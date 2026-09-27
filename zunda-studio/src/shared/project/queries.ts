import type { Item, ItemId, Ms, Project, VoiceItem, VoiceParams } from './types'

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

export interface EffectiveVoice {
  engineId: string
  speakerId: number
  params: VoiceParams
}

/** キャラクターの既定値にアイテムの上書きを重ねた、実際に合成に使う声。キャラクターが無ければ null。 */
export function effectiveVoice(project: Project, item: VoiceItem): EffectiveVoice | null {
  const character = project.characters[item.characterId]
  if (!character) return null
  const base = character.voice
  const override = item.voiceOverride ?? {}
  return {
    engineId: base.engineId,
    speakerId: base.speakerId,
    params: {
      speedScale: override.speedScale ?? base.speedScale,
      pitchScale: override.pitchScale ?? base.pitchScale,
      intonationScale: override.intonationScale ?? base.intonationScale,
      volumeScale: override.volumeScale ?? base.volumeScale,
      prePhonemeLength: override.prePhonemeLength ?? base.prePhonemeLength,
      postPhonemeLength: override.postPhonemeLength ?? base.postPhonemeLength
    }
  }
}

/** 合成結果が今のセリフ・声に対応しているかを判定するための署名。 */
export function synthesisSignature(project: Project, item: VoiceItem): string | null {
  const voice = effectiveVoice(project, item)
  return voice ? JSON.stringify([voice.engineId, voice.speakerId, item.text, voice.params]) : null
}
