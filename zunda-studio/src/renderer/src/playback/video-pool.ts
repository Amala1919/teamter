import { sourceTimeMs } from '@shared/audio/envelope'
import type { ItemId, Ms, Project, VideoItem } from '@shared/project/types'

import { api } from '../api'
import { playableSource } from '../state/media'

/**
 * 動画アイテムごとの <video> 要素。
 * 止まっているときはプレビューの描画がシークを指示し、再生中は Player が音声の時計に合わせて再生させる。
 * Compositor は要素が今表示しているコマをそのまま描く。
 */
class VideoPool {
  private readonly entries = new Map<ItemId, { element: HTMLVideoElement; path: string }>()
  private playing = false
  private onFrame: () => void = () => {}

  /** 新しいコマが表示できるようになったときに呼ぶ(再描画を促す)。 */
  setFrameListener(listener: () => void): void {
    this.onFrame = listener
  }

  element(project: Project, item: VideoItem): HTMLVideoElement | null {
    const asset = project.assets[item.assetId]
    if (!asset) return null
    const path = playableSource(asset)
    if (!path) return null
    const existing = this.entries.get(item.id)
    if (existing && existing.path === path) return existing.element
    if (existing) this.dispose(item.id)

    const element = document.createElement('video')
    element.muted = true
    element.preload = 'auto'
    element.playsInline = true
    element.crossOrigin = 'anonymous'
    element.addEventListener('loadeddata', () => this.onFrame())
    element.addEventListener('seeked', () => this.onFrame())
    element.src = api.mediaUrl(path)
    this.entries.set(item.id, { element, path })
    return element
  }

  /** 描画用: 素材上の時刻 sourceMs のコマ。止まっていればそこへシークする。 */
  frame(project: Project, item: VideoItem, sourceMs: Ms): HTMLVideoElement | null {
    const element = this.element(project, item)
    if (!element) return null
    if (!this.playing) {
      const target = sourceMs / 1000
      const asset = project.assets[item.assetId]
      const halfFrame = 0.5 / (asset?.type === 'video' && asset.fps > 0 ? asset.fps : 30)
      if (!element.seeking && Math.abs(element.currentTime - target) > halfFrame) element.currentTime = target
    }
    return element.readyState >= 2 ? element : null
  }

  /** 再生中の同期。音声の時計の位置 positionMs に合わせて、各動画を再生・停止・補正する。 */
  sync(project: Project, positionMs: Ms): void {
    this.playing = true
    const muted = new Set(project.layers.filter((layer) => layer.muted).map((layer) => layer.id))
    const active = new Set<ItemId>()
    for (const item of project.items) {
      if (item.type !== 'video' || positionMs < item.startMs || positionMs >= item.startMs + item.durationMs) continue
      const element = this.element(project, item)
      if (!element) continue
      active.add(item.id)
      const target = sourceTimeMs(item, positionMs - item.startMs) / 1000
      element.playbackRate = item.playbackRate
      element.muted = muted.has(item.layerId) || item.volume === 0
      // HTML の音量は1が上限。1を超える音量は書き出しでだけ反映される。
      element.volume = Math.min(1, item.volume)
      if (element.paused) {
        element.currentTime = target
        void element.play().catch(() => {})
      } else if (Math.abs(element.currentTime - target) > 0.15) {
        element.currentTime = target
      }
    }
    for (const [itemId, { element }] of this.entries) {
      if (!active.has(itemId) && !element.paused) element.pause()
    }
  }

  stop(): void {
    this.playing = false
    for (const { element } of this.entries.values()) {
      element.pause()
      element.muted = true
    }
  }

  /** プロジェクトから消えたアイテムの要素を片付ける。 */
  prune(project: Project): void {
    const alive = new Set(project.items.map((item) => item.id))
    for (const itemId of this.entries.keys()) {
      if (!alive.has(itemId)) this.dispose(itemId)
    }
  }

  private dispose(itemId: ItemId): void {
    const entry = this.entries.get(itemId)
    if (!entry) return
    entry.element.pause()
    entry.element.removeAttribute('src')
    entry.element.load()
    this.entries.delete(itemId)
  }
}

export const videoPool = new VideoPool()
