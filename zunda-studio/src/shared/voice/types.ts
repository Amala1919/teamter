import type { AccentPhrase, LipSyncKeyframe, VoiceParams } from '../project/types'

export type EngineState = 'unknown' | 'starting' | 'ready' | 'unavailable'

export interface EngineStatus {
  id: string
  label: string
  url: string
  state: EngineState
  version?: string
  message?: string
  /** アプリが起動したエンジンか(終了時に止める対象か)。 */
  managed: boolean
  /** not-found: 起動していないうえ、実行ファイルも見つからない(自動インストールを勧める)。 */
  reason?: 'not-found'
}

/** VOICEVOX ENGINE の自動インストールの進み具合。 */
export type EngineInstallPhase = 'idle' | 'checking' | 'downloading' | 'extracting' | 'starting' | 'done' | 'error' | 'cancelled'

export interface EngineInstallState {
  phase: EngineInstallPhase
  version?: string
  receivedBytes: number
  /** 分からないときは null。 */
  totalBytes: number | null
  message?: string
}

export interface EngineInstallInfo {
  /** この OS・CPU 向けの公式配布があるか。 */
  supported: boolean
  /** 公式配布の種類(windows-cpu など)。 */
  target: string | null
  installed: { version: string; executablePath: string } | null
  state: EngineInstallState
}

export interface SpeakerStyle {
  id: number
  name: string
}

export interface SpeakerInfo {
  name: string
  uuid: string
  styles: SpeakerStyle[]
}

export interface SynthesisRequest {
  engineId: string
  speakerId: number
  text: string
  params: VoiceParams
  /** 読みやアクセントを修正済みならそれを使う。無ければテキストから求める。 */
  accentPhrases?: AccentPhrase[] | null
  /** AquesTalk 風記法の読み。指定するとテキストの代わりにこれを読む。 */
  kana?: string | null
}

export interface SynthesisOutcome {
  cacheKey: string
  wavPath: string
  audioDurationMs: number
  lipSync: LipSyncKeyframe[]
  accentPhrases: AccentPhrase[]
  kana: string
}

export interface UserDictWord {
  id: string
  surface: string
  pronunciation: string
  accentType: number
  priority: number
}
