import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'

import { IMAGE_EXTENSIONS, type MediaProbe, type ProxyFormat, type WaveformPeaks } from '@shared/media/types'
import type { AppSettings } from '@shared/settings/schema'

import { AppError } from '../../core/errors'
import type { EventBus } from '../../core/events'
import { runProcess, spawnProcess } from '../../core/process'
import { ffmpegErrorDetail, type FfmpegLocator } from './ffmpeg'

/** 波形の細かさ。10ms ごとに1点。 */
const PEAKS_PER_SECOND = 100
const PEAK_SAMPLE_RATE = 8000

interface FfprobeStream {
  codec_type?: string
  codec_name?: string
  width?: number
  height?: number
  avg_frame_rate?: string
  r_frame_rate?: string
  duration?: string
  disposition?: { attached_pic?: number }
}

interface FfprobeOutput {
  streams?: FfprobeStream[]
  format?: { duration?: string; format_name?: string }
}

function parseRate(rate: string | undefined): number {
  if (!rate) return 0
  const [numerator, denominator] = rate.split('/').map(Number)
  if (!numerator || !denominator) return 0
  return Math.round((numerator / denominator) * 1000) / 1000
}

/** ffprobe の JSON を素材の情報にまとめる。画像は拡張子と「長さが無い1枚の絵」で見分ける。 */
export function interpretProbe(path: string, output: FfprobeOutput): MediaProbe {
  const streams = output.streams ?? []
  const video = streams.find((stream) => stream.codec_type === 'video' && !stream.disposition?.attached_pic)
  const audio = streams.find((stream) => stream.codec_type === 'audio')
  const durationSeconds = Number(output.format?.duration ?? video?.duration ?? audio?.duration ?? 0)
  const durationMs = Number.isFinite(durationSeconds) ? Math.round(durationSeconds * 1000) : 0
  const container = output.format?.format_name ?? ''
  const isImage =
    IMAGE_EXTENSIONS.includes(extname(path).toLowerCase()) || container.endsWith('_pipe') || container === 'image2'

  if (video && (isImage || durationMs === 0)) {
    return {
      kind: 'image',
      durationMs: 0,
      width: video.width ?? 0,
      height: video.height ?? 0,
      fps: 0,
      hasAudio: false,
      videoCodec: video.codec_name ?? null,
      audioCodec: null,
      container
    }
  }
  if (video) {
    return {
      kind: 'video',
      durationMs,
      width: video.width ?? 0,
      height: video.height ?? 0,
      fps: parseRate(video.avg_frame_rate) || parseRate(video.r_frame_rate) || 30,
      hasAudio: audio !== undefined,
      videoCodec: video.codec_name ?? null,
      audioCodec: audio?.codec_name ?? null,
      container
    }
  }
  if (audio) {
    return {
      kind: 'audio',
      durationMs,
      width: 0,
      height: 0,
      fps: 0,
      hasAudio: true,
      videoCodec: null,
      audioCodec: audio.codec_name ?? null,
      container
    }
  }
  throw new AppError('FFMPEG_FAILED', '映像も音声も含まれていないファイルです')
}

/**
 * 素材の下調べ(ffprobe)と、編集を軽くするための派生ファイル(プロキシ・波形)。
 * 派生ファイルは元ファイルの場所・大きさ・更新時刻から作ったキーでキャッシュし、元が変われば作り直す。
 */
export class MediaService {
  private readonly proxyJobs = new Map<string, Promise<string>>()
  private readonly peakJobs = new Map<string, Promise<WaveformPeaks>>()

  constructor(
    private readonly locator: FfmpegLocator,
    private readonly getSettings: () => AppSettings,
    private readonly events: EventBus,
    private readonly directories: { proxy: string; peaks: string }
  ) {}

  async probe(path: string): Promise<MediaProbe> {
    await this.requireFile(path)
    const ffprobe = await this.locator.ffprobe()
    const result = await runProcess({
      command: ffprobe,
      args: ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path],
      env: this.locator.processEnv,
      timeoutMs: 30_000
    })
    if (result.exitCode !== 0) {
      throw new AppError('FFMPEG_FAILED', 'ファイルを読み取れませんでした', ffmpegErrorDetail(result.stderr))
    }
    let output: FfprobeOutput
    try {
      output = JSON.parse(result.stdout) as FfprobeOutput
    } catch {
      throw new AppError('FFMPEG_FAILED', 'ffprobe の出力を解釈できませんでした', result.stdout.slice(0, 500))
    }
    return interpretProbe(path, output)
  }

  /**
   * 編集用の軽い動画を用意して、その場所を返す。作成中は進み具合を media:proxy-progress で知らせる。
   * maxHeight はプレビューの高さの上限(0 なら元の大きさのまま)。省略すると設定の高さ(既定 540p)。
   */
  async proxy(path: string, format: ProxyFormat, maxHeight?: number): Promise<string> {
    const height = maxHeight ?? this.getSettings().media.proxyHeight
    const key = await this.cacheKey(path, `proxy:${format}:${height}`)
    const output = join(this.directories.proxy, `${key}.${format}`)
    if (await exists(output)) return output
    let job = this.proxyJobs.get(output)
    if (!job) {
      job = this.makeProxy(path, output, format, height).finally(() => this.proxyJobs.delete(output))
      this.proxyJobs.set(output, job)
    }
    return job
  }

  async peaks(path: string): Promise<WaveformPeaks> {
    const key = await this.cacheKey(path, `peaks:${PEAKS_PER_SECOND}`)
    const output = join(this.directories.peaks, `${key}.bin`)
    if (await exists(output)) {
      return { samplesPerSecond: PEAKS_PER_SECOND, data: (await readFile(output)).toString('base64') }
    }
    let job = this.peakJobs.get(output)
    if (!job) {
      job = this.makePeaks(path, output).finally(() => this.peakJobs.delete(output))
      this.peakJobs.set(output, job)
    }
    return job
  }

  private async makeProxy(path: string, output: string, format: ProxyFormat, height: number): Promise<string> {
    const ffmpeg = await this.locator.ffmpeg()
    const probe = await this.probe(path)
    await mkdir(this.directories.proxy, { recursive: true })
    const partial = output.replace(/\.(\w+)$/, '.part.$1')
    // シークしやすいよう、キーフレームを 0.5 秒ごとに入れる。
    const gop = String(Math.max(1, Math.round((probe.fps || 30) / 2)))
    // 高い画質を選んだときは、画質の落ちにくい設定にする(大きさ・作る時間とのつり合い)。
    const quality = proxyQuality(height)
    const codec =
      format === 'mp4'
        ? ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', String(quality.crf), '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart']
        : ['-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', quality.bitrate, '-c:a', 'libopus', '-b:a', '96k']
    const args = [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-nostats',
      '-progress',
      'pipe:1',
      '-i',
      path,
      '-map',
      '0:v:0',
      '-map',
      '0:a:0?',
      '-vf',
      // 0 は元の大きさのまま(符号化できるよう偶数にだけそろえる)。
      height > 0 ? `scale=-2:'min(${height},ih)'` : 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
      '-g',
      gop,
      ...codec,
      partial
    ]
    const emit = (ratio: number): void => this.events.emit('media:proxy-progress', { path, ratio })
    emit(0)
    const result = await runProcess({
      command: ffmpeg,
      args,
      env: this.locator.processEnv,
      onStdoutLine: (line) => {
        const match = /^out_time_us=(\d+)/.exec(line)
        if (match && probe.durationMs > 0) emit(Math.min(0.99, Number(match[1]) / 1000 / probe.durationMs))
      }
    })
    if (result.exitCode !== 0) {
      await rm(partial, { force: true })
      throw new AppError('FFMPEG_FAILED', '編集用の動画(プロキシ)を作れませんでした', ffmpegErrorDetail(result.stderr))
    }
    await rename(partial, output)
    emit(1)
    return output
  }

  private async makePeaks(path: string, output: string): Promise<WaveformPeaks> {
    const ffmpeg = await this.locator.ffmpeg()
    const bucket = PEAK_SAMPLE_RATE / PEAKS_PER_SECOND
    const peaks: number[] = []
    let current = 0
    let count = 0
    let carry: Buffer | null = null
    let stderr = ''

    const child = spawnProcess({
      command: ffmpeg,
      args: ['-hide_banner', '-loglevel', 'error', '-i', path, '-map', '0:a:0', '-ac', '1', '-ar', String(PEAK_SAMPLE_RATE), '-f', 's16le', '-'],
      env: this.locator.processEnv
    })
    child.stdin?.end()
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk
    })
    child.stdout?.on('data', (chunk: Buffer) => {
      let data = carry ? Buffer.concat([carry, chunk]) : chunk
      const usable = data.length - (data.length % 2)
      carry = usable < data.length ? data.subarray(usable) : null
      data = data.subarray(0, usable)
      for (let offset = 0; offset < data.length; offset += 2) {
        current = Math.max(current, Math.abs(data.readInt16LE(offset)))
        if (++count === bucket) {
          peaks.push(Math.min(255, Math.round((current / 32768) * 255)))
          current = 0
          count = 0
        }
      }
    })
    const exitCode = await new Promise<number | null>((resolvePromise, rejectPromise) => {
      child.on('error', rejectPromise)
      child.on('close', resolvePromise)
    })
    if (exitCode !== 0) {
      throw new AppError('FFMPEG_FAILED', '波形を作れませんでした', ffmpegErrorDetail(stderr))
    }
    if (count > 0) peaks.push(Math.min(255, Math.round((current / 32768) * 255)))
    const buffer = Buffer.from(peaks)
    await mkdir(this.directories.peaks, { recursive: true })
    await writeFile(output, buffer)
    return { samplesPerSecond: PEAKS_PER_SECOND, data: buffer.toString('base64') }
  }

  private async cacheKey(path: string, purpose: string): Promise<string> {
    const info = await this.requireFile(path)
    return createHash('sha256').update(`${purpose}\n${path}\n${info.size}\n${info.mtimeMs}`).digest('hex').slice(0, 32)
  }

  private async requireFile(path: string): Promise<{ size: number; mtimeMs: number }> {
    try {
      const info = await stat(path)
      if (!info.isFile()) throw new Error('not a file')
      return info
    } catch {
      throw new AppError('NOT_FOUND', `ファイルが見つかりません: ${path}`)
    }
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/** プレビュー用の動画の画質。高さ 0 は元の大きさ。 */
export function proxyQuality(height: number): { crf: number; bitrate: string } {
  if (height === 0 || height >= 1080) return { crf: 20, bitrate: '8M' }
  if (height >= 720) return { crf: 23, bitrate: '4M' }
  return { crf: 26, bitrate: '2M' }
}
