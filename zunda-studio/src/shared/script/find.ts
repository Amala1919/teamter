import type { Command } from '../commands/types'
import type { CharacterId, VoiceItem } from '../project/types'

/**
 * 台本の検索・置換。大文字・小文字と全角・半角の英数字は区別しない(「HP」で「ＨＰ」「hp」も見つかる)。
 * 置換はセリフごとの voice.setText にまとめ、1回の取り消しで全部戻せるようにする。
 */
export interface FindOptions {
  query: string
  /** 指定すると、その話者のセリフだけを対象にする。 */
  characterId?: CharacterId | null
}

/** 比べるための形(全角英数字を半角に、英字を小文字に)。文字数は変えない(位置をそのまま使うため)。 */
function fold(text: string): string {
  return text.replace(/[Ａ-Ｚａ-ｚ０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0)).toLowerCase()
}

/** セリフの中で見つかった位置(先頭からの文字数)。 */
export function matchPositions(text: string, query: string): number[] {
  if (query === '') return []
  const haystack = fold(text)
  const needle = fold(query)
  const positions: number[] = []
  for (let index = haystack.indexOf(needle); index !== -1; index = haystack.indexOf(needle, index + needle.length)) positions.push(index)
  return positions
}

/** 見つかったセリフ(並びは台本の順)。 */
export function findLines(lines: readonly VoiceItem[], options: FindOptions): VoiceItem[] {
  return lines.filter(
    (line) => (!options.characterId || line.characterId === options.characterId) && matchPositions(line.text, options.query).length > 0
  )
}

/** 置き換えた後の文。 */
export function replaceInText(text: string, query: string, replacement: string): string {
  const positions = matchPositions(text, query)
  let result = ''
  let cursor = 0
  for (const position of positions) {
    result += text.slice(cursor, position) + replacement
    cursor = position + query.length
  }
  return result + text.slice(cursor)
}

/** まとめて置換するコマンド。置き換えると空になるセリフは消さずに残す(消すのは別の操作にする)。 */
export function replaceCommands(lines: readonly VoiceItem[], options: FindOptions, replacement: string): Command[] {
  const commands: Command[] = []
  for (const line of findLines(lines, options)) {
    const text = replaceInText(line.text, options.query, replacement)
    if (text !== line.text && text.trim() !== '') commands.push({ op: 'voice.setText', itemId: line.id, text })
  }
  return commands
}
