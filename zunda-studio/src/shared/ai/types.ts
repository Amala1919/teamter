/**
 * AIプロバイダに関する型。仕様は docs/ARCHITECTURE.md の 2.8 を参照。
 */

export const PROVIDER_IDS = ['claude-code', 'opencode'] as const
export type ProviderId = (typeof PROVIDER_IDS)[number]

/** 会話AI: 相方のセリフとライブの会話。編集AI: 編集チャット・推敲・下書き・投稿文。 */
export const AI_ROLES = ['conversation', 'editor'] as const
export type AiRole = (typeof AI_ROLES)[number]

export const AI_ROLE_LABELS: Record<AiRole, string> = {
  conversation: '会話AI(相方)',
  editor: '編集AI'
}

export interface ModelRef {
  providerId: ProviderId
  model: string
}

/** 生成物に添える生成元の記録。 */
export interface GeneratedBy extends ModelRef {
  at: string
}

export interface ModelInfo {
  id: string
  label: string
  /** 一覧の取得元。static は内蔵の候補、cli はCLIから取得した実際の一覧。 */
  source: 'static' | 'cli' | 'custom'
  note?: string
  /** 画面の「おすすめ」に並べるもの。 */
  recommended?: boolean
}

export type ProviderState =
  | { kind: 'ready'; version: string }
  | { kind: 'not-installed' }
  /** APIキーで接続する設定だが、キーがまだ入っていない。 */
  | { kind: 'needs-key' }
  | { kind: 'error'; message: string }

export interface ProviderStatus {
  providerId: ProviderId
  label: string
  executablePath: string | null
  state: ProviderState
}

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

export interface GenerateRequest {
  system: string
  /** 最後の要素がこれから答えるべき発話。 */
  turns: ChatTurn[]
  /** 指定すると構造化出力を求める。検証は呼び出し側で必ず行う。 */
  jsonSchema?: Record<string, unknown>
}

export interface GenerateResult {
  text: string
  /** jsonSchema を指定したときの解釈済みの値(未検証)。 */
  structured?: unknown
  generatedBy: GeneratedBy
  durationMs: number
}

const MODEL_ID_PATTERN = /^[A-Za-z0-9._:/@[\]-]{1,200}$/

/** CLIの引数に渡すため、モデルIDに使える文字を制限する。 */
export function isSafeModelId(model: string): boolean {
  return MODEL_ID_PATTERN.test(model)
}

export function formatModelRef(ref: ModelRef): string {
  const provider = ref.providerId === 'claude-code' ? 'Claude' : 'OpenCode'
  return `${provider} / ${ref.model}`
}
