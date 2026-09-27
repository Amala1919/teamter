import { randomBytes } from 'node:crypto'
import { rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

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

const LABEL = 'Claude Code'

/**
 * 内蔵の候補。サブスクで使えるモデルはプランによって異なるため、選べても実行時に断られることがある。
 * エイリアスは Claude Code 側で常に最新版を指すので、既定ではエイリアスを勧める。
 */
export const CLAUDE_MODELS: ModelInfo[] = [
  { id: 'sonnet', label: 'Sonnet(最新・エイリアス)', source: 'static', note: '速さと質のバランスが良い' },
  { id: 'opus', label: 'Opus(最新・エイリアス)', source: 'static', note: '文章の質を優先するとき' },
  { id: 'haiku', label: 'Haiku(最新・エイリアス)', source: 'static', note: '速さ優先。ライブ向き' },
  { id: 'fable', label: 'Fable(最新・エイリアス)', source: 'static', note: '最上位。プランによっては使えない' },
  { id: 'claude-fable-5-1', label: 'Claude Fable 5.1', source: 'static' },
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', source: 'static' },
  { id: 'claude-opus-5', label: 'Claude Opus 5', source: 'static' },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', source: 'static' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', source: 'static' }
]

/** --json-schema をコマンドラインで渡せる上限。cmd.exe 経由の起動は 8191 文字で打ち切られるため余裕を持たせる。 */
const MAX_INLINE_SCHEMA_LENGTH = 6000

/**
 * 認証をサブスクのログインに寄せるため、子プロセスからAPIキー系の環境変数を外す。
 * これらが設定されていると Claude Code はサブスクではなくAPI課金で動くため。
 */
const STRIPPED_ENV = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX']

interface ClaudeJsonResult {
  type?: string
  subtype?: string
  is_error?: boolean
  result?: unknown
  structured_output?: unknown
}

export class ClaudeCodeProvider implements LlmProvider {
  readonly id = 'claude-code' as const
  readonly label = LABEL

  constructor(
    private readonly getSettings: () => AppSettings,
    private readonly workDirectory: string,
    private readonly baseEnv: NodeJS.ProcessEnv = process.env
  ) {}

  private config(): AppSettings['ai']['providers']['claude-code'] {
    return this.getSettings().ai.providers['claude-code']
  }

  private async executable(): Promise<string | null> {
    return resolveExecutable('claude', this.config().executablePath, this.baseEnv)
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
        env: this.childEnv(),
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

  listModels(): Promise<ModelInfo[]> {
    const custom = this.config().customModels.map<ModelInfo>((id) => ({ id, label: id, source: 'custom' }))
    return Promise.resolve([...CLAUDE_MODELS, ...custom])
  }

  async generate(model: string, request: GenerateRequest, signal?: AbortSignal): Promise<GenerateResult> {
    if (!isSafeModelId(model)) {
      throw new AppError('INVALID_ARGUMENT', `モデルIDに使えない文字が含まれています: ${model}`)
    }
    const executablePath = await this.executable()
    if (!executablePath) throw new AppError('CLI_NOT_FOUND', 'Claude Code(claude コマンド)が見つかりません')

    const schemaText = request.jsonSchema ? JSON.stringify(request.jsonSchema) : null
    const useNativeSchema = schemaText !== null && schemaText.length <= MAX_INLINE_SCHEMA_LENGTH
    const system =
      request.jsonSchema && !useNativeSchema
        ? `${request.system}\n\n${jsonInstruction(request.jsonSchema)}`
        : request.system

    const systemFile = join(this.workDirectory, `system-${randomBytes(6).toString('hex')}.txt`)
    await writeFile(systemFile, system, 'utf8')

    const args = [
      '-p',
      '--output-format',
      'json',
      '--model',
      model,
      '--system-prompt-file',
      systemFile,
      // 台本生成にファイル操作やシェルは不要。ツールを全て外して純粋な文章生成にする。
      '--tools',
      '',
      // --tools は MCP のツールには効かないため、別途すべて拒否する。
      '--disallowedTools',
      'mcp__*',
      '--no-session-persistence',
      // ユーザーのフック・CLAUDE.md・MCP 等を読み込まない。認証とモデル選択は通常どおり動く。
      '--safe-mode',
      '--permission-prompts',
      'none'
    ]
    if (useNativeSchema && schemaText) args.push('--json-schema', schemaText)

    const started = Date.now()
    let run
    try {
      run = await runProcess({
        command: executablePath,
        args,
        cwd: this.workDirectory,
        env: this.childEnv(),
        input: turnsToPrompt(request.turns),
        timeoutMs: this.config().timeoutMs,
        ...(signal ? { signal } : {})
      })
    } catch (error) {
      throw spawnFailure(LABEL, error)
    } finally {
      await rm(systemFile, { force: true })
    }
    if (run.aborted) throw new AppError('CANCELLED', '生成を中止しました')

    const parsed = parseClaudeOutput(run.stdout)
    if (run.exitCode !== 0 || parsed === null || parsed.is_error === true) {
      const summary = parsed && typeof parsed.result === 'string' ? parsed.result : run.stdout
      throw cliFailure(LABEL, run, summary)
    }

    const text = typeof parsed.result === 'string' ? parsed.result : ''
    const result: GenerateResult = {
      text,
      generatedBy: { providerId: this.id, model, at: new Date().toISOString() },
      durationMs: Date.now() - started
    }
    if (request.jsonSchema) {
      result.structured = parsed.structured_output ?? parseStructuredFallback(text)
    }
    return result
  }

  private childEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...this.baseEnv }
    for (const key of STRIPPED_ENV) delete env[key]
    return env
  }
}

/** --output-format json の出力は通常1つのJSONだが、前後に警告行が混ざる場合に備えて最後の行から探す。 */
export function parseClaudeOutput(stdout: string): ClaudeJsonResult | null {
  const lines = stdout.trim().split(/\r?\n/).reverse()
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('{')) continue
    try {
      const value = JSON.parse(trimmed) as unknown
      if (typeof value === 'object' && value !== null) return value as ClaudeJsonResult
    } catch {
      continue
    }
  }
  try {
    return JSON.parse(stdout) as ClaudeJsonResult
  } catch {
    return null
  }
}

function parseStructuredFallback(text: string): unknown {
  try {
    return extractJson(text)
  } catch {
    return undefined
  }
}
