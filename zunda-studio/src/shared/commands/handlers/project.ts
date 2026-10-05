import { validateBriefing } from '../../ai/briefing'
import { isSafeModelId } from '../../ai/types'
import { SUBTITLE_APPEARS, ZOOM_METHODS, type Layer } from '../../project/types'
import { rescaleProject } from '../../project/canvas'
import { normalizeChapters } from '../../project/chapters'
import { TIMELINE_COLOR } from '../../project/timeline-colors'
import { fail, insertLayer, requireLayer, refreshSubtitleLines, type HandlerTable } from '../env'

type ProjectHandlers = Pick<
  HandlerTable,
  | 'project.setMeta'
  | 'project.setConversationAi'
  | 'project.setEditing'
  | 'project.setMix'
  | 'project.setBriefing'
  | 'credits.set'
  | 'publish.set'
  | 'chat.append'
  | 'chat.setOutcome'
  | 'layer.insert'
  | 'layer.update'
  | 'style.upsertSubtitle'
  | 'project.setCanvas'
>

const CHAT_LIMIT = 500

const MIX_KEYS = ['master', 'voice', 'music', 'video'] as const
/** 音量のつまみの上限(倍率)。 */
export const MAX_MIX = 2

const COLOR_PATTERN = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/

export const projectHandlers: ProjectHandlers = {
  'project.setMeta': (draft, command) => {
    if (command.title !== undefined) {
      if (command.title.trim() === '') fail(command.op, 'プロジェクト名が空です')
      draft.meta.title = command.title
    }
    if (command.synopsis !== undefined) draft.meta.synopsis = command.synopsis
  },

  'project.setConversationAi': (draft, command) => {
    if (command.model !== null && !isSafeModelId(command.model.model)) {
      fail(command.op, `モデルIDに使えない文字が含まれています: ${command.model.model}`)
    }
    draft.ai.conversation = command.model
  },

  'project.setCanvas': (draft, command) => {
    const width = command.width ?? draft.canvas.width
    const height = command.height ?? draft.canvas.height
    for (const [value, label] of [
      [width, '幅'],
      [height, '高さ']
    ] as const) {
      if (!Number.isInteger(value) || value < 64 || value > 7680) fail(command.op, `動画の${label}は 64〜7680 の整数にしてください`)
      // H.264 は縦横が偶数でないと書き出せない。
      if (value % 2 !== 0) fail(command.op, `動画の${label}は偶数にしてください`)
    }
    if (command.fps !== undefined && !(Number.isFinite(command.fps) && command.fps >= 1 && command.fps <= 120)) fail(command.op, 'フレームレートは 1〜120 にしてください')
    if (command.backgroundColor !== undefined && !COLOR_PATTERN.test(command.backgroundColor)) fail(command.op, `背景の色の指定が不正です: ${command.backgroundColor}`)
    if (command.rescale && (width !== draft.canvas.width || height !== draft.canvas.height)) {
      rescaleProject(draft, draft.canvas, { width, height })
      for (const item of draft.items) if (item.type === 'voice') refreshSubtitleLines(draft, item)
    }
    draft.canvas = {
      ...draft.canvas,
      width,
      height,
      ...(command.fps !== undefined ? { fps: Math.round(command.fps) } : {}),
      ...(command.backgroundColor !== undefined ? { backgroundColor: command.backgroundColor } : {})
    }
  },

  'project.setMix': (draft, command) => {
    const mix = { ...(draft.mix ?? {}) }
    for (const key of MIX_KEYS) {
      const value = command[key]
      if (value === undefined) continue
      if (value === null || value === 1) {
        delete mix[key]
        continue
      }
      if (!(Number.isFinite(value) && value >= 0 && value <= MAX_MIX)) fail(command.op, `音量は 0〜${MAX_MIX * 100}% で指定してください`)
      mix[key] = Math.round(value * 100) / 100
    }
    if (Object.keys(mix).length === 0) delete draft.mix
    else draft.mix = mix
  },

  'project.setEditing': (draft, command) => {
    if (command.openGapOnVoiceInsert !== undefined) draft.editing.openGapOnVoiceInsert = command.openGapOnVoiceInsert
    // 以前の名前(rippleOnVoiceChange)の指定は、何もしない(以前のコマンドを受け付けるだけ)
    if (command.closeGapOnVoiceDelete !== undefined) draft.editing.closeGapOnVoiceDelete = command.closeGapOnVoiceDelete
    if (command.groupFollowsVoice !== undefined) draft.editing.groupFollowsVoice = command.groupFollowsVoice
    if (command.autoPortraitTrack !== undefined) draft.editing.autoPortraitTrack = command.autoPortraitTrack
    for (const key of ['cutFadeInMs', 'cutFadeOutMs'] as const) {
      const value = command[key]
      if (value === undefined) continue
      if (!(value >= 0 && value <= 5000)) fail(command.op, 'フェードの長さは0〜5秒にしてください')
      draft.editing[key] = Math.round(value)
    }
    if (command.freezeFadeIn !== undefined) draft.editing.freezeFadeIn = command.freezeFadeIn
    if (command.rippleIgnoresOthers !== undefined) draft.editing.rippleIgnoresOthers = command.rippleIgnoresOthers
    if (command.zoomMethod !== undefined) {
      if (!ZOOM_METHODS.includes(command.zoomMethod)) fail(command.op, `寄り方の指定が不正です: ${command.zoomMethod}`)
      draft.editing.zoomMethod = command.zoomMethod
    }
    if (command.zoomOnStill !== undefined) {
      if (!['off', 'overwrite', 'insert'].includes(command.zoomOnStill)) fail(command.op, `静止画の指定が不正です: ${command.zoomOnStill}`)
      draft.editing.zoomOnStill = command.zoomOnStill
    }
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
    if (command.portraitDim !== undefined) {
      if (!(command.portraitDim >= 0 && command.portraitDim <= 0.8)) fail(command.op, '立ち絵を暗くする度合いは0〜0.8で指定してください')
      draft.editing.portraitDim = command.portraitDim
    }
    if (command.portraitHop !== undefined) draft.editing.portraitHop = command.portraitHop
    if (command.avoidOverlap !== undefined) draft.editing.avoidOverlap = command.avoidOverlap
  },

  'credits.set': (draft, command) => {
    if (command.generated !== undefined && command.generated !== draft.credits.generated) {
      draft.credits.generated = command.generated
      draft.credits.confirmedByUser = false
    }
    if (command.confirmedByUser !== undefined) draft.credits.confirmedByUser = command.confirmedByUser
  },

  'publish.set': (draft, command) => {
    const { publish } = command
    if (publish.titles.some((title) => title.length > 200)) fail(command.op, 'タイトルが長すぎます')
    if (publish.description.length > 10_000) fail(command.op, '概要欄が長すぎます')
    draft.publish = { ...publish, chapters: normalizeChapters(publish.chapters) }
  },

  'chat.append': (draft, command) => {
    if (draft.chat.messages.some((message) => message.id === command.message.id)) fail(command.op, '同じ発言がすでにあります')
    draft.chat.messages.push(command.message)
    // 履歴が際限なく伸びないよう、古いものから捨てる。
    if (draft.chat.messages.length > CHAT_LIMIT) draft.chat.messages.splice(0, draft.chat.messages.length - CHAT_LIMIT)
  },

  'chat.setOutcome': (draft, command) => {
    const message = draft.chat.messages.find((candidate) => candidate.id === command.messageId)
    if (!message) fail(command.op, '発言が見つかりません')
    message.outcome = command.outcome
  },

  'project.setBriefing': (draft, command) => {
    if (command.briefing === null) {
      draft.ai.briefing = null
      return
    }
    const problem = validateBriefing(command.briefing)
    if (problem) fail(command.op, problem)
    // immer の下書きへは素の値として入れる。
    draft.ai.briefing = JSON.parse(JSON.stringify(command.briefing)) as typeof command.briefing
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
    if (command.color !== undefined) {
      if (command.color === null) delete layer.color
      else if (!TIMELINE_COLOR.test(command.color)) fail(command.op, `色の指定が不正です: ${command.color}`)
      else layer.color = command.color.toLowerCase()
    }
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
    if (props.background) {
      const background = props.background
      if (!COLOR_PATTERN.test(background.color)) fail(command.op, '帯の色の指定が不正です')
      if (!(background.opacity >= 0 && background.opacity <= 1)) fail(command.op, '帯の濃さは0〜1で指定してください')
      if (!(background.paddingPx >= 0 && background.paddingPx <= 200)) fail(command.op, '帯の余白は0〜200pxで指定してください')
      if (!(background.radiusPx >= 0 && background.radiusPx <= 200)) fail(command.op, '帯の角の丸みは0〜200pxで指定してください')
      if (typeof background.fullWidth !== 'boolean') fail(command.op, '帯の幅の指定が不正です')
    }
    if (props.appear) {
      if (!SUBTITLE_APPEARS.includes(props.appear.kind)) fail(command.op, `字幕の出方の指定が不正です: ${String(props.appear.kind)}`)
      if (!(props.appear.durationMs >= 0 && props.appear.durationMs <= 10_000)) fail(command.op, '字幕の出方の時間は0〜10秒で指定してください')
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
