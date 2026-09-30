import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { EventBus } from '@main/core/events'
import { ExportService } from '@main/services/export/export-service'
import { FfmpegLocator } from '@main/services/media/ffmpeg'
import { PsdService } from '@main/services/psd/psd-service'
import type { SynthesisService } from '@main/services/voice/synthesis-service'
import { sourceTimeMs } from '@shared/audio/envelope'
import { aiCommandSchema } from '@shared/ai/edit-commands'
import { applyCommands, type CommandContext } from '@shared/commands/apply'
import type { Command } from '@shared/commands/types'
import { createEmptyProject } from '@shared/project/factory'
import type { Project, VideoItem, ZoomItem } from '@shared/project/types'
import { defaultSettings } from '@shared/settings/schema'

let counter = 0
const context = (): CommandContext => ({ newId: (prefix) => `${prefix}_${++counter}`, now: () => new Date('2026-01-01T00:00:00Z') })
const run = (project: Project, commands: Command[]): ReturnType<typeof applyCommands> => applyCommands(project, commands, context())
const apply = (project: Project, commands: Command[]): Project => run(project, commands).project

/** 30fps・10秒の録画を 0 秒から置き、4秒のテロップを後ろに置いたプロジェクト。 */
function base(path = '/rec/game.mp4', options: { fps?: number; seconds?: number; width?: number; height?: number } = {}): Project {
  const { fps = 30, seconds = 10, width = 1280, height = 720 } = options
  const canvas = options.width !== undefined ? { width, height, fps } : {}
  return apply(createEmptyProject(canvas), [
    {
      op: 'asset.add',
      asset: {
        type: 'video',
        path: { absolute: path, relative: null },
        license: { source: '自分で録画', creditRequired: false },
        durationMs: seconds * 1000,
        width,
        height,
        fps,
        hasAudio: true
      },
      tempId: 'v'
    },
    { op: 'media.placeVideo', assetId: 'v', atMs: 0, tempId: 'clip' },
    { op: 'media.placeText', text: 'あとのテロップ', atMs: seconds * 1000 + 1000, durationMs: 1000 }
  ])
}

const videos = (project: Project): VideoItem[] =>
  project.items.filter((item): item is VideoItem => item.type === 'video').sort((a, b) => a.startMs - b.startMs)

describe('静止画(フリーズフレーム)', () => {
  it('途中で止めて挟むと、止める直前のコマを出し続け、後ろはその分ずれる', () => {
    const project = base()
    const clip = videos(project)[0]!
    const result = run(project, [{ op: 'item.freezeFrame', itemId: clip.id, atMs: 4000, durationMs: 2000, mode: 'insert', tempId: 'still' }])
    const [first, still, rest] = videos(result.project)
    expect(first).toMatchObject({ startMs: 0, durationMs: 4000, inMs: 0, outMs: 4000 })
    // 30fps なので、4秒ちょうどの1コマ前(3967ms)のコマで止める
    expect(still).toMatchObject({ id: result.resolvedIds['still'], startMs: 4000, durationMs: 2000, inMs: 3967, freeze: true, effects: [] })
    expect(rest).toMatchObject({ startMs: 6000, durationMs: 6000, inMs: 4000, outMs: 10_000 })
    expect(result.project.items.find((item) => item.type === 'text')!.startMs).toBe(13_000)
    // 静止画の間は、素材の時刻が動かない
    expect(sourceTimeMs(still!, 0)).toBe(3967)
    expect(sourceTimeMs(still!, 1999)).toBe(3967)
  })

  it('寄っている途中で止めると、ズームも止めている間ずっと寄ったままにする', () => {
    let project = base()
    project = apply(project, [{ op: 'zoom.insert', atMs: 3000, durationMs: 2000, region: { x: 0, y: 0, width: 640 }, method: 'cut' }])
    const clip = videos(project)[0]!
    const frozen = apply(project, [{ op: 'item.freezeFrame', itemId: clip.id, atMs: 4000, durationMs: 3000, mode: 'insert' }])
    const zoom = frozen.items.find((item): item is ZoomItem => item.type === 'zoom')!
    expect(zoom).toMatchObject({ startMs: 3000, durationMs: 5000 })
  })

  it('上書きでは後ろをずらさず、動画のその先を静止画で置き換える', () => {
    const project = base()
    const clip = videos(project)[0]!
    const result = apply(project, [{ op: 'item.freezeFrame', itemId: clip.id, atMs: 4000, durationMs: 2000, mode: 'overwrite' }])
    const [first, still, rest] = videos(result)
    expect(first).toMatchObject({ durationMs: 4000 })
    expect(still).toMatchObject({ startMs: 4000, durationMs: 2000, freeze: true })
    expect(rest).toMatchObject({ startMs: 6000, durationMs: 4000, inMs: 6000, outMs: 10_000 })
    expect(result.items.find((item) => item.type === 'text')!.startMs).toBe(11_000)
    // 残りより長く止めると、後半は消える
    const long = apply(project, [{ op: 'item.freezeFrame', itemId: clip.id, atMs: 4000, durationMs: 8000, mode: 'overwrite' }])
    expect(videos(long)).toHaveLength(2)
  })

  it('上書きでは、静止画の後に続く動画だけをフェードインさせ(前はフェードアウトしない)、設定で切れる。挟むときは付けない', () => {
    const project = base()
    const clip = videos(project)[0]!
    const [first, still, rest] = videos(apply(project, [{ op: 'item.freezeFrame', itemId: clip.id, atMs: 4000, durationMs: 2000, mode: 'overwrite' }]))
    expect(first!.effects).toEqual([])
    expect(still!.effects).toEqual([])
    expect(rest!.effects).toEqual([{ type: 'fade', inMs: 300, outMs: 0 }])

    const off = apply(project, [{ op: 'project.setEditing', freezeFadeIn: false }])
    const [, , plain] = videos(apply(off, [{ op: 'item.freezeFrame', itemId: clip.id, atMs: 4000, durationMs: 2000, mode: 'overwrite' }]))
    expect(plain!.effects).toEqual([])

    const inserted = videos(apply(project, [{ op: 'item.freezeFrame', itemId: clip.id, atMs: 4000, durationMs: 2000, mode: 'insert' }]))
    expect(inserted.map((item) => item.effects)).toEqual([[], [], []])
  })

  it('動画の終わりちょうどで止めると、最後のコマを後ろに足す(分割はしない)', () => {
    const project = base()
    const clip = videos(project)[0]!
    const [whole, still] = videos(apply(project, [{ op: 'item.freezeFrame', itemId: clip.id, atMs: 10_000, durationMs: 1500, mode: 'insert' }]))
    expect(whole).toMatchObject({ durationMs: 10_000, outMs: 10_000 })
    expect(still).toMatchObject({ startMs: 10_000, durationMs: 1500, inMs: 9967, freeze: true })
  })

  it('静止画は長さだけ変わり(コマは同じ)、速度の変更や重ねての静止はできない', () => {
    const project = base()
    const clip = videos(project)[0]!
    const result = run(project, [{ op: 'item.freezeFrame', itemId: clip.id, atMs: 4000, durationMs: 2000, mode: 'insert', tempId: 'still' }])
    const stillId = result.resolvedIds['still']!
    const trimmed = apply(result.project, [{ op: 'item.trim', itemId: stillId, endMs: 9000 }])
    expect(trimmed.items.find((item) => item.id === stillId)).toMatchObject({ durationMs: 5000, inMs: 3967, outMs: 3967 })
    const split = apply(result.project, [{ op: 'item.split', itemId: stillId, atMs: 5000 }])
    expect(videos(split).filter((item) => item.freeze).map((item) => item.inMs)).toEqual([3967, 3967])
    expect(() => apply(result.project, [{ op: 'item.setSpeed', itemId: stillId, rate: 2 }])).toThrow('静止画の速度')
    expect(() => apply(result.project, [{ op: 'item.freezeFrame', itemId: stillId, atMs: 4500, durationMs: 1000, mode: 'insert' }])).toThrow('すでに静止画')
    expect(() => apply(result.project, [{ op: 'item.freezeFrame', itemId: clip.id, atMs: 30_000, durationMs: 1000, mode: 'insert' }])).toThrow('動画の中にありません')
    expect(aiCommandSchema.safeParse({ op: 'item.freezeFrame', itemId: 'x', atMs: 1, durationMs: 1000, mode: 'insert' }).success).toBe(true)
  })

  it('書き出しでも止めている間は同じコマが映り、音は鳴らない(本物の ffmpeg)', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'zs-freeze-'))
    // 0〜1.5秒は赤、1.5〜3秒は緑の動画(音つき)
    const source = join(directory, 'change.mp4')
    execFileSync('ffmpeg', [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'color=c=red:s=160x90:r=15:d=1.5',
      '-f', 'lavfi', '-i', 'color=c=lime:s=160x90:r=15:d=1.5',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=3',
      '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]',
      '-map', '[v]', '-map', '2:a', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', source
    ])
    let project = base(source, { fps: 15, seconds: 3, width: 160, height: 90 })
    const clip = videos(project)[0]!
    project = apply(project, [{ op: 'item.freezeFrame', itemId: clip.id, atMs: 1000, durationMs: 2000, mode: 'insert' }])
    // テロップは外しておく(色を調べやすくする)
    project = { ...project, items: project.items.filter((item) => item.type === 'video') }

    const settings = defaultSettings()
    const synthesis = { resolve: () => Promise.resolve(null) } as unknown as SynthesisService
    const exporter = new ExportService(new FfmpegLocator(() => settings), () => settings, new EventBus(), new PsdService(join(directory, 'psd')), synthesis, join(directory, 'temp'))
    const output = join(directory, 'out.mp4')
    await exporter.run('freeze', { project, outputPath: output })

    const color = (seconds: number): number[] => {
      const frame = execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-ss', String(seconds), '-i', output, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])
      const offset = (45 * 160 + 80) * 3
      return [frame[offset]!, frame[offset + 1]!, frame[offset + 2]!]
    }
    const isRed = ([r, g]: number[]): boolean => r! > 180 && g! < 80
    const isGreen = ([r, g]: number[]): boolean => g! > 180 && r! < 80
    // 元の動画なら 2.0 秒は緑だが、1〜3秒は 1 秒時点(赤)のコマで止まっている
    expect(isRed(color(1.5))).toBe(true)
    expect(isRed(color(2.6))).toBe(true)
    // 止め終わったら続きから(3.2秒 = 素材の1.2秒は赤、4.2秒 = 素材の2.2秒は緑)
    expect(isRed(color(3.2))).toBe(true)
    expect(isGreen(color(4.2))).toBe(true)

    const rms = (from: number, to: number): number => {
      const pcm = execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-ss', String(from), '-t', String(to - from), '-i', output, '-ac', '1', '-f', 'f32le', '-'])
      const samples = new Float32Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 4))
      return Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / Math.max(1, samples.length))
    }
    expect(rms(0.2, 0.8)).toBeGreaterThan(0.02)
    expect(rms(1.3, 2.7)).toBeLessThan(0.002)
    expect(rms(3.3, 3.9)).toBeGreaterThan(0.02)
  }, 60_000)
})
