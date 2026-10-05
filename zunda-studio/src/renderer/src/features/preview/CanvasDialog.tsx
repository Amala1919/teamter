import { useState } from 'react'

import { CANVAS_PRESETS } from '@shared/project/canvas'

import { useEditorStore } from '../../state/store'
import { Modal } from '../../ui/Modal'

/** 動画の大きさ・フレームレート・背景の色を変える。 */
export function CanvasDialog({ onClose, onError }: { onClose: () => void; onError: (message: string) => void }): React.JSX.Element {
  const canvas = useEditorStore((state) => state.project.canvas)
  const dispatch = useEditorStore((state) => state.dispatch)
  const [width, setWidth] = useState(canvas.width)
  const [height, setHeight] = useState(canvas.height)
  const [fps, setFps] = useState(canvas.fps)
  const [background, setBackground] = useState(canvas.backgroundColor.slice(0, 7))
  const [rescale, setRescale] = useState(true)
  const preset = CANVAS_PRESETS.find((candidate) => candidate.width === width && candidate.height === height)

  const apply = (): void => {
    const result = dispatch([{ op: 'project.setCanvas', width, height, fps, backgroundColor: background, rescale }], '動画の大きさの変更')
    if (!result.ok) {
      onError(result.message)
      return
    }
    onClose()
  }

  return (
    <Modal
      title="動画の設定"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose}>
            やめる
          </button>
          <button type="button" onClick={apply} data-testid="canvas-apply">
            変える
          </button>
        </>
      }
    >
      <label className="field">
        <span className="field__label">大きさ</span>
        <select
          value={preset?.id ?? 'custom'}
          onChange={(event) => {
            const chosen = CANVAS_PRESETS.find((candidate) => candidate.id === event.target.value)
            if (chosen) {
              setWidth(chosen.width)
              setHeight(chosen.height)
            }
          }}
          data-testid="canvas-preset"
        >
          {CANVAS_PRESETS.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.label}
            </option>
          ))}
          <option value="custom">そのほか(下で決める)</option>
        </select>
      </label>
      <div className="field__row field__row--wrap">
        <label className="field field--inline">
          <span className="field__label">幅</span>
          <input type="number" min={64} max={7680} step={2} value={width} onChange={(event) => setWidth(Math.round(Number(event.target.value) / 2) * 2)} data-testid="canvas-width" />
        </label>
        <label className="field field--inline">
          <span className="field__label">高さ</span>
          <input type="number" min={64} max={7680} step={2} value={height} onChange={(event) => setHeight(Math.round(Number(event.target.value) / 2) * 2)} data-testid="canvas-height" />
        </label>
        <label className="field field--inline">
          <span className="field__label">フレームレート</span>
          <select value={fps} onChange={(event) => setFps(Number(event.target.value))} data-testid="canvas-fps">
            {[...new Set([24, 30, 60, canvas.fps])]
              .sort((a, b) => a - b)
              .map((value) => (
                <option key={value} value={value}>
                  {value}fps
                </option>
              ))}
          </select>
        </label>
        <label className="field field--inline">
          <span className="field__label">背景の色</span>
          <input type="color" value={background} onChange={(event) => setBackground(event.target.value)} />
        </label>
      </div>
      <label className="field__row">
        <input type="checkbox" checked={rescale} onChange={(event) => setRescale(event.target.checked)} data-testid="canvas-rescale" />
        置いた素材・立ち絵・字幕の位置と大きさを、新しい大きさに合わせる
      </label>
      <p className="note">
        縦型のショートを、このプロジェクトの一部から別に作るときは、ツールバーの「ショートを作る」が便利です(ゲームの録画を縦の画面に合わせ、字幕も読みやすく置き直します)。
      </p>
    </Modal>
  )
}
