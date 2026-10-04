import { scaleKeys } from '../../audio/volume-keys'
import { DEFAULT_LAYER_IDS } from '../../project/factory'
import type { Item, Ms, Project, VideoItem } from '../../project/types'
import { fail, findMutableItem, itemEnd, layerOrDefault, requireFinite, shiftItemsFrom, type ApplyEnv, type HandlerTable } from '../env'
import { MAX_SPEED, splitItem } from './edit'

type CondenseHandlers = Pick<HandlerTable, 'video.condense'>

/** 区間の端がアイテムの端にこれより近ければ、分けずに端から使う。 */
const EDGE_MS = 40

/** 早送りの区間に置くテロップの見た目(右上の黒い帯)。 */
const LABEL_LOOK = {
  color: '#ffffff',
  fontWeight: 900,
  fontSizePx: 44,
  outline: 'none' as const,
  shadow: 'none' as const,
  background: { color: '#000000', opacity: 0.6, paddingPx: 12, radiusPx: 10 }
}

function mergeRanges(ranges: readonly { fromMs: Ms; toMs: Ms }[], item: Item): [Ms, Ms][] {
  const sorted = ranges
    .map(({ fromMs, toMs }): [Ms, Ms] => [Math.max(item.startMs, Math.round(fromMs)), Math.min(itemEnd(item), Math.round(toMs))])
    .filter(([from, to]) => to - from >= 50)
    .sort((a, b) => a[0] - b[0])
  const merged: [Ms, Ms][] = []
  for (const range of sorted) {
    const last = merged.at(-1)
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1])
    else merged.push([...range])
  }
  return merged
}

/** item の [from, to] の部分を、別のアイテムとして切り出す(前後は元のアイテムと新しいアイテムに残る)。 */
function carve(draft: Project, item: VideoItem, from: Ms, to: Ms, env: ApplyEnv): VideoItem {
  if (itemEnd(item) - to > EDGE_MS) splitItem(draft, item, to, env.ctx.newId('itm'))
  if (from - item.startMs > EDGE_MS) return splitItem(draft, item, from, env.ctx.newId('itm')) as VideoItem
  return item
}

export const condenseHandlers: CondenseHandlers = {
  'video.condense': (draft, command, env) => {
    const item = findMutableItem(draft, env.resolve(command.itemId), command.op)
    if (item.type !== 'video') fail(command.op, '動画を選んでください')
    if (item.freeze) fail(command.op, '静止画には使えません')
    if (command.mode !== 'cut' && command.mode !== 'speed') fail(command.op, `詰め方の指定が不正です: ${String(command.mode)}`)
    for (const range of command.ranges) {
      requireFinite(range.fromMs, command.op, '区間の始まり')
      requireFinite(range.toMs, command.op, '区間の終わり')
    }
    const rate = command.rate ?? 4
    if (command.mode === 'speed' && !(rate > 1 && rate * item.playbackRate <= MAX_SPEED)) {
      fail(command.op, `早送りの速さは、元の速さと合わせて${MAX_SPEED}倍までにしてください`)
    }
    const ranges = mergeRanges(command.ranges, item)
    if (ranges.length === 0) fail(command.op, '詰める区間がありません')
    const ripple = command.ripple !== false
    const sped: string[] = []

    // 後ろの区間から処理する(前の区間の位置が、後ろの処理で動かないように)。
    for (const [from, to] of [...ranges].reverse()) {
      const part = carve(draft, item, from, to, env)
      if (command.mode === 'cut') {
        draft.items.splice(draft.items.indexOf(part), 1)
        // 後ろを詰める。切り取った区間の終わり以降に始まるものを、切り取った長さだけ前へ。
        if (ripple) shiftItemsFrom(draft, to, -(to - from), new Set())
        continue
      }
      const before = part.durationMs
      part.playbackRate = Math.round(part.playbackRate * rate * 1000) / 1000
      part.durationMs = Math.max(10, Math.round((part.outMs - part.inMs) / part.playbackRate))
      const keys = scaleKeys(part.volumeKeys, part.durationMs / Math.max(1, before))
      if (keys) part.volumeKeys = keys
      const saved = before - part.durationMs
      if (ripple) shiftItemsFrom(draft, to, -saved, new Set([part.id]))
      sped.push(part.id)
    }

    // 早送りの区間に「▶▶ ×4」を出す(右上)。テロップは普通のテロップなので、あとから消したり直したりできる。
    if (command.mode === 'speed' && command.label !== false) {
      const layerId = layerOrDefault(draft, undefined, { id: DEFAULT_LAYER_IDS.voice, name: 'ボイス' }, command.op, env.resolve)
      const style = Object.keys(draft.subtitleStyles)[0]
      if (style) {
        const scale = draft.canvas.width / 1920
        // 位置は、すべての区間を詰め終わってからのもの(前の区間を詰めると後ろの区間も動くため)。
        const labels = draft.items.filter((candidate) => sped.includes(candidate.id)).map((part) => ({ from: part.startMs, to: itemEnd(part) }))
        for (const { from, to } of labels) {
          draft.items.push({
            id: env.ctx.newId('itm'),
            type: 'text',
            layerId,
            startMs: from,
            durationMs: Math.max(10, to - from),
            effects: [{ type: 'blink', periodMs: 1200, minOpacity: 0.55 }],
            locked: false,
            text: `▶▶ ×${Number(rate.toFixed(2))}`,
            styleId: style,
            transform: { x: Math.round(draft.canvas.width - 150 * scale), y: Math.round(70 * scale), scale: 1, rotation: 0, opacity: 1 },
            look: { ...LABEL_LOOK, fontSizePx: Math.round(LABEL_LOOK.fontSizePx * scale) }
          })
        }
      }
    }
  }
}
