import { useEffect, useState } from 'react'

import type { Command } from '@shared/commands/types'
import type { AiPersona, BanterRole, Character, CharacterId, VoiceParams } from '@shared/project/types'

import { toAppError } from '../../api'
import { useSettingsStore } from '../../state/settings'
import { useEditorStore } from '../../state/store'
import { useVoiceStore } from '../../state/voice'
import { Modal } from '../../ui/Modal'
import { PortraitSection } from '../portrait/PortraitSection'
import { VoiceParamsEditor } from './VoiceParamsEditor'

const BANTER_ROLES: { id: BanterRole; label: string }[] = [
  { id: 'tsukkomi', label: 'ツッコミ' },
  { id: 'boke', label: 'ボケ' },
  { id: 'navigator', label: '進行役・解説' },
  { id: 'free', label: '自由' }
]

const DEFAULT_PERSONA: AiPersona = {
  personality: '',
  speechStyle: '',
  banterRole: 'tsukkomi',
  forbidden: [],
  targetLengthChars: 40
}

/** キャラクターごとに見分けやすい字幕の縁取り色。 */
const OUTLINE_COLORS = ['#2b7a0b', '#a0306a', '#1f5fa8', '#b8621b', '#6a3fb0', '#3a3a3a']

interface CharacterDialogProps {
  onClose: () => void
  initialCharacterId?: CharacterId
}

export function CharacterDialog({ onClose, initialCharacterId }: CharacterDialogProps): React.JSX.Element {
  const characters = useEditorStore((state) => state.project.characters)
  const dispatch = useEditorStore((state) => state.dispatch)
  const [selectedId, setSelectedId] = useState<CharacterId | null>(
    initialCharacterId ?? Object.keys(characters)[0] ?? null
  )
  const [error, setError] = useState<string | null>(null)

  const run = (commands: Command[], label: string): Record<string, string> | null => {
    const result = dispatch(commands, label)
    if (!result.ok) {
      setError(result.message)
      return null
    }
    setError(null)
    return result.resolvedIds
  }

  const selected = selectedId ? characters[selectedId] : undefined

  const addCharacter = (): void => {
    const count = Object.keys(characters).length
    const resolved = run(
      [
        {
          op: 'style.upsertSubtitle',
          props: {
            name: `キャラクター${count + 1}`,
            outline: { color: OUTLINE_COLORS[count % OUTLINE_COLORS.length]!, widthPx: 8 }
          },
          tempId: 'style'
        },
        {
          op: 'character.create',
          name: `キャラクター${count + 1}`,
          engineId: 'voicevox',
          speakerId: 3,
          speakerName: 'ずんだもん(ノーマル)',
          subtitleStyleId: 'style',
          tempId: 'character'
        }
      ],
      'キャラクターの追加'
    )
    if (resolved?.['character']) setSelectedId(resolved['character'])
  }

  return (
    <Modal title="キャラクター" onClose={onClose} wide>
      {error && (
        <div className="banner banner--error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)}>
            閉じる
          </button>
        </div>
      )}
      <div className="character-dialog">
        <aside className="character-dialog__list">
          {Object.values(characters).map((character) => (
            <button
              key={character.id}
              type="button"
              className={
                character.id === selectedId ? 'character-dialog__item character-dialog__item--active' : 'character-dialog__item'
              }
              onClick={() => setSelectedId(character.id)}
            >
              <span>{character.name}</span>
              <span className={`script__role script__role--${character.authorRole}`}>
                {character.authorRole === 'ai' ? 'AI' : 'あなた'}
              </span>
            </button>
          ))}
          <button type="button" onClick={addCharacter} data-testid="add-character">
            キャラクターを追加
          </button>
        </aside>
        <section className="character-dialog__editor">
          {selected ? (
            <CharacterEditor
              key={selected.id}
              character={selected}
              run={run}
              onDeleted={() => setSelectedId(null)}
            />
          ) : (
            <p className="pane__empty">キャラクターを選ぶか、追加してください。</p>
          )}
        </section>
      </div>
    </Modal>
  )
}

interface CharacterEditorProps {
  character: Character
  run: (commands: Command[], label: string) => Record<string, string> | null
  onDeleted: () => void
}

function CharacterEditor({ character, run, onDeleted }: CharacterEditorProps): React.JSX.Element {
  const engines = useSettingsStore((state) => state.settings?.voice.engines ?? [])
  const speakers = useVoiceStore((state) => state.speakers[character.voice.engineId])
  const loadSpeakers = useVoiceStore((state) => state.loadSpeakers)
  const ensureEngine = useVoiceStore((state) => state.ensureEngine)
  const style = useEditorStore((state) => state.project.subtitleStyles[character.subtitleStyleId])
  const [speakerError, setSpeakerError] = useState<string | null>(null)
  const [persona, setPersona] = useState<AiPersona>(character.persona ?? DEFAULT_PERSONA)

  useEffect(() => {
    let cancelled = false
    ensureEngine(character.voice.engineId)
      .then((status) => {
        if (status.state !== 'ready') throw new Error(status.message ?? '音声エンジンに接続できません')
        return loadSpeakers(character.voice.engineId)
      })
      .then(() => !cancelled && setSpeakerError(null))
      .catch((error: unknown) => !cancelled && setSpeakerError(toAppError(error).message))
    return () => {
      cancelled = true
    }
  }, [character.voice.engineId, ensureEngine, loadSpeakers])

  const engineLabel = engines.find((engine) => engine.id === character.voice.engineId)?.label ?? character.voice.engineId

  const update = (patch: Omit<Extract<Command, { op: 'character.update' }>, 'op' | 'characterId'>, label: string): void => {
    run([{ op: 'character.update', characterId: character.id, ...patch }], label)
  }

  const selectSpeaker = (value: string): void => {
    const styleId = Number(value)
    const speaker = speakers?.find((candidate) => candidate.styles.some((styleOption) => styleOption.id === styleId))
    const styleName = speaker?.styles.find((styleOption) => styleOption.id === styleId)?.name
    if (!speaker) return
    // クレジットは規約上「エンジン名:キャラクター名」が基本。利用者が書き換えていなければ追従させる。
    const autoCredit = character.creditText === '' || character.creditText.startsWith(`${engineLabel}:`)
    update(
      {
        voice: { speakerId: styleId, speakerName: `${speaker.name}(${styleName ?? ''})` },
        ...(autoCredit ? { creditText: `${engineLabel}:${speaker.name}` } : {})
      },
      '話者の変更'
    )
  }

  const commitPersona = (next: AiPersona): void => {
    setPersona(next)
    run([{ op: 'character.setPersona', characterId: character.id, persona: next }], 'ペルソナの変更')
  }

  return (
    <div className="settings-section">
      <section>
        <label className="field">
          <span className="field__label">名前</span>
          <input
            type="text"
            defaultValue={character.name}
            onBlur={(event) => {
              const name = event.target.value.trim()
              if (name !== '' && name !== character.name) update({ name }, 'キャラクター名の変更')
            }}
            data-testid="character-name"
          />
        </label>
        <div className="field">
          <span className="field__label">セリフを書く人</span>
          <span className="field__row">
            <label>
              <input
                type="radio"
                checked={character.authorRole === 'user'}
                onChange={() => update({ authorRole: 'user' }, '役割の変更')}
              />
              あなた
            </label>
            <label>
              <input
                type="radio"
                checked={character.authorRole === 'ai'}
                onChange={() =>
                  // persona が無いと AI の役にできないので、無ければ既定のペルソナと一緒に切り替える。
                  update(character.persona ? { authorRole: 'ai' } : { authorRole: 'ai', persona }, '役割の変更')
                }
                data-testid="role-ai"
              />
              AI(相方)
            </label>
          </span>
        </div>
      </section>

      <section>
        <h3>声</h3>
        <label className="field">
          <span className="field__label">音声エンジン</span>
          <select
            value={character.voice.engineId}
            onChange={(event) => update({ voice: { engineId: event.target.value } }, '音声エンジンの変更')}
          >
            {engines.map((engine) => (
              <option key={engine.id} value={engine.id}>
                {engine.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field__label">話者</span>
          {speakers ? (
            <select
              value={character.voice.speakerId}
              onChange={(event) => selectSpeaker(event.target.value)}
              data-testid="character-speaker"
            >
              {!speakers.some((speaker) => speaker.styles.some((styleOption) => styleOption.id === character.voice.speakerId)) && (
                <option value={character.voice.speakerId}>{character.voice.speakerName}</option>
              )}
              {speakers.map((speaker) => (
                <optgroup key={speaker.uuid} label={speaker.name}>
                  {speaker.styles.map((styleOption) => (
                    <option key={styleOption.id} value={styleOption.id}>
                      {speaker.name}({styleOption.name})
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          ) : (
            <span className="status status--warn">{speakerError ?? '話者一覧を読み込み中…'}</span>
          )}
        </label>
        <VoiceParamsEditor
          values={character.voice}
          onCommit={(params: Partial<VoiceParams>) => update({ voice: params }, '声の既定値の変更')}
        />
        <label className="field">
          <span className="field__label">クレジット表記</span>
          <input
            type="text"
            defaultValue={character.creditText}
            key={character.creditText}
            placeholder={`例: ${engineLabel}:ずんだもん`}
            onBlur={(event) => {
              if (event.target.value !== character.creditText) update({ creditText: event.target.value }, 'クレジットの変更')
            }}
            data-testid="character-credit"
          />
        </label>
      </section>

      <PortraitSection character={character} run={run} />

      {style && (
        <section>
          <h3>字幕</h3>
          <label className="field">
            <span className="field__label">文字の色</span>
            <input
              type="color"
              value={style.color.slice(0, 7)}
              onChange={(event) =>
                run([{ op: 'style.upsertSubtitle', styleId: style.id, props: { color: event.target.value } }], '字幕の色の変更')
              }
            />
          </label>
          <label className="field">
            <span className="field__label">縁取りの色</span>
            <input
              type="color"
              value={(style.outline?.color ?? '#000000').slice(0, 7)}
              onChange={(event) =>
                run(
                  [
                    {
                      op: 'style.upsertSubtitle',
                      styleId: style.id,
                      props: { outline: { color: event.target.value, widthPx: style.outline?.widthPx ?? 8 } }
                    }
                  ],
                  '字幕の縁取りの変更'
                )
              }
            />
          </label>
          <label className="field">
            <span className="field__label">1行の文字数</span>
            <input
              type="number"
              min={4}
              max={60}
              defaultValue={style.maxCharsPerLine}
              onBlur={(event) => {
                const value = Number(event.target.value)
                if (Number.isInteger(value) && value !== style.maxCharsPerLine) {
                  run([{ op: 'style.upsertSubtitle', styleId: style.id, props: { maxCharsPerLine: value } }], '字幕の文字数の変更')
                }
              }}
            />
          </label>
        </section>
      )}

      {character.authorRole === 'ai' && (
        <section data-testid="persona-editor">
          <h3>相方のペルソナ</h3>
          <p className="note">会話AIは、ここに書いた人物として返答を書きます。録画中のライブ会話でも同じ人物として話します。</p>
          <label className="field">
            <span className="field__label">性格</span>
            <textarea
              rows={2}
              defaultValue={persona.personality}
              placeholder="例: 冷静で少し毒舌だが、面倒見はいい"
              onBlur={(event) => commitPersona({ ...persona, personality: event.target.value })}
              data-testid="persona-personality"
            />
          </label>
          <label className="field">
            <span className="field__label">口調</span>
            <textarea
              rows={2}
              defaultValue={persona.speechStyle}
              placeholder="例: 一人称は「わたくし」。語尾に「かしら」"
              onBlur={(event) => commitPersona({ ...persona, speechStyle: event.target.value })}
            />
          </label>
          <label className="field">
            <span className="field__label">掛け合いでの立ち位置</span>
            <select
              value={persona.banterRole}
              onChange={(event) => commitPersona({ ...persona, banterRole: event.target.value as BanterRole })}
            >
              {BANTER_ROLES.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field__label">返答の目安の長さ(文字)</span>
            <input
              type="number"
              min={5}
              max={300}
              defaultValue={persona.targetLengthChars}
              onBlur={(event) => {
                const value = Number(event.target.value)
                if (Number.isInteger(value) && value > 0) commitPersona({ ...persona, targetLengthChars: value })
              }}
            />
          </label>
          <label className="field">
            <span className="field__label">使わせない表現(1行に1つ)</span>
            <textarea
              rows={3}
              defaultValue={persona.forbidden.join('\n')}
              onBlur={(event) =>
                commitPersona({
                  ...persona,
                  forbidden: event.target.value
                    .split('\n')
                    .map((line) => line.trim())
                    .filter(Boolean)
                })
              }
            />
          </label>
        </section>
      )}

      <section>
        <button
          type="button"
          className="button--danger"
          onClick={() => {
            if (run([{ op: 'character.delete', characterId: character.id }], 'キャラクターの削除')) onDeleted()
          }}
        >
          このキャラクターを削除
        </button>
      </section>
    </div>
  )
}
