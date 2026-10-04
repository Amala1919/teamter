import { useEffect, useState } from 'react'

import type { CanvasConfig, Crop } from '@shared/project/types'

type Handle = 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se' | 'move'
const HANDLES: Exclude<Handle, 'move'>[] = ['nw', 'ne', 'sw', 'se', 'n', 's', 'e', 'w']
/** 切り抜いても最低これだけは残す(割合)。 */
const MIN_KEEP = 0.05

/** 切り抜きの割合を、ドラッグの量(素材の向きでの、素材の大きさに対する割合)だけ動かす。 */
export function dragCrop(crop: Crop, handle: Handle, fx: number, fy: number): Crop {
  let { left, right, top, bottom } = crop
  if (handle === 'move') {
    // 残す範囲の大きさはそのままで、場所だけ動かす。
    const dx = Math.max(-left, Math.min(right, fx))
    const dy = Math.max(-top, Math.min(bottom, fy))
    return { left: left + dx, right: right - dx, top: top + dy, bottom: bottom - dy }
  }
  if (handle.includes('w')) left = Math.min(1 - right - MIN_KEEP, Math.max(0, left + fx))
  if (handle.includes('e')) right = Math.min(1 - left - MIN_KEEP, Math.max(0, right - fx))
  if (handle.includes('n')) top = Math.min(1 - bottom - MIN_KEEP, Math.max(0, top + fy))
  if (handle.includes('s')) bottom = Math.min(1 - top - MIN_KEEP, Math.max(0, bottom - fy))
  const round = (value: number): number => Math.round(value * 1000) / 1000
  return { left: round(left), right: round(right), top: round(top), bottom: round(bottom) }
}

interface CropFrameEditorProps {
  canvas: Pick<CanvasConfig, 'width' | 'height'>
  /** 切り抜く前の素材の中心と大きさ(画面上、拡大率込み)。 */
  center: { x: number; y: number }
  size: { width: number; height: number }
  rotation: number
  crop: Crop
  /** 表示上の1pxがキャンバス座標でいくつか。 */
  scale: number
  onCommit: (crop: Crop) => void
  onClose: () => void
}

/**
 * 切り抜きの編集。切り抜く前の素材全体の上に、残す範囲の枠を出す。辺・角で範囲を変え、内側で範囲を動かす。
 * 離したときに1回だけ反映する。
 */
export function CropFrameEditor({ canvas, center, size, rotation, crop, scale, onCommit, onClose }: CropFrameEditorProps): React.JSX.Element {
  const [draft, setDraft] = useState<Crop | null>(null)
  const shown = draft ?? crop
  useEffect(() => setDraft(null), [crop.left, crop.right, crop.top, crop.bottom])

  const begin = (event: React.PointerEvent, handle: Handle): void => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const origin = { x: event.clientX, y: event.clientY }
    let latest = crop
    const angle = (-rotation * Math.PI) / 180
    const onMove = (move: PointerEvent): void => {
      const dx = (move.clientX - origin.x) * scale
      const dy = (move.clientY - origin.y) * scale
      // 素材の向きに直してから、素材の大きさに対する割合にする。
      const localX = dx * Math.cos(angle) - dy * Math.sin(angle)
      const localY = dx * Math.sin(angle) + dy * Math.cos(angle)
      latest = dragCrop(crop, handle, localX / Math.max(1, size.width), localY / Math.max(1, size.height))
      setDraft(latest)
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      if (latest !== crop) onCommit(latest)
      else setDraft(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp, { once: true })
  }

  const percent = (value: number, total: number): string => `${(value / total) * 100}%`
  const pct = (value: number): string => `${value * 100}%`
  return (
    <div className="zoom-frame__layer" data-testid="crop-frame-layer">
      <div
        className="crop-frame__whole"
        style={{
          left: percent(center.x - size.width / 2, canvas.width),
          top: percent(center.y - size.height / 2, canvas.height),
          width: percent(size.width, canvas.width),
          height: percent(size.height, canvas.height),
          transform: rotation !== 0 ? `rotate(${rotation}deg)` : undefined
        }}
      >
        <div
          className="zoom-frame crop-frame"
          style={{ left: pct(shown.left), top: pct(shown.top), right: pct(shown.right), bottom: pct(shown.bottom) }}
          onPointerDown={(event) => begin(event, 'move')}
          onDoubleClick={onClose}
          data-testid="crop-frame"
          data-crop={`${shown.left},${shown.top},${shown.right},${shown.bottom}`}
        >
          <span className="zoom-frame__label">切り抜き(ダブルクリックで終える)</span>
          {HANDLES.map((handle) => (
            <span key={handle} className={`zoom-frame__handle zoom-frame__handle--${handle}`} onPointerDown={(event) => begin(event, handle)} data-testid={`crop-handle-${handle}`} />
          ))}
        </div>
      </div>
    </div>
  )
}
