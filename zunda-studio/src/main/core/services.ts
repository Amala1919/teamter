import { AiService } from '../services/ai/ai-service'
import { ClaudeCodeProvider } from '../services/ai/claude-code-provider'
import { OpenCodeProvider } from '../services/ai/opencode-provider'
import { ProjectService } from '../services/project/project-service'
import { PsdService } from '../services/psd/psd-service'
import { EngineManager } from '../services/voice/engine-manager'
import { SynthesisService } from '../services/voice/synthesis-service'
import type { FilePicker } from './dialog'
import { EventBus } from './events'
import { MediaAccess } from './media-access'
import { createAppPaths, ensureAppDirectories, type AppPaths } from './paths'
import { SettingsStore } from './settings-store'

export interface ServicesOptions {
  userData: string
  runtime: 'electron' | 'devhost'
  appVersion: string
  picker: FilePicker
  /** 子プロセスに渡す環境変数。テストでは模擬CLIを PATH に置くために差し替える。 */
  env?: NodeJS.ProcessEnv
}

/**
 * main 側のサービスをまとめて組み立てる。Electron にもテスト用ホストにも依存しない。
 */
export interface Services {
  runtime: 'electron' | 'devhost'
  appVersion: string
  paths: AppPaths
  events: EventBus
  settings: SettingsStore
  media: MediaAccess
  picker: FilePicker
  projects: ProjectService
  ai: AiService
  engines: EngineManager
  synthesis: SynthesisService
  psd: PsdService
  /** 終了時の後始末(アプリが起動した音声エンジンを止める等)。 */
  dispose: () => Promise<void>
}

export async function createServices(options: ServicesOptions): Promise<Services> {
  const paths = createAppPaths(options.userData)
  await ensureAppDirectories(paths)

  const events = new EventBus()
  const settings = new SettingsStore(paths.settingsFile, events)
  await settings.load()

  const media = new MediaAccess()
  media.allowRoot(paths.cache.root)

  const getSettings = (): ReturnType<SettingsStore['get']> => settings.get()
  const env = options.env ?? process.env
  const ai = new AiService(getSettings)
  ai.register(new ClaudeCodeProvider(getSettings, paths.cache.aiWork, env))
  ai.register(new OpenCodeProvider(getSettings, paths.cache.aiWork, env))

  const engines = new EngineManager(getSettings, events)
  const synthesis = new SynthesisService(engines, paths.cache.voice)

  return {
    runtime: options.runtime,
    appVersion: options.appVersion,
    paths,
    events,
    settings,
    media,
    picker: options.picker,
    projects: new ProjectService(media),
    ai,
    engines,
    synthesis,
    psd: new PsdService(paths.cache.psd),
    dispose: () => engines.shutdown()
  }
}
