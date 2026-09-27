import { produce } from 'immer'

import { isSafeModelId } from '../ai/types'

import type { Item, Layer, Project, VoiceItem } from '../project/types'
import { CommandError, type Command } from './types'

export interface CommandContext {
  /** 新しいIDを生成する。テストでは決定論的な実装を渡す。 */
  newId: (prefix: string) => string
  now: () => Date
}

export interface ApplyResult {
  project: Project
  /** 一時ID から実際に生成されたID への対応。 */
  resolvedIds: Record<string, string>
}

/** 未合成のボイスアイテムに与える暫定の尺。合成後に実測値へ置き換わる。 */
const PROVISIONAL_MS_PER_CHAR = 150
const PROVISIONAL_MIN_MS = 500

export function estimateSpeechDurationMs(text: string): number {
  return Math.max(PROVISIONAL_MIN_MS, text.length * PROVISIONAL_MS_PER_CHAR)
}

/**
 * コマンド列を適用する。1件でも失敗したら CommandError を投げ、プロジェクトは変更しない。
 * 部分適用を許すと、AI が生成した相互に依存するコマンド列が中途半端な状態を残すため。
 */
export function applyCommands(
  project: Project,
  commands: readonly Command[],
  ctx: CommandContext
): ApplyResult {
  const resolvedIds: Record<string, string> = {}
  const resolve = (id: string): string => resolvedIds[id] ?? id

  const next = produce(project, (draft) => {
    for (const command of commands) {
      applyOne(draft, command, ctx, resolvedIds, resolve)
    }
    draft.meta.updatedAt = ctx.now().toISOString()
  })

  return { project: next, resolvedIds }
}

function applyOne(
  draft: Project,
  command: Command,
  ctx: CommandContext,
  resolvedIds: Record<string, string>,
  resolve: (id: string) => string
): void {
  switch (command.op) {
    case 'project.setMeta': {
      if (command.title !== undefined) draft.meta.title = command.title
      return
    }

    case 'project.setConversationAi': {
      if (command.model !== null && !isSafeModelId(command.model.model)) {
        throw new CommandError(`モデルIDに使えない文字が含まれています: ${command.model.model}`, command.op)
      }
      draft.ai.conversation = command.model
      return
    }

    case 'layer.insert': {
      const id = ctx.newId('lyr')
      const layer: Layer = {
        id,
        name: command.name,
        index: command.index,
        visible: true,
        locked: false,
        muted: false
      }
      for (const existing of draft.layers) {
        if (existing.index >= command.index) existing.index += 1
      }
      draft.layers.push(layer)
      draft.layers.sort((a, b) => a.index - b.index)
      if (command.tempId) resolvedIds[command.tempId] = id
      return
    }

    case 'character.create': {
      const styleId = command.subtitleStyleId ?? Object.keys(draft.subtitleStyles)[0]
      if (!styleId || !draft.subtitleStyles[styleId]) {
        throw new CommandError('字幕スタイルが存在しません', command.op)
      }
      const authorRole = command.authorRole ?? 'user'
      if (authorRole === 'ai' && !command.persona) {
        throw new CommandError('AIが演じる役には persona が必要です', command.op)
      }
      const id = ctx.newId('chr')
      draft.characters[id] = {
        id,
        name: command.name,
        authorRole,
        persona: command.persona ?? null,
        voice: {
          engineId: command.engineId,
          speakerId: command.speakerId,
          speakerName: command.speakerName,
          speedScale: 1,
          pitchScale: 0,
          intonationScale: 1,
          volumeScale: 1,
          prePhonemeLength: 0.1,
          postPhonemeLength: 0.1
        },
        subtitleStyleId: styleId,
        portrait: null,
        creditRequired: command.creditText !== undefined,
        creditText: command.creditText ?? ''
      }
      if (command.tempId) resolvedIds[command.tempId] = id
      return
    }

    case 'character.setPersona': {
      const characterId = resolve(command.characterId)
      const character = draft.characters[characterId]
      if (!character) {
        throw new CommandError(`キャラクターが見つかりません: ${characterId}`, command.op)
      }
      if (character.authorRole !== 'ai') {
        throw new CommandError('AIが演じる役ではないため persona を設定できません', command.op)
      }
      character.persona = command.persona
      return
    }

    case 'item.setTimeRange': {
      const item = mutableItem(draft, resolve(command.itemId), command.op)
      if (command.durationMs !== undefined) {
        if (item.type === 'voice') {
          throw new CommandError(
            'ボイスアイテムの尺は合成結果から決まるため直接変更できません',
            command.op
          )
        }
        if (command.durationMs <= 0) {
          throw new CommandError('尺は正の値でなければなりません', command.op)
        }
        item.durationMs = command.durationMs
      }
      if (command.startMs !== undefined) {
        if (command.startMs < 0) {
          throw new CommandError('開始時刻は負の値にできません', command.op)
        }
        item.startMs = command.startMs
      }
      return
    }

    case 'item.setLayer': {
      const item = mutableItem(draft, resolve(command.itemId), command.op)
      const layerId = resolve(command.layerId)
      if (!draft.layers.some((layer) => layer.id === layerId)) {
        throw new CommandError(`レイヤーが見つかりません: ${layerId}`, command.op)
      }
      item.layerId = layerId
      return
    }

    case 'item.delete': {
      const itemId = resolve(command.itemId)
      const index = draft.items.findIndex((item) => item.id === itemId)
      if (index < 0) throw new CommandError(`アイテムが見つかりません: ${itemId}`, command.op)
      draft.items.splice(index, 1)
      return
    }

    case 'voice.insert': {
      const characterId = resolve(command.characterId)
      if (!draft.characters[characterId]) {
        throw new CommandError(`キャラクターが見つかりません: ${characterId}`, command.op)
      }
      if (command.text.trim() === '') {
        throw new CommandError('セリフが空です', command.op)
      }
      const layerId = resolve(command.layerId ?? defaultVoiceLayerId(draft, command.op))
      if (!draft.layers.some((layer) => layer.id === layerId)) {
        throw new CommandError(`レイヤーが見つかりません: ${layerId}`, command.op)
      }
      const id = ctx.newId('itm')
      const item: VoiceItem = {
        id,
        type: 'voice',
        layerId,
        startMs: command.atMs,
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
        subtitleLines: [command.text]
      }
      draft.items.push(item)
      if (command.tempId) resolvedIds[command.tempId] = id
      return
    }

    case 'voice.setText': {
      const item = mutableItem(draft, resolve(command.itemId), command.op)
      if (item.type !== 'voice') {
        throw new CommandError('ボイスアイテムではありません', command.op)
      }
      if (command.text.trim() === '') {
        throw new CommandError('セリフが空です', command.op)
      }
      item.text = command.text
      item.subtitleLines = [command.text]
      // テキストが変わったら合成結果は無効になる。再合成までは暫定の尺を使う。
      item.synthesis = null
      item.durationMs = estimateSpeechDurationMs(command.text)
      return
    }

    case 'voice.setSubtitleOverride': {
      const item = mutableItem(draft, resolve(command.itemId), command.op)
      if (item.type !== 'voice') {
        throw new CommandError('ボイスアイテムではありません', command.op)
      }
      if (command.styleId !== undefined && !draft.subtitleStyles[command.styleId]) {
        throw new CommandError(`字幕スタイルが見つかりません: ${command.styleId}`, command.op)
      }
      const override = { ...(item.subtitleOverride ?? {}) }
      if (command.styleId !== undefined) override.styleId = command.styleId
      if (command.color !== undefined) override.color = command.color
      if (command.sizeScale !== undefined) override.sizeScale = command.sizeScale
      item.subtitleOverride = override
      return
    }

    default: {
      const exhaustive: never = command
      throw new Error(`未対応のコマンド: ${JSON.stringify(exhaustive)}`)
    }
  }
}

function mutableItem(draft: Project, itemId: string, op: Command['op']): Item {
  const item = draft.items.find((candidate) => candidate.id === itemId)
  if (!item) throw new CommandError(`アイテムが見つかりません: ${itemId}`, op)
  if (item.locked) throw new CommandError(`アイテムはロックされています: ${itemId}`, op)
  return item
}

function defaultVoiceLayerId(draft: Project, op: Command['op']): string {
  const layer = draft.layers.find((candidate) => candidate.name === 'ボイス') ?? draft.layers[0]
  if (!layer) throw new CommandError('レイヤーが存在しません', op)
  return layer.id
}
