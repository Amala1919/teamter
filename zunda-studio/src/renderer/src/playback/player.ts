import { create } from 'zustand'

import { gainAt, gainEnvelope, sourceSpanMs } from '@shared/audio/envelope'
import { isVoiceItem, itemEndMs, projectDurationMs } from '@shared/project/queries'
import type { AudioItem, Item, Ms, Project } from '@shared/project/types'

import { api } from '../api'
import { useEditorStore } from '../state/store'
import { resolveWavPath } from '../state/voice'
import { videoPool } from './video-pool'

/** 予約する音の1件。gain は音量の折れ線(BGM のフェードやダッキング)。 */
interface ScheduleEntry {
  startMs: Ms
  buffer: AudioBuffer
  /** 素材の切り出し(秒)。ループならこの区間を繰り返す。 */
  offsetSeconds?: number
  loop?: { start: number; end: number }
  durationMs?: Ms
  item?: AudioItem
}

interface PlaybackState {
  playing: boolean
  /** 再生開始の準備中(音声の読み込み中)。 */
  loading: boolean
  error: string | null
}

export const usePlaybackStore = create<PlaybackState>(() => ({ playing: false, loading: false, error: null }))

/**
 * 再生の時計は AudioContext の currentTime を正とする。
 * 画面の更新(requestAnimationFrame)は遅れたり間引かれたりするが、音声の時計は正確に進むため、
 * 再生位置は常に音声の時計から計算し、字幕や口パクが音声とずれないようにする。
 */
class Player {
  private context: AudioContext | null = null
  private sources: AudioScheduledSourceNode[] = []
  private readonly buffers = new Map<string, AudioBuffer>()
  private frame = 0
  private session = 0

  async play(fromMs: Ms, untilMs?: Ms): Promise<void> {
    this.stop()
    const session = ++this.session
    const project = useEditorStore.getState().project
    const endMs = untilMs ?? projectDurationMs(project)
    if (fromMs >= endMs) return

    usePlaybackStore.setState({ loading: true, error: null })
    const context = this.ensureContext()
    try {
      await context.resume()
      const schedule = await this.prepare(project, fromMs, endMs)
      if (session !== this.session) return

      const startAt = context.currentTime + 0.05
      for (const entry of schedule) this.schedule(context, project, entry, fromMs, endMs, startAt)

      usePlaybackStore.setState({ playing: true, loading: false })
      const tick = (): void => {
        if (session !== this.session) return
        const position = fromMs + Math.max(0, context.currentTime - startAt) * 1000
        if (position >= endMs) {
          useEditorStore.getState().setPlayhead(endMs)
          this.stop()
          return
        }
        useEditorStore.getState().setPlayhead(position)
        videoPool.sync(useEditorStore.getState().project, position)
        this.frame = requestAnimationFrame(tick)
      }
      this.frame = requestAnimationFrame(tick)
    } catch (error) {
      if (session !== this.session) return
      usePlaybackStore.setState({ playing: false, loading: false, error: String(error) })
    }
  }

  stop(): void {
    this.session++
    cancelAnimationFrame(this.frame)
    for (const source of this.sources) {
      try {
        source.stop()
      } catch {
        // まだ開始していないソースを止めると例外になる環境がある。止まっていれば十分。
      }
    }
    this.sources = []
    videoPool.stop()
    usePlaybackStore.setState({ playing: false, loading: false })
  }

  private ensureContext(): AudioContext {
    this.context ??= new AudioContext()
    return this.context
  }

  /** 1件の音を AudioContext に予約する。途中から再生するときは、その位置から鳴らす。 */
  private schedule(context: AudioContext, project: Project, entry: ScheduleEntry, fromMs: Ms, endMs: Ms, startAt: number): void {
    const itemStart = entry.startMs
    const itemEnd = itemStart + (entry.durationMs ?? entry.buffer.duration * 1000)
    const playFrom = Math.max(fromMs, itemStart)
    const playUntil = Math.min(endMs, itemEnd)
    if (playUntil <= playFrom) return

    const source = context.createBufferSource()
    source.buffer = entry.buffer
    let output: AudioNode = source
    if (entry.item) {
      const gain = context.createGain()
      const points = gainEnvelope(project, entry.item)
      const toContextTime = (relMs: Ms): number => startAt + (itemStart + relMs - fromMs) / 1000
      const fromRel = playFrom - itemStart
      gain.gain.setValueAtTime(gainAt(points, fromRel), toContextTime(fromRel))
      for (const point of points) {
        if (point.atMs > fromRel) gain.gain.linearRampToValueAtTime(point.gain, toContextTime(point.atMs))
      }
      source.connect(gain)
      output = gain
    }
    output.connect(context.destination)

    const delay = (playFrom - fromMs) / 1000
    const relSeconds = (playFrom - itemStart) / 1000
    const length = (playUntil - playFrom) / 1000
    if (entry.loop) {
      const span = entry.loop.end - entry.loop.start
      source.loop = true
      source.loopStart = entry.loop.start
      source.loopEnd = entry.loop.end
      source.start(startAt + delay, entry.loop.start + (span > 0 ? relSeconds % span : 0), length)
    } else {
      source.start(startAt + delay, (entry.offsetSeconds ?? 0) + relSeconds, length)
    }
    this.sources.push(source)
  }

  private async prepare(project: Project, fromMs: Ms, endMs: Ms): Promise<ScheduleEntry[]> {
    const muted = new Set(project.layers.filter((layer) => layer.muted).map((layer) => layer.id))
    const inRange = (item: Item): boolean => !muted.has(item.layerId) && itemEndMs(item) > fromMs && item.startMs < endMs
    const loaded = await Promise.all(
      project.items.map(async (item): Promise<ScheduleEntry | null> => {
        if (!inRange(item)) return null
        if (isVoiceItem(item) && item.synthesis) {
          const buffer = await this.load(project, item)
          return buffer ? { startMs: item.startMs, buffer } : null
        }
        if (item.type === 'audio') {
          const asset = project.assets[item.assetId]
          if (!asset) return null
          const buffer = await this.loadFile(asset.path.absolute)
          const loop = item.loop && sourceSpanMs(item) > 0 ? { start: item.inMs / 1000, end: item.outMs / 1000 } : undefined
          return { startMs: item.startMs, buffer, offsetSeconds: item.inMs / 1000, durationMs: item.durationMs, item, ...(loop ? { loop } : {}) }
        }
        return null
      })
    )
    return loaded.filter((entry): entry is ScheduleEntry => entry !== null)
  }

  /** 素材ファイルを丸ごとデコードする(BGM・効果音)。 */
  private async loadFile(path: string): Promise<AudioBuffer> {
    const cached = this.buffers.get(`file:${path}`)
    if (cached) return cached
    const response = await fetch(api.mediaUrl(path))
    if (!response.ok) throw new Error(`音声ファイルを読み込めません: ${path}`)
    const buffer = await this.ensureContext().decodeAudioData(await response.arrayBuffer())
    this.buffers.set(`file:${path}`, buffer)
    return buffer
  }

  private async load(project: Project, item: Parameters<typeof resolveWavPath>[1]): Promise<AudioBuffer | null> {
    const key = item.synthesis?.cacheKey
    if (!key) return null
    const cached = this.buffers.get(key)
    if (cached) return cached
    const path = await resolveWavPath(project, item)
    if (!path) return null
    const response = await fetch(api.mediaUrl(path))
    const buffer = await this.ensureContext().decodeAudioData(await response.arrayBuffer())
    this.buffers.set(key, buffer)
    return buffer
  }
}

export const player = new Player()

export function togglePlayback(): void {
  if (usePlaybackStore.getState().playing) {
    player.stop()
    return
  }
  const { playheadMs, project } = useEditorStore.getState()
  const start = playheadMs >= projectDurationMs(project) ? 0 : playheadMs
  void player.play(start)
}
