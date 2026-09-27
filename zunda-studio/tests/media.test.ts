import { createCanvas } from '@napi-rs/canvas'
import { describe, expect, it } from 'vitest'

import { NodeRenderResources } from '../src/main/render/node-resources'
import { gainAt, gainEnvelope, sourceTimeMs, speechIntervals } from '@shared/audio/envelope'
import { applyCommands, type CommandContext } from '@shared/commands/apply'
import { CommandError, type Command } from '@shared/commands/types'
import { createEmptyProject, DEFAULT_LAYER_IDS } from '@shared/project/factory'
import type { AudioItem, Project, VideoItem, ZoomItem } from '@shared/project/types'
import { renderFrame } from '@shared/render/compositor'
import { effectStateAt } from '@shared/render/effects'
import type { Ctx2D } from '@shared/render/types'
import { clampRegion, regionHeight, resizeRegion, zoomProgress, zoomViewport } from '@shared/render/zoom'

function testContext(): CommandContext {
  let counter = 0
  return { newId: (prefix) => `${prefix}_${++counter}`, now: () => new Date('2026-01-01T00:00:00Z') }
}

function apply(project: Project, commands: Command[]): Project {
  return applyCommands(project, commands, testContext()).project
}

function withAssets(): Project {
  return apply(createEmptyProject({ renderSeed: 7 }), [
    {
      op: 'asset.add',
      asset: {
        type: 'video',
        path: { absolute: '/rec/game.mp4', relative: null },
        license: { source: '自分で録画', creditRequired: false },
        durationMs: 60_000,
        width: 1280,
        height: 720,
        fps: 60,
        hasAudio: true
      },
      tempId: 'v'
    },
    {
      op: 'asset.add',
      asset: {
        type: 'audio',
        path: { absolute: '/bgm/loop.mp3', relative: null },
        license: { source: 'https://example.com', creditRequired: true, creditText: 'BGM: 例' },
        durationMs: 10_000
      },
      tempId: 'a'
    }
  ])
}

function assetIdOf(project: Project, type: string): string {
  return Object.entries(project.assets).find(([, asset]) => asset.type === type)![0]
}

function only<T extends { type: string }>(project: Project, type: T['type']): T {
  return project.items.find((item) => item.type === type) as unknown as T
}

describe('素材の配置', () => {
  it('動画は既定で背景レイヤーに、素材の全体を、画面中央・等倍で置く', () => {
    const project = withAssets()
    const next = apply(project, [{ op: 'media.placeVideo', assetId: assetIdOf(project, 'video'), atMs: 1000 }])
    const video = only<VideoItem>(next, 'video')
    expect(video).toMatchObject({ layerId: DEFAULT_LAYER_IDS.background, startMs: 1000, durationMs: 60_000, inMs: 0, outMs: 60_000 })
    expect(video.transform).toEqual({ x: 960, y: 540, scale: 1, rotation: 0, opacity: 1 })
  })

  it('素材の長さを超える切り出しや、違う種類の素材は拒否する', () => {
    const project = withAssets()
    expect(() =>
      apply(project, [{ op: 'media.placeVideo', assetId: assetIdOf(project, 'video'), atMs: 0, inMs: 0, outMs: 70_000 }])
    ).toThrow(CommandError)
    expect(() => apply(project, [{ op: 'media.placeVideo', assetId: assetIdOf(project, 'audio'), atMs: 0 }])).toThrow(CommandError)
  })

  it('ループする BGM は素材より長く置け、既定で BGM レイヤーに置かれダッキングの対象になる', () => {
    const project = withAssets()
    const next = apply(project, [
      { op: 'media.placeAudio', assetId: assetIdOf(project, 'audio'), atMs: 0, durationMs: 45_000, loop: true, volume: 0.3 }
    ])
    const audio = only<AudioItem>(next, 'audio')
    expect(audio).toMatchObject({ layerId: DEFAULT_LAYER_IDS.bgm, durationMs: 45_000, loop: true, duckable: true })
    expect(() =>
      apply(project, [{ op: 'media.placeAudio', assetId: assetIdOf(project, 'audio'), atMs: 0, durationMs: 45_000 }])
    ).toThrow('ループしない')
  })
})

describe('item.trim', () => {
  function placed(): { project: Project; itemId: string } {
    const project = withAssets()
    const next = apply(project, [
      { op: 'media.placeVideo', assetId: assetIdOf(project, 'video'), atMs: 5000, inMs: 10_000, outMs: 20_000 }
    ])
    return { project: next, itemId: only<VideoItem>(next, 'video').id }
  }

  it('左端を縮めると、映像はその分だけ先から始まる', () => {
    const { project, itemId } = placed()
    const next = apply(project, [{ op: 'item.trim', itemId, startMs: 7000 }])
    expect(only<VideoItem>(next, 'video')).toMatchObject({ startMs: 7000, durationMs: 8000, inMs: 12_000, outMs: 20_000 })
  })

  it('右端を伸ばすと切り出しの終わりも伸びる。素材の外までは伸ばせない', () => {
    const { project, itemId } = placed()
    const next = apply(project, [{ op: 'item.trim', itemId, endMs: 20_000 }])
    expect(only<VideoItem>(next, 'video')).toMatchObject({ durationMs: 15_000, outMs: 25_000 })
    // 切り出しは素材の 10 秒目から。左端を 10 秒より前へは伸ばせない
    expect(apply(project, [{ op: 'item.trim', itemId, startMs: 0 }]).items[0]).toMatchObject({ inMs: 5000 })
    const late = apply(project, [{ op: 'item.setTimeRange', itemId, startMs: 15_000 }])
    expect(() => apply(late, [{ op: 'item.trim', itemId, startMs: 0 }])).toThrow('素材の先頭')
    expect(() => apply(project, [{ op: 'item.trim', itemId, endMs: 60_000 }])).toThrow('素材の末尾')
  })

  it('ボイスアイテムは伸縮できない', () => {
    const project = apply(createEmptyProject(), [
      { op: 'character.create', name: 'ずんだもん', engineId: 'voicevox', speakerId: 3, speakerName: 'ずんだもん' }
    ])
    const characterId = Object.keys(project.characters)[0]!
    const next = apply(project, [{ op: 'voice.insert', characterId, text: 'やあ', atMs: 0 }])
    expect(() => apply(next, [{ op: 'item.trim', itemId: next.items[0]!.id, endMs: 5000 }])).toThrow(CommandError)
  })
})

describe('変形・音量・エフェクト', () => {
  it('変形は部分的に更新でき、不正な値は拒否する', () => {
    const project = withAssets()
    const placed = apply(project, [{ op: 'media.placeVideo', assetId: assetIdOf(project, 'video'), atMs: 0 }])
    const itemId = only<VideoItem>(placed, 'video').id
    const next = apply(placed, [{ op: 'item.setTransform', itemId, x: 100, scale: 0.5 }])
    expect(only<VideoItem>(next, 'video').transform).toEqual({ x: 100, y: 540, scale: 0.5, rotation: 0, opacity: 1 })
    expect(() => apply(placed, [{ op: 'item.setTransform', itemId, opacity: 2 }])).toThrow(CommandError)
    expect(() => apply(placed, [{ op: 'item.setAudio', itemId, loop: true }])).toThrow('動画で変えられるのは音量だけ')
  })

  it('ループをやめると、素材より長い分は切り詰める', () => {
    const project = withAssets()
    const placed = apply(project, [
      { op: 'media.placeAudio', assetId: assetIdOf(project, 'audio'), atMs: 0, durationMs: 30_000, loop: true }
    ])
    const itemId = only<AudioItem>(placed, 'audio').id
    const next = apply(placed, [{ op: 'item.setAudio', itemId, loop: false, fadeOutMs: 1500 }])
    expect(only<AudioItem>(next, 'audio')).toMatchObject({ loop: false, durationMs: 10_000, fadeOutMs: 1500 })
  })

  it('エフェクトを足し・変え・外せる', () => {
    const project = withAssets()
    const placed = apply(project, [{ op: 'media.placeText', text: '衝撃', atMs: 0, durationMs: 2000 }])
    const itemId = placed.items[0]!.id
    let next = apply(placed, [
      { op: 'item.addEffect', itemId, effect: { type: 'fade', inMs: 200, outMs: 200 } },
      { op: 'item.addEffect', itemId, effect: { type: 'shake', amplitudePx: 10, frequencyHz: 20, durationMs: 300 } }
    ])
    expect(next.items[0]!.effects).toHaveLength(2)
    next = apply(next, [{ op: 'item.updateEffect', itemId, effectIndex: 0, effect: { type: 'fade', inMs: 500, outMs: 0 } }])
    expect(next.items[0]!.effects[0]).toEqual({ type: 'fade', inMs: 500, outMs: 0 })
    next = apply(next, [{ op: 'item.removeEffect', itemId, effectIndex: 1 }])
    expect(next.items[0]!.effects).toHaveLength(1)
    expect(() =>
      apply(placed, [{ op: 'item.addEffect', itemId, effect: { type: 'shake', amplitudePx: 10, frequencyHz: 0, durationMs: 1 } }])
    ).toThrow(CommandError)
  })

  it('エフェクトの効果: フェード・拡大・移動は時刻で決まり、振動は同じ種なら同じで終わりに向けて弱まる', () => {
    const item = {
      id: 'itm_1',
      durationMs: 2000,
      effects: [
        { type: 'fade', inMs: 400, outMs: 400 },
        { type: 'scale', from: 0.5, to: 1, easing: 'linear', durationMs: 1000 },
        { type: 'move', fromX: 0, fromY: 100, toX: 0, toY: 0, easing: 'linear', durationMs: 1000 }
      ] as VideoItem['effects']
    }
    expect(effectStateAt(item, 200, 1)).toMatchObject({ alpha: 0.5, scale: 0.6, dy: 80 })
    expect(effectStateAt(item, 1000, 1)).toMatchObject({ alpha: 1, scale: 1, dy: 0 })
    expect(effectStateAt(item, 1900, 1).alpha).toBeCloseTo(0.25)

    const shaking = { id: 'itm_2', durationMs: 1000, effects: [{ type: 'shake', amplitudePx: 20, frequencyHz: 10, durationMs: 1000 }] as VideoItem['effects'] }
    const early = effectStateAt(shaking, 130, 5)
    expect(effectStateAt(shaking, 130, 5)).toEqual(early)
    expect(Math.hypot(early.dx, early.dy)).toBeGreaterThan(0)
    expect(Math.abs(effectStateAt(shaking, 999, 5).dx)).toBeLessThan(0.1)
    expect(effectStateAt(shaking, 130, 6)).not.toEqual(early)
  })
})

describe('ズーム', () => {
  it('枠は縦横比を保ったまま画面の内側・最小の大きさ以上に収める', () => {
    const canvas = { width: 1920, height: 1080 }
    expect(clampRegion(canvas, { x: 1800, y: -50, width: 960 })).toEqual({ x: 960, y: 0, width: 960 })
    expect(clampRegion(canvas, { x: 0, y: 0, width: 10 }).width).toBe(192)
    expect(clampRegion(canvas, { x: -5, y: 0, width: 5000 })).toEqual({ x: 0, y: 0, width: 1920 })
    expect(regionHeight(canvas, 960)).toBe(540)
  })

  it('zoom.insert は既定でズームレイヤーに置き、画面全体なら一番上のレイヤーに置く', () => {
    const project = createEmptyProject()
    const region = { x: 100, y: 100, width: 960 }
    const next = apply(project, [
      { op: 'zoom.insert', atMs: 1000, durationMs: 3000, region, method: 'punch' },
      { op: 'zoom.insert', atMs: 5000, durationMs: 3000, region, wholeScreen: true }
    ])
    const [first, second] = next.items as ZoomItem[]
    expect(first).toMatchObject({ layerId: DEFAULT_LAYER_IDS.zoom, method: 'punch', inMs: 250, outMs: 300 })
    expect(second).toMatchObject({ layerId: DEFAULT_LAYER_IDS.bgm, method: 'smooth', inMs: 400, outMs: 400 })
  })

  it('ズームレイヤーが無いプロジェクトでは、背景のすぐ上に作る', () => {
    const project = createEmptyProject()
    project.layers = project.layers.filter((layer) => layer.id !== DEFAULT_LAYER_IDS.zoom)
    const next = apply(project, [{ op: 'zoom.insert', atMs: 0, durationMs: 1000, region: { x: 0, y: 0, width: 960 } }])
    const layer = next.layers.find((candidate) => candidate.id === next.items[0]!.layerId)!
    expect(layer).toMatchObject({ name: 'ズーム', index: 1 })
    expect(next.layers.find((candidate) => candidate.id === DEFAULT_LAYER_IDS.background)!.index).toBe(0)
  })

  it('zoom.update で範囲と寄り方を変えられる', () => {
    const placed = apply(createEmptyProject(), [
      { op: 'zoom.insert', atMs: 0, durationMs: 1000, region: { x: 0, y: 0, width: 960 }, tempId: 'z' }
    ])
    const itemId = placed.items[0]!.id
    const next = apply(placed, [{ op: 'zoom.update', itemId, region: { x: 2000, y: 0, width: 480 }, method: 'cut', inMs: 0 }])
    expect(next.items[0]).toMatchObject({ region: { x: 1440, y: 0, width: 480 }, method: 'cut', inMs: 0 })
  })

  it('寄り具合は、開始時刻に寄り始め、終了時刻に元へ戻る', () => {
    const base = { durationMs: 4000, inMs: 400, outMs: 400 }
    expect(zoomProgress({ ...base, method: 'cut' }, 0)).toBe(1)
    expect(zoomProgress({ ...base, method: 'cut' }, 4000)).toBe(0)
    expect(zoomProgress({ ...base, method: 'linear' }, 200)).toBeCloseTo(0.5)
    expect(zoomProgress({ ...base, method: 'linear' }, 3800)).toBeCloseTo(0.5)
    expect(zoomProgress({ ...base, method: 'smooth' }, 2000)).toBe(1)
    // パンチインは途中で行き過ぎる
    const punch = Array.from({ length: 40 }, (_, index) => zoomProgress({ ...base, method: 'punch' }, index * 10))
    expect(Math.max(...punch)).toBeGreaterThan(1.02)
    // ゆっくり寄り続けると、戻る直前に枠へ着く
    const slow = { ...base, method: 'slowPush' as const, inMs: 0 }
    expect(zoomProgress(slow, 1000)).toBeGreaterThan(0)
    expect(zoomProgress(slow, 1000)).toBeLessThan(zoomProgress(slow, 3000))
    expect(zoomProgress(slow, 3599)).toBeCloseTo(1, 2)
    // 寄る時間と戻る時間が尺より長ければ比率を保って縮める
    expect(zoomProgress({ durationMs: 400, inMs: 400, outMs: 400, method: 'linear' }, 100)).toBeCloseTo(0.5)
  })

  it('映す範囲は、寄り具合0で画面全体、1で枠そのもの', () => {
    const canvas = { width: 1920, height: 1080 }
    const region = { x: 300, y: 200, width: 640 }
    expect(zoomViewport(canvas, region, 0)).toEqual({ x: 0, y: 0, width: 1920, height: 1080 })
    const full = zoomViewport(canvas, region, 1)
    expect(full.x).toBeCloseTo(300)
    expect(full.y).toBeCloseTo(200)
    expect(full.width).toBeCloseTo(640)
    expect(full.height).toBeCloseTo(360)
    // 途中は対数で補間する(半分の進み具合で拡大率は √3 倍)
    expect(1920 / zoomViewport(canvas, region, 0.5).width).toBeCloseTo(Math.sqrt(3))
    // 行き過ぎても画面の外は映さない
    const over = zoomViewport(canvas, { x: 0, y: 0, width: 640 }, 1.1)
    expect(over.x).toBeGreaterThanOrEqual(0)
    expect(over.y).toBeGreaterThanOrEqual(0)
  })
})

describe('音量の折れ線', () => {
  function bgmProject(): { project: Project; item: AudioItem } {
    let project = withAssets()
    project = apply(project, [
      { op: 'character.create', name: 'ずんだもん', engineId: 'voicevox', speakerId: 3, speakerName: 'ずんだもん' },
      { op: 'media.placeAudio', assetId: assetIdOf(project, 'audio'), atMs: 0, durationMs: 20_000, loop: true, volume: 0.5 }
    ])
    const characterId = Object.keys(project.characters)[0]!
    project = apply(project, [{ op: 'voice.insert', characterId, text: 'しゃべる', atMs: 5000 }])
    const line = project.items.find((item) => item.type === 'voice')!
    project = apply(project, [
      {
        op: 'voice.applySynthesis',
        itemId: line.id,
        expectedText: 'しゃべる',
        synthesis: { cacheKey: 'k', audioDurationMs: 2000, accentPhrases: [], lipSync: [] }
      }
    ])
    const item = only<AudioItem>(project, 'audio')
    return { project, item }
  }

  it('セリフの間だけ BGM を下げ、前後はなめらかに戻す', () => {
    const { project, item } = bgmProject()
    const line = project.items.find((candidate) => candidate.type === 'voice')!
    const points = gainEnvelope(project, item)
    const fade = project.editing.duckFadeMs
    expect(gainAt(points, 1000)).toBeCloseTo(0.5)
    expect(gainAt(points, line.startMs + 100)).toBeCloseTo(0.5 * project.editing.duckVolume)
    expect(gainAt(points, line.startMs - fade / 2)).toBeCloseTo(0.5 * (1 - (1 - project.editing.duckVolume) / 2))
    expect(gainAt(points, line.startMs + line.durationMs + fade + 10)).toBeCloseTo(0.5)
  })

  it('ダッキングの対象でなければ下げない。ミュートしたレイヤーのセリフでも下げない', () => {
    const { project, item } = bgmProject()
    const line = project.items.find((candidate) => candidate.type === 'voice')!
    const off = apply(project, [{ op: 'item.setAudio', itemId: item.id, duckable: false }])
    expect(gainAt(gainEnvelope(off, only<AudioItem>(off, 'audio')), line.startMs + 100)).toBeCloseTo(0.5)
    const muted = { ...project, layers: project.layers.map((layer) => (layer.id === line.layerId ? { ...layer, muted: true } : layer)) }
    expect(speechIntervals(muted)).toEqual([])
  })

  it('フェードイン・アウトとループの素材位置', () => {
    const { project, item } = bgmProject()
    const faded = apply(project, [{ op: 'item.setAudio', itemId: item.id, fadeInMs: 1000, fadeOutMs: 2000, duckable: false }])
    const fadedItem = only<AudioItem>(faded, 'audio')
    const points = gainEnvelope(faded, fadedItem)
    expect(gainAt(points, 0)).toBe(0)
    expect(gainAt(points, 500)).toBeCloseTo(0.25)
    expect(gainAt(points, 19_000)).toBeCloseTo(0.25)
    expect(sourceTimeMs(fadedItem, 12_500)).toBe(2500)
  })
})

describe('Compositor(動画・変形・ズーム)', () => {
  function pixelReader(project: Project, timeMs: number, resources: NodeRenderResources): (x: number, y: number) => number[] {
    const canvas = createCanvas(project.canvas.width, project.canvas.height)
    const context = canvas.getContext('2d')
    renderFrame(context as unknown as Ctx2D, project, timeMs, resources)
    return (x, y) => Array.from(context.getImageData(x, y, 1, 1).data.slice(0, 3))
  }

  function solidFrame(width: number, height: number, color: string): unknown {
    const canvas = createCanvas(width, height)
    const context = canvas.getContext('2d')
    context.fillStyle = color
    context.fillRect(0, 0, width, height)
    return canvas
  }

  it('動画のコマは画面に収まる大きさで描かれ、変形とフェードが掛かる', () => {
    let project = withAssets()
    project = apply(project, [{ op: 'media.placeVideo', assetId: assetIdOf(project, 'video'), atMs: 0 }])
    const video = only<VideoItem>(project, 'video')
    const resources = new NodeRenderResources()
    resources.setVideoFrame(video.id, solidFrame(320, 180, '#00ff00'))
    expect(pixelReader(project, 100, resources)(5, 5)).toEqual([0, 255, 0])

    const shrunk = apply(project, [
      { op: 'item.setTransform', itemId: video.id, scale: 0.5 },
      { op: 'item.addEffect', itemId: video.id, effect: { type: 'fade', inMs: 1000, outMs: 0 } }
    ])
    const read = pixelReader(shrunk, 500, resources)
    expect(read(5, 5)).toEqual([0, 0, 0])
    const [, green] = read(960, 540)
    expect(green).toBeGreaterThan(110)
    expect(green).toBeLessThan(145)
  })

  it('ズームは下のレイヤーだけを拡大し、上のレイヤー(立ち絵・字幕の位置)はそのまま', () => {
    let project = createEmptyProject({ renderSeed: 1 })
    project = apply(project, [
      // 背景: 画面の中央に 1/10 の大きさの赤い四角
      { op: 'media.placeShape', shape: 'rect', fill: '#ff0000', atMs: 0, durationMs: 10_000, transform: { scale: 0.1 } },
      // 字幕のレイヤー: 左上に青い四角
      {
        op: 'media.placeShape',
        shape: 'rect',
        fill: '#0000ff',
        atMs: 0,
        durationMs: 10_000,
        layerId: DEFAULT_LAYER_IDS.voice,
        transform: { x: 100, y: 100, scale: 0.05 }
      },
      // 中央の半分の範囲に瞬間で寄る
      { op: 'zoom.insert', atMs: 1000, durationMs: 2000, region: { x: 480, y: 270, width: 960 }, method: 'cut' }
    ])
    const resources = new NodeRenderResources()
    const before = pixelReader(project, 500, resources)
    // 赤い四角は 192×108。中心から 150px 右は四角の外
    expect(before(960 + 150, 540)).toEqual([0, 0, 0])
    expect(before(100, 100)).toEqual([0, 0, 255])

    const zoomed = pixelReader(project, 1500, resources)
    // 2倍に拡大されて 384×216 になり、中心から 150px 右も赤い
    expect(zoomed(960 + 150, 540)).toEqual([255, 0, 0])
    expect(zoomed(960 + 200, 540)).toEqual([0, 0, 0])
    // ズームより上のレイヤーは拡大されない
    expect(zoomed(100, 100)).toEqual([0, 0, 255])
    expect(zoomed(100 + 60, 100)).toEqual([0, 0, 0])

    // 終了時刻を過ぎれば元に戻る
    expect(pixelReader(project, 3000, resources)(960 + 150, 540)).toEqual([0, 0, 0])
    // 枠の編集中はズームを掛けずに描ける
    const canvas = createCanvas(1920, 1080)
    const context = canvas.getContext('2d')
    renderFrame(context as unknown as Ctx2D, project, 1500, resources, { applyZoom: false })
    expect(Array.from(context.getImageData(960 + 150, 540, 1, 1).data.slice(0, 3))).toEqual([0, 0, 0])
  })
})

describe('ズーム枠の操作(resizeRegion)', () => {
  const canvas = { width: 1920, height: 1080 }
  const region = { x: 480, y: 270, width: 960 }

  it('右下の角は左上を固定して、大きく動かした方向に合わせて縦横比を保って変わる', () => {
    expect(resizeRegion(canvas, region, 'se', -240, 0)).toEqual({ x: 480, y: 270, width: 720 })
    expect(resizeRegion(canvas, region, 'se', 0, 135)).toEqual({ x: 480, y: 270, width: 1200 })
    // 画面の外へは広げない(右端と下端のうち先に当たるほうで止まる)
    expect(resizeRegion(canvas, region, 'se', 2000, 0)).toEqual({ x: 480, y: 270, width: 1440 })
  })

  it('左上の角は右下を固定する', () => {
    const next = resizeRegion(canvas, region, 'nw', 240, 0)
    expect(next.width).toBe(720)
    expect(next.x + next.width).toBe(1440)
    expect(next.y + regionHeight(canvas, next.width)).toBe(810)
  })

  it('辺は向かいの辺の中央を固定する', () => {
    const east = resizeRegion(canvas, region, 'e', 192, 0)
    expect(east.x).toBe(480)
    expect(east.width).toBe(1152)
    expect(east.y + regionHeight(canvas, east.width) / 2).toBe(540)
    const north = resizeRegion(canvas, region, 'n', 0, 54)
    expect(north.y + regionHeight(canvas, north.width)).toBe(810)
    expect(north.x + north.width / 2).toBe(960)
  })

  it('最小の大きさより小さくはならず、移動は画面の内側に収まる', () => {
    expect(resizeRegion(canvas, region, 'se', -5000, -5000).width).toBe(192)
    expect(resizeRegion(canvas, region, 'move', -1000, 5000)).toEqual({ x: 0, y: 540, width: 960 })
  })
})
