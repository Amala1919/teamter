import { shiftKeys } from '../audio/volume-keys'
import { itemEndMs } from './queries'
import { wrapSubtitle } from './subtitle'
import type { Effect, Item, Ms, Project, VideoItem } from './types'

/**
 * 動画の大きさ(キャンバス)を変えるときの、置いた素材の合わせ方と、縦型のショートの作り方。
 * どちらもプロジェクトを直接書き換える(コマンドの処理と、ショートの作成から呼ぶ)。
 */

/** よく使う動画の大きさ。 */
export const CANVAS_PRESETS: { id: string; label: string; width: number; height: number }[] = [
  { id: '1080p', label: '横 1920×1080(フルHD)', width: 1920, height: 1080 },
  { id: '720p', label: '横 1280×720(HD)', width: 1280, height: 720 },
  { id: '1440p', label: '横 2560×1440(WQHD)', width: 2560, height: 1440 },
  { id: '2160p', label: '横 3840×2160(4K)', width: 3840, height: 2160 },
  { id: 'vertical', label: '縦 1080×1920(ショート・リール)', width: 1080, height: 1920 },
  { id: 'square', label: '正方形 1080×1080', width: 1080, height: 1080 }
]

/** エフェクトのうち、画素で表す量(動き・揺れ・浮く高さ)を k 倍にする。 */
function scaleEffects(effects: Effect[], k: number): void {
  for (const effect of effects) {
    if (effect.type === 'move') {
      effect.fromX *= k
      effect.fromY *= k
      effect.toX *= k
      effect.toY *= k
    } else if (effect.type === 'shake' || effect.type === 'float') {
      effect.amplitudePx *= k
    }
  }
}

/**
 * 置いた素材を、新しい大きさの画面に合わせる。位置は縦横それぞれの比で、大きさは小さい方の比で変える。
 * 動画は画面に収まる大きさが基準なので、拡大率はそのまま(画面に合わせて自動で大きさが変わる)。
 * styles が false なら字幕スタイルは変えない(ショートのように別の決め方をするとき)。
 */
export function rescaleProject(draft: Project, from: { width: number; height: number }, to: { width: number; height: number }, options: { styles?: boolean } = {}): void {
  const sx = to.width / from.width
  const sy = to.height / from.height
  const k = Math.min(sx, sy)
  for (const item of draft.items) {
    if ('transform' in item) {
      item.transform.x = Math.round(item.transform.x * sx)
      item.transform.y = Math.round(item.transform.y * sy)
      if (item.type !== 'video') item.transform.scale = Math.round(item.transform.scale * k * 1000) / 1000
    }
    if (item.type === 'zoom') {
      item.region = { x: Math.round(item.region.x * sx), y: Math.round(item.region.y * sy), width: Math.round(item.region.width * sx) }
    }
    if (item.type === 'portrait' && item.transformOverride) {
      item.transformOverride = { ...item.transformOverride, x: Math.round(item.transformOverride.x * sx), y: Math.round(item.transformOverride.y * sy), scale: item.transformOverride.scale * k }
    }
    scaleEffects(item.effects, k)
  }
  for (const character of Object.values(draft.characters)) {
    const portrait = character.portrait
    if (portrait) portrait.transform = { ...portrait.transform, x: Math.round(portrait.transform.x * sx), y: Math.round(portrait.transform.y * sy), scale: portrait.transform.scale * k }
  }
  if (options.styles === false) return
  for (const style of Object.values(draft.subtitleStyles)) {
    style.fontSizePx = Math.max(8, Math.round(style.fontSizePx * k))
    style.position = { ...style.position, x: Math.round(style.position.x * sx), y: Math.round(style.position.y * sy) }
    if (style.outline) style.outline = { ...style.outline, widthPx: Math.round(style.outline.widthPx * k * 10) / 10 }
    if (style.shadow) style.shadow = { ...style.shadow, offsetX: style.shadow.offsetX * k, offsetY: style.shadow.offsetY * k, blurPx: style.shadow.blurPx * k }
    if (style.background) style.background = { ...style.background, paddingPx: style.background.paddingPx * k, radiusPx: style.background.radiusPx * k }
  }
}

/** アイテムを [fromMs, toMs] に切り詰め、頭を fromMs だけ前へずらす。範囲に無いもの(セリフは収まらないもの)は null。 */
function clipItem(item: Item, fromMs: Ms, toMs: Ms): Item | null {
  const start = Math.max(item.startMs, fromMs)
  const end = Math.min(itemEndMs(item), toMs)
  if (end - start < 10) return null
  // セリフは途中で切れないので、範囲に収まるものだけ入れる。
  if (item.type === 'voice' && (item.startMs < fromMs || itemEndMs(item) > toMs)) return null
  const copy = structuredClone(item)
  const cutHead = start - item.startMs
  if (copy.type === 'video' && !copy.freeze) {
    copy.inMs = Math.round(copy.inMs + cutHead * copy.playbackRate)
    copy.outMs = Math.round(copy.inMs + (end - start) * copy.playbackRate)
  } else if (copy.type === 'audio' && !copy.loop) {
    copy.inMs = Math.round(copy.inMs + cutHead)
    copy.outMs = Math.round(copy.inMs + (end - start))
  }
  if ((copy.type === 'video' || copy.type === 'audio') && copy.volumeKeys) {
    const keys = shiftKeys(copy.volumeKeys, cutHead, end - start)
    if (keys) copy.volumeKeys = keys
    else delete copy.volumeKeys
  }
  if (copy.type === 'portrait') delete copy.untilEnd
  copy.startMs = start - fromMs
  copy.durationMs = end - start
  return copy
}

/** 画面いっぱいに置いた動画(ゲームの録画)か。中央にあり、等倍で、切り抜いていない。 */
function isFullScreenVideo(item: Item, canvas: { width: number; height: number }): item is VideoItem {
  return (
    item.type === 'video' &&
    !item.crop &&
    Math.abs(item.transform.scale - 1) < 0.02 &&
    Math.abs(item.transform.x - canvas.width / 2) < 4 &&
    Math.abs(item.transform.y - canvas.height / 2) < 4
  )
}

export interface ShortOptions {
  fromMs: Ms
  toMs: Ms
  width: number
  height: number
  /** blur: 全体を見せ、上下はぼかした同じ映像で埋める / fill: 真ん中を切り抜いて画面いっぱいにする */
  layout: 'blur' | 'fill'
  /** 新しい ID を作る(背景の動画とレイヤー)。 */
  newId: (prefix: string) => string
}

/**
 * 今のプロジェクトの一部から、縦型のショートのプロジェクトを作る。元のプロジェクトは変えない。
 * 範囲の素材を切り出し、画面の大きさを変え、ゲームの録画を縦の画面に合わせ、字幕を下の方に大きめに出す。
 */
export function makeShortProject(project: Project, options: ShortOptions): Project {
  const short = structuredClone(project)
  const from = { width: project.canvas.width, height: project.canvas.height }
  const to = { width: options.width, height: options.height }
  short.items = project.items.flatMap((item) => {
    const clipped = clipItem(item, options.fromMs, options.toMs)
    return clipped ? [clipped] : []
  })
  const fullScreen = new Set(short.items.filter((item) => isFullScreenVideo(item, from)).map((item) => item.id))
  rescaleProject(short, from, to, { styles: false })
  short.canvas = { ...short.canvas, width: to.width, height: to.height }

  // ゲームの録画: 幅に合わせて少し上に置き、後ろにぼかした同じ映像を敷く(または切り抜いて画面いっぱいに)。
  const backgroundLayerId = options.newId('lyr')
  let needsBackgroundLayer = false
  for (const item of [...short.items]) {
    if (!fullScreen.has(item.id) || item.type !== 'video') continue
    const asset = short.assets[item.assetId]
    if (!asset || asset.type !== 'video') continue
    const fit = Math.min(to.width / asset.width, to.height / asset.height)
    const cover = Math.max(to.width / asset.width, to.height / asset.height) / fit
    item.transform.x = Math.round(to.width / 2)
    if (options.layout === 'fill') {
      item.transform.y = Math.round(to.height / 2)
      item.transform.scale = Math.round(cover * 1000) / 1000
      continue
    }
    item.transform.y = Math.round(to.height * 0.42)
    const background: VideoItem = {
      ...structuredClone(item),
      id: options.newId('itm'),
      layerId: backgroundLayerId,
      transform: { ...item.transform, y: Math.round(to.height / 2), scale: Math.round(cover * 1000) / 1000 },
      adjust: { brightness: 0.6, contrast: 1, saturation: 1.1, hue: 0, sepia: 0, blurPx: 24 },
      volume: 0
    }
    delete background.groupId
    delete background.volumeKeys
    short.items.unshift(background)
    needsBackgroundLayer = true
  }
  if (needsBackgroundLayer) {
    for (const layer of short.layers) layer.index += 1
    short.layers.push({ id: backgroundLayerId, name: 'ぼかした背景', index: 0, visible: true, locked: false, muted: true })
    short.layers.sort((a, b) => a.index - b.index)
  }

  // 字幕: スマホで読めるよう大きさはそのまま、横幅に収まる文字数で折り返し、ゲームの下に出す。
  for (const style of Object.values(short.subtitleStyles)) {
    style.position = { anchor: 'bottom-center', x: Math.round(to.width / 2), y: Math.round(to.height * (options.layout === 'blur' ? 0.8 : 0.86)) }
    style.maxCharsPerLine = Math.max(6, Math.min(style.maxCharsPerLine, Math.floor((to.width * 0.9) / Math.max(8, style.fontSizePx))))
  }
  for (const item of short.items) {
    if (item.type !== 'voice' || item.subtitleLinesManual) continue
    const character = short.characters[item.characterId]
    const styleId = item.subtitleOverride?.styleId ?? character?.subtitleStyleId
    const style = styleId === undefined ? undefined : short.subtitleStyles[styleId]
    item.subtitleLines = wrapSubtitle(item.displayText ?? item.text, style?.maxCharsPerLine ?? 14)
  }

  short.markers = (project.markers ?? [])
    .filter((marker) => marker.atMs >= options.fromMs && marker.atMs <= options.toMs)
    .map((marker) => ({ ...marker, atMs: marker.atMs - options.fromMs }))
  if (short.markers.length === 0) delete short.markers
  short.liveSessions = {}
  short.chat = { messages: [] }
  delete short.publish
  short.meta = { ...short.meta, title: `${project.meta.title}(ショート)` }
  return short
}
