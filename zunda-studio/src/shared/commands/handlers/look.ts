import { SHAPE_KINDS, type ColorAdjust, type Crop, type MediaFrame, type ShapeItem, type ShapeProps } from '../../project/types'
import { MAX_KEY_GAIN, normalizeKeys } from '../../audio/volume-keys'
import { fail, findMutableItem, requireFinite, type HandlerTable } from '../env'
import type { CommandOp, ItemSetShape } from '../types'
import { COLOR_PATTERN } from './media'

type LookHandlers = Pick<HandlerTable, 'item.setShape' | 'item.setMediaLook' | 'item.setVolumeKeys'>

function range(value: unknown, min: number, max: number, label: string, op: CommandOp): number {
  if (typeof value !== 'number' || !(Number.isFinite(value) && value >= min && value <= max)) fail(op, `${label}は ${min}〜${max} で指定してください`)
  return value
}

function color(value: unknown, label: string, op: CommandOp): string {
  if (typeof value !== 'string' || !COLOR_PATTERN.test(value)) fail(op, `${label}の指定が不正です: ${String(value)}`)
  return value
}

export function validateShapeKind(kind: unknown, op: CommandOp): ShapeItem['shape'] {
  if (!SHAPE_KINDS.includes(kind as ShapeItem['shape'])) fail(op, `図形の形の指定が不正です: ${String(kind)}`)
  return kind as ShapeItem['shape']
}

/** 図形の見た目の指定を確かめる(null は「既定に戻す」なのでそのまま通す)。 */
export function validateShapeProps(props: ItemSetShape['props'] | ShapeProps, op: CommandOp): NonNullable<ItemSetShape['props']> {
  const p = props ?? {}
  if (p.width != null) range(p.width, 1, 20_000, '図形の幅', op)
  if (p.height != null) range(p.height, 1, 20_000, '図形の高さ', op)
  if (p.fillOpacity != null) range(p.fillOpacity, 0, 1, '塗りの濃さ', op)
  if (p.gradient != null) {
    color(p.gradient.color, 'グラデーションの色', op)
    range(p.gradient.angle, -360, 360, 'グラデーションの向き', op)
    if (typeof p.gradient.radial !== 'boolean') fail(op, 'グラデーションの種類の指定が不正です')
  }
  if (p.thickness != null) range(p.thickness, 0.5, 400, '線の太さ', op)
  if (p.dash != null && !['solid', 'dash', 'dot'].includes(p.dash)) fail(op, `線の種類の指定が不正です: ${String(p.dash)}`)
  for (const [key, label] of [
    ['stroke', '縁取り'],
    ['outerStroke', '外側の縁']
  ] as const) {
    const stroke = p[key]
    if (stroke == null) continue
    color(stroke.color, `${label}の色`, op)
    range(stroke.widthPx, 0, 200, `${label}の太さ`, op)
  }
  if (p.shadow != null) {
    color(p.shadow.color, '影の色', op)
    range(p.shadow.offsetX, -200, 200, '影のずれ', op)
    range(p.shadow.offsetY, -200, 200, '影のずれ', op)
    range(p.shadow.blurPx, 0, 200, '影のぼかし', op)
  }
  if (p.cornerRadius != null) range(p.cornerRadius, 0, 10_000, '角の丸み', op)
  if (p.points != null) range(p.points, 3, 60, '角の数', op)
  if (p.innerRatio != null) range(p.innerRatio, 0.05, 0.98, 'くぼみの深さ', op)
  if (p.tail != null) {
    requireFinite(p.tail.x, op, 'しっぽの位置')
    requireFinite(p.tail.y, op, 'しっぽの位置')
  }
  if (p.headSize != null) range(p.headSize, 0.2, 4, '矢印の頭の大きさ', op)
  if (p.bend != null) range(p.bend, -1, 1, '曲がり具合', op)
  if (p.drawMs != null) range(p.drawMs, 0, 60_000, '描いていく時間', op)
  if (p.roughness != null) range(p.roughness, 0, 1, '手書き風のゆらぎ', op)
  if (p.wiggle != null && typeof p.wiggle !== 'boolean') fail(op, 'ゆらゆら動かすかの指定が不正です')
  if (p.density != null) range(p.density, 0.2, 3, '量', op)
  if (p.speed != null) range(p.speed, 0, 10, '速さ', op)
  return p
}

function validateCrop(crop: Crop, op: CommandOp): Crop {
  const sides = ['left', 'top', 'right', 'bottom'] as const
  for (const side of sides) range(crop[side], 0, 0.95, '切り抜きの割合', op)
  if (crop.left + crop.right > 0.95 || crop.top + crop.bottom > 0.95) fail(op, '切り抜きすぎです(5%以上は残してください)')
  return { left: crop.left, top: crop.top, right: crop.right, bottom: crop.bottom }
}

function validateFrame(frame: MediaFrame, op: CommandOp): MediaFrame {
  if (!['rect', 'rounded', 'circle'].includes(frame.shape)) fail(op, `枠の形の指定が不正です: ${String(frame.shape)}`)
  range(frame.radiusPx, 0, 2000, '枠の角の丸み', op)
  if (frame.border) {
    color(frame.border.color, '枠の線の色', op)
    range(frame.border.widthPx, 0, 200, '枠の線の太さ', op)
  }
  if (frame.shadow) {
    color(frame.shadow.color, '影の色', op)
    range(frame.shadow.offsetX, -200, 200, '影のずれ', op)
    range(frame.shadow.offsetY, -200, 200, '影のずれ', op)
    range(frame.shadow.blurPx, 0, 200, '影のぼかし', op)
  }
  return JSON.parse(JSON.stringify(frame)) as MediaFrame
}

function validateAdjust(adjust: ColorAdjust, op: CommandOp): ColorAdjust {
  return {
    brightness: range(adjust.brightness, 0, 3, '明るさ', op),
    contrast: range(adjust.contrast, 0, 3, 'コントラスト', op),
    saturation: range(adjust.saturation, 0, 3, '鮮やかさ', op),
    hue: range(adjust.hue, -360, 360, '色合い', op),
    sepia: range(adjust.sepia, 0, 1, 'セピア', op),
    blurPx: range(adjust.blurPx, 0, 100, 'ぼかし', op)
  }
}

/** 元のままの色の調整か(それなら持たない)。 */
function isNeutral(adjust: ColorAdjust): boolean {
  return adjust.brightness === 1 && adjust.contrast === 1 && adjust.saturation === 1 && adjust.hue === 0 && adjust.sepia === 0 && adjust.blurPx === 0
}

/** 図形の見た目の調整の項目(大きさを除く)。replace で捨てるもの。 */
const SHAPE_LOOK_KEYS: (keyof ShapeProps)[] = [
  'fillOpacity',
  'gradient',
  'thickness',
  'dash',
  'stroke',
  'outerStroke',
  'shadow',
  'cornerRadius',
  'points',
  'innerRatio',
  'tail',
  'headSize',
  'bend',
  'drawMs',
  'roughness',
  'wiggle',
  'density',
  'speed'
]

export const lookHandlers: LookHandlers = {
  'item.setVolumeKeys': (draft, command, env) => {
    const item = findMutableItem(draft, env.resolve(command.itemId), command.op)
    if (item.type !== 'audio' && item.type !== 'video') fail(command.op, '音のあるアイテムではありません')
    if (command.keys === null || command.keys.length === 0) {
      delete item.volumeKeys
      return
    }
    if (command.keys.length > 500) fail(command.op, '音量の点は500個までです')
    for (const key of command.keys) {
      requireFinite(key.atMs, command.op, '音量の点の時刻')
      range(key.gain, 0, MAX_KEY_GAIN, '音量の点の大きさ', command.op)
    }
    const keys = normalizeKeys(command.keys.map((key) => ({ atMs: Math.min(item.durationMs, Math.max(0, key.atMs)), gain: key.gain })))
    item.volumeKeys = keys
  },

  'item.setShape': (draft, command, env) => {
    if (command.itemIds.length === 0) fail(command.op, '図形を選んでください')
    const shape = command.shape === undefined ? undefined : validateShapeKind(command.shape, command.op)
    const fill = command.fill === undefined ? undefined : color(command.fill, '色', command.op)
    const patch = validateShapeProps(command.props, command.op)
    for (const rawId of command.itemIds) {
      const item = findMutableItem(draft, env.resolve(rawId), command.op)
      if (item.type !== 'shape') fail(command.op, '図形ではありません')
      if (shape !== undefined) item.shape = shape
      if (fill !== undefined) item.fill = fill
      const target = item as unknown as Record<string, unknown>
      if (command.replace) for (const key of SHAPE_LOOK_KEYS) delete target[key]
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === undefined) delete target[key]
        else target[key] = JSON.parse(JSON.stringify(value)) as unknown
      }
    }
  },

  'item.setMediaLook': (draft, command, env) => {
    if (command.itemIds.length === 0) fail(command.op, '動画か画像を選んでください')
    const crop = command.crop == null ? command.crop : validateCrop(command.crop, command.op)
    const frame = command.frame == null ? command.frame : validateFrame(command.frame, command.op)
    const adjust = command.adjust == null ? command.adjust : validateAdjust(command.adjust, command.op)
    for (const rawId of command.itemIds) {
      const item = findMutableItem(draft, env.resolve(rawId), command.op)
      if (item.type !== 'video' && item.type !== 'image') fail(command.op, '動画か画像ではありません')
      if (crop === null) delete item.crop
      else if (crop !== undefined) {
        if (crop.left + crop.top + crop.right + crop.bottom === 0) delete item.crop
        else item.crop = { ...crop }
      }
      if (frame === null) delete item.frame
      else if (frame !== undefined) item.frame = JSON.parse(JSON.stringify(frame)) as MediaFrame
      if (adjust === null) delete item.adjust
      else if (adjust !== undefined) {
        if (isNeutral(adjust)) delete item.adjust
        else item.adjust = { ...adjust }
      }
    }
  }
}
