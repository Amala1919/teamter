import type { Crop, ImageItem, Item, Project, VideoItem } from '../project/types'
import { croppedSize, normalizedCrop } from './compositor'
import { shapeSize } from './shapes'
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
      return asset?.type === 'image' ? croppedSize(asset.width, asset.height, item.crop) : null
    }
    case 'video': {
      const asset = project.assets[item.assetId]
      if (asset?.type !== 'video') return null
      const fit = Math.min(project.canvas.width / asset.width, project.canvas.height / asset.height)
      return croppedSize(asset.width * fit, asset.height * fit, item.crop)
    }
    case 'shape':
      return shapeSize(item, project.canvas)
  }
}

/** 切り抜いた部分の中心の、切り抜く前の素材の中心からのずれ(画面上。回転込み)。 */
function cropOffset(size: { width: number; height: number }, rotation: number, crop: Crop | undefined): { x: number; y: number } {
  const c = normalizedCrop(crop)
  const dx = ((c.left - c.right) / 2) * size.width
  const dy = ((c.top - c.bottom) / 2) * size.height
  const angle = (rotation * Math.PI) / 180
  return { x: dx * Math.cos(angle) - dy * Math.sin(angle), y: dx * Math.sin(angle) + dy * Math.cos(angle) }
}

/**
 * 切り抜く前の素材の中心と大きさ(画面上、拡大率込み)。切り抜いた素材は、残った部分の中心が置いた位置になる。
 * 切り抜きを編集するとき、素材全体を元の場所に出すのに使う。
 */
export function uncroppedPlacement(project: Project, item: VideoItem | ImageItem, measure: Ctx2D): { center: { x: number; y: number }; size: { width: number; height: number } } | null {
  const base = itemBaseSize(project, { ...item, crop: { left: 0, top: 0, right: 0, bottom: 0 } }, measure)
  if (!base) return null
  const size = { width: base.width * item.transform.scale, height: base.height * item.transform.scale }
  const offset = cropOffset(size, item.transform.rotation, item.crop)
  return { center: { x: item.transform.x - offset.x, y: item.transform.y - offset.y }, size }
}

/** 切り抜きを変えたとき、残る部分が画面の同じ場所に残るような、置く位置(残った部分の中心)。 */
export function centerForCrop(whole: { center: { x: number; y: number }; size: { width: number; height: number } }, rotation: number, crop: Crop): { x: number; y: number } {
  const offset = cropOffset(whole.size, rotation, crop)
  return { x: Math.round(whole.center.x + offset.x), y: Math.round(whole.center.y + offset.y) }
}

/** 画面の上での範囲(回転は考えない)。中心は置いた位置。 */
export function itemBox(project: Project, item: PlacedItem, measure: Ctx2D): { x: number; y: number; width: number; height: number } | null {
  const size = itemBaseSize(project, item, measure)
  if (!size) return null
  const width = size.width * item.transform.scale
  const height = size.height * item.transform.scale
  return { x: item.transform.x - width / 2, y: item.transform.y - height / 2, width, height }
}
