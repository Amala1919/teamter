import type { Ms } from '../project/types'

/**
 * 録画の解析結果と、そこから「使えそうな区間」の候補を選ぶ規則(REQUIREMENTS.md A-5)。
 * 解析(ffmpeg)は main 側、候補の選び方はここ(テストしやすいよう純粋な関数にしてある)。
 */

export interface RecordingAnalysis {
  durationMs: Ms
  /** 場面が大きく切り替わった時刻。 */
  sceneChanges: Ms[]
  /** 音がほとんど無い区間(ゲーム音も声も無い)。 */
  silences: [Ms, Ms][]
  /** 1秒ごとの音の大きさ(0〜1)。盛り上がりの目安。 */
  loudness: number[]
}

export interface CandidateSegment {
  id: string
  inMs: Ms
  outMs: Ms
  /** 高いほど使いどころ。 */
  score: number
  /** 区間の中の目印・会話の数(候補を選んだ理由として AI に渡す)。 */
  markers: number
  talks: number
  /** 平均の音の大きさ(0〜1)。 */
  loudness: number
}

export const MIN_SEGMENT_MS = 5_000
export const MAX_SEGMENT_MS = 40_000

/** 場面の切り替わりで録画を区切り、短すぎる区間はつなげ、長すぎる区間は分ける。無音の区間は候補から外す。 */
export function segmentRecording(analysis: RecordingAnalysis): [Ms, Ms][] {
  const cuts = [...new Set([0, ...analysis.sceneChanges.filter((at) => at > 0 && at < analysis.durationMs), analysis.durationMs])].sort((a, b) => a - b)
  const segments: [Ms, Ms][] = []
  let start = cuts[0]!
  for (const cut of cuts.slice(1)) {
    if (cut - start < MIN_SEGMENT_MS && cut !== analysis.durationMs) continue
    let from = start
    while (cut - from > MAX_SEGMENT_MS) {
      segments.push([from, from + MAX_SEGMENT_MS])
      from += MAX_SEGMENT_MS
    }
    if (cut - from >= 1000) segments.push([from, cut])
    start = cut
  }
  return segments.filter(([from, to]) => silentRatio(analysis, from, to) < 0.8)
}

function silentRatio(analysis: RecordingAnalysis, from: Ms, to: Ms): number {
  let silent = 0
  for (const [start, end] of analysis.silences) silent += Math.max(0, Math.min(end, to) - Math.max(start, from))
  return silent / Math.max(1, to - from)
}

function meanLoudness(analysis: RecordingAnalysis, from: Ms, to: Ms): number {
  const first = Math.floor(from / 1000)
  const last = Math.max(first + 1, Math.ceil(to / 1000))
  const values = analysis.loudness.slice(first, last)
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length
}

/**
 * 候補の区間を選ぶ。点数 = 盛り上がり(音の大きさ) + 目印 ×3 + 録画中の会話 ×1。
 * 目印は「ここは使う」という投稿者自身の判断なので、最も重く見る。
 */
export function candidateSegments(
  analysis: RecordingAnalysis,
  moments: { markers: Ms[]; talks: Ms[] },
  limit = 40
): CandidateSegment[] {
  const loudest = Math.max(0.0001, ...analysis.loudness)
  return segmentRecording(analysis)
    .map(([inMs, outMs], index) => {
      const markers = moments.markers.filter((at) => at >= inMs && at < outMs).length
      const talks = moments.talks.filter((at) => at >= inMs && at < outMs).length
      const loudness = meanLoudness(analysis, inMs, outMs) / loudest
      return { id: `seg${index + 1}`, inMs, outMs, markers, talks, loudness: Math.round(loudness * 100) / 100, score: Math.round((loudness + markers * 3 + talks) * 100) / 100 }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .sort((a, b) => a.inMs - b.inMs)
}
