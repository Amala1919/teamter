import { describe, expect, it } from 'vitest'

import { aiCommandSchema } from '@shared/ai/edit-commands'
import { gainEnvelope, mixGain } from '@shared/audio/envelope'
import { applyCommands, type CommandContext } from '@shared/commands/apply'
import type { Command } from '@shared/commands/types'
import { createEmptyProject } from '@shared/project/factory'
import type { AudioItem, Project } from '@shared/project/types'

let counter = 0
const ctx: CommandContext = { newId: (prefix) => `${prefix}_${++counter}`, now: () => new Date('2026-01-01T00:00:00Z') }
const apply = (project: Project, commands: Command[]): Project => applyCommands(project, commands, ctx).project

describe('全体の音量(project.setMix)', () => {
  it('つまみを足していき、null や 100% で消える。範囲外は断る', () => {
    let project = apply(createEmptyProject(), [{ op: 'project.setMix', master: 0.8, music: 0.5 }])
    expect(project.mix).toEqual({ master: 0.8, music: 0.5 })
    project = apply(project, [{ op: 'project.setMix', voice: 1.2, music: null }])
    expect(project.mix).toEqual({ master: 0.8, voice: 1.2 })
    project = apply(project, [{ op: 'project.setMix', master: 1, voice: null }])
    expect(project.mix).toBeUndefined()
    expect(() => apply(project, [{ op: 'project.setMix', master: 3 }])).toThrow('0〜200%')
    expect(() => apply(project, [{ op: 'project.setMix', video: -0.1 }])).toThrow('0〜200%')
  })

  it('全体 × 種類ごとの倍率を、BGM・効果音と動画の音量の折れ線に掛ける', () => {
    const project = apply(createEmptyProject(), [
      {
        op: 'asset.add',
        asset: { type: 'audio', path: { absolute: '/bgm.mp3', relative: null }, license: { source: 'x', creditRequired: false }, durationMs: 10_000 },
        tempId: 'a'
      },
      { op: 'media.placeAudio', assetId: 'a', atMs: 0, durationMs: 5000, volume: 0.8, duckable: false },
      { op: 'project.setMix', master: 0.5, music: 1.5, voice: 0.4 }
    ])
    const bgm = project.items.find((item): item is AudioItem => item.type === 'audio')!
    expect(mixGain(project, 'music')).toBeCloseTo(0.75)
    expect(mixGain(project, 'voice')).toBeCloseTo(0.2)
    expect(mixGain(project, 'video')).toBeCloseTo(0.5)
    expect(gainEnvelope(project, bgm).every((point) => Math.abs(point.gain - 0.8 * 0.75) < 1e-9)).toBe(true)
    expect(mixGain(createEmptyProject(), 'voice')).toBe(1)
  })

  it('編集AIも音量を変えられる', () => {
    expect(aiCommandSchema.safeParse({ op: 'project.setMix', music: 0.6 }).success).toBe(true)
    expect(aiCommandSchema.safeParse({ op: 'project.setMix', master: 5 }).success).toBe(false)
  })
})
