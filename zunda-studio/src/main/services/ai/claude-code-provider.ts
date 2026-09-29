import { randomBytes } from 'node:crypto'
import { rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  isSafeModelId,
  type AiImage,
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
 * サブスクで選べるモデルの一覧。Claude Code にはモデル一覧を返すコマンドが無いため内蔵する。
 * プランによって使えないモデルもあり、選べても実行時に断られることがある(接続テストで確かめられる)。
 * エイリアスは Claude Code 側で常に最新版を指すので、おすすめはエイリアスにする。
 */
export const CLAUDE_MODELS: ModelInfo[] = [
  { id: 'sonnet', label: 'Sonnet(最新)', source: 'static', recommended: true, note: '速さと質のバランスが良い。迷ったらこれ' },
  { id: 'opus', label: 'Opus(最新)', source: 'static', recommended: true, note: '文章の質を優先するとき。編集AI向き' },
  { id: 'haiku', label: 'Haiku(最新)', source: 'static', recommended: true, note: '速さ優先。ライブ向き' },
  { id: 'fable', label: 'Fable(最新)', source: 'static', note: '最上位。プランによっては使用量クレジットが要り、無いと断られる(接続テストで確かめられる)' },
  { id: 'claude-fable-5-1', label: 'Claude Fable 5.1', source: 'static' },
  { id: 'claude-fable-5', label: 'Claude Fable 5', source: 'static' },
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', source: 'static' },
  { id: 'claude-opus-5', label: 'Claude Opus 5', source: 'static' },
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8', source: 'static' },
  { id: 'claude-opus-4-7', label: 'Claude Opus 4.7', source: 'static' },
  { id: 'claude-opus-4-6', label: 'Claude Opus 4.6', source: 'static' },
  { id: 'claude-opus-4-5', label: 'Claude Opus 4.5', source: 'static' },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', source: 'static' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', source: 'static' },
  { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5', source: 'static' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', source: 'static' },
  { id: 'claude-sonnet-4-0', label: 'Claude Sonnet 4(旧)', source: 'static' },
  { id: 'claude-opus-4-0', label: 'Claude Opus 4(旧)', source: 'static' }
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

    // 画像を添えるときは、画像を送れる stream-json で入出力する(文字だけのときは今まで通り)。
    const images = request.images ?? []
    const streaming = images.length > 0
    const args = [
      '-p',
      ...(streaming ? ['--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose'] : ['--output-format', 'json']),
      '--model',
      model,
      '--system-prompt-file',
      systemFile,
      // 台本生成にファイル操作やシェルは不要。ツールを全て外して純粋な文章生成にする。
      // 事実の確かめ(webSearch)のときだけ、読むだけのウェブ検索・取得を許す。
      '--tools',
      request.webSearch ? 'WebSearch,WebFetch' : '',
      ...(request.webSearch ? ['--allowedTools', 'WebSearch,WebFetch'] : []),
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
        input: streaming ? streamJsonInput(turnsToPrompt(request.turns), images) : turnsToPrompt(request.turns),
        timeoutMs: Math.max(this.config().timeoutMs, request.timeoutMs ?? 0),
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
    if (request.webSearch) result.webSearch = true
    return result
  }

  private childEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...this.baseEnv }
    for (const key of STRIPPED_ENV) delete env[key]
    return env
  }
}

/**
 * 画像つきの依頼を、stream-json の入力(利用者の発話1つ)にする。
 * 画像ごとに説明の文を前に置き、最後に依頼の本文を置く。
 */
export function streamJsonInput(prompt: string, images: readonly AiImage[]): string {
  const content: unknown[] = []
  for (const image of images) {
    content.push({ type: 'text', text: image.caption })
    content.push({ type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } })
  }
  content.push({ type: 'text', text: prompt })
  return JSON.stringify({ type: 'user', message: { role: 'user', content } }) + '\n'
}

/**
 * 出力から結果を取り出す。--output-format json は通常1つの JSON、stream-json は1行1イベントで、
 * 結果は type が result の行。前後に警告行や別のイベントが混ざる場合に備えて、最後の行から探す。
 */
export function parseClaudeOutput(stdout: string): ClaudeJsonResult | null {
  const lines = stdout.trim().split(/\r?\n/).reverse()
  let fallback: ClaudeJsonResult | null = null
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('{')) continue
    try {
      const value = JSON.parse(trimmed) as unknown
      if (typeof value !== 'object' || value === null) continue
      if ((value as ClaudeJsonResult).type === 'result') return value as ClaudeJsonResult
      fallback ??= value as ClaudeJsonResult
    } catch {
      continue
    }
  }
  if (fallback) return fallback
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
