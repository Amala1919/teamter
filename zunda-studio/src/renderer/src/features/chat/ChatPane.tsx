import { useEffect, useMemo, useRef, useState } from 'react'

import { formatModelRef } from '@shared/ai/types'
import type { Command } from '@shared/commands/types'
import type { ChatMessage } from '@shared/project/types'

import { formatDurationJa } from '../../lib/time'
import { dryRun, useChatStore } from '../../state/ai'
import { useSettingsStore } from '../../state/settings'
import { useEditorStore } from '../../state/store'
import { DraftDialog } from './DraftDialog'
import { ExplainerDialog } from './ExplainerDialog'
import { PortraitAiDialog } from './PortraitAiDialog'

/** 差分に並べるセリフの上限。多いときは「他N件」にまとめる。 */
const SCRIPT_PREVIEW = 8

/**
 * 編集AIとのチャット(AI_EDIT_PROTOCOL.md 3章・7章)。
 * AI の提案はコマンド列として届き、差分を見てから「適用」したときだけ、1回の取り消しで戻せる単位で反映する。
 */
export function ChatPane(): React.JSX.Element {
  const messages = useEditorStore((state) => state.project.chat.messages)
  const editorModel = useSettingsStore((state) => state.settings?.ai.roles.editor ?? null)
  const sending = useChatStore((state) => state.sending)
  const send = useChatStore((state) => state.send)
  const [draft, setDraft] = useState('')
  const [draftOpen, setDraftOpen] = useState(false)
  const [portraitOpen, setPortraitOpen] = useState(false)
  const [explainerOpen, setExplainerOpen] = useState(false)
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const log = logRef.current
    if (log) log.scrollTop = log.scrollHeight
  }, [messages.length, sending])

  const submit = (): void => {
    if (draft.trim() === '' || sending || !editorModel) return
    const text = draft
    setDraft('')
    void send(text)
  }

  return (
    <div className="chat" data-testid="chat">
      <div className="chat__header">
        <p className="chat__model chat__model--header">{editorModel ? `編集AI: ${formatModelRef(editorModel)}` : '編集AI 未設定'}</p>
        <button type="button" className="button--small" disabled={!editorModel || sending} onClick={() => setDraftOpen(true)} data-testid="open-draft">
          録画から下書き
        </button>
        <button type="button" className="button--small" disabled={!editorModel || sending} onClick={() => setPortraitOpen(true)} data-testid="open-portrait-ai">
          立ち絵をAIで調整
        </button>
        <button type="button" className="button--small" onClick={() => setExplainerOpen(true)} data-testid="open-explainer" title="お題と長さを決めると、AI が解説の台本を書き、セリフと参考画像を並べる">
          解説パートを作る
        </button>
      </div>
      {draftOpen && <DraftDialog onClose={() => setDraftOpen(false)} />}
      {portraitOpen && <PortraitAiDialog onClose={() => setPortraitOpen(false)} />}
      {explainerOpen && <ExplainerDialog onClose={() => setExplainerOpen(false)} />}

      <div className="chat__log" ref={logRef}>
        {messages.length === 0 ? (
          <p className="pane__empty">
            台本や演出の変更を頼めます。AIの提案は、変更点を確かめてから適用します。
            <br />
            例: 「テンポを上げたいので相方のセリフを短くして」「ボス登場のところで左上に寄って」
          </p>
        ) : (
          messages.map((message) => <ChatEntry key={message.id} message={message} />)
        )}
        {sending && <p className="status" data-testid="chat-sending">編集AIが考えています…</p>}
      </div>

      {!editorModel && <p className="status status--warn">編集AIが未設定です(設定 → AI)</p>}
      <form
        className="chat__input"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <textarea
          rows={3}
          value={draft}
          placeholder="例: テンポを上げたいので各セリフを短くして(Ctrl+Enter で送信)"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault()
              submit()
            }
          }}
          disabled={!editorModel}
          data-testid="chat-input"
        />
        <button type="submit" disabled={!editorModel || sending || draft.trim() === ''} data-testid="chat-send">
          送信
        </button>
      </form>
    </div>
  )
}

function ChatEntry({ message }: { message: ChatMessage }): React.JSX.Element {
  if (message.role === 'user') {
    return (
      <article className="chat__message chat__message--user" data-testid="chat-message-user">
        <p>{message.content}</p>
      </article>
    )
  }
  return (
    <article className="chat__message chat__message--assistant" data-testid="chat-message-assistant">
      {message.error ? (
        <p className="status status--error" role="alert">
          {message.error}
        </p>
      ) : (
        <p>{message.content}</p>
      )}
      {message.proposedCommands && message.proposedCommands.length > 0 && <Proposal message={message} />}
      {message.generatedBy && <span className="chat__model">{formatModelRef(message.generatedBy)}</span>}
    </article>
  )
}

function Proposal({ message }: { message: ChatMessage }): React.JSX.Element {
  const project = useEditorStore((state) => state.project)
  const apply = useChatStore((state) => state.apply)
  const reject = useChatStore((state) => state.reject)
  const [error, setError] = useState<string | null>(null)
  const commands = message.proposedCommands as Command[]
  // 今のプロジェクトに当てたらどうなるかを、その都度計算して見せる(提案の後に手で編集していても正しく出る)。
  const result = useMemo(() => (message.outcome ? null : dryRun(commands)), [project, commands, message.outcome])

  if (message.outcome) {
    return (
      <p className={message.outcome === 'applied' ? 'status status--ok' : 'status'} data-testid="proposal-outcome">
        {message.outcome === 'applied' ? `適用しました(${commands.length}件の操作。元に戻すで取り消せます)` : '適用しませんでした'}
      </p>
    )
  }

  return (
    <div className="proposal" data-testid="proposal">
      {result && !result.ok ? (
        <p className="status status--error" data-testid="proposal-invalid">
          この提案は今のプロジェクトに適用できません: {result.message}
        </p>
      ) : (
        result?.ok && (
          <>
            <p className="proposal__summary">
              {result.diff.script.length > 0 && `台本を${result.diff.script.length}件変更します`}
              {result.diff.empty && '見た目の変化はありません'}
            </p>
            <ul className="proposal__script">
              {result.diff.script.slice(0, SCRIPT_PREVIEW).map((change) => (
                <li key={`${change.kind}-${change.index}-${change.before ?? ''}`} data-testid="proposal-line">
                  <span className="proposal__speaker">
                    #{change.index} {change.speaker}
                    {change.notes.length > 0 && `(${change.notes.join('・')})`}
                  </span>
                  {change.before !== null && change.before !== change.after && <del className="proposal__before">- {change.before}</del>}
                  {change.after !== null && change.before !== change.after && <ins className="proposal__after">+ {change.after}</ins>}
                </li>
              ))}
              {result.diff.script.length > SCRIPT_PREVIEW && <li className="note">… 他{result.diff.script.length - SCRIPT_PREVIEW}件</li>}
            </ul>
            {result.diff.others.length > 0 && (
              <ul className="proposal__others">
                {result.diff.others.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}
            <p className="proposal__duration" data-testid="proposal-duration">
              尺: {formatDurationJa(result.diff.durationBeforeMs)} → {formatDurationJa(result.diff.durationAfterMs)}
              {result.diff.script.some((change) => change.kind !== 'removed' && change.before !== change.after) && '(セリフの尺は合成後に確定)'}
            </p>
          </>
        )
      )}
      {error && <p className="status status--error">{error}</p>}
      <div className="proposal__actions">
        <button
          type="button"
          className="button--small button--primary"
          disabled={!result?.ok}
          onClick={() => setError(apply(message))}
          data-testid="proposal-apply"
        >
          適用
        </button>
        <button type="button" className="button--small" onClick={() => reject(message)} data-testid="proposal-reject">
          却下
        </button>
      </div>
    </div>
  )
}
