import { useEffect, useRef } from 'react'

import type { ItemSetTextLook } from '@shared/commands/types'
import type { Project, TextAlign, TextItem } from '@shared/project/types'
import { telopSize, telopStyle, TELOP_PRESETS } from '@shared/render/telop'

import { FONT_WEIGHTS, measureContext, useFontList } from '../../lib/fonts'
import { NumberField } from '../../ui/NumberField'
import type { Run } from './ItemInspectors'

type LookPatch = ItemSetTextLook['look']

const ALIGNS: [TextAlign, string][] = [
  ['left', '左揃え'],
  ['center', '中央揃え'],
  ['right', '右揃え']
]

/** 画面の端から空ける幅(配置のボタン)。 */
const EDGE_MARGIN = 60

const DEFAULT_OUTLINE = { color: '#000000', widthPx: 8 }
const DEFAULT_SHADOW = { color: '#00000080', offsetX: 4, offsetY: 4, blurPx: 4 }
const DEFAULT_BACKGROUND = { color: '#000000', opacity: 0.6, paddingPx: 16, radiusPx: 8 }

/**
 * テロップの設定。文字・スタイルのほか、このテロップだけの見た目(色・フォント・縁取り・影・帯・文字送り)と配置。
 * 複数のテロップを選んでいれば、見た目・配置は選んだテロップすべてに反映する(文字は表示中の1つだけ)。
 */
export function TextInspector({ project, item, targets, run }: { project: Project; item: TextItem; targets: TextItem[]; run: Run }): React.JSX.Element {
  const style = project.subtitleStyles[item.styleId]
  const { fonts, load } = useFontList()
  const ids = targets.map((target) => target.id)
  const many = targets.length > 1
  const setLook = (look: LookPatch, label: string, replace = false): void =>
    run([{ op: 'item.setTextLook', itemIds: ids, look, ...(replace ? { replace } : {}) }], label)
  if (!style) return <section><h3>テロップ</h3><p className="note">字幕スタイルが見つかりません。</p></section>
  const shown = telopStyle(style, item.look)
  const look = item.look ?? {}
  const outlineMode = look.outline === undefined ? 'style' : look.outline === 'none' ? 'none' : 'custom'
  const shadowMode = look.shadow === undefined ? 'style' : look.shadow === 'none' ? 'none' : 'custom'

  /** 画面の上・中・下、左・中・右へ置く(テロップの大きさに合わせて端から少し空ける)。 */
  const place = (axis: 'x' | 'y', where: 'start' | 'center' | 'end', label: string): void => {
    const commands = targets.flatMap((target) => {
      const targetStyle = project.subtitleStyles[target.styleId]
      if (!targetStyle) return []
      const size = telopSize(measureContext(), target, targetStyle)
      const half = ((axis === 'x' ? size.width : size.height) * target.transform.scale) / 2
      const total = axis === 'x' ? project.canvas.width : project.canvas.height
      const value = where === 'start' ? EDGE_MARGIN + half : where === 'end' ? total - EDGE_MARGIN - half : total / 2
      return [{ op: 'item.setTransform' as const, itemId: target.id, [axis]: Math.round(value) }]
    })
    if (commands.length > 0) run(commands, label)
  }

  return (
    <section data-testid="text-inspector">
      <h3>テロップ</h3>
      {many && (
        <p className="note" data-testid="text-targets">
          選んでいる{targets.length}個のテロップに、見た目と配置をまとめて反映します(文字はこのテロップだけ)。
        </p>
      )}
      <label className="field">
        <span className="field__label">文字</span>
        <textarea
          rows={2}
          key={item.text}
          defaultValue={item.text}
          onBlur={(event) => {
            const text = event.target.value
            if (text.trim() !== '' && text !== item.text) run([{ op: 'item.setContent', itemId: item.id, text }], 'テロップの変更')
          }}
          data-testid="inspector-text"
        />
      </label>
      <label className="field field--inline">
        <span className="field__label">スタイル</span>
        <select
          value={item.styleId}
          onChange={(event) => run(ids.map((itemId) => ({ op: 'item.setContent' as const, itemId, styleId: event.target.value })), 'スタイルの変更')}
        >
          {Object.values(project.subtitleStyles).map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.name}
            </option>
          ))}
        </select>
      </label>

      <div className="field">
        <span className="field__label">ひな形</span>
        <div className="telop-presets">
          {TELOP_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className="button--small"
              onClick={() => setLook(preset.look, `テロップの見た目: ${preset.name}`, !preset.merge)}
              data-testid={`telop-preset-${preset.id}`}
            >
              {preset.name}
            </button>
          ))}
        </div>
      </div>

      <h4 className="inspector__subhead">文字</h4>
      <div className="field__row field__row--wrap">
        <ColorField label="色" value={shown.color} onCommit={(color) => setLook({ color }, '文字の色')} testId="telop-color" />
        <NumberField
          label="大きさ(px)"
          value={shown.fontSizePx}
          min={8}
          max={400}
          step={4}
          onCommit={(fontSizePx) => setLook({ fontSizePx: Math.round(fontSizePx) }, '文字の大きさ')}
          testId="telop-size"
        />
        <label className="field field--inline">
          <span className="field__label">太さ</span>
          <select value={shown.fontWeight} onChange={(event) => setLook({ fontWeight: Number(event.target.value) }, '文字の太さ')} data-testid="telop-weight">
            {FONT_WEIGHTS.map(([weight, label]) => (
              <option key={weight} value={weight}>
                {label}
              </option>
            ))}
            {!FONT_WEIGHTS.some(([weight]) => weight === shown.fontWeight) && <option value={shown.fontWeight}>{shown.fontWeight}</option>}
          </select>
        </label>
        <label className="field field--inline">
          <span className="field__label">揃え</span>
          <select value={shown.align} onChange={(event) => setLook({ align: event.target.value as TextAlign }, '文字の揃え')} data-testid="telop-align">
            {ALIGNS.map(([align, label]) => (
              <option key={align} value={align}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <NumberField label="行間(倍)" value={shown.lineHeight} min={0.5} max={4} step={0.1} onCommit={(lineHeight) => setLook({ lineHeight }, '行間')} />
      </div>
      <label className="field">
        <span className="field__label">フォント</span>
        <input
          type="text"
          list="telop-fonts"
          key={shown.fontFamily}
          defaultValue={shown.fontFamily}
          onFocus={load}
          onBlur={(event) => {
            const family = event.target.value.trim()
            if (family !== '' && family !== shown.fontFamily) setLook({ fontFamily: family }, 'フォントの変更')
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
          }}
          data-testid="telop-font"
        />
        <datalist id="telop-fonts">
          {fonts.map((font) => (
            <option key={font} value={font} />
          ))}
        </datalist>
      </label>

      <h4 className="inspector__subhead">縁取り・影</h4>
      <div className="field__row field__row--wrap">
        <label className="field field--inline">
          <span className="field__label">縁取り</span>
          <select
            value={outlineMode}
            onChange={(event) => {
              const mode = event.target.value
              setLook({ outline: mode === 'style' ? null : mode === 'none' ? 'none' : (shown.outline ?? style.outline ?? DEFAULT_OUTLINE) }, '縁取り')
            }}
            data-testid="telop-outline"
          >
            <option value="style">スタイルのまま</option>
            <option value="custom">付ける</option>
            <option value="none">付けない</option>
          </select>
        </label>
        {shown.outline && (
          <>
            <ColorField
              label="縁の色"
              value={shown.outline.color}
              onCommit={(color) => setLook({ outline: { ...(shown.outline ?? DEFAULT_OUTLINE), color } }, '縁取りの色')}
              testId="telop-outline-color"
            />
            <NumberField
              label="縁の太さ(px)"
              value={shown.outline.widthPx}
              min={1}
              max={60}
              onCommit={(widthPx) => setLook({ outline: { ...(shown.outline ?? DEFAULT_OUTLINE), widthPx } }, '縁取りの太さ')}
              testId="telop-outline-width"
            />
          </>
        )}
      </div>
      <div className="field__row field__row--wrap">
        <label className="field field--inline">
          <span className="field__label">影</span>
          <select
            value={shadowMode}
            onChange={(event) => {
              const mode = event.target.value
              setLook({ shadow: mode === 'style' ? null : mode === 'none' ? 'none' : (shown.shadow ?? DEFAULT_SHADOW) }, '影')
            }}
            data-testid="telop-shadow"
          >
            <option value="style">スタイルのまま</option>
            <option value="custom">付ける</option>
            <option value="none">付けない</option>
          </select>
        </label>
        {shown.shadow && (
          <ColorField
            label="影の色"
            value={shown.shadow.color}
            onCommit={(color) => setLook({ shadow: { ...(shown.shadow ?? DEFAULT_SHADOW), color } }, '影の色')}
          />
        )}
      </div>

      <h4 className="inspector__subhead">背景の帯</h4>
      <label className="field__row">
        <input
          type="checkbox"
          checked={shown.background !== null}
          onChange={(event) => setLook({ background: event.target.checked ? DEFAULT_BACKGROUND : null }, event.target.checked ? '帯を敷く' : '帯を外す')}
          data-testid="telop-band"
        />
        文字の後ろに帯を敷く
      </label>
      {shown.background && (
        <div className="field__row field__row--wrap">
          <ColorField
            label="帯の色"
            value={shown.background.color}
            onCommit={(color) => setLook({ background: { ...(shown.background ?? DEFAULT_BACKGROUND), color } }, '帯の色')}
            testId="telop-band-color"
          />
          <NumberField
            label="濃さ(%)"
            value={shown.background.opacity}
            displayScale={100}
            min={0}
            max={100}
            step={10}
            onCommit={(opacity) => setLook({ background: { ...(shown.background ?? DEFAULT_BACKGROUND), opacity } }, '帯の濃さ')}
            testId="telop-band-opacity"
          />
          <NumberField
            label="余白(px)"
            value={shown.background.paddingPx}
            min={0}
            max={200}
            step={2}
            onCommit={(paddingPx) => setLook({ background: { ...(shown.background ?? DEFAULT_BACKGROUND), paddingPx } }, '帯の余白')}
          />
          <NumberField
            label="角の丸み(px)"
            value={shown.background.radiusPx}
            min={0}
            max={200}
            step={2}
            onCommit={(radiusPx) => setLook({ background: { ...(shown.background ?? DEFAULT_BACKGROUND), radiusPx } }, '帯の角の丸み')}
          />
        </div>
      )}

      <h4 className="inspector__subhead">出し方</h4>
      <NumberField
        label="文字送り(秒。0 なら一度に出す)"
        value={shown.typewriterMs}
        displayScale={0.001}
        min={0}
        max={60}
        step={0.5}
        onCommit={(typewriterMs) => setLook({ typewriterMs: Math.round(typewriterMs) }, '文字送り')}
        testId="telop-typewriter"
      />

      <h4 className="inspector__subhead">画面の上の配置</h4>
      <div className="telop-place">
        <span className="field__label">縦</span>
        <button type="button" className="button--small" onClick={() => place('y', 'start', '上に置く')} data-testid="telop-place-top">
          上
        </button>
        <button type="button" className="button--small" onClick={() => place('y', 'center', '縦の真ん中に置く')} data-testid="telop-place-middle">
          真ん中
        </button>
        <button type="button" className="button--small" onClick={() => place('y', 'end', '下に置く')} data-testid="telop-place-bottom">
          下
        </button>
        <span className="field__label">横</span>
        <button type="button" className="button--small" onClick={() => place('x', 'start', '左に置く')} data-testid="telop-place-left">
          左
        </button>
        <button type="button" className="button--small" onClick={() => place('x', 'center', '横の真ん中に置く')} data-testid="telop-place-center">
          真ん中
        </button>
        <button type="button" className="button--small" onClick={() => place('x', 'end', '右に置く')} data-testid="telop-place-right">
          右
        </button>
      </div>
      <p className="note">プレビューでテロップをクリックすると枠が出て、ドラッグで動かし、四隅で大きさを変えられます。</p>

      <button
        type="button"
        className="button--small"
        disabled={targets.every((target) => target.look === undefined)}
        onClick={() => setLook({}, 'テロップの見た目をスタイルに戻す', true)}
        data-testid="telop-reset-look"
      >
        見た目をスタイルに戻す
      </button>
    </section>
  )
}

/**
 * 色を選ぶ欄。選び終えたとき(色の窓を閉じたとき)に1回だけ反映する。
 * 窓の中で動かすたびに反映すると、取り消しの履歴が細切れになるため。
 */
function ColorField({ label, value, onCommit, testId }: { label: string; value: string; onCommit: (color: string) => void; testId?: string }): React.JSX.Element {
  const ref = useRef<HTMLInputElement>(null)
  const commit = useRef(onCommit)
  commit.current = onCommit
  const hex = value.slice(0, 7)
  // 透けている色(#rrggbbaa)は、透け具合を保ったまま色だけ変える。
  const alpha = value.length === 9 ? value.slice(7) : ''
  useEffect(() => {
    const input = ref.current
    if (!input) return
    const onChange = (): void => {
      if (input.value.toLowerCase() !== hex.toLowerCase()) commit.current(input.value + alpha)
    }
    input.addEventListener('change', onChange)
    return () => input.removeEventListener('change', onChange)
  }, [hex, alpha])
  return (
    <label className="field field--inline">
      <span className="field__label">{label}</span>
      <input ref={ref} type="color" key={hex} defaultValue={hex} data-testid={testId} />
    </label>
  )
}
