/**
 * プロジェクトへの変更はすべてこのコマンドを経由する。
 * UI の手動編集と AI チャットは同一のコマンドを使う。仕様は docs/AI_EDIT_PROTOCOL.md を参照。
 *
 * 新しい操作を足すときは、ここに型を1つ足し、commands/handlers/ に処理を1つ足す。
 * 処理表は全ての op を網羅することが型で強制されるので、足し忘れはコンパイルエラーになる。
 */

import type { GeneratedBy, ModelRef } from '../ai/types'
import type { ProjectTemplate } from '../project/templates'
import type {
  AiPersona,
  ProjectBriefing,
  Asset,
  AssetId,
  AssetLicense,
  PreviewResolution,
  ChatMessage,
  PublishInfo,
  PortraitConfig,
  PortraitItemKind,
  PortraitTransform,
  CharacterAuthorRole,
  ColorAdjust,
  Crop,
  Effect,
  Item,
  MediaFrame,
  ShapeItem,
  ShapeKind,
  ShapeProps,
  TransitionKind,
  Transform,
  ZoomMethod,
  ZoomRegion,
  CharacterId,
  ExpressionId,
  ItemId,
  LayerId,
  LiveEntryId,
  LiveSession,
  LiveSessionId,
  Ms,
  SubtitleStyle,
  SubtitleStyleId,
  SynthesisResult,
  TextLook,
  VoiceConfig,
  VolumeKey,
  VoiceParams
} from '../project/types'

// ------------------------------------------------------------------ プロジェクト

export interface ProjectSetMeta {
  op: 'project.setMeta'
  title?: string
  synopsis?: string
}

/** この動画で相方を演じるAIを決める。null ならアプリの既定値に従う。 */
export interface ProjectSetConversationAi {
  op: 'project.setConversationAi'
  model: ModelRef | null
}

/**
 * 企画メモから作った相方のスタンスと前提知識を保存する(null で消す)。
 * 利用者の確認を経てから保存する前提で、AI の編集提案からは使わせない。
 */
export interface ProjectSetBriefing {
  op: 'project.setBriefing'
  briefing: ProjectBriefing | null
}

/** 全体の音量と、音の種類ごとの音量(0〜2 の倍率。1 = 100%)。null で 100% に戻す。 */
export interface ProjectSetMix {
  op: 'project.setMix'
  master?: number | null
  voice?: number | null
  music?: number | null
  video?: number | null
}

export interface ProjectSetEditing {
  op: 'project.setEditing'
  openGapOnVoiceInsert?: boolean
  /** 以前の名前。指定しても何も起きない。 */
  rippleOnVoiceChange?: boolean
  closeGapOnVoiceDelete?: boolean
  groupFollowsVoice?: boolean
  autoPortraitTrack?: boolean
  cutFadeInMs?: Ms
  cutFadeOutMs?: Ms
  freezeFadeIn?: boolean
  rippleIgnoresOthers?: boolean
  zoomMethod?: ZoomMethod
  zoomOnStill?: 'off' | 'overwrite' | 'insert'
  defaultGapMs?: Ms
  duckVolume?: number
  duckFadeMs?: Ms
  portraitDim?: number
  portraitHop?: boolean
  avoidOverlap?: boolean
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

/** 編集チャットの発言を記録する。取り消しの対象にはしない(アプリの内部処理だけが発行する)。 */
export interface ChatAppend {
  op: 'chat.append'
  message: ChatMessage
}

export interface ChatSetOutcome {
  op: 'chat.setOutcome'
  messageId: string
  outcome: 'applied' | 'rejected'
}

/** 投稿用の文を保存する(利用者が直した内容をそのまま置き換える)。 */
export interface PublishSet {
  op: 'publish.set'
  publish: PublishInfo
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
  /** タイムラインでの色(#rrggbb)。null で種類ごとの色に戻す。 */
  color?: string | null
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

/** 動画のプレビューの画質を変える(書き出しには関係しない)。 */
export interface AssetSetPreview {
  op: 'asset.setPreview'
  assetId: AssetId
  preview: PreviewResolution
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
  /** タイムラインでの色(#rrggbb)。null で自動の色分けに戻す。 */
  timelineColor?: string | null
  /** アプリに保存したキャラクターとの結び付き。null で外す。 */
  libraryId?: string | null
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

/** 字幕に出す文字を、読み上げる文字とは別にする。null でセリフと同じに戻す。声は変わらない。 */
export interface VoiceSetDisplayText {
  op: 'voice.setDisplayText'
  itemId: ItemId
  text: string | null
}

/** セリフの字幕を出す・出さない(声はそのまま)。複数のセリフにまとめて使える。 */
export interface VoiceSetSubtitleHidden {
  op: 'voice.setSubtitleHidden'
  itemIds: ItemId[]
  hidden: boolean
}

/** 読み方を直す(カタカナとアクセント記号)。null で自動の読みに戻す。 */
export interface VoiceSetReading {
  op: 'voice.setReading'
  itemId: ItemId
  reading: string | null
}

/**
 * 合成結果を捨てて、合成し直させる(ユーザー辞書を変えたとき)。engineId を指定すると、その音声エンジンのセリフだけ。
 * アプリの内部処理だけが発行する。
 */
export interface VoiceInvalidateSynthesis {
  op: 'voice.invalidateSynthesis'
  engineId?: string
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

/** 図形・装飾を置く。props の width・height を省くと画面いっぱいの大きさになる(以前の図形と同じ)。 */
export interface MediaPlaceShape {
  op: 'media.placeShape'
  shape: ShapeItem['shape']
  fill: string
  layerId?: LayerId
  atMs: Ms
  durationMs: Ms
  transform?: Partial<Transform>
  props?: ShapeProps
  effects?: Effect[]
  tempId?: string
}

/**
 * 図形の形・色・見た目を変える(選んだ複数の図形にまとめて)。props の項目を null にすると形ごとの既定に戻す。
 * replace なら今の見た目の調整を捨てて props だけにする(大きさは残す。ひな形を当てるとき)。
 */
export interface ItemSetShape {
  op: 'item.setShape'
  itemIds: ItemId[]
  shape?: ShapeKind
  fill?: string
  props?: { [K in keyof ShapeProps]?: ShapeProps[K] | null }
  replace?: boolean
}

/** 音量の折れ点を置き換える(アイテム内の時刻と倍率)。null か空で一定に戻す。 */
export interface ItemSetVolumeKeys {
  op: 'item.setVolumeKeys'
  itemId: ItemId
  keys: VolumeKey[] | null
}

/** 動画・画像の切り抜き・枠(ワイプの見た目)・色の調整を変える(複数にまとめて)。null で外す。 */
export interface ItemSetMediaLook {
  op: 'item.setMediaLook'
  itemIds: ItemId[]
  crop?: Crop | null
  frame?: MediaFrame | null
  adjust?: ColorAdjust | null
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

/**
 * テロップだけの見た目を変える(選んだ複数のテロップにまとめて)。look の項目を null にすると、スタイルに戻す。
 * replace なら、今の見た目を捨てて look だけにする(見た目の貼り付け・ひな形)。
 */
export interface ItemSetTextLook {
  op: 'item.setTextLook'
  itemIds: ItemId[]
  look: { [K in keyof TextLook]?: TextLook[K] | null }
  replace?: boolean
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

/**
 * アイテムを指定の時刻で2つに分ける。後ろ半分は新しいアイテムになる(tempId で ID を受け取れる)。
 * 動画・音声は素材の切り出し位置も分け、フェードは前半に入り・後半に出だけを残す。セリフとズームは分けられない。
 */
export interface ItemSplit {
  op: 'item.split'
  itemId: ItemId
  atMs: Ms
  tempId?: string
}

/**
 * コピーしたアイテムを貼り付ける。一番早いものが atMs に来るよう、並びを保ったまま置く。
 * 新しい ID は tempIdPrefix + 番号(0から)で受け取れる。レイヤーが無くなっていたら元の種類の既定のレイヤーに置く。
 */
export interface ItemPaste {
  op: 'item.paste'
  items: Item[]
  atMs: Ms
  tempIdPrefix?: string
}

/**
 * 動画をその時刻のコマで止めて、静止画として durationMs の間表示する(フリーズフレーム)。
 * insert: 止めている間、後ろのアイテムをずらす(その時刻にかかっているズームは、静止画の間も寄ったまま伸ばす)。
 * overwrite: 後ろはずらさず、動画のその先を静止画で置き換える。
 * atMs が動画の終わりちょうどなら、最後のコマで止める。静止画のアイテムは tempId で受け取れる。
 */
export interface ItemFreezeFrame {
  op: 'item.freezeFrame'
  itemId: ItemId
  atMs: Ms
  durationMs: Ms
  mode: 'insert' | 'overwrite'
  tempId?: string
}

/** 動画の再生速度を変える。切り出す区間はそのままで、画面上の長さが変わる。 */
export interface ItemSetSpeed {
  op: 'item.setSpeed'
  itemId: ItemId
  rate: number
}

/** アイテムをロックする・解く(ロック中のアイテムはほかのコマンドで変えられない)。 */
export interface ItemSetLocked {
  op: 'item.setLocked'
  itemId: ItemId
  locked: boolean
}

// ------------------------------------------------------------------ タイムライン全体

/**
 * アイテムを消し、空いた時間を詰める(後ろのアイテムを前へずらす)。
 * 既定では、ほかのレイヤーに残った素材がある時間は詰めない。
 * ignoreOthers: true なら、ほかの素材は考慮せず、消した長さだけ詰める。
 */
export interface TimelineRippleDelete {
  op: 'timeline.rippleDelete'
  itemIds: ItemId[]
  ignoreOthers?: boolean
}

/**
 * 前の素材から切り替える(クロスフェード・ワイプなど)。直前で終わる画面の素材と durationMs だけ重ね、この素材に登場の切り替えを付ける。
 * 重ねる分は前の素材の続きを使う(足りなければこの素材の手前を使う)。この素材は前の素材より上のレイヤーへ移す。
 * 直前に素材が無ければ、登場の切り替えだけを付ける。
 */
export interface TimelineCrossTransition {
  op: 'timeline.crossTransition'
  itemId: ItemId
  kind: TransitionKind
  durationMs: Ms
}

/**
 * 動画の中の区間(タイムラインの時刻)をまとめて詰める。待ち時間(相手のターン・ロード)を飛ばすのに使う。
 * cut: その区間を切り取る / speed: その区間だけ rate 倍で早送りにする(label なら「▶▶ ×4」のテロップも置く)。
 * ripple(既定 true)なら、短くなった分だけ後ろの素材を前へ詰める。
 */
export interface VideoCondense {
  op: 'video.condense'
  itemId: ItemId
  ranges: { fromMs: Ms; toMs: Ms }[]
  mode: 'cut' | 'speed'
  rate?: number
  ripple?: boolean
  label?: boolean
}

/** atMs の位置にある「何も置かれていない時間」を詰める。 */
export interface TimelineCloseGap {
  op: 'timeline.closeGap'
  atMs: Ms
}

/**
 * 選んだアイテムを左(前)へ詰める。前にある同じレイヤーの素材(セリフはほかのレイヤーのセリフも)の終わり、無ければ 0 秒まで。
 * 選んでいないものは動かさない。グループに入っていれば仲間も一緒に動かす。ロック中のものは動かさない。
 * keepGaps: true なら選んだもの同士の間を保ったまま、まとめて動かす。false(既定)なら選んだもの同士の間も詰める。
 */
export interface TimelinePackLeft {
  op: 'timeline.packLeft'
  itemIds: ItemId[]
  keepGaps?: boolean
}

/** atMs 以降に始まるアイテムを後ろへずらし、空白を作る。 */
export interface TimelineInsertGap {
  op: 'timeline.insertGap'
  atMs: Ms
  durationMs: Ms
}

/**
 * 同じレイヤーで重なっている素材を、空いている同じ種類のレイヤーへ振り分ける(無ければレイヤーを増やす)。
 * 後から始まる方を動かす。立ち絵の区間とズームは動かさない。
 */
export interface TimelineArrangeOverlaps {
  op: 'timeline.arrangeOverlaps'
}

/** タイムラインでの素材の色を変える(動画には出ない)。null ならレイヤー・種類の色に戻す。ロック中の素材も変えられる。 */
export interface ItemSetColor {
  op: 'item.setColor'
  itemIds: ItemId[]
  color: string | null
}

/**
 * 選んだアイテムを1つのグループにする(2つ以上)。既に別のグループに入っているものは、そのグループごと新しいグループにまとめる。
 * グループのアイテムは一緒に動き、グループのセリフの尺が変わると後ろのものが合わせてずれる。
 */
export interface ItemGroup {
  op: 'item.group'
  itemIds: ItemId[]
  tempId?: string
}

/** 選んだアイテムを入っているグループから外す(グループに1つしか残らなければ、そのグループも解く)。 */
export interface ItemUngroup {
  op: 'item.ungroup'
  itemIds: ItemId[]
}

/** 素材の無いレイヤーを消す(既定のレイヤーは残す)。 */
export interface LayerRemoveEmpty {
  op: 'layer.removeEmpty'
}

// ------------------------------------------------------------------ 立ち絵(場面ごと)

/** 登場・退場の動き。fade: ふわっと / pop: ぽんっと / none: 動き無し。 */
export type PortraitTransition = 'none' | 'fade' | 'pop'

/**
 * 場面ごとの立ち絵を置く(kind の意味は PortraitItem を参照)。
 * transition は show のときの登場・退場の動き(エフェクトとして付く。あとから変えられる)。
 */
export interface PortraitInsert {
  op: 'portrait.insert'
  characterId: CharacterId
  atMs: Ms
  durationMs: Ms
  kind?: PortraitItemKind
  transform?: PortraitTransform | null
  expressionId?: ExpressionId | null
  transition?: PortraitTransition
  layerId?: LayerId
  tempId?: string
}

/** 場面ごとの立ち絵の、種類・位置・表情を変える。null は「上書きしない(全体の設定に従う)」。 */
export interface PortraitUpdate {
  op: 'portrait.update'
  itemId: ItemId
  kind?: PortraitItemKind
  transform?: PortraitTransform | null
  expressionId?: ExpressionId | null
  /** 動画の最後まで表示する(自動で伸ばす)か。 */
  untilEnd?: boolean
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

// ------------------------------------------------------------------ ひな形

/**
 * ひな形(オープニング・エンディングなど)を atMs に入れる。ripple なら後ろをずらして場所を空ける。
 * 素材・字幕スタイル・レイヤーは入れる先のものに合わせ(無ければ足す)、キャラクターがいないセリフは入れない。
 * 入れたアイテムの ID は tempIdPrefix + 番号で受け取れる。アプリの内部処理だけが発行する。
 */
export interface TemplateInsert {
  op: 'template.insert'
  template: ProjectTemplate
  atMs: Ms
  ripple?: boolean
  tempIdPrefix?: string
}

// ------------------------------------------------------------------ 目印(編集中のメモ)

/** 目印を置く。動画には出ない(編集のメモ・チャプターの元)。 */
export interface MarkerAdd {
  op: 'marker.add'
  atMs: Ms
  text?: string
  /** #rrggbb */
  color?: string
  tempId?: string
}

export interface MarkerUpdate {
  op: 'marker.update'
  markerId: string
  atMs?: Ms
  text?: string
  color?: string
}

export interface MarkerRemove {
  op: 'marker.remove'
  markerId: string
}

// ------------------------------------------------------------------ ライブの記録

/** ライブの記録をプロジェクトに取り込む。既にあれば発言を足し、採用済みの印や手で直したずれは残す。 */
export interface LiveImportSession {
  op: 'live.importSession'
  session: LiveSession
}

/** 録画とのずれを直す(R-6)。 */
export interface LiveSetOffset {
  op: 'live.setOffset'
  sessionId: LiveSessionId
  offsetMs: Ms
}

/** どの録画素材の会話か。null で結び付けを外す。 */
export interface LiveLinkRecording {
  op: 'live.linkRecording'
  sessionId: LiveSessionId
  assetId: AssetId | null
}

export interface LiveRemoveSession {
  op: 'live.removeSession'
  sessionId: LiveSessionId
}

/**
 * ライブの発言を台本に採用する(R-5)。自分の発言は自分の役、相方の発言は相方の役のセリフになる。
 * atMs を省略すると、発言がタイムラインのどこにあたるかから決める。
 */
export interface ScriptAdoptLiveEntry {
  op: 'script.adoptLiveEntry'
  sessionId: LiveSessionId
  entryId: LiveEntryId
  atMs?: Ms
  /** 話者を明示する(役に合うキャラクターが複数いるとき)。 */
  characterId?: CharacterId
  tempId?: string
}

export type Command =
  | ProjectSetMeta
  | ProjectSetConversationAi
  | ProjectSetEditing
  | ProjectSetMix
  | ProjectSetBriefing
  | CreditsSet
  | PublishSet
  | ChatAppend
  | ChatSetOutcome
  | LayerInsert
  | LayerUpdate
  | AssetAdd
  | AssetSetPreview
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
  | ItemSetTextLook
  | ItemAddEffect
  | ItemUpdateEffect
  | ItemRemoveEffect
  | ItemSplit
  | ItemPaste
  | ItemSetSpeed
  | ItemFreezeFrame
  | ItemSetLocked
  | TimelineRippleDelete
  | TimelineCloseGap
  | TimelineCrossTransition
  | VideoCondense
  | TimelinePackLeft
  | TimelineInsertGap
  | TimelineArrangeOverlaps
  | ItemSetColor
  | ItemGroup
  | ItemUngroup
  | LayerRemoveEmpty
  | MediaPlaceVideo
  | MediaPlaceImage
  | MediaPlaceAudio
  | MediaPlaceText
  | MediaPlaceShape
  | ItemSetShape
  | ItemSetMediaLook
  | ItemSetVolumeKeys
  | PortraitInsert
  | PortraitUpdate
  | ZoomInsert
  | ZoomUpdate
  | TemplateInsert
  | MarkerAdd
  | MarkerUpdate
  | MarkerRemove
  | LiveImportSession
  | LiveSetOffset
  | LiveLinkRecording
  | LiveRemoveSession
  | ScriptAdoptLiveEntry
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
  | VoiceSetReading
  | VoiceSetDisplayText
  | VoiceSetSubtitleHidden
  | VoiceInvalidateSynthesis
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
