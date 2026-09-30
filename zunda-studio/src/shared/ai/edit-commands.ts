import { z } from 'zod'

import type { Command } from '../commands/types'
import { ZOOM_METHODS } from '../project/types'

/**
 * 編集AIが出してよいコマンドの一覧と形(AI_EDIT_PROTOCOL.md 5章・6章)。
 * ここに無い操作(素材の削除、合成結果の反映、ペルソナの変更、クレジットの確認など)は AI には出させない。
 * 形の検証はここで行い、中身の整合性(ID の存在など)はコマンドの適用(ドライラン)で確かめる。
 */

/** 1回の提案で出せるコマンドの上限。これを超える大きな変更は分けて提案させる。 */
export const MAX_AI_COMMANDS = 200

const id = z.string().min(1).max(100)
const ms = z.number().min(0).max(24 * 60 * 60 * 1000)
const text = z.string().min(1).max(2000)
const color = z.string().regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/)
const easing = z.enum(['linear', 'easeInCubic', 'easeOutCubic', 'easeInOutCubic'])
const transform = z
  .object({ x: z.number(), y: z.number(), scale: z.number().positive(), rotation: z.number(), opacity: z.number().min(0).max(1) })
  .partial()
const tempId = z.string().min(1).max(40).optional().describe('後のコマンドから参照するための一時ID')

const effect = z.discriminatedUnion('type', [
  z.object({ type: z.literal('fade'), inMs: ms, outMs: ms }),
  z.object({ type: z.literal('scale'), from: z.number().positive(), to: z.number().positive(), easing, durationMs: ms }),
  z.object({ type: z.literal('move'), fromX: z.number(), fromY: z.number(), toX: z.number(), toY: z.number(), easing, durationMs: ms }),
  z.object({ type: z.literal('shake'), amplitudePx: z.number().min(0), frequencyHz: z.number().positive().max(60), durationMs: ms })
])

const portraitTransform = z.object({
  x: z.number(),
  y: z.number(),
  scale: z.number().positive().max(20),
  flipX: z.boolean(),
  anchor: z.enum(['top-left', 'top-center', 'top-right', 'center', 'bottom-left', 'bottom-center', 'bottom-right'])
})

const nullableNumber = z.number().nullable().optional()

export const aiCommandSchema = z.discriminatedUnion('op', [
  // 台本
  z.object({
    op: z.literal('voice.insert'),
    characterId: id,
    text,
    atMs: ms.optional(),
    afterItemId: id.optional(),
    expressionId: id.optional(),
    tempId
  }),
  z.object({ op: z.literal('voice.setText'), itemId: id, text }),
  z.object({ op: z.literal('voice.delete'), itemId: id }),
  z.object({ op: z.literal('voice.move'), itemId: id, afterItemId: id.nullable() }),
  z.object({ op: z.literal('voice.setCharacter'), itemId: id, characterId: id }),
  z.object({ op: z.literal('voice.setExpression'), itemId: id, expressionId: id.nullable() }),
  z.object({
    op: z.literal('voice.setVoiceParams'),
    itemId: id,
    params: z.object({
      speedScale: nullableNumber,
      pitchScale: nullableNumber,
      intonationScale: nullableNumber,
      volumeScale: nullableNumber,
      prePhonemeLength: nullableNumber,
      postPhonemeLength: nullableNumber
    })
  }),
  z.object({ op: z.literal('voice.setSubtitleOverride'), itemId: id, styleId: id.optional(), color: color.optional(), sizeScale: z.number().positive().max(4).optional() }),
  z.object({ op: z.literal('voice.setSubtitleLines'), itemId: id, lines: z.array(z.string().max(200)).max(8).nullable() }),
  z.object({ op: z.literal('voice.setGapAfter'), itemId: id, gapMs: ms }),
  z.object({
    op: z.literal('voice.setReading'),
    itemId: id,
    reading: z.string().max(1000).nullable().describe("読み方(カタカナ。アクセントの位置の後に '、区切りは /)")
  }),
  // アイテム共通
  z.object({ op: z.literal('item.setTimeRange'), itemId: id, startMs: ms.optional(), durationMs: ms.optional() }),
  z.object({ op: z.literal('item.trim'), itemId: id, startMs: ms.optional(), endMs: ms.optional() }),
  z.object({ op: z.literal('item.setLayer'), itemId: id, layerId: id }),
  z.object({ op: z.literal('item.setTransform'), itemId: id, ...transform.shape }),
  z.object({
    op: z.literal('item.setAudio'),
    itemId: id,
    volume: z.number().min(0).max(4).optional(),
    loop: z.boolean().optional(),
    fadeInMs: ms.optional(),
    fadeOutMs: ms.optional(),
    duckable: z.boolean().optional()
  }),
  z.object({ op: z.literal('item.setContent'), itemId: id, text: text.optional(), styleId: id.optional(), fill: color.optional(), shape: z.enum(['rect', 'ellipse']).optional() }),
  z.object({ op: z.literal('item.addEffect'), itemId: id, effect }),
  z.object({ op: z.literal('item.updateEffect'), itemId: id, effectIndex: z.number().int().min(0), effect }),
  z.object({ op: z.literal('item.removeEffect'), itemId: id, effectIndex: z.number().int().min(0) }),
  z.object({ op: z.literal('item.delete'), itemId: id }),
  z.object({ op: z.literal('item.split'), itemId: id, atMs: ms, tempId }),
  z.object({ op: z.literal('item.setSpeed'), itemId: id, rate: z.number().min(0.25).max(4) }),
  z.object({ op: z.literal('item.freezeFrame'), itemId: id, atMs: ms, durationMs: ms, mode: z.enum(['insert', 'overwrite']), tempId }),
  // タイムライン全体の間
  z.object({ op: z.literal('timeline.rippleDelete'), itemIds: z.array(id).min(1).max(200), ignoreOthers: z.boolean().optional() }),
  z.object({ op: z.literal('timeline.closeGap'), atMs: ms }),
  z.object({ op: z.literal('timeline.packLeft'), itemIds: z.array(id).min(1).max(200), keepGaps: z.boolean().optional() }),
  z.object({ op: z.literal('timeline.insertGap'), atMs: ms, durationMs: ms }),
  // 素材の配置(素材そのものの登録・削除は利用者だけが行う)
  z.object({ op: z.literal('media.placeVideo'), assetId: id, atMs: ms, layerId: id.optional(), inMs: ms.optional(), outMs: ms.optional(), transform: transform.optional(), volume: z.number().min(0).max(4).optional(), tempId }),
  z.object({ op: z.literal('media.placeImage'), assetId: id, atMs: ms, durationMs: ms, layerId: id.optional(), transform: transform.optional(), tempId }),
  z.object({
    op: z.literal('media.placeAudio'),
    assetId: id,
    atMs: ms,
    layerId: id.optional(),
    inMs: ms.optional(),
    outMs: ms.optional(),
    durationMs: ms.optional(),
    volume: z.number().min(0).max(4).optional(),
    loop: z.boolean().optional(),
    duckable: z.boolean().optional(),
    tempId
  }),
  z.object({ op: z.literal('media.placeText'), text, atMs: ms, durationMs: ms, layerId: id.optional(), styleId: id.optional(), transform: transform.optional(), tempId }),
  z.object({ op: z.literal('media.placeShape'), shape: z.enum(['rect', 'ellipse']), fill: color, atMs: ms, durationMs: ms, layerId: id.optional(), transform: transform.optional(), tempId }),
  // ズーム
  z.object({
    op: z.literal('zoom.insert'),
    atMs: ms,
    durationMs: ms,
    region: z.object({ x: z.number(), y: z.number(), width: z.number().positive() }),
    method: z.enum(ZOOM_METHODS).optional(),
    inMs: ms.optional(),
    outMs: ms.optional(),
    wholeScreen: z.boolean().optional(),
    tempId
  }),
  z.object({
    op: z.literal('zoom.update'),
    itemId: id,
    region: z.object({ x: z.number(), y: z.number(), width: z.number().positive() }).optional(),
    method: z.enum(ZOOM_METHODS).optional(),
    inMs: ms.optional(),
    outMs: ms.optional()
  }),
  // レイヤー・スタイル・プロジェクト
  z.object({ op: z.literal('layer.insert'), name: z.string().min(1).max(40), index: z.number().int().min(0), tempId }),
  z.object({ op: z.literal('layer.update'), layerId: id, name: z.string().min(1).max(40).optional(), visible: z.boolean().optional(), muted: z.boolean().optional() }),
  z.object({
    op: z.literal('style.upsertSubtitle'),
    styleId: id.optional(),
    baseStyleId: id.optional(),
    props: z
      .object({
        name: z.string().max(40),
        fontSizePx: z.number().min(8).max(300),
        color,
        maxCharsPerLine: z.number().int().min(4).max(60),
        lineHeight: z.number().min(0.8).max(3),
        outline: z.object({ color, widthPx: z.number().min(0).max(40) }).nullable()
      })
      .partial(),
    tempId
  }),
  z.object({ op: z.literal('project.setMeta'), title: z.string().min(1).max(200).optional(), synopsis: z.string().max(4000).optional() }),
  z.object({
    op: z.literal('project.setEditing'),
    openGapOnVoiceInsert: z.boolean().optional(),
    rippleOnVoiceChange: z.boolean().optional(),
    defaultGapMs: ms.optional(),
    duckVolume: z.number().min(0).max(1).optional(),
    duckFadeMs: ms.optional(),
    portraitDim: z.number().min(0).max(0.8).optional(),
    portraitHop: z.boolean().optional()
  }),
  // 場面ごとの立ち絵
  z.object({
    op: z.literal('portrait.insert'),
    characterId: id,
    atMs: ms,
    durationMs: ms,
    kind: z.enum(['show', 'hide', 'adjust']).optional(),
    transform: portraitTransform.nullable().optional(),
    expressionId: id.nullable().optional(),
    transition: z.enum(['none', 'fade', 'pop']).optional(),
    tempId
  }),
  z.object({ op: z.literal('portrait.update'), itemId: id, kind: z.enum(['show', 'hide', 'adjust']).optional(), transform: portraitTransform.nullable().optional(), expressionId: id.nullable().optional() })
])

export type AiCommand = z.infer<typeof aiCommandSchema>

export const editorResponseSchema = z.object({
  reply: z.string().max(4000).describe('利用者への返事。何をどう変えるかを短く説明する。変更しない場合はその理由'),
  commands: z.array(aiCommandSchema).max(MAX_AI_COMMANDS).describe('適用するコマンド。質問への回答だけなら空配列')
})

export type EditorResponse = z.infer<typeof editorResponseSchema>

/** AI が出したコマンドを、アプリのコマンドとして扱う(形は検証済み。未指定の省略可能な値は取り除く)。 */
export function toCommands(commands: readonly AiCommand[]): Command[] {
  return commands.map((command) => stripUndefined(command) as unknown as Command)
}

function stripUndefined(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripUndefined)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .map(([key, entry]) => [key, stripUndefined(entry)])
    )
  }
  return value
}
