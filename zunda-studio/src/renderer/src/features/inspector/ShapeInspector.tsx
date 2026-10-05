import type { Command } from '@shared/commands/types'
import { SHAPE_KINDS, type Project, type ShapeItem, type ShapeKind } from '@shared/project/types'
import { SHAPE_PRESETS } from '@shared/render/shape-presets'
import { isLineKind, SHAPE_DEFAULTS, shapeSize } from '@shared/render/shapes'

import { scaledPresetProps } from '../../state/decorations'
import { NumberField } from '../../ui/NumberField'
import type { Run } from './ItemInspectors'

type PropsPatch = NonNullable<Extract<Command, { op: 'item.setShape' }>['props']>

/** 形ごとに、出す調整の項目。 */
const CORNER_KINDS: ShapeKind[] = ['roundRect', 'bubble']
const POINT_KINDS: ShapeKind[] = ['star', 'burst', 'shout', 'cloud']
const TAIL_KINDS: ShapeKind[] = ['bubble', 'shout', 'cloud']
const HEAD_KINDS: ShapeKind[] = ['arrow', 'curveArrow']
const AMOUNT_KINDS: ShapeKind[] = ['focusLines', 'speedLines', 'confetti', 'sparkles']
const SPECIAL_KINDS: ShapeKind[] = ['focusLines', 'speedLines', 'spotlight', 'confetti', 'sparkles']

/** 影の種類(影・光る)。光るは、ずらさずに明るい色で大きくぼかした影。 */
function shadowKind(item: ShapeItem): 'none' | 'drop' | 'glow' {
  if (!item.shadow) return 'none'
  return item.shadow.offsetX === 0 && item.shadow.offsetY === 0 ? 'glow' : 'drop'
}

/** #rrggbb(aa) から色の入力欄に出せる #rrggbb を取り出す。 */
function solid(color: string | undefined, fallback: string): string {
  return color && /^#[0-9a-fA-F]{6}/.test(color) ? color.slice(0, 7) : fallback
}

/**
 * 図形・装飾の見た目。選んだ図形がいくつかあれば、まとめて変える。
 * 大きさ・向きはプレビューの枠でも変えられる。
 */
export function ShapeInspector({ project, item, targets, run }: { project: Project; item: ShapeItem; targets: ShapeItem[]; run: Run }): React.JSX.Element {
  const ids = targets.length > 0 ? targets.map((target) => target.id) : [item.id]
  const setProps = (props: PropsPatch, label: string): void => run([{ op: 'item.setShape', itemIds: ids, props }], label)
  const kind = item.shape
  const line = isLineKind(kind)
  const special = SPECIAL_KINDS.includes(kind)
  const size = shapeSize(item, project.canvas)
  const filled = (item.fillOpacity ?? 1) > 0

  return (
    <section data-testid="shape-inspector">
      <h3>図形・装飾{ids.length > 1 ? `(${ids.length}個をまとめて)` : ''}</h3>
      <div className="field__row field__row--wrap">
        <label className="field field--inline">
          <span className="field__label">形</span>
          <select
            value={kind}
            onChange={(event) => run([{ op: 'item.setShape', itemIds: ids, shape: event.target.value as ShapeKind }], '形の変更')}
            data-testid="shape-kind"
          >
            {SHAPE_KINDS.map((value) => (
              <option key={value} value={value}>
                {SHAPE_DEFAULTS[value].label}
              </option>
            ))}
          </select>
        </label>
        <label className="field field--inline">
          <span className="field__label">ひな形の見た目</span>
          <select
            value=""
            onChange={(event) => {
              const preset = SHAPE_PRESETS.find((candidate) => candidate.id === event.target.value)
              if (!preset) return
              // 大きさは今のまま、形・色・縁取り・影・描き方を、ひな形のものにする。
              const { width: _width, height: _height, ...look } = scaledPresetProps(preset, project)
              run([{ op: 'item.setShape', itemIds: ids, shape: preset.shape, fill: preset.fill, props: look, replace: true }], `ひな形「${preset.name}」の見た目にする`)
            }}
            data-testid="shape-preset"
          >
            <option value="">選ぶと見た目が変わる…</option>
            {SHAPE_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="field__row field__row--wrap">
        <label className="field field--inline">
          <span className="field__label">{line ? '線の色' : kind === 'spotlight' ? '暗くする色' : '色'}</span>
          <input
            type="color"
            value={solid(item.fill, '#ffffff')}
            onChange={(event) => run([{ op: 'item.setShape', itemIds: ids, fill: event.target.value }], '色の変更')}
            data-testid="shape-fill"
          />
        </label>
        <NumberField
          label={line ? '濃さ(%)' : kind === 'spotlight' ? '暗さ(%)' : '塗りの濃さ(%)'}
          value={item.fillOpacity ?? (kind === 'spotlight' ? 0.7 : 1)}
          displayScale={100}
          min={0}
          max={100}
          step={10}
          onCommit={(fillOpacity) => setProps({ fillOpacity }, '濃さの変更')}
          testId="shape-fill-opacity"
        />
        {!special && (
          <label className="field__row">
            <input
              type="checkbox"
              checked={item.gradient != null}
              onChange={(event) => setProps({ gradient: event.target.checked ? { color: '#000000', angle: 90, radial: false } : null }, 'グラデーションの切り替え')}
              data-testid="shape-gradient"
            />
            グラデーション
          </label>
        )}
      </div>
      {item.gradient && !special && (
        <div className="field__row field__row--wrap">
          <label className="field field--inline">
            <span className="field__label">終わりの色</span>
            <input type="color" value={solid(item.gradient.color, '#000000')} onChange={(event) => setProps({ gradient: { ...item.gradient!, color: event.target.value } }, 'グラデーションの変更')} />
          </label>
          <NumberField label="向き(度)" value={item.gradient.angle} step={15} min={-360} max={360} onCommit={(angle) => setProps({ gradient: { ...item.gradient!, angle } }, 'グラデーションの変更')} />
          <label className="field__row">
            <input type="checkbox" checked={item.gradient.radial} onChange={(event) => setProps({ gradient: { ...item.gradient!, radial: event.target.checked } }, 'グラデーションの変更')} />
            中心から(円形)
          </label>
        </div>
      )}

      <div className="field__row field__row--wrap">
        <NumberField label="幅(px)" value={size.width} min={1} onCommit={(width) => setProps({ width }, '大きさの変更')} testId="shape-width" />
        <NumberField label="高さ(px)" value={size.height} min={1} onCommit={(height) => setProps({ height }, '大きさの変更')} testId="shape-height" />
        {(line || kind === 'curveArrow') && (
          <NumberField
            label="線の太さ(px)"
            value={item.thickness ?? Math.round(Math.min(size.width, size.height) * 0.07)}
            min={0.5}
            onCommit={(thickness) => setProps({ thickness }, '線の太さの変更')}
            testId="shape-thickness"
          />
        )}
        {(line || !filled) && !special && (
          <label className="field field--inline">
            <span className="field__label">線の種類</span>
            <select value={item.dash ?? 'solid'} onChange={(event) => setProps({ dash: event.target.value === 'solid' ? null : (event.target.value as 'dash' | 'dot') }, '線の種類の変更')}>
              <option value="solid">実線</option>
              <option value="dash">破線</option>
              <option value="dot">点線</option>
            </select>
          </label>
        )}
      </div>

      {!special && (
        <>
          <StrokeRow label="縁取り" stroke={item.stroke ?? null} fallback={{ color: '#ffffff', widthPx: 6 }} onChange={(stroke) => setProps({ stroke }, '縁取りの変更')} testId="shape-stroke" />
          <StrokeRow label="外側の縁" stroke={item.outerStroke ?? null} fallback={{ color: '#1b1b1b', widthPx: 4 }} onChange={(outerStroke) => setProps({ outerStroke }, '外側の縁の変更')} testId="shape-outer-stroke" />
        </>
      )}
      <div className="field__row field__row--wrap">
        <label className="field field--inline">
          <span className="field__label">影</span>
          <select
            value={shadowKind(item)}
            onChange={(event) => {
              const value = event.target.value
              const shadow =
                value === 'none'
                  ? null
                  : value === 'glow'
                    ? { color: solid(item.fill, '#ffd60a'), offsetX: 0, offsetY: 0, blurPx: 28 }
                    : { color: '#00000088', offsetX: 6, offsetY: 8, blurPx: 10 }
              setProps({ shadow }, '影の変更')
            }}
            data-testid="shape-shadow"
          >
            <option value="none">なし</option>
            <option value="drop">影を落とす</option>
            <option value="glow">光らせる</option>
          </select>
        </label>
        {item.shadow && (
          <>
            <label className="field field--inline">
              <span className="field__label">影の色</span>
              <input type="color" value={solid(item.shadow.color, '#000000')} onChange={(event) => setProps({ shadow: { ...item.shadow!, color: event.target.value } }, '影の色の変更')} />
            </label>
            <NumberField label="ぼかし(px)" value={item.shadow.blurPx} min={0} max={200} onCommit={(blurPx) => setProps({ shadow: { ...item.shadow!, blurPx } }, '影の変更')} />
          </>
        )}
      </div>

      <ShapeSpecificFields item={item} size={size} setProps={setProps} />

      {!special && (
        <>
          <h3>描き方</h3>
          <div className="field__row field__row--wrap">
            <NumberField
              label="描いていく時間(秒)"
              value={item.drawMs ?? 0}
              displayScale={0.001}
              step={0.1}
              min={0}
              onCommit={(drawMs) => setProps({ drawMs: drawMs > 0 ? drawMs : null }, '描いていく時間の変更')}
              testId="shape-draw"
            />
            <NumberField
              label="手書き風のゆらぎ(%)"
              value={item.roughness ?? (kind === 'handCircle' ? 0.35 : 0)}
              displayScale={100}
              min={0}
              max={100}
              step={10}
              onCommit={(roughness) => setProps({ roughness }, '手書き風のゆらぎの変更')}
              testId="shape-roughness"
            />
            <label className="field__row">
              <input type="checkbox" checked={item.wiggle === true} onChange={(event) => setProps({ wiggle: event.target.checked ? true : null }, 'ゆらゆら動かすかの切り替え')} />
              線をゆらゆら動かす
            </label>
          </div>
          <p className="note">「描いていく時間」を入れると、置いた時刻から線を描くように現れます(矢印・帯・線は左から伸びます)。</p>
        </>
      )}
    </section>
  )
}

function StrokeRow({
  label,
  stroke,
  fallback,
  onChange,
  testId
}: {
  label: string
  stroke: { color: string; widthPx: number } | null
  fallback: { color: string; widthPx: number }
  onChange: (stroke: { color: string; widthPx: number } | null) => void
  testId: string
}): React.JSX.Element {
  return (
    <div className="field__row field__row--wrap">
      <label className="field__row">
        <input type="checkbox" checked={stroke !== null} onChange={(event) => onChange(event.target.checked ? fallback : null)} data-testid={testId} />
        {label}
      </label>
      {stroke && (
        <>
          <input type="color" value={solid(stroke.color, fallback.color)} onChange={(event) => onChange({ ...stroke, color: event.target.value })} aria-label={`${label}の色`} />
          <NumberField label="太さ(px)" value={stroke.widthPx} min={0} max={200} onCommit={(widthPx) => onChange({ ...stroke, widthPx })} />
        </>
      )}
    </div>
  )
}

function ShapeSpecificFields({
  item,
  size,
  setProps
}: {
  item: ShapeItem
  size: { width: number; height: number }
  setProps: (props: PropsPatch, label: string) => void
}): React.JSX.Element | null {
  const kind = item.shape
  const fields: React.JSX.Element[] = []
  if (CORNER_KINDS.includes(kind)) {
    fields.push(
      <NumberField
        key="corner"
        label="角の丸み(px)"
        value={item.cornerRadius ?? Math.round(Math.min(size.width, size.height) * (kind === 'bubble' ? 0.45 : 0.18))}
        min={0}
        onCommit={(cornerRadius) => setProps({ cornerRadius }, '角の丸みの変更')}
      />
    )
  }
  if (POINT_KINDS.includes(kind)) {
    const defaults: Partial<Record<ShapeKind, [number, number]>> = { star: [5, 0.45], burst: [14, 0.7], shout: [18, 0.82], cloud: [9, 0] }
    const [points, inner] = defaults[kind] ?? [5, 0.45]
    fields.push(
      <NumberField key="points" label={kind === 'cloud' ? 'もこもこの数' : '角の数'} value={item.points ?? points} min={3} max={60} onCommit={(value) => setProps({ points: Math.round(value) }, '角の数の変更')} />
    )
    if (kind !== 'cloud') {
      fields.push(
        <NumberField
          key="inner"
          label="くぼみ(%)"
          value={item.innerRatio ?? inner}
          displayScale={100}
          min={5}
          max={98}
          step={5}
          onCommit={(innerRatio) => setProps({ innerRatio }, 'くぼみの変更')}
        />
      )
    }
  }
  if (HEAD_KINDS.includes(kind)) {
    fields.push(
      <NumberField key="head" label="頭の大きさ(%)" value={item.headSize ?? 1} displayScale={100} min={20} max={400} step={10} onCommit={(headSize) => setProps({ headSize }, '矢印の頭の変更')} />
    )
  }
  if (kind === 'curveArrow') {
    fields.push(
      <NumberField key="bend" label="曲がり(%)" value={item.bend ?? 0.45} displayScale={100} min={-100} max={100} step={10} onCommit={(bend) => setProps({ bend }, '曲がり具合の変更')} />
    )
  }
  if (TAIL_KINDS.includes(kind)) {
    const tail = item.tail ?? { x: -size.width * 0.22, y: size.height * 0.85 }
    fields.push(
      <NumberField key="tailX" label="しっぽの先X" value={Math.round(tail.x)} onCommit={(x) => setProps({ tail: { ...tail, x } }, 'しっぽの変更')} testId="shape-tail-x" />,
      <NumberField key="tailY" label="しっぽの先Y" value={Math.round(tail.y)} onCommit={(y) => setProps({ tail: { ...tail, y } }, 'しっぽの変更')} />
    )
  }
  if (AMOUNT_KINDS.includes(kind)) {
    fields.push(
      <NumberField key="density" label="量(%)" value={item.density ?? 1} displayScale={100} min={20} max={300} step={10} onCommit={(density) => setProps({ density }, '量の変更')} />,
      <NumberField key="speed" label="速さ(%)" value={item.speed ?? 1} displayScale={100} min={0} max={1000} step={10} onCommit={(speed) => setProps({ speed }, '速さの変更')} />
    )
  }
  if (kind === 'spotlight') {
    fields.push(
      <NumberField
        key="feather"
        label="縁のぼかし(%)"
        value={item.innerRatio ?? 0.25}
        displayScale={100}
        min={5}
        max={90}
        step={5}
        onCommit={(innerRatio) => setProps({ innerRatio }, '縁のぼかしの変更')}
      />
    )
  }
  if (fields.length === 0) return null
  return <div className="field__row field__row--wrap">{fields}</div>
}

