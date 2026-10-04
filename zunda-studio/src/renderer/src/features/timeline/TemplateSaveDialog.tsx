import { useState } from 'react'

import { TEMPLATE_KIND_LABELS, type TemplateKind } from '@shared/project/templates'

import { saveSelectionAsTemplate } from '../../state/templates'
import { Modal } from '../../ui/Modal'

/** 選んでいる素材をひな形として保存する。 */
export function TemplateSaveDialog({ count, onClose, onError }: { count: number; onClose: () => void; onError: (message: string) => void }): React.JSX.Element {
  const [name, setName] = useState('オープニング')
  const [kind, setKind] = useState<TemplateKind>('opening')
  const [autoAdd, setAutoAdd] = useState(false)
  const [saving, setSaving] = useState(false)

  const save = (): void => {
    if (name.trim() === '') return
    setSaving(true)
    void saveSelectionAsTemplate({ name: name.trim(), kind, autoAdd })
      .then((message) => {
        if (message) onError(message)
        else onClose()
      })
      .finally(() => setSaving(false))
  }

  return (
    <Modal
      title="選んだものをひな形にする"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose}>
            やめる
          </button>
          <button type="button" disabled={saving || name.trim() === ''} onClick={save} data-testid="template-save">
            保存
          </button>
        </>
      }
    >
      <p className="note">
        選んだ{count}個の素材(テロップ・画像・動画・BGM・効果音・図形・セリフ)を、並びのままアプリに保存します。どのプロジェクトにも、タイムラインの「ひな形」から入れられます。
        立ち絵の区間とズームは入りません。
      </p>
      <label className="field">
        <span className="field__label">名前</span>
        <input type="text" value={name} onChange={(event) => setName(event.target.value)} autoFocus data-testid="template-name" />
      </label>
      <div className="segmented" role="radiogroup" aria-label="ひな形の種類">
        {(Object.keys(TEMPLATE_KIND_LABELS) as TemplateKind[]).map((value) => (
          <label key={value}>
            <input
              type="radio"
              name="template-kind"
              checked={kind === value}
              onChange={() => {
                setKind(value)
                // 名前を変えていなければ、種類に合わせた名前にする。
                if (Object.values(TEMPLATE_KIND_LABELS).includes(name)) setName(TEMPLATE_KIND_LABELS[value])
              }}
              data-testid={`template-kind-${value}`}
            />
            {TEMPLATE_KIND_LABELS[value]}
          </label>
        ))}
      </div>
      <label className="field__row">
        <input type="checkbox" checked={autoAdd} onChange={(event) => setAutoAdd(event.target.checked)} data-testid="template-auto-add" />
        新しいプロジェクトに自動で入れる(オープニングは先頭、ほかはその後ろ)
      </label>
    </Modal>
  )
}
