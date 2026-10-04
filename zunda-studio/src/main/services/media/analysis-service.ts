import { createHash } from 'node:crypto'
import { mkdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

import type { MediaActivity } from '@shared/media/activity'
import type { RecordingAnalysis } from '@shared/media/analysis'

import { AppError } from '../../core/errors'
import { writeFileAtomic } from '../../core/fs'
import { runProcess } from '../../core/process'
import { ffmpegErrorDetail, type FfmpegLocator } from './ffmpeg'
import type { MediaService } from './media-service'

/** 場面の切り替わりとみなす変化の大きさ(0〜1)。 */
const SCENE_THRESHOLD = 0.3
/** 動きを測るときの1秒あたりのコマ数。 */
const ACTIVITY_FPS = 4
/** 無音とみなす音量と長さ。 */
const SILENCE_DB = -40
const SILENCE_SECONDS = 1.5

/**
 * 録画の解析(場面の切り替わり・無音・音の大きさ)。自動下書きで「使えそうな区間」を選ぶ材料にする。
 * 数十分の録画でも数分で終わるよう、映像は1秒に2コマ・小さな画にして調べる。結果はファイルごとにキャッシュする。
 */
export class AnalysisService {
  constructor(
    private readonly locator: FfmpegLocator,
    private readonly media: MediaService,
    private readonly cacheDirectory: string
  ) {}

  async analyze(path: string): Promise<RecordingAnalysis> {
    const info = await stat(path).catch(() => {
      throw new AppError('NOT_FOUND', `ファイルが見つかりません: ${path}`)
    })
    const key = createHash('sha256').update(`analysis:1\n${path}\n${info.size}\n${info.mtimeMs}`).digest('hex').slice(0, 32)
    const cachePath = join(this.cacheDirectory, `${key}.json`)
    try {
      return JSON.parse(await readFile(cachePath, 'utf8')) as RecordingAnalysis
    } catch {
      // 未解析なら解析する。
    }

    const probe = await this.media.probe(path)
    const [sceneChanges, silences, peaks] = await Promise.all([this.scenes(path), this.silences(path, probe.hasAudio), probe.hasAudio ? this.media.peaks(path) : null])
    const analysis: RecordingAnalysis = {
      durationMs: probe.durationMs,
      sceneChanges,
      silences,
      loudness: peaks ? perSecond(Buffer.from(peaks.data, 'base64'), peaks.samplesPerSecond) : []
    }
    await mkdir(this.cacheDirectory, { recursive: true })
    await writeFileAtomic(cachePath, JSON.stringify(analysis))
    return analysis
  }

  /**
   * 動きと音の時間変化(待ち時間を探すのに使う)。映像は1秒に4コマ・小さな画で前のコマとの違いを測る。
   * 結果はファイルごとにキャッシュする。
   */
  async activity(path: string): Promise<MediaActivity> {
    const info = await stat(path).catch(() => {
      throw new AppError('NOT_FOUND', `ファイルが見つかりません: ${path}`)
    })
    const key = createHash('sha256').update(`activity:1\n${path}\n${info.size}\n${info.mtimeMs}`).digest('hex').slice(0, 32)
    const cachePath = join(this.cacheDirectory, `${key}.json`)
    try {
      return JSON.parse(await readFile(cachePath, 'utf8')) as MediaActivity
    } catch {
      // 未解析なら解析する。
    }
    const probe = await this.media.probe(path)
    const stepMs = 1000 / ACTIVITY_FPS
    const [motion, peaks] = await Promise.all([this.motion(path, probe.durationMs, stepMs), probe.hasAudio ? this.media.peaks(path) : null])
    const activity: MediaActivity = {
      durationMs: probe.durationMs,
      stepMs,
      motion,
      sound: peaks ? perStep(Buffer.from(peaks.data, 'base64'), peaks.samplesPerSecond, stepMs) : []
    }
    await mkdir(this.cacheDirectory, { recursive: true })
    await writeFileAtomic(cachePath, JSON.stringify(activity))
    return activity
  }

  /** 1コマごとの、前のコマとの違い(scene_score)。 */
  private async motion(path: string, durationMs: number, stepMs: number): Promise<number[]> {
    const result = await this.run(['-i', path, '-an', '-vf', `fps=${ACTIVITY_FPS},scale=160:-2,select='gte(scene\\,0)',metadata=print:key=lavfi.scene_score`, '-f', 'null', '-'])
    const values: number[] = new Array<number>(Math.ceil(durationMs / stepMs)).fill(0)
    let index = -1
    for (const line of result.split('\n')) {
      const time = /pts_time:([\d.]+)/.exec(line)
      if (time) {
        index = Math.round((Number(time[1]) * 1000) / stepMs)
        continue
      }
      const score = /lavfi\.scene_score=([\d.]+)/.exec(line)
      if (score && index >= 0 && index < values.length) values[index] = Math.round(Number(score[1]) * 100_000) / 100_000
    }
    return values
  }

  private async scenes(path: string): Promise<number[]> {
    const result = await this.run(['-i', path, '-an', '-vf', `fps=2,scale=160:-2,select='gt(scene\\,${SCENE_THRESHOLD})',showinfo`, '-f', 'null', '-'])
    const times: number[] = []
    for (const match of result.matchAll(/pts_time:([\d.]+)/g)) times.push(Math.round(Number(match[1]) * 1000))
    return times
  }

  private async silences(path: string, hasAudio: boolean): Promise<[number, number][]> {
    if (!hasAudio) return []
    const result = await this.run(['-i', path, '-vn', '-af', `silencedetect=noise=${SILENCE_DB}dB:d=${SILENCE_SECONDS}`, '-f', 'null', '-'])
    const silences: [number, number][] = []
    let start: number | null = null
    for (const line of result.split('\n')) {
      const begin = /silence_start: (-?[\d.]+)/.exec(line)
      const end = /silence_end: ([\d.]+)/.exec(line)
      if (begin) start = Math.max(0, Math.round(Number(begin[1]) * 1000))
      if (end && start !== null) {
        silences.push([start, Math.round(Number(end[1]) * 1000)])
        start = null
      }
    }
    return silences
  }

  /** ffmpeg を動かし、解析の結果が出る標準エラー出力を返す。 */
  private async run(args: string[]): Promise<string> {
    const result = await runProcess({
      command: await this.locator.ffmpeg(),
      args: ['-hide_banner', '-nostats', ...args],
      env: this.locator.processEnv,
      timeoutMs: 30 * 60 * 1000
    })
    if (result.exitCode !== 0) throw new AppError('FFMPEG_FAILED', '録画を解析できませんでした', ffmpegErrorDetail(result.stderr))
    return result.stderr
  }
}

/** 10ms ごとの振幅を、stepMs ごとの大きさ(その間の最大。0〜1)にまとめる。 */
function perStep(peaks: Buffer, samplesPerSecond: number, stepMs: number): number[] {
  const per = Math.max(1, Math.round((samplesPerSecond * stepMs) / 1000))
  const values: number[] = []
  for (let offset = 0; offset < peaks.length; offset += per) {
    let peak = 0
    for (const value of peaks.subarray(offset, offset + per)) peak = Math.max(peak, value)
    values.push(Math.round((peak / 255) * 1000) / 1000)
  }
  return values
}

/** 10ms ごとの振幅を1秒ごとの大きさ(0〜1)にまとめる。 */
function perSecond(peaks: Buffer, samplesPerSecond: number): number[] {
  const seconds: number[] = []
  for (let offset = 0; offset < peaks.length; offset += samplesPerSecond) {
    const slice = peaks.subarray(offset, offset + samplesPerSecond)
    let sum = 0
    for (const value of slice) sum += value
    seconds.push(Math.round((sum / Math.max(1, slice.length) / 255) * 1000) / 1000)
  }
  return seconds
}
