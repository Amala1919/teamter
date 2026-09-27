import { produce } from 'immer'

import type { Project } from '../project/types'
import type { ApplyEnv, CommandContext, HandlerTable } from './env'
import { assetHandlers } from './handlers/asset'
import { characterHandlers } from './handlers/character'
import { itemHandlers } from './handlers/item'
import { mediaHandlers } from './handlers/media'
import { projectHandlers } from './handlers/project'
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
  ...mediaHandlers,
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
    draft.meta.updatedAt = ctx.now().toISOString()
  })

  return { project: next, resolvedIds }
}
