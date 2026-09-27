import type { ModelInfo, ProviderId, ProviderStatus } from '../ai/types'
import type { AppErrorShape } from '../errors'
import type { Project } from '../project/types'
import type { AppSettings, SettingsPatch } from '../settings/schema'

/**
 * main とレンダラの間の通信契約。
 * 機能を足すときは、ここにチャネルを1つ足し、main 側のハンドラ表に実装を1つ足す。
 * Electron の IPC とテスト用ホストの HTTP は、どちらもこの表をそのまま運ぶ。
 */

export interface AppInfo {
  appVersion: string
  runtime: 'electron' | 'devhost'
  platform: string
  projectFileExtension: string
}

export type PickKind =
  | 'openProject'
  | 'saveProject'
  | 'video'
  | 'audio'
  | 'image'
  | 'psd'
  | 'exportVideo'
  | 'exportText'
  | 'executable'
  | 'any'

export interface PickRequest {
  kind: PickKind
  /** 保存ダイアログの既定のファイル名。 */
  defaultName?: string
  multiple?: boolean
}

export interface IpcContract {
  'app:info': { args: []; result: AppInfo }

  'settings:get': { args: []; result: AppSettings }
  'settings:update': { args: [patch: SettingsPatch]; result: AppSettings }

  'dialog:pick': { args: [request: PickRequest]; result: string[] | null }

  'project:read': { args: [path: string]; result: Project }
  'project:write': { args: [path: string, project: Project]; result: Project }

  'ai:providers': { args: []; result: ProviderStatus[] }
  'ai:models': { args: [providerId: ProviderId]; result: ModelInfo[] }
  'ai:test': { args: [providerId: ProviderId, model: string]; result: { text: string; durationMs: number } }
}

export type Channel = keyof IpcContract
export type ChannelArgs<C extends Channel> = IpcContract[C]['args']
export type ChannelResult<C extends Channel> = IpcContract[C]['result']

export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: AppErrorShape }

/** main からレンダラへ送る通知。 */
export interface AppEvents {
  'settings:changed': AppSettings
}

export type EventName = keyof AppEvents

export interface EventEnvelope<E extends EventName = EventName> {
  type: E
  payload: AppEvents[E]
}

/**
 * window.zunda として公開される最小の橋渡し。Electron では preload が、テスト用ホストでは HTTP 実装が提供する。
 * contextBridge はエラーの独自プロパティを運べないため、結果は IpcResult のまま返し、
 * 型付きの呼び出しと例外への変換はレンダラ側(renderer/src/api.ts)で行う。
 */
export interface ZundaBridge {
  runtime: 'electron' | 'devhost'
  invoke: (channel: string, args: unknown[]) => Promise<IpcResult<unknown>>
  subscribe: (listener: (envelope: EventEnvelope) => void) => () => void
  /** ローカルファイルを <video> や <img> で読むためのURL。main 側で許可されたファイルに限り配信される。 */
  mediaUrl: (absolutePath: string) => string
}
