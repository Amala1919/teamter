import { useEffect, useState } from 'react'

import { cleanLayerName } from '@shared/portrait/infer'
import {
  NO_PART,
  type CharacterId,
  type Expression,
  type PartId,
  type PartRole,
  type PortraitConfig,
  type PortraitPartGroup,
  type PortraitTransform,
  type Vowel
} from '@shared/project/types'
import { layerKey, walkLayers, type PsdLayerNode, type PsdManifest } from '@shared/psd/types'

import { toAppError } from '../../api'
import { browserResources } from '../../render/browser-resources'
import { useEditorStore } from '../../state/store'
import { Modal } from '../../ui/Modal'
import { PortraitPreview } from './PortraitPreview'

const ROLE_LABELS: Record<PartRole, string> = {
  eye: '目',
  mouth: '口',
  eyebrow: '眉',
  body: '体',
  other: 'その他'
}

const VOWEL_LABELS: [Vowel, string][] = [
  ['a', 'あ'],
  ['i', 'い'],
  ['u', 'う'],
  ['e', 'え'],
  ['o', 'お'],
  ['N', 'ん・閉じ']
]

type Tab = 'parts' | 'expressions' | 'layers' | 'placement'

interface PortraitManagerProps {
  characterId: CharacterId
  onClose: () => void
}

/**
 * 立ち絵の素材マネージャー。PSD のどのグループが目・口・眉か、まばたきと口パクにどのパーツを使うか、
 * 表情ごとにどのパーツを選ぶかを、試し表示を見ながら決める(REQUIREMENTS.md P-2〜P-6)。
 * 変更はその場でプロジェクトに反映され、元に戻すで取り消せる。
 */
export function PortraitManager({ characterId, onClose }: PortraitManagerProps): React.JSX.Element {
  const character = useEditorStore((state) => state.project.characters[characterId])
  const assets = useEditorStore((state) => state.project.assets)
  const dispatch = useEditorStore((state) => state.dispatch)
  const [manifest, setManifest] = useState<PsdManifest | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('parts')
  const [animate, setAnimate] = useState(true)
  const portrait = character?.portrait ?? null
  const [expressionId, setExpressionId] = useState<string | null>(portrait?.defaultExpressionId ?? null)

  const asset = portrait ? assets[portrait.assetId] : undefined
  useEffect(() => {
    if (!portrait || !asset) return
    browserResources
      .loadManifest(portrait.assetId, asset.path.absolute)
      .then(setManifest)
      .catch((caught: unknown) => setError(toAppError(caught).message))
  }, [portrait, asset])

  if (!character || !portrait) {
    return (
      <Modal title="立ち絵" onClose={onClose}>
        <p className="pane__empty">立ち絵が設定されていません。</p>
      </Modal>
    )
  }

  const save = (next: PortraitConfig, label: string): void => {
    const result = dispatch([{ op: 'character.setPortrait', characterId, portrait: next }], label)
    setError(result.ok ? null : result.message)
  }

  const updateGroup = (group: PortraitPartGroup, label: string): void => {
    save({ ...portrait, partGroups: { ...portrait.partGroups, [group.id]: group } }, label)
  }

  return (
    <Modal title={`立ち絵の設定 — ${character.name}`} onClose={onClose} wide>
      {error && (
        <div className="banner banner--error" role="alert">
          <span>{error}</span>
        </div>
      )}
      {!manifest ? (
        <p className="pane__empty">PSD を読み込み中…</p>
      ) : (
        <div className="portrait-manager">
          <aside className="portrait-manager__preview">
            <PortraitPreview portrait={portrait} manifest={manifest} expressionId={expressionId} animate={animate} />
            <label className="field__row">
              <input type="checkbox" checked={animate} onChange={(event) => setAnimate(event.target.checked)} />
              口パクとまばたきを動かす
            </label>
            <label className="field__row">
              表情
              <select value={expressionId ?? ''} onChange={(event) => setExpressionId(event.target.value || null)}>
                {Object.values(portrait.expressions).map((expression) => (
                  <option key={expression.id} value={expression.id}>
                    {expression.name}
                  </option>
                ))}
              </select>
            </label>
            {manifest.warnings.map((warning) => (
              <p key={warning} className="status status--warn">
                {warning}
              </p>
            ))}
          </aside>
          <section className="portrait-manager__editor">
            <nav className="tabs" role="tablist">
              {(
                [
                  ['parts', 'パーツ'],
                  ['expressions', '表情'],
                  ['layers', 'レイヤーの表示'],
                  ['placement', '配置']
                ] as [Tab, string][]
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={tab === id}
                  className={tab === id ? 'tabs__tab tabs__tab--active' : 'tabs__tab'}
                  onClick={() => setTab(id)}
                  data-testid={`portrait-tab-${id}`}
                >
                  {label}
                </button>
              ))}
            </nav>
            {tab === 'parts' && <PartsEditor portrait={portrait} manifest={manifest} save={save} updateGroup={updateGroup} />}
            {tab === 'expressions' && (
              <ExpressionsEditor
                portrait={portrait}
                save={save}
                selectedId={expressionId}
                onSelect={setExpressionId}
              />
            )}
            {tab === 'layers' && <LayersEditor portrait={portrait} manifest={manifest} save={save} />}
            {tab === 'placement' && <PlacementEditor portrait={portrait} save={save} />}
          </section>
        </div>
      )}
    </Modal>
  )
}

interface EditorProps {
  portrait: PortraitConfig
  save: (next: PortraitConfig, label: string) => void
}

function PartSelect({
  group,
  value,
  onChange,
  allowNone,
  testId
}: {
  group: PortraitPartGroup
  value: PartId | undefined
  onChange: (value: PartId | undefined) => void
  allowNone?: boolean
  testId?: string
}): React.JSX.Element {
  return (
    <select value={value ?? ''} onChange={(event) => onChange(event.target.value || undefined)} data-testid={testId}>
      {(allowNone || value === undefined) && <option value="">(なし)</option>}
      {group.items.map((item) => (
        <option key={item.id} value={item.id}>
          {item.name}
        </option>
      ))}
    </select>
  )
}

/**
 * 表情でのパーツの選び方。「なし」は何も表示しない(エフェクトを消す)、「PSD のまま」は PSD で表示になっているものを出す。
 * どれを選んだ後でも、なし・PSD のままに戻せる。
 */
function ExpressionPartSelect({
  group,
  value,
  onChange,
  testId
}: {
  group: PortraitPartGroup
  value: PartId | undefined
  onChange: (value: PartId | undefined) => void
  testId?: string
}): React.JSX.Element {
  return (
    <select value={value ?? ''} onChange={(event) => onChange(event.target.value || undefined)} data-testid={testId}>
      <option value={NO_PART}>(なし・表示しない)</option>
      <option value="">(PSD の表示のまま)</option>
      {group.items.map((item) => (
        <option key={item.id} value={item.id}>
          {item.name}
        </option>
      ))}
    </select>
  )
}

function PartsEditor({
  portrait,
  manifest,
  save,
  updateGroup
}: EditorProps & { manifest: PsdManifest; updateGroup: (group: PortraitPartGroup, label: string) => void }): React.JSX.Element {
  const groups = Object.values(portrait.partGroups)
  const usedPaths = new Set(groups.map((group) => layerKey(group.layerPath)))
  const candidates: PsdLayerNode[] = []
  walkLayers(manifest.layers, (node) => {
    if (node.kind === 'group' && node.children.length >= 2 && !usedPaths.has(node.key)) candidates.push(node)
  })

  const addGroup = (key: string): void => {
    const node = candidates.find((candidate) => candidate.key === key)
    if (!node) return
    const id = `grp_${Date.now().toString(36)}`
    const group: PortraitPartGroup = {
      id,
      role: 'other',
      layerPath: node.path,
      selection: 'exclusive',
      items: node.children.map((child, index) => ({ id: `${id}_${index}`, name: cleanLayerName(child.name), layerPath: child.path }))
    }
    save({ ...portrait, partGroups: { ...portrait.partGroups, [id]: group } }, 'パーツグループの追加')
  }

  const removeGroup = (group: PortraitPartGroup): void => {
    const partGroups = { ...portrait.partGroups }
    delete partGroups[group.id]
    const expressions = Object.fromEntries(
      Object.entries(portrait.expressions).map(([id, expression]) => {
        const selections = { ...expression.selections }
        delete selections[group.id]
        return [id, { ...expression, selections }]
      })
    )
    save(
      {
        ...portrait,
        partGroups,
        expressions,
        lipSync: portrait.lipSync?.partGroupId === group.id ? null : portrait.lipSync,
        blink: portrait.blink?.partGroupId === group.id ? null : portrait.blink
      },
      'パーツグループの削除'
    )
  }

  return (
    <div className="settings-section">
      {groups.length === 0 && <p className="note">パーツグループがありません。下の一覧から PSD のフォルダを追加してください。</p>}
      {groups.map((group) => (
        <section key={group.id} data-testid={`part-group-${group.role}`}>
          <h3>
            {layerKey(group.layerPath)}
            <span className="note">({group.items.length}パーツ)</span>
          </h3>
          <label className="field">
            <span className="field__label">役割</span>
            <select
              value={group.role}
              onChange={(event) => updateGroup({ ...group, role: event.target.value as PartRole }, 'パーツの役割の変更')}
            >
              {(Object.keys(ROLE_LABELS) as PartRole[]).map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABELS[role]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field__label">選び方</span>
            <select
              value={group.selection}
              onChange={(event) =>
                updateGroup({ ...group, selection: event.target.value as PortraitPartGroup['selection'] }, '選び方の変更')
              }
            >
              <option value="exclusive">どれか1つだけ表示</option>
              <option value="multiple">PSD の表示のまま</option>
            </select>
          </label>

          {group.role === 'eye' && (
            <div className="field">
              <span className="field__label">まばたき</span>
              <span className="field__row field__row--wrap">
                {(['開いた目', '半目', '閉じた目'] as const).map((label, index) => {
                  const sequence = group.blinkSequence ?? []
                  const value = index === 0 ? sequence[0] : index === 2 ? sequence.at(-1) : sequence.length === 3 ? sequence[1] : undefined
                  return (
                    <label key={label} className="field__row">
                      {label}
                      <PartSelect
                        group={group}
                        value={value}
                        allowNone={index === 1}
                        testId={`blink-${index}`}
                        onChange={(part) => {
                          const open = index === 0 ? part : sequence[0]
                          const half = index === 1 ? part : sequence.length === 3 ? sequence[1] : undefined
                          const closed = index === 2 ? part : sequence.at(-1)
                          const next = [open, half, closed].filter((id): id is string => id !== undefined)
                          const valid = open !== undefined && closed !== undefined && open !== closed
                          updateGroup({ ...group, blinkSequence: next }, 'まばたきの設定')
                          if (valid) {
                            save(
                              {
                                ...portrait,
                                partGroups: { ...portrait.partGroups, [group.id]: { ...group, blinkSequence: next } },
                                blink: {
                                  ...(portrait.blink ?? { intervalMs: 4000, jitterMs: 1500, closeDurationMs: 150 }),
                                  partGroupId: group.id
                                }
                              },
                              'まばたきの設定'
                            )
                          }
                        }}
                      />
                    </label>
                  )
                })}
              </span>
            </div>
          )}

          {group.role === 'mouth' && (
            <MouthEditor portrait={portrait} group={group} save={save} />
          )}

          <button type="button" className="button--small button--danger" onClick={() => removeGroup(group)}>
            このグループをパーツから外す
          </button>
        </section>
      ))}
      {candidates.length > 0 && (
        <section>
          <label className="field">
            <span className="field__label">フォルダをパーツにする</span>
            <select value="" onChange={(event) => addGroup(event.target.value)}>
              <option value="">選んでください</option>
              {candidates.map((candidate) => (
                <option key={candidate.key} value={candidate.key}>
                  {candidate.key}
                </option>
              ))}
            </select>
          </label>
        </section>
      )}
      {portrait.blink && (
        <section>
          <label className="field">
            <span className="field__label">まばたきの間隔(秒)</span>
            <input
              type="number"
              min={1}
              max={20}
              step={0.5}
              defaultValue={portrait.blink.intervalMs / 1000}
              onBlur={(event) => {
                const seconds = Number(event.target.value)
                if (seconds >= 1 && portrait.blink) {
                  save({ ...portrait, blink: { ...portrait.blink, intervalMs: Math.round(seconds * 1000) } }, 'まばたきの間隔の変更')
                }
              }}
            />
          </label>
        </section>
      )}
    </div>
  )
}

function MouthEditor({ portrait, group, save }: EditorProps & { group: PortraitPartGroup }): React.JSX.Element {
  const active = portrait.lipSync?.partGroupId === group.id
  const mode = active ? portrait.lipSync!.mode : group.vowelMap ? 'vowel' : 'amplitude'

  const commit = (next: PortraitPartGroup, nextMode: 'vowel' | 'amplitude'): void => {
    save(
      {
        ...portrait,
        partGroups: { ...portrait.partGroups, [group.id]: next },
        lipSync: { mode: nextMode, partGroupId: group.id }
      },
      '口パクの設定'
    )
  }

  return (
    <>
      <label className="field">
        <span className="field__label">口パクの方式</span>
        <select value={mode} onChange={(event) => commit(group, event.target.value as 'vowel' | 'amplitude')} data-testid="lipsync-mode">
          <option value="vowel">母音に合わせる(あいうえお のパーツがある)</option>
          <option value="amplitude">開き具合で動かす(閉・半・開 のパーツ)</option>
        </select>
      </label>
      {mode === 'vowel' ? (
        <div className="field">
          <span className="field__label">母音ごとの口</span>
          <span className="field__row field__row--wrap">
            {VOWEL_LABELS.map(([vowel, label]) => (
              <label key={vowel} className="field__row">
                {label}
                <PartSelect
                  group={group}
                  value={group.vowelMap?.[vowel]}
                  testId={`vowel-${vowel}`}
                  onChange={(part) => {
                    const vowelMap = { ...(group.vowelMap ?? {}) }
                    if (part) vowelMap[vowel] = part
                    else delete vowelMap[vowel]
                    if (vowel === 'N' && part) {
                      vowelMap.cl = part
                      vowelMap.pau = part
                    }
                    commit({ ...group, vowelMap }, 'vowel')
                  }}
                />
              </label>
            ))}
          </span>
        </div>
      ) : (
        <div className="field">
          <span className="field__label">開き具合</span>
          <span className="field__row field__row--wrap">
            {(['閉じた口', '半開き(任意)', '開いた口'] as const).map((label, index) => {
              const sequence = group.openSequence ?? []
              const value = index === 0 ? sequence[0] : index === 2 ? sequence.at(-1) : sequence.length === 3 ? sequence[1] : undefined
              return (
                <label key={label} className="field__row">
                  {label}
                  <PartSelect
                    group={group}
                    value={value}
                    allowNone={index === 1}
                    onChange={(part) => {
                      const closed = index === 0 ? part : sequence[0]
                      const half = index === 1 ? part : sequence.length === 3 ? sequence[1] : undefined
                      const open = index === 2 ? part : sequence.at(-1)
                      commit(
                        { ...group, openSequence: [closed, half, open].filter((id): id is string => id !== undefined) },
                        'amplitude'
                      )
                    }}
                  />
                </label>
              )
            })}
          </span>
        </div>
      )}
      {!active && <p className="note">このグループは口パクに使われていません。上で設定すると使われるようになります。</p>}
    </>
  )
}

function ExpressionsEditor({
  portrait,
  save,
  selectedId,
  onSelect
}: EditorProps & { selectedId: string | null; onSelect: (id: string | null) => void }): React.JSX.Element {
  const expression = selectedId ? portrait.expressions[selectedId] : undefined
  const groups = Object.values(portrait.partGroups).filter((group) => group.selection === 'exclusive' && group.role !== 'mouth')

  const add = (): void => {
    const id = `exp_${Date.now().toString(36)}`
    const base = expression ?? Object.values(portrait.expressions)[0]
    const next: Expression = { id, name: `表情${Object.keys(portrait.expressions).length + 1}`, selections: { ...(base?.selections ?? {}) } }
    save({ ...portrait, expressions: { ...portrait.expressions, [id]: next } }, '表情の追加')
    onSelect(id)
  }

  const update = (next: Expression, label: string): void => {
    save({ ...portrait, expressions: { ...portrait.expressions, [next.id]: next } }, label)
  }

  return (
    <div className="settings-section">
      <section>
        <div className="field__row field__row--wrap">
          {Object.values(portrait.expressions).map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              className={candidate.id === selectedId ? 'chip chip--active' : 'chip'}
              onClick={() => onSelect(candidate.id)}
            >
              {candidate.name}
              {candidate.id === portrait.defaultExpressionId ? '(既定)' : ''}
            </button>
          ))}
          <button type="button" onClick={add} data-testid="add-expression">
            表情を追加
          </button>
        </div>
      </section>
      {expression && (
        <section>
          <label className="field">
            <span className="field__label">名前</span>
            <input
              type="text"
              key={expression.id}
              defaultValue={expression.name}
              onBlur={(event) => {
                const name = event.target.value.trim()
                if (name !== '' && name !== expression.name) update({ ...expression, name }, '表情の名前の変更')
              }}
              data-testid="expression-name"
            />
          </label>
          <p className="note">口は口パクが動かすので、ここでは選びません。</p>
          {groups.map((group) => (
            <label key={group.id} className="field">
              <span className="field__label">{ROLE_LABELS[group.role]}({layerKey(group.layerPath)})</span>
              <ExpressionPartSelect
                group={group}
                value={expression.selections[group.id]}
                testId={`expression-${group.role}`}
                onChange={(part) => {
                  const selections = { ...expression.selections }
                  if (part) selections[group.id] = part
                  else delete selections[group.id]
                  update({ ...expression, selections }, '表情のパーツの変更')
                }}
              />
            </label>
          ))}
          <div className="field__row">
            {expression.id !== portrait.defaultExpressionId && (
              <>
                <button type="button" onClick={() => save({ ...portrait, defaultExpressionId: expression.id }, '既定の表情の変更')}>
                  既定の表情にする
                </button>
                <button
                  type="button"
                  className="button--danger"
                  onClick={() => {
                    const expressions = { ...portrait.expressions }
                    delete expressions[expression.id]
                    save({ ...portrait, expressions }, '表情の削除')
                    onSelect(portrait.defaultExpressionId)
                  }}
                >
                  この表情を削除
                </button>
              </>
            )}
          </div>
        </section>
      )}
    </div>
  )
}

function LayersEditor({ portrait, manifest, save }: EditorProps & { manifest: PsdManifest }): React.JSX.Element {
  const partGroupKeys = new Set(Object.values(portrait.partGroups).map((group) => layerKey(group.layerPath)))

  const render = (nodes: readonly PsdLayerNode[], depth: number): React.JSX.Element[] =>
    [...nodes].reverse().flatMap((node) => {
      const override = portrait.layerVisibility[node.key]
      const visible = override ?? !node.hidden
      const isPartGroup = partGroupKeys.has(node.key)
      return [
        <label key={node.key} className="layer-row" style={{ paddingLeft: depth * 16 }}>
          <input
            type="checkbox"
            checked={visible}
            onChange={(event) => {
              const layerVisibility = { ...portrait.layerVisibility }
              if (event.target.checked === !node.hidden) delete layerVisibility[node.key]
              else layerVisibility[node.key] = event.target.checked
              save({ ...portrait, layerVisibility }, 'レイヤーの表示の変更')
            }}
          />
          <span>{node.kind === 'group' ? '📁 ' : ''}{node.name}</span>
          {override !== undefined && <span className="note">(変更済み)</span>}
          {isPartGroup && <span className="note">(パーツ)</span>}
        </label>,
        ...(node.kind === 'group' && !isPartGroup ? render(node.children, depth + 1) : [])
      ]
    })

  return (
    <div className="settings-section">
      <p className="note">小物や差分のオン・オフを決めます。パーツのフォルダの中身は、表情と口パクで切り替わります。</p>
      <div className="layer-tree">{render(manifest.layers, 0)}</div>
    </div>
  )
}

function PlacementEditor({ portrait, save }: EditorProps): React.JSX.Element {
  const transform = portrait.transform
  const set = (patch: Partial<PortraitTransform>, label: string): void =>
    save({ ...portrait, transform: { ...transform, ...patch } }, label)

  const numberField = (key: 'x' | 'y' | 'scale', label: string, step: number): React.JSX.Element => (
    <label className="field">
      <span className="field__label">{label}</span>
      <input
        type="number"
        step={step}
        key={`${key}-${transform[key]}`}
        defaultValue={transform[key]}
        onBlur={(event) => {
          const value = Number(event.target.value)
          if (Number.isFinite(value) && value !== transform[key] && (key !== 'scale' || value > 0)) set({ [key]: value }, '立ち絵の配置の変更')
        }}
        data-testid={`placement-${key}`}
      />
    </label>
  )

  return (
    <div className="settings-section">
      <p className="note">位置は画面(動画)の座標で、基準点の位置を指定します。</p>
      {numberField('x', '横位置(px)', 10)}
      {numberField('y', '縦位置(px)', 10)}
      {numberField('scale', '拡大率', 0.05)}
      <label className="field">
        <span className="field__label">基準点</span>
        <select value={transform.anchor} onChange={(event) => set({ anchor: event.target.value as PortraitTransform['anchor'] }, '基準点の変更')}>
          <option value="bottom-center">下端の中央</option>
          <option value="bottom-left">下端の左</option>
          <option value="bottom-right">下端の右</option>
          <option value="center">中央</option>
          <option value="top-center">上端の中央</option>
        </select>
      </label>
      <label className="field">
        <span className="field__label">左右反転</span>
        <input type="checkbox" checked={transform.flipX} onChange={(event) => set({ flipX: event.target.checked }, '左右反転の変更')} />
      </label>
    </div>
  )
}
