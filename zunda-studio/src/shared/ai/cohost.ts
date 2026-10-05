import { z } from 'zod'

import { formatMs } from '../lib/time'
import { voiceItemsInOrder } from '../project/queries'
import type { BanterRole, Character, CharacterId, ItemId, Project, VoiceItem } from '../project/types'
import { briefingPromptSection } from './briefing'
import type { ChatTurn, GenerateRequest } from './types'

/**
 * 相方(AIが演じるキャラクター)の返答を作るための依頼文と、返ってきた内容の検証。
 * 仕様は docs/AI_EDIT_PROTOCOL.md 2章。
 */

export interface CohostRequest {
  /** このセリフの後に続ける。null なら台本の最後。 */
  afterItemId: ItemId | null
  /** 何人分の候補を作るか(B-7)。 */
  candidates: number
  /** 何往復ぶん続けるか(B-8)。1 なら相方の返答1行だけ。2以上なら両者のセリフを交互に作る。 */
  rounds: number
  /** 書かせるキャラクター。省略すると AI の役のキャラクター。自分の役を指定すると提案になる(B-10)。 */
  characterId?: CharacterId
  /** その場の指示(「もっと辛口で」など)。 */
  instruction?: string
  /**
   * 1つのセリフの長さの目安(文字数)。セリフを作るたびに返答作成の欄で決める。
   * 省略すると、演じるキャラクターの人物像に残っている値(以前のプロジェクト)を使い、それも無ければ目安を伝えない。
   */
  targetLengthChars?: number
  /** ゲーム画面を見せる。frame: その時刻の1コマ / frames: 選んだ複数の時刻のコマ / clip: 区間を数コマに分けて見せる。 */
  vision?: CohostVision
}

export type CohostVision = (
  | { kind: 'frame'; atMs: number }
  | { kind: 'frames'; times: number[] }
  | { kind: 'clip'; startMs: number; endMs: number }
) &
  VisionOptions

/** 見せる画像の画質。standard: 横 768px(場面の様子が分かる) / high: 長辺 1568px(細かい文字・数字も読める。利用枠を約4倍使う)。 */
export type VisionQuality = 'standard' | 'high'

/** 録画のうち見せる範囲。録画の幅・高さに対する割合(0〜1)。無ければ画面全体。 */
export interface VisionRegion {
  x: number
  y: number
  width: number
  height: number
}

export interface VisionOptions {
  quality?: VisionQuality
  region?: VisionRegion
}

/** 画質ごとの画像の長辺の上限(px)。元の録画より大きくはしない。 */
export const VISION_MAX_EDGE: Record<VisionQuality, number> = { standard: 768, high: 1568 }

/** 範囲を 0〜1 に収め、小さすぎる範囲は広げる(最小 5%)。 */
export function clampRegion(region: VisionRegion): VisionRegion {
  const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, Number.isFinite(value) ? value : min))
  const width = clamp(region.width, 0.05, 1)
  const height = clamp(region.height, 0.05, 1)
  return { x: clamp(region.x, 0, 1 - width), y: clamp(region.y, 0, 1 - height), width, height }
}

/** 画面全体を指しているか(ほぼ全体なら切り出さない)。 */
export function isWholeFrame(region: VisionRegion | undefined): boolean {
  return !region || (region.width >= 0.995 && region.height >= 0.995)
}

/** 範囲を人が読める形にする(例: 「左から50%・上から0%の、幅50%×高さ100%」)。 */
export function describeRegion(region: VisionRegion): string {
  const percent = (value: number): string => `${Math.round(value * 100)}%`
  return `左から${percent(region.x)}・上から${percent(region.y)}の、幅${percent(region.width)}×高さ${percent(region.height)}`
}

/** 区間の映像は、何コマに分けて見せるか(長いほど多く、上限あり)。 */
export const MAX_CLIP_FRAMES = 8
export const MAX_CLIP_MS = 60_000

/** 見せる時刻の一覧。区間は両端を含めて等間隔に分ける。 */
export function visionTimes(vision: CohostVision): number[] {
  if (vision.kind === 'frame') return [Math.max(0, Math.round(vision.atMs))]
  // 選んだ時刻は、重なりを除いて時間順に並べ、上限までにする。
  if (vision.kind === 'frames') return frameList(vision.times)
  const start = Math.max(0, Math.min(vision.startMs, vision.endMs))
  const end = Math.max(start, Math.min(Math.max(vision.startMs, vision.endMs), start + MAX_CLIP_MS))
  const count = Math.min(MAX_CLIP_FRAMES, Math.max(2, 2 + Math.floor((end - start) / 2000)))
  if (end - start < 100) return [Math.round(start)]
  return Array.from({ length: count }, (_, index) => Math.round(start + ((end - start) * index) / (count - 1)))
}

/** 選んだ時刻の一覧を整える(負の値・重なりを除き、時間順、上限 MAX_CLIP_FRAMES)。 */
export function frameList(times: readonly number[]): number[] {
  return [...new Set(times.map((time) => Math.max(0, Math.round(time))))].sort((a, b) => a - b).slice(0, MAX_CLIP_FRAMES)
}

/** 画像に添える説明(依頼文の最後に足す)。 */
export function visionNote(vision: CohostVision, shownTimes: number[]): string {
  if (shownTimes.length === 0) return ''
  const main = visionMainNote(vision, shownTimes)
  if (isWholeFrame(vision.region)) return main
  return `${main}\n画像はゲーム画面全体ではなく、一部(${describeRegion(clampRegion(vision.region!))})を切り出して大きく見せたものです。細かい文字や数字も読み取って、正確に触れてください。読み取れないものは推測で言わないでください。`
}

function visionMainNote(vision: CohostVision, shownTimes: number[]): string {
  if (vision.kind === 'frame' || (vision.kind === 'frames' && shownTimes.length === 1)) {
    return `## 画面
添付の画像は、動画の ${formatMs(shownTimes[0]!)} のゲーム画面です。画面で起きていることも踏まえて返答してください(画面の説明をそのまま読み上げるのではなく、実況の会話として自然に触れる)。`
  }
  if (vision.kind === 'frames') {
    return `## 画面(選んだ場面)
添付の ${shownTimes.length} 枚の画像は、動画の ${shownTimes.map((time) => formatMs(time)).join('、')} のゲーム画面です(時間順。間は飛んでいます)。それぞれの場面で起きていることも踏まえて返答してください(画面の説明をそのまま読み上げるのではなく、実況の会話として自然に触れる)。`
  }
  return `## 画面(区間の映像)
添付の ${shownTimes.length} 枚の画像は、動画の ${formatMs(shownTimes[0]!)}〜${formatMs(shownTimes.at(-1)!)} の映像を時間順にコマで分けたものです。この間に画面で起きた出来事(動き・変化)も踏まえて返答してください。`
}

export interface CohostLine {
  characterId: CharacterId
  text: string
  expressionId: string | null
}

export interface CohostCandidate {
  lines: CohostLine[]
  /** 目安の長さを大きく超える、使わせない表現を含む、など。 */
  warnings: string[]
}

/** 直近の何行を原文のまま渡すか。掛け合いのテンポは直前の流れに強く依存するため、ここは削らない。 */
export const RECENT_LINES = 40
/** それより前は話者と冒頭だけを縮めて渡す。 */
const OLDER_LINE_CHARS = 24
const OLDER_LINES_MAX = 120

const BANTER_ROLE_TEXT: Record<BanterRole, string> = {
  tsukkomi: 'ツッコミ役。相手のボケや言い間違いに的確にツッコむ',
  boke: 'ボケ役。とぼけた発言や勘違いで笑いを取る',
  navigator: '進行役・解説役。状況を整理し、視聴者に分かるよう補足する',
  free: '自由な立ち位置'
}

export const cohostResponseSchema = z.object({
  candidates: z
    .array(
      z.object({
        lines: z
          .array(
            z.object({
              speaker: z.string().min(1).describe('話すキャラクターの名前'),
              text: z.string().min(1).max(400).describe('セリフ。改行や話者名は含めない'),
              expression: z.string().nullable().describe('表情の名前。合うものが無ければ null')
            })
          )
          .min(1)
          .max(12)
      })
    )
    .min(1)
    .max(5)
})

export type CohostResponse = z.infer<typeof cohostResponseSchema>

function aiCharacter(project: Project, request: CohostRequest): Character {
  const chosen = request.characterId ? project.characters[request.characterId] : undefined
  const character = chosen ?? Object.values(project.characters).find((candidate) => candidate.authorRole === 'ai')
  if (!character) throw new Error('相方(AIの役)のキャラクターがいません')
  return character
}

/** この位置までの会話(発話順)。 */
export function conversationUntil(project: Project, afterItemId: ItemId | null): VoiceItem[] {
  const lines = voiceItemsInOrder(project)
  if (afterItemId === null) return lines
  const index = lines.findIndex((line) => line.id === afterItemId)
  return index < 0 ? lines : lines.slice(0, index + 1)
}

function speakerName(project: Project, line: VoiceItem): string {
  return project.characters[line.characterId]?.name ?? '?'
}

function expressionNames(character: Character): string[] {
  return Object.values(character.portrait?.expressions ?? {}).map((expression) => expression.name)
}

/** 返答の長さの目安を、ボタンひとつで入れるための長さ別の候補(文字数)。 */
export const LENGTH_PRESETS: readonly { label: string; chars: number }[] = [
  { label: '一言', chars: 15 },
  { label: '短め', chars: 25 },
  { label: 'ふつう', chars: 40 },
  { label: '長め', chars: 70 },
  { label: '長文', chars: 120 }
]

/** 返答の長さの目安として入れられる文字数の範囲。 */
export const LENGTH_RANGE = { min: 5, max: 300 } as const

/** セリフの長さの目安(文字数)。返答ごとの指定を優先し、無ければ人物像に残っている値。 */
export function targetLength(request: Pick<CohostRequest, 'targetLengthChars'>, character: Character | undefined): number | null {
  return request.targetLengthChars ?? character?.persona?.targetLengthChars ?? null
}

export function describePersona(character: Character, targetLengthChars: number | null): string {
  const persona = character.persona
  if (!persona) return `${character.name}(性格の設定なし。自然な話し方で)`
  return [
    `名前: ${character.name}`,
    persona.personality ? `性格: ${persona.personality}` : null,
    persona.speechStyle ? `口調: ${persona.speechStyle}` : null,
    `掛け合いでの立ち位置: ${BANTER_ROLE_TEXT[persona.banterRole]}`,
    targetLengthChars !== null ? `1回のセリフの長さの目安: ${targetLengthChars}文字前後` : null,
    persona.forbidden.length > 0 ? `使ってはいけない表現: ${persona.forbidden.join(' / ')}` : null
  ]
    .filter(Boolean)
    .join('\n')
}

/** 返答を依頼する文を作る。 */
export function buildCohostPrompt(project: Project, request: CohostRequest): Omit<GenerateRequest, 'jsonSchema'> {
  const actor = aiCharacter(project, request)
  const conversation = conversationUntil(project, request.afterItemId)
  const others = Object.values(project.characters).filter((character) => character.id !== actor.id)
  const rounds = Math.max(1, Math.min(6, request.rounds))
  const candidates = Math.max(1, Math.min(5, request.candidates))
  const suggestingForUser = actor.authorRole === 'user'
  const target = targetLength(request, actor)

  const expressionHelp = [actor, ...(rounds > 1 ? others : [])]
    .map((character) => {
      const names = expressionNames(character)
      return names.length > 0 ? `${character.name}の表情: ${names.join(' / ')}` : null
    })
    .filter(Boolean)

  const system = [
    'あなたはYouTubeのゲーム実況動画(ゆっくり実況・VOICEVOX実況の形式)で、掛け合いのセリフを書く役目です。',
    suggestingForUser
      ? `今回は投稿者本人が演じる「${actor.name}」のセリフの案を出します。投稿者が選んで直す前提の下書きです。`
      : `あなたは相方の「${actor.name}」を演じます。人物像を最後まで崩さないでください。`,
    '',
    '## 演じる人物',
    describePersona(actor, target),
    others.length > 0 ? `\n## 掛け合いの相手\n${others.map((other) => `${other.name}${other.authorRole === 'user' ? '(投稿者本人が演じる)' : ''}`).join('\n')}` : '',
    project.meta.synopsis?.trim() ? `\n## 動画の企画メモ\n${project.meta.synopsis.trim()}` : '',
    `\n${briefingPromptSection(project)}`,
    '',
    '## 守ること',
    '- セリフは字幕と合成音声でそのまま使われる。話者名・かっこ・ト書き・絵文字・改行を入れない',
    '- 直前の流れを受けて、自然に会話を続ける。前のセリフを繰り返さない',
    rounds === 1
      ? `- ${actor.name}のセリフを1つだけ書く`
      : `- ${actor.name}と相手が交互に話す形で、合計${rounds}個のセリフを書く。最初は${actor.name}`,
    // 人物像に長さの目安が無い役(自分の案など)にも、返答ごとに決めた長さは伝える
    ...(target !== null && !actor.persona ? [`- 1つのセリフは${target}文字前後にする`] : []),
    `- 案を${candidates}通り出す。案ごとに違う切り口にする`,
    expressionHelp.length > 0 ? `- 各セリフに合う表情を次の中から選ぶ(合うものが無ければ null)\n  ${expressionHelp.join('\n  ')}` : '- 表情は null にする',
    '- 出力は指定のJSONだけ'
  ]
    .filter((line) => line !== '')
    .join('\n')

  const older = conversation.slice(0, Math.max(0, conversation.length - RECENT_LINES)).slice(-OLDER_LINES_MAX)
  const recent = conversation.slice(-RECENT_LINES)
  const transcript = [
    older.length > 0 ? `(これより前の流れ。冒頭だけ)\n${older.map((line) => `${speakerName(project, line)}: ${truncate(line.text, OLDER_LINE_CHARS)}`).join('\n')}\n` : '',
    recent.length > 0
      ? `## ここまでの会話\n${recent.map((line) => `[${formatMs(line.startMs)}] ${speakerName(project, line)}: ${line.text}`).join('\n')}`
      : '## ここまでの会話\n(まだ何も話していない。動画の冒頭のセリフを書く)'
  ]
    .filter(Boolean)
    .join('\n')

  const instruction = request.instruction?.trim()
  const turns: ChatTurn[] = [
    {
      role: 'user',
      content: [transcript, '', instruction ? `## 今回の指示\n${instruction}` : '', `${actor.name}の次のセリフを書いてください。`]
        .filter((line) => line !== '')
        .join('\n')
    }
  ]
  return { system, turns }
}

function truncate(text: string, length: number): string {
  return text.length > length ? `${text.slice(0, length)}…` : text
}

/** 返ってきた内容を、キャラクターIDと表情IDに解決する。名前が合わなければ交互の順で割り当てる。 */
export function interpretCohostResponse(project: Project, request: CohostRequest, response: CohostResponse): CohostCandidate[] {
  const actor = aiCharacter(project, request)
  const conversation = conversationUntil(project, request.afterItemId)
  const previousSpeaker = conversation.at(-1)?.characterId
  const partner =
    (previousSpeaker && previousSpeaker !== actor.id ? project.characters[previousSpeaker] : undefined) ??
    Object.values(project.characters).find((character) => character.id !== actor.id)
  const byName = new Map(Object.values(project.characters).map((character) => [character.name, character]))

  return response.candidates.map((candidate) => {
    const warnings: string[] = []
    const lines = candidate.lines.map((line, index): CohostLine => {
      const alternate = index % 2 === 0 ? actor : (partner ?? actor)
      const character = request.rounds > 1 ? (byName.get(line.speaker.trim()) ?? alternate) : actor
      const expression = Object.values(character.portrait?.expressions ?? {}).find(
        (candidateExpression) => candidateExpression.name === line.expression || candidateExpression.id === line.expression
      )
      const text = cleanLine(line.text, character.name)
      const persona = character.persona
      if (persona) {
        const hit = persona.forbidden.filter((word) => word !== '' && text.includes(word))
        if (hit.length > 0) warnings.push(`使わせない表現を含んでいます: ${hit.join('、')}`)
      }
      const target = targetLength(request, character)
      if (target !== null && text.length > target * 2.5) warnings.push(`${character.name}のセリフが目安(${target}文字)よりかなり長いです`)
      return { characterId: character.id, text, expressionId: expression?.id ?? null }
    })
    return { lines: lines.slice(0, request.rounds > 1 ? request.rounds : 1), warnings }
  })
}

/** 「名前: セリフ」「「セリフ」」のような余計な飾りを外す。 */
export function cleanLine(text: string, name: string): string {
  let result = text.replace(/\s*\n\s*/g, '').trim()
  for (const prefix of [`${name}:`, `${name}:`, `${name}「`]) {
    if (result.startsWith(prefix)) result = result.slice(prefix.length).trim()
  }
  if (/^「.*」$/.test(result)) result = result.slice(1, -1)
  if (result.endsWith('」') && !result.includes('「')) result = result.slice(0, -1)
  return result.trim()
}
