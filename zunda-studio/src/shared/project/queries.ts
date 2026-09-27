import type { Item, ItemId, Ms, Project, VoiceItem } from './types'

export function findItem(project: Project, itemId: ItemId): Item | undefined {
  return project.items.find((item) => item.id === itemId)
}

export function requireItem(project: Project, itemId: ItemId): Item {
  const item = findItem(project, itemId)
  if (!item) throw new Error(`アイテムが見つかりません: ${itemId}`)
  return item
}

export function itemEndMs(item: Item): Ms {
  return item.startMs + item.durationMs
}

/** プロジェクト全体の尺。アイテムが無ければ 0。 */
export function projectDurationMs(project: Project): Ms {
  return project.items.reduce((max, item) => Math.max(max, itemEndMs(item)), 0)
}

export function isVoiceItem(item: Item): item is VoiceItem {
  return item.type === 'voice'
}

/** ボイスアイテムを発話順(開始時刻順)に返す。台本ビューの表示順でもある。 */
export function voiceItemsInOrder(project: Project): VoiceItem[] {
  return project.items.filter(isVoiceItem).sort((a, b) => a.startMs - b.startMs)
}

/** 指定時刻に表示・再生されるアイテム。描画順(レイヤーの index 昇順)で返す。 */
export function itemsAt(project: Project, timeMs: Ms): Item[] {
  const layerIndex = new Map(project.layers.map((layer) => [layer.id, layer.index]))
  return project.items
    .filter((item) => item.startMs <= timeMs && timeMs < itemEndMs(item))
    .sort((a, b) => (layerIndex.get(a.layerId) ?? 0) - (layerIndex.get(b.layerId) ?? 0))
}
