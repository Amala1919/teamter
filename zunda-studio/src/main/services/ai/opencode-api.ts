import type { ChatTurn, GenerateRequest } from '@shared/ai/types'
import { catalogEntry, opencodePlan, type OpenCodeApiFormat } from '@shared/ai/opencode-catalog'
import { OPENCODE_GO_BASE_URL, OPENCODE_ZEN_BASE_URL } from '@shared/settings/schema'

import { AppError } from '../../core/errors'
import { classifyCliFailure } from './cli-errors'

/**
 * OpenCode Go / Zen の API を、APIキーで直接呼ぶ。
 * モデルによって受け付ける形式(OpenAI の chat/completions・responses、Anthropic の messages、Gemini)が違う。
 * 内蔵の一覧(opencode-catalog.ts)に載っていればその形式を、無ければ名前から見当をつけ、断られたら別の形式で試し直す。
 */

export type ApiFormat = OpenCodeApiFormat

const FORMAT_HINTS: { pattern: RegExp; format: ApiFormat }[] = [
  { pattern: /^gemini/i, format: 'gemini' },
  { pattern: /^(gpt|grok|muse|o\d)/i, format: 'responses' },
  { pattern: /^(minimax|qwen|claude)/i, format: 'messages' }
]

const FALLBACK_ORDER: ApiFormat[] = ['chat', 'messages', 'responses']

/** 試す順の形式。内蔵の一覧か名前から決めたものを先頭にする。model は「opencode-go/kimi-k3」の形でも名前だけでもよい。 */
export function formatsFor(model: string): ApiFormat[] {
  const name = apiModelName(model)
  const preferred = catalogEntry(model)?.format ?? FORMAT_HINTS.find((hint) => hint.pattern.test(name))?.format ?? 'chat'
  return [preferred, ...FALLBACK_ORDER.filter((format) => format !== preferred)]
}

/** モデルIDの前に付ける名前(opencode コマンドと同じ ID にそろえる)。 */
export function modelPrefix(baseUrl: string): string {
  return /\/zen\/go(\/|$)/.test(baseUrl) ? 'opencode-go' : 'opencode'
}

function sameUrl(a: string, b: string): boolean {
  return a.replace(/\/+$/, '') === b.replace(/\/+$/, '')
}

/** 公式の接続先(Go・Zen)を使っているか。独自の接続先なら全てそこへ送る。 */
export function usesOfficialEndpoints(baseUrl: string): boolean {
  return sameUrl(baseUrl, OPENCODE_GO_BASE_URL) || sameUrl(baseUrl, OPENCODE_ZEN_BASE_URL)
}

/** モデルを送る接続先。公式なら ID の前置きで Go と Zen を分ける(1つのキーで両方使える)。 */
export function baseUrlFor(model: string, configured: string): string {
  if (!usesOfficialEndpoints(configured)) return configured
  const plan = opencodePlan(model)
  if (plan === 'go') return OPENCODE_GO_BASE_URL
  if (plan === 'zen') return OPENCODE_ZEN_BASE_URL
  return configured
}

/** 「opencode-go/kimi-k3」のような ID から、API に渡す名前を取り出す。 */
export function apiModelName(model: string): string {
  const slash = model.indexOf('/')
  return slash >= 0 ? model.slice(slash + 1) : model
}

function formatPath(format: ApiFormat, name: string): string {
  switch (format) {
    case 'chat':
      return '/chat/completions'
    case 'messages':
      return '/messages'
    case 'responses':
      return '/responses'
    case 'gemini':
      return `/models/${encodeURIComponent(name)}:generateContent`
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export interface OpenCodeApiOptions {
  baseUrl: string
  apiKey: string
  timeoutMs: number
  fetch?: FetchLike
}

export class OpenCodeApi {
  /** 通った形式を覚えておき、次からはそれを先に使う。 */
  private readonly learned = new Map<string, ApiFormat>()

  constructor(private readonly fetchImpl: FetchLike = (input, init) => fetch(input, init)) {}

  async listModels(options: Omit<OpenCodeApiOptions, 'fetch'>): Promise<string[]> {
    const response = await this.request(options, '/models', { method: 'GET' })
    const body = (await response.json()) as { data?: { id?: unknown }[] }
    const prefix = modelPrefix(options.baseUrl)
    return (body.data ?? [])
      .map((entry) => entry.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
      .map((id) => (id.includes('/') ? id : `${prefix}/${id}`))
  }

  async generate(
    options: Omit<OpenCodeApiOptions, 'fetch'>,
    model: string,
    request: GenerateRequest & { system: string },
    signal?: AbortSignal
  ): Promise<string> {
    const name = apiModelName(model)
    const target = { ...options, baseUrl: baseUrlFor(model, options.baseUrl) }
    const learned = this.learned.get(model)
    const formats = learned ? [learned, ...formatsFor(model).filter((format) => format !== learned)] : formatsFor(model)
    let lastError: AppError | null = null
    for (const format of formats) {
      const response = await this.request(target, formatPath(format, name), {
        method: 'POST',
        body: JSON.stringify(buildBody(format, name, request.system, request.turns)),
        ...(signal ? { signal } : {})
      }, true)
      if (response.ok) {
        const text = extractText(format, await response.json())
        if (text.trim() === '') throw new AppError('CLI_FAILED', `OpenCode: ${name} から空の応答が返りました`)
        this.learned.set(model, format)
        return text
      }
      const detail = await response.text().catch(() => '')
      lastError = httpFailure(response.status, detail)
      // 形式違いで断られたときだけ、別の形式で試す。キーや上限の問題は試し直しても変わらない。
      if (!isFormatRejection(response.status, detail)) throw lastError
    }
    throw lastError ?? new AppError('CLI_FAILED', `OpenCode: ${name} を呼び出せませんでした`)
  }

  private async request(
    options: Omit<OpenCodeApiOptions, 'fetch'>,
    path: string,
    init: RequestInit,
    allowFailure = false
  ): Promise<Response> {
    if (options.apiKey.trim() === '') {
      throw new AppError('AI_KEY_REQUIRED', 'OpenCode の API キーが入力されていません')
    }
    const timeout = AbortSignal.timeout(options.timeoutMs)
    const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout
    let response: Response
    try {
      response = await this.fetchImpl(`${options.baseUrl.replace(/\/+$/, '')}${path}`, {
        ...init,
        signal,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${options.apiKey}`,
          // messages 形式(Anthropic 互換)と Gemini 形式は、それぞれこちらのヘッダーでキーを受け取る。
          'x-api-key': options.apiKey,
          'x-goog-api-key': options.apiKey,
          'anthropic-version': '2023-06-01'
        }
      })
    } catch (error) {
      if (init.signal?.aborted) throw new AppError('CANCELLED', '生成を中止しました')
      if (timeout.aborted) throw new AppError('CLI_FAILED', 'OpenCode が時間内に応答しませんでした')
      throw new AppError('CLI_FAILED', 'OpenCode に接続できません。ネットにつながっているか確かめてください', String(error))
    }
    if (!response.ok && !allowFailure) throw httpFailure(response.status, await response.text().catch(() => ''))
    return response
  }
}

function buildBody(format: ApiFormat, model: string, system: string, turns: readonly ChatTurn[]): Record<string, unknown> {
  const messages = turns.map((turn) => ({ role: turn.role, content: turn.content }))
  switch (format) {
    case 'chat':
      return { model, messages: [{ role: 'system', content: system }, ...messages], stream: false }
    case 'messages':
      return { model, system, messages, max_tokens: 8192, stream: false }
    case 'responses':
      return { model, instructions: system, input: messages, stream: false }
    case 'gemini':
      return {
        systemInstruction: { parts: [{ text: system }] },
        contents: turns.map((turn) => ({ role: turn.role === 'assistant' ? 'model' : 'user', parts: [{ text: turn.content }] }))
      }
  }
}

interface ChatBody {
  choices?: { message?: { content?: unknown } }[]
}
interface MessagesBody {
  content?: { type?: string; text?: unknown }[]
}
interface GeminiBody {
  candidates?: { content?: { parts?: { text?: unknown; thought?: unknown }[] } }[]
}
interface ResponsesBody {
  output_text?: unknown
  output?: { type?: string; content?: { type?: string; text?: unknown }[] }[]
}

export function extractText(format: ApiFormat, body: unknown): string {
  switch (format) {
    case 'chat': {
      const content = (body as ChatBody).choices?.[0]?.message?.content
      if (typeof content === 'string') return content
      if (Array.isArray(content)) {
        return content.map((part: { text?: unknown }) => (typeof part.text === 'string' ? part.text : '')).join('')
      }
      return ''
    }
    case 'messages':
      return ((body as MessagesBody).content ?? [])
        .filter((part) => part.type === 'text' && typeof part.text === 'string')
        .map((part) => part.text as string)
        .join('')
    case 'responses': {
      const typed = body as ResponsesBody
      if (typeof typed.output_text === 'string') return typed.output_text
      return (typed.output ?? [])
        .filter((item) => item.type === 'message')
        .flatMap((item) => item.content ?? [])
        .filter((part) => part.type === 'output_text' && typeof part.text === 'string')
        .map((part) => part.text as string)
        .join('')
    }
    case 'gemini':
      return ((body as GeminiBody).candidates?.[0]?.content?.parts ?? [])
        .filter((part) => typeof part.text === 'string' && part.thought !== true)
        .map((part) => part.text as string)
        .join('')
  }
}

function isFormatRejection(status: number, detail: string): boolean {
  if (status === 404 || status === 405 || status === 415) return true
  if (status === 400 || status === 422 || status === 501 || status === 503) {
    return /endpoint|not supported|unsupported|format|unknown (url|route)|use the .* (api|endpoint)/i.test(detail)
  }
  return false
}

export function httpFailure(status: number, detail: string): AppError {
  const summary = detail.trim().slice(0, 2000)
  if (status === 401 || status === 403) {
    return new AppError('AI_KEY_REQUIRED', 'OpenCode の API キーが正しくないか、使えない状態です', summary)
  }
  if (status === 429 || classifyCliFailure(summary) === 'AI_RATE_LIMITED') {
    return new AppError('AI_RATE_LIMITED', 'OpenCode: AIの利用上限に達しました', summary)
  }
  return new AppError('CLI_FAILED', `OpenCode がエラーを返しました(${status})`, summary)
}
