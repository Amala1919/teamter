import { create } from 'zustand'

import type { EngineInstallInfo, EngineInstallState } from '@shared/voice/types'

import { api } from '../api'

interface EngineInstallStore {
  info: EngineInstallInfo | null
  refresh: () => Promise<void>
  /** 公式の VOICEVOX ENGINE を入れて起動する。進み具合は info.state に届く。 */
  install: () => Promise<void>
  cancel: () => Promise<void>
}

export const useEngineInstallStore = create<EngineInstallStore>((set, get) => ({
  info: null,
  refresh: async () => {
    set({ info: await api.invoke('voice:install:info') })
  },
  install: async () => {
    try {
      await api.invoke('voice:install:start')
    } finally {
      await get().refresh()
    }
  },
  cancel: async () => {
    await api.invoke('voice:install:cancel')
  }
}))

api.subscribe('voice:install-progress', (state: EngineInstallState) => {
  const info = useEngineInstallStore.getState().info
  useEngineInstallStore.setState({
    info: info ? { ...info, state } : { supported: true, target: null, installed: null, state }
  })
})

export const INSTALLING_PHASES: EngineInstallState['phase'][] = ['checking', 'downloading', 'extracting', 'starting']

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}
