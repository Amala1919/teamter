import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { beforeAll, describe, expect, it } from 'vitest'

import { EventBus } from '../src/main/core/events'
import { mixAudio } from '../src/main/services/export/audio-mix'
import { ExportService } from '../src/main/services/export/export-service'
import { FfmpegLocator } from '../src/main/services/media/ffmpeg'
import { PsdService } from '../src/main/services/psd/psd-service'
import type { SynthesisService } from '../src/main/services/voice/synthesis-service'
import { applyCommands, type CommandContext } from '@shared/commands/apply'
import type { Command } from '@shared/commands/types'
import type { ExportProgress } from '@shared/export/types'
import { generateCredits } from '@shared/project/credits'
import { createEmptyProject } from '@shared/project/factory'
import type { Project } from '@shared/project/types'
import { defaultSettings } from '@shared/settings/schema'

import { makeTestAudio, makeTestVideo } from './fixtures/media'

function context(): CommandContext {
  let counter = 0
  return { newId: (prefix) => `${prefix}_${++counter}`, now: () => new Date('2026-01-01T00:00:00Z') }
}

function apply(project: Project, commands: Command[]): Project {
  return applyCommands(project, commands, context()).project
}

function ffmpeg(args: string[]): Buffer {
  return execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...args], { maxBuffer: 256 * 1024 * 1024 })
}

/** 書き出した動画の、ある時刻のコマの画素(RGB)。 */
function pixelAt(path: string, seconds: number, x: number, y: number, width: number): number[] {
  const frame = ffmpeg(['-ss', String(seconds), '-i', path, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])
  const offset = (y * width + x) * 3
  return [frame[offset]!, frame[offset + 1]!, frame[offset + 2]!]
}

/** WAV/動画の音声の、区間ごとの音の大きさ(RMS)。 */
function rms(path: string, fromSeconds: number, toSeconds: number): number {
  const pcm = ffmpeg(['-ss', String(fromSeconds), '-t', String(toSeconds - fromSeconds), '-i', path, '-ac', '1', '-ar', '48000', '-f', 'f32le', '-'])
  const samples = new Float32Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 4))
  let sum = 0
  for (const sample of samples) sum += sample * sample
  return Math.sqrt(sum / Math.max(1, samples.length))
}

function isRed([r, g, b]: number[]): boolean {
  return r! > 180 && g! < 70 && b! < 70
}

function isBlue([r, g, b]: number[]): boolean {
  return b! > 180 && r! < 70 && g! < 70
}

describe('書き出し(本物の ffmpeg)', () => {
  const directory = mkdtempSync(join(tmpdir(), 'zunda-export-'))
  let video: string
  let bgm: string
  let silentVoice: string
  const settings = defaultSettings()
  const events = new EventBus()
  const synthesis = { resolve: () => Promise.resolve(silentVoice) } as unknown as SynthesisService
  const exporter = (): ExportService =>
    new ExportService(new FfmpegLocator(() => settings), () => settings, events, new PsdService(join(directory, 'psd')), synthesis, join(directory, 'temp'))

  beforeAll(() => {
    video = makeTestVideo(directory, { seconds: 3, width: 320, height: 180, fps: 15 })
    bgm = makeTestAudio(directory, { seconds: 1, frequency: 220 })
    silentVoice = join(directory, 'voice.wav')
    ffmpeg(['-y', '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono', '-t', '1', silentVoice])
  })

  function buildProject(): Project {
    let project = createEmptyProject({ width: 320, height: 180, fps: 15, renderSeed: 3 })
    project = apply(project, [
      {
        op: 'asset.add',
        asset: {
          type: 'video',
          path: { absolute: video, relative: null },
          license: { source: '自分で録画', creditRequired: false },
          durationMs: 3000,
          width: 320,
          height: 180,
          fps: 15,
          hasAudio: true
        },
        tempId: 'v'
      },
      {
        op: 'asset.add',
        asset: {
          type: 'audio',
          path: { absolute: bgm, relative: null },
          license: { source: 'https://example.com/bgm', creditRequired: true, creditText: 'BGM: テスト音源' },
          durationMs: 1000
        },
        tempId: 'a'
      },
      { op: 'character.create', name: 'ずんだもん', engineId: 'voicevox', speakerId: 3, speakerName: 'ずんだもん', creditText: 'VOICEVOX:ずんだもん', tempId: 'z' },
      { op: 'media.placeVideo', assetId: 'v', atMs: 0, volume: 0 },
      // BGM はループで3秒。セリフの間は下げる
      { op: 'media.placeAudio', assetId: 'a', atMs: 0, durationMs: 3000, loop: true, duckable: true, volume: 1 },
      { op: 'zoom.insert', atMs: 1000, durationMs: 1000, region: { x: 0, y: 45, width: 160 }, method: 'cut' },
      { op: 'voice.insert', characterId: 'z', text: 'しゃべるのだ', atMs: 1500, tempId: 'line' }
    ])
    const line = project.items.find((item) => item.type === 'voice')!
    return apply(project, [
      {
        op: 'voice.applySynthesis',
        itemId: line.id,
        expectedText: 'しゃべるのだ',
        synthesis: { cacheKey: 'silent', audioDurationMs: 1000, accentPhrases: [], lipSync: [] }
      }
    ])
  }

  it('音声はセリフの間だけ BGM が下がり、ループで途切れない', async () => {
    const project = buildProject()
    const output = join(directory, 'mix.wav')
    await mixAudio({
      project,
      startMs: 0,
      endMs: 3000,
      ffmpeg: 'ffmpeg',
      env: process.env,
      voicePath: () => Promise.resolve(silentVoice),
      outputPath: output
    })
    const header = await readFile(output)
    expect(header.subarray(0, 4).toString()).toBe('RIFF')
    const loud = rms(output, 0.2, 1.0)
    const ducked = rms(output, 1.7, 2.3)
    expect(loud).toBeGreaterThan(0.05)
    expect(ducked / loud).toBeCloseTo(project.editing.duckVolume, 1)
    // ループの2周目(1秒以降)もセリフが始まるまでは元の大きさ
    expect(rms(output, 1.05, 1.25) / loud).toBeGreaterThan(0.9)
  })

  it('mp4(H.264/AAC)に書き出し、映像・ズーム・進み具合がプレビューと同じ規則になる', async () => {
    const project = buildProject()
    const output = join(directory, 'out.mp4')
    const progress: ExportProgress[] = []
    const stop = events.listen((envelope) => {
      if (envelope.type === 'export:progress') progress.push(envelope.payload as ExportProgress)
    })
    await exporter().run('job-1', { project, outputPath: output })
    stop()

    const probe = JSON.parse(
      execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', output]).toString()
    ) as { streams: { codec_name: string; width?: number }[]; format: { duration: string } }
    expect(probe.streams.map((stream) => stream.codec_name).sort()).toEqual(['aac', 'h264'])
    expect(probe.streams.find((stream) => stream.codec_name === 'h264')!.width).toBe(320)
    expect(Number(probe.format.duration)).toBeCloseTo(3, 0)

    // ズームの前: 左は赤、右は青
    expect(isRed(pixelAt(output, 0.5, 20, 90, 320))).toBe(true)
    expect(isBlue(pixelAt(output, 0.5, 300, 90, 320))).toBe(true)
    // ズーム中(左半分に寄る): 右端まで赤
    expect(isRed(pixelAt(output, 1.3, 300, 90, 320))).toBe(true)
    // ズームの後: 元に戻る
    expect(isBlue(pixelAt(output, 2.5, 300, 90, 320))).toBe(true)

    expect(progress.map((entry) => entry.phase)).toEqual(expect.arrayContaining(['prepare', 'audio', 'video', 'done']))
    expect(progress.at(-1)).toMatchObject({ phase: 'done', outputPath: output })
    expect(existsSync(output.replace('.mp4', '.part.mp4'))).toBe(false)
  })

  it('中止すると途中のファイルを残さない', async () => {
    const project = buildProject()
    const output = join(directory, 'cancel.mp4')
    const controller = new AbortController()
    const progress: ExportProgress[] = []
    const stop = events.listen((envelope) => {
      if (envelope.type !== 'export:progress') return
      const payload = envelope.payload as ExportProgress
      progress.push(payload)
      if (payload.phase === 'video') controller.abort()
    })
    await exporter().run('job-2', { project, outputPath: output }, controller.signal)
    stop()
    expect(progress.at(-1)?.phase).toBe('cancelled')
    expect(existsSync(output)).toBe(false)
    expect(existsSync(output.replace('.mp4', '.part.mp4'))).toBe(false)
  })

  it('合成されていないセリフがあれば書き出さない', async () => {
    const characterId = Object.keys(buildProject().characters)[0]!
    const unsynthesized = apply(buildProject(), [{ op: 'voice.insert', characterId, text: 'まだなのだ', atMs: 2600 }])
    await expect(exporter().run('job-3', { project: unsynthesized, outputPath: join(directory, 'x.mp4') })).rejects.toThrow(
      '音声が合成されていないセリフ'
    )
  })

  it('クレジットは使っている素材とキャラクターから作り、足りない記入を指摘する', () => {
    const project = buildProject()
    const credits = generateCredits(project)
    expect(credits.text).toBe('【音声】\nVOICEVOX:ずんだもん\n\n【BGM・効果音】\nBGM: テスト音源')
    expect(credits.issues).toEqual([])
    const missing = apply(project, [
      { op: 'asset.updateLicense', assetId: Object.keys(project.assets)[1]!, license: { source: '', creditRequired: true, creditText: '' } }
    ])
    expect(generateCredits(missing).issues.map((issue) => issue.message)).toEqual([
      'bgm.wav の入手元が未記入です',
      'bgm.wav はクレジットが必要ですが、表記が未記入です'
    ])
  })
})
