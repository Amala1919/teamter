import type { ErrorCode } from '@shared/errors'

import { AppError } from '../../core/errors'
import type { RunResult } from '../../core/process'

const LOGIN_PATTERNS = [
  /not logged in/i,
  /please (run )?\/?login/i,
  /authenticat/i,
  /unauthori[sz]ed/i,
  /invalid api key/i,
  /\b401\b/,
  /ProviderAuthError/i,
  /no credentials/i,
  /oauth/i
]

const RATE_LIMIT_PATTERNS = [
  /rate.?limit/i,
  /usage limit/i,
  /limit (has been )?reached/i,
  /quota/i,
  /\b429\b/,
  /too many requests/i,
  /overloaded/i
]

/**
 * API(従量課金)の残高が足りない。サブスクではなく Console のアカウント(API キー)で
 * ログインしているときに出る(サブスクなら出ない)。
 */
const CREDIT_PATTERNS = [/credit balance (is )?too low/i, /insufficient (credit|balance|funds)/i]

/** 選んだモデルが今のプラン・契約では使えない(Fable の使用量クレジットなど)。 */
const MODEL_UNAVAILABLE_PATTERNS = [
  /requires? (usage )?credits/i,
  /switch to (another|a different) model/i,
  /model[^\n]{0,40}(not (found|available|supported)|does not exist|is unavailable)/i,
  /(invalid|unknown) model/i,
  /not available (on|for|with) your (plan|account|subscription)/i,
  /(do(es)? not|don't) have access to/i
]

/** CLI が古く、渡したオプションを知らない。 */
const OUTDATED_PATTERNS = [/unknown option/i, /unrecognized (option|argument)/i, /error: unknown/i, /invalid option/i]

export function classifyCliFailure(text: string): ErrorCode {
  if (CREDIT_PATTERNS.some((pattern) => pattern.test(text))) return 'AI_CREDIT_LOW'
  if (RATE_LIMIT_PATTERNS.some((pattern) => pattern.test(text))) return 'AI_RATE_LIMITED'
  if (MODEL_UNAVAILABLE_PATTERNS.some((pattern) => pattern.test(text))) return 'AI_MODEL_UNAVAILABLE'
  if (LOGIN_PATTERNS.some((pattern) => pattern.test(text))) return 'AI_NOT_LOGGED_IN'
  if (OUTDATED_PATTERNS.some((pattern) => pattern.test(text))) return 'CLI_OUTDATED'
  return 'CLI_FAILED'
}

const MESSAGES: Record<string, string> = {
  AI_RATE_LIMITED: 'AIの利用上限に達しました',
  AI_CREDIT_LOW: 'API(従量課金)の残高が足りません',
  AI_MODEL_UNAVAILABLE: '選んだモデルは今のプラン・契約では使えません',
  AI_NOT_LOGGED_IN: 'AIのCLIにログインしていません',
  CLI_OUTDATED: 'CLIが古く、必要な機能に対応していません',
  CLI_FAILED: 'AIのCLIがエラーで終了しました'
}

/**
 * CLIの失敗を、利用者が次に何をすればよいか分かるエラーに変換する。
 * CLI が言った理由(1行目)もメッセージに入れる(詳細を開かなくても原因が分かるように)。
 */
export function cliFailure(label: string, run: RunResult, summary: string): AppError {
  if (run.timedOut) {
    return new AppError('CLI_FAILED', `${label} が時間内に応答しませんでした`, tail(run.stderr || run.stdout))
  }
  const evidence = `${summary}\n${run.stderr}`
  const code = classifyCliFailure(evidence)
  const reason = firstReason(summary) ?? firstReason(run.stderr)
  const message = `${label}: ${MESSAGES[code] ?? 'エラーが発生しました'}${reason ? `(CLI の出力: ${reason})` : ''}`
  return new AppError(code, message, tail(evidence))
}

/** 出力のうち、理由として見せる1行(JSON の行や空行は飛ばす)。長ければ切り詰める。 */
export function firstReason(text: string): string | null {
  const line = text
    .split(/\r?\n/)
    .map((candidate) => candidate.trim())
    .find((candidate) => candidate !== '' && !candidate.startsWith('{') && !candidate.startsWith('['))
  if (!line) return null
  return line.length > 200 ? `${line.slice(0, 200)}…` : line
}

export function spawnFailure(label: string, error: unknown): AppError {
  const code = (error as NodeJS.ErrnoException).code
  if (code === 'ENOENT' || code === 'EACCES') {
    return new AppError('CLI_NOT_FOUND', `${label} を起動できません`, String(error))
  }
  return new AppError('CLI_FAILED', `${label} の起動に失敗しました`, String(error))
}

function tail(text: string, maxLength = 4000): string {
  const trimmed = text.trim()
  return trimmed.length <= maxLength ? trimmed : '…' + trimmed.slice(-maxLength)
}
