import { mkdtempSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { TemplateStore } from '@main/core/template-store'
import { applyCommands } from '@shared/commands/apply'
import type { Command } from '@shared/commands/types'
import { createEmptyProject } from '@shared/project/factory'
import { templateFromItems } from '@shared/project/templates'
import type { Project, TextItem, VoiceItem } from '@shared/project/types'

let counter = 0
const ctx = { newId: (prefix: string) => `${prefix}_${++counter}`, now: () => new Date('2026-01-01T00:00:00Z') }

function apply(project: Project, commands: Command[]): Project {
  return applyCommands(project, commands, ctx).project
}

const META = { id: 'tpl_1', name: 'オープニング', kind: 'opening' as const, autoAdd: true, createdAt: '2026-01-01T00:00:00Z' }

/** ロゴ(画像)・テロップ・ジングル(音)・あいさつのセリフを並べたプロジェクト。 */
function source(): Project {
  let project = apply(createEmptyProject(), [
    { op: 'character.create', name: 'ずんだもん', engineId: 'voicevox', speakerId: 3, speakerName: 'ずんだもん' },
    { op: 'asset.add', asset: { type: 'image', path: { absolute: '/x/logo.png', relative: null }, width: 400, height: 200, license: { source: '自作', creditRequired: false } }, tempId: 'logo' },
    { op: 'asset.add', asset: { type: 'audio', path: { absolute: '/x/jingle.mp3', relative: null }, durationMs: 3000, license: { source: '魔王魂', creditRequired: true, creditText: '魔王魂' } }, tempId: 'jingle' },
    { op: 'media.placeImage', assetId: 'logo', atMs: 10_000, durationMs: 3000 },
    { op: 'media.placeAudio', assetId: 'jingle', atMs: 10_000 },
    { op: 'media.placeText', text: 'ゲーム実況', atMs: 11_000, durationMs: 2000 }
  ])
  const characterId = Object.keys(project.characters)[0]!
  project = apply(project, [{ op: 'voice.insert', characterId, text: 'はじまるのだ', atMs: 12_000 }])
  return project
}

function sourceTemplate(): ReturnType<typeof templateFromItems> & object {
  const project = source()
  return templateFromItems(project, project.items.map((item) => item.id), META)!
}

describe('ひな形(オープニング・エンディング)', () => {
  it('選んだ素材を、頭を 0 にした並びで、素材・スタイル・キャラクターごと保存する', () => {
    const project = source()
    const template = templateFromItems(project, project.items.map((item) => item.id), META)!
    expect(template.durationMs).toBe(3000)
    expect(template.items.map((item) => [item.type, item.startMs])).toEqual([
      ['image', 0],
      ['audio', 0],
      ['text', 1000],
      ['voice', 2000]
    ])
    expect(Object.values(template.assets).map((asset) => asset.path.absolute).sort()).toEqual(['/x/jingle.mp3', '/x/logo.png'])
    expect(template.characters).toEqual([{ id: Object.keys(project.characters)[0], name: 'ずんだもん' }])
    expect(templateFromItems(project, [], META)).toBeNull()
  })

  it('別のプロジェクトの先頭に入れると、後ろがずれ、素材が登録され、同じ名前のキャラクターのセリフになる', () => {
    const template = sourceTemplate()
    let target = apply(createEmptyProject(), [
      { op: 'character.create', name: 'ずんだもん', engineId: 'voicevox', speakerId: 3, speakerName: 'ずんだもん' },
      { op: 'media.placeText', text: '本編', atMs: 0, durationMs: 5000 }
    ])
    const characterId = Object.keys(target.characters)[0]!
    target = apply(target, [{ op: 'template.insert', template, atMs: 0, ripple: true, tempIdPrefix: 't' }])
    expect(target.items.find((item) => item.type === 'text' && (item as TextItem).text === '本編')!.startMs).toBe(3000)
    expect(Object.values(target.assets).map((asset) => asset.path.absolute).sort()).toEqual(['/x/jingle.mp3', '/x/logo.png'])
    const voice = target.items.find((item): item is VoiceItem => item.type === 'voice')!
    expect(voice).toMatchObject({ characterId, startMs: 2000, text: 'はじまるのだ' })
    // 2回目は同じ素材を使い回す(素材を二重に登録しない)。
    target = apply(target, [{ op: 'template.insert', template, atMs: 20_000, ripple: false }])
    expect(Object.keys(target.assets)).toHaveLength(2)
  })

  it('キャラクターがいないプロジェクトでは、セリフだけ入れない', () => {
    const template = sourceTemplate()
    const target = apply(createEmptyProject(), [{ op: 'template.insert', template, atMs: 0 }])
    expect(target.items.map((item) => item.type).sort()).toEqual(['audio', 'image', 'text'])
  })

  it('アプリに保存し、読み直しても同じで、素材の読み込みを許可する', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'zs-templates-')), 'templates.json')
    const allowed: string[] = []
    const store = new TemplateStore(file, (path) => allowed.push(path))
    await store.load()
    const template = sourceTemplate()
    await store.save(template)
    expect(allowed.sort()).toEqual(['/x/jingle.mp3', '/x/logo.png'])
    const reloaded = new TemplateStore(file, () => undefined)
    expect(await reloaded.load()).toEqual([template])
    expect(JSON.parse(await readFile(file, 'utf8')).version).toBe(1)
    await expect(store.save({ ...template, items: [] })).rejects.toThrow('ひな形の形が不正')
    expect(await store.remove(template.id)).toEqual([])
  })
})
