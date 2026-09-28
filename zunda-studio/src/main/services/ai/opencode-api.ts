import type { AiImage, ChatTurn, GenerateRequest } from '@shared/ai/types'
import { catalogEntry, opencodePlan, type OpenCodeApiFormat } from '@shared/ai/opencode-catalog'
import { OPENCODE_GO_BASE_URL, OPENCODE_ZEN_BASE_URL } from '@shared/settings/schema'

import { normalizeApiKey } from '@shared/settings/secrets'

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

/**
 * 形式ごとの、キーを渡すヘッダー。OpenCode のサーバーは形式ごとに決まったヘッダーからしかキーを読まない
 * (messages は x-api-key、Gemini は x-goog-api-key、それ以外は Authorization)。
 */
export function authHeaders(format: ApiFormat | 'list', apiKey: string): Record<string, string> {
  switch (format) {
    case 'messages':
      return { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
    case 'gemini':
      return { 'x-goog-api-key': apiKey }
    default:
      return { authorization: `Bearer ${apiKey}` }
  }
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
    const response = await this.request(options, '/models', 'list', { method: 'GET' })
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
      const response = await this.request(target, formatPath(format, name), format, {
        method: 'POST',
        body: JSON.stringify(buildBody(format, name, request.system, request.turns, request.images ?? [])),
        ...(signal ? { signal } : {})
      }, true)
      if (response.ok) {
        const text = extractText(format, await response.json())
        if (text.trim() === '') throw new AppError('CLI_FAILED', `OpenCode: ${name} から空の応答が返りました`)
        this.learned.set(model, format)
        return text
      }
      const detail = await response.text().catch(() => '')
      lastError = httpFailure(response.status, detail, model)
      // 形式違いで断られたときだけ、別の形式で試す。キーや上限の問題は試し直しても変わらない。
      if (!isFormatRejection(response.status, detail)) throw lastError
    }
    throw lastError ?? new AppError('CLI_FAILED', `OpenCode: ${name} を呼び出せませんでした`)
  }

  private async request(
    options: Omit<OpenCodeApiOptions, 'fetch'>,
    path: string,
    format: ApiFormat | 'list',
    init: RequestInit,
    allowFailure = false
  ): Promise<Response> {
    const apiKey = normalizeApiKey(options.apiKey)
    if (apiKey === '') {
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
          // エラーの文を日本語で返してもらう。
          'accept-language': 'ja',
          'user-agent': 'zunda-studio',
          ...authHeaders(format, apiKey)
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

/**
 * 形式ごとの本文。画像は最後の発話(利用者)に、説明の文と一緒に添える。
 */
export function buildBody(format: ApiFormat, model: string, system: string, turns: readonly ChatTurn[], images: readonly AiImage[] = []): Record<string, unknown> {
  const last = turns.length - 1
  const dataUrl = (image: AiImage): string => `data:${image.mediaType};base64,${image.data}`
  switch (format) {
    case 'chat':
      return {
        model,
        messages: [
          { role: 'system', content: system },
          ...turns.map((turn, index) =>
            index === last && images.length > 0
              ? {
                  role: turn.role,
                  content: [
                    ...images.flatMap((image) => [
                      { type: 'text', text: image.caption },
                      { type: 'image_url', image_url: { url: dataUrl(image) } }
                    ]),
                    { type: 'text', text: turn.content }
                  ]
                }
              : { role: turn.role, content: turn.content }
          )
        ],
        stream: false
      }
    case 'messages':
      return {
        model,
        system,
        messages: turns.map((turn, index) =>
          index === last && images.length > 0
            ? {
                role: turn.role,
                content: [
                  ...images.flatMap((image) => [
                    { type: 'text', text: image.caption },
                    { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } }
                  ]),
                  { type: 'text', text: turn.content }
                ]
              }
            : { role: turn.role, content: turn.content }
        ),
        max_tokens: 8192,
        stream: false
      }
    case 'responses':
      return {
        model,
        instructions: system,
        input: turns.map((turn, index) =>
          index === last && images.length > 0
            ? {
                role: turn.role,
                content: [
                  ...images.flatMap((image) => [
                    { type: 'input_text', text: image.caption },
                    { type: 'input_image', image_url: dataUrl(image) }
                  ]),
                  { type: 'input_text', text: turn.content }
                ]
              }
            : { role: turn.role, content: turn.content }
        ),
        stream: false
      }
    case 'gemini':
      return {
        systemInstruction: { parts: [{ text: system }] },
        contents: turns.map((turn, index) => ({
          role: turn.role === 'assistant' ? 'model' : 'user',
          parts:
            index === last && images.length > 0
              ? [...images.flatMap((image) => [{ text: image.caption }, { inline_data: { mime_type: image.mediaType, data: image.data } }]), { text: turn.content }]
              : [{ text: turn.content }]
        }))
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

/** OpenCode のサーバーが返すエラーの形: { type: "error", error: { type, message } }。 */
export interface GatewayError {
  type: string
  message: string
}

export function parseGatewayError(detail: string): GatewayError | null {
  try {
    const body = JSON.parse(detail) as { error?: unknown; message?: unknown }
    const error = body.error
    if (error && typeof error === 'object') {
      const typed = error as { type?: unknown; message?: unknown }
      if (typeof typed.message === 'string') return { type: typeof typed.type === 'string' ? typed.type : '', message: typed.message }
    }
    if (typeof error === 'string') return { type: '', message: error }
    if (typeof body.message === 'string') return { type: '', message: body.message }
  } catch {
    // JSON でなければ文そのものを使う
  }
  const text = detail.trim()
  return text === '' ? null : { type: '', message: text.slice(0, 300) }
}

const FORMAT_MISMATCH = /endpoint|not supported for format|フォーマット|unsupported format|use the .* (api|endpoint)|unknown (url|route)/i

function isFormatRejection(status: number, detail: string): boolean {
  if (status === 404 || status === 405 || status === 415) return true
  const error = parseGatewayError(detail)
  // 「このモデルはこの形式では使えない」は、別の形式なら通ることがある。
  if (error?.type === 'ModelError') return /not supported for format|フォーマット/i.test(error.message)
  if (status === 400 || status === 422 || status === 501 || status === 503) return FORMAT_MISMATCH.test(detail)
  return false
}

/** キーそのものが間違っている・無いときの文。 */
const INVALID_KEY = /invalid api key|missing api key|無効なAPIキー|APIキーがありません|unauthorized|incorrect api key/i

/**
 * サーバーの応答をエラーにする。OpenCode は「残高不足」「プランに無いモデル」「データ利用への同意が必要」なども
 * 401/403 で返すので、状態コードだけでキーの誤りと決めつけず、中身の種類で分ける。サーバーの文は必ず見せる。
 */
export function httpFailure(status: number, detail: string, model?: string): AppError {
  const summary = detail.trim().slice(0, 2000)
  const error = parseGatewayError(detail)
  const said = error ? `: ${error.message}` : ''
  const type = error?.type ?? ''
  if (/RateLimit|UsageLimit/.test(type)) return new AppError('AI_RATE_LIMITED', `OpenCode: AIの利用上限に達しました${said}`, summary)
  if (type === 'CreditsError') {
    // Go のモデルでこうなるのは、キーのアカウントに Go の契約が無く、残高払いにも回せなかったとき。
    const advice =
      model !== undefined && opencodePlan(model) === 'go'
        ? 'OpenCode Go を契約しているアカウント(ワークスペース)で発行したキーか確かめてください'
        : 'OpenCode Go の契約だけなら「OpenCode Go(月額プラン)」のモデルを選んでください'
    return new AppError('AI_MODEL_UNAVAILABLE', `OpenCode: 残高か支払い方法が必要です${said}。${advice}`, summary)
  }
  if (type === 'ModelError' || type === 'RegionError' || type === 'DataPolicyError' || type === 'MonthlyLimitError' || type === 'UserLimitError') {
    return new AppError('AI_MODEL_UNAVAILABLE', `OpenCode: このモデルは今は使えません${said}`, summary)
  }
  if (type === 'AuthError' && !INVALID_KEY.test(error?.message ?? '')) {
    return new AppError('AI_MODEL_UNAVAILABLE', `OpenCode: このモデルは今は使えません${said}`, summary)
  }
  if (status === 429 || classifyCliFailure(summary) === 'AI_RATE_LIMITED') {
    return new AppError('AI_RATE_LIMITED', `OpenCode: AIの利用上限に達しました${said}`, summary)
  }
  if (status === 401 || status === 403) {
    return new AppError('AI_KEY_REQUIRED', `OpenCode: API キーが受け付けられませんでした${said}`, summary)
  }
  return new AppError('CLI_FAILED', `OpenCode がエラーを返しました(${status})${said}`, summary)
}
