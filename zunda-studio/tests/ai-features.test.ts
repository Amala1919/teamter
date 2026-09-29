import { describe, expect, it } from 'vitest'

import { buildCohostPrompt, cleanLine, interpretCohostResponse, RECENT_LINES } from '@shared/ai/cohost'
import { aiCommandSchema, editorResponseSchema, toCommands } from '@shared/ai/edit-commands'
import { buildEditorContext, buildEditorPrompt, SCRIPT_LINES_LIMIT } from '@shared/ai/editor'
import { applyCommands, type CommandContext } from '@shared/commands/apply'
import type { Command } from '@shared/commands/types'
import { diffProjects } from '@shared/project/diff'
import { createEmptyProject } from '@shared/project/factory'
import type { Project } from '@shared/project/types'

// ID が呼び出しをまたいで重ならないよう、数え上げはファイル全体で共有する。
let counter = 0

function context(): CommandContext {
  return { newId: (prefix) => `${prefix}_${++counter}`, now: () => new Date('2026-01-01T00:00:00Z') }
}

function apply(project: Project, commands: Command[]): Project {
  return applyCommands(project, commands, context()).project
}

/** ずんだもん(本人)と四国めたん(相方)と、2行の台本。 */
function banterProject(lines = 2): { project: Project; zunda: string; metan: string } {
  let project = createEmptyProject({ renderSeed: 1 })
  project.meta.synopsis = '初見でホラーゲームを遊ぶ回'
  project = apply(project, [
    { op: 'character.create', name: 'ずんだもん', engineId: 'voicevox', speakerId: 3, speakerName: 'ずんだもん', tempId: 'z' },
    {
      op: 'character.create',
      name: '四国めたん',
      engineId: 'voicevox',
      speakerId: 2,
      speakerName: '四国めたん',
      authorRole: 'ai',
      persona: { personality: '冷静で毒舌', speechStyle: '語尾は「〜わ」「〜かしら」', banterRole: 'tsukkomi', forbidden: ['やばい'], targetLengthChars: 20 },
      tempId: 'm'
    }
  ])
  const [zunda, metan] = Object.keys(project.characters) as [string, string]
  const commands: Command[] = []
  for (let index = 0; index < lines; index++) {
    commands.push({ op: 'voice.insert', characterId: index % 2 === 0 ? zunda : metan, text: `セリフ${index + 1}番`, atMs: index * 2000 })
  }
  return { project: apply(project, commands), zunda, metan }
}

function withExpressions(project: Project, characterId: string): Project {
  const next = structuredClone(project)
  next.assets['ast_psd'] = { type: 'psd', path: { absolute: '/p.psd', relative: null }, license: { source: 'x', creditRequired: false } }
  next.characters[characterId]!.portrait = {
    assetId: 'ast_psd',
    partGroups: {},
    layerVisibility: {},
    expressions: {
      exp_normal: { id: 'exp_normal', name: '通常', selections: {} },
      exp_angry: { id: 'exp_angry', name: '怒り', selections: {} }
    },
    defaultExpressionId: 'exp_normal',
    lipSync: null,
    blink: null,
    transform: { x: 0, y: 0, scale: 1, anchor: 'bottom-center', flipX: false }
  } as never
  return next
}

describe('相方の返答の依頼文', () => {
  it('ペルソナ・企画メモ・直前の会話・表情の候補・候補の数を伝える', () => {
    const { project, metan } = banterProject()
    const prompt = buildCohostPrompt(withExpressions(project, metan), { afterItemId: null, candidates: 3, rounds: 1, instruction: 'もっと辛口で' })
    expect(prompt.system).toContain('四国めたん')
    expect(prompt.system).toContain('冷静で毒舌')
    expect(prompt.system).toContain('語尾は「〜わ」')
    expect(prompt.system).toContain('ツッコミ役')
    expect(prompt.system).toContain('やばい')
    expect(prompt.system).toContain('20文字前後')
    expect(prompt.system).toContain('初見でホラーゲームを遊ぶ回')
    expect(prompt.system).toContain('通常 / 怒り')
    expect(prompt.system).toContain('案を3通り')
    const last = prompt.turns.at(-1)!.content
    expect(last).toContain('ずんだもん: セリフ1番')
    expect(last).toContain('四国めたん: セリフ2番')
    expect(last).toContain('もっと辛口で')
  })

  it('指定のセリフまでの会話だけを渡す', () => {
    const { project } = banterProject(4)
    const lines = project.items.filter((item) => item.type === 'voice')
    const prompt = buildCohostPrompt(project, { afterItemId: lines[1]!.id, candidates: 1, rounds: 1 })
    expect(prompt.turns.at(-1)!.content).toContain('セリフ2番')
    expect(prompt.turns.at(-1)!.content).not.toContain('セリフ3番')
  })

  it('長い会話は、直近は原文のまま、それより前は縮めて渡す', () => {
    const { project } = banterProject(RECENT_LINES + 10)
    const content = buildCohostPrompt(project, { afterItemId: null, candidates: 1, rounds: 1 }).turns.at(-1)!.content
    expect(content).toContain('これより前の流れ')
    expect(content).toMatch(/\[\d+:\d+\.\d+\] ずんだもん: セリフ49番/)
    expect(content).not.toMatch(/\] ずんだもん: セリフ1番/)
  })

  it('自分の役を指定すると、投稿者のセリフの案として頼む(B-10)', () => {
    const { project, zunda } = banterProject()
    const prompt = buildCohostPrompt(project, { afterItemId: null, candidates: 1, rounds: 1, characterId: zunda })
    expect(prompt.system).toContain('投稿者本人が演じる「ずんだもん」のセリフの案')
  })
})

describe('返答の長さの目安(セリフごと)', () => {
  it('返答ごとに決めた長さを依頼文に入れ、人物像に残っている値より優先する', () => {
    const { project, zunda } = banterProject()
    const base = { afterItemId: null, candidates: 1, rounds: 1 }
    // 指定が無ければ、人物像に残っている値(以前のプロジェクト)
    expect(buildCohostPrompt(project, base).system).toContain('1回のセリフの長さの目安: 20文字前後')
    // 指定すればそちらを使う(セリフごとに変えられる)
    const long = buildCohostPrompt(project, { ...base, targetLengthChars: 120 }).system
    expect(long).toContain('1回のセリフの長さの目安: 120文字前後')
    expect(long).not.toContain('目安: 20文字前後')
    // 人物像の無い役(自分のセリフの案)にも伝わる
    expect(buildCohostPrompt(project, { ...base, characterId: zunda, targetLengthChars: 25 }).system).toContain('1つのセリフは25文字前後')
    expect(buildCohostPrompt(project, { ...base, characterId: zunda }).system).not.toContain('文字前後')
  })

  it('長すぎる指摘も、返答ごとの長さを基準にする', () => {
    const { project, metan } = banterProject()
    const response = { candidates: [{ lines: [{ speaker: '四国めたん', text: 'あ'.repeat(60), expression: null }] }] }
    const request = { afterItemId: null, candidates: 1, rounds: 1 }
    // 目安 20 文字なら 60 文字は長すぎ、目安 120 文字なら問題ない
    expect(interpretCohostResponse(project, request, response)[0]!.warnings.join()).toContain('目安(20文字)')
    expect(interpretCohostResponse(project, { ...request, targetLengthChars: 120 }, response)[0]!.warnings).toEqual([])
    void metan
  })

  it('長さ別の候補は、範囲の中で小さい順に並ぶ', async () => {
    const { LENGTH_PRESETS, LENGTH_RANGE } = await import('@shared/ai/cohost')
    const sizes = LENGTH_PRESETS.map((preset) => preset.chars)
    expect(sizes).toEqual([...sizes].sort((a, b) => a - b))
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(LENGTH_RANGE.min)
    expect(Math.max(...sizes)).toBeLessThanOrEqual(LENGTH_RANGE.max)
  })
})

describe('相方の返答の解釈', () => {
  it('表情の名前をIDにし、名前の飾りを外し、使わせない表現と長すぎる返答を指摘する', () => {
    const { project, metan } = banterProject()
    const withFace = withExpressions(project, metan)
    const candidates = interpretCohostResponse(withFace, { afterItemId: null, candidates: 2, rounds: 1 }, {
      candidates: [
        { lines: [{ speaker: '四国めたん', text: '四国めたん:「あら、そうかしら」', expression: '怒り' }] },
        { lines: [{ speaker: '四国めたん', text: 'それはやばいわね。'.repeat(8), expression: '存在しない表情' }] }
      ]
    })
    expect(candidates[0]).toEqual({ lines: [{ characterId: metan, text: 'あら、そうかしら', expressionId: 'exp_angry' }], warnings: [] })
    expect(candidates[1]!.lines[0]!.expressionId).toBeNull()
    expect(candidates[1]!.warnings.join('\n')).toContain('使わせない表現を含んでいます: やばい')
    expect(candidates[1]!.warnings.join('\n')).toContain('目安(20文字)')
  })

  it('何往復も作るときは、話者の名前で割り当て、分からなければ交互にする', () => {
    const { project, zunda, metan } = banterProject()
    const [candidate] = interpretCohostResponse(project, { afterItemId: null, candidates: 1, rounds: 3 }, {
      candidates: [
        {
          lines: [
            { speaker: '四国めたん', text: 'いくわよ', expression: null },
            { speaker: '謎の人', text: 'まつのだ', expression: null },
            { speaker: '四国めたん', text: 'またないわ', expression: null }
          ]
        }
      ]
    })
    expect(candidate!.lines.map((line) => line.characterId)).toEqual([metan, zunda, metan])
  })

  it('セリフの飾りの取り方', () => {
    expect(cleanLine('ずんだもん: やるのだ', 'ずんだもん')).toBe('やるのだ')
    expect(cleanLine('「やるのだ」', 'ずんだもん')).toBe('やるのだ')
    expect(cleanLine('やる\nのだ', 'ずんだもん')).toBe('やるのだ')
  })
})

describe('編集AIのコマンド', () => {
  it('許されたコマンドだけを受け付ける(合成結果の反映・クレジットの確認・ペルソナの変更は不可)', () => {
    expect(aiCommandSchema.safeParse({ op: 'voice.setText', itemId: 'itm_1', text: '短く' }).success).toBe(true)
    expect(aiCommandSchema.safeParse({ op: 'zoom.insert', atMs: 0, durationMs: 1000, region: { x: 0, y: 0, width: 960 }, method: 'punch' }).success).toBe(true)
    for (const forbidden of [
      { op: 'voice.applySynthesis', itemId: 'x', expectedText: 'a', synthesis: {} },
      { op: 'credits.set', confirmedByUser: true },
      { op: 'character.setPersona', characterId: 'x', persona: {} },
      { op: 'asset.remove', assetId: 'x' }
    ]) {
      expect(aiCommandSchema.safeParse(forbidden).success).toBe(false)
    }
    expect(editorResponseSchema.safeParse({ reply: 'x', commands: Array.from({ length: 201 }, () => ({ op: 'item.delete', itemId: 'a' })) }).success).toBe(false)
  })

  it('検証済みのコマンドはそのまま適用でき、省略した値は取り除かれる', () => {
    const { project } = banterProject()
    const line = project.items.find((item) => item.type === 'voice')!
    const parsed = editorResponseSchema.parse({
      reply: '短くしました',
      commands: [
        { op: 'voice.setText', itemId: line.id, text: '短いのだ' },
        { op: 'media.placeText', text: '衝撃', atMs: 0, durationMs: 1000, tempId: 't' },
        { op: 'item.addEffect', itemId: 't', effect: { type: 'shake', amplitudePx: 10, frequencyHz: 20, durationMs: 300 } }
      ]
    })
    const commands = toCommands(parsed.commands)
    expect(JSON.stringify(commands)).not.toContain('undefined')
    const next = apply(project, commands)
    expect(next.items.find((item) => item.id === line.id)).toMatchObject({ text: '短いのだ' })
    expect(next.items.find((item) => item.type === 'text')!.effects).toHaveLength(1)
  })

  it('依頼文には台本の表・IDの一覧・選択中のアイテムが入り、素材の中身は入らない', () => {
    const { project } = banterProject()
    const line = project.items.find((item) => item.type === 'voice')!
    const prompt = buildEditorPrompt(project, { message: 'テンポを上げて', selection: [line.id], history: [{ role: 'user', content: '前の相談' }, { role: 'assistant', content: '前の返事' }] })
    const last = prompt.turns.at(-1)!.content
    expect(last).toContain(`${line.id} ずんだもん 0:00.000`)
    expect(last).toContain('★選択中')
    expect(last).toContain('lyr_zoom ズーム')
    expect(last).toContain('## 指示\nテンポを上げて')
    expect(prompt.turns[0]).toEqual({ role: 'user', content: '前の相談' })
    expect(prompt.system).toContain('投稿者本人の役のセリフは、指示がない限り書き換えない')
  })

  it('台本が長すぎるときは、選択範囲の周辺だけを渡す', () => {
    const { project } = banterProject(SCRIPT_LINES_LIMIT + 50)
    const lines = project.items.filter((item) => item.type === 'voice').sort((a, b) => a.startMs - b.startMs)
    const text = buildEditorContext(project, [lines[10]!.id])
    expect(text).toContain(`台本は全${SCRIPT_LINES_LIMIT + 50}行`)
    expect(text).toContain('「セリフ11番」 ★選択中')
    expect(text).not.toContain('「セリフ150番」')
  })
})

describe('差分', () => {
  it('セリフの変更・追加・削除と、ほかのアイテムの変更、尺の変化をまとめる', () => {
    const { project, metan } = banterProject(3)
    const [first, second, third] = project.items.filter((item) => item.type === 'voice')
    const after = apply(project, [
      { op: 'voice.setText', itemId: first!.id, text: '変えたのだ' },
      { op: 'voice.delete', itemId: third!.id },
      { op: 'voice.insert', characterId: metan, text: '足したわ', afterItemId: second!.id },
      { op: 'zoom.insert', atMs: 0, durationMs: 1000, region: { x: 0, y: 0, width: 960 } },
      { op: 'media.placeText', text: 'テロップ', atMs: 0, durationMs: 1000 }
    ])
    const diff = diffProjects(project, after)
    expect(diff.script).toEqual([
      { kind: 'changed', index: 1, speaker: 'ずんだもん', before: 'セリフ1番', after: '変えたのだ', notes: [] },
      { kind: 'added', index: 3, speaker: '四国めたん', before: null, after: '足したわ', notes: [] },
      { kind: 'removed', index: 3, speaker: 'ずんだもん', before: 'セリフ3番', after: null, notes: [] }
    ])
    // テロップは背景の映像と重なるので、空いている「背景 2」へ振り分けられ、レイヤーが増える
    expect(diff.others.sort()).toEqual(['ズームを追加(1件)', 'テロップを追加(1件)', 'レイヤーを変更'])
    expect(diff.durationBeforeMs).toBeGreaterThan(0)
    expect(diff.empty).toBe(false)
    expect(diffProjects(project, project).empty).toBe(true)
  })
})
