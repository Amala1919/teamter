import type { Item, Project } from '../project/types'
import { telopSize } from './telop'
import type { Ctx2D } from './types'

/** 位置・大きさを持つ素材(プレビューで動かせるもの)。 */
export type PlacedItem = Extract<Item, { type: 'text' | 'image' | 'shape' | 'video' }>

export function isPlacedItem(item: Item): item is PlacedItem {
  return item.type === 'text' || item.type === 'image' || item.type === 'shape' || item.type === 'video'
}

/** 等倍(拡大率 1)のときの大きさ。compositor の描き方と同じ基準。テロップは文字を測るので context を使う。 */
export function itemBaseSize(project: Project, item: PlacedItem, measure: Ctx2D): { width: number; height: number } | null {
  switch (item.type) {
    case 'text': {
      const style = project.subtitleStyles[item.styleId]
      return style ? telopSize(measure, item, style) : null
    }
    case 'image': {
      const asset = project.assets[item.assetId]
      return asset?.type === 'image' ? { width: asset.width, height: asset.height } : null
    }
    case 'video': {
      const asset = project.assets[item.assetId]
      if (asset?.type !== 'video') return null
      const fit = Math.min(project.canvas.width / asset.width, project.canvas.height / asset.height)
      return { width: asset.width * fit, height: asset.height * fit }
    }
    case 'shape':
      return { width: project.canvas.width, height: project.canvas.height }
  }
}

/** 画面の上での範囲(回転は考えない)。中心は置いた位置。 */
export function itemBox(project: Project, item: PlacedItem, measure: Ctx2D): { x: number; y: number; width: number; height: number } | null {
  const size = itemBaseSize(project, item, measure)
  if (!size) return null
  const width = size.width * item.transform.scale
  const height = size.height * item.transform.scale
  return { x: item.transform.x - width / 2, y: item.transform.y - height / 2, width, height }
}
