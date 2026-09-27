import { access, constants } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type { VoiceEngineSettings } from '@shared/settings/schema'

/**
 * 音声エンジンの実行ファイルを、よくある置き場所から探す。
 * 設定で場所を指定しなくても、アプリに同梱したエンジン、または利用者がインストールした VOICEVOX / AivisSpeech を起動できるようにする。
 * (エンジン本体は改変せず、公式の配布物をそのまま起動する。REQUIREMENTS.md L-2)
 */
export interface DiscoveryContext {
  platform: NodeJS.Platform
  env: NodeJS.ProcessEnv
  home: string
  /** アプリに同梱した資源の置き場所(Electron の process.resourcesPath)。無ければ null。 */
  resourcesPath: string | null
  /** アプリが自動で入れた VOICEVOX ENGINE の実行ファイル。 */
  installedEngine?: string | null
}

export function defaultDiscoveryContext(): DiscoveryContext {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath ?? null
  return { platform: process.platform, env: process.env, home: homedir(), resourcesPath }
}

/** エンジンの種類ごとの、同梱・インストール先の候補。先にあるものほど優先する。 */
export function engineCandidates(engine: Pick<VoiceEngineSettings, 'id' | 'label'>, context: DiscoveryContext): string[] {
  const exe = context.platform === 'win32' ? 'run.exe' : 'run'
  const name = `${engine.id} ${engine.label}`.toLowerCase()
  const isAivis = name.includes('aivis')
  const candidates: string[] = []

  // 1. アプリに同梱したエンジン(配布時に extraResources として置く)
  if (context.resourcesPath) {
    candidates.push(join(context.resourcesPath, isAivis ? 'aivisspeech-engine' : 'voicevox-engine', exe))
  }

  // 2. アプリが自動で入れたエンジン
  if (!isAivis && context.installedEngine) candidates.push(context.installedEngine)

  // 3. 利用者がインストールしたアプリに入っているエンジン
  const localAppData = context.env['LOCALAPPDATA'] ?? join(context.home, 'AppData', 'Local')
  const programFiles = context.env['ProgramFiles'] ?? 'C:\\Program Files'
  if (isAivis) {
    if (context.platform === 'win32') {
      candidates.push(join(localAppData, 'Programs', 'AivisSpeech', 'AivisSpeech-Engine', exe))
    } else if (context.platform === 'darwin') {
      candidates.push('/Applications/AivisSpeech.app/Contents/Resources/AivisSpeech-Engine/run')
      candidates.push(join(context.home, 'Applications/AivisSpeech.app/Contents/Resources/AivisSpeech-Engine/run'))
    }
  } else {
    if (context.platform === 'win32') {
      candidates.push(join(localAppData, 'Programs', 'VOICEVOX', 'vv-engine', exe))
      candidates.push(join(localAppData, 'Programs', 'VOICEVOX', exe))
      candidates.push(join(programFiles, 'VOICEVOX', 'vv-engine', exe))
    } else if (context.platform === 'darwin') {
      candidates.push('/Applications/VOICEVOX.app/Contents/Resources/vv-engine/run')
      candidates.push(join(context.home, 'Applications/VOICEVOX.app/Contents/Resources/vv-engine/run'))
    } else {
      candidates.push(join(context.home, '.voicevox', 'vv-engine', 'run'))
      candidates.push(join(context.home, '.local', 'share', 'voicevox', 'vv-engine', 'run'))
    }
  }
  return candidates
}

export async function discoverEngineExecutable(
  engine: Pick<VoiceEngineSettings, 'id' | 'label'>,
  context: DiscoveryContext = defaultDiscoveryContext()
): Promise<string | null> {
  for (const candidate of engineCandidates(engine, context)) {
    try {
      await access(candidate, context.platform === 'win32' ? constants.F_OK : constants.X_OK)
      return candidate
    } catch {
      // 次の候補へ。
    }
  }
  return null
}
