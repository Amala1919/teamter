import { useEffect, useState } from 'react'

import type { Command } from '@shared/commands/types'
import { itemEndMs, voiceItemsInOrder } from '@shared/project/queries'
import type { CharacterId, ItemId } from '@shared/project/types'

import { player } from '../../playback/player'
import { useCohostStore } from '../../state/ai'
import { copySelection } from '../../state/edit-actions'
import { useEditorStore } from '../../state/store'
import { characterLook } from '../../state/subtitle-defaults'
import { useVoiceStore } from '../../state/voice'
import { openContextMenu } from '../../ui/ContextMenu'
import { CharacterDialog } from '../characters/CharacterDialog'
import { BulkInputDialog, type BulkLine } from './BulkInputDialog'
import { CohostAiBar } from './CohostAiBar'
import { CohostControls } from './CohostPanel'
import { ScriptFindBar } from './ScriptFindBar'
import { ScriptLine } from './ScriptLine'

interface ScriptPaneProps {
  onError: (message: string | null) => void
}

export function ScriptPane({ onError }: ScriptPaneProps): React.JSX.Element {
  const project = useEditorStore((state) => state.project)
  const dispatch = useEditorStore((state) => state.dispatch)
  const setSelection = useEditorStore((state) => state.setSelection)
  const setPlayhead = useEditorStore((state) => state.setPlayhead)
  const selectedItemIds = useEditorStore((state) => state.selectedItemIds)
  const lineStatuses = useVoiceStore((state) => state.lines)
  const retry = useVoiceStore((state) => state.retry)
  const requestGenerate = useCohostStore((state) => state.requestGenerate)

  const characters = Object.values(project.characters)
  const lines = voiceItemsInOrder(project)
  const [speakerId, setSpeakerId] = useState<CharacterId | null>(null)
  const [focusItemId, setFocusItemId] = useState<ItemId | null>(null)
  const [dialog, setDialog] = useState<'characters' | 'bulk' | null>(null)
  const [findOpen, setFindOpen] = useState(false)
  const [matchedIds, setMatchedIds] = useState<ItemId[]>([])
  const activeSpeaker =
    speakerId && project.characters[speakerId] ? speakerId : (characters[0]?.id ?? null)

  // Ctrl+F: 台本の検索を開く(ダイアログを開いている間は効かせない)。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== 'f') return
      if (document.querySelector('[role="dialog"]')) return
      event.preventDefault()
      setFindOpen(true)
      // 既に開いていれば検索欄へ戻す。
      document.querySelector<HTMLInputElement>('[data-testid="script-find-query"]')?.focus()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const run = (commands: Command[], label: string): Record<string, string> | null => {
    const result = dispatch(commands, label)
    onError(result.ok ? null : result.message)
    return result.ok ? result.resolvedIds : null
  }

  /** そのセリフを選んで、相方の返答を頼む(台本の下の操作欄が今の設定で作る)。 */
  const requestReply = (itemId: ItemId): void => {
    setSelection([itemId], 'script')
    requestGenerate()
  }

  /** 2人の掛け合いでは、次のセリフはもう一方の話者であることが多い。 */
  const otherSpeaker = (characterId: CharacterId): CharacterId => {
    if (characters.length !== 2) return characterId
    return characters.find((character) => character.id !== characterId)?.id ?? characterId
  }

  const appendLine = (characterId: CharacterId, text = '…'): void => {
    const last = lines[lines.length - 1]
    const resolved = run(
      [
        last
          ? { op: 'voice.insert', characterId, text, afterItemId: last.id, tempId: 'new' }
          : { op: 'voice.insert', characterId, text, atMs: 0, tempId: 'new' }
      ],
      'セリフの追加'
    )
    if (resolved?.['new']) setFocusItemId(resolved['new'])
  }

  const addAfter = (afterId: ItemId, characterId: CharacterId): void => {
    const resolved = run(
      [{ op: 'voice.insert', characterId: otherSpeaker(characterId), text: '…', afterItemId: afterId, tempId: 'new' }],
      'セリフの追加'
    )
    if (resolved?.['new']) setFocusItemId(resolved['new'])
  }

  const addBulk = (bulk: BulkLine[]): void => {
    const last = lines[lines.length - 1]
    const commands: Command[] = bulk.map((line, index) => {
      const tempId = `bulk_${index}`
      const previous = index === 0 ? last?.id : `bulk_${index - 1}`
      return previous
        ? { op: 'voice.insert', characterId: line.characterId, text: line.text, afterItemId: previous, tempId }
        : { op: 'voice.insert', characterId: line.characterId, text: line.text, atMs: 0, tempId }
    })
    if (run(commands, `台本の追加(${bulk.length}行)`)) setDialog(null)
  }

  const move = (index: number, direction: -1 | 1): void => {
    const line = lines[index]
    if (!line) return
    // 1つ上へ = 2つ上の後ろへ。1つ下へ = 1つ下の後ろへ。
    const afterIndex = direction === -1 ? index - 2 : index + 1
    const after = afterIndex < 0 ? null : (lines[afterIndex]?.id ?? null)
    if (direction === 1 && !lines[index + 1]) return
    run([{ op: 'voice.move', itemId: line.id, afterItemId: after }], 'セリフの並べ替え')
  }

  const createStarterCharacters = (): void => {
    run(
      [
        {
          op: 'style.upsertSubtitle',
          props: { ...characterLook('#2b7a0b'), name: 'ずんだもん' },
          tempId: 'zundaStyle'
        },
        {
          op: 'style.upsertSubtitle',
          props: { ...characterLook('#a0306a'), name: '四国めたん' },
          tempId: 'metanStyle'
        },
        {
          op: 'character.create',
          name: 'ずんだもん',
          authorRole: 'user',
          engineId: 'voicevox',
          speakerId: 3,
          speakerName: 'ずんだもん(ノーマル)',
          subtitleStyleId: 'zundaStyle',
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
          subtitleStyleId: 'metanStyle',
          creditText: 'VOICEVOX:四国めたん'
        }
      ],
      'キャラクターの追加'
    )
  }

  const failedCount = lines.filter((line) => lineStatuses[line.id]?.state === 'error').length
  const firstFailure = lines.map((line) => lineStatuses[line.id]).find((status) => status?.state === 'error')

  return (
    <section className="pane pane--script">
      <header className="pane__header">
        <h2>台本</h2>
        <button type="button" className="button--small" onClick={() => setDialog('characters')} data-testid="open-characters">
          キャラクター
        </button>
        <button type="button" className="button--small" onClick={() => setFindOpen((open) => !open)} disabled={lines.length === 0} title="台本の検索・置換(Ctrl+F)" data-testid="open-script-find">
          検索
        </button>
        <span className="pane__count">{lines.length}行</span>
      </header>
      {findOpen && lines.length > 0 && (
        <ScriptFindBar lines={lines} characters={characters} onClose={() => setFindOpen(false)} onMatches={setMatchedIds} onError={onError} />
      )}

      {characters.length === 0 ? (
        <div className="pane__empty">
          <p>キャラクターがまだありません。</p>
          <button type="button" onClick={createStarterCharacters}>
            ずんだもん(あなた)と四国めたん(AI)を追加
          </button>
          <button type="button" onClick={() => setDialog('characters')}>
            キャラクターを自分で設定する
          </button>
        </div>
      ) : (
        <>
          <CohostAiBar onError={onError} />
          <div className="script__controls">
            <select
              value={activeSpeaker ?? ''}
              onChange={(event) => setSpeakerId(event.target.value)}
              aria-label="追加するセリフの話者"
              data-testid="add-speaker"
            >
              {characters.map((character) => (
                <option key={character.id} value={character.id}>
                  {character.name}
                </option>
              ))}
            </select>
            <button type="button" onClick={() => activeSpeaker && appendLine(activeSpeaker)} data-testid="add-line">
              セリフを追加
            </button>
            <button type="button" onClick={() => setDialog('bulk')} data-testid="open-bulk">
              まとめて入力
            </button>
          </div>

          {failedCount > 0 && firstFailure?.state === 'error' && (
            <div className="banner banner--error" role="alert" data-testid="synthesis-banner">
              <span>
                {failedCount}行を合成できません: {firstFailure.message}。{firstFailure.guidance}
              </span>
              <button type="button" onClick={() => retry()}>
                すべて再試行
              </button>
            </div>
          )}

          <ol className="script__lines">
            {lines.map((line, index) => (
              <ScriptLine
                key={line.id}
                index={index}
                line={line}
                characters={characters}
                status={lineStatuses[line.id]}
                selected={selectedItemIds.includes(line.id)}
                matched={matchedIds.includes(line.id)}
                focusRequested={focusItemId === line.id}
                isFirst={index === 0}
                isLast={index === lines.length - 1}
                onSelect={() => {
                  setSelection([line.id], 'script')
                  setPlayhead(line.startMs)
                }}
                onFocusHandled={() => setFocusItemId(null)}
                onCommitText={(text) => run([{ op: 'voice.setText', itemId: line.id, text }], 'セリフの編集')}
                onAddAfter={() => addAfter(line.id, line.characterId)}
                onRequestReply={() => requestReply(line.id)}
                onChangeCharacter={(characterId) =>
                  run([{ op: 'voice.setCharacter', itemId: line.id, characterId }], '話者の変更')
                }
                onChangeExpression={(expressionId) =>
                  run([{ op: 'voice.setExpression', itemId: line.id, expressionId }], '表情の変更')
                }
                onMove={(direction) => move(index, direction)}
                onDelete={() => run([{ op: 'voice.delete', itemId: line.id }], 'セリフの削除')}
                onRetry={() => retry(line.id)}
                onContextMenu={(event) => {
                  setSelection([line.id], 'script')
                  const character = characters.find((candidate) => candidate.id === line.characterId)
                  const expressions = character?.portrait ? Object.values(character.portrait.expressions) : []
                  openContextMenu(event, [
                    { label: 'このセリフを再生', disabled: !line.synthesis, onSelect: () => void player.play(line.startMs, line.startMs + line.durationMs) },
                    // 読み方・声の調整などは右の欄のインスペクタで直す
                    { label: 'インスペクタで開く(読み方・声の調整)', onSelect: () => setSelection([line.id], 'other'), testId: 'menu-line-inspector' },
                    { label: '再生位置をここへ', onSelect: () => setPlayhead(line.startMs) },
                    'separator',
                    { label: 'このセリフへの返答を作る', shortcut: 'Ctrl+Shift+Enter', onSelect: () => requestReply(line.id), testId: 'menu-line-cohost' },
                    { label: '次にセリフを追加', shortcut: 'Ctrl+Enter', onSelect: () => addAfter(line.id, line.characterId), testId: 'menu-line-add-after' },
                    {
                      label: '話者',
                      submenu: characters.map((candidate) => ({
                        label: candidate.name,
                        checked: candidate.id === line.characterId,
                        onSelect: () => run([{ op: 'voice.setCharacter', itemId: line.id, characterId: candidate.id }], '話者の変更')
                      })),
                      testId: 'menu-line-speaker'
                    },
                    ...(expressions.length > 0
                      ? [
                          {
                            label: '表情',
                            submenu: [
                              { label: '既定', checked: line.expressionId === null, onSelect: () => run([{ op: 'voice.setExpression', itemId: line.id, expressionId: null }], '表情の変更') },
                              ...expressions.map((expression) => ({
                                label: expression.name,
                                checked: expression.id === line.expressionId,
                                onSelect: () => run([{ op: 'voice.setExpression', itemId: line.id, expressionId: expression.id }], '表情の変更')
                              }))
                            ]
                          }
                        ]
                      : []),
                    {
                      label: line.subtitleHidden ? '字幕を出す' : '字幕を出さない',
                      onSelect: () =>
                        run(
                          [{ op: 'voice.setSubtitleHidden', itemIds: [line.id], hidden: !line.subtitleHidden }],
                          line.subtitleHidden ? '字幕を出す' : '字幕を出さない'
                        ),
                      testId: 'menu-line-subtitle-hidden'
                    },
                    'separator',
                    { label: '上へ', disabled: index === 0, onSelect: () => move(index, -1) },
                    { label: '下へ', disabled: index === lines.length - 1, onSelect: () => move(index, 1) },
                    { label: 'コピー', onSelect: () => copySelection([line.id]) },
                    'separator',
                    { label: '削除', danger: true, onSelect: () => run([{ op: 'voice.delete', itemId: line.id }], 'セリフの削除'), testId: 'menu-line-delete' }
                  ])
                }}
              />
            ))}
          </ol>
          {lines.length > 0 && (
            <p className="note">
              Ctrl+Enter で次のセリフを追加(2人なら話者が交互になります)。Ctrl+Shift+Enter で選んでいるセリフへの返答を作ります。全体の尺:{' '}
              {(itemEndMs(lines[lines.length - 1]!) / 1000).toFixed(1)}秒
            </p>
          )}
          {/* 相方の返答の操作は台本の下に固定し、台本が長くてもスクロールせずに使えるようにする。 */}
          <div className="script__dock" data-testid="script-dock">
            <CohostControls onError={onError} />
          </div>
        </>
      )}

      {dialog === 'characters' && <CharacterDialog onClose={() => setDialog(null)} />}
      {dialog === 'bulk' && activeSpeaker && (
        <BulkInputDialog
          characters={characters}
          defaultCharacterId={activeSpeaker}
          onSubmit={addBulk}
          onClose={() => setDialog(null)}
        />
      )}
    </section>
  )
}
