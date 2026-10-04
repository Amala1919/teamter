import { produce } from 'immer'

import type { Item, ItemId, Project } from '../project/types'
import { extendPortraitTracks } from '../portrait/tracks'
import { changedItems, resolveOverlaps } from './arrange'
import type { ApplyEnv, CommandContext, HandlerTable } from './env'
import { assetHandlers } from './handlers/asset'
import { characterHandlers } from './handlers/character'
import { dissolveLoneGroups, editHandlers } from './handlers/edit'
import { itemHandlers } from './handlers/item'
import { liveHandlers } from './handlers/live'
import { lookHandlers } from './handlers/look'
import { mediaHandlers } from './handlers/media'
import { portraitHandlers } from './handlers/portrait'
import { projectHandlers } from './handlers/project'
import { transitionHandlers } from './handlers/transition'
import { voiceHandlers } from './handlers/voice'
import { zoomHandlers } from './handlers/zoom'
import type { Command } from './types'

export { estimateSpeechDurationMs, type CommandContext } from './env'

export interface ApplyResult {
  project: Project
  /** 一時ID から実際に生成されたID への対応。 */
  resolvedIds: Record<string, string>
}

/** 全ての op の処理。型が網羅を強制する(足し忘れはコンパイルエラーになる)。 */
const HANDLERS: HandlerTable = {
  ...projectHandlers,
  ...assetHandlers,
  ...characterHandlers,
  ...itemHandlers,
  ...editHandlers,
  ...liveHandlers,
  ...lookHandlers,
  ...mediaHandlers,
  ...portraitHandlers,
  ...transitionHandlers,
  ...voiceHandlers,
  ...zoomHandlers
}

/**
 * コマンド列を適用する。1件でも失敗したら CommandError を投げ、プロジェクトは変更しない。
 * 部分適用を許すと、AI が生成した相互に依存するコマンド列が中途半端な状態を残すため。
 */
export function applyCommands(
  project: Project,
  commands: readonly Command[],
  ctx: CommandContext
): ApplyResult {
  const resolvedIds: Record<string, string> = {}
  const env: ApplyEnv = { ctx, resolvedIds, resolve: (id) => resolvedIds[id] ?? id }

  const next = produce(project, (draft) => {
    for (const command of commands) {
      const handler = HANDLERS[command.op] as (draft: Project, command: Command, env: ApplyEnv) => void
      if (!handler) throw new Error(`未対応のコマンド: ${JSON.stringify(command)}`)
      handler(draft, command, env)
    }
    dissolveLoneGroups(draft)
    // 足した・動かした素材が同じレイヤーの素材と重なったら、空いている同じ種類のレイヤーへ移す。
    // 合成で尺が変わっただけのセリフは、置いた場所・レイヤーのままにする(重なっても別のレイヤーへ飛ばさない)。
    if (draft.editing.avoidOverlap !== false) {
      const before = new Map<ItemId, Item>(project.items.map((item) => [item.id, item]))
      const moved = changedItems(before, draft.items).filter((id) => !onlyResized(before.get(id), draft.items.find((item) => item.id === id)))
      resolveOverlaps(draft, moved, env, before)
    }
    // 「動画の最後まで」の立ち絵の区間を、今の動画の長さに合わせる。
    extendPortraitTracks(draft)
    draft.meta.updatedAt = ctx.now().toISOString()
  })

  return { project: next, resolvedIds }
}

/** セリフの尺だけが変わった(置いた時刻とレイヤーはそのまま)。 */
function onlyResized(before: Item | undefined, after: Item | undefined): boolean {
  return before !== undefined && after !== undefined && after.type === 'voice' && before.startMs === after.startMs && before.layerId === after.layerId
}
