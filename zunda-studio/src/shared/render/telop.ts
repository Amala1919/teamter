/**
 * テロップ(テキストのアイテム)の描き方。プレビューと書き出しは compositor からこれを呼ぶ。
 * 見た目は字幕スタイルに、テロップだけの上書き(TextItem.look)を重ねて決める。
 */

import type { Ms, SubtitleOutline, SubtitleShadow, SubtitleStyle, TextAlign, TextBackground, TextItem, TextLook } from '../project/types'
import type { Ctx2D } from './types'

/** 描くときの見た目(スタイルと上書きを合わせたもの)。 */
export interface TelopStyle {
  fontFamily: string
  fontWeight: number
  fontSizePx: number
  color: string
  align: TextAlign
  lineHeight: number
  outline: SubtitleOutline | null
  shadow: SubtitleShadow | null
  background: TextBackground | null
  typewriterMs: Ms
}

export function telopStyle(style: SubtitleStyle, look: TextLook | undefined): TelopStyle {
  const outline = look?.outline === undefined ? style.outline : look.outline === 'none' ? null : look.outline
  const shadow = look?.shadow === undefined ? style.shadow : look.shadow === 'none' ? null : look.shadow
  return {
    fontFamily: look?.fontFamily ?? style.fontFamily,
    fontWeight: look?.fontWeight ?? style.fontWeight,
    fontSizePx: look?.fontSizePx ?? style.fontSizePx,
    color: look?.color ?? style.color,
    align: look?.align ?? 'center',
    lineHeight: look?.lineHeight ?? style.lineHeight,
    outline: outline && outline.widthPx > 0 ? outline : null,
    shadow,
    background: look?.background ?? null,
    typewriterMs: look?.typewriterMs ?? 0
  }
}

/** 字幕に使うフォント。指定のフォントが無い環境でも日本語が表示されるよう、OS ごとの候補を後ろに並べる。 */
export function fontFamilyStack(family: string): string {
  const fallbacks = ['Noto Sans JP', 'Yu Gothic UI', 'Meiryo', 'Hiragino Sans', 'IPAGothic', 'sans-serif']
  return [family, ...fallbacks.filter((candidate) => candidate !== family)]
    .map((name) => (name === 'sans-serif' ? name : `"${name}"`))
    .join(', ')
}

function fontOf(style: TelopStyle): string {
  return `${style.fontWeight} ${style.fontSizePx}px ${fontFamilyStack(style.fontFamily)}`
}

interface TelopLayout {
  lines: string[]
  widths: number[]
  /** 一番長い行の幅。 */
  width: number
  lineHeightPx: number
  /** 1行目の文字の並び(ベースライン)の位置。行の塊の中心を 0 とする。 */
  firstBaseline: number
  /** 文字の塊の高さ(1行目の上端から最終行の下端まで)。 */
  textHeight: number
}

/** context.font を設定してから測る(描く前に呼ぶ)。 */
function layout(context: Ctx2D, text: string, style: TelopStyle): TelopLayout {
  context.font = fontOf(style)
  const lines = text.split('\n')
  const widths = lines.map((line) => context.measureText(line).width)
  const lineHeightPx = style.fontSizePx * style.lineHeight
  const spread = lineHeightPx * (lines.length - 1)
  return {
    lines,
    widths,
    width: Math.max(0, ...widths),
    lineHeightPx,
    firstBaseline: -spread / 2 + style.fontSizePx * 0.35,
    textHeight: spread + style.fontSizePx
  }
}

/** テロップの見た目の大きさ(等倍・回転なし)。帯と縁取りを含む。中心は置いた位置。 */
export function telopSize(context: Ctx2D, item: Pick<TextItem, 'text' | 'look'>, style: SubtitleStyle): { width: number; height: number } {
  const resolved = telopStyle(style, item.look)
  context.save()
  const { width, textHeight } = layout(context, item.text, resolved)
  context.restore()
  const pad = resolved.background ? resolved.background.paddingPx : 0
  const edge = resolved.outline ? resolved.outline.widthPx : 0
  return { width: width + 2 * Math.max(pad, edge / 2), height: textHeight + 2 * Math.max(pad, edge / 2) }
}

/** 文字送りで、今出ている文字数(改行は数えない)。 */
export function visibleCharacters(text: string, typewriterMs: Ms, relMs: Ms): number {
  const total = Array.from(text.replace(/\n/g, '')).length
  if (typewriterMs <= 0) return total
  return Math.max(0, Math.min(total, Math.floor((total * Math.max(0, relMs)) / typewriterMs)))
}

/** テロップを、置いた位置を原点(行の塊の中心)として描く。変形とエフェクトは呼ぶ側で掛けておく。 */
export function drawTelop(context: Ctx2D, item: Pick<TextItem, 'text' | 'look'>, style: SubtitleStyle, relMs: Ms): void {
  const resolved = telopStyle(style, item.look)
  context.save()
  const { lines, widths, width, lineHeightPx, firstBaseline, textHeight } = layout(context, item.text, resolved)

  if (resolved.background && resolved.background.opacity > 0) {
    const { paddingPx, radiusPx, color, opacity } = resolved.background
    context.save()
    context.globalAlpha *= opacity
    context.fillStyle = color
    roundedRect(context, -width / 2 - paddingPx, -textHeight / 2 - paddingPx, width + paddingPx * 2, textHeight + paddingPx * 2, radiusPx)
    context.fill()
    context.restore()
  }

  // 行は左端から描く(文字送りで文字が増えても、行の位置が動かないように)。
  context.textAlign = 'left'
  context.textBaseline = 'alphabetic'
  let remaining = visibleCharacters(item.text, resolved.typewriterMs, relMs)
  lines.forEach((line, index) => {
    if (remaining <= 0) return
    const chars = Array.from(line)
    const shown = chars.slice(0, remaining).join('')
    remaining -= chars.length
    if (shown === '') return
    const lineWidth = widths[index] ?? 0
    const x = resolved.align === 'left' ? -width / 2 : resolved.align === 'right' ? width / 2 - lineWidth : -lineWidth / 2
    const y = firstBaseline + lineHeightPx * index
    // 影は最初に描くもの(縁取りがあれば縁取り、無ければ文字)にだけ付ける。
    if (resolved.shadow) {
      context.shadowColor = resolved.shadow.color
      context.shadowOffsetX = resolved.shadow.offsetX
      context.shadowOffsetY = resolved.shadow.offsetY
      context.shadowBlur = resolved.shadow.blurPx
    }
    if (resolved.outline) {
      context.lineWidth = resolved.outline.widthPx
      context.strokeStyle = resolved.outline.color
      context.lineJoin = 'round'
      context.strokeText(shown, x, y)
      context.shadowColor = 'transparent'
    }
    context.fillStyle = resolved.color
    context.fillText(shown, x, y)
    context.shadowColor = 'transparent'
  })
  context.restore()
}

function roundedRect(context: Ctx2D, x: number, y: number, width: number, height: number, radius: number): void {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2))
  context.beginPath()
  context.moveTo(x + r, y)
  context.arcTo(x + width, y, x + width, y + height, r)
  context.arcTo(x + width, y + height, x, y + height, r)
  context.arcTo(x, y + height, x, y, r)
  context.arcTo(x, y, x + width, y, r)
  context.closePath()
}

/**
 * よく使う見た目のひな形。押すとテロップの見た目をこれにする(スタイルの設定は変えない)。
 * merge のものは今の見た目に足す(文字送りなど、ほかの見た目と組み合わせるもの)。
 */
export const TELOP_PRESETS: { id: string; name: string; look: TextLook; merge?: boolean }[] = [
  { id: 'plain', name: 'スタイルのまま', look: {} },
  { id: 'yellow', name: '黄色・黒縁', look: { color: '#ffe14d', fontWeight: 900, outline: { color: '#000000', widthPx: 10 } } },
  { id: 'red', name: '赤で強調', look: { color: '#ff3b30', fontWeight: 900, outline: { color: '#ffffff', widthPx: 10 } } },
  { id: 'blue', name: '白・青縁', look: { color: '#ffffff', fontWeight: 900, outline: { color: '#1e5bd8', widthPx: 10 } } },
  {
    id: 'darkBand',
    name: '黒帯',
    look: { color: '#ffffff', outline: 'none', shadow: 'none', background: { color: '#000000', opacity: 0.65, paddingPx: 18, radiusPx: 8 } }
  },
  {
    id: 'lightBand',
    name: '白帯',
    look: { color: '#222222', outline: 'none', shadow: 'none', background: { color: '#ffffff', opacity: 0.9, paddingPx: 18, radiusPx: 8 } }
  },
  {
    id: 'news',
    name: 'ニュース風',
    look: {
      color: '#ffffff',
      fontWeight: 700,
      align: 'left',
      outline: 'none',
      shadow: 'none',
      background: { color: '#c8102e', opacity: 0.95, paddingPx: 16, radiusPx: 0 }
    }
  },
  {
    id: 'typewriter',
    name: '文字送り(1秒)',
    look: { typewriterMs: 1000 },
    merge: true
  }
]
