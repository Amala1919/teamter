import { useEffect, useRef, useState } from 'react'

import type { Command } from '@shared/commands/types'
import { lookForCharacter, subtitleLook, subtitlePresets } from '@shared/project/subtitle-look'
import type { PortraitAnchor, SubtitleStyle } from '@shared/project/types'
import { drawSubtitleLines } from '@shared/render/compositor'
import type { Ctx2D } from '@shared/render/types'

import { useEditorStore } from '../../state/store'
import { useSettingsStore } from '../../state/settings'

type Run = (commands: Command[], label: string) => unknown

/** よく使われる日本語フォント。入っていないフォントは、見本で代わりのフォントになる。 */
const COMMON_FONTS = [
  'Noto Sans JP',
  'M PLUS Rounded 1c',
  'BIZ UDPゴシック',
  'UD デジタル 教科書体 N-B',
  'Yu Gothic UI',
  '游ゴシック',
  'メイリオ',
  'MS Pゴシック',
  'Hiragino Sans',
  'けいふぉんと',
  'コーポレート・ロゴ',
  'やさしさゴシック',
  '源ノ角ゴシック'
]

const WEIGHTS: [number, string][] = [
  [400, '標準'],
  [700, '太字'],
  [900, '極太']
]

/** 文字の揃え方。字幕は、指定した点を最後の行の下端として上へ積むので、縦の意味は持たない。 */
const ALIGNS: [PortraitAnchor, string][] = [
  ['bottom-center', '中央揃え'],
  ['bottom-left', '左揃え(点が左端)'],
  ['bottom-right', '右揃え(点が右端)']
]

function alignOf(anchor: PortraitAnchor): PortraitAnchor {
  return anchor.endsWith('left') ? 'bottom-left' : anchor.endsWith('right') ? 'bottom-right' : 'bottom-center'
}

const DEFAULT_SHADOW = { color: '#00000080', offsetX: 4, offsetY: 4, blurPx: 4 }

interface SubtitleStyleEditorProps {
  style: SubtitleStyle
  /** 見本に出す文(このキャラクターのセリフなど)。 */
  sampleLines: string[]
  run: Run
}

/**
 * セリフの字幕(ボイステロップ)の見た目を決める。フォント・大きさ・色・縁取り・影・位置・行の文字数。
 * 見本は動画と同じ描き方で描き、見本の上をドラッグして位置を決められる。
 * 決めた見た目はアプリの既定にでき、新しいキャラクターとプロジェクトに使われる。
 */
export function SubtitleStyleEditor({ style, sampleLines, run }: SubtitleStyleEditorProps): React.JSX.Element {
  const canvasSize = useEditorStore((state) => state.project.canvas)
  const allStyles = useEditorStore((state) => state.project.subtitleStyles)
  const otherStyles = Object.values(allStyles).filter((other) => other.id !== style.id)
  const subtitleSettings = useSettingsStore((state) => state.settings?.subtitle)
  const updateSettings = useSettingsStore((state) => state.update)
  const [fonts, setFonts] = useState<string[]>(COMMON_FONTS)
  const [notice, setNotice] = useState<string | null>(null)

  const set = (props: Partial<Omit<SubtitleStyle, 'id'>>, label: string): void => {
    run([{ op: 'style.upsertSubtitle', styleId: style.id, props }], label)
  }

  /** PC に入っているフォントの一覧を読む(使える環境だけ)。 */
  const loadLocalFonts = (): void => {
    const query = (window as unknown as { queryLocalFonts?: () => Promise<{ family: string }[]> }).queryLocalFonts
    if (!query) return
    query()
      .then((list) => setFonts([...new Set([...COMMON_FONTS, ...list.map((font) => font.family)])].sort((a, b) => a.localeCompare(b, 'ja'))))
      .catch(() => undefined)
  }

  const perCharacter = subtitleSettings?.characterOutlineColors ?? true
  const defaults = subtitleSettings?.defaults ?? null

  const saveAsDefault = (): void => {
    updateSettings({ subtitle: { defaults: subtitleLook(style) } })
      .then(() => setNotice('アプリの既定にしました。これから作るキャラクターとプロジェクトの字幕に使われます。'))
      .catch((error: unknown) => setNotice(String(error)))
  }

  const applyToOthers = (): void => {
    const look = subtitleLook(style)
    run(
      otherStyles.map((other) => ({
        op: 'style.upsertSubtitle' as const,
        styleId: other.id,
        props: lookForCharacter(look, other.outline?.color ?? look.outline?.color ?? '#000000', perCharacter)
      })),
      '字幕の見た目をそろえる'
    )
    setNotice(perCharacter ? 'ほかのキャラクターも同じ見た目にしました(縁取りの色はそれぞれのまま)。' : 'ほかのキャラクターも同じ見た目にしました。')
  }

  return (
    <div className="subtitle-editor" data-testid="subtitle-editor">
      <SubtitleSample style={style} lines={sampleLines} width={canvasSize.width} height={canvasSize.height} onMove={(position) => set({ position }, '字幕の位置の変更')} />
      <p className="note">見本の上をドラッグすると字幕の位置を動かせます。</p>

      <div className="field">
        <span className="field__label">位置</span>
        <span className="field__row field__row--wrap">
          {subtitlePresets(canvasSize.width, canvasSize.height).map((preset) => (
            <button key={preset.id} type="button" className="button--small" onClick={() => set({ position: preset.position }, '字幕の位置の変更')} data-testid={`subtitle-preset-${preset.id}`}>
              {preset.label}
            </button>
          ))}
        </span>
      </div>
      <label className="field">
        <span className="field__label">文字の揃え方</span>
        <select
          value={alignOf(style.position.anchor)}
          onChange={(event) => set({ position: { ...style.position, anchor: event.target.value as PortraitAnchor } }, '字幕の揃え方の変更')}
          data-testid="subtitle-anchor"
        >
          {ALIGNS.map(([anchor, label]) => (
            <option key={anchor} value={anchor}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <div className="field">
        <span className="field__label">座標(px。縦は最後の行の下端)</span>
        <span className="field__row">
          横
          <NumberInput value={style.position.x} step={10} onCommit={(x) => set({ position: { ...style.position, x } }, '字幕の位置の変更')} testId="subtitle-x" />
          縦
          <NumberInput value={style.position.y} step={10} onCommit={(y) => set({ position: { ...style.position, y } }, '字幕の位置の変更')} testId="subtitle-y" />
        </span>
      </div>

      <label className="field">
        <span className="field__label">フォント</span>
        <span className="field__row">
          <input
            type="text"
            list="subtitle-fonts"
            key={style.fontFamily}
            defaultValue={style.fontFamily}
            onFocus={loadLocalFonts}
            onBlur={(event) => {
              const family = event.target.value.trim()
              if (family !== '' && family !== style.fontFamily) set({ fontFamily: family }, 'フォントの変更')
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
            }}
            data-testid="subtitle-font"
          />
          <datalist id="subtitle-fonts">
            {fonts.map((font) => (
              <option key={font} value={font} />
            ))}
          </datalist>
        </span>
      </label>
      <label className="field">
        <span className="field__label">太さ</span>
        <select value={style.fontWeight} onChange={(event) => set({ fontWeight: Number(event.target.value) }, '文字の太さの変更')} data-testid="subtitle-weight">
          {WEIGHTS.map(([weight, label]) => (
            <option key={weight} value={weight}>
              {label}
            </option>
          ))}
          {!WEIGHTS.some(([weight]) => weight === style.fontWeight) && <option value={style.fontWeight}>{style.fontWeight}</option>}
        </select>
      </label>
      <label className="field">
        <span className="field__label">大きさ(px)</span>
        <NumberInput value={style.fontSizePx} min={8} max={400} step={2} onCommit={(fontSizePx) => set({ fontSizePx }, '文字の大きさの変更')} testId="subtitle-size" />
      </label>
      <label className="field">
        <span className="field__label">文字の色</span>
        <input type="color" value={style.color.slice(0, 7)} onChange={(event) => set({ color: event.target.value }, '字幕の色の変更')} data-testid="subtitle-color" />
      </label>

      <div className="field">
        <span className="field__label">縁取り</span>
        <span className="field__row">
          <input
            type="checkbox"
            checked={style.outline !== null}
            onChange={(event) => set({ outline: event.target.checked ? { color: '#000000', widthPx: 8 } : null }, '字幕の縁取りの変更')}
            aria-label="縁取りを付ける"
            data-testid="subtitle-outline"
          />
          {style.outline && (
            <>
              <input
                type="color"
                value={style.outline.color.slice(0, 7)}
                onChange={(event) => set({ outline: { color: event.target.value, widthPx: style.outline?.widthPx ?? 8 } }, '字幕の縁取りの変更')}
                aria-label="縁取りの色"
                data-testid="subtitle-outline-color"
              />
              太さ
              <NumberInput
                value={style.outline.widthPx}
                min={0}
                max={100}
                step={1}
                onCommit={(widthPx) => set({ outline: { color: style.outline?.color ?? '#000000', widthPx } }, '字幕の縁取りの変更')}
                testId="subtitle-outline-width"
              />
            </>
          )}
        </span>
      </div>

      <div className="field">
        <span className="field__label">影</span>
        <span className="field__row field__row--wrap">
          <input
            type="checkbox"
            checked={style.shadow !== null}
            onChange={(event) => set({ shadow: event.target.checked ? DEFAULT_SHADOW : null }, '字幕の影の変更')}
            aria-label="影を付ける"
            data-testid="subtitle-shadow"
          />
          {style.shadow && (
            <>
              <input
                type="color"
                value={style.shadow.color.slice(0, 7)}
                onChange={(event) => set({ shadow: { ...style.shadow!, color: `${event.target.value}${style.shadow!.color.slice(7)}` } }, '字幕の影の変更')}
                aria-label="影の色"
              />
              ずれ
              <NumberInput value={style.shadow.offsetX} step={1} onCommit={(offsetX) => set({ shadow: { ...style.shadow!, offsetX } }, '字幕の影の変更')} />
              <NumberInput value={style.shadow.offsetY} step={1} onCommit={(offsetY) => set({ shadow: { ...style.shadow!, offsetY } }, '字幕の影の変更')} />
              ぼかし
              <NumberInput value={style.shadow.blurPx} min={0} step={1} onCommit={(blurPx) => set({ shadow: { ...style.shadow!, blurPx } }, '字幕の影の変更')} />
            </>
          )}
        </span>
      </div>

      <label className="field">
        <span className="field__label">1行の文字数</span>
        <NumberInput value={style.maxCharsPerLine} min={4} max={60} step={1} integer onCommit={(maxCharsPerLine) => set({ maxCharsPerLine }, '字幕の文字数の変更')} testId="subtitle-chars" />
      </label>
      <label className="field">
        <span className="field__label">行間(文字の高さの倍)</span>
        <NumberInput value={style.lineHeight} min={0.5} max={4} step={0.05} onCommit={(lineHeight) => set({ lineHeight }, '字幕の行間の変更')} testId="subtitle-line-height" />
      </label>

      <div className="field">
        <span className="field__label">既定</span>
        <span className="field__row field__row--wrap">
          <button type="button" onClick={saveAsDefault} data-testid="subtitle-save-default">
            この見た目をアプリの既定にする
          </button>
          <button
            type="button"
            disabled={!defaults}
            onClick={() => defaults && set(lookForCharacter(defaults, style.outline?.color ?? defaults.outline?.color ?? '#000000', perCharacter), 'アプリの既定を当てる')}
            data-testid="subtitle-apply-default"
          >
            アプリの既定を当てる
          </button>
          {otherStyles.length > 0 && (
            <button type="button" onClick={applyToOthers} data-testid="subtitle-apply-others">
              ほかのキャラクターも同じ見た目にする
            </button>
          )}
        </span>
      </div>
      <label className="field__row">
        <input
          type="checkbox"
          checked={perCharacter}
          onChange={(event) => updateSettings({ subtitle: { characterOutlineColors: event.target.checked } }).catch(() => undefined)}
          data-testid="subtitle-per-character-outline"
        />
        既定を使うときも、縁取りの色はキャラクターごとに変える
      </label>
      {defaults && (
        <p className="note" data-testid="subtitle-default-summary">
          アプリの既定: {defaults.fontFamily} / {defaults.fontSizePx}px /{' '}
          {ALIGNS.find(([anchor]) => anchor === alignOf(defaults.position.anchor))?.[1].replace(/\(.*\)$/, '')}{' '}
          <button
            type="button"
            className="button--small"
            onClick={() => updateSettings({ subtitle: { defaults: null } }).then(() => setNotice('アプリの既定を、はじめの設定に戻しました。'))}
            data-testid="subtitle-clear-default"
          >
            はじめの設定に戻す
          </button>
        </p>
      )}
      {notice && (
        <p className="status status--ok" data-testid="subtitle-notice">
          {notice}
        </p>
      )}
    </div>
  )
}

/** 数値の入力。確定(Enter・フォーカスを外す)したときだけ反映する。 */
function NumberInput({
  value,
  onCommit,
  min,
  max,
  step,
  integer,
  testId
}: {
  value: number
  onCommit: (value: number) => void
  min?: number
  max?: number
  step?: number
  integer?: boolean
  testId?: string
}): React.JSX.Element {
  return (
    <input
      type="number"
      className="input--narrow"
      key={value}
      defaultValue={value}
      min={min}
      max={max}
      step={step}
      onBlur={(event) => {
        const next = Number(event.target.value)
        if (!Number.isFinite(next) || next === value) return
        if ((min !== undefined && next < min) || (max !== undefined && next > max) || (integer && !Number.isInteger(next))) {
          event.target.value = String(value)
          return
        }
        onCommit(next)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
      }}
      data-testid={testId}
    />
  )
}

/** 字幕の見本。動画と同じ大きさのキャンバスに同じ描き方で描き、縮めて見せる。ドラッグで位置を決める。 */
function SubtitleSample({
  style,
  lines,
  width,
  height,
  onMove
}: {
  style: SubtitleStyle
  lines: string[]
  width: number
  height: number
  onMove: (position: SubtitleStyle['position']) => void
}): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [dragPosition, setDragPosition] = useState<{ x: number; y: number } | null>(null)
  const [fontsVersion, setFontsVersion] = useState(0)
  const shown = dragPosition ? { ...style, position: { ...style.position, ...dragPosition } } : style

  useEffect(() => {
    // フォントの読み込みが終わったら描き直す(読み込み前は代わりのフォントで描かれるため)。
    document.fonts?.ready.then(() => setFontsVersion((version) => version + 1)).catch(() => undefined)
  }, [style.fontFamily])

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d') as unknown as Ctx2D | null
    if (!canvas || !context) return
    const raw = canvas.getContext('2d')!
    const gradient = raw.createLinearGradient(0, 0, 0, height)
    gradient.addColorStop(0, '#46607a')
    gradient.addColorStop(1, '#1d2a36')
    raw.fillStyle = gradient
    raw.fillRect(0, 0, width, height)
    // 位置の目安(三分割の線)
    raw.strokeStyle = 'rgba(255,255,255,0.15)'
    raw.lineWidth = Math.max(1, width / 640)
    for (const ratio of [1 / 3, 2 / 3]) {
      raw.beginPath()
      raw.moveTo(width * ratio, 0)
      raw.lineTo(width * ratio, height)
      raw.moveTo(0, height * ratio)
      raw.lineTo(width, height * ratio)
      raw.stroke()
    }
    drawSubtitleLines(context, lines, shown)
  }, [shown, lines, width, height, fontsVersion])

  const toCanvas = (event: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } => {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = ((event.clientX - rect.left) / rect.width) * width
    const y = ((event.clientY - rect.top) / rect.height) * height
    return { x: Math.round(Math.min(width, Math.max(0, x))), y: Math.round(Math.min(height, Math.max(0, y))) }
  }

  return (
    <canvas
      ref={canvasRef}
      className="subtitle-editor__sample"
      width={width}
      height={height}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId)
        setDragPosition(toCanvas(event))
      }}
      onPointerMove={(event) => {
        if (dragPosition) setDragPosition(toCanvas(event))
      }}
      onPointerUp={(event) => {
        if (!dragPosition) return
        const next = toCanvas(event)
        setDragPosition(null)
        onMove({ ...style.position, ...next })
      }}
      data-testid="subtitle-sample"
    />
  )
}
