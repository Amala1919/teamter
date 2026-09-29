import type { Command } from '@shared/commands/types'

import { useSettingsStore } from './settings'
import { useEditorStore } from './store'

export type EditingPatch = Omit<Extract<Command, { op: 'project.setEditing' }>, 'op'>

/**
 * 編集の設定を変える。開いているプロジェクトに反映し(元に戻せる)、新しいプロジェクトの既定にもする。
 * 失敗したら理由の文を返す。
 */
export function changeEditing(patch: EditingPatch): string | null {
  const result = useEditorStore.getState().dispatch([{ op: 'project.setEditing', ...patch }], '編集の設定の変更')
  if (!result.ok) return result.message
  // アプリの既定に残すのは、設定の「編集」タブで扱う項目だけ。
  const { duckVolume: _duck, duckFadeMs: _fade, portraitDim: _dim, portraitHop: _hop, ...defaults } = patch
  if (Object.keys(defaults).length > 0) void useSettingsStore.getState().update({ editing: defaults }).catch(() => {})
  return null
}
