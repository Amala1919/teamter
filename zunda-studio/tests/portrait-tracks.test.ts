import { describe, expect, it } from 'vitest'

import { applyCommands, type CommandContext } from '@shared/commands/apply'
import type { Command } from '@shared/commands/types'
import { portraitScenes } from '@shared/portrait/scene'
import { migratePortraitTracks, MIN_TRACK_MS } from '@shared/portrait/tracks'
import { createEmptyProject } from '@shared/project/factory'
import { projectDurationMs } from '@shared/project/queries'
import type { PortraitConfig, PortraitItem, Project } from '@shared/project/types'

const ctx: CommandContext = (() => {
  let counter = 0
  return { newId: (prefix: string) => `${prefix}_${++counter}`, now: () => new Date('2026-01-01T00:00:00Z') }
})()

function apply(project: Project, commands: Command[]): Project {
  return applyCommands(project, commands, ctx).project
}

function portraitConfig(assetId: string): PortraitConfig {
  return {
    assetId,
    transform: { x: 0, y: 0, scale: 1, flipX: false, anchor: 'top-left' },
    partGroups: {},
    layerVisibility: {},
    expressions: {},
    defaultExpressionId: null,
    lipSync: null,
    blink: null
  }
}

function setup(): { project: Project; characterId: string; assetId: string } {
  let project = apply(createEmptyProject(), [
    { op: 'asset.add', asset: { type: 'psd', path: { absolute: '/psd/zunda.psd', relative: null }, license: { source: 'テスト', creditRequired: false } } },
    { op: 'character.create', name: 'ずんだもん', engineId: 'voicevox', speakerId: 3, speakerName: 'ずんだもん' }
  ])
  const assetId = Object.keys(project.assets)[0]!
  const characterId = Object.keys(project.characters)[0]!
  project = apply(project, [{ op: 'voice.insert', characterId, text: 'はじめるのだ', atMs: 0 }])
  return { project, characterId, assetId }
}

const tracks = (project: Project): PortraitItem[] => project.items.filter((item): item is PortraitItem => item.type === 'portrait')
const contentEnd = (project: Project): number =>
  Math.max(...project.items.filter((item) => item.type !== 'portrait').map((item) => item.startMs + item.durationMs))

describe('立ち絵の表示の区間(タイムライン)', () => {
  it('立ち絵を付けると、動画の頭から最後までの表示の区間が置かれる', () => {
    const { project, characterId, assetId } = setup()
    const next = apply(project, [{ op: 'character.setPortrait', characterId, portrait: portraitConfig(assetId) }])
    const [track] = tracks(next)
    expect(tracks(next)).toHaveLength(1)
    expect(track).toMatchObject({ characterId, kind: 'show', startMs: 0, untilEnd: true, layerId: 'lyr_portrait', transformOverride: null })
    expect(track!.durationMs).toBe(Math.max(MIN_TRACK_MS, contentEnd(next)))
    // 動画の長さには数えない(立ち絵を付けても尺は変わらない)
    expect(projectDurationMs(next)).toBe(projectDurationMs(project))
    // 付け直しても増えない
    const again = apply(next, [{ op: 'character.setPortrait', characterId, portrait: portraitConfig(assetId) }])
    expect(tracks(again)).toHaveLength(1)
  })

  it('設定で切ると、立ち絵を付けても区間は置かない', () => {
    const { project, characterId, assetId } = setup()
    const next = apply(project, [
      { op: 'project.setEditing', autoPortraitTrack: false },
      { op: 'character.setPortrait', characterId, portrait: portraitConfig(assetId) }
    ])
    expect(tracks(next)).toHaveLength(0)
  })

  it('セリフが増えると最後まで伸び、長さを変えるとその長さに固定される', () => {
    const { project, characterId, assetId } = setup()
    let next = apply(project, [{ op: 'character.setPortrait', characterId, portrait: portraitConfig(assetId) }])
    next = apply(next, [{ op: 'voice.insert', characterId, text: 'ずっと後ろのセリフなのだ', atMs: 30_000 }])
    const track = tracks(next)[0]!
    expect(track.startMs + track.durationMs).toBe(contentEnd(next))

    const trimmed = apply(next, [{ op: 'item.trim', itemId: track.id, endMs: 10_000 }])
    expect(tracks(trimmed)[0]).toMatchObject({ durationMs: 10_000 })
    expect(tracks(trimmed)[0]!.untilEnd).toBeUndefined()
    const later = apply(trimmed, [{ op: 'voice.insert', characterId, text: 'もっと後ろ', atMs: 50_000 }])
    expect(tracks(later)[0]!.durationMs).toBe(10_000)
    // 区間の外では出ない
    expect(portraitScenes(later, 20_000)).toHaveLength(0)
    expect(portraitScenes(later, 5000)).toHaveLength(1)

    // 「最後まで」に戻せる
    const back = apply(later, [{ op: 'portrait.update', itemId: track.id, untilEnd: true }])
    expect(tracks(back)[0]!.startMs + tracks(back)[0]!.durationMs).toBe(contentEnd(back))
  })

  it('「最後まで」の区間は、最後の素材の後ろでも出し続ける', () => {
    const { project, characterId, assetId } = setup()
    const next = apply(project, [{ op: 'character.setPortrait', characterId, portrait: portraitConfig(assetId) }])
    expect(portraitScenes(next, 999_999)).toHaveLength(1)
  })

  it('位置を区間ごとに変えられ、区間を消すと立ち絵は出ない', () => {
    const { project, characterId, assetId } = setup()
    const next = apply(project, [{ op: 'character.setPortrait', characterId, portrait: portraitConfig(assetId) }])
    const track = tracks(next)[0]!
    const moved = apply(next, [
      { op: 'portrait.update', itemId: track.id, transform: { x: 300, y: 40, scale: 0.8, flipX: true, anchor: 'top-left' } }
    ])
    expect(portraitScenes(moved, 100)[0]!.transform).toMatchObject({ x: 300, y: 40, scale: 0.8, flipX: true })
    expect(portraitScenes(moved, 100)[0]!.controllingItem?.id).toBe(track.id)
    const removed = apply(next, [{ op: 'item.delete', itemId: track.id }])
    expect(portraitScenes(removed, 100)).toHaveLength(0)
  })

  it('分割すると前半は長さが固定され、後半が「最後まで」を引き継ぐ', () => {
    const { project, characterId, assetId } = setup()
    const next = apply(project, [{ op: 'character.setPortrait', characterId, portrait: portraitConfig(assetId) }])
    const track = tracks(next)[0]!
    const split = apply(next, [{ op: 'item.split', itemId: track.id, atMs: 1000 }])
    const [first, second] = tracks(split).sort((a, b) => a.startMs - b.startMs)
    expect(first).toMatchObject({ startMs: 0, durationMs: 1000 })
    expect(first!.untilEnd).toBeUndefined()
    expect(second).toMatchObject({ startMs: 1000, untilEnd: true })
  })

  it('立ち絵を外したり、キャラクターを消したりすると、自動の区間も片付く', () => {
    const { project: base, characterId: id, assetId } = setup()
    const line = base.items.find((item) => item.type === 'voice')!
    const project = apply(base, [
      { op: 'voice.delete', itemId: line.id },
      { op: 'character.setPortrait', characterId: id, portrait: portraitConfig(assetId) }
    ])
    expect(tracks(project)).toHaveLength(1)
    expect(tracks(apply(project, [{ op: 'character.setPortrait', characterId: id, portrait: null }]))).toHaveLength(0)
    const deleted = apply(project, [{ op: 'character.delete', characterId: id }])
    expect(deleted.characters[id]).toBeUndefined()
    expect(tracks(deleted)).toHaveLength(0)
  })

  it('以前のプロジェクト(区間を置かずに全体で出していた)は、開くと同じ見た目の区間が足される', () => {
    const { project, characterId, assetId } = setup()
    const withPortrait = apply(project, [{ op: 'character.setPortrait', characterId, portrait: portraitConfig(assetId) }])
    const legacy: Project = { ...withPortrait, items: withPortrait.items.filter((item) => item.type !== 'portrait') }
    const migrated = migratePortraitTracks(legacy)
    expect(tracks(migrated)).toEqual([expect.objectContaining({ id: `itm_portrait_${characterId}`, untilEnd: true, startMs: 0 })])
    expect(portraitScenes(migrated, 100)).toHaveLength(1)
    // 何度読んでも同じ。区間があれば足さない。
    expect(migratePortraitTracks(migrated)).toBe(migrated)
    const withShow = apply(legacy, [{ op: 'portrait.insert', characterId, atMs: 5000, durationMs: 1000 }])
    expect(tracks(migratePortraitTracks(withShow))).toHaveLength(1)
  })
})
