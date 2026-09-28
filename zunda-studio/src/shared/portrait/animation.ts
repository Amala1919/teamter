import type {
  BlinkConfig,
  Character,
  Ms,
  PartGroupId,
  PartId,
  PortraitConfig,
  PortraitPartGroup,
  Project,
  VoiceItem,
  Vowel
} from '../project/types'
import { vowelAt } from '../voice/timing'

/**
 * 立ち絵の、ある時刻における各パーツの選択を求める。
 * 乱数(まばたきの間隔)は renderSeed とキャラクターIDから決定論的に作るので、
 * プレビューと書き出しで同じ瞬間にまばたきする。
 */

export function hashString(text: string): number {
  let hash = 2166136261
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

export function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

const scheduleCache = new Map<string, { starts: number[]; next: () => number }>()
const SCHEDULE_CACHE_LIMIT = 64

/** まばたきの開始時刻の列を、必要な時刻まで伸ばしながら返す。 */
function blinkStarts(seed: number, characterId: string, blink: BlinkConfig, untilMs: Ms): number[] {
  const key = `${seed}:${characterId}:${blink.intervalMs}:${blink.jitterMs}`
  let entry = scheduleCache.get(key)
  if (!entry) {
    const random = mulberry32(hashString(key))
    let cursor = 0
    const first = blink.intervalMs * (0.3 + random() * 0.4)
    const next = (): number => {
      cursor = cursor === 0 ? first : cursor + Math.max(blink.closeDurationMs * 2, blink.intervalMs + blink.jitterMs * (random() * 2 - 1))
      return cursor
    }
    entry = { starts: [], next }
    if (scheduleCache.size >= SCHEDULE_CACHE_LIMIT) scheduleCache.delete(scheduleCache.keys().next().value!)
    scheduleCache.set(key, entry)
  }
  while ((entry.starts.at(-1) ?? -1) <= untilMs) entry.starts.push(entry.next())
  return entry.starts
}

/**
 * まばたき中なら、その瞬間の目のパーツを返す(まばたきしていなければ null)。
 * (半目→)閉(→半目)の順に closeDurationMs で1往復する。
 */
export function blinkPartAt(
  seed: number,
  characterId: string,
  blink: BlinkConfig,
  sequence: readonly PartId[],
  timeMs: Ms
): PartId | null {
  if (sequence.length < 2 || timeMs < 0) return null
  const starts = blinkStarts(seed, characterId, blink, timeMs)
  // 二分探索で timeMs 以前の最後の開始時刻を探す。
  let low = 0
  let high = starts.length - 1
  let found = -1
  while (low <= high) {
    const middle = (low + high) >> 1
    if (starts[middle]! <= timeMs) {
      found = middle
      low = middle + 1
    } else {
      high = middle - 1
    }
  }
  if (found < 0) return null
  const elapsed = timeMs - starts[found]!
  if (elapsed >= blink.closeDurationMs) return null
  // 開いた目は「まばたきしていない状態」と同じなので段に含めない。3段なら 半目 → 閉 → 半目。
  const last = sequence.length - 1
  const steps = last * 2 - 1
  const step = Math.min(steps - 1, Math.floor((elapsed / blink.closeDurationMs) * steps))
  const position = step < last ? step + 1 : 2 * last - (step + 1)
  return sequence[position] ?? null
}

const OPENNESS: Record<Vowel, number> = { a: 2, o: 2, e: 2, i: 1, u: 1, N: 0, cl: 0, pau: 0 }

export function mouthPartFor(group: PortraitPartGroup, mode: 'vowel' | 'amplitude', vowel: Vowel): PartId | null {
  if (mode === 'vowel') return group.vowelMap?.[vowel] ?? group.vowelMap?.pau ?? null
  const sequence = group.openSequence ?? []
  if (sequence.length === 0) return null
  const level = OPENNESS[vowel]
  if (level === 0) return sequence[0]!
  // 段階が2つ(閉・開)しかなければ、少し開く母音も開いた口にする。
  const index = sequence.length === 2 ? 1 : Math.min(sequence.length - 1, level)
  return sequence[index]!
}

/** このキャラクターが今しゃべっているセリフ。 */
export function speakingLine(project: Project, characterId: string, timeMs: Ms): VoiceItem | null {
  for (const item of project.items) {
    if (item.type !== 'voice' || item.characterId !== characterId) continue
    if (item.startMs <= timeMs && timeMs < item.startMs + item.durationMs) return item
  }
  return null
}

/**
 * 表情 → まばたき → 口パク の順に重ねて、各パーツグループで選ぶパーツを決める。
 * まばたきは、選ばれている目が「開いた目」のときだけ動かす(笑い目などの特別な目を上書きしないため)。
 */
export function portraitSelections(
  project: Project,
  character: Character,
  portrait: PortraitConfig,
  timeMs: Ms,
  /** 場面ごとの立ち絵で決めた表情。あればセリフの表情より優先する。 */
  expressionOverride?: string
): Record<PartGroupId, PartId> {
  const line = speakingLine(project, character.id, timeMs)
  const expressionId = expressionOverride ?? line?.expressionId ?? portrait.defaultExpressionId
  const expression = expressionId ? portrait.expressions[expressionId] : undefined
  const selections: Record<PartGroupId, PartId> = { ...(expression?.selections ?? {}) }

  const blink = portrait.blink
  const eyeGroup = blink ? portrait.partGroups[blink.partGroupId] : undefined
  if (blink && eyeGroup?.blinkSequence && eyeGroup.blinkSequence.length >= 2) {
    const current = selections[eyeGroup.id] ?? eyeGroup.blinkSequence[0]
    if (current === eyeGroup.blinkSequence[0]) {
      const blinking = blinkPartAt(project.meta.renderSeed, character.id, blink, eyeGroup.blinkSequence, timeMs)
      if (blinking) selections[eyeGroup.id] = blinking
    }
  }

  const lipSync = portrait.lipSync
  const mouthGroup = lipSync ? portrait.partGroups[lipSync.partGroupId] : undefined
  if (lipSync && mouthGroup) {
    const vowel: Vowel =
      line?.synthesis && line.synthesis.lipSync.length > 0 ? vowelAt(line.synthesis.lipSync, timeMs - line.startMs) : 'pau'
    const mouth = mouthPartFor(mouthGroup, lipSync.mode, vowel)
    if (mouth) selections[mouthGroup.id] = mouth
  }
  return selections
}
