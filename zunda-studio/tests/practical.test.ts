import { describe, expect, it } from 'vitest'

import { EventBus } from '@main/core/events'
import { AutosaveService } from '@main/services/project/autosave'
import { EngineManager } from '@main/services/voice/engine-manager'
import { SynthesisService } from '@main/services/voice/synthesis-service'
import { applyCommands, type CommandContext } from '@shared/commands/apply'
import type { Command } from '@shared/commands/types'
import { createEmptyProject } from '@shared/project/factory'
import { synthesisSignature } from '@shared/project/queries'
import { srtTime, toSrt } from '@shared/project/srt'
import type { AccentPhrase, Project, VoiceItem } from '@shared/project/types'
import { accentPhrasesToKana } from '@shared/voice/kana'

import { startMockVoicevox } from './fixtures/mock-voicevox.mjs'
import { settingsWith, tempDir } from './helpers/env'

let counter = 0
const context = (): CommandContext => ({ newId: (prefix) => `${prefix}_${++counter}`, now: () => new Date('2026-01-01T00:00:00Z') })
const apply = (project: Project, commands: Command[]): Project => applyCommands(project, commands, context()).project

function withLine(text = 'こんにちは'): { project: Project; line: VoiceItem } {
  const project = apply(createEmptyProject(), [
    { op: 'character.create', name: 'ずんだもん', engineId: 'voicevox', speakerId: 3, speakerName: 'ずんだもん', tempId: 'z' },
    { op: 'voice.insert', characterId: 'z', text, atMs: 0 }
  ])
  return { project, line: project.items.find((item): item is VoiceItem => item.type === 'voice')! }
}

const mora = (text: string, vowel: string): AccentPhrase['moras'][number] => ({ text, consonant: null, consonantLength: null, vowel, vowelLength: 0.1, pitch: 5 })

describe('読み方の表記(カタカナとアクセント記号)', () => {
  it('アクセントの位置・区切り・息継ぎ・無声化・疑問を書き分ける', () => {
    const phrases: AccentPhrase[] = [
      { moras: [mora('コ', 'o'), mora('ン', 'N'), mora('ニ', 'i'), mora('チ', 'i'), mora('ワ', 'a')], accent: 5, pauseMora: null, isInterrogative: false },
      { moras: [mora('キ', 'I'), mora('ョ', 'o'), mora('ウ', 'u')], accent: 1, pauseMora: mora('、', 'pau'), isInterrogative: false },
      { moras: [mora('ホ', 'o'), mora('ン', 'N'), mora('ト', 'o')], accent: 1, pauseMora: null, isInterrogative: true }
    ]
    expect(accentPhrasesToKana(phrases)).toBe("コンニチワ'/_キ'ョウ、ホ'ント？")
  })
})

describe('読み方の上書きと、辞書を変えたときの合成し直し', () => {
  it('読みを直すと合成し直しになり、テキストを書き換えると読みの上書きは外れる', () => {
    const { project, line } = withLine()
    const synthesized = apply(project, [
      { op: 'voice.applySynthesis', itemId: line.id, expectedText: 'こんにちは', synthesis: { cacheKey: 'k', audioDurationMs: 800, accentPhrases: [], lipSync: [] } }
    ])
    const before = synthesisSignature(synthesized, synthesized.items[0] as VoiceItem)
    const reread = apply(synthesized, [{ op: 'voice.setReading', itemId: line.id, reading: "コンニチワ'" }])
    const item = reread.items[0] as VoiceItem
    expect(item).toMatchObject({ reading: "コンニチワ'", synthesis: null })
    expect(synthesisSignature(reread, item)).not.toBe(before)
    expect(() => apply(synthesized, [{ op: 'voice.setReading', itemId: line.id, reading: 'hello' }])).toThrow('カタカナ')
    const rewritten = apply(reread, [{ op: 'voice.setText', itemId: line.id, text: 'さようなら' }])
    expect((rewritten.items[0] as VoiceItem).reading).toBeNull()
  })

  it('辞書を変えたら、その音声エンジンのセリフだけ合成し直す', () => {
    const { project, line } = withLine()
    const other = apply(project, [
      { op: 'character.create', name: 'つむぎ', engineId: 'aivis', speakerId: 8, speakerName: 'つむぎ', tempId: 't' },
      { op: 'voice.insert', characterId: 't', text: 'やあ', atMs: 3000 }
    ])
    const synthesis = { cacheKey: 'k', audioDurationMs: 500, accentPhrases: [], lipSync: [] }
    const both = apply(
      other,
      other.items.filter((item): item is VoiceItem => item.type === 'voice').map((item) => ({ op: 'voice.applySynthesis' as const, itemId: item.id, expectedText: item.text, synthesis }))
    )
    const invalidated = apply(both, [{ op: 'voice.invalidateSynthesis', engineId: 'voicevox' }])
    const lines = invalidated.items.filter((item): item is VoiceItem => item.type === 'voice')
    expect(lines.find((item) => item.id === line.id)!.synthesis).toBeNull()
    expect(lines.find((item) => item.id !== line.id)!.synthesis).not.toBeNull()
  })

  it('辞書に語を登録した後は、同じ文でもエンジンに読みを聞き直す(古い読みを使い回さない)', async () => {
    const mock = await startMockVoicevox()
    try {
      const settings = settingsWith({ voice: { engines: [{ id: 'voicevox', label: 'VOICEVOX', url: mock.url, executablePath: null, autoLaunch: false }] } })
      const engines = new EngineManager(() => settings, new EventBus())
      const synthesis = new SynthesisService(engines, await tempDir('zs-dict-'))
      const request = { engineId: 'voicevox', speakerId: 3, text: 'まおうじょう', params: { speedScale: 1, pitchScale: 0, intonationScale: 1, volumeScale: 1, prePhonemeLength: 0.1, postPhonemeLength: 0.1 } }
      const first = await synthesis.synthesize(request)
      const cached = await synthesis.synthesize(request)
      expect(cached.cacheKey).toBe(first.cacheKey)

      await (await engines.require('voicevox')).addUserDictWord({ surface: 'まおうじょう', pronunciation: 'マ', accentType: 1, priority: 5 })
      await synthesis.bumpDictionary('voicevox')
      const after = await synthesis.synthesize(request)
      expect(after.cacheKey).not.toBe(first.cacheKey)
      expect(after.audioDurationMs).toBeLessThan(first.audioDurationMs)
    } finally {
      await mock.close()
    }
  })
})

describe('SRT', () => {
  it('セリフごとに、画面と同じ改行で書き出す', () => {
    const { project, line } = withLine('今日はこのゲームをやっていくのだ')
    const synthesized = apply(project, [
      { op: 'voice.applySynthesis', itemId: line.id, expectedText: line.text, synthesis: { cacheKey: 'k', audioDurationMs: 3_723_456, accentPhrases: [], lipSync: [] } },
      { op: 'voice.setSubtitleLines', itemId: line.id, lines: ['今日はこのゲームを', 'やっていくのだ'] }
    ])
    expect(toSrt(synthesized)).toBe(`1\n00:00:00,000 --> ${srtTime(3_723_456)}\n今日はこのゲームを\nやっていくのだ\n`)
    expect(srtTime(3_723_456)).toBe('01:02:03,456')
    expect(toSrt(synthesized, { withSpeaker: true })).toContain('ずんだもん: 今日はこのゲームを')
  })
})

describe('自動保存', () => {
  it('書いて・一覧して・読み戻し・消せる。キーは決まった形だけ', async () => {
    const service = new AutosaveService(await tempDir('zs-autosave-'))
    const { project } = withLine()
    await service.write('edit_abcdef123', '/p/a.zsproj', project)
    expect(await service.list()).toEqual([expect.objectContaining({ key: 'edit_abcdef123', filePath: '/p/a.zsproj', title: '無題のプロジェクト' })])
    expect((await service.read('edit_abcdef123')).items).toHaveLength(1)
    await service.clear('edit_abcdef123')
    expect(await service.list()).toEqual([])
    await expect(service.write('../../x', null, project)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
  })
})
