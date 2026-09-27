import { useEffect, useMemo, useState } from 'react'

import type { LiveSessionSummary } from '@shared/live/types'
import { entryTimelineMs, offsetForAlignment, recordingTimeMs } from '@shared/live/timing'
import type { LiveEntry, LiveSession, Project } from '@shared/project/types'

import { api, toAppError } from '../../api'
import { formatMs } from '../../lib/time'
import { player } from '../../playback/player'
import { openLiveWindow } from '../../state/live'
import { assetName } from '../../state/media'
import { useEditorStore } from '../../state/store'
import { Modal } from '../../ui/Modal'

const KIND_LABELS: Record<LiveEntry['kind'], string> = { chat: '', question: '質問', note: 'メモ', marker: '目印' }

/**
 * 録画中の会話の振り返り(REQUIREMENTS.md R-4〜R-6, R-12)。
 * 発言を選ぶとその場面へ移り、「台本に使う」で自分の発言は自分の役、相方の発言は相方の役のセリフになる。
 */
export function LiveLogPane({ onError }: { onError: (message: string | null) => void }): React.JSX.Element {
  const project = useEditorStore((state) => state.project)
  const dispatch = useEditorStore((state) => state.dispatch)
  const setPlayhead = useEditorStore((state) => state.setPlayhead)
  const playheadMs = useEditorStore((state) => state.playheadMs)
  const sessions = Object.values(project.liveSessions).sort((a, b) => b.startedAt.localeCompare(a.startedAt))
  const [sessionId, setSessionId] = useState<string | null>(sessions[0]?.id ?? null)
  const [query, setQuery] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [aligning, setAligning] = useState<string | null>(null)
  const session = (sessionId ? project.liveSessions[sessionId] : undefined) ?? sessions[0]

  const run = (commands: Parameters<typeof dispatch>[0], label: string): boolean => {
    const result = dispatch(commands, label)
    onError(result.ok ? null : result.message)
    return result.ok
  }

  const entries = useMemo(() => {
    if (!session) return []
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
    return session.entries.filter((entry) => words.every((word) => entry.text.toLowerCase().includes(word)))
  }, [session, query])

  const saveText = async (): Promise<void> => {
    if (!session) return
    try {
      const picked = await api.invoke('dialog:pick', { kind: 'exportText', defaultName: `ライブ記録_${session.startedAt.slice(0, 10)}.txt` })
      if (!picked?.[0]) return
      await api.invoke('export:text', picked[0], transcript(project, session))
    } catch (error) {
      onError(toAppError(error).message)
    }
  }

  return (
    <div className="live-log" data-testid="live-log-pane">
      <div className="live-log__toolbar">
        <button type="button" className="button--small button--primary" onClick={() => void openLiveWindow().then(onError)} data-testid="open-live">
          ライブを始める
        </button>
        <button type="button" className="button--small" onClick={() => setImportOpen(true)} data-testid="open-live-import">
          記録を取り込む
        </button>
      </div>

      {!session ? (
        <p className="pane__empty">
          録画しながら相方と話した記録がここに並びます。「ライブを始める」で録画中用の小さなウィンドウを開き、終わったら「記録を取り込む」でこのプロジェクトに入れてください。
        </p>
      ) : (
        <>
          <label className="field field--inline">
            <span className="field__label">記録</span>
            <select value={session.id} onChange={(event) => setSessionId(event.target.value)} data-testid="live-session-select">
              {sessions.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {new Date(candidate.startedAt).toLocaleString()}({candidate.entries.length}件)
                </option>
              ))}
            </select>
          </label>
          <SessionLink project={project} session={session} run={run} />
          <input
            type="search"
            value={query}
            placeholder="発言を探す"
            onChange={(event) => setQuery(event.target.value)}
            className="live-log__search"
            data-testid="live-search"
          />
          {aligning && (
            <p className="status status--warn" data-testid="live-aligning">
              プレビューをこの発言の場面へ動かしてから「ここに合わせる」を押してください。
              <button
                type="button"
                className="button--small"
                onClick={() => {
                  const entry = session.entries.find((candidate) => candidate.id === aligning)
                  const offset = entry ? offsetForAlignment(project, session, entry, playheadMs) : null
                  if (offset === null) onError('再生位置に録画が映っていません')
                  else run([{ op: 'live.setOffset', sessionId: session.id, offsetMs: offset }], 'ライブの記録のずれの調整')
                  setAligning(null)
                }}
                data-testid="live-align-here"
              >
                ここに合わせる
              </button>
              <button type="button" className="button--small" onClick={() => setAligning(null)}>
                やめる
              </button>
            </p>
          )}
          <ol className="live-log__entries">
            {entries.map((entry) => {
              const timelineMs = entryTimelineMs(project, session, entry)
              const speaker = entry.role === 'ai' ? '相方' : 'あなた'
              return (
                <li
                  key={entry.id}
                  className={`live-log__entry live-log__entry--${entry.role}${entry.bookmarked ? ' live-log__entry--marked' : ''}`}
                  data-testid="live-log-entry"
                >
                  <button
                    type="button"
                    className="live-log__time"
                    disabled={timelineMs === null}
                    title={timelineMs === null ? 'タイムラインに置いた録画の範囲の外です' : 'この場面へ移動'}
                    onClick={() => {
                      if (timelineMs === null) return
                      player.stop()
                      setPlayhead(timelineMs)
                    }}
                    data-testid="live-seek"
                  >
                    {formatMs(Math.max(0, recordingTimeMs(session, entry))).replace(/\.\d+$/, '')}
                  </button>
                  <span className="live-log__body">
                    <span className="live-log__speaker">
                      {speaker}
                      {KIND_LABELS[entry.kind] && ` ・${KIND_LABELS[entry.kind]}`}
                      {entry.bookmarked && ' ★'}
                    </span>
                    <span className="live-log__text">{entry.text}</span>
                  </span>
                  <span className="live-log__actions">
                    {entry.adoptedItemId && project.items.some((item) => item.id === entry.adoptedItemId) ? (
                      <span className="status status--ok">採用済み</span>
                    ) : (
                      entry.kind !== 'marker' && (
                        <button
                          type="button"
                          className="button--small"
                          onClick={() =>
                            run(
                              [
                                {
                                  op: 'script.adoptLiveEntry',
                                  sessionId: session.id,
                                  entryId: entry.id,
                                  // 録画の範囲の外なら再生位置に置く。
                                  ...(timelineMs === null ? { atMs: playheadMs } : {})
                                }
                              ],
                              'ライブの発言を台本に採用'
                            )
                          }
                          data-testid="live-adopt"
                        >
                          台本に使う
                        </button>
                      )
                    )}
                    <button type="button" className="button--small" onClick={() => setAligning(entry.id)} title="録画とのずれをこの発言で合わせる" data-testid="live-align">
                      合わせる
                    </button>
                  </span>
                </li>
              )
            })}
          </ol>
          <div className="field__row">
            <button type="button" className="button--small" onClick={() => void saveText()} data-testid="live-save-text">
              テキストに保存
            </button>
            <button
              type="button"
              className="button--small button--danger"
              onClick={() => {
                if (run([{ op: 'live.removeSession', sessionId: session.id }], 'ライブの記録を外す')) setSessionId(null)
              }}
            >
              この記録を外す
            </button>
          </div>
        </>
      )}
      {importOpen && (
        <ImportDialog
          onClose={() => setImportOpen(false)}
          onImported={(id) => {
            setSessionId(id)
            setImportOpen(false)
          }}
          onError={onError}
        />
      )}
    </div>
  )
}

/** どの録画の会話か、ずれはいくつか。 */
function SessionLink({ project, session, run }: { project: Project; session: LiveSession; run: (commands: Parameters<ReturnType<typeof useEditorStore.getState>['dispatch']>[0], label: string) => boolean }): React.JSX.Element {
  const videos = Object.entries(project.assets).filter(([, asset]) => asset.type === 'video')
  return (
    <div className="live-log__link">
      <label className="field field--inline">
        <span className="field__label">録画</span>
        <select
          value={session.recordingAssetId ?? ''}
          onChange={(event) =>
            run([{ op: 'live.linkRecording', sessionId: session.id, assetId: event.target.value || null }], 'ライブの記録と録画の結び付け')
          }
          data-testid="live-recording"
        >
          <option value="">(結び付けない: 録画を 0 秒に置いたものとみなす)</option>
          {videos.map(([assetId, asset]) => (
            <option key={assetId} value={assetId}>
              {assetName(asset)}
            </option>
          ))}
        </select>
      </label>
      <span className="note" data-testid="live-offset">
        ずれ: {session.offsetMs >= 0 ? '+' : '-'}
        {formatMs(Math.abs(session.offsetMs))}(
        {session.offsetSource === 'obs' ? 'OBS から自動' : session.offsetSource === 'manual' ? '手で調整' : '未調整'})
      </span>
    </div>
  )
}

function ImportDialog({ onClose, onImported, onError }: { onClose: () => void; onImported: (id: string) => void; onError: (message: string | null) => void }): React.JSX.Element {
  const project = useEditorStore((state) => state.project)
  const dispatch = useEditorStore((state) => state.dispatch)
  const [summaries, setSummaries] = useState<LiveSessionSummary[] | null>(null)

  useEffect(() => {
    api
      .invoke('live:list')
      .then(setSummaries)
      .catch((error: unknown) => onError(toAppError(error).message))
  }, [onError])

  const importSession = async (summary: LiveSessionSummary): Promise<void> => {
    try {
      const { recordingPath, ...session } = await api.invoke('live:read', summary.id)
      // OBS から録画ファイルが分かっていれば、同じファイルの素材に自動で結び付ける。
      const recordingAssetId = recordingPath
        ? (Object.entries(project.assets).find(([, asset]) => asset.type === 'video' && asset.path.absolute === recordingPath)?.[0] ?? null)
        : null
      const result = dispatch([{ op: 'live.importSession', session: { ...session, recordingAssetId } }], 'ライブの記録の取り込み')
      if (!result.ok) {
        onError(result.message)
        return
      }
      onImported(session.id)
    } catch (error) {
      onError(toAppError(error).message)
    }
  }

  return (
    <Modal title="ライブの記録を取り込む" onClose={onClose}>
      {!summaries ? (
        <p className="status">読み込み中…</p>
      ) : summaries.length === 0 ? (
        <p className="pane__empty">まだ記録がありません。</p>
      ) : (
        <ul className="live-import">
          {summaries.map((summary) => (
            <li key={summary.id} className="live-import__row" data-testid="live-import-row">
              <span>
                <strong>{new Date(summary.startedAt).toLocaleString()}</strong>
                <span className="note">
                  {summary.projectTitle} / 相方: {summary.aiName} / {summary.entryCount}件(目印 {summary.markerCount})
                  {summary.endedAt ? '' : ' / 終了していない'}
                </span>
              </span>
              <button type="button" className="button--small" onClick={() => void importSession(summary)} data-testid="live-import">
                {project.liveSessions[summary.id] ? '取り込み直す' : '取り込む'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}

/** 記録をテキストにする(R-12)。 */
function transcript(project: Project, session: LiveSession): string {
  const characters = Object.values(project.characters)
  const aiName = characters.find((character) => character.authorRole === 'ai')?.name ?? '相方'
  const userName = characters.find((character) => character.authorRole === 'user')?.name ?? 'あなた'
  return [
    `ライブの記録 ${new Date(session.startedAt).toLocaleString()}`,
    '',
    ...session.entries.map((entry) => {
      const time = formatMs(Math.max(0, recordingTimeMs(session, entry))).replace(/\.\d+$/, '')
      if (entry.kind === 'marker') return `[${time}] ★ ${entry.text}`
      return `[${time}] ${entry.role === 'ai' ? aiName : userName}: ${entry.text}`
    })
  ].join('\n')
}
