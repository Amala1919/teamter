import type { Command } from '@shared/commands/types'
import { itemEndMs, projectDurationMs } from '@shared/project/queries'
import type { Effect, Item, ItemId, Ms } from '@shared/project/types'

import { deleteSelection, useEditorStore } from './store'

/**
 * タイムラインの編集操作。右クリックメニュー・ショートカット・ボタンから同じ関数を呼ぶ。
 * どれも失敗したら理由の文を返す(成功なら null)。
 */

/** コマの送りの単位(30fps の1コマ)。 */
export const FRAME_MS = Math.round(1000 / 30)

/** コピーしたアイテム(このアプリの中だけで使う)。切り取った後でも貼れるよう、中身ごと持つ。 */
let clipboard: Item[] = []

export function hasClipboard(): boolean {
  return clipboard.length > 0
}

function state(): ReturnType<typeof useEditorStore.getState> {
  return useEditorStore.getState()
}

function selectedItems(ids?: readonly ItemId[]): Item[] {
  const { project, selectedItemIds } = state()
  const wanted = new Set(ids ?? selectedItemIds)
  return project.items.filter((item) => wanted.has(item.id))
}

function run(commands: Command[], label: string): { error: string | null; resolvedIds: Record<string, string> } {
  const result = state().dispatch(commands, label)
  return result.ok ? { error: null, resolvedIds: result.resolvedIds } : { error: result.message, resolvedIds: {} }
}

export function copySelection(ids?: readonly ItemId[]): string | null {
  const items = selectedItems(ids)
  if (items.length === 0) return 'コピーするアイテムを選んでください'
  clipboard = items.map((item) => structuredClone(item))
  return null
}

export function cutSelection(ids?: readonly ItemId[]): string | null {
  const error = copySelection(ids)
  if (error) return error
  if (ids) state().setSelection([...ids])
  return deleteSelection()
}

/** コピーしたものを atMs(既定は再生位置)に貼る。貼ったものを選んだ状態にする。 */
export function pasteAt(atMs?: Ms): string | null {
  if (clipboard.length === 0) return '貼り付けるものがありません(先にコピーしてください)'
  const at = atMs ?? state().playheadMs
  const { error, resolvedIds } = run([{ op: 'item.paste', items: clipboard, atMs: at, tempIdPrefix: 'paste' }], '貼り付け')
  if (error) return error
  state().setSelection(clipboard.map((_, index) => resolvedIds[`paste${index}`]).filter((id): id is string => id !== undefined))
  return null
}

/** 選んだものを、そのすぐ後ろに複製する。 */
export function duplicateSelection(ids?: readonly ItemId[]): string | null {
  const items = selectedItems(ids)
  if (items.length === 0) return '複製するアイテムを選んでください'
  const end = Math.max(...items.map(itemEndMs))
  const { error, resolvedIds } = run([{ op: 'item.paste', items, atMs: end, tempIdPrefix: 'dup' }], '複製')
  if (error) return error
  state().setSelection(items.map((_, index) => resolvedIds[`dup${index}`]).filter((id): id is string => id !== undefined))
  return null
}

/**
 * 再生位置で分ける。選んだアイテムを分け、何も選んでいなければ再生位置にある(分けられる)アイテムを全て分ける。
 */
export function splitAtPlayhead(ids?: readonly ItemId[]): string | null {
  const { project, playheadMs } = state()
  const lockedLayers = new Set(project.layers.filter((layer) => layer.locked).map((layer) => layer.id))
  const pool = ids || state().selectedItemIds.length > 0 ? selectedItems(ids) : project.items
  const targets = pool.filter(
    (item) =>
      item.type !== 'voice' &&
      item.type !== 'zoom' &&
      !item.locked &&
      !lockedLayers.has(item.layerId) &&
      item.startMs < playheadMs &&
      playheadMs < itemEndMs(item)
  )
  if (targets.length === 0) return '再生位置に分けられるアイテムがありません(セリフとズームは分けられません)'
  return run(
    targets.map((item) => ({ op: 'item.split', itemId: item.id, atMs: playheadMs })),
    '分割'
  ).error
}

/** 消して詰める。 */
export function rippleDeleteSelection(ids?: readonly ItemId[]): string | null {
  const items = selectedItems(ids)
  if (items.length === 0) return '消すアイテムを選んでください'
  const { error } = run([{ op: 'timeline.rippleDelete', itemIds: items.map((item) => item.id) }], '削除して詰める')
  if (!error) state().setSelection([])
  return error
}

export function closeGapAt(atMs: Ms): string | null {
  return run([{ op: 'timeline.closeGap', atMs }], '空白を詰める').error
}

export function insertGapAt(atMs: Ms, durationMs: Ms): string | null {
  return run([{ op: 'timeline.insertGap', atMs, durationMs }], '空白を入れる').error
}

export function selectAll(): void {
  const { project, setSelection } = state()
  setSelection(project.items.map((item) => item.id))
}

export function selectLayer(layerId: string): void {
  const { project, setSelection } = state()
  setSelection(project.items.filter((item) => item.layerId === layerId).map((item) => item.id))
}

/** アイテムの頭を再生位置へ動かす。 */
export function moveToPlayhead(itemId: ItemId): string | null {
  const { playheadMs } = state()
  return run([{ op: 'item.setTimeRange', itemId, startMs: playheadMs }], '再生位置へ移動').error
}

export function setSpeed(itemId: ItemId, rate: number): string | null {
  return run([{ op: 'item.setSpeed', itemId, rate }], '速度の変更').error
}

export function setVolume(itemId: ItemId, volume: number): string | null {
  return run([{ op: 'item.setAudio', itemId, volume }], '音量の変更').error
}

export function setLocked(ids: readonly ItemId[], locked: boolean): string | null {
  return run(
    ids.map((itemId) => ({ op: 'item.setLocked', itemId, locked })),
    locked ? 'ロック' : 'ロックの解除'
  ).error
}

export function moveToLayer(ids: readonly ItemId[], layerId: string): string | null {
  return run(
    ids.map((itemId) => ({ op: 'item.setLayer', itemId, layerId })),
    'レイヤーの移動'
  ).error
}

/** フェード(入り・出)を付ける。音声は音量のフェード、それ以外は見た目のフェード。 */
export function addFade(item: Item, which: 'in' | 'out' | 'both', lengthMs = 500): string | null {
  const inMs = which === 'out' ? 0 : lengthMs
  const outMs = which === 'in' ? 0 : lengthMs
  if (item.type === 'audio') {
    return run([{ op: 'item.setAudio', itemId: item.id, ...(inMs ? { fadeInMs: inMs } : {}), ...(outMs ? { fadeOutMs: outMs } : {}) }], 'フェード').error
  }
  const index = item.effects.findIndex((effect) => effect.type === 'fade')
  const current = index >= 0 ? (item.effects[index] as Extract<Effect, { type: 'fade' }>) : null
  const effect: Effect = { type: 'fade', inMs: inMs || (current?.inMs ?? 0), outMs: outMs || (current?.outMs ?? 0) }
  return run(
    [index >= 0 ? { op: 'item.updateEffect', itemId: item.id, effectIndex: index, effect } : { op: 'item.addEffect', itemId: item.id, effect }],
    'フェード'
  ).error
}

export function addEffect(itemId: ItemId, effect: Effect, label: string): string | null {
  return run([{ op: 'item.addEffect', itemId, effect }], label).error
}

/** 再生位置を動かす。 */
export function nudgePlayhead(deltaMs: Ms): void {
  const { playheadMs, setPlayhead } = state()
  setPlayhead(Math.max(0, playheadMs + deltaMs))
}

/** 前後の編集点(アイテムの端)へ飛ぶ。 */
export function jumpToEditPoint(direction: 1 | -1): void {
  const { project, playheadMs, setPlayhead } = state()
  const points = new Set<number>([0, projectDurationMs(project)])
  for (const item of project.items) {
    points.add(item.startMs)
    points.add(itemEndMs(item))
  }
  const sorted = [...points].sort((a, b) => a - b)
  const next = direction > 0 ? sorted.find((point) => point > playheadMs + 1) : [...sorted].reverse().find((point) => point < playheadMs - 1)
  if (next !== undefined) setPlayhead(next)
}

export function jumpToEnd(): void {
  const { project, setPlayhead } = state()
  setPlayhead(projectDurationMs(project))
}
