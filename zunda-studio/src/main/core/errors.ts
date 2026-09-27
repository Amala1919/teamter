import type { AppErrorShape, ErrorCode } from '@shared/errors'

export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly detail?: string
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export function toErrorShape(error: unknown): AppErrorShape {
  if (error instanceof AppError) {
    return error.detail === undefined
      ? { code: error.code, message: error.message }
      : { code: error.code, message: error.message, detail: error.detail }
  }
  if (error instanceof Error) {
    return { code: 'INTERNAL', message: error.message, detail: error.stack ?? '' }
  }
  return { code: 'INTERNAL', message: String(error) }
}
