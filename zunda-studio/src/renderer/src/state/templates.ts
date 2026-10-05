import { nanoid } from 'nanoid'

import type { Command } from '@shared/commands/types'
import { projectDurationMs } from '@shared/project/queries'
import { templateFromItems, type ProjectTemplate, type TemplateKind } from '@shared/project/templates'
import type { Ms, Project } from '@shared/project/types'

import { api, toAppError } from '../api'
import { useEditorStore } from './store'
import { setTemplateEntries } from './template-entries'

/**
 * ひな形(オープニング・エンディングなど)の保存と、プロジェクトへの入れ方。
 * どれも失敗したら理由の文を返す(成功なら null)。
 */

export async function loadTemplates(): Promise<void> {
  setTemplateEntries(await api.invoke('templates:list'))
}

/** 選んでいる素材をひな形として保存する。 */
export async function saveSelectionAsTemplate(meta: { name: string; kind: TemplateKind; autoAdd: boolean }): Promise<string | null> {
  const { project, selectedItemIds } = useEditorStore.getState()
  const template = templateFromItems(project, selectedItemIds, { id: `tpl_${nanoid(10)}`, createdAt: new Date().toISOString(), ...meta })
  if (!template) return 'ひな形にする素材を選んでください(立ち絵の区間とズームは入りません)'
  try {
    setTemplateEntries(await api.invoke('templates:save', template))
    return null
  } catch (error) {
    return toAppError(error).message
  }
}

export async function updateTemplate(template: ProjectTemplate, patch: Partial<Pick<ProjectTemplate, 'name' | 'kind' | 'autoAdd'>>): Promise<string | null> {
  try {
    setTemplateEntries(await api.invoke('templates:save', { ...template, ...patch }))
    return null
  } catch (error) {
    return toAppError(error).message
  }
}

export async function removeTemplate(template: ProjectTemplate): Promise<string | null> {
  try {
    setTemplateEntries(await api.invoke('templates:remove', template.id))
    return null
  } catch (error) {
    return toAppError(error).message
  }
}

export type TemplatePlace = 'playhead' | 'overlay' | 'start' | 'end'

/** ひな形を入れるコマンド。start は先頭に入れて後ろをずらす、end は最後に足す、overlay は再生位置に重ねて置く。 */
export function templateCommands(project: Project, template: ProjectTemplate, place: TemplatePlace, playheadMs: Ms): Command[] {
  const atMs = place === 'start' ? 0 : place === 'end' ? projectDurationMs(project) : playheadMs
  return [{ op: 'template.insert', template, atMs, ripple: place === 'start' || place === 'playhead', tempIdPrefix: 'tpl' }]
}

export function insertTemplate(template: ProjectTemplate, place: TemplatePlace): string | null {
  const { project, playheadMs, dispatch, setSelection } = useEditorStore.getState()
  const result = dispatch(templateCommands(project, template, place, playheadMs), `ひな形「${template.name}」を入れる`)
  if (!result.ok) return result.message
  const ids = Object.entries(result.resolvedIds)
    .filter(([key]) => key.startsWith('tpl'))
    .map(([, id]) => id)
  setSelection(ids)
  if (ids.length < template.items.length) return `ひな形「${template.name}」のうち、このプロジェクトにいないキャラクターのセリフは入れませんでした`
  return null
}
