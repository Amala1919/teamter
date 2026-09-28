import { useState } from 'react'

import { newFactId, quoteInMemo } from '@shared/ai/briefing'
import { formatModelRef } from '@shared/ai/types'
import type { BriefingFact, BriefingFactStatus, ProjectBriefing } from '@shared/project/types'

import { api, toAppError } from '../../api'
import { useSettingsStore } from '../../state/settings'
import { useEditorStore } from '../../state/store'
import { Modal } from '../../ui/Modal'

const ORIGIN_LABELS: Record<BriefingFact['origin'], string> = {
  memo: '企画メモより',
  ai: 'AIが補った知識',
  user: '自分で書いた'
}

const STATUS_LABELS: Record<BriefingFactStatus, string> = {
  confirmed: '使う(確認済み)',
  unverified: '未確認',
  rejected: '使わない'
}

const VERDICT_LABELS = {
  supported: '裏付けあり',
  contradicted: '誤りの可能性',
  unclear: '確かめられず'
} as const

type Busy = null | 'generate' | 'check'

/**
 * 企画メモと、そこから作る相方のスタンス・前提知識。
 * 前提知識は動画の中で事実として話されるので、AI が補った知識は裏付けの確認(使えればウェブ検索)を経て、
 * 利用者が「使う」にしたものだけを AI への依頼に入れる(shared/ai/briefing.ts)。
 */
export function SynopsisDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const project = useEditorStore((state) => state.project)
  const dispatch = useEditorStore((state) => state.dispatch)
  const editorModel = useSettingsStore((state) => state.settings?.ai.roles.editor ?? null)
  const synopsis = project.meta.synopsis ?? ''
  const [memo, setMemo] = useState(synopsis)
  const [briefing, setBriefing] = useState<ProjectBriefing | null>(project.ai.briefing ?? null)
  const [busy, setBusy] = useState<Busy>(null)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error' | 'info'; text: string } | null>(null)

  const projectWithMemo = { ...project, meta: { ...project.meta, synopsis: memo } }
  const stale = briefing !== null && briefing.sourceSynopsis.replace(/\s+/g, '') !== memo.trim().replace(/\s+/g, '')
  const counts = { confirmed: 0, unverified: 0, rejected: 0 }
  for (const fact of briefing?.facts ?? []) counts[fact.status] += 1

  const fail = (error: unknown): void => {
    const appError = toAppError(error)
    setMessage({ kind: 'error', text: `${appError.message}。${appError.guidance}` })
  }

  const check = async (base: ProjectBriefing, factIds: string[] | null): Promise<void> => {
    setBusy('check')
    setMessage({ kind: 'info', text: '前提知識の裏付けを確かめています(ウェブ検索を使うときは数分かかることがあります)…' })
    try {
      const result = await api.invoke('ai:briefingCheck', projectWithMemo, base, factIds)
      setBriefing(result.briefing)
      setMessage(
        result.checked === 0
          ? { kind: 'info', text: '確かめる項目はありません(企画メモにある項目と「使わない」項目は確かめません)。' }
          : {
              kind: 'ok',
              text: result.webSearched
                ? `${result.checked}件をウェブで確かめました。出典を開いて内容を確かめ、正しいものを「使う」にしてください。`
                : `${result.checked}件を AI の知識で見直しました(ウェブ検索は使えませんでした。編集AIを Claude にするとウェブで確かめられます)。自分で確かめてから「使う」にしてください。`
            }
      )
    } catch (error) {
      fail(error)
    } finally {
      setBusy(null)
    }
  }

  const generate = async (): Promise<void> => {
    setBusy('generate')
    setMessage({ kind: 'info', text: '企画メモから相方のスタンスと前提知識を作っています…' })
    try {
      const created = await api.invoke('ai:briefing', projectWithMemo)
      setBriefing(created)
      // 作ったらそのまま、AI が補った知識の裏付けを確かめる。
      await check(created, null)
    } catch (error) {
      fail(error)
      setBusy(null)
    }
  }

  const updateFact = (id: string, patch: Partial<BriefingFact>): void => {
    if (!briefing) return
    setBriefing({ ...briefing, facts: briefing.facts.map((fact) => (fact.id === id ? { ...fact, ...patch } : fact)) })
  }

  const save = (): void => {
    const commands = []
    if (memo !== synopsis) commands.push({ op: 'project.setMeta' as const, synopsis: memo })
    // 書きかけで空のままの項目は保存しない。
    const cleaned = briefing ? { ...briefing, facts: briefing.facts.filter((fact) => fact.text.trim() !== '') } : null
    if (JSON.stringify(cleaned) !== JSON.stringify(project.ai.briefing ?? null)) {
      commands.push({ op: 'project.setBriefing' as const, briefing: cleaned ? { ...cleaned, updatedAt: new Date().toISOString() } : null })
    }
    if (commands.length > 0) {
      const result = dispatch(commands, '企画メモと前提の保存')
      if (!result.ok) {
        setMessage({ kind: 'error', text: result.message })
        return
      }
    }
    onClose()
  }

  const supportedIds = (briefing?.facts ?? [])
    .filter((fact) => fact.status === 'unverified' && fact.check?.verdict === 'supported' && fact.check.webSearched)
    .map((fact) => fact.id)

  return (
    <Modal
      title="企画メモと相方の前提"
      onClose={onClose}
      wide
      footer={
        <button type="button" className="button--primary" onClick={save} disabled={busy !== null} data-testid="synopsis-save">
          保存
        </button>
      }
    >
      <p className="note">動画の題材や見どころを書いておくと、相方の返答や編集AIが話題からそれにくくなります。</p>
      <textarea
        rows={6}
        className="synopsis__text"
        value={memo}
        placeholder="例: 初見でホラーゲーム『〇〇』を遊ぶ回。ずんだもんが怖がり、めたんが冷静にツッコむ。見どころはボス戦の逆転。"
        onChange={(event) => setMemo(event.target.value)}
        data-testid="synopsis-text"
      />

      <section className="briefing" data-testid="briefing">
        <h3>相方のスタンスと前提知識</h3>
        <p className="note">
          企画メモから、相方がこの動画で取る立ち位置と、会話で使う前提知識を作ります。前提知識は動画の中で事実として話されるので、
          <strong>「使う」にした項目だけ</strong>が相方・編集AI・ライブの返答に渡ります。AI が補った知識は誤り・古い情報のことがあるので、
          裏付けの結果と出典を見て、自分で確かめてから「使う」にしてください。
        </p>
        <div className="field__row field__row--wrap">
          <button
            type="button"
            onClick={() => void generate()}
            disabled={busy !== null || memo.trim() === '' || editorModel === null}
            title={editorModel === null ? '編集AIが未設定です(設定 → AI)' : memo.trim() === '' ? '先に企画メモを書いてください' : undefined}
            data-testid="briefing-generate"
          >
            {busy === 'generate' ? '作っています…' : briefing ? '企画メモから作り直す' : '企画メモから作る'}
          </button>
          {briefing && (
            <button type="button" onClick={() => void check(briefing, null)} disabled={busy !== null || editorModel === null} data-testid="briefing-check">
              {busy === 'check' ? '確かめています…' : '未確認の知識の裏付けを確かめる'}
            </button>
          )}
          {supportedIds.length > 0 && (
            <button
              type="button"
              onClick={() =>
                briefing &&
                setBriefing({ ...briefing, facts: briefing.facts.map((fact) => (supportedIds.includes(fact.id) ? { ...fact, status: 'confirmed' } : fact)) })
              }
              disabled={busy !== null}
              title="ウェブで出典が見つかった項目を「使う」にします。出典は自分でも開いて確かめてください"
              data-testid="briefing-confirm-supported"
            >
              出典のある項目({supportedIds.length}件)を使う
            </button>
          )}
          {editorModel && <span className="note">編集AI: {formatModelRef(editorModel)}</span>}
        </div>
        {message && (
          <p className={`status ${message.kind === 'error' ? 'status--error' : message.kind === 'ok' ? 'status--ok' : ''}`} data-testid="briefing-message">
            {message.text}
          </p>
        )}
        {stale && (
          <p className="status status--warn" data-testid="briefing-stale">
            企画メモが、前提を作ったときから変わっています。必要なら作り直してください。
          </p>
        )}

        {briefing && (
          <>
            <label className="field">
              <span className="field__label">相方のスタンス</span>
              <textarea
                rows={3}
                value={briefing.stance}
                onChange={(event) => setBriefing({ ...briefing, stance: event.target.value })}
                data-testid="briefing-stance"
              />
            </label>

            <div className="briefing__summary" data-testid="briefing-summary">
              前提知識: 使う {counts.confirmed}件 / 未確認 {counts.unverified}件 / 使わない {counts.rejected}件
            </div>
            <ul className="briefing__facts">
              {briefing.facts.map((fact) => (
                <FactRow
                  key={fact.id}
                  fact={fact}
                  memo={memo}
                  disabled={busy !== null}
                  onChange={(patch) => updateFact(fact.id, patch)}
                  onDelete={() => setBriefing({ ...briefing, facts: briefing.facts.filter((other) => other.id !== fact.id) })}
                  onCheck={() => void check(briefing, [fact.id])}
                />
              ))}
            </ul>
            <div className="field__row field__row--wrap">
              <button
                type="button"
                className="button--small"
                onClick={() =>
                  setBriefing({
                    ...briefing,
                    facts: [...briefing.facts, { id: newFactId(), text: '', origin: 'user', quote: null, status: 'confirmed', checkHint: null, check: null }]
                  })
                }
                data-testid="briefing-add"
              >
                前提知識を書き足す
              </button>
              <button type="button" className="button--small button--danger" onClick={() => setBriefing(null)} data-testid="briefing-clear">
                前提を消す
              </button>
            </div>
            {briefing.questions.length > 0 && (
              <div className="briefing__questions" data-testid="briefing-questions">
                <strong>AIからの確認事項</strong>(企画メモに書き足すと、次に作るときに使われます)
                <ul>
                  {briefing.questions.map((question) => (
                    <li key={question}>{question}</li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </section>
    </Modal>
  )
}

function FactRow({
  fact,
  memo,
  disabled,
  onChange,
  onDelete,
  onCheck
}: {
  fact: BriefingFact
  memo: string
  disabled: boolean
  onChange: (patch: Partial<BriefingFact>) => void
  onDelete: () => void
  onCheck: () => void
}): React.JSX.Element {
  const check = fact.check
  const quoteMissing = fact.origin === 'memo' && fact.quote !== null && !quoteInMemo(fact.quote, memo)
  return (
    <li className={`briefing__fact briefing__fact--${fact.status}`} data-testid="briefing-fact" data-status={fact.status} data-origin={fact.origin}>
      <div className="briefing__factHeader">
        <span className={`briefing__origin briefing__origin--${fact.origin}`} data-testid="briefing-fact-origin">
          {ORIGIN_LABELS[fact.origin]}
        </span>
        <span className="segmented briefing__status" role="radiogroup" aria-label="この前提知識を使うか">
          {(['confirmed', 'unverified', 'rejected'] as const).map((status) => (
            <button
              key={status}
              type="button"
              className={fact.status === status ? 'chip chip--active' : 'chip'}
              aria-pressed={fact.status === status}
              disabled={disabled}
              onClick={() => onChange({ status })}
              data-testid={`briefing-fact-${status}`}
            >
              {STATUS_LABELS[status]}
            </button>
          ))}
        </span>
      </div>
      <textarea
        rows={2}
        className="briefing__text"
        value={fact.text}
        placeholder="例: このシリーズは第3話で、前回は満州を攻略した"
        disabled={disabled}
        // 書き換えた内容は利用者が書いたものとして扱う(AI の確認の結果は古くなるので外す)。
        onChange={(event) => onChange({ text: event.target.value, origin: 'user', quote: null, check: null })}
        data-testid="briefing-fact-text"
      />
      {fact.quote && (
        <p className="note">
          メモの該当箇所: 「{fact.quote}」{quoteMissing && <span className="status status--warn">(今のメモには見当たりません)</span>}
        </p>
      )}
      {fact.checkHint && <p className="note">確かめる点: {fact.checkHint}</p>}
      {check && (
        <div className={`briefing__check briefing__check--${check.verdict}`} data-testid="briefing-fact-check">
          <strong data-testid="briefing-fact-verdict">{VERDICT_LABELS[check.verdict]}</strong>
          <span className="note">{check.webSearched ? '(ウェブで確認)' : '(AIの知識だけで見直し。ウェブでは未確認)'}</span>
          <div>{check.reason}</div>
          {check.sources.length > 0 && (
            <ul className="briefing__sources">
              {check.sources.map((source) => (
                <li key={source.url}>
                  <a href={source.url} target="_blank" rel="noreferrer" data-testid="briefing-fact-source">
                    {source.title}
                  </a>
                </li>
              ))}
            </ul>
          )}
          {check.suggestion && (
            <div>
              修正案: {check.suggestion}{' '}
              <button
                type="button"
                className="button--small"
                disabled={disabled}
                onClick={() =>
                  onChange({
                    text: check.suggestion ?? fact.text,
                    origin: 'ai',
                    quote: null,
                    status: 'unverified',
                    check: null,
                    checkHint: 'AIの確認で出た修正案です。もう一度確かめてください'
                  })
                }
                data-testid="briefing-fact-suggest"
              >
                修正案に置き換える
              </button>
            </div>
          )}
        </div>
      )}
      <div className="field__row">
        {fact.origin !== 'memo' && (
          <button type="button" className="button--small" disabled={disabled || fact.text.trim() === ''} onClick={onCheck} data-testid="briefing-fact-recheck">
            この項目を確かめる
          </button>
        )}
        <button type="button" className="button--small button--danger" disabled={disabled} onClick={onDelete} data-testid="briefing-fact-delete">
          削除
        </button>
      </div>
    </li>
  )
}
