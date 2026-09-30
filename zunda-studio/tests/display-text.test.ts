import { describe, expect, it } from 'vitest'

import { aiCommandSchema } from '@shared/ai/edit-commands'
import { applyCommands, type CommandContext } from '@shared/commands/apply'
import type { Command } from '@shared/commands/types'
import { createEmptyProject } from '@shared/project/factory'
import { toSrt } from '@shared/project/srt'
import type { Project, SynthesisResult, VoiceItem } from '@shared/project/types'

let counter = 0
const ctx: CommandContext = { newId: (prefix) => `${prefix}_${++counter}`, now: () => new Date('2026-01-01T00:00:00Z') }
const apply = (project: Project, commands: Command[]): Project => applyCommands(project, commands, ctx).project

const synthesis: SynthesisResult = { cacheKey: 'k'.repeat(64), audioDurationMs: 1000, lipSync: [], accentPhrases: [] }

/** 合成済みのセリフが1つあるプロジェクト。 */
function oneLine(text = 'くさはえるのだ'): { project: Project; id: string } {
  const created = apply(createEmptyProject(), [
    { op: 'character.create', name: 'ずんだもん', engineId: 'voicevox', speakerId: 3, speakerName: 'ずんだもん' }
  ])
  const characterId = Object.keys(created.characters)[0]!
  const inserted = applyCommands(created, [{ op: 'voice.insert', characterId, text, atMs: 0, tempId: 'l' }], ctx)
  const id = inserted.resolvedIds['l']!
  return { project: apply(inserted.project, [{ op: 'voice.applySynthesis', itemId: id, expectedText: text, synthesis }]), id }
}

const line = (project: Project, id: string): VoiceItem => project.items.find((item) => item.id === id) as VoiceItem

describe('字幕に出す文字(voice.setDisplayText)', () => {
  it('字幕だけ変わり、声(セリフ・合成結果)はそのまま', () => {
    const { project, id } = oneLine()
    const next = apply(project, [{ op: 'voice.setDisplayText', itemId: id, text: '草生えるのだ' }])
    expect(line(next, id)).toMatchObject({ text: 'くさはえるのだ', displayText: '草生えるのだ', subtitleLines: ['草生えるのだ'] })
    expect(line(next, id).synthesis).not.toBeNull()
    expect(toSrt(next)).toContain('草生えるのだ')
    expect(toSrt(next)).not.toContain('くさはえる')
  })

  it('改行位置の手直しは字幕の文字に対して行い、字幕の文字を変えると自動の改行に戻る', () => {
    const { project, id } = oneLine()
    let next = apply(project, [{ op: 'voice.setDisplayText', itemId: id, text: '草生えるのだ' }])
    next = apply(next, [{ op: 'voice.setSubtitleLines', itemId: id, lines: ['草', '生えるのだ'] }])
    expect(line(next, id)).toMatchObject({ subtitleLines: ['草', '生えるのだ'], subtitleLinesManual: true })
    expect(() => apply(next, [{ op: 'voice.setSubtitleLines', itemId: id, lines: ['くさ', 'はえるのだ'] }])).toThrow('一致しません')
    next = apply(next, [{ op: 'voice.setDisplayText', itemId: id, text: 'ｗｗｗ' }])
    expect(line(next, id)).toMatchObject({ subtitleLines: ['ｗｗｗ'], subtitleLinesManual: false })
  })

  it('null やセリフと同じ文字でセリフに戻り、空は断る。セリフを書き換えると外れる', () => {
    const { project, id } = oneLine()
    const set = apply(project, [{ op: 'voice.setDisplayText', itemId: id, text: '草生えるのだ' }])
    expect(line(apply(set, [{ op: 'voice.setDisplayText', itemId: id, text: null }]), id)).toMatchObject({ displayText: null, subtitleLines: ['くさはえるのだ'] })
    expect(line(apply(set, [{ op: 'voice.setDisplayText', itemId: id, text: 'くさはえるのだ' }]), id).displayText).toBeNull()
    expect(() => apply(set, [{ op: 'voice.setDisplayText', itemId: id, text: '  ' }])).toThrow('空です')
    const rewritten = apply(set, [{ op: 'voice.setText', itemId: id, text: 'べつのセリフなのだ' }])
    expect(line(rewritten, id)).toMatchObject({ displayText: null, subtitleLines: ['べつのセリフなのだ'] })
  })

  it('編集AIも字幕だけを変えられる', () => {
    expect(aiCommandSchema.safeParse({ op: 'voice.setDisplayText', itemId: 'itm_1', text: '草' }).success).toBe(true)
    expect(aiCommandSchema.safeParse({ op: 'voice.setDisplayText', itemId: 'itm_1', text: null }).success).toBe(true)
  })
})
