import type { Ms, VideoItem } from '../project/types'

/**
 * 録画の「動き」と「音」の時間変化と、そこから待ち時間(相手のターン・ロード・考え中など)を探す規則。
 * 解析(ffmpeg)は main 側、探し方はここ(テストしやすいよう純粋な関数にしてある)。
 */

export interface MediaActivity {
  durationMs: Ms
  /** 1つの値が受け持つ時間。 */
  stepMs: Ms
  /** 前のコマとの違いの大きさ(ffmpeg の scene_score。0〜1。止まっている画面ならほぼ 0)。 */
  motion: number[]
  /** 音の大きさ(0〜1)。音の無い素材なら空。 */
  sound: number[]
}

export interface LullOptions {
  /** 画面の動きが少ないところを探す。 */
  useMotion: boolean
  /** この値より動きが小さければ「動きが少ない」(scene_score)。 */
  motionBelow: number
  /** 音が小さいところを探す(動きと両方なら、両方を満たすところ)。 */
  useSound: boolean
  /** この値より音が小さければ「音が小さい」(0〜1)。 */
  soundBelow: number
  /** これより短い待ち時間は拾わない。 */
  minMs: Ms
  /** 前後に残す余白(待ち時間の始まりと終わりを少しだけ見せる)。 */
  marginMs: Ms
}

export const DEFAULT_LULL_OPTIONS: LullOptions = {
  useMotion: true,
  motionBelow: 0.004,
  useSound: false,
  soundBelow: 0.08,
  minMs: 3000,
  marginMs: 500
}

/** 動きの感度の目盛り(画面で選ぶ)。値が大きいほど、多少動いていても待ち時間とみなす。 */
export const MOTION_LEVELS: { label: string; value: number }[] = [
  { label: 'ほぼ止まっている', value: 0.0015 },
  { label: '少しだけ動く(標準)', value: 0.004 },
  { label: 'ゆっくり動く', value: 0.01 },
  { label: 'そこそこ動いていても', value: 0.025 }
]

/** 素材の上の時刻で、待ち時間の区間を探す([始まり, 終わり] の並び)。 */
export function findLulls(activity: MediaActivity, options: LullOptions, range: { fromMs: Ms; toMs: Ms } = { fromMs: 0, toMs: activity.durationMs }): [Ms, Ms][] {
  if (!options.useMotion && !options.useSound) return []
  const steps = Math.ceil(activity.durationMs / Math.max(1, activity.stepMs))
  const quiet = (index: number): boolean => {
    const still = !options.useMotion || (activity.motion[index] ?? 1) < options.motionBelow
    const silent = !options.useSound || activity.sound.length === 0 || (activity.sound[index] ?? 1) < options.soundBelow
    return still && silent
  }
  const lulls: [Ms, Ms][] = []
  let start: number | null = null
  for (let index = 0; index <= steps; index++) {
    const at = index * activity.stepMs
    const inside = at >= range.fromMs && at < range.toMs && index < steps && quiet(index)
    if (inside && start === null) start = at
    if (!inside && start !== null) {
      const end = Math.min(at, range.toMs)
      const from = start + options.marginMs
      const to = end - options.marginMs
      if (to - from >= Math.max(options.minMs - options.marginMs * 2, 200)) lulls.push([from, to])
      start = null
    }
  }
  return lulls
}

/**
 * タイムラインの動画のアイテムについて、待ち時間をタイムライン上の区間で返す(アイテムの区間の中だけ)。
 * 静止画(フリーズフレーム)は対象にしない。
 */
export function lullsForItem(item: VideoItem, activity: MediaActivity, options: LullOptions): [Ms, Ms][] {
  if (item.freeze) return []
  const rate = item.playbackRate
  return findLulls(activity, options, { fromMs: item.inMs, toMs: item.outMs }).map(([from, to]): [Ms, Ms] => [
    Math.round(item.startMs + (from - item.inMs) / rate),
    Math.round(item.startMs + (to - item.inMs) / rate)
  ])
}
