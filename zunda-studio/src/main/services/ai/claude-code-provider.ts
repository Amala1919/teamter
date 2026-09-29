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

  private readonly unsupported = new Map<string, Set<Feature>>()

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

    const unsupported = this.unsupportedFor(executablePath)
    const started = Date.now()
    // 古い CLI が知らないオプションで断ったら、そのオプションを覚えて代わりのやり方にし、すぐにやり直す
    // (断られるのは引数を読む段階なので一瞬で済む)。知らないオプションの数だけ繰り返す。
    for (let attempt = 0; ; attempt++) {
      const plan = buildInvocation(model, request, unsupported)
      const systemFile = plan.systemInFile ? join(this.workDirectory, `system-${randomBytes(6).toString('hex')}.txt`) : null
      if (systemFile) await writeFile(systemFile, plan.system, 'utf8')
      const args = systemFile ? [...plan.args, '--system-prompt-file', systemFile] : plan.args
      let run
      try {
        run = await runProcess({
          command: executablePath,
          args,
          cwd: this.workDirectory,
          env: this.childEnv(),
          input: plan.input,
          timeoutMs: Math.max(this.config().timeoutMs, request.timeoutMs ?? 0),
          ...(signal ? { signal } : {})
        })
      } catch (error) {
        throw spawnFailure(LABEL, error)
      } finally {
        if (systemFile) await rm(systemFile, { force: true })
      }
      if (run.aborted) throw new AppError('CANCELLED', '生成を中止しました')

      const parsed = parseClaudeOutput(run.stdout)
      if (run.exitCode !== 0 || parsed === null || parsed.is_error === true) {
        const feature = run.exitCode !== 0 ? unknownFeature(`${run.stderr}\n${run.stdout}`) : null
        if (feature && !unsupported.has(feature) && attempt < FEATURES.length) {
          unsupported.add(feature)
          continue
        }
        const summary = parsed && typeof parsed.result === 'string' ? parsed.result : run.stdout
        throw cliFailure(LABEL, run, summary)
      }
      return this.toResult(model, request, parsed, plan, started)
    }
  }

  /** 実行ファイルごとの、使えないと分かったオプション(CLI を入れ替えれば別の実行ファイルとして覚え直す)。 */
  private unsupportedFor(executablePath: string): Set<Feature> {
    let known = this.unsupported.get(executablePath)
    if (!known) {
      known = new Set()
      this.unsupported.set(executablePath, known)
    }
    return known
  }

  private toResult(model: string, request: GenerateRequest, parsed: ClaudeJsonResult, plan: Invocation, started: number): GenerateResult {
    const text = typeof parsed.result === 'string' ? parsed.result : ''
    const result: GenerateResult = {
      text,
      generatedBy: { providerId: this.id, model, at: new Date().toISOString() },
      durationMs: Date.now() - started
    }
    // 画像を送れない古い CLI では、画像を外して文字だけで作った
    if (plan.imagesDropped) result.imagesDropped = true
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
 * 新しい CLI にだけあるオプション。古い CLI が知らなければ、代わりのやり方にする。
 * - safeMode: 利用者のフック・CLAUDE.md・MCP 等を読み込まない → 設定の読み込み元を空にし、MCP を使わない
 * - permissionPrompts: 許可の確認を誰にも出さない → ツールを外しているので無くても確認は出ない
 * - noSessionPersistence: 会話を保存しない → 無くても動く(履歴が残るだけ)
 * - systemPromptFile: システムプロンプトをファイルで渡す → 依頼の本文の前に書く
 * - tools: 使えるツールを絞る → 組み込みのツールを名前で拒否する
 * - jsonSchema: 構造化出力 → システムプロンプトで JSON を指示する
 * - streamInput: 画像を送る(stream-json の入力) → 画像を外して文字だけで頼む
 * - settingSources / strictMcp: safeMode の代わりに使うもの(これも無ければ外す)
 */
const FEATURES = [
  'safeMode',
  'permissionPrompts',
  'noSessionPersistence',
  'systemPromptFile',
  'tools',
  'jsonSchema',
  'streamInput',
  'settingSources',
  'strictMcp'
] as const
export type Feature = (typeof FEATURES)[number]

const FEATURE_OPTIONS: Record<string, Feature> = {
  '--safe-mode': 'safeMode',
  '--permission-prompts': 'permissionPrompts',
  '--no-session-persistence': 'noSessionPersistence',
  '--system-prompt-file': 'systemPromptFile',
  '--tools': 'tools',
  '--json-schema': 'jsonSchema',
  '--input-format': 'streamInput',
  '--setting-sources': 'settingSources',
  '--strict-mcp-config': 'strictMcp'
}

/** --tools が無い CLI で拒否する組み込みのツール(文章を作るだけなので、どれも要らない)。 */
const BUILTIN_TOOLS = ['Bash', 'Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'Read', 'Glob', 'Grep', 'LS', 'Task', 'TodoWrite', 'WebFetch', 'WebSearch']

/** CLI の「知らないオプション」のエラーから、どの機能が使えないかを読み取る。 */
export function unknownFeature(output: string): Feature | null {
  const match = /unknown option ['"`]?(--[a-z0-9-]+)/i.exec(output) ?? /unrecognized (?:option|argument)s?:? ['"`]?(--[a-z0-9-]+)/i.exec(output)
  return match ? (FEATURE_OPTIONS[match[1]!.toLowerCase()] ?? null) : null
}

export interface Invocation {
  args: string[]
  input: string
  system: string
  /** システムプロンプトを --system-prompt-file で渡すか(呼び出し側が一時ファイルを作る)。 */
  systemInFile: boolean
  imagesDropped: boolean
}

/** CLI の引数と標準入力を組み立てる。unsupported は、その CLI が知らないと分かったオプション。 */
export function buildInvocation(model: string, request: GenerateRequest, unsupported: ReadonlySet<Feature>): Invocation {
  const can = (feature: Feature): boolean => !unsupported.has(feature)
  const schemaText = request.jsonSchema ? JSON.stringify(request.jsonSchema) : null
  const useNativeSchema = schemaText !== null && schemaText.length <= MAX_INLINE_SCHEMA_LENGTH && can('jsonSchema')
  const system = request.jsonSchema && !useNativeSchema ? `${request.system}\n\n${jsonInstruction(request.jsonSchema)}` : request.system

  // 画像を添えるときは、画像を送れる stream-json で入出力する(文字だけのときは今まで通り)。
  const requested = request.images ?? []
  const streaming = requested.length > 0 && can('streamInput')
  const prompt = turnsToPrompt(request.turns)
  // --system-prompt-file が無い CLI では、指示を本文の前に書く。
  const body = can('systemPromptFile') ? prompt : `## 指示(必ず従うこと)\n${system}\n\n## 依頼\n${prompt}`

  const web = request.webSearch === true
  const args = [
    '-p',
    ...(streaming ? ['--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose'] : ['--output-format', 'json']),
    '--model',
    model
  ]
  // 台本生成にファイル操作やシェルは不要。ツールを全て外して純粋な文章生成にする。
  // 事実の確かめ(webSearch)のときだけ、読むだけのウェブ検索・取得を許す。
  if (can('tools')) {
    args.push('--tools', web ? 'WebSearch,WebFetch' : '')
    if (web) args.push('--allowedTools', 'WebSearch,WebFetch')
    // --tools は MCP のツールには効かないため、別途すべて拒否する。
    args.push('--disallowedTools', 'mcp__*')
  } else {
    if (web) args.push('--allowedTools', 'WebSearch,WebFetch')
    const denied = BUILTIN_TOOLS.filter((tool) => !(web && (tool === 'WebSearch' || tool === 'WebFetch')))
    args.push('--disallowedTools', [...denied, 'mcp__*'].join(','))
  }
  if (can('noSessionPersistence')) args.push('--no-session-persistence')
  // ユーザーのフック・CLAUDE.md・MCP 等を読み込まない。認証とモデル選択は通常どおり動く。
  if (can('safeMode')) {
    args.push('--safe-mode')
  } else {
    if (can('settingSources')) args.push('--setting-sources', '')
    if (can('strictMcp')) args.push('--strict-mcp-config')
  }
  if (can('permissionPrompts')) args.push('--permission-prompts', 'none')
  if (useNativeSchema && schemaText) args.push('--json-schema', schemaText)

  return {
    args,
    input: streaming ? streamJsonInput(body, requested) : body,
    system,
    systemInFile: can('systemPromptFile'),
    imagesDropped: requested.length > 0 && !streaming
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
