import type { Ms } from '../project/types'

/** 1:23.450 の形式。タイムラインと台本の両方で同じ表記を使う。 */
export function formatMs(timeMs: Ms): string {
  const totalSeconds = Math.floor(timeMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  const milliseconds = Math.floor(timeMs % 1000)
  return `${minutes}:${String(seconds).padStart(2, '0')}.${String(milliseconds).padStart(3, '0')}`
}

/** 4分18秒 の形式。尺の変化を人に伝えるときに使う。 */
export function formatDurationJa(timeMs: Ms): string {
  const totalSeconds = Math.round(timeMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes === 0) return `${seconds}秒`
  return seconds === 0 ? `${minutes}分` : `${minutes}分${seconds}秒`
}
