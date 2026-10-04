import { TRANSITION_KINDS, type Item, type Layer, type Project, type TransitionKind } from '../../project/types'
import { fail, findMutableItem, insertLayer, itemEnd, requireFinite, type ApplyEnv, type HandlerTable } from '../env'

type TransitionHandlers = Pick<HandlerTable, 'timeline.crossTransition'>

/** 前の素材の終わりとこの素材の始まりが、これだけ離れていても「つながっている」とみなす(1〜2コマ)。 */
const ADJACENT_MS = 70

const VISUAL_TYPES: Item['type'][] = ['video', 'image', 'text', 'shape']

/** この素材の直前で終わる、画面に出る素材。同じレイヤーのものを先に、終わりが近いものを選ぶ。 */
function previousVisual(draft: Project, item: Item): Item | undefined {
  const candidates = draft.items.filter(
    (other) =>
      other.id !== item.id &&
      VISUAL_TYPES.includes(other.type) &&
      other.startMs < item.startMs &&
      Math.abs(itemEnd(other) - item.startMs) <= ADJACENT_MS
  )
  return candidates.sort((a, b) => Number(b.layerId === item.layerId) - Number(a.layerId === item.layerId) || itemEnd(b) - itemEnd(a))[0]
}

function sourceRoomAfter(draft: Project, item: Item): number {
  if (item.type !== 'video' || item.freeze) return Number.POSITIVE_INFINITY
  const asset = draft.assets[item.assetId]
  if (!asset || asset.type !== 'video') return 0
  return (asset.durationMs - item.outMs) / Math.max(0.01, item.playbackRate)
}

function sourceRoomBefore(item: Item): number {
  if (item.type !== 'video' || item.freeze) return item.startMs
  return Math.min(item.startMs, item.inMs / Math.max(0.01, item.playbackRate))
}

/** 素材の後ろを ms だけ伸ばす(動画は素材の続きを使う)。 */
function extendEnd(item: Item, ms: number): void {
  if (item.type === 'video' && !item.freeze) item.outMs = Math.round(item.outMs + ms * item.playbackRate)
  item.durationMs += ms
}

/** 素材の頭を ms だけ前へ伸ばす(動画は素材の手前から使う)。 */
function extendStart(item: Item, ms: number): void {
  if (item.type === 'video' && !item.freeze) item.inMs = Math.max(0, Math.round(item.inMs - ms * item.playbackRate))
  item.startMs -= ms
  item.durationMs += ms
}

/** 切ったところに付いたフェードを外す(重ねて切り替えるときに、間で暗くならないように)。 */
function dropFade(item: Item, side: 'inMs' | 'outMs'): void {
  for (const effect of item.effects) if (effect.type === 'fade') effect[side] = 0
  item.effects = item.effects.filter((effect) => effect.type !== 'fade' || effect.inMs > 0 || effect.outMs > 0)
}

/**
 * item を above より上のレイヤーに置く。上にある画面の素材のレイヤーで、その時間が空いているものを近い順に探し、
 * 無ければ above のすぐ上にレイヤーを作る。
 */
function placeAbove(draft: Project, item: Item, above: Item, env: ApplyEnv): void {
  const layers = [...draft.layers].sort((a, b) => a.index - b.index)
  const base = layers.find((layer) => layer.id === above.layerId)
  if (!base) return
  const current = layers.find((layer) => layer.id === item.layerId)
  const free = (layer: Layer): boolean =>
    !draft.items.some((other) => other.id !== item.id && other.layerId === layer.id && other.startMs < itemEnd(item) && item.startMs < itemEnd(other))
  const visualOrEmpty = (layer: Layer): boolean => draft.items.filter((other) => other.layerId === layer.id).every((other) => VISUAL_TYPES.includes(other.type))
  if (current && current.index > base.index && free(current)) return
  // ズームのレイヤーより上に出すと、ズームで一緒に拡大されなくなるので、ズームより下で探す。
  const zoomIndex = Math.min(...draft.items.filter((other) => other.type === 'zoom').map((other) => layers.find((layer) => layer.id === other.layerId)?.index ?? Infinity))
  const target = layers.find((layer) => layer.index > base.index && layer.index < zoomIndex && layer.visible && !layer.locked && visualOrEmpty(layer) && free(layer))
  if (target) {
    item.layerId = target.id
    return
  }
  const name = base.name.replace(/\s+\d+$/, '')
  const names = new Set(draft.layers.map((layer) => layer.name))
  let number = 2
  while (names.has(`${name} ${number}`)) number += 1
  const layer: Layer = { id: env.ctx.newId('lyr'), name: `${name} ${number}`, index: base.index + 1, visible: true, locked: false, muted: false }
  insertLayer(draft, layer)
  item.layerId = layer.id
}

export const transitionHandlers: TransitionHandlers = {
  'timeline.crossTransition': (draft, command, env) => {
    const item = findMutableItem(draft, env.resolve(command.itemId), command.op)
    if (!VISUAL_TYPES.includes(item.type)) fail(command.op, '画面に出る素材(動画・画像・テロップ・図形)を選んでください')
    if (!TRANSITION_KINDS.includes(command.kind as TransitionKind)) fail(command.op, `切り替え方の指定が不正です: ${String(command.kind)}`)
    requireFinite(command.durationMs, command.op, '切り替えの時間')
    if (command.durationMs <= 0) fail(command.op, '切り替えの時間は正の値にしてください')

    const previous = previousVisual(draft, item)
    let duration = Math.round(Math.min(command.durationMs, item.durationMs / 2))
    const kind: TransitionKind = command.kind
    if (previous) {
      if (previous.locked) fail(command.op, '前の素材がロックされています')
      duration = Math.round(Math.min(duration, previous.durationMs / 2))
      // 重なっている分(つながりの誤差)を除いて、あと何ms重ねればよいか。
      const gap = item.startMs - itemEnd(previous)
      const needed = duration + gap
      // 前の素材を後ろへ伸ばす(この素材の始まりは動かさない。セリフとの合わせがずれないように)。
      // 前の素材の続きが足りなければ、この素材の頭を前へ伸ばす。
      const canOverlap = needed <= 0 || sourceRoomAfter(draft, previous) >= needed || sourceRoomBefore(item) >= needed
      if (canOverlap) {
        if (needed > 0) {
          if (sourceRoomAfter(draft, previous) >= needed) extendEnd(previous, needed)
          else extendStart(item, needed)
        }
        dropFade(previous, 'outMs')
        placeAbove(draft, item, previous, env)
      } else {
        // どちらの素材にも重ねる分の続きが無ければ、重ねずに、前の素材を消していってからこの素材を出す
        // (クロスフェードなら、いったん暗くなってから明るくなる)。
        duration = Math.round(duration / 2)
        const fadeOut = { kind: 'fade' as const, durationMs: duration }
        const existingOut = previous.effects.find((effect) => effect.type === 'transition')
        if (existingOut && existingOut.type === 'transition') existingOut.out = fadeOut
        else previous.effects.push({ type: 'transition', in: null, out: fadeOut })
        dropFade(previous, 'outMs')
      }
    }
    dropFade(item, 'inMs')
    const side = { kind, durationMs: duration }
    const existing = item.effects.find((effect) => effect.type === 'transition')
    if (existing && existing.type === 'transition') existing.in = side
    else item.effects.push({ type: 'transition', in: side, out: null })
  }
}
