/**
 * AIの出力から JSON を取り出す。
 * モデルによっては指示してもコードブロックで囲んだり前置きを付けたりするため、
 * 最初の完結した JSON オブジェクト(または配列)を括弧の対応で探す。
 */
export function extractJson(text: string): unknown {
  const trimmed = text.trim()
  const direct = tryParse(trimmed)
  if (direct.ok) return direct.value

  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed)
  if (fenced?.[1]) {
    const inner = tryParse(fenced[1].trim())
    if (inner.ok) return inner.value
  }

  for (let start = 0; start < trimmed.length; start++) {
    const char = trimmed[start]
    if (char !== '{' && char !== '[') continue
    const end = findMatchingBracket(trimmed, start)
    if (end < 0) continue
    const candidate = tryParse(trimmed.slice(start, end + 1))
    if (candidate.ok) return candidate.value
  }
  throw new Error('応答にJSONが含まれていません')
}

function tryParse(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch {
    return { ok: false }
  }
}

function findMatchingBracket(text: string, start: number): number {
  const open = text[start]
  const close = open === '{' ? '}' : ']'
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < text.length; index++) {
    const char = text[index]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === open) depth++
    else if (char === close) {
      depth--
      if (depth === 0) return index
    }
  }
  return -1
}
