import { TRANSITION_KINDS, type Effect, type Project, type TextLook, type TransitionSide } from '../../project/types'
import { fadeCutEdge, fail, findMutableItem, requireFinite, requireLayer, type HandlerTable } from '../env'
import type { CommandOp, ItemSetTextLook } from '../types'
import { validateShapeKind } from './look'
import { COLOR_PATTERN, validateTransform, validateVolume } from './media'

type ItemHandlers = Pick<
  HandlerTable,
  | 'item.setTimeRange'
  | 'item.setLayer'
  | 'item.delete'
  | 'item.trim'
  | 'item.setTransform'
  | 'item.setAudio'
  | 'item.setContent'
  | 'item.setTextLook'
  | 'item.addEffect'
  | 'item.updateEffect'
  | 'item.removeEffect'
>

/** 伸縮で残す最短の尺。 */
const MIN_DURATION_MS = 10

const EASINGS = ['linear', 'easeInCubic', 'easeOutCubic', 'easeInOutCubic']

export function validateEffect(effect: Effect, op: CommandOp): Effect {
  const nonNegative = (value: number, label: string): void => {
    requireFinite(value, op, label)
    if (value < 0) fail(op, `${label}は0以上にしてください`)
  }
  const period = (value: number): void => {
    requireFinite(value, op, '周期')
    if (value < 50 || value > 60_000) fail(op, '周期は0.05〜60秒にしてください')
  }
  switch (effect.type) {
    case 'fade':
      nonNegative(effect.inMs, 'フェードインの時間')
      nonNegative(effect.outMs, 'フェードアウトの時間')
      return { type: 'fade', inMs: effect.inMs, outMs: effect.outMs }
    case 'scale':
      if (!(effect.from > 0 && effect.to > 0)) fail(op, '拡大率は正の値にしてください')
      if (!EASINGS.includes(effect.easing)) fail(op, `変化の曲線の指定が不正です: ${effect.easing}`)
      nonNegative(effect.durationMs, '時間')
      return { type: 'scale', from: effect.from, to: effect.to, easing: effect.easing, durationMs: effect.durationMs }
    case 'move':
      for (const value of [effect.fromX, effect.fromY, effect.toX, effect.toY]) requireFinite(value, op, '移動量')
      if (!EASINGS.includes(effect.easing)) fail(op, `変化の曲線の指定が不正です: ${effect.easing}`)
      nonNegative(effect.durationMs, '時間')
      return { ...effect }
    case 'shake':
      nonNegative(effect.amplitudePx, '揺れの大きさ')
      nonNegative(effect.durationMs, '時間')
      if (!(effect.frequencyHz > 0 && effect.frequencyHz <= 60)) fail(op, '揺れの速さは0〜60Hzにしてください')
      return { ...effect }
    case 'pulse':
      nonNegative(effect.amount, '振れ幅')
      if (effect.amount > 2) fail(op, '振れ幅は2以下にしてください')
      period(effect.periodMs)
      return { type: 'pulse', amount: effect.amount, periodMs: effect.periodMs }
    case 'blink':
      period(effect.periodMs)
      if (!(effect.minOpacity >= 0 && effect.minOpacity <= 1)) fail(op, '一番薄いときの濃さは0〜1にしてください')
      return { type: 'blink', periodMs: effect.periodMs, minOpacity: effect.minOpacity }
    case 'spin':
      requireFinite(effect.degreesPerSecond, op, '回る速さ')
      if (Math.abs(effect.degreesPerSecond) > 7200) fail(op, '回る速さが大きすぎます')
      return { type: 'spin', degreesPerSecond: effect.degreesPerSecond }
    case 'swing':
      requireFinite(effect.degrees, op, '傾きの大きさ')
      if (Math.abs(effect.degrees) > 180) fail(op, '傾きは180度以下にしてください')
      period(effect.periodMs)
      return { type: 'swing', degrees: effect.degrees, periodMs: effect.periodMs }
    case 'float':
      nonNegative(effect.amplitudePx, '浮く高さ')
      period(effect.periodMs)
      return { type: 'float', amplitudePx: effect.amplitudePx, periodMs: effect.periodMs }
    case 'transition': {
      const side = (value: TransitionSide | null | undefined, label: string): TransitionSide | null => {
        if (value === null || value === undefined) return null
        if (!TRANSITION_KINDS.includes(value.kind)) fail(op, `${label}の切り替え方の指定が不正です: ${String(value.kind)}`)
        nonNegative(value.durationMs, `${label}の時間`)
        return { kind: value.kind, durationMs: value.durationMs }
      }
      const result = { type: 'transition' as const, in: side(effect.in, '登場'), out: side(effect.out, '退場') }
      if (!result.in && !result.out) fail(op, '登場か退場のどちらかを指定してください')
      return result
    }
    default:
      return fail(op, `未対応のエフェクトです: ${(effect as { type: string }).type}`)
  }
}

function assetDurationMs(draft: Project, assetId: string): number {
  const asset = draft.assets[assetId]
  return asset && (asset.type === 'video' || asset.type === 'audio') ? asset.durationMs : Number.POSITIVE_INFINITY
}

export const itemHandlers: ItemHandlers = {
  'item.setTimeRange': (draft, command, env) => {
    const item = findMutableItem(draft, env.resolve(command.itemId), command.op)
    if (command.durationMs !== undefined) {
      if (item.type === 'voice') fail(command.op, 'ボイスアイテムの尺は合成結果から決まるため直接変更できません')
      if (command.durationMs <= 0) fail(command.op, '尺は正の値でなければなりません')
      item.durationMs = Math.round(command.durationMs)
      // 長さを決めたら、その長さに固定する(動画の最後まで伸ばすのをやめる)。
      if (item.type === 'portrait') delete item.untilEnd
    }
    if (command.startMs !== undefined) {
      if (command.startMs < 0) fail(command.op, '開始時刻は負の値にできません')
      item.startMs = Math.round(command.startMs)
    }
  },

  'item.setLayer': (draft, command, env) => {
    const item = findMutableItem(draft, env.resolve(command.itemId), command.op)
    item.layerId = requireLayer(draft, env.resolve(command.layerId), command.op).id
  },

  'item.delete': (draft, command, env) => {
    const itemId = env.resolve(command.itemId)
    const index = draft.items.findIndex((item) => item.id === itemId)
    if (index < 0) fail(command.op, `アイテムが見つかりません: ${itemId}`)
    if (draft.items[index]!.locked) fail(command.op, `アイテムはロックされています: ${itemId}`)
    draft.items.splice(index, 1)
    for (const session of Object.values(draft.liveSessions)) {
      for (const entry of session.entries) {
        if (entry.adoptedItemId === itemId) entry.adoptedItemId = null
      }
    }
  },

  'item.trim': (draft, command, env) => {
    const item = findMutableItem(draft, env.resolve(command.itemId), command.op)
    if (item.type === 'voice') fail(command.op, 'ボイスアイテムの尺は合成結果から決まるため直接変更できません')
    const start = Math.round(command.startMs ?? item.startMs)
    const end = Math.round(command.endMs ?? item.startMs + item.durationMs)
    requireFinite(start, command.op, '開始時刻')
    requireFinite(end, command.op, '終了時刻')
    if (start < 0) fail(command.op, '開始時刻は負の値にできません')
    if (end - start < MIN_DURATION_MS) fail(command.op, '尺が短すぎます')

    // 静止画は同じコマを出し続けるので、長さだけが変わる。
    if ((item.type === 'video' && !item.freeze) || (item.type === 'audio' && !item.loop)) {
      // 素材の切り出し位置も一緒に動かす。映像は画面上の位置を保ったまま端だけが動く。
      const rate = item.type === 'video' ? item.playbackRate : 1
      const inMs = Math.round(item.inMs + (start - item.startMs) * rate)
      const outMs = Math.round(inMs + (end - start) * rate)
      if (inMs < 0) fail(command.op, '素材の先頭より前には伸ばせません')
      if (outMs > assetDurationMs(draft, item.assetId) + 1) fail(command.op, '素材の末尾より後には伸ばせません')
      item.inMs = inMs
      item.outMs = outMs
    }
    const cutStart = start !== item.startMs
    const cutEnd = end !== item.startMs + item.durationMs
    item.startMs = start
    item.durationMs = end - start
    if (item.type === 'portrait' && command.endMs !== undefined) delete item.untilEnd
    // 動画の端を切ったら、切った側をフェードさせる(設定で切れる)。
    if (cutStart) fadeCutEdge(draft, item, 'in')
    if (cutEnd) fadeCutEdge(draft, item, 'out')
  },

  'item.setTransform': (draft, command, env) => {
    const item = findMutableItem(draft, env.resolve(command.itemId), command.op)
    if (!('transform' in item)) fail(command.op, 'このアイテムには位置・大きさがありません')
    const { op: _op, itemId: _itemId, ...patch } = command
    const next = { ...item.transform, ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) }
    validateTransform(next, command.op)
    item.transform = next
  },

  'item.setAudio': (draft, command, env) => {
    const item = findMutableItem(draft, env.resolve(command.itemId), command.op)
    if (item.type !== 'audio' && item.type !== 'video') fail(command.op, '音のあるアイテムではありません')
    if (command.volume !== undefined) item.volume = validateVolume(command.volume, command.op)
    if (item.type === 'video') {
      if (command.loop !== undefined || command.fadeInMs !== undefined || command.fadeOutMs !== undefined || command.duckable !== undefined) {
        fail(command.op, '動画で変えられるのは音量だけです')
      }
      return
    }
    for (const [key, value] of [
      ['fadeInMs', command.fadeInMs],
      ['fadeOutMs', command.fadeOutMs]
    ] as const) {
      if (value === undefined) continue
      requireFinite(value, command.op, 'フェードの時間')
      if (value < 0) fail(command.op, 'フェードの時間は0以上にしてください')
      item[key] = Math.round(value)
    }
    if (command.duckable !== undefined) item.duckable = command.duckable
    if (command.loop !== undefined) {
      item.loop = command.loop
      // ループをやめたら、素材の区間より長い分は切り詰める。
      if (!item.loop) item.durationMs = Math.min(item.durationMs, item.outMs - item.inMs)
    }
  },

  'item.setContent': (draft, command, env) => {
    const item = findMutableItem(draft, env.resolve(command.itemId), command.op)
    if (item.type === 'text') {
      if (command.fill !== undefined || command.shape !== undefined) fail(command.op, 'テロップには色・形を指定できません')
      if (command.text !== undefined) {
        if (command.text.trim() === '') fail(command.op, 'テロップの文字が空です')
        item.text = command.text
      }
      if (command.styleId !== undefined) {
        const styleId = env.resolve(command.styleId)
        if (!draft.subtitleStyles[styleId]) fail(command.op, '字幕スタイルが見つかりません')
        item.styleId = styleId
      }
      return
    }
    if (item.type === 'shape') {
      if (command.text !== undefined || command.styleId !== undefined) fail(command.op, '図形には文字を指定できません')
      if (command.fill !== undefined) {
        if (!COLOR_PATTERN.test(command.fill)) fail(command.op, `色の指定が不正です: ${command.fill}`)
        item.fill = command.fill
      }
      if (command.shape !== undefined) item.shape = validateShapeKind(command.shape, command.op)
      return
    }
    fail(command.op, 'テロップか図形のアイテムではありません')
  },

  'item.setTextLook': (draft, command, env) => {
    if (command.itemIds.length === 0) fail(command.op, 'テロップを選んでください')
    const patch = validateTextLook(command.look, command.op)
    for (const rawId of command.itemIds) {
      const item = findMutableItem(draft, env.resolve(rawId), command.op)
      if (item.type !== 'text') fail(command.op, 'テロップではありません')
      const look: Record<string, unknown> = command.replace ? {} : { ...(item.look ?? {}) }
      for (const [key, value] of Object.entries(patch)) {
        if (value === null) delete look[key]
        else look[key] = JSON.parse(JSON.stringify(value)) as unknown
      }
      // 文字送り 0 は「しない」と同じ。
      if (look['typewriterMs'] === 0) delete look['typewriterMs']
      if (Object.keys(look).length === 0) delete item.look
      else item.look = look as TextLook
    }
  },

  'item.addEffect': (draft, command, env) => {
    const item = findMutableItem(draft, env.resolve(command.itemId), command.op)
    if (item.type === 'zoom') fail(command.op, 'ズームにはエフェクトを付けられません')
    item.effects.push(validateEffect(command.effect, command.op))
  },

  'item.updateEffect': (draft, command, env) => {
    const item = findMutableItem(draft, env.resolve(command.itemId), command.op)
    if (!item.effects[command.effectIndex]) fail(command.op, `エフェクトが見つかりません: ${command.effectIndex}`)
    item.effects[command.effectIndex] = validateEffect(command.effect, command.op)
  },

  'item.removeEffect': (draft, command, env) => {
    const item = findMutableItem(draft, env.resolve(command.itemId), command.op)
    if (!item.effects[command.effectIndex]) fail(command.op, `エフェクトが見つかりません: ${command.effectIndex}`)
    item.effects.splice(command.effectIndex, 1)
  }
}

export const TEXT_ALIGNS = ['left', 'center', 'right'] as const

/** テロップの見た目の指定を確かめる(null は「スタイルに戻す」なのでそのまま通す)。 */
export function validateTextLook(look: ItemSetTextLook['look'], op: CommandOp): ItemSetTextLook['look'] {
  const range = (value: number, min: number, max: number, label: string): void => {
    if (!(Number.isFinite(value) && value >= min && value <= max)) fail(op, `${label}は ${min}〜${max} で指定してください`)
  }
  const color = (value: string, label: string): void => {
    if (!COLOR_PATTERN.test(value)) fail(op, `${label}の指定が不正です: ${value}`)
  }
  if (look.color != null) color(look.color, '文字の色')
  if (look.fontFamily != null && (look.fontFamily.trim() === '' || look.fontFamily.length > 100)) fail(op, 'フォントの指定が不正です')
  if (look.fontWeight != null) range(look.fontWeight, 100, 900, '文字の太さ')
  if (look.fontSizePx != null) range(look.fontSizePx, 8, 400, '文字の大きさ(px)')
  if (look.align != null && !TEXT_ALIGNS.includes(look.align)) fail(op, `揃え方の指定が不正です: ${String(look.align)}`)
  if (look.lineHeight != null) range(look.lineHeight, 0.5, 4, '行間')
  if (look.outline != null && look.outline !== 'none') {
    color(look.outline.color, '縁取りの色')
    range(look.outline.widthPx, 0, 60, '縁取りの太さ(px)')
  }
  if (look.shadow != null && look.shadow !== 'none') {
    color(look.shadow.color, '影の色')
    range(look.shadow.offsetX, -100, 100, '影のずれ')
    range(look.shadow.offsetY, -100, 100, '影のずれ')
    range(look.shadow.blurPx, 0, 100, '影のぼかし')
  }
  if (look.background != null) {
    color(look.background.color, '帯の色')
    range(look.background.opacity, 0, 1, '帯の濃さ')
    range(look.background.paddingPx, 0, 200, '帯の余白(px)')
    range(look.background.radiusPx, 0, 200, '帯の角の丸み(px)')
  }
  if (look.typewriterMs != null) range(look.typewriterMs, 0, 60_000, '文字送りの時間(ms)')
  return look
}
