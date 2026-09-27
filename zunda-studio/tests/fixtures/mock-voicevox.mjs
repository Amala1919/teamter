// VOICEVOX ENGINE の模擬サーバー。API の形状(パス・クエリ・JSON のキー)は本物に合わせてある。
// 音声は本物と同じ手順(前後の無音・句読点の無音・話速・93.75fps の偶数丸め)で長さを決めた WAV を返すので、
// アプリ側の口パクのタイミング計算と音声の長さが一致するかを検証できる。
//
//   node tests/fixtures/mock-voicevox.mjs --port 50121
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'

const FRAME_RATE = 93.75
const SAMPLES_PER_FRAME = 256
const ENGINE_RATE = 24000

const SPEAKERS = [
  {
    name: '四国めたん',
    speaker_uuid: '7ffcb7ce-00ec-4bdc-82cd-45a8889e43ff',
    styles: [
      { name: 'ノーマル', id: 2, type: 'talk' },
      { name: 'あまあま', id: 0, type: 'talk' }
    ],
    version: '0.99.0',
    supported_features: { permitted_synthesis_morphing: 'SELF_ONLY' }
  },
  {
    name: 'ずんだもん',
    speaker_uuid: '388f246b-8c41-4ac1-8e2d-5d79f3ff56d9',
    styles: [
      { name: 'ノーマル', id: 3, type: 'talk' },
      { name: 'あまあま', id: 1, type: 'talk' }
    ],
    version: '0.99.0',
    supported_features: { permitted_synthesis_morphing: 'SELF_ONLY' }
  }
]

const VOWEL_ROWS = {
  a: 'あかさたなはまやらわがざだばぱ',
  i: 'いきしちにひみりぎじぢびぴ',
  u: 'うくすつぬふむゆるぐずづぶぷ',
  e: 'えけせてねへめれげぜでべぺ',
  o: 'おこそとのほもよろをごぞどぼぽ'
}
const CONSONANTS = {
  か: 'k', き: 'k', く: 'k', け: 'k', こ: 'k', さ: 's', し: 'sh', す: 's', せ: 's', そ: 's',
  た: 't', ち: 'ch', つ: 'ts', て: 't', と: 't', な: 'n', に: 'n', ぬ: 'n', ね: 'n', の: 'n',
  は: 'h', ひ: 'h', ふ: 'f', へ: 'h', ほ: 'h', ま: 'm', み: 'm', む: 'm', め: 'm', も: 'm',
  や: 'y', ゆ: 'y', よ: 'y', ら: 'r', り: 'r', る: 'r', れ: 'r', ろ: 'r', わ: 'w', を: 'w',
  が: 'g', ぎ: 'g', ぐ: 'g', げ: 'g', ご: 'g', ざ: 'z', じ: 'j', ず: 'z', ぜ: 'z', ぞ: 'z',
  だ: 'd', ぢ: 'j', づ: 'z', で: 'd', ど: 'd', ば: 'b', び: 'b', ぶ: 'b', べ: 'b', ぼ: 'b',
  ぱ: 'p', ぴ: 'p', ぷ: 'p', ぺ: 'p', ぽ: 'p'
}

function toHiragana(text) {
  return text.replace(/[ァ-ヶ]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0x60))
}

function moraFor(char, previousVowel) {
  if (char === 'ん') return { text: 'ン', consonant: null, consonant_length: null, vowel: 'N', vowel_length: 0.08, pitch: 5.6 }
  if (char === 'っ') return { text: 'ッ', consonant: null, consonant_length: null, vowel: 'cl', vowel_length: 0.07, pitch: 0 }
  if (char === 'ー') return { text: 'ー', consonant: null, consonant_length: null, vowel: previousVowel ?? 'a', vowel_length: 0.1, pitch: 5.8 }
  let vowel = 'a'
  for (const [candidate, row] of Object.entries(VOWEL_ROWS)) {
    if (row.includes(char)) vowel = candidate
  }
  const consonant = CONSONANTS[char] ?? (/[ぁ-ゖ]/.test(char) ? null : 'k')
  return {
    // 本物のエンジンと同じく、モーラの文字はカタカナで返す。
    text: /[ぁ-ゖ]/.test(char) ? String.fromCharCode(char.charCodeAt(0) + 0x60) : char,
    consonant,
    consonant_length: consonant ? 0.06 : null,
    vowel,
    vowel_length: 0.1,
    pitch: 5.8
  }
}

/** テキストをアクセント句に分ける。「、」で句を切って無音を入れ、「？」で疑問文にする。 */
export function textToAccentPhrases(text) {
  const phrases = []
  let moras = []
  const flush = (pause, interrogative) => {
    if (moras.length === 0) return
    phrases.push({
      moras,
      accent: 1,
      pause_mora: pause ? { text: '、', consonant: null, consonant_length: null, vowel: 'pau', vowel_length: 0.3, pitch: 0 } : null,
      is_interrogative: interrogative
    })
    moras = []
  }
  for (const char of toHiragana(text)) {
    if (char === '、' || char === ',' || char === '/') flush(char !== '/', false)
    else if (char === '？' || char === '?') flush(false, true)
    else if (char === '。' || char === '！' || char === '!' || /\s/.test(char)) flush(false, false)
    else if (char === "'" || char === '_') continue
    else moras.push(moraFor(char, moras.at(-1)?.vowel))
  }
  flush(false, false)
  return phrases
}

function roundHalfEven(value) {
  const floor = Math.floor(value)
  const diff = value - floor
  if (diff > 0.5) return floor + 1
  if (diff < 0.5) return floor
  return floor % 2 === 0 ? floor : floor + 1
}

/** 本物のエンジンと同じ手順で総フレーム数を求める。 */
export function engineFrames(query) {
  const moras = []
  for (const phrase of query.accent_phrases) {
    moras.push(...phrase.moras)
    const last = phrase.moras.at(-1)
    if (phrase.is_interrogative && last && last.pitch > 0) {
      moras.push({ consonant: null, consonant_length: null, vowel: last.vowel, vowel_length: 0.15 })
    }
    if (phrase.pause_mora) moras.push(phrase.pause_mora)
  }
  const all = [
    { consonant_length: null, vowel: 'sil', vowel_length: query.prePhonemeLength },
    ...moras,
    { consonant_length: null, vowel: 'sil', vowel_length: query.postPhonemeLength }
  ]
  let frames = 0
  for (const mora of all) {
    let vowelLength = mora.vowel_length
    if (mora.vowel === 'pau') {
      if (query.pauseLength !== null && query.pauseLength !== undefined) vowelLength = query.pauseLength
      vowelLength *= query.pauseLengthScale ?? 1
    }
    if (mora.consonant_length !== null && mora.consonant_length !== undefined) {
      frames += roundHalfEven((mora.consonant_length / query.speedScale) * FRAME_RATE)
    }
    frames += roundHalfEven((vowelLength / query.speedScale) * FRAME_RATE)
  }
  return frames
}

export function makeWav(sampleCount, sampleRate) {
  const dataSize = sampleCount * 2
  const buffer = Buffer.alloc(44 + dataSize)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataSize, 40)
  for (let index = 0; index < sampleCount; index++) {
    const value = Math.round(Math.sin((2 * Math.PI * 220 * index) / sampleRate) * 3000)
    buffer.writeInt16LE(value, 44 + index * 2)
  }
  return buffer
}

async function readBody(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

export function startMockVoicevox({ port = 0, delayMs = 0 } = {}) {
  const stats = { audio_query: 0, accent_phrases: 0, synthesis: 0, speakers: 0, maxConcurrentSynthesis: 0 }
  let concurrentSynthesis = 0
  const dictionary = new Map()

  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost')
    const json = (status, body) => {
      response.writeHead(status, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify(body))
    }
    const speakerParam = Number(url.searchParams.get('speaker'))
    const knownStyle = SPEAKERS.some((speaker) => speaker.styles.some((style) => style.id === speakerParam))

    try {
      if (request.method === 'GET' && url.pathname === '/version') return json(200, '0.99.0-mock')
      if (request.method === 'GET' && url.pathname === '/speakers') {
        stats.speakers++
        return json(200, SPEAKERS)
      }
      if (request.method === 'GET' && url.pathname === '/__stats') return json(200, stats)

      if (request.method === 'POST' && url.pathname === '/audio_query') {
        stats.audio_query++
        const text = url.searchParams.get('text') ?? ''
        if (!knownStyle) return json(422, { detail: 'unknown speaker' })
        if (text.includes('💥')) return json(500, { detail: 'engine exploded' })
        // 本物と同じく、ユーザー辞書の語はその読みで読む。
        let spoken = text
        for (const word of dictionary.values()) spoken = spoken.split(word.surface).join(word.pronunciation)
        const accent_phrases = textToAccentPhrases(spoken)
        return json(200, {
          accent_phrases,
          speedScale: 1,
          pitchScale: 0,
          intonationScale: 1,
          volumeScale: 1,
          prePhonemeLength: 0.1,
          postPhonemeLength: 0.1,
          pauseLength: null,
          pauseLengthScale: 1,
          outputSamplingRate: ENGINE_RATE,
          outputStereo: false,
          kana: accent_phrases.map((phrase) => phrase.moras.map((mora) => mora.text).join('')).join('/')
        })
      }

      if (request.method === 'POST' && url.pathname === '/accent_phrases') {
        stats.accent_phrases++
        const text = url.searchParams.get('text') ?? ''
        if (url.searchParams.get('is_kana') === 'true' && /[a-zA-Z]/.test(text)) {
          return json(400, { detail: { error_name: 'ParseKanaError', error_args: { text } } })
        }
        return json(200, textToAccentPhrases(text))
      }

      if (request.method === 'POST' && url.pathname === '/synthesis') {
        stats.synthesis++
        concurrentSynthesis++
        stats.maxConcurrentSynthesis = Math.max(stats.maxConcurrentSynthesis, concurrentSynthesis)
        try {
          const query = JSON.parse(await readBody(request))
          if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs))
          if (!knownStyle) return json(422, { detail: 'unknown speaker' })
          const frames = engineFrames(query)
          const rate = query.outputSamplingRate ?? ENGINE_RATE
          const samples = Math.round((frames * SAMPLES_PER_FRAME * rate) / ENGINE_RATE)
          response.writeHead(200, { 'Content-Type': 'audio/wav' })
          response.end(makeWav(samples, rate))
          return
        } finally {
          concurrentSynthesis--
        }
      }

      if (request.method === 'GET' && url.pathname === '/user_dict') {
        return json(200, Object.fromEntries(dictionary))
      }
      if (request.method === 'POST' && url.pathname === '/user_dict_word') {
        const id = randomUUID()
        dictionary.set(id, {
          surface: url.searchParams.get('surface'),
          pronunciation: url.searchParams.get('pronunciation'),
          accent_type: Number(url.searchParams.get('accent_type')),
          priority: Number(url.searchParams.get('priority') ?? 5)
        })
        return json(200, id)
      }
      if (request.method === 'DELETE' && url.pathname.startsWith('/user_dict_word/')) {
        dictionary.delete(url.pathname.split('/').pop())
        response.writeHead(204)
        response.end()
        return
      }
      json(404, { detail: 'Not Found' })
    } catch (error) {
      json(500, { detail: String(error) })
    }
  })

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const address = server.address()
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        stats,
        close: () => new Promise((done) => server.close(() => done()))
      })
    })
  })
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const index = process.argv.indexOf('--port')
  const port = index >= 0 ? Number(process.argv[index + 1]) : 50121
  const mock = await startMockVoicevox({ port })
  console.log(`mock voicevox: ${mock.url}`)
}
