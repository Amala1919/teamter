import { voiceItemsInOrder } from './queries'
import type { Ms, Project } from './types'

/**
 * 字幕を SRT(ソフト字幕)にする(REQUIREMENTS.md S-5)。YouTube に字幕ファイルとして上げられる。
 * 1セリフを1つの字幕にし、改行は画面と同じ位置で入れる。話者名は入れない(画面の字幕と同じ)。
 */
export function toSrt(project: Project, options: { withSpeaker?: boolean } = {}): string {
  return voiceItemsInOrder(project)
    .filter((line) => line.text.trim() !== '')
    .map((line, index) => {
      const speaker = project.characters[line.characterId]?.name
      const lines = line.subtitleLines.length > 0 ? line.subtitleLines : [line.displayText ?? line.text]
      const body = options.withSpeaker && speaker ? [`${speaker}: ${lines[0]}`, ...lines.slice(1)] : lines
      return `${index + 1}\n${srtTime(line.startMs)} --> ${srtTime(line.startMs + line.durationMs)}\n${body.join('\n')}\n`
    })
    .join('\n')
}

export function srtTime(ms: Ms): string {
  const total = Math.max(0, Math.round(ms))
  const hours = Math.floor(total / 3_600_000)
  const minutes = Math.floor((total % 3_600_000) / 60_000)
  const seconds = Math.floor((total % 60_000) / 1000)
  const millis = total % 1000
  const pad = (value: number, width = 2): string => String(value).padStart(width, '0')
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)},${pad(millis, 3)}`
}
