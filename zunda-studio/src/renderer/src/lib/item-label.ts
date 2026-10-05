import type { Item, Project } from '@shared/project/types'
import { SHAPE_DEFAULTS } from '@shared/render/shapes'
import { ZOOM_METHOD_LABELS } from '@shared/render/zoom'

import { assetName } from '../state/media'

/** アイテムを見分けるための短い名前(タイムラインの表示・インスペクタのグループの一覧に使う)。 */
export function itemLabel(project: Project, item: Item): string {
  switch (item.type) {
    case 'voice':
      return item.text
    case 'video':
      return `${item.freeze ? '静止画: ' : ''}${assetName(project.assets[item.assetId])}`
    case 'image':
    case 'audio':
      return assetName(project.assets[item.assetId])
    case 'text':
      return item.text
    case 'shape':
      return SHAPE_DEFAULTS[item.shape]?.label ?? '図形'
    case 'zoom':
      return `ズーム(${ZOOM_METHOD_LABELS[item.method]})`
    case 'portrait': {
      const name = project.characters[item.characterId]?.name ?? ''
      const kind = item.kind ?? 'show'
      const expression = item.expressionId ? project.characters[item.characterId]?.portrait?.expressions[item.expressionId]?.name : undefined
      const label = kind === 'hide' ? `隠す: ${name}` : kind === 'adjust' ? `調整: ${name}` : item.untilEnd ? `立ち絵: ${name}` : `登場: ${name}`
      return expression ? `${label}(${expression})` : label
    }
  }
}
