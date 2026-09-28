import { z } from 'zod'

import type { Command } from '../commands/types'
import { formatDurationJa, formatMs } from '../lib/time'
import { itemEndMs, projectDurationMs, voiceItemsInOrder } from '../project/queries'
import type { Project } from '../project/types'
import { MAX_AI_COMMANDS } from './edit-commands'
import type { GenerateRequest } from './types'

/**
 * 立ち絵をまとめて調整させる(ほかの編集が終わった後に使う想定)。
 * セリフの内容と場面(ズーム・録画の区間)から、表情・出し入れ・位置・話し手の強調をコマンドの列で提案させ、
 * 編集チャットと同じく、差分を確かめてから1回で適用する。
 */

export interface PortraitRequest {
  /** 「驚く場面ははっきり」「ズーム中は隠して」などの追加の指示。 */
  instruction?: string
}

const id = z.string().min(1).max(100)
const ms = z.number().min(0).max(24 * 60 * 60 * 1000)
const tempId = z.string().min(1).max(40).optional()
const transform = z.object({
  x: z.number(),
  y: z.number(),
  scale: z.number().positive().max(20),
  flipX: z.boolean(),
  anchor: z.enum(['top-left', 'top-center', 'top-right', 'center', 'bottom-left', 'bottom-center', 'bottom-right'])
})
const kind = z.enum(['show', 'hide', 'adjust'])

/** 立ち絵の調整で出してよいコマンド。立ち絵以外(セリフの文・素材・尺)には触れさせない。 */
export const portraitCommandSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('voice.setExpression'), itemId: id, expressionId: id.nullable() }),
  z.object({
    op: z.literal('portrait.insert'),
    characterId: id,
    atMs: ms,
    durationMs: ms,
    kind: kind.optional(),
    transform: transform.nullable().optional(),
    expressionId: id.nullable().optional(),
    transition: z.enum(['none', 'fade', 'pop']).optional(),
    tempId
  }),
  z.object({ op: z.literal('portrait.update'), itemId: id, kind: kind.optional(), transform: transform.nullable().optional(), expressionId: id.nullable().optional() }),
  z.object({ op: z.literal('item.setTimeRange'), itemId: id, startMs: ms.optional(), durationMs: ms.optional() }),
  z.object({ op: z.literal('item.delete'), itemId: id }),
  z.object({ op: z.literal('project.setEditing'), portraitDim: z.number().min(0).max(0.8).optional(), portraitHop: z.boolean().optional() })
])

export const portraitResponseSchema = z.object({
  reply: z.string().max(4000).describe('何をどう調整したかの短い説明'),
  commands: z.array(portraitCommandSchema).max(MAX_AI_COMMANDS)
})

export type PortraitResponse = z.infer<typeof portraitResponseSchema>

/**
 * 立ち絵以外のアイテムを動かす・消すコマンドは外す(スキーマでは ID の種類まで確かめられないため)。
 * 外した数を返し、返事に書き添える。
 */
export function filterPortraitCommands(project: Project, commands: readonly PortraitResponse['commands'][number][]): { commands: Command[]; dropped: number } {
  const tempIds = new Set(commands.flatMap((command) => (command.op === 'portrait.insert' && command.tempId ? [command.tempId] : [])))
  const isPortrait = (itemId: string): boolean => tempIds.has(itemId) || project.items.some((item) => item.id === itemId && item.type === 'portrait')
  const kept: Command[] = []
  let dropped = 0
  for (const command of commands) {
    if ((command.op === 'item.delete' || command.op === 'item.setTimeRange' || command.op === 'portrait.update') && !isPortrait(command.itemId)) {
      dropped++
      continue
    }
    kept.push(stripUndefined(command) as Command)
  }
  return { commands: kept, dropped }
}

function stripUndefined(value: object): object {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined))
}

export function buildPortraitPrompt(project: Project, request: PortraitRequest): Omit<GenerateRequest, 'jsonSchema'> {
  const { width, height } = project.canvas
  const system = [
    'あなたはゲーム実況動画(VOICEVOX の合成音声とキャラクターの立ち絵で作る、2人の掛け合いの動画)の編集者です。',
    '台本と場面を読んで、立ち絵(表情・出し入れ・位置)をまとめて調整する「コマンドの列」を作ります。投稿者が差分を確かめてから適用します。',
    '',
    '## 決まりごと',
    '- 出力は指定の JSON だけ。reply に何をどう調整したかを短く書き、commands にコマンドを並べる',
    '- セリフの表情は voice.setExpression で付ける。使える表情は各キャラクターの表情 ID だけ(新しい表情は作れない)',
    '- 表情はセリフの感情(驚き・怒り・喜び・困惑など)がはっきりしているところにだけ付け、普通の会話は既定の表情のままでよい',
    '- 場面ごとの立ち絵は portrait.insert で置く。kind は show(この区間だけ出す。1つでも置くとその区間の外では出なくなるので、使うならそのキャラクターが出る区間を全て置く)/ hide(この区間だけ隠す)/ adjust(この区間だけ位置・大きさ・表情を変える)',
    `- 位置は画面 ${width}x${height} の座標。transform の x, y は anchor(基準点)の位置で、scale は立ち絵の拡大率。今の設定を土台に少しずつ変える`,
    '- ズームで画面の一部に寄っている区間は、立ち絵が大事な場面を隠さないよう、hide するか、端に寄せて小さくする(adjust)ことを考える',
    '- セリフの無い長い区間(ゲーム画面を見せる場面)では、立ち絵を小さくするか隠してもよい',
    '- 話していない人を暗くする(portraitDim 0.25〜0.5 くらい)・話し始めに跳ねる(portraitHop)は project.setEditing で決める。掛け合いが多い動画なら暗くするのが見やすい',
    '- 既にある場面ごとの立ち絵は、portrait.update・item.setTimeRange・item.delete で直してよい。立ち絵以外のアイテムには触れない',
    '- セリフの文・順番・尺は変えない',
    `- コマンドは${MAX_AI_COMMANDS}個まで。変える必要が無ければ commands は空でよい`
  ].join('\n')

  const characters = Object.values(project.characters).map((character) => {
    const portrait = character.portrait
    if (!portrait) return `- ${character.id} ${character.name}(立ち絵なし)`
    const expressions = Object.values(portrait.expressions)
      .map((expression) => `${expression.id}=${expression.name}`)
      .join(', ')
    const t = portrait.transform
    const role = character.authorRole === 'ai' ? '相方(AI)' : '投稿者'
    const persona = character.persona?.personality ? ` 人物像: ${character.persona.personality}` : ''
    return `- ${character.id} ${character.name}(${role})${persona}\n  表情: ${expressions || '(なし)'}\n  今の配置: x=${Math.round(t.x)} y=${Math.round(t.y)} scale=${t.scale} anchor=${t.anchor} flipX=${t.flipX}`
  })
  const lines = voiceItemsInOrder(project).map((line, index) => {
    const speaker = project.characters[line.characterId]?.name ?? '?'
    const expression = line.expressionId ? (project.characters[line.characterId]?.portrait?.expressions[line.expressionId]?.name ?? line.expressionId) : '既定'
    return `${index + 1}. ${line.id} ${speaker} ${formatMs(line.startMs)}-${formatMs(itemEndMs(line))} 表情=${expression} 「${line.text}」`
  })
  const scenes = project.items
    .filter((item) => item.type === 'zoom' || item.type === 'video')
    .sort((a, b) => a.startMs - b.startMs)
    .map((item) => {
      const range = `${formatMs(item.startMs)}-${formatMs(itemEndMs(item))}`
      if (item.type === 'zoom') return `- ズーム ${range} 範囲 x=${Math.round(item.region.x)} y=${Math.round(item.region.y)} 幅=${Math.round(item.region.width)}`
      return `- 録画 ${range}${item.type === 'video' && item.freeze ? '(静止画)' : ''}`
    })
  const portraits = project.items
    .filter((item) => item.type === 'portrait')
    .map((item) => {
      if (item.type !== 'portrait') return ''
      const name = project.characters[item.characterId]?.name ?? item.characterId
      const t = item.transformOverride
      return `- ${item.id} ${name} ${item.kind ?? 'show'} ${formatMs(item.startMs)}-${formatMs(itemEndMs(item))}${item.expressionId ? ` 表情=${item.expressionId}` : ''}${t ? ` 配置 x=${Math.round(t.x)} y=${Math.round(t.y)} scale=${t.scale}` : ''}`
    })

  const content = [
    `## 動画\n${width}x${height} 総尺 ${formatDurationJa(projectDurationMs(project))}`,
    project.meta.synopsis?.trim() ? `## 企画メモ\n${project.meta.synopsis.trim()}` : '',
    `## キャラクター\n${characters.join('\n') || '(なし)'}`,
    `## 台本(発話順)\n${lines.join('\n') || '(まだセリフが無い)'}`,
    `## 場面(録画・ズーム)\n${scenes.join('\n') || '(なし)'}`,
    `## 今ある場面ごとの立ち絵\n${portraits.join('\n') || '(なし)'}`,
    `## 話し手の強調\n暗くする=${project.editing.portraitDim ?? 0} 跳ねる=${project.editing.portraitHop === true}`,
    request.instruction?.trim() ? `## 投稿者からの指示\n${request.instruction.trim()}` : '## 投稿者からの指示\n(特になし。全体を見て自然に整える)'
  ]
    .filter(Boolean)
    .join('\n\n')
  return { system, turns: [{ role: 'user', content }] }
}
