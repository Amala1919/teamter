import type { Item, Project } from './types'

/**
 * タイムラインでの素材の色。動画には出ない、見分けるための印。
 * 素材ごとの色 > レイヤーの色 > 種類ごとの色(画面のスタイル)の順に決まる。
 */

/** 色は不透明の #rrggbb だけ(見分けるための印なので、透明にはしない)。 */
export const TIMELINE_COLOR = /^#[0-9a-fA-F]{6}$/

/** 右クリックから選べる色。暗い画面で見分けやすい明るさにそろえてある。 */
export const TIMELINE_PALETTE: readonly { name: string; swatch: string; hex: string }[] = [
  { name: '赤', swatch: '🟥', hex: '#d64545' },
  { name: '橙', swatch: '🟧', hex: '#e07b28' },
  { name: '黄', swatch: '🟨', hex: '#d4b21f' },
  { name: '緑', swatch: '🟩', hex: '#3fa34d' },
  { name: '水色', swatch: '🩵', hex: '#2fa7c9' },
  { name: '青', swatch: '🟦', hex: '#3b6fd6' },
  { name: '紫', swatch: '🟪', hex: '#8a55d6' },
  { name: '桃', swatch: '🩷', hex: '#d65a9e' },
  { name: '茶', swatch: '🟫', hex: '#8f6a45' },
  { name: '灰', swatch: '⬜', hex: '#7c8894' }
]

/** 素材に付いている色(素材 > レイヤー)。どちらも無ければ null(種類ごとの色で描く)。 */
export function timelineColor(project: Project, item: Item): string | null {
  if (item.color) return item.color
  return project.layers.find((layer) => layer.id === item.layerId)?.color ?? null
}
