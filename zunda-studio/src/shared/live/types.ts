import type { ModelRef } from '../ai/types'
import type { AiPersona, LiveEntry, LiveSession, Ms, VoiceParams } from '../project/types'

/**
 * ライブモード(録画中の会話)のための型。仕様は docs/ARCHITECTURE.md 2.6、PROJECT_FORMAT.md 9章。
 */

/** ライブの相手(相方)の設定。編集画面のプロジェクトから写して、ライブウィンドウへ渡す。 */
export interface LiveProfile {
  /** 相方(AIが演じるキャラクター)の名前と人物像。 */
  aiName: string
  persona: AiPersona | null
  /** 投稿者本人の役の名前。 */
  userName: string
  /** プロジェクトで選んだ会話AI。null ならアプリの既定値。 */
  model: ModelRef | null
  /** 返答の読み上げに使う声。null なら読み上げない。 */
  voice: { engineId: string; speakerId: number; params: VoiceParams } | null
  /** どのプロジェクトから始めたか(表示用)。 */
  projectTitle: string
}

/** セッションの一覧に出す要約。 */
export interface LiveSessionSummary {
  id: string
  startedAt: string
  endedAt: string | null
  entryCount: number
  markerCount: number
  aiName: string
  projectTitle: string
  /** OBS から受け取った録画ファイルの場所(分かれば)。 */
  recordingPath: string | null
}

/** ライブウィンドウに見せる今の状態。 */
export interface LiveState {
  profile: LiveProfile | null
  session: (LiveSession & { recordingPath: string | null }) | null
  obs: ObsStatus
  /** AI が返答を考えている最中か。 */
  thinking: boolean
}

export type ObsStatus =
  | { state: 'disabled' }
  | { state: 'connecting' }
  | { state: 'connected'; recording: boolean }
  | { state: 'error'; message: string }

/** 押しながら話すで録った音声(文字起こし用)。 */
export interface TranscribeRequest {
  /** 音声ファイルの中身(base64)。形式は ffmpeg が読めれば何でもよい(MediaRecorder の webm など)。 */
  audio: string
}

/** セッションの記録ファイル(JSONL)の1行。 */
export type LiveLogLine =
  | { type: 'session'; id: string; startedAt: string; profile: LiveProfile }
  | { type: 'entry'; entry: LiveEntry }
  | { type: 'offset'; offsetMs: Ms; source: 'obs' | 'manual'; recordingPath?: string }
  | { type: 'end'; endedAt: string }
