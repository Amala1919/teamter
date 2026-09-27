import { useEffect, useState } from 'react'

import { toAppError } from '../../api'
import { formatBytes, INSTALLING_PHASES, useEngineInstallStore } from '../../state/engine-install'
import { useVoiceStore } from '../../state/voice'

/** 自動インストールの進み具合(バーと説明)。 */
export function EngineInstallProgress(): React.JSX.Element | null {
  const state = useEngineInstallStore((store) => store.info?.state)
  const cancel = useEngineInstallStore((store) => store.cancel)
  if (!state || !INSTALLING_PHASES.includes(state.phase)) return null
  const ratio = state.phase === 'downloading' && state.totalBytes ? state.receivedBytes / state.totalBytes : null
  return (
    <div className="install-progress" data-testid="engine-install-progress">
      <div className="install-progress__text">
        <span>{state.message}</span>
        {state.phase === 'downloading' && (
          <span className="install-progress__bytes">
            {formatBytes(state.receivedBytes)}
            {state.totalBytes ? ` / ${formatBytes(state.totalBytes)}` : ''}
          </span>
        )}
      </div>
      <div className={`progress ${ratio === null ? 'progress--busy' : ''}`}>
        <div className="progress__bar" style={{ width: ratio === null ? '100%' : `${Math.round(ratio * 100)}%` }} />
      </div>
      {(state.phase === 'downloading' || state.phase === 'checking' || state.phase === 'extracting') && (
        <button type="button" className="button--small" onClick={() => void cancel()} data-testid="engine-install-cancel">
          中止
        </button>
      )}
    </div>
  )
}

/** 入れる・入れ直すボタン。失敗したら理由を出す。 */
export function useEngineInstallAction(onError?: (error: unknown) => void): { start: () => void; busy: boolean } {
  const install = useEngineInstallStore((store) => store.install)
  const phase = useEngineInstallStore((store) => store.info?.state.phase)
  const busy = phase !== undefined && INSTALLING_PHASES.includes(phase)
  const start = (): void => {
    install().catch((error: unknown) => {
      if (toAppError(error).code !== 'CANCELLED') onError?.(error)
    })
  }
  return { start, busy }
}

/**
 * VOICEVOX が見つからないときに上に出す案内。ボタン1つで公式の VOICEVOX ENGINE を入れて起動する。
 */
export function EngineInstallBanner({ onOpenSettings }: { onOpenSettings: () => void }): React.JSX.Element | null {
  const voicevox = useVoiceStore((state) => state.engines.find((engine) => engine.id === 'voicevox'))
  const info = useEngineInstallStore((store) => store.info)
  const refresh = useEngineInstallStore((store) => store.refresh)
  const [dismissed, setDismissed] = useState(false)
  const [done, setDone] = useState(false)
  const { start, busy } = useEngineInstallAction()

  useEffect(() => {
    void refresh().catch(() => undefined)
  }, [refresh])

  const phase = info?.state.phase
  useEffect(() => {
    if (phase !== 'done') return
    setDone(true)
    const timer = window.setTimeout(() => setDone(false), 6000)
    return () => window.clearTimeout(timer)
  }, [phase])

  if (busy) {
    return (
      <div className="banner banner--info" role="status" data-testid="engine-install-banner">
        <EngineInstallProgress />
      </div>
    )
  }
  if (done && voicevox?.state === 'ready') {
    return (
      <div className="banner banner--ok" role="status" data-testid="engine-install-done">
        <span>VOICEVOX を入れて起動しました({info?.installed?.version ?? ''})。セリフの音声を作れます。</span>
      </div>
    )
  }
  if (dismissed || !info?.supported || voicevox?.reason !== 'not-found') return null
  const failed = phase === 'error' ? info.state.message : null
  return (
    <div className="banner banner--warn" role="alert" data-testid="engine-install-banner">
      <span>
        {failed ? `VOICEVOX を入れられませんでした: ${failed}` : 'VOICEVOX(音声エンジン)が見つかりません。'}
        公式の VOICEVOX ENGINE を自動でダウンロードして起動できます(1〜2GB 程度。利用規約は voicevox.hiroshiba.jp を確認してください)。
      </span>
      <span className="banner__actions">
        <button type="button" className="button--primary" onClick={start} data-testid="engine-install-start">
          {failed ? 'もう一度試す' : '自動で入れて起動'}
        </button>
        <button type="button" onClick={onOpenSettings}>
          場所を指定する
        </button>
        <button type="button" onClick={() => setDismissed(true)}>
          あとで
        </button>
      </span>
    </div>
  )
}
