import { DEFAULT_LAYER_IDS } from '../../project/factory'
import { ZOOM_METHODS, type Project, type ZoomItem, type ZoomRegion } from '../../project/types'
import { clampRegion, defaultZoomTiming } from '../../render/zoom'
import { fail, insertLayer, requireFinite, requireLayer, type ApplyEnv, type HandlerTable } from '../env'
import type { CommandOp } from '../types'

type ZoomHandlers = Pick<HandlerTable, 'zoom.insert' | 'zoom.update'>

function validRegion(draft: Project, region: ZoomRegion, op: CommandOp): ZoomRegion {
  requireFinite(region.x, op, '枠の位置')
  requireFinite(region.y, op, '枠の位置')
  requireFinite(region.width, op, '枠の幅')
  if (region.width <= 0) fail(op, '枠の幅は正の値にしてください')
  return clampRegion(draft.canvas, region)
}

function validTiming(value: number, op: CommandOp, label: string): number {
  requireFinite(value, op, label)
  if (value < 0) fail(op, `${label}は0以上にしてください`)
  return Math.round(value)
}

/**
 * ズームを置くレイヤー。画面全体なら一番上。そうでなければ「ズーム」レイヤー(無ければ背景のすぐ上に作る)。
 * ズームはそのレイヤーより下だけを拡大する。
 */
function zoomLayerId(draft: Project, wholeScreen: boolean, env: ApplyEnv): string {
  const ordered = [...draft.layers].sort((a, b) => a.index - b.index)
  if (wholeScreen) {
    const top = ordered.at(-1)
    if (!top) fail('zoom.insert', 'レイヤーが存在しません')
    return top.id
  }
  const existing =
    draft.layers.find((layer) => layer.id === DEFAULT_LAYER_IDS.zoom) ?? draft.layers.find((layer) => layer.name === 'ズーム')
  if (existing) return existing.id
  const background = draft.layers.find((layer) => layer.id === DEFAULT_LAYER_IDS.background) ?? ordered[0]
  const id = env.ctx.newId('lyr')
  insertLayer(draft, {
    id,
    name: 'ズーム',
    index: (background?.index ?? -1) + 1,
    visible: true,
    locked: false,
    muted: false
  })
  return id
}

export const zoomHandlers: ZoomHandlers = {
  'zoom.insert': (draft, command, env) => {
    requireFinite(command.atMs, command.op, '開始時刻')
    requireFinite(command.durationMs, command.op, '尺')
    if (command.atMs < 0) fail(command.op, '開始時刻は負の値にできません')
    if (command.durationMs <= 0) fail(command.op, '尺は正の値でなければなりません')
    const method = command.method ?? 'smooth'
    if (!ZOOM_METHODS.includes(method)) fail(command.op, `寄り方の指定が不正です: ${method}`)
    const timing = defaultZoomTiming(method)
    const layerId =
      command.layerId !== undefined
        ? requireLayer(draft, env.resolve(command.layerId), command.op).id
        : zoomLayerId(draft, command.wholeScreen ?? false, env)
    const item: ZoomItem = {
      id: env.ctx.newId('itm'),
      type: 'zoom',
      layerId,
      startMs: Math.round(command.atMs),
      durationMs: Math.round(command.durationMs),
      effects: [],
      locked: false,
      region: validRegion(draft, command.region, command.op),
      method,
      inMs: validTiming(command.inMs ?? timing.inMs, command.op, '寄る時間'),
      outMs: validTiming(command.outMs ?? timing.outMs, command.op, '戻る時間')
    }
    draft.items.push(item)
    if (command.tempId) env.resolvedIds[command.tempId] = item.id
  },

  'zoom.update': (draft, command, env) => {
    const item = draft.items.find((candidate) => candidate.id === env.resolve(command.itemId))
    if (!item) fail(command.op, `アイテムが見つかりません: ${command.itemId}`)
    if (item.type !== 'zoom') fail(command.op, 'ズームのアイテムではありません')
    if (item.locked) fail(command.op, `アイテムはロックされています: ${item.id}`)
    if (command.region) item.region = validRegion(draft, command.region, command.op)
    if (command.method !== undefined) {
      if (!ZOOM_METHODS.includes(command.method)) fail(command.op, `寄り方の指定が不正です: ${command.method}`)
      item.method = command.method
    }
    if (command.inMs !== undefined) item.inMs = validTiming(command.inMs, command.op, '寄る時間')
    if (command.outMs !== undefined) item.outMs = validTiming(command.outMs, command.op, '戻る時間')
  }
}
