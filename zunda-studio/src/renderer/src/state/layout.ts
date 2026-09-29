import { create } from 'zustand'

/**
 * 画面の各欄の大きさ(比率)。境界をドラッグして変え、この PC に覚えておく。
 * 比率で持つのは、ウィンドウの大きさを変えても配分が保たれるようにするため。
 */
export interface LayoutRatios {
  /** 台本の欄の幅(ウィンドウの幅に対して)。 */
  left: number
  /** 右の欄(チャット・ライブの記録・インスペクタ)の幅。 */
  right: number
  /** タイムラインの高さ(ウィンドウの高さに対して)。 */
  timeline: number
}

export type LayoutKey = keyof LayoutRatios

export const DEFAULT_LAYOUT: LayoutRatios = { left: 0.22, right: 0.24, timeline: 0.36 }

/** それぞれの欄の最小・最大。中央のプレビューが潰れないよう、左右の合計も抑える。 */
export const LAYOUT_LIMITS: Record<LayoutKey, [number, number]> = {
  left: [0.12, 0.45],
  right: [0.12, 0.45],
  timeline: [0.12, 0.7]
}
const MIN_CENTER = 0.25

const STORAGE_KEY = 'zs.layout'

function load(): LayoutRatios {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_LAYOUT
    const parsed = JSON.parse(raw) as Partial<Record<string, number>>
    // 今は使わない項目(以前のインスペクタの高さなど)は読み捨てる。
    const known = Object.fromEntries((Object.keys(DEFAULT_LAYOUT) as LayoutKey[]).filter((key) => key in parsed).map((key) => [key, parsed[key]]))
    return normalize({ ...DEFAULT_LAYOUT, ...known })
  } catch {
    return DEFAULT_LAYOUT
  }
}

function save(layout: LayoutRatios): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(layout))
  } catch {
    // 保存できなくても、この起動の間は効く。
  }
}

export function clampRatio(key: LayoutKey, value: number): number {
  const [min, max] = LAYOUT_LIMITS[key]
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : DEFAULT_LAYOUT[key]
}

function normalize(layout: LayoutRatios): LayoutRatios {
  const next = { ...layout }
  for (const key of Object.keys(next) as LayoutKey[]) next[key] = clampRatio(key, next[key])
  // 左右が広すぎて中央が狭くなるときは、右を先に縮める。
  const overflow = next.left + next.right - (1 - MIN_CENTER)
  if (overflow > 0) next.right = Math.max(LAYOUT_LIMITS.right[0], next.right - overflow)
  return next
}

interface LayoutState {
  layout: LayoutRatios
  set: (key: LayoutKey, value: number) => void
  reset: (key?: LayoutKey) => void
}

export const useLayoutStore = create<LayoutState>((set, get) => ({
  layout: load(),
  set: (key, value) => {
    const layout = normalize({ ...get().layout, [key]: value })
    // 中央の最小幅に当たったら、動かした側を止める。
    if (key === 'right' || key === 'left') {
      const total = layout.left + layout.right
      if (total > 1 - MIN_CENTER) layout[key] = Math.max(LAYOUT_LIMITS[key][0], 1 - MIN_CENTER - (key === 'left' ? layout.right : layout.left))
    }
    set({ layout })
    save(layout)
  },
  reset: (key) => {
    const layout = key ? { ...get().layout, [key]: DEFAULT_LAYOUT[key] } : DEFAULT_LAYOUT
    set({ layout })
    save(layout)
  }
}))
