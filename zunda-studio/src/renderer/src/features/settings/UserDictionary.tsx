import { useCallback, useEffect, useState } from 'react'

import type { VoiceEngineSettings } from '@shared/settings/schema'
import type { UserDictWord } from '@shared/voice/types'

import { api, toAppError } from '../../api'
import { useEditorStore } from '../../state/store'

/**
 * 音声エンジンのユーザー辞書(V-6)。固有名詞やゲーム用語の読みを登録すると、以後その語はこの読みで合成される。
 * 変えた後は、そのエンジンのセリフを合成し直す。
 */
export function UserDictionary({ engines }: { engines: VoiceEngineSettings[] }): React.JSX.Element {
  const [engineId, setEngineId] = useState(engines[0]?.id ?? '')
  const [words, setWords] = useState<UserDictWord[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [surface, setSurface] = useState('')
  const [pronunciation, setPronunciation] = useState('')
  const [accentType, setAccentType] = useState(0)

  const reload = useCallback(() => {
    if (!engineId) return
    setWords(null)
    api
      .invoke('voice:dict:list', engineId)
      .then((list) => {
        setWords(list)
        setError(null)
      })
      .catch((caught: unknown) => {
        const appError = toAppError(caught)
        setError(`${appError.message}。${appError.guidance}`)
        setWords([])
      })
  }, [engineId])

  useEffect(reload, [reload])

  const afterChange = (): void => {
    reload()
    // 辞書の変更をすでに合成したセリフにも反映する。
    useEditorStore.getState().dispatch([{ op: 'voice.invalidateSynthesis', engineId }], '辞書の反映', { history: 'skip' })
  }

  const add = async (): Promise<void> => {
    try {
      await api.invoke('voice:dict:add', engineId, { surface: surface.trim(), pronunciation: pronunciation.trim(), accentType, priority: 5 })
      setSurface('')
      setPronunciation('')
      setAccentType(0)
      afterChange()
    } catch (caught) {
      setError(toAppError(caught).message)
    }
  }

  return (
    <section data-testid="user-dictionary">
      <h3>読み方の辞書</h3>
      <p className="note">ゲームの固有名詞などの読みを登録します。登録すると、そのエンジンのセリフは合成し直されます。</p>
      <label className="field field--inline">
        <span className="field__label">音声エンジン</span>
        <select value={engineId} onChange={(event) => setEngineId(event.target.value)}>
          {engines.map((engine) => (
            <option key={engine.id} value={engine.id}>
              {engine.label}
            </option>
          ))}
        </select>
      </label>
      {error && <p className="status status--error">{error}</p>}
      <div className="field__row field__row--wrap">
        <input type="text" value={surface} placeholder="語(例: 魔王城)" onChange={(event) => setSurface(event.target.value)} data-testid="dict-surface" />
        <input
          type="text"
          value={pronunciation}
          placeholder="読み(カタカナ。例: マオウジョウ)"
          onChange={(event) => setPronunciation(event.target.value)}
          data-testid="dict-pronunciation"
        />
        <label className="field--inline">
          アクセント
          <input type="number" min={0} max={20} value={accentType} onChange={(event) => setAccentType(Number(event.target.value))} title="何モーラ目が高いか。0 は平板" />
        </label>
        <button type="button" disabled={surface.trim() === '' || !/^[ァ-ー]+$/.test(pronunciation.trim())} onClick={() => void add()} data-testid="dict-add">
          登録
        </button>
      </div>
      {words === null ? (
        <p className="status">読み込み中…</p>
      ) : words.length === 0 ? (
        <p className="note">登録された語はありません。</p>
      ) : (
        <ul className="dict-list">
          {words.map((word) => (
            <li key={word.id} data-testid="dict-word">
              <span>
                {word.surface} → {word.pronunciation}(アクセント {word.accentType})
              </span>
              <button
                type="button"
                className="button--small button--danger"
                onClick={() =>
                  void api
                    .invoke('voice:dict:delete', engineId, word.id)
                    .then(afterChange)
                    .catch((caught: unknown) => setError(toAppError(caught).message))
                }
              >
                削除
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
