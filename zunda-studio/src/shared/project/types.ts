/**
 * プロジェクトのデータモデル。仕様は docs/PROJECT_FORMAT.md を参照。
 * 時間はすべてミリ秒の整数で表す。
 */

import type { GeneratedBy, ModelRef } from '../ai/types'

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
  /** 入手元がフリー素材の一覧(shared/media/free-sources.ts)のどれか。 */
  sourceId?: string
  /** クレジットが任意の素材でも、概要欄に表記を載せる。 */
  creditOptIn?: boolean
}

interface AssetBase {
  path: AssetPath
  license: AssetLicense
}

/** 素材の符号化方式。プレビューでそのまま再生できるか(プロキシが要るか)の判断に使う。 */
export interface MediaCodecs {
  video: string | null
  audio: string | null
  container: string
}

/**
 * プレビューで使う動画の画質。書き出しには関係しない(書き出しは常に元のファイルから作る)。
 * - auto: そのまま再生できる形式なら元のファイル、できなければ設定の高さ(既定 540p)の軽い動画を作る
 * - original: そのまま再生できる形式なら元のファイル、できなければ元の大きさのまま変換する
 * - 数値: その高さを上限にする(元がそれより大きければ、その高さの軽い動画を作る)
 */
export type PreviewResolution = 'auto' | 'original' | 360 | 540 | 720 | 1080

export const PREVIEW_RESOLUTIONS: readonly PreviewResolution[] = ['auto', 'original', 1080, 720, 540, 360]

export interface VideoAsset extends AssetBase {
  type: 'video'
  codecs?: MediaCodecs
  /** プレビューの画質。無ければ auto。 */
  preview?: PreviewResolution
  durationMs: Ms
  width: number
  height: number
  fps: number
  hasAudio: boolean
}

export interface AudioAsset extends AssetBase {
  type: 'audio'
  codecs?: MediaCodecs
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

/**
 * 表情で「このグループは何も表示しない」ことを表す値。
 * 選ばない(キーが無い)ときは PSD の表示のままになるので、エフェクトなどを消すにはこれを入れる。
 */
export const NO_PART = '__none__'

export interface Expression {
  id: ExpressionId
  name: string
  /** パーツグループごとに選択するパーツ(NO_PART なら何も表示しない)。口は口パクが制御するため含めない。 */
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
  /**
   * パーツ以外のレイヤーの表示を PSD の初期状態から変えたもの(レイヤーの key → 表示するか)。
   * 小物のオン・オフなどに使う。
   */
  layerVisibility: Record<string, boolean>
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
  /**
   * タイムラインでこのキャラクターのセリフを描く色(#rrggbb)。見分けるための印で、動画には出ない。
   * 無ければ、キャラクターの並びに応じて自動で色分けする。
   */
  timelineColor?: string
  /** アプリに保存したキャラクター(SavedCharacter)から足した・保存したなら、その ID。プロジェクトで直すとアプリにも反映する。 */
  libraryId?: string
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

/** 字幕の後ろに敷く帯。 */
export interface SubtitleBackground {
  color: string
  /** 0〜1 */
  opacity: number
  paddingPx: number
  radiusPx: number
  /** 真なら画面の横幅いっぱいの帯にする。 */
  fullWidth: boolean
}

/** 字幕の出方。typewriter は1文字ずつ。 */
export const SUBTITLE_APPEARS = ['none', 'fade', 'pop', 'slideUp', 'typewriter'] as const
export type SubtitleAppearKind = (typeof SUBTITLE_APPEARS)[number]

export interface SubtitleAppear {
  kind: SubtitleAppearKind
  durationMs: Ms
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
  /** 字幕の後ろの帯。無ければ敷かない。 */
  background?: SubtitleBackground | null
  /** 出方。無ければそのまま出す。 */
  appear?: SubtitleAppear | null
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
  /** このレイヤーの素材のタイムラインでの色(#rrggbb)。素材ごとの色があればそちらが優先。 */
  color?: string
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

/** 大きくなったり小さくなったりを繰り返す(ドクンドクン)。amount は振れ幅(0.1 で ±10%)。 */
export interface PulseEffect {
  type: 'pulse'
  amount: number
  periodMs: Ms
}

/** 点滅する。minOpacity は一番薄いときの不透明度(0 で消える)。 */
export interface BlinkEffect {
  type: 'blink'
  periodMs: Ms
  minOpacity: number
}

/** 回り続ける(1秒に degreesPerSecond 度。負なら逆回り)。 */
export interface SpinEffect {
  type: 'spin'
  degreesPerSecond: number
}

/** 振り子のように左右に傾く。 */
export interface SwingEffect {
  type: 'swing'
  degrees: number
  periodMs: Ms
}

/** ふわふわと上下に浮く。 */
export interface FloatEffect {
  type: 'float'
  amplitudePx: number
  periodMs: Ms
}

/** 登場・退場の切り替え方。docs/PROJECT_FORMAT.md 7 を参照。 */
export const TRANSITION_KINDS = [
  'fade',
  'wipeRight',
  'wipeLeft',
  'wipeDown',
  'wipeUp',
  'iris',
  'slideLeft',
  'slideRight',
  'slideUp',
  'slideDown',
  'zoom',
  'pop',
  'blur',
  'spin',
  'blinds'
] as const
export type TransitionKind = (typeof TRANSITION_KINDS)[number]

export interface TransitionSide {
  kind: TransitionKind
  durationMs: Ms
}

/**
 * 登場(in)・退場(out)の切り替え。ワイプ・スライド・円形などで出入りする。
 * 前の動画に重ねて置いた動画に in を付けると、場面の切り替え(クロスフェード・ワイプ)になる。
 */
export interface TransitionEffect {
  type: 'transition'
  in: TransitionSide | null
  out: TransitionSide | null
}

export type Effect =
  | FadeEffect
  | ScaleEffect
  | MoveEffect
  | ShakeEffect
  | PulseEffect
  | BlinkEffect
  | SpinEffect
  | SwingEffect
  | FloatEffect
  | TransitionEffect

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
  /** タイムラインでの色(#rrggbb)。見分けるための印で、動画には出ない。無ければレイヤーの色、それも無ければ種類ごとの色。 */
  color?: string
  /**
   * グループ。同じ値のアイテムは一緒に動く(ドラッグで一緒に動き、グループのセリフの尺が変わると後ろのものが合わせてずれる)。
   * 無ければ独立していて、ほかのアイテムの変化では動かない。
   */
  groupId?: string
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
  /** AIが書いたセリフなら生成元。人間が書いたなら null。 */
  generatedBy: GeneratedBy | null
  /** 未合成なら null。durationMs はここから導出される。 */
  synthesis: SynthesisResult | null
  /** 字幕の行。既定では自動改行の結果で、手で決めた場合は subtitleLinesManual が真になる。 */
  subtitleLines: string[]
  /** 字幕の改行を手で決めたか。テキストを書き換えると自動に戻る。 */
  subtitleLinesManual: boolean
  /**
   * 読み方の上書き(AquesTalk 風のカタカナ表記。例: コンニチワ'/ズンダモン'デス)。
   * null ならテキストから自動で読む。テキストを書き換えると外れる(V-6)。
   */
  reading?: string | null
  /**
   * 字幕に出す文字(読み上げる text とは別にしたいとき)。null・無しなら text をそのまま出す。
   * 声は text(と reading)で合成する。text を書き換えると外れる。
   */
  displayText?: string | null
  /** 真なら、このセリフの字幕を画面にも SRT にも出さない(声はそのまま)。 */
  subtitleHidden?: boolean
}

/** 切り抜き。素材の上下左右から切り落とす割合(0〜1)。 */
export interface Crop {
  left: number
  top: number
  right: number
  bottom: number
}

/** 動画・画像の枠(ワイプ・小窓の見た目)。 */
export interface MediaFrame {
  /** rect: 四角 / rounded: 角丸(radiusPx) / circle: 円(楕円)で切り抜く */
  shape: 'rect' | 'rounded' | 'circle'
  radiusPx: number
  border: { color: string; widthPx: number } | null
  shadow: SubtitleShadow | null
}

/** 色の調整。数値は元のままが 1(色相は 0 度、ぼかし・セピアは 0)。 */
export interface ColorAdjust {
  brightness: number
  contrast: number
  saturation: number
  /** 色相を回す角度(度)。 */
  hue: number
  /** セピア(0〜1)。回想シーンなどに。 */
  sepia: number
  /** ぼかし(px)。 */
  blurPx: number
}

/** 音量の折れ点(アイテム内の相対時刻と倍率)。点の間はなめらかにつなぐ。 */
export interface VolumeKey {
  atMs: Ms
  /** 0〜4。素材の音量(volume)にさらに掛ける。 */
  gain: number
}

/** 動画・画像に共通の見た目(切り抜き・枠・色の調整)。どれも無ければ元のまま。 */
export interface MediaLook {
  crop?: Crop
  frame?: MediaFrame
  adjust?: ColorAdjust
}

export interface VideoItem extends ItemBase, MediaLook {
  type: 'video'
  assetId: AssetId
  inMs: Ms
  outMs: Ms
  transform: Transform
  volume: number
  playbackRate: number
  /**
   * 静止画(フリーズフレーム)。真なら、素材の inMs のコマを尺いっぱい表示し続ける(音は鳴らさない)。
   * 無い古いプロジェクトは通常の動画として扱う。
   */
  freeze?: boolean
  /** 音量の時間変化。無ければ一定。 */
  volumeKeys?: VolumeKey[]
}

export interface ImageItem extends ItemBase, MediaLook {
  type: 'image'
  assetId: AssetId
  transform: Transform
}

export interface TextItem extends ItemBase {
  type: 'text'
  text: string
  styleId: SubtitleStyleId
  transform: Transform
  /** このテロップだけの見た目。無い項目は字幕スタイル(styleId)に従う。 */
  look?: TextLook
}

/** テロップの文字の揃え方(行の塊の中での揃え)。 */
export type TextAlign = 'left' | 'center' | 'right'

/** テロップの後ろに敷く帯。 */
export interface TextBackground {
  /** #rrggbb */
  color: string
  /** 0〜1 */
  opacity: number
  /** 文字の周りの余白(px)。 */
  paddingPx: number
  /** 角の丸み(px)。 */
  radiusPx: number
}

/**
 * テロップだけの見た目(字幕スタイルの上書き)。無い項目はスタイルに従う。
 * 縁取り・影の 'none' は「スタイルにあっても付けない」。
 */
export interface TextLook {
  color?: string
  fontFamily?: string
  fontWeight?: number
  fontSizePx?: number
  align?: TextAlign
  lineHeight?: number
  outline?: SubtitleOutline | 'none'
  shadow?: SubtitleShadow | 'none'
  background?: TextBackground
  /** 文字送り: 最初のこの時間で1文字ずつ出す(ms)。無いか0なら、はじめから全部出す。 */
  typewriterMs?: Ms
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
  /** 音量の時間変化。無ければ一定。 */
  volumeKeys?: VolumeKey[]
}

/**
 * 図形・装飾の形。描き方は shared/render/shapes.ts。
 * 動くもの(集中線・流線・紙吹雪・キラキラ)は時刻と renderSeed から決定論的に描く。
 */
export const SHAPE_KINDS = [
  'rect',
  'roundRect',
  'ellipse',
  'triangle',
  'diamond',
  'star',
  'burst',
  'heart',
  'arrow',
  'curveArrow',
  'line',
  'wave',
  'check',
  'cross',
  'handCircle',
  'corners',
  'bubble',
  'shout',
  'cloud',
  'band',
  'focusLines',
  'speedLines',
  'spotlight',
  'confetti',
  'sparkles'
] as const
export type ShapeKind = (typeof SHAPE_KINDS)[number]

export interface ShapeStroke {
  color: string
  widthPx: number
}

/** 塗りのグラデーション。fill から color へ変わる。 */
export interface ShapeGradient {
  color: string
  /** 線形の向き(度。0 で左から右、90 で上から下)。 */
  angle: number
  /** 真なら中心から外へ(円形)。 */
  radial: boolean
}

/** 図形の見た目と、形ごとの調整。無い項目は形ごとの既定値。 */
export interface ShapeProps {
  /** 基準の大きさ(px)。無い(以前の図形)なら画面いっぱい。 */
  width?: number
  height?: number
  /** 塗りの不透明度(0 なら塗らず線だけ)。 */
  fillOpacity?: number
  gradient?: ShapeGradient | null
  /** 線の形(矢印の軸・下線・チェックなど)の太さ(px)。 */
  thickness?: number
  /** 線の種類。線の形では本体の線、塗らない図形では縁取りに掛かる。 */
  dash?: 'solid' | 'dash' | 'dot'
  /** 縁取り。 */
  stroke?: ShapeStroke | null
  /** 線のさらに外側の縁(白い縁で目立たせるなど)。 */
  outerStroke?: ShapeStroke | null
  /** 影。ずらしを 0 にして明るい色にすると光って見える。 */
  shadow?: SubtitleShadow | null
  cornerRadius?: number
  /** 星・爆発の角の数。 */
  points?: number
  /** 星のくぼみの深さ(0〜1。小さいほど細い)。 */
  innerRatio?: number
  /** 吹き出しのしっぽの先(図形の中心からの位置、px)。 */
  tail?: { x: number; y: number } | null
  /** 矢印の頭の大きさ(太さに対する倍率)。 */
  headSize?: number
  /** 曲がった矢印の曲がり具合(-1〜1)。 */
  bend?: number
  /** 線を描いていく(手書きで現れる)時間。0 なら始めから全部出す。 */
  drawMs?: Ms
  /** 手書き風のゆらぎ(0〜1)。 */
  roughness?: number
  /** 手書きの線をゆらゆら動かす。 */
  wiggle?: boolean
  /** 集中線・紙吹雪・キラキラの量(0.2〜3、1 が標準)。 */
  density?: number
  /** 動く装飾の速さ(倍率)。 */
  speed?: number
}

export interface ShapeItem extends ItemBase, ShapeProps {
  type: 'shape'
  shape: ShapeKind
  fill: string
  transform: Transform
}

/** 寄り方。docs/PROJECT_FORMAT.md 6.3 を参照。 */
export const ZOOM_METHODS = ['cut', 'smooth', 'linear', 'punch', 'slowPush'] as const
export type ZoomMethod = (typeof ZOOM_METHODS)[number]

/** ズームする範囲(キャンバス座標)。高さは持たず、縦横比は常にキャンバスと同じになる。 */
export interface ZoomRegion {
  x: number
  y: number
  width: number
}

/** 画面の一部に寄って、終了時に戻る演出。このアイテムより下のレイヤーだけを拡大する。 */
export interface ZoomItem extends ItemBase {
  type: 'zoom'
  region: ZoomRegion
  method: ZoomMethod
  /** 寄るのにかける時間。 */
  inMs: Ms
  /** 戻るのにかける時間。 */
  outMs: Ms
}

/**
 * 場面ごとの立ち絵(PROJECT_FORMAT.md 6.2)。
 * show: この区間に出す。そのキャラクターの show を1つでも置くと、show の区間の外では出ない(登場・退場)。
 * hide: この区間だけ隠す。
 * adjust: 出し入れは変えずに、この区間の位置・大きさ・表情だけを変える。
 */
export type PortraitItemKind = 'show' | 'hide' | 'adjust'

export interface PortraitItem extends ItemBase {
  type: 'portrait'
  characterId: CharacterId
  transformOverride: PortraitTransform | null
  /** 無ければ show(以前のプロジェクトの意味のまま)。 */
  kind?: PortraitItemKind
  /** この区間の表情。null か無ければ、セリフごとの表情に従う。 */
  expressionId?: ExpressionId | null
  /** 動画の最後まで表示する(セリフや素材が増えると自動で伸びる)。立ち絵を付けたときに置く区間がこれ。 */
  untilEnd?: boolean
}

export type Item =
  | VoiceItem
  | VideoItem
  | ImageItem
  | TextItem
  | AudioItem
  | ShapeItem
  | PortraitItem
  | ZoomItem

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
  /** 企画メモ(動画の題材・見どころ)。相方の返答や下書きで話題がそれないように AI に渡す。 */
  synopsis?: string
}

export interface CreditsState {
  generated: string
  /** クレジットの最終確認はユーザーの明示的な操作でのみ true にする。 */
  confirmedByUser: boolean
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  /** 送受信の実時刻(エポックミリ秒)。 */
  atMs: number
  /** アシスタントが提案したコマンド列(適用済みでも履歴として残す)。 */
  proposedCommands?: unknown[]
  /** 提案をどうしたか。未定なら undefined。 */
  outcome?: 'applied' | 'rejected'
  /** 返事をしたAI。 */
  generatedBy?: GeneratedBy
  /** 失敗した呼び出し(AIに繋がらない等)の記録。 */
  error?: string
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
  /** AIの発言なら生成元。 */
  generatedBy: GeneratedBy | null
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
  ai: ProjectAiSettings
  editing: EditingSettings
  /** 投稿用の文(タイトル案・概要欄・チャプター)。AIの下書きを利用者が直して使う(A-6, E-4)。 */
  publish?: PublishInfo
  /** 全体の音量と、音の種類ごとの音量。無い項目は 1(100%)。 */
  mix?: AudioMix
  /** 編集中の目印。 */
  markers?: Marker[]
}

/**
 * 音量のつまみ(倍率。1 = 100%、0〜2)。プレビューと書き出しの両方に掛かる。
 * 素材ごとの音量・フェード・ダッキングは、これとは別にそのまま掛かる。
 */
export interface AudioMix {
  /** 全体の音量。 */
  master?: number
  /** セリフ。 */
  voice?: number
  /** BGM・効果音(音声の素材)。 */
  music?: number
  /** 動画の音。 */
  video?: number
}

/** 編集中の目印(メモ付き)。動画には出ない。チャプターの元にもできる。 */
export interface Marker {
  id: string
  atMs: Ms
  text: string
  /** #rrggbb */
  color: string
}

export interface Chapter {
  atMs: Ms
  title: string
}

export interface PublishInfo {
  titles: string[]
  description: string
  chapters: Chapter[]
  generatedBy: GeneratedBy | null
}

/**
 * 編集の自動処理。素材は独立が基本で、ここで選んだものだけを自動で行う(設定の「編集」タブで選ぶ)。
 */
export interface EditingSettings {
  /**
   * セリフを間に足したとき、後ろのセリフをずらして場所を空けるか(V-4)。無いときは空けない(素材は独立が基本)。
   * 空けないと、足したセリフが次のセリフと重なることがあり、重なりの自動振り分けが入っていれば別のレイヤーに置かれる。
   */
  openGapOnVoiceInsert?: boolean
  /** 以前の名前の設定。今は使わない(以前のプロジェクトを読むためだけに残す)。 */
  rippleOnVoiceChange?: boolean
  /** セリフを消したとき、後ろのセリフを前に詰めるか。無いときは詰めない。 */
  closeGapOnVoiceDelete?: boolean
  /** グループのセリフの長さが変わったとき、グループのうち後ろのものを一緒にずらすか。無いときはずらす。 */
  groupFollowsVoice?: boolean
  /** 立ち絵を付けたとき、動画の最後までの表示の区間をタイムラインに置くか。無いときは置く。 */
  autoPortraitTrack?: boolean
  /** 動画を分けた・端を切ったとき、切った所をフェードさせる長さ(0 ならしない)。無いときは 300ms。 */
  cutFadeInMs?: Ms
  cutFadeOutMs?: Ms
  /**
   * 再生位置から先を静止画にしたとき(上書き)、静止画の後に続く動画をフェードインさせるか(長さは cutFadeInMs)。無いときはさせる。
   * 静止画の前はそのコマから続くので、フェードアウトはしない。
   */
  freezeFadeIn?: boolean
  /**
   * 「削除して詰める」(Shift+Delete)で、ほかの素材は考慮せず消した長さだけ詰めるか。
   * 無いときは考慮する(ほかのレイヤーに残った素材がある時間は詰めない)。右クリックのメニューからはどちらも選べる。
   */
  rippleIgnoresOthers?: boolean
  /** ズームを置くときの既定の寄り方。無いときは smooth。 */
  zoomMethod?: ZoomMethod
  /**
   * ズームを置くとき、その時点の動画のコマを静止画にして、ズームとグループにするか。無いときはする。
   * overwrite は動画のその先を静止画で置き換え(ほかは動かない)、insert は動画を止めて後ろをずらす。
   */
  zoomOnStill?: 'off' | 'overwrite' | 'insert'
  /** セリフを続けて追加するときの間。 */
  defaultGapMs: Ms
  /** セリフの間、duckable な音声(BGM など)をこの倍率まで下げる(M-4)。 */
  duckVolume: number
  /** 音量を下げる・戻すのにかける時間。 */
  duckFadeMs: Ms
  /** 誰かが話しているとき、話していないキャラクターの立ち絵を暗くする度合い(0〜0.8)。無いか0なら暗くしない。 */
  portraitDim?: number
  /** 話し始めに立ち絵を小さく跳ねさせる。 */
  portraitHop?: boolean
  /**
   * 同じレイヤーで素材が重なったら、足した・動かした方を空いている同じ種類のレイヤーへ移す(無ければ増やす)。
   * 無いときは有効(false のときだけ重ねたままにする)。
   */
  avoidOverlap?: boolean
}

export interface ProjectAiSettings {
  /** この動画で相方を演じるAI。null ならアプリの既定値。 */
  conversation: ModelRef | null
  /** 企画メモから作った、相方のスタンスと前提知識(shared/ai/briefing.ts)。無ければ使わない。 */
  briefing?: ProjectBriefing | null
}

/** 前提知識の出どころ。memo: 企画メモに書いてある / ai: AI が補った一般的な知識 / user: 利用者が書き足した。 */
export type BriefingFactOrigin = 'memo' | 'ai' | 'user'

/** confirmed だけが AI への依頼に使われる。unverified(未確認)と rejected(使わない)は使わない。 */
export type BriefingFactStatus = 'confirmed' | 'unverified' | 'rejected'

export interface BriefingSource {
  title: string
  url: string
}

/** AI による裏付けの確認の結果。確認済みにするかは利用者が決める(AI の判断だけでは使わない)。 */
export interface BriefingCheck {
  /** supported: 裏付けあり / contradicted: 誤りの可能性が高い / unclear: 確かめられなかった */
  verdict: 'supported' | 'contradicted' | 'unclear'
  reason: string
  /** 出典。ウェブで調べたときだけ(調べていないのに URL を出させない)。 */
  sources: BriefingSource[]
  /** ウェブで調べたか。false なら AI の知識だけでの見直し。 */
  webSearched: boolean
  /** 誤りの可能性があるとき、正しいと思われる内容。 */
  suggestion: string | null
  at: string
}

export interface BriefingFact {
  id: string
  text: string
  origin: BriefingFactOrigin
  /** memo のとき、企画メモの該当箇所(原文のまま)。 */
  quote: string | null
  status: BriefingFactStatus
  /** AI が付けた「確かめるべき点」。 */
  checkHint: string | null
  check: BriefingCheck | null
}

export interface ProjectBriefing {
  /** 相方がこの動画で取る立ち位置(知識の程度・視聴者への向き合い方・避けること)。 */
  stance: string
  facts: BriefingFact[]
  /** 企画メモだけでは分からず、AI が投稿者に確かめたいこと。 */
  questions: string[]
  /** 作ったときの企画メモ。今のメモと違えば作り直しを勧める。 */
  sourceSynopsis: string
  generatedBy: GeneratedBy | null
  updatedAt: string
}
