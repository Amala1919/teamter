import { describe, expect, it } from 'vitest'

import { applyCommands, type CommandContext } from '@shared/commands/apply'
import type { Command } from '@shared/commands/types'
import { createEmptyProject } from '@shared/project/factory'
import { characterTimelineColor, timelineColor } from '@shared/project/timeline-colors'
import type { Project } from '@shared/project/types'

const ctx = (() => {
  let counter = 0
  return { newId: (prefix: string) => `${prefix}_${++counter}`, now: () => new Date('2026-01-01T00:00:00Z') } satisfies CommandContext
})()
const apply = (project: Project, commands: Command[]): Project => applyCommands(project, commands, ctx).project

function twoCharacters(): { project: Project; a: string; b: string; lineA: string; lineB: string } {
  const project = apply(createEmptyProject(), [
    { op: 'character.create', name: 'ずんだもん', engineId: 'voicevox', speakerId: 3, speakerName: 'ずんだもん', tempId: 'a' },
    { op: 'character.create', name: '四国めたん', engineId: 'voicevox', speakerId: 2, speakerName: '四国めたん', tempId: 'b' }
  ])
  const [a, b] = Object.keys(project.characters) as [string, string]
  const withLines = apply(project, [
    { op: 'voice.insert', characterId: a, text: 'こんにちは', atMs: 0, tempId: 'l1' },
    { op: 'voice.insert', characterId: b, text: 'やあ', atMs: 5000, tempId: 'l2' }
  ])
  const [lineA, lineB] = withLines.items.filter((item) => item.type === 'voice').map((item) => item.id) as [string, string]
  return { project: withLines, a, b, lineA, lineB }
}

describe('キャラクターごとのタイムラインの色', () => {
  it('色を決めていなければ、キャラクターごとに違う色でセリフを描く', () => {
    const { project, a, b, lineA, lineB } = twoCharacters()
    expect(characterTimelineColor(project.characters, a)).not.toBe(characterTimelineColor(project.characters, b))
    const colorOf = (id: string): string | null => timelineColor(project, project.items.find((item) => item.id === id)!)
    expect(colorOf(lineA)).toBe(characterTimelineColor(project.characters, a))
    expect(colorOf(lineB)).toBe(characterTimelineColor(project.characters, b))
    expect(colorOf(lineA)).not.toBe(colorOf(lineB))
  })

  it('設定した色が使われ、自動に戻せる。不正な色は断る', () => {
    const { project, a, lineA } = twoCharacters()
    const colored = apply(project, [{ op: 'character.update', characterId: a, timelineColor: '#AA33CC' }])
    expect(colored.characters[a]!.timelineColor).toBe('#aa33cc')
    expect(timelineColor(colored, colored.items.find((item) => item.id === lineA)!)).toBe('#aa33cc')
    const reset = apply(colored, [{ op: 'character.update', characterId: a, timelineColor: null }])
    expect(reset.characters[a]!.timelineColor).toBeUndefined()
    expect(() => apply(project, [{ op: 'character.update', characterId: a, timelineColor: 'red' }])).toThrow('色の指定が不正')
  })

  it('優先順位は 素材の色 > キャラクターに設定した色 > レイヤーの色 > 自動の色。セリフ以外はキャラクターの色に影響されない', () => {
    const { project, a, lineA } = twoCharacters()
    const layerId = project.items.find((item) => item.id === lineA)!.layerId
    const auto = characterTimelineColor(project.characters, a)
    const withLayer = apply(project, [{ op: 'layer.update', layerId, color: '#112233' }])
    // 設定した色が無ければ、レイヤーの色が自動の色より先
    expect(timelineColor(withLayer, withLayer.items.find((item) => item.id === lineA)!)).toBe('#112233')
    const both = apply(withLayer, [{ op: 'character.update', characterId: a, timelineColor: '#445566' }])
    expect(timelineColor(both, both.items.find((item) => item.id === lineA)!)).toBe('#445566')
    const own = apply(both, [{ op: 'item.setColor', itemIds: [lineA], color: '#778899' }])
    expect(timelineColor(own, own.items.find((item) => item.id === lineA)!)).toBe('#778899')
    expect(auto).not.toBeNull()
    // セリフ以外(テロップ)は、キャラクターの色を使わない
    const text = apply(project, [{ op: 'media.placeText', text: 'テロップ', atMs: 0, durationMs: 1000, tempId: 't' }])
    expect(timelineColor(text, text.items.find((item) => item.type === 'text')!)).toBeNull()
  })
})
