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

/** ffmpeg の標準エラー出力から、利用者に見せる短い理由を取り出す(最後の数行)。 */
export function ffmpegErrorDetail(stderr: string): string {
  return stderr.trim().split(/\r?\n/).slice(-8).join('\n')
}
