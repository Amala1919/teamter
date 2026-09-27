import { itemEndMs } from '@shared/project/queries'
import type { Item, Layer, Ms, Project } from '@shared/project/types'
import { clampRegion, regionHeight } from '@shared/render/zoom'

import {
  addEffect,
  addFade,
  closeGapAt,
  copySelection,
  cutSelection,
  duplicateSelection,
  hasClipboard,
  insertGapAt,
  moveToLayer,
  moveToPlayhead,
  pasteAt,
  rippleDeleteSelection,
  selectAll,
  selectLayer,
  setLocked,
  setSpeed,
  setVolume,
  splitAtPlayhead
} from '../../state/edit-actions'
import { deleteSelection, useEditorStore } from '../../state/store'
import type { MenuEntry } from '../../ui/ContextMenu'

/** 右クリックメニューの中身。どれも失敗したら onError に理由を渡す。 */
export interface MenuContext {
  onError: (message: string) => void
  onAddMedia: () => void
}

const report =
  (context: MenuContext, action: () => string | null) =>
  (): void => {
    const error = action()
    if (error) context.onError(error)
  }

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4]
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
      onSelect: report(context, () => rippleDeleteSelection(ids)),
      testId: 'menu-ripple-delete'
    },
    'separator',
    { label: '再生位置へ移動', disabled: locked || many, onSelect: report(context, () => moveToPlayhead(item.id)), testId: 'menu-move-to-playhead' },
    { label: '再生位置をここの頭へ', onSelect: () => state().setPlayhead(item.startMs) },
    { label: '再生位置をここの終わりへ', onSelect: () => state().setPlayhead(itemEndMs(item)) }
  ]

  const tools: MenuEntry[] = []
  if (item.type === 'video') {
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
  if (item.type === 'video' || item.type === 'audio') {
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
    'separator',
    { label: 'ここの空白を詰める', onSelect: report(context, () => closeGapAt(at)), testId: 'menu-close-gap' },
    {
      label: 'ここに空白を入れる',
      testId: 'menu-insert-gap',
      submenu: GAPS.map(([length, label]) => ({ label, onSelect: report(context, () => insertGapAt(at, length)), testId: `menu-insert-gap-${length}` }))
    },
    'separator',
    { label: 'すべて選択', shortcut: 'Ctrl+A', onSelect: selectAll },
    { label: `「${layer.name}」をすべて選択`, onSelect: () => selectLayer(layer.id) }
  ]
}

/** 目盛りを右クリックしたとき。 */
export function rulerMenu(atMs: Ms, context: MenuContext): MenuEntry[] {
  const at = Math.max(0, Math.round(atMs))
  return [
    { label: '再生位置をここへ', onSelect: () => state().setPlayhead(at) },
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
    'separator',
    { label: 'このレイヤーをすべて選択', onSelect: () => selectLayer(layer.id) }
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
  const result = state().dispatch([{ op: 'zoom.insert', atMs, durationMs, region, tempId: 'zoom' }], 'ズーム枠の追加')
  if (!result.ok) return result.message
  if (result.resolvedIds['zoom']) {
    state().setSelection([result.resolvedIds['zoom']])
    state().setPlayhead(atMs)
  }
  return null
}
