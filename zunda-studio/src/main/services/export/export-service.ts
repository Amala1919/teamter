import type { ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { createCanvas, ImageData, type Canvas } from '@napi-rs/canvas'

import { sourceTimeMs } from '@shared/audio/envelope'
import type { ExportProgress, ExportRequest } from '@shared/export/types'
import { projectDurationMs } from '@shared/project/queries'
import type { ItemId, Project, VideoItem } from '@shared/project/types'
import { renderFrame } from '@shared/render/compositor'
import type { Ctx2D } from '@shared/render/types'
import type { AppSettings } from '@shared/settings/schema'

import { AppError, toErrorShape } from '../../core/errors'
import type { EventBus } from '../../core/events'
import { spawnProcess } from '../../core/process'
import { NodeRenderResources } from '../../render/node-resources'
import { ffmpegErrorDetail, type FfmpegLocator } from '../media/ffmpeg'
import type { PsdService } from '../psd/psd-service'
import type { SynthesisService } from '../voice/synthesis-service'
import { mixAudio } from './audio-mix'
import { FrameStream } from './streams'

interface ActiveVideo {
  stream: FrameStream
  canvas: Canvas
  width: number
  height: number
}

/**
 * mp4 の書き出し。プレビューと同じ Compositor で1コマずつ描き、ffmpeg で H.264/AAC にする。
 * 音声は先に WAV に混ぜておき、映像のエンコードと同時に多重化する。
 */
export class ExportService {
  private readonly jobs = new Map<string, AbortController>()

  constructor(
    private readonly locator: FfmpegLocator,
    private readonly getSettings: () => AppSettings,
    private readonly events: EventBus,
    private readonly psd: PsdService,
    private readonly synthesis: SynthesisService,
    private readonly tempDirectory: string
  ) {}

  /** 書き出しを始めて、ジョブIDを返す。進み具合と結果は export:progress で知らせる。 */
  start(request: ExportRequest): string {
    const jobId = randomUUID()
    const controller = new AbortController()
    this.jobs.set(jobId, controller)
    void this.run(jobId, request, controller.signal).finally(() => this.jobs.delete(jobId))
    return jobId
  }

  cancel(jobId: string): void {
    this.jobs.get(jobId)?.abort()
  }

  /** 書き出しを最後まで行う(テストや、進み具合の通知が要らない呼び出し向け)。 */
  async run(jobId: string, request: ExportRequest, signal?: AbortSignal): Promise<void> {
    const emit = (progress: Omit<ExportProgress, 'jobId'>): void => this.events.emit('export:progress', { jobId, ...progress })
    const partial = request.outputPath.replace(/(\.\w+)?$/, '.part$1')
    const audioPath = join(this.tempDirectory, `${jobId}.wav`)
    try {
      emit({ phase: 'prepare', ratio: 0 })
      const project = request.project
      const startMs = Math.max(0, request.startMs ?? 0)
      const endMs = Math.min(request.endMs ?? projectDurationMs(project), projectDurationMs(project))
      if (endMs <= startMs) throw new AppError('INVALID_ARGUMENT', '書き出す範囲が空です')
      const ffmpeg = await this.locator.ffmpeg()
      const env = this.locator.processEnv
      await mkdir(this.tempDirectory, { recursive: true })
      await mkdir(dirname(request.outputPath), { recursive: true })
      const resources = await this.prepareResources(project)

      emit({ phase: 'audio', ratio: 0 })
      await mixAudio({
        project,
        startMs,
        endMs,
        ffmpeg,
        env,
        outputPath: audioPath,
        signal,
        voicePath: async (item) => {
          const path = item.synthesis ? await this.synthesis.resolve(item.synthesis.cacheKey) : null
          if (!path) throw new AppError('NOT_FOUND', `セリフの音声が見つかりません(合成し直してください): ${item.text}`)
          return path
        },
        onProgress: (ratio) => emit({ phase: 'audio', ratio })
      })

      await this.encodeVideo(project, request, { startMs, endMs, ffmpeg, env, audioPath, partial, resources, signal }, (ratio, fps) =>
        emit({ phase: 'video', ratio, fps })
      )
      await rename(partial, request.outputPath)
      emit({ phase: 'done', ratio: 1, outputPath: request.outputPath })
    } catch (error) {
      await rm(partial, { force: true })
      const cancelled = signal?.aborted === true || (error instanceof AppError && error.code === 'CANCELLED')
      emit(cancelled ? { phase: 'cancelled', ratio: 0 } : { phase: 'error', ratio: 0, error: toErrorShape(error) })
      if (!cancelled) throw error
    } finally {
      await rm(audioPath, { force: true })
    }
  }

  private async prepareResources(project: Project): Promise<NodeRenderResources> {
    const resources = new NodeRenderResources()
    for (const character of Object.values(project.characters)) {
      const assetId = character.portrait?.assetId
      const asset = assetId ? project.assets[assetId] : undefined
      if (!assetId || !asset || asset.type !== 'psd') continue
      await resources.addPsd(assetId, await this.psd.load(asset.path.absolute))
    }
    for (const item of project.items) {
      if (item.type !== 'image') continue
      const asset = project.assets[item.assetId]
      if (asset?.type === 'image') await resources.loadImage(asset.path.absolute)
    }
    return resources
  }

  private async encodeVideo(
    project: Project,
    request: ExportRequest,
    context: {
      startMs: number
      endMs: number
      ffmpeg: string
      env: NodeJS.ProcessEnv
      audioPath: string
      partial: string
      resources: NodeRenderResources
      signal: AbortSignal | undefined
    },
    onProgress: (ratio: number, fps: number) => void
  ): Promise<void> {
    const { width, height } = project.canvas
    const fps = request.fps ?? project.canvas.fps
    const settings = this.getSettings().export
    const outputHeight = request.height && request.height !== height ? request.height : null
    const encoder = spawnProcess({
      command: context.ffmpeg,
      env: context.env,
      args: [
        '-y',
        '-hide_banner',
        '-loglevel',
        'error',
        '-f',
        'rawvideo',
        '-pix_fmt',
        'rgba',
        '-s',
        `${width}x${height}`,
        '-r',
        String(fps),
        '-i',
        '-',
        '-i',
        context.audioPath,
        ...(outputHeight ? ['-vf', `scale=-2:${outputHeight}:flags=lanczos`] : []),
        '-map',
        '0:v',
        '-map',
        '1:a',
        '-c:v',
        'libx264',
        '-preset',
        settings.preset,
        '-crf',
        String(request.crf ?? settings.crf),
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-b:a',
        `${settings.audioBitrateKbps}k`,
        '-movflags',
        '+faststart',
        '-shortest',
        context.partial
      ]
    })
    let stderr = ''
    encoder.stderr?.setEncoding('utf8')
    encoder.stderr?.on('data', (chunk: string) => {
      if (stderr.length < 64 * 1024) stderr += chunk
    })
    const exited = new Promise<number | null>((resolve, reject) => {
      encoder.on('error', reject)
      encoder.on('close', resolve)
    })

    const canvas = createCanvas(width, height)
    const ctx = canvas.getContext('2d')
    const videos = new Map<ItemId, ActiveVideo>()
    const frameCount = Math.max(1, Math.ceil(((context.endMs - context.startMs) / 1000) * fps))
    const started = Date.now()
    try {
      for (let frame = 0; frame < frameCount; frame++) {
        if (context.signal?.aborted) throw new AppError('CANCELLED', '書き出しを中止しました')
        const timeMs = context.startMs + (frame * 1000) / fps
        await this.updateVideoFrames(project, timeMs, fps, videos, context)
        renderFrame(ctx as unknown as Ctx2D, project, timeMs, context.resources)
        const pixels = ctx.getImageData(0, 0, width, height).data
        await writeFrame(encoder, Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength))
        // 1コマごとにイベントループを一巡させる。@napi-rs/canvas の getImageData・ImageData の画素(1コマ 8MB)は、
        // 次の巡回(setImmediate)で解放される。書き込みがすぐ終わる環境(Windows のパイプなど)では巡回が起きず、
        // コマの数だけメモリが溜まって、PC のメモリを使い切って ffmpeg が失敗していた。
        await yieldToEventLoop()
        if (frame % 5 === 0 || frame === frameCount - 1) {
          const elapsed = (Date.now() - started) / 1000
          onProgress((frame + 1) / frameCount, elapsed > 0 ? (frame + 1) / elapsed : 0)
        }
      }
      encoder.stdin?.end()
      const code = await exited
      if (code !== 0) throw new AppError('FFMPEG_FAILED', encodeFailure(stderr), ffmpegErrorDetail(stderr))
    } catch (error) {
      encoder.kill('SIGKILL')
      if (error instanceof AppError && error.code === 'FFMPEG_FAILED') throw error
      // 書き込みの失敗は、ffmpeg が先に異常終了したことが原因であることが多い。その理由を添える。
      if (!(error instanceof AppError) && stderr.trim() !== '') {
        throw new AppError('FFMPEG_FAILED', encodeFailure(stderr), ffmpegErrorDetail(stderr))
      }
      throw error
    } finally {
      for (const video of videos.values()) video.stream.close()
    }
  }

  /** この時刻に映る動画アイテムのコマを用意する。映らなくなった動画は読み込みを止める。 */
  private async updateVideoFrames(
    project: Project,
    timeMs: number,
    fps: number,
    videos: Map<ItemId, ActiveVideo>,
    context: { ffmpeg: string; env: NodeJS.ProcessEnv; resources: NodeRenderResources }
  ): Promise<void> {
    const active = new Set<ItemId>()
    for (const item of project.items) {
      if (item.type !== 'video' || timeMs < item.startMs || timeMs >= item.startMs + item.durationMs) continue
      const asset = project.assets[item.assetId]
      if (!asset || asset.type !== 'video') continue
      active.add(item.id)
      let video = videos.get(item.id)
      if (!video) {
        video = this.openVideo(project, item, timeMs, fps, context)
        videos.set(item.id, video)
      }
      const frame = await video.stream.next()
      if (!frame) continue
      const data = new ImageData(new Uint8ClampedArray(frame.buffer, frame.byteOffset, frame.byteLength), video.width, video.height)
      video.canvas.getContext('2d').putImageData(data, 0, 0)
      context.resources.setVideoFrame(item.id, video.canvas)
    }
    for (const [itemId, video] of videos) {
      if (active.has(itemId)) continue
      video.stream.close()
      videos.delete(itemId)
      context.resources.setVideoFrame(itemId, null)
    }
  }

  private openVideo(
    project: Project,
    item: VideoItem,
    timeMs: number,
    fps: number,
    context: { ffmpeg: string; env: NodeJS.ProcessEnv }
  ): ActiveVideo {
    const asset = project.assets[item.assetId]
    if (!asset || asset.type !== 'video') throw new AppError('NOT_FOUND', '動画の素材が見つかりません')
    // Compositor が描く大きさで読めば、拡大縮小の手間とメモリが最小になる。
    // ズームがあるなら寄ったときに粗くならないよう2倍まで細かく読む。素材より細かくはしない。
    const fitted = asset.width * Math.min(project.canvas.width / asset.width, project.canvas.height / asset.height)
    const headroom = project.items.some((candidate) => candidate.type === 'zoom') ? 2 : 1
    const wanted = fitted * Math.max(item.transform.scale, 0.05) * headroom
    const even = (value: number): number => Math.max(2, Math.round(value / 2) * 2)
    const width = even(Math.min(asset.width, Math.max(16, wanted)))
    const height = even((width * asset.height) / asset.width)
    return {
      stream: new FrameStream(context.ffmpeg, context.env, asset.path.absolute, {
        startMs: sourceTimeMs(item, timeMs - item.startMs),
        fps,
        width,
        height,
        playbackRate: item.freeze ? 1 : item.playbackRate,
        singleFrame: item.freeze === true
      }),
      canvas: createCanvas(width, height),
      width,
      height
    }
  }
}

/** エンコードの失敗を伝える文。メモリ不足なら対処も添える。 */
export function encodeFailure(stderr: string): string {
  return /Cannot allocate memory|out of memory/i.test(stderr)
    ? '動画のエンコードに失敗しました(PC のメモリが足りなくなりました。ほかのアプリを閉じるか、書き出しの解像度を下げてもう一度試してください)'
    : '動画のエンコードに失敗しました'
}

/** イベントループを一巡させる(ネイティブのメモリの後片付けを走らせる)。 */
export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

function writeFrame(child: ChildProcess, data: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const stdin = child.stdin
    if (!stdin || stdin.destroyed) {
      reject(new Error('エンコーダが終了しています'))
      return
    }
    const onError = (error: Error): void => reject(error)
    stdin.once('error', onError)
    const flushed = stdin.write(data, (error) => {
      stdin.off('error', onError)
      if (error) reject(error)
    })
    if (flushed) resolve()
    else stdin.once('drain', () => resolve())
  })
}
