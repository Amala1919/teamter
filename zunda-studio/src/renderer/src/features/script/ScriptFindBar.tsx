import { useEffect, useRef, useState } from 'react'

import { findLines, replaceCommands } from '@shared/script/find'
import type { Character, ItemId, VoiceItem } from '@shared/project/types'

import { useEditorStore } from '../../state/store'

interface ScriptFindBarProps {
  lines: VoiceItem[]
  characters: Character[]
  onClose: () => void
  /** 見つかったセリフ(強調する)。 */
  onMatches: (itemIds: ItemId[]) => void
  onError: (message: string | null) => void
}

/**
 * 台本の検索・置換(Ctrl+F)。↑↓ か Enter で見つかったセリフへ移り、「すべて置換」は1回の取り消しで戻せる。
 */
export function ScriptFindBar({ lines, characters, onClose, onMatches, onError }: ScriptFindBarProps): React.JSX.Element {
  const dispatch = useEditorStore((state) => state.dispatch)
  const setSelection = useEditorStore((state) => state.setSelection)
  const setPlayhead = useEditorStore((state) => state.setPlayhead)
  const selectedItemIds = useEditorStore((state) => state.selectedItemIds)
  const [query, setQuery] = useState('')
  const [replacement, setReplacement] = useState('')
  const [characterId, setCharacterId] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const options = { query, characterId: characterId || null }
  const matches = query === '' ? [] : findLines(lines, options)
  const matchKey = matches.map((line) => line.id).join(',')
  const current = matches.findIndex((line) => selectedItemIds.includes(line.id))

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])
  useEffect(() => {
    onMatches(matchKey === '' ? [] : matchKey.split(','))
  }, [matchKey, onMatches])
  useEffect(() => () => onMatches([]), [onMatches])

  const go = (direction: 1 | -1): void => {
    if (matches.length === 0) return
    const next = current === -1 ? (direction === 1 ? 0 : matches.length - 1) : (current + direction + matches.length) % matches.length
    const line = matches[next]!
    setSelection([line.id], 'script')
    setPlayhead(line.startMs)
    document.querySelector(`[data-line-id="${line.id}"]`)?.scrollIntoView({ block: 'nearest' })
  }

  const replaceAll = (): void => {
    const commands = replaceCommands(lines, options, replacement)
    if (commands.length === 0) return
    const result = dispatch(commands, `セリフの置換(${commands.length}行)`)
    onError(result.ok ? null : result.message)
  }

  return (
    <div
      className="script__find"
      role="search"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          onClose()
        }
      }}
      data-testid="script-find"
    >
      <div className="script__findRow">
        <input
          ref={inputRef}
          type="search"
          value={query}
          placeholder="台本を検索"
          aria-label="台本を検索"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              go(event.shiftKey ? -1 : 1)
            }
          }}
          data-testid="script-find-query"
        />
        <span className="script__findCount" data-testid="script-find-count">
          {query === '' ? '' : matches.length === 0 ? '0件' : `${current === -1 ? '-' : current + 1}/${matches.length}件`}
        </span>
        <button type="button" className="button--small" onClick={() => go(-1)} disabled={matches.length === 0} aria-label="前へ">
          ↑
        </button>
        <button type="button" className="button--small" onClick={() => go(1)} disabled={matches.length === 0} aria-label="次へ" data-testid="script-find-next">
          ↓
        </button>
        <button type="button" className="button--small" onClick={onClose} aria-label="検索を閉じる">
          ×
        </button>
      </div>
      <div className="script__findRow">
        <input
          type="text"
          value={replacement}
          placeholder="置換後の文字"
          aria-label="置換後の文字"
          onChange={(event) => setReplacement(event.target.value)}
          data-testid="script-find-replacement"
        />
        <select value={characterId} onChange={(event) => setCharacterId(event.target.value)} aria-label="検索する話者" data-testid="script-find-speaker">
          <option value="">全員</option>
          {characters.map((character) => (
            <option key={character.id} value={character.id}>
              {character.name}
            </option>
          ))}
        </select>
        <button type="button" className="button--small" onClick={replaceAll} disabled={matches.length === 0} data-testid="script-find-replace-all">
          すべて置換
        </button>
      </div>
    </div>
  )
}
