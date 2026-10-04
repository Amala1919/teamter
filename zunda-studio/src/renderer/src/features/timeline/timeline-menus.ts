import { zoomCommands } from '@shared/commands/zoom-still'
import type { Command } from '@shared/commands/types'
import { itemEndMs } from '@shared/project/queries'
import { TRANSITION_KINDS, type Item, type Layer, type Ms, type Project, type TransitionKind, type VideoItem } from '@shared/project/types'
import { TRANSITION_LABELS } from '@shared/render/effects'
import { TIMELINE_PALETTE } from '@shared/project/timeline-colors'
import { clampRegion, regionHeight } from '@shared/render/zoom'

import {
  addEffect,
  addFade,
  closeGapAt,
  copySelection,
  copyTextLook,
  cutSelection,
  duplicateSelection,
  freezeAtPlayhead,
  hasClipboard,
  hasTextLook,
  insertGapAt,
  moveToLayer,
  moveToPlayhead,
  packLeftSelection,
  pasteAt,
  pasteTextLook,
  rippleDeleteSelection,
  selectAll,
  selectFrom,
  groupSelection,
  ungroupSelection,
  selectLayer,
  setLocked,
  setSpeed,
  setVolume,
  splitAtPlayhead
} from '../../state/edit-actions'
import { pickColor } from '../../lib/pick-color'
import { addVolumeKey, setVolumeKeys } from './VolumeLine'
import { dipVolume } from '../../state/volume'
import { addMarker } from '../../state/markers'
import { CORNER_LABELS, crossTransition, makeWipe, resetWipe, setAdjust, setTransitionSide, wipeFromPart, type Corner } from '../../state/look-actions'
import { ADJUST_PRESETS } from '../inspector/MediaLookInspector'
import { deleteSelection, useEditorStore } from '../../state/store'
import type { MenuEntry } from '../../ui/ContextMenu'

/** 右クリックメニューの中身。どれも失敗したら onError に理由を渡す。 */
export interface MenuContext {
  onError: (message: string) => void
  onAddMedia: () => void
  /** 待ち時間を探す画面を開く(動画)。 */
  onFindLulls?: (item: VideoItem) => void
}

const report =
  (context: MenuContext, action: () => string | null) =>
  (): void => {
    const error = action()
    if (error) context.onError(error)
  }

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 8, 16]
const VOLUMES: [number, string][] = [
  [0, 'ミュート'],
  [0.25, '25%'],
  [0.5, '50%'],
  [1, '100%'],
  [1.5, '150%'],
  [2, '200%']
]
const GAPS: [Ms, string][] = [
  [500, '0.5秒'],
  [1000, '1秒'],
  [2000, '2秒'],
  [5000, '5秒']
]

/** 静止画の長さの選択肢(あとからタイムラインで伸び縮みできる)。 */
const FREEZE_LENGTHS: [Ms, string][] = [
  [1000, '1秒'],
  [2000, '2秒'],
  [3000, '3秒'],
  [5000, '5秒']
]

/** 前の素材から切り替えるときの、よく使う切り替え方。 */
const CROSS_KINDS: [TransitionKind, string][] = [
  ['fade', 'クロスフェード(0.5秒)'],
  ['wipeRight', 'ワイプ(左から右へ)'],
  ['wipeDown', 'ワイプ(上から下へ)'],
  ['iris', '円が広がる'],
  ['slideLeft', 'スライド(右から)'],
  ['zoom', 'ズーム'],
  ['blur', 'ぼかし'],
  ['blinds', 'ブラインド']
]

const VISUAL_TYPES: Item['type'][] = ['video', 'image', 'text', 'shape', 'portrait']

function state(): ReturnType<typeof useEditorStore.getState> {
  return useEditorStore.getState()
}

/** タイムラインのアイテムを右クリックしたとき。操作の対象は選んでいるアイテム(右クリックしたものを含む)。 */
export function itemMenu(project: Project, item: Item, context: MenuContext): MenuEntry[] {
  const { playheadMs, selectedItemIds } = state()
  const ids = selectedItemIds.includes(item.id) ? selectedItemIds : [item.id]
  const layer = project.layers.find((candidate) => candidate.id === item.layerId)
  const locked = item.locked || layer?.locked === true
  const many = ids.length > 1
  const selected = project.items.filter((candidate) => ids.includes(candidate.id))
  // 選んでいるのが1つのグループの仲間だけなら、グループとして1つのものと同じに扱う。
  const oneGroup = item.groupId !== undefined && selected.every((candidate) => candidate.groupId === item.groupId)
  const anyGrouped = selected.some((candidate) => candidate.groupId !== undefined)
  // Shift+Delete で使う方(設定の「編集」タブで選ぶ)に印を付ける。
  const rippleIgnoresOthers = project.editing.rippleIgnoresOthers === true
  const splittable = item.type !== 'voice' && item.type !== 'zoom' && item.startMs < playheadMs && playheadMs < itemEndMs(item)
  const entries: MenuEntry[] = [
    {
      label: many ? `選んだ${ids.length}個を再生位置で分割` : '再生位置で分割',
      shortcut: 'S',
      disabled: locked || !splittable,
      onSelect: report(context, () => splitAtPlayhead(ids)),
      testId: 'menu-split'
    },
    'separator',
    { label: '切り取り', shortcut: 'Ctrl+X', disabled: locked, onSelect: report(context, () => cutSelection(ids)), testId: 'menu-cut' },
    { label: 'コピー', shortcut: 'Ctrl+C', onSelect: report(context, () => copySelection(ids)), testId: 'menu-copy' },
    { label: '再生位置に貼り付け', shortcut: 'Ctrl+V', disabled: !hasClipboard(), onSelect: report(context, () => pasteAt()), testId: 'menu-paste' },
    { label: 'すぐ後ろに複製', shortcut: 'Ctrl+D', onSelect: report(context, () => duplicateSelection(ids)), testId: 'menu-duplicate' },
    'separator',
    {
      label: '削除',
      shortcut: 'Delete',
      disabled: locked,
      danger: true,
      onSelect: report(context, () => {
        state().setSelection([...ids])
        return deleteSelection()
      }),
      testId: 'menu-delete'
    },
    {
      label: '削除して詰める',
      shortcut: 'Shift+Delete',
      disabled: locked,
      danger: true,
      testId: 'menu-ripple-delete',
      submenu: [
        {
          label: 'ほかの素材が残っている時間は詰めない',
          checked: !rippleIgnoresOthers,
          onSelect: report(context, () => rippleDeleteSelection(ids, false)),
          testId: 'menu-ripple-delete-respect'
        },
        {
          label: 'ほかの素材は考慮せず、消した長さだけ詰める',
          checked: rippleIgnoresOthers,
          onSelect: report(context, () => rippleDeleteSelection(ids, true)),
          testId: 'menu-ripple-delete-ignore'
        }
      ]
    },
    'separator',
    many && !oneGroup
      ? {
          label: `選んだ${ids.length}個を左に詰める`,
          disabled: locked,
          testId: 'menu-pack-left',
          submenu: [
            {
              label: '空白を埋める(選んだもの同士の間も詰める)',
              onSelect: report(context, () => packLeftSelection(false, ids)),
              testId: 'menu-pack-left-fill'
            },
            {
              label: '空白を保つ(間はそのまま、まとめて左へ)',
              onSelect: report(context, () => packLeftSelection(true, ids)),
              testId: 'menu-pack-left-keep'
            }
          ]
        }
      : { label: '左に詰める', disabled: locked, onSelect: report(context, () => packLeftSelection(false, ids)), testId: 'menu-pack-left' },
    { label: '再生位置へ移動', disabled: locked || (many && !oneGroup), onSelect: report(context, () => moveToPlayhead(item.id)), testId: 'menu-move-to-playhead' },
    { label: '再生位置をここの頭へ', onSelect: () => state().setPlayhead(item.startMs) },
    { label: '再生位置をここの終わりへ', onSelect: () => state().setPlayhead(itemEndMs(item)) },
    'separator',
    {
      label: many && !oneGroup ? `選んだ${ids.length}個をグループにする` : 'グループにする',
      shortcut: 'Ctrl+G',
      disabled: !many || oneGroup,
      onSelect: report(context, () => groupSelection(ids)),
      testId: 'menu-group'
    },
    { label: 'グループを解く', shortcut: 'Ctrl+Shift+G', disabled: !anyGrouped, onSelect: report(context, () => ungroupSelection(ids)), testId: 'menu-ungroup' },
    'separator',
    {
      label: many ? `選んだ${ids.length}個の色` : '色',
      testId: 'menu-item-color',
      submenu: colorSubmenu(
        item.color ?? null,
        (color) => {
          const result = state().dispatch([{ op: 'item.setColor', itemIds: ids, color }], '素材の色の変更')
          return result.ok ? null : result.message
        },
        'レイヤー・種類の色に戻す',
        'menu-item-color',
        context
      )
    }
  ]

  const tools: MenuEntry[] = []
  if (item.type === 'voice') {
    // 選んだセリフの字幕をまとめて出す・出さない(1つめのセリフに合わせて切り替える)
    const lines = selected.filter((candidate) => candidate.type === 'voice').map((candidate) => candidate.id)
    const hide = item.subtitleHidden !== true
    tools.push({
      label: `${lines.length > 1 ? `選んだ${lines.length}個のセリフの` : ''}字幕を${hide ? '出さない' : '出す'}`,
      disabled: locked,
      onSelect: report(context, () => {
        const result = state().dispatch([{ op: 'voice.setSubtitleHidden', itemIds: lines, hidden: hide }], hide ? '字幕を出さない' : '字幕を出す')
        return result.ok ? null : result.message
      }),
      testId: 'menu-subtitle-hidden'
    })
  }
  if (item.type === 'text') {
    const texts = selected.filter((candidate) => candidate.type === 'text').length
    tools.push(
      { label: '見た目をコピー', onSelect: () => copyTextLook(item), testId: 'menu-copy-look' },
      {
        label: texts > 1 ? `選んだ${texts}個のテロップに見た目を貼り付け` : '見た目を貼り付け',
        disabled: locked || !hasTextLook(),
        onSelect: report(context, () => pasteTextLook(ids)),
        testId: 'menu-paste-look'
      }
    )
  }
  if (item.type === 'video' && !item.freeze) {
    const canFreeze = !locked && item.startMs <= playheadMs && playheadMs <= itemEndMs(item)
    const freezeMenu = (mode: 'insert' | 'overwrite'): MenuEntry[] =>
      FREEZE_LENGTHS.map(([length, label]) => ({
        label,
        onSelect: report(context, () => freezeAtPlayhead(length, mode, [item.id])),
        testId: `menu-freeze-${mode}-${length}`
      }))
    tools.push(
      {
        label: '再生位置で止めて静止画を挟む',
        shortcut: 'F',
        disabled: !canFreeze,
        testId: 'menu-freeze-insert',
        submenu: freezeMenu('insert')
      },
      {
        label: '再生位置から先を静止画にする',
        disabled: !canFreeze,
        testId: 'menu-freeze-overwrite',
        submenu: freezeMenu('overwrite')
      }
    )
  }
  if (item.type === 'video' && !item.freeze && context.onFindLulls) {
    const video = item
    const open = context.onFindLulls
    tools.push({ label: '待ち時間を探して詰める・早送り…', disabled: locked, onSelect: () => open(video), testId: 'menu-find-lulls' })
  }
  if (item.type === 'video' && !item.freeze) {
    tools.push({
      label: '速度',
      disabled: locked,
      testId: 'menu-speed',
      submenu: SPEEDS.map((rate) => ({
        label: `${rate}倍`,
        checked: item.playbackRate === rate,
        onSelect: report(context, () => setSpeed(item.id, rate)),
        testId: `menu-speed-${rate}`
      }))
    })
  }
  if ((item.type === 'video' && !item.freeze) || item.type === 'audio') {
    tools.push({
      label: '音量',
      disabled: locked,
      testId: 'menu-volume',
      submenu: VOLUMES.map(([volume, label]) => ({
        label,
        checked: item.volume === volume,
        onSelect: report(context, () => setVolume(item.id, volume)),
        testId: `menu-volume-${volume}`
      }))
    })
  }
  if ((item.type === 'video' && !item.freeze) || item.type === 'audio') {
    const sound = item
    const relMs = playheadMs - item.startMs
    const inside = relMs > 0 && relMs < item.durationMs
    tools.push({
      label: '音量の点(時間で音量を変える)',
      disabled: locked,
      testId: 'menu-volume-keys',
      submenu: [
        { label: '再生位置に点を足す', disabled: !inside, onSelect: report(context, () => addVolumeKey(sound, relMs)), testId: 'menu-volume-key-add' },
        {
          label: '再生位置の前後1秒だけ下げる(30%)',
          disabled: !inside,
          onSelect: report(context, () => dipVolume(sound, relMs)),
          testId: 'menu-volume-dip'
        },
        { label: 'すべての点を消す(一定に戻す)', disabled: !sound.volumeKeys?.length, onSelect: report(context, () => setVolumeKeys(sound, null, '音量の点を消す')) }
      ]
    })
  }
  if (item.type !== 'voice' && item.type !== 'zoom') {
    tools.push({
      label: 'フェード',
      disabled: locked,
      testId: 'menu-fade',
      submenu: [
        { label: 'フェードイン(0.5秒)', onSelect: report(context, () => addFade(item, 'in')), testId: 'menu-fade-in' },
        { label: 'フェードアウト(0.5秒)', onSelect: report(context, () => addFade(item, 'out')), testId: 'menu-fade-out' },
        { label: '両方(0.5秒)', onSelect: report(context, () => addFade(item, 'both')), testId: 'menu-fade-both' }
      ]
    })
  }
  if (VISUAL_TYPES.includes(item.type)) {
    tools.push({
      label: '動きを付ける',
      disabled: locked,
      testId: 'menu-motion',
      submenu: [
        {
          label: 'じわっと寄る',
          onSelect: report(context, () =>
            addEffect(item.id, { type: 'scale', from: 1, to: 1.15, easing: 'easeInOutCubic', durationMs: item.durationMs }, 'じわっと寄る')
          )
        },
        {
          label: 'ぽんっと出る',
          onSelect: report(context, () =>
            addEffect(item.id, { type: 'scale', from: 0.6, to: 1, easing: 'easeOutCubic', durationMs: 250 }, 'ぽんっと出る')
          )
        },
        {
          label: '揺らす(驚き)',
          onSelect: report(context, () =>
            addEffect(item.id, { type: 'shake', amplitudePx: 12, frequencyHz: 18, durationMs: Math.min(600, item.durationMs) }, '揺らす')
          ),
          testId: 'menu-shake'
        }
      ]
    })
  }
  if (item.type === 'video' || item.type === 'image' || item.type === 'text' || item.type === 'shape') {
    const transition = item.effects.find((effect) => effect.type === 'transition')
    const current = transition?.type === 'transition' ? transition : null
    const sideMenu = (side: 'in' | 'out'): MenuEntry[] => [
      { label: 'なし', checked: !current?.[side], onSelect: report(context, () => setTransitionSide(item, side, null)) },
      ...TRANSITION_KINDS.map((kind) => ({
        label: TRANSITION_LABELS[kind],
        checked: current?.[side]?.kind === kind,
        onSelect: report(context, () => setTransitionSide(item, side, kind)),
        testId: `menu-transition-${side}-${kind}`
      }))
    ]
    tools.push(
      {
        label: '前の素材から切り替える(重ねる)',
        disabled: locked,
        testId: 'menu-cross-transition',
        submenu: CROSS_KINDS.map(([kind, label]) => ({
          label,
          onSelect: report(context, () => crossTransition(item.id, kind, 500)),
          testId: `menu-cross-${kind}`
        }))
      },
      { label: '登場の動き', disabled: locked, testId: 'menu-transition-in', submenu: sideMenu('in') },
      { label: '退場の動き', disabled: locked, testId: 'menu-transition-out', submenu: sideMenu('out') }
    )
  }
  if (item.type === 'video' || item.type === 'image') {
    const media = item
    tools.push(
      {
        label: '小窓(ワイプ)',
        disabled: locked,
        testId: 'menu-wipe',
        submenu: [
          ...(Object.keys(CORNER_LABELS) as Corner[]).map((corner) => ({
            label: `${CORNER_LABELS[corner]}の小窓にする`,
            onSelect: report(context, () => makeWipe(media, corner)),
            testId: `menu-wipe-${corner}`
          })),
          'separator' as const,
          {
            label: '一部を切り抜いて小窓で見せる(複製)',
            onSelect: report(context, () => wipeFromPart(media)),
            testId: 'menu-wipe-part'
          },
          { label: '小窓をやめる(画面いっぱいに戻す)', onSelect: report(context, () => resetWipe(media)), testId: 'menu-wipe-reset' }
        ]
      },
      {
        label: '色の調整',
        disabled: locked,
        testId: 'menu-adjust',
        submenu: ADJUST_PRESETS.map((preset) => ({
          label: preset.name,
          onSelect: report(context, () =>
            setAdjust(
              selected.filter((candidate) => candidate.type === 'video' || candidate.type === 'image').map((candidate) => candidate.id),
              preset.id === 'none' ? null : preset.adjust,
              `色の調整「${preset.name}」`
            )
          ),
          testId: `menu-adjust-${preset.id}`
        }))
      }
    )
  }
  if (item.type === 'video' || item.type === 'image') {
    tools.push({
      label: 'この区間にズーム枠を置く',
      onSelect: report(context, () => insertZoom(project, item.startMs, item.durationMs)),
      testId: 'menu-zoom-here'
    })
  }
  if (tools.length > 0) entries.push('separator', ...tools)

  const targets = project.layers.filter((candidate) => candidate.id !== item.layerId)
  entries.push(
    'separator',
    {
      label: '別のレイヤーへ',
      disabled: locked || targets.length === 0,
      testId: 'menu-layer',
      submenu: [...project.layers]
        .sort((a, b) => b.index - a.index)
        .map((candidate) => ({
          label: candidate.name,
          checked: candidate.id === item.layerId,
          disabled: candidate.locked || candidate.id === item.layerId,
          onSelect: report(context, () => moveToLayer(ids, candidate.id))
        }))
    },
    {
      label: item.locked ? 'ロックを解除' : 'ロック',
      checked: item.locked,
      onSelect: report(context, () => setLocked(ids, !item.locked)),
      testId: 'menu-lock'
    }
  )
  return entries
}

/** レーンの何も無い所を右クリックしたとき。atMs はクリックした時刻。 */
export function laneMenu(project: Project, layer: Layer, atMs: Ms, context: MenuContext): MenuEntry[] {
  const at = Math.max(0, Math.round(atMs))
  const place = (label: string, action: () => string | null): Exclude<MenuEntry, 'separator'> => ({ label, onSelect: report(context, action) })
  return [
    { label: 'ここに貼り付け', shortcut: 'Ctrl+V', disabled: !hasClipboard(), onSelect: report(context, () => pasteAt(at)), testId: 'menu-paste-here' },
    { label: '再生位置をここへ', onSelect: () => state().setPlayhead(at), testId: 'menu-seek-here' },
    'separator',
    { label: '素材を追加…', onSelect: context.onAddMedia },
    place('ここにテロップを置く', () => placeText(at, layer)),
    { ...place('ここにズーム枠を置く', () => insertZoom(project, at, 3000)), testId: 'menu-zoom-at' },
    ...portraitSceneMenu(project, at, context),
    'separator',
    { label: 'ここの空白を詰める', onSelect: report(context, () => closeGapAt(at)), testId: 'menu-close-gap' },
    {
      label: 'ここに空白を入れる',
      testId: 'menu-insert-gap',
      submenu: GAPS.map(([length, label]) => ({ label, onSelect: report(context, () => insertGapAt(at, length)), testId: `menu-insert-gap-${length}` }))
    },
    'separator',
    { label: 'すべて選択', shortcut: 'Ctrl+A', onSelect: selectAll },
    { label: 'ここから後ろをすべて選択', onSelect: () => selectFrom(at), testId: 'menu-select-from' },
    { label: `「${layer.name}」をすべて選択`, onSelect: () => selectLayer(layer.id) },
    { label: `「${layer.name}」のここから後ろを選択`, onSelect: () => selectFrom(at, layer.id) },
    'separator',
    ...overlapMenu(project, context)
  ]
}

/**
 * 重なりの振り分け。同じレイヤーで重なった素材を、空いている同じ種類のレイヤーへ移す(shared/commands/arrange.ts)。
 * レイヤーの見出しと、レーンの何も無いところの右クリックから使う。
 */
function overlapMenu(project: Project, context: MenuContext): MenuEntry[] {
  const dispatch = (commands: Command[], label: string) =>
    report(context, () => {
      const result = state().dispatch(commands, label)
      return result.ok ? null : result.message
    })
  const auto = project.editing.avoidOverlap !== false
  return [
    {
      label: '重なったら別のレイヤーへ自動で移す',
      checked: auto,
      onSelect: dispatch([{ op: 'project.setEditing', avoidOverlap: !auto }], '重なりの自動振り分けの切り替え'),
      testId: 'menu-avoid-overlap'
    },
    {
      label: '重なりを整理(空いているレイヤーへ振り分け)',
      onSelect: dispatch([{ op: 'timeline.arrangeOverlaps' }], '重なりの整理'),
      testId: 'menu-arrange-overlaps'
    },
    { label: '空のレイヤーを消す', onSelect: dispatch([{ op: 'layer.removeEmpty' }], '空のレイヤーを消す'), testId: 'menu-remove-empty-layers' }
  ]
}

/** 目盛りを右クリックしたとき。 */
export function rulerMenu(atMs: Ms, context: MenuContext): MenuEntry[] {
  const at = Math.max(0, Math.round(atMs))
  return [
    { label: '再生位置をここへ', onSelect: () => state().setPlayhead(at) },
    { label: 'ここに目印を置く', onSelect: report(context, () => addMarker(at).error), testId: 'menu-ruler-marker' },
    { label: 'ここから後ろをすべて選択', onSelect: () => selectFrom(at), testId: 'menu-ruler-select-from' },
    {
      label: 'ここで分割',
      onSelect: report(context, () => {
        state().setPlayhead(at)
        state().setSelection([])
        return splitAtPlayhead()
      })
    },
    {
      label: 'ここに空白を入れる',
      submenu: GAPS.map(([length, label]) => ({ label, onSelect: report(context, () => insertGapAt(at, length)) }))
    }
  ]
}

/** レイヤー名を右クリックしたとき。 */
export function layerMenu(layer: Layer, context: MenuContext): MenuEntry[] {
  const toggle = (key: 'visible' | 'muted' | 'locked', label: string) =>
    report(context, () => {
      const result = state().dispatch([{ op: 'layer.update', layerId: layer.id, [key]: !layer[key] }], label)
      return result.ok ? null : result.message
    })
  return [
    { label: '表示する', checked: layer.visible, onSelect: toggle('visible', 'レイヤーの表示の切り替え') },
    { label: 'ミュート', checked: layer.muted, onSelect: toggle('muted', 'レイヤーのミュートの切り替え') },
    { label: 'ロック', checked: layer.locked, onSelect: toggle('locked', 'レイヤーのロックの切り替え') },
    {
      label: 'レイヤーの色',
      testId: 'menu-layer-color',
      submenu: colorSubmenu(
        layer.color ?? null,
        (color) => {
          const result = state().dispatch([{ op: 'layer.update', layerId: layer.id, color }], 'レイヤーの色の変更')
          return result.ok ? null : result.message
        },
        '種類ごとの色に戻す',
        'menu-layer-color',
        context
      )
    },
    'separator',
    { label: 'このレイヤーをすべて選択', onSelect: () => selectLayer(layer.id) },
    'separator',
    ...overlapMenu(state().project, context)
  ]
}

/**
 * 色の選択肢。決まった色の一覧、自由に選ぶ、元に戻す。
 * 色はタイムラインで見分けるための印で、動画には出ない。
 */
function colorSubmenu(
  current: string | null,
  apply: (color: string | null) => string | null,
  resetLabel: string,
  testPrefix: string,
  context: MenuContext
): MenuEntry[] {
  return [
    ...TIMELINE_PALETTE.map((entry) => ({
      label: `${entry.swatch} ${entry.name}`,
      checked: current === entry.hex,
      onSelect: report(context, () => apply(entry.hex)),
      testId: `${testPrefix}-${entry.hex.slice(1)}`
    })),
    'separator' as const,
    {
      label: 'ほかの色を選ぶ…',
      onSelect: () => pickColor(current ?? '#3fa34d', (color) => report(context, () => apply(color))()),
      testId: `${testPrefix}-pick`
    },
    { label: resetLabel, disabled: current === null, onSelect: report(context, () => apply(null)), testId: `${testPrefix}-reset` }
  ]
}

function placeText(atMs: Ms, layer: Layer): string | null {
  const result = state().dispatch(
    [{ op: 'media.placeText', text: 'テロップ', atMs, durationMs: 3000, ...(layer.locked ? {} : { layerId: layer.id }), tempId: 'text' }],
    'テロップの追加'
  )
  if (!result.ok) return result.message
  if (result.resolvedIds['text']) state().setSelection([result.resolvedIds['text']])
  return null
}

/**
 * ズーム枠を置いて選ぶ。center を渡すとそこを中心にした半分の大きさの枠にする(プレビューの右クリック)。
 */
export function insertZoom(project: Project, atMs: Ms, durationMs: Ms, center?: { x: number; y: number }): string | null {
  const width = project.canvas.width / 2
  const height = regionHeight(project.canvas, width)
  const cx = center?.x ?? project.canvas.width / 2
  const cy = center?.y ?? project.canvas.height / 2
  const region = clampRegion(project.canvas, { x: cx - width / 2, y: cy - height / 2, width })
  // 設定によっては、その時点の動画のコマを静止画にしてズームとグループにする。
  const result = state().dispatch(zoomCommands(project, atMs, durationMs, region), 'ズーム枠の追加')
  if (!result.ok) return result.message
  if (result.resolvedIds['zoom']) {
    state().setSelection([result.resolvedIds['zoom']])
    state().setPlayhead(atMs)
  }
  return null
}

/** 場面ごとの立ち絵を置く項目(立ち絵のあるキャラクターごと)。 */
function portraitSceneMenu(project: Project, atMs: Ms, context: MenuContext): MenuEntry[] {
  const characters = Object.values(project.characters).filter((character) => character.portrait)
  if (characters.length === 0) return []
  const insert = (characterId: string, kind: 'show' | 'hide' | 'adjust', transition: 'none' | 'fade' | 'pop') =>
    report(context, () => {
      const result = state().dispatch(
        [{ op: 'portrait.insert', characterId, atMs, durationMs: 3000, kind, ...(kind === 'show' ? { transition } : {}), tempId: 'scene' }],
        '立ち絵の区間'
      )
      if (!result.ok) return result.message
      if (result.resolvedIds['scene']) state().setSelection([result.resolvedIds['scene']])
      return null
    })
  return [
    {
      label: 'ここに立ち絵の区間を置く',
      testId: 'menu-portrait-scene-at',
      submenu: characters.map((character) => ({
        label: character.name,
        testId: `menu-portrait-scene-${character.id}`,
        submenu: [
          { label: 'この区間だけ出す(ふわっと)', onSelect: insert(character.id, 'show', 'fade'), testId: 'menu-portrait-show-fade' },
          { label: 'この区間だけ出す(ぽんっと)', onSelect: insert(character.id, 'show', 'pop') },
          { label: 'この区間だけ隠す', onSelect: insert(character.id, 'hide', 'none'), testId: 'menu-portrait-hide-at' },
          { label: 'この区間だけ位置・表情を変える', onSelect: insert(character.id, 'adjust', 'none'), testId: 'menu-portrait-adjust-at' }
        ]
      }))
    }
  ]
}
