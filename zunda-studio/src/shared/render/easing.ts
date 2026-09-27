import type { Easing } from '../project/types'

export type EasingName = Easing | 'easeOutBack'

/** 0〜1 の進み具合を曲線で変換する。範囲外の入力は 0〜1 に収める。 */
export function ease(name: EasingName, t: number): number {
  const x = Math.min(1, Math.max(0, t))
  switch (name) {
    case 'linear':
      return x
    case 'easeInCubic':
      return x * x * x
    case 'easeOutCubic':
      return 1 - Math.pow(1 - x, 3)
    case 'easeInOutCubic':
      return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2
    case 'easeOutBack': {
      // 少し行き過ぎてから戻る(パンチイン)。行き過ぎは約8%。
      const c1 = 1.2
      const c3 = c1 + 1
      return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2)
    }
  }
}
