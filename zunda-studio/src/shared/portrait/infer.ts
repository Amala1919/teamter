import type {
  AssetId,
  BlinkConfig,
  Expression,
  LipSyncConfig,
  PartId,
  PartRole,
  PortraitConfig,
  PortraitPart,
  PortraitPartGroup,
  Vowel
} from '../project/types'
import { walkLayers, type PsdLayerNode, type PsdManifest } from '../psd/types'

/**
 * PSD のレイヤー名から、目・口・眉などのパーツと、まばたき・口パクの設定を推定する。
 * 命名は素材ごとにばらつくので、これはあくまで初期値であり、最終的には利用者が素材マネージャーで確かめて直す
 * (REQUIREMENTS.md P-2)。PSDToolKit の「!」「*」接頭辞があれば排他選択のヒントとして使う。
 */

export function cleanLayerName(name: string): string {
  return name.replace(/#\d+$/, '').replace(/^[!*:]+/, '').trim()
}

const ROLE_PATTERNS: [PartRole, RegExp][] = [
  ['eyebrow', /眉|まゆ|brow/i],
  ['eye', /目|眼|め$|^め|eye/i],
  ['mouth', /口|くち|mouth|lip/i],
  ['body', /体|からだ|身体|body|服|胴/i]
]

export function roleForName(name: string): PartRole {
  const cleaned = cleanLayerName(name)
  for (const [role, pattern] of ROLE_PATTERNS) {
    if (pattern.test(cleaned)) return role
  }
  return 'other'
}

const EYE_CLOSED = /閉|とじ|つぶ|瞑|close|shut|[＝=]|[ー－―]/i
/** 笑い目は閉じた目の代わりに使えるが、まばたきには本物の閉じた目の方が自然なので後回しにする。 */
const EYE_SMILE = /にっこり|笑|smile/i
const EYE_HALF = /半|はん|half|細|ジト/i
const EYE_OPEN = /開|あけ|open|通常|基本|普通|ふつう|normal|default/i

const MOUTH_VOWELS: [Vowel, RegExp][] = [
  ['a', /^(あ|ア|a)$|[^ん]あ$/i],
  ['i', /^(い|イ|i)$/i],
  ['u', /^(う|ウ|u)$/i],
  ['e', /^(え|エ|e)$/i],
  ['o', /^(お|オ|o)$/i],
  ['N', /^(ん|ン|n)$/i]
]
const MOUTH_CLOSED = /閉|とじ|close|むっ|む$|^ん$|ン|n$|へ/i
const MOUTH_HALF = /半|小|中|half|small|mid/i
const MOUTH_OPEN = /開|大|open|large|big|^ほあ|あー/i

interface Classified {
  open?: PartId
  half?: PartId
  closed?: PartId
}

function classifyEye(parts: PortraitPart[]): Classified {
  const result: Classified = {}
  let smile: PartId | undefined
  for (const part of parts) {
    const name = cleanLayerName(part.name)
    if (!result.closed && EYE_CLOSED.test(name) && !EYE_OPEN.test(name)) result.closed = part.id
    else if (!result.half && EYE_HALF.test(name)) result.half = part.id
    else if (!result.open && EYE_OPEN.test(name)) result.open = part.id
    else if (!smile && EYE_SMILE.test(name)) smile = part.id
  }
  if (!result.closed && smile) result.closed = smile
  return result
}

function classifyMouth(parts: PortraitPart[]): { vowels: Partial<Record<Vowel, PartId>>; levels: Classified } {
  const vowels: Partial<Record<Vowel, PartId>> = {}
  const levels: Classified = {}
  for (const part of parts) {
    const name = cleanLayerName(part.name)
    for (const [vowel, pattern] of MOUTH_VOWELS) {
      if (!vowels[vowel] && pattern.test(name)) vowels[vowel] = part.id
    }
    if (!levels.closed && MOUTH_CLOSED.test(name)) levels.closed = part.id
    else if (!levels.half && MOUTH_HALF.test(name)) levels.half = part.id
    else if (!levels.open && MOUTH_OPEN.test(name)) levels.open = part.id
  }
  return { vowels, levels }
}

function isExclusive(group: PsdLayerNode, role: PartRole): boolean {
  if (group.name.startsWith('!')) return true
  if (group.children.length > 0 && group.children.every((child) => child.name.startsWith('*'))) return true
  return role === 'eye' || role === 'mouth' || role === 'eyebrow'
}

export interface InferredPortrait {
  config: PortraitConfig
  /** 自動で決められなかったこと。素材マネージャーで確認を促すために表示する。 */
  notes: string[]
}

export function inferPortraitConfig(
  manifest: PsdManifest,
  assetId: AssetId,
  canvas: { width: number; height: number },
  slot: number
): InferredPortrait {
  const partGroups: Record<string, PortraitPartGroup> = {}
  const notes: string[] = []
  let groupCounter = 0
  let partCounter = 0

  walkLayers(manifest.layers, (node) => {
    if (node.kind !== 'group' || node.children.length < 2) return
    const role = roleForName(node.name)
    const exclusive = isExclusive(node, role)
    if (role === 'other' && !exclusive) return
    const items = node.children.map<PortraitPart>((child) => ({
      id: `prt_${++partCounter}`,
      name: cleanLayerName(child.name),
      layerPath: child.path
    }))
    const id = `grp_${++groupCounter}`
    partGroups[id] = { id, role, layerPath: node.path, selection: exclusive ? 'exclusive' : 'multiple', items }
  })

  const groups = Object.values(partGroups)
  const expressionSelections: Record<string, PartId> = {}
  for (const group of groups) {
    if (group.selection !== 'exclusive' || group.role === 'mouth') continue
    const node = manifest.layers.length === 0 ? null : findVisibleChild(manifest, group)
    const chosen = group.items.find((item) => item.layerPath.join('/') === node?.key) ?? group.items[0]
    if (chosen) expressionSelections[group.id] = chosen.id
  }

  let blink: BlinkConfig | null = null
  for (const group of groups.filter((candidate) => candidate.role === 'eye')) {
    const eye = classifyEye(group.items)
    if (eye.open && eye.closed) {
      group.blinkSequence = [eye.open, ...(eye.half ? [eye.half] : []), eye.closed]
      blink = { partGroupId: group.id, intervalMs: 4000, jitterMs: 1500, closeDurationMs: 150 }
      // 通常の表情では開いた目を選んでおく(まばたきは開いた目のときだけ動く)。
      expressionSelections[group.id] = eye.open
      break
    }
  }
  if (!blink) notes.push('まばたきに使う「開いた目」と「閉じた目」を見つけられませんでした')

  let lipSync: LipSyncConfig | null = null
  for (const group of groups.filter((candidate) => candidate.role === 'mouth')) {
    const { vowels, levels } = classifyMouth(group.items)
    const vowelCount = (['a', 'i', 'u', 'e', 'o'] as const).filter((vowel) => vowels[vowel]).length
    if (vowelCount >= 3) {
      const closed = vowels.N ?? levels.closed ?? vowels.u ?? group.items[0]!.id
      group.vowelMap = {
        a: vowels.a ?? vowels.o ?? vowels.e ?? closed,
        i: vowels.i ?? vowels.e ?? vowels.a ?? closed,
        u: vowels.u ?? vowels.o ?? closed,
        e: vowels.e ?? vowels.i ?? vowels.a ?? closed,
        o: vowels.o ?? vowels.a ?? vowels.u ?? closed,
        N: closed,
        cl: closed,
        pau: closed
      }
      lipSync = { mode: 'vowel', partGroupId: group.id }
      break
    }
    if (levels.closed && (levels.open ?? levels.half)) {
      group.openSequence = [levels.closed, ...(levels.half ? [levels.half] : []), ...(levels.open ? [levels.open] : [])]
      lipSync = { mode: 'amplitude', partGroupId: group.id }
      break
    }
  }
  if (!lipSync) notes.push('口パクに使う口のパーツ(あいうえお、または閉じた口と開いた口)を見つけられませんでした')

  const expression: Expression = { id: 'exp_normal', name: '通常', selections: expressionSelections }
  const scale = Math.min(1, (canvas.height * 0.9) / Math.max(1, manifest.height))
  const xRatio = slot === 0 ? 0.82 : slot === 1 ? 0.18 : 0.5

  return {
    config: {
      assetId,
      transform: {
        x: Math.round(canvas.width * xRatio),
        y: canvas.height,
        scale: Math.round(scale * 1000) / 1000,
        flipX: false,
        anchor: 'bottom-center'
      },
      partGroups,
      layerVisibility: {},
      expressions: { [expression.id]: expression },
      defaultExpressionId: expression.id,
      lipSync,
      blink
    },
    notes
  }
}

function findVisibleChild(manifest: PsdManifest, group: PortraitPartGroup): PsdLayerNode | null {
  let groupNode: PsdLayerNode | null = null
  walkLayers(manifest.layers, (node) => {
    if (!groupNode && node.path.join('/') === group.layerPath.join('/')) groupNode = node
  })
  const children: PsdLayerNode[] = (groupNode as PsdLayerNode | null)?.children ?? []
  // PSD では上のレイヤーほど手前に見えるので、見えている子のうち一番上を初期値にする。
  return [...children].reverse().find((child) => !child.hidden) ?? null
}
