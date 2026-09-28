import { z } from 'zod'

import { formatDurationJa, formatMs } from '../lib/time'
import { entryTimelineMs } from '../live/timing'
import { normalizeChapters } from '../project/chapters'
import { projectDurationMs, voiceItemsInOrder } from '../project/queries'
import type { Chapter, Project } from '../project/types'
import { briefingPromptSection } from './briefing'
import type { GenerateRequest } from './types'

/**
 * 投稿用の文(タイトル案・概要欄・チャプター)の依頼文(REQUIREMENTS.md A-6, E-4)。
 * 作るのは下書きで、投稿は利用者が確かめてから自分で行う(L-5)。
 */

/** 台本を渡す上限(行)。長い動画は間引いて渡す。 */
const SCRIPT_LIMIT = 300

export const publishResponseSchema = z.object({
  titles: z.array(z.string().min(1).max(100)).min(1).max(5).describe('動画タイトルの案'),
  description: z.string().max(3000).describe('概要欄の本文(チャプターとクレジットは含めない)'),
  chapters: z
    .array(z.object({ atSeconds: z.number().min(0), title: z.string().min(1).max(60) }))
    .max(30)
    .describe('チャプター。最初は 0 秒')
})

export type PublishResponse = z.infer<typeof publishResponseSchema>

export function buildPublishPrompt(project: Project): Omit<GenerateRequest, 'jsonSchema'> {
  const lines = voiceItemsInOrder(project)
  const step = Math.max(1, Math.ceil(lines.length / SCRIPT_LIMIT))
  const script = lines
    .filter((_, index) => index % step === 0)
    .map((line) => `[${formatMs(line.startMs).replace(/\.\d+$/, '')}] ${project.characters[line.characterId]?.name ?? '?'}: ${line.text}`)
    .join('\n')
  const markers: string[] = []
  for (const session of Object.values(project.liveSessions)) {
    for (const entry of session.entries) {
      if (!entry.bookmarked) continue
      const atMs = entryTimelineMs(project, session, entry)
      if (atMs !== null) markers.push(`[${formatMs(atMs).replace(/\.\d+$/, '')}] ${entry.text}`)
    }
  }
  const characters = Object.values(project.characters).map((character) => character.name)

  const system = [
    'あなたは YouTube のゲーム実況動画の投稿文を考えるアシスタントです。',
    '台本から、タイトル案・概要欄の本文・チャプターを作ります。投稿者が確かめて直す前提の下書きです。',
    '',
    '## 決まりごと',
    '- 出力は指定のJSONだけ',
    '- タイトル案は3〜5個。内容と違う誇張や、見る人をだます書き方はしない。1つ40文字程度まで',
    '- 概要欄は2〜4段落の短い紹介。チャプターとクレジットは別に付け足すので書かない',
    '- チャプターは話題の切れ目に置き、最初は 0 秒。間は10秒以上空け、3つ以上にする。題は短く'
  ].join('\n')

  const content = [
    `## 動画\n総尺 ${formatDurationJa(projectDurationMs(project))} / 登場: ${characters.join('、') || '(なし)'}`,
    project.meta.synopsis?.trim() ? `## 企画メモ\n${project.meta.synopsis.trim()}` : '',
    `\n${briefingPromptSection(project)}`,
    `## 仮のタイトル\n${project.meta.title}`,
    markers.length > 0 ? `## 録画中に打った目印\n${markers.join('\n')}` : '',
    `## 台本${step > 1 ? `(${step}行に1行だけ)` : ''}\n${script || '(まだセリフが無い)'}`
  ]
    .filter(Boolean)
    .join('\n\n')

  return { system, turns: [{ role: 'user', content }] }
}

export function interpretPublishResponse(project: Project, response: PublishResponse): { titles: string[]; description: string; chapters: Chapter[] } {
  const totalMs = projectDurationMs(project)
  const chapters = normalizeChapters(
    response.chapters
      .map((chapter) => ({ atMs: chapter.atSeconds * 1000, title: chapter.title }))
      .filter((chapter) => totalMs === 0 || chapter.atMs < totalMs)
  )
  return {
    titles: response.titles.map((title) => title.trim()).filter(Boolean),
    description: response.description.trim(),
    chapters
  }
}
