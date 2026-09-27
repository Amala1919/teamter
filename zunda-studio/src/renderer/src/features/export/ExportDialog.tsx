import { useEffect, useMemo, useState } from 'react'

import type { ExportProgress } from '@shared/export/types'
import { generateCredits } from '@shared/project/credits'
import { itemEndMs, projectDurationMs } from '@shared/project/queries'

import { api, toAppError } from '../../api'
import { formatMs } from '../../lib/time'
import { useEditorStore } from '../../state/store'
import { Modal } from '../../ui/Modal'

const HEIGHTS = [
  { value: 0, label: 'プロジェクトと同じ' },
  { value: 720, label: '720p' },
  { value: 1080, label: '1080p' },
  { value: 1440, label: '1440p' },
  { value: 2160, label: '2160p(4K)' }
]

const QUALITIES = [
  { value: 18, label: '高画質(ファイル大)' },
  { value: 20, label: '標準' },
  { value: 26, label: '軽量(ファイル小)' }
]

const PHASE_LABELS: Record<ExportProgress['phase'], string> = {
  prepare: '準備中',
  audio: '音声を合成中',
  video: '映像を書き出し中',
  done: '完了',
  error: '失敗',
  cancelled: '中止しました'
}

/**
 * mp4 の書き出しと、概要欄のクレジット文の確認(REQUIREMENTS.md E-1〜E-3, E-5, L-4)。
 */
export function ExportDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const project = useEditorStore((state) => state.project)
  const dispatch = useEditorStore((state) => state.dispatch)
  const selectedItemIds = useEditorStore((state) => state.selectedItemIds)
  const [height, setHeight] = useState(0)
  const [fps, setFps] = useState(project.canvas.fps)
  const [crf, setCrf] = useState(20)
  const [range, setRange] = useState<'all' | 'selection'>('all')
  const [progress, setProgress] = useState<ExportProgress | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [savedText, setSavedText] = useState<string | null>(null)

  const draft = useMemo(() => generateCredits(project), [project])
  const creditsText = project.credits.generated || draft.text
  const unsynthesized = project.items.filter((item) => item.type === 'voice' && item.synthesis === null).length
  const duration = projectDurationMs(project)
  const selection = project.items.filter((item) => selectedItemIds.includes(item.id))
  const selectionRange =
    selection.length > 0
      ? { startMs: Math.min(...selection.map((item) => item.startMs)), endMs: Math.max(...selection.map((item) => itemEndMs(item))) }
      : null
  const running = progress !== null && ['prepare', 'audio', 'video'].includes(progress.phase)

  useEffect(() => {
    if (!jobId) return
    return api.subscribe('export:progress', (payload) => {
      if (payload.jobId !== jobId) return
      setProgress(payload)
      if (payload.phase === 'error') setError(`${payload.error?.message ?? '書き出しに失敗しました'}${payload.error?.detail ? `\n${payload.error.detail}` : ''}`)
    })
  }, [jobId])

  const start = async (): Promise<void> => {
    setError(null)
    try {
      const picked = await api.invoke('dialog:pick', { kind: 'exportVideo', defaultName: `${project.meta.title}.mp4` })
      const outputPath = picked?.[0]
      if (!outputPath) return
      const bounds = range === 'selection' && selectionRange ? selectionRange : { startMs: 0, endMs: duration }
      setProgress({ jobId: '', phase: 'prepare', ratio: 0 })
      const id = await api.invoke('export:start', {
        project,
        outputPath,
        ...bounds,
        fps,
        crf,
        ...(height > 0 ? { height } : {})
      })
      setJobId(id)
    } catch (caught) {
      setProgress(null)
      setError(toAppError(caught).message)
    }
  }

  const saveDescription = async (): Promise<void> => {
    setError(null)
    try {
      const picked = await api.invoke('dialog:pick', { kind: 'exportText', defaultName: `${project.meta.title}_概要欄.txt` })
      const path = picked?.[0]
      if (!path) return
      await api.invoke('export:text', path, creditsText)
      setSavedText(path)
    } catch (caught) {
      setError(toAppError(caught).message)
    }
  }

  return (
    <Modal title="書き出し" onClose={running ? () => {} : onClose} wide>
      <div className="settings-section export-dialog">
        {error && (
          <div className="banner banner--error" role="alert">
            <span className="export-dialog__error">{error}</span>
          </div>
        )}
        <section>
          <h3>動画(mp4 / H.264・AAC)</h3>
          {unsynthesized > 0 && (
            <p className="status status--warn" data-testid="export-unsynthesized">
              音声が合成されていないセリフが {unsynthesized} 行あります。合成が終わるまで書き出せません。
            </p>
          )}
          <div className="field__row field__row--wrap">
            <label className="field field--inline">
              <span className="field__label">解像度</span>
              <select value={height} onChange={(event) => setHeight(Number(event.target.value))} data-testid="export-height">
                {HEIGHTS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.value === 0 ? `${option.label}(${project.canvas.width}×${project.canvas.height})` : option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field field--inline">
              <span className="field__label">フレームレート</span>
              <select value={fps} onChange={(event) => setFps(Number(event.target.value))} data-testid="export-fps">
                {[...new Set([24, 30, 60, project.canvas.fps])].sort((a, b) => a - b).map((value) => (
                  <option key={value} value={value}>
                    {value}fps
                  </option>
                ))}
              </select>
            </label>
            <label className="field field--inline">
              <span className="field__label">画質</span>
              <select value={crf} onChange={(event) => setCrf(Number(event.target.value))}>
                {QUALITIES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="field__row field__row--wrap">
            <label className="field__row">
              <input type="radio" checked={range === 'all'} onChange={() => setRange('all')} />
              全体({formatMs(duration)})
            </label>
            <label className="field__row">
              <input type="radio" checked={range === 'selection'} disabled={!selectionRange} onChange={() => setRange('selection')} data-testid="export-range-selection" />
              選択中のアイテムの区間
              {selectionRange && `(${formatMs(selectionRange.startMs)} – ${formatMs(selectionRange.endMs)})`}
            </label>
          </div>
          {progress && (
            <div className="export-dialog__progress" data-testid="export-progress">
              <progress max={1} value={progress.phase === 'done' ? 1 : progress.ratio} />
              <span data-testid="export-phase">
                {PHASE_LABELS[progress.phase]}
                {running && ` ${Math.round(progress.ratio * 100)}%`}
                {progress.phase === 'video' && progress.fps ? `(${progress.fps.toFixed(1)}コマ/秒)` : ''}
              </span>
            </div>
          )}
          {progress?.phase === 'done' && progress.outputPath && (
            <p className="status status--ok" data-testid="export-done">
              書き出しました: {progress.outputPath}
            </p>
          )}
          <div className="field__row">
            {running ? (
              <button type="button" className="button--danger" onClick={() => jobId && void api.invoke('export:cancel', jobId)} data-testid="export-cancel">
                中止
              </button>
            ) : (
              <button type="button" className="button--primary" onClick={() => void start()} disabled={unsynthesized > 0 || duration === 0} data-testid="export-start">
                書き出す
              </button>
            )}
          </div>
        </section>

        <section data-testid="credits-section">
          <h3>概要欄のクレジット</h3>
          <p className="note">使っているキャラクターと素材から作った下書きです。規約どおりか確かめてから投稿してください。</p>
          {draft.issues.map((issue) => (
            <p key={issue.message} className="status status--warn" data-testid="credit-issue">
              {issue.message}
            </p>
          ))}
          <textarea
            className="export-dialog__credits"
            rows={6}
            key={creditsText}
            defaultValue={creditsText}
            onBlur={(event) => {
              if (event.target.value !== creditsText) dispatch([{ op: 'credits.set', generated: event.target.value }], 'クレジットの編集')
            }}
            data-testid="credits-text"
          />
          <div className="field__row field__row--wrap">
            <button
              type="button"
              className="button--small"
              onClick={() => dispatch([{ op: 'credits.set', generated: draft.text }], 'クレジットの作り直し')}
              disabled={creditsText === draft.text}
            >
              素材から作り直す
            </button>
            <button type="button" className="button--small" onClick={() => void navigator.clipboard?.writeText(creditsText)}>
              コピー
            </button>
            <button type="button" className="button--small" onClick={() => void saveDescription()} data-testid="credits-save">
              テキストに保存
            </button>
            <label className="field__row">
              <input
                type="checkbox"
                checked={project.credits.confirmedByUser}
                onChange={(event) =>
                  dispatch(
                    [
                      // 確認したのは今見えている文なので、下書きのままならそれを保存してから印を付ける。
                      ...(project.credits.generated === '' ? [{ op: 'credits.set' as const, generated: creditsText }] : []),
                      { op: 'credits.set', confirmedByUser: event.target.checked }
                    ],
                    'クレジットの確認'
                  )
                }
                data-testid="credits-confirmed"
              />
              内容を確認した
            </label>
          </div>
          {savedText && <p className="status status--ok">保存しました: {savedText}</p>}
        </section>
      </div>
    </Modal>
  )
}
