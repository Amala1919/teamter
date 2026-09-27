/**
 * 合成描画の唯一の実装。プレビューと書き出しの両方がこの関数を呼ぶ。
 * docs/ARCHITECTURE.md の「プレビューと書き出しは同一のレンダラを使う」を参照。
 *
 * 現在時刻や Math.random を参照してはならない。時刻に依存するものは引数の timeMs と
 * project.meta.renderSeed から決定論的に導出する。これがプレビューと書き出しの一致を保証する。
 */

import { itemsAt } from '@shared/project/queries'
import type { Item, Ms, Project, SubtitleStyle, VoiceItem } from '@shared/project/types'

export function renderFrame(
  context: CanvasRenderingContext2D,
  project: Project,
  timeMs: Ms
): void {
  const { width, height, backgroundColor } = project.canvas
  context.save()
  context.clearRect(0, 0, width, height)
  context.fillStyle = backgroundColor
  context.fillRect(0, 0, width, height)

  const layerById = new Map(project.layers.map((layer) => [layer.id, layer]))
  for (const item of itemsAt(project, timeMs)) {
    if (layerById.get(item.layerId)?.visible === false) continue
    drawItem(context, project, item)
  }
  context.restore()
}

function drawItem(context: CanvasRenderingContext2D, project: Project, item: Item): void {
  switch (item.type) {
    case 'voice':
      drawSubtitle(context, project, item)
      return
    case 'shape':
      context.fillStyle = item.fill
      context.globalAlpha = item.transform.opacity
      context.fillRect(0, 0, project.canvas.width, project.canvas.height)
      context.globalAlpha = 1
      return
    case 'text':
      drawText(context, item.text.split('\n'), project.subtitleStyles[item.styleId])
      return
    case 'video':
    case 'image':
    case 'portrait':
      // Phase 2 / 3 で実装する。それまでは配置が分かるプレースホルダを描く。
      drawPlaceholder(context, project, item)
      return
  }
}

function drawSubtitle(
  context: CanvasRenderingContext2D,
  project: Project,
  item: VoiceItem
): void {
  const character = project.characters[item.characterId]
  const styleId = item.subtitleOverride?.styleId ?? character?.subtitleStyleId
  const style = styleId === undefined ? undefined : project.subtitleStyles[styleId]
  if (!style) return

  const color = item.subtitleOverride?.color ?? style.color
  const sizeScale = item.subtitleOverride?.sizeScale ?? 1
  drawText(context, item.subtitleLines, {
    ...style,
    color,
    fontSizePx: style.fontSizePx * sizeScale
  })
}

function drawText(
  context: CanvasRenderingContext2D,
  lines: readonly string[],
  style: SubtitleStyle | undefined
): void {
  if (!style || lines.length === 0) return

  context.save()
  context.font = `${style.fontWeight} ${style.fontSizePx}px "${style.fontFamily}"`
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

function drawPlaceholder(
  context: CanvasRenderingContext2D,
  project: Project,
  item: Item
): void {
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
