import { ERROR_GUIDANCE, isErrorCode, type ErrorCode } from '@shared/errors'
import type {
  AppEvents,
  Channel,
  ChannelArgs,
  ChannelResult,
  EventEnvelope,
  EventName,
  IpcResult,
  ZundaBridge
} from '@shared/ipc/contract'

/** main から返ったエラー。code で次に何をすべきかを案内する。 */
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly detail?: string
  ) {
    super(message)
    this.name = 'AppError'
  }

  get guidance(): string {
    return ERROR_GUIDANCE[this.code]
  }
}

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error
  if (error instanceof Error) return new AppError('INTERNAL', error.message)
  return new AppError('INTERNAL', String(error))
}

/** テスト用ホストで動いているとき、window.zunda の代わりに使う HTTP 版の橋渡し。 */
function createHttpBridge(origin: string): ZundaBridge {
  const listeners = new Set<(envelope: EventEnvelope) => void>()
  let source: EventSource | null = null
  const ensureSource = (): void => {
    if (source) return
    source = new EventSource(`${origin}/events`)
    source.onmessage = (message) => {
      const envelope = JSON.parse(String(message.data)) as EventEnvelope
      for (const listener of listeners) listener(envelope)
    }
  }
  return {
    runtime: 'devhost',
    invoke: async (channel, args) => {
      const response = await fetch(`${origin}/ipc/${encodeURIComponent(channel)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ args })
      })
      return (await response.json()) as IpcResult<unknown>
    },
    subscribe: (listener) => {
      ensureSource()
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    mediaUrl: (absolutePath) => `${origin}/media?path=${encodeURIComponent(absolutePath)}`
  }
}

const bridge: ZundaBridge = window.zunda ?? createHttpBridge(window.location.origin)

export const api = {
  runtime: bridge.runtime,

  async invoke<C extends Channel>(channel: C, ...args: ChannelArgs<C>): Promise<ChannelResult<C>> {
    const result = (await bridge.invoke(channel, args)) as IpcResult<ChannelResult<C>>
    if (result.ok) return result.value
    const code = isErrorCode(result.error.code) ? result.error.code : 'INTERNAL'
    throw new AppError(code, result.error.message, result.error.detail)
  },

  subscribe<E extends EventName>(event: E, listener: (payload: AppEvents[E]) => void): () => void {
    return bridge.subscribe((envelope) => {
      if (envelope.type === event) listener(envelope.payload as AppEvents[E])
    })
  },

  mediaUrl(absolutePath: string): string {
    return bridge.mediaUrl(absolutePath)
  }
}
