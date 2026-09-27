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
import { jsonInstruction, turnsToPrompt, type LlmProvider } from './provider'

const LABEL = 'OpenCode'
const AGENT_NAME = 'zunda-studio'

/**
 * CLIからモデル一覧を取れないときに出す候補(OpenCode Go の公式ドキュメント時点の一覧)。
 * 実際の一覧は `opencode models` から取得し、そちらを優先する。
 */
export const OPENCODE_GO_FALLBACK_MODELS: ModelInfo[] = [
  'kimi-k3',
  'glm-5.3',
  'glm-5.2',
  'qwen3.8-max',
  'qwen3.8-flash',
  'deepseek-v4-pro',
  'deepseek-v4-flash',
  'minimax-m3',
  'gpt-6-luna',
  'grok-4.7',
  'mimo-v2.6-pro',
  'longcat-2.0'
].map((id) => ({ id: `opencode-go/${id}`, label: `opencode-go/${id}`, source: 'static' as const }))

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

  constructor(
    private readonly getSettings: () => AppSettings,
    private readonly workDirectory: string,
    private readonly baseEnv: NodeJS.ProcessEnv = process.env
  ) {}

  private config(): AppSettings['ai']['providers']['opencode'] {
    return this.getSettings().ai.providers.opencode
  }

  private async executable(): Promise<string | null> {
    return resolveExecutable('opencode', this.config().executablePath, this.baseEnv)
  }

  async status(): Promise<ProviderStatus> {
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
    const config = this.config()
    const custom = config.customModels.map<ModelInfo>((id) => ({ id, label: id, source: 'custom' }))
    const executablePath = await this.executable()
    if (!executablePath) return [...OPENCODE_GO_FALLBACK_MODELS, ...custom]

    try {
      const args = config.providerFilter ? ['models', config.providerFilter] : ['models']
      const run = await runProcess({
        command: executablePath,
        args,
        cwd: this.workDirectory,
        env: this.childEnv(null),
        timeoutMs: 30_000
      })
      const models = parseModelList(run.stdout)
      if (run.exitCode !== 0 || models.length === 0) return [...OPENCODE_GO_FALLBACK_MODELS, ...custom]
      return [...models.map<ModelInfo>((id) => ({ id, label: id, source: 'cli' })), ...custom]
    } catch {
      return [...OPENCODE_GO_FALLBACK_MODELS, ...custom]
    }
  }

  async generate(model: string, request: GenerateRequest, signal?: AbortSignal): Promise<GenerateResult> {
    if (!isSafeModelId(model) || !model.includes('/')) {
      throw new AppError('INVALID_ARGUMENT', `OpenCode のモデルは provider/model の形式で指定してください: ${model}`)
    }
    const executablePath = await this.executable()
    if (!executablePath) throw new AppError('CLI_NOT_FOUND', 'OpenCode(opencode コマンド)が見つかりません')

    // OpenCode にはスキーマを強制する仕組みが無いので、指示で求めてアプリ側で検証する。
    const system = request.jsonSchema
      ? `${request.system}\n\n${jsonInstruction(request.jsonSchema)}`
      : request.system

    const started = Date.now()
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

    const result: GenerateResult = {
      text,
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
