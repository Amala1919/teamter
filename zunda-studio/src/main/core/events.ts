import type { AppEvents, EventEnvelope, EventName } from '@shared/ipc/contract'

type Listener = (envelope: EventEnvelope) => void

/**
 * main からレンダラへの通知を配る。送り先(Electron のウィンドウ、テスト用ホストの SSE)は
 * それぞれのアダプタが listen して転送する。サービスは送り先を知らない。
 */
export class EventBus {
  private readonly listeners = new Set<Listener>()

  emit<E extends EventName>(type: E, payload: AppEvents[E]): void {
    const envelope = { type, payload } as EventEnvelope
    for (const listener of this.listeners) listener(envelope)
  }

  listen(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}
