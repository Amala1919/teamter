/**
 * OpenCode Go / OpenCode Zen で使えるモデルの一覧(内蔵の控え)。
 * 元は models.dev(https://github.com/sst/models.dev の providers/opencode-go・providers/opencode、2026-09-27 時点)。
 * 提供終了予定(deprecated)のものは除いている。
 *
 * API キーがまだ無いときや一覧を取れないときにもモデルを選べるようにするほか、
 * モデルごとに API の形式(chat/completions・messages・responses・Gemini)を決めるのに使う。
 * 実際に使えるモデルは API の /models から取り、そちらを優先して合わせて出す。
 */

/** OpenCode の API の形式。 */
export type OpenCodeApiFormat = 'chat' | 'messages' | 'responses' | 'gemini'

export interface OpenCodeCatalogEntry {
  /** opencode コマンドと同じ ID(opencode-go/… は Go、opencode/… は Zen)。 */
  id: string
  name: string
  format: OpenCodeApiFormat
  /** 無料で使えるもの。 */
  free?: boolean
}

export const OPENCODE_CATALOG: readonly OpenCodeCatalogEntry[] = [
  { id: 'opencode-go/deepseek-v4-flash-vision-exp', name: 'DeepSeek V4 Flash Vision Exp', format: 'chat' },
  { id: 'opencode-go/deepseek-v4-flash', name: 'DeepSeek V4 Flash', format: 'chat' },
  { id: 'opencode-go/deepseek-v4-pro', name: 'DeepSeek V4 Pro (New)', format: 'chat' },
  { id: 'opencode-go/deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', format: 'chat' },
  { id: 'opencode-go/glm-5.1', name: 'GLM-5.1', format: 'chat' },
  { id: 'opencode-go/glm-5.2', name: 'GLM-5.2', format: 'chat' },
  { id: 'opencode-go/glm-5.3-flash', name: 'GLM-5.3-Flash', format: 'chat' },
  { id: 'opencode-go/glm-5.3', name: 'GLM-5.3', format: 'chat' },
  { id: 'opencode-go/gpt-5.6-luna', name: 'GPT-5.6 Luna', format: 'responses' },
  { id: 'opencode-go/gpt-6-luna', name: 'GPT-6 Luna', format: 'responses' },
  { id: 'opencode-go/grok-4.6', name: 'Grok 4.6', format: 'responses' },
  { id: 'opencode-go/grok-4.7', name: 'Grok 4.7', format: 'responses' },
  { id: 'opencode-go/hy3', name: 'Hy3', format: 'chat' },
  { id: 'opencode-go/hy4-preview', name: 'Hy4 preview', format: 'chat' },
  { id: 'opencode-go/kimi-k2.6', name: 'Kimi K2.6', format: 'chat' },
  { id: 'opencode-go/kimi-k2.7-code', name: 'Kimi K2.7 Code', format: 'chat' },
  { id: 'opencode-go/kimi-k3', name: 'Kimi K3', format: 'chat' },
  { id: 'opencode-go/longcat-2.0', name: 'LongCat-2.0', format: 'chat' },
  { id: 'opencode-go/longcat-2.5-preview-free', name: 'LongCat 2.5 Preview Free', format: 'chat', free: true },
  { id: 'opencode-go/mimo-v2.5-pro', name: 'MiMo V2.5 Pro', format: 'chat' },
  { id: 'opencode-go/mimo-v2.5', name: 'MiMo V2.5', format: 'chat' },
  { id: 'opencode-go/mimo-v2.6-flash', name: 'MiMo-V2.6-Flash', format: 'chat' },
  { id: 'opencode-go/mimo-v2.6-pro', name: 'MiMo-V2.6-Pro', format: 'chat' },
  { id: 'opencode-go/minimax-m2.7', name: 'MiniMax-M2.7', format: 'messages' },
  { id: 'opencode-go/minimax-m3', name: 'MiniMax-M3', format: 'messages' },
  { id: 'opencode-go/muse-spark-1.2-contributor', name: 'Muse Spark 1.2 Contributor', format: 'responses' },
  { id: 'opencode-go/muse-spark-1.3-contributor', name: 'Muse Spark 1.3 Contributor', format: 'responses' },
  { id: 'opencode-go/qwen3.6-plus', name: 'Qwen3.6 Plus', format: 'chat' },
  { id: 'opencode-go/qwen3.7-max', name: 'Qwen3.7 Max', format: 'chat' },
  { id: 'opencode-go/qwen3.7-plus', name: 'Qwen3.7 Plus', format: 'chat' },
  { id: 'opencode-go/qwen3.8-flash', name: 'Qwen3.8 Flash', format: 'messages' },
  { id: 'opencode-go/qwen3.8-max', name: 'Qwen3.8 Max', format: 'chat' },
  { id: 'opencode-go/space-bunny-free', name: 'Space Bunny Free', format: 'chat', free: true },
  { id: 'opencode/big-pickle', name: 'Big Pickle', format: 'chat', free: true },
  { id: 'opencode/claude-fable-5-1', name: 'Claude Fable 5.1', format: 'messages' },
  { id: 'opencode/claude-fable-5', name: 'Claude Fable 5', format: 'messages' },
  { id: 'opencode/claude-haiku-4-5', name: 'Claude Haiku 4.5', format: 'messages' },
  { id: 'opencode/claude-opus-4-5', name: 'Claude Opus 4.5', format: 'messages' },
  { id: 'opencode/claude-opus-4-6', name: 'Claude Opus 4.6', format: 'messages' },
  { id: 'opencode/claude-opus-4-7', name: 'Claude Opus 4.7', format: 'messages' },
  { id: 'opencode/claude-opus-4-8', name: 'Claude Opus 4.8', format: 'messages' },
  { id: 'opencode/claude-opus-5-5', name: 'Claude Opus 5.5', format: 'messages' },
  { id: 'opencode/claude-opus-5', name: 'Claude Opus 5', format: 'messages' },
  { id: 'opencode/claude-sonnet-4-5', name: 'Claude Sonnet 4.5', format: 'messages' },
  { id: 'opencode/claude-sonnet-4-6', name: 'Claude Sonnet 4.6', format: 'messages' },
  { id: 'opencode/claude-sonnet-4', name: 'Claude Sonnet 4', format: 'messages' },
  { id: 'opencode/claude-sonnet-5', name: 'Claude Sonnet 5', format: 'messages' },
  { id: 'opencode/deepseek-v4-flash-vision-exp', name: 'DeepSeek V4 Flash Vision Exp', format: 'chat' },
  { id: 'opencode/deepseek-v4-flash', name: 'DeepSeek V4 Flash', format: 'chat' },
  { id: 'opencode/deepseek-v4-pro', name: 'DeepSeek V4 Pro', format: 'chat' },
  { id: 'opencode/deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', format: 'chat' },
  { id: 'opencode/gemini-3-flash', name: 'Gemini 3 Flash', format: 'gemini' },
  { id: 'opencode/gemini-3.1-pro', name: 'Gemini 3.1 Pro Preview', format: 'gemini' },
  { id: 'opencode/gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash Lite', format: 'gemini' },
  { id: 'opencode/gemini-3.5-flash', name: 'Gemini 3.5 Flash', format: 'gemini' },
  { id: 'opencode/gemini-3.6-flash', name: 'Gemini 3.6 Flash', format: 'gemini' },
  { id: 'opencode/gemini-3.7-flash', name: 'Gemini 3.7 Flash', format: 'gemini' },
  { id: 'opencode/gemini-3.8-flash', name: 'Gemini 3.8 Flash', format: 'gemini' },
  { id: 'opencode/glm-5.1', name: 'GLM-5.1', format: 'chat' },
  { id: 'opencode/glm-5.2', name: 'GLM-5.2', format: 'chat' },
  { id: 'opencode/glm-5.3-flash', name: 'GLM-5.3-Flash', format: 'chat' },
  { id: 'opencode/glm-5.3', name: 'GLM-5.3', format: 'chat' },
  { id: 'opencode/glm-5', name: 'GLM-5', format: 'chat' },
  { id: 'opencode/gpt-5-codex', name: 'GPT-5 Codex', format: 'responses' },
  { id: 'opencode/gpt-5-nano', name: 'GPT-5 Nano', format: 'responses' },
  { id: 'opencode/gpt-5.1-codex-max', name: 'GPT-5.1 Codex Max', format: 'responses' },
  { id: 'opencode/gpt-5.1-codex-mini', name: 'GPT-5.1 Codex Mini', format: 'responses' },
  { id: 'opencode/gpt-5.1-codex', name: 'GPT-5.1 Codex', format: 'responses' },
  { id: 'opencode/gpt-5.1', name: 'GPT-5.1', format: 'responses' },
  { id: 'opencode/gpt-5.2-codex', name: 'GPT-5.2 Codex', format: 'responses' },
  { id: 'opencode/gpt-5.2', name: 'GPT-5.2', format: 'responses' },
  { id: 'opencode/gpt-5.3-codex-spark', name: 'GPT-5.3 Codex Spark', format: 'responses' },
  { id: 'opencode/gpt-5.3-codex', name: 'GPT-5.3 Codex', format: 'responses' },
  { id: 'opencode/gpt-5.4-mini', name: 'GPT-5.4 Mini', format: 'responses' },
  { id: 'opencode/gpt-5.4-nano', name: 'GPT-5.4 Nano', format: 'responses' },
  { id: 'opencode/gpt-5.4-pro', name: 'GPT-5.4 Pro', format: 'responses' },
  { id: 'opencode/gpt-5.4', name: 'GPT-5.4', format: 'responses' },
  { id: 'opencode/gpt-5.5-pro', name: 'GPT-5.5 Pro', format: 'responses' },
  { id: 'opencode/gpt-5.5', name: 'GPT-5.5', format: 'responses' },
  { id: 'opencode/gpt-5.6-luna', name: 'GPT-5.6 Luna', format: 'responses' },
  { id: 'opencode/gpt-5.6-sol', name: 'GPT-5.6 Sol', format: 'responses' },
  { id: 'opencode/gpt-5.6-terra', name: 'GPT-5.6 Terra', format: 'responses' },
  { id: 'opencode/gpt-5', name: 'GPT-5', format: 'responses' },
  { id: 'opencode/gpt-6-astra', name: 'GPT-6 Astra', format: 'responses' },
  { id: 'opencode/gpt-6-luna', name: 'GPT-6 Luna', format: 'responses' },
  { id: 'opencode/gpt-6-sol', name: 'GPT-6 Sol', format: 'responses' },
  { id: 'opencode/grok-4.5', name: 'Grok 4.5', format: 'responses' },
  { id: 'opencode/grok-4.6', name: 'Grok 4.6', format: 'responses' },
  { id: 'opencode/grok-4.7', name: 'Grok 4.7 (30% Off)', format: 'responses' },
  { id: 'opencode/grok-build-0.1', name: 'Grok Build 0.1', format: 'responses' },
  { id: 'opencode/jev-1.13-free', name: 'Jev 1.13 Free', format: 'chat', free: true },
  { id: 'opencode/jev-1.13', name: 'Jev 1.13', format: 'chat' },
  { id: 'opencode/kimi-k2.5', name: 'Kimi K2.5', format: 'chat' },
  { id: 'opencode/kimi-k2.6', name: 'Kimi K2.6', format: 'chat' },
  { id: 'opencode/kimi-k2.7-code', name: 'Kimi K2.7 Code', format: 'chat' },
  { id: 'opencode/kimi-k3', name: 'Kimi K3', format: 'chat' },
  { id: 'opencode/ling-3.0-flash-fin-free', name: 'Ling 3.0 Flash Fin Free', format: 'chat', free: true },
  { id: 'opencode/longcat-2.5-preview-free', name: 'LongCat 2.5 Preview Free', format: 'chat', free: true },
  { id: 'opencode/mimo-v2.6-flash-free', name: 'MiMo-V2.6-Flash Free', format: 'chat', free: true },
  { id: 'opencode/minimax-m2.5', name: 'MiniMax-M2.5', format: 'chat' },
  { id: 'opencode/minimax-m2.7', name: 'MiniMax-M2.7', format: 'chat' },
  { id: 'opencode/minimax-m3', name: 'MiniMax-M3', format: 'chat' },
  { id: 'opencode/muse-spark-1.2', name: 'Muse Spark 1.2', format: 'responses' },
  { id: 'opencode/muse-spark-1.3-contributor-free', name: 'Muse Spark 1.3 Free', format: 'responses', free: true },
  { id: 'opencode/muse-spark-1.3', name: 'Muse Spark 1.3', format: 'responses' },
  { id: 'opencode/nemotron-3-ultra-free', name: 'Nemotron 3 Ultra Free', format: 'chat', free: true },
  { id: 'opencode/nemotron-3.5-lightning-free', name: 'Nemotron 3.5 Lightning Free', format: 'chat', free: true },
  { id: 'opencode/qwen3.5-plus', name: 'Qwen3.5 Plus', format: 'messages' },
  { id: 'opencode/qwen3.6-plus', name: 'Qwen3.6 Plus', format: 'messages' },
  { id: 'opencode/qwen3.8-flash', name: 'Qwen3.8 Flash', format: 'messages' },
  { id: 'opencode/qwen3.8-max', name: 'Qwen3.8 Max', format: 'chat' },
  { id: 'opencode/space-bunny-free', name: 'Space Bunny Free', format: 'chat', free: true }
]

const BY_ID = new Map(OPENCODE_CATALOG.map((entry) => [entry.id, entry]))

export function catalogEntry(id: string): OpenCodeCatalogEntry | undefined {
  return BY_ID.get(id)
}

/** ID の前置き(opencode-go / opencode)から、どのプランのモデルか。 */
export function opencodePlan(id: string): 'go' | 'zen' | 'other' {
  if (id.startsWith('opencode-go/')) return 'go'
  if (id.startsWith('opencode/')) return 'zen'
  return 'other'
}
