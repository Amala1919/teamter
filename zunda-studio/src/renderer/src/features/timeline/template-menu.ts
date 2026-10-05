import { TEMPLATE_KIND_LABELS, type ProjectTemplate } from '@shared/project/templates'

import { formatMs } from '../../lib/time'
import { insertTemplate, removeTemplate, updateTemplate } from '../../state/templates'
import type { MenuEntry } from '../../ui/ContextMenu'

/** タイムラインの「ひな形 ▾」のメニュー。 */
export function templateMenu(templates: ProjectTemplate[], selectedCount: number, onSave: () => void, onError: (message: string) => void): MenuEntry[] {
  const report = (message: string | null): void => {
    if (message) onError(message)
  }
  const later = (task: Promise<string | null>): void => void task.then(report)
  return [
    { label: '選んだものをひな形にする…', disabled: selectedCount === 0, onSelect: onSave, testId: 'menu-template-save' },
    ...(templates.length > 0 ? (['separator'] as const) : []),
    ...templates.map(
      (template): MenuEntry => ({
        label: `${template.name}(${TEMPLATE_KIND_LABELS[template.kind]}・${formatMs(template.durationMs).replace(/\.\d+$/, '')})`,
        testId: 'menu-template-item',
        submenu: [
          { label: '再生位置に入れる(後ろをずらす)', onSelect: () => report(insertTemplate(template, 'playhead')), testId: 'menu-template-insert' },
          { label: '再生位置に重ねて置く(ずらさない)', onSelect: () => report(insertTemplate(template, 'overlay')) },
          { label: '先頭に入れる(後ろをずらす)', onSelect: () => report(insertTemplate(template, 'start')), testId: 'menu-template-start' },
          { label: '最後に足す', onSelect: () => report(insertTemplate(template, 'end')), testId: 'menu-template-end' },
          'separator',
          {
            label: '新しいプロジェクトに自動で入れる',
            checked: template.autoAdd,
            onSelect: () => later(updateTemplate(template, { autoAdd: !template.autoAdd }))
          },
          { label: 'ひな形を消す', danger: true, onSelect: () => later(removeTemplate(template)) }
        ]
      })
    )
  ]
}
