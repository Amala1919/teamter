import { itemEndMs } from '../project/queries'
import type { AudioItem, Ms, Project, VideoItem } from '../project/types'

/**
 * 音の大きさの時間変化(音量 × フェード × ダッキング)。
 * プレビュー(Web Audio の GainNode の自動変化)と書き出し(ミキサー)は、どちらもこの折れ線をそのまま使う。
 * 同じ折れ線から作るので、プレビューと書き出しで音量の変化が一致する。
 */

export interface GainPoint {
  /** アイテム内の相対時刻。 */
  atMs: Ms
  gain: number
}

export type SoundItem = AudioItem | VideoItem

export function isSoundItem(item: { type: string }): item is SoundItem {
  return item.type === 'audio' || item.type === 'video'
}

/** 素材の区間の長さ。 */
export function sourceSpanMs(item: SoundItem): Ms {
  return Math.max(0, item.outMs - item.inMs)
}

/**
 * アイテム内の相対時刻に対応する、素材上の時刻。
 * 動画は再生速度を掛ける。ループする音声は素材の区間を繰り返す。
 */
export function sourceTimeMs(item: SoundItem, relMs: Ms): Ms {
  if (item.type === 'video') return item.inMs + relMs * item.playbackRate
  const span = sourceSpanMs(item)
  if (item.loop && span > 0) return item.inMs + (relMs % span)
  return item.inMs + relMs
}

/** セリフが鳴っている区間(ミュートされたレイヤーを除く)。近い区間は1つにまとめる。 */
export function speechIntervals(project: Project): [Ms, Ms][] {
  const muted = new Set(project.layers.filter((layer) => layer.muted).map((layer) => layer.id))
  const fade = project.editing.duckFadeMs
  const intervals = project.items
    .filter((item) => item.type === 'voice' && item.synthesis !== null && !muted.has(item.layerId))
    .map((item): [Ms, Ms] => [item.startMs, itemEndMs(item)])
    .sort((a, b) => a[0] - b[0])
  const merged: [Ms, Ms][] = []
  for (const interval of intervals) {
    const last = merged.at(-1)
    // 間が短ければ、戻してすぐ下げるより下げたままのほうが自然に聞こえる。
    if (last && interval[0] - last[1] <= fade * 2) last[1] = Math.max(last[1], interval[1])
    else merged.push([...interval])
  }
  return merged
}

function fadeFactor(item: SoundItem, relMs: Ms): number {
  if (item.type !== 'audio') return 1
  let factor = 1
  if (item.fadeInMs > 0 && relMs < item.fadeInMs) factor = Math.min(factor, relMs / item.fadeInMs)
  const untilEnd = item.durationMs - relMs
  if (item.fadeOutMs > 0 && untilEnd < item.fadeOutMs) factor = Math.min(factor, untilEnd / item.fadeOutMs)
  return Math.max(0, Math.min(1, factor))
}

/** ダッキングの掛かり具合(0 = 掛からない、1 = 最大まで下げる)。 */
function duckCoverage(intervals: readonly [Ms, Ms][], fadeMs: Ms, timeMs: Ms): number {
  let coverage = 0
  for (const [start, end] of intervals) {
    if (timeMs < start - fadeMs || timeMs > end + fadeMs) continue
    if (timeMs >= start && timeMs <= end) return 1
    const ramp = timeMs < start ? 1 - (start - timeMs) / Math.max(1, fadeMs) : 1 - (timeMs - end) / Math.max(1, fadeMs)
    coverage = Math.max(coverage, ramp)
  }
  return Math.max(0, Math.min(1, coverage))
}

/** アイテムの音量の折れ線。折れ点は時刻順に並び、最初は 0、最後は尺の位置にある。 */
export function gainEnvelope(project: Project, item: SoundItem): GainPoint[] {
  const duration = item.durationMs
  const times = new Set<Ms>([0, duration])
  if (item.type === 'audio') {
    if (item.fadeInMs > 0) times.add(Math.min(duration, item.fadeInMs))
    if (item.fadeOutMs > 0) times.add(Math.max(0, duration - item.fadeOutMs))
  }
  const duck = item.type === 'audio' && item.duckable && project.editing.duckVolume < 1
  const intervals = duck ? speechIntervals(project) : []
  const fade = project.editing.duckFadeMs
  for (const [start, end] of intervals) {
    for (const absolute of [start - fade, start, end, end + fade]) {
      const rel = absolute - item.startMs
      if (rel > 0 && rel < duration) times.add(rel)
    }
  }
  return [...times]
    .sort((a, b) => a - b)
    .map((atMs) => {
      const duckFactor = duck ? 1 - (1 - project.editing.duckVolume) * duckCoverage(intervals, fade, item.startMs + atMs) : 1
      return { atMs, gain: item.volume * fadeFactor(item, atMs) * duckFactor }
    })
}

/** 折れ線上の値。 */
export function gainAt(points: readonly GainPoint[], relMs: Ms): number {
  if (points.length === 0) return 0
  if (relMs <= points[0]!.atMs) return points[0]!.gain
  for (let index = 1; index < points.length; index++) {
    const next = points[index]!
    if (relMs <= next.atMs) {
      const previous = points[index - 1]!
      const span = next.atMs - previous.atMs
      return span <= 0 ? next.gain : previous.gain + ((next.gain - previous.gain) * (relMs - previous.atMs)) / span
    }
  }
  return points.at(-1)!.gain
}
