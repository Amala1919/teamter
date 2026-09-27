import { readFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { AppError } from '@main/core/errors'
import { EventBus } from '@main/core/events'
import { readWavInfo } from '@main/core/wav'
import { EngineManager } from '@main/services/voice/engine-manager'
import { SynthesisService } from '@main/services/voice/synthesis-service'
import { fromEngineAccentPhrases, type EngineAccentPhrase } from '@main/services/voice/voicevox-client'
import type { VoiceParams } from '@shared/project/types'
import type { AppSettings } from '@shared/settings/schema'
import type { EngineStatus } from '@shared/voice/types'
import {
  FRAME_RATE,
  lipSyncKeyframes,
  phonemeSegments,
  roundHalfEven,
  totalFrames,
  vowelAt
} from '@shared/voice/timing'

import { engineFrames, startMockVoicevox, textToAccentPhrases, type MockVoicevox } from './fixtures/mock-voicevox.mjs'
import { FIXTURE_BIN, settingsWith, tempDir } from './helpers/env'

const PARAMS: VoiceParams = {
  speedScale: 1,
  pitchScale: 0,
  intonationScale: 1,
  volumeScale: 1,
  prePhonemeLength: 0.1,
  postPhonemeLength: 0.1
}

function engineSettings(url: string, extra: Partial<AppSettings['voice']['engines'][number]> = {}): AppSettings {
  return settingsWith({
    voice: { engines: [{ id: 'voicevox', label: 'VOICEVOX', url, executablePath: null, autoLaunch: true, ...extra }] }
  })
}

async function freePort(): Promise<number> {
  return new Promise((resolvePromise) => {
    const server = createServer()
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => resolvePromise(port))
    })
  })
}

describe('口パクのタイミング', () => {
  it('偶数丸めは numpy.round と同じ', () => {
    expect(roundHalfEven(0.5)).toBe(0)
    expect(roundHalfEven(1.5)).toBe(2)
    expect(roundHalfEven(2.5)).toBe(2)
    expect(roundHalfEven(2.51)).toBe(3)
    expect(roundHalfEven(3.5)).toBe(4)
  })

  const cases: [string, Partial<VoiceParams> & { pauseLength?: number | null; pauseLengthScale?: number }][] = [
    ['こんにちはなのだ', {}],
    ['ボス、つよすぎるのだ？', {}],
    ['はやくちなのだ、ほんとうに', { speedScale: 1.37 }],
    ['ゆっくり', { speedScale: 0.73, prePhonemeLength: 0.25, postPhonemeLength: 0.4 }],
    ['くぎり、くぎり、くぎり', { pauseLengthScale: 1.8 }],
    ['くぎり、くぎり', { pauseLength: 0.05 }],
    ['っんーまみむめも', {}]
  ]

  it.each(cases)('「%s」の総フレーム数がエンジンと一致する', (text, overrides) => {
    const params = {
      ...PARAMS,
      pauseLength: null as number | null,
      pauseLengthScale: 1,
      ...overrides
    }
    const engineQuery = { accent_phrases: textToAccentPhrases(text), ...params }
    const phrases = fromEngineAccentPhrases(engineQuery.accent_phrases as EngineAccentPhrase[])
    expect(totalFrames(phonemeSegments(phrases, params))).toBe(engineFrames(engineQuery))
  })

  it('子音の間は唇を閉じる子音なら口を閉じ、母音で開く', () => {
    const phrases = fromEngineAccentPhrases(textToAccentPhrases('まあ') as EngineAccentPhrase[])
    const keyframes = lipSyncKeyframes(
      phonemeSegments(phrases, { ...PARAMS, pauseLength: null, pauseLengthScale: 1 })
    )
    // 無音 → ま の子音(閉じる)→ 母音 a(開く)→ 終わりの無音
    expect(keyframes.map((keyframe) => keyframe.vowel)).toEqual(['pau', 'N', 'a', 'pau'])
    expect(keyframes[0]!.atMs).toBe(0)
    expect(keyframes[1]!.atMs).toBe(Math.round((Math.round(0.1 * FRAME_RATE) / FRAME_RATE) * 1000))
    expect(vowelAt(keyframes, keyframes[2]!.atMs + 1)).toBe('a')
    expect(vowelAt(keyframes, 999_999)).toBe('pau')
  })

  it('話速を上げると同じ口の動きが早く終わる', () => {
    const phrases = fromEngineAccentPhrases(textToAccentPhrases('あいうえお') as EngineAccentPhrase[])
    const normal = lipSyncKeyframes(phonemeSegments(phrases, { ...PARAMS, pauseLength: null, pauseLengthScale: 1 }))
    const fast = lipSyncKeyframes(
      phonemeSegments(phrases, { ...PARAMS, speedScale: 2, pauseLength: null, pauseLengthScale: 1 })
    )
    expect(fast.at(-1)!.atMs).toBeLessThan(normal.at(-1)!.atMs)
    expect(fast.map((keyframe) => keyframe.vowel)).toEqual(normal.map((keyframe) => keyframe.vowel))
  })
})

describe('音声エンジンと合成', () => {
  let mock: MockVoicevox
  let cache: string
  let events: EventBus
  let statuses: EngineStatus[]

  beforeEach(async () => {
    mock = await startMockVoicevox()
    cache = await tempDir('zs-voice-')
    events = new EventBus()
    statuses = []
    events.listen((envelope) => {
      if (envelope.type === 'voice:engine-status') statuses.push(envelope.payload as EngineStatus)
    })
  })

  afterEach(async () => {
    await mock.close()
  })

  it('起動済みのエンジンに接続し、話者一覧を取得する', async () => {
    const engines = new EngineManager(() => engineSettings(mock.url), events)
    const status = await engines.ensure('voicevox')
    expect(status).toMatchObject({ state: 'ready', version: '0.99.0-mock', managed: false })
    expect(statuses.at(-1)?.state).toBe('ready')
    const speakers = await engines.client('voicevox').speakers()
    expect(speakers.map((speaker) => speaker.name)).toEqual(['四国めたん', 'ずんだもん'])
    expect(speakers[1]!.styles[0]).toEqual({ id: 3, name: 'ノーマル' })
  })

  it('合成した音声の長さと口パクの終わりが一致する', async () => {
    const engines = new EngineManager(() => engineSettings(mock.url), events)
    const synthesis = new SynthesisService(engines, cache)
    const outcome = await synthesis.synthesize({
      engineId: 'voicevox',
      speakerId: 3,
      text: 'ボス、つよすぎるのだ？',
      params: { ...PARAMS, speedScale: 1.2 }
    })
    const wav = readWavInfo(await readFile(outcome.wavPath))
    expect(outcome.audioDurationMs).toBe(wav.durationMs)
    // 最後のキーフレーム(終わりの無音の開始)は音声の終わりより前にある
    const lastSpeech = outcome.lipSync.at(-1)!
    expect(lastSpeech.vowel).toBe('pau')
    expect(lastSpeech.atMs).toBeLessThan(outcome.audioDurationMs)
    expect(outcome.accentPhrases.length).toBe(2)
    expect(outcome.accentPhrases[1]!.isInterrogative).toBe(true)
  })

  it('同じセリフとパラメータなら二度目はエンジンに問い合わせない', async () => {
    const engines = new EngineManager(() => engineSettings(mock.url), events)
    const synthesis = new SynthesisService(engines, cache)
    const request = { engineId: 'voicevox', speakerId: 3, text: 'キャッシュなのだ', params: PARAMS }
    const first = await synthesis.synthesize(request)
    const queriesAfterFirst = mock.stats.audio_query
    const second = await synthesis.synthesize(request)
    expect(second.cacheKey).toBe(first.cacheKey)
    expect(mock.stats.audio_query).toBe(queriesAfterFirst)
    expect(mock.stats.synthesis).toBe(1)
  })

  it('保存済みのアクセント句から、キャッシュが無くても同じキーの音声を作り直せる', async () => {
    const engines = new EngineManager(() => engineSettings(mock.url), events)
    const first = await new SynthesisService(engines, cache).synthesize({
      engineId: 'voicevox',
      speakerId: 3,
      text: '別のマシンでも同じ音',
      params: PARAMS
    })
    // 別のマシン = 空のキャッシュ
    const otherMachine = new SynthesisService(engines, await tempDir('zs-voice-other-'))
    expect(await otherMachine.resolve(first.cacheKey)).toBeNull()
    const rebuilt = await otherMachine.synthesize({
      engineId: 'voicevox',
      speakerId: 3,
      text: '別のマシンでも同じ音',
      params: PARAMS,
      accentPhrases: first.accentPhrases
    })
    expect(rebuilt.cacheKey).toBe(first.cacheKey)
    expect(rebuilt.audioDurationMs).toBe(first.audioDurationMs)
  })

  it('読み(カナ)を指定するとテキストの代わりにそれを読む', async () => {
    const engines = new EngineManager(() => engineSettings(mock.url), events)
    const outcome = await new SynthesisService(engines, cache).synthesize({
      engineId: 'voicevox',
      speakerId: 3,
      text: '難読漢字',
      kana: "ナ'ンドク/カ'ンジ",
      params: PARAMS
    })
    expect(outcome.accentPhrases).toHaveLength(2)
    expect(mock.stats.accent_phrases).toBe(1)
    expect(mock.stats.audio_query).toBe(0)
  })

  it('エンジンへの合成要求は1本ずつ流す', async () => {
    await mock.close()
    mock = await startMockVoicevox({ delayMs: 80 })
    const engines = new EngineManager(() => engineSettings(mock.url), events)
    const synthesis = new SynthesisService(engines, cache)
    await Promise.all(
      ['いち', 'に', 'さん', 'よん'].map((text) =>
        synthesis.synthesize({ engineId: 'voicevox', speakerId: 3, text, params: PARAMS })
      )
    )
    expect(mock.stats.synthesis).toBe(4)
    expect(mock.stats.maxConcurrentSynthesis).toBe(1)
  })

  it('エンジンのエラーを利用者に分かるエラーにする', async () => {
    const engines = new EngineManager(() => engineSettings(mock.url), events)
    const synthesis = new SynthesisService(engines, cache)
    await expect(
      synthesis.synthesize({ engineId: 'voicevox', speakerId: 3, text: '💥', params: PARAMS })
    ).rejects.toMatchObject({ code: 'ENGINE_FAILED' })
  })

  it('起動していなければ、場所の設定を促す', async () => {
    const port = await freePort()
    const engines = new EngineManager(() => engineSettings(`http://127.0.0.1:${port}`), events)
    const status = await engines.ensure('voicevox')
    expect(status.state).toBe('unavailable')
    expect(status.message).toContain('エンジンの場所を設定')
    await expect(engines.require('voicevox')).rejects.toBeInstanceOf(AppError)
  })

  it('実行ファイルが設定されていれば起動して接続し、終了時に止める', async () => {
    const port = await freePort()
    const engines = new EngineManager(
      () => engineSettings(`http://127.0.0.1:${port}`, { executablePath: join(FIXTURE_BIN, 'fake-engine') }),
      events
    )
    const [a, b] = await Promise.all([engines.ensure('voicevox'), engines.ensure('voicevox')])
    expect(a.state).toBe('ready')
    expect(b.state).toBe('ready')
    expect(a.managed).toBe(true)
    expect(statuses.map((status) => status.state)).toContain('starting')

    await engines.shutdown()
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 300))
    expect((await engines.probe('voicevox')).state).toBe('unavailable')
  })

  it('起動直後に落ちたら、その理由を伝える', async () => {
    const port = await freePort()
    process.env['FAKE_ENGINE_CRASH'] = '1'
    try {
      const engines = new EngineManager(
        () => engineSettings(`http://127.0.0.1:${port}`, { executablePath: join(FIXTURE_BIN, 'fake-engine') }),
        events
      )
      const status = await engines.ensure('voicevox')
      expect(status.state).toBe('unavailable')
      expect(status.message).toContain('model load failed')
    } finally {
      delete process.env['FAKE_ENGINE_CRASH']
    }
  })
})
