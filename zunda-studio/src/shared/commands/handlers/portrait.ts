import { DEFAULT_LAYER_IDS } from '../../project/factory'
import type { Effect, PortraitItem, PortraitItemKind, PortraitTransform, Project } from '../../project/types'
import { fail, findMutableItem, layerOrDefault, requireFinite, type HandlerTable } from '../env'
import type { CommandOp, PortraitTransition } from '../types'

type PortraitHandlers = Pick<HandlerTable, 'portrait.insert' | 'portrait.update'>

const KINDS: readonly PortraitItemKind[] = ['show', 'hide', 'adjust']
const ANCHORS: readonly PortraitTransform['anchor'][] = [
  'top-left',
  'top-center',
  'top-right',
  'center',
  'bottom-left',
  'bottom-center',
  'bottom-right'
]
const PORTRAIT_LAYER = { id: DEFAULT_LAYER_IDS.portrait, name: '立ち絵' }

/** 登場・退場の動きを、エフェクトとして表す。 */
export function transitionEffects(transition: PortraitTransition, durationMs: number): Effect[] {
  const edge = Math.min(300, Math.floor(durationMs / 3))
  switch (transition) {
    case 'fade':
      return [{ type: 'fade', inMs: edge, outMs: edge }]
    case 'pop':
      return [
        { type: 'fade', inMs: Math.min(150, edge), outMs: edge },
        { type: 'scale', from: 0.7, to: 1, easing: 'easeOutCubic', durationMs: Math.min(250, edge) }
      ]
    case 'none':
      return []
  }
}

function validateTransform(transform: PortraitTransform, op: CommandOp): PortraitTransform {
  requireFinite(transform.x, op, '立ち絵の位置')
  requireFinite(transform.y, op, '立ち絵の位置')
  if (!(transform.scale > 0 && transform.scale <= 20)) fail(op, '立ち絵の拡大率が不正です')
  if (!ANCHORS.includes(transform.anchor)) fail(op, `立ち絵の基準点が不正です: ${String(transform.anchor)}`)
  return { x: transform.x, y: transform.y, scale: transform.scale, flipX: transform.flipX === true, anchor: transform.anchor }
}

function validateExpression(draft: Project, characterId: string, expressionId: string | null | undefined, op: CommandOp): void {
  if (expressionId === null || expressionId === undefined) return
  if (!draft.characters[characterId]?.portrait?.expressions[expressionId]) fail(op, `表情が見つかりません: ${expressionId}`)
}

export const portraitHandlers: PortraitHandlers = {
  'portrait.insert': (draft, command, env) => {
    const characterId = env.resolve(command.characterId)
    const character = draft.characters[characterId]
    if (!character) fail(command.op, `キャラクターが見つかりません: ${characterId}`)
    if (!character.portrait) fail(command.op, `${character.name} には立ち絵がありません`)
    const kind = command.kind ?? 'show'
    if (!KINDS.includes(kind)) fail(command.op, `立ち絵の種類が不正です: ${String(kind)}`)
    const atMs = Math.round(requireFinite(command.atMs, command.op, '開始時刻'))
    const durationMs = Math.round(requireFinite(command.durationMs, command.op, '尺'))
    if (atMs < 0) fail(command.op, '開始時刻は負の値にできません')
    if (durationMs <= 0) fail(command.op, '尺は正の値でなければなりません')
    const expressionId = command.expressionId === undefined ? null : command.expressionId === null ? null : env.resolve(command.expressionId)
    validateExpression(draft, characterId, expressionId, command.op)

    const id = env.ctx.newId('itm')
    const item: PortraitItem = {
      id,
      type: 'portrait',
      layerId: layerOrDefault(draft, command.layerId, PORTRAIT_LAYER, command.op, env.resolve),
      startMs: atMs,
      durationMs,
      effects: kind === 'show' ? transitionEffects(command.transition ?? 'none', durationMs) : [],
      locked: false,
      characterId,
      transformOverride: command.transform ? validateTransform(command.transform, command.op) : null,
      kind,
      expressionId
    }
    draft.items.push(item)
    if (command.tempId) env.resolvedIds[command.tempId] = id
  },

  'portrait.update': (draft, command, env) => {
    const item = findMutableItem(draft, env.resolve(command.itemId), command.op)
    if (item.type !== 'portrait') fail(command.op, '場面ごとの立ち絵ではありません')
    if (command.kind !== undefined) {
      if (!KINDS.includes(command.kind)) fail(command.op, `立ち絵の種類が不正です: ${String(command.kind)}`)
      item.kind = command.kind
    }
    if (command.transform !== undefined) {
      item.transformOverride = command.transform === null ? null : validateTransform(command.transform, command.op)
    }
    if (command.expressionId !== undefined) {
      const expressionId = command.expressionId === null ? null : env.resolve(command.expressionId)
      validateExpression(draft, item.characterId, expressionId, command.op)
      item.expressionId = expressionId
    }
  }
}
