import type { AccentPhrase, Mora } from '@shared/project/types'
import type { SpeakerInfo, UserDictWord } from '@shared/voice/types'

import { AppError } from '../../core/errors'

/**
 * VOICEVOX 互換エンジン(VOICEVOX / AivisSpeech / COEIROINK 等)の HTTP API。
 * エンジンの JSON はスネークケースなので、プロジェクトの型(キャメルケース)との変換もここで行う。
 */

export interface EngineMora {
  text: string
  consonant: string | null
  consonant_length: number | null
  vowel: string
  vowel_length: number
  pitch: number
}

export interface EngineAccentPhrase {
  moras: EngineMora[]
  accent: number
  pause_mora: EngineMora | null
  is_interrogative: boolean
}

export interface EngineAudioQuery {
  accent_phrases: EngineAccentPhrase[]
  speedScale: number
  pitchScale: number
  intonationScale: number
  volumeScale: number
  prePhonemeLength: number
  postPhonemeLength: number
  pauseLength: number | null
  pauseLengthScale: number
  outputSamplingRate: number
  outputStereo: boolean
  kana?: string
}

export class VoicevoxClient {
  constructor(
    readonly baseUrl: string,
    private readonly timeoutMs = 60_000
  ) {}

  async version(timeoutMs = 2_000): Promise<string> {
    return (await this.request('GET', '/version', undefined, undefined, timeoutMs)) as string
  }

  async speakers(): Promise<SpeakerInfo[]> {
    const raw = (await this.request('GET', '/speakers')) as {
      name: string
      speaker_uuid: string
      styles: { name: string; id: number; type?: string }[]
    }[]
    return raw.map((speaker) => ({
      name: speaker.name,
      uuid: speaker.speaker_uuid,
      // 歌唱用のスタイルは話し声の合成に使えないので除く。
      styles: speaker.styles
        .filter((style) => style.type === undefined || style.type === 'talk')
        .map((style) => ({ id: style.id, name: style.name }))
    }))
  }

  async audioQuery(text: string, styleId: number): Promise<EngineAudioQuery> {
    return (await this.request('POST', '/audio_query', { text, speaker: String(styleId) })) as EngineAudioQuery
  }

  async accentPhrasesFromKana(kana: string, styleId: number): Promise<EngineAccentPhrase[]> {
    return (await this.request('POST', '/accent_phrases', {
      text: kana,
      speaker: String(styleId),
      is_kana: 'true'
    })) as EngineAccentPhrase[]
  }

  async synthesis(query: EngineAudioQuery, styleId: number): Promise<Uint8Array> {
    const response = await this.fetchRaw('POST', '/synthesis', { speaker: String(styleId) }, JSON.stringify(query))
    return new Uint8Array(await response.arrayBuffer())
  }

  async userDict(): Promise<UserDictWord[]> {
    const raw = (await this.request('GET', '/user_dict')) as Record<
      string,
      { surface: string; pronunciation: string; accent_type: number; priority: number }
    >
    return Object.entries(raw).map(([id, word]) => ({
      id,
      surface: word.surface,
      pronunciation: word.pronunciation,
      accentType: word.accent_type,
      priority: word.priority
    }))
  }

  async addUserDictWord(word: Omit<UserDictWord, 'id'>): Promise<string> {
    return (await this.request('POST', '/user_dict_word', {
      surface: word.surface,
      pronunciation: word.pronunciation,
      accent_type: String(word.accentType),
      priority: String(word.priority)
    })) as string
  }

  async deleteUserDictWord(id: string): Promise<void> {
    await this.fetchRaw('DELETE', `/user_dict_word/${encodeURIComponent(id)}`)
  }

  private async request(
    method: string,
    path: string,
    query?: Record<string, string>,
    body?: string,
    timeoutMs?: number
  ): Promise<unknown> {
    const response = await this.fetchRaw(method, path, query, body, timeoutMs)
    const text = await response.text()
    return text === '' ? null : (JSON.parse(text) as unknown)
  }

  private async fetchRaw(
    method: string,
    path: string,
    query?: Record<string, string>,
    body?: string,
    timeoutMs = this.timeoutMs
  ): Promise<Response> {
    const url = new URL(path, this.baseUrl)
    for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value)
    let response: Response
    try {
      response = await fetch(url, {
        method,
        ...(body === undefined ? {} : { body, headers: { 'Content-Type': 'application/json' } }),
        signal: AbortSignal.timeout(timeoutMs)
      })
    } catch (error) {
      throw new AppError('ENGINE_UNAVAILABLE', `音声エンジンに接続できません(${this.baseUrl})`, String(error))
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new AppError('ENGINE_FAILED', `音声エンジンがエラーを返しました(${response.status})`, detail)
    }
    return response
  }
}

export function fromEngineMora(mora: EngineMora): Mora {
  return {
    text: mora.text,
    consonant: mora.consonant ?? null,
    consonantLength: mora.consonant_length ?? null,
    vowel: mora.vowel,
    vowelLength: mora.vowel_length,
    pitch: mora.pitch
  }
}

export function toEngineMora(mora: Mora): EngineMora {
  return {
    text: mora.text,
    consonant: mora.consonant,
    consonant_length: mora.consonantLength,
    vowel: mora.vowel,
    vowel_length: mora.vowelLength,
    pitch: mora.pitch
  }
}

export function fromEngineAccentPhrases(phrases: readonly EngineAccentPhrase[]): AccentPhrase[] {
  return phrases.map((phrase) => ({
    moras: phrase.moras.map(fromEngineMora),
    accent: phrase.accent,
    pauseMora: phrase.pause_mora ? fromEngineMora(phrase.pause_mora) : null,
    isInterrogative: phrase.is_interrogative ?? false
  }))
}

export function toEngineAccentPhrases(phrases: readonly AccentPhrase[]): EngineAccentPhrase[] {
  return phrases.map((phrase) => ({
    moras: phrase.moras.map(toEngineMora),
    accent: phrase.accent,
    pause_mora: phrase.pauseMora ? toEngineMora(phrase.pauseMora) : null,
    is_interrogative: phrase.isInterrogative
  }))
}
