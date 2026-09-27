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

export type DispatchResult = { ok: true } | { ok: false; message: string }

interface EditorState {
  project: Project
  filePath: string | null
  dirty: boolean
  selectedItemIds: ItemId[]
  playheadMs: Ms
  undoStack: HistoryEntry[]
  redoStack: HistoryEntry[]

  /** プロジェクトへの変更はすべてこの関数を通す。 */
  dispatch: (commands: readonly Command[], label: string) => DispatchResult
  undo: () => void
  redo: () => void

  setPlayhead: (timeMs: Ms) => void
  setSelection: (itemIds: ItemId[]) => void

  newProject: () => void
  openProject: () => Promise<void>
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
  selectedItemIds: [],
  playheadMs: 0,
  undoStack: [],
  redoStack: [],

  dispatch: (commands, label) => {
    if (commands.length === 0) return { ok: true }
    const { project, undoStack } = get()
    try {
      const { project: next } = applyCommands(project, commands, commandContext)
      set({
        project: next,
        dirty: true,
        undoStack: [...undoStack, { label, project }].slice(-HISTORY_LIMIT),
        redoStack: []
      })
      return { ok: true }
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
      project: entry.project,
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
      project: entry.project,
      redoStack: redoStack.slice(0, -1),
      undoStack: [...undoStack, { label: entry.label, project }],
      dirty: true
    })
  },

  setPlayhead: (timeMs) => set({ playheadMs: Math.max(0, Math.round(timeMs)) }),
  setSelection: (itemIds) => set({ selectedItemIds: itemIds }),

  newProject: () =>
    set({
      project: createEmptyProject(),
      filePath: null,
      dirty: false,
      selectedItemIds: [],
      playheadMs: 0,
      undoStack: [],
      redoStack: []
    }),

  openProject: async () => {
    const picked = await api.invoke('dialog:pick', { kind: 'openProject' })
    const path = picked?.[0]
    if (!path) return
    const project = await api.invoke('project:read', path)
    set({
      project,
      filePath: path,
      dirty: false,
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
    set({ filePath: target, dirty: get().project !== written })
  }
}))

function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]/g, '_').trim()
  return cleaned === '' ? 'project' : cleaned
}
