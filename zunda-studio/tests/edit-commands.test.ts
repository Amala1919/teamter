import { describe, expect, it } from 'vitest'

import { atempoChain } from '@main/services/export/streams'
import { aiCommandSchema } from '@shared/ai/edit-commands'
import { applyCommands, type CommandContext } from '@shared/commands/apply'
import type { Command } from '@shared/commands/types'
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
    expect(first).toMatchObject({ id: clip.id, startMs: 0, durationMs: 4000, inMs: 1000, outMs: 5000, effects: [{ type: 'fade', inMs: 500, outMs: 0 }] })
    expect(second).toMatchObject({ id: result.resolvedIds['rest'], startMs: 4000, durationMs: 6000, inMs: 5000, outMs: 11_000, effects: [{ type: 'fade', inMs: 0, outMs: 800 }] })
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
    const pasted = apply(project, [{ op: 'item.paste', items: [{ ...bgm, layerId: 'lyr_gone' }], atMs: 0 }])
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
