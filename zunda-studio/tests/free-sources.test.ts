import { describe, expect, it } from 'vitest'

import { applyCommands, type CommandContext } from '@shared/commands/apply'
import type { Command } from '@shared/commands/types'
import { detectFreeSource, FREE_SOURCES, freeSource, licenseFromSource } from '@shared/media/free-sources'
import { generateCredits } from '@shared/project/credits'
import { createEmptyProject } from '@shared/project/factory'
import type { AssetLicense, Project } from '@shared/project/types'

let counter = 0
const context = (): CommandContext => ({ newId: (prefix) => `${prefix}_${++counter}`, now: () => new Date('2026-01-01T00:00:00Z') })
const apply = (project: Project, commands: Command[]): Project => applyCommands(project, commands, context()).project

function withAudio(files: { name: string; license: AssetLicense }[]): Project {
  const commands: Command[] = []
  files.forEach((file, index) => {
    commands.push(
      {
        op: 'asset.add',
        asset: { type: 'audio', path: { absolute: `/bgm/${file.name}`, relative: null }, license: file.license, durationMs: 5000 },
        tempId: `a${index}`
      },
      { op: 'media.placeAudio', assetId: `a${index}`, atMs: index * 5000, durationMs: 5000 }
    )
  })
  return apply(createEmptyProject(), commands)
}

describe('フリー素材サイトの一覧', () => {
  it('どのサイトも規約の場所・表記の例・注意を持ち、ID が重ならない', () => {
    expect(new Set(FREE_SOURCES.map((source) => source.id)).size).toBe(FREE_SOURCES.length)
    for (const source of FREE_SOURCES) {
      expect(source.url).toMatch(/^https:\/\//)
      expect(source.termsUrl).toMatch(/^https:\/\//)
      expect(source.creditText.trim()).not.toBe('')
      expect(source.notes.length).toBeGreaterThan(0)
    }
    // 戦争・歴史もの向きのサイトもある
    expect(FREE_SOURCES.filter((source) => source.epic).length).toBeGreaterThanOrEqual(2)
  })

  it('ファイル名からサイトを推し量る(分からなければ推し量らない)', () => {
    expect(detectFreeSource('maou_bgm_orchestra20.mp3')?.id).toBe('maoudamashii')
    expect(detectFreeSource('MusMus-BGM-120.mp3')?.id).toBe('musmus')
    expect(detectFreeSource('PerituneMaterial_Epic3.mp3')?.id).toBe('peritune')
    expect(detectFreeSource('nc123456_ゆっくりBGM.mp3')?.id).toBe('niconi-commons')
    expect(detectFreeSource('決定ボタンを押す.mp3')).toBeUndefined()
  })

  it('サイトを選ぶと入手元・表記が埋まり、必要なものは必ず、任意のものは既定で概要欄に載る', () => {
    const maou = licenseFromSource(freeSource('maoudamashii')!, 'maou_bgm_orchestra20.mp3')
    expect(maou).toMatchObject({ sourceId: 'maoudamashii', creditRequired: true, creditText: '音楽: 魔王魂' })
    const dova = licenseFromSource(freeSource('dova')!, 'ほのぼの日常.mp3')
    expect(dova).toMatchObject({ creditRequired: false, creditOptIn: true, creditText: 'BGM: DOVA-SYNDROME「ほのぼの日常」' })
    const lab = { ...licenseFromSource(freeSource('soundeffect-lab')!, 'ボタン.mp3'), creditOptIn: false }

    const project = withAudio([
      { name: 'maou_bgm_orchestra20.mp3', license: maou },
      { name: 'ほのぼの日常.mp3', license: dova },
      { name: 'ボタン.mp3', license: lab }
    ])
    const { text, issues } = generateCredits(project)
    expect(text).toContain('【BGM・効果音】')
    expect(text).toContain('音楽: 魔王魂')
    expect(text).toContain('BGM: DOVA-SYNDROME「ほのぼの日常」')
    // 任意で、載せないと決めたものは載せない
    expect(text).not.toContain('効果音ラボ')
    expect(issues).toEqual([])
  })

  it('素材ごとに違うサイトは、表記が必要な扱いにして確認を促す', () => {
    const commons = licenseFromSource(freeSource('niconi-commons')!, 'nc123456_ジングル.mp3')
    expect(commons).toMatchObject({ creditRequired: true, creditText: 'nc123456_ジングル(ニコニ・コモンズ)' })
  })
})
