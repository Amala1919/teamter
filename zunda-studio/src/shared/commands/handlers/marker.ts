import type { Marker } from '../../project/types'
import { fail, requireFinite, type HandlerTable } from '../env'
import type { CommandOp } from '../types'
import { COLOR_PATTERN } from './media'

type MarkerHandlers = Pick<HandlerTable, 'marker.add' | 'marker.update' | 'marker.remove'>

/** 目印の既定の色(黄色)。 */
export const DEFAULT_MARKER_COLOR = '#f5c518'
/** 目印のメモの長さの上限。 */
const MAX_TEXT = 500

function validTime(value: number, op: CommandOp): number {
  requireFinite(value, op, '目印の時刻')
  if (value < 0) fail(op, '目印の時刻は負の値にできません')
  return Math.round(value)
}

function validText(text: string, op: CommandOp): string {
  if (text.length > MAX_TEXT) fail(op, `目印のメモは${MAX_TEXT}文字までです`)
  return text
}

function validColor(color: string, op: CommandOp): string {
  if (!COLOR_PATTERN.test(color)) fail(op, `目印の色の指定が不正です: ${color}`)
  return color
}

function findMarker(markers: Marker[] | undefined, markerId: string, op: CommandOp): Marker {
  const marker = markers?.find((candidate) => candidate.id === markerId)
  if (!marker) fail(op, `目印が見つかりません: ${markerId}`)
  return marker
}

export const markerHandlers: MarkerHandlers = {
  'marker.add': (draft, command, env) => {
    const marker: Marker = {
      id: env.ctx.newId('mrk'),
      atMs: validTime(command.atMs, command.op),
      text: validText(command.text ?? '', command.op),
      color: validColor(command.color ?? DEFAULT_MARKER_COLOR, command.op)
    }
    draft.markers = [...(draft.markers ?? []), marker].sort((a, b) => a.atMs - b.atMs)
    if (command.tempId) env.resolvedIds[command.tempId] = marker.id
  },

  'marker.update': (draft, command, env) => {
    const marker = findMarker(draft.markers, env.resolve(command.markerId), command.op)
    if (command.atMs !== undefined) marker.atMs = validTime(command.atMs, command.op)
    if (command.text !== undefined) marker.text = validText(command.text, command.op)
    if (command.color !== undefined) marker.color = validColor(command.color, command.op)
    draft.markers?.sort((a, b) => a.atMs - b.atMs)
  },

  'marker.remove': (draft, command, env) => {
    const marker = findMarker(draft.markers, env.resolve(command.markerId), command.op)
    draft.markers = (draft.markers ?? []).filter((candidate) => candidate.id !== marker.id)
    if (draft.markers.length === 0) delete draft.markers
  }
}
