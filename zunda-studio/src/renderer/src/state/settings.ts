import { create } from 'zustand'

import type { ModelInfo, ProviderId, ProviderStatus } from '@shared/ai/types'
import type { AppSettings, SettingsPatch } from '@shared/settings/schema'
import type { SecretName, SecretStatus } from '@shared/settings/secrets'

import { api } from '../api'

interface SettingsState {
  settings: AppSettings | null
  providers: ProviderStatus[]
  models: Partial<Record<ProviderId, ModelInfo[]>>
  modelsLoading: Partial<Record<ProviderId, boolean>>
  secrets: SecretStatus[]

  load: () => Promise<void>
  loadSecrets: () => Promise<void>
  /** APIキーなどを入れる(null で消す)。キーが変わるとモデル一覧も変わるので読み直す。 */
  setSecret: (name: SecretName, value: string | null) => Promise<SecretStatus>
  update: (patch: SettingsPatch) => Promise<void>
  refreshProviders: () => Promise<void>
  loadModels: (providerId: ProviderId, force?: boolean) => Promise<ModelInfo[]>
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: null,
  providers: [],
  models: {},
  modelsLoading: {},
  secrets: [],

  loadSecrets: async () => {
    set({ secrets: await api.invoke('secrets:status') })
  },

  setSecret: async (name, value) => {
    const status = await api.invoke('secrets:set', name, value)
    set({ secrets: [...get().secrets.filter((item) => item.name !== name), status], models: {} })
    await get().refreshProviders()
    return status
  },

  load: async () => {
    const settings = await api.invoke('settings:get')
    set({ settings })
  },

  update: async (patch) => {
    const settings = await api.invoke('settings:update', patch)
    // CLIの場所や一覧の絞り込みが変わると、プロバイダの状態とモデル一覧も変わりうる。
    set({ settings, models: {} })
  },

  refreshProviders: async () => {
    const providers = await api.invoke('ai:providers')
    set({ providers })
  },

  loadModels: async (providerId, force = false) => {
    const cached = get().models[providerId]
    if (cached && !force) return cached
    set({ modelsLoading: { ...get().modelsLoading, [providerId]: true } })
    try {
      const models = await api.invoke('ai:models', providerId)
      set({ models: { ...get().models, [providerId]: models } })
      return models
    } finally {
      set({ modelsLoading: { ...get().modelsLoading, [providerId]: false } })
    }
  }
}))

// main 側で設定が変わったら(別ウィンドウからの変更を含め)追随する。
api.subscribe('settings:changed', (settings) => useSettingsStore.setState({ settings }))
