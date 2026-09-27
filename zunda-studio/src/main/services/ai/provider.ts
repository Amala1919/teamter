import type {
  ChatTurn,
  GenerateRequest,
  GenerateResult,
  ModelInfo,
  ProviderId,
  ProviderStatus
} from '@shared/ai/types'

/**
 * AIプロバイダの共通インターフェース。docs/ARCHITECTURE.md の 2.8 を参照。
 * 新しい接続方式(APIキー、ローカルLLM等)はこのインターフェースを実装して登録するだけで足りる。
 */
export interface LlmProvider {
  readonly id: ProviderId
  readonly label: string
  status: () => Promise<ProviderStatus>
  listModels: () => Promise<ModelInfo[]>
  generate: (model: string, request: GenerateRequest, signal?: AbortSignal) => Promise<GenerateResult>
}

/**
 * CLIは1回の呼び出しに1つのプロンプトしか受け取らないため、会話を1つの文章にまとめる。
 * 最後の発話がこれから答えるべきものであることを明示する。
 */
export function turnsToPrompt(turns: readonly ChatTurn[]): string {
  if (turns.length === 0) return ''
  if (turns.length === 1) return turns[0]!.content
  const history = turns
    .slice(0, -1)
    .map((turn) => `[${turn.role === 'user' ? 'ユーザー' : 'あなた'}]\n${turn.content}`)
    .join('\n\n')
  const last = turns[turns.length - 1]!
  return `これまでのやりとり:\n\n${history}\n\n---\n\n今回の依頼:\n\n${last.content}`
}

/** スキーマを守ったJSONだけを返させるための指示。CLIがスキーマ強制を持たない場合に使う。 */
export function jsonInstruction(schema: Record<string, unknown>): string {
  return [
    '出力は次のJSONスキーマに適合するJSONオブジェクト1つだけにしてください。',
    '説明文、前置き、コードブロックの囲み(```)は付けないでください。',
    '',
    JSON.stringify(schema)
  ].join('\n')
}
