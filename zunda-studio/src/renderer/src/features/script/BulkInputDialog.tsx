import { useState } from 'react'

import type { Character, CharacterId } from '@shared/project/types'

import { Modal } from '../../ui/Modal'

export interface BulkLine {
  characterId: CharacterId
  text: string
}

/**
 * 台本をまとめて貼り付ける。1行が1セリフ。「名前:セリフ」の形なら、その名前のキャラクターに割り当てる。
 * 名前の無い行は、直前に指定した話者(最初は選択中の話者)のセリフになる。
 */
export function parseBulkScript(
  text: string,
  characters: readonly Character[],
  defaultCharacterId: CharacterId
): { lines: BulkLine[]; unknownNames: string[] } {
  const byName = new Map(characters.map((character) => [character.name, character.id]))
  const lines: BulkLine[] = []
  const unknownNames = new Set<string>()
  let current = defaultCharacterId

  for (const raw of text.split(/\r?\n/)) {
    const trimmed = raw.trim()
    if (trimmed === '') continue
    const match = /^([^:：「」]{1,20})[:：](.*)$/.exec(trimmed)
    if (match) {
      const name = match[1]!.trim()
      const body = match[2]!.trim()
      const characterId = byName.get(name)
      if (characterId) {
        current = characterId
        if (body !== '') lines.push({ characterId, text: body })
        continue
      }
      unknownNames.add(name)
    }
    lines.push({ characterId: current, text: trimmed })
  }
  return { lines, unknownNames: [...unknownNames] }
}

interface BulkInputDialogProps {
  characters: Character[]
  defaultCharacterId: CharacterId
  onSubmit: (lines: BulkLine[]) => void
  onClose: () => void
}

export function BulkInputDialog({ characters, defaultCharacterId, onSubmit, onClose }: BulkInputDialogProps): React.JSX.Element {
  const [text, setText] = useState('')
  const parsed = parseBulkScript(text, characters, defaultCharacterId)

  return (
    <Modal
      title="台本をまとめて入力"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose}>
            キャンセル
          </button>
          <button
            type="button"
            disabled={parsed.lines.length === 0}
            onClick={() => onSubmit(parsed.lines)}
            data-testid="bulk-submit"
          >
            {parsed.lines.length}行を追加
          </button>
        </>
      }
    >
      <p className="note">
        1行が1つのセリフになります。「{characters[0]?.name ?? 'ずんだもん'}:セリフ」のように書くと話者を指定できます。
      </p>
      <textarea
        className="bulk__text"
        rows={14}
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={`${characters[0]?.name ?? 'ずんだもん'}:今日はこのゲームをやるのだ！\n${characters[1]?.name ?? '四国めたん'}:始めましょうか。`}
        data-testid="bulk-text"
        autoFocus
      />
      {parsed.unknownNames.length > 0 && (
        <p className="status status--warn">
          見つからない名前: {parsed.unknownNames.join('、')}(名前の部分もセリフとして扱います)
        </p>
      )}
    </Modal>
  )
}
