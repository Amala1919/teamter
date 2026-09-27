import { useEffect } from 'react'

import { AI_ROLE_LABELS, type ProviderId } from '@shared/ai/types'
import type { AppSettings } from '@shared/settings/schema'

import { PathField } from '../../ui/PathField'
import { useSettingsStore } from '../../state/settings'
import { ModelPicker } from './ModelPicker'

interface AiSettingsProps {
  settings: AppSettings
  onError: (error: unknown) => void
}

export function AiSettings({ settings, onError }: AiSettingsProps): React.JSX.Element {
  const update = useSettingsStore((state) => state.update)
  const providers = useSettingsStore((state) => state.providers)
  const refreshProviders = useSettingsStore((state) => state.refreshProviders)

  useEffect(() => {
    refreshProviders().catch(onError)
  }, [refreshProviders, onError, settings.ai.providers])

  const save = (patch: Parameters<typeof update>[0]): void => {
    update(patch).catch(onError)
  }

  const providerStatus = (id: ProviderId): React.JSX.Element => {
    const status = providers.find((candidate) => candidate.providerId === id)
    if (!status) return <span className="status">確認中…</span>
    switch (status.state.kind) {
      case 'ready':
        return (
          <span className="status status--ok" data-testid={`provider-${id}-status`}>
            利用可能({status.state.version})
          </span>
        )
      case 'not-installed':
        return (
          <span className="status status--warn" data-testid={`provider-${id}-status`}>
            見つかりません
          </span>
        )
      case 'error':
        return (
          <span className="status status--error" data-testid={`provider-${id}-status`}>
            エラー: {status.state.message}
          </span>
        )
    }
  }

  return (
    <div className="settings-section">
      <section>
        <h3>役割ごとのAI</h3>
        <p className="note">
          会話AIは相方のセリフと、録画中のライブ会話を担当します。プロジェクトごとに変えられます(台本パネルの「中の人」)。
          編集AIは編集チャット・推敲・下書き・概要欄を担当します。
        </p>
        <div className="field">
          <span className="field__label">{AI_ROLE_LABELS.conversation}の既定値</span>
          <ModelPicker
            value={settings.ai.roles.conversation}
            onChange={(model) => save({ ai: { roles: { conversation: model } } })}
            testId="role-conversation"
          />
        </div>
        <div className="field">
          <span className="field__label">{AI_ROLE_LABELS.editor}</span>
          <ModelPicker
            value={settings.ai.roles.editor}
            onChange={(model) => save({ ai: { roles: { editor: model } } })}
            testId="role-editor"
          />
        </div>
      </section>

      <section>
        <h3>Claude(サブスク)</h3>
        <p className="note">
          インストール済みの Claude Code(claude コマンド)を経由して、ログイン中のサブスクで生成します。
          事前にターミナルで claude を起動してログインしておいてください。
        </p>
        <div className="field">
          <span className="field__label">状態</span>
          {providerStatus('claude-code')}
        </div>
        <PathField
          label="claude の場所"
          value={settings.ai.providers['claude-code'].executablePath}
          onChange={(executablePath) => save({ ai: { providers: { 'claude-code': { executablePath } } } })}
          testId="claude-path"
        />
      </section>

      <section>
        <h3>OpenCode</h3>
        <p className="note">
          インストール済みの OpenCode(opencode コマンド)を経由して生成します。OpenCode Go を使う場合は、OpenCode で /connect
          から OpenCode Go を接続しておいてください。
        </p>
        <div className="field">
          <span className="field__label">状態</span>
          {providerStatus('opencode')}
        </div>
        <PathField
          label="opencode の場所"
          value={settings.ai.providers.opencode.executablePath}
          onChange={(executablePath) => save({ ai: { providers: { opencode: { executablePath } } } })}
          testId="opencode-path"
        />
        <label className="field">
          <span className="field__label">モデル一覧の絞り込み</span>
          <input
            type="text"
            defaultValue={settings.ai.providers.opencode.providerFilter}
            placeholder="空欄なら全プロバイダ"
            onBlur={(event) => save({ ai: { providers: { opencode: { providerFilter: event.target.value.trim() } } } })}
          />
        </label>
        <p className="note">
          OpenCode Go はコーディングエージェント向けに提供されているサービスです。台本生成はその想定外の使い方になるため、
          利用規約と利用状況にご注意ください。
        </p>
      </section>

      <section>
        <h3>ライブモード</h3>
        <label className="field">
          <span className="field__label">返答の最大文字数</span>
          <input
            type="number"
            min={10}
            max={400}
            defaultValue={settings.ai.liveMaxChars}
            onBlur={(event) => {
              const value = Number(event.target.value)
              if (Number.isInteger(value) && value > 0) save({ ai: { liveMaxChars: value } })
            }}
          />
        </label>
      </section>
    </div>
  )
}
