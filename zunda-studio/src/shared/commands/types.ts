/**
 * プロジェクトへの変更はすべてこのコマンドを経由する。
 * UI の手動編集と AI チャットは同一のコマンドを使う。仕様は docs/AI_EDIT_PROTOCOL.md を参照。
 *
 * 新しい操作を足すときは、ここに型を1つ足し、commands/handlers/ に処理を1つ足す。
 * 処理表は全ての op を網羅することが型で強制されるので、足し忘れはコンパイルエラーになる。
 */

import type { GeneratedBy, ModelRef } from '../ai/types'
import type {
  AiPersona,
  Asset,
  AssetId,
  AssetLicense,
  PortraitConfig,
  CharacterAuthorRole,
  Effect,
  ShapeItem,
  Transform,
  ZoomMethod,
  ZoomRegion,
  CharacterId,
  ExpressionId,
  ItemId,
  LayerId,
  Ms,
  SubtitleStyle,
  SubtitleStyleId,
  SynthesisResult,
  VoiceConfig,
  VoiceParams
} from '../project/types'

// ------------------------------------------------------------------ プロジェクト

export interface ProjectSetMeta {
  op: 'project.setMeta'
  title?: string
}

/** この動画で相方を演じるAIを決める。null ならアプリの既定値に従う。 */
export interface ProjectSetConversationAi {
  op: 'project.setConversationAi'
  model: ModelRef | null
}

export interface ProjectSetEditing {
  op: 'project.setEditing'
  rippleOnVoiceChange?: boolean
  defaultGapMs?: Ms
  duckVolume?: number
  duckFadeMs?: Ms
}

/**
 * 概要欄のクレジット文を保存する。文を変えたら確認済みの印は外れる(確認し直してもらう)。
 * confirmedByUser は利用者の明示的な操作でのみ真にする(AI には公開しない)。
 */
export interface CreditsSet {
  op: 'credits.set'
  generated?: string
  confirmedByUser?: boolean
}

// ------------------------------------------------------------------ レイヤー

export interface LayerInsert {
  op: 'layer.insert'
  name: string
  index: number
  /** AI が後続コマンドから参照するための一時ID。適用時に実IDへ解決される。 */
  tempId?: string
}

/** レイヤーの名前・表示・ロック・ミュートを変える。 */
export interface LayerUpdate {
  op: 'layer.update'
  layerId: LayerId
  name?: string
  visible?: boolean
  locked?: boolean
  muted?: boolean
}

// ------------------------------------------------------------------ 素材

/** 素材を登録する。ライセンス情報は必須(書き出し時のクレジット集約に使う。L-4)。 */
export interface AssetAdd {
  op: 'asset.add'
  asset: Asset
  tempId?: string
}

export interface AssetUpdateLicense {
  op: 'asset.updateLicense'
  assetId: AssetId
  license: AssetLicense
}

/** 使われていない素材だけ外せる。 */
export interface AssetRemove {
  op: 'asset.remove'
  assetId: AssetId
}

// ------------------------------------------------------------------ 字幕スタイル

/** 字幕スタイルを作る(styleId 省略時)か、部分的に更新する。 */
export interface StyleUpsertSubtitle {
  op: 'style.upsertSubtitle'
  styleId?: SubtitleStyleId
  /** 新規作成時に元にするスタイル。省略時は最初のスタイル。 */
  baseStyleId?: SubtitleStyleId
  props: Partial<Omit<SubtitleStyle, 'id'>>
  tempId?: string
}

// ------------------------------------------------------------------ キャラクター

export interface CharacterCreate {
  op: 'character.create'
  name: string
  /** 既定は 'user'(人間が書く役)。AIが演じる相方なら 'ai' を指定し persona を設定する。 */
  authorRole?: CharacterAuthorRole
  persona?: AiPersona
  engineId: string
  speakerId: number
  speakerName: string
  subtitleStyleId?: SubtitleStyleId
  creditText?: string
  tempId?: string
}

/** 相方の性格・口調を設定する。AIが自分の人格を勝手に書き換えないよう、これはUIからのみ発行する。 */
export interface CharacterSetPersona {
  op: 'character.setPersona'
  characterId: CharacterId
  persona: AiPersona
}

/** キャラクターの既定値を変える。声が変わる変更は、そのキャラクターのセリフを合成し直す対象にする。 */
export interface CharacterUpdate {
  op: 'character.update'
  characterId: CharacterId
  name?: string
  authorRole?: CharacterAuthorRole
  /** AIの役にするときは persona も同時に渡せる(persona が無いと AI の役にできないため)。 */
  persona?: AiPersona
  voice?: Partial<VoiceConfig>
  subtitleStyleId?: SubtitleStyleId
  creditText?: string
}

/** 立ち絵の設定を丸ごと置き換える(素材マネージャーで編集した結果を反映する)。null で立ち絵を外す。 */
export interface CharacterSetPortrait {
  op: 'character.setPortrait'
  characterId: CharacterId
  portrait: PortraitConfig | null
}

export interface CharacterDelete {
  op: 'character.delete'
  characterId: CharacterId
}

// ------------------------------------------------------------------ アイテム共通

export interface ItemSetTimeRange {
  op: 'item.setTimeRange'
  itemId: ItemId
  startMs?: Ms
  durationMs?: Ms
}

export interface ItemSetLayer {
  op: 'item.setLayer'
  itemId: ItemId
  layerId: LayerId
}

export interface ItemDelete {
  op: 'item.delete'
  itemId: ItemId
}

// ------------------------------------------------------------------ ボイス

/**
 * セリフを挿入する。atMs か afterItemId のどちらか一方で位置を決める。
 * afterItemId を使うとそのセリフの直後(既定の間を空けて)に入り、後ろのアイテムは追従設定に従ってずれる。
 */
export interface VoiceInsert {
  op: 'voice.insert'
  characterId: CharacterId
  text: string
  atMs?: Ms
  afterItemId?: ItemId
  layerId?: LayerId
  expressionId?: ExpressionId
  /** AIが書いたセリフの生成元。AI自身には指定させず、アプリが付与する。 */
  generatedBy?: GeneratedBy
  tempId?: string
}

export interface VoiceSetText {
  op: 'voice.setText'
  itemId: ItemId
  text: string
}

/** セリフを削除し、追従設定に従って後ろを前に詰める。 */
export interface VoiceDelete {
  op: 'voice.delete'
  itemId: ItemId
}

/** 発話順を変える。afterItemId が null なら先頭へ。 */
export interface VoiceMove {
  op: 'voice.move'
  itemId: ItemId
  afterItemId: ItemId | null
}

export interface VoiceSetCharacter {
  op: 'voice.setCharacter'
  itemId: ItemId
  characterId: CharacterId
}

export interface VoiceSetExpression {
  op: 'voice.setExpression'
  itemId: ItemId
  expressionId: ExpressionId | null
}

/** 発話パラメータをキャラクターの既定値から上書きする。null の項目は上書きを外す。 */
export interface VoiceSetVoiceParams {
  op: 'voice.setVoiceParams'
  itemId: ItemId
  params: { [K in keyof VoiceParams]?: VoiceParams[K] | null }
}

export interface VoiceSetSubtitleOverride {
  op: 'voice.setSubtitleOverride'
  itemId: ItemId
  styleId?: SubtitleStyleId
  color?: string
  sizeScale?: number
}

/** 字幕の改行位置を手で決める。null なら自動改行に戻す。 */
export interface VoiceSetSubtitleLines {
  op: 'voice.setSubtitleLines'
  itemId: ItemId
  lines: string[] | null
}

/** 次のセリフまでの間を決める。後ろのアイテムを全てずらす。 */
export interface VoiceSetGapAfter {
  op: 'voice.setGapAfter'
  itemId: ItemId
  gapMs: Ms
}

/**
 * 合成結果を反映する。アプリの内部処理だけが発行し、AI には公開しない。
 * 合成を要求した時点のテキストと違えば(その間に書き換えられたなら)古い結果として拒否する。
 */
export interface VoiceApplySynthesis {
  op: 'voice.applySynthesis'
  itemId: ItemId
  expectedText: string
  synthesis: SynthesisResult
}

// ------------------------------------------------------------------ 素材の配置

/** 動画の区間を配置する。inMs/outMs を省略すると素材の全体。 */
export interface MediaPlaceVideo {
  op: 'media.placeVideo'
  assetId: AssetId
  layerId?: LayerId
  atMs: Ms
  inMs?: Ms
  outMs?: Ms
  transform?: Partial<Transform>
  volume?: number
  tempId?: string
}

export interface MediaPlaceImage {
  op: 'media.placeImage'
  assetId: AssetId
  layerId?: LayerId
  atMs: Ms
  durationMs: Ms
  transform?: Partial<Transform>
  tempId?: string
}

/** BGM・効果音を配置する。durationMs を省略すると素材の区間の長さ(ループなら素材の区間より長くできる)。 */
export interface MediaPlaceAudio {
  op: 'media.placeAudio'
  assetId: AssetId
  layerId?: LayerId
  atMs: Ms
  inMs?: Ms
  outMs?: Ms
  durationMs?: Ms
  volume?: number
  loop?: boolean
  duckable?: boolean
  tempId?: string
}

export interface MediaPlaceText {
  op: 'media.placeText'
  text: string
  layerId?: LayerId
  atMs: Ms
  durationMs: Ms
  styleId?: SubtitleStyleId
  transform?: Partial<Transform>
  tempId?: string
}

export interface MediaPlaceShape {
  op: 'media.placeShape'
  shape: ShapeItem['shape']
  fill: string
  layerId?: LayerId
  atMs: Ms
  durationMs: Ms
  transform?: Partial<Transform>
  tempId?: string
}

// ------------------------------------------------------------------ アイテム共通(続き)

/**
 * アイテムの端を動かす(タイムラインでの伸縮)。動画・音声は素材の切り出し位置も一緒に動くので、
 * 左端を右へ縮めると、映像はその分だけ先から始まる。
 */
export interface ItemTrim {
  op: 'item.trim'
  itemId: ItemId
  startMs?: Ms
  endMs?: Ms
}

export interface ItemSetTransform {
  op: 'item.setTransform'
  itemId: ItemId
  x?: number
  y?: number
  scale?: number
  rotation?: number
  opacity?: number
}

/** 音量・ループ・フェード・ダッキングの対象か。動画は音量だけ持つ。 */
export interface ItemSetAudio {
  op: 'item.setAudio'
  itemId: ItemId
  volume?: number
  loop?: boolean
  fadeInMs?: Ms
  fadeOutMs?: Ms
  duckable?: boolean
}

/** テロップの文字・図形の色など、アイテムの中身を変える。 */
export interface ItemSetContent {
  op: 'item.setContent'
  itemId: ItemId
  text?: string
  styleId?: SubtitleStyleId
  fill?: string
  shape?: ShapeItem['shape']
}

export interface ItemAddEffect {
  op: 'item.addEffect'
  itemId: ItemId
  effect: Effect
}

export interface ItemUpdateEffect {
  op: 'item.updateEffect'
  itemId: ItemId
  effectIndex: number
  effect: Effect
}

export interface ItemRemoveEffect {
  op: 'item.removeEffect'
  itemId: ItemId
  effectIndex: number
}

// ------------------------------------------------------------------ ズーム

/**
 * ズーム枠を置く。範囲は画面からはみ出さないよう、縦横比を保ったまま収める。
 * wholeScreen が真なら一番上のレイヤーに置き、立ち絵・字幕も含めて拡大する。
 */
export interface ZoomInsert {
  op: 'zoom.insert'
  atMs: Ms
  durationMs: Ms
  region: ZoomRegion
  method?: ZoomMethod
  inMs?: Ms
  outMs?: Ms
  wholeScreen?: boolean
  layerId?: LayerId
  tempId?: string
}

export interface ZoomUpdate {
  op: 'zoom.update'
  itemId: ItemId
  region?: ZoomRegion
  method?: ZoomMethod
  inMs?: Ms
  outMs?: Ms
}

export type Command =
  | ProjectSetMeta
  | ProjectSetConversationAi
  | ProjectSetEditing
  | CreditsSet
  | LayerInsert
  | LayerUpdate
  | AssetAdd
  | AssetUpdateLicense
  | AssetRemove
  | StyleUpsertSubtitle
  | CharacterCreate
  | CharacterSetPersona
  | CharacterUpdate
  | CharacterSetPortrait
  | CharacterDelete
  | ItemSetTimeRange
  | ItemSetLayer
  | ItemDelete
  | ItemTrim
  | ItemSetTransform
  | ItemSetAudio
  | ItemSetContent
  | ItemAddEffect
  | ItemUpdateEffect
  | ItemRemoveEffect
  | MediaPlaceVideo
  | MediaPlaceImage
  | MediaPlaceAudio
  | MediaPlaceText
  | MediaPlaceShape
  | ZoomInsert
  | ZoomUpdate
  | VoiceInsert
  | VoiceSetText
  | VoiceDelete
  | VoiceMove
  | VoiceSetCharacter
  | VoiceSetExpression
  | VoiceSetVoiceParams
  | VoiceSetSubtitleOverride
  | VoiceSetSubtitleLines
  | VoiceSetGapAfter
  | VoiceApplySynthesis

export type CommandOp = Command['op']
export type CommandOf<K extends CommandOp> = Extract<Command, { op: K }>

/** コマンドが適用できなかったことを表す。適用は全件成功か全件不適用のいずれかになる。 */
export class CommandError extends Error {
  constructor(
    message: string,
    readonly op: CommandOp
  ) {
    super(message)
    this.name = 'CommandError'
  }
}
