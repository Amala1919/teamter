import type { ModelInfo } from './types'

/**
 * モデル一覧のうち「おすすめ」に出すものを決める。
 * 系列(kimi・glm など)ごとに、一覧の中でいちばん新しい版を1つだけ勧める。
 * 版が上がって名前が変わっても、決まった ID を書き換えずに済むようにするため。
 */
export interface RecommendRule {
  /** 系列を見分ける。provider/ の後ろの名前に当てる。 */
  pattern: RegExp
  note?: string
}

/** OpenCode Go で勧める系列。台本の掛け合いと編集指示の両方をこなせるもの。 */
export const OPENCODE_RECOMMENDED: RecommendRule[] = [
  { pattern: /^kimi-k\d[\d.]*$/i, note: '会話・台本向き' },
  { pattern: /^glm-\d[\d.]*$/i, note: 'バランス型' },
  { pattern: /^deepseek-v[\d.]+-pro$/i, note: '編集・下書き向き' },
  { pattern: /^qwen[\d.]+-max$/i, note: '指示に忠実' }
]

function baseName(id: string): string {
  const slash = id.indexOf('/')
  return slash >= 0 ? id.slice(slash + 1) : id
}

const byVersion = (a: string, b: string): number => a.localeCompare(b, 'en', { numeric: true })

export function markRecommended(models: ModelInfo[], rules: RecommendRule[]): ModelInfo[] {
  const chosen = new Map<string, string | undefined>()
  for (const rule of rules) {
    const matches = models.filter((model) => model.source !== 'custom' && rule.pattern.test(baseName(model.id)))
    const newest = matches.map((model) => model.id).sort(byVersion).at(-1)
    if (newest !== undefined && !chosen.has(newest)) chosen.set(newest, rule.note)
  }
  return models.map((model) => {
    if (!chosen.has(model.id)) return model
    const note = chosen.get(model.id)
    return { ...model, recommended: true, ...(note && !model.note ? { note } : {}) }
  })
}

/** おすすめを先に、残りは名前順に並べて2つに分ける(一覧に無い手入力のモデルは最後)。 */
export function groupModels(models: ModelInfo[]): { recommended: ModelInfo[]; others: ModelInfo[] } {
  const recommended = models.filter((model) => model.recommended === true)
  const others = models
    .filter((model) => model.recommended !== true)
    .sort((a, b) => (a.source === 'custom' ? 1 : 0) - (b.source === 'custom' ? 1 : 0) || byVersion(a.id, b.id))
  return { recommended, others }
}
