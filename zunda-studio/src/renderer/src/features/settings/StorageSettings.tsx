import { useCallback, useEffect, useState } from 'react'

import type { CacheInfo } from '@shared/ipc/contract'

import { api, toAppError } from '../../api'

/** バイト数を読みやすく。 */
function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`
  return `${Math.ceil(bytes / 1024)} KB`
}

/**
 * 設定の「保存場所」タブ。キャッシュ(プロキシの動画・合成した音声・波形など)の場所を変え、今のキャッシュを移す。
 * 移したキャッシュは次の起動から使い、古い場所は次の起動で消す。
 */
export function StorageSettings({ onError }: { onError: (error: unknown) => void }): React.JSX.Element {
  const [info, setInfo] = useState<CacheInfo | null>(null)
  const [moving, setMoving] = useState<{ copiedBytes: number; totalBytes: number } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const refresh = useCallback(() => {
    api
      .invoke('cache:info')
      .then(setInfo)
      .catch((error: unknown) => onError(error))
  }, [onError])

  useEffect(() => refresh(), [refresh])
  useEffect(() => api.subscribe('cache:move-progress', setMoving), [])

  const move = async (directory: string | null): Promise<void> => {
    setNotice(null)
    setMoving({ copiedBytes: 0, totalBytes: info?.bytes ?? 0 })
    try {
      setInfo(await api.invoke('cache:move', directory))
    } catch (error) {
      onError(error)
    } finally {
      setMoving(null)
    }
  }

  const pickAndMove = async (): Promise<void> => {
    try {
      const picked = await api.invoke('dialog:pick', { kind: 'directory' })
      if (picked?.[0]) await move(picked[0])
    } catch (error) {
      onError(error)
    }
  }

  const relaunch = async (): Promise<void> => {
    try {
      const restarted = await api.invoke('app:relaunch')
      if (!restarted) setNotice('この画面からは起動し直せません。アプリを閉じて、もう一度開いてください。')
    } catch (error) {
      onError(toAppError(error))
    }
  }

  const pending = info !== null && info.nextPath !== info.path
  const atDefault = info !== null && info.nextPath === info.defaultPath

  return (
    <div className="settings-section" data-testid="storage-settings">
      <h3>キャッシュの保存場所</h3>
      <p className="note">
        キャッシュには、プレビュー用に作った軽い動画・合成したセリフの音声・波形・立ち絵の画像などが入ります。消しても必要になったときに作り直されますが、
        大きくなりやすいので、空きの多いドライブに移せます(プロジェクトのファイルや素材はそのままです)。
      </p>
      {info?.fallbackFrom && (
        <p className="status status--warn" data-testid="storage-fallback">
          設定した場所({info.fallbackFrom})が使えないため、既定の場所を使っています。ドライブをつなぐと、次の起動からその場所を使います。
        </p>
      )}
      {info ? (
        <dl className="inspector__list storage__list">
          <dt>今の場所</dt>
          <dd data-testid="storage-path">{info.path}</dd>
          <dt>大きさ</dt>
          <dd data-testid="storage-size">{formatBytes(info.bytes)}</dd>
          <dt>ドライブの空き</dt>
          <dd>{info.freeBytes === null ? '不明' : formatBytes(info.freeBytes)}</dd>
        </dl>
      ) : (
        <p className="pane__empty">調べています…</p>
      )}

      {moving ? (
        <div className="storage__progress" data-testid="storage-moving">
          <span>移しています… {moving.totalBytes > 0 ? `${formatBytes(moving.copiedBytes)} / ${formatBytes(moving.totalBytes)}` : ''}</span>
          <progress max={Math.max(1, moving.totalBytes)} value={moving.copiedBytes} />
        </div>
      ) : (
        <div className="field__row field__row--wrap">
          <button type="button" className="button--primary" disabled={!info} onClick={() => void pickAndMove()} data-testid="storage-move">
            場所を変えて、今のキャッシュを移す…
          </button>
          {info && !atDefault && (
            <button type="button" onClick={() => void move(null)} data-testid="storage-reset">
              既定の場所に戻す
            </button>
          )}
        </div>
      )}
      <p className="note">選んだフォルダの中に「zunda-studio-cache」というフォルダを作って移します。移す先のドライブの空きが足りなければ移しません。</p>

      {pending && info && (
        <div className="banner" role="status" data-testid="storage-pending">
          <span>
            コピーしました。次の起動から <strong data-testid="storage-next-path">{info.nextPath}</strong> を使います(今の場所は、そのときに消します)。
          </span>
          <button type="button" className="button--primary" onClick={() => void relaunch()} data-testid="storage-relaunch">
            今すぐ起動し直す
          </button>
        </div>
      )}
      {notice && <p className="status">{notice}</p>}
    </div>
  )
}
