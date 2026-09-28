import { projectDurationMs, voiceItemsInOrder } from './queries'
import type { Item, Project, VoiceItem } from './types'

/**
 * 適用前に見せる差分(AI_EDIT_PROTOCOL.md 7章)。コマンド列ではなく、適用前後のプロジェクトを比べて作る。
 * どのコマンドでも同じ見せ方になり、コマンドの種類が増えてもここを直さずに済む。
 */

export interface ScriptChange {
  kind: 'added' | 'removed' | 'changed'
  /** 変更後(削除なら変更前)の発話順の番号(1始まり)。 */
  index: number
  speaker: string
  before: string | null
  after: string | null
  /** 話者や表情など、文字以外の変更。 */
  notes: string[]
}

export interface ProjectDiff {
  script: ScriptChange[]
  /** セリフ以外の変更の要約(「動画を1件追加」など)。 */
  others: string[]
  durationBeforeMs: number
  durationAfterMs: number
  /** 何も変わらないか。 */
  empty: boolean
}

const TYPE_LABELS: Record<Item['type'], string> = {
  voice: 'セリフ',
  video: '動画',
  image: '画像',
  text: 'テロップ',
  audio: '音声',
  shape: '図形',
  portrait: '立ち絵',
  zoom: 'ズーム'
}

function speakerOf(project: Project, line: VoiceItem): string {
  return project.characters[line.characterId]?.name ?? '?'
}

function describeItemChange(before: Item, after: Item): string[] {
  const changes: string[] = []
  if (before.startMs !== after.startMs || before.durationMs !== after.durationMs) changes.push('区間')
  if (before.layerId !== after.layerId) changes.push('レイヤー')
  if (JSON.stringify(before.effects) !== JSON.stringify(after.effects)) changes.push('エフェクト')
  if ('transform' in before && 'transform' in after && JSON.stringify(before.transform) !== JSON.stringify(after.transform)) changes.push('位置・大きさ')
  const rest = (item: Item): string =>
    JSON.stringify({ ...item, startMs: 0, durationMs: 0, layerId: '', effects: [], transform: null })
  if (rest(before) !== rest(after)) changes.push('設定')
  return changes
}

export function diffProjects(before: Project, after: Project): ProjectDiff {
  const beforeLines = voiceItemsInOrder(before)
  const afterLines = voiceItemsInOrder(after)
  const beforeById = new Map(beforeLines.map((line, index) => [line.id, { line, index }]))
  const afterIds = new Set(afterLines.map((line) => line.id))
  const script: ScriptChange[] = []

  afterLines.forEach((line, index) => {
    const previous = beforeById.get(line.id)
    if (!previous) {
      script.push({ kind: 'added', index: index + 1, speaker: speakerOf(after, line), before: null, after: line.text, notes: [] })
      return
    }
    const notes: string[] = []
    if (previous.line.characterId !== line.characterId) notes.push(`話者: ${speakerOf(before, previous.line)} → ${speakerOf(after, line)}`)
    if (previous.line.expressionId !== line.expressionId) notes.push('表情')
    if (JSON.stringify(previous.line.voiceOverride) !== JSON.stringify(line.voiceOverride)) notes.push('声の調整')
    if (JSON.stringify(previous.line.subtitleOverride) !== JSON.stringify(line.subtitleOverride) || previous.line.subtitleLines.join('\n') !== line.subtitleLines.join('\n')) {
      if (previous.line.text === line.text) notes.push('字幕の見た目・改行')
    }
    if (previous.index !== index) notes.push('順番')
    if (JSON.stringify(previous.line.effects) !== JSON.stringify(line.effects)) notes.push('エフェクト')
    if (previous.line.text !== line.text || notes.length > 0) {
      script.push({
        kind: 'changed',
        index: index + 1,
        speaker: speakerOf(after, line),
        before: previous.line.text,
        after: line.text,
        notes
      })
    }
  })
  beforeLines.forEach((line, index) => {
    if (!afterIds.has(line.id)) script.push({ kind: 'removed', index: index + 1, speaker: speakerOf(before, line), before: line.text, after: null, notes: [] })
  })

  const others: string[] = []
  const beforeItems = new Map(before.items.filter((item) => item.type !== 'voice').map((item) => [item.id, item]))
  const afterItems = new Map(after.items.filter((item) => item.type !== 'voice').map((item) => [item.id, item]))
  const count = new Map<string, number>()
  const bump = (key: string): void => {
    count.set(key, (count.get(key) ?? 0) + 1)
  }
  for (const [itemId, item] of afterItems) {
    const previous = beforeItems.get(itemId)
    if (!previous) bump(`${TYPE_LABELS[item.type]}を追加`)
    else {
      const changes = describeItemChange(previous, item)
      if (changes.length > 0) bump(`${TYPE_LABELS[item.type]}の${changes.join('・')}を変更`)
    }
  }
  for (const [itemId, item] of beforeItems) {
    if (!afterItems.has(itemId)) bump(`${TYPE_LABELS[item.type]}を削除`)
  }
  for (const [label, total] of count) others.push(`${label}(${total}件)`)
  if (JSON.stringify(before.layers) !== JSON.stringify(after.layers)) others.push('レイヤーを変更')
  if (JSON.stringify(before.subtitleStyles) !== JSON.stringify(after.subtitleStyles)) others.push('字幕スタイルを変更')
  if (before.meta.title !== after.meta.title || before.meta.synopsis !== after.meta.synopsis) others.push('タイトル・企画メモを変更')
  if (JSON.stringify(before.editing) !== JSON.stringify(after.editing)) others.push('編集の設定を変更')
  if (JSON.stringify(before.ai.briefing ?? null) !== JSON.stringify(after.ai.briefing ?? null)) others.push('相方のスタンス・前提知識を変更')

  script.sort((a, b) => a.index - b.index)
  return {
    script,
    others,
    durationBeforeMs: projectDurationMs(before),
    durationAfterMs: projectDurationMs(after),
    empty: script.length === 0 && others.length === 0
  }
}
