import {
  isSafeModelId,
  type GenerateRequest,
  type GenerateResult,
  type ModelInfo,
  type ProviderStatus
} from '@shared/ai/types'
import type { AppSettings } from '@shared/settings/schema'

import { AppError } from '../../core/errors'
import { resolveExecutable, runProcess } from '../../core/process'
import { cliFailure, spawnFailure } from './cli-errors'
import { extractJson } from './json'
import { OpenCodeApi, usesOfficialEndpoints, type FetchLike } from './opencode-api'
import { jsonInstruction, turnsToPrompt, type LlmProvider } from './provider'
import { markRecommended, OPENCODE_RECOMMENDED } from '@shared/ai/models'
import { catalogEntry, OPENCODE_CATALOG, opencodePlan } from '@shared/ai/opencode-catalog'
import { OPENCODE_GO_BASE_URL, OPENCODE_ZEN_BASE_URL } from '@shared/settings/schema'

const LABEL = 'OpenCode'
const AGENT_NAME = 'zunda-studio'


/** OpenCode のツール権限キー。全て拒否して純粋な文章生成にする。 */
const DENIED_PERMISSIONS = [
  'read',
  'edit',
  'glob',
  'grep',
  'list',
  'bash',
  'task',
  'external_directory',
  'todowrite',
  'webfetch',
  'websearch',
  'lsp',
  'skill',
  'question'
]

interface OpenCodeEvent {
  type?: string
  part?: { type?: string; text?: string }
  error?: { name?: string; data?: { message?: string } }
}

export class OpenCodeProvider implements LlmProvider {
  readonly id = 'opencode' as const
  readonly label = LABEL

  private readonly api: OpenCodeApi

  constructor(
    private readonly getSettings: () => AppSettings,
    private readonly workDirectory: string,
    private readonly baseEnv: NodeJS.ProcessEnv = process.env,
    /** 保存してある API キー。キーで接続するときに使う。 */
    private readonly getApiKey: () => string | null = () => null,
    fetchImpl?: FetchLike
  ) {
    this.api = new OpenCodeApi(fetchImpl)
  }

  private config(): AppSettings['ai']['providers']['opencode'] {
    return this.getSettings().ai.providers.opencode
  }

  private usesApi(): boolean {
    return this.config().connection === 'api-key'
  }

  private apiOptions(): { baseUrl: string; apiKey: string; timeoutMs: number } {
    const config = this.config()
    return { baseUrl: config.baseUrl, apiKey: this.getApiKey() ?? '', timeoutMs: config.timeoutMs }
  }

  private async executable(): Promise<string | null> {
    return resolveExecutable('opencode', this.config().executablePath, this.baseEnv)
  }

  async status(): Promise<ProviderStatus> {
    if (this.usesApi()) {
      const key = this.getApiKey()
      const base = { providerId: this.id, label: this.label, executablePath: null }
      if (!key) return { ...base, state: { kind: 'needs-key' } }
      return { ...base, state: { kind: 'ready', version: `APIキー …${key.slice(-4)}` } }
    }
    const executablePath = await this.executable()
    const base = { providerId: this.id, label: this.label, executablePath }
    if (!executablePath) return { ...base, state: { kind: 'not-installed' } }
    try {
      const run = await runProcess({
        command: executablePath,
        args: ['--version'],
        cwd: this.workDirectory,
        env: this.childEnv(null),
        timeoutMs: 15_000
      })
      if (run.exitCode !== 0) {
        return { ...base, state: { kind: 'error', message: (run.stderr || run.stdout).trim() } }
      }
      return { ...base, state: { kind: 'ready', version: run.stdout.trim().split('\n')[0] ?? '' } }
    } catch (error) {
      return { ...base, state: { kind: 'error', message: String(error) } }
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    // おすすめは、契約しているプラン(接続先が Zen なら Zen、それ以外は Go)のモデルから選ぶ。
    const prefer = this.usesApi() && this.config().baseUrl.replace(/\/+$/, '') === OPENCODE_ZEN_BASE_URL ? 'opencode/' : 'opencode-go/'
    return markRecommended(await this.listAllModels(), OPENCODE_RECOMMENDED, prefer)
  }

  /**
   * 選べるモデルの一覧。API(または opencode コマンド)から取れたものを先に、内蔵の一覧にしか無いものを後ろに並べる。
   * 内蔵の一覧も出すのは、キーを入れる前や一覧を取れないときでも選べるようにするため。
   */
  private async listAllModels(): Promise<ModelInfo[]> {
    const config = this.config()
    const custom = config.customModels.map<ModelInfo>((id) => ({ id, label: id, source: 'custom', group: '手入力したモデル' }))
    let live: string[] = []
    let includeCatalog = true
    if (this.usesApi()) {
      if (this.getApiKey()) live = await this.listFromApi()
      // 独自の接続先では、OpenCode の一覧が当てはまるとは限らない。取れたものだけ出す。
      includeCatalog = usesOfficialEndpoints(config.baseUrl) || live.length === 0
    } else {
      // コマンドの一覧は、そのコマンドで実際に使えるもの。取れたときはそれだけを出す。
      live = await this.listFromCli()
      includeCatalog = live.length === 0
    }
    const ids = [...new Set([...live, ...(includeCatalog ? OPENCODE_CATALOG.map((entry) => entry.id) : [])])]
    const liveSet = new Set(live)
    return [...ids.map((id) => describeModel(id, liveSet.has(id) ? 'cli' : 'static')), ...custom]
  }

  /** 公式の接続先なら、Go と Zen の両方の一覧を取る(1つのキーで両方使える)。 */
  private async listFromApi(): Promise<string[]> {
    const options = this.apiOptions()
    const bases = usesOfficialEndpoints(options.baseUrl) ? [OPENCODE_GO_BASE_URL, OPENCODE_ZEN_BASE_URL] : [options.baseUrl]
    const results = await Promise.allSettled(bases.map((baseUrl) => this.api.listModels({ ...options, baseUrl })))
    return results.flatMap((result) => (result.status === 'fulfilled' ? result.value : []))
  }

  /** opencode コマンドに登録されている全プロバイダのモデル。 */
  private async listFromCli(): Promise<string[]> {
    const executablePath = await this.executable()
    if (!executablePath) return []
    try {
      const run = await runProcess({
        command: executablePath,
        args: ['models'],
        cwd: this.workDirectory,
        env: this.childEnv(null),
        timeoutMs: 30_000
      })
      return run.exitCode === 0 ? parseModelList(run.stdout) : []
    } catch {
      return []
    }
  }

  async generate(model: string, request: GenerateRequest, signal?: AbortSignal): Promise<GenerateResult> {
    if (!isSafeModelId(model) || !model.includes('/')) {
      throw new AppError('INVALID_ARGUMENT', `OpenCode のモデルは provider/model の形式で指定してください: ${model}`)
    }
    // OpenCode にはスキーマを強制する仕組みが無いので、指示で求めてアプリ側で検証する。
    const system = request.jsonSchema
      ? `${request.system}\n\n${jsonInstruction(request.jsonSchema)}`
      : request.system
    const started = Date.now()

    if (this.usesApi()) {
      const text = await this.api.generate(this.apiOptions(), model, { ...request, system }, signal)
      return this.result(model, text, started, request)
    }

    const executablePath = await this.executable()
    if (!executablePath) throw new AppError('CLI_NOT_FOUND', 'OpenCode(opencode コマンド)が見つかりません')

    let run
    try {
      run = await runProcess({
        command: executablePath,
        args: ['run', '--format', 'json', '--agent', AGENT_NAME, '--model', model, '--pure'],
        cwd: this.workDirectory,
        env: this.childEnv(system),
        input: turnsToPrompt(request.turns),
        timeoutMs: this.config().timeoutMs,
        ...(signal ? { signal } : {})
      })
    } catch (error) {
      throw spawnFailure(LABEL, error)
    }
    if (run.aborted) throw new AppError('CANCELLED', '生成を中止しました')

    const { text, errors } = parseRunEvents(run.stdout)
    if (run.exitCode !== 0 || errors.length > 0 || text.trim() === '') {
      throw cliFailure(LABEL, run, errors.join('\n') || run.stdout)
    }

    return this.result(model, text, started, request)
  }

  private result(model: string, text: string, started: number, request: GenerateRequest): GenerateResult {
    const result: GenerateResult = {
      text: text.trim(),
      generatedBy: { providerId: this.id, model, at: new Date().toISOString() },
      durationMs: Date.now() - started
    }
    if (request.jsonSchema) {
      try {
        result.structured = extractJson(text)
      } catch {
        result.structured = undefined
      }
    }
    return result
  }

  /**
   * 専用エージェントの定義は OPENCODE_CONFIG_CONTENT で渡し、利用者の設定ファイルには書き込まない。
   * ~/.claude の CLAUDE.md やスキルを読ませないのは、相方の人格にコーディング向けの指示が混ざらないようにするため。
   */
  private childEnv(system: string | null): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {
      ...this.baseEnv,
      OPENCODE_DISABLE_CLAUDE_CODE: '1',
      OPENCODE_DISABLE_AUTOUPDATE: '1'
    }
    if (system !== null) env['OPENCODE_CONFIG_CONTENT'] = JSON.stringify(agentConfig(system))
    return env
  }
}

const PLAN_GROUPS = { go: 'OpenCode Go(月額プラン)', zen: 'OpenCode Zen(従量課金)' } as const

/** 一覧に出す形。名前は内蔵の一覧から、無ければ ID のまま。 */
export function describeModel(id: string, source: ModelInfo['source']): ModelInfo {
  const entry = catalogEntry(id)
  const plan = opencodePlan(id)
  const group = plan === 'other' ? `その他のプロバイダ(${id.split('/')[0]})` : PLAN_GROUPS[plan]
  return {
    id,
    label: entry ? entry.name : id,
    source,
    group,
    ...(entry?.free ? { note: '無料' } : {})
  }
}

export function agentConfig(system: string): Record<string, unknown> {
  const permission: Record<string, string> = { '*': 'deny' }
  for (const key of DENIED_PERMISSIONS) permission[key] = 'deny'
  // steps は指定しない。OpenCode は1回目の応答で既に「最大ステップ到達」とみなす数え方をするため、
  // steps: 1 にすると最初の応答に作業報告を求める指示が注入され、セリフが壊れる。
  // ツールは permission で全て拒否しているので、ステップが重なることはない。
  return {
    agent: {
      [AGENT_NAME]: {
        description: 'zunda-studio の台本生成用。ツールは使わない',
        mode: 'primary',
        prompt: system,
        permission
      }
    }
  }
}

export function parseModelList(stdout: string): string[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[A-Za-z0-9._-]+\/[A-Za-z0-9._:@/[\]-]+$/.test(line))
}

/** `opencode run --format json` は1行1イベントのJSONを出す。text パートを順に連結する。 */
export function parseRunEvents(stdout: string): { text: string; errors: string[] } {
  const texts: string[] = []
  const errors: string[] = []
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('{')) continue
    let event: OpenCodeEvent
    try {
      event = JSON.parse(trimmed) as OpenCodeEvent
    } catch {
      continue
    }
    if (event.type === 'text' && typeof event.part?.text === 'string') texts.push(event.part.text)
    if (event.type === 'error') {
      errors.push(event.error?.data?.message ?? event.error?.name ?? '不明なエラー')
    }
  }
  return { text: texts.join('\n').trim(), errors }
}
