import type { ColorAdjust, Crop, ImageItem, MediaFrame, VideoItem } from '@shared/project/types'

import { usePreviewTools } from '../../state/preview-tools'
import { NumberField } from '../../ui/NumberField'
import type { Run } from './ItemInspectors'

const NEUTRAL: ColorAdjust = { brightness: 1, contrast: 1, saturation: 1, hue: 0, sepia: 0, blurPx: 0 }

/** よく使う色の調整。押すと今の調整をこれにする。 */
export const ADJUST_PRESETS: { id: string; name: string; adjust: ColorAdjust }[] = [
  { id: 'none', name: '元のまま', adjust: NEUTRAL },
  { id: 'vivid', name: '鮮やかに', adjust: { ...NEUTRAL, saturation: 1.35, contrast: 1.1 } },
  { id: 'bright', name: '明るく', adjust: { ...NEUTRAL, brightness: 1.25, contrast: 1.05 } },
  { id: 'dark', name: '暗く(後ろに引く)', adjust: { ...NEUTRAL, brightness: 0.55 } },
  { id: 'mono', name: '白黒', adjust: { ...NEUTRAL, saturation: 0, contrast: 1.1 } },
  { id: 'sepia', name: 'セピア(回想)', adjust: { ...NEUTRAL, sepia: 0.85, contrast: 0.95, brightness: 1.05 } },
  { id: 'blur', name: 'ぼかす(背景に)', adjust: { ...NEUTRAL, blurPx: 18, brightness: 0.8 } },
  { id: 'cool', name: '青っぽく', adjust: { ...NEUTRAL, hue: 200, saturation: 0.7, sepia: 0.3 } }
]

/** 枠(ワイプ・小窓)のひな形。 */
export const FRAME_PRESETS: { id: string; name: string; frame: MediaFrame | null }[] = [
  { id: 'none', name: '枠なし', frame: null },
  { id: 'white', name: '白い縁・角丸', frame: { shape: 'rounded', radiusPx: 24, border: { color: '#ffffff', widthPx: 8 }, shadow: { color: '#00000099', offsetX: 6, offsetY: 8, blurPx: 16 } } },
  { id: 'circle', name: '丸く切り抜く', frame: { shape: 'circle', radiusPx: 0, border: { color: '#ffffff', widthPx: 8 }, shadow: { color: '#00000099', offsetX: 0, offsetY: 6, blurPx: 16 } } },
  { id: 'neon', name: '光る縁', frame: { shape: 'rounded', radiusPx: 18, border: { color: '#00e5ff', widthPx: 6 }, shadow: { color: '#00e5ff', offsetX: 0, offsetY: 0, blurPx: 30 } } },
  { id: 'plain', name: '細い黒縁', frame: { shape: 'rect', radiusPx: 0, border: { color: '#111111', widthPx: 4 }, shadow: null } }
]

function solid(color: string, fallback: string): string {
  return /^#[0-9a-fA-F]{6}/.test(color) ? color.slice(0, 7) : fallback
}

/** 動画・画像の切り抜き・枠・色の調整。 */
export function MediaLookInspector({ item, targets, run }: { item: VideoItem | ImageItem; targets: (VideoItem | ImageItem)[]; run: Run }): React.JSX.Element {
  const ids = targets.length > 0 ? targets.map((target) => target.id) : [item.id]
  const cropItemId = usePreviewTools((state) => state.cropItemId)
  const setCropItem = usePreviewTools((state) => state.setCropItem)
  const crop: Crop = item.crop ?? { left: 0, top: 0, right: 0, bottom: 0 }
  const adjust = item.adjust ?? NEUTRAL
  const frame = item.frame ?? null
  const setCrop = (patch: Partial<Crop>): void => run([{ op: 'item.setMediaLook', itemIds: ids, crop: { ...crop, ...patch } }], '切り抜きの変更')
  const setAdjust = (patch: Partial<ColorAdjust>): void => run([{ op: 'item.setMediaLook', itemIds: ids, adjust: { ...adjust, ...patch } }], '色の調整')
  const setFrame = (next: MediaFrame | null): void => run([{ op: 'item.setMediaLook', itemIds: ids, frame: next }], '枠の変更')
  const editing = cropItemId === item.id

  return (
    <>
      <section data-testid="crop-inspector">
        <h3>切り抜き</h3>
        <div className="field__row field__row--wrap">
          <button type="button" className={editing ? 'button--small button--active' : 'button--small'} onClick={() => setCropItem(editing ? null : item.id)} data-testid="crop-edit">
            {editing ? '切り抜きの編集を終える' : 'プレビューで切り抜く'}
          </button>
          {item.crop && (
            <button type="button" className="button--small" onClick={() => run([{ op: 'item.setMediaLook', itemIds: ids, crop: null }], '切り抜きをやめる')} data-testid="crop-reset">
              切り抜きをやめる
            </button>
          )}
        </div>
        <div className="field__row field__row--wrap">
          {(
            [
              ['left', '左'],
              ['right', '右'],
              ['top', '上'],
              ['bottom', '下']
            ] as const
          ).map(([side, label]) => (
            <NumberField
              key={side}
              label={`${label}(%)`}
              value={crop[side]}
              displayScale={100}
              min={0}
              max={95}
              step={5}
              onCommit={(value) => setCrop({ [side]: value })}
              testId={`crop-${side}`}
            />
          ))}
        </div>
        <p className="note">「プレビューで切り抜く」で、残す範囲の辺をドラッグできます。残った部分は画面の同じ場所に残ります。</p>
      </section>

      <section data-testid="frame-inspector">
        <h3>枠(ワイプ・小窓の見た目)</h3>
        <div className="chip-row">
          {FRAME_PRESETS.map((preset) => (
            <button key={preset.id} type="button" className="button--small" onClick={() => setFrame(preset.frame)} data-testid={`frame-preset-${preset.id}`}>
              {preset.name}
            </button>
          ))}
        </div>
        {frame && (
          <div className="field__row field__row--wrap">
            <label className="field field--inline">
              <span className="field__label">形</span>
              <select value={frame.shape} onChange={(event) => setFrame({ ...frame, shape: event.target.value as MediaFrame['shape'] })}>
                <option value="rect">四角</option>
                <option value="rounded">角丸</option>
                <option value="circle">丸</option>
              </select>
            </label>
            {frame.shape === 'rounded' && <NumberField label="角の丸み(px)" value={frame.radiusPx} min={0} onCommit={(radiusPx) => setFrame({ ...frame, radiusPx })} />}
            <label className="field__row">
              <input type="checkbox" checked={frame.border !== null} onChange={(event) => setFrame({ ...frame, border: event.target.checked ? { color: '#ffffff', widthPx: 6 } : null })} />
              縁
            </label>
            {frame.border && (
              <>
                <input type="color" value={solid(frame.border.color, '#ffffff')} onChange={(event) => setFrame({ ...frame, border: { ...frame.border!, color: event.target.value } })} aria-label="縁の色" />
                <NumberField label="縁の太さ(px)" value={frame.border.widthPx} min={0} max={200} onCommit={(widthPx) => setFrame({ ...frame, border: { ...frame.border!, widthPx } })} />
              </>
            )}
            <label className="field__row">
              <input
                type="checkbox"
                checked={frame.shadow !== null}
                onChange={(event) => setFrame({ ...frame, shadow: event.target.checked ? { color: '#00000099', offsetX: 6, offsetY: 8, blurPx: 16 } : null })}
              />
              影
            </label>
          </div>
        )}
      </section>

      <section data-testid="adjust-inspector">
        <h3>色の調整</h3>
        <div className="chip-row">
          {ADJUST_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className="button--small"
              onClick={() => run([{ op: 'item.setMediaLook', itemIds: ids, adjust: preset.id === 'none' ? null : preset.adjust }], `色の調整「${preset.name}」`)}
              data-testid={`adjust-preset-${preset.id}`}
            >
              {preset.name}
            </button>
          ))}
        </div>
        <div className="field__row field__row--wrap">
          <NumberField label="明るさ(%)" value={adjust.brightness} displayScale={100} min={0} max={300} step={5} onCommit={(brightness) => setAdjust({ brightness })} testId="adjust-brightness" />
          <NumberField label="コントラスト(%)" value={adjust.contrast} displayScale={100} min={0} max={300} step={5} onCommit={(contrast) => setAdjust({ contrast })} />
          <NumberField label="鮮やかさ(%)" value={adjust.saturation} displayScale={100} min={0} max={300} step={5} onCommit={(saturation) => setAdjust({ saturation })} testId="adjust-saturation" />
          <NumberField label="色合い(度)" value={adjust.hue} min={-360} max={360} step={15} onCommit={(hue) => setAdjust({ hue })} />
          <NumberField label="セピア(%)" value={adjust.sepia} displayScale={100} min={0} max={100} step={10} onCommit={(sepia) => setAdjust({ sepia })} />
          <NumberField label="ぼかし(px)" value={adjust.blurPx} min={0} max={100} onCommit={(blurPx) => setAdjust({ blurPx })} />
        </div>
      </section>
    </>
  )
}
