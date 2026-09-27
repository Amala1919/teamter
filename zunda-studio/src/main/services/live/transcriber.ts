import { randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { AppSettings } from '@shared/settings/schema'

import { AppError } from '../../core/errors'
import { resolveExecutable, runProcess } from '../../core/process'
import { ffmpegErrorDetail, type FfmpegLocator } from '../media/ffmpeg'

/** 押しながら話すの1回の上限(これより長い録音は受け付けない)。 */
const MAX_AUDIO_BYTES = 20 * 1024 * 1024

/**
 * 押しながら話した声を文字にする(R-7)。whisper.cpp をローカルで動かし、声を外へ送らない。
 * 録った声は文字起こしにだけ使い、動画の音声には使わない。
 */
export class Transcriber {
  constructor(
    private readonly getSettings: () => AppSettings,
    private readonly locator: FfmpegLocator,
    private readonly tempDirectory: string
  ) {}

  async transcribe(audioBase64: string): Promise<string> {
    const { whisperPath, whisperModelPath, language } = this.getSettings().speech
    const whisper = await resolveExecutable('whisper-cli', whisperPath, this.locator.processEnv)
    if (!whisper || !whisperModelPath) {
      throw new AppError('STT_UNAVAILABLE', whisper ? '文字起こしのモデルが指定されていません' : 'whisper が見つかりません')
    }
    const audio = Buffer.from(audioBase64, 'base64')
    if (audio.length === 0) throw new AppError('INVALID_ARGUMENT', '音声が空です')
    if (audio.length > MAX_AUDIO_BYTES) throw new AppError('INVALID_ARGUMENT', '音声が長すぎます(1回は1分程度まで)')

    await mkdir(this.tempDirectory, { recursive: true })
    const base = join(this.tempDirectory, `stt-${randomUUID()}`)
    const input = `${base}.input`
    const wav = `${base}.wav`
    try {
      await writeFile(input, audio)
      // whisper.cpp は 16kHz モノラルの WAV を受け付ける。
      const converted = await runProcess({
        command: await this.locator.ffmpeg(),
        args: ['-y', '-hide_banner', '-loglevel', 'error', '-i', input, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav],
        env: this.locator.processEnv,
        timeoutMs: 60_000
      })
      if (converted.exitCode !== 0) throw new AppError('FFMPEG_FAILED', '録音を読み取れませんでした', ffmpegErrorDetail(converted.stderr))
      const result = await runProcess({
        command: whisper,
        args: ['-m', whisperModelPath, '-f', wav, '-l', language, '-nt', '-np'],
        env: this.locator.processEnv,
        timeoutMs: 120_000
      })
      if (result.exitCode !== 0) throw new AppError('STT_UNAVAILABLE', '文字起こしに失敗しました', result.stderr.trim().split('\n').slice(-6).join('\n'))
      return result.stdout
        .split(/\r?\n/)
        .map((line) => line.replace(/^\[[^\]]*\]\s*/, '').trim())
        .filter(Boolean)
        .join('')
    } finally {
      await rm(input, { force: true })
      await rm(wav, { force: true })
    }
  }
}
