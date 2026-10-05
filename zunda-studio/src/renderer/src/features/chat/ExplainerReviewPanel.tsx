import { useState } from 'react'

import { formatMs } from '../../lib/time'
import { player, usePlaybackStore } from '../../playback/player'
import {
  cancelExplainer,
  closeExplainerReview,
  findRedoable,
  openExplainerDialog,
  redoExplainer,
  useExplainerStore
} from '../../state/explainer'
import { useEditorStore } from '../../state/store'
import { ExplainerStatus } from './ExplainerDialog'

/**
 * 解説パートの確認パネル。作り終えたらダイアログの代わりに画面の右下に出す(画面の操作はふさがない)。
 * プレビューで再生して確かめながら、追加の要件を書いて作り直せる。作り直しは前回の解説を消して同じ場所に置き直す
 * (「元に戻す」で前回に戻せる)。設定(長さ・語り方など)を変えたいときは、ダイアログを開いて作り直す。
 */
export function ExplainerReviewPanel(): React.JSX.Element | null {
  const open = useExplainerStore((state) => state.reviewOpen && !state.dialogOpen)
  const history = useExplainerStore((state) => state.history)
  const phase = useExplainerStore((state) => state.phase)
  const project = useEditorStore((state) => state.project)
  const playing = usePlaybackStore((state) => state.playing)
  const [requirement, setRequirement] = useState('')
  const [collapsed, setCollapsed] = useState(false)

  const running = phase.kind === 'writing' || phase.kind === 'voicing' || phase.kind === 'images'
  const redoable = findRedoable(history, project)
  // 作り直せる解説が無くなった(消した・元に戻した)ら、作っている途中やエラーのとき以外は出さない。
  if (!open || (!redoable && !running && phase.kind !== 'error')) return null

  const playFromStart = (): void => {
    if (playing) {
      player.stop()
      return
    }
    if (!redoable) return
    const { setPlayhead, setSelection } = useEditorStore.getState()
    setPlayhead(redoable.placed.startMs)
    setSelection(redoable.placed.itemIds)
    void player.play(redoable.placed.startMs)
  }

  const redo = (): void => {
    void redoExplainer(requirement.trim()).then(() => {
      // 作り直せたら要件の欄を空にする(続けて別の要件で作り直せるように)。
      if (useExplainerStore.getState().phase.kind === 'done') setRequirement('')
    })
  }

  return (
    <aside className={`explainer-review${collapsed ? ' is-collapsed' : ''}`} aria-label="解説パートの確認" data-testid="explainer-review-panel">
      <header className="explainer-review__header">
        <strong>解説パートを確かめる</strong>
        {redoable && <span className="explainer-review__title">「{redoable.last.title}」</span>}
        <span className="explainer-review__spacer" />
        <button type="button" className="button--small" onClick={() => setCollapsed(!collapsed)} aria-expanded={!collapsed} data-testid="explainer-review-collapse">
          {collapsed ? '広げる' : 'たたむ'}
        </button>
        <button type="button" className="button--small" onClick={closeExplainerReview} disabled={running} title="これで決める(パネルを閉じる)" data-testid="explainer-review-close">
          これで決定
        </button>
      </header>
      {!collapsed && (
        <div className="explainer-review__body">
          {redoable && (
            <p className="explainer-review__range">
              {formatMs(redoable.placed.startMs).replace(/\.\d+$/, '')} 〜 {formatMs(redoable.placed.endMs).replace(/\.\d+$/, '')}・{redoable.last.lines.length}行
              <button type="button" className="button--small" onClick={playFromStart} disabled={running} data-testid="explainer-review-play">
                {playing ? '■ 止める' : '▶ 頭から再生'}
              </button>
            </p>
          )}
          <ExplainerStatus />
          {redoable && !running && (
            <>
              <label className="field field--stacked">
                <span className="field__label">作り直すときの追加の要件(任意)</span>
                <textarea
                  rows={3}
                  value={requirement}
                  placeholder="例: もっと短く。最初に結論を言って。専門用語を減らして"
                  onChange={(event) => setRequirement(event.target.value)}
                  data-testid="explainer-review-requirement"
                />
              </label>
              <div className="explainer-review__actions">
                <button
                  type="button"
                  className="button--primary"
                  disabled={redoable.placed.locked}
                  title={redoable.placed.locked ? 'ロックしたものがあるため作り直せません' : '前回の台本をもとに、要件を満たすように書き直す(空なら別の案に)'}
                  onClick={redo}
                  data-testid="explainer-review-redo"
                >
                  作り直す
                </button>
                <button type="button" onClick={openExplainerDialog} data-testid="explainer-review-settings">
                  設定を変えて作り直す…
                </button>
              </div>
              <p className="note">作り直すと、今の解説を消して同じ場所に置き直します。気に入らなければ「元に戻す」で前の解説に戻せます。</p>
            </>
          )}
          {running && (
            <button type="button" className="button--danger" onClick={cancelExplainer} data-testid="explainer-review-cancel">
              やめる
            </button>
          )}
        </div>
      )}
    </aside>
  )
}
