import OBSWebSocket from 'obs-websocket-js'

/**
 * OBS との接続(obs-websocket 5)。録画の開始・終了と経過時間を受け取り、会話の記録と録画の時刻を対応付ける。
 * テストでは同じ形の偽物に差し替える。
 */
export interface ObsConnection {
  recordStatus(): Promise<{ active: boolean; durationMs: number }>
  onRecordState(listener: (event: { active: boolean; state: string; outputPath: string | null }) => void): void
  onClose(listener: () => void): void
  disconnect(): Promise<void>
}

export type ObsConnector = (url: string, password: string) => Promise<ObsConnection>

export const connectObs: ObsConnector = async (url, password) => {
  const obs = new OBSWebSocket()
  await obs.connect(url, password === '' ? undefined : password)
  return {
    recordStatus: async () => {
      const status = await obs.call('GetRecordStatus')
      return { active: status.outputActive, durationMs: status.outputDuration }
    },
    onRecordState: (listener) => {
      obs.on('RecordStateChanged', (event) =>
        listener({ active: event.outputActive, state: event.outputState, outputPath: event.outputPath ?? null })
      )
    },
    onClose: (listener) => {
      obs.on('ConnectionClosed', listener)
    },
    disconnect: () => obs.disconnect()
  }
}
