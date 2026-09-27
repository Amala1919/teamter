import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { EventBus } from '@main/core/events'
import { AnalysisService } from '@main/services/media/analysis-service'
import { FfmpegLocator } from '@main/services/media/ffmpeg'
import { MediaService } from '@main/services/media/media-service'
import { buildDraftPrompt, liveMomentsFor, wrapDraftCommands } from '@shared/ai/draft'
import { buildPublishPrompt, interpretPublishResponse } from '@shared/ai/publish'
import { applyCommands, type CommandContext } from '@shared/commands/apply'
import type { Command } from '@shared/commands/types'
import { candidateSegments, segmentRecording, type RecordingAnalysis } from '@shared/media/analysis'
import { chapterLines, normalizeChapters, youtubeTime } from '@shared/project/chapters'
import { createEmptyProject } from '@shared/project/factory'
import type { Project } from '@shared/project/types'
import { defaultSettings } from '@shared/settings/schema'

let counter = 0
const context = (): CommandContext => ({ newId: (prefix) => `${prefix}_${++counter}`, now: () => new Date('2026-01-01T00:00:00Z') })
const apply = (project: Project, commands: Command[]): Project => applyCommands(project, commands, context()).project

describe('区間の候補', () => {
  const analysis: RecordingAnalysis = {
    durationMs: 120_000,
    sceneChanges: [2_000, 30_000, 31_000, 100_000],
    silences: [[100_000, 120_000]],
    loudness: Array.from({ length: 120 }, (_, second) => (second >= 30 && second < 60 ? 0.9 : 0.2))
  }

  it('場面の切り替わりで区切り、短い区間はつなぎ、長い区間は分け、無音の区間は外す', () => {
    expect(segmentRecording(analysis)).toEqual([
      [0, 30_000],
      [30_000, 70_000],
      [70_000, 100_000]
    ])
  })

  it('目印を最も重く見て、盛り上がりと会話を足した点数の高い順に選び、時刻順に返す', () => {
    const picked = candidateSegments(analysis, { markers: [80_000], talks: [5_000, 6_000] }, 2)
    expect(picked.map((segment) => [segment.inMs, segment.markers, segment.talks])).toEqual([
      [0, 0, 2],
      [70_000, 1, 0]
    ])
  })
})

describe('録画の解析(本物の ffmpeg)', () => {
  it('場面の切り替わり・無音・1秒ごとの音の大きさを調べ、2回目はキャッシュを使う', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'zunda-analysis-'))
    const video = join(directory, 'scene.mp4')
    // 0〜2秒: 赤い画面と音 / 2〜4秒: 青い画面と無音
    execFileSync('ffmpeg', [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'color=c=red:s=160x90:r=10:d=2',
      '-f', 'lavfi', '-i', 'color=c=blue:s=160x90:r=10:d=2',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=2',
      '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono',
      '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v];[3:a]atrim=duration=2[silent];[2:a][silent]concat=n=2:v=0:a=1[a]',
      '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', video
    ])
    const settings = defaultSettings()
    const locator = new FfmpegLocator(() => settings)
    const media = new MediaService(locator, () => settings, new EventBus(), { proxy: join(directory, 'proxy'), peaks: join(directory, 'peaks') })
    const service = new AnalysisService(locator, media, join(directory, 'analysis'))
    const analysis = await service.analyze(video)
    expect(analysis.sceneChanges.some((at) => Math.abs(at - 2000) <= 600)).toBe(true)
    expect(analysis.silences.some(([start, end]) => start >= 1800 && start <= 2400 && end >= 3500)).toBe(true)
    expect(analysis.loudness.length).toBeGreaterThanOrEqual(4)
    expect(analysis.loudness[0]!).toBeGreaterThan(analysis.loudness[3]!)
    expect(await service.analyze(video)).toEqual(analysis)
  })
})

function draftProject(): { project: Project; assetId: string } {
  const project = apply(createEmptyProject(), [
    { op: 'character.create', name: 'ずんだもん', engineId: 'voicevox', speakerId: 3, speakerName: 'ずんだもん' },
    {
      op: 'character.create',
      name: '四国めたん',
      engineId: 'voicevox',
      speakerId: 2,
      speakerName: '四国めたん',
      authorRole: 'ai',
      persona: { personality: '冷静で毒舌', speechStyle: '〜わ', banterRole: 'tsukkomi', forbidden: [], targetLengthChars: 20 }
    },
    {
      op: 'asset.add',
      asset: {
        type: 'video',
        path: { absolute: '/rec/boss.mkv', relative: null },
        license: { source: '自分で録画', creditRequired: false },
        durationMs: 600_000,
        width: 1920,
        height: 1080,
        fps: 60,
        hasAudio: true
      },
      tempId: 'rec'
    }
  ])
  const assetId = Object.keys(project.assets)[0]!
  const withLive = apply(project, [
    {
      op: 'live.importSession',
      session: {
        id: 'ses_draft1',
        startedAt: '2026-09-27T20:00:00Z',
        endedAt: null,
        recordingAssetId: assetId,
        offsetMs: 10_000,
        offsetSource: 'obs',
        entries: [
          { id: 'ent_1', atMs: 50_000, role: 'user', text: 'ボス出たのだ', kind: 'chat', bookmarked: false, adoptedItemId: null, generatedBy: null },
          { id: 'ent_2', atMs: 90_000, role: 'user', text: '奇跡の回避', kind: 'marker', bookmarked: true, adoptedItemId: null, generatedBy: null }
        ]
      }
    }
  ])
  return { project: withLive, assetId }
}

describe('下書きの依頼文', () => {
  it('候補の区間・録画上の時刻の会話と目印・役の ID を渡す', () => {
    const { project, assetId } = draftProject()
    const moments = liveMomentsFor(project, assetId)
    expect(moments.map((moment) => moment.atMs)).toEqual([60_000, 100_000])
    const prompt = buildDraftPrompt(project, { recordingAssetId: assetId, targetMs: 300_000, instruction: 'ボス戦中心' }, [
      { id: 'seg1', inMs: 55_000, outMs: 80_000, score: 2.5, markers: 0, talks: 1, loudness: 0.5 }
    ])
    expect(prompt.system).toContain(`assetId は "${assetId}"`)
    expect(prompt.system).toContain('5分前後')
    expect(prompt.system).toContain('冷静で毒舌')
    const content = prompt.turns[0]!.content
    expect(content).toContain('seg1 0:55.000-1:20.000')
    expect(content).toContain('[1:00.000] ずんだもん: ボス出たのだ')
    expect(content).toContain('[1:40.000] ★目印: 奇跡の回避')
    expect(content).toContain('ボス戦中心')
  })

  it('下書きを当てる間だけ、セリフの挿入で後ろがずれないようにする', () => {
    const { project, assetId } = draftProject()
    const characterId = Object.values(project.characters).find((character) => character.authorRole === 'ai')!.id
    const commands = wrapDraftCommands(project, [
      { op: 'media.placeVideo', assetId, atMs: 0, inMs: 55_000, outMs: 80_000 },
      { op: 'media.placeVideo', assetId, atMs: 25_000, inMs: 95_000, outMs: 105_000 },
      { op: 'voice.insert', characterId, text: '見なさい', atMs: 1_000 }
    ])
    const next = apply(project, commands)
    const videos = next.items.filter((item) => item.type === 'video').map((item) => item.startMs)
    expect(videos).toEqual([0, 25_000])
    expect(next.editing.rippleOnVoiceChange).toBe(true)
  })
})

describe('投稿文', () => {
  it('チャプターは時刻順・最初は 0:00・10秒以上空ける', () => {
    expect(
      normalizeChapters([
        { atMs: 65_000, title: 'ボス戦' },
        { atMs: 3_000, title: 'はじめに' },
        { atMs: 70_000, title: '近すぎる' },
        { atMs: 200_000, title: '' },
        { atMs: 125_000, title: 'まとめ' }
      ])
    ).toEqual([
      { atMs: 0, title: 'はじめに' },
      { atMs: 65_000, title: 'ボス戦' },
      { atMs: 125_000, title: 'まとめ' }
    ])
    expect(chapterLines([{ atMs: 0, title: 'はじめに' }, { atMs: 65_000, title: 'ボス戦' }], 300_000)).toBe('0:00 はじめに\n1:05 ボス戦')
    expect(youtubeTime(3_723_000, 4_000_000)).toBe('1:02:03')
  })

  it('依頼文には台本と目印が入り、返ってきたチャプターは決まりに合わせる', () => {
    const { project: base, assetId } = draftProject()
    // 録画をタイムラインに置くと、目印がタイムライン上の時刻になる
    const project = apply(base, [{ op: 'media.placeVideo', assetId, atMs: 0, inMs: 0, outMs: 300_000 }])
    const prompt = buildPublishPrompt(project)
    expect(prompt.turns[0]!.content).toContain('## 録画中に打った目印\n[1:40] 奇跡の回避')
    const interpreted = interpretPublishResponse(project, {
      titles: [' 初見ボス戦 ', ''],
      description: '  ボスに挑む回  ',
      chapters: [
        { atSeconds: 5, title: '開始' },
        { atSeconds: 8, title: '近い' }
      ]
    })
    expect(interpreted).toEqual({ titles: ['初見ボス戦'], description: 'ボスに挑む回', chapters: [{ atMs: 0, title: '開始' }] })
  })
})
