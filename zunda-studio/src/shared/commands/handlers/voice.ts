import type { Item, Project, VoiceItem, VoiceParams } from '../../project/types'
import {
  autoSubtitleLines,
  defaultVoiceLayerId,
  earliestStartFrom,
  estimateSpeechDurationMs,
  fail,
  findVoiceItem,
  invalidateSynthesis,
  itemEnd,
  refreshSubtitleLines,
  requireLayer,
  requireNonEmptyText,
  shiftItemsFrom,
  subtitleText,
  type HandlerTable
} from '../env'

type VoiceHandlers = Pick<
  HandlerTable,
  | 'voice.insert'
  | 'voice.setText'
  | 'voice.setReading'
  | 'voice.setDisplayText'
  | 'voice.invalidateSynthesis'
  | 'voice.delete'
  | 'voice.move'
  | 'voice.setCharacter'
  | 'voice.setExpression'
  | 'voice.setVoiceParams'
  | 'voice.setSubtitleOverride'
  | 'voice.setSubtitleLines'
  | 'voice.setGapAfter'
  | 'voice.applySynthesis'
>

const VOICE_PARAM_RANGES: Record<keyof VoiceParams, [number, number]> = {
  speedScale: [0.5, 2],
  pitchScale: [-0.15, 0.15],
  intonationScale: [0, 2],
  volumeScale: [0, 2],
  prePhonemeLength: [0, 1.5],
  postPhonemeLength: [0, 1.5]
}

/**
 * セリフの操作で自動でずらすのはセリフだけ。録画・BGM・効果音・画像・立ち絵・ズームは、利用者が置いた場所から動かさない
 * (セリフを足しただけで、合わせて置いた素材がずれてしまうのを防ぐ)。
 */
const isLine = (item: Item): boolean => item.type === 'voice'

/**
 * セリフが占めていた場所を詰める。後ろに続くセリフのうち最も早いものが、このセリフの開始位置に来る。
 */
function closeGap(draft: Project, item: VoiceItem): void {
  const exclude = new Set([item.id])
  const next = earliestStartFrom(draft, itemEnd(item), exclude, isLine)
  if (next === null) return
  shiftItemsFrom(draft, itemEnd(item), -(next - item.startMs), exclude, isLine)
}

/** 指定時刻に、尺 + 間 の分だけ後ろのセリフをずらして場所を空ける。 */
function openGap(draft: Project, atMs: number, lengthMs: number, excludeId: string): void {
  shiftItemsFrom(draft, atMs, lengthMs, new Set([excludeId]), isLine)
}

export const voiceHandlers: VoiceHandlers = {
  'voice.insert': (draft, command, env) => {
    const characterId = env.resolve(command.characterId)
    if (!draft.characters[characterId]) fail(command.op, `キャラクターが見つかりません: ${characterId}`)
    requireNonEmptyText(command.text, command.op)
    if ((command.atMs === undefined) === (command.afterItemId === undefined)) {
      fail(command.op, '挿入位置は atMs か afterItemId のどちらか一方で指定してください')
    }
    const layerId = requireLayer(draft, env.resolve(command.layerId ?? defaultVoiceLayerId(draft, command.op)), command.op).id
    const gap = draft.editing.defaultGapMs

    let atMs: number
    if (command.afterItemId !== undefined) {
      const after = draft.items.find((item) => item.id === env.resolve(command.afterItemId!))
      if (!after) fail(command.op, `アイテムが見つかりません: ${command.afterItemId}`)
      atMs = itemEnd(after) + gap
    } else {
      if (command.atMs! < 0) fail(command.op, '開始時刻は負の値にできません')
      atMs = Math.round(command.atMs!)
    }

    const id = env.ctx.newId('itm')
    const item: VoiceItem = {
      id,
      type: 'voice',
      layerId,
      startMs: atMs,
      durationMs: estimateSpeechDurationMs(command.text),
      effects: [],
      locked: false,
      characterId,
      text: command.text,
      voiceOverride: null,
      subtitleOverride: null,
      expressionId: command.expressionId ?? null,
      generatedBy: command.generatedBy ?? null,
      synthesis: null,
      subtitleLines: [],
      subtitleLinesManual: false
    }
    item.subtitleLines = autoSubtitleLines(draft, item)
    // 後ろのセリフをずらして場所を空けるかは設定で選ぶ(既定は空けない。素材は独立が基本)。
    if (draft.editing.openGapOnVoiceInsert === true) openGap(draft, atMs, item.durationMs + gap, id)
    draft.items.push(item)
    if (command.tempId) env.resolvedIds[command.tempId] = id
  },

  'voice.setText': (draft, command, env) => {
    const item = findVoiceItem(draft, env.resolve(command.itemId), command.op)
    requireNonEmptyText(command.text, command.op)
    if (item.text === command.text) return
    item.text = command.text
    item.subtitleLinesManual = false
    // 読みの上書き・字幕だけの文字は前のテキストに対するものなので外す。
    item.reading = null
    item.displayText = null
    refreshSubtitleLines(draft, item)
    invalidateSynthesis(item)
  },

  'voice.setDisplayText': (draft, command, env) => {
    const item = findVoiceItem(draft, env.resolve(command.itemId), command.op)
    let text = command.text === null ? null : command.text.replace(/\r\n?/g, '\n')
    if (text !== null) {
      if (text.trim() === '') fail(command.op, '字幕に出す文字が空です')
      if (text.length > 2000) fail(command.op, '字幕に出す文字が長すぎます')
      // セリフと同じなら、別にしない
      if (text === item.text) text = null
    }
    if ((item.displayText ?? null) === text) return
    item.displayText = text
    // 字幕の改行は、新しい文字で自動に戻す(声は変わらないので合成し直さない)。
    item.subtitleLinesManual = false
    refreshSubtitleLines(draft, item)
  },

  'voice.setReading': (draft, command, env) => {
    const item = findVoiceItem(draft, env.resolve(command.itemId), command.op)
    const reading = command.reading === null ? null : command.reading.trim()
    if (reading !== null) {
      if (reading === '') fail(command.op, '読みが空です')
      if (reading.length > 1000) fail(command.op, '読みが長すぎます')
      // カタカナ・長音・アクセント記号(')・区切り(/ 、)・無声化(_)・疑問(？)だけを受け付ける。
      if (!/^[\u30A1-\u30FC'/、_？?]+$/.test(reading)) fail(command.op, '読みはカタカナとアクセント記号(\' / 、 _ ？)で書いてください')
    }
    if ((item.reading ?? null) === reading) return
    item.reading = reading
    invalidateSynthesis(item)
  },

  'voice.invalidateSynthesis': (draft, command) => {
    for (const item of draft.items) {
      if (item.type !== 'voice' || !item.synthesis) continue
      if (command.engineId !== undefined && draft.characters[item.characterId]?.voice.engineId !== command.engineId) continue
      invalidateSynthesis(item)
    }
  },

  'voice.delete': (draft, command, env) => {
    const item = findVoiceItem(draft, env.resolve(command.itemId), command.op)
    // 消した後を詰めるかは設定で選ぶ(既定は詰めない。素材は独立が基本)。
    if (draft.editing.closeGapOnVoiceDelete === true) closeGap(draft, item)
    draft.items.splice(draft.items.indexOf(item), 1)
    for (const session of Object.values(draft.liveSessions)) {
      for (const entry of session.entries) {
        if (entry.adoptedItemId === item.id) entry.adoptedItemId = null
      }
    }
  },

  'voice.move': (draft, command, env) => {
    const item = findVoiceItem(draft, env.resolve(command.itemId), command.op)
    const afterId = command.afterItemId === null ? null : env.resolve(command.afterItemId)
    if (afterId === item.id) fail(command.op, '自分自身の後ろには移動できません')
    const gap = draft.editing.defaultGapMs

    // 元の場所を詰めてから、新しい場所を空けて入れる。並べ替えは必ず前後をずらす。
    closeGap(draft, item)
    item.startMs = -1
    let atMs: number
    if (afterId === null) {
      const first = draft.items
        .filter((candidate) => candidate.type === 'voice' && candidate.id !== item.id)
        .reduce<number | null>((min, candidate) => (min === null ? candidate.startMs : Math.min(min, candidate.startMs)), null)
      atMs = first ?? 0
    } else {
      const after = draft.items.find((candidate) => candidate.id === afterId)
      if (!after) fail(command.op, `アイテムが見つかりません: ${afterId}`)
      atMs = itemEnd(after) + gap
    }
    openGap(draft, atMs, item.durationMs + gap, item.id)
    item.startMs = atMs
  },

  'voice.setCharacter': (draft, command, env) => {
    const item = findVoiceItem(draft, env.resolve(command.itemId), command.op)
    const characterId = env.resolve(command.characterId)
    if (!draft.characters[characterId]) fail(command.op, `キャラクターが見つかりません: ${characterId}`)
    if (item.characterId === characterId) return
    item.characterId = characterId
    // 表情はキャラクターごとに定義されるので引き継げない。
    item.expressionId = null
    refreshSubtitleLines(draft, item)
    invalidateSynthesis(item)
  },

  'voice.setExpression': (draft, command, env) => {
    const item = findVoiceItem(draft, env.resolve(command.itemId), command.op)
    if (command.expressionId !== null) {
      const expressions = draft.characters[item.characterId]?.portrait?.expressions ?? {}
      if (!expressions[command.expressionId]) fail(command.op, `表情が見つかりません: ${command.expressionId}`)
    }
    item.expressionId = command.expressionId
  },

  'voice.setVoiceParams': (draft, command, env) => {
    const item = findVoiceItem(draft, env.resolve(command.itemId), command.op)
    const next: Partial<VoiceParams> = { ...(item.voiceOverride ?? {}) }
    for (const [key, value] of Object.entries(command.params) as [keyof VoiceParams, number | null | undefined][]) {
      if (value === undefined) continue
      if (value === null) {
        delete next[key]
        continue
      }
      const [min, max] = VOICE_PARAM_RANGES[key]
      if (!Number.isFinite(value) || value < min || value > max) {
        fail(command.op, `${key} は ${min} 〜 ${max} の範囲で指定してください`)
      }
      next[key] = value
    }
    item.voiceOverride = Object.keys(next).length === 0 ? null : next
    invalidateSynthesis(item)
  },

  'voice.setSubtitleOverride': (draft, command, env) => {
    const item = findVoiceItem(draft, env.resolve(command.itemId), command.op)
    if (command.styleId !== undefined && !draft.subtitleStyles[command.styleId]) {
      fail(command.op, `字幕スタイルが見つかりません: ${command.styleId}`)
    }
    const override = { ...(item.subtitleOverride ?? {}) }
    if (command.styleId !== undefined) override.styleId = command.styleId
    if (command.color !== undefined) override.color = command.color
    if (command.sizeScale !== undefined) {
      if (command.sizeScale <= 0 || command.sizeScale > 5) fail(command.op, '文字の大きさの倍率が不正です')
      override.sizeScale = command.sizeScale
    }
    item.subtitleOverride = override
    if (command.styleId !== undefined) refreshSubtitleLines(draft, item)
  },

  'voice.setSubtitleLines': (draft, command, env) => {
    const item = findVoiceItem(draft, env.resolve(command.itemId), command.op)
    if (command.lines === null) {
      item.subtitleLinesManual = false
      item.subtitleLines = autoSubtitleLines(draft, item)
      return
    }
    if (command.lines.join('') !== subtitleText(item).replace(/\n/g, '')) {
      fail(command.op, '字幕の行を繋げたものがセリフと一致しません。改行位置だけを変えてください')
    }
    item.subtitleLines = command.lines.filter((line) => line !== '')
    item.subtitleLinesManual = true
  },

  'voice.setGapAfter': (draft, command, env) => {
    const item = findVoiceItem(draft, env.resolve(command.itemId), command.op)
    if (command.gapMs < 0) fail(command.op, '間は0以上にしてください')
    const exclude = new Set([item.id])
    const next = earliestStartFrom(draft, itemEnd(item), exclude, isLine)
    if (next === null) return
    shiftItemsFrom(draft, itemEnd(item), Math.round(command.gapMs) - (next - itemEnd(item)), exclude, isLine)
  },

  'voice.applySynthesis': (draft, command, env) => {
    const item = findVoiceItem(draft, env.resolve(command.itemId), command.op)
    if (item.text !== command.expectedText) fail(command.op, '合成中にセリフが変更されたため、古い結果を破棄しました')
    const oldEnd = itemEnd(item)
    const newDuration = Math.max(1, Math.round(command.synthesis.audioDurationMs))
    const delta = newDuration - item.durationMs
    item.synthesis = command.synthesis
    item.durationMs = newDuration
    // 素材は独立が基本。合成で尺が変わっても、ほかのセリフ・素材は動かさない。
    // 同じグループの、このセリフより後ろのものだけ一緒にずらす(グループは動きを合わせるためのもの)。
    const groupId = item.groupId
    if (delta === 0 || groupId === undefined || draft.editing.groupFollowsVoice === false) return
    shiftItemsFrom(draft, oldEnd, delta, new Set([item.id]), (other) => other.groupId === groupId)
  }
}
