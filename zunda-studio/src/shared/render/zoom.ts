import type { CanvasConfig, Ms, ZoomItem, ZoomMethod, ZoomRegion } from '../project/types'
import { ease } from './easing'

/**
 * ズームの計算。プレビューの枠の操作、コマンドの検証、描画のすべてがここを使う。
 * docs/PROJECT_FORMAT.md 6.3 を参照。
 */

/** 枠の最小の幅(キャンバスに対する割合)。これより小さいと映像が粗くなりすぎる。 */
export const MIN_ZOOM_WIDTH_RATIO = 0.1

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

type CanvasSize = Pick<CanvasConfig, 'width' | 'height'>

export function regionHeight(canvas: CanvasSize, width: number): number {
  return (width * canvas.height) / canvas.width
}

export function regionRect(canvas: CanvasSize, region: ZoomRegion): Rect {
  return { x: region.x, y: region.y, width: region.width, height: regionHeight(canvas, region.width) }
}

/** 縦横比を保ったまま、最小の大きさ以上・画面の内側に収める。 */
export function clampRegion(canvas: CanvasSize, region: ZoomRegion): ZoomRegion {
  const width = Math.min(canvas.width, Math.max(canvas.width * MIN_ZOOM_WIDTH_RATIO, region.width))
  const height = regionHeight(canvas, width)
  const x = Math.min(canvas.width - width, Math.max(0, region.x))
  const y = Math.min(canvas.height - height, Math.max(0, region.y))
  return { x: round2(x), y: round2(y), width: round2(width) }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/** 既定の枠: 画面中央の半分の大きさ。 */
export function defaultRegion(canvas: CanvasSize): ZoomRegion {
  const width = canvas.width / 2
  return { x: (canvas.width - width) / 2, y: (canvas.height - regionHeight(canvas, width)) / 2, width }
}

/** 寄り方の既定の時間。瞬間なら0、それ以外は短めにする。 */
export function defaultZoomTiming(method: ZoomMethod): { inMs: Ms; outMs: Ms } {
  switch (method) {
    case 'cut':
      return { inMs: 0, outMs: 0 }
    case 'punch':
      return { inMs: 250, outMs: 300 }
    case 'slowPush':
      return { inMs: 0, outMs: 400 }
    default:
      return { inMs: 400, outMs: 400 }
  }
}

/**
 * アイテム内の相対時刻における寄り具合。0 = 元の画面、1 = 枠の範囲。
 * punch は行き過ぎるので一時的に 1 を超える。
 */
export function zoomProgress(item: Pick<ZoomItem, 'method' | 'inMs' | 'outMs' | 'durationMs'>, relMs: Ms): number {
  const { durationMs } = item
  if (relMs < 0 || relMs >= durationMs) return 0
  // 寄る時間と戻る時間の合計が尺を超えるときは、比率を保って縮める。
  const total = item.inMs + item.outMs
  const fit = total > durationMs && total > 0 ? durationMs / total : 1
  const inMs = item.inMs * fit
  const outMs = item.outMs * fit
  const untilOut = durationMs - relMs

  if (item.method === 'cut') return 1
  if (outMs > 0 && untilOut < outMs) {
    const back = untilOut / outMs
    return item.method === 'linear' ? back : ease('easeInOutCubic', back)
  }
  switch (item.method) {
    case 'smooth':
      return inMs > 0 && relMs < inMs ? ease('easeInOutCubic', relMs / inMs) : 1
    case 'linear':
      return inMs > 0 && relMs < inMs ? relMs / inMs : 1
    case 'punch':
      return inMs > 0 && relMs < inMs ? ease('easeOutBack', relMs / inMs) : 1
    case 'slowPush': {
      // 戻り始めるまでの時間いっぱいをかけて枠まで寄り続ける(inMs は使わない)。
      const pushEnd = Math.max(1, durationMs - outMs)
      return Math.min(1, ease('easeOutCubic', relMs / pushEnd))
    }
  }
}

/**
 * 寄り具合に応じて、元の画面のどの範囲を画面いっぱいに映すか。
 * 拡大率は幅の対数で補間し(一定の速さで寄って見える)、枠の不動点に向かってまっすぐ寄る。
 */
export function zoomViewport(canvas: CanvasSize, region: ZoomRegion, progress: number): Rect {
  if (progress <= 0) return { x: 0, y: 0, width: canvas.width, height: canvas.height }
  const target = regionRect(canvas, region)
  const fullScale = canvas.width / target.width
  const scale = Math.pow(fullScale, progress)
  const width = canvas.width / scale
  const height = canvas.height / scale
  // 不動点: 元の画面と枠とで同じ位置に映る点。枠が画面と同じ大きさなら動かない。
  const shrink = 1 - target.width / canvas.width
  const fixedX = shrink > 1e-9 ? target.x / shrink : 0
  const fixedY = shrink > 1e-9 ? target.y / shrink : 0
  const x = fixedX * (1 - 1 / scale)
  const y = fixedY * (1 - 1 / scale)
  // 行き過ぎ(punch)で画面の外を映さないように収める。
  const clampedWidth = Math.min(canvas.width, width)
  const clampedHeight = Math.min(canvas.height, height)
  return {
    x: Math.min(canvas.width - clampedWidth, Math.max(0, x)),
    y: Math.min(canvas.height - clampedHeight, Math.max(0, y)),
    width: clampedWidth,
    height: clampedHeight
  }
}

export const ZOOM_METHOD_LABELS: Record<ZoomMethod, string> = {
  cut: '瞬間',
  smooth: 'なめらか',
  linear: '等速',
  punch: 'パンチイン',
  slowPush: 'ゆっくり寄り続ける'
}
