import { contextBridge, ipcRenderer } from 'electron'

import type { EventEnvelope, IpcResult, ZundaBridge } from '@shared/ipc/contract'

// preload は main のモジュールを読み込めないため、チャネル名とスキームをここにも書く。
const INVOKE_CHANNEL = 'zs:invoke'
const EVENT_CHANNEL = 'zs:event'
const MEDIA_SCHEME = 'zs-media'

const bridge: ZundaBridge = {
  runtime: 'electron',
  invoke: (channel: string, args: unknown[]) =>
    ipcRenderer.invoke(INVOKE_CHANNEL, channel, args) as Promise<IpcResult<unknown>>,
  subscribe: (listener: (envelope: EventEnvelope) => void) => {
    const handler = (_: unknown, envelope: EventEnvelope): void => listener(envelope)
    ipcRenderer.on(EVENT_CHANNEL, handler)
    return () => {
      ipcRenderer.off(EVENT_CHANNEL, handler)
    }
  },
  mediaUrl: (absolutePath: string) => `${MEDIA_SCHEME}://file/${encodeURIComponent(absolutePath)}`
}

contextBridge.exposeInMainWorld('zunda', bridge)
