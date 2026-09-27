import { useEffect, useState } from 'react'

import type { CanvasConfig, ZoomRegion } from '@shared/project/types'
import { regionHeight, resizeRegion, type ZoomHandle } from '@shared/render/zoom'

type Handle = ZoomHandle

const HANDLES: Exclude<Handle, 'move'>[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']

interface ZoomFrameEditorProps {
  canvas: Pick<CanvasConfig, 'width' | 'height'>
  region: ZoomRegion
  /** 表示上の1pxがキャンバス座標でいくつか。 */
  scale: number
  onCommit: (region: ZoomRegion) => void
}

/**
 * プレビューに重ねるズーム枠。ウインドウと同じ感覚で、四辺・四隅で大きさを、内側で位置を変える。
 * 縦横比は常にキャンバスと同じで、画面の外へははみ出さない(REQUIREMENTS.md Z-1, Z-2)。
 * ドラッグ中は手元だけで動かし、離したときに1回だけ反映する(取り消しの単位を1回にするため)。
 */
export function ZoomFrameEditor({ canvas, region, scale, onCommit }: ZoomFrameEditorProps): React.JSX.Element {
  const [draft, setDraft] = useState<ZoomRegion | null>(null)
  const shown = draft ?? region
  const height = regionHeight(canvas, shown.width)

  useEffect(() => setDraft(null), [region])

  const begin = (event: React.PointerEvent, handle: Handle): void => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const origin = { x: event.clientX, y: event.clientY }
    let latest = region
    const onMove = (move: PointerEvent): void => {
      latest = resizeRegion(canvas, region, handle, (move.clientX - origin.x) * scale, (move.clientY - origin.y) * scale)
      setDraft(latest)
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      if (latest !== region) onCommit(latest)
      else setDraft(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp, { once: true })
  }

  const percent = (value: number, total: number): string => `${(value / total) * 100}%`

  return (
    <div className="zoom-frame__layer" data-testid="zoom-frame-layer">
      <div
        className="zoom-frame"
        style={{
          left: percent(shown.x, canvas.width),
          top: percent(shown.y, canvas.height),
          width: percent(shown.width, canvas.width),
          height: percent(height, canvas.height)
        }}
        onPointerDown={(event) => begin(event, 'move')}
        data-testid="zoom-frame"
        data-region={`${Math.round(shown.x)},${Math.round(shown.y)},${Math.round(shown.width)}`}
      >
        <span className="zoom-frame__label">{Math.round((canvas.width / shown.width) * 100) / 100}倍</span>
        {HANDLES.map((handle) => (
          <span
            key={handle}
            className={`zoom-frame__handle zoom-frame__handle--${handle}`}
            onPointerDown={(event) => begin(event, handle)}
            data-testid={`zoom-handle-${handle}`}
          />
        ))}
      </div>
    </div>
  )
}
