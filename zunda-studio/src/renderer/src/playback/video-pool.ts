import { sourceTimeMs } from '@shared/audio/envelope'
import type { ItemId, Ms, Project, VideoItem } from '@shared/project/types'

import { api } from '../api'
import { playableSource } from '../state/media'

/** 再生位置と動画のずれ(動画の時間ではなくタイムラインの時間)がこれを超えたら、シークして合わせる。 */
const SEEK_DRIFT_MS = 1000
/** これ以下のずれは気にしない。これを超えたら、速さを少し変えて追いつかせる(シークすると一瞬コマが消えるため)。 */
const SMALL_DRIFT_MS = 40
/** 追いつかせるときに速さを変える割合。 */
const CATCH_UP = 0.2
/** これだけ先に始まる動画は、前もって読み込んで頭のコマへシークしておく(境目で消えないように)。 */
const PRELOAD_MS = 1500

interface Entry {
  element: HTMLVideoElement
  path: string
  /** シーク中や読み込み中に代わりに見せる、直前に見えていたコマ。 */
  hold: HTMLCanvasElement | null
}

/**
 * 動画アイテムごとの <video> 要素。
 * 止まっているときはプレビューの描画がシークを指示し、再生中は Player が音声の時計に合わせて再生させる。
 * Compositor は要素が今表示しているコマをそのまま描く。
 *
 * シーク中や読み込み中の要素はコマを描けない(空になる)。そのまま描くと画面が点滅するので、
 * 直前に見えていたコマを写しておき、その間はそれを見せる。再生中のずれは、なるべくシークせずに速さで追いつかせる
 * (倍速の動画は再生を始めたときの遅れが大きく見え、シークし直すと遅れ→シークを繰り返して点滅していた)。
 */
class VideoPool {
  private readonly entries = new Map<ItemId, Entry>()
  /** 素材ごとの、最後に写したコマ(分割した動画の境目で、次の部分が読み込み中のあいだ見せる)。 */
  private readonly lastFrameByPath = new Map<string, HTMLCanvasElement>()
  private playing = false
  private onFrame: () => void = () => {}

  /** 新しいコマが表示できるようになったときに呼ぶ(再描画を促す)。 */
  setFrameListener(listener: () => void): void {
    this.onFrame = listener
  }

  element(project: Project, item: VideoItem): HTMLVideoElement | null {
    return this.entry(project, item)?.element ?? null
  }

  private entry(project: Project, item: VideoItem): Entry | null {
    const asset = project.assets[item.assetId]
    if (!asset) return null
    const path = playableSource(asset)
    if (!path) return null
    const existing = this.entries.get(item.id)
    if (existing && existing.path === path) return existing
    if (existing) this.dispose(item.id)

    const element = document.createElement('video')
    element.muted = true
    element.preload = 'auto'
    element.playsInline = true
    element.crossOrigin = 'anonymous'
    element.addEventListener('loadeddata', () => this.onFrame())
    element.addEventListener('seeked', () => this.onFrame())
    element.src = api.mediaUrl(path)
    const entry: Entry = { element, path, hold: null }
    this.entries.set(item.id, entry)
    return entry
  }

  /** 描画用: 素材上の時刻 sourceMs のコマ。止まっていればそこへシークする。 */
  frame(project: Project, item: VideoItem, sourceMs: Ms): HTMLVideoElement | HTMLCanvasElement | null {
    const entry = this.entry(project, item)
    if (!entry) return null
    const { element } = entry
    if (!this.playing) {
      const target = sourceMs / 1000
      const asset = project.assets[item.assetId]
      const halfFrame = 0.5 / (asset?.type === 'video' && asset.fps > 0 ? asset.fps : 30)
      if (!element.seeking && Math.abs(element.currentTime - target) > halfFrame) this.seek(entry, target)
    }
    if (isShowable(element)) return element
    return entry.hold ?? this.lastFrameByPath.get(entry.path) ?? null
  }

  /** 再生中の同期。音声の時計の位置 positionMs に合わせて、各動画を再生・停止・補正する。 */
  sync(project: Project, positionMs: Ms): void {
    this.playing = true
    const muted = new Set(project.layers.filter((layer) => layer.muted).map((layer) => layer.id))
    const active = new Set<ItemId>()
    for (const item of project.items) {
      if (item.type !== 'video') continue
      const end = item.startMs + item.durationMs
      if (positionMs >= end) continue
      if (positionMs < item.startMs) {
        // もうすぐ始まる動画は、読み込んで頭のコマに合わせておく。
        if (item.startMs - positionMs <= PRELOAD_MS) this.preload(project, item)
        continue
      }
      const entry = this.entry(project, item)
      if (!entry) continue
      const { element } = entry
      active.add(item.id)
      const target = sourceTimeMs(item, positionMs - item.startMs) / 1000
      if (item.freeze) {
        // 静止画: 止めたまま、そのコマを出し続ける(音も鳴らさない)。
        element.muted = true
        if (!element.paused) element.pause()
        if (!element.seeking && Math.abs(element.currentTime - target) > 0.01) this.seek(entry, target)
        continue
      }
      const rate = item.playbackRate > 0 ? item.playbackRate : 1
      element.muted = muted.has(item.layerId) || item.volume === 0
      // HTML の音量は1が上限。1を超える音量は書き出しでだけ反映される。
      element.volume = Math.min(1, item.volume)
      // ずれはタイムラインの時間で測る(倍速の動画は、同じ遅れでも動画の時間では大きく見えるため)。
      const driftMs = ((element.currentTime - target) * 1000) / rate
      if (element.paused) {
        if (!element.seeking && Math.abs(driftMs) > SMALL_DRIFT_MS) this.seek(entry, target)
        setRate(element, rate)
        void element.play().catch(() => {})
      } else if (Math.abs(driftMs) > SEEK_DRIFT_MS) {
        if (!element.seeking) this.seek(entry, target)
        setRate(element, rate)
      } else if (Math.abs(driftMs) > SMALL_DRIFT_MS) {
        // 遅れていれば少し速く、進みすぎていれば少し遅くして、シークせずに追いつかせる。
        setRate(element, rate * (driftMs < 0 ? 1 + CATCH_UP : 1 - CATCH_UP))
      } else {
        setRate(element, rate)
      }
    }
    for (const [itemId, entry] of this.entries) {
      if (active.has(itemId) || entry.element.paused) continue
      // 次の部分(分割した動画の後ろ側など)が読み込み中なら、このコマを代わりに見せる。
      this.capture(entry)
      entry.element.pause()
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

  private preload(project: Project, item: VideoItem): void {
    const entry = this.entry(project, item)
    if (!entry || !entry.element.paused || entry.element.seeking) return
    const head = sourceTimeMs(item, 0) / 1000
    if (Math.abs(entry.element.currentTime - head) > 0.01) entry.element.currentTime = head
  }

  /** シークする。シークの間も見せられるよう、今のコマを写しておく。 */
  private seek(entry: Entry, seconds: number): void {
    this.capture(entry)
    entry.element.currentTime = seconds
  }

  /** 今見えているコマを写す(描けるコマが無ければ前の写しのまま)。 */
  private capture(entry: Entry): void {
    const { element } = entry
    if (!isShowable(element) || element.videoWidth === 0) return
    const canvas = entry.hold ?? document.createElement('canvas')
    if (canvas.width !== element.videoWidth || canvas.height !== element.videoHeight) {
      canvas.width = element.videoWidth
      canvas.height = element.videoHeight
    }
    const context = canvas.getContext('2d')
    if (!context) return
    try {
      context.drawImage(element, 0, 0)
    } catch {
      return
    }
    entry.hold = canvas
    this.lastFrameByPath.set(entry.path, canvas)
  }

  private dispose(itemId: ItemId): void {
    const entry = this.entries.get(itemId)
    if (!entry) return
    entry.element.pause()
    entry.element.removeAttribute('src')
    entry.element.load()
    this.entries.delete(itemId)
    if (entry.hold && this.lastFrameByPath.get(entry.path) === entry.hold) this.lastFrameByPath.delete(entry.path)
  }
}

/** 今のコマを描けるか(シーク中や読み込み中は描けない)。 */
function isShowable(element: HTMLVideoElement): boolean {
  return element.readyState >= 2 && !element.seeking
}

/** 速さは変わるときだけ設定する(毎フレーム設定すると、環境によっては再生が引っかかる)。 */
function setRate(element: HTMLVideoElement, rate: number): void {
  if (Math.abs(element.playbackRate - rate) > 1e-3) element.playbackRate = rate
}

export const videoPool = new VideoPool()
