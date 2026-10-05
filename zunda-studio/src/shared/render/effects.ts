import { hashString, mulberry32 } from '../portrait/animation'
import type { Effect, Item, Ms, TransitionKind, TransitionSide } from '../project/types'
import { ease } from './easing'

/**
 * 見える範囲の切り抜き(ワイプなどの切り替え)。アイテムの枠(中心を原点にした幅・高さ)に対して掛ける。
 * edge: その辺から visible の割合だけ見せる / iris: 中心から円で見せる / blinds: 横の帯ごとに見せる
 */
export type ClipState =
  | { kind: 'edge'; from: 'left' | 'right' | 'top' | 'bottom'; visible: number }
  | { kind: 'iris'; visible: number }
  | { kind: 'blinds'; visible: number }

/** エフェクトをすべて適用した結果。アイテム本来の変形に掛け合わせる。 */
export interface EffectState {
  alpha: number
  scale: number
  dx: number
  dy: number
  /** 回転(度)。 */
  rotation: number
  /** ぼかし(px)。 */
  blurPx: number
  clips: ClipState[]
}

export const IDENTITY_EFFECT: EffectState = { alpha: 1, scale: 1, dx: 0, dy: 0, rotation: 0, blurPx: 0, clips: [] }

/** 画面の大きさ(スライドで画面の外から入るのに使う)。 */
export interface Stage {
  width: number
  height: number
}

const DEFAULT_STAGE: Stage = { width: 1920, height: 1080 }

/** 2つの効果を重ねる(立ち絵の登場と調整の両方に付いているときなど)。 */
export function combineEffects(a: EffectState, b: EffectState): EffectState {
  if (a === IDENTITY_EFFECT) return b
  if (b === IDENTITY_EFFECT) return a
  return {
    alpha: a.alpha * b.alpha,
    scale: a.scale * b.scale,
    dx: a.dx + b.dx,
    dy: a.dy + b.dy,
    rotation: a.rotation + b.rotation,
    blurPx: a.blurPx + b.blurPx,
    clips: [...a.clips, ...b.clips]
  }
}

/**
 * アイテム内の相対時刻におけるエフェクトの効果。乱数(振動)は renderSeed とアイテムIDから決定論的に作る。
 * docs/PROJECT_FORMAT.md 7 を参照。
 */
export function effectStateAt(item: Pick<Item, 'id' | 'durationMs' | 'effects'>, relMs: Ms, seed: number, stage: Stage = DEFAULT_STAGE): EffectState {
  const state: EffectState = { ...IDENTITY_EFFECT, clips: [] }
  item.effects.forEach((effect, index) => applyEffect(state, effect, item, relMs, seed, index, stage))
  return state
}

function applyEffect(
  state: EffectState,
  effect: Effect,
  item: Pick<Item, 'id' | 'durationMs'>,
  relMs: Ms,
  seed: number,
  index: number,
  stage: Stage
): void {
  switch (effect.type) {
    case 'fade': {
      let alpha = 1
      if (effect.inMs > 0 && relMs < effect.inMs) alpha = Math.min(alpha, relMs / effect.inMs)
      const untilEnd = item.durationMs - relMs
      if (effect.outMs > 0 && untilEnd < effect.outMs) alpha = Math.min(alpha, untilEnd / effect.outMs)
      state.alpha *= Math.min(1, Math.max(0, alpha))
      return
    }
    case 'scale': {
      const t = effect.durationMs > 0 ? relMs / effect.durationMs : 1
      state.scale *= effect.from + (effect.to - effect.from) * ease(effect.easing, t)
      return
    }
    case 'move': {
      const t = ease(effect.easing, effect.durationMs > 0 ? relMs / effect.durationMs : 1)
      state.dx += effect.fromX + (effect.toX - effect.fromX) * t
      state.dy += effect.fromY + (effect.toY - effect.fromY) * t
      return
    }
    case 'shake': {
      if (relMs >= effect.durationMs || effect.amplitudePx <= 0) return
      // 揺れは終わりに向けて弱まる。位置は周波数ごとの乱数の点を滑らかにつないだもの。
      const decay = 1 - relMs / Math.max(1, effect.durationMs)
      const phase = (relMs / 1000) * Math.max(0.1, effect.frequencyHz)
      const step = Math.floor(phase)
      const blend = ease('easeInOutCubic', phase - step)
      const key = `${seed}:${item.id}:${index}`
      const [x0, y0] = noisePoint(key, step)
      const [x1, y1] = noisePoint(key, step + 1)
      state.dx += (x0 + (x1 - x0) * blend) * effect.amplitudePx * decay
      state.dy += (y0 + (y1 - y0) * blend) * effect.amplitudePx * decay
      return
    }
    case 'pulse':
      state.scale *= 1 + effect.amount * Math.sin(wave(relMs, effect.periodMs))
      return
    case 'blink': {
      // なめらかな波を少しとがらせて、点いている・消えているがはっきり分かるようにする。
      const raw = 0.5 + 0.5 * Math.cos(wave(relMs, effect.periodMs))
      const level = Math.min(1, Math.max(0, (raw - 0.25) * 2))
      const floor = Math.min(1, Math.max(0, effect.minOpacity))
      state.alpha *= floor + (1 - floor) * level
      return
    }
    case 'spin':
      state.rotation += (effect.degreesPerSecond * relMs) / 1000
      return
    case 'swing':
      state.rotation += effect.degrees * Math.sin(wave(relMs, effect.periodMs))
      return
    case 'float':
      state.dy += effect.amplitudePx * Math.sin(wave(relMs, effect.periodMs))
      return
    case 'transition': {
      if (effect.in && effect.in.durationMs > 0 && relMs < effect.in.durationMs) {
        applyTransition(state, effect.in, ease('easeOutCubic', relMs / effect.in.durationMs), 'in', stage)
      }
      const untilEnd = item.durationMs - relMs
      if (effect.out && effect.out.durationMs > 0 && untilEnd < effect.out.durationMs) {
        applyTransition(state, effect.out, ease('easeOutCubic', Math.max(0, untilEnd) / effect.out.durationMs), 'out', stage)
      }
      return
    }
  }
}

/** 周期の中の位置(ラジアン)。 */
function wave(relMs: Ms, periodMs: Ms): number {
  return ((2 * Math.PI) * relMs) / Math.max(50, periodMs)
}

/**
 * 切り替えを掛ける。shown は見えている度合い(0 で隠れている、1 で全部見えている)。
 * 退場は登場を逆に再生した形にするが、ワイプ・スライドは入ってきた向きのまま抜けていく。
 */
function applyTransition(state: EffectState, side: TransitionSide, shown: number, phase: 'in' | 'out', stage: Stage): void {
  const hidden = 1 - shown
  const kind: TransitionKind = side.kind
  switch (kind) {
    case 'fade':
      state.alpha *= shown
      return
    case 'wipeRight':
      state.clips.push({ kind: 'edge', from: phase === 'in' ? 'left' : 'right', visible: shown })
      return
    case 'wipeLeft':
      state.clips.push({ kind: 'edge', from: phase === 'in' ? 'right' : 'left', visible: shown })
      return
    case 'wipeDown':
      state.clips.push({ kind: 'edge', from: phase === 'in' ? 'top' : 'bottom', visible: shown })
      return
    case 'wipeUp':
      state.clips.push({ kind: 'edge', from: phase === 'in' ? 'bottom' : 'top', visible: shown })
      return
    case 'iris':
      state.clips.push({ kind: 'iris', visible: shown })
      return
    case 'blinds':
      state.clips.push({ kind: 'blinds', visible: shown })
      return
    case 'slideLeft':
      // 右から入って左へ抜ける。
      state.dx += (phase === 'in' ? 1 : -1) * hidden * stage.width
      return
    case 'slideRight':
      state.dx += (phase === 'in' ? -1 : 1) * hidden * stage.width
      return
    case 'slideUp':
      state.dy += (phase === 'in' ? 1 : -1) * hidden * stage.height
      return
    case 'slideDown':
      state.dy += (phase === 'in' ? -1 : 1) * hidden * stage.height
      return
    case 'zoom':
      // 登場は大きいところから寄ってくる。退場は手前に抜けていく。
      state.scale *= phase === 'in' ? 1 + 0.6 * hidden : 1 + 0.4 * hidden
      state.alpha *= shown
      return
    case 'pop':
      state.scale *= phase === 'in' ? Math.max(0, popCurve(shown)) : shown
      state.alpha *= Math.min(1, shown * 2)
      return
    case 'blur':
      state.blurPx += 40 * hidden
      state.alpha *= Math.min(1, shown * 1.5)
      return
    case 'spin':
      state.rotation += (phase === 'in' ? -1 : 1) * 270 * hidden
      state.scale *= shown
      return
  }
}

/** 少し行き過ぎてから戻る(ぽんっと出る)。shown はすでに曲線を掛けた値なので、ここでは行き過ぎだけ足す。 */
function popCurve(shown: number): number {
  return shown + Math.sin(shown * Math.PI) * 0.18
}

function noisePoint(key: string, step: number): [number, number] {
  const random = mulberry32(hashString(`${key}:${step}`))
  return [random() * 2 - 1, random() * 2 - 1]
}

export const EFFECT_LABELS: Record<Effect['type'], string> = {
  fade: 'フェード',
  scale: '拡大・縮小',
  move: '移動',
  shake: '振動',
  pulse: 'ドクンドクン(拡大の繰り返し)',
  blink: '点滅',
  spin: '回転し続ける',
  swing: 'ゆらゆら傾く',
  float: 'ふわふわ浮く',
  transition: '登場・退場の切り替え'
}

export const TRANSITION_LABELS: Record<TransitionKind, string> = {
  fade: 'フェード',
  wipeRight: 'ワイプ(左から右へ)',
  wipeLeft: 'ワイプ(右から左へ)',
  wipeDown: 'ワイプ(上から下へ)',
  wipeUp: 'ワイプ(下から上へ)',
  iris: '円が広がる',
  slideLeft: 'スライド(右から)',
  slideRight: 'スライド(左から)',
  slideUp: 'スライド(下から)',
  slideDown: 'スライド(上から)',
  zoom: 'ズーム',
  pop: 'ぽんっと',
  blur: 'ぼかし',
  spin: '回転',
  blinds: 'ブラインド'
}

export function defaultEffect(type: Effect['type']): Effect {
  switch (type) {
    case 'fade':
      return { type: 'fade', inMs: 300, outMs: 300 }
    case 'scale':
      return { type: 'scale', from: 0.9, to: 1, easing: 'easeOutCubic', durationMs: 300 }
    case 'move':
      return { type: 'move', fromX: 0, fromY: 60, toX: 0, toY: 0, easing: 'easeOutCubic', durationMs: 300 }
    case 'shake':
      return { type: 'shake', amplitudePx: 12, frequencyHz: 18, durationMs: 400 }
    case 'pulse':
      return { type: 'pulse', amount: 0.08, periodMs: 700 }
    case 'blink':
      return { type: 'blink', periodMs: 600, minOpacity: 0 }
    case 'spin':
      return { type: 'spin', degreesPerSecond: 90 }
    case 'swing':
      return { type: 'swing', degrees: 8, periodMs: 1200 }
    case 'float':
      return { type: 'float', amplitudePx: 12, periodMs: 1600 }
    case 'transition':
      return { type: 'transition', in: { kind: 'wipeRight', durationMs: 500 }, out: null }
  }
}
