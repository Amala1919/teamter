import { useEffect, useState } from 'react'

import type { Command } from '@shared/commands/types'
import { wrapSubtitle } from '@shared/project/subtitle'
import { characterTimelineColor, TIMELINE_PALETTE } from '@shared/project/timeline-colors'
import type { AiPersona, BanterRole, Character, CharacterId, VoiceParams } from '@shared/project/types'

import { api, toAppError } from '../../api'
import { useSettingsStore } from '../../state/settings'
import { useEditorStore } from '../../state/store'
import { addFromLibrary, removeFromLibrary, saveToLibrary, setAutoAdd } from '../../state/character-library'
import { useLibraryEntries } from '../../state/library-entries'
import { characterLook } from '../../state/subtitle-defaults'
import { useVoiceStore } from '../../state/voice'
import { Modal } from '../../ui/Modal'
import { PortraitSection } from '../portrait/PortraitSection'
import { SubtitleStyleEditor } from './SubtitleStyleEditor'
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
            ...characterLook(OUTLINE_COLORS[count % OUTLINE_COLORS.length]!),
            name: `キャラクター${count + 1}`
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
          <LibraryList
            usedIds={new Set(Object.values(characters).map((character) => character.libraryId).filter((id): id is string => id !== undefined))}
            onAdded={(characterId) => setSelectedId(characterId)}
            onError={setError}
          />
        </aside>
        <section className="character-dialog__editor">
          {selected && <LibraryLink key={`link-${selected.id}`} characterId={selected.id} libraryId={selected.libraryId} onError={setError} />}
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
  const characters = useEditorStore((state) => state.project.characters)
  const style = useEditorStore((state) => state.project.subtitleStyles[character.subtitleStyleId])
  const firstLine = useEditorStore((state) =>
    state.project.items.find((item) => item.type === 'voice' && item.characterId === character.id && item.text.trim() !== '')
  )
  // 見本はこのキャラクターの最初のセリフ(無ければ見本の文)を、今の1行の文字数で折り返したもの。
  const sampleText = firstLine?.type === 'voice' ? firstLine.text : `${character.name}のセリフの見本なのだ。字幕はこう見えるのだ！`
  const sampleLines = style ? wrapSubtitle(sampleText, style.maxCharsPerLine) : []
  const [speakerError, setSpeakerError] = useState<string | null>(null)
  const [persona, setPersona] = useState<AiPersona>(character.persona ?? DEFAULT_PERSONA)
  const [personaVersion, setPersonaVersion] = useState(0)

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
        <div className="field" data-testid="character-color-field">
          <span className="field__label">タイムラインでの色(このキャラクターのセリフの色)</span>
          <span className="field__row field__row--wrap">
            <input
              type="color"
              value={characterTimelineColor(characters, character.id) ?? '#3fa34d'}
              onChange={(event) => update({ timelineColor: event.target.value }, 'タイムラインの色の変更')}
              aria-label="タイムラインでの色"
              data-testid="character-color"
            />
            {TIMELINE_PALETTE.map((color) => (
              <button
                key={color.hex}
                type="button"
                className={character.timelineColor === color.hex ? 'color-swatch color-swatch--active' : 'color-swatch'}
                style={{ background: color.hex }}
                title={color.name}
                aria-label={color.name}
                onClick={() => update({ timelineColor: color.hex }, 'タイムラインの色の変更')}
                data-testid={`character-color-${color.hex.slice(1)}`}
              />
            ))}
            {character.timelineColor ? (
              <button type="button" className="button--small" onClick={() => update({ timelineColor: null }, 'タイムラインの色の変更')} data-testid="character-color-reset">
                自動に戻す
              </button>
            ) : (
              <span className="note">自動(キャラクターごとに違う色)</span>
            )}
          </span>
        </div>
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
          <h3>字幕(ボイステロップ)</h3>
          <SubtitleStyleEditor style={style} sampleLines={sampleLines} run={run} />
        </section>
      )}

      {character.authorRole === 'ai' && (
        <section data-testid="persona-editor" key={personaVersion}>
          <h3>相方のペルソナ</h3>
          <p className="note">会話AIは、ここに書いた人物として返答を書きます。録画中のライブ会話でも同じ人物として話します。</p>
          <PersonaTransfer
            name={character.name}
            persona={persona}
            onImport={(next) => {
              commitPersona(next)
              setPersonaVersion((version) => version + 1)
            }}
          />
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
          <p className="note">返答の長さの目安は、セリフごとに台本の「返答を作る」の欄で決めます。</p>
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

/** 相方の設定をファイルに書き出す・読み込む(B-9)。別のプロジェクトでも同じ相方を使える。 */
function PersonaTransfer({
  name,
  persona,
  onImport
}: {
  name: string
  persona: AiPersona
  onImport: (persona: AiPersona) => void
}): React.JSX.Element {
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const onError = (text: string): void => {
    setMessage(null)
    setError(text)
  }
  return (
    <div className="field__row field__row--wrap">
      <button
        type="button"
        className="button--small"
        onClick={() =>
          void api
            .invoke('dialog:pick', { kind: 'exportText', defaultName: `${name}_相方設定.json` })
            .then(async (picked) => {
              if (!picked?.[0]) return
              await api.invoke('export:text', picked[0], JSON.stringify({ format: 'zunda-studio/persona', version: 1, name, persona }, null, 2))
              setError(null)
              setMessage(`書き出しました: ${picked[0]}`)
            })
            .catch((error: unknown) => onError(toAppError(error).message))
        }
        data-testid="persona-export"
      >
        設定を書き出す
      </button>
      <button
        type="button"
        className="button--small"
        onClick={() =>
          void api
            .invoke('dialog:pick', { kind: 'persona' })
            .then(async (picked) => {
              if (!picked?.[0]) return
              onImport(await api.invoke('persona:read', picked[0]))
              setError(null)
              setMessage('読み込みました')
            })
            .catch((error: unknown) => onError(toAppError(error).message))
        }
        data-testid="persona-import"
      >
        設定を読み込む
      </button>
      {message && <span className="status status--ok">{message}</span>}
      {error && (
        <span className="status status--error" data-testid="persona-error">
          {error}
        </span>
      )}
    </div>
  )
}

/** アプリに保存したキャラクターの一覧。プロジェクトに足す・新しいプロジェクトに入れるか・アプリから消す。 */
function LibraryList({ usedIds, onAdded, onError }: { usedIds: Set<string>; onAdded: (characterId: string) => void; onError: (message: string | null) => void }): React.JSX.Element {
  const entries = useLibraryEntries((state) => state.entries)
  const report = (message: string | null): void => {
    if (message) onError(message)
  }
  return (
    <div className="character-library" data-testid="character-library">
      <h4 className="character-library__title">アプリに保存したキャラクター</h4>
      {entries.length === 0 ? (
        <p className="note">まだありません。キャラクターを選んで「アプリに保存」すると、ほかの動画でも使えます。</p>
      ) : (
        entries.map((entry) => {
          const used = usedIds.has(entry.id)
          return (
            <div key={entry.id} className="character-library__item" data-testid="library-entry">
              <span className="character-library__name">
                {entry.name}
                <span className={`script__role script__role--${entry.authorRole}`}>{entry.authorRole === 'ai' ? 'AI' : 'あなた'}</span>
              </span>
              <label className="character-library__auto">
                <input type="checkbox" checked={entry.autoAdd} onChange={(event) => void setAutoAdd(entry.id, event.target.checked).then(report)} data-testid="library-auto-add" />
                新しいプロジェクトに入れる
              </label>
              <span className="character-library__actions">
                <button
                  type="button"
                  className="button--small"
                  disabled={used}
                  title={used ? 'このプロジェクトに入っています' : 'このプロジェクトに足す'}
                  onClick={() => {
                    const result = addFromLibrary([entry.id])
                    if (result.error) onError(result.error)
                    else if (result.characterIds[0]) onAdded(result.characterIds[0])
                  }}
                  data-testid="library-add"
                >
                  {used ? '追加済み' : '追加'}
                </button>
                <button
                  type="button"
                  className="button--small"
                  title="アプリから消す(このプロジェクトのキャラクターは残ります)"
                  aria-label={`${entry.name}をアプリから消す`}
                  onClick={() => void removeFromLibrary(entry.id).then(report)}
                  data-testid="library-remove"
                >
                  ×
                </button>
              </span>
            </div>
          )
        })
      )}
    </div>
  )
}

/** 選んでいるキャラクターをアプリに保存する欄(保存済みなら、その状態)。 */
function LibraryLink({ characterId, libraryId, onError }: { characterId: string; libraryId: string | undefined; onError: (message: string | null) => void }): React.JSX.Element {
  const saved = useLibraryEntries((state) => state.entries.find((entry) => entry.id === libraryId))
  const sync = useSettingsStore((state) => state.settings?.ui.syncCharactersToLibrary !== false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const save = (): void => {
    setBusy(true)
    void saveToLibrary(characterId)
      .then((message) => {
        if (message) onError(message)
        else setNotice('アプリに保存しました')
      })
      .finally(() => setBusy(false))
  }
  return (
    <section className="character-library__link" data-testid="library-link">
      {saved ? (
        <>
          <span className="status status--ok" data-testid="library-status">
            アプリに保存済み{sync ? '(ここで直すとアプリにも反映)' : ''}
          </span>
          {!sync && (
            <button type="button" className="button--small" disabled={busy} onClick={save} data-testid="library-save">
              今の内容をアプリに保存
            </button>
          )}
        </>
      ) : (
        <button type="button" className="button--small" disabled={busy} onClick={save} title="ほかの動画(プロジェクト)でも使えるように、アプリに保存します" data-testid="library-save">
          {libraryId ? 'アプリから消えています。もう一度アプリに保存' : 'このキャラクターをアプリに保存'}
        </button>
      )}
      {notice && <span className="note">{notice}</span>}
    </section>
  )
}
