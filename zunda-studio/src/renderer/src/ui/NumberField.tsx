interface NumberFieldProps {
  label: string
  value: number
  onCommit: (value: number) => void
  min?: number
  max?: number
  step?: number
  /** 表示の倍率(例: ミリ秒を秒で見せるなら 0.001)。 */
  displayScale?: number
  testId?: string
}

/**
 * 数値の入力欄。入力のたびではなく、確定(フォーカスが外れる・Enter)したときに1回だけ反映する。
 * 1文字ごとにコマンドを送ると、取り消しの履歴が細切れになるため。
 */
export function NumberField({ label, value, onCommit, min, max, step = 1, displayScale = 1, testId }: NumberFieldProps): React.JSX.Element {
  const shown = Math.round(value * displayScale * 1000) / 1000
  const commit = (raw: string, input: HTMLInputElement): void => {
    const parsed = Number(raw)
    if (raw.trim() === '' || !Number.isFinite(parsed)) {
      input.value = String(shown)
      return
    }
    const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, parsed))
    if (clamped !== shown) onCommit(clamped / displayScale)
    else input.value = String(shown)
  }
  return (
    <label className="field field--inline">
      <span className="field__label">{label}</span>
      <input
        type="number"
        key={shown}
        defaultValue={shown}
        min={min}
        max={max}
        step={step}
        onBlur={(event) => commit(event.target.value, event.target)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') (event.target as HTMLInputElement).blur()
        }}
        data-testid={testId}
      />
    </label>
  )
}
