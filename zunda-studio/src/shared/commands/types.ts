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
}

// ------------------------------------------------------------------ レイヤー

export interface LayerInsert {
  op: 'layer.insert'
  name: string
  index: number
  /** AI が後続コマンドから参照するための一時ID。適用時に実IDへ解決される。 */
  tempId?: string
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

export type Command =
  | ProjectSetMeta
  | ProjectSetConversationAi
  | ProjectSetEditing
  | LayerInsert
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
