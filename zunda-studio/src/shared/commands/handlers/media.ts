import { DEFAULT_LAYER_IDS } from '../../project/factory'
import type { Asset, AssetType, Item, Project, ShapeProps, Transform } from '../../project/types'
import { fail, layerOrDefault, requireFinite, type ApplyEnv, type HandlerTable } from '../env'
import type { CommandOp } from '../types'
import { validateEffect } from './item'
import { validateShapeKind, validateShapeProps } from './look'

type MediaHandlers = Pick<
  HandlerTable,
  'media.placeVideo' | 'media.placeImage' | 'media.placeAudio' | 'media.placeText' | 'media.placeShape'
>

const COLOR_PATTERN = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/

const BACKGROUND = { id: DEFAULT_LAYER_IDS.background, name: '背景' }
const BGM = { id: DEFAULT_LAYER_IDS.bgm, name: 'BGM' }
const VOICE = { id: DEFAULT_LAYER_IDS.voice, name: 'ボイス' }

function requireAsset<T extends AssetType>(
  draft: Project,
  assetId: string,
  type: T,
  op: CommandOp
): Extract<Asset, { type: T }> {
  const asset = draft.assets[assetId]
  if (!asset) fail(op, `素材が見つかりません: ${assetId}`)
  if (asset.type !== type) fail(op, `この素材は${type}ではありません`)
  return asset as Extract<Asset, { type: T }>
}

/** 変形の既定値は画面の中央・等倍。 */
export function makeTransform(draft: Project, partial: Partial<Transform> | undefined, op: CommandOp): Transform {
  const transform: Transform = {
    x: draft.canvas.width / 2,
    y: draft.canvas.height / 2,
    scale: 1,
    rotation: 0,
    opacity: 1,
    ...partial
  }
  validateTransform(transform, op)
  return transform
}

export function validateTransform(transform: Transform, op: CommandOp): void {
  for (const [key, value] of Object.entries(transform)) requireFinite(value, op, key)
  if (!(transform.scale > 0)) fail(op, '拡大率は正の値にしてください')
  if (transform.opacity < 0 || transform.opacity > 1) fail(op, '不透明度は0〜1の範囲にしてください')
}

export function validateVolume(volume: number, op: CommandOp): number {
  if (!(volume >= 0 && volume <= 4)) fail(op, '音量は0〜4の範囲にしてください')
  return volume
}

function validateTiming(atMs: number, durationMs: number, op: CommandOp): void {
  requireFinite(atMs, op, '開始時刻')
  requireFinite(durationMs, op, '尺')
  if (atMs < 0) fail(op, '開始時刻は負の値にできません')
  if (durationMs <= 0) fail(op, '尺は正の値でなければなりません')
}

/** 素材の切り出し区間を検証して返す。省略時は素材の全体。 */
function sourceRange(
  asset: { durationMs: number },
  inMs: number | undefined,
  outMs: number | undefined,
  op: CommandOp
): { inMs: number; outMs: number } {
  const start = Math.round(inMs ?? 0)
  const end = Math.round(outMs ?? asset.durationMs)
  if (start < 0) fail(op, '切り出しの開始位置は負の値にできません')
  if (end <= start) fail(op, '切り出しの終了位置は開始位置より後にしてください')
  // 素材の長さは ffprobe の値で、ミリ秒の丸めの分だけ揺れるので少し許す。
  if (end > asset.durationMs + 1) fail(op, '切り出しの終了位置が素材の長さを超えています')
  return { inMs: start, outMs: Math.min(end, asset.durationMs) }
}

function push(draft: Project, item: Item, tempId: string | undefined, env: ApplyEnv): void {
  draft.items.push(item)
  if (tempId) env.resolvedIds[tempId] = item.id
}

export const mediaHandlers: MediaHandlers = {
  'media.placeVideo': (draft, command, env) => {
    const assetId = env.resolve(command.assetId)
    const asset = requireAsset(draft, assetId, 'video', command.op)
    const range = sourceRange(asset, command.inMs, command.outMs, command.op)
    validateTiming(command.atMs, range.outMs - range.inMs, command.op)
    push(
      draft,
      {
        id: env.ctx.newId('itm'),
        type: 'video',
        layerId: layerOrDefault(draft, command.layerId, BACKGROUND, command.op, env.resolve),
        startMs: Math.round(command.atMs),
        durationMs: range.outMs - range.inMs,
        effects: [],
        locked: false,
        assetId,
        ...range,
        transform: makeTransform(draft, command.transform, command.op),
        volume: validateVolume(command.volume ?? 1, command.op),
        playbackRate: 1
      },
      command.tempId,
      env
    )
  },

  'media.placeImage': (draft, command, env) => {
    const assetId = env.resolve(command.assetId)
    requireAsset(draft, assetId, 'image', command.op)
    validateTiming(command.atMs, command.durationMs, command.op)
    push(
      draft,
      {
        id: env.ctx.newId('itm'),
        type: 'image',
        layerId: layerOrDefault(draft, command.layerId, BACKGROUND, command.op, env.resolve),
        startMs: Math.round(command.atMs),
        durationMs: Math.round(command.durationMs),
        effects: [],
        locked: false,
        assetId,
        transform: makeTransform(draft, command.transform, command.op)
      },
      command.tempId,
      env
    )
  },

  'media.placeAudio': (draft, command, env) => {
    const assetId = env.resolve(command.assetId)
    const asset = requireAsset(draft, assetId, 'audio', command.op)
    const range = sourceRange(asset, command.inMs, command.outMs, command.op)
    const loop = command.loop ?? false
    const durationMs = Math.round(command.durationMs ?? range.outMs - range.inMs)
    validateTiming(command.atMs, durationMs, command.op)
    if (!loop && durationMs > range.outMs - range.inMs + 1) fail(command.op, 'ループしない音声は素材の区間より長くできません')
    push(
      draft,
      {
        id: env.ctx.newId('itm'),
        type: 'audio',
        layerId: layerOrDefault(draft, command.layerId, BGM, command.op, env.resolve),
        startMs: Math.round(command.atMs),
        durationMs,
        effects: [],
        locked: false,
        assetId,
        ...range,
        volume: validateVolume(command.volume ?? 1, command.op),
        loop,
        fadeInMs: 0,
        fadeOutMs: 0,
        duckable: command.duckable ?? true
      },
      command.tempId,
      env
    )
  },

  'media.placeText': (draft, command, env) => {
    if (command.text.trim() === '') fail(command.op, 'テロップの文字が空です')
    validateTiming(command.atMs, command.durationMs, command.op)
    const styleId = command.styleId === undefined ? Object.keys(draft.subtitleStyles)[0] : env.resolve(command.styleId)
    if (!styleId || !draft.subtitleStyles[styleId]) fail(command.op, '字幕スタイルが見つかりません')
    push(
      draft,
      {
        id: env.ctx.newId('itm'),
        type: 'text',
        layerId: layerOrDefault(draft, command.layerId, VOICE, command.op, env.resolve),
        startMs: Math.round(command.atMs),
        durationMs: Math.round(command.durationMs),
        effects: [],
        locked: false,
        text: command.text,
        styleId,
        transform: makeTransform(draft, command.transform, command.op)
      },
      command.tempId,
      env
    )
  },

  'media.placeShape': (draft, command, env) => {
    if (!COLOR_PATTERN.test(command.fill)) fail(command.op, `色の指定が不正です: ${command.fill}`)
    validateTiming(command.atMs, command.durationMs, command.op)
    const props = validateShapeProps(command.props ?? {}, command.op)
    push(
      draft,
      {
        // 見た目の調整(大きさ・縁取り・影など)を先に置き、決まった項目で上書きする。
        ...(JSON.parse(JSON.stringify(props)) as ShapeProps),
        id: env.ctx.newId('itm'),
        type: 'shape',
        layerId: layerOrDefault(draft, command.layerId, BACKGROUND, command.op, env.resolve),
        startMs: Math.round(command.atMs),
        durationMs: Math.round(command.durationMs),
        effects: (command.effects ?? []).map((effect) => validateEffect(effect, command.op)),
        locked: false,
        shape: validateShapeKind(command.shape, command.op),
        fill: command.fill,
        transform: makeTransform(draft, command.transform, command.op)
      },
      command.tempId,
      env
    )
  }
}

export { COLOR_PATTERN }
