import { useState } from 'react'

import { DEFAULT_CUT_FADE_MS } from '@shared/commands/env'
import { ZOOM_METHODS, type EditingSettings as ProjectEditing, type ZoomMethod } from '@shared/project/types'
import { ZOOM_METHOD_LABELS } from '@shared/render/zoom'
import type { AppSettings } from '@shared/settings/schema'

import { changeEditing, type EditingPatch } from '../../state/editing'
import { useSettingsStore } from '../../state/settings'
import { useEditorStore } from '../../state/store'
import { NumberField } from '../../ui/NumberField'

type Toggle = 'openGapOnVoiceInsert' | 'closeGapOnVoiceDelete' | 'groupFollowsVoice' | 'autoPortraitTrack' | 'avoidOverlap'

/** 編集の自動処理の一覧。値が無いときの扱い(以前のプロジェクト)もここで決める。 */
const TOGGLES: { key: Toggle; label: string; note: string; fallback: boolean }[] = [
  {
    key: 'closeGapOnVoiceDelete',
    label: 'セリフを消したら、後ろのセリフを前に詰める',
    note: '切ると、消したところは空いたままになります(ほかのものは動きません)。',
    fallback: false
  },
  {
    key: 'openGapOnVoiceInsert',
    label: 'セリフを間に足したら、後ろのセリフをずらして場所を空ける',
    note: '切っておくと(既定)、後ろのセリフは動きません。足したセリフが次のセリフと重なるときは、重なりの自動振り分けが入っていれば別のレイヤーに置かれます。',
    fallback: false
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
  const update = useSettingsStore((state) => state.update)

  // 保存の応答を待たずに見た目を切り替える(応答が来るまで押しても変わらないように見えないよう)。
  const [autoInspector, setAutoInspector] = useState(settings.ui.autoInspectorTab)

  const value = (key: Toggle, fallback: boolean): boolean => (editing as ProjectEditing)[key] ?? fallback

  const change = (patch: EditingPatch): void => {
    const message = changeEditing(patch)
    if (message) onError(new Error(message))
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

      <h3>動画を切ったとき</h3>
      <p className="note">動画を分けた・端を切ったとき、切った所をフェードさせます(映像と音の両方)。0 秒ならフェードしません。</p>
      <div className="field__row field__row--wrap">
        <NumberField
          label="切った後の始まりをフェードイン(秒)"
          value={editing.cutFadeInMs ?? DEFAULT_CUT_FADE_MS}
          displayScale={0.001}
          step={0.1}
          min={0}
          max={5}
          onCommit={(ms) => change({ cutFadeInMs: ms })}
          testId="editing-cutFadeInMs"
        />
        <NumberField
          label="切る前の終わりをフェードアウト(秒)"
          value={editing.cutFadeOutMs ?? DEFAULT_CUT_FADE_MS}
          displayScale={0.001}
          step={0.1}
          min={0}
          max={5}
          onCommit={(ms) => change({ cutFadeOutMs: ms })}
          testId="editing-cutFadeOutMs"
        />
      </div>

      <h3>ズーム</h3>
      <label className="field">
        <span className="field__label">既定の寄り方</span>
        <select value={editing.zoomMethod ?? 'smooth'} onChange={(event) => change({ zoomMethod: event.target.value as ZoomMethod })} data-testid="editing-zoomMethod">
          {ZOOM_METHODS.map((method) => (
            <option key={method} value={method}>
              {ZOOM_METHOD_LABELS[method]}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="field__label">ズームを置くとき、その時点の動画のコマを静止画にする</span>
        <select
          value={editing.zoomOnStill ?? 'overwrite'}
          onChange={(event) => change({ zoomOnStill: event.target.value as 'off' | 'overwrite' | 'insert' })}
          data-testid="editing-zoomOnStill"
        >
          <option value="overwrite">静止画にする(動画のその先を置き換える。ほかは動かない)</option>
          <option value="insert">静止画にする(動画を止めて、後ろをずらす)</option>
          <option value="off">しない(動画のまま寄る)</option>
        </select>
        <span className="note">静止画にしたときは、静止画とズームをグループにします(一緒に動きます)。プレビューの「静止画で」でもすぐ切り替えられます。</span>
      </label>

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
