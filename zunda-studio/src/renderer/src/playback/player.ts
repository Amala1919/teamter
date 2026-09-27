import { create } from 'zustand'

import { isVoiceItem, itemEndMs, projectDurationMs } from '@shared/project/queries'
import type { Ms, Project } from '@shared/project/types'

import { api } from '../api'
import { useEditorStore } from '../state/store'
import { resolveWavPath } from '../state/voice'

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
      for (const entry of schedule) {
        const source = context.createBufferSource()
        source.buffer = entry.buffer
        source.connect(context.destination)
        const delay = Math.max(0, (entry.startMs - fromMs) / 1000)
        const offset = Math.max(0, (fromMs - entry.startMs) / 1000)
        const length = Math.min(entry.buffer.duration - offset, (endMs - Math.max(fromMs, entry.startMs)) / 1000)
        if (length <= 0) continue
        source.start(startAt + delay, offset, length)
        this.sources.push(source)
      }

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
    usePlaybackStore.setState({ playing: false, loading: false })
  }

  private ensureContext(): AudioContext {
    this.context ??= new AudioContext()
    return this.context
  }

  private async prepare(
    project: Project,
    fromMs: Ms,
    endMs: Ms
  ): Promise<{ startMs: Ms; buffer: AudioBuffer }[]> {
    const muted = new Set(project.layers.filter((layer) => layer.muted).map((layer) => layer.id))
    const entries = project.items.filter(
      (item) =>
        isVoiceItem(item) &&
        item.synthesis !== null &&
        !muted.has(item.layerId) &&
        itemEndMs(item) > fromMs &&
        item.startMs < endMs
    )
    const loaded = await Promise.all(
      entries.map(async (item) => {
        if (!isVoiceItem(item) || !item.synthesis) return null
        const buffer = await this.load(project, item)
        return buffer ? { startMs: item.startMs, buffer } : null
      })
    )
    return loaded.filter((entry): entry is { startMs: Ms; buffer: AudioBuffer } => entry !== null)
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
