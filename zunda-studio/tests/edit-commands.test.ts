import { describe, expect, it } from 'vitest'

import { atempoChain } from '@main/services/export/streams'
import { aiCommandSchema } from '@shared/ai/edit-commands'
import { applyCommands, type CommandContext } from '@shared/commands/apply'
import type { Command } from '@shared/commands/types'
import { zoomCommands } from '@shared/commands/zoom-still'
import { createEmptyProject, DEFAULT_LAYER_IDS } from '@shared/project/factory'
import type { AudioItem, Item, Project, TextItem, VideoItem } from '@shared/project/types'

let counter = 0
const context = (): CommandContext => ({ newId: (prefix) => `${prefix}_${++counter}`, now: () => new Date('2026-01-01T00:00:00Z') })
const run = (project: Project, commands: Command[]): ReturnType<typeof applyCommands> => applyCommands(project, commands, context())
const apply = (project: Project, commands: Command[]): Project => run(project, commands).project

function base(): Project {
  return apply(createEmptyProject(), [
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
      asset: { type: 'audio', path: { absolute: '/bgm/a.mp3', relative: null }, license: { source: 'x', creditRequired: false }, durationMs: 10_000 },
      tempId: 'a'
    },
    { op: 'media.placeVideo', assetId: 'v', atMs: 0, inMs: 1000, outMs: 11_000, tempId: 'clip' },
    { op: 'media.placeAudio', assetId: 'a', atMs: 0, durationMs: 10_000, tempId: 'bgm' },
    { op: 'media.placeText', text: 'テロップ', atMs: 12_000, durationMs: 2000, tempId: 'text' },
    { op: 'character.create', name: 'ずんだもん', engineId: 'voicevox', speakerId: 3, speakerName: 'ずんだもん', tempId: 'z' }
  ])
}

const byType = <T extends Item>(project: Project, type: T['type']): T[] => project.items.filter((item) => item.type === type) as T[]

describe('分割', () => {
  it('動画を再生位置で分け、素材の区間とフェードを前後に振り分ける', () => {
    let project = base()
    const clip = byType<VideoItem>(project, 'video')[0]!
    project = apply(project, [{ op: 'item.addEffect', itemId: clip.id, effect: { type: 'fade', inMs: 500, outMs: 800 } }])
    const result = run(project, [{ op: 'item.split', itemId: clip.id, atMs: 4000, tempId: 'rest' }])
    const [first, second] = byType<VideoItem>(result.project, 'video')
    // 元のフェード(入り 500・出 800)は前後に分かれ、切った所には既定のフェード(300ms)が付く
    expect(first).toMatchObject({ id: clip.id, startMs: 0, durationMs: 4000, inMs: 1000, outMs: 5000, effects: [{ type: 'fade', inMs: 500, outMs: 300 }] })
    expect(second).toMatchObject({ id: result.resolvedIds['rest'], startMs: 4000, durationMs: 6000, inMs: 5000, outMs: 11_000, effects: [{ type: 'fade', inMs: 300, outMs: 800 }] })
  })

  it('動画を切った所のフェードは設定で長さを選べ、0 なら付けない。端を切ったときも付ける', () => {
    let project = base()
    const clip = byType<VideoItem>(project, 'video')[0]!
    const [first, second] = byType<VideoItem>(apply(project, [{ op: 'item.split', itemId: clip.id, atMs: 4000 }]), 'video')
    expect(first!.effects).toEqual([{ type: 'fade', inMs: 0, outMs: 300 }])
    expect(second!.effects).toEqual([{ type: 'fade', inMs: 300, outMs: 0 }])

    project = apply(project, [{ op: 'project.setEditing', cutFadeInMs: 0, cutFadeOutMs: 500 }])
    const [a, b] = byType<VideoItem>(apply(project, [{ op: 'item.split', itemId: clip.id, atMs: 4000 }]), 'video')
    expect(a!.effects).toEqual([{ type: 'fade', inMs: 0, outMs: 500 }])
    expect(b!.effects).toEqual([])

    // 端を切ると、切った側だけ
    const fresh = base()
    const freshClip = byType<VideoItem>(fresh, 'video')[0]!
    const trimmed = byType<VideoItem>(apply(fresh, [{ op: 'item.trim', itemId: freshClip.id, startMs: 2000 }]), 'video')[0]!
    expect(trimmed.effects).toEqual([{ type: 'fade', inMs: 300, outMs: 0 }])
    // 音声には付けない
    const bgm = byType<AudioItem>(fresh, 'audio')[0]!
    const [audioFirst] = byType<AudioItem>(apply(fresh, [{ op: 'item.split', itemId: bgm.id, atMs: 5000 }]), 'audio')
    expect(audioFirst!.effects).toEqual([])
  })

  it('速度を変えた動画は、速度に合わせて素材の位置を分ける', () => {
    let project = base()
    const clip = byType<VideoItem>(project, 'video')[0]!
    project = apply(project, [{ op: 'item.setSpeed', itemId: clip.id, rate: 2 }])
    expect(byType<VideoItem>(project, 'video')[0]).toMatchObject({ durationMs: 5000, playbackRate: 2 })
    const [first, second] = byType<VideoItem>(apply(project, [{ op: 'item.split', itemId: clip.id, atMs: 1000 }]), 'video')
    expect(first).toMatchObject({ inMs: 1000, outMs: 3000, durationMs: 1000 })
    expect(second).toMatchObject({ inMs: 3000, outMs: 11_000, durationMs: 4000 })
  })

  it('音声はフェードを前後に分け、端やセリフでは分けられない', () => {
    let project = base()
    const bgm = byType<AudioItem>(project, 'audio')[0]!
    project = apply(project, [{ op: 'item.setAudio', itemId: bgm.id, fadeInMs: 300, fadeOutMs: 900 }])
    const [first, second] = byType<AudioItem>(apply(project, [{ op: 'item.split', itemId: bgm.id, atMs: 6000 }]), 'audio')
    expect(first).toMatchObject({ fadeInMs: 300, fadeOutMs: 0, durationMs: 6000 })
    expect(second).toMatchObject({ fadeInMs: 0, fadeOutMs: 900, startMs: 6000 })

    expect(() => apply(project, [{ op: 'item.split', itemId: bgm.id, atMs: 10_000 }])).toThrow('アイテムの中')
    const withLine = apply(project, [{ op: 'voice.insert', characterId: Object.keys(project.characters)[0]!, text: 'やあ', atMs: 20_000 }])
    const line = byType(withLine, 'voice')[0]!
    expect(() => apply(withLine, [{ op: 'item.split', itemId: line.id, atMs: line.startMs + 100 }])).toThrow('セリフは分けられません')
  })
})

describe('貼り付け', () => {
  it('並びを保ったまま新しい ID で置き、ID を受け取れる', () => {
    const project = base()
    const sources = [byType<VideoItem>(project, 'video')[0]!, byType<TextItem>(project, 'text')[0]!]
    const result = run(project, [{ op: 'item.paste', items: sources, atMs: 30_000, tempIdPrefix: 'p' }])
    const pastedVideo = result.project.items.find((item) => item.id === result.resolvedIds['p0'])!
    const pastedText = result.project.items.find((item) => item.id === result.resolvedIds['p1'])!
    expect(pastedVideo).toMatchObject({ type: 'video', startMs: 30_000, inMs: 1000 })
    expect(pastedText).toMatchObject({ type: 'text', startMs: 42_000, text: 'テロップ' })
    expect(result.project.items).toHaveLength(project.items.length + 2)
  })

  it('無くなったレイヤーは既定のレイヤーに置き、無い素材は断る', () => {
    const project = base()
    const bgm = byType<AudioItem>(project, 'audio')[0]!
    // 元の BGM と重ならない時間に貼る(重なると空いているレイヤーへ振り分けられるため)
    const free = bgm.startMs + bgm.durationMs + 1000
    const pasted = apply(project, [{ op: 'item.paste', items: [{ ...bgm, layerId: 'lyr_gone' }], atMs: free }])
    expect(byType<AudioItem>(pasted, 'audio').at(-1)!.layerId).toBe(DEFAULT_LAYER_IDS.bgm)
    expect(() => apply(project, [{ op: 'item.paste', items: [{ ...bgm, assetId: 'ast_other' }], atMs: 0 }])).toThrow('素材がこのプロジェクトにありません')
  })
})

describe('間の編集', () => {
  it('消して詰めると、後ろのアイテムが前へ寄る', () => {
    const project = base()
    const clip = byType<VideoItem>(project, 'video')[0]!
    const bgm = byType<AudioItem>(project, 'audio')[0]!
    const result = apply(project, [{ op: 'timeline.rippleDelete', itemIds: [clip.id, bgm.id] }])
    expect(result.items.map((item) => item.type)).toEqual(['text'])
    expect(byType<TextItem>(result, 'text')[0]!.startMs).toBe(2000)
  })

  it('ほかのレイヤーに残ったアイテムには重ならないところまでしか詰めない', () => {
    const project = base()
    const clip = byType<VideoItem>(project, 'video')[0]!
    // BGM(0〜10秒)が残るので、消した動画の区間(0〜10秒)は空かず、詰めない
    const result = apply(project, [{ op: 'timeline.rippleDelete', itemIds: [clip.id] }])
    expect(byType<TextItem>(result, 'text')[0]!.startMs).toBe(12_000)
  })

  it('何も無い時間を詰める・空ける', () => {
    const project = base()
    const closed = apply(project, [{ op: 'timeline.closeGap', atMs: 11_000 }])
    expect(byType<TextItem>(closed, 'text')[0]!.startMs).toBe(10_000)
    expect(() => apply(project, [{ op: 'timeline.closeGap', atMs: 5000 }])).toThrow('アイテムがあります')
    expect(() => apply(project, [{ op: 'timeline.closeGap', atMs: 50_000 }])).toThrow('後ろにアイテムがありません')
    const opened = apply(project, [{ op: 'timeline.insertGap', atMs: 11_000, durationMs: 3000 }])
    expect(byType<TextItem>(opened, 'text')[0]!.startMs).toBe(15_000)
    expect(byType<VideoItem>(opened, 'video')[0]!.startMs).toBe(0)
  })

  describe('左に詰める', () => {
    /** 同じレイヤーにテロップを 0〜2秒・5〜7秒・10〜12秒、別のレイヤーに BGM(3〜20秒)。 */
    function spaced(): { project: Project; a: string; b: string; c: string; bgm: string } {
      const result = run(createEmptyProject(), [
        {
          op: 'asset.add',
          asset: { type: 'audio', path: { absolute: '/bgm/a.mp3', relative: null }, license: { source: 'x', creditRequired: false }, durationMs: 60_000 },
          tempId: 'asset'
        },
        { op: 'media.placeText', text: 'A', atMs: 0, durationMs: 2000, tempId: 'a' },
        { op: 'media.placeText', text: 'B', atMs: 5000, durationMs: 2000, tempId: 'b' },
        { op: 'media.placeText', text: 'C', atMs: 10_000, durationMs: 2000, tempId: 'c' },
        { op: 'media.placeAudio', assetId: 'asset', atMs: 3000, durationMs: 17_000, tempId: 'bgm' }
      ])
      const id = (key: string): string => result.resolvedIds[key]!
      return { project: result.project, a: id('a'), b: id('b'), c: id('c'), bgm: id('bgm') }
    }
    const startOf = (project: Project, id: string): number => project.items.find((item) => item.id === id)!.startMs

    it('1つなら、同じレイヤーの前の素材の終わりまで寄せ、ほかは動かさない(別のレイヤーの素材は関係ない)', () => {
      const { project, a, b, c, bgm } = spaced()
      const next = apply(project, [{ op: 'timeline.packLeft', itemIds: [b] }])
      expect([startOf(next, a), startOf(next, b), startOf(next, c), startOf(next, bgm)]).toEqual([0, 2000, 10_000, 3000])
      // 前に何も無ければ 0 秒まで
      expect(startOf(apply(project, [{ op: 'timeline.packLeft', itemIds: [bgm] }]), bgm)).toBe(0)
    })

    it('複数なら、空白を埋める(選んだもの同士の間も詰める)か、空白を保ってまとめて動かすかを選べる', () => {
      const { project, a, b, c } = spaced()
      const filled = apply(project, [{ op: 'timeline.packLeft', itemIds: [c, b] }])
      expect([startOf(filled, a), startOf(filled, b), startOf(filled, c)]).toEqual([0, 2000, 4000])
      const kept = apply(project, [{ op: 'timeline.packLeft', itemIds: [b, c], keepGaps: true }])
      expect([startOf(kept, a), startOf(kept, b), startOf(kept, c)]).toEqual([0, 2000, 7000])
    })

    it('グループの仲間は一緒に動き、ロック中のものは動かさない。詰める空白が無ければ断る', () => {
      const { project, a, b, c, bgm } = spaced()
      const grouped = apply(project, [{ op: 'item.group', itemIds: [c, bgm] }])
      // C は 2秒まで寄れるが、BGM は 3秒 しか寄れないので、仲間そろって 3秒 だけ動く
      const moved = apply(grouped, [{ op: 'timeline.packLeft', itemIds: [c] }])
      expect([startOf(moved, c), startOf(moved, bgm), startOf(moved, b)]).toEqual([7000, 0, 5000])

      const locked = apply(project, [{ op: 'item.setLocked', itemId: b, locked: true }])
      const packed = apply(locked, [{ op: 'timeline.packLeft', itemIds: [b, c] }])
      expect([startOf(packed, b), startOf(packed, c)]).toEqual([5000, 7000])
      expect(() => apply(project, [{ op: 'timeline.packLeft', itemIds: [a] }])).toThrow('前に詰められる空白がありません')
    })

    it('セリフは、ほかのレイヤーのセリフとも声が重ならないところまで', () => {
      const project = apply(createEmptyProject(), [
        { op: 'character.create', name: 'ずんだもん', engineId: 'voicevox', speakerId: 3, speakerName: 'ずんだもん' }
      ])
      const characterId = Object.keys(project.characters)[0]!
      // 2つめは1つめと重ねて置いて別のレイヤーへ振り分けさせ、後ろへ離す
      let withLines = apply(project, [
        { op: 'voice.insert', characterId, text: 'ひとつめ', atMs: 20_000 },
        { op: 'voice.insert', characterId, text: 'ふたつめ', atMs: 20_100 }
      ])
      const [first, second] = byType(withLines, 'voice').sort((x, y) => x.startMs - y.startMs)
      expect(second!.layerId).not.toBe(first!.layerId)
      withLines = apply(withLines, [{ op: 'item.setTimeRange', itemId: second!.id, startMs: 40_000 }])

      const next = apply(withLines, [{ op: 'timeline.packLeft', itemIds: [first!.id, second!.id] }])
      const packed = (id: string): Item => next.items.find((item) => item.id === id)!
      expect(packed(first!.id).startMs).toBe(0)
      expect(packed(second!.id).startMs).toBe(packed(first!.id).durationMs)
      expect(packed(second!.id).layerId).toBe(second!.layerId)
    })
  })

  it('速度は動画だけ・範囲内だけ', () => {
    const project = base()
    const bgm = byType<AudioItem>(project, 'audio')[0]!
    const clip = byType<VideoItem>(project, 'video')[0]!
    expect(() => apply(project, [{ op: 'item.setSpeed', itemId: bgm.id, rate: 2 }])).toThrow('動画だけ')
    expect(() => apply(project, [{ op: 'item.setSpeed', itemId: clip.id, rate: 8 }])).toThrow('0.25〜4倍')
  })

  it('編集AIも同じ操作を提案できる', () => {
    for (const command of [
      { op: 'item.split', itemId: 'itm_1', atMs: 1000 },
      { op: 'item.setSpeed', itemId: 'itm_1', rate: 1.5 },
      { op: 'timeline.rippleDelete', itemIds: ['itm_1'] },
      { op: 'timeline.closeGap', atMs: 1000 },
      { op: 'timeline.packLeft', itemIds: ['itm_1'], keepGaps: true },
      { op: 'timeline.insertGap', atMs: 1000, durationMs: 500 }
    ]) {
      expect(aiCommandSchema.safeParse(command).success).toBe(true)
    }
    expect(aiCommandSchema.safeParse({ op: 'item.paste', items: [], atMs: 0 }).success).toBe(false)
  })
})

describe('速度を変えた動画の音', () => {
  it('高さを保ったまま速さを変えるフィルタを、範囲外は重ねて作る', () => {
    expect(atempoChain(1)).toBeNull()
    expect(atempoChain(1.5)).toBe('atempo=1.500000')
    expect(atempoChain(4)).toBe('atempo=2,atempo=2.000000')
    expect(atempoChain(0.25)).toBe('atempo=0.5,atempo=0.500000')
  })
})

describe('速度を変えた動画の音を実際に読む', () => {
  it('2倍速なら、素材の2秒分が1秒の音になる', async () => {
    const { mkdtempSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { makeTestAudio } = await import('./fixtures/media')
    const { PcmStream, SAMPLE_RATE } = await import('@main/services/export/streams')
    const path = makeTestAudio(mkdtempSync(join(tmpdir(), 'zs-speed-')), { seconds: 3 })
    const stream = new PcmStream('ffmpeg', process.env, path, 0, 1000, 2)
    let frames = 0
    for (;;) {
      const chunk = await stream.read(SAMPLE_RATE / 4)
      const nonZero = chunk.findLastIndex((value) => value !== 0)
      if (nonZero < 0) break
      frames += Math.ceil((nonZero + 1) / 2)
      if (frames > SAMPLE_RATE * 3) break
    }
    stream.close()
    // 出力の長さは約1秒(atempo の前後の揺らぎを見込む)
    expect(frames / SAMPLE_RATE).toBeGreaterThan(0.9)
    expect(frames / SAMPLE_RATE).toBeLessThan(1.1)
  })
})

describe('ズームと静止画', () => {
  const region = { x: 320, y: 180, width: 960 }

  it('既定では、その時点の動画のコマを静止画にして置き換え、ズームとグループにする(ほかは動かない)', () => {
    const project = base()
    const text = byType<TextItem>(project, 'text')[0]!
    const result = run(project, zoomCommands(project, 4000, 3000, region))
    const still = result.project.items.find((item) => item.id === result.resolvedIds['still']) as VideoItem
    const zoom = result.project.items.find((item) => item.id === result.resolvedIds['zoom'])!
    expect(still).toMatchObject({ type: 'video', freeze: true, startMs: 4000, durationMs: 3000 })
    expect(zoom).toMatchObject({ type: 'zoom', startMs: 4000, durationMs: 3000, method: 'smooth' })
    expect(still.groupId).toBeDefined()
    expect(zoom.groupId).toBe(still.groupId)
    // 動画のその先は静止画の後ろから続き、テロップは動かない
    const videos = byType<VideoItem>(result.project, 'video').filter((item) => !item.freeze)
    expect(videos.map((item) => [item.startMs, item.startMs + item.durationMs])).toEqual([
      [0, 4000],
      [7000, 10_000]
    ])
    expect(byType<TextItem>(result.project, 'text')[0]!.startMs).toBe(text.startMs)
  })

  it('設定で「しない」ならズームだけ、「止めてずらす」なら後ろをずらす。既定の寄り方も設定に従う', () => {
    let project = apply(base(), [{ op: 'project.setEditing', zoomOnStill: 'off', zoomMethod: 'punch' }])
    expect(zoomCommands(project, 4000, 3000, region).map((command) => command.op)).toEqual(['zoom.insert'])
    const zoomed = apply(project, zoomCommands(project, 4000, 3000, region))
    expect(zoomed.items.find((item) => item.type === 'zoom')).toMatchObject({ method: 'punch' })

    project = apply(base(), [{ op: 'project.setEditing', zoomOnStill: 'insert' }])
    const text = byType<TextItem>(project, 'text')[0]!
    const inserted = apply(project, zoomCommands(project, 4000, 3000, region))
    expect(byType<TextItem>(inserted, 'text')[0]!.startMs).toBe(text.startMs + 3000)

    // 動画が無い所ではズームだけ
    expect(zoomCommands(base(), 30_000, 3000, region).map((command) => command.op)).toEqual(['zoom.insert'])
  })
})

describe('動画のフェードと音', () => {
  it('動画のフェード(エフェクト)に合わせて、動画の音も小さくなる', async () => {
    const { gainAt, gainEnvelope } = await import('@shared/audio/envelope')
    const project = base()
    const clip = byType<VideoItem>(project, 'video')[0]!
    const faded = apply(project, [{ op: 'item.addEffect', itemId: clip.id, effect: { type: 'fade', inMs: 1000, outMs: 1000 } }])
    const video = byType<VideoItem>(faded, 'video')[0]!
    const points = gainEnvelope(faded, video)
    expect(gainAt(points, 0)).toBeCloseTo(0)
    expect(gainAt(points, 500)).toBeCloseTo(video.volume * 0.5)
    expect(gainAt(points, 5000)).toBeCloseTo(video.volume)
    expect(gainAt(points, video.durationMs - 500)).toBeCloseTo(video.volume * 0.5)
  })
})
