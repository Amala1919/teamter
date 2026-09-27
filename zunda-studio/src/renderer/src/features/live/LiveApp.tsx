import { useEffect, useRef, useState } from 'react'

import { formatModelRef } from '@shared/ai/types'
import type { LiveState } from '@shared/live/types'
import type { LiveEntry } from '@shared/project/types'

import { api, toAppError } from '../../api'
import { formatMs } from '../../lib/time'
import { useSettingsStore } from '../../state/settings'

/** 画面に出す直近の発言の数(古いものは記録には残る)。 */
const VISIBLE_ENTRIES = 60

type Kind = 'chat' | 'question' | 'note'

const KIND_LABELS: Record<Kind, string> = { chat: '雑談', question: '質問', note: 'メモ' }

/**
 * 録画中に使う小さなウィンドウ(REQUIREMENTS.md R-1〜R-11)。
 * ゲームの操作を妨げないよう、最小限の操作だけを置く。発言は main 側で1件ずつファイルに追記される。
 */
export function LiveApp(): React.JSX.Element {
  const [state, setState] = useState<LiveState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [kind, setKind] = useState<Kind>('chat')
  const [now, setNow] = useState(Date.now())
  const settings = useSettingsStore((store) => store.settings)
  const loadSettings = useSettingsStore((store) => store.load)
  const recorder = useTalkRecorder(
    (text) => {
      setDraft('')
      void say(text)
    },
    (message) => setError(message)
  )
  const logRef = useRef<HTMLOListElement>(null)

  useEffect(() => {
    void loadSettings()
    api
      .invoke('live:state')
      .then(setState)
      .catch((caught: unknown) => setError(toAppError(caught).message))
    const offState = api.subscribe('live:state', setState)
    const offHotkey = api.subscribe('live:hotkey', () => recorder.toggle())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => {
      offState()
      offHotkey()
      window.clearInterval(timer)
    }
    // recorder.toggle は録音の状態を中で持つので、登録し直す必要はない。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadSettings])

  useSpeakReplies(state, settings?.live.speakReplies ?? false, settings?.live.outputDeviceId ?? null)

  useEffect(() => {
    const log = logRef.current
    if (log) log.scrollTop = log.scrollHeight
  }, [state?.session?.entries.length, state?.thinking])

  const run = async <T,>(action: () => Promise<T>): Promise<T | undefined> => {
    setError(null)
    try {
      return await action()
    } catch (caught) {
      const appError = toAppError(caught)
      setError(`${appError.message}${appError.guidance ? `。${appError.guidance}` : ''}`)
      return undefined
    }
  }

  const say = async (text: string): Promise<void> => {
    if (text.trim() === '') return
    await run(() => api.invoke('live:say', text, kind))
  }

  if (!state) return <main className="live">{error ? <p className="status status--error">{error}</p> : <p className="status">読み込み中…</p>}</main>

  const session = state.session
  const entries = session?.entries.slice(-VISIBLE_ENTRIES) ?? []
  const elapsed = session ? now - Date.parse(session.startedAt) : 0

  return (
    <main className="live" data-testid="live-window">
      <header className="live__header">
        <strong>{state.profile ? `相方: ${state.profile.aiName}` : 'ライブ'}</strong>
        {session && (
          <span className="live__clock" data-testid="live-clock">
            ● {formatMs(Math.max(0, elapsed)).replace(/\.\d+$/, '')}
          </span>
        )}
        <ObsBadge state={state} />
      </header>
      {error && (
        <p className="status status--error" role="alert" data-testid="live-error">
          {error}
        </p>
      )}

      {!state.profile ? (
        <p className="pane__empty">編集画面の「ライブ」ボタンから開いてください(相方の設定をプロジェクトから受け取ります)。</p>
      ) : !session ? (
        <section className="live__start">
          <p className="note">
            録画を始める前か直後に「開始」を押してください。話した内容は時刻付きで記録され、あとで編集画面から振り返って台本に使えます。
          </p>
          <p className="note">
            会話AI: {state.profile.model ? formatModelRef(state.profile.model) : settings?.ai.roles.conversation ? formatModelRef(settings.ai.roles.conversation) : '未設定'}
            {settings && ` / 目印: ${settings.live.markerHotkey} / 話す: ${settings.live.pushToTalkHotkey}`}
          </p>
          <button type="button" className="button--primary" onClick={() => void run(() => api.invoke('live:start'))} data-testid="live-start">
            開始
          </button>
        </section>
      ) : (
        <>
          <ol className="live__log" ref={logRef} data-testid="live-log">
            {entries.map((entry) => (
              <LiveLine key={entry.id} entry={entry} aiName={state.profile!.aiName} userName={state.profile!.userName} />
            ))}
            {state.thinking && <li className="status">{state.profile.aiName}が考えています…</li>}
          </ol>
          <form
            className="live__input"
            onSubmit={(event) => {
              event.preventDefault()
              const text = draft
              setDraft('')
              void say(text)
            }}
          >
            <div className="live__kinds" role="radiogroup" aria-label="発言の種類">
              {(Object.keys(KIND_LABELS) as Kind[]).map((option) => (
                <label key={option} className={option === kind ? 'chip chip--active' : 'chip'}>
                  <input type="radio" name="kind" value={option} checked={option === kind} onChange={() => setKind(option)} hidden />
                  {KIND_LABELS[option]}
                </label>
              ))}
            </div>
            <input
              type="text"
              value={draft}
              placeholder={kind === 'note' ? 'メモ(相方は返事をしません)' : '相方に話しかける(Enter で送信)'}
              onChange={(event) => setDraft(event.target.value)}
              data-testid="live-input"
            />
            <div className="live__buttons">
              <button
                type="button"
                className={recorder.recording ? 'live__talk live__talk--on' : 'live__talk'}
                onPointerDown={() => recorder.start()}
                onPointerUp={() => recorder.stop()}
                onPointerLeave={() => recorder.recording && recorder.stop()}
                disabled={recorder.busy}
                data-testid="live-talk"
              >
                {recorder.busy ? '文字にしています…' : recorder.recording ? '話しています(離すと送信)' : '押しながら話す'}
              </button>
              <button type="submit" disabled={draft.trim() === ''} data-testid="live-send">
                送信
              </button>
              <button
                type="button"
                onClick={() => {
                  // 返事を待たずに入力欄を空ける(待っている間に打った次の言葉を消さないため)。
                  const text = draft
                  setDraft('')
                  void run(() => api.invoke('live:mark', text))
                }}
                data-testid="live-mark"
              >
                目印
              </button>
              <button type="button" className="button--danger" onClick={() => void run(() => api.invoke('live:stop'))} data-testid="live-stop">
                終了
              </button>
            </div>
          </form>
        </>
      )}
      {settings && <LiveAudioSettings speak={settings.live.speakReplies} deviceId={settings.live.outputDeviceId} hasVoice={state.profile?.voice != null} />}
    </main>
  )
}

function LiveLine({ entry, aiName, userName }: { entry: LiveEntry; aiName: string; userName: string }): React.JSX.Element {
  const speaker = entry.role === 'ai' ? aiName : userName
  return (
    <li className={`live__entry live__entry--${entry.role} live__entry--${entry.kind}`} data-testid="live-entry" data-kind={entry.kind}>
      <span className="live__time">{formatMs(entry.atMs).replace(/\.\d+$/, '')}</span>
      {entry.kind === 'marker' ? (
        <span className="live__marker">★ {entry.text}</span>
      ) : (
        <>
          <span className="live__speaker">{speaker}</span>
          <span className="live__text">{entry.text}</span>
        </>
      )}
    </li>
  )
}

function ObsBadge({ state }: { state: LiveState }): React.JSX.Element | null {
  const obs = state.obs
  if (obs.state === 'disabled') return null
  const text =
    obs.state === 'connecting' ? 'OBS 接続中…' : obs.state === 'connected' ? (obs.recording ? 'OBS 録画中' : 'OBS 接続済み') : obs.message
  return (
    <span className={obs.state === 'error' ? 'live__obs live__obs--error' : 'live__obs'} data-testid="live-obs" title={text}>
      {text}
    </span>
  )
}

/** 返答の読み上げと、出力先の選択(R-8)。録画に混ぜたくないときは、録画しない出力先を選ぶ。 */
function LiveAudioSettings({ speak, deviceId, hasVoice }: { speak: boolean; deviceId: string | null; hasVoice: boolean }): React.JSX.Element {
  const update = useSettingsStore((store) => store.update)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  useEffect(() => {
    void navigator.mediaDevices
      ?.enumerateDevices()
      .then((list) => setDevices(list.filter((device) => device.kind === 'audiooutput')))
      .catch(() => setDevices([]))
  }, [])
  return (
    <details className="live__settings">
      <summary>読み上げの設定</summary>
      <label className="field__row">
        <input type="checkbox" checked={speak} disabled={!hasVoice} onChange={(event) => void update({ live: { speakReplies: event.target.checked } })} />
        相方の返事を声で読み上げる{!hasVoice && '(相方の声が未設定)'}
      </label>
      <label className="field field--inline">
        <span className="field__label">出力先</span>
        <select value={deviceId ?? ''} onChange={(event) => void update({ live: { outputDeviceId: event.target.value || null } })}>
          <option value="">既定の出力</option>
          {devices.map((device) => (
            <option key={device.deviceId} value={device.deviceId}>
              {device.label || device.deviceId}
            </option>
          ))}
        </select>
      </label>
    </details>
  )
}

/** 新しく届いた相方の発言を、相方の声で読み上げる。 */
function useSpeakReplies(state: LiveState | null, enabled: boolean, deviceId: string | null): void {
  const spoken = useRef(new Set<string>())
  const voice = state?.profile?.voice ?? null
  const entries = state?.session?.entries
  useEffect(() => {
    if (!entries) return
    // 開いたときに既にある発言は読み上げない。
    if (spoken.current.size === 0) {
      for (const entry of entries.slice(0, -1)) spoken.current.add(entry.id)
    }
    for (const entry of entries) {
      if (spoken.current.has(entry.id)) continue
      spoken.current.add(entry.id)
      if (!enabled || !voice || entry.role !== 'ai') continue
      void api
        .invoke('voice:synthesize', { engineId: voice.engineId, speakerId: voice.speakerId, text: entry.text, params: voice.params })
        .then(async (outcome) => {
          const audio = new Audio(api.mediaUrl(outcome.wavPath)) as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }
          if (deviceId && audio.setSinkId) await audio.setSinkId(deviceId).catch(() => {})
          await audio.play()
        })
        .catch(() => {
          // 読み上げは補助なので、失敗しても記録は続ける。
        })
    }
  }, [entries, enabled, voice, deviceId])
}

/** 押しながら話す: 押している間だけマイクを録り、離したら文字にして渡す(R-7)。 */
function useTalkRecorder(
  onText: (text: string) => void,
  onError: (message: string) => void
): { recording: boolean; busy: boolean; start: () => void; stop: () => void; toggle: () => void } {
  const [recording, setRecording] = useState(false)
  const [busy, setBusy] = useState(false)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])

  const start = (): void => {
    if (recorderRef.current || busy) return
    void navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        const recorder = new MediaRecorder(stream)
        chunks.current = []
        recorder.ondataavailable = (event) => chunks.current.push(event.data)
        recorder.onstop = () => {
          stream.getTracks().forEach((track) => track.stop())
          const blob = new Blob(chunks.current, { type: recorder.mimeType })
          recorderRef.current = null
          setRecording(false)
          if (blob.size === 0) return
          setBusy(true)
          void blob
            .arrayBuffer()
            .then((buffer) => api.invoke('live:transcribe', toBase64(new Uint8Array(buffer))))
            .then((text) => {
              if (text.trim() !== '') onText(text)
            })
            .catch((error: unknown) => {
              const appError = toAppError(error)
              onError(`${appError.message}${appError.guidance ? `。${appError.guidance}` : ''}`)
            })
            .finally(() => setBusy(false))
        }
        recorderRef.current = recorder
        recorder.start()
        setRecording(true)
      })
      .catch(() => onError('マイクを使えません。OS の設定でマイクの使用を許可してください'))
  }

  const stop = (): void => {
    const recorder = recorderRef.current
    if (recorder && recorder.state !== 'inactive') recorder.stop()
  }

  return { recording, busy, start, stop, toggle: () => (recorderRef.current ? stop() : start()) }
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk))
  }
  return btoa(binary)
}
