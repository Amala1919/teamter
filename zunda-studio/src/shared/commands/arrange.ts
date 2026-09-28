import { DEFAULT_LAYER_IDS } from '../project/factory'
import type { Item, ItemId, Layer, Project } from '../project/types'
import { insertLayer, itemEnd, type ApplyEnv } from './env'

/**
 * 同じレイヤーで素材が時間的に重なったとき、動かした(足した)方を、その時間が空いている同じ種類のレイヤーへ移す。
 * 空いているレイヤーが無ければ、すぐ上に同じ種類のレイヤーを増やす(ゆっくりムービーメーカーと同じ考え方)。
 * 1つのレイヤーには同じ時刻に1つの素材だけになるので、どちらが手前に描かれるかも「上のレイヤーが手前」ではっきりする。
 *
 * 立ち絵の区間とズームは対象にしない。立ち絵の区間は同じレイヤーで重ねて使うもの(出す区間の中で表情だけ変える等)で、
 * ズームはレイヤーの位置で拡大する範囲が決まるため。
 */

export type ArrangeCategory = 'voice' | 'audio' | 'visual'
type LayerCategory = ArrangeCategory | 'portrait' | 'zoom'

export function arrangeCategory(item: Item): ArrangeCategory | null {
  switch (item.type) {
    case 'voice':
      return 'voice'
    case 'audio':
      return 'audio'
    case 'video':
    case 'image':
    case 'text':
    case 'shape':
      return 'visual'
    default:
      return null
  }
}

function itemCategory(item: Item): LayerCategory {
  return arrangeCategory(item) ?? (item.type === 'zoom' ? 'zoom' : 'portrait')
}

/** 空の既定のレイヤーが受け持つ種類。 */
const DEFAULT_LAYER_CATEGORY: Record<string, LayerCategory> = {
  [DEFAULT_LAYER_IDS.background]: 'visual',
  [DEFAULT_LAYER_IDS.zoom]: 'zoom',
  [DEFAULT_LAYER_IDS.portrait]: 'portrait',
  [DEFAULT_LAYER_IDS.voice]: 'voice',
  [DEFAULT_LAYER_IDS.bgm]: 'audio'
}

function overlaps(a: { startMs: number; end: number }, b: { startMs: number; end: number }): boolean {
  return a.startMs < b.end && b.startMs < a.end
}

function span(item: Item): { startMs: number; end: number } {
  return { startMs: item.startMs, end: itemEnd(item) }
}

interface Arranger {
  /** 動かしたアイテムの数。 */
  moved: number
}

/**
 * 重なりを解消する。
 * candidates は動かしてよいアイテム(足した・動かした・長さを変えたもの)。先に始まるものから順に見る。
 * before を渡すと、その時点で既にあった重なりはそのままにする(ほかの編集のついでに古い重なりまで動かさないため)。
 */
export function resolveOverlaps(
  draft: Project,
  candidates: readonly ItemId[],
  env: ApplyEnv,
  before?: ReadonlyMap<ItemId, Item>
): Arranger {
  const result: Arranger = { moved: 0 }
  const byId = new Map(draft.items.map((item) => [item.id, item]))
  const queue = candidates
    .map((id) => byId.get(id))
    .filter((item): item is Item => item !== undefined && !item.locked && arrangeCategory(item) !== null)
    .sort((a, b) => a.startMs - b.startMs || a.id.localeCompare(b.id))

  const overlappedBefore = (a: Item, b: Item): boolean => {
    const oldA = before?.get(a.id)
    const oldB = before?.get(b.id)
    return oldA !== undefined && oldB !== undefined && oldA.layerId === oldB.layerId && overlaps(span(oldA), span(oldB))
  }

  // 位置が決まったもの。動かさないアイテムと、先に見た候補。後の候補はまだ動くかもしれないので、重なりの相手にしない。
  const pending = new Set(queue.map((item) => item.id))
  const settled = (other: Item): boolean => !pending.has(other.id)

  for (const item of queue) {
    const conflict = draft.items.some(
      (other) =>
        other.id !== item.id &&
        settled(other) &&
        other.layerId === item.layerId &&
        overlaps(span(item), span(other)) &&
        !overlappedBefore(item, other)
    )
    if (conflict) {
      const target = pickLayer(draft, item, settled) ?? createLayerNextTo(draft, item, env)
      if (target) {
        item.layerId = target.id
        result.moved += 1
      }
    }
    pending.delete(item.id)
  }
  return result
}

/** レイヤーに入っている素材の種類。空なら既定のレイヤーの受け持ち、どれでもなければ null(何でも入れられる)。 */
function layerCategory(draft: Project, layer: Layer): LayerCategory | 'mixed' | null {
  let found: LayerCategory | null = null
  for (const item of draft.items) {
    if (item.layerId !== layer.id) continue
    const category = itemCategory(item)
    if (found !== null && found !== category) return 'mixed'
    found = category
  }
  return found ?? DEFAULT_LAYER_CATEGORY[layer.id] ?? null
}

function usable(layer: Layer, category: ArrangeCategory): boolean {
  // 見えない・ロック中のレイヤー、音の素材ならミュート中のレイヤーには入れない(置いたのに見えない・聞こえないのを防ぐ)。
  return layer.visible && !layer.locked && !(layer.muted && category !== 'visual')
}

function freeAt(draft: Project, layer: Layer, item: Item, settled: (other: Item) => boolean): boolean {
  const range = span(item)
  return !draft.items.some((other) => other.id !== item.id && settled(other) && other.layerId === layer.id && overlaps(range, span(other)))
}

/**
 * 移す先。同じ種類の素材が入っていて、その時間が空いているレイヤーを、元のレイヤーに近い順(同じ距離なら上)に探す。
 * セリフは、同じキャラクターのセリフが入っているレイヤーを先に選ぶ(キャラクターごとにまとまるように)。
 * 空のレイヤーは、元のすぐ隣にあるときだけ使う(遠くの無関係なレイヤーに飛ばさない)。
 */
function pickLayer(draft: Project, item: Item, settled: (other: Item) => boolean): Layer | null {
  const category = arrangeCategory(item)!
  const source = draft.layers.find((layer) => layer.id === item.layerId)
  const sourceIndex = source?.index ?? 0
  let best: { layer: Layer; score: number[] } | null = null
  for (const layer of draft.layers) {
    if (layer.id === item.layerId || !usable(layer, category) || !freeAt(draft, layer, item, settled)) continue
    const kind = layerCategory(draft, layer)
    const empty = !draft.items.some((other) => other.layerId === layer.id)
    const distance = Math.abs(layer.index - sourceIndex)
    let tier: number
    if (!empty && kind === category) {
      const sameCharacter =
        item.type === 'voice' && draft.items.some((other) => other.layerId === layer.id && other.type === 'voice' && other.characterId === item.characterId)
      tier = item.type === 'voice' && !sameCharacter ? 2 : 0
    } else if (empty && (kind === category || kind === null) && distance === 1) {
      tier = 1
    } else {
      continue
    }
    const score = [tier, distance, layer.index > sourceIndex ? 0 : 1]
    if (!best || compare(score, best.score) < 0) best = { layer, score }
  }
  return best?.layer ?? null
}

function compare(a: number[], b: number[]): number {
  for (let index = 0; index < a.length; index += 1) {
    const diff = a[index]! - b[index]!
    if (diff !== 0) return diff
  }
  return 0
}

/** 元のレイヤーのすぐ上に、同じ名前に番号を付けたレイヤーを作る(例: ボイス → ボイス 2)。 */
function createLayerNextTo(draft: Project, item: Item, env: ApplyEnv): Layer | null {
  const source = draft.layers.find((layer) => layer.id === item.layerId)
  if (!source) return null
  const base = source.name.replace(/\s+\d+$/, '')
  const names = new Set(draft.layers.map((layer) => layer.name))
  let number = 2
  while (names.has(`${base} ${number}`)) number += 1
  const layer: Layer = {
    id: env.ctx.newId('lyr'),
    name: `${base} ${number}`,
    index: source.index + 1,
    visible: true,
    locked: false,
    muted: false
  }
  insertLayer(draft, layer)
  return draft.layers.find((candidate) => candidate.id === layer.id) ?? null
}

/** 素材の無いレイヤーを消す(既定のレイヤーは残す)。消した数を返す。 */
export function removeEmptyLayers(draft: Project): number {
  const used = new Set(draft.items.map((item) => item.layerId))
  const keep = new Set<string>(Object.values(DEFAULT_LAYER_IDS))
  const before = draft.layers.length
  draft.layers = draft.layers.filter((layer) => used.has(layer.id) || keep.has(layer.id))
  draft.layers.sort((a, b) => a.index - b.index).forEach((layer, index) => (layer.index = index))
  return before - draft.layers.length
}

/**
 * 1回のコマンド列の前後を比べて、動かしてよいアイテム(新しく足した・レイヤーや時間が変わったもの)を選ぶ。
 */
export function changedItems(before: ReadonlyMap<ItemId, Item>, after: readonly Item[]): ItemId[] {
  return after
    .filter((item) => {
      const old = before.get(item.id)
      return !old || old.layerId !== item.layerId || old.startMs !== item.startMs || old.durationMs !== item.durationMs
    })
    .map((item) => item.id)
}
