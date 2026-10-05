import type { Command } from '@shared/commands/types'
import type { ColorAdjust, ImageItem, Item, ItemId, Ms, TransitionKind, VideoItem } from '@shared/project/types'
import { itemBox } from '@shared/render/item-box'

import { measureContext } from '../lib/fonts'
import { usePreviewTools } from './preview-tools'
import { useEditorStore } from './store'

/**
 * 見た目の操作(切り替え・小窓・色の調整)。右クリックメニューとインスペクタから同じ関数を呼ぶ。
 * どれも失敗したら理由の文を返す(成功なら null)。
 */

function state(): ReturnType<typeof useEditorStore.getState> {
  return useEditorStore.getState()
}

function run(commands: Command[], label: string): { error: string | null; resolvedIds: Record<string, string> } {
  const result = state().dispatch(commands, label)
  return result.ok ? { error: null, resolvedIds: result.resolvedIds } : { error: result.message, resolvedIds: {} }
}

/** 前の素材から切り替える(重ねて、この素材に登場の切り替えを付ける)。 */
export function crossTransition(itemId: ItemId, kind: TransitionKind, durationMs: Ms = 500): string | null {
  return run([{ op: 'timeline.crossTransition', itemId, kind, durationMs }], '前の素材からの切り替え').error
}

/** 登場・退場の動きを決める(kind が null なら外す)。ほかのエフェクトはそのまま。 */
export function setTransitionSide(item: Item, side: 'in' | 'out', kind: TransitionKind | null, durationMs: Ms = 400): string | null {
  const index = item.effects.findIndex((effect) => effect.type === 'transition')
  const current = index >= 0 ? item.effects[index] : undefined
  const existing = current?.type === 'transition' ? current : null
  const length = Math.min(durationMs, Math.max(50, Math.floor(item.durationMs / 2)))
  const next = { type: 'transition' as const, in: existing?.in ?? null, out: existing?.out ?? null, [side]: kind ? { kind, durationMs: length } : null }
  const label = side === 'in' ? '登場の動き' : '退場の動き'
  if (!next.in && !next.out) return index >= 0 ? run([{ op: 'item.removeEffect', itemId: item.id, effectIndex: index }], label).error : null
  return run(
    [index >= 0 ? { op: 'item.updateEffect', itemId: item.id, effectIndex: index, effect: next } : { op: 'item.addEffect', itemId: item.id, effect: next }],
    label
  ).error
}

export type Corner = 'bottomRight' | 'bottomLeft' | 'topRight' | 'topLeft'

export const CORNER_LABELS: Record<Corner, string> = {
  bottomRight: '右下',
  bottomLeft: '左下',
  topRight: '右上',
  topLeft: '左上'
}

/** 一部を小窓で見せるときに、複製を置くレイヤーの名前。 */
const WIPE_LAYER_NAME = '小窓'

/** 小窓の見た目(白い縁・角丸・影)。 */
const WIPE_FRAME = { shape: 'rounded' as const, radiusPx: 20, border: { color: '#ffffff', widthPx: 6 }, shadow: { color: '#00000099', offsetX: 6, offsetY: 8, blurPx: 16 } }

/** 小窓を置く位置(画面の端から少し離す)。width・height は小窓の大きさ。 */
function cornerPosition(corner: Corner, width: number, height: number): { x: number; y: number } {
  const { canvas } = state().project
  const margin = Math.round(canvas.width * 0.025)
  const right = corner === 'bottomRight' || corner === 'topRight'
  const bottom = corner === 'bottomRight' || corner === 'bottomLeft'
  return {
    x: Math.round(right ? canvas.width - margin - width / 2 : margin + width / 2),
    y: Math.round(bottom ? canvas.height - margin - height / 2 : margin + height / 2)
  }
}

/** 動画・画像を小窓(ワイプ)にする。画面の 3 割ほどの大きさで隅に置き、白い縁を付ける。 */
export function makeWipe(item: VideoItem | ImageItem, corner: Corner): string | null {
  const { project } = state()
  const box = itemBox(project, item, measureContext())
  if (!box) return '素材の大きさが分かりません'
  const baseWidth = box.width / item.transform.scale
  const baseHeight = box.height / item.transform.scale
  const scale = Math.round(((project.canvas.width * 0.3) / baseWidth) * 1000) / 1000
  const position = cornerPosition(corner, baseWidth * scale, baseHeight * scale)
  return run(
    [
      { op: 'item.setTransform', itemId: item.id, ...position, scale, rotation: 0 },
      { op: 'item.setMediaLook', itemIds: [item.id], frame: WIPE_FRAME }
    ],
    '小窓(ワイプ)にする'
  ).error
}

/** 小窓をやめて、画面いっぱい・枠なしに戻す。 */
export function resetWipe(item: VideoItem | ImageItem): string | null {
  const { canvas } = state().project
  return run(
    [
      { op: 'item.setTransform', itemId: item.id, x: canvas.width / 2, y: canvas.height / 2, scale: 1, rotation: 0 },
      { op: 'item.setMediaLook', itemIds: [item.id], frame: null }
    ],
    '小窓をやめる'
  ).error
}

/**
 * 動画・画像の一部を、小窓で大きく見せる(手札・ミニマップなど)。同じ素材を上のレイヤーに複製し、真ん中を切り抜いて隅に置く。
 * 複製の音は消す(同じ音が二重に鳴らないように)。置いたあとプレビューで切り抜く範囲を決められるよう、切り抜きの編集を始める。
 */
export function wipeFromPart(item: VideoItem | ImageItem, corner: Corner = 'topRight'): string | null {
  const { project } = state()
  const asset = project.assets[item.assetId]
  if (!asset || (asset.type !== 'video' && asset.type !== 'image')) return '素材が見つかりません'
  const crop = { left: 0.3, right: 0.3, top: 0.3, bottom: 0.3 }
  // 切り抜く前の基準の大きさ(動画は画面に収まる大きさ、画像は画素数)。
  const fit = asset.type === 'video' ? Math.min(project.canvas.width / asset.width, project.canvas.height / asset.height) : 1
  const keptWidth = asset.width * fit * (1 - crop.left - crop.right)
  const keptHeight = asset.height * fit * (1 - crop.top - crop.bottom)
  const scale = Math.round(((project.canvas.width * 0.36) / keptWidth) * 1000) / 1000
  const position = cornerPosition(corner, keptWidth * scale, keptHeight * scale)
  const clone = structuredClone(item) as VideoItem | ImageItem
  delete clone.groupId
  clone.effects = []
  delete clone.crop
  delete clone.frame
  // 小窓は元の素材より上の「小窓」レイヤーに置く(無ければ元のレイヤーのすぐ上に作る)。
  const sourceLayer = project.layers.find((layer) => layer.id === item.layerId)
  const wipeLayer = project.layers.find((layer) => layer.name === WIPE_LAYER_NAME && layer.index > (sourceLayer?.index ?? -1))
  const commands: Command[] = [
    ...(wipeLayer ? [] : [{ op: 'layer.insert', name: WIPE_LAYER_NAME, index: (sourceLayer?.index ?? 0) + 1, tempId: 'part-layer' } satisfies Command]),
    { op: 'item.paste', items: [clone], atMs: item.startMs, tempIdPrefix: 'part' },
    { op: 'item.setLayer', itemId: 'part0', layerId: wipeLayer?.id ?? 'part-layer' },
    { op: 'item.setMediaLook', itemIds: ['part0'], crop, frame: WIPE_FRAME },
    { op: 'item.setTransform', itemId: 'part0', ...position, scale, rotation: 0 },
    { op: 'item.addEffect', itemId: 'part0', effect: { type: 'transition', in: { kind: 'pop', durationMs: 300 }, out: { kind: 'fade', durationMs: 250 } } }
  ]
  if (item.type === 'video' && !item.freeze) commands.push({ op: 'item.setAudio', itemId: 'part0', volume: 0 })
  const { error, resolvedIds } = run(commands, '一部を小窓で見せる')
  if (error) return error
  const id = resolvedIds['part0']
  if (id) {
    state().setSelection([id])
    usePreviewTools.getState().setCropItem(id)
  }
  return null
}

/** 色の調整をまとめて変える(null で元のまま)。 */
export function setAdjust(itemIds: ItemId[], adjust: ColorAdjust | null, label: string): string | null {
  return run([{ op: 'item.setMediaLook', itemIds, adjust }], label).error
}
