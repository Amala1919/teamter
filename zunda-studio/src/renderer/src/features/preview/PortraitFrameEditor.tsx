import { useEffect, useState } from 'react'

import type { CanvasConfig, PortraitTransform } from '@shared/project/types'
import type { PsdManifest } from '@shared/psd/types'
import { portraitPlacement } from '@shared/render/portrait'

type Corner = 'nw' | 'ne' | 'sw' | 'se'
const CORNERS: Corner[] = ['nw', 'ne', 'sw', 'se']
const MIN_SCALE = 0.05
const MAX_SCALE = 20

/** 四隅をつまんだときの拡大率。基準点(足元など)はそのままで、大きさだけ変わる。 */
export function scaleFromCorner(transform: PortraitTransform, manifest: Pick<PsdManifest, 'width' | 'height'>, corner: Corner, dx: number, dy: number): number {
  const width = manifest.width * transform.scale
  const height = manifest.height * transform.scale
  const sx = corner.endsWith('e') ? 1 : -1
  const sy = corner.startsWith('s') ? 1 : -1
  const ratioX = (width + sx * dx) / width
  const ratioY = (height + sy * dy) / height
  // 大きく動かした方の向きに合わせる(縦横比は保つ)。
  const ratio = Math.abs(ratioX - 1) >= Math.abs(ratioY - 1) ? ratioX : ratioY
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(transform.scale * ratio * 1000) / 1000))
}

interface PortraitFrameEditorProps {
  canvas: Pick<CanvasConfig, 'width' | 'height'>
  manifest: Pick<PsdManifest, 'width' | 'height'>
  transform: PortraitTransform
  /** 表示上の1pxがキャンバス座標でいくつか。 */
  scale: number
  /** 枠に出す説明(「全体の配置」「この区間の配置」など)。 */
  label: string
  onCommit: (transform: PortraitTransform) => void
  /** 枠の上での右クリック(プレビューと同じメニューを出す)。 */
  onContextMenu?: (event: React.MouseEvent) => void
}

/**
 * プレビューに重ねる立ち絵の枠。内側をドラッグして動かし、四隅で大きさを変える。
 * 離したときに1回だけ反映する(取り消しの単位を1回にするため)。
 */
export function PortraitFrameEditor({ canvas, manifest, transform, scale, label, onCommit, onContextMenu }: PortraitFrameEditorProps): React.JSX.Element {
  const [draft, setDraft] = useState<PortraitTransform | null>(null)
  const shown = draft ?? transform
  const placement = portraitPlacement(shown, manifest as PsdManifest)

  useEffect(() => setDraft(null), [transform])

  const begin = (event: React.PointerEvent, handle: Corner | 'move'): void => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const origin = { x: event.clientX, y: event.clientY }
    let latest = transform
    const onMove = (move: PointerEvent): void => {
      const dx = (move.clientX - origin.x) * scale
      const dy = (move.clientY - origin.y) * scale
      latest =
        handle === 'move'
          ? { ...transform, x: Math.round(transform.x + dx), y: Math.round(transform.y + dy) }
          : { ...transform, scale: scaleFromCorner(transform, manifest, handle, dx, dy) }
      setDraft(latest)
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      if (latest !== transform) onCommit(latest)
      else setDraft(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp, { once: true })
  }

  const percent = (value: number, total: number): string => `${(value / total) * 100}%`
  return (
    <div className="zoom-frame__layer" data-testid="portrait-frame-layer">
      <div
        className="zoom-frame portrait-frame"
        style={{
          left: percent(placement.x, canvas.width),
          top: percent(placement.y, canvas.height),
          width: percent(placement.width, canvas.width),
          height: percent(placement.height, canvas.height)
        }}
        onPointerDown={(event) => begin(event, 'move')}
        onContextMenu={onContextMenu}
        data-testid="portrait-frame"
        data-transform={`${Math.round(shown.x)},${Math.round(shown.y)},${shown.scale}`}
      >
        <span className="zoom-frame__label">
          {label} · {Math.round(shown.scale * 100)}%
        </span>
        {CORNERS.map((corner) => (
          <span
            key={corner}
            className={`zoom-frame__handle zoom-frame__handle--${corner}`}
            onPointerDown={(event) => begin(event, corner)}
            data-testid={`portrait-handle-${corner}`}
          />
        ))}
      </div>
    </div>
  )
}
