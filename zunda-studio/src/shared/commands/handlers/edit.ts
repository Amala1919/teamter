import { scaleKeys, splitKeys } from '../../audio/volume-keys'
import { DEFAULT_LAYER_IDS } from '../../project/factory'
import type { Effect, Item, Ms, Project, VideoItem } from '../../project/types'
import { TIMELINE_COLOR } from '../../project/timeline-colors'
import { removeEmptyLayers, resolveOverlaps } from '../arrange'
import { fadeCutEdge, fail, findMutableItem, itemEnd, layerOrDefault, requireFinite, shiftItemsFrom, type HandlerTable } from '../env'
import type { CommandOp } from '../types'
import { validateEffect } from './item'
import { validateTransform, validateVolume } from './media'

type EditHandlers = Pick<
  HandlerTable,
  | 'item.split'
  | 'item.freezeFrame'
  | 'item.paste'
  | 'item.setSpeed'
  | 'item.setLocked'
  | 'timeline.rippleDelete'
  | 'timeline.closeGap'
  | 'timeline.packLeft'
  | 'timeline.insertGap'
  | 'timeline.arrangeOverlaps'
  | 'layer.removeEmpty'
  | 'item.setColor'
  | 'item.group'
  | 'item.ungroup'
>

/** 分けたときに両側に残す最短の尺。 */
const MIN_PART_MS = 10
export const MIN_SPEED = 0.25
export const MAX_SPEED = 4

const ITEM_TYPES: readonly Item['type'][] = ['voice', 'video', 'image', 'text', 'audio', 'shape', 'portrait', 'zoom']

/** 種類ごとの既定のレイヤー(貼り付け先のレイヤーが無くなっていたとき)。 */
const DEFAULT_LAYER: Record<Item['type'], { id: string; name: string }> = {
  voice: { id: DEFAULT_LAYER_IDS.voice, name: 'ボイス' },
  audio: { id: DEFAULT_LAYER_IDS.bgm, name: 'BGM' },
  zoom: { id: DEFAULT_LAYER_IDS.zoom, name: 'ズーム' },
  portrait: { id: DEFAULT_LAYER_IDS.portrait, name: '立ち絵' },
  video: { id: DEFAULT_LAYER_IDS.background, name: '背景' },
  image: { id: DEFAULT_LAYER_IDS.background, name: '背景' },
  text: { id: DEFAULT_LAYER_IDS.background, name: '背景' },
  shape: { id: DEFAULT_LAYER_IDS.background, name: '背景' }
}

/** 分けたとき、前半・後半に残すエフェクト。フェードは前半に入り・後半に出だけ、揺れは両方、動きは前半だけ。 */
function splitEffects(effects: readonly Effect[]): { first: Effect[]; second: Effect[] } {
  const first: Effect[] = []
  const second: Effect[] = []
  for (const effect of effects) {
    if (effect.type === 'fade') {
      if (effect.inMs > 0) first.push({ type: 'fade', inMs: effect.inMs, outMs: 0 })
      if (effect.outMs > 0) second.push({ type: 'fade', inMs: 0, outMs: effect.outMs })
    } else if (effect.type === 'transition') {
      // 登場は前半に、退場は後半に残す。
      if (effect.in) first.push({ type: 'transition', in: { ...effect.in }, out: null })
      if (effect.out) second.push({ type: 'transition', in: null, out: { ...effect.out } })
    } else {
      first.push({ ...effect })
      // 揺れと、繰り返しの動き(ドクンドクン・点滅・回転など)は両方に残す。
      if (['shake', 'pulse', 'blink', 'spin', 'swing', 'float'].includes(effect.type)) second.push({ ...effect })
    }
  }
  return { first, second }
}

/**
 * アイテムを at で2つに分け、後半(新しいアイテム)を返す。前半は元のアイテムのまま短くなる。
 * 動画・音声は素材の区間も分け、フェードは前半に入り・後半に出だけを残す。
 */
function splitItem(draft: Project, item: Item, at: Ms, newId: string): Item {
  const second = clone(item)
  second.id = newId
  second.startMs = at
  second.durationMs = itemEnd(item) - at
  // 音量の折れ点も、分けた所で前半と後半に分ける。
  if ((item.type === 'audio' || item.type === 'video') && (second.type === 'audio' || second.type === 'video') && item.volumeKeys) {
    const keys = splitKeys(item.volumeKeys, at - item.startMs, item.durationMs)
    if (keys.first) item.volumeKeys = keys.first
    else delete item.volumeKeys
    if (keys.second) second.volumeKeys = keys.second
    else delete second.volumeKeys
  }
  item.durationMs = at - item.startMs
  const effects = splitEffects(item.effects)
  item.effects = effects.first
  second.effects = effects.second

  if (item.type === 'video' && second.type === 'video' && !item.freeze) {
    const cut = Math.round(item.inMs + item.durationMs * item.playbackRate)
    second.inMs = cut
    item.outMs = cut
  } else if (item.type === 'audio' && second.type === 'audio') {
    // ループ再生の音は、後半も素材の頭から繰り返す(区間はそのまま)。
    if (!item.loop) {
      const cut = item.inMs + item.durationMs
      second.inMs = cut
      item.outMs = cut
    }
    item.fadeOutMs = 0
    second.fadeInMs = 0
  }
  draft.items.splice(draft.items.indexOf(item) + 1, 0, second)
  return second
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/** 貼り付けるアイテムが、このプロジェクトで成り立つか確かめる(別のプロジェクトからの貼り付けに備える)。 */
function validatePasted(draft: Project, item: Item, op: CommandOp): void {
  if (!ITEM_TYPES.includes(item.type)) fail(op, `未対応のアイテムです: ${String(item.type)}`)
  requireFinite(item.startMs, op, '開始時刻')
  requireFinite(item.durationMs, op, '尺')
  if (item.durationMs <= 0) fail(op, '尺は正の値でなければなりません')
  if (!Array.isArray(item.effects)) fail(op, 'エフェクトの形式が不正です')
  item.effects = item.effects.map((effect) => validateEffect(effect, op))
  if ('assetId' in item && !draft.assets[item.assetId]) fail(op, '貼り付ける素材がこのプロジェクトにありません')
  if ((item.type === 'voice' || item.type === 'portrait') && !draft.characters[item.characterId]) {
    fail(op, '貼り付けるセリフのキャラクターがこのプロジェクトにいません')
  }
  if (item.type === 'text' && !draft.subtitleStyles[item.styleId]) fail(op, '貼り付けるテロップの字幕スタイルがありません')
  if ('transform' in item) validateTransform(item.transform, op)
  if (item.type === 'video' || item.type === 'audio') validateVolume(item.volume, op)
}

export const editHandlers: EditHandlers = {
  'item.split': (draft, command, env) => {
    const item = findMutableItem(draft, env.resolve(command.itemId), command.op)
    if (item.type === 'voice') fail(command.op, 'セリフは分けられません(台本で2つのセリフに分けてください)')
    if (item.type === 'zoom') fail(command.op, 'ズームは分けられません(長さを変えてください)')
    const at = Math.round(requireFinite(command.atMs, command.op, '分ける位置'))
    if (at - item.startMs < MIN_PART_MS || itemEnd(item) - at < MIN_PART_MS) {
      fail(command.op, '分ける位置がアイテムの中にありません')
    }
    const second = splitItem(draft, item, at, env.ctx.newId('itm'))
    // 動画の最後まで伸びるのは後半だけ(前半は分けた位置で終わる)。
    if (item.type === 'portrait') delete item.untilEnd
    // 動画を切った所は、前半を消えていくように、後半を現れるようにする(設定で切れる)。
    fadeCutEdge(draft, item, 'out')
    fadeCutEdge(draft, second, 'in')
    if (command.tempId) env.resolvedIds[command.tempId] = second.id
  },

  'item.freezeFrame': (draft, command, env) => {
    const item = findMutableItem(draft, env.resolve(command.itemId), command.op)
    if (item.type !== 'video') fail(command.op, '静止画にできるのは動画だけです')
    if (item.freeze) fail(command.op, 'すでに静止画です(長さを変えてください)')
    const at = Math.round(requireFinite(command.atMs, command.op, '止める位置'))
    const length = Math.round(requireFinite(command.durationMs, command.op, '止める長さ'))
    if (length < MIN_PART_MS) fail(command.op, '止める長さが短すぎます')
    if (at < item.startMs || at > itemEnd(item)) fail(command.op, '止める位置が動画の中にありません')

    // 止める直前に映っていたコマ(区切りの位置そのものは、後半の最初のコマになるため)。
    const asset = draft.assets[item.assetId]
    const frameMs = 1000 / (asset?.type === 'video' && asset.fps > 0 ? asset.fps : 30)
    const cutSource = item.inMs + (at - item.startMs) * item.playbackRate
    const frameSource = Math.round(Math.min(Math.max(item.inMs, cutSource - frameMs), Math.max(item.inMs, item.outMs - frameMs)))

    // 静止画の後ろに続く動画(途中で止めるなら後半、頭で止めるなら動画全体、終わりで止めるなら無し)。
    let after: VideoItem | null = null
    if (at - item.startMs >= MIN_PART_MS && itemEnd(item) - at >= MIN_PART_MS) {
      after = splitItem(draft, item, at, env.ctx.newId('itm')) as VideoItem
    } else if (at - item.startMs < MIN_PART_MS) {
      after = item
    }

    if (command.mode === 'insert') {
      // その時刻にかかっているズームは、止めている間も寄ったままにする。
      for (const other of draft.items) {
        if (other.type === 'zoom' && !other.locked && other.startMs < at && at < itemEnd(other)) other.durationMs += length
      }
      shiftItemsFrom(draft, at, length, new Set())
    } else if (after) {
      // 上書き: 動画のその先を静止画の長さだけ削る。
      if (after.durationMs <= length) {
        draft.items.splice(draft.items.indexOf(after), 1)
      } else {
        after.inMs = Math.round(after.inMs + length * after.playbackRate)
        after.startMs = at + length
        after.durationMs -= length
        // 静止画の後は映像が飛ぶので、続きの動画をフェードインさせる(設定で切れる)。
        // 静止画の前はそのコマから続くので、フェードアウトはしない。
        if (draft.editing.freezeFadeIn !== false) fadeCutEdge(draft, after, 'in')
      }
    }

    const still: VideoItem = {
      ...clone(item),
      id: env.ctx.newId('itm'),
      startMs: at,
      durationMs: length,
      inMs: frameSource,
      outMs: frameSource,
      playbackRate: 1,
      freeze: true,
      effects: [],
      locked: false
    }
    const index = draft.items.indexOf(item)
    draft.items.splice(index + 1, 0, still)
    if (command.tempId) env.resolvedIds[command.tempId] = still.id
  },

  'item.paste': (draft, command, env) => {
    if (command.items.length === 0) fail(command.op, '貼り付けるものがありません')
    if (command.items.length > 500) fail(command.op, '一度に貼り付けられるのは500個までです')
    requireFinite(command.atMs, command.op, '貼り付ける位置')
    if (command.atMs < 0) fail(command.op, '貼り付ける位置は負の値にできません')
    const earliest = Math.min(...command.items.map((item) => item.startMs))
    // 貼り付けたものは元のグループには入れない。一緒に貼り付けた仲間どうしで、新しいグループにする。
    const groups = new Map<string, string>()
    command.items.forEach((source, index) => {
      const item = clone(source)
      validatePasted(draft, item, command.op)
      item.id = env.ctx.newId('itm')
      if (item.groupId !== undefined) {
        const next = groups.get(item.groupId) ?? env.ctx.newId('grp')
        groups.set(item.groupId, next)
        item.groupId = next
      }
      item.locked = false
      item.startMs = Math.round(command.atMs + (source.startMs - earliest))
      const layerExists = draft.layers.some((layer) => layer.id === item.layerId)
      item.layerId = layerExists ? item.layerId : layerOrDefault(draft, undefined, DEFAULT_LAYER[item.type], command.op, env.resolve)
      draft.items.push(item)
      if (command.tempIdPrefix) env.resolvedIds[`${command.tempIdPrefix}${index}`] = item.id
    })
  },

  'item.setSpeed': (draft, command, env) => {
    const item = findMutableItem(draft, env.resolve(command.itemId), command.op)
    if (item.type !== 'video') fail(command.op, '速度を変えられるのは動画だけです')
    if (item.freeze) fail(command.op, '静止画の速度は変えられません')
    requireFinite(command.rate, command.op, '速度')
    if (command.rate < MIN_SPEED || command.rate > MAX_SPEED) fail(command.op, `速度は${MIN_SPEED}〜${MAX_SPEED}倍にしてください`)
    item.playbackRate = command.rate
    const before = item.durationMs
    item.durationMs = Math.max(MIN_PART_MS, Math.round((item.outMs - item.inMs) / command.rate))
    // 音量の折れ点は、素材の同じ場所に付いたままにする(長さに合わせて伸び縮みさせる)。
    const keys = scaleKeys(item.volumeKeys, item.durationMs / Math.max(1, before))
    if (keys) item.volumeKeys = keys
  },

  'item.setLocked': (draft, command, env) => {
    const itemId = env.resolve(command.itemId)
    const item = draft.items.find((candidate) => candidate.id === itemId)
    if (!item) fail(command.op, `アイテムが見つかりません: ${itemId}`)
    item.locked = command.locked
  },

  'timeline.rippleDelete': (draft, command, env) => {
    const ids = new Set(command.itemIds.map((id) => env.resolve(id)))
    if (ids.size === 0) fail(command.op, '消すアイテムがありません')
    const removed: Item[] = []
    for (const id of ids) {
      const item = findMutableItem(draft, id, command.op)
      removed.push(item)
    }
    draft.items = draft.items.filter((item) => !ids.has(item.id))
    for (const session of Object.values(draft.liveSessions)) {
      for (const entry of session.entries) {
        if (entry.adoptedItemId && ids.has(entry.adoptedItemId)) entry.adoptedItemId = null
      }
    }
    // 消した範囲をまとめ、後ろの範囲から順に詰める(前を先に詰めると後ろの範囲の位置がずれるため)。
    // 既定では、残った素材がある時間は詰めない。ignoreOthers なら、ほかの素材は考慮せず消した長さだけ詰める。
    const ranges = mergeRanges(removed.map((item) => [item.startMs, itemEnd(item)] as [Ms, Ms]))
    for (const [start, end] of ranges.reverse()) {
      let occupied = start
      for (const item of command.ignoreOthers ? [] : draft.items) {
        if (item.startMs < end && itemEnd(item) <= end && itemEnd(item) > occupied) occupied = itemEnd(item)
      }
      if (end > occupied) shiftItemsFrom(draft, end, -(end - occupied), new Set())
    }
  },

  'timeline.closeGap': (draft, command) => {
    const at = requireFinite(command.atMs, command.op, '位置')
    if (draft.items.some((item) => item.startMs <= at && at < itemEnd(item))) {
      fail(command.op, 'ここにはアイテムがあります。何も置かれていない所で使ってください')
    }
    let previousEnd = 0
    let nextStart: Ms | null = null
    for (const item of draft.items) {
      if (itemEnd(item) <= at) previousEnd = Math.max(previousEnd, itemEnd(item))
      else if (item.startMs > at && (nextStart === null || item.startMs < nextStart)) nextStart = item.startMs
    }
    if (nextStart === null) fail(command.op, '後ろにアイテムがありません')
    shiftItemsFrom(draft, nextStart, -(nextStart - previousEnd), new Set())
  },

  'timeline.packLeft': (draft, command, env) => {
    const ids = new Set(command.itemIds.map((id) => env.resolve(id)))
    if (ids.size === 0) fail(command.op, '詰めるアイテムを選んでください')
    for (const id of ids) {
      if (!draft.items.some((item) => item.id === id)) fail(command.op, `アイテムが見つかりません: ${id}`)
    }
    // グループの仲間も一緒に動かす。ロック中のもの(レイヤーのロックも)は動かさず、ほかを止める側にする。
    const lockedLayers = new Set(draft.layers.filter((layer) => layer.locked).map((layer) => layer.id))
    const groups = new Set(draft.items.filter((item) => ids.has(item.id) && item.groupId !== undefined).map((item) => item.groupId))
    const movable = draft.items.filter(
      (item) => (ids.has(item.id) || (item.groupId !== undefined && groups.has(item.groupId))) && !item.locked && !lockedLayers.has(item.layerId)
    )
    if (movable.length === 0) fail(command.op, '動かせるアイテムがありません(ロックされています)')

    // 一緒に動かす単位。間を保つなら全体で1つ、そうでなければグループごと・1つずつ(前にあるものから順に詰める)。
    const units: Item[][] = []
    if (command.keepGaps) units.push(movable)
    else {
      const byGroup = new Map<string, Item[]>()
      for (const item of movable) {
        if (item.groupId === undefined) units.push([item])
        else if (byGroup.has(item.groupId)) byGroup.get(item.groupId)!.push(item)
        else {
          const unit = [item]
          byGroup.set(item.groupId, unit)
          units.push(unit)
        }
      }
      units.sort((a, b) => Math.min(...a.map((item) => item.startMs)) - Math.min(...b.map((item) => item.startMs)))
    }

    let movedAny = false
    for (const unit of units) {
      const members = new Set(unit.map((item) => item.id))
      const delta = Math.min(...unit.map((item) => roomBefore(draft, item, members)))
      if (delta <= 0) continue
      for (const item of unit) item.startMs -= delta
      movedAny = true
    }
    if (!movedAny) fail(command.op, '前に詰められる空白がありません')
  },

  'timeline.insertGap': (draft, command) => {
    const at = requireFinite(command.atMs, command.op, '位置')
    const length = requireFinite(command.durationMs, command.op, '空ける長さ')
    if (at < 0) fail(command.op, '位置は負の値にできません')
    if (length <= 0) fail(command.op, '空ける長さは正の値にしてください')
    shiftItemsFrom(draft, at, Math.round(length), new Set())
  },

  'timeline.arrangeOverlaps': (draft, _command, env) => {
    resolveOverlaps(
      draft,
      draft.items.map((item) => item.id),
      env
    )
  },

  'layer.removeEmpty': (draft) => {
    removeEmptyLayers(draft)
  },

  'item.setColor': (draft, command, env) => {
    if (command.color !== null && !TIMELINE_COLOR.test(command.color)) fail(command.op, `色の指定が不正です: ${command.color}`)
    for (const rawId of command.itemIds) {
      const id = env.resolve(rawId)
      // 色はタイムラインの見分けのための印なので、ロック中の素材も変えられる。
      const item = draft.items.find((candidate) => candidate.id === id)
      if (!item) fail(command.op, `アイテムが見つかりません: ${id}`)
      if (command.color === null) delete item.color
      else item.color = command.color.toLowerCase()
    }
  },

  'item.group': (draft, command, env) => {
    const ids = new Set(command.itemIds.map((id) => env.resolve(id)))
    const items = [...ids].map((id) => {
      const item = draft.items.find((candidate) => candidate.id === id)
      if (!item) fail(command.op, `アイテムが見つかりません: ${id}`)
      return item
    })
    // 既にグループに入っているものは、そのグループの仲間ごとまとめる(グループが入れ子にならないように)。
    const absorbed = new Set(items.map((item) => item.groupId).filter((id): id is string => id !== undefined))
    const members = draft.items.filter((item) => ids.has(item.id) || (item.groupId !== undefined && absorbed.has(item.groupId)))
    if (members.length < 2) fail(command.op, 'グループにするには2つ以上選んでください')
    const groupId = env.ctx.newId('grp')
    for (const item of members) item.groupId = groupId
    if (command.tempId) env.resolvedIds[command.tempId] = groupId
  },

  'item.ungroup': (draft, command, env) => {
    for (const rawId of command.itemIds) {
      const id = env.resolve(rawId)
      const item = draft.items.find((candidate) => candidate.id === id)
      if (!item) fail(command.op, `アイテムが見つかりません: ${id}`)
      delete item.groupId
    }
  }
}

/** 1つしか残っていないグループを解く(消したり外したりした後に、独りのグループが残らないように)。 */
export function dissolveLoneGroups(draft: Project): void {
  const counts = new Map<string, number>()
  for (const item of draft.items) if (item.groupId !== undefined) counts.set(item.groupId, (counts.get(item.groupId) ?? 0) + 1)
  for (const item of draft.items) if (item.groupId !== undefined && (counts.get(item.groupId) ?? 0) < 2) delete item.groupId
}

/**
 * アイテムの前にある空き(ms)。同じレイヤーで前にある素材の終わり(無ければ 0 秒)まで。
 * セリフは声が重ならないよう、ほかのレイヤーのセリフも前の素材として数える。一緒に動かす仲間(unit)は数えない。
 */
function roomBefore(draft: Project, item: Item, unit: ReadonlySet<string>): Ms {
  let limit = 0
  for (const other of draft.items) {
    if (unit.has(other.id) || other.startMs >= item.startMs) continue
    if (other.layerId !== item.layerId && !(item.type === 'voice' && other.type === 'voice')) continue
    limit = Math.max(limit, itemEnd(other))
  }
  return Math.max(0, item.startMs - limit)
}

function mergeRanges(ranges: [Ms, Ms][]): [Ms, Ms][] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0])
  const merged: [Ms, Ms][] = []
  for (const range of sorted) {
    const last = merged.at(-1)
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1])
    else merged.push([range[0], range[1]])
  }
  return merged
}
