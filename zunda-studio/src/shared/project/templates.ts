import { z } from 'zod'

import { itemEndMs } from './queries'
import type { Asset, AssetId, CharacterId, Item, ItemId, LayerId, Ms, Project, SubtitleStyle } from './types'

/**
 * ひな形(オープニング・エンディングなど、毎回使う並び)。選んだ素材をアプリに保存し、どのプロジェクトにも入れられる。
 * 素材の場所・字幕スタイル・キャラクターの名前もいっしょに持ち、入れる先のプロジェクトのものに合わせる。
 */

export type TemplateKind = 'opening' | 'ending' | 'other'

export const TEMPLATE_KIND_LABELS: Record<TemplateKind, string> = {
  opening: 'オープニング',
  ending: 'エンディング',
  other: 'そのほか'
}

export interface ProjectTemplate {
  id: string
  name: string
  kind: TemplateKind
  /** 新しいプロジェクトに自動で入れる(オープニングは先頭、エンディングは最後)。 */
  autoAdd: boolean
  createdAt: string
  durationMs: Ms
  /** 開始時刻は、ひな形の頭を 0 とした時刻。 */
  items: Item[]
  assets: Record<AssetId, Asset>
  subtitleStyles: Record<string, SubtitleStyle>
  /** 素材を置いていたレイヤー(入れる先では同じ名前のレイヤーに置く)。 */
  layers: { id: LayerId; name: string; index: number }[]
  /** セリフのキャラクター(入れる先では、アプリに保存したキャラクターか同じ名前のキャラクターに合わせる)。 */
  characters: { id: CharacterId; name: string; libraryId?: string }[]
}

/** 保存できるひな形の形(中身の素材の形はコマンドの適用で確かめる)。 */
export const projectTemplateSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(100),
  kind: z.enum(['opening', 'ending', 'other']),
  autoAdd: z.boolean(),
  createdAt: z.string().max(64),
  durationMs: z.number().min(1).max(24 * 60 * 60 * 1000),
  items: z.array(z.record(z.string(), z.unknown())).min(1).max(1000),
  assets: z.record(z.string(), z.record(z.string(), z.unknown())),
  subtitleStyles: z.record(z.string(), z.record(z.string(), z.unknown())),
  layers: z.array(z.object({ id: z.string(), name: z.string().max(100), index: z.number() })).max(200),
  characters: z.array(z.object({ id: z.string(), name: z.string().max(100), libraryId: z.string().optional() })).max(100)
})

/** 選んだ素材からひな形を作る(立ち絵の区間とズームは含めない。立ち絵はキャラクターの設定、ズームは素材に依るため)。 */
export function templateFromItems(
  project: Project,
  itemIds: readonly ItemId[],
  meta: { id: string; name: string; kind: TemplateKind; autoAdd: boolean; createdAt: string }
): ProjectTemplate | null {
  const items = project.items.filter((item) => itemIds.includes(item.id) && item.type !== 'portrait' && item.type !== 'zoom')
  if (items.length === 0) return null
  const start = Math.min(...items.map((item) => item.startMs))
  const end = Math.max(...items.map((item) => itemEndMs(item)))
  const assets: Record<AssetId, Asset> = {}
  const subtitleStyles: Record<string, SubtitleStyle> = {}
  const characters: ProjectTemplate['characters'] = []
  for (const item of items) {
    if ('assetId' in item) {
      const asset = project.assets[item.assetId]
      if (asset) assets[item.assetId] = structuredClone(asset)
    }
    if (item.type === 'text') {
      const style = project.subtitleStyles[item.styleId]
      if (style) subtitleStyles[style.id] = structuredClone(style)
    }
    if (item.type === 'voice' && !characters.some((character) => character.id === item.characterId)) {
      const character = project.characters[item.characterId]
      if (character) characters.push({ id: character.id, name: character.name, ...(character.libraryId ? { libraryId: character.libraryId } : {}) })
    }
  }
  const usedLayers = new Set(items.map((item) => item.layerId))
  return {
    ...meta,
    durationMs: end - start,
    items: items.map((item) => {
      const copy = structuredClone(item)
      copy.startMs -= start
      copy.locked = false
      return copy
    }),
    assets,
    subtitleStyles,
    layers: project.layers.filter((layer) => usedLayers.has(layer.id)).map((layer) => ({ id: layer.id, name: layer.name, index: layer.index })),
    characters
  }
}
