import { create } from 'zustand'

import { explainerCommands, type ExplainerRequest, type ExplainerScript, type FoundImage, type ImageSourceKind, type PlacedLine } from '@shared/ai/explainer'
import type { GeneratedBy, ModelRef } from '@shared/ai/types'
import { projectDurationMs } from '@shared/project/queries'
import type { Ms, SubtitleStyle, TextLook } from '@shared/project/types'
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
    }
  | { kind: 'error'; message: string }

interface ExplainerState {
  phase: ExplainerPhase
  /** 途中でやめるための印。 */
  cancelled: boolean
}

export const useExplainerStore = create<ExplainerState>(() => ({ phase: { kind: 'idle' }, cancelled: false }))

export interface ExplainerOptions {
  model: ModelRef | null
  webSearch: boolean
  /** 置く場所。playhead: 再生位置 / end: 最後に足す。 */
  place: 'playhead' | 'end'
  /** 再生位置に置くとき、後ろの素材をずらして場所を空ける。 */
  ripple: boolean
  showTitle: boolean
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
    const outcome = await api.invoke('voice:synthesize', { engineId, speakerId, text: line.text, params })
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

/** 解説パートを作って並べる。成功したら並べたアイテムを選んだ状態にする。 */
export async function createExplainer(request: ExplainerRequest, options: ExplainerOptions): Promise<void> {
  useExplainerStore.setState({ cancelled: false })
  try {
    setPhase({ kind: 'writing' })
    const { script, generatedBy, webSearched } = await api.invoke('ai:explainer', useEditorStore.getState().project, request, {
      model: options.model,
      webSearch: options.webSearch
    })
    checkCancelled()
    const lines = await voiceLines(script)
    const images = request.images ? await findImages(lines) : lines.map(() => null)
    checkCancelled()

    const { project, playheadMs, dispatch, setSelection } = useEditorStore.getState()
    const atMs = options.place === 'end' ? projectDurationMs(project) : Math.round(playheadMs)
    const style = Object.values(project.subtitleStyles)[0]
    const measure = measureWith(style)
    const commands = explainerCommands(project, {
      atMs,
      title: script.title,
      lines,
      images,
      ripple: options.place === 'playhead' && options.ripple,
      showTitle: options.showTitle,
      gapMs: project.editing.defaultGapMs,
      ...(measure ? { measure } : {})
    })
    const result = dispatch(commands, `解説「${script.title}」を作る`)
    if (!result.ok) throw new Error(result.message)
    const ids = Object.entries(result.resolvedIds)
      .filter(([key]) => /^ex-(v|i|c)\d+$|^ex-title$/.test(key))
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
      warnings: script.warnings
    })
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
