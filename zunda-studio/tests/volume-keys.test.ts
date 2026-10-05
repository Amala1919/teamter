import { describe, expect, it } from 'vitest'

import { gainAt, gainEnvelope } from '@shared/audio/envelope'
import { keyGainAt, splitKeys } from '@shared/audio/volume-keys'
import { applyCommands } from '@shared/commands/apply'
import type { Command } from '@shared/commands/types'
import { createEmptyProject } from '@shared/project/factory'
import type { AudioItem, Project, VideoItem } from '@shared/project/types'

let counter = 0
const ctx = { newId: (prefix: string) => `${prefix}_${++counter}`, now: () => new Date('2026-01-01T00:00:00Z') }

function apply(project: Project, commands: Command[]): Project {
  return applyCommands(project, commands, ctx).project
}

function withBgm(): Project {
  return apply(createEmptyProject(), [
    {
      op: 'asset.add',
      asset: { type: 'audio', path: { absolute: '/x/bgm.mp3', relative: null }, durationMs: 60_000, license: { source: 'テスト', creditRequired: false } },
      tempId: 'a'
    },
    { op: 'media.placeAudio', assetId: 'a', atMs: 0, inMs: 0, outMs: 10_000, duckable: false }
  ])
}

describe('音量の折れ点', () => {
  it('点の間はまっすぐつなぎ、端より外は端の値のまま', () => {
    const keys = [
      { atMs: 1000, gain: 1 },
      { atMs: 2000, gain: 0 }
    ]
    expect(keyGainAt(keys, 0)).toBe(1)
    expect(keyGainAt(keys, 1500)).toBeCloseTo(0.5)
    expect(keyGainAt(keys, 5000)).toBe(0)
    expect(keyGainAt(undefined, 5000)).toBe(1)
  })

  it('プレビューと書き出しの音量の折れ線に掛かる', () => {
    let project = withBgm()
    const item = project.items[0] as AudioItem
    project = apply(project, [
      {
        op: 'item.setVolumeKeys',
        itemId: item.id,
        keys: [
          { atMs: 2000, gain: 1 },
          { atMs: 3000, gain: 0.25 }
        ]
      }
    ])
    const envelope = gainEnvelope(project, project.items[0] as AudioItem)
    expect(gainAt(envelope, 1000)).toBeCloseTo(1)
    expect(gainAt(envelope, 2500)).toBeCloseTo(0.625)
    expect(gainAt(envelope, 8000)).toBeCloseTo(0.25)
  })

  it('左端を切っても分けても、点は素材の同じ場所に付いたまま', () => {
    let project = withBgm()
    const id = project.items[0]!.id
    project = apply(project, [
      {
        op: 'item.setVolumeKeys',
        itemId: id,
        keys: [
          { atMs: 4000, gain: 1 },
          { atMs: 6000, gain: 0 }
        ]
      },
      { op: 'item.trim', itemId: id, startMs: 1000 }
    ])
    const trimmed = project.items[0] as AudioItem
    // 頭を1秒切ったので、点は1秒前へずれる(端には切った所の値の点が入る)。
    expect(trimmed.volumeKeys).toEqual([
      { atMs: 0, gain: 1 },
      { atMs: 3000, gain: 1 },
      { atMs: 5000, gain: 0 }
    ])
    project = apply(project, [{ op: 'item.split', itemId: id, atMs: 5000, tempId: 'second' }])
    const [first, second] = project.items as AudioItem[]
    expect(keyGainAt(first!.volumeKeys, 4000)).toBeCloseTo(0.5)
    expect(keyGainAt(second!.volumeKeys, 0)).toBeCloseTo(0.5)
    expect(keyGainAt(second!.volumeKeys, 1000)).toBeCloseTo(0)
    expect(splitKeys(undefined, 10, 20)).toEqual({ first: undefined, second: undefined })
  })

  it('動画の速度を変えると、点も長さに合わせて伸び縮みする', () => {
    let project = apply(createEmptyProject(), [
      {
        op: 'asset.add',
        asset: { type: 'video', path: { absolute: '/x/v.mp4', relative: null }, durationMs: 8000, width: 1920, height: 1080, fps: 30, hasAudio: true, license: { source: '録画', creditRequired: false } },
        tempId: 'v'
      },
      { op: 'media.placeVideo', assetId: 'v', atMs: 0, tempId: 'item' }
    ])
    const id = project.items[0]!.id
    project = apply(project, [
      { op: 'item.setVolumeKeys', itemId: id, keys: [{ atMs: 4000, gain: 0.5 }] },
      { op: 'item.setSpeed', itemId: id, rate: 2 }
    ])
    expect((project.items[0] as VideoItem).volumeKeys).toEqual([{ atMs: 2000, gain: 0.5 }])
    expect(() => apply(project, [{ op: 'item.setVolumeKeys', itemId: id, keys: [{ atMs: 0, gain: 9 }] }])).toThrow('音量の点の大きさ')
  })
})
