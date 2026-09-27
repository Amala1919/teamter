import { nanoid } from 'nanoid'
import { create } from 'zustand'

import { applyCommands, type CommandContext } from '@shared/commands/apply'
import { CommandError, type Command } from '@shared/commands/types'
import { createEmptyProject } from '@shared/project/factory'
import type { ItemId, Ms, Project } from '@shared/project/types'

import { api } from '../api'

/**
 * undo はコマンドの逆操作ではなく、適用前のプロジェクトのスナップショットで実現する。
 * immer が構造を共有するため、変更されていない部分はコピーされず、スナップショットは安価である。
 * 逆操作を各コマンドごとに正しく書くのは誤りやすく、コマンドを追加するたびに負債が増えるため採らない。
 */
interface HistoryEntry {
  label: string
  project: Project
}

const HISTORY_LIMIT = 200

export type DispatchResult = { ok: true; resolvedIds: Record<string, string> } | { ok: false; message: string }

export interface DispatchOptions {
  /**
   * push: 取り消しの単位として履歴に積む(通常の編集)。
   * skip: 履歴に積まない。合成結果の反映のような、利用者の操作から導かれる二次的な更新に使う。
   *       取り消すと元の操作ごと戻り、二次的な更新は必要なら再び行われる。
   */
  history?: 'push' | 'skip'
}

interface EditorState {
  project: Project
  filePath: string | null
  dirty: boolean
  /** 自動保存の置き場所を分けるための、開いている間だけのキー。 */
  sessionKey: string
  selectedItemIds: ItemId[]
  playheadMs: Ms
  undoStack: HistoryEntry[]
  redoStack: HistoryEntry[]

  /** プロジェクトへの変更はすべてこの関数を通す。 */
  dispatch: (commands: readonly Command[], label: string, options?: DispatchOptions) => DispatchResult
  undo: () => void
  redo: () => void

  setPlayhead: (timeMs: Ms) => void
  setSelection: (itemIds: ItemId[]) => void

  newProject: () => void
  openProject: () => Promise<void>
  /** 自動保存から復元する。保存されていない変更として開く。 */
  restoreProject: (project: Project, filePath: string | null, sessionKey: string) => void
  saveProject: (options?: { saveAs?: boolean }) => Promise<void>
}

const commandContext: CommandContext = {
  newId: (prefix) => `${prefix}_${nanoid(10)}`,
  now: () => new Date()
}

export const useEditorStore = create<EditorState>((set, get) => ({
  project: createEmptyProject(),
  filePath: null,
  dirty: false,
  sessionKey: newSessionKey(),
  selectedItemIds: [],
  playheadMs: 0,
  undoStack: [],
  redoStack: [],

  dispatch: (commands, label, options) => {
    if (commands.length === 0) return { ok: true, resolvedIds: {} }
    const { project, undoStack } = get()
    try {
      const { project: next, resolvedIds } = applyCommands(project, commands, commandContext)
      if (options?.history === 'skip') {
        set({ project: next, dirty: true })
      } else {
        set({
          project: next,
          dirty: true,
          undoStack: [...undoStack, { label, project }].slice(-HISTORY_LIMIT),
          redoStack: []
        })
      }
      return { ok: true, resolvedIds }
    } catch (error) {
      const message =
        error instanceof CommandError
          ? `${label}に失敗しました: ${error.message}`
          : `${label}に失敗しました: ${String(error)}`
      return { ok: false, message }
    }
  },

  undo: () => {
    const { undoStack, redoStack, project } = get()
    const entry = undoStack.at(-1)
    if (!entry) return
    set({
      // チャットの記録は編集の対象ではないので、取り消しても今のまま残す。
      project: { ...entry.project, chat: project.chat },
      undoStack: undoStack.slice(0, -1),
      redoStack: [...redoStack, { label: entry.label, project }],
      dirty: true
    })
  },

  redo: () => {
    const { undoStack, redoStack, project } = get()
    const entry = redoStack.at(-1)
    if (!entry) return
    set({
      project: { ...entry.project, chat: project.chat },
      redoStack: redoStack.slice(0, -1),
      undoStack: [...undoStack, { label: entry.label, project }],
      dirty: true
    })
  },

  setPlayhead: (timeMs) => set({ playheadMs: Math.max(0, Math.round(timeMs)) }),
  setSelection: (itemIds) => set({ selectedItemIds: itemIds }),

  newProject: () => {
    discardAutosave(get().sessionKey)
    set({
      project: createEmptyProject(),
      filePath: null,
      dirty: false,
      sessionKey: newSessionKey(),
      selectedItemIds: [],
      playheadMs: 0,
      undoStack: [],
      redoStack: []
    })
  },

  openProject: async () => {
    const picked = await api.invoke('dialog:pick', { kind: 'openProject' })
    const path = picked?.[0]
    if (!path) return
    const project = await api.invoke('project:read', path)
    discardAutosave(get().sessionKey)
    set({
      project,
      filePath: path,
      dirty: false,
      sessionKey: newSessionKey(),
      selectedItemIds: [],
      playheadMs: 0,
      undoStack: [],
      redoStack: []
    })
  },

  saveProject: async (options) => {
    const { project, filePath } = get()
    let target = options?.saveAs ? null : filePath
    if (!target) {
      const picked = await api.invoke('dialog:pick', {
        kind: 'saveProject',
        defaultName: `${sanitizeFileName(project.meta.title)}.zsproj`
      })
      target = picked?.[0] ?? null
    }
    if (!target) return
    const written = await api.invoke('project:write', target, project)
    // 保存時に素材の相対パスが更新されるので、保存結果を正とする。編集中に変わった分は失わないよう
    // 保存前と同じオブジェクトのときだけ置き換える。
    if (get().project === project) set({ project: written })
    const dirty = get().project !== written
    set({ filePath: target, dirty })
    // 保存できたら、自動保存の写しは要らない。
    if (!dirty) discardAutosave(get().sessionKey)
  },

  restoreProject: (project, filePath, sessionKey) =>
    set({
      project,
      filePath,
      dirty: true,
      sessionKey,
      selectedItemIds: [],
      playheadMs: 0,
      undoStack: [],
      redoStack: []
    })
}))

function newSessionKey(): string {
  return `edit_${nanoid(12)}`
}

function discardAutosave(key: string): void {
  void api.invoke('autosave:clear', key).catch(() => {})
}

/** 自動保存の間隔。 */
const AUTOSAVE_INTERVAL_MS = 15_000

/**
 * 保存していない変更を一定間隔でアプリのデータ置き場に写す。止める関数を返す。
 * 変わっていなければ書かない(immer の構造共有で、変更の有無は参照の比較で分かる)。
 */
export function startAutosave(intervalMs = AUTOSAVE_INTERVAL_MS): () => void {
  let written: Project | null = null
  const timer = window.setInterval(() => {
    const { project, dirty, filePath, sessionKey } = useEditorStore.getState()
    if (!dirty || project === written) return
    written = project
    void api.invoke('autosave:write', sessionKey, filePath, project).catch(() => {
      written = null
    })
  }, intervalMs)
  return () => window.clearInterval(timer)
}

function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]/g, '_').trim()
  return cleaned === '' ? 'project' : cleaned
}

/** 選んでいるアイテムを消す。セリフは後ろを詰める(voice.delete)。失敗したらその理由を返す。 */
export function deleteSelection(): string | null {
  const { project, selectedItemIds, dispatch, setSelection } = useEditorStore.getState()
  const commands: Command[] = []
  for (const itemId of selectedItemIds) {
    const item = project.items.find((candidate) => candidate.id === itemId)
    if (!item) continue
    commands.push(item.type === 'voice' ? { op: 'voice.delete', itemId } : { op: 'item.delete', itemId })
  }
  if (commands.length === 0) return null
  const result = dispatch(commands, 'アイテムの削除')
  if (!result.ok) return result.message
  setSelection([])
  return null
}
