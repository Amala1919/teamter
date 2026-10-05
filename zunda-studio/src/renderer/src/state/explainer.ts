import { nanoid } from 'nanoid'
import { create } from 'zustand'

import {
  EXPLAINER_GROUP_TEMP_ID,
  explainerCommands,
  findPlacedExplainer,
  removeExplainerCommands,
  type ExplainerRequest,
  type ExplainerScript,
  type FoundImage,
  type ImageSourceKind,
  type PlacedExplainer,
  type PlacedLine
} from '@shared/ai/explainer'
import { applyCommands } from '@shared/commands/apply'
import type { GeneratedBy, ModelRef } from '@shared/ai/types'
import { projectDurationMs } from '@shared/project/queries'
import type { Ms, Project, SubtitleStyle, TextLook } from '@shared/project/types'
import { telopSize } from '@shared/render/telop'

import { api, toAppError } from '../api'
import { measureContext } from '../lib/fonts'
import { useEditorStore } from './store'

/**
 * 解説パートを作る流れ: AI が台本を書く → セリフを合成する → 参考画像を探す → タイムラインに並べる(1回の「元に戻す」で戻る)。
 * 合成を先に済ませるので、セリフの長さどおりに並び、画像もセリフに合わせて出し入れできる。
 */

export type ExplainerPhase =
  | { kind: 'idle' }
  | { kind: 'writing' }
  | { kind: 'voicing'; done: number; total: number }
  | { kind: 'images'; done: number; total: number }
  | {
      kind: 'done'
      lines: number
      images: number
      /** 出どころごとの画像の数。 */
      imageKinds: Record<ImageSourceKind, number>
      missingImages: number
      durationMs: Ms
      webSearched: boolean
      generatedBy: GeneratedBy
      warnings: string[]
      /** 前回の解説を作り直した。 */
      replaced: boolean
    }
  | { kind: 'error'; message: string }

/** 前回作った解説(作り直すときに、消して同じ場所に置き直すため)。 */
export interface LastExplainer {
  /** タイムラインの解説のグループ。グループごと消して置き直す。 */
  groupId: string
  title: string
  lines: { characterId: string; text: string }[]
  /** 後ろの素材をずらして場所を空けたか(作り直すときも同じにする)。 */
  ripple: boolean
  request: ExplainerRequest
  options: ExplainerOptions
}

interface ExplainerState {
  phase: ExplainerPhase
  /** 途中でやめるための印。 */
  cancelled: boolean
  /** 作った解説(新しい順)。作り直したあと「元に戻す」で前回に戻しても、残っている方を作り直せるように。 */
  history: LastExplainer[]
  /** ダイアログの入力(閉じても覚えておき、開き直したときに戻す)。 */
  draft: ExplainerDraft | null
  /** 設定のダイアログを開いている。 */
  dialogOpen: boolean
  /**
   * 確認パネル(画面の操作をふさがない小さな欄)を出している。作り終えたらダイアログを閉じてこれを出し、
   * プレビューで確かめながら、追加の要件を書いて作り直せるようにする。
   */
  reviewOpen: boolean
}

/** ダイアログの入力。 */
export interface ExplainerDraft {
  request: ExplainerRequest
  options: ExplainerOptions
}

export const useExplainerStore = create<ExplainerState>(() => ({
  phase: { kind: 'idle' },
  cancelled: false,
  history: [],
  draft: null,
  dialogOpen: false,
  reviewOpen: false
}))

const MAX_HISTORY = 10

export function saveExplainerDraft(draft: ExplainerDraft): void {
  useExplainerStore.setState({ draft })
}

/** 設定のダイアログを開く(確認パネルは隠す。作っている途中なら、その進み具合をダイアログに出す)。 */
export function openExplainerDialog(): void {
  const { phase } = useExplainerStore.getState()
  const running = phase.kind === 'writing' || phase.kind === 'voicing' || phase.kind === 'images'
  useExplainerStore.setState({ dialogOpen: true, reviewOpen: false, ...(running ? {} : { phase: { kind: 'idle' } as const }) })
}

export function closeExplainerDialog(): void {
  useExplainerStore.setState({ dialogOpen: false })
}

/** 確認パネルを出す(作り直せる解説があるときだけ意味がある)。 */
export function openExplainerReview(): void {
  useExplainerStore.setState({ dialogOpen: false, reviewOpen: true })
}

export function closeExplainerReview(): void {
  useExplainerStore.setState({ reviewOpen: false })
}

export interface ExplainerOptions {
  model: ModelRef | null
  webSearch: boolean
  /** 置く場所。playhead: 再生位置 / end: 最後に足す。 */
  place: 'playhead' | 'end'
  /** 再生位置に置くとき、後ろの素材をずらして場所を空ける。 */
  ripple: boolean
  showTitle: boolean
  /** 解説のあいだ、話すキャラクターの立ち絵を出す(表示の区間が切れていれば足す)。 */
  showPortraits: boolean
}

function setPhase(phase: ExplainerPhase): void {
  useExplainerStore.setState({ phase })
}

export function cancelExplainer(): void {
  useExplainerStore.setState({ cancelled: true })
}

class Cancelled extends Error {}

function checkCancelled(): void {
  if (useExplainerStore.getState().cancelled) throw new Cancelled()
}

/** セリフを順に合成する(合成済みの音声は次から使い回される)。 */
async function voiceLines(script: ExplainerScript): Promise<PlacedLine[]> {
  const placed: PlacedLine[] = []
  for (const [index, line] of script.lines.entries()) {
    checkCancelled()
    setPhase({ kind: 'voicing', done: index, total: script.lines.length })
    const character = useEditorStore.getState().project.characters[line.characterId]
    if (!character) continue
    const { engineId, speakerId, speakerName: _name, ...params } = character.voice
    // 読み間違えないよう、字幕とは別の読み上げ用の文で合成する。
    const outcome = await api.invoke('voice:synthesize', { engineId, speakerId, text: line.speech, params })
    placed.push({
      ...line,
      synthesis: { cacheKey: outcome.cacheKey, audioDurationMs: outcome.audioDurationMs, lipSync: outcome.lipSync, accentPhrases: outcome.accentPhrases }
    })
  }
  return placed
}

/**
 * 画像を探す。AI がウェブで見つけた候補(一次ソースが先)を試し、使えなければ Commons を言葉で探す。
 * 同じ候補・言葉は1回だけ探し、見つからなければその画像は出さない。
 */
async function findImages(lines: PlacedLine[]): Promise<(FoundImage | null)[]> {
  const total = lines.filter((line) => line.image).length
  const cache = new Map<string, FoundImage | null>()
  const result: (FoundImage | null)[] = []
  let done = 0
  for (const line of lines) {
    if (!line.image) {
      result.push(null)
      continue
    }
    checkCancelled()
    setPhase({ kind: 'images', done, total })
    const { sources } = line.image
    // Commons は英語の説明が多いので、英語の言葉から探し、無ければ日本語で探す。
    const queries = [line.image.queryEn, line.image.query].filter((query) => query.trim() !== '')
    const key = JSON.stringify([sources.map((source) => source.imageUrl ?? source.pageUrl), queries])
    if (!cache.has(key)) cache.set(key, await api.invoke('images:find', { sources, queries }))
    result.push(cache.get(key) ?? null)
    done++
  }
  return result
}

/** テロップの幅を、画面と同じ描き方で測る。 */
function measureWith(style: SubtitleStyle | undefined): ((text: string, look: TextLook) => number) | undefined {
  if (!style) return undefined
  return (text, look) => telopSize(measureContext(), { text, look }, style).width
}

/** 作り直せる解説(作った中で、タイムラインに残っているいちばん新しいもの)。無ければ null。 */
export function findRedoable(history: readonly LastExplainer[], project: Project): { last: LastExplainer; placed: PlacedExplainer } | null {
  for (const last of history) {
    const placed = findPlacedExplainer(project, last.groupId)
    if (placed) return { last, placed }
  }
  return null
}

export function redoableExplainer(): { last: LastExplainer; placed: PlacedExplainer } | null {
  return findRedoable(useExplainerStore.getState().history, useEditorStore.getState().project)
}

/** 確認パネルから作り直す(前回と同じ設定に、追加の要件を足す)。 */
export function redoExplainer(requirement: string): Promise<void> {
  const redoable = redoableExplainer()
  if (!redoable) {
    setPhase({ kind: 'error', message: '作り直す解説がタイムラインに見つかりません(消したか、グループを解いたため)' })
    return Promise.resolve()
  }
  return createExplainer(redoable.last.request, redoable.last.options, { requirement })
}

/**
 * 解説パートを作って並べる。成功したら並べたアイテムを選んだ状態にする。
 * redo を渡すと作り直す: 前回の台本と追加の要件を AI に渡して書き直させ、前回の解説を消して同じ場所に置き直す(1回の「元に戻す」で前回に戻る)。
 */
export async function createExplainer(request: ExplainerRequest, options: ExplainerOptions, redo?: { requirement: string }): Promise<void> {
  useExplainerStore.setState({ cancelled: false })
  try {
    const previous = redo ? redoableExplainer() : null
    if (redo && !previous) throw new Error('前回の解説がタイムラインに見つかりません(消したか、グループを解いたため)。「作る」で新しく作ってください')
    if (previous?.placed.locked) throw new Error('前回の解説にロックしたものがあるため、作り直せません。ロックを外してください')
    const fullRequest: ExplainerRequest = previous
      ? { ...request, revision: { title: previous.last.title, lines: previous.last.lines, requirement: redo!.requirement } }
      : request

    setPhase({ kind: 'writing' })
    const { script, generatedBy, webSearched } = await api.invoke('ai:explainer', useEditorStore.getState().project, fullRequest, {
      model: options.model,
      webSearch: options.webSearch
    })
    checkCancelled()
    const lines = await voiceLines(script)
    const images = request.images ? await findImages(lines) : lines.map(() => null)
    checkCancelled()

    const { project: current, playheadMs, dispatch, setSelection } = useEditorStore.getState()
    // 作り直すときは、前回の解説を消してから(後ろをずらしていたなら戻してから)、同じ場所に置く。
    const target = previous ? findPlacedExplainer(current, previous.last.groupId) : null
    if (previous && !target) throw new Error('前回の解説がタイムラインに見つかりません(作り直しの途中で消されました)')
    const ripple = previous ? previous.last.ripple : options.place === 'playhead' && options.ripple
    const removal = target ? removeExplainerCommands(current, target, ripple) : []
    const project = removal.length > 0 ? applyCommands(current, removal, { newId: (prefix) => `${prefix}_dry${nanoid(6)}`, now: () => new Date() }).project : current
    const atMs = target ? target.startMs : options.place === 'end' ? projectDurationMs(project) : Math.round(playheadMs)
    const style = Object.values(project.subtitleStyles)[0]
    const measure = measureWith(style)
    const commands = explainerCommands(project, {
      atMs,
      title: script.title,
      lines,
      images,
      ripple,
      showTitle: options.showTitle,
      showPortraits: options.showPortraits,
      gapMs: project.editing.defaultGapMs,
      ...(measure ? { measure } : {})
    })
    const result = dispatch([...removal, ...commands], previous ? `解説「${script.title}」を作り直す` : `解説「${script.title}」を作る`)
    if (!result.ok) throw new Error(result.message)
    const groupId = result.resolvedIds[EXPLAINER_GROUP_TEMP_ID]
    if (groupId) {
      const entry: LastExplainer = { groupId, title: script.title, lines: script.lines.map((line) => ({ characterId: line.characterId, text: line.text })), ripple, request, options }
      useExplainerStore.setState((state) => ({ history: [entry, ...state.history].slice(0, MAX_HISTORY) }))
    }
    const ids = Object.entries(result.resolvedIds)
      .filter(([key]) => /^ex-(v|i|c|p)\d+$|^ex-title$/.test(key))
      .map(([, id]) => id)
    setSelection(ids)
    useEditorStore.getState().setPlayhead(atMs)
    const wanted = lines.filter((line) => line.image).length
    const found = images.filter((image) => image !== null).length
    const imageKinds: Record<ImageSourceKind, number> = { primary: 0, reliable: 0, free: 0 }
    for (const image of images) if (image) imageKinds[image.kind]++
    setPhase({
      kind: 'done',
      lines: lines.length,
      images: found,
      imageKinds,
      missingImages: wanted - found,
      durationMs: lines.reduce((sum, line) => sum + line.synthesis.audioDurationMs, 0) + project.editing.defaultGapMs * Math.max(0, lines.length - 1),
      webSearched,
      generatedBy,
      warnings: script.warnings,
      replaced: previous !== null
    })
    // 作り終えたらダイアログを閉じ、確認パネルを出す(プレビューで確かめながら作り直せるように)。
    if (groupId) openExplainerReview()
  } catch (error) {
    if (error instanceof Cancelled) {
      setPhase({ kind: 'idle' })
      return
    }
    const appError = toAppError(error)
    setPhase({ kind: 'error', message: `${appError.message}。${appError.guidance}` })
  }
}

export function resetExplainer(): void {
  useExplainerStore.setState({ phase: { kind: 'idle' }, cancelled: false })
}
