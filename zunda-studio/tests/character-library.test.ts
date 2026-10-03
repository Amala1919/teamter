import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { CharacterLibraryStore } from '../src/main/core/character-library-store'

import { applyCommands, type CommandContext } from '@shared/commands/apply'
import type { Command } from '@shared/commands/types'
import { addSavedCharacterCommands, savedCharacterSchema, savedContent, toSavedCharacter } from '@shared/project/character-library'
import { createEmptyProject } from '@shared/project/factory'
import type { PortraitConfig, Project } from '@shared/project/types'

let counter = 0
const ctx: CommandContext = { newId: (prefix) => `${prefix}_${++counter}`, now: () => new Date('2026-01-01T00:00:00Z') }
const run = (project: Project, commands: Command[]): ReturnType<typeof applyCommands> => applyCommands(project, commands, ctx)

const persona = { personality: '冷静', speechStyle: '語尾は「かしら」', banterRole: 'tsukkomi' as const, forbidden: ['ばか'], targetLengthChars: 30 }

function portraitConfig(assetId: string): PortraitConfig {
  return {
    assetId,
    transform: { x: 1200, y: 200, scale: 0.7, flipX: true, anchor: 'top-left' },
    partGroups: {},
    layerVisibility: { 'layer-1': false },
    expressions: { exp_smile: { id: 'exp_smile', name: '笑顔', selections: {} } as unknown as PortraitConfig['expressions'][string] },
    defaultExpressionId: null,
    lipSync: null,
    blink: null
  }
}

/** 相方(AI)のキャラクターを、声・字幕・立ち絵・色まで作り込んだプロジェクト。 */
function withCharacter(): { project: Project; characterId: string } {
  const result = run(createEmptyProject(), [
    { op: 'asset.add', asset: { type: 'psd', path: { absolute: '/psd/metan.psd', relative: null }, license: { source: '坂本アヒル', creditRequired: true } }, tempId: 'psd' },
    { op: 'style.upsertSubtitle', props: { name: 'めたん', color: '#ffe0f0', fontSizePx: 72 }, tempId: 'style' },
    { op: 'character.create', name: '四国めたん', authorRole: 'ai', persona, engineId: 'voicevox', speakerId: 2, speakerName: '四国めたん(ノーマル)', subtitleStyleId: 'style', creditText: 'VOICEVOX:四国めたん', tempId: 'c' },
    { op: 'character.update', characterId: 'c', voice: { speedScale: 1.2, pitchScale: 0.05 }, timelineColor: '#c84a8a' },
    { op: 'character.setPortrait', characterId: 'c', portrait: portraitConfig('psd') }
  ])
  return { project: result.project, characterId: result.resolvedIds['c']! }
}

describe('アプリに保存したキャラクター', () => {
  it('保存した形から足すと、声・ペルソナ・字幕・立ち絵・色・クレジットまで同じキャラクターになる', () => {
    const { project, characterId } = withCharacter()
    const saved = toSavedCharacter(project, characterId, { id: 'lib_1', autoAdd: true }, new Date('2026-02-01T00:00:00Z'))
    expect(savedCharacterSchema.safeParse(JSON.parse(JSON.stringify(saved))).success).toBe(true)
    expect(saved.portrait?.psd.path).toBe('/psd/metan.psd')

    const added = run(createEmptyProject(), addSavedCharacterCommands(saved))
    const next = added.project
    const copy = next.characters[added.resolvedIds['character']!]!
    const original = project.characters[characterId]!
    expect(copy).toMatchObject({
      name: '四国めたん',
      authorRole: 'ai',
      persona,
      voice: original.voice,
      creditText: 'VOICEVOX:四国めたん',
      creditRequired: true,
      timelineColor: '#c84a8a',
      libraryId: 'lib_1'
    })
    const { id: _a, ...copyStyle } = next.subtitleStyles[copy.subtitleStyleId]!
    const { id: _b, ...originalStyle } = project.subtitleStyles[original.subtitleStyleId]!
    expect(copyStyle).toEqual(originalStyle)
    expect(next.assets[copy.portrait!.assetId]).toMatchObject({ type: 'psd', path: { absolute: '/psd/metan.psd' }, license: { source: '坂本アヒル' } })
    expect({ ...copy.portrait, assetId: '' }).toEqual({ ...original.portrait, assetId: '' })
    // 足し直した形からもう一度保存しても、中身は同じ
    expect(savedContent(toSavedCharacter(next, copy.id, { id: 'lib_1', autoAdd: true }, new Date()))).toBe(savedContent(saved))
  })

  it('複数のキャラクターを1回で足せ、同じ PSD は二重に登録しない', () => {
    const { project, characterId } = withCharacter()
    const saved = toSavedCharacter(project, characterId, { id: 'lib_1', autoAdd: true }, new Date())
    const result = run(createEmptyProject(), [...addSavedCharacterCommands(saved, 'a_'), ...addSavedCharacterCommands({ ...saved, id: 'lib_2', name: '二人目' }, 'b_')])
    expect(Object.values(result.project.characters).map((character) => character.name).sort()).toEqual(['二人目', '四国めたん'])
    expect(Object.values(result.project.assets).filter((asset) => asset.type === 'psd')).toHaveLength(1)
  })

  it('立ち絵の無い・あなたの役のキャラクターも保存でき、壊れた保存は弾く', () => {
    const result = run(createEmptyProject(), [{ op: 'character.create', name: 'ずんだもん', engineId: 'voicevox', speakerId: 3, speakerName: 'ずんだもん', tempId: 'z' }])
    const saved = toSavedCharacter(result.project, result.resolvedIds['z']!, { id: 'lib_z', autoAdd: false }, new Date())
    expect(saved).toMatchObject({ authorRole: 'user', persona: null, portrait: null, autoAdd: false })
    const added = run(createEmptyProject(), addSavedCharacterCommands(saved))
    expect(added.project.characters[added.resolvedIds['character']!]).toMatchObject({ name: 'ずんだもん', authorRole: 'user', libraryId: 'lib_z' })
    expect(savedCharacterSchema.safeParse({ ...saved, name: '' }).success).toBe(false)
    expect(savedCharacterSchema.safeParse({ ...saved, voice: null }).success).toBe(false)
  })
})

describe('アプリに保存したキャラクターの置き場(main)', () => {
  it('保存・上書き・削除がファイルに残り、立ち絵の PSD は読み込みを許可する', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'zunda-library-')), 'characters.json')
    const allowed: string[] = []
    const store = new CharacterLibraryStore(file, (path) => allowed.push(path))
    expect(await store.load()).toEqual([])

    const { project, characterId } = withCharacter()
    const saved = toSavedCharacter(project, characterId, { id: 'lib_1', autoAdd: true }, new Date())
    expect((await store.save(saved)).map((entry) => entry.name)).toEqual(['四国めたん'])
    expect(allowed).toContain('/psd/metan.psd')
    await store.save({ ...saved, name: 'めたん(改)', autoAdd: false })
    await store.save({ ...saved, id: 'lib_2', name: '二人目', portrait: null })

    // 読み直しても残っている
    const reloaded = new CharacterLibraryStore(file, () => {})
    expect((await reloaded.load()).map((entry) => [entry.id, entry.name, entry.autoAdd])).toEqual([
      ['lib_1', 'めたん(改)', false],
      ['lib_2', '二人目', true]
    ])
    expect((await reloaded.remove('lib_1')).map((entry) => entry.id)).toEqual(['lib_2'])
    await expect(reloaded.save({ ...saved, name: '' })).rejects.toThrow('形が不正')
  })

  it('壊れた項目だけ飛ばして読み、ファイルが壊れていても空で始める', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'zunda-library-'))
    const file = join(directory, 'characters.json')
    const { project, characterId } = withCharacter()
    const saved = toSavedCharacter(project, characterId, { id: 'lib_ok', autoAdd: true }, new Date())
    writeFileSync(file, JSON.stringify({ version: 1, characters: [saved, { id: 'broken' }] }))
    expect((await new CharacterLibraryStore(file, () => {}).load()).map((entry) => entry.id)).toEqual(['lib_ok'])
    writeFileSync(file, '{ not json')
    expect(await new CharacterLibraryStore(file, () => {}).load()).toEqual([])
  })
})
