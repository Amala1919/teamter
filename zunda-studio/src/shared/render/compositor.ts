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
  Item,
  LayerId,
  Ms,
  Project,
  SubtitleStyle,
  Transform,
  VoiceItem,
  ZoomItem
} from '../project/types'
import { effectStateAt, IDENTITY_EFFECT, type EffectState } from './effects'
import { drawPortrait, portraitPlacement } from './portrait'
import { drawTelop, fontFamilyStack } from './telop'
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
    const next = effectStateAt(item, timeMs - item.startMs, project.meta.renderSeed)
    effect = { alpha: effect.alpha * next.alpha, scale: effect.scale * next.scale, dx: effect.dx + next.dx, dy: effect.dy + next.dy }
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
  if (scene.dim > 0) {
    if ('filter' in context) context.filter = `brightness(${Math.round((1 - scene.dim) * 100)}%)`
    else context.globalAlpha *= 1 - scene.dim / 2
  }
  context.translate(centerX + effect.dx, centerY + effect.dy)
  context.scale(effect.scale, effect.scale)
  context.translate(-centerX, -centerY)
  drawPortrait(context, character, manifest, selections, resources, transform)
  context.restore()
}

// ---------------------------------------------------------------- アイテム

function drawItem(context: Ctx2D, project: Project, item: Item, relMs: Ms, resources: RenderResources): void {
  const effect = item.effects.length > 0 ? effectStateAt(item, relMs, project.meta.renderSeed) : IDENTITY_EFFECT
  if (effect.alpha <= 0) return
  switch (item.type) {
    case 'voice':
      drawSubtitle(context, project, item, effect)
      return
    case 'shape':
      // 図形の基準の大きさは画面全体(等倍で画面を覆う)。
      withTransform(context, item.transform, effect, project.canvas.width, project.canvas.height, (x, y, width, height) => {
        context.fillStyle = item.fill
        if (item.shape === 'ellipse') {
          context.beginPath()
          context.ellipse(x + width / 2, y + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2)
          context.fill()
        } else {
          context.fillRect(x, y, width, height)
        }
      })
      return
    case 'text': {
      const style = project.subtitleStyles[item.styleId]
      if (!style) return
      withTransform(context, item.transform, effect, 0, 0, () => drawTelop(context, item, style, relMs))
      return
    }
    case 'image': {
      const asset = project.assets[item.assetId]
      if (!asset || asset.type !== 'image') return
      const image = resources.image(asset.path.absolute)
      if (!image) return
      // 画像の基準の大きさは素材の画素数そのまま。
      withTransform(context, item.transform, effect, asset.width, asset.height, (x, y, width, height) =>
        context.drawImage(image, x, y, width, height)
      )
      return
    }
    case 'video': {
      const asset = project.assets[item.assetId]
      if (!asset || asset.type !== 'video') return
      const frame = resources.video(item, sourceTimeMs(item, relMs))
      if (!frame) return
      // 動画の基準の大きさは画面に収まる最大の大きさ(ゲーム録画をそのまま画面いっぱいに置ける)。
      const fit = Math.min(project.canvas.width / asset.width, project.canvas.height / asset.height)
      withTransform(context, item.transform, effect, asset.width * fit, asset.height * fit, (x, y, width, height) =>
        context.drawImage(frame, x, y, width, height)
      )
      return
    }
    case 'audio':
    case 'portrait':
    case 'zoom':
      return
  }
}

/** 変形(中心の位置・回転・拡大率・不透明度)とエフェクトを掛けて、中心を原点にした矩形に描く。 */
function withTransform(
  context: Ctx2D,
  transform: Transform,
  effect: EffectState,
  width: number,
  height: number,
  draw: (x: number, y: number, width: number, height: number) => void
): void {
  context.save()
  context.globalAlpha *= transform.opacity * effect.alpha
  context.translate(transform.x + effect.dx, transform.y + effect.dy)
  if (transform.rotation !== 0) context.rotate((transform.rotation * Math.PI) / 180)
  const scale = transform.scale * effect.scale
  context.scale(scale, scale)
  draw(-width / 2, -height / 2, width, height)
  context.restore()
}

function drawSubtitle(context: Ctx2D, project: Project, item: VoiceItem, effect: EffectState): void {
  const character = project.characters[item.characterId]
  const styleId = item.subtitleOverride?.styleId ?? character?.subtitleStyleId
  const style = styleId === undefined ? undefined : project.subtitleStyles[styleId]
  if (!style) return

  const color = item.subtitleOverride?.color ?? style.color
  const sizeScale = item.subtitleOverride?.sizeScale ?? 1
  const resolved = { ...style, color, fontSizePx: style.fontSizePx * sizeScale }
  if (effect === IDENTITY_EFFECT) {
    drawText(context, item.subtitleLines, resolved)
    return
  }
  context.save()
  context.globalAlpha *= effect.alpha
  context.translate(style.position.x + effect.dx, style.position.y + effect.dy)
  context.scale(effect.scale, effect.scale)
  context.translate(-style.position.x, -style.position.y)
  drawText(context, item.subtitleLines, resolved)
  context.restore()
}

export { fontFamilyStack }

/** 字幕を描く(字幕の設定画面の見本用。動画と同じ描き方)。 */
export function drawSubtitleLines(context: Ctx2D, lines: readonly string[], style: SubtitleStyle): void {
  drawText(context, lines, style)
}

/** 字幕を描く。指定位置を最終行の下端として上へ積む(テロップは telop.ts)。 */
function drawText(context: Ctx2D, lines: readonly string[], style: SubtitleStyle | undefined): void {
  if (!style || lines.length === 0) return

  context.save()
  context.font = `${style.fontWeight} ${style.fontSizePx}px ${fontFamilyStack(style.fontFamily)}`
  context.textAlign = style.position.anchor.endsWith('left') ? 'left' : style.position.anchor.endsWith('right') ? 'right' : 'center'
  context.textBaseline = 'alphabetic'

  const lineHeightPx = style.fontSizePx * style.lineHeight
  // 指定位置を最終行の下端とみなし、行数に応じて上へ積む。
  const firstLineY = style.position.y - lineHeightPx * (lines.length - 1)

  lines.forEach((line, index) => {
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
      context.strokeText(line, style.position.x, y)
    }
    context.shadowColor = 'transparent'
    context.fillStyle = style.color
    context.fillText(line, style.position.x, y)
  })

  context.restore()
}
