import { describe, expect, it } from 'vitest'

import { applyCommands } from '@shared/commands/apply'
import type { Command } from '@shared/commands/types'
import { makeShortProject } from '@shared/project/canvas'
import { createEmptyProject } from '@shared/project/factory'
import type { Project, ShapeItem, TextItem, VideoItem, VoiceItem } from '@shared/project/types'

let counter = 0
const ctx = { newId: (prefix: string) => `${prefix}_${++counter}`, now: () => new Date('2026-01-01T00:00:00Z') }

function apply(project: Project, commands: Command[]): Project {
  return applyCommands(project, commands, ctx).project
}

function gameProject(): Project {
  let project = apply(createEmptyProject(), [
    { op: 'character.create', name: 'ずんだもん', engineId: 'voicevox', speakerId: 3, speakerName: 'ずんだもん' },
    {
      op: 'asset.add',
      asset: { type: 'video', path: { absolute: '/x/game.mp4', relative: null }, durationMs: 120_000, width: 1920, height: 1080, fps: 30, hasAudio: true, license: { source: '録画', creditRequired: false } },
      tempId: 'v'
    },
    { op: 'media.placeVideo', assetId: 'v', atMs: 0 },
    { op: 'media.placeText', text: 'タイトル', atMs: 0, durationMs: 5000, transform: { x: 960, y: 100 } },
    { op: 'media.placeShape', shape: 'arrow', fill: '#ff0000', atMs: 1000, durationMs: 3000, props: { width: 400, height: 150 }, transform: { x: 1500, y: 800 } }
  ])
  const characterId = Object.keys(project.characters)[0]!
  project = apply(project, [
    { op: 'voice.insert', characterId, text: 'ここで逆転するのだ!みんな見ててほしいのだ', atMs: 10_000 },
    { op: 'voice.insert', characterId, text: '範囲の外のセリフ', atMs: 50_000 },
    { op: 'marker.add', atMs: 12_000, text: '逆転' }
  ])
  return project
}

describe('動画の大きさを変える', () => {
  it('大きさ・フレームレート・背景の色を変え、置いた素材と字幕を新しい大きさに合わせる', () => {
    let project = gameProject()
    project = apply(project, [{ op: 'project.setCanvas', width: 1280, height: 720, fps: 60, backgroundColor: '#112233', rescale: true }])
    expect(project.canvas).toEqual({ width: 1280, height: 720, fps: 60, backgroundColor: '#112233' })
    const text = project.items.find((item): item is TextItem => item.type === 'text')!
    expect(text.transform).toMatchObject({ x: 640, y: 67, scale: 0.667 })
    const video = project.items.find((item): item is VideoItem => item.type === 'video')!
    expect(video.transform).toMatchObject({ x: 640, y: 360, scale: 1 })
    const style = Object.values(project.subtitleStyles)[0]!
    expect(style.fontSizePx).toBe(43)
    expect(style.position).toMatchObject({ x: 640, y: 653 })
  })

  it('合わせないこともでき、奇数や小さすぎる大きさは拒否する', () => {
    let project = gameProject()
    project = apply(project, [{ op: 'project.setCanvas', width: 1080, height: 1920 }])
    expect(project.items.find((item) => item.type === 'text')).toMatchObject({ transform: { x: 960, y: 100 } })
    expect(() => apply(project, [{ op: 'project.setCanvas', width: 1081 }])).toThrow('偶数')
    expect(() => apply(project, [{ op: 'project.setCanvas', height: 10 }])).toThrow('64〜7680')
  })
})

describe('縦型のショートを作る', () => {
  it('範囲の素材だけを切り出し、ゲームの録画を縦に合わせ、後ろにぼかした映像を敷く', () => {
    const project = gameProject()
    const short = makeShortProject(project, { fromMs: 2000, toMs: 32_000, width: 1080, height: 1920, layout: 'blur', newId: ctx.newId })
    expect(short.canvas).toMatchObject({ width: 1080, height: 1920 })
    expect(short.meta.title).toContain('(ショート)')
    const videos = short.items.filter((item): item is VideoItem => item.type === 'video')
    expect(videos).toHaveLength(2)
    const [background, game] = videos
    // 後ろの映像は画面を覆う大きさで、ぼかして暗くし、音は出さない。
    expect(background).toMatchObject({ volume: 0, startMs: 0, durationMs: 30_000, inMs: 2000 })
    expect(background!.transform.scale).toBeCloseTo(3.16, 1)
    expect(background!.adjust?.blurPx).toBeGreaterThan(0)
    expect(game).toMatchObject({ startMs: 0, inMs: 2000, outMs: 32_000, transform: { x: 540, scale: 1 } })
    const order = (id: string): number => short.layers.find((layer) => layer.id === id)!.index
    expect(order(background!.layerId)).toBeLessThan(order(game!.layerId))
    // 範囲に収まるセリフだけが入り、字幕は縦の画面の幅で折り返す。
    const voices = short.items.filter((item): item is VoiceItem => item.type === 'voice')
    expect(voices.map((voice) => voice.startMs)).toEqual([8000])
    const style = Object.values(short.subtitleStyles)[0]!
    expect(style.position).toMatchObject({ x: 540 })
    expect(Math.max(...voices[0]!.subtitleLines.map((line) => Array.from(line).length))).toBeLessThanOrEqual(style.maxCharsPerLine)
    expect(short.markers).toEqual([expect.objectContaining({ atMs: 10_000, text: '逆転' })])
    // 矢印は縦の画面に合わせて小さく、位置も比で動く。
    const arrow = short.items.find((item): item is ShapeItem => item.type === 'shape')!
    expect(arrow.startMs).toBe(0)
    expect(arrow.transform.scale).toBeCloseTo(0.5625, 3)
    // 元のプロジェクトは変わらない。
    expect(project.canvas.width).toBe(1920)
    expect(project.items.filter((item) => item.type === 'video')).toHaveLength(1)
  })

  it('切り抜いて画面いっぱいにもできる', () => {
    const short = makeShortProject(gameProject(), { fromMs: 0, toMs: 10_000, width: 1080, height: 1920, layout: 'fill', newId: ctx.newId })
    const videos = short.items.filter((item): item is VideoItem => item.type === 'video')
    expect(videos).toHaveLength(1)
    expect(videos[0]!.transform).toMatchObject({ x: 540, y: 960 })
    expect(videos[0]!.transform.scale).toBeCloseTo(3.16, 1)
  })
})
