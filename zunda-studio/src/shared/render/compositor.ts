/**
 * 合成描画の唯一の実装。プレビュー(ブラウザ)と書き出し(Node)の両方がこの関数を呼ぶ。
 * docs/ARCHITECTURE.md の「プレビューと書き出しは同一のレンダラを使う」を参照。
 *
 * 現在時刻や Math.random を参照してはならない。時刻に依存するものは引数の timeMs と
 * project.meta.renderSeed から決定論的に導出する。これがプレビューと書き出しの一致を保証する。
 */

import { sourceTimeMs } from '../audio/envelope'
import { portraitSelections } from '../portrait/animation'
import { portraitScenes, type PortraitScene } from '../portrait/scene'
import { itemsAt } from '../project/queries'
import type {
  ColorAdjust,
  Crop,
  ImageItem,
  Item,
  LayerId,
  MediaFrame,
  Ms,
  Project,
  SubtitleStyle,
  Transform,
  VideoItem,
  VoiceItem,
  ZoomItem
} from '../project/types'
import { ease } from './easing'
import { combineEffects, effectStateAt, IDENTITY_EFFECT, type ClipState, type EffectState } from './effects'
import { drawPortrait, portraitPlacement } from './portrait'
import { drawShape, shapeSize } from './shapes'
import { drawTelop, fontFamilyStack, telopSize } from './telop'
import type { CanvasLike, Ctx2D, RenderResources } from './types'
import { zoomProgress, zoomViewport } from './zoom'

export interface RenderOptions {
  /**
   * ズームを適用するか。枠を編集している間は拡大前の画面を見せるため false にする(REQUIREMENTS.md Z-6)。
   */
  applyZoom?: boolean
  /** セリフの字幕を描くか(既定は描く)。サムネイル用の画像を字幕なしで作るときに false にする。 */
  subtitles?: boolean
}

/** 描画順を決めるための1要素。アイテムに加え、常時表示の立ち絵もここに並ぶ。 */
type Drawable =
  | { kind: 'item'; layerId: LayerId; item: Item }
  | { kind: 'portrait'; layerId: LayerId; scene: PortraitScene; item: null }
  | { kind: 'zoom'; layerId: LayerId; item: ZoomItem }

export function renderFrame(
  context: Ctx2D,
  project: Project,
  timeMs: Ms,
  resources: RenderResources,
  options: RenderOptions = {}
): void {
  const { width, height, backgroundColor } = project.canvas
  // 全体を消すのは save() の外で行う。書き出しの @napi-rs/canvas は描いた内容を記録として積み、
  // 保存(save)の外で全体を消したときにだけ記録を捨てる。save() の中で消すと、動画のコマ(1080p で 8MB)を
  // 描くたびに記録が溜まり、長い動画の書き出しで PC のメモリを使い切っていた。
  context.setTransform(1, 0, 0, 1, 0, 0)
  context.clearRect(0, 0, width, height)
  context.save()
  context.globalAlpha = 1
  context.globalCompositeOperation = 'source-over'
  context.fillStyle = backgroundColor
  context.fillRect(0, 0, width, height)

  const layerIndex = new Map(project.layers.map((layer) => [layer.id, layer.index]))
  const hidden = new Set(project.layers.filter((layer) => !layer.visible).map((layer) => layer.id))

  const drawables: Drawable[] = []
  for (const item of itemsAt(project, timeMs)) {
    // 立ち絵は、場面ごとの立ち絵をまとめて portraitScenes で決める。
    if (item.type === 'portrait') continue
    // 字幕を出さないセリフ(と、字幕なしで描くとき)は、セリフを描かない(声は書き出しの音声で鳴る)。
    if (item.type === 'voice' && (options.subtitles === false || item.subtitleHidden === true)) continue
    if (item.type === 'zoom') {
      if (options.applyZoom !== false) drawables.push({ kind: 'zoom', layerId: item.layerId, item })
    } else {
      drawables.push({ kind: 'item', layerId: item.layerId, item })
    }
  }
  for (const scene of portraitScenes(project, timeMs)) {
    drawables.push({ kind: 'portrait', layerId: scene.layerId, scene, item: null })
  }
  // レイヤーの下から順に描く。ズームは「それより下」だけを拡大するので、同じレイヤーの中では最初に処理する。
  // 同じレイヤーの他の要素は元の並び(アイテム → 立ち絵)を保つため、安定ソートを使う。
  const order = (drawable: Drawable): number => (layerIndex.get(drawable.layerId) ?? 0) * 2 + (drawable.kind === 'zoom' ? 0 : 1)
  drawables.sort((a, b) => order(a) - order(b))

  for (const drawable of drawables) {
    if (hidden.has(drawable.layerId)) continue
    const relMs = drawable.item ? timeMs - drawable.item.startMs : 0
    if (drawable.kind === 'zoom') {
      applyZoom(context, project, drawable.item, relMs, resources)
    } else if (drawable.kind === 'portrait') {
      drawCharacter(context, project, drawable.scene, timeMs, resources)
    } else {
      drawItem(context, project, drawable.item, relMs, resources)
    }
  }
  context.restore()
}

// ---------------------------------------------------------------- ズーム

const scratchCanvases = new WeakMap<RenderResources, CanvasLike>()

function scratchCanvas(resources: RenderResources, width: number, height: number): CanvasLike {
  let canvas = scratchCanvases.get(resources)
  if (!canvas || canvas.width !== width || canvas.height !== height) {
    canvas = resources.createCanvas(width, height)
    scratchCanvases.set(resources, canvas)
  }
  return canvas
}

/** ここまでに描いた内容(= ズームより下のレイヤー)を、枠の範囲が画面いっぱいになるよう描き直す。 */
function applyZoom(context: Ctx2D, project: Project, item: ZoomItem, relMs: Ms, resources: RenderResources): void {
  const progress = zoomProgress(item, relMs)
  if (progress === 0) return
  const { width, height } = project.canvas
  const view = zoomViewport(project.canvas, item.region, progress)
  const scratch = scratchCanvas(resources, width, height)
  const scratchContext = scratch.getContext('2d')
  if (!scratchContext) return
  scratchContext.setTransform(1, 0, 0, 1, 0, 0)
  scratchContext.globalAlpha = 1
  scratchContext.globalCompositeOperation = 'source-over'
  scratchContext.clearRect(0, 0, width, height)
  scratchContext.drawImage(context.canvas, 0, 0, width, height)

  context.save()
  context.setTransform(1, 0, 0, 1, 0, 0)
  context.globalAlpha = 1
  context.globalCompositeOperation = 'source-over'
  context.clearRect(0, 0, width, height)
  context.drawImage(scratch, view.x, view.y, view.width, view.height, 0, 0, width, height)
  context.restore()
}

// ---------------------------------------------------------------- 立ち絵

function drawCharacter(context: Ctx2D, project: Project, scene: PortraitScene, timeMs: Ms, resources: RenderResources): void {
  const { character, transform } = scene
  const portrait = character.portrait
  if (!portrait) return
  const manifest = resources.psd(portrait.assetId)
  if (!manifest) return
  const selections = portraitSelections(project, character, portrait, timeMs, scene.expressionId)

  // 登場・退場などのエフェクト(show と adjust の両方に付いていれば重ねる)。
  let effect: EffectState = IDENTITY_EFFECT
  for (const item of scene.effectItems) {
    effect = combineEffects(effect, effectStateAt(item, timeMs - item.startMs, project.meta.renderSeed, project.canvas))
  }
  if (effect.alpha <= 0) return
  const placement = portraitPlacement(transform, manifest)
  if (scene.hop > 0) effect = { ...effect, dy: effect.dy - scene.hop * placement.height }
  const plain = effect === IDENTITY_EFFECT && scene.dim === 0

  if (plain) {
    drawPortrait(context, character, manifest, selections, resources, transform)
    return
  }
  // エフェクトは立ち絵の中心を基準に掛ける。
  const centerX = placement.x + placement.width / 2
  const centerY = placement.y + placement.height / 2
  context.save()
  context.globalAlpha *= effect.alpha
  // 話していないキャラクターを暗くする(フィルタに対応していない環境では、少し透かして代わりにする)。
  const filters: string[] = []
  if (scene.dim > 0) {
    if ('filter' in context) filters.push(`brightness(${Math.round((1 - scene.dim) * 100)}%)`)
    else context.globalAlpha *= 1 - scene.dim / 2
  }
  if (effect.blurPx > 0.1) filters.push(`blur(${effect.blurPx.toFixed(1)}px)`)
  if (filters.length > 0 && 'filter' in context) context.filter = filters.join(' ')
  context.translate(centerX + effect.dx, centerY + effect.dy)
  if (effect.rotation !== 0) context.rotate((effect.rotation * Math.PI) / 180)
  context.scale(effect.scale, effect.scale)
  context.translate(-centerX, -centerY)
  drawPortrait(context, character, manifest, selections, resources, transform)
  context.restore()
}

// ---------------------------------------------------------------- アイテム

function drawItem(context: Ctx2D, project: Project, item: Item, relMs: Ms, resources: RenderResources): void {
  const effect = item.effects.length > 0 ? effectStateAt(item, relMs, project.meta.renderSeed, project.canvas) : IDENTITY_EFFECT
  if (effect.alpha <= 0) return
  switch (item.type) {
    case 'voice':
      drawSubtitle(context, project, item, effect, relMs)
      return
    case 'shape': {
      const { width, height } = shapeSize(item, project.canvas)
      withTransform(context, item.transform, effect, width, height, null, () =>
        drawShape(context, item, { relMs, seed: project.meta.renderSeed, canvas: project.canvas })
      )
      return
    }
    case 'text': {
      const style = project.subtitleStyles[item.styleId]
      if (!style) return
      // 切り替え(ワイプなど)で切り抜くときだけ、テロップの大きさを測る。
      const size = effect.clips.length > 0 ? telopSize(context, item, style) : { width: 0, height: 0 }
      withTransform(context, item.transform, effect, size.width, size.height, null, () => drawTelop(context, item, style, relMs))
      return
    }
    case 'image': {
      const asset = project.assets[item.assetId]
      if (!asset || asset.type !== 'image') return
      const image = resources.image(asset.path.absolute)
      if (!image) return
      // 画像の基準の大きさは素材の画素数そのまま(切り抜いたら、残った部分の大きさ)。
      drawMedia(context, item, effect, image, asset.width, asset.height)
      return
    }
    case 'video': {
      const asset = project.assets[item.assetId]
      if (!asset || asset.type !== 'video') return
      const frame = resources.video(item, sourceTimeMs(item, relMs))
      if (!frame) return
      // 動画の基準の大きさは画面に収まる最大の大きさ(ゲーム録画をそのまま画面いっぱいに置ける)。
      const fit = Math.min(project.canvas.width / asset.width, project.canvas.height / asset.height)
      drawMedia(context, item, effect, frame, asset.width * fit, asset.height * fit)
      return
    }
    case 'audio':
    case 'portrait':
    case 'zoom':
      return
  }
}

/** 色の調整とぼかしを、キャンバスのフィルタの書き方にする。何もしなければ null。 */
export function filterOf(adjust: ColorAdjust | undefined, extraBlurPx = 0): string | null {
  const parts: string[] = []
  if (adjust) {
    if (adjust.brightness !== 1) parts.push(`brightness(${round(adjust.brightness * 100)}%)`)
    if (adjust.contrast !== 1) parts.push(`contrast(${round(adjust.contrast * 100)}%)`)
    if (adjust.saturation !== 1) parts.push(`saturate(${round(adjust.saturation * 100)}%)`)
    if (adjust.hue !== 0) parts.push(`hue-rotate(${round(adjust.hue)}deg)`)
    if (adjust.sepia > 0) parts.push(`sepia(${round(adjust.sepia * 100)}%)`)
  }
  const blur = (adjust?.blurPx ?? 0) + extraBlurPx
  if (blur > 0.1) parts.push(`blur(${blur.toFixed(1)}px)`)
  return parts.length > 0 ? parts.join(' ') : null
}

function round(value: number): number {
  return Math.round(value * 10) / 10
}

/** 素材の画素の大きさ(動画の要素・キャンバス・画像のどれでも)。分からなければ fallback。 */
function intrinsicSize(source: unknown, fallbackWidth: number, fallbackHeight: number): { width: number; height: number } {
  const value = source as { videoWidth?: number; videoHeight?: number; width?: number; height?: number }
  if (typeof value.videoWidth === 'number' && value.videoWidth > 0 && typeof value.videoHeight === 'number' && value.videoHeight > 0) {
    return { width: value.videoWidth, height: value.videoHeight }
  }
  if (typeof value.width === 'number' && value.width > 0 && typeof value.height === 'number' && value.height > 0) {
    return { width: value.width, height: value.height }
  }
  return { width: fallbackWidth, height: fallbackHeight }
}

/** 切り抜きの割合を、ありえる範囲に収める(左右・上下を合わせて 95% までしか切らない)。 */
export function normalizedCrop(crop: Crop | undefined): Crop {
  if (!crop) return { left: 0, top: 0, right: 0, bottom: 0 }
  const clamp = (value: number): number => Math.min(0.95, Math.max(0, Number.isFinite(value) ? value : 0))
  let { left, right, top, bottom } = { left: clamp(crop.left), right: clamp(crop.right), top: clamp(crop.top), bottom: clamp(crop.bottom) }
  if (left + right > 0.95) {
    const ratio = 0.95 / (left + right)
    left *= ratio
    right *= ratio
  }
  if (top + bottom > 0.95) {
    const ratio = 0.95 / (top + bottom)
    top *= ratio
    bottom *= ratio
  }
  return { left, top, right, bottom }
}

/** 切り抜いたあとの基準の大きさ。 */
export function croppedSize(width: number, height: number, crop: Crop | undefined): { width: number; height: number } {
  const c = normalizedCrop(crop)
  return { width: width * (1 - c.left - c.right), height: height * (1 - c.top - c.bottom) }
}

/** 動画・画像を、切り抜き・枠・色の調整を掛けて描く。 */
function drawMedia(context: Ctx2D, item: VideoItem | ImageItem, effect: EffectState, source: unknown, baseWidth: number, baseHeight: number): void {
  const crop = normalizedCrop(item.crop)
  const { width, height } = croppedSize(baseWidth, baseHeight, item.crop)
  const pixels = intrinsicSize(source, baseWidth, baseHeight)
  const sx = pixels.width * crop.left
  const sy = pixels.height * crop.top
  const sw = pixels.width * (1 - crop.left - crop.right)
  const sh = pixels.height * (1 - crop.top - crop.bottom)
  const filter = filterOf(item.adjust, effect.blurPx)
  const frame = item.frame
  withTransform(context, item.transform, effect, width, height, filter, (x, y) => {
    if (!frame) {
      context.drawImage(source, sx, sy, sw, sh, x, y, width, height)
      return
    }
    const outline = (): void => framePath(context, frame, x, y, width, height)
    // 影は枠の形で、素材の下に落とす。
    if (frame.shadow) {
      context.save()
      context.shadowColor = frame.shadow.color
      context.shadowOffsetX = frame.shadow.offsetX
      context.shadowOffsetY = frame.shadow.offsetY
      context.shadowBlur = frame.shadow.blurPx
      context.fillStyle = '#000000'
      context.beginPath()
      outline()
      context.fill()
      context.restore()
    }
    context.save()
    context.beginPath()
    outline()
    context.clip()
    context.drawImage(source, sx, sy, sw, sh, x, y, width, height)
    context.restore()
    if (frame.border && frame.border.widthPx > 0) {
      context.save()
      if ('filter' in context) context.filter = 'none'
      context.strokeStyle = frame.border.color
      context.lineWidth = frame.border.widthPx
      context.lineJoin = 'round'
      context.beginPath()
      outline()
      context.stroke()
      context.restore()
    }
  })
}

/** 枠の形の輪郭(beginPath は呼ぶ側で)。 */
function framePath(context: Ctx2D, frame: MediaFrame, x: number, y: number, width: number, height: number): void {
  if (frame.shape === 'circle') {
    context.ellipse(x + width / 2, y + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2)
    return
  }
  const radius = frame.shape === 'rounded' ? Math.max(0, Math.min(frame.radiusPx, width / 2, height / 2)) : 0
  if (radius <= 0) {
    context.rect(x, y, width, height)
    return
  }
  context.moveTo(x + radius, y)
  context.arcTo(x + width, y, x + width, y + height, radius)
  context.arcTo(x + width, y + height, x, y + height, radius)
  context.arcTo(x, y + height, x, y, radius)
  context.arcTo(x, y, x + width, y, radius)
  context.closePath()
}

/**
 * 変形(中心の位置・回転・拡大率・不透明度)とエフェクトを掛けて、中心を原点にした矩形に描く。
 * 切り替え(ワイプ・円・ブラインド)は、この矩形を切り抜いて見せる範囲を絞る。
 */
function withTransform(
  context: Ctx2D,
  transform: Transform,
  effect: EffectState,
  width: number,
  height: number,
  filter: string | null,
  draw: (x: number, y: number, width: number, height: number) => void
): void {
  context.save()
  context.globalAlpha *= transform.opacity * effect.alpha
  context.translate(transform.x + effect.dx, transform.y + effect.dy)
  const rotation = transform.rotation + effect.rotation
  if (rotation !== 0) context.rotate((rotation * Math.PI) / 180)
  const scale = transform.scale * effect.scale
  context.scale(scale, scale)
  const x = -width / 2
  const y = -height / 2
  if (effect.clips.length > 0 && width > 0 && height > 0) {
    for (const clip of effect.clips) applyClip(context, clip, x, y, width, height)
  }
  // ぼかし(切り替えのぼかしを含む)は、素材の描き方に関わらず掛ける。
  const blur = filter ?? (effect.blurPx > 0.1 ? `blur(${effect.blurPx.toFixed(1)}px)` : null)
  if (blur && 'filter' in context) context.filter = blur
  draw(x, y, width, height)
  context.restore()
}

function applyClip(context: Ctx2D, clip: ClipState, x: number, y: number, width: number, height: number): void {
  const visible = Math.min(1, Math.max(0, clip.visible))
  context.beginPath()
  switch (clip.kind) {
    case 'edge': {
      // 縁取りや影がはみ出す分も見せるよう、切り抜きは少し広めにとる。
      const pad = Math.max(width, height)
      if (clip.from === 'left') context.rect(x - pad, y - pad, pad + width * visible, height + pad * 2)
      else if (clip.from === 'right') context.rect(x + width * (1 - visible), y - pad, width * visible + pad, height + pad * 2)
      else if (clip.from === 'top') context.rect(x - pad, y - pad, width + pad * 2, pad + height * visible)
      else context.rect(x - pad, y + height * (1 - visible), width + pad * 2, height * visible + pad)
      break
    }
    case 'iris': {
      const radius = (Math.hypot(width, height) / 2) * visible
      context.ellipse(x + width / 2, y + height / 2, Math.max(0.01, radius), Math.max(0.01, radius), 0, 0, Math.PI * 2)
      break
    }
    case 'blinds': {
      const slats = 8
      const slat = height / slats
      for (let index = 0; index < slats; index++) context.rect(x - width, y + slat * index, width * 3, Math.max(0.01, slat * visible))
      break
    }
  }
  context.clip()
}

function drawSubtitle(context: Ctx2D, project: Project, item: VoiceItem, effect: EffectState, relMs: Ms): void {
  const character = project.characters[item.characterId]
  const styleId = item.subtitleOverride?.styleId ?? character?.subtitleStyleId
  const style = styleId === undefined ? undefined : project.subtitleStyles[styleId]
  if (!style) return

  const color = item.subtitleOverride?.color ?? style.color
  const sizeScale = item.subtitleOverride?.sizeScale ?? 1
  const resolved = { ...style, color, fontSizePx: style.fontSizePx * sizeScale }
  // 字幕の出方(ふわっと・ぽんっと・下から・1文字ずつ)を、エフェクトに重ねる。
  const appear = appearState(style, relMs)
  const total = combineEffects(effect, appear.effect)
  const visibleChars = appear.visibleChars
  if (total === IDENTITY_EFFECT) {
    drawText(context, item.subtitleLines, resolved, project.canvas.width, visibleChars)
    return
  }
  if (total.alpha <= 0) return
  context.save()
  context.globalAlpha *= total.alpha
  context.translate(style.position.x + total.dx, style.position.y + total.dy)
  if (total.rotation !== 0) context.rotate((total.rotation * Math.PI) / 180)
  context.scale(total.scale, total.scale)
  context.translate(-style.position.x, -style.position.y)
  if (total.blurPx > 0.1 && 'filter' in context) context.filter = `blur(${total.blurPx.toFixed(1)}px)`
  drawText(context, item.subtitleLines, resolved, project.canvas.width, visibleChars)
  context.restore()
}

/** 字幕の出方の、その時刻での効果。 */
function appearState(style: SubtitleStyle, relMs: Ms): { effect: EffectState; visibleChars: number | null } {
  const appear = style.appear
  if (!appear || appear.kind === 'none' || appear.durationMs <= 0 || relMs >= appear.durationMs) {
    return { effect: IDENTITY_EFFECT, visibleChars: null }
  }
  const t = Math.max(0, relMs) / appear.durationMs
  switch (appear.kind) {
    case 'fade':
      return { effect: { ...IDENTITY_EFFECT, alpha: ease('easeOutCubic', t) }, visibleChars: null }
    case 'pop':
      return { effect: { ...IDENTITY_EFFECT, scale: Math.max(0.01, ease('easeOutBack', t)), alpha: Math.min(1, t * 3) }, visibleChars: null }
    case 'slideUp':
      return { effect: { ...IDENTITY_EFFECT, dy: (1 - ease('easeOutCubic', t)) * style.fontSizePx * 0.8, alpha: ease('easeOutCubic', t) }, visibleChars: null }
    case 'typewriter':
      return { effect: IDENTITY_EFFECT, visibleChars: relMs }
  }
}

export { fontFamilyStack }

/** 字幕を描く(字幕の設定画面の見本用。動画と同じ描き方)。 */
export function drawSubtitleLines(context: Ctx2D, lines: readonly string[], style: SubtitleStyle, canvasWidth = 1920): void {
  drawText(context, lines, style, canvasWidth, null)
}

/**
 * 字幕を描く。指定位置を最終行の下端として上へ積む(テロップは telop.ts)。
 * typewriterRelMs を渡すと、字幕の出方(1文字ずつ)の時間に合わせて文字を出す。
 */
function drawText(context: Ctx2D, lines: readonly string[], style: SubtitleStyle | undefined, canvasWidth: number, typewriterRelMs: number | null): void {
  if (!style || lines.length === 0) return

  context.save()
  context.font = `${style.fontWeight} ${style.fontSizePx}px ${fontFamilyStack(style.fontFamily)}`
  const align = style.position.anchor.endsWith('left') ? 'left' : style.position.anchor.endsWith('right') ? 'right' : 'center'
  context.textBaseline = 'alphabetic'

  const lineHeightPx = style.fontSizePx * style.lineHeight
  // 指定位置を最終行の下端とみなし、行数に応じて上へ積む。
  const firstLineY = style.position.y - lineHeightPx * (lines.length - 1)
  const widths = lines.map((line) => context.measureText(line).width)

  if (style.background && style.background.opacity > 0) {
    const { paddingPx, radiusPx, color, opacity, fullWidth } = style.background
    const blockWidth = Math.max(0, ...widths)
    const left = align === 'left' ? style.position.x : align === 'right' ? style.position.x - blockWidth : style.position.x - blockWidth / 2
    // 文字の上端(1行目)から下端(最終行)まで。英字の下がりも含めて少し下まで取る。
    const top = firstLineY - style.fontSizePx * 0.92
    const bottom = style.position.y + style.fontSizePx * 0.28
    context.save()
    context.globalAlpha *= opacity
    context.fillStyle = color
    context.beginPath()
    if (fullWidth) context.rect(0, top - paddingPx, canvasWidth, bottom - top + paddingPx * 2)
    else roundedRectPath(context, left - paddingPx, top - paddingPx, blockWidth + paddingPx * 2, bottom - top + paddingPx * 2, radiusPx)
    context.fill()
    context.restore()
  }

  // 1文字ずつ出すときは、全体の文字数のうち、時間に応じた分だけ出す(行の位置は全部出たときのまま)。
  const totalChars = lines.reduce((sum, line) => sum + Array.from(line).length, 0)
  const durationMs = style.appear?.durationMs ?? 0
  let remaining = typewriterRelMs === null || durationMs <= 0 ? totalChars : Math.floor((totalChars * Math.max(0, typewriterRelMs)) / durationMs)
  context.textAlign = 'left'
  lines.forEach((line, index) => {
    if (remaining <= 0) return
    const chars = Array.from(line)
    const shown = chars.slice(0, remaining).join('')
    remaining -= chars.length
    const lineWidth = widths[index] ?? 0
    const x = align === 'left' ? style.position.x : align === 'right' ? style.position.x - lineWidth : style.position.x - lineWidth / 2
    const y = firstLineY + lineHeightPx * index
    if (style.shadow) {
      context.shadowColor = style.shadow.color
      context.shadowOffsetX = style.shadow.offsetX
      context.shadowOffsetY = style.shadow.offsetY
      context.shadowBlur = style.shadow.blurPx
    }
    if (style.outline) {
      context.lineWidth = style.outline.widthPx
      context.strokeStyle = style.outline.color
      context.lineJoin = 'round'
      context.strokeText(shown, x, y)
    }
    context.shadowColor = 'transparent'
    context.fillStyle = style.color
    context.fillText(shown, x, y)
  })

  context.restore()
}

function roundedRectPath(context: Ctx2D, x: number, y: number, width: number, height: number, radius: number): void {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2))
  context.moveTo(x + r, y)
  context.arcTo(x + width, y, x + width, y + height, r)
  context.arcTo(x + width, y + height, x, y + height, r)
  context.arcTo(x, y + height, x, y, r)
  context.arcTo(x, y, x + width, y, r)
  context.closePath()
}
