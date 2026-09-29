import { mkdtempSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { beforeAll, describe, expect, it } from 'vitest'

import { EventBus } from '../src/main/core/events'
import { FfmpegLocator } from '../src/main/services/media/ffmpeg'
import { interpretProbe, MediaService, proxyQuality } from '../src/main/services/media/media-service'
import { defaultSettings, type AppSettings } from '@shared/settings/schema'

import { makeTestAudio, makeTestImage, makeTestVideo } from './fixtures/media'

describe('MediaService(本物の ffmpeg)', () => {
  const directory = mkdtempSync(join(tmpdir(), 'zunda-media-'))
  let video: string
  let audio: string
  let image: string
  let settings: AppSettings
  const events = new EventBus()
  let service: MediaService

  beforeAll(async () => {
    video = makeTestVideo(directory, { seconds: 2 })
    audio = makeTestAudio(directory, { seconds: 1.5 })
    image = await makeTestImage(directory)
    settings = defaultSettings()
    service = new MediaService(new FfmpegLocator(() => settings), () => settings, events, {
      proxy: join(directory, 'proxy'),
      peaks: join(directory, 'peaks')
    })
  })

  it('動画・音声・画像を見分け、長さと大きさを調べる', async () => {
    expect(await service.probe(video)).toMatchObject({
      kind: 'video',
      width: 320,
      height: 180,
      fps: 30,
      hasAudio: true,
      videoCodec: 'h264',
      audioCodec: 'aac'
    })
    expect((await service.probe(video)).durationMs).toBeGreaterThanOrEqual(1990)
    expect(await service.probe(audio)).toMatchObject({ kind: 'audio', durationMs: 1500, hasAudio: true })
    expect(await service.probe(image)).toMatchObject({ kind: 'image', width: 64, height: 48, durationMs: 0 })
  })

  it('存在しないファイルは NOT_FOUND、壊れたファイルは FFMPEG_FAILED', async () => {
    await expect(service.probe(join(directory, 'none.mp4'))).rejects.toMatchObject({ code: 'NOT_FOUND' })
    const broken = join(directory, 'broken.mp4')
    await (await import('node:fs/promises')).writeFile(broken, 'not a video')
    await expect(service.probe(broken)).rejects.toMatchObject({ code: 'FFMPEG_FAILED' })
  })

  it('プロキシを作り、進み具合を知らせ、2回目はキャッシュを使う', async () => {
    const progress: number[] = []
    const stop = events.listen((envelope) => {
      if (envelope.type === 'media:proxy-progress') progress.push((envelope.payload as { ratio: number }).ratio)
    })
    const first = await service.proxy(video, 'webm')
    stop()
    expect(first.endsWith('.webm')).toBe(true)
    expect(progress.at(0)).toBe(0)
    expect(progress.at(-1)).toBe(1)
    expect(await service.probe(first)).toMatchObject({ kind: 'video', videoCodec: 'vp8', hasAudio: true })
    const { mtimeMs } = await stat(first)
    const second = await service.proxy(video, 'webm')
    expect(second).toBe(first)
    expect((await stat(second)).mtimeMs).toBe(mtimeMs)
  })

  it('プレビューの高さを選ぶと、その高さ(0 は元の大きさ)で別に作る', async () => {
    const tall = makeTestVideo(directory, { name: 'tall.mp4', seconds: 1, width: 640, height: 360 })
    const standard = await service.proxy(tall, 'mp4')
    const small = await service.proxy(tall, 'mp4', 180)
    const original = await service.proxy(tall, 'mp4', 0)
    expect(new Set([standard, small, original]).size).toBe(3)
    expect(await service.probe(small)).toMatchObject({ width: 320, height: 180 })
    expect(await service.probe(original)).toMatchObject({ width: 640, height: 360 })
    // 元より大きい高さを選んでも、元の大きさを超えない
    expect(await service.probe(await service.proxy(tall, 'mp4', 1080))).toMatchObject({ height: 360 })
    expect(proxyQuality(0).crf).toBeLessThan(proxyQuality(540).crf)
    expect(proxyQuality(720).crf).toBeLessThan(proxyQuality(360).crf)
  })

  it('同時に頼まれても、プロキシは1回だけ作る', async () => {
    const other = makeTestVideo(directory, { name: 'other.mp4', seconds: 1 })
    const [a, b] = await Promise.all([service.proxy(other, 'mp4'), service.proxy(other, 'mp4')])
    expect(a).toBe(b)
    expect(await service.probe(a)).toMatchObject({ videoCodec: 'h264' })
  })

  it('波形は10msごとの振幅で、正弦波(ffmpeg の既定は振幅 1/8)ならほぼ一定の値が並ぶ', async () => {
    const peaks = await service.peaks(audio)
    const data = Buffer.from(peaks.data, 'base64')
    expect(peaks.samplesPerSecond).toBe(100)
    expect(data.length).toBeGreaterThanOrEqual(149)
    expect(data.length).toBeLessThanOrEqual(151)
    expect(Math.min(...data.subarray(5, 140))).toBeGreaterThanOrEqual(30)
    expect(Math.max(...data.subarray(5, 140))).toBeLessThanOrEqual(33)
    // 2回目はキャッシュから同じ内容
    expect((await service.peaks(audio)).data).toBe(peaks.data)
  })

  it('ffmpeg が見つからなければ FFMPEG_NOT_FOUND', async () => {
    const missing = new MediaService(new FfmpegLocator(() => settings, { PATH: '/nonexistent' }), () => settings, events, {
      proxy: join(directory, 'p2'),
      peaks: join(directory, 'k2')
    })
    await expect(missing.probe(video)).rejects.toMatchObject({ code: 'FFMPEG_NOT_FOUND' })
  })
})

describe('interpretProbe', () => {
  it('カバー画像付きの音声ファイルは音声として扱う', () => {
    const result = interpretProbe('/a/song.mp3', {
      streams: [
        { codec_type: 'audio', codec_name: 'mp3' },
        { codec_type: 'video', codec_name: 'mjpeg', width: 500, height: 500, disposition: { attached_pic: 1 } }
      ],
      format: { duration: '12.5', format_name: 'mp3' }
    })
    expect(result).toMatchObject({ kind: 'audio', durationMs: 12_500 })
  })
})
