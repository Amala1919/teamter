import { describe, expect, it } from 'vitest'

import { applyCommands, type CommandContext } from '@shared/commands/apply'
import type { Command } from '@shared/commands/types'
import { createEmptyProject, DEFAULT_LAYER_IDS } from '@shared/project/factory'
import type { Item, Project } from '@shared/project/types'

let counter = 0
const context = (): CommandContext => ({ newId: (prefix) => `${prefix}_${++counter}`, now: () => new Date('2026-01-01T00:00:00Z') })
const run = (project: Project, commands: Command[]): ReturnType<typeof applyCommands> => applyCommands(project, commands, context())
const apply = (project: Project, commands: Command[]): Project => run(project, commands).project

/** ずんだもんとめたん、効果音の素材。セリフは詰めずに好きな時刻に置けるようにする。 */
function base(): { project: Project; zunda: string; metan: string } {
  const result = run(createEmptyProject(), [
    { op: 'project.setEditing', rippleOnVoiceChange: false },
    { op: 'character.create', name: 'ずんだもん', engineId: 'voicevox', speakerId: 3, speakerName: 'ずんだもん', tempId: 'z' },
    { op: 'character.create', name: '四国めたん', engineId: 'voicevox', speakerId: 2, speakerName: '四国めたん', tempId: 'm' },
    {
      op: 'asset.add',
      asset: { type: 'audio', path: { absolute: '/se/pon.mp3', relative: null }, license: { source: 'x', creditRequired: false }, durationMs: 5000 },
      tempId: 'se'
    }
  ])
  return { project: result.project, zunda: result.resolvedIds['z']!, metan: result.resolvedIds['m']! }
}

const layerOf = (project: Project, item: Item | undefined): string => project.layers.find((layer) => layer.id === item?.layerId)?.name ?? '?'
const voices = (project: Project): Item[] => project.items.filter((item) => item.type === 'voice')
const line = (project: Project, text: string): Item => project.items.find((item) => item.type === 'voice' && item.text === text)!

describe('重なりの自動振り分け', () => {
  it('同じ時間のセリフは別のボイスのレイヤーへ移り、同じキャラクターのセリフは同じレイヤーにまとまる', () => {
    const { project, zunda, metan } = base()
    let next = apply(project, [{ op: 'voice.insert', characterId: zunda, text: 'ずんだ1', atMs: 0 }])
    next = apply(next, [{ op: 'voice.insert', characterId: metan, text: 'めたん1', atMs: 100 }])
    expect(layerOf(next, line(next, 'ずんだ1'))).toBe('ボイス')
    expect(layerOf(next, line(next, 'めたん1'))).toBe('ボイス 2')
    // 新しいレイヤーは元のすぐ上にできる
    const voice = next.layers.find((layer) => layer.id === DEFAULT_LAYER_IDS.voice)!
    expect(next.layers.find((layer) => layer.name === 'ボイス 2')!.index).toBe(voice.index + 1)

    // めたんのセリフがまた重なったら、めたんのいるレイヤーへ(レイヤーは増えない)
    next = apply(next, [{ op: 'voice.insert', characterId: zunda, text: 'ずんだ2', atMs: 5000 }])
    next = apply(next, [{ op: 'voice.insert', characterId: metan, text: 'めたん2', atMs: 5100 }])
    expect(layerOf(next, line(next, 'めたん2'))).toBe('ボイス 2')
    expect(next.layers).toHaveLength(project.layers.length + 1)

    // 重ならなければ、これまでどおり既定のレイヤーに置く
    next = apply(next, [{ op: 'voice.insert', characterId: metan, text: 'めたん3', atMs: 20_000 }])
    expect(layerOf(next, line(next, 'めたん3'))).toBe('ボイス')
    expect(voices(next)).toHaveLength(5)
  })

  it('効果音を重ねると、空いている音のレイヤーへ移る。3つ重なれば3段になる', () => {
    const { project } = base()
    const se = Object.keys(project.assets)[0]!
    const place = (atMs: number): Command => ({ op: 'media.placeAudio', assetId: se, atMs, durationMs: 1000 })
    const next = apply(project, [place(0), place(500), place(800)])
    const audio = next.items.filter((item) => item.type === 'audio')
    expect(audio.map((item) => layerOf(next, item))).toEqual(['BGM', 'BGM 2', 'BGM 3'])
  })

  it('動かした方が移り、動かしていない素材はそのまま。重ならない場所へ動かせば元のレイヤーのまま', () => {
    const { project, zunda } = base()
    let next = apply(project, [
      { op: 'voice.insert', characterId: zunda, text: 'A', atMs: 0 },
      { op: 'voice.insert', characterId: zunda, text: 'B', atMs: 10_000 }
    ])
    const b = line(next, 'B')
    next = apply(next, [{ op: 'item.setTimeRange', itemId: b.id, startMs: 200 }])
    expect(layerOf(next, line(next, 'A'))).toBe('ボイス')
    expect(layerOf(next, line(next, 'B'))).toBe('ボイス 2')
    // 空いている場所へ戻して、ボイスのレイヤーへ移せば重ならない
    next = apply(next, [
      { op: 'item.setTimeRange', itemId: b.id, startMs: 10_000 },
      { op: 'item.setLayer', itemId: b.id, layerId: DEFAULT_LAYER_IDS.voice }
    ])
    expect(layerOf(next, line(next, 'B'))).toBe('ボイス')
  })

  it('既にあった重なりは、ほかの編集のついでには動かさない。「重なりを整理」でまとめて振り分ける', () => {
    const { project, zunda, metan } = base()
    // 振り分けを切って重ねる(これまでのプロジェクトの状態)
    let next = apply(project, [
      { op: 'project.setEditing', avoidOverlap: false },
      { op: 'voice.insert', characterId: zunda, text: 'A', atMs: 0 },
      { op: 'voice.insert', characterId: metan, text: 'B', atMs: 100 }
    ])
    expect(layerOf(next, line(next, 'B'))).toBe('ボイス')
    next = apply(next, [{ op: 'project.setEditing', avoidOverlap: true }])
    // 全体をずらしても、元からの重なりは動かさない
    next = apply(next, [{ op: 'timeline.insertGap', atMs: 0, durationMs: 1000 }])
    expect(layerOf(next, line(next, 'B'))).toBe('ボイス')

    next = apply(next, [{ op: 'timeline.arrangeOverlaps' }])
    expect(layerOf(next, line(next, 'A'))).toBe('ボイス')
    expect(layerOf(next, line(next, 'B'))).toBe('ボイス 2')
  })

  it('振り分けを切っていれば重ねたまま。ズームは重なっても動かさない', () => {
    const { project, zunda } = base()
    const off = apply(project, [
      { op: 'project.setEditing', avoidOverlap: false },
      { op: 'voice.insert', characterId: zunda, text: 'A', atMs: 0 },
      { op: 'voice.insert', characterId: zunda, text: 'B', atMs: 100 }
    ])
    expect(voices(off).every((item) => item.layerId === DEFAULT_LAYER_IDS.voice)).toBe(true)

    const scenes = apply(project, [
      { op: 'zoom.insert', atMs: 0, durationMs: 3000, region: { x: 0, y: 0, width: 960 } },
      { op: 'zoom.insert', atMs: 1000, durationMs: 3000, region: { x: 0, y: 0, width: 960 } }
    ])
    expect(scenes.items.filter((item) => item.type === 'zoom').every((item) => item.layerId === DEFAULT_LAYER_IDS.zoom)).toBe(true)
    expect(scenes.layers).toHaveLength(project.layers.length)
  })

  it('見えない・ロックしたレイヤーには移さない。すぐ隣の空のレイヤーは使う', () => {
    const { project, zunda } = base()
    let next = apply(project, [
      { op: 'voice.insert', characterId: zunda, text: 'A', atMs: 0 },
      { op: 'voice.insert', characterId: zunda, text: 'B', atMs: 100 }
    ])
    const second = next.layers.find((layer) => layer.name === 'ボイス 2')!
    next = apply(next, [{ op: 'layer.update', layerId: second.id, locked: true }])
    next = apply(next, [{ op: 'voice.insert', characterId: zunda, text: 'C', atMs: 200 }])
    expect(layerOf(next, line(next, 'C'))).toBe('ボイス 3')

    // すぐ上に空のレイヤーを作っておけば、そこを使う
    const { project: fresh, zunda: z } = base()
    const voice = fresh.layers.find((layer) => layer.id === DEFAULT_LAYER_IDS.voice)!
    let withEmpty = apply(fresh, [{ op: 'layer.insert', name: '掛け合い', index: voice.index + 1 }])
    withEmpty = apply(withEmpty, [
      { op: 'voice.insert', characterId: z, text: 'A', atMs: 0 },
      { op: 'voice.insert', characterId: z, text: 'B', atMs: 100 }
    ])
    expect(layerOf(withEmpty, line(withEmpty, 'B'))).toBe('掛け合い')
  })

  it('空のレイヤーを消す(既定のレイヤーは残す)', () => {
    const { project, zunda } = base()
    let next = apply(project, [
      { op: 'voice.insert', characterId: zunda, text: 'A', atMs: 0 },
      { op: 'voice.insert', characterId: zunda, text: 'B', atMs: 100 }
    ])
    expect(next.layers).toHaveLength(project.layers.length + 1)
    next = apply(next, [{ op: 'item.delete', itemId: line(next, 'B').id }, { op: 'layer.removeEmpty' }])
    expect(next.layers.map((layer) => layer.id).sort()).toEqual(project.layers.map((layer) => layer.id).sort())
    // 並びの番号は詰め直す
    expect(next.layers.map((layer) => layer.index).sort()).toEqual(project.layers.map((_, index) => index))
  })
})

describe('タイムラインの色', () => {
  it('素材の色 > レイヤーの色 > (セリフは)キャラクターの自動の色の順に決まり、戻せる', async () => {
    const { timelineColor, characterTimelineColor } = await import('@shared/project/timeline-colors')
    const { project, zunda } = base()
    let next = apply(project, [
      { op: 'voice.insert', characterId: zunda, text: 'A', atMs: 0 },
      { op: 'voice.insert', characterId: zunda, text: 'B', atMs: 5000 }
    ])
    const [a, b] = voices(next)
    // セリフは、色を決めていなければキャラクターごとの自動の色
    const auto = characterTimelineColor(next.characters, zunda)
    expect(auto).not.toBeNull()
    expect(timelineColor(next, a!)).toBe(auto)

    next = apply(next, [{ op: 'layer.update', layerId: DEFAULT_LAYER_IDS.voice, color: '#3B6FD6' }])
    expect(timelineColor(next, line(next, 'A'))).toBe('#3b6fd6')
    next = apply(next, [{ op: 'item.setColor', itemIds: [a!.id], color: '#d64545' }])
    expect(timelineColor(next, line(next, 'A'))).toBe('#d64545')
    expect(timelineColor(next, line(next, 'B'))).toBe('#3b6fd6')

    // ロック中の素材も色は変えられる(見分けのための印なので)
    next = apply(next, [{ op: 'item.setLocked', itemId: b!.id, locked: true }, { op: 'item.setColor', itemIds: [b!.id], color: '#3fa34d' }])
    expect(timelineColor(next, line(next, 'B'))).toBe('#3fa34d')

    next = apply(next, [{ op: 'item.setColor', itemIds: [a!.id], color: null }, { op: 'layer.update', layerId: DEFAULT_LAYER_IDS.voice, color: null }])
    expect(timelineColor(next, line(next, 'A'))).toBe(auto)
    expect(line(next, 'A')).not.toHaveProperty('color')

    // 不正な色は断る
    expect(() => apply(next, [{ op: 'item.setColor', itemIds: [a!.id], color: 'red' }])).toThrow('色の指定が不正です')
    expect(() => apply(next, [{ op: 'layer.update', layerId: DEFAULT_LAYER_IDS.voice, color: '#12345678' }])).toThrow('色の指定が不正です')
  })

  it('ボイスとボイス 2 のように、同じ種類のレイヤーでも別々の色にできる', async () => {
    const { timelineColor } = await import('@shared/project/timeline-colors')
    const { project, zunda, metan } = base()
    let next = apply(project, [
      { op: 'voice.insert', characterId: zunda, text: 'A', atMs: 0 },
      { op: 'voice.insert', characterId: metan, text: 'B', atMs: 100 }
    ])
    const second = next.layers.find((layer) => layer.name === 'ボイス 2')!
    next = apply(next, [
      { op: 'layer.update', layerId: DEFAULT_LAYER_IDS.voice, color: '#3fa34d' },
      { op: 'layer.update', layerId: second.id, color: '#d65a9e' }
    ])
    expect(timelineColor(next, line(next, 'A'))).toBe('#3fa34d')
    expect(timelineColor(next, line(next, 'B'))).toBe('#d65a9e')
  })
})
