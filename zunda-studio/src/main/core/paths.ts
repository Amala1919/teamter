import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * アプリが書き込む場所。キャッシュは消しても再生成できるものだけを置く。
 */
export interface AppPaths {
  userData: string
  settingsFile: string
  /** 録画中の会話記録。消えると取り戻せないのでキャッシュには置かない。 */
  live: string
  cache: {
    root: string
    voice: string
    proxy: string
    peaks: string
    psd: string
    /** AI の CLI を起動する作業ディレクトリ。ユーザーのプロジェクト設定を読ませないため空にしておく。 */
    aiWork: string
    temp: string
  }
}

export function createAppPaths(userData: string): AppPaths {
  const root = join(userData, 'cache')
  return {
    userData,
    settingsFile: join(userData, 'settings.json'),
    live: join(userData, 'live'),
    cache: {
      root,
      voice: join(root, 'voice'),
      proxy: join(root, 'proxy'),
      peaks: join(root, 'peaks'),
      psd: join(root, 'psd'),
      aiWork: join(root, 'ai-work'),
      temp: join(root, 'temp')
    }
  }
}

export async function ensureAppDirectories(paths: AppPaths): Promise<void> {
  await Promise.all(
    [paths.userData, paths.live, ...Object.values(paths.cache)].map((directory) =>
      mkdir(directory, { recursive: true })
    )
  )
}
