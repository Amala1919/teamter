import type { Item, Layer } from '../../project/types'
import { fail, insertLayer, requireFinite, shiftItemsFrom, type HandlerTable } from '../env'
import { clone, validatePasted } from './edit'

type TemplateHandlers = Pick<HandlerTable, 'template.insert'>

export const templateHandlers: TemplateHandlers = {
  'template.insert': (draft, command, env) => {
    const template = command.template
    if (!Array.isArray(template.items) || template.items.length === 0) fail(command.op, 'ひな形に素材がありません')
    const at = Math.round(requireFinite(command.atMs, command.op, '入れる位置'))
    if (at < 0) fail(command.op, '入れる位置は負の値にできません')

    // 素材: 同じファイルがあればそれを使い、無ければ登録する。
    const assetIds = new Map<string, string>()
    for (const [id, asset] of Object.entries(template.assets)) {
      const existing = Object.entries(draft.assets).find(([, candidate]) => candidate.type === asset.type && candidate.path.absolute === asset.path.absolute)
      if (existing) {
        assetIds.set(id, existing[0])
        continue
      }
      const next = env.ctx.newId('ast')
      draft.assets[next] = clone(asset)
      assetIds.set(id, next)
    }
    // 字幕スタイル: 同じ ID があればそれを使い(見た目は入れる先のもの)、無ければ足す。
    const styleIds = new Map<string, string>()
    for (const [id, style] of Object.entries(template.subtitleStyles)) {
      if (draft.subtitleStyles[id]) {
        styleIds.set(id, id)
        continue
      }
      const next = env.ctx.newId('sty')
      draft.subtitleStyles[next] = { ...clone(style), id: next }
      styleIds.set(id, next)
    }
    // キャラクター: アプリに保存した同じキャラクター、無ければ同じ名前のキャラクター。いなければそのセリフは入れない。
    const characterIds = new Map<string, string>()
    for (const character of template.characters) {
      const match =
        Object.values(draft.characters).find((candidate) => character.libraryId !== undefined && candidate.libraryId === character.libraryId) ??
        Object.values(draft.characters).find((candidate) => candidate.name === character.name)
      if (match) characterIds.set(character.id, match.id)
    }
    // レイヤー: 同じ名前のレイヤー。無ければ、ひな形での並びに近い高さに作る。
    const layerIds = new Map<string, string>()
    for (const layer of [...template.layers].sort((a, b) => a.index - b.index)) {
      const existing = draft.layers.find((candidate) => candidate.name === layer.name)
      if (existing) {
        layerIds.set(layer.id, existing.id)
        continue
      }
      const created: Layer = { id: env.ctx.newId('lyr'), name: layer.name, index: Math.min(layer.index, draft.layers.length), visible: true, locked: false, muted: false }
      insertLayer(draft, created)
      layerIds.set(layer.id, created.id)
    }

    // 後ろをずらして場所を空ける(重ねて置くときはずらさない)。
    if (command.ripple) shiftItemsFrom(draft, at, Math.round(template.durationMs), new Set())

    const groups = new Map<string, string>()
    template.items.forEach((source, index) => {
      const item = clone(source) as Item
      if ('assetId' in item) {
        const mapped = assetIds.get(item.assetId)
        if (!mapped) return
        item.assetId = mapped
      }
      if (item.type === 'text') item.styleId = styleIds.get(item.styleId) ?? item.styleId
      if (item.type === 'voice') {
        const mapped = characterIds.get(item.characterId)
        if (!mapped) return
        item.characterId = mapped
      }
      if (item.type === 'portrait' || item.type === 'zoom') return
      item.layerId = layerIds.get(item.layerId) ?? item.layerId
      validatePasted(draft, item, command.op)
      item.id = env.ctx.newId('itm')
      if (item.groupId !== undefined) {
        const next = groups.get(item.groupId) ?? env.ctx.newId('grp')
        groups.set(item.groupId, next)
        item.groupId = next
      }
      item.locked = false
      item.startMs = Math.round(at + Math.max(0, item.startMs))
      draft.items.push(item)
      if (command.tempIdPrefix) env.resolvedIds[`${command.tempIdPrefix}${index}`] = item.id
    })
  }
}
