import type { Item, Layer, Ms, Project, VoiceItem } from '../project/types'
import { wrapSubtitle } from '../project/subtitle'
import { CommandError, type CommandOf, type CommandOp } from './types'

export interface CommandContext {
  /** 新しいIDを生成する。テストでは決定論的な実装を渡す。 */
  newId: (prefix: string) => string
  now: () => Date
}

/** 1回の適用の間、各処理が共有する状態。 */
export interface ApplyEnv {
  ctx: CommandContext
  /** 一時ID から実際に生成されたID への対応。 */
  resolvedIds: Record<string, string>
  resolve: (id: string) => string
}

export type Handler<K extends CommandOp> = (draft: Project, command: CommandOf<K>, env: ApplyEnv) => void
export type HandlerTable = { [K in CommandOp]: Handler<K> }

/** 未合成のボイスアイテムに与える暫定の尺。合成後に実測値へ置き換わる。 */
const PROVISIONAL_MS_PER_CHAR = 150
const PROVISIONAL_MIN_MS = 500

export function estimateSpeechDurationMs(text: string): number {
  return Math.max(PROVISIONAL_MIN_MS, text.length * PROVISIONAL_MS_PER_CHAR)
}

export function fail(op: CommandOp, message: string): never {
  throw new CommandError(message, op)
}

export function findMutableItem(draft: Project, itemId: string, op: CommandOp): Item {
  const item = draft.items.find((candidate) => candidate.id === itemId)
  if (!item) fail(op, `アイテムが見つかりません: ${itemId}`)
  if (item.locked) fail(op, `アイテムはロックされています: ${itemId}`)
  return item
}

export function findVoiceItem(draft: Project, itemId: string, op: CommandOp): VoiceItem {
  const item = findMutableItem(draft, itemId, op)
  if (item.type !== 'voice') fail(op, 'ボイスアイテムではありません')
  return item
}

export function requireLayer(draft: Project, layerId: string, op: CommandOp): Layer {
  const layer = draft.layers.find((candidate) => candidate.id === layerId)
  if (!layer) fail(op, `レイヤーが見つかりません: ${layerId}`)
  return layer
}

export function requireNonEmptyText(text: string, op: CommandOp): string {
  if (text.trim() === '') fail(op, 'セリフが空です')
  return text
}

export function defaultVoiceLayerId(draft: Project, op: CommandOp): string {
  const layer = draft.layers.find((candidate) => candidate.name === 'ボイス') ?? draft.layers[0]
  if (!layer) fail(op, 'レイヤーが存在しません')
  return layer.id
}

export function itemEnd(item: Item): Ms {
  return item.startMs + item.durationMs
}

/**
 * 基準時刻以降に始まるアイテムをまとめてずらす(リップル編集)。
 * ロックされたアイテムは動かさない。開始時刻は 0 未満にしない。
 */
export function shiftItemsFrom(
  draft: Project,
  pivotMs: Ms,
  deltaMs: Ms,
  exclude: ReadonlySet<string>,
  only: (item: Item) => boolean = () => true
): void {
  if (deltaMs === 0) return
  for (const item of draft.items) {
    if (exclude.has(item.id) || item.locked || item.startMs < pivotMs || !only(item)) continue
    item.startMs = Math.max(0, item.startMs + deltaMs)
  }
}

/** 基準時刻以降に始まるアイテムのうち最も早い開始時刻。無ければ null。 */
export function earliestStartFrom(
  draft: Project,
  pivotMs: Ms,
  exclude: ReadonlySet<string>,
  only: (item: Item) => boolean = () => true
): Ms | null {
  let earliest: Ms | null = null
  for (const item of draft.items) {
    if (exclude.has(item.id) || item.locked || item.startMs < pivotMs || !only(item)) continue
    if (earliest === null || item.startMs < earliest) earliest = item.startMs
  }
  return earliest
}

/** セリフに使う字幕スタイルの1行の文字数で自動改行する。 */
export function autoSubtitleLines(draft: Project, item: VoiceItem): string[] {
  const character = draft.characters[item.characterId]
  const styleId = item.subtitleOverride?.styleId ?? character?.subtitleStyleId
  const style = styleId === undefined ? undefined : draft.subtitleStyles[styleId]
  return wrapSubtitle(item.text, style?.maxCharsPerLine ?? 22)
}

export function refreshSubtitleLines(draft: Project, item: VoiceItem): void {
  if (!item.subtitleLinesManual) item.subtitleLines = autoSubtitleLines(draft, item)
}

/** 声に関わる変更の後に呼ぶ。合成結果を無効にして、合成し直しの対象にする。尺は新しい結果が届くまで変えない。 */
export function invalidateSynthesis(item: VoiceItem): void {
  item.synthesis = null
}

/**
 * 指定のレイヤー、無ければ既定のレイヤー(ID が一致するもの、無ければ名前が一致するもの)を返す。
 * どちらも無ければ最も下のレイヤー。
 */
export function layerOrDefault(
  draft: Project,
  layerId: string | undefined,
  fallback: { id: string; name: string },
  op: CommandOp,
  resolve: (id: string) => string
): string {
  if (layerId !== undefined) return requireLayer(draft, resolve(layerId), op).id
  const layer =
    draft.layers.find((candidate) => candidate.id === fallback.id) ??
    draft.layers.find((candidate) => candidate.name === fallback.name) ??
    [...draft.layers].sort((a, b) => a.index - b.index)[0]
  if (!layer) fail(op, 'レイヤーが存在しません')
  return layer.id
}

/** 指定の位置にレイヤーを差し込み、それ以降を押し上げる。 */
export function insertLayer(draft: Project, layer: Layer): void {
  for (const existing of draft.layers) {
    if (existing.index >= layer.index) existing.index += 1
  }
  draft.layers.push(layer)
  draft.layers.sort((a, b) => a.index - b.index)
}

export function requireFinite(value: number, op: CommandOp, label: string): number {
  if (!Number.isFinite(value)) fail(op, `${label}が数値ではありません`)
  return value
}

/** 動画を切ったとき(分けた・端を切った)に付けるフェードの既定の長さ。 */
export const DEFAULT_CUT_FADE_MS = 300

/**
 * 動画の切った所をフェードさせる(設定の「編集」で長さを選ぶ。0 ならしない)。
 * 既にフェードがあれば、その側が 0 のときだけ付ける(利用者が決めた長さは変えない)。静止画には付けない。
 */
export function fadeCutEdge(draft: Project, item: Item, edge: 'in' | 'out'): void {
  if (item.type !== 'video' || item.freeze) return
  const length = edge === 'in' ? (draft.editing.cutFadeInMs ?? DEFAULT_CUT_FADE_MS) : (draft.editing.cutFadeOutMs ?? DEFAULT_CUT_FADE_MS)
  if (length <= 0) return
  // 短い動画でも、フェードが長さの半分を超えないようにする。
  const ms = Math.min(length, Math.floor(item.durationMs / 2))
  if (ms <= 0) return
  const fade = item.effects.find((effect) => effect.type === 'fade')
  if (!fade) {
    item.effects.push({ type: 'fade', inMs: edge === 'in' ? ms : 0, outMs: edge === 'out' ? ms : 0 })
    return
  }
  if (fade.type !== 'fade') return
  if (edge === 'in' && fade.inMs === 0) fade.inMs = ms
  if (edge === 'out' && fade.outMs === 0) fade.outMs = ms
}
