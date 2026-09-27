import { fail, findMutableItem, requireLayer, type HandlerTable } from '../env'

type ItemHandlers = Pick<HandlerTable, 'item.setTimeRange' | 'item.setLayer' | 'item.delete'>

export const itemHandlers: ItemHandlers = {
  'item.setTimeRange': (draft, command, env) => {
    const item = findMutableItem(draft, env.resolve(command.itemId), command.op)
    if (command.durationMs !== undefined) {
      if (item.type === 'voice') fail(command.op, 'ボイスアイテムの尺は合成結果から決まるため直接変更できません')
      if (command.durationMs <= 0) fail(command.op, '尺は正の値でなければなりません')
      item.durationMs = Math.round(command.durationMs)
    }
    if (command.startMs !== undefined) {
      if (command.startMs < 0) fail(command.op, '開始時刻は負の値にできません')
      item.startMs = Math.round(command.startMs)
    }
  },

  'item.setLayer': (draft, command, env) => {
    const item = findMutableItem(draft, env.resolve(command.itemId), command.op)
    item.layerId = requireLayer(draft, env.resolve(command.layerId), command.op).id
  },

  'item.delete': (draft, command, env) => {
    const itemId = env.resolve(command.itemId)
    const index = draft.items.findIndex((item) => item.id === itemId)
    if (index < 0) fail(command.op, `アイテムが見つかりません: ${itemId}`)
    if (draft.items[index]!.locked) fail(command.op, `アイテムはロックされています: ${itemId}`)
    draft.items.splice(index, 1)
    for (const session of Object.values(draft.liveSessions)) {
      for (const entry of session.entries) {
        if (entry.adoptedItemId === itemId) entry.adoptedItemId = null
      }
    }
  }
}
