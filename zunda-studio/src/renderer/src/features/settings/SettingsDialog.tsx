import { useCallback, useEffect, useState } from 'react'

import { toAppError } from '../../api'
import { useSettingsStore } from '../../state/settings'
import { Modal } from '../../ui/Modal'
import { AiSettings } from './AiSettings'
import { LiveSettings } from './LiveSettings'
import { VoiceSettings } from './VoiceSettings'

type Tab = 'ai' | 'voice' | 'live'

const TABS: { id: Tab; label: string }[] = [
  { id: 'ai', label: 'AI' },
  { id: 'voice', label: '音声エンジン' },
  { id: 'live', label: 'ライブ・外部ツール' }
]

interface SettingsDialogProps {
  onClose: () => void
}

/** アプリ全体の設定。タブは各フェーズの機能に合わせて増やす。 */
export function SettingsDialog({ onClose }: SettingsDialogProps): React.JSX.Element {
  const settings = useSettingsStore((state) => state.settings)
  const load = useSettingsStore((state) => state.load)
  const [tab, setTab] = useState<Tab>('ai')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!settings) load().catch((caught: unknown) => setError(toAppError(caught).message))
  }, [settings, load])

  const onError = useCallback((caught: unknown) => {
    const appError = toAppError(caught)
    setError(`${appError.message}。${appError.guidance}`)
  }, [])

  return (
    <Modal title="設定" onClose={onClose} wide>
      <nav className="tabs" role="tablist">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={tab === item.id ? 'tabs__tab tabs__tab--active' : 'tabs__tab'}
            onClick={() => setTab(item.id)}
            data-testid={`settings-tab-${item.id}`}
          >
            {item.label}
          </button>
        ))}
      </nav>
      {error && (
        <div className="banner banner--error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)}>
            閉じる
          </button>
        </div>
      )}
      {!settings ? (
        <p className="pane__empty">読み込み中…</p>
      ) : tab === 'ai' ? (
        <AiSettings settings={settings} onError={onError} />
      ) : tab === 'voice' ? (
        <VoiceSettings settings={settings} onError={onError} />
      ) : (
        <LiveSettings settings={settings} onError={onError} />
      )}
    </Modal>
  )
}
