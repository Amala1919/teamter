import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

import { loadImage, createCanvas } from '@napi-rs/canvas'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { AppError } from '@main/core/errors'
import { AiService } from '@main/services/ai/ai-service'
import { ClaudeCodeProvider } from '@main/services/ai/claude-code-provider'
import { buildBody } from '@main/services/ai/opencode-api'
import { OpenCodeProvider } from '@main/services/ai/opencode-provider'
import type { LlmProvider } from '@main/services/ai/provider'
import { FfmpegLocator } from '@main/services/media/ffmpeg'
import { frameFilter, grabFrames } from '@main/services/media/frame-grabber'
import { clampRegion, describeRegion, visionNote, visionTimes } from '@shared/ai/cohost'
import type { AiImage, GenerateRequest } from '@shared/ai/types'
import { applyCommands, type CommandContext } from '@shared/commands/apply'
import type { Command } from '@shared/commands/types'
import { createEmptyProject } from '@shared/project/factory'
import type { Project } from '@shared/project/types'
import { defaultSettings } from '@shared/settings/schema'

import { GOOD_KEY, startMockOpenCodeApi, type MockOpenCodeApi } from './fixtures/mock-opencode-api.mjs'
import { fakeCliSettings, readCliLog, settingsWith, tempDir } from './helpers/env'

let counter = 0
const context = (): CommandContext => ({ newId: (prefix) => `${prefix}_${++counter}`, now: () => new Date('2026-01-01T00:00:00Z') })
const apply = (project: Project, commands: Command[]): Project => applyCommands(project, commands, context()).project

const image = (caption: string): AiImage => ({ mediaType: 'image/jpeg', data: Buffer.from('jpeg').toString('base64'), caption })

describe('見せる時刻', () => {
  it('画面は1コマ、区間は長さに応じて両端を含めて等間隔(上限あり)', () => {
    expect(visionTimes({ kind: 'frame', atMs: 12_345 })).toEqual([12_345])
    expect(visionTimes({ kind: 'clip', startMs: 10_000, endMs: 20_000 })).toEqual([10_000, 11_667, 13_333, 15_000, 16_667, 18_333, 20_000])
    expect(visionTimes({ kind: 'clip', startMs: 0, endMs: 1000 })).toEqual([0, 1000])
    const long = visionTimes({ kind: 'clip', startMs: 0, endMs: 600_000 })
    expect(long).toHaveLength(8)
    expect(long.at(-1)).toBe(60_000)
    expect(visionNote({ kind: 'clip', startMs: 0, endMs: 4000 }, [0, 2000, 4000])).toContain('3 枚')
  })

  it('選んだ複数の時刻は、重なりを除いて時間順に並べ、上限までにする', () => {
    expect(visionTimes({ kind: 'frames', times: [9000, 3000, 3000.4, -5, 6000] })).toEqual([0, 3000, 6000, 9000])
    expect(visionTimes({ kind: 'frames', times: Array.from({ length: 12 }, (_, index) => index * 1000) })).toHaveLength(8)
    const note = visionNote({ kind: 'frames', times: [3000, 9000] }, [3000, 9000])
    expect(note).toContain('2 枚の画像は、動画の 0:03.000、0:09.000 のゲーム画面')
    expect(note).toContain('間は飛んでいます')
    // 1枚だけなら、1コマのときと同じ説明
    expect(visionNote({ kind: 'frames', times: [3000] }, [3000])).toContain('添付の画像は、動画の 0:03.000 のゲーム画面です')
  })
})

describe('録画からコマを取り出す(本物の ffmpeg)', () => {
  it('その時刻に映っている録画のコマを JPEG で取り出し、映像の無い時刻は飛ばす', async () => {
    const directory = await tempDir('zs-vision-')
    const video = join(directory, 'change.mp4')
    execFileSync('ffmpeg', [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'color=c=red:s=320x180:r=30:d=1.5',
      '-f', 'lavfi', '-i', 'color=c=lime:s=320x180:r=30:d=1.5',
      '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]', '-map', '[v]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video
    ])
    const project = apply(createEmptyProject(), [
      {
        op: 'asset.add',
        asset: { type: 'video', path: { absolute: video, relative: null }, license: { source: '自分で録画', creditRequired: false }, durationMs: 3000, width: 320, height: 180, fps: 30, hasAudio: false },
        tempId: 'v'
      },
      { op: 'media.placeVideo', assetId: 'v', atMs: 1000 }
    ])
    const allowed: string[] = []
    const { images, shownTimes } = await grabFrames(project, [500, 1500, 3500], new FfmpegLocator(() => defaultSettings()), async (path) => {
      allowed.push(path)
    })
    // 0.5 秒は録画が置かれる前なので飛ばす。1.5 秒 = 素材の 0.5 秒(赤)、3.5 秒 = 素材の 2.5 秒(緑)
    expect(shownTimes).toEqual([1500, 3500])
    expect(allowed).toEqual([video, video])
    expect(images.map((item) => item.caption)).toEqual(['動画の 0:01.500 の画面', '動画の 0:03.500 の画面'])
    const colorOf = async (item: AiImage): Promise<number[]> => {
      const picture = await loadImage(Buffer.from(item.data, 'base64'))
      const canvas = createCanvas(picture.width, picture.height)
      const ctx = canvas.getContext('2d')
      ctx.drawImage(picture, 0, 0)
      return Array.from(ctx.getImageData(picture.width / 2, picture.height / 2, 1, 1).data.slice(0, 3))
    }
    const [red, green] = [await colorOf(images[0]!), await colorOf(images[1]!)]
    expect(red[0]).toBeGreaterThan(180)
    expect(red[1]).toBeLessThan(80)
    expect(green[1]).toBeGreaterThan(180)
    expect(green[0]).toBeLessThan(80)
    // 本物の ffmpeg で動画を作って読むので、テストを並べて走らせると既定の5秒を超えることがある
  }, 60_000)
})

describe('見せる画像の画質と範囲', () => {
  it('範囲は 0〜1 に収め、小さすぎる範囲は広げる。全体なら切り出さない', () => {
    expect(clampRegion({ x: 0.9, y: -0.2, width: 0.5, height: 0.01 })).toEqual({ x: 0.5, y: 0, width: 0.5, height: 0.05 })
    expect(describeRegion({ x: 0.5, y: 0, width: 0.5, height: 1 })).toBe('左から50%・上から0%の、幅50%×高さ100%')
    expect(frameFilter(768)).toBe("scale='if(gte(iw,ih),min(768,iw),-2)':'if(gte(iw,ih),-2,min(768,ih))'")
    expect(frameFilter(1568, { x: 0, y: 0, width: 1, height: 1 })).not.toContain('crop')
    expect(frameFilter(1568, { x: 0.5, y: 0.25, width: 0.5, height: 0.5 })).toMatch(/^crop=trunc\(iw\*0\.5000\/2\)\*2:trunc\(ih\*0\.5000\/2\)\*2:trunc\(iw\*0\.5000\):trunc\(ih\*0\.2500\),scale=/)
    // 切り出したことと、読めないものは推測しないことを AI に伝える
    const note = visionNote({ kind: 'frame', atMs: 3000, region: { x: 0.5, y: 0, width: 0.5, height: 1 } }, [3000])
    expect(note).toContain('一部(左から50%・上から0%の、幅50%×高さ100%)を切り出して')
    expect(note).toContain('推測で言わない')
    expect(visionNote({ kind: 'frame', atMs: 3000 }, [3000])).not.toContain('切り出して')
  })

  it('本物の ffmpeg で、標準は長辺 768px・高画質は長辺 1568px、範囲はその部分だけを切り出す', async () => {
    const directory = await tempDir('zs-vision-quality-')
    const video = join(directory, 'big.mp4')
    // 左半分が赤、右半分が青の 1920x1080
    execFileSync('ffmpeg', [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'color=c=red:s=1920x1080:r=30:d=1',
      '-vf', 'drawbox=x=960:y=0:w=960:h=1080:color=blue:t=fill', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video
    ])
    const project = apply(createEmptyProject(), [
      {
        op: 'asset.add',
        asset: { type: 'video', path: { absolute: video, relative: null }, license: { source: '自分で録画', creditRequired: false }, durationMs: 1000, width: 1920, height: 1080, fps: 30, hasAudio: false },
        tempId: 'v'
      },
      { op: 'media.placeVideo', assetId: 'v', atMs: 0 }
    ])
    const ffmpeg = new FfmpegLocator(() => defaultSettings())
    const allow = async (): Promise<void> => undefined
    const sizeAndColor = async (item: AiImage): Promise<{ width: number; height: number; left: number[]; right: number[] }> => {
      const picture = await loadImage(Buffer.from(item.data, 'base64'))
      const canvas = createCanvas(picture.width, picture.height)
      const ctx = canvas.getContext('2d')
      ctx.drawImage(picture, 0, 0)
      const at = (x: number): number[] => Array.from(ctx.getImageData(x, picture.height / 2, 1, 1).data.slice(0, 3))
      return { width: picture.width, height: picture.height, left: at(4), right: at(picture.width - 4) }
    }

    const standard = await sizeAndColor((await grabFrames(project, [500], ffmpeg, allow)).images[0]!)
    expect([standard.width, standard.height]).toEqual([768, 432])
    const high = await sizeAndColor((await grabFrames(project, [500], ffmpeg, allow, { quality: 'high' })).images[0]!)
    expect([high.width, high.height]).toEqual([1568, 882])

    // 右半分だけ: 960x1080 は高画質の上限より小さいので、元の大きさのまま。全部青
    const { images } = await grabFrames(project, [500], ffmpeg, allow, { quality: 'high', region: { x: 0.5, y: 0, width: 0.5, height: 1 } })
    expect(images[0]!.caption).toBe('動画の 0:00.500 の画面(一部を切り出したもの)')
    const cropped = await sizeAndColor(images[0]!)
    expect([cropped.width, cropped.height]).toEqual([960, 1080])
    expect(cropped.left[2]).toBeGreaterThan(180)
    expect(cropped.right[2]).toBeGreaterThan(180)
    expect(cropped.left[0]).toBeLessThan(80)
  }, 60_000)
})

describe('AI に画像を渡す', () => {
  let mock: MockOpenCodeApi
  let work: string
  beforeAll(async () => {
    mock = await startMockOpenCodeApi()
    work = await tempDir('zs-vision-ai-')
  })
  afterAll(async () => {
    await mock.close()
  })

  const request: GenerateRequest = {
    system: 'あなたは四国めたんです。',
    turns: [{ role: 'user', content: 'ボスが来たのだ' }],
    images: [image('動画の 0:01.000 の画面'), image('動画の 0:02.000 の画面')]
  }

  it('Claude(サブスク)は stream-json で画像を送り、結果の行を読む', async () => {
    const logFile = join(work, 'claude-log.jsonl')
    const provider = new ClaudeCodeProvider(() => fakeCliSettings(), work, { ...process.env, FAKE_MODE: 'text', FAKE_LOG: logFile })
    const result = await provider.generate('sonnet', request)
    expect(result.text).toBe('こんにちはなのだ')
    const [entry] = await readCliLog(logFile)
    expect(entry!.argv).toEqual(expect.arrayContaining(['--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose']))
    expect(entry!.stdin).toBe('ボスが来たのだ')
    expect((entry as unknown as { images: { caption: string }[] }).images.map((item) => item.caption)).toEqual(['動画の 0:01.000 の画面', '動画の 0:02.000 の画面'])

    // 画像が無いときは今まで通り(json 出力)
    const textOnly = new ClaudeCodeProvider(() => fakeCliSettings(), work, { ...process.env, FAKE_MODE: 'text', FAKE_LOG: join(work, 'plain.jsonl') })
    await textOnly.generate('sonnet', { system: 's', turns: [{ role: 'user', content: 'x' }] })
    const [plain] = await readCliLog(join(work, 'plain.jsonl'))
    expect(plain!.argv).toEqual(expect.arrayContaining(['--output-format', 'json']))
    expect(plain!.argv).not.toContain('stream-json')
  })

  it('OpenCode の API は、形式ごとの書き方で最後の発話に画像を添える', async () => {
    const chat = buildBody('chat', 'kimi-k3', 's', request.turns, request.images) as { messages: { content: unknown }[] }
    expect(chat.messages[1]!.content).toEqual([
      { type: 'text', text: '動画の 0:01.000 の画面' },
      { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${request.images![0]!.data}` } },
      { type: 'text', text: '動画の 0:02.000 の画面' },
      { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${request.images![1]!.data}` } },
      { type: 'text', text: 'ボスが来たのだ' }
    ])
    const messages = buildBody('messages', 'minimax-m3', 's', request.turns, request.images) as { messages: { content: { type: string }[] }[] }
    expect(messages.messages[0]!.content.map((block) => block.type)).toEqual(['text', 'image', 'text', 'image', 'text'])
    const responses = buildBody('responses', 'gpt-6-luna', 's', request.turns, request.images) as { input: { content: { type: string }[] }[] }
    expect(responses.input[0]!.content.map((block) => block.type)).toEqual(['input_text', 'input_image', 'input_text', 'input_image', 'input_text'])
    const gemini = buildBody('gemini', 'gemini-3.8-flash', 's', request.turns, request.images) as { contents: { parts: Record<string, unknown>[] }[] }
    expect(gemini.contents[0]!.parts.map((part) => Object.keys(part)[0])).toEqual(['text', 'inline_data', 'text', 'inline_data', 'text'])

    // 実際に送ると、模擬の API に画像つきで届く
    const provider = new OpenCodeProvider(() => settingsWith({ ai: { providers: { opencode: { connection: 'api-key', baseUrl: mock.baseUrl } } } }), work, {}, () => GOOD_KEY)
    mock.calls.length = 0
    await provider.generate('opencode-go/kimi-k3', request)
    expect(JSON.stringify(mock.calls[0]!.body)).toContain('image_url')
  })

  it('画像を読めないモデルなら、画像を外して文字だけでやり直す', async () => {
    const seen: (number | undefined)[] = []
    const stub: LlmProvider = {
      id: 'opencode',
      label: 'stub',
      status: () => Promise.resolve({ providerId: 'opencode', label: 'stub', executablePath: null, state: { kind: 'ready', version: '' } }),
      listModels: () => Promise.resolve([]),
      generate: (model, req) => {
        seen.push(req.images?.length)
        if (req.images?.length) return Promise.reject(new AppError('CLI_FAILED', 'OpenCode がエラーを返しました(400)', 'This model does not support image input'))
        return Promise.resolve({ text: 'ok', generatedBy: { providerId: 'opencode', model, at: 'x' }, durationMs: 1 })
      }
    }
    const settings = settingsWith({ ai: { roles: { conversation: { providerId: 'opencode', model: 'opencode-go/text-only' } } } })
    const ai = new AiService(() => settings)
    ai.register(stub)
    const result = await ai.generate('conversation', request)
    expect(result).toMatchObject({ text: 'ok', imagesDropped: true })
    expect(seen).toEqual([2, undefined])
    // 画像と関係の無い失敗はそのまま伝える
    const failing = new AiService(() => settings)
    failing.register({ ...stub, generate: () => Promise.reject(new AppError('AI_RATE_LIMITED', '上限')) })
    await expect(failing.generate('conversation', request)).rejects.toMatchObject({ code: 'AI_RATE_LIMITED' })
  })

  it('opencode コマンド経由では画像を送らず、送らなかったことを返す', async () => {
    const provider = new OpenCodeProvider(() => fakeCliSettings(), work, { ...process.env, FAKE_MODE: 'text', FAKE_LOG: join(work, 'oc.jsonl') })
    const result = await provider.generate('opencode-go/kimi-k3', request)
    expect(result.imagesDropped).toBe(true)
  })
})
