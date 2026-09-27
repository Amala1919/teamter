/**
 * プロジェクトへの変更はすべてこのコマンドを経由する。
 * UI の手動編集と AI チャットは同一のコマンドを使う。仕様は docs/AI_EDIT_PROTOCOL.md を参照。
 *
 * Phase 0 では骨格の検証に必要な最小の集合のみ実装している。
 * 残りは各フェーズで追加する(プロトコル仕様側には全体が定義済み)。
 */

import type { GeneratedBy, ModelRef } from '../ai/types'
import type {
  AiPersona,
  CharacterAuthorRole,
  CharacterId,
  ExpressionId,
  ItemId,
  LayerId,
  Ms,
  SubtitleStyleId
} from '../project/types'

export interface ProjectSetMeta {
  op: 'project.setMeta'
  title?: string
}

/** この動画で相方を演じるAIを決める。null ならアプリの既定値に従う。 */
export interface ProjectSetConversationAi {
  op: 'project.setConversationAi'
  model: ModelRef | null
}

export interface LayerInsert {
  op: 'layer.insert'
  name: string
  index: number
  /** AI が後続コマンドから参照するための一時ID。適用時に実IDへ解決される。 */
  tempId?: string
}

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

export interface VoiceInsert {
  op: 'voice.insert'
  characterId: CharacterId
  text: string
  atMs: Ms
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

export interface VoiceSetSubtitleOverride {
  op: 'voice.setSubtitleOverride'
  itemId: ItemId
  styleId?: SubtitleStyleId
  color?: string
  sizeScale?: number
}

export type Command =
  | ProjectSetMeta
  | ProjectSetConversationAi
  | LayerInsert
  | CharacterCreate
  | CharacterSetPersona
  | ItemSetTimeRange
  | ItemSetLayer
  | ItemDelete
  | VoiceInsert
  | VoiceSetText
  | VoiceSetSubtitleOverride

export type CommandOp = Command['op']

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
