import { useState } from 'react'

import type { SoundEntry } from '@shared/settings/schema'

import { moveSound, placeSound, previewSound, registerSoundFiles, removeSound, updateSound } from '../../state/sounds'
import { useSettingsStore } from '../../state/settings'
import { Modal } from '../../ui/Modal'

const NO_SOUNDS: SoundEntry[] = []

/**
 * 効果音のパレット。よく使う音を登録しておき、押すと再生位置に置く。最初の9つは数字キー(1〜9)でも置ける。
 * パレットはアプリに保存され、どのプロジェクトでも使える。
 */
export function SoundPalette({ onClose, onError }: { onClose: () => void; onError: (message: string) => void }): React.JSX.Element {
  const entries = useSettingsStore((state) => state.settings?.sounds.palette ?? NO_SOUNDS)
  const [busy, setBusy] = useState(false)
  const report = (message: string | null): void => {
    if (message) onError(message)
  }
  const guard = (task: () => Promise<string | null | void>): void => {
    setBusy(true)
    task()
      .then((message) => report(message ?? null))
      .catch((error: unknown) => onError(String(error)))
      .finally(() => setBusy(false))
  }

  return (
    <Modal
      title="効果音のパレット"
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" disabled={busy} onClick={() => guard(registerSoundFiles)} data-testid="sound-register">
            ファイルから登録…
          </button>
          <button type="button" onClick={onClose}>
            閉じる
          </button>
        </>
      }
    >
      <p className="note">
        名前を押すと再生位置に置きます(「効果音」レイヤー)。上から9つは、タイムラインで数字キーの 1〜9 を押しても置けます。
        パレットはアプリに保存され、どのプロジェクトでも使えます。タイムラインの音声を右クリックして「効果音のパレットに登録」からも足せます。
      </p>
      {entries.length === 0 ? (
        <p className="pane__empty" data-testid="sound-empty">
          まだ登録がありません。「ファイルから登録…」で、よく使う効果音(ドン・チーン・拍手など)を足してください。
        </p>
      ) : (
        <ul className="sound-list" data-testid="sound-list">
          {entries.map((entry, index) => (
            <li key={entry.id} className="sound-list__item" data-testid="sound-entry">
              <span className="sound-list__key">{index < 9 ? index + 1 : ''}</span>
              <button type="button" className="sound-list__place" disabled={busy} onClick={() => guard(() => placeSound(entry))} title={entry.path} data-testid="sound-place">
                {entry.name}
              </button>
              <button type="button" className="button--small" onClick={() => previewSound(entry)} title="試しに鳴らす" aria-label={`${entry.name}を試しに鳴らす`}>
                ▶
              </button>
              <label className="field field--inline">
                <span className="field__label">音量(%)</span>
                <input
                  type="number"
                  min={0}
                  max={400}
                  step={10}
                  key={entry.volume}
                  defaultValue={Math.round(entry.volume * 100)}
                  onBlur={(event) => {
                    const value = Number(event.target.value) / 100
                    if (Number.isFinite(value) && value >= 0 && value <= 4 && value !== entry.volume) guard(() => updateSound(entry.id, { volume: value }))
                  }}
                />
              </label>
              <input
                type="text"
                className="sound-list__name"
                key={entry.name}
                defaultValue={entry.name}
                aria-label="名前"
                onBlur={(event) => {
                  const name = event.target.value.trim()
                  if (name !== '' && name !== entry.name) guard(() => updateSound(entry.id, { name }))
                }}
              />
              <button type="button" className="button--small" disabled={index === 0} onClick={() => guard(() => moveSound(entry.id, -1))} aria-label="上へ">
                ↑
              </button>
              <button type="button" className="button--small" disabled={index === entries.length - 1} onClick={() => guard(() => moveSound(entry.id, 1))} aria-label="下へ">
                ↓
              </button>
              <button type="button" className="button--small button--danger" onClick={() => guard(() => removeSound(entry.id))} aria-label={`${entry.name}をパレットから外す`}>
                外す
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}
