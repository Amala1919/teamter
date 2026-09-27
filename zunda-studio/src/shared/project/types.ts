/**
 * プロジェクトのデータモデル。仕様は docs/PROJECT_FORMAT.md を参照。
 * 時間はすべてミリ秒の整数で表す。
 */

export const PROJECT_FORMAT_VERSION = 1

export type Ms = number

export type CharacterId = string
export type AssetId = string
export type LayerId = string
export type ItemId = string
export type PartGroupId = string
export type PartId = string
export type ExpressionId = string
export type SubtitleStyleId = string

// ---------------------------------------------------------------- 素材

/** 素材の場所。別マシンでも開けるよう相対パスを併記し、読み込み時は相対を優先する。 */
export interface AssetPath {
  absolute: string
  /** プロジェクトファイルからの相対パス。プロジェクトが未保存なら null。 */
  relative: string | null
}

export interface AssetLicense {
  /** 入手元。URL でも「自分で録画」のような記述でもよい。 */
  source: string
  creditRequired: boolean
  creditText?: string
  note?: string
}

interface AssetBase {
  path: AssetPath
  license: AssetLicense
}

export interface VideoAsset extends AssetBase {
  type: 'video'
  durationMs: Ms
  width: number
  height: number
  fps: number
  hasAudio: boolean
}

export interface AudioAsset extends AssetBase {
  type: 'audio'
  durationMs: Ms
}

export interface ImageAsset extends AssetBase {
  type: 'image'
  width: number
  height: number
}

export interface PsdAsset extends AssetBase {
  type: 'psd'
}

export type Asset = VideoAsset | AudioAsset | ImageAsset | PsdAsset
export type AssetType = Asset['type']

// ---------------------------------------------------------------- 立ち絵

/** PSD 内のレイヤーを指すパス。ルートから対象レイヤーまでの名前の並び。 */
export type LayerPath = readonly string[]

export type PartRole = 'eye' | 'mouth' | 'eyebrow' | 'body' | 'other'

export interface PortraitPart {
  id: PartId
  name: string
  layerPath: LayerPath
}

/** 母音。VOICEVOX のモーラが返す値に合わせる。 */
export type Vowel = 'a' | 'i' | 'u' | 'e' | 'o' | 'N' | 'cl' | 'pau'

export interface PortraitPartGroup {
  id: PartGroupId
  role: PartRole
  layerPath: LayerPath
  /** exclusive: グループ内で1つだけ表示する。multiple: 複数同時に表示できる。 */
  selection: 'exclusive' | 'multiple'
  items: PortraitPart[]
  /** まばたき用。開いた状態から閉じた状態までの順に並べる。 */
  blinkSequence?: PartId[]
  /** 口パク(母音方式)用。母音から口パーツへの対応。 */
  vowelMap?: Partial<Record<Vowel, PartId>>
  /** 口パク(開閉方式)用。閉じた状態から開いた状態までの順に並べる。 */
  openSequence?: PartId[]
}

export interface Expression {
  id: ExpressionId
  name: string
  /** パーツグループごとに選択するパーツ。口は口パクが制御するため含めない。 */
  selections: Record<PartGroupId, PartId>
}

export type PortraitAnchor =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'center'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right'

export interface PortraitTransform {
  x: number
  y: number
  scale: number
  flipX: boolean
  anchor: PortraitAnchor
}

export interface LipSyncConfig {
  /** vowel: モーラの母音からパーツを選ぶ。amplitude: 音量から開口度を決める。 */
  mode: 'vowel' | 'amplitude'
  partGroupId: PartGroupId
}

export interface BlinkConfig {
  partGroupId: PartGroupId
  intervalMs: Ms
  /** まばたき間隔のゆらぎ幅。乱数は renderSeed から決定論的に生成する。 */
  jitterMs: Ms
  closeDurationMs: Ms
}

export interface PortraitConfig {
  assetId: AssetId
  transform: PortraitTransform
  partGroups: Record<PartGroupId, PortraitPartGroup>
  expressions: Record<ExpressionId, Expression>
  defaultExpressionId: ExpressionId | null
  lipSync: LipSyncConfig | null
  blink: BlinkConfig | null
}

// ---------------------------------------------------------------- キャラクター

export interface VoiceParams {
  speedScale: number
  pitchScale: number
  intonationScale: number
  volumeScale: number
  prePhonemeLength: number
  postPhonemeLength: number
}

export interface VoiceConfig extends VoiceParams {
  engineId: string
  /** エンジン側のスタイルID(VOICEVOX の speaker/style id)。 */
  speakerId: number
  speakerName: string
}

/**
 * セリフを誰が書くか。
 * user: 投稿者本人の役。セリフは人間が書く。
 * ai: AIが演じる相方。セリフはAIが persona に従って書く。
 */
export type CharacterAuthorRole = 'user' | 'ai'

/** 掛け合いでの立ち位置。 */
export type BanterRole = 'tsukkomi' | 'boke' | 'navigator' | 'free'

/** AIが相方としてセリフを書くときの拠り所。エピソードをまたいで口調を保つために保存する。 */
export interface AiPersona {
  /** 性格。「冷静で毒舌だが根は優しい」など。 */
  personality: string
  /** 一人称・語尾・口癖などの言語的な癖。 */
  speechStyle: string
  banterRole: BanterRole
  /** 使わせたくない表現。 */
  forbidden: string[]
  /** 1返答あたりの目安の長さ(文字数)。テンポの基準になる。 */
  targetLengthChars: number
}

export interface Character {
  id: CharacterId
  name: string
  authorRole: CharacterAuthorRole
  /** authorRole が 'ai' のときのみ設定する。 */
  persona: AiPersona | null
  voice: VoiceConfig
  subtitleStyleId: SubtitleStyleId
  portrait: PortraitConfig | null
  /** 音声ライブラリの規約上クレジットが必要か。 */
  creditRequired: boolean
  creditText: string
}

// ---------------------------------------------------------------- 字幕スタイル

export interface SubtitleOutline {
  color: string
  widthPx: number
}

export interface SubtitleShadow {
  color: string
  offsetX: number
  offsetY: number
  blurPx: number
}

export interface SubtitlePosition {
  anchor: PortraitAnchor
  x: number
  y: number
}

export interface SubtitleStyle {
  id: SubtitleStyleId
  name: string
  fontFamily: string
  fontWeight: number
  fontSizePx: number
  color: string
  outline: SubtitleOutline | null
  shadow: SubtitleShadow | null
  position: SubtitlePosition
  maxCharsPerLine: number
  lineHeight: number
}

// ---------------------------------------------------------------- レイヤー

export interface Layer {
  id: LayerId
  name: string
  /** 大きいほど前面に描画される。 */
  index: number
  visible: boolean
  locked: boolean
  muted: boolean
}

// ---------------------------------------------------------------- エフェクト

export type Easing = 'linear' | 'easeInCubic' | 'easeOutCubic' | 'easeInOutCubic'

export interface FadeEffect {
  type: 'fade'
  inMs: Ms
  outMs: Ms
}

export interface ScaleEffect {
  type: 'scale'
  from: number
  to: number
  easing: Easing
  durationMs: Ms
}

export interface MoveEffect {
  type: 'move'
  fromX: number
  fromY: number
  toX: number
  toY: number
  easing: Easing
  durationMs: Ms
}

/** 乱数は renderSeed とアイテムIDと相対時刻から決定論的に生成する。 */
export interface ShakeEffect {
  type: 'shake'
  amplitudePx: number
  frequencyHz: number
  durationMs: Ms
}

export type Effect = FadeEffect | ScaleEffect | MoveEffect | ShakeEffect

// ---------------------------------------------------------------- アイテム

export interface Transform {
  x: number
  y: number
  scale: number
  rotation: number
  opacity: number
}

interface ItemBase {
  id: ItemId
  layerId: LayerId
  startMs: Ms
  durationMs: Ms
  effects: Effect[]
  locked: boolean
}

/** VOICEVOX の Mora。docs/ARCHITECTURE.md の音声合成の項を参照。 */
export interface Mora {
  text: string
  consonant: string | null
  consonantLength: number | null
  vowel: string
  vowelLength: number
  pitch: number
}

export interface AccentPhrase {
  moras: Mora[]
  accent: number
  pauseMora: Mora | null
  isInterrogative: boolean
}

export interface LipSyncKeyframe {
  atMs: Ms
  vowel: Vowel
}

export interface SynthesisResult {
  /** 合成済み音声のディスクキャッシュのキー。 */
  cacheKey: string
  audioDurationMs: Ms
  lipSync: LipSyncKeyframe[]
  /** 読み方の修正を永続化するために保持する。あれば再取得せず合成に使う。 */
  accentPhrases: AccentPhrase[]
}

export interface SubtitleOverride {
  styleId?: SubtitleStyleId
  color?: string
  sizeScale?: number
}

export interface VoiceItem extends ItemBase {
  type: 'voice'
  characterId: CharacterId
  text: string
  /** キャラクター既定値の部分上書き。 */
  voiceOverride: Partial<VoiceParams> | null
  subtitleOverride: SubtitleOverride | null
  expressionId: ExpressionId | null
  /** 未合成なら null。durationMs はここから導出される。 */
  synthesis: SynthesisResult | null
  /** 自動改行の結果。手動で編集できる。 */
  subtitleLines: string[]
}

export interface VideoItem extends ItemBase {
  type: 'video'
  assetId: AssetId
  inMs: Ms
  outMs: Ms
  transform: Transform
  volume: number
  playbackRate: number
}

export interface ImageItem extends ItemBase {
  type: 'image'
  assetId: AssetId
  transform: Transform
}

export interface TextItem extends ItemBase {
  type: 'text'
  text: string
  styleId: SubtitleStyleId
  transform: Transform
}

export interface AudioItem extends ItemBase {
  type: 'audio'
  assetId: AssetId
  inMs: Ms
  outMs: Ms
  volume: number
  loop: boolean
  fadeInMs: Ms
  fadeOutMs: Ms
  /** セリフ再生中に自動で音量を下げる対象にするか。 */
  duckable: boolean
}

export interface ShapeItem extends ItemBase {
  type: 'shape'
  shape: 'rect' | 'ellipse'
  fill: string
  transform: Transform
}

/** 立ち絵の登場・退場を明示的に制御したい場合に置く。 */
export interface PortraitItem extends ItemBase {
  type: 'portrait'
  characterId: CharacterId
  transformOverride: PortraitTransform | null
}

export type Item =
  | VoiceItem
  | VideoItem
  | ImageItem
  | TextItem
  | AudioItem
  | ShapeItem
  | PortraitItem

export type ItemType = Item['type']

// ---------------------------------------------------------------- プロジェクト

export interface CanvasConfig {
  width: number
  height: number
  fps: number
  backgroundColor: string
}

export interface ProjectMeta {
  title: string
  createdAt: string
  updatedAt: string
  /** まばたきや振動の乱数を決定論的にするための種。 */
  renderSeed: number
}

export interface CreditsState {
  generated: string
  /** クレジットの最終確認はユーザーの明示的な操作でのみ true にする。 */
  confirmedByUser: boolean
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  atMs: number
  /** アシスタントが提案したコマンド列(適用済みでも履歴として残す)。 */
  proposedCommands?: unknown[]
  applied?: boolean
  transactionId?: string
}

// ------------------------------------------------ ライブセッション(録画中の記録)

export type LiveSessionId = string
export type LiveEntryId = string

/**
 * 録画中にAIと交わした会話の1件。
 * atMs はセッション開始からの相対時刻。録画上の時刻は session.offsetMs + atMs で求める。
 * 相対時刻で保存するのは、録画との対応付け(offsetMs)を後から修正できるようにするため。
 */
export interface LiveEntry {
  id: LiveEntryId
  atMs: Ms
  role: 'user' | 'ai'
  text: string
  /** chat: 雑談 / question: 質問と回答 / note: 自分用のメモ / marker: 目印だけ */
  kind: 'chat' | 'question' | 'note' | 'marker'
  /** 録画中に「ここは使う」と目印を付けたか。 */
  bookmarked: boolean
  /** 台本に採用した場合、生成されたボイスアイテムのID。二重採用を防ぐ。 */
  adoptedItemId: ItemId | null
}

export interface LiveSession {
  id: LiveSessionId
  /** セッション開始の実時刻。録画との対応付けの手がかりになる。 */
  startedAt: string
  endedAt: string | null
  /** このセッションに対応する録画素材。未対応なら null。 */
  recordingAssetId: AssetId | null
  /** 録画のこの時刻(ms)がセッション開始に対応する。 */
  offsetMs: Ms
  /** offsetMs をどう決めたか。手動調整したかを区別して表示するため。 */
  offsetSource: 'obs' | 'manual' | 'unknown'
  entries: LiveEntry[]
}

export interface Project {
  formatVersion: number
  meta: ProjectMeta
  canvas: CanvasConfig
  characters: Record<CharacterId, Character>
  subtitleStyles: Record<SubtitleStyleId, SubtitleStyle>
  assets: Record<AssetId, Asset>
  layers: Layer[]
  items: Item[]
  /** 録画中にAIと交わした会話の記録。台本の素材として振り返る。 */
  liveSessions: Record<LiveSessionId, LiveSession>
  credits: CreditsState
  chat: { messages: ChatMessage[] }
}
