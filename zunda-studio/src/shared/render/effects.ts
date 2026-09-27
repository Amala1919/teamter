import { hashString, mulberry32 } from '../portrait/animation'
import type { Effect, Item, Ms } from '../project/types'
import { ease } from './easing'

/** エフェクトをすべて適用した結果。アイテム本来の変形に掛け合わせる。 */
export interface EffectState {
  alpha: number
  scale: number
  dx: number
  dy: number
}

export const IDENTITY_EFFECT: EffectState = { alpha: 1, scale: 1, dx: 0, dy: 0 }

/**
 * アイテム内の相対時刻におけるエフェクトの効果。乱数(振動)は renderSeed とアイテムIDから決定論的に作る。
 * docs/PROJECT_FORMAT.md 7 を参照。
 */
export function effectStateAt(item: Pick<Item, 'id' | 'durationMs' | 'effects'>, relMs: Ms, seed: number): EffectState {
  const state = { ...IDENTITY_EFFECT }
  item.effects.forEach((effect, index) => applyEffect(state, effect, item, relMs, seed, index))
  return state
}

function applyEffect(
  state: EffectState,
  effect: Effect,
  item: Pick<Item, 'id' | 'durationMs'>,
  relMs: Ms,
  seed: number,
  index: number
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
  }
}

function noisePoint(key: string, step: number): [number, number] {
  const random = mulberry32(hashString(`${key}:${step}`))
  return [random() * 2 - 1, random() * 2 - 1]
}

export const EFFECT_LABELS: Record<Effect['type'], string> = {
  fade: 'フェード',
  scale: '拡大・縮小',
  move: '移動',
  shake: '振動'
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
  }
}
