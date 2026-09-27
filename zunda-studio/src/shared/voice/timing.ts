/**
 * VOICEVOX の音声がどの時刻にどのモーラを発音しているかを求める。
 * エンジン(voicevox_engine/tts_pipeline/tts_engine.py)の処理順と丸め方をそのまま再現しているので、
 * 合成された音声と口パクがフレーム単位で一致する。
 *
 *   1. 疑問文のアクセント句の末尾に、語尾上げのモーラ(0.15秒)を足す
 *   2. アクセント句ごとのモーラと句末の無音(pau)を並べる
 *   3. 前後に無音(sil)を足す
 *   4. pauseLength / pauseLengthScale を pau に適用する
 *   5. 全ての長さを speedScale で割る
 *   6. 子音・母音それぞれを 93.75fps のフレームに偶数丸めする
 */

import type { AccentPhrase, LipSyncKeyframe, Mora, Vowel } from '../project/types'

export const FRAME_RATE = 93.75
const UPSPEAK_LENGTH = 0.15

export interface TimingParams {
  speedScale: number
  prePhonemeLength: number
  postPhonemeLength: number
  pauseLength: number | null
  pauseLengthScale: number
}

export interface PhonemeSegment {
  /** 発音している文字(無音は空文字)。 */
  text: string
  consonant: string | null
  vowel: string
  startFrame: number
  consonantFrames: number
  vowelFrames: number
}

/** numpy.round と同じ偶数丸め(0.5 は偶数側へ)。 */
export function roundHalfEven(value: number): number {
  const floor = Math.floor(value)
  const diff = value - floor
  if (diff > 0.5) return floor + 1
  if (diff < 0.5) return floor
  return floor % 2 === 0 ? floor : floor + 1
}

export function toFrames(seconds: number): number {
  return roundHalfEven(seconds * FRAME_RATE)
}

export function framesToMs(frames: number): number {
  return Math.round((frames / FRAME_RATE) * 1000)
}

interface WorkingMora {
  text: string
  consonant: string | null
  consonantLength: number | null
  vowel: string
  vowelLength: number
}

export function phonemeSegments(
  accentPhrases: readonly AccentPhrase[],
  params: TimingParams,
  interrogativeUpspeak = true
): PhonemeSegment[] {
  const moras: WorkingMora[] = []
  for (const phrase of accentPhrases) {
    const phraseMoras: WorkingMora[] = phrase.moras.map(toWorking)
    const last = phrase.moras[phrase.moras.length - 1]
    if (interrogativeUpspeak && phrase.isInterrogative && last && last.pitch > 0) {
      phraseMoras.push({
        text: '',
        consonant: null,
        consonantLength: null,
        vowel: last.vowel,
        vowelLength: UPSPEAK_LENGTH
      })
    }
    moras.push(...phraseMoras)
    if (phrase.pauseMora) moras.push(toWorking(phrase.pauseMora))
  }

  const all: WorkingMora[] = [
    { text: '', consonant: null, consonantLength: null, vowel: 'sil', vowelLength: params.prePhonemeLength },
    ...moras,
    { text: '', consonant: null, consonantLength: null, vowel: 'sil', vowelLength: params.postPhonemeLength }
  ]

  let frame = 0
  return all.map((mora) => {
    let vowelLength = mora.vowelLength
    if (mora.vowel === 'pau') {
      if (params.pauseLength !== null) vowelLength = params.pauseLength
      vowelLength *= params.pauseLengthScale
    }
    const consonantFrames =
      mora.consonantLength === null ? 0 : toFrames(mora.consonantLength / params.speedScale)
    const vowelFrames = toFrames(vowelLength / params.speedScale)
    const segment: PhonemeSegment = {
      text: mora.text,
      consonant: mora.consonant,
      vowel: mora.vowel,
      startFrame: frame,
      consonantFrames,
      vowelFrames
    }
    frame += consonantFrames + vowelFrames
    return segment
  })
}

function toWorking(mora: Mora): WorkingMora {
  return {
    text: mora.text,
    consonant: mora.consonant,
    consonantLength: mora.consonantLength,
    vowel: mora.vowel,
    vowelLength: mora.vowelLength
  }
}

export function totalFrames(segments: readonly PhonemeSegment[]): number {
  const last = segments[segments.length - 1]
  return last ? last.startFrame + last.consonantFrames + last.vowelFrames : 0
}

/** 唇を閉じて発音する子音。この間は口を閉じた形にすると自然に見える。 */
const BILABIALS = new Set(['m', 'my', 'b', 'by', 'p', 'py'])

/**
 * 母音をそのまま口の形として使う。
 * 無声化した母音(大文字)は小文字の母音と同じ形、無音と促音は閉じた口にする。
 */
export function normalizeVowel(vowel: string): Vowel {
  switch (vowel) {
    case 'a':
    case 'A':
      return 'a'
    case 'i':
    case 'I':
      return 'i'
    case 'u':
    case 'U':
      return 'u'
    case 'e':
    case 'E':
      return 'e'
    case 'o':
    case 'O':
      return 'o'
    case 'N':
      return 'N'
    case 'cl':
      return 'cl'
    default:
      return 'pau'
  }
}

/**
 * 口パクのキーフレームを作る。各キーフレームは次のキーフレームまでその口の形を保つことを意味する。
 */
export function lipSyncKeyframes(segments: readonly PhonemeSegment[]): LipSyncKeyframe[] {
  const keyframes: LipSyncKeyframe[] = []
  const push = (frame: number, vowel: Vowel): void => {
    const atMs = framesToMs(frame)
    const previous = keyframes[keyframes.length - 1]
    if (previous && previous.vowel === vowel) return
    if (previous && previous.atMs === atMs) {
      previous.vowel = vowel
      return
    }
    keyframes.push({ atMs, vowel })
  }

  for (const segment of segments) {
    const vowel = normalizeVowel(segment.vowel)
    if (segment.consonant && segment.consonantFrames > 0) {
      push(segment.startFrame, BILABIALS.has(segment.consonant) ? 'N' : vowel)
    }
    push(segment.startFrame + segment.consonantFrames, vowel)
  }
  return keyframes
}

/** 指定時刻の口の形。キーフレームが無ければ閉じた口。 */
export function vowelAt(keyframes: readonly LipSyncKeyframe[], timeMs: number): Vowel {
  let current: Vowel = 'pau'
  for (const keyframe of keyframes) {
    if (keyframe.atMs > timeMs) break
    current = keyframe.vowel
  }
  return current
}
