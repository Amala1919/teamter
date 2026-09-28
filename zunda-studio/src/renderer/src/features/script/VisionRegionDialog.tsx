import { useEffect, useRef, useState } from 'react'

import { clampRegion, describeRegion, type VisionRegion } from '@shared/ai/cohost'

import { api, toAppError } from '../../api'
import { formatMs } from '../../lib/time'
import { useEditorStore } from '../../state/store'
import { Modal } from '../../ui/Modal'

interface VisionRegionDialogProps {
  /** 範囲を選ぶときに見せる時刻(見せる画面の最初の時刻)。 */
  atMs: number
  initial: VisionRegion | undefined
  onPick: (region: VisionRegion) => void
  onClose: () => void
}

/**
 * 相方に見せる範囲を、実際の録画のコマの上でドラッグして選ぶ。
 * 範囲は録画に対する割合で持つので、プレビューでの録画の置き方(拡大・移動)に左右されない。
 */
export function VisionRegionDialog({ atMs, initial, onPick, onClose }: VisionRegionDialogProps): React.JSX.Element {
  const project = useEditorStore((state) => state.project)
  const [image, setImage] = useState<string | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [region, setRegion] = useState<VisionRegion | undefined>(initial)
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null)
  const frameRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    api
      .invoke('ai:visionFrame', project, atMs)
      .then((result) => !cancelled && setImage(result))
      .catch((caught: unknown) => !cancelled && setError(toAppError(caught).message))
    return () => {
      cancelled = true
    }
    // 開いたときの時刻のコマだけを見せる
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toRatio = (event: React.PointerEvent): { x: number; y: number } => {
    const rect = frameRef.current!.getBoundingClientRect()
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / Math.max(1, rect.width))),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / Math.max(1, rect.height)))
    }
  }

  const fromPoints = (a: { x: number; y: number }, b: { x: number; y: number }): VisionRegion => ({
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y)
  })

  const shown = region ? clampRegion(region) : undefined

  return (
    <Modal
      title={`見せる範囲を選ぶ(${formatMs(atMs)} の画面)`}
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" onClick={onClose}>
            やめる
          </button>
          <button
            type="button"
            className="button--primary"
            disabled={!shown}
            onClick={() => {
              if (shown) onPick(shown)
              onClose()
            }}
            data-testid="region-apply"
          >
            この範囲を見せる
          </button>
        </>
      }
    >
      <p className="note">
        録画の上をドラッグして、相方に見せたい範囲を囲んでください。細かい文字や数字(資源・兵力・地図の名前など)を読ませたいときに、その部分だけを大きく見せます。
      </p>
      {error && <p className="status status--error">{error}</p>}
      {image === undefined && !error && <p className="pane__empty">録画のコマを読み込み中…</p>}
      {image === null && <p className="status status--warn">この時刻には録画が映っていません。再生位置を録画の上に動かしてください。</p>}
      {image && (
        <div
          ref={frameRef}
          className="region-picker"
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId)
            const point = toRatio(event)
            setDrag(point)
            setRegion({ ...point, width: 0, height: 0 })
          }}
          onPointerMove={(event) => {
            if (drag) setRegion(fromPoints(drag, toRatio(event)))
          }}
          onPointerUp={(event) => {
            if (!drag) return
            const next = fromPoints(drag, toRatio(event))
            setDrag(null)
            // クリックだけ(ほとんど動かしていない)なら選び直し
            setRegion(next.width < 0.01 || next.height < 0.01 ? undefined : next)
          }}
          data-testid="region-picker"
        >
          <img src={image} alt="録画のコマ" draggable={false} />
          {shown && (
            <div
              className="region-picker__box"
              style={{ left: `${shown.x * 100}%`, top: `${shown.y * 100}%`, width: `${shown.width * 100}%`, height: `${shown.height * 100}%` }}
              data-testid="region-box"
            />
          )}
        </div>
      )}
      <p className="note" data-testid="region-summary">
        {shown ? `選んだ範囲: ${describeRegion(shown)}` : 'まだ範囲を選んでいません'}
      </p>
    </Modal>
  )
}
