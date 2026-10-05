import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { AiService } from '../services/ai/ai-service'
import { ClaudeCodeProvider } from '../services/ai/claude-code-provider'
import { OpenCodeProvider } from '../services/ai/opencode-provider'
import { ExportService } from '../services/export/export-service'
import { LiveService } from '../services/live/live-service'
import { connectObs, type ObsConnector } from '../services/live/obs-link'
import { Transcriber } from '../services/live/transcriber'
import { FfmpegLocator } from '../services/media/ffmpeg'
import { AnalysisService } from '../services/media/analysis-service'
import { MediaService } from '../services/media/media-service'
import { AutosaveService } from '../services/project/autosave'
import { ProjectService } from '../services/project/project-service'
import { PsdService } from '../services/psd/psd-service'
import { discoverEngineExecutable, defaultDiscoveryContext } from '../services/voice/engine-discovery'
import { EngineInstaller } from '../services/voice/engine-installer'
import { EngineManager } from '../services/voice/engine-manager'
import { SynthesisService } from '../services/voice/synthesis-service'
import type { FilePicker } from './dialog'
import { EventBus } from './events'
import { MediaAccess } from './media-access'
import { PLAIN_CIPHER, SecretStore, type SecretCipher } from './secret-store'
import { defaultCacheRoot, finishCacheMove, markCacheRoot } from './cache-location'
import { createAppPaths, ensureAppDirectories, type AppPaths } from './paths'
import { SettingsStore } from './settings-store'
import { CharacterLibraryStore } from './character-library-store'
import { TemplateStore } from './template-store'
import { CommonsImageService } from '../services/media/commons-images'
import { sevenZipPath } from './seven-zip'

export interface ServicesOptions {
  userData: string
  runtime: 'electron' | 'devhost'
  appVersion: string
  picker: FilePicker
  /** 子プロセスに渡す環境変数。テストでは模擬CLIを PATH に置くために差し替える。 */
  env?: NodeJS.ProcessEnv
  /** 実行環境ごとのウィンドウ操作(Electron だけが持つ)。 */
  windows?: WindowControl
  /** OBS への接続。テストでは偽物に差し替える。 */
  connectObs?: ObsConnector
  /** APIキーの暗号化(Electron は OS の鍵保管庫)。無ければ暗号化せずに置く。 */
  cipher?: SecretCipher
  /** VOICEVOX ENGINE の配布元。テストでは模擬サーバーに向ける。 */
  engineRelease?: { latestUrl: string; downloadBase: string }
  /** HTTP の呼び出し(AI の API など)。テストで差し替える。 */
  fetch?: (input: string, init?: RequestInit) => Promise<Response>
  /** 画像の検索の API(テストで模擬の配布元を指すため)。 */
  commonsApi?: string
}

/** ライブ用ウィンドウとホットキー。テスト用ホストでは用意しない。 */
export interface WindowControl {
  openLive(): boolean
  /** ホットキーを登録する。登録できなかったら false。 */
  registerHotkey(accelerator: string, handler: () => void): boolean
  unregisterHotkeys(): void
  /** アプリを起動し直す。 */
  relaunch?(): boolean
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
  /** キャッシュの置き場所。設定の場所が使えず既定に戻したときは fallbackFrom にその場所が入る。 */
  cache: { root: string; defaultRoot: string; fallbackFrom: string | null }
  /** アプリに保存したキャラクター。 */
  characters: CharacterLibraryStore
  templates: TemplateStore
  commonsImages: CommonsImageService
  secrets: SecretStore
  media: MediaAccess
  picker: FilePicker
  projects: ProjectService
  ai: AiService
  engines: EngineManager
  /** VOICEVOX ENGINE の自動インストール。 */
  engineInstaller: EngineInstaller
  synthesis: SynthesisService
  psd: PsdService
  /** ffprobe・プロキシ・波形。 */
  mediaTools: MediaService
  analysis: AnalysisService
  ffmpeg: FfmpegLocator
  exporter: ExportService
  /** 保存ダイアログで選ばれた書き出し先。これ以外の場所には書き出さない。 */
  saveTargets: Set<string>
  /** ファイル選択で選ばれた、読み込んでよいファイル(相方の設定など)。 */
  readableFiles: Set<string>
  live: LiveService
  windows: WindowControl | null
  autosave: AutosaveService
  /** 終了時の後始末(アプリが起動した音声エンジンを止める等)。 */
  dispose: () => Promise<void>
}

export async function createServices(options: ServicesOptions): Promise<Services> {
  const events = new EventBus()
  // キャッシュの置き場所は設定で決まるので、先に設定を読む。
  await mkdir(options.userData, { recursive: true })
  const settings = new SettingsStore(createAppPaths(options.userData).settingsFile, events)
  await settings.load()
  const cache = await openCacheRoot(options.userData, settings.get().storage.cacheDir)
  const paths = createAppPaths(options.userData, cache.root)
  await ensureAppDirectories(paths)
  // 前の起動でキャッシュを移していたら、古い場所を後片付けする(起動は待たせない)。
  const cleanup = settings.get().storage.cleanupCacheDir
  if (cleanup && !cache.fallbackFrom) {
    void finishCacheMove(cleanup, paths.cache.root, defaultCacheRoot(options.userData))
      .then(() => settings.update({ storage: { cleanupCacheDir: null } }))
      .catch(() => {})
  }

  const secrets = new SecretStore(paths.secretsFile, options.cipher ?? PLAIN_CIPHER)
  await secrets.load()

  const media = new MediaAccess()
  media.allowRoot(paths.cache.root)
  // 効果音のパレットに登録した音は、どのプロジェクトからでも置けるようにしておく(登録はファイルを選んだときだけ)。
  media.allowFiles(settings.get().sounds.palette.map((entry) => entry.path))
  // 保存したキャラクターの立ち絵(PSD)は、新しいプロジェクトに足したときに読めるようにしておく。
  const characters = new CharacterLibraryStore(paths.charactersFile, (path) => media.allowFile(path))
  await characters.load()
  // ひな形で使う素材も、どのプロジェクトに入れても読めるようにしておく。
  const templates = new TemplateStore(paths.templatesFile, (path) => media.allowFile(path))
  await templates.load()
  // 解説の参考画像(Wikimedia Commons)。落とした画像は前の起動の分も読めるようにしておく。
  media.allowRoot(paths.downloadedImages)
  const commonsImages = new CommonsImageService(paths.downloadedImages, (path) => media.allowFile(path), `zunda-studio/${options.appVersion} (https://github.com/Amala1919/teamter)`, {
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.commonsApi ? { apiBase: options.commonsApi } : {})
  })

  const getSettings = (): ReturnType<SettingsStore['get']> => settings.get()
  const env = options.env ?? process.env
  const ai = new AiService(getSettings)
  ai.register(new ClaudeCodeProvider(getSettings, paths.cache.aiWork, env))
  ai.register(
    new OpenCodeProvider(getSettings, paths.cache.aiWork, env, () => secrets.get('opencode.apiKey'), options.fetch, `zunda-studio/${options.appVersion}`)
  )

  const engineInstaller = new EngineInstaller({
    root: join(paths.userData, 'engines'),
    sevenZipPath: await sevenZipPath(),
    events,
    ...(options.engineRelease ? { release: options.engineRelease } : {}),
    ...(options.fetch ? { fetch: options.fetch } : {})
  })
  const engines = new EngineManager(getSettings, events, (engine) =>
    discoverEngineExecutable(engine, { ...defaultDiscoveryContext(), installedEngine: engineInstaller.executablePath })
  )
  const synthesis = new SynthesisService(engines, paths.cache.voice)
  const ffmpeg = new FfmpegLocator(getSettings, env)
  const psd = new PsdService(paths.cache.psd)
  const live = new LiveService(
    paths.live,
    ai,
    getSettings,
    events,
    options.connectObs ?? connectObs,
    new Transcriber(getSettings, ffmpeg, paths.cache.temp)
  )
  const mediaTools = new MediaService(ffmpeg, getSettings, events, { proxy: paths.cache.proxy, peaks: paths.cache.peaks })

  return {
    runtime: options.runtime,
    appVersion: options.appVersion,
    paths,
    events,
    settings,
    cache: { root: paths.cache.root, defaultRoot: defaultCacheRoot(options.userData), fallbackFrom: cache.fallbackFrom },
    characters,
    templates,
    commonsImages,
    secrets,
    media,
    picker: options.picker,
    projects: new ProjectService(media),
    ai,
    engines,
    engineInstaller,
    synthesis,
    psd,
    mediaTools,
    analysis: new AnalysisService(ffmpeg, mediaTools, join(paths.cache.root, 'analysis')),
    ffmpeg,
    exporter: new ExportService(ffmpeg, getSettings, events, psd, synthesis, paths.cache.temp),
    saveTargets: new Set(),
    readableFiles: new Set(),
    live,
    windows: options.windows ?? null,
    autosave: new AutosaveService(join(paths.userData, 'autosave')),
    dispose: async () => {
      engineInstaller.cancel()
      options.windows?.unregisterHotkeys()
      await live.dispose()
      await engines.shutdown()
    }
  }
}

/**
 * 設定のキャッシュの置き場所を開く。使えなければ(ドライブを外した・書き込めないなど)既定の場所に戻し、fallbackFrom で知らせる。
 */
async function openCacheRoot(userData: string, configured: string | null): Promise<{ root: string; fallbackFrom: string | null }> {
  const fallback = defaultCacheRoot(userData)
  if (configured) {
    try {
      await markCacheRoot(configured)
      return { root: configured, fallbackFrom: null }
    } catch {
      await markCacheRoot(fallback)
      return { root: fallback, fallbackFrom: configured }
    }
  }
  await markCacheRoot(fallback)
  return { root: fallback, fallbackFrom: null }
}
