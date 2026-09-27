import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { AccentPhrase, VoiceParams } from '@shared/project/types'
import { lipSyncKeyframes, phonemeSegments } from '@shared/voice/timing'
import type { SynthesisOutcome, SynthesisRequest } from '@shared/voice/types'

import { fileExists, writeFileAtomic } from '../../core/fs'
import { Semaphore } from '../../core/semaphore'
import { readWavInfo } from '../../core/wav'
import type { EngineManager } from './engine-manager'
import {
  fromEngineAccentPhrases,
  toEngineAccentPhrases,
  type EngineAudioQuery
} from './voicevox-client'

interface CacheMeta {
  cacheKey: string
  audioDurationMs: number
  accentPhrases: AccentPhrase[]
  kana: string
}

/**
 * 音声合成とそのディスクキャッシュ。
 *
 * キャッシュの正規のキーは「エンジン・話者・合成に渡したクエリ全体」のハッシュで、プロジェクトにはこれを保存する。
 * 別のマシンでキャッシュが無くても、保存済みのアクセント句から同じクエリを組み立てれば同じキーと同じ音声になる。
 * テキストからの合成は /audio_query を呼ぶ前にキャッシュを引けるよう、テキスト側のキーから正規のキーへの索引も持つ。
 */
export class SynthesisService {
  private readonly queues = new Map<string, Semaphore>()

  constructor(
    private readonly engines: EngineManager,
    private readonly cacheDirectory: string
  ) {}

  wavPath(cacheKey: string): string {
    return join(this.cacheDirectory, `${cacheKey}.wav`)
  }

  async resolve(cacheKey: string): Promise<string | null> {
    if (!/^[a-f0-9]{64}$/.test(cacheKey)) return null
    const path = this.wavPath(cacheKey)
    return (await fileExists(path)) ? path : null
  }

  async synthesize(request: SynthesisRequest): Promise<SynthesisOutcome> {
    const textKey = request.accentPhrases ? null : hash({ kind: 'text', ...pickRequestKey(request) })
    if (textKey) {
      const indexed = await this.readIndex(textKey)
      if (indexed) {
        const cached = await this.readCached(indexed, request.params)
        if (cached) return cached
      }
    }

    const client = await this.engines.require(request.engineId)
    const queue = this.queue(request.engineId)

    let accentPhrases: AccentPhrase[]
    let kana: string
    let samplingRate = 24000
    if (request.accentPhrases) {
      accentPhrases = request.accentPhrases
      kana = ''
    } else if (request.kana) {
      accentPhrases = fromEngineAccentPhrases(
        await queue.run(() => client.accentPhrasesFromKana(request.kana!, request.speakerId))
      )
      kana = request.kana
    } else {
      const base = await queue.run(() => client.audioQuery(request.text, request.speakerId))
      accentPhrases = fromEngineAccentPhrases(base.accent_phrases)
      kana = base.kana ?? ''
      samplingRate = base.outputSamplingRate
    }

    const query = buildQuery(accentPhrases, request.params, samplingRate)
    const cacheKey = hash({ kind: 'query', engineId: request.engineId, speakerId: request.speakerId, query })
    const cached = await this.readCached(cacheKey, request.params)
    if (cached) {
      if (textKey) await this.writeIndex(textKey, cacheKey)
      return cached
    }

    const wav = await queue.run(() => client.synthesis(query, request.speakerId))
    const info = readWavInfo(wav)
    await writeFileAtomic(this.wavPath(cacheKey), wav)
    const meta: CacheMeta = { cacheKey, audioDurationMs: info.durationMs, accentPhrases, kana }
    await writeFileAtomic(join(this.cacheDirectory, `${cacheKey}.json`), JSON.stringify(meta))
    if (textKey) await this.writeIndex(textKey, cacheKey)
    return this.outcome(meta, request.params)
  }

  private queue(engineId: string): Semaphore {
    let queue = this.queues.get(engineId)
    if (!queue) {
      queue = new Semaphore(1)
      this.queues.set(engineId, queue)
    }
    return queue
  }

  private async readCached(cacheKey: string, params: VoiceParams): Promise<SynthesisOutcome | null> {
    if (!(await fileExists(this.wavPath(cacheKey)))) return null
    try {
      const meta = JSON.parse(await readFile(join(this.cacheDirectory, `${cacheKey}.json`), 'utf8')) as CacheMeta
      return this.outcome(meta, params)
    } catch {
      return null
    }
  }

  private outcome(meta: CacheMeta, params: VoiceParams): SynthesisOutcome {
    const segments = phonemeSegments(meta.accentPhrases, {
      speedScale: params.speedScale,
      prePhonemeLength: params.prePhonemeLength,
      postPhonemeLength: params.postPhonemeLength,
      pauseLength: null,
      pauseLengthScale: 1
    })
    return {
      cacheKey: meta.cacheKey,
      wavPath: this.wavPath(meta.cacheKey),
      audioDurationMs: meta.audioDurationMs,
      lipSync: lipSyncKeyframes(segments),
      accentPhrases: meta.accentPhrases,
      kana: meta.kana
    }
  }

  private async readIndex(textKey: string): Promise<string | null> {
    try {
      const value = (await readFile(join(this.cacheDirectory, `text-${textKey}.key`), 'utf8')).trim()
      return /^[a-f0-9]{64}$/.test(value) ? value : null
    } catch {
      return null
    }
  }

  private async writeIndex(textKey: string, cacheKey: string): Promise<void> {
    await writeFileAtomic(join(this.cacheDirectory, `text-${textKey}.key`), cacheKey)
  }
}

function pickRequestKey(request: SynthesisRequest): Record<string, unknown> {
  return {
    engineId: request.engineId,
    speakerId: request.speakerId,
    text: request.text,
    kana: request.kana ?? null,
    params: orderedParams(request.params)
  }
}

function orderedParams(params: VoiceParams): VoiceParams {
  return {
    speedScale: params.speedScale,
    pitchScale: params.pitchScale,
    intonationScale: params.intonationScale,
    volumeScale: params.volumeScale,
    prePhonemeLength: params.prePhonemeLength,
    postPhonemeLength: params.postPhonemeLength
  }
}

/** キーを決定的にするため、クエリはこの関数で常に同じキー順に組み立てる。 */
export function buildQuery(accentPhrases: AccentPhrase[], params: VoiceParams, samplingRate = 24000): EngineAudioQuery {
  return {
    accent_phrases: toEngineAccentPhrases(accentPhrases),
    speedScale: params.speedScale,
    pitchScale: params.pitchScale,
    intonationScale: params.intonationScale,
    volumeScale: params.volumeScale,
    prePhonemeLength: params.prePhonemeLength,
    postPhonemeLength: params.postPhonemeLength,
    pauseLength: null,
    pauseLengthScale: 1,
    outputSamplingRate: samplingRate,
    outputStereo: false
  }
}

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}
