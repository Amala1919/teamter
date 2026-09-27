import { z } from 'zod'

import type {
  AiRole,
  GenerateRequest,
  GenerateResult,
  ModelInfo,
  ModelRef,
  ProviderId,
  ProviderStatus
} from '@shared/ai/types'
import { AI_ROLE_LABELS } from '@shared/ai/types'
import type { AppSettings } from '@shared/settings/schema'

import { AppError } from '../../core/errors'
import type { LlmProvider } from './provider'

export interface ResolveOptions {
  /** その呼び出しだけ使うモデル(再生成時に別のAIで試す場合など)。 */
  explicit?: ModelRef | null
  /** プロジェクトの会話AI設定。会話AIの役割にのみ効く。 */
  projectConversation?: ModelRef | null
}

export interface StructuredResult<T> {
  value: T
  result: GenerateResult
}

/**
 * 役割(会話AI / 編集AI)からモデルを決め、プロバイダを呼び出す。
 * 決め方は「明示指定 → プロジェクトの会話AI → アプリの既定値」の順(ARCHITECTURE.md 2.8)。
 */
export class AiService {
  private readonly providers = new Map<ProviderId, LlmProvider>()

  constructor(private readonly getSettings: () => AppSettings) {}

  register(provider: LlmProvider): void {
    this.providers.set(provider.id, provider)
  }

  provider(id: ProviderId): LlmProvider {
    const provider = this.providers.get(id)
    if (!provider) throw new AppError('AI_NOT_CONFIGURED', `未対応のAIプロバイダです: ${id}`)
    return provider
  }

  resolve(role: AiRole, options: ResolveOptions = {}): ModelRef {
    const chosen =
      options.explicit ??
      (role === 'conversation' ? options.projectConversation : null) ??
      this.getSettings().ai.roles[role]
    if (!chosen) {
      throw new AppError('AI_NOT_CONFIGURED', `${AI_ROLE_LABELS[role]}が選ばれていません`)
    }
    return chosen
  }

  async statuses(): Promise<ProviderStatus[]> {
    return Promise.all([...this.providers.values()].map((provider) => provider.status()))
  }

  async models(providerId: ProviderId): Promise<ModelInfo[]> {
    return this.provider(providerId).listModels()
  }

  async generate(
    role: AiRole,
    request: GenerateRequest,
    options: ResolveOptions = {},
    signal?: AbortSignal
  ): Promise<GenerateResult> {
    const ref = this.resolve(role, options)
    return this.provider(ref.providerId).generate(ref.model, request, signal)
  }

  /**
   * スキーマに適合する出力を求める。CLI側の強制に頼らず必ずここで検証し、
   * 失敗したら何が違ったかを伝えて1回だけやり直させる。
   */
  async generateStructured<T>(
    role: AiRole,
    request: Omit<GenerateRequest, 'jsonSchema'>,
    schema: z.ZodType<T>,
    options: ResolveOptions = {},
    signal?: AbortSignal
  ): Promise<StructuredResult<T>> {
    const jsonSchema = z.toJSONSchema(schema, { target: 'draft-7' }) as Record<string, unknown>
    const first = await this.generate(role, { ...request, jsonSchema }, options, signal)
    const firstCheck = schema.safeParse(first.structured)
    if (firstCheck.success) return { value: firstCheck.data, result: first }

    const feedback = describeIssues(first.structured, firstCheck.error)
    const retryTurns = [
      ...request.turns,
      { role: 'assistant' as const, content: first.text },
      {
        role: 'user' as const,
        content: `直前の出力は指定の形式に合っていませんでした。\n${feedback}\n形式に合うJSONだけを出力し直してください。`
      }
    ]
    const second = await this.generate(role, { ...request, turns: retryTurns, jsonSchema }, options, signal)
    const secondCheck = schema.safeParse(second.structured)
    if (secondCheck.success) return { value: secondCheck.data, result: second }

    throw new AppError(
      'AI_OUTPUT_INVALID',
      'AIの応答が指定の形式になりませんでした',
      `${describeIssues(second.structured, secondCheck.error)}\n\n--- 応答 ---\n${second.text.slice(0, 2000)}`
    )
  }
}

function describeIssues(value: unknown, error: z.ZodError): string {
  if (value === undefined) return 'JSONとして読み取れませんでした。'
  return error.issues
    .slice(0, 8)
    .map((issue) => `- ${issue.path.join('.') || '(全体)'}: ${issue.message}`)
    .join('\n')
}
