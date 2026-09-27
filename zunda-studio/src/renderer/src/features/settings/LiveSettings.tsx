import type { AppSettings, SettingsPatch } from '@shared/settings/schema'

import { useSettingsStore } from '../../state/settings'
import { PathField } from '../../ui/PathField'

interface LiveSettingsProps {
  settings: AppSettings
  onError: (error: unknown) => void
}

/** ライブ(録画中の会話)・書き出し・外部ツール(ffmpeg / whisper / OBS)の設定。 */
export function LiveSettings({ settings, onError }: LiveSettingsProps): React.JSX.Element {
  const update = useSettingsStore((state) => state.update)
  const save = (patch: SettingsPatch): void => {
    update(patch).catch(onError)
  }

  return (
    <div className="settings-section">
      <section>
        <h3>ライブ(録画中の会話)</h3>
        <label className="field">
          <span className="field__label">目印を打つホットキー</span>
          <input
            type="text"
            defaultValue={settings.live.markerHotkey}
            key={settings.live.markerHotkey}
            onBlur={(event) => event.target.value.trim() && save({ live: { markerHotkey: event.target.value.trim() } })}
            data-testid="settings-marker-hotkey"
          />
        </label>
        <label className="field">
          <span className="field__label">話す(押すたびに開始・終了)のホットキー</span>
          <input
            type="text"
            defaultValue={settings.live.pushToTalkHotkey}
            key={settings.live.pushToTalkHotkey}
            onBlur={(event) => event.target.value.trim() && save({ live: { pushToTalkHotkey: event.target.value.trim() } })}
          />
        </label>
        <p className="note">例: CommandOrControl+Shift+M。ゲーム中でも効くよう、ライブを始めている間だけ登録します。</p>
        <label className="field">
          <span className="field__label">返事の長さの上限(文字)</span>
          <input
            type="number"
            min={10}
            max={400}
            defaultValue={settings.ai.liveMaxChars}
            key={settings.ai.liveMaxChars}
            onBlur={(event) => {
              const value = Number(event.target.value)
              if (Number.isInteger(value) && value > 0) save({ ai: { liveMaxChars: value } })
            }}
          />
        </label>
        <label className="field__row">
          <input type="checkbox" checked={settings.live.alwaysOnTop} onChange={(event) => save({ live: { alwaysOnTop: event.target.checked } })} />
          ライブのウィンドウを常に最前面に出す(次に開いたときから)
        </label>
      </section>

      <section>
        <h3>音声入力(文字起こし)</h3>
        <p className="note">押しながら話した声は、この PC の中で whisper.cpp を使って文字にします。声を外へは送りません。</p>
        <PathField
          label="whisper.cpp の実行ファイル(whisper-cli)"
          value={settings.speech.whisperPath}
          onChange={(value) => save({ speech: { whisperPath: value } })}
          testId="settings-whisper-path"
        />
        <PathField
          label="モデルファイル(ggml-*.bin)"
          value={settings.speech.whisperModelPath}
          placeholder="例: ggml-small.bin"
          pickKind="any"
          onChange={(value) => save({ speech: { whisperModelPath: value } })}
          testId="settings-whisper-model"
        />
      </section>

      <section>
        <h3>OBS 連携</h3>
        <p className="note">OBS の「ツール → WebSocketサーバー設定」を有効にすると、録画の開始時刻から会話の時刻を自動で合わせます。</p>
        <label className="field__row">
          <input type="checkbox" checked={settings.obs.enabled} onChange={(event) => save({ obs: { enabled: event.target.checked } })} data-testid="settings-obs-enabled" />
          OBS と連携する
        </label>
        <label className="field">
          <span className="field__label">接続先</span>
          <input type="text" defaultValue={settings.obs.url} key={settings.obs.url} onBlur={(event) => save({ obs: { url: event.target.value.trim() } })} />
        </label>
        <label className="field">
          <span className="field__label">パスワード</span>
          <input type="password" defaultValue={settings.obs.password} onBlur={(event) => save({ obs: { password: event.target.value } })} />
        </label>
      </section>

      <section>
        <h3>動画の処理(ffmpeg)</h3>
        <PathField label="ffmpeg" value={settings.media.ffmpegPath} onChange={(value) => save({ media: { ffmpegPath: value } })} testId="settings-ffmpeg-path" />
        <PathField label="ffprobe" value={settings.media.ffprobePath} onChange={(value) => save({ media: { ffprobePath: value } })} />
        <label className="field">
          <span className="field__label">書き出しの速さ(x264 preset)</span>
          <select value={settings.export.preset} onChange={(event) => save({ export: { preset: event.target.value } })}>
            {['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow'].map((preset) => (
              <option key={preset} value={preset}>
                {preset}
              </option>
            ))}
          </select>
        </label>
      </section>
    </div>
  )
}
