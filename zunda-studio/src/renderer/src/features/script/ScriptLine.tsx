import { useEffect, useRef } from 'react'

import { formatModelRef } from '@shared/ai/types'
import type { Character, VoiceItem } from '@shared/project/types'

import { formatMs } from '../../lib/time'
import { player } from '../../playback/player'
import type { LineStatus } from '../../state/voice'

interface ScriptLineProps {
  index: number
  line: VoiceItem
  characters: Character[]
  status: LineStatus | undefined
  selected: boolean
  /** 台本の検索で見つかったセリフ。 */
  matched?: boolean
  focusRequested: boolean
  isFirst: boolean
  isLast: boolean
  onSelect: () => void
  onFocusHandled: () => void
  onCommitText: (text: string) => void
  onAddAfter: () => void
  /** このセリフへの相方の返答を作る(Ctrl+Shift+Enter)。 */
  onRequestReply: () => void
  onChangeCharacter: (characterId: string) => void
  onChangeExpression: (expressionId: string | null) => void
  onMove: (direction: -1 | 1) => void
  onDelete: () => void
  onRetry: () => void
  onContextMenu: (event: React.MouseEvent) => void
}

export function ScriptLine(props: ScriptLineProps): React.JSX.Element {
  const { line, characters, status } = props
  const textRef = useRef<HTMLTextAreaElement>(null)
  const character = characters.find((candidate) => candidate.id === line.characterId)

  useEffect(() => {
    if (!props.focusRequested) return
    textRef.current?.focus()
    textRef.current?.select()
    props.onFocusHandled()
  }, [props.focusRequested, props])

  // 外からセリフが変わった(undo 等)ときに入力欄を追従させる。
  useEffect(() => {
    const element = textRef.current
    if (element && document.activeElement !== element && element.value !== line.text) element.value = line.text
  }, [line.text])

  const commit = (): void => {
    const text = textRef.current?.value.trim() ?? ''
    if (text !== '' && text !== line.text) props.onCommitText(text)
    else if (text === '' && textRef.current) textRef.current.value = line.text
  }

  return (
    <li
      className={[
        'script__line',
        props.isLast ? 'script__line--latest' : '',
        props.selected ? 'script__line--selected' : '',
        props.matched ? 'script__line--matched' : ''
      ]
        .filter(Boolean)
        .join(' ')}
      data-line-id={line.id}
      onClick={props.onSelect}
      onContextMenu={(event) => {
        // セリフの入力欄では、文字の切り取り・貼り付けのメニュー(OS 標準)を使う。
        if ((event.target as HTMLElement).tagName === 'TEXTAREA') return
        props.onContextMenu(event)
      }}
      data-testid="script-line"
    >
      <div className="script__lineHeader">
        <span className="script__index">{props.index + 1}</span>
        {props.isLast && (
          <span className="script__latest" data-testid="script-line-latest">
            最新
          </span>
        )}
        <select
          className="script__speakerSelect"
          value={line.characterId}
          onChange={(event) => props.onChangeCharacter(event.target.value)}
          onClick={(event) => event.stopPropagation()}
          aria-label="話者"
        >
          {characters.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.name}
            </option>
          ))}
        </select>
        {character?.portrait && Object.keys(character.portrait.expressions).length > 0 && (
          <select
            className="script__expressionSelect"
            value={line.expressionId ?? ''}
            onChange={(event) => props.onChangeExpression(event.target.value || null)}
            onClick={(event) => event.stopPropagation()}
            aria-label="表情"
            data-testid="line-expression"
          >
            <option value="">表情: 既定</option>
            {Object.values(character.portrait.expressions).map((expression) => (
              <option key={expression.id} value={expression.id}>
                {expression.name}
              </option>
            ))}
          </select>
        )}
        {character && (
          <span className={`script__role script__role--${character.authorRole}`}>
            {character.authorRole === 'ai' ? 'AI' : 'あなた'}
          </span>
        )}
        <span className="script__time">
          {formatMs(line.startMs)}
          {line.synthesis && ` · ${(line.durationMs / 1000).toFixed(2)}秒`}
        </span>
      </div>

      <textarea
        ref={textRef}
        className="script__text"
        defaultValue={line.text}
        rows={2}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && event.shiftKey) {
            // Ctrl+Shift+Enter: このセリフへの相方の返答を作る
            event.preventDefault()
            commit()
            props.onRequestReply()
            return
          }
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault()
            commit()
            props.onAddAfter()
          }
        }}
        aria-label={`${props.index + 1}行目のセリフ`}
        data-testid="script-text"
      />
      {line.displayText && (
        <p className="script__displayText" title="字幕だけ別の文字を出しています(インスペクタで変えられます)" data-testid="script-display-text">
          字幕: {line.displayText}
        </p>
      )}

      <div className="script__lineFooter">
        <SynthesisBadge line={line} status={status} onRetry={props.onRetry} />
        <span className="script__actions" onClick={(event) => event.stopPropagation()}>
          <button
            type="button"
            className="button--small"
            disabled={!line.synthesis}
            onClick={() => void player.play(line.startMs, line.startMs + line.durationMs)}
            title="このセリフを再生"
            data-testid="play-line"
          >
            ▶
          </button>
          <button type="button" className="button--small" disabled={props.isFirst} onClick={() => props.onMove(-1)} title="上へ">
            ↑
          </button>
          <button type="button" className="button--small" disabled={props.isLast} onClick={() => props.onMove(1)} title="下へ">
            ↓
          </button>
          <button type="button" className="button--small" onClick={props.onDelete} data-testid="delete-line">
            削除
          </button>
        </span>
      </div>

      {line.generatedBy && (
        <span className="script__generatedBy" data-testid="generated-by">
          {formatModelRef(line.generatedBy)} が書いたセリフ
        </span>
      )}
    </li>
  )
}

function SynthesisBadge({
  line,
  status,
  onRetry
}: {
  line: VoiceItem
  status: LineStatus | undefined
  onRetry: () => void
}): React.JSX.Element {
  if (status?.state === 'error') {
    return (
      <span className="status status--error" data-testid="synthesis-status" title={status.guidance}>
        合成できません: {status.message}
        <button
          type="button"
          className="button--small"
          onClick={(event) => {
            event.stopPropagation()
            onRetry()
          }}
        >
          再試行
        </button>
      </span>
    )
  }
  if (status || !line.synthesis) {
    return (
      <span className="status" data-testid="synthesis-status">
        合成中…
      </span>
    )
  }
  return (
    <span className="status status--ok" data-testid="synthesis-status">
      合成済み
    </span>
  )
}
