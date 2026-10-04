import { create } from 'zustand'

import type { Command } from '@shared/commands/types'
import { projectDurationMs } from '@shared/project/queries'
import type { ProjectTemplate } from '@shared/project/templates'
import type { Project } from '@shared/project/types'

/**
 * アプリに保存したひな形の一覧(main の templates.json の写し)。
 * 新しいプロジェクトを作るとき(store.ts)にも読むので、ほかの状態に依存しない小さな置き場にしておく。
 */
export const useTemplateEntries = create<{ entries: ProjectTemplate[]; loaded: boolean }>(() => ({ entries: [], loaded: false }))

export function setTemplateEntries(entries: ProjectTemplate[]): void {
  useTemplateEntries.setState({ entries, loaded: true })
}

/** 新しいプロジェクトに自動で入れるひな形(オープニングは先頭、エンディングは最後、そのほかは最後)。 */
export function autoTemplateCommands(project: Project): Command[] {
  const entries = useTemplateEntries.getState().entries.filter((entry) => entry.autoAdd)
  const openings = entries.filter((entry) => entry.kind === 'opening')
  const others = entries.filter((entry) => entry.kind !== 'opening')
  const commands: Command[] = []
  let at = 0
  for (const template of openings) {
    commands.push({ op: 'template.insert', template, atMs: at, ripple: false })
    at += template.durationMs
  }
  // オープニングの後ろに、エンディングなどを並べる(まだ本編が無いので、すぐ後ろ)。
  for (const template of others) {
    commands.push({ op: 'template.insert', template, atMs: Math.max(at, projectDurationMs(project)), ripple: false })
    at += template.durationMs
  }
  return commands
}
