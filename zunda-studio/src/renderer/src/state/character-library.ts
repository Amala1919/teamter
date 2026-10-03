import { nanoid } from 'nanoid'

import { addSavedCharacterCommands, savedContent, toSavedCharacter, type SavedCharacter } from '@shared/project/character-library'
import type { Project } from '@shared/project/types'

import { api, toAppError } from '../api'
import { setLibraryEntries, useLibraryEntries } from './library-entries'
import { useSettingsStore } from './settings'
import { useEditorStore } from './store'

/**
 * アプリに保存したキャラクターの操作。保存・削除・プロジェクトへの追加と、プロジェクトで直したときのアプリへの反映。
 * どれも失敗したら理由の文を返す(成功なら null)。
 */

export async function loadLibrary(): Promise<void> {
  setLibraryEntries(await api.invoke('characters:list'))
}

function entry(id: string | undefined): SavedCharacter | undefined {
  return id ? useLibraryEntries.getState().entries.find((candidate) => candidate.id === id) : undefined
}

/** プロジェクトのキャラクターをアプリに保存する。既に結び付いていれば上書き、無ければ新しく保存して結び付ける。 */
export async function saveToLibrary(characterId: string): Promise<string | null> {
  const { project, dispatch } = useEditorStore.getState()
  const character = project.characters[characterId]
  if (!character) return 'キャラクターが見つかりません'
  const existing = entry(character.libraryId)
  const base = existing ? { id: existing.id, autoAdd: existing.autoAdd } : { id: `lib_${nanoid(10)}`, autoAdd: true }
  try {
    setLibraryEntries(await api.invoke('characters:save', toSavedCharacter(project, characterId, base, new Date())))
  } catch (error) {
    return toAppError(error).message
  }
  if (character.libraryId !== base.id) {
    const result = dispatch([{ op: 'character.update', characterId, libraryId: base.id }], 'キャラクターをアプリに保存')
    if (!result.ok) return result.message
  }
  return null
}

export async function removeFromLibrary(id: string): Promise<string | null> {
  try {
    setLibraryEntries(await api.invoke('characters:remove', id))
    return null
  } catch (error) {
    return toAppError(error).message
  }
}

/** 新しいプロジェクトに自動で入れるかを切り替える。 */
export async function setAutoAdd(id: string, autoAdd: boolean): Promise<string | null> {
  const saved = entry(id)
  if (!saved) return null
  // 応答を待たずに見た目を切り替える(失敗したら戻す)。
  const before = useLibraryEntries.getState().entries
  setLibraryEntries(before.map((candidate) => (candidate.id === id ? { ...candidate, autoAdd } : candidate)))
  try {
    setLibraryEntries(await api.invoke('characters:save', { ...saved, autoAdd }))
    return null
  } catch (error) {
    setLibraryEntries(before)
    return toAppError(error).message
  }
}

/** 保存したキャラクターを、開いているプロジェクトに足す(取り消せる)。足したキャラクターの ID を返す。 */
export function addFromLibrary(ids: readonly string[]): { error: string | null; characterIds: string[] } {
  const saved = ids.map((id) => entry(id)).filter((value): value is SavedCharacter => value !== undefined)
  if (saved.length === 0) return { error: '足すキャラクターを選んでください', characterIds: [] }
  const result = useEditorStore
    .getState()
    .dispatch(saved.flatMap((value, index) => addSavedCharacterCommands(value, `lib${index}_`)), saved.length > 1 ? 'キャラクターをまとめて追加' : `${saved[0]!.name}を追加`)
  if (!result.ok) return { error: result.message, characterIds: [] }
  return { error: null, characterIds: saved.map((_, index) => result.resolvedIds[`lib${index}_character`]).filter((id): id is string => id !== undefined) }
}

/**
 * プロジェクトで直したキャラクターを、アプリに保存したほうにも反映する(設定で切れる)。
 * 比べるのは「直す前と後のプロジェクト」で、プロジェクトを開いたり新しく作ったりしただけでは反映しない
 * (古いプロジェクトを開いて、アプリのほうを古い内容で上書きしないように)。
 */
export function startLibrarySync(delayMs = 600): () => void {
  const pending = new Map<string, Project>()
  let timer: number | null = null
  const flush = (): void => {
    timer = null
    const project = useEditorStore.getState().project
    for (const characterId of pending.keys()) {
      const character = project.characters[characterId]
      const saved = entry(character?.libraryId)
      if (!character || !saved) continue
      const next = toSavedCharacter(project, characterId, { id: saved.id, autoAdd: saved.autoAdd }, new Date())
      if (savedContent(next) === savedContent(saved)) continue
      void api
        .invoke('characters:save', next)
        .then(setLibraryEntries)
        .catch(() => {})
    }
    pending.clear()
  }
  return useEditorStore.subscribe((state, previous) => {
    if (state.project === previous.project || state.sessionKey !== previous.sessionKey) return
    if (useSettingsStore.getState().settings?.ui.syncCharactersToLibrary === false) return
    for (const character of Object.values(state.project.characters)) {
      if (!character.libraryId || !entry(character.libraryId)) continue
      if (changed(previous.project, state.project, character.id)) pending.set(character.id, state.project)
    }
    if (pending.size > 0 && timer === null) timer = window.setTimeout(flush, delayMs)
  })
}

/** キャラクターの保存の中身(声・字幕・立ち絵など)が変わったか。 */
function changed(before: Project, after: Project, characterId: string): boolean {
  const a = before.characters[characterId]
  const b = after.characters[characterId]
  if (!a || !b) return false
  if (a === b && before.subtitleStyles[a.subtitleStyleId] === after.subtitleStyles[b.subtitleStyleId]) return false
  try {
    const base = { id: '', autoAdd: false }
    const at = new Date(0)
    return savedContent(toSavedCharacter(before, characterId, base, at)) !== savedContent(toSavedCharacter(after, characterId, base, at))
  } catch {
    return false
  }
}
