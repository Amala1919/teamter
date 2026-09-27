import { open } from 'node:fs/promises'

import { gainEnvelope, sourceSpanMs, type GainPoint } from '@shared/audio/envelope'
import type { Item, Ms, Project } from '@shared/project/types'

import { AppError } from '../../core/errors'
import { CHANNELS, decodeAll, PcmStream, SAMPLE_RATE } from './streams'

/**
 * 書き出し用の音声ミキサー。セリフ・BGM・効果音・動画の音を、プレビューと同じ音量の折れ線で重ねて WAV にする。
 * 音量の計算を ffmpeg のフィルタに任せず自前で行うのは、プレビュー(Web Audio)と同じ折れ線を
 * そのまま使って、聞こえ方を一致させるため。
 */

const BLOCK_FRAMES = SAMPLE_RATE / 2

export interface MixOptions {
  project: Project
  startMs: Ms
  endMs: Ms
  ffmpeg: string
  env: NodeJS.ProcessEnv
  /** セリフの音声ファイルの場所。 */
  voicePath: (item: Extract<Item, { type: 'voice' }>) => Promise<string>
  outputPath: string
  onProgress?: (ratio: number) => void
  signal?: AbortSignal | undefined
}

interface Entry {
  item: Item
  path: string
  /** 出力上の開始・終了(出力の先頭からのフレーム数)。 */
  fromFrame: number
  toFrame: number
  /** 素材上の読み始め(ms)。 */
  sourceStartMs: Ms
  gain: GainPoint[] | null
  loop: { buffer: Float32Array; offsetFrames: number } | null
  /** 再生速度(動画の速度変更)。 */
  rate: number
  stream: PcmStream | null
  done: boolean
}

function toFrame(ms: Ms): number {
  return Math.round((ms / 1000) * SAMPLE_RATE)
}

/** 折れ線上を順に進みながら値を求める(標本ごとに先頭から探さないように)。 */
class GainCursor {
  private index = 0
  constructor(private readonly points: GainPoint[]) {}

  at(relMs: Ms): number {
    const points = this.points
    while (this.index < points.length - 2 && points[this.index + 1]!.atMs <= relMs) this.index++
    const a = points[this.index]!
    const b = points[Math.min(this.index + 1, points.length - 1)]!
    if (relMs <= a.atMs || b.atMs <= a.atMs) return relMs <= a.atMs ? a.gain : b.gain
    if (relMs >= b.atMs) return b.gain
    return a.gain + ((b.gain - a.gain) * (relMs - a.atMs)) / (b.atMs - a.atMs)
  }
}

export async function mixAudio(options: MixOptions): Promise<void> {
  const { project, startMs, endMs } = options
  const totalFrames = Math.max(0, toFrame(endMs - startMs))
  const muted = new Set(project.layers.filter((layer) => layer.muted).map((layer) => layer.id))
  const entries: Entry[] = []

  for (const item of project.items) {
    if (muted.has(item.layerId)) continue
    const itemEnd = item.startMs + item.durationMs
    const from = Math.max(item.startMs, startMs)
    const to = Math.min(itemEnd, endMs)
    if (to <= from) continue
    const base = { item, fromFrame: toFrame(from - startMs), toFrame: toFrame(to - startMs), stream: null, done: false }
    if (item.type === 'voice') {
      if (!item.synthesis) throw new AppError('INVALID_ARGUMENT', `音声が合成されていないセリフがあります: ${item.text}`)
      entries.push({ ...base, path: await options.voicePath(item), sourceStartMs: from - item.startMs, gain: null, loop: null, rate: 1 })
    } else if (item.type === 'audio' || item.type === 'video') {
      const asset = project.assets[item.assetId]
      if (!asset || (asset.type === 'video' && !asset.hasAudio) || item.volume === 0) continue
      // 静止画は音を鳴らさない。
      if (item.type === 'video' && item.freeze) continue
      const gain = gainEnvelope(project, item)
      if (item.type === 'audio' && item.loop && sourceSpanMs(item) > 0) {
        const buffer = await decodeAll(options.ffmpeg, options.env, asset.path.absolute, item.inMs, sourceSpanMs(item))
        const spanFrames = buffer.length / CHANNELS
        const offsetFrames = toFrame(from - item.startMs) % spanFrames
        entries.push({ ...base, path: asset.path.absolute, sourceStartMs: 0, gain, loop: { buffer, offsetFrames }, rate: 1 })
      } else {
        const rate = item.type === 'video' ? item.playbackRate : 1
        entries.push({ ...base, path: asset.path.absolute, sourceStartMs: item.inMs + (from - item.startMs) * rate, gain, loop: null, rate })
      }
    }
  }

  const file = await open(options.outputPath, 'w')
  try {
    await file.write(wavHeader(totalFrames))
    const mix = new Float32Array(BLOCK_FRAMES * CHANNELS)
    const cursors = new Map<Entry, GainCursor>()
    for (let block = 0; block < totalFrames; block += BLOCK_FRAMES) {
      if (options.signal?.aborted) throw new AppError('CANCELLED', '書き出しを中止しました')
      const blockEnd = Math.min(totalFrames, block + BLOCK_FRAMES)
      mix.fill(0)
      for (const entry of entries) {
        if (entry.done || entry.toFrame <= block || entry.fromFrame >= blockEnd) continue
        const from = Math.max(block, entry.fromFrame)
        const to = Math.min(blockEnd, entry.toFrame)
        const count = to - from
        const samples = await readEntry(entry, from, count, options)
        let cursor = cursors.get(entry)
        if (!cursor && entry.gain) {
          cursor = new GainCursor(entry.gain)
          cursors.set(entry, cursor)
        }
        const itemOffsetMs = startMs - entry.item.startMs
        for (let frame = 0; frame < count; frame++) {
          const gain = cursor ? cursor.at(((from + frame) / SAMPLE_RATE) * 1000 + itemOffsetMs) : 1
          const target = (from - block + frame) * CHANNELS
          mix[target] = mix[target]! + samples[frame * CHANNELS]! * gain
          mix[target + 1] = mix[target + 1]! + samples[frame * CHANNELS + 1]! * gain
        }
        if (to >= entry.toFrame) {
          entry.done = true
          entry.stream?.close()
        }
      }
      await file.write(toPcm16(mix, blockEnd - block))
      options.onProgress?.(blockEnd / Math.max(1, totalFrames))
    }
  } finally {
    for (const entry of entries) entry.stream?.close()
    await file.close()
  }
}

async function readEntry(entry: Entry, fromFrame: number, count: number, options: MixOptions): Promise<Float32Array> {
  if (entry.loop) {
    const { buffer } = entry.loop
    const span = buffer.length / CHANNELS
    const result = new Float32Array(count * CHANNELS)
    let position = (entry.loop.offsetFrames + (fromFrame - entry.fromFrame)) % span
    for (let frame = 0; frame < count; frame++) {
      result[frame * CHANNELS] = buffer[position * CHANNELS]!
      result[frame * CHANNELS + 1] = buffer[position * CHANNELS + 1]!
      position = (position + 1) % span
    }
    return result
  }
  // 必要になった時点で読み始める(数百のセリフで ffmpeg を同時に起動しないように)。
  entry.stream ??= new PcmStream(
    options.ffmpeg,
    options.env,
    entry.path,
    entry.sourceStartMs,
    ((entry.toFrame - entry.fromFrame) / SAMPLE_RATE) * 1000 + 50,
    entry.rate
  )
  return entry.stream.read(count)
}

function toPcm16(mix: Float32Array, frames: number): Buffer {
  const buffer = Buffer.alloc(frames * CHANNELS * 2)
  for (let index = 0; index < frames * CHANNELS; index++) {
    const value = Math.max(-1, Math.min(1, mix[index]!))
    buffer.writeInt16LE(Math.round(value * 32767), index * 2)
  }
  return buffer
}

export function wavHeader(frames: number): Buffer {
  const dataBytes = frames * CHANNELS * 2
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + dataBytes, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(CHANNELS, 22)
  header.writeUInt32LE(SAMPLE_RATE, 24)
  header.writeUInt32LE(SAMPLE_RATE * CHANNELS * 2, 28)
  header.writeUInt16LE(CHANNELS * 2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(dataBytes, 40)
  return header
}
