import type { CohostCandidate, CohostRequest } from '../ai/cohost'
import type { DraftRequest } from '../ai/draft'
import type { PortraitRequest } from '../ai/portraits'
import type { EditorRequest } from '../ai/editor'
import type { Command } from '../commands/types'
import type { ExportProgress, ExportRequest } from '../export/types'
import type { MediaProbe, ProxyFormat, WaveformPeaks } from '../media/types'
import type { GeneratedBy, ModelInfo, ProviderId, ProviderStatus } from '../ai/types'
import type { AppErrorShape } from '../errors'
import type { LiveProfile, LiveSessionSummary, LiveState } from '../live/types'
import type { AiPersona, LiveEntry, LiveSession, Project, ProjectBriefing, PublishInfo } from '../project/types'
import type { PsdManifest } from '../psd/types'
import type { AppSettings, SettingsPatch } from '../settings/schema'
import type { SecretName, SecretStatus } from '../settings/secrets'
import type {
  EngineInstallInfo,
  EngineInstallState,
  EngineStatus,
  SpeakerInfo,
  SynthesisOutcome,
  SynthesisRequest,
  UserDictWord
} from '../voice/types'

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
  /** 動画・音声・画像のどれでも。 */
  | 'media'
  | 'image'
  | 'psd'
  /** 相方の設定(ペルソナ)の JSON。 */
  | 'persona'
  | 'exportVideo'
  | 'exportText'
  /** 今の画面の画像(サムネイル用)。 */
  | 'exportImage'
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

  /** APIキーなどが入っているか(値そのものは返さない)。 */
  'secrets:status': { args: []; result: SecretStatus[] }
  /** APIキーなどを入れる。null か空文字で消す。 */
  'secrets:set': { args: [name: SecretName, value: string | null]; result: SecretStatus }

  'dialog:pick': { args: [request: PickRequest]; result: string[] | null }

  'project:read': { args: [path: string]; result: Project }
  'project:write': { args: [path: string, project: Project]; result: Project }
  /** 最近開いたプロジェクトの一覧から外す(見つからなくなったものなど)。 */
  'project:forgetRecent': { args: [path: string]; result: void }

  'ai:providers': { args: []; result: ProviderStatus[] }
  'ai:models': { args: [providerId: ProviderId]; result: ModelInfo[] }
  'ai:test': { args: [providerId: ProviderId, model: string]; result: { text: string; durationMs: number } }
  /** 相方の返答(候補)を作る。台本には入れず、採用は利用者が決める。 */
  'ai:cohost': {
    args: [project: Project, request: CohostRequest]
    /** vision: 画面を見せたときの結果(見せたコマの数、モデルが画像を読めず文字だけで作ったか)。 */
    result: { candidates: CohostCandidate[]; generatedBy: GeneratedBy; vision?: { shownFrames: number; imagesDropped: boolean } }
  }
  /** 録画とライブの記録から、台本とタイムラインの下書き(コマンドの提案)を作る。 */
  'ai:draft': { args: [project: Project, request: DraftRequest]; result: { reply: string; commands: Command[]; generatedBy: GeneratedBy; candidates: number } }
  /** 立ち絵(表情・出し入れ・位置・話し手の強調)をまとめて調整する提案を作る。適用は差分を確かめてから。 */
  'ai:portraits': { args: [project: Project, request: PortraitRequest]; result: { reply: string; commands: Command[]; generatedBy: GeneratedBy } }
  /** 相方に見せる範囲を選ぶための、その時刻の録画のコマ(JPEG の data URL)。録画が映っていなければ null。 */
  'ai:visionFrame': { args: [project: Project, atMs: number]; result: string | null }
  /** 企画メモから、相方のスタンスと前提知識を作る。保存は利用者が確かめてから(project.setBriefing)。 */
  'ai:briefing': { args: [project: Project]; result: ProjectBriefing }
  /**
   * 前提知識の裏付けを確かめる(使えればウェブ検索で)。factIds が無ければ未確認の AI の知識をまとめて確かめる。
   * 結果を書き込んだ前提を返す。確認済みにはしない。
   */
  'ai:briefingCheck': { args: [project: Project, briefing: ProjectBriefing, factIds: string[] | null]; result: { briefing: ProjectBriefing; webSearched: boolean; checked: number } }
  /** 投稿用の文(タイトル案・概要欄・チャプター)の下書きを作る。 */
  'ai:publish': { args: [project: Project]; result: PublishInfo }
  /** 編集の指示をコマンド列の提案にする。適用は利用者が差分を確かめてから行う。 */
  'ai:edit': { args: [project: Project, request: EditorRequest]; result: { reply: string; commands: Command[]; generatedBy: GeneratedBy } }

  'voice:engines': { args: []; result: EngineStatus[] }
  'voice:ensure': { args: [engineId: string]; result: EngineStatus }
  /** VOICEVOX ENGINE の自動インストールの状況。 */
  'voice:install:info': { args: []; result: EngineInstallInfo }
  /** 公式の VOICEVOX ENGINE をダウンロード・展開し、起動する。進み具合は voice:install-progress で届く。 */
  'voice:install:start': { args: []; result: EngineStatus }
  'voice:install:cancel': { args: []; result: void }
  'voice:speakers': { args: [engineId: string]; result: SpeakerInfo[] }
  'voice:synthesize': { args: [request: SynthesisRequest]; result: SynthesisOutcome }
  /** キャッシュ済みの音声ファイルの場所。無ければ null(保存済みのアクセント句から再合成する)。 */
  'voice:resolve': { args: [cacheKey: string]; result: string | null }
  'voice:dict:list': { args: [engineId: string]; result: UserDictWord[] }
  'voice:dict:add': { args: [engineId: string, word: Omit<UserDictWord, 'id'>]; result: string }
  'voice:dict:delete': { args: [engineId: string, wordId: string]; result: void }

  /** PSD を解析してレイヤーツリーを返す。各レイヤーの画像はキャッシュに PNG として置かれる。 */
  'psd:load': { args: [path: string]; result: PsdManifest }

  /** 素材の長さ・大きさ・符号化方式を調べる(ffprobe)。 */
  'media:probe': { args: [path: string]; result: MediaProbe }
  /** 編集用の軽い動画を用意して、その場所を返す。 */
  'media:proxy': { args: [path: string, format: ProxyFormat]; result: string }
  /** 波形の表示用データ。 */
  'media:peaks': { args: [path: string]; result: WaveformPeaks }

  /** mp4 の書き出しを始めてジョブIDを返す。進み具合は export:progress で届く。 */
  'export:start': { args: [request: ExportRequest]; result: string }
  'export:cancel': { args: [jobId: string]; result: void }
  /** 概要欄などのテキストをファイルに書く。 */
  'export:text': { args: [path: string, text: string]; result: void }
  /** PNG の画像(base64)を保存する。保存先は保存ダイアログで選んだ場所だけ。 */
  'export:image': { args: [path: string, pngBase64: string]; result: void }

  /** ライブ(録画中の会話)。相方の設定は編集画面のプロジェクトから写して渡す。 */
  'live:setProfile': { args: [profile: LiveProfile]; result: LiveState }
  'live:state': { args: []; result: LiveState }
  'live:start': { args: []; result: LiveState }
  'live:say': { args: [text: string, kind: 'chat' | 'question' | 'note']; result: LiveEntry[] }
  'live:mark': { args: [text: string]; result: LiveEntry }
  'live:stop': { args: []; result: LiveState }
  /** 押しながら話した声を文字にする。 */
  'live:transcribe': { args: [audio: string]; result: string }
  'live:list': { args: []; result: LiveSessionSummary[] }
  'live:read': { args: [sessionId: string]; result: LiveSession & { recordingPath: string | null } }
  /** ライブ用の小さなウィンドウを開く。開けない環境(テスト用ホスト)なら false。 */
  'live:openWindow': { args: []; result: boolean }

  /** 書き出した相方の設定(ペルソナ)を読み込む(B-9)。ファイル選択で選んだものに限る。 */
  'persona:read': { args: [path: string]; result: AiPersona }

  /** 自動保存(T-5)。保存したら clear する。起動時に list に残っていれば復元を勧める。 */
  'autosave:write': { args: [key: string, filePath: string | null, project: Project]; result: void }
  'autosave:list': { args: []; result: AutosaveEntry[] }
  'autosave:read': { args: [key: string]; result: Project }
  'autosave:clear': { args: [key: string]; result: void }
}

export interface AutosaveEntry {
  key: string
  /** 元のプロジェクトファイル。未保存の新規なら null。 */
  filePath: string | null
  title: string
  savedAt: string
}

export type Channel = keyof IpcContract
export type ChannelArgs<C extends Channel> = IpcContract[C]['args']
export type ChannelResult<C extends Channel> = IpcContract[C]['result']

export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: AppErrorShape }

/** main からレンダラへ送る通知。 */
export interface AppEvents {
  'settings:changed': AppSettings
  'voice:engine-status': EngineStatus
  'voice:install-progress': EngineInstallState
  /** プロキシ作成の進み具合(0〜1)。 */
  'media:proxy-progress': { path: string; ratio: number }
  'export:progress': ExportProgress
  'live:state': LiveState
  'live:entry': { sessionId: string; entry: LiveEntry }
  /** ライブ中のホットキー(押しながら話すの開始・終了)。 */
  'live:hotkey': { action: 'toggle-talk' }
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
