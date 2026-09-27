import type { ChildProcess } from 'node:child_process'
import type { Readable } from 'node:stream'

import { AppError } from '../../core/errors'
import { spawnProcess } from '../../core/process'
import { ffmpegErrorDetail } from '../media/ffmpeg'

/** 貯めすぎたら子プロセスからの読み取りを止める量。 */
const HIGH_WATER_BYTES = 32 * 1024 * 1024

/**
 * 子プロセスの出力を、必要な分だけ順に取り出す。読む側が遅ければ出力を一時停止する(メモリを溜めない)。
 */
export class ByteReader {
  private readonly chunks: Buffer[] = []
  private buffered = 0
  private ended = false
  private failure: Error | null = null
  private wake: (() => void) | null = null

  constructor(private readonly stream: Readable) {
    stream.on('data', (chunk: Buffer) => {
      this.chunks.push(chunk)
      this.buffered += chunk.length
      if (this.buffered > HIGH_WATER_BYTES) stream.pause()
      this.notify()
    })
    stream.on('end', () => {
      this.ended = true
      this.notify()
    })
    stream.on('error', (error) => {
      this.failure = error
      this.notify()
    })
  }

  /** ちょうど size バイト返す。終わりに達していれば短い(0 のこともある)。 */
  async read(size: number): Promise<Buffer> {
    while (this.buffered < size && !this.ended) {
      if (this.failure) throw this.failure
      if (this.stream.isPaused()) this.stream.resume()
      await new Promise<void>((resolve) => {
        this.wake = resolve
      })
    }
    if (this.failure) throw this.failure
    const take = Math.min(size, this.buffered)
    const joined = this.chunks.length === 1 ? this.chunks[0]! : Buffer.concat(this.chunks)
    const result = joined.subarray(0, take)
    const rest = joined.subarray(take)
    this.chunks.length = 0
    if (rest.length > 0) this.chunks.push(rest)
    this.buffered = rest.length
    if (this.buffered <= HIGH_WATER_BYTES && this.stream.isPaused()) this.stream.resume()
    return result
  }

  private notify(): void {
    const wake = this.wake
    this.wake = null
    wake?.()
  }
}

/** ffmpeg を起動し、標準出力を順に読めるようにする。終了時の失敗は finish() で分かる。 */
export class FfmpegOutput {
  readonly reader: ByteReader
  private readonly child: ChildProcess
  private stderr = ''
  private readonly exit: Promise<number | null>

  constructor(ffmpeg: string, args: string[], env: NodeJS.ProcessEnv) {
    this.child = spawnProcess({ command: ffmpeg, args, env })
    this.child.stdin?.end()
    this.child.stderr?.setEncoding('utf8')
    this.child.stderr?.on('data', (chunk: string) => {
      if (this.stderr.length < 64 * 1024) this.stderr += chunk
    })
    this.reader = new ByteReader(this.child.stdout!)
    this.exit = new Promise((resolve, reject) => {
      this.child.on('error', reject)
      this.child.on('close', resolve)
    })
  }

  /** 最後まで読んだ後に呼ぶ。ffmpeg が失敗していれば例外にする。 */
  async finish(what: string): Promise<void> {
    const code = await this.exit
    if (code !== 0 && code !== null) throw new AppError('FFMPEG_FAILED', `${what}に失敗しました`, ffmpegErrorDetail(this.stderr))
  }

  kill(): void {
    if (this.child.exitCode === null && this.child.signalCode === null) this.child.kill('SIGKILL')
  }
}

export const SAMPLE_RATE = 48_000
export const CHANNELS = 2
const BYTES_PER_FRAME = CHANNELS * 4

/**
 * 素材の一部を 48kHz ステレオの float に展開しながら読む。
 * 素材の長さを超えて読むと無音を返す(素材の終わりより長く置かれていても書き出しが止まらないように)。
 */
export class PcmStream {
  private readonly output: FfmpegOutput
  private exhausted = false

  constructor(ffmpeg: string, env: NodeJS.ProcessEnv, path: string, startMs: number, durationMs: number) {
    this.output = new FfmpegOutput(
      ffmpeg,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-ss',
        (startMs / 1000).toFixed(3),
        '-t',
        (durationMs / 1000).toFixed(3),
        '-i',
        path,
        '-vn',
        '-ac',
        String(CHANNELS),
        '-ar',
        String(SAMPLE_RATE),
        '-f',
        'f32le',
        '-'
      ],
      env
    )
  }

  /** frames 個(1フレーム = 左右1組)の標本。足りない分は 0。 */
  async read(frames: number): Promise<Float32Array> {
    const result = new Float32Array(frames * CHANNELS)
    if (this.exhausted) return result
    const bytes = await this.output.reader.read(frames * BYTES_PER_FRAME)
    const usable = bytes.length - (bytes.length % 4)
    const view = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + usable))
    result.set(view)
    if (bytes.length < frames * BYTES_PER_FRAME) {
      this.exhausted = true
      await this.output.finish('音声の読み込み')
    }
    return result
  }

  close(): void {
    this.output.kill()
  }
}

/** 素材の区間をまるごと展開する(ループする BGM 用。区間は通常数分以内)。 */
export async function decodeAll(ffmpeg: string, env: NodeJS.ProcessEnv, path: string, startMs: number, durationMs: number): Promise<Float32Array> {
  const stream = new PcmStream(ffmpeg, env, path, startMs, durationMs)
  const frames = Math.max(1, Math.round((durationMs / 1000) * SAMPLE_RATE))
  try {
    return await stream.read(frames)
  } finally {
    stream.close()
  }
}

/**
 * 動画の一部を、指定の大きさ・フレームレートの RGBA のコマとして順に読む。
 * 素材の終わりに達したら最後のコマを返し続ける。
 */
export class FrameStream {
  private readonly output: FfmpegOutput
  private last: Buffer | null = null
  private exhausted = false
  readonly frameBytes: number

  constructor(
    ffmpeg: string,
    env: NodeJS.ProcessEnv,
    path: string,
    options: { startMs: number; fps: number; width: number; height: number; playbackRate: number }
  ) {
    this.frameBytes = options.width * options.height * 4
    const filters = [
      options.playbackRate !== 1 ? `setpts=PTS/${options.playbackRate}` : null,
      `fps=${options.fps}`,
      `scale=${options.width}:${options.height}:flags=bicubic`,
      'format=rgba'
    ].filter(Boolean)
    this.output = new FfmpegOutput(
      ffmpeg,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-ss',
        (options.startMs / 1000).toFixed(3),
        '-i',
        path,
        '-an',
        '-vf',
        filters.join(','),
        '-f',
        'rawvideo',
        '-pix_fmt',
        'rgba',
        '-'
      ],
      env
    )
  }

  async next(): Promise<Buffer | null> {
    if (!this.exhausted) {
      const frame = await this.output.reader.read(this.frameBytes)
      if (frame.length === this.frameBytes) {
        this.last = Buffer.from(frame)
        return this.last
      }
      this.exhausted = true
      await this.output.finish('動画の読み込み')
    }
    return this.last
  }

  close(): void {
    this.output.kill()
  }
}
