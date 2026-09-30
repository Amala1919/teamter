import { useEffect, useState } from 'react'

import type { CanvasConfig } from '@shared/project/types'

type Corner = 'nw' | 'ne' | 'sw' | 'se'
const CORNERS: Corner[] = ['nw', 'ne', 'sw', 'se']
const MIN_SCALE = 0.05
const MAX_SCALE = 20

export interface Placement {
  x: number
  y: number
  scale: number
}

/**
 * 四隅をつまんだときの拡大率。素材は置いた位置(中心)を基準に大きくなるので、角を動かした分の2倍だけ幅が変わる。
 * width・height は今の拡大率での大きさ。
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

interface ItemFrameEditorProps {
  canvas: Pick<CanvasConfig, 'width' | 'height'>
  /** 今の拡大率での大きさ(キャンバスの座標)。 */
  size: { width: number; height: number }
  placement: Placement
  /** 表示上の1pxがキャンバス座標でいくつか。 */
  scale: number
  label: string
  onCommit: (placement: Placement) => void
  onContextMenu?: (event: React.MouseEvent) => void
}

/**
 * プレビューに重ねる、選んだ素材(テロップ・画像・図形・動画)の枠。内側をドラッグして動かし、四隅で大きさを変える。
 * 離したときに1回だけ反映する(取り消しの単位を1回にするため)。
 */
export function ItemFrameEditor({ canvas, size, placement, scale, label, onCommit, onContextMenu }: ItemFrameEditorProps): React.JSX.Element {
  const [draft, setDraft] = useState<Placement | null>(null)
  const shown = draft ?? placement
  const ratio = shown.scale / Math.max(0.0001, placement.scale)
  const width = size.width * ratio
  const height = size.height * ratio

  useEffect(() => setDraft(null), [placement.x, placement.y, placement.scale])

  const begin = (event: React.PointerEvent, handle: Corner | 'move'): void => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const origin = { x: event.clientX, y: event.clientY }
    let latest = placement
    const onMove = (move: PointerEvent): void => {
      const dx = (move.clientX - origin.x) * scale
      const dy = (move.clientY - origin.y) * scale
      latest =
        handle === 'move'
          ? { ...placement, x: Math.round(placement.x + dx), y: Math.round(placement.y + dy) }
          : { ...placement, scale: scaleFromCorner(placement.scale, size.width, size.height, handle, dx, dy) }
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
          height: percent(height, canvas.height)
        }}
        onPointerDown={(event) => begin(event, 'move')}
        onContextMenu={onContextMenu}
        data-testid="item-frame"
        data-placement={`${Math.round(shown.x)},${Math.round(shown.y)},${shown.scale}`}
      >
        <span className="zoom-frame__label">
          {label} · {Math.round(shown.scale * 100)}%
        </span>
        {CORNERS.map((corner) => (
          <span
            key={corner}
            className={`zoom-frame__handle zoom-frame__handle--${corner}`}
            onPointerDown={(event) => begin(event, corner)}
            data-testid={`item-handle-${corner}`}
          />
        ))}
      </div>
    </div>
  )
}
