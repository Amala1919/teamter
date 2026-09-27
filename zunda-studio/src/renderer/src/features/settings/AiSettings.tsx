import { useEffect, useState } from 'react'

import { AI_ROLE_LABELS, type ProviderId } from '@shared/ai/types'
import { OPENCODE_GO_BASE_URL, OPENCODE_ZEN_BASE_URL, type AppSettings } from '@shared/settings/schema'

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

  const opencode = settings.ai.providers.opencode

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
      case 'needs-key':
        return (
          <span className="status status--warn" data-testid={`provider-${id}-status`}>
            APIキーが未入力です
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
        <div className="field">
          <span className="field__label">状態</span>
          {providerStatus('opencode')}
        </div>
        <div className="field">
          <span className="field__label">接続のしかた</span>
          <div className="segmented" role="radiogroup" aria-label="OpenCode の接続のしかた">
            <label>
              <input
                type="radio"
                name="opencode-connection"
                checked={opencode.connection === 'api-key'}
                onChange={() => save({ ai: { providers: { opencode: { connection: 'api-key' } } } })}
                data-testid="opencode-connection-api-key"
              />
              APIキーを入れる(おすすめ)
            </label>
            <label>
              <input
                type="radio"
                name="opencode-connection"
                checked={opencode.connection === 'cli'}
                onChange={() => save({ ai: { providers: { opencode: { connection: 'cli' } } } })}
                data-testid="opencode-connection-cli"
              />
              opencode コマンドを使う
            </label>
          </div>
        </div>

        {opencode.connection === 'api-key' ? (
          <>
            <OpenCodeKeyField onError={onError} />
            <label className="field">
              <span className="field__label">サービス</span>
              <select
                value={
                  opencode.baseUrl === OPENCODE_GO_BASE_URL ? 'go' : opencode.baseUrl === OPENCODE_ZEN_BASE_URL ? 'zen' : 'custom'
                }
                onChange={(event) => {
                  const baseUrl = event.target.value === 'zen' ? OPENCODE_ZEN_BASE_URL : OPENCODE_GO_BASE_URL
                  save({ ai: { providers: { opencode: { baseUrl } } } })
                }}
                data-testid="opencode-service"
              >
                <option value="go">OpenCode Go(月額プラン)</option>
                <option value="zen">OpenCode Zen(従量課金)</option>
                {opencode.baseUrl !== OPENCODE_GO_BASE_URL && opencode.baseUrl !== OPENCODE_ZEN_BASE_URL && (
                  <option value="custom">その他: {opencode.baseUrl}</option>
                )}
              </select>
            </label>
            <details className="settings-advanced">
              <summary>接続先を直接指定する(上級者向け)</summary>
              <label className="field">
                <span className="field__label">接続先 URL</span>
                <input
                  type="url"
                  key={opencode.baseUrl}
                  defaultValue={opencode.baseUrl}
                  onBlur={(event) => {
                    const baseUrl = event.target.value.trim()
                    if (baseUrl !== '' && baseUrl !== opencode.baseUrl) save({ ai: { providers: { opencode: { baseUrl } } } })
                  }}
                  data-testid="opencode-base-url"
                />
              </label>
            </details>
            <p className="note">
              キーは OpenCode のサイト(opencode.ai)にログインし、OpenCode Go を契約したうえで管理画面の「API Keys」から発行します。
              入れたキーはこの PC の中だけに暗号化して保存し、OpenCode 以外には送りません。
            </p>
          </>
        ) : (
          <>
            <p className="note">
              インストール済みの OpenCode(opencode コマンド)を経由して生成します。OpenCode で /connect から OpenCode Go を接続しておいてください。
            </p>
            <PathField
              label="opencode の場所"
              value={opencode.executablePath}
              onChange={(executablePath) => save({ ai: { providers: { opencode: { executablePath } } } })}
              testId="opencode-path"
            />
            <label className="field">
              <span className="field__label">モデル一覧の絞り込み</span>
              <input
                type="text"
                defaultValue={opencode.providerFilter}
                placeholder="空欄なら全プロバイダ"
                onBlur={(event) => save({ ai: { providers: { opencode: { providerFilter: event.target.value.trim() } } } })}
              />
            </label>
          </>
        )}
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

/** OpenCode の API キー。入れたキーは画面に戻さず、末尾の数文字だけ見せる。 */
function OpenCodeKeyField({ onError }: { onError: (error: unknown) => void }): React.JSX.Element {
  const secrets = useSettingsStore((state) => state.secrets)
  const loadSecrets = useSettingsStore((state) => state.loadSecrets)
  const setSecret = useSettingsStore((state) => state.setSecret)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const status = secrets.find((item) => item.name === 'opencode.apiKey')

  useEffect(() => {
    loadSecrets().catch(onError)
  }, [loadSecrets, onError])

  const store = (value: string | null): void => {
    setBusy(true)
    setSecret('opencode.apiKey', value)
      .then(() => setDraft(''))
      .catch(onError)
      .finally(() => setBusy(false))
  }

  return (
    <div className="field">
      <span className="field__label">API キー</span>
      <div className="key-field">
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder={status?.set ? `保存済み(${status.hint ?? ''})。変えるときだけ入力` : 'sk-… を貼り付け'}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && draft.trim() !== '') store(draft)
          }}
          aria-label="OpenCode の API キー"
          data-testid="opencode-key-input"
        />
        <button type="button" disabled={busy || draft.trim() === ''} onClick={() => store(draft)} data-testid="opencode-key-save">
          保存して接続
        </button>
        {status?.set && (
          <button type="button" disabled={busy} onClick={() => store(null)} data-testid="opencode-key-clear">
            キーを消す
          </button>
        )}
      </div>
      <span className={`status ${status?.set ? 'status--ok' : 'status--warn'}`} data-testid="opencode-key-status">
        {status?.set ? `保存済み ${status.hint ?? ''}` : '未入力'}
        {status?.set && !status.secure ? '(この環境では暗号化できないため、そのまま保存しています)' : ''}
      </span>
    </div>
  )
}
