import { useEffect, useState } from 'react'

import type { PickKind } from '@shared/ipc/contract'

import { api } from '../api'

interface PathFieldProps {
  label: string
  value: string | null
  placeholder?: string
  pickKind?: PickKind
  onChange: (value: string | null) => void
  testId?: string
}

/** 外部ツールの実行ファイルなど、パスを1つ指定する入力欄。空欄は「自動で探す」を意味する。 */
export function PathField({ label, value, placeholder, pickKind = 'executable', onChange, testId }: PathFieldProps): React.JSX.Element {
  const [draft, setDraft] = useState(value ?? '')
  useEffect(() => setDraft(value ?? ''), [value])

  const commit = (next: string): void => {
    const trimmed = next.trim()
    const normalized = trimmed === '' ? null : trimmed
    if (normalized !== value) onChange(normalized)
  }

  return (
    <label className="field">
      <span className="field__label">{label}</span>
      <span className="field__row">
        <input
          type="text"
          value={draft}
          placeholder={placeholder ?? '空欄なら自動で探す'}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={(event) => commit(event.target.value)}
          data-testid={testId}
        />
        <button
          type="button"
          onClick={() => {
            void api.invoke('dialog:pick', { kind: pickKind }).then((picked) => {
              const path = picked?.[0]
              if (path) {
                setDraft(path)
                commit(path)
              }
            })
          }}
        >
          参照
        </button>
      </span>
    </label>
  )
}
