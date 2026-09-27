import { readFile } from 'node:fs/promises'

import {
  applySettingsPatch,
  defaultSettings,
  parseSettings,
  type AppSettings,
  type SettingsPatch
} from '@shared/settings/schema'

import { AppError } from './errors'
import type { EventBus } from './events'
import { writeFileAtomic } from './fs'

export class SettingsStore {
  private current: AppSettings = defaultSettings()
  private writeChain: Promise<void> = Promise.resolve()

  constructor(
    private readonly file: string,
    private readonly events: EventBus
  ) {}

  async load(): Promise<AppSettings> {
    try {
      this.current = parseSettings(JSON.parse(await readFile(this.file, 'utf8')))
    } catch {
      // 初回起動や破損時は既定値で始める。壊れたファイルは次の保存で上書きされる。
      this.current = defaultSettings()
    }
    return this.current
  }

  get(): AppSettings {
    return this.current
  }

  async update(patch: SettingsPatch): Promise<AppSettings> {
    const { settings, rejected } = applySettingsPatch(this.current, patch)
    if (rejected.length > 0) {
      throw new AppError('INVALID_ARGUMENT', `設定の値が不正です: ${rejected.join(', ')}`)
    }
    this.current = settings
    const snapshot = JSON.stringify(this.current, null, 2)
    // 連続した更新で書き込み順が入れ替わらないよう直列化する。
    this.writeChain = this.writeChain.then(() => writeFileAtomic(this.file, snapshot))
    await this.writeChain
    this.events.emit('settings:changed', this.current)
    return this.current
  }
}
