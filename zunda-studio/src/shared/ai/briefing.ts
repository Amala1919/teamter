import { z } from 'zod'

import type { BriefingCheck, BriefingFact, BriefingSource, Project, ProjectBriefing } from '../project/types'
import type { GenerateRequest } from './types'

/**
 * 企画メモから、相方の「スタンス」と「前提知識」を作る。
 *
 * 前提知識は動画の中で事実として話される。誤りがそのまま動画に残らないよう、次の順に守りを重ねる。
 * 1. 出どころを分ける。企画メモに書いてあること(memo)は原文の引用を付けさせ、引用がメモに本当にあるかをここで機械的に確かめる。
 *    見つからなければ AI の知識扱いにする。
 * 2. AI が補った知識(ai)は、作った時点では「未確認」。確かめ方(checkHint)を必ず付けさせる。
 * 3. 別の依頼で裏付けを確かめる(使えればウェブ検索で、出典つき)。ウェブで調べていない結果の URL は捨てる。
 *    ウェブで調べたのに出典の無い「裏付けあり」は「確かめられず」に下げる。誤りの可能性が高いものは「使わない」にする。
 * 4. 「確認済み」にするのは利用者だけ。AI への依頼(相方の返答・編集・概要欄)には確認済みの項目だけを渡し、
 *    それ以外の事実は断定しないよう指示する。
 */

export const MAX_BRIEFING_FACTS = 30

export const briefingResponseSchema = z.object({
  stance: z.string().max(2000).describe('相方がこの動画で取る立ち位置。企画メモから読み取れることだけで書く'),
  facts: z
    .array(
      z.object({
        text: z.string().min(1).max(300).describe('相方が会話で使ってよい事実。1項目に1つの事実'),
        origin: z.enum(['memo', 'ai']).describe('memo: 企画メモに書いてある / ai: メモに無く、あなたが補った一般的な知識'),
        quote: z.string().max(300).nullable().describe('memo のとき、企画メモの該当部分を一字一句そのまま。ai のときは null'),
        checkHint: z.string().max(300).nullable().describe('ai のとき、何をどこで確かめればよいか(バージョン・時期で変わる点など)')
      })
    )
    .max(MAX_BRIEFING_FACTS),
  questions: z.array(z.string().min(1).max(200)).max(5).describe('企画メモだけでは分からず、投稿者に確かめたいこと')
})

export type BriefingResponse = z.infer<typeof briefingResponseSchema>

export const briefingCheckSchema = z.object({
  results: z
    .array(
      z.object({
        id: z.string().min(1).max(100),
        verdict: z.enum(['supported', 'contradicted', 'unclear']),
        reason: z.string().max(500),
        sources: z.array(z.object({ title: z.string().max(200), url: z.string().max(500) })).max(5),
        suggestion: z.string().max(300).nullable()
      })
    )
    .max(MAX_BRIEFING_FACTS)
})

export type BriefingCheckResponse = z.infer<typeof briefingCheckSchema>

function characterLines(project: Project): string {
  return Object.values(project.characters)
    .map((character) => `- ${character.name}(${character.authorRole === 'ai' ? '相方。AIが演じる' : '投稿者本人が演じる'})`)
    .join('\n')
}

/** 前提を作る依頼。 */
export function buildBriefingPrompt(project: Project): Omit<GenerateRequest, 'jsonSchema'> {
  const system = [
    'あなたはゲーム実況動画(ゆっくり実況・VOICEVOX実況の形式)の企画担当です。',
    '投稿者の企画メモを読み、掛け合いの相方(AIが演じるキャラクター)がこの動画で使う「スタンス」と「前提知識」をまとめます。',
    '',
    '## スタンス',
    '- 相方の立ち位置を書く: 題材についての知識の程度(初見か経験者か)、視聴者への向き合い方、話の方向性、避けること',
    '- 企画メモから読み取れることだけで書く。メモに無い設定を作らない',
    '',
    '## 前提知識(ここが動画の中で事実として話される。誤りは動画にそのまま残るので、特に慎重に)',
    '- origin=memo: 企画メモに書いてあること。quote に企画メモの該当部分を一字一句そのまま写す(言い換えない)',
    '- origin=ai: メモには無いが、この題材について広く知られていて、会話に役立つ一般的な知識',
    '  - 少しでも自信が無いことは書かない。数値・固有名詞・日付・バージョンを推測で作らない',
    '  - ゲームの仕様はバージョンや時期で変わる。変わりうる点と確かめ方(公式サイト・公式wiki など)を checkHint に書く',
    '- 1項目に1つの事実を短く書く。意見・感想・演出の案は前提知識に入れない',
    '- 企画メモだけでは分からないこと(題材のバージョン、どこまで進めたか等)は推測せず questions に書く',
    '- 出力は指定のJSONだけ'
  ].join('\n')
  const content = [
    `## 動画のタイトル\n${project.meta.title}`,
    `## 登場人物\n${characterLines(project) || '(未設定)'}`,
    `## 企画メモ\n${(project.meta.synopsis ?? '').trim()}`,
    '',
    'この企画メモから、相方のスタンスと前提知識をまとめてください。'
  ].join('\n')
  return { system, turns: [{ role: 'user', content }] }
}

/** 比べるための正規化(全角・半角の違い、空白・改行の違いを無視する)。 */
function normalize(text: string): string {
  return text.normalize('NFKC').replace(/\s+/g, '')
}

/** 引用が企画メモに本当にあるか。 */
export function quoteInMemo(quote: string, synopsis: string): boolean {
  const needle = normalize(quote)
  return needle.length > 0 && normalize(synopsis).includes(needle)
}

let factCounter = 0
export function newFactId(): string {
  factCounter += 1
  return `fact_${Date.now().toString(36)}_${factCounter}`
}

/**
 * AI の応答を前提にする。memo の引用がメモに無ければ AI の知識扱い(未確認)に下げる。
 * メモに書いてあることは確認済み、AI が補った知識は未確認で始める。
 */
export function interpretBriefing(
  project: Project,
  response: BriefingResponse,
  generatedBy: ProjectBriefing['generatedBy'],
  now: Date,
  newId: () => string = newFactId
): ProjectBriefing {
  const synopsis = (project.meta.synopsis ?? '').trim()
  const seen = new Set<string>()
  const facts: BriefingFact[] = []
  for (const raw of response.facts) {
    const text = raw.text.trim()
    const key = normalize(text)
    if (text === '' || seen.has(key)) continue
    seen.add(key)
    const quote = raw.quote?.trim() ?? ''
    if (raw.origin === 'memo' && quote !== '' && quoteInMemo(quote, synopsis)) {
      facts.push({ id: newId(), text, origin: 'memo', quote, status: 'confirmed', checkHint: null, check: null })
      continue
    }
    const demoted = raw.origin === 'memo'
    facts.push({
      id: newId(),
      text,
      origin: 'ai',
      quote: null,
      status: 'unverified',
      checkHint: demoted
        ? '企画メモに書いてあるとされましたが、メモに同じ文が見つかりませんでした。メモの内容と合っているか確かめてください'
        : raw.checkHint?.trim() || null,
      check: null
    })
  }
  return {
    stance: response.stance.trim(),
    facts: facts.slice(0, MAX_BRIEFING_FACTS),
    questions: response.questions.map((question) => question.trim()).filter(Boolean),
    sourceSynopsis: synopsis,
    generatedBy,
    updatedAt: now.toISOString()
  }
}

/** 裏付けを確かめる対象。企画メモに書いてあること・使わないものは除く。 */
export function factsToCheck(briefing: ProjectBriefing, ids?: readonly string[]): BriefingFact[] {
  const wanted = ids ? new Set(ids) : null
  return briefing.facts.filter((fact) => (wanted ? wanted.has(fact.id) : fact.origin !== 'memo' && fact.status !== 'rejected'))
}

/** 裏付けを確かめる依頼。 */
export function buildCheckPrompt(project: Project, facts: readonly BriefingFact[], webSearch: boolean): Omit<GenerateRequest, 'jsonSchema'> {
  const system = [
    'あなたは動画の事実確認の担当です。次の各項目が事実として正しいかを、1つずつ確かめます。',
    webSearch
      ? '- ウェブ検索を必ず使って調べる。公式サイト・公式wiki・信頼できる資料を優先し、見た資料の URL を sources に入れる'
      : '- ウェブ検索は使えない。あなたの知識だけで判断する。sources は必ず空にする(URL を書かない)',
    '- 裏付けが取れたときだけ supported。推測や「たぶん正しい」は unclear にする',
    '- 誤り・古い情報の可能性が高いときは contradicted にして、正しいと思われる内容を suggestion に書く',
    '  suggestion は元の項目をそのまま置き換えられる、1つの事実の文にする(例: 「Hearts of Iron IV は2016年に発売された」)',
    '- バージョンや時期で変わる内容は、どの時点の情報かを reason に書く',
    '- 項目の番号を id にそのまま入れて返す(例: "1")。出力は指定のJSONだけ'
  ].join('\n')
  const content = [
    `## 動画のタイトル\n${project.meta.title}`,
    project.meta.synopsis?.trim() ? `## 企画メモ(題材の手がかり)\n${project.meta.synopsis.trim()}` : '',
    '## 確かめる項目',
    ...facts.map((fact, index) => `- ${index + 1}: ${fact.text}${fact.checkHint ? `(確かめる点: ${fact.checkHint})` : ''}`)
  ]
    .filter(Boolean)
    .join('\n')
  return { system, turns: [{ role: 'user', content }] }
}

/**
 * 依頼では項目を番号(1, 2, …)で示す(長い ID を写し間違えさせないため)。応答の番号を項目の ID に戻す。
 * 知らない番号の結果は捨てる。
 */
export function mapCheckIds(facts: readonly BriefingFact[], response: BriefingCheckResponse): BriefingCheckResponse {
  return {
    results: response.results.flatMap((result) => {
      const fact = facts[Number(result.id.replace(/[^0-9]/g, '')) - 1]
      return fact ? [{ ...result, id: fact.id }] : []
    })
  }
}

function safeSources(sources: readonly BriefingSource[]): BriefingSource[] {
  return sources
    .filter((source) => /^https:\/\/[^\s]+$/.test(source.url))
    .map((source) => ({ title: source.title.trim() || source.url, url: source.url }))
}

/**
 * 確かめた結果を前提に書き込む。確認済みにはしない(利用者が決める)。
 * - ウェブで調べていなければ出典を捨てる(作られた URL を見せないため)
 * - ウェブで調べたのに出典の無い「裏付けあり」は「確かめられず」に下げる
 * - 誤りの可能性が高いものは「使わない」にする
 */
export function applyCheckResults(briefing: ProjectBriefing, response: BriefingCheckResponse, webSearched: boolean, now: Date): ProjectBriefing {
  const results = new Map(response.results.map((result) => [result.id, result]))
  return {
    ...briefing,
    facts: briefing.facts.map((fact) => {
      const result = results.get(fact.id)
      if (!result) return fact
      const sources = webSearched ? safeSources(result.sources) : []
      let verdict = result.verdict
      let reason = result.reason.trim()
      if (verdict === 'supported' && webSearched && sources.length === 0) {
        verdict = 'unclear'
        reason = `${reason}(出典が示されなかったため「確かめられず」にしました)`
      }
      const check: BriefingCheck = {
        verdict,
        reason,
        sources,
        webSearched,
        suggestion: result.suggestion?.trim() || null,
        at: now.toISOString()
      }
      // 確認済みの項目は、利用者の判断を優先してそのまま(誤りの可能性だけは知らせる)。
      const status = fact.status === 'confirmed' ? 'confirmed' : verdict === 'contradicted' ? 'rejected' : 'unverified'
      return { ...fact, check, status }
    })
  }
}

/** 作ったときから企画メモが変わっているか。 */
export function briefingIsStale(project: Project): boolean {
  const briefing = project.ai.briefing
  if (!briefing) return false
  return normalize(briefing.sourceSynopsis) !== normalize(project.meta.synopsis ?? '')
}

/**
 * AI への依頼に入れる前提の文(企画メモの後ろに置く)。確認済みの前提知識だけを入れ、事実の扱いの決まりを必ず添える。
 * 前提が無くても、決まりだけは入れる(企画メモに無い事実を断定させないため)。
 */
export function briefingPromptSection(project: Project): string {
  const briefing = project.ai.briefing
  // 企画メモに書いてあること(memo)は、依頼に企画メモそのものが入るので重ねない(AI の言い換えで意味がずれるのを避ける)。
  const confirmed = briefing?.facts.filter((fact) => fact.status === 'confirmed' && fact.origin !== 'memo') ?? []
  return [
    briefing?.stance.trim() ? `## 相方のスタンス\n${briefing.stance.trim()}` : '',
    confirmed.length > 0 ? `## 前提知識(投稿者が確認済み)\n${confirmed.map((fact) => `- ${fact.text}`).join('\n')}` : '',
    [
      '## 事実の扱い',
      '- 企画メモと前提知識に無い事実(数値・固有名詞・日付・ゲームの仕様の細部)は断定しない',
      '- 分からないことは分からないと言うか、疑問や予想として話す(「〜だったはず」「〜かしら?」)'
    ].join('\n')
  ]
    .filter(Boolean)
    .join('\n\n')
}

/** 前提の保存の前に、大きさと値を確かめる(コマンドの処理から使う)。 */
export function validateBriefing(briefing: ProjectBriefing): string | null {
  if (briefing.stance.length > 4000) return 'スタンスが長すぎます'
  if (briefing.facts.length > 100) return '前提知識が多すぎます'
  for (const fact of briefing.facts) {
    if (fact.text.trim() === '' || fact.text.length > 500) return '前提知識の項目が空か、長すぎます'
    if (!['memo', 'ai', 'user'].includes(fact.origin)) return '前提知識の出どころが不正です'
    if (!['confirmed', 'unverified', 'rejected'].includes(fact.status)) return '前提知識の状態が不正です'
  }
  return null
}
