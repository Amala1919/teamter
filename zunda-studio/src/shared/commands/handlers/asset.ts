import type { Asset, Project } from '../../project/types'
import { fail, type HandlerTable } from '../env'

type AssetHandlers = Pick<HandlerTable, 'asset.add' | 'asset.updateLicense' | 'asset.remove'>

function assetInUse(draft: Project, assetId: string): boolean {
  const usedByItem = draft.items.some((item) => 'assetId' in item && item.assetId === assetId)
  const usedByPortrait = Object.values(draft.characters).some((character) => character.portrait?.assetId === assetId)
  return usedByItem || usedByPortrait
}

function validateAsset(asset: Asset, op: 'asset.add'): void {
  if (asset.path.absolute.trim() === '') fail(op, '素材の場所が空です')
  if (typeof asset.license?.source !== 'string') fail(op, '素材の入手元(ライセンス情報)が必要です')
  if ((asset.type === 'video' || asset.type === 'audio') && !(asset.durationMs > 0)) fail(op, '素材の長さが不正です')
}

export const assetHandlers: AssetHandlers = {
  'asset.add': (draft, command, env) => {
    validateAsset(command.asset, command.op)
    // 同じファイルを二重に登録しない。既にあればそれを使う。
    const existing = Object.entries(draft.assets).find(
      ([, asset]) => asset.path.absolute === command.asset.path.absolute && asset.type === command.asset.type
    )
    if (existing) {
      if (command.tempId) env.resolvedIds[command.tempId] = existing[0]
      return
    }
    const id = env.ctx.newId('ast')
    draft.assets[id] = command.asset
    if (command.tempId) env.resolvedIds[command.tempId] = id
  },

  'asset.updateLicense': (draft, command, env) => {
    const asset = draft.assets[env.resolve(command.assetId)]
    if (!asset) fail(command.op, `素材が見つかりません: ${command.assetId}`)
    asset.license = command.license
  },

  'asset.remove': (draft, command, env) => {
    const assetId = env.resolve(command.assetId)
    if (!draft.assets[assetId]) fail(command.op, `素材が見つかりません: ${assetId}`)
    if (assetInUse(draft, assetId)) fail(command.op, 'この素材は使われているため外せません')
    delete draft.assets[assetId]
  }
}
