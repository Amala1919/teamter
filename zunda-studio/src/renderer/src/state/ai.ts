import { nanoid } from 'nanoid'
import { create } from 'zustand'

import type { CohostCandidate, CohostLine, CohostRequest } from '@shared/ai/cohost'
import type { DraftRequest } from '@shared/ai/draft'
import type { PortraitRequest } from '@shared/ai/portraits'
import type { GeneratedBy } from '@shared/ai/types'
import { applyCommands } from '@shared/commands/apply'
import { CommandError, type Command } from '@shared/commands/types'
import { diffProjects, type ProjectDiff } from '@shared/project/diff'
import { voiceItemsInOrder } from '@shared/project/queries'
import type { ChatMessage, ItemId } from '@shared/project/types'

import { api, toAppError } from '../api'
import { useEditorStore } from './store'

/**
 * AI とのやりとり(相方の返答の候補、編集チャット)の画面側の状態。
 * どちらも AI の出力をそのまま確定させず、利用者が採用・適用したときにだけコマンドとして反映する。
 */

// ---------------------------------------------------------------- 相方の返答

export interface CohostSession {
  request: CohostRequest
  /** どのセリフの後に入れるか。null なら台本の最後。 */
  afterItemId: ItemId | null
  candidates: CohostCandidate[]
  generatedBy: GeneratedBy | null
  loading: boolean
  error: string | null
  /** 画面を見せたときの結果。 */
  vision?: { shownFrames: number; imagesDropped: boolean } | undefined
}

interface CohostState {
  session: CohostSession | null
  /**
   * 「返答を作って」の依頼の回数。台本の下の操作欄がこれを見て、今の設定(候補の数・指示など)で生成する。
   * セリフの右クリックやショートカットから、操作欄までスクロールせずに頼めるようにするため。
   */
  requestSeq: number
  requestGenerate: () => void
  generate: (request: Omit<CohostRequest, 'afterItemId'>) => Promise<void>
  regenerate: () => Promise<void>
  discard: () => void
  /** 候補を台本に入れる。lines は利用者が手で直した後の内容。入れた最後のセリフのIDを返す。 */
  adopt: (lines: CohostLine[]) => { ok: true; lastItemId: string | null } | { ok: false; message: string }
}

/** 返答を差し込む位置: 選んでいるセリフの後ろ、無ければ台本の最後。 */
function anchorLine(): ItemId | null {
  const { project, selectedItemIds } = useEditorStore.getState()
  const lines = voiceItemsInOrder(project)
  const selected = lines.filter((line) => selectedItemIds.includes(line.id)).at(-1)
  return selected?.id ?? lines.at(-1)?.id ?? null
}

export const useCohostStore = create<CohostState>((set, get) => ({
  session: null,
  requestSeq: 0,
  requestGenerate: () => set((state) => ({ requestSeq: state.requestSeq + 1 })),

  generate: async (options) => {
    const afterItemId = anchorLine()
    const request: CohostRequest = { ...options, afterItemId }
    set({ session: { request, afterItemId, candidates: [], generatedBy: null, loading: true, error: null } })
    try {
      const { project } = useEditorStore.getState()
      const result = await api.invoke('ai:cohost', project, request)
      set((state) =>
        state.session?.request === request
          ? { session: { ...state.session, candidates: result.candidates, generatedBy: result.generatedBy, loading: false, vision: result.vision } }
          : state
      )
    } catch (error) {
      const appError = toAppError(error)
      set((state) =>
        state.session?.request === request
          ? { session: { ...state.session, loading: false, error: `${appError.message}${appError.guidance ? `。${appError.guidance}` : ''}` } }
          : state
      )
    }
  },

  regenerate: async () => {
    const session = get().session
    if (!session) return
    const { afterItemId: _ignored, ...options } = session.request
    await get().generate(options)
  },

  discard: () => set({ session: null }),

  adopt: (lines) => {
    const session = get().session
    if (!session || lines.length === 0) return { ok: false, message: '採用するセリフがありません' }
    const commands: Command[] = []
    let previous: string | null = session.afterItemId
    lines.forEach((line, index) => {
      const tempId = `adopt${index}`
      commands.push({
        op: 'voice.insert',
        characterId: line.characterId,
        text: line.text,
        ...(previous ? { afterItemId: previous } : { atMs: 0 }),
        ...(line.expressionId ? { expressionId: line.expressionId } : {}),
        ...(session.generatedBy ? { generatedBy: session.generatedBy } : {}),
        tempId
      })
      previous = tempId
    })
    const { dispatch, setSelection } = useEditorStore.getState()
    const result = dispatch(commands, lines.length > 1 ? '相方の掛け合いを採用' : '相方の返答を採用')
    if (!result.ok) return { ok: false, message: result.message }
    const lastItemId = result.resolvedIds[`adopt${lines.length - 1}`] ?? null
    if (lastItemId) setSelection([lastItemId])
    set({ session: null })
    return { ok: true, lastItemId }
  }
}))

// ---------------------------------------------------------------- 編集チャット

/** 提案を今のプロジェクトに当てたらどうなるか(当てられなければその理由)。 */
export type DryRun = { ok: true; diff: ProjectDiff } | { ok: false; message: string }

export function dryRun(commands: Command[]): DryRun {
  const { project } = useEditorStore.getState()
  try {
    const { project: next } = applyCommands(project, commands, { newId: (prefix) => `${prefix}_dry${nanoid(6)}`, now: () => new Date() })
    return { ok: true, diff: diffProjects(project, next) }
  } catch (error) {
    return { ok: false, message: error instanceof CommandError ? error.message : String(error) }
  }
}

interface ChatState {
  sending: boolean
  send: (message: string) => Promise<void>
  /** 録画から下書きを作らせ、提案としてチャットに出す。 */
  draft: (request: DraftRequest, label: string) => Promise<void>
  /** 立ち絵をまとめて調整させ、提案としてチャットに出す。 */
  portraits: (request: PortraitRequest, label: string) => Promise<void>
  apply: (message: ChatMessage) => string | null
  reject: (message: ChatMessage) => void
}

function append(message: Omit<ChatMessage, 'id' | 'atMs'>): ChatMessage {
  const full: ChatMessage = { id: `msg_${nanoid(10)}`, atMs: Date.now(), ...message }
  useEditorStore.getState().dispatch([{ op: 'chat.append', message: full }], 'チャット', { history: 'skip' })
  return full
}

export const useChatStore = create<ChatState>((set) => ({
  sending: false,

  send: async (text) => {
    const trimmed = text.trim()
    if (trimmed === '') return
    const { project, selectedItemIds } = useEditorStore.getState()
    const history = project.chat.messages.filter((message) => !message.error).map((message) => ({ role: message.role, content: message.content }))
    append({ role: 'user', content: trimmed })
    set({ sending: true })
    try {
      const result = await api.invoke('ai:edit', useEditorStore.getState().project, { message: trimmed, selection: selectedItemIds, history })
      append({
        role: 'assistant',
        content: result.reply,
        generatedBy: result.generatedBy,
        ...(result.commands.length > 0 ? { proposedCommands: result.commands } : {})
      })
    } catch (error) {
      const appError = toAppError(error)
      append({ role: 'assistant', content: '', error: `${appError.message}${appError.guidance ? `。${appError.guidance}` : ''}` })
    } finally {
      set({ sending: false })
    }
  },

  draft: async (request, label) => {
    append({ role: 'user', content: label })
    set({ sending: true })
    try {
      const result = await api.invoke('ai:draft', useEditorStore.getState().project, request)
      append({
        role: 'assistant',
        content: `${result.reply}(使えそうな区間の候補 ${result.candidates} か所から選びました)`,
        generatedBy: result.generatedBy,
        ...(result.commands.length > 0 ? { proposedCommands: result.commands } : {})
      })
    } catch (error) {
      const appError = toAppError(error)
      append({ role: 'assistant', content: '', error: `${appError.message}${appError.guidance ? `。${appError.guidance}` : ''}` })
    } finally {
      set({ sending: false })
    }
  },

  portraits: async (request, label) => {
    append({ role: 'user', content: label })
    set({ sending: true })
    try {
      const result = await api.invoke('ai:portraits', useEditorStore.getState().project, request)
      append({
        role: 'assistant',
        content: result.reply,
        generatedBy: result.generatedBy,
        ...(result.commands.length > 0 ? { proposedCommands: result.commands } : {})
      })
    } catch (error) {
      const appError = toAppError(error)
      append({ role: 'assistant', content: '', error: `${appError.message}${appError.guidance ? `。${appError.guidance}` : ''}` })
    } finally {
      set({ sending: false })
    }
  },

  apply: (message) => {
    const commands = (message.proposedCommands ?? []) as Command[]
    const { dispatch } = useEditorStore.getState()
    // 提案全体を1回の取り消しで戻せるよう、まとめて1回で適用する。
    const result = dispatch(commands, `AIの編集: ${message.content.slice(0, 20)}`)
    if (!result.ok) return result.message
    dispatch([{ op: 'chat.setOutcome', messageId: message.id, outcome: 'applied' }], 'チャット', { history: 'skip' })
    return null
  },

  reject: (message) => {
    useEditorStore.getState().dispatch([{ op: 'chat.setOutcome', messageId: message.id, outcome: 'rejected' }], 'チャット', { history: 'skip' })
  }
}))
