import { z } from 'zod'

import { PROVIDER_IDS } from '../ai/types'

/**
 * アプリ全体の設定。プロジェクトに属さないもの(どのAIを使うか、外部ツールの場所など)を持つ。
 * 各項目に既定値を持たせ、古い・壊れた設定ファイルからでも起動できるようにする。
 */

const modelRefSchema = z.object({
  providerId: z.enum(PROVIDER_IDS),
  model: z.string().min(1)
})

const executablePath = z.string().min(1).nullable().default(null)

const aiSchema = z
  .object({
    roles: z
      .object({
        conversation: modelRefSchema.nullable().default(null),
        editor: modelRefSchema.nullable().default(null)
      })
      .prefault({}),
    providers: z
      .object({
        'claude-code': z
          .object({
            executablePath,
            /** 一覧に無いモデルIDを手入力で足したもの。 */
            customModels: z.array(z.string()).default([]),
            timeoutMs: z.number().int().positive().default(180_000)
          })
          .prefault({}),
        opencode: z
          .object({
            executablePath,
            customModels: z.array(z.string()).default([]),
            /** モデル一覧をこのプロバイダに絞る。空文字なら全プロバイダを表示する。 */
            providerFilter: z.string().default('opencode-go'),
            timeoutMs: z.number().int().positive().default(180_000)
          })
          .prefault({})
      })
      .prefault({}),
    /** ライブモードでの返答の上限文字数。プレイを止めないため短くする。 */
    liveMaxChars: z.number().int().positive().default(80)
  })
  .prefault({})

const voiceEngineSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  url: z.string().url(),
  /** 同梱・インストール済みのエンジンの実行ファイル。null なら起動済みのものに接続するだけ。 */
  executablePath: z.string().min(1).nullable().default(null),
  autoLaunch: z.boolean().default(true)
})

const voiceSchema = z
  .object({
    engines: z.array(voiceEngineSchema).default([
      {
        id: 'voicevox',
        label: 'VOICEVOX',
        url: 'http://127.0.0.1:50021',
        executablePath: null,
        autoLaunch: true
      }
    ])
  })
  .prefault({})

const mediaSchema = z
  .object({
    ffmpegPath: executablePath,
    ffprobePath: executablePath,
    /** 編集用プロキシの縦解像度。 */
    proxyHeight: z.number().int().positive().default(540)
  })
  .prefault({})

const speechSchema = z
  .object({
    whisperPath: executablePath,
    whisperModelPath: executablePath,
    language: z.string().default('ja')
  })
  .prefault({})

const obsSchema = z
  .object({
    enabled: z.boolean().default(false),
    url: z.string().default('ws://127.0.0.1:4455'),
    password: z.string().default('')
  })
  .prefault({})

const liveSchema = z
  .object({
    markerHotkey: z.string().default('CommandOrControl+Shift+M'),
    pushToTalkHotkey: z.string().default('CommandOrControl+Shift+Space'),
    speakReplies: z.boolean().default(true),
    /** 返答の読み上げ先。null なら既定の出力デバイス。 */
    outputDeviceId: z.string().nullable().default(null),
    alwaysOnTop: z.boolean().default(true)
  })
  .prefault({})

const exportSchema = z
  .object({
    crf: z.number().int().min(0).max(51).default(20),
    preset: z.string().default('veryfast'),
    audioBitrateKbps: z.number().int().positive().default(192)
  })
  .prefault({})

export const settingsSchema = z.object({
  version: z.literal(1).default(1),
  ai: aiSchema,
  voice: voiceSchema,
  media: mediaSchema,
  speech: speechSchema,
  obs: obsSchema,
  live: liveSchema,
  export: exportSchema,
  recentProjects: z.array(z.string()).default([])
})

export type AppSettings = z.infer<typeof settingsSchema>
export type VoiceEngineSettings = z.infer<typeof voiceEngineSchema>

type DeepPartial<T> = T extends readonly (infer U)[]
  ? readonly U[]
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> | undefined }
    : T

export type SettingsPatch = DeepPartial<AppSettings>

const SECTION_KEYS = Object.keys(settingsSchema.shape) as (keyof AppSettings)[]

export function defaultSettings(): AppSettings {
  return settingsSchema.parse({})
}

/**
 * 設定を読み込む。壊れた項目があっても全体を捨てず、その項目だけ既定値に戻す。
 * 1つの設定ミスでAIの割り当てなど他の設定まで失われるのを避けるため。
 */
export function parseSettings(raw: unknown): AppSettings {
  const source = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  const defaults = defaultSettings()
  const result: Record<string, unknown> = {}
  for (const key of SECTION_KEYS) {
    const section = settingsSchema.shape[key].safeParse(source[key])
    result[key] = section.success ? section.data : defaults[key]
  }
  return result as AppSettings
}

/** 配列は置き換え、オブジェクトは再帰的に統合する。不正になった項目は更新前の値を保つ。 */
export function mergeSettings(base: AppSettings, patch: SettingsPatch): AppSettings {
  return applySettingsPatch(base, patch).settings
}

/**
 * 更新を適用する。更新によって不正になった項目は既定値ではなく更新前の値に戻し、拒否した項目名を返す。
 * 読み込み時(parseSettings)と違い、更新時に既定値へ戻すと1つの入力ミスで他の設定まで消えてしまうため。
 */
export function applySettingsPatch(
  base: AppSettings,
  patch: SettingsPatch
): { settings: AppSettings; rejected: (keyof AppSettings)[] } {
  const merged = deepMerge(base, patch) as Record<string, unknown>
  const result: Record<string, unknown> = {}
  const rejected: (keyof AppSettings)[] = []
  for (const key of SECTION_KEYS) {
    const section = settingsSchema.shape[key].safeParse(merged[key])
    if (section.success) {
      result[key] = section.data
    } else {
      result[key] = base[key]
      rejected.push(key)
    }
  }
  return { settings: result as AppSettings, rejected }
}

function deepMerge(base: unknown, patch: unknown): unknown {
  if (patch === undefined) return base
  if (Array.isArray(patch) || typeof patch !== 'object' || patch === null) return patch
  if (typeof base !== 'object' || base === null || Array.isArray(base)) return patch
  const merged: Record<string, unknown> = { ...(base as Record<string, unknown>) }
  for (const [key, value] of Object.entries(patch)) {
    merged[key] = deepMerge(merged[key], value)
  }
  return merged
}
