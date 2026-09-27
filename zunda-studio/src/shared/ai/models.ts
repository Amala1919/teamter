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

/**
 * おすすめの印を付ける。preferPrefix を渡すと、その前置き(opencode-go/ など)のモデルがあればそちらから選ぶ。
 */
export function markRecommended(models: ModelInfo[], rules: RecommendRule[], preferPrefix?: string): ModelInfo[] {
  const chosen = new Map<string, string | undefined>()
  for (const rule of rules) {
    const matches = models.filter((model) => model.source !== 'custom' && rule.pattern.test(baseName(model.id)))
    const preferred = preferPrefix ? matches.filter((model) => model.id.startsWith(preferPrefix)) : []
    const pool = preferred.length > 0 ? preferred : matches
    const newest = [...pool].sort((a, b) => byVersion(baseName(a.id), baseName(b.id))).at(-1)?.id
    if (newest !== undefined && !chosen.has(newest)) chosen.set(newest, rule.note)
  }
  return models.map((model) => {
    if (!chosen.has(model.id)) return model
    const note = chosen.get(model.id)
    return { ...model, recommended: true, ...(note && !model.note ? { note } : {}) }
  })
}

export interface ModelGroup {
  label: string
  models: ModelInfo[]
}

/** 見出しの無いモデルをまとめる見出し。 */
export const OTHER_MODELS_LABEL = 'その他のモデル'

/**
 * おすすめを先に、残りは見出し(group)ごとにまとめる。見出しは一覧に出てきた順、中は名前順。
 * 手入力したモデルは最後。
 */
export function groupModels(models: ModelInfo[]): { recommended: ModelInfo[]; groups: ModelGroup[] } {
  const recommended = models.filter((model) => model.recommended === true)
  const groups = new Map<string, ModelInfo[]>()
  for (const model of models) {
    if (model.recommended === true) continue
    const label = model.group ?? OTHER_MODELS_LABEL
    groups.set(label, [...(groups.get(label) ?? []), model])
  }
  const ordered = [...groups.entries()]
    .map(([label, list]) => ({
      label,
      models: [...list].sort((a, b) => Number(a.source === 'custom') - Number(b.source === 'custom') || byVersion(a.label, b.label))
    }))
    .sort((a, b) => Number(a.models.every((m) => m.source === 'custom')) - Number(b.models.every((m) => m.source === 'custom')))
  return { recommended, groups: ordered }
}
