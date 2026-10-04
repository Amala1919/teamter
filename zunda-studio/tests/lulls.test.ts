import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { EventBus } from '@main/core/events'
import { AnalysisService } from '@main/services/media/analysis-service'
import { FfmpegLocator } from '@main/services/media/ffmpeg'
import { MediaService } from '@main/services/media/media-service'
import { applyCommands } from '@shared/commands/apply'
import type { Command } from '@shared/commands/types'
import { DEFAULT_LULL_OPTIONS, findLulls, lullsForItem, type MediaActivity } from '@shared/media/activity'
import { createEmptyProject } from '@shared/project/factory'
import type { Project, TextItem, VideoItem } from '@shared/project/types'
import { defaultSettings } from '@shared/settings/schema'

let counter = 0
const ctx = { newId: (prefix: string) => `${prefix}_${++counter}`, now: () => new Date('2026-01-01T00:00:00Z') }

function apply(project: Project, commands: Command[]): Project {
  return applyCommands(project, commands, ctx).project
}

/** 0〜4秒は動く、4〜10秒は止まっている、10〜12秒はまた動く(250ms ごと)。 */
function activity(): MediaActivity {
  const motion = Array.from({ length: 48 }, (_, index) => (index >= 16 && index < 40 ? 0 : 0.05))
  return { durationMs: 12_000, stepMs: 250, motion, sound: [] }
}

describe('待ち時間を探す', () => {
  it('動きの少ない区間を、前後の余白を残して拾う。短いものは拾わない', () => {
    expect(findLulls(activity(), DEFAULT_LULL_OPTIONS)).toEqual([[4500, 9500]])
    expect(findLulls(activity(), { ...DEFAULT_LULL_OPTIONS, minMs: 7000 })).toEqual([])
    expect(findLulls(activity(), { ...DEFAULT_LULL_OPTIONS, useMotion: false, useSound: false })).toEqual([])
  })

  it('タイムラインの動画の区間に直す(切り出し位置と速さを考える)', () => {
    const item = { startMs: 1000, inMs: 2000, outMs: 12_000, playbackRate: 2, freeze: false } as VideoItem
    expect(lullsForItem(item, activity(), DEFAULT_LULL_OPTIONS)).toEqual([[2250, 4750]])
  })

  it('本物の ffmpeg で、止まっている画面を見つける', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'zunda-lulls-'))
    const video = join(directory, 'game.mp4')
    // 0〜3秒: 動く模様 / 3〜8秒: 止まった青い画面
    execFileSync('ffmpeg', [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=30:duration=3',
      '-f', 'lavfi', '-i', 'color=c=blue:size=320x180:rate=30:duration=5',
      '-filter_complex', '[0:v][1:v]concat=n=2:v=1[v]',
      '-map', '[v]', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', video
    ])
    const settings = defaultSettings()
    const locator = new FfmpegLocator(() => settings)
    const media = new MediaService(locator, () => settings, new EventBus(), { proxy: join(directory, 'proxy'), peaks: join(directory, 'peaks') })
    const service = new AnalysisService(locator, media, join(directory, 'analysis'))
    const result = await service.activity(video)
    expect(result.stepMs).toBe(250)
    expect(result.sound).toEqual([])
    const lulls = findLulls(result, DEFAULT_LULL_OPTIONS)
    expect(lulls).toHaveLength(1)
    expect(lulls[0]![0]).toBeGreaterThanOrEqual(3000)
    expect(lulls[0]![0]).toBeLessThanOrEqual(4000)
    expect(lulls[0]![1]).toBeGreaterThanOrEqual(7000)
    // 2回目はキャッシュから同じ結果を返す。
    expect(await service.activity(video)).toEqual(result)
  })
})

describe('待ち時間をまとめて詰める', () => {
  function project(): Project {
    return apply(createEmptyProject(), [
      {
        op: 'asset.add',
        asset: { type: 'video', path: { absolute: '/x/game.mp4', relative: null }, durationMs: 30_000, width: 1920, height: 1080, fps: 30, hasAudio: true, license: { source: '録画', creditRequired: false } },
        tempId: 'v'
      },
      { op: 'media.placeVideo', assetId: 'v', atMs: 0, tempId: 'video' },
      // 後ろの素材(BGM ではなくテロップ)。詰めると前へ動く。
      { op: 'media.placeText', text: 'あとで', atMs: 25_000, durationMs: 2000 }
    ])
  }

  it('切り取ると区間が消え、後ろの素材も前へ詰まる', () => {
    let current = project()
    const videoId = current.items[0]!.id
    current = apply(current, [
      {
        op: 'video.condense',
        itemId: videoId,
        mode: 'cut',
        ranges: [
          { fromMs: 5000, toMs: 10_000 },
          { fromMs: 15_000, toMs: 18_000 }
        ]
      }
    ])
    const videos = current.items.filter((item): item is VideoItem => item.type === 'video').sort((a, b) => a.startMs - b.startMs)
    expect(videos.map((video) => [video.startMs, video.durationMs, video.inMs, video.outMs])).toEqual([
      [0, 5000, 0, 5000],
      [5000, 5000, 10_000, 15_000],
      [10_000, 12_000, 18_000, 30_000]
    ])
    expect(current.items.find((item) => item.type === 'text')!.startMs).toBe(17_000)
  })

  it('早送りにすると区間だけ速くなり、「▶▶ ×4」が出て、1回で元に戻せる', () => {
    const before = project()
    const videoId = before.items[0]!.id
    const after = apply(before, [{ op: 'video.condense', itemId: videoId, mode: 'speed', rate: 4, ranges: [{ fromMs: 4000, toMs: 12_000 }] }])
    const videos = after.items.filter((item): item is VideoItem => item.type === 'video').sort((a, b) => a.startMs - b.startMs)
    expect(videos.map((video) => [video.startMs, video.durationMs, video.playbackRate])).toEqual([
      [0, 4000, 1],
      [4000, 2000, 4],
      [6000, 18_000, 1]
    ])
    const labels = after.items.filter((item): item is TextItem => item.type === 'text' && item.text.startsWith('▶▶'))
    expect(labels).toHaveLength(1)
    expect(labels[0]).toMatchObject({ text: '▶▶ ×4', startMs: 4000, durationMs: 2000 })
    // 後ろのテロップは、短くなった6秒だけ前へ。
    expect(after.items.find((item) => item.type === 'text' && item.text === 'あとで')!.startMs).toBe(19_000)
    // コマンドは1回なので、元のプロジェクトはそのまま(取り消しの単位も1回)。
    expect(before.items).toHaveLength(2)
    expect(() => apply(before, [{ op: 'video.condense', itemId: videoId, mode: 'speed', rate: 32, ranges: [{ fromMs: 0, toMs: 1000 }] }])).toThrow('16倍')
  })
})
