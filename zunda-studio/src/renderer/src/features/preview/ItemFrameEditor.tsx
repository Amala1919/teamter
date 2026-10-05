import { useEffect, useState } from 'react'

import type { CanvasConfig } from '@shared/project/types'

type Corner = 'nw' | 'ne' | 'sw' | 'se'
type Edge = 'n' | 's' | 'e' | 'w'
const CORNERS: Corner[] = ['nw', 'ne', 'sw', 'se']
const EDGES: Edge[] = ['n', 's', 'e', 'w']
const MIN_SCALE = 0.05
const MAX_SCALE = 20

export interface Placement {
  x: number
  y: number
  scale: number
  /** 回転(度)。 */
  rotation: number
  /** 基準の大きさ(幅・高さを別々に変えられる素材=図形だけ)。 */
  width?: number
  height?: number
}

/**
 * 四隅をつまんだときの拡大率。素材は置いた位置(中心)を基準に大きくなるので、角を動かした分の2倍だけ幅が変わる。
 * width・height は今の拡大率での大きさ。dx・dy は素材の向きに合わせた(回転を戻した)ずれ。
 */
export function scaleFromCorner(scale: number, width: number, height: number, corner: Corner, dx: number, dy: number): number {
  const sx = corner.endsWith('e') ? 1 : -1
  const sy = corner.startsWith('s') ? 1 : -1
  const ratioX = (width + 2 * sx * dx) / Math.max(1, width)
  const ratioY = (height + 2 * sy * dy) / Math.max(1, height)
  // 大きく動かした方の向きに合わせる(縦横比は保つ)。
  const ratio = Math.abs(ratioX - 1) >= Math.abs(ratioY - 1) ? ratioX : ratioY
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(scale * ratio * 1000) / 1000))
}

/** 画面上のずれを、素材の向き(回転)に合わせたずれにする。 */
function toLocal(dx: number, dy: number, rotation: number): { dx: number; dy: number } {
  const angle = (-rotation * Math.PI) / 180
  return { dx: dx * Math.cos(angle) - dy * Math.sin(angle), dy: dx * Math.sin(angle) + dy * Math.cos(angle) }
}

/** 素材の向きのずれを、画面上のずれにする。 */
function toScreen(dx: number, dy: number, rotation: number): { dx: number; dy: number } {
  return toLocal(dx, dy, -rotation)
}

/**
 * 辺をつまんで、幅か高さだけを変える(図形)。反対側の辺はその場に残す(中心がずれる)。
 * size は今の拡大率での大きさ、base は基準の大きさ。
 */
export function resizeFromEdge(placement: Placement, base: { width: number; height: number }, edge: Edge, localDx: number, localDy: number): Placement {
  const scale = Math.max(0.0001, placement.scale)
  const horizontal = edge === 'e' || edge === 'w'
  const sign = edge === 'e' || edge === 's' ? 1 : -1
  const delta = (horizontal ? localDx : localDy) * sign
  const current = horizontal ? base.width : base.height
  const next = Math.max(4, Math.round(current + delta / scale))
  const moved = ((next - current) * scale) / 2
  const shift = toScreen(horizontal ? moved * sign : 0, horizontal ? 0 : moved * sign, placement.rotation)
  return {
    ...placement,
    x: Math.round(placement.x + shift.dx),
    y: Math.round(placement.y + shift.dy),
    width: horizontal ? next : base.width,
    height: horizontal ? base.height : next
  }
}

interface ItemFrameEditorProps {
  canvas: Pick<CanvasConfig, 'width' | 'height'>
  /** 基準の大きさ(拡大率 1 のとき。キャンバスの座標)。 */
  base: { width: number; height: number }
  placement: Placement
  /** 表示上の1pxがキャンバス座標でいくつか。 */
  scale: number
  label: string
  /** 辺をつまんで幅・高さを別々に変えられるか(図形)。 */
  resizable?: boolean
  onCommit: (placement: Placement) => void
  onContextMenu?: (event: React.MouseEvent) => void
}

/**
 * プレビューに重ねる、選んだ素材(テロップ・画像・図形・動画)の枠。
 * 内側をドラッグして動かし、四隅で大きさ、上の丸で向き(Shift で15度ずつ)、図形は辺で幅・高さを変える。
 * 離したときに1回だけ反映する(取り消しの単位を1回にするため)。
 */
export function ItemFrameEditor({ canvas, base, placement, scale, label, resizable, onCommit, onContextMenu }: ItemFrameEditorProps): React.JSX.Element {
  const [draft, setDraft] = useState<Placement | null>(null)
  const shown = draft ?? placement
  const shownBase = { width: shown.width ?? base.width, height: shown.height ?? base.height }
  const width = shownBase.width * shown.scale
  const height = shownBase.height * shown.scale

  useEffect(() => setDraft(null), [placement.x, placement.y, placement.scale, placement.rotation, placement.width, placement.height])

  const begin = (event: React.PointerEvent, handle: Corner | Edge | 'move' | 'rotate'): void => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const origin = { x: event.clientX, y: event.clientY }
    // 回すときの中心(画面上)。枠の要素の中心。
    const frameElement = (event.currentTarget as HTMLElement).closest('[data-testid="item-frame"]') as HTMLElement | null
    const rect = frameElement?.getBoundingClientRect()
    const center = rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : origin
    let latest = placement
    const onMove = (move: PointerEvent): void => {
      const dx = (move.clientX - origin.x) * scale
      const dy = (move.clientY - origin.y) * scale
      if (handle === 'move') {
        latest = { ...placement, x: Math.round(placement.x + dx), y: Math.round(placement.y + dy) }
      } else if (handle === 'rotate') {
        let degrees = (Math.atan2(move.clientY - center.y, move.clientX - center.x) * 180) / Math.PI + 90
        if (degrees > 180) degrees -= 360
        degrees = move.shiftKey ? Math.round(degrees / 15) * 15 : Math.round(degrees)
        latest = { ...placement, rotation: degrees }
      } else {
        const local = toLocal(dx, dy, placement.rotation)
        latest = CORNERS.includes(handle as Corner)
          ? { ...placement, scale: scaleFromCorner(placement.scale, base.width * placement.scale, base.height * placement.scale, handle as Corner, local.dx, local.dy) }
          : resizeFromEdge(placement, base, handle as Edge, local.dx, local.dy)
      }
      setDraft(latest)
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      if (latest !== placement) onCommit(latest)
      else setDraft(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp, { once: true })
  }

  const percent = (value: number, total: number): string => `${(value / total) * 100}%`
  return (
    <div className="zoom-frame__layer" data-testid="item-frame-layer">
      <div
        className="zoom-frame item-frame"
        style={{
          left: percent(shown.x - width / 2, canvas.width),
          top: percent(shown.y - height / 2, canvas.height),
          width: percent(width, canvas.width),
          height: percent(height, canvas.height),
          transform: shown.rotation !== 0 ? `rotate(${shown.rotation}deg)` : undefined
        }}
        onPointerDown={(event) => begin(event, 'move')}
        onContextMenu={onContextMenu}
        data-testid="item-frame"
        data-placement={`${Math.round(shown.x)},${Math.round(shown.y)},${shown.scale}`}
        data-rotation={shown.rotation}
        data-size={`${Math.round(shownBase.width)},${Math.round(shownBase.height)}`}
      >
        <span className="zoom-frame__label">
          {label} · {Math.round(shown.scale * 100)}%{shown.rotation !== 0 ? ` · ${shown.rotation}°` : ''}
        </span>
        <span className="item-frame__rotate" onPointerDown={(event) => begin(event, 'rotate')} title="ドラッグで回す(Shift で15度ずつ)" data-testid="item-handle-rotate" />
        {CORNERS.map((corner) => (
          <span
            key={corner}
            className={`zoom-frame__handle zoom-frame__handle--${corner}`}
            onPointerDown={(event) => begin(event, corner)}
            data-testid={`item-handle-${corner}`}
          />
        ))}
        {resizable &&
          EDGES.map((edge) => (
            <span
              key={edge}
              className={`zoom-frame__handle zoom-frame__handle--${edge} item-frame__edge`}
              onPointerDown={(event) => begin(event, edge)}
              data-testid={`item-handle-${edge}`}
            />
          ))}
      </div>
    </div>
  )
}
