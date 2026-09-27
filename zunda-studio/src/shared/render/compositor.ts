/**
 * 合成描画の唯一の実装。プレビュー(ブラウザ)と書き出し(Node)の両方がこの関数を呼ぶ。
 * docs/ARCHITECTURE.md の「プレビューと書き出しは同一のレンダラを使う」を参照。
 *
 * 現在時刻や Math.random を参照してはならない。時刻に依存するものは引数の timeMs と
 * project.meta.renderSeed から決定論的に導出する。これがプレビューと書き出しの一致を保証する。
 */

import { portraitSelections } from '../portrait/animation'
import { itemsAt } from '../project/queries'
import type { Character, Item, LayerId, Ms, PortraitItem, Project, SubtitleStyle, VoiceItem } from '../project/types'
import { drawPortrait } from './portrait'
import type { Ctx2D, RenderResources } from './types'

/** 描画順を決めるための1要素。アイテムに加え、常時表示の立ち絵もここに並ぶ。 */
type Drawable =
  | { kind: 'item'; layerId: LayerId; item: Item }
  | { kind: 'portrait'; layerId: LayerId; character: Character; item: PortraitItem | null }

export function renderFrame(context: Ctx2D, project: Project, timeMs: Ms, resources: RenderResources): void {
  const { width, height, backgroundColor } = project.canvas
  context.save()
  context.setTransform(1, 0, 0, 1, 0, 0)
  context.globalAlpha = 1
  context.globalCompositeOperation = 'source-over'
  context.clearRect(0, 0, width, height)
  context.fillStyle = backgroundColor
  context.fillRect(0, 0, width, height)

  const layerIndex = new Map(project.layers.map((layer) => [layer.id, layer.index]))
  const hidden = new Set(project.layers.filter((layer) => !layer.visible).map((layer) => layer.id))

  const drawables: Drawable[] = []
  for (const item of itemsAt(project, timeMs)) {
    if (item.type === 'portrait') {
      const character = project.characters[item.characterId]
      if (character) drawables.push({ kind: 'portrait', layerId: item.layerId, character, item })
    } else {
      drawables.push({ kind: 'item', layerId: item.layerId, item })
    }
  }
  for (const character of alwaysVisiblePortraits(project)) {
    drawables.push({ kind: 'portrait', layerId: portraitLayerId(project), character, item: null })
  }
  // 同じレイヤーの中では元の並び(アイテム → 立ち絵)を保つため、安定ソートを使う。
  drawables.sort((a, b) => (layerIndex.get(a.layerId) ?? 0) - (layerIndex.get(b.layerId) ?? 0))

  for (const drawable of drawables) {
    if (hidden.has(drawable.layerId)) continue
    if (drawable.kind === 'portrait') {
      drawCharacter(context, project, drawable.character, drawable.item, timeMs, resources)
    } else {
      drawItem(context, project, drawable.item)
    }
  }
  context.restore()
}

/**
 * 立ち絵の表示の既定: そのキャラクターの立ち絵アイテムが1つも無ければ、動画全体を通して表示する。
 * 登場・退場を制御したいときだけ立ち絵アイテムを置けばよい(PROJECT_FORMAT.md 6.2)。
 */
function alwaysVisiblePortraits(project: Project): Character[] {
  const controlled = new Set(
    project.items.filter((item): item is PortraitItem => item.type === 'portrait').map((item) => item.characterId)
  )
  return Object.values(project.characters).filter((character) => character.portrait && !controlled.has(character.id))
}

function portraitLayerId(project: Project): LayerId {
  return (
    project.layers.find((layer) => layer.id === 'lyr_portrait')?.id ??
    project.layers.find((layer) => layer.name === '立ち絵')?.id ??
    project.layers[project.layers.length - 1]?.id ??
    ''
  )
}

function drawCharacter(
  context: Ctx2D,
  project: Project,
  character: Character,
  item: PortraitItem | null,
  timeMs: Ms,
  resources: RenderResources
): void {
  const portrait = character.portrait
  if (!portrait) return
  const manifest = resources.psd(portrait.assetId)
  if (!manifest) return
  const selections = portraitSelections(project, character, portrait, timeMs)
  drawPortrait(context, character, manifest, selections, resources, item?.transformOverride ?? portrait.transform)
}

function drawItem(context: Ctx2D, project: Project, item: Item): void {
  switch (item.type) {
    case 'voice':
      drawSubtitle(context, project, item)
      return
    case 'shape':
      context.save()
      context.fillStyle = item.fill
      context.globalAlpha = item.transform.opacity
      context.fillRect(0, 0, project.canvas.width, project.canvas.height)
      context.restore()
      return
    case 'text':
      drawText(context, item.text.split('\n'), project.subtitleStyles[item.styleId])
      return
    case 'video':
    case 'image':
      // Phase 3 で実装する。それまでは配置が分かるプレースホルダを描く。
      drawPlaceholder(context, project, item)
      return
    case 'portrait':
      return
  }
}

function drawSubtitle(context: Ctx2D, project: Project, item: VoiceItem): void {
  const character = project.characters[item.characterId]
  const styleId = item.subtitleOverride?.styleId ?? character?.subtitleStyleId
  const style = styleId === undefined ? undefined : project.subtitleStyles[styleId]
  if (!style) return

  const color = item.subtitleOverride?.color ?? style.color
  const sizeScale = item.subtitleOverride?.sizeScale ?? 1
  drawText(context, item.subtitleLines, { ...style, color, fontSizePx: style.fontSizePx * sizeScale })
}

/** 字幕に使うフォント。指定のフォントが無い環境でも日本語が表示されるよう、OS ごとの候補を後ろに並べる。 */
export function fontFamilyStack(family: string): string {
  const fallbacks = ['Noto Sans JP', 'Yu Gothic UI', 'Meiryo', 'Hiragino Sans', 'IPAGothic', 'sans-serif']
  return [family, ...fallbacks.filter((candidate) => candidate !== family)]
    .map((name) => (name === 'sans-serif' ? name : `"${name}"`))
    .join(', ')
}

function drawText(context: Ctx2D, lines: readonly string[], style: SubtitleStyle | undefined): void {
  if (!style || lines.length === 0) return

  context.save()
  context.font = `${style.fontWeight} ${style.fontSizePx}px ${fontFamilyStack(style.fontFamily)}`
  context.textAlign = style.position.anchor.endsWith('left')
    ? 'left'
    : style.position.anchor.endsWith('right')
      ? 'right'
      : 'center'
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

function drawPlaceholder(context: Ctx2D, project: Project, item: Item): void {
  const width = project.canvas.width * 0.5
  const height = project.canvas.height * 0.5
  const x = (project.canvas.width - width) / 2
  const y = (project.canvas.height - height) / 2

  context.save()
  context.strokeStyle = '#4a5a68'
  context.setLineDash([12, 8])
  context.lineWidth = 4
  context.strokeRect(x, y, width, height)
  context.fillStyle = '#7f95a6'
  context.font = '32px sans-serif'
  context.textAlign = 'center'
  context.fillText(`${item.type} (未実装)`, project.canvas.width / 2, y + height / 2)
  context.restore()
}
