import { useState } from 'react'

import type { EditingSettings as ProjectEditing } from '@shared/project/types'
import type { AppSettings } from '@shared/settings/schema'

import { useSettingsStore } from '../../state/settings'
import { useEditorStore } from '../../state/store'
import { NumberField } from '../../ui/NumberField'

type Toggle = 'rippleOnVoiceChange' | 'closeGapOnVoiceDelete' | 'groupFollowsVoice' | 'autoPortraitTrack' | 'avoidOverlap'

/** 編集の自動処理の一覧。値が無いときの扱い(以前のプロジェクト)もここで決める。 */
const TOGGLES: { key: Toggle; label: string; note: string; fallback: boolean }[] = [
  {
    key: 'closeGapOnVoiceDelete',
    label: 'セリフを消したら、後ろのセリフを前に詰める',
    note: '切ると、消したところは空いたままになります(ほかのものは動きません)。',
    fallback: false
  },
  {
    key: 'rippleOnVoiceChange',
    label: 'セリフを間に足したら、後ろのセリフをずらして場所を空ける',
    note: '切ると、足したセリフが次のセリフと重なることがあります(重なりの自動振り分けが入っていれば別のレイヤーに置かれます)。',
    fallback: true
  },
  {
    key: 'groupFollowsVoice',
    label: 'グループのセリフの長さが変わったら、グループのうち後ろのものを一緒にずらす',
    note: 'グループに入っていないものは、この設定に関わらず動きません。',
    fallback: true
  },
  {
    key: 'avoidOverlap',
    label: '足した・動かした素材が同じレイヤーのものと重なったら、空いているレイヤーへ振り分ける',
    note: '切ると、同じレイヤーに重ねたまま置きます。',
    fallback: true
  },
  {
    key: 'autoPortraitTrack',
    label: '立ち絵を付けたら、動画の最後までの表示の区間をタイムラインに置く',
    note: '切ると、立ち絵は自分で区間を置いたところにだけ出ます。',
    fallback: true
  }
]

/**
 * 設定の「編集」タブ。編集の自動処理を、する・しないで選ぶ。
 * 開いているプロジェクトに反映し(元に戻せる)、新しいプロジェクトの既定にもする。
 */
export function EditingSettings({ settings, onError }: { settings: AppSettings; onError: (error: unknown) => void }): React.JSX.Element {
  const editing = useEditorStore((state) => state.project.editing)
  const dispatch = useEditorStore((state) => state.dispatch)
  const update = useSettingsStore((state) => state.update)

  // 保存の応答を待たずに見た目を切り替える(応答が来るまで押しても変わらないように見えないよう)。
  const [autoInspector, setAutoInspector] = useState(settings.ui.autoInspectorTab)

  const value = (key: Toggle, fallback: boolean): boolean => (editing as ProjectEditing)[key] ?? fallback

  const change = (patch: Partial<Record<Toggle, boolean>> & { defaultGapMs?: number }): void => {
    const result = dispatch([{ op: 'project.setEditing', ...patch }], '編集の設定の変更')
    if (!result.ok) {
      onError(new Error(result.message))
      return
    }
    update({ editing: patch }).catch(onError)
  }

  return (
    <div className="settings-section" data-testid="editing-settings">
      <h3>編集の自動処理</h3>
      <p className="note">
        素材は独立が基本で、ここで選んだものだけを自動で行います。開いているプロジェクトに反映し(元に戻せます)、新しく作るプロジェクトの既定にもなります。
      </p>
      {TOGGLES.map((toggle) => (
        <label key={toggle.key} className="field__row field__row--top">
          <input
            type="checkbox"
            checked={value(toggle.key, toggle.fallback)}
            onChange={(event) => change({ [toggle.key]: event.target.checked })}
            data-testid={`editing-${toggle.key}`}
          />
          <span>
            {toggle.label}
            <span className="note note--block">{toggle.note}</span>
          </span>
        </label>
      ))}
      <NumberField
        label="セリフを続けて足すときの間(秒)"
        value={editing.defaultGapMs}
        displayScale={0.001}
        step={0.05}
        min={0}
        max={10}
        onCommit={(gap) => change({ defaultGapMs: gap })}
        testId="editing-defaultGapMs"
      />

      <h3>画面</h3>
      <label className="field__row">
        <input
          type="checkbox"
          checked={autoInspector}
          onChange={(event) => {
            const next = event.target.checked
            setAutoInspector(next)
            update({ ui: { autoInspectorTab: next } }).catch((error: unknown) => {
              setAutoInspector(!next)
              onError(error)
            })
          }}
          data-testid="editing-autoInspectorTab"
        />
        タイムラインやプレビューで素材を選んだら、右の欄をインスペクタに切り替える
      </label>
    </div>
  )
}
