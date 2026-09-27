import { useEffect, useState } from 'react'

import { PROVIDER_IDS, isSafeModelId, type ModelRef, type ProviderId } from '@shared/ai/types'

import { api, toAppError } from '../../api'
import { useSettingsStore } from '../../state/settings'

const PROVIDER_LABELS: Record<ProviderId, string> = {
  'claude-code': 'Claude(サブスク / Claude Code)',
  opencode: 'OpenCode(OpenCode Go 等)'
}

const CUSTOM = '__custom__'

interface ModelPickerProps {
  value: ModelRef | null
  onChange: (value: ModelRef | null) => void
  /** null を選べるようにするときの表示。例: 「アプリの既定値を使う」。 */
  inheritLabel?: string
  testId?: string
}

/** プロバイダとモデルを選ぶ。一覧に無いモデルは手入力できる(AI-3)。 */
export function ModelPicker({ value, onChange, inheritLabel, testId }: ModelPickerProps): React.JSX.Element {
  const models = useSettingsStore((state) => (value ? state.models[value.providerId] : undefined))
  const loading = useSettingsStore((state) => (value ? state.modelsLoading[value.providerId] : false))
  const loadModels = useSettingsStore((state) => state.loadModels)
  // 「その他」で手入力中かどうか。確定するまで親には何も送らない(空のIDで設定を壊さないため)。
  const [customMode, setCustomMode] = useState(false)
  const [customDraft, setCustomDraft] = useState('')
  const [testState, setTestState] = useState<{ kind: 'idle' | 'running' | 'ok' | 'error'; text: string }>({
    kind: 'idle',
    text: ''
  })

  useEffect(() => {
    if (value) void loadModels(value.providerId)
  }, [value, loadModels])

  const inList = value !== null && (models ?? []).some((model) => model.id === value.model)
  const showCustom = value !== null && (customMode || (!inList && models !== undefined))

  // 一覧に無いモデルが既に選ばれているときは、その ID を入力欄に出しておく。
  useEffect(() => {
    if (value && models !== undefined && !inList) setCustomDraft(value.model)
  }, [value, models, inList])

  const commitCustom = (text: string): void => {
    const model = text.trim()
    if (value && model !== '' && isSafeModelId(model) && model !== value.model) onChange({ ...value, model })
  }

  const selectProvider = (providerId: string): void => {
    setTestState({ kind: 'idle', text: '' })
    setCustomMode(false)
    if (providerId === '') {
      onChange(null)
      return
    }
    const id = providerId as ProviderId
    void loadModels(id).then((list) => {
      const first = list[0]
      onChange(first ? { providerId: id, model: first.id } : { providerId: id, model: '' })
    })
  }

  const runTest = (): void => {
    if (!value || value.model === '') return
    setTestState({ kind: 'running', text: '問い合わせ中…' })
    api
      .invoke('ai:test', value.providerId, value.model)
      .then((result) =>
        setTestState({ kind: 'ok', text: `応答: ${result.text}(${(result.durationMs / 1000).toFixed(1)}秒)` })
      )
      .catch((error: unknown) => {
        const appError = toAppError(error)
        setTestState({ kind: 'error', text: `${appError.message}。${appError.guidance}` })
      })
  }

  return (
    <div className="model-picker" data-testid={testId}>
      <select
        value={value?.providerId ?? ''}
        onChange={(event) => selectProvider(event.target.value)}
        aria-label="AIの種類"
        data-testid={testId ? `${testId}-provider` : undefined}
      >
        {inheritLabel !== undefined && <option value="">{inheritLabel}</option>}
        {inheritLabel === undefined && value === null && <option value="">選んでください</option>}
        {PROVIDER_IDS.map((id) => (
          <option key={id} value={id}>
            {PROVIDER_LABELS[id]}
          </option>
        ))}
      </select>

      {value && (
        <select
          value={showCustom ? CUSTOM : value.model}
          onChange={(event) => {
            setTestState({ kind: 'idle', text: '' })
            if (event.target.value === CUSTOM) {
              setCustomMode(true)
              setCustomDraft(inList ? '' : value.model)
            } else {
              setCustomMode(false)
              onChange({ ...value, model: event.target.value })
            }
          }}
          aria-label="モデル"
          disabled={loading === true}
          data-testid={testId ? `${testId}-model` : undefined}
        >
          {loading && <option value={value.model}>読み込み中…</option>}
          {(models ?? []).map((model) => (
            <option key={model.id} value={model.id} title={model.note}>
              {model.label}
              {model.note ? ` — ${model.note}` : ''}
            </option>
          ))}
          <option value={CUSTOM}>その他(モデルIDを入力)</option>
        </select>
      )}

      {showCustom && value && (
        <input
          type="text"
          placeholder={value.providerId === 'opencode' ? '例: opencode-go/kimi-k3' : '例: claude-opus-5'}
          value={customDraft}
          onChange={(event) => setCustomDraft(event.target.value)}
          onBlur={(event) => commitCustom(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commitCustom(event.currentTarget.value)
          }}
          aria-label="モデルID"
          aria-invalid={customDraft !== '' && !isSafeModelId(customDraft.trim())}
          data-testid={testId ? `${testId}-custom` : undefined}
        />
      )}

      {value && value.model !== '' && (
        <button
          type="button"
          onClick={runTest}
          disabled={testState.kind === 'running'}
          data-testid={testId ? `${testId}-test` : undefined}
        >
          接続テスト
        </button>
      )}
      {testState.kind !== 'idle' && (
        <span
          className={`model-picker__status model-picker__status--${testState.kind}`}
          data-testid={testId ? `${testId}-status` : undefined}
        >
          {testState.text}
        </span>
      )}
    </div>
  )
}
