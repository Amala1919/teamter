import type { ChildProcess } from 'node:child_process'
import { dirname } from 'node:path'

import type { AppSettings, VoiceEngineSettings } from '@shared/settings/schema'
import type { EngineStatus } from '@shared/voice/types'

import { AppError } from '../../core/errors'
import type { EventBus } from '../../core/events'
import { spawnProcess } from '../../core/process'
import { discoverEngineExecutable } from './engine-discovery'
import { VoicevoxClient } from './voicevox-client'

const STARTUP_TIMEOUT_MS = 120_000
const POLL_INTERVAL_MS = 500

/**
 * 音声エンジンの検出・起動・停止。
 * 既に起動しているエンジン(利用者が VOICEVOX を開いている等)があればそれに接続し、
 * 無ければ設定された実行ファイルを起動する。アプリが起動したエンジンだけを終了時に止める。
 */
export class EngineManager {
  private readonly statuses = new Map<string, EngineStatus>()
  private readonly processes = new Map<string, ChildProcess>()
  private readonly pending = new Map<string, Promise<EngineStatus>>()
  private readonly clients = new Map<string, VoicevoxClient>()

  constructor(
    private readonly getSettings: () => AppSettings,
    private readonly events: EventBus,
    /** 場所が設定されていないときに、同梱・インストール済みのエンジンを探す。テストでは差し替える。 */
    private readonly discover: (engine: VoiceEngineSettings) => Promise<string | null> = (engine) => discoverEngineExecutable(engine)
  ) {}

  engines(): VoiceEngineSettings[] {
    return this.getSettings().voice.engines
  }

  engine(engineId: string): VoiceEngineSettings {
    const engine = this.engines().find((candidate) => candidate.id === engineId)
    if (!engine) throw new AppError('ENGINE_UNAVAILABLE', `音声エンジンが設定されていません: ${engineId}`)
    return engine
  }

  client(engineId: string): VoicevoxClient {
    const engine = this.engine(engineId)
    const cached = this.clients.get(engineId)
    if (cached && cached.baseUrl === engine.url) return cached
    const client = new VoicevoxClient(engine.url)
    this.clients.set(engineId, client)
    return client
  }

  statusList(): EngineStatus[] {
    return this.engines().map((engine) => this.statuses.get(engine.id) ?? this.initialStatus(engine))
  }

  /** 使える状態にする。起動中の要求が重なったら同じ待ちを共有する。 */
  async ensure(engineId: string): Promise<EngineStatus> {
    const current = this.statuses.get(engineId)
    if (current?.state === 'ready') {
      // 前回使えたエンジンが落ちている場合に備えて軽く確かめる。
      const probed = await this.probe(engineId)
      if (probed.state === 'ready') return probed
    }
    const inFlight = this.pending.get(engineId)
    if (inFlight) return inFlight
    const task = this.start(engineId).finally(() => this.pending.delete(engineId))
    this.pending.set(engineId, task)
    return task
  }

  /** 使える状態でなければ、利用者に分かるエラーにする。 */
  async require(engineId: string): Promise<VoicevoxClient> {
    const status = await this.ensure(engineId)
    if (status.state !== 'ready') {
      throw new AppError('ENGINE_UNAVAILABLE', status.message ?? `${status.label} に接続できません`)
    }
    return this.client(engineId)
  }

  async probe(engineId: string): Promise<EngineStatus> {
    const engine = this.engine(engineId)
    try {
      const version = await this.client(engineId).version()
      return this.update(engine, { state: 'ready', version })
    } catch {
      const previous = this.statuses.get(engineId)
      return this.update(engine, {
        state: previous?.state === 'starting' ? 'starting' : 'unavailable',
        message: `${engine.label} に接続できません(${engine.url})`
      })
    }
  }

  async shutdown(): Promise<void> {
    for (const [engineId, child] of this.processes) {
      if (child.exitCode === null) child.kill()
      this.processes.delete(engineId)
    }
  }

  private async start(engineId: string): Promise<EngineStatus> {
    const engine = this.engine(engineId)
    const probed = await this.probe(engineId)
    if (probed.state === 'ready') return probed

    const executablePath = engine.autoLaunch ? (engine.executablePath ?? (await this.discover(engine))) : null
    if (!executablePath) {
      return this.update(engine, {
        state: 'unavailable',
        message: !engine.autoLaunch
          ? `${engine.label} が起動していません(自動起動は無効)`
          : `${engine.label} が見つかりません。自動で入れるか、エンジンの場所を設定してください`,
        ...(engine.autoLaunch ? { reason: 'not-found' as const } : {})
      })
    }

    const url = new URL(engine.url)
    const port = url.port || '50021'
    this.update(engine, { state: 'starting', message: `${engine.label} を起動しています…` })

    let stderrTail = ''
    let exited = false
    let child: ChildProcess
    try {
      child = spawnProcess({
        command: executablePath,
        args: ['--host', url.hostname, '--port', port],
        cwd: dirname(executablePath)
      })
    } catch (error) {
      return this.update(engine, { state: 'unavailable', message: `${engine.label} を起動できません: ${String(error)}` })
    }
    this.processes.set(engineId, child)
    child.stdout?.resume()
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      stderrTail = (stderrTail + chunk).slice(-2000)
    })
    child.on('exit', () => {
      exited = true
      this.processes.delete(engineId)
      const status = this.statuses.get(engineId)
      if (status?.state === 'ready') {
        this.update(engine, { state: 'unavailable', message: `${engine.label} が終了しました` })
      }
    })
    child.on('error', (error) => {
      exited = true
      stderrTail += String(error)
    })

    const deadline = Date.now() + STARTUP_TIMEOUT_MS
    while (Date.now() < deadline) {
      if (exited) {
        return this.update(engine, {
          state: 'unavailable',
          message: `${engine.label} が起動直後に終了しました${stderrTail ? `: ${stderrTail.trim().split('\n').at(-1)}` : ''}`
        })
      }
      const status = await this.probe(engineId)
      if (status.state === 'ready') return this.update(engine, { state: 'ready', ...(status.version ? { version: status.version } : {}) })
      await new Promise((resolvePromise) => setTimeout(resolvePromise, POLL_INTERVAL_MS))
    }
    child.kill()
    return this.update(engine, { state: 'unavailable', message: `${engine.label} の起動が時間内に終わりませんでした` })
  }

  private initialStatus(engine: VoiceEngineSettings): EngineStatus {
    return { id: engine.id, label: engine.label, url: engine.url, state: 'unknown', managed: false }
  }

  private update(
    engine: VoiceEngineSettings,
    change: Pick<EngineStatus, 'state'> & Partial<Pick<EngineStatus, 'version' | 'message' | 'reason'>>
  ): EngineStatus {
    const status: EngineStatus = {
      id: engine.id,
      label: engine.label,
      url: engine.url,
      state: change.state,
      managed: this.processes.has(engine.id),
      ...(change.version ? { version: change.version } : {}),
      ...(change.message && change.state !== 'ready' ? { message: change.message } : {}),
      ...(change.reason && change.state !== 'ready' ? { reason: change.reason } : {})
    }
    const previous = this.statuses.get(engine.id)
    this.statuses.set(engine.id, status)
    if (previous?.state !== status.state || previous.message !== status.message || previous.reason !== status.reason) {
      this.events.emit('voice:engine-status', status)
    }
    return status
  }
}
