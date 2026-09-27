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

export function classifyCliFailure(text: string): ErrorCode {
  if (RATE_LIMIT_PATTERNS.some((pattern) => pattern.test(text))) return 'AI_RATE_LIMITED'
  if (LOGIN_PATTERNS.some((pattern) => pattern.test(text))) return 'AI_NOT_LOGGED_IN'
  return 'CLI_FAILED'
}

const MESSAGES: Record<string, string> = {
  AI_RATE_LIMITED: 'AIの利用上限に達しました',
  AI_NOT_LOGGED_IN: 'AIのCLIにログインしていません',
  CLI_FAILED: 'AIのCLIがエラーで終了しました'
}

/** CLIの失敗を、利用者が次に何をすればよいか分かるエラーに変換する。 */
export function cliFailure(label: string, run: RunResult, summary: string): AppError {
  if (run.timedOut) {
    return new AppError('CLI_FAILED', `${label} が時間内に応答しませんでした`, tail(run.stderr || run.stdout))
  }
  const evidence = `${summary}\n${run.stderr}`
  const code = classifyCliFailure(evidence)
  return new AppError(code, `${label}: ${MESSAGES[code] ?? 'エラーが発生しました'}`, tail(evidence))
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
