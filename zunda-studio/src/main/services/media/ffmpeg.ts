import type { AppSettings } from '@shared/settings/schema'

import { AppError } from '../../core/errors'
import { resolveExecutable } from '../../core/process'

/** ffmpeg と ffprobe の場所。設定で指定されていればそれを、無ければ PATH から探す。 */
export class FfmpegLocator {
  constructor(
    private readonly getSettings: () => AppSettings,
    private readonly env: NodeJS.ProcessEnv = process.env
  ) {}

  async ffmpeg(): Promise<string> {
    return this.require('ffmpeg', this.getSettings().media.ffmpegPath)
  }

  async ffprobe(): Promise<string> {
    return this.require('ffprobe', this.getSettings().media.ffprobePath)
  }

  get processEnv(): NodeJS.ProcessEnv {
    return this.env
  }

  private async require(name: string, configured: string | null): Promise<string> {
    const found = await resolveExecutable(name, configured, this.env)
    if (!found) {
      throw new AppError(
        'FFMPEG_NOT_FOUND',
        configured ? `${name} を起動できません: ${configured}` : `${name} が見つかりません`
      )
    }
    return found
  }
}

/** 「〇〇に失敗しました」の文。ffmpeg がメモリ不足で止まったなら、その旨と対処を添える。 */
export function ffmpegFailure(what: string, stderr: string): string {
  return /Cannot allocate memory|out of memory|Failed to allocate/i.test(stderr)
    ? `${what}に失敗しました(PC のメモリが足りなくなりました。ほかのアプリを閉じるか、書き出しの解像度を下げてもう一度試してください)`
    : `${what}に失敗しました`
}

/** ffmpeg の標準エラー出力から、利用者に見せる短い理由を取り出す(最後の数行)。 */
export function ffmpegErrorDetail(stderr: string): string {
  return stderr.trim().split(/\r?\n/).slice(-8).join('\n')
}
