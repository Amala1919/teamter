import { isSafeModelId } from '../../ai/types'
import type { Layer } from '../../project/types'
import { fail, insertLayer, requireLayer, refreshSubtitleLines, type HandlerTable } from '../env'

type ProjectHandlers = Pick<
  HandlerTable,
  | 'project.setMeta'
  | 'project.setConversationAi'
  | 'project.setEditing'
  | 'layer.insert'
  | 'layer.update'
  | 'style.upsertSubtitle'
>

const COLOR_PATTERN = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/

export const projectHandlers: ProjectHandlers = {
  'project.setMeta': (draft, command) => {
    if (command.title !== undefined) {
      if (command.title.trim() === '') fail(command.op, 'プロジェクト名が空です')
      draft.meta.title = command.title
    }
  },

  'project.setConversationAi': (draft, command) => {
    if (command.model !== null && !isSafeModelId(command.model.model)) {
      fail(command.op, `モデルIDに使えない文字が含まれています: ${command.model.model}`)
    }
    draft.ai.conversation = command.model
  },

  'project.setEditing': (draft, command) => {
    if (command.rippleOnVoiceChange !== undefined) draft.editing.rippleOnVoiceChange = command.rippleOnVoiceChange
    if (command.defaultGapMs !== undefined) {
      if (command.defaultGapMs < 0) fail(command.op, '間は0以上にしてください')
      draft.editing.defaultGapMs = Math.round(command.defaultGapMs)
    }
    if (command.duckVolume !== undefined) {
      if (!(command.duckVolume >= 0 && command.duckVolume <= 1)) fail(command.op, '下げる音量は0〜1の範囲で指定してください')
      draft.editing.duckVolume = command.duckVolume
    }
    if (command.duckFadeMs !== undefined) {
      if (command.duckFadeMs < 0) fail(command.op, '音量を下げる時間は0以上にしてください')
      draft.editing.duckFadeMs = Math.round(command.duckFadeMs)
    }
  },

  'layer.update': (draft, command, env) => {
    const layer = requireLayer(draft, env.resolve(command.layerId), command.op)
    if (command.name !== undefined) {
      if (command.name.trim() === '') fail(command.op, 'レイヤー名が空です')
      layer.name = command.name
    }
    if (command.visible !== undefined) layer.visible = command.visible
    if (command.locked !== undefined) layer.locked = command.locked
    if (command.muted !== undefined) layer.muted = command.muted
  },

  'layer.insert': (draft, command, env) => {
    const id = env.ctx.newId('lyr')
    const layer: Layer = {
      id,
      name: command.name,
      index: command.index,
      visible: true,
      locked: false,
      muted: false
    }
    insertLayer(draft, layer)
    if (command.tempId) env.resolvedIds[command.tempId] = id
  },

  'style.upsertSubtitle': (draft, command, env) => {
    const props = command.props
    for (const key of ['color'] as const) {
      const value = props[key]
      if (value !== undefined && !COLOR_PATTERN.test(value)) fail(command.op, `色の指定が不正です: ${value}`)
    }
    if (props.outline && !COLOR_PATTERN.test(props.outline.color)) fail(command.op, '縁取りの色の指定が不正です')
    if (props.fontSizePx !== undefined && (props.fontSizePx < 8 || props.fontSizePx > 400)) {
      fail(command.op, '文字の大きさは 8〜400px で指定してください')
    }
    if (props.maxCharsPerLine !== undefined && (props.maxCharsPerLine < 1 || props.maxCharsPerLine > 200)) {
      fail(command.op, '1行の文字数が不正です')
    }

    if (command.styleId === undefined) {
      const baseId = command.baseStyleId ?? Object.keys(draft.subtitleStyles)[0]
      const base = baseId === undefined ? undefined : draft.subtitleStyles[baseId]
      if (!base) fail(command.op, '元にする字幕スタイルがありません')
      const id = env.ctx.newId('sty')
      // immer の下書きは Proxy なので structuredClone できない。JSON 経由で素の値として複製する。
      const copy = JSON.parse(JSON.stringify(base)) as typeof base
      draft.subtitleStyles[id] = { ...copy, ...props, id }
      if (command.tempId) env.resolvedIds[command.tempId] = id
      return
    }

    const styleId = env.resolve(command.styleId)
    const style = draft.subtitleStyles[styleId]
    if (!style) fail(command.op, `字幕スタイルが見つかりません: ${styleId}`)
    Object.assign(style, props)
    if (props.maxCharsPerLine !== undefined) {
      for (const item of draft.items) {
        if (item.type !== 'voice') continue
        const itemStyle = item.subtitleOverride?.styleId ?? draft.characters[item.characterId]?.subtitleStyleId
        if (itemStyle === styleId) refreshSubtitleLines(draft, item)
      }
    }
  }
}
