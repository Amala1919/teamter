import { join } from 'node:path'

import { beforeEach, describe, expect, it } from 'vitest'

import { ClaudeCodeProvider } from '@main/services/ai/claude-code-provider'
import { buildCohostPrompt } from '@shared/ai/cohost'
import {
  applyCheckResults,
  briefingIsStale,
  briefingPromptSection,
  buildCheckPrompt,
  factsToCheck,
  interpretBriefing,
  mapCheckIds,
  quoteInMemo,
  type BriefingResponse
} from '@shared/ai/briefing'
import { buildLivePrompt } from '@shared/ai/live'
import { applyCommands, type CommandContext } from '@shared/commands/apply'
import type { Command } from '@shared/commands/types'
import { createEmptyProject } from '@shared/project/factory'
import type { Project, ProjectBriefing } from '@shared/project/types'

import { fakeCliSettings, readCliLog, tempDir } from './helpers/env'

let counter = 0
const context = (): CommandContext => ({ newId: (prefix) => `${prefix}_${++counter}`, now: () => new Date('2026-01-01T00:00:00Z') })
const apply = (project: Project, commands: Command[]): Project => applyCommands(project, commands, context()).project

const MEMO = 'Hearts of Iron IV で日本を遊ぶ回。ずんだもんは初見で、めたんは経験者。\n見どころは日中戦争の泥沼。'

function base(): Project {
  return apply(createEmptyProject(), [
    { op: 'project.setMeta', title: 'HoI4 日本プレイ', synopsis: MEMO },
    { op: 'character.create', name: 'ずんだもん', authorRole: 'user', engineId: 'voicevox', speakerId: 3, speakerName: 'ずんだもん' },
    {
      op: 'character.create',
      name: '四国めたん',
      authorRole: 'ai',
      persona: { personality: '冷静', speechStyle: '丁寧', banterRole: 'tsukkomi', forbidden: [], targetLengthChars: 40 },
      engineId: 'voicevox',
      speakerId: 2,
      speakerName: '四国めたん'
    }
  ])
}

let idCounter = 0
const ids = (): string => `f${++idCounter}`

const response: BriefingResponse = {
  stance: 'めたんは経験者として、初見のずんだもんに要点だけ教える。',
  facts: [
    // メモのとおり(全角・改行の違いは許す)
    { text: 'ずんだもんは初見', origin: 'memo', quote: 'ずんだもんは初見で、めたんは経験者。', checkHint: null },
    // メモにあるとされたが、メモに無い文
    { text: '日本は強い', origin: 'memo', quote: '日本は最強の国', checkHint: null },
    // AI が補った知識
    { text: 'HoI4 は Paradox Interactive のゲーム', origin: 'ai', quote: null, checkHint: '公式サイトで確認' },
    // 重複は1つにまとめる
    { text: 'ずんだもんは初見', origin: 'memo', quote: 'ずんだもんは初見', checkHint: null }
  ],
  questions: ['どのバージョン(DLC)で遊ぶか']
}

describe('企画メモからの前提(スタンス・前提知識)', () => {
  it('メモにあることは引用がメモに本当にあるときだけ確認済み。無ければ AI の知識として未確認にする', () => {
    const briefing = interpretBriefing(base(), response, null, new Date('2026-01-01T00:00:00Z'), ids)
    expect(briefing.stance).toContain('経験者')
    expect(briefing.questions).toEqual(['どのバージョン(DLC)で遊ぶか'])
    expect(briefing.sourceSynopsis).toBe(MEMO)
    expect(briefing.facts).toHaveLength(3)
    const [memo, demoted, knowledge] = briefing.facts
    expect(memo).toMatchObject({ origin: 'memo', status: 'confirmed', quote: 'ずんだもんは初見で、めたんは経験者。' })
    expect(demoted).toMatchObject({ origin: 'ai', status: 'unverified', quote: null })
    expect(demoted!.checkHint).toContain('メモに同じ文が見つかりませんでした')
    expect(knowledge).toMatchObject({ origin: 'ai', status: 'unverified', checkHint: '公式サイトで確認' })
    // 全角・半角、空白・改行の違いは同じ文とみなす
    expect(quoteInMemo('見どころは 日中戦争の泥沼。', 'ＡＢＣ\n見どころは日中戦争の\n泥沼。')).toBe(true)
    expect(quoteInMemo('', MEMO)).toBe(false)
    // 確かめる対象は AI の知識だけ(メモのもの・使わないものは除く)
    expect(factsToCheck(briefing).map((fact) => fact.id)).toEqual([demoted!.id, knowledge!.id])
  })

  it('確かめる依頼では項目を番号で示し、応答の番号を項目に戻す(知らない番号は捨てる)', () => {
    const briefing = interpretBriefing(base(), response, null, new Date(), ids)
    const facts = factsToCheck(briefing)
    const prompt = buildCheckPrompt(base(), facts, false)
    expect(prompt.turns[0]!.content).toContain(`- 1: ${facts[0]!.text}`)
    expect(prompt.system).toContain('sources は必ず空')
    const mapped = mapCheckIds(facts, {
      results: [
        { id: '2', verdict: 'supported', reason: 'r', sources: [], suggestion: null },
        { id: '9', verdict: 'supported', reason: 'r', sources: [], suggestion: null }
      ]
    })
    expect(mapped.results.map((result) => result.id)).toEqual([facts[1]!.id])
  })

  it('裏付けの結果: ウェブで調べていなければ出典を捨て、出典の無い「裏付けあり」は確かめられずにし、誤りは使わない', () => {
    const briefing = interpretBriefing(base(), response, null, new Date(), ids)
    const [, demoted, knowledge] = briefing.facts
    const results = {
      results: [
        { id: knowledge!.id, verdict: 'supported' as const, reason: '公式サイトに記載', sources: [{ title: '公式', url: 'https://www.paradoxinteractive.com/' }, { title: '怪しい', url: 'http://example.com' }], suggestion: null },
        { id: demoted!.id, verdict: 'contradicted' as const, reason: 'メモには書かれていない', sources: [], suggestion: '日本は資源が乏しい' }
      ]
    }
    const web = applyCheckResults(briefing, results, true, new Date())
    const checkedKnowledge = web.facts.find((fact) => fact.id === knowledge!.id)!
    // 裏付けがあっても確認済みにはしない(利用者が決める)。https 以外の出典は捨てる
    expect(checkedKnowledge.status).toBe('unverified')
    expect(checkedKnowledge.check).toMatchObject({ verdict: 'supported', webSearched: true, sources: [{ title: '公式', url: 'https://www.paradoxinteractive.com/' }] })
    // 誤りの可能性が高いものは使わない
    expect(web.facts.find((fact) => fact.id === demoted!.id)).toMatchObject({ status: 'rejected', check: { verdict: 'contradicted', suggestion: '日本は資源が乏しい' } })

    // ウェブで調べていない結果の URL は見せない
    const offline = applyCheckResults(briefing, results, false, new Date())
    expect(offline.facts.find((fact) => fact.id === knowledge!.id)!.check).toMatchObject({ sources: [], webSearched: false })

    // ウェブで調べたのに出典の無い「裏付けあり」は「確かめられず」
    const noSource = applyCheckResults(briefing, { results: [{ ...results.results[0]!, sources: [] }] }, true, new Date())
    expect(noSource.facts.find((fact) => fact.id === knowledge!.id)!.check!.verdict).toBe('unclear')

    // 利用者が確認済みにしたものは、結果が出ても確認済みのまま(誤りの可能性は表示で知らせる)
    const confirmed: ProjectBriefing = { ...briefing, facts: briefing.facts.map((fact) => (fact.id === demoted!.id ? { ...fact, status: 'confirmed' } : fact)) }
    expect(applyCheckResults(confirmed, results, true, new Date()).facts.find((fact) => fact.id === demoted!.id)!.status).toBe('confirmed')
  })

  it('依頼には確認済みの前提知識だけを入れ、事実を断定しない決まりを必ず添える', () => {
    let project = base()
    // 前提が無くても決まりは入る
    expect(briefingPromptSection(project)).toContain('断定しない')

    const briefing = interpretBriefing(project, response, null, new Date(), ids)
    const withUser: ProjectBriefing = {
      ...briefing,
      facts: [
        ...briefing.facts,
        { id: 'u1', text: 'このシリーズは第3話', origin: 'user', quote: null, status: 'confirmed', checkHint: null, check: null },
        { id: 'r1', text: '使わない知識', origin: 'ai', quote: null, status: 'rejected', checkHint: null, check: null }
      ]
    }
    project = apply(project, [{ op: 'project.setBriefing', briefing: withUser }])
    const section = briefingPromptSection(project)
    expect(section).toContain('めたんは経験者として')
    expect(section).toContain('このシリーズは第3話')
    // 未確認・使わないものは入れない
    expect(section).not.toContain('Paradox')
    expect(section).not.toContain('使わない知識')
    // メモにあることは企画メモそのものが入るので重ねない
    expect(section).not.toContain('- ずんだもんは初見')

    // 相方の返答の依頼に入る
    const prompt = buildCohostPrompt(project, { candidates: 1, rounds: 1, afterItemId: null })
    expect(prompt.system).toContain('## 相方のスタンス')
    expect(prompt.system).toContain('このシリーズは第3話')
    // ライブの返答にも入る
    const live = buildLivePrompt(
      { aiName: '四国めたん', persona: null, userName: 'ずんだもん', model: null, voice: null, projectTitle: 't', briefing: section },
      [],
      80
    )
    expect(live.system).toContain('このシリーズは第3話')
  })

  it('前提の保存は取り消せ、企画メモが変わると作り直しを勧める。不正な前提は断る', () => {
    let project = base()
    const briefing = interpretBriefing(project, response, null, new Date(), ids)
    project = apply(project, [{ op: 'project.setBriefing', briefing }])
    expect(project.ai.briefing?.facts).toHaveLength(3)
    expect(briefingIsStale(project)).toBe(false)
    project = apply(project, [{ op: 'project.setMeta', synopsis: `${MEMO}\n追記: 難易度はシビア` }])
    expect(briefingIsStale(project)).toBe(true)
    expect(() => apply(project, [{ op: 'project.setBriefing', briefing: { ...briefing, facts: [{ ...briefing.facts[0]!, text: ' ' }] } }])).toThrow('空か')
    project = apply(project, [{ op: 'project.setBriefing', briefing: null }])
    expect(project.ai.briefing).toBeNull()
  })
})

describe('事実の確かめでのウェブ検索', () => {
  let work: string
  let logFile: string
  beforeEach(async () => {
    work = await tempDir('zs-briefing-')
    logFile = join(work, 'cli-log.jsonl')
  })

  it('Claude Code では、求めたときだけ読むだけのウェブ検索を許す', async () => {
    const provider = new ClaudeCodeProvider(() => fakeCliSettings(), work, { ...process.env, FAKE_MODE: 'text', FAKE_LOG: logFile })
    const plain = await provider.generate('sonnet', { system: 's', turns: [{ role: 'user', content: 'x' }] })
    expect(plain.webSearch).toBeUndefined()
    const searched = await provider.generate('sonnet', { system: 's', turns: [{ role: 'user', content: 'x' }], webSearch: true })
    expect(searched.webSearch).toBe(true)
    const [first, second] = await readCliLog(logFile)
    expect(first!.argv[first!.argv.indexOf('--tools') + 1]).toBe('')
    expect(first!.argv).not.toContain('--allowedTools')
    expect(second!.argv[second!.argv.indexOf('--tools') + 1]).toBe('WebSearch,WebFetch')
    expect(second!.argv[second!.argv.indexOf('--allowedTools') + 1]).toBe('WebSearch,WebFetch')
    // ほかのツール(ファイル・シェル・MCP)は使わせないまま
    expect(second!.argv[second!.argv.indexOf('--disallowedTools') + 1]).toBe('mcp__*')
  })
})
