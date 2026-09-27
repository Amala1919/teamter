
import type { Chapter, Ms } from './types'

/** YouTube がチャプターとして扱う最短の間隔。 */
export const MIN_CHAPTER_GAP_MS = 10_000
/** YouTube がチャプターとして扱う最少の数。 */
export const MIN_CHAPTERS = 3

/**
 * チャプターを YouTube の決まりに合わせる: 時刻順、最初は 0:00、間は10秒以上、題は空でない。
 * 決まりを満たせない分は落とす(数が足りなければ YouTube 側で無視されるので、画面で知らせる)。
 */
export function normalizeChapters(chapters: readonly Chapter[]): Chapter[] {
  const sorted = [...chapters]
    .filter((chapter) => chapter.title.trim() !== '' && Number.isFinite(chapter.atMs))
    .map((chapter) => ({ atMs: Math.max(0, Math.round(chapter.atMs)), title: chapter.title.trim().replace(/\s*\n\s*/g, ' ') }))
    .sort((a, b) => a.atMs - b.atMs)
  const result: Chapter[] = []
  for (const chapter of sorted) {
    const last = result.at(-1)
    if (!last) {
      result.push({ ...chapter, atMs: 0 })
      continue
    }
    if (chapter.atMs - last.atMs >= MIN_CHAPTER_GAP_MS) result.push(chapter)
  }
  return result
}

/** 概要欄に貼るチャプターの行(例: 1:23 ボス戦)。1時間を超える動画は 1:02:03 の形にする。 */
export function chapterLines(chapters: readonly Chapter[], totalMs: Ms): string {
  return chapters.map((chapter) => `${youtubeTime(chapter.atMs, totalMs)} ${chapter.title}`).join('\n')
}

export function youtubeTime(atMs: Ms, totalMs: Ms): string {
  const seconds = Math.floor(atMs / 1000)
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const rest = seconds % 60
  if (totalMs >= 3_600_000) return `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
  return `${minutes}:${String(rest).padStart(2, '0')}`
}

