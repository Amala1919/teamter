import { useState } from 'react'

import type { Command } from '@shared/commands/types'
import { voiceItemsInOrder, itemEndMs } from '@shared/project/queries'
import type { CharacterId } from '@shared/project/types'

import { formatModelRef } from '@shared/ai/types'

import { formatMs } from '../../lib/time'
import { useEditorStore } from '../../state/store'
import { CohostAiBar } from './CohostAiBar'

/** 新しいセリフを前のセリフの後ろに置くときの間隔。 */
const DEFAULT_GAP_MS = 200

interface ScriptPaneProps {
  onError: (message: string | null) => void
}

export function ScriptPane({ onError }: ScriptPaneProps): React.JSX.Element {
  const project = useEditorStore((state) => state.project)
  const dispatch = useEditorStore((state) => state.dispatch)
  const setSelection = useEditorStore((state) => state.setSelection)
  const setPlayhead = useEditorStore((state) => state.setPlayhead)
  const selectedItemIds = useEditorStore((state) => state.selectedItemIds)

  const characters = Object.values(project.characters)
  const lines = voiceItemsInOrder(project)
  const [speakerId, setSpeakerId] = useState<CharacterId | null>(null)
  const activeSpeaker = speakerId ?? characters[0]?.id ?? null

  const run = (commands: Command[], label: string): void => {
    const result = dispatch(commands, label)
    onError(result.ok ? null : result.message)
  }

  const addLine = (): void => {
    if (!activeSpeaker) return
    const lastEnd = lines.length === 0 ? 0 : itemEndMs(lines[lines.length - 1]!)
    run(
      [
        {
          op: 'voice.insert',
          characterId: activeSpeaker,
          text: '新しいセリフ',
          atMs: lines.length === 0 ? 0 : lastEnd + DEFAULT_GAP_MS
        }
      ],
      'セリフの追加'
    )
  }

  const createStarterCharacters = (): void => {
    run(
      [
        {
          op: 'character.create',
          name: 'ずんだもん',
          authorRole: 'user',
          engineId: 'voicevox',
          speakerId: 3,
          speakerName: 'ずんだもん(ノーマル)',
          creditText: 'VOICEVOX:ずんだもん'
        },
        {
          op: 'character.create',
          name: '四国めたん',
          authorRole: 'ai',
          persona: {
            personality: '冷静で少し毒舌だが、面倒見はいい',
            speechStyle: '一人称は「わたくし」。丁寧語まじりで、語尾に「かしら」を使う',
            banterRole: 'tsukkomi',
            forbidden: [],
            targetLengthChars: 40
          },
          engineId: 'voicevox',
          speakerId: 2,
          speakerName: '四国めたん(ノーマル)',
          creditText: 'VOICEVOX:四国めたん'
        }
      ],
      'キャラクターの追加'
    )
  }

  return (
    <section className="pane pane--script">
      <header className="pane__header">
        <h2>台本</h2>
        <span className="pane__count">{lines.length}行</span>
      </header>

      {characters.length === 0 ? (
        <div className="pane__empty">
          <p>キャラクターがまだありません。</p>
          <button type="button" onClick={createStarterCharacters}>
            ずんだもん(あなた)と四国めたん(AI)を追加
          </button>
          <p className="note">
            Phase 1 で VOICEVOX から話者一覧を取得して選べるようにする。ここでは仮の設定を作る。
          </p>
        </div>
      ) : (
        <>
          <CohostAiBar onError={onError} />
          <div className="script__controls">
            <select
              value={activeSpeaker ?? ''}
              onChange={(event) => setSpeakerId(event.target.value)}
              aria-label="追加するセリフの話者"
            >
              {characters.map((character) => (
                <option key={character.id} value={character.id}>
                  {character.name}
                </option>
              ))}
            </select>
            <button type="button" onClick={addLine}>
              セリフを追加
            </button>
            <button type="button" disabled title="Phase 4 で有効になる">
              相方の返答を生成
            </button>
          </div>

          <ol className="script__lines">
            {lines.map((line, index) => {
              const character = project.characters[line.characterId]
              const selected = selectedItemIds.includes(line.id)
              return (
                <li
                  key={line.id}
                  className={selected ? 'script__line script__line--selected' : 'script__line'}
                  onClick={() => {
                    setSelection([line.id])
                    setPlayhead(line.startMs)
                  }}
                >
                  <div className="script__lineHeader">
                    <span className="script__index">{index + 1}</span>
                    <span className="script__speaker">{character?.name ?? '不明な話者'}</span>
                    {character && (
                      <span className={`script__role script__role--${character.authorRole}`}>
                        {character.authorRole === 'ai' ? 'AI' : 'あなた'}
                      </span>
                    )}
                    <span className="script__time">{formatMs(line.startMs)}</span>
                    <button
                      type="button"
                      className="script__delete"
                      onClick={(event) => {
                        event.stopPropagation()
                        run([{ op: 'item.delete', itemId: line.id }], 'セリフの削除')
                      }}
                    >
                      削除
                    </button>
                  </div>
                  <textarea
                    className="script__text"
                    defaultValue={line.text}
                    rows={2}
                    onBlur={(event) => {
                      const text = event.target.value.trim()
                      if (text === '' || text === line.text) return
                      run([{ op: 'voice.setText', itemId: line.id, text }], 'セリフの編集')
                    }}
                  />
                  {line.generatedBy && (
                    <span className="script__generatedBy" data-testid="generated-by">
                      {formatModelRef(line.generatedBy)} が書いたセリフ
                    </span>
                  )}
                  {line.synthesis === null && (
                    <span className="script__pending">
                      未合成(尺は文字数からの暫定値。Phase 1 で実測値に置き換わる)
                    </span>
                  )}
                </li>
              )
            })}
          </ol>
        </>
      )}
    </section>
  )
}
