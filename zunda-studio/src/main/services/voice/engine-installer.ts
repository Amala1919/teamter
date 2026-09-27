import { createWriteStream } from 'node:fs'
import { chmod, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'

import type { EngineInstallInfo, EngineInstallState } from '@shared/voice/types'

import { AppError } from '../../core/errors'
import type { EventBus } from '../../core/events'
import { runProcess } from '../../core/process'

/**
 * VOICEVOX ENGINE(公式の配布物)をダウンロードして展開する。
 * 配布は 7z の分割アーカイブ(voicevox_engine-<種類>-<版>.7z.001, .002 …)なので、同梱の 7za で展開する。
 * エンジン本体は改変せずにそのまま置き、起動は EngineManager に任せる(REQUIREMENTS.md L-2)。
 */

/** GitHub の最新リリースを取れないときに使う版。 */
export const FALLBACK_ENGINE_VERSION = '0.25.2'

export const OFFICIAL_RELEASE = {
  latestUrl: 'https://api.github.com/repos/VOICEVOX/voicevox_engine/releases/latest',
  downloadBase: 'https://github.com/VOICEVOX/voicevox_engine/releases/download'
}

export interface InstallerOptions {
  /** エンジンを置く場所(userData/engines)。 */
  root: string
  sevenZipPath: string
  events: EventBus
  platform?: NodeJS.Platform
  arch?: string
  release?: { latestUrl: string; downloadBase: string }
  fetch?: (input: string, init?: RequestInit) => Promise<Response>
}

/** OS と CPU に合う公式配布の種類。GPU 版は環境を選ぶので、どこでも動く CPU 版を使う。 */
export function engineTarget(platform: NodeJS.Platform, arch: string): string | null {
  if (platform === 'win32' && arch === 'x64') return 'windows-cpu'
  if (platform === 'darwin' && (arch === 'arm64' || arch === 'x64')) return `macos-${arch}`
  if (platform === 'linux' && (arch === 'x64' || arch === 'arm64')) return `linux-cpu-${arch}`
  return null
}

interface ReleaseAsset {
  name: string
  size: number | null
}

/** 分割アーカイブの部品を、番号順に並べて取り出す。 */
export function archiveParts(assets: readonly ReleaseAsset[], target: string, version: string): ReleaseAsset[] {
  const prefix = `voicevox_engine-${target}-${version}.7z.`
  return assets
    .filter((asset) => asset.name.startsWith(prefix) && /^\d{3}$/.test(asset.name.slice(prefix.length)))
    .sort((a, b) => a.name.localeCompare(b.name))
}

const IDLE: EngineInstallState = { phase: 'idle', receivedBytes: 0, totalBytes: null }
const PROGRESS_INTERVAL_MS = 250

export class EngineInstaller {
  private state: EngineInstallState = IDLE
  private controller: AbortController | null = null
  private running: Promise<string> | null = null
  private readonly platform: NodeJS.Platform
  private readonly arch: string
  private readonly release: { latestUrl: string; downloadBase: string }
  private readonly fetchImpl: (input: string, init?: RequestInit) => Promise<Response>

  constructor(private readonly options: InstallerOptions) {
    this.platform = options.platform ?? process.platform
    this.arch = options.arch ?? process.arch
    this.release = options.release ?? OFFICIAL_RELEASE
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init))
  }

  get target(): string | null {
    return engineTarget(this.platform, this.arch)
  }

  /** 入れたエンジンの置き場所。 */
  get installDir(): string {
    return join(this.options.root, 'voicevox')
  }

  get executablePath(): string {
    return join(this.installDir, this.platform === 'win32' ? 'run.exe' : 'run')
  }

  async info(): Promise<EngineInstallInfo> {
    return { supported: this.target !== null, target: this.target, installed: await this.installed(), state: this.state }
  }

  async installed(): Promise<{ version: string; executablePath: string } | null> {
    try {
      await stat(this.executablePath)
      const version = (await readFile(join(this.installDir, 'zunda-version.txt'), 'utf8')).trim()
      return { version: version || '不明', executablePath: this.executablePath }
    } catch {
      return null
    }
  }

  /** インストールを始める。終わると実行ファイルの場所を返す。重ねて呼ばれたら同じ処理を待つ。 */
  install(): Promise<string> {
    if (this.running) return this.running
    this.controller = new AbortController()
    this.running = this.run(this.controller.signal).finally(() => {
      this.running = null
      this.controller = null
    })
    return this.running
  }

  cancel(): void {
    this.controller?.abort()
  }

  /** 起動まで終わったことを知らせる(起動は EngineManager が行う)。 */
  finish(message?: string): void {
    this.update({ phase: message ? 'error' : 'done', ...(message ? { message } : {}) })
  }

  markStarting(): void {
    this.update({ phase: 'starting', message: 'VOICEVOX を起動しています…' })
  }

  private async run(signal: AbortSignal): Promise<string> {
    const target = this.target
    if (!target) {
      const error = new AppError('ENGINE_UNAVAILABLE', 'この PC(OS・CPU)向けの VOICEVOX は自動で入れられません')
      this.update({ ...IDLE, phase: 'error', message: error.message })
      throw error
    }
    const downloads = join(this.options.root, 'downloads')
    try {
      this.update({ ...IDLE, phase: 'checking', message: '最新の VOICEVOX を確かめています…' })
      const { version, parts } = await this.resolveRelease(target, signal)
      const total = parts.every((part) => part.size !== null) ? parts.reduce((sum, part) => sum + (part.size ?? 0), 0) : null
      this.update({ phase: 'downloading', version, receivedBytes: 0, totalBytes: total, message: `VOICEVOX ${version} をダウンロードしています…` })

      await mkdir(downloads, { recursive: true })
      let received = 0
      for (const part of parts) {
        const file = join(downloads, part.name)
        received += await this.download(`${this.release.downloadBase}/${version}/${part.name}`, file, part.size, received, signal)
      }

      this.update({ phase: 'extracting', message: '展開しています…(数分かかることがあります)' })
      const staging = join(this.options.root, 'staging')
      await rm(staging, { recursive: true, force: true })
      const run = await runProcess({
        command: this.options.sevenZipPath,
        args: ['x', join(downloads, parts[0]!.name), `-o${staging}`, '-y', '-bso0', '-bsp0'],
        signal
      })
      if (run.aborted) throw new AppError('CANCELLED', 'インストールを中止しました')
      if (run.exitCode !== 0) {
        throw new AppError('ENGINE_FAILED', 'VOICEVOX を展開できませんでした', (run.stderr || run.stdout).slice(-2000))
      }
      const extracted = await this.findExtractedRoot(staging, target)
      await rm(this.installDir, { recursive: true, force: true })
      await rename(extracted, this.installDir)
      await rm(staging, { recursive: true, force: true })
      await writeFile(join(this.installDir, 'zunda-version.txt'), version)
      if (this.platform !== 'win32') await chmod(this.executablePath, 0o755)
      await rm(downloads, { recursive: true, force: true })
      this.update({ phase: 'starting', message: 'VOICEVOX を起動しています…' })
      return this.executablePath
    } catch (error) {
      if (signal.aborted || (error instanceof AppError && error.code === 'CANCELLED')) {
        this.update({ phase: 'cancelled', message: 'インストールを中止しました' })
        throw new AppError('CANCELLED', 'インストールを中止しました')
      }
      const appError =
        error instanceof AppError ? error : new AppError('ENGINE_FAILED', 'VOICEVOX を入れられませんでした', String(error))
      this.update({ phase: 'error', message: `${appError.message}${appError.detail ? `(${appError.detail.split('\n')[0]})` : ''}` })
      throw appError
    }
  }

  /** 最新リリースの版と、この種類の部品一覧を決める。GitHub API が使えなければ決まった版で試す。 */
  private async resolveRelease(target: string, signal: AbortSignal): Promise<{ version: string; parts: ReleaseAsset[] }> {
    try {
      const response = await this.fetchImpl(this.release.latestUrl, {
        headers: { accept: 'application/vnd.github+json' },
        signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)])
      })
      if (response.ok) {
        const body = (await response.json()) as { tag_name?: string; assets?: { name?: string; size?: number }[] }
        const version = body.tag_name ?? ''
        const parts = archiveParts(
          (body.assets ?? []).map((asset) => ({ name: asset.name ?? '', size: typeof asset.size === 'number' ? asset.size : null })),
          target,
          version
        )
        if (version !== '' && parts.length > 0) return { version, parts }
      }
    } catch (error) {
      if (signal.aborted) throw error
    }
    return this.listFromManifest(target, FALLBACK_ENGINE_VERSION, signal)
  }

  /** 配布に添えられた部品の一覧(….7z.txt)から部品を知る。 */
  private async listFromManifest(target: string, version: string, signal: AbortSignal): Promise<{ version: string; parts: ReleaseAsset[] }> {
    const url = `${this.release.downloadBase}/${version}/voicevox_engine-${target}-${version}.7z.txt`
    let response: Response
    try {
      response = await this.fetchImpl(url, { signal })
    } catch (error) {
      if (signal.aborted) throw error
      throw new AppError('ENGINE_FAILED', 'VOICEVOX の配布元に接続できません。ネットにつながっているか確かめてください', String(error))
    }
    if (!response.ok) throw new AppError('ENGINE_FAILED', `VOICEVOX の配布が見つかりません(${response.status})`, url)
    const names = (await response.text())
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
    const parts = archiveParts(
      names.map((name) => ({ name, size: null })),
      target,
      version
    )
    if (parts.length === 0) throw new AppError('ENGINE_FAILED', 'VOICEVOX の配布の中身が想定と違います', names.join('\n'))
    return { version, parts }
  }

  /** 1つの部品を落とす。前回落とし終えていれば使い回す。落としたバイト数を返す。 */
  private async download(url: string, file: string, expected: number | null, before: number, signal: AbortSignal): Promise<number> {
    if (expected !== null) {
      try {
        if ((await stat(file)).size === expected) {
          this.update({ receivedBytes: before + expected })
          return expected
        }
      } catch {
        // まだ無い。
      }
    }
    let response: Response
    try {
      response = await this.fetchImpl(url, { signal })
    } catch (error) {
      if (signal.aborted) throw error
      throw new AppError('ENGINE_FAILED', 'VOICEVOX をダウンロードできません。ネットにつながっているか確かめてください', String(error))
    }
    if (!response.ok || !response.body) throw new AppError('ENGINE_FAILED', `VOICEVOX をダウンロードできません(${response.status})`, url)
    let received = 0
    let lastEmit = 0
    const counter = new Transform({
      transform: (chunk: Buffer, _encoding, callback) => {
        received += chunk.length
        const now = Date.now()
        if (now - lastEmit >= PROGRESS_INTERVAL_MS) {
          lastEmit = now
          this.update({ receivedBytes: before + received })
        }
        callback(null, chunk)
      }
    })
    const partial = `${file}.partial`
    await pipeline(Readable.fromWeb(response.body as unknown as WebReadableStream<Uint8Array>), counter, createWriteStream(partial), { signal })
    if (expected !== null && received !== expected) {
      throw new AppError('ENGINE_FAILED', 'ダウンロードが途中で切れました。もう一度試してください', `${received} / ${expected} bytes`)
    }
    await rename(partial, file)
    this.update({ receivedBytes: before + received })
    return received
  }

  /** 展開した中から、エンジンの入ったフォルダ(<種類>/run)を探す。 */
  private async findExtractedRoot(staging: string, target: string): Promise<string> {
    const exe = this.platform === 'win32' ? 'run.exe' : 'run'
    const candidates = [join(staging, target), staging, ...(await readdir(staging)).map((name) => join(staging, name))]
    for (const candidate of candidates) {
      try {
        await stat(join(candidate, exe))
        return candidate
      } catch {
        // 次へ。
      }
    }
    throw new AppError('ENGINE_FAILED', `展開した中にエンジン(${exe})が見つかりません`)
  }

  private update(change: Partial<EngineInstallState>): void {
    this.state = { ...this.state, ...change }
    if (change.phase && !['downloading', 'extracting', 'checking', 'starting'].includes(change.phase)) {
      // 途中経過以外の段階に入ったら、古い説明は残さない。
      if (!('message' in change)) delete this.state.message
    }
    this.options.events.emit('voice:install-progress', this.state)
  }
}
