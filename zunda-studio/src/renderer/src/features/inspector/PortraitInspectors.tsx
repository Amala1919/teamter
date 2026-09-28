import { transitionEffects } from '@shared/commands/handlers/portrait'
import type { Command, PortraitTransition } from '@shared/commands/types'
import type { PortraitItem, PortraitItemKind, PortraitTransform, Project } from '@shared/project/types'

import { NumberField } from '../../ui/NumberField'

type Run = (commands: Command[], label: string) => void

const KIND_LABELS: Record<PortraitItemKind, string> = {
  show: 'この区間だけ出す(登場・退場)',
  hide: 'この区間だけ隠す',
  adjust: 'この区間だけ位置・表情を変える'
}

/** 今付いているエフェクトが、どの登場の動きにあたるか(手で変えていれば custom)。 */
function currentTransition(item: PortraitItem): PortraitTransition | 'custom' {
  const same = (transition: PortraitTransition): boolean =>
    JSON.stringify(item.effects) === JSON.stringify(transitionEffects(transition, item.durationMs))
  if (item.effects.length === 0) return 'none'
  if (same('fade')) return 'fade'
  if (same('pop')) return 'pop'
  return 'custom'
}

/** 場面ごとの立ち絵の設定。 */
export function PortraitSceneInspector({ project, item, run }: { project: Project; item: PortraitItem; run: Run }): React.JSX.Element {
  const character = project.characters[item.characterId]
  const portrait = character?.portrait ?? null
  const kind = item.kind ?? 'show'
  const expressions = Object.values(portrait?.expressions ?? {})
  const transform = item.transformOverride
  const setTransform = (next: PortraitTransform | null, label: string): void => run([{ op: 'portrait.update', itemId: item.id, transform: next }], label)
  const transition = currentTransition(item)

  return (
    <section data-testid="portrait-scene-inspector">
      <h3>場面ごとの立ち絵({character?.name ?? '不明'})</h3>
      <label className="field">
        <span className="field__label">この区間の扱い</span>
        <select value={kind} onChange={(event) => run([{ op: 'portrait.update', itemId: item.id, kind: event.target.value as PortraitItemKind }], '立ち絵の区間の種類')} data-testid="portrait-scene-kind">
          {(Object.keys(KIND_LABELS) as PortraitItemKind[]).map((value) => (
            <option key={value} value={value}>
              {KIND_LABELS[value]}
            </option>
          ))}
        </select>
      </label>
      {kind === 'show' && (
        <p className="note">この区間を置くと、{character?.name ?? 'このキャラクター'} は「出す」区間の中でだけ表示されます(区間の外では出ません)。</p>
      )}
      {kind === 'show' && (
        <label className="field">
          <span className="field__label">登場・退場の動き</span>
          <select
            value={transition}
            onChange={(event) => {
              const next = event.target.value as PortraitTransition
              const removes: Command[] = item.effects.map((_, index) => ({ op: 'item.removeEffect', itemId: item.id, effectIndex: item.effects.length - 1 - index }))
              const adds: Command[] = transitionEffects(next, item.durationMs).map((effect) => ({ op: 'item.addEffect', itemId: item.id, effect }))
              run([...removes, ...adds], '登場の動き')
            }}
            data-testid="portrait-scene-transition"
          >
            <option value="none">動き無し</option>
            <option value="fade">ふわっと</option>
            <option value="pop">ぽんっと</option>
            {transition === 'custom' && <option value="custom">エフェクトで個別に設定</option>}
          </select>
        </label>
      )}
      {kind !== 'hide' && expressions.length > 0 && (
        <label className="field">
          <span className="field__label">この区間の表情</span>
          <select
            value={item.expressionId ?? ''}
            onChange={(event) => run([{ op: 'portrait.update', itemId: item.id, expressionId: event.target.value || null }], '立ち絵の区間の表情')}
            data-testid="portrait-scene-expression"
          >
            <option value="">セリフに合わせる</option>
            {expressions.map((expression) => (
              <option key={expression.id} value={expression.id}>
                {expression.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {kind !== 'hide' && portrait && (
        <>
          <label className="field__row">
            <input
              type="checkbox"
              checked={transform !== null}
              onChange={(event) => setTransform(event.target.checked ? portrait.transform : null, '立ち絵の区間の配置')}
              data-testid="portrait-scene-own-transform"
            />
            この区間だけの位置・大きさにする(プレビューで枠をドラッグしても変えられます)
          </label>
          {transform && (
            <>
              <NumberField label="X" value={transform.x} onCommit={(x) => setTransform({ ...transform, x }, '立ち絵の位置')} testId="portrait-scene-x" />
              <NumberField label="Y" value={transform.y} onCommit={(y) => setTransform({ ...transform, y }, '立ち絵の位置')} />
              <NumberField label="大きさ(%)" value={transform.scale} displayScale={100} min={5} max={2000} step={5} onCommit={(scale) => setTransform({ ...transform, scale }, '立ち絵の大きさ')} testId="portrait-scene-scale" />
              <label className="field__row">
                <input type="checkbox" checked={transform.flipX} onChange={(event) => setTransform({ ...transform, flipX: event.target.checked }, '立ち絵の反転')} />
                左右反転
              </label>
            </>
          )}
        </>
      )}
    </section>
  )
}

const DIM_LEVELS: [number, string][] = [
  [0, 'しない'],
  [0.25, '少し'],
  [0.45, '普通'],
  [0.65, 'しっかり']
]

/** 話し手の強調(動画全体の設定)。 */
export function SpeakerEmphasisSettings({ project, run }: { project: Project; run: Run }): React.JSX.Element {
  const dim = project.editing.portraitDim ?? 0
  const nearest = DIM_LEVELS.reduce((best, level) => (Math.abs(level[0] - dim) < Math.abs(best[0] - dim) ? level : best))
  return (
    <section data-testid="speaker-emphasis">
      <h3>立ち絵: 話し手の強調(動画全体)</h3>
      <label className="field">
        <span className="field__label">話していない人を暗くする</span>
        <select value={String(nearest[0])} onChange={(event) => run([{ op: 'project.setEditing', portraitDim: Number(event.target.value) }], '話し手の強調')} data-testid="speaker-dim">
          {DIM_LEVELS.map(([value, label]) => (
            <option key={value} value={String(value)}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="field__row">
        <input
          type="checkbox"
          checked={project.editing.portraitHop === true}
          onChange={(event) => run([{ op: 'project.setEditing', portraitHop: event.target.checked }], '話し手の強調')}
          data-testid="speaker-hop"
        />
        話し始めに立ち絵を小さく跳ねさせる
      </label>
    </section>
  )
}
