import { useEffect } from 'react'

import type { AppSettings, VoiceEngineSettings } from '@shared/settings/schema'

import { useSettingsStore } from '../../state/settings'
import { useVoiceStore } from '../../state/voice'
import { PathField } from '../../ui/PathField'

interface VoiceSettingsProps {
  settings: AppSettings
  onError: (error: unknown) => void
}

/** VOICEVOX 互換のエンジンの接続先。AivisSpeech も同じ API なので同じ形で追加できる。 */
const PRESETS: Omit<VoiceEngineSettings, 'id'>[] = [
  { label: 'AivisSpeech', url: 'http://127.0.0.1:10101', executablePath: null, autoLaunch: true }
]

export function VoiceSettings({ settings, onError }: VoiceSettingsProps): React.JSX.Element {
  const update = useSettingsStore((state) => state.update)
  const engines = useVoiceStore((state) => state.engines)
  const refreshEngines = useVoiceStore((state) => state.refreshEngines)
  const ensureEngine = useVoiceStore((state) => state.ensureEngine)

  useEffect(() => {
    refreshEngines().catch(onError)
  }, [refreshEngines, onError, settings.voice.engines])

  const saveEngines = (next: VoiceEngineSettings[]): void => {
    update({ voice: { engines: next } }).catch(onError)
  }
  const patchEngine = (id: string, patch: Partial<VoiceEngineSettings>): void => {
    saveEngines(settings.voice.engines.map((engine) => (engine.id === id ? { ...engine, ...patch } : engine)))
  }

  return (
    <div className="settings-section">
      <p className="note">
        セリフの音声は VOICEVOX 互換の音声エンジンで合成します。エンジンが既に起動していればそれに接続し、
        起動していなければ下で指定した実行ファイル(VOICEVOX ENGINE の run.exe など)を起動します。
      </p>
      {settings.voice.engines.map((engine) => {
        const status = engines.find((candidate) => candidate.id === engine.id)
        return (
          <section key={engine.id} data-testid={`engine-${engine.id}`}>
            <h3>{engine.label}</h3>
            <div className="field">
              <span className="field__label">状態</span>
              <span className="field__row">
                <span
                  className={`status ${status?.state === 'ready' ? 'status--ok' : status?.state === 'unavailable' ? 'status--error' : ''}`}
                  data-testid={`engine-${engine.id}-status`}
                >
                  {status?.state === 'ready'
                    ? `接続中(${status.version ?? ''})${status.managed ? ' · アプリが起動' : ''}`
                    : status?.state === 'starting'
                      ? '起動中…'
                      : (status?.message ?? '未確認')}
                </span>
                <button
                  type="button"
                  className="button--small"
                  onClick={() => ensureEngine(engine.id).catch(onError)}
                  data-testid={`engine-${engine.id}-connect`}
                >
                  接続・起動
                </button>
              </span>
            </div>
            <label className="field">
              <span className="field__label">接続先URL</span>
              <input
                type="text"
                defaultValue={engine.url}
                onBlur={(event) => {
                  const url = event.target.value.trim()
                  if (url !== engine.url) patchEngine(engine.id, { url })
                }}
                data-testid={`engine-${engine.id}-url`}
              />
            </label>
            <PathField
              label="エンジンの実行ファイル"
              value={engine.executablePath}
              placeholder="空欄なら起動済みのエンジンに接続するだけ"
              onChange={(executablePath) => patchEngine(engine.id, { executablePath })}
              testId={`engine-${engine.id}-path`}
            />
            <label className="field">
              <span className="field__label">自動で起動する</span>
              <input
                type="checkbox"
                checked={engine.autoLaunch}
                onChange={(event) => patchEngine(engine.id, { autoLaunch: event.target.checked })}
              />
            </label>
            {engine.id !== 'voicevox' && (
              <button
                type="button"
                className="button--danger button--small"
                onClick={() => saveEngines(settings.voice.engines.filter((candidate) => candidate.id !== engine.id))}
              >
                このエンジンを外す
              </button>
            )}
          </section>
        )
      })}
      <section>
        {PRESETS.filter((preset) => !settings.voice.engines.some((engine) => engine.label === preset.label)).map((preset) => (
          <button
            key={preset.label}
            type="button"
            onClick={() =>
              saveEngines([...settings.voice.engines, { ...preset, id: preset.label.toLowerCase().replace(/\s+/g, '-') }])
            }
          >
            {preset.label} を追加
          </button>
        ))}
      </section>
    </div>
  )
}
