/** 行頭に置いてはいけない文字(行頭禁則)。 */
const FORBIDDEN_AT_LINE_START = new Set([
  '。',
  '、',
  '，',
  '．',
  '」',
  '』',
  '）',
  ')',
  '】',
  '〉',
  '》',
  '!',
  '!',
  '?',
  '?',
  'ー',
  'っ',
  'ゃ',
  'ゅ',
  'ょ',
  'ぁ',
  'ぃ',
  'ぅ',
  'ぇ',
  'ぉ',
  'ゎ',
  '々',
  '〜',
  '…'
])

/** 行末に置いてはいけない文字(行末禁則)。 */
const FORBIDDEN_AT_LINE_END = new Set(['「', '『', '（', '(', '【', '〈', '《'])

/**
 * 字幕を指定文字数で折り返す。明示的な改行は尊重する。
 * 禁則処理を行うのは、折り返し位置によって行頭に句点だけが残る見栄えを避けるため。
 */
export function wrapSubtitle(text: string, maxCharsPerLine: number): string[] {
  if (maxCharsPerLine <= 0) return [text]

  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    if (paragraph === '') {
      lines.push('')
      continue
    }
    lines.push(...wrapParagraph([...paragraph], maxCharsPerLine))
  }
  return lines
}

function wrapParagraph(characters: string[], maxCharsPerLine: number): string[] {
  const lines: string[] = []
  let current: string[] = []

  for (const character of characters) {
    current.push(character)
    if (current.length < maxCharsPerLine) continue

    let breakAt = current.length
    // 次の文字が行頭禁則なら、この行に入れてから折り返したいので判断を1文字遅らせる。
    // ここでは先読みせず、行末禁則の文字が末尾に来た場合だけ1文字戻す。
    while (breakAt > 1 && FORBIDDEN_AT_LINE_END.has(current[breakAt - 1]!)) {
      breakAt -= 1
    }
    lines.push(current.slice(0, breakAt).join(''))
    current = current.slice(breakAt)
  }

  if (current.length > 0) {
    lines.push(current.join(''))
  }

  return mergeOrphanLastLine(lines)
}

/**
 * 最後の行が1文字だけ、または行頭禁則の文字だけなら前の行に付ける。
 * 字幕で1文字だけの行が下に垂れるのは目立って読みにくいため、
 * 指定文字数をわずかに超えることを許して見栄えを取る。
 */
function mergeOrphanLastLine(lines: string[]): string[] {
  if (lines.length < 2) return lines
  const last = lines[lines.length - 1]!
  const previous = lines[lines.length - 2]!
  const characters = [...last]
  const isOrphan =
    characters.length === 1 || characters.every((char) => FORBIDDEN_AT_LINE_START.has(char))
  if (!isOrphan) return lines
  return [...lines.slice(0, -2), previous + last]
}
