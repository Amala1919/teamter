import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import type { Command } from '@shared/commands/types'
import { entryTimelineMs } from '@shared/live/timing'
import { itemEndMs, projectDurationMs } from '@shared/project/queries'
import { timelineColor } from '@shared/project/timeline-colors'
import { PREVIEW_RESOLUTIONS, type Item, type Layer, type Ms, type Project } from '@shared/project/types'
import { ZOOM_METHOD_LABELS } from '@shared/render/zoom'

import { pickColor } from '../../lib/pick-color'
import { formatMs } from '../../lib/time'
import { usePlaybackStore } from '../../playback/player'
import { withGroups } from '../../state/edit-actions'
import { assetName, importMediaFiles, parsePreview } from '../../state/media'
import { useSettingsStore } from '../../state/settings'
import { useEditorStore } from '../../state/store'
import { openContextMenu } from '../../ui/ContextMenu'
import { itemMenu, laneMenu, layerMenu, rulerMenu, type MenuContext } from './timeline-menus'
import { FreeSourcesDialog } from '../media/FreeSourcesDialog'
import { Waveform } from './Waveform'

const MIN_VISIBLE_MS = 10_000
/** 最後のアイテムの後ろに空けておく余白(そこへドラッグで伸ばせるように)。 */
const TAIL_MS = 10_000
const ROW_HEIGHT = 36
const HEADER_WIDTH = 112
/** これより動かなければドラッグではなくクリックとみなす。 */
const DRAG_THRESHOLD_PX = 3
const SNAP_PX = 8
/** 拡大の範囲(1秒あたりの画素数)と、ホイール1段での倍率。 */
const MIN_PX_PER_SECOND = 5
const MAX_PX_PER_SECOND = 300
const WHEEL_ZOOM_STEP = 1.2

type DragMode = 'move' | 'start' | 'end'

interface DragState {
  itemId: string
  mode: DragMode
  originX: number
  originY: number
  moved: boolean
  deltaMs: Ms
  layerOffset: number
  /** 一緒に動かすアイテム(複数選んでいるときに、そのうちの1つをつかんだら全部を時間方向に動かす)。 */
  group: string[]
  /** 選んでいた複数の中の1つをつかんだか(動かさずに離したら、それ(とそのグループ)だけを選び直す)。 */
  reselectOnClick: boolean
}

export function TimelinePane({ onError }: { onError: (message: string) => void }): React.JSX.Element {
  const project = useEditorStore((state) => state.project)
  const playheadMs = useEditorStore((state) => state.playheadMs)
  const setPlayhead = useEditorStore((state) => state.setPlayhead)
  const selectedItemIds = useEditorStore((state) => state.selectedItemIds)
  const setSelection = useEditorStore((state) => state.setSelection)
  const dispatch = useEditorStore((state) => state.dispatch)
  const playing = usePlaybackStore((state) => state.playing)
  const [pxPerSecond, setPxPerSecond] = useState(60)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [sourcesOpen, setSourcesOpen] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const rulerRef = useRef<HTMLDivElement>(null)
  const zoomRef = useRef(pxPerSecond)
  zoomRef.current = pxPerSecond
  const pendingScroll = useRef<number | null>(null)

  useLayoutEffect(() => {
    const scroller = scrollRef.current
    if (pendingScroll.current === null || !scroller) return
    scroller.scrollLeft = Math.max(0, pendingScroll.current)
    pendingScroll.current = null
  }, [pxPerSecond])

  const visibleMs = Math.max(projectDurationMs(project) + TAIL_MS, MIN_VISIBLE_MS)
  const contentWidth = (visibleMs / 1000) * pxPerSecond
  const msToPx = (ms: Ms): number => (ms / 1000) * pxPerSecond

  // ライブで打った目印を、録画の場面の位置に出す(R-9)。
  const liveMarkers = useMemo(() => {
    const markers: { key: string; atMs: Ms; text: string }[] = []
    for (const session of Object.values(project.liveSessions)) {
      for (const entry of session.entries) {
        if (!entry.bookmarked) continue
        const atMs = entryTimelineMs(project, session, entry)
        if (atMs !== null) markers.push({ key: `${session.id}:${entry.id}`, atMs, text: entry.text })
      }
    }
    return markers
  }, [project])

  const layersFrontFirst = useMemo(() => [...project.layers].sort((a, b) => b.index - a.index), [project.layers])
  const itemsByLayer = useMemo(() => {
    const grouped = new Map<string, Item[]>()
    for (const layer of project.layers) grouped.set(layer.id, [])
    for (const item of project.items) grouped.get(item.layerId)?.push(item)
    return grouped
  }, [project])

  // 再生中は再生位置が見える範囲に収まるよう追いかける。
  useEffect(() => {
    const scroller = scrollRef.current
    if (!playing || !scroller) return
    const x = msToPx(playheadMs) + HEADER_WIDTH
    if (x < scroller.scrollLeft + HEADER_WIDTH || x > scroller.scrollLeft + scroller.clientWidth - 40) {
      scroller.scrollLeft = x - HEADER_WIDTH - 40
    }
  })

  /**
   * 目盛りの上でホイールを回すと拡大・縮小する(上で拡大)。タイムラインのどこでも Ctrl+ホイールで同じ。
   * マウスの下の時刻が動かないよう、横のスクロールも合わせる。
   * React の wheel は preventDefault できない(passive)ので、要素に直接付ける。
   */
  useEffect(() => {
    const scroller = scrollRef.current
    const ruler = rulerRef.current
    if (!scroller || !ruler) return
    const onWheel = (event: WheelEvent): void => {
      const onRuler = event.target instanceof Node && ruler.contains(event.target)
      if (!onRuler && !event.ctrlKey) return
      if (event.deltaY === 0) return
      event.preventDefault()
      const current = zoomRef.current
      const next = Math.min(MAX_PX_PER_SECOND, Math.max(MIN_PX_PER_SECOND, current * (event.deltaY < 0 ? WHEEL_ZOOM_STEP : 1 / WHEEL_ZOOM_STEP)))
      if (next === current) return
      const seconds = Math.max(0, (event.clientX - ruler.getBoundingClientRect().left) / current)
      zoomRef.current = next
      // 幅が広がるのは描き直した後なので、スクロールはその後で合わせる(useLayoutEffect)。
      pendingScroll.current = scroller.scrollLeft + seconds * (next - current)
      setPxPerSecond(next)
    }
    scroller.addEventListener('wheel', onWheel, { passive: false })
    return () => scroller.removeEventListener('wheel', onWheel)
  }, [])

  const run = (commands: Command[], label: string): void => {
    const result = dispatch(commands, label)
    if (!result.ok) onError(result.message)
  }

  const snapTargets = (excludeId: string): Ms[] => {
    const targets = [0, playheadMs]
    for (const item of project.items) {
      if (item.id === excludeId) continue
      targets.push(item.startMs, itemEndMs(item))
    }
    return targets
  }

  /** 端の時刻がほかのアイテムの端や再生位置に近ければ吸い付かせる。 */
  const snapDelta = (edges: Ms[], deltaMs: Ms, excludeId: string): Ms => {
    const limit = (SNAP_PX / pxPerSecond) * 1000
    let best: Ms | null = null
    for (const target of snapTargets(excludeId)) {
      for (const edge of edges) {
        const candidate = target - edge
        if (Math.abs(candidate - deltaMs) <= limit && (best === null || Math.abs(candidate - deltaMs) < Math.abs(best - deltaMs))) {
          best = candidate
        }
      }
    }
    return best ?? deltaMs
  }

  const beginDrag = (event: React.PointerEvent, item: Item, mode: DragMode): void => {
    if (event.button !== 0) return
    event.stopPropagation()
    const layer = project.layers.find((candidate) => candidate.id === item.layerId)
    // グループに入っているものは、グループごと選ぶ。
    const own = withGroups(project.items, [item.id])
    // 複数選んでいる中の1つをつかんだら、選んだものをまとめて動かす(離すまで選択はそのまま)。
    const keepGroup = !event.shiftKey && mode === 'move' && selectedItemIds.length > 1 && selectedItemIds.includes(item.id)
    const selection = event.shiftKey
      ? selectedItemIds.includes(item.id)
        ? selectedItemIds
        : [...selectedItemIds, ...own.filter((id) => !selectedItemIds.includes(id))]
      : keepGroup
        ? selectedItemIds
        : own
    if (selection !== selectedItemIds) setSelection(selection)
    if (item.locked || layer?.locked) return
    const lockedLayers = new Set(project.layers.filter((candidate) => candidate.locked).map((candidate) => candidate.id))
    // 動かすもの: 選んだもの(グループの仲間を含む)。端をつまんで長さを変えるときは、つかんだものだけ。
    const moving = mode === 'move' ? withGroups(project.items, selection) : [item.id]
    const group = project.items.filter((candidate) => moving.includes(candidate.id) && !candidate.locked && !lockedLayers.has(candidate.layerId)).map((candidate) => candidate.id)
    setDrag({ itemId: item.id, mode, originX: event.clientX, originY: event.clientY, moved: false, deltaMs: 0, layerOffset: 0, group, reselectOnClick: keepGroup })
  }

  useEffect(() => {
    if (!drag) return
    const item = project.items.find((candidate) => candidate.id === drag.itemId)
    if (!item) return
    const onMove = (event: PointerEvent): void => {
      const dx = event.clientX - drag.originX
      const dy = event.clientY - drag.originY
      const moved = drag.moved || Math.hypot(dx, dy) > DRAG_THRESHOLD_PX
      let deltaMs = (dx / pxPerSecond) * 1000
      if (drag.mode === 'move') {
        deltaMs = snapDelta([item.startMs, itemEndMs(item)], deltaMs, item.id)
        // まとめて動かすときは、いちばん前のものが 0 秒より前に出ないようにする。
        const earliest = Math.min(...project.items.filter((candidate) => drag.group.includes(candidate.id)).map((candidate) => candidate.startMs), item.startMs)
        deltaMs = Math.max(-earliest, deltaMs)
      } else if (drag.mode === 'start') {
        deltaMs = snapDelta([item.startMs], deltaMs, item.id)
        deltaMs = Math.min(Math.max(-item.startMs, deltaMs), item.durationMs - 10)
      } else {
        deltaMs = snapDelta([itemEndMs(item)], deltaMs, item.id)
        deltaMs = Math.max(10 - item.durationMs, deltaMs)
      }
      const layerOffset = drag.mode === 'move' && drag.group.length <= 1 ? Math.round(dy / ROW_HEIGHT) : 0
      setDrag({ ...drag, moved, deltaMs, layerOffset })
    }
    const onUp = (): void => {
      setDrag(null)
      if (!drag.moved) {
        // まとめてつかんで動かさなかったら、クリックしたもの(とそのグループ)だけを選び直す。
        if (drag.reselectOnClick) setSelection(withGroups(project.items, [item.id]))
        setPlayhead(item.startMs)
        return
      }
      commitDrag(project, item, drag, layersFrontFirst, run)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp, { once: true })
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  })

  const scrub = (event: React.PointerEvent<HTMLDivElement>): void => {
    const bounds = event.currentTarget.getBoundingClientRect()
    const seek = (clientX: number): void => setPlayhead(Math.max(0, ((clientX - bounds.left) / pxPerSecond) * 1000))
    seek(event.clientX)
    const onMove = (move: PointerEvent): void => seek(move.clientX)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', () => window.removeEventListener('pointermove', onMove), { once: true })
  }

  const addMedia = async (): Promise<void> => {
    try {
      const { errors } = await importMediaFiles()
      if (errors.length > 0) onError(errors.join('\n'))
    } catch (error) {
      onError(String(error))
    }
  }

  const previewDefault = useSettingsStore((state) => state.settings?.media.previewResolution ?? 'auto')

  const addCaption = (): void => {
    const result = dispatch([{ op: 'media.placeText', text: 'テロップ', atMs: playheadMs, durationMs: 3000, tempId: 'text' }], 'テロップの追加')
    if (!result.ok) onError(result.message)
    else if (result.resolvedIds['text']) setSelection([result.resolvedIds['text']])
  }

  const step = labelStepSeconds(pxPerSecond)
  const menuContext: MenuContext = { onError, onAddMedia: () => void addMedia() }
  /** クリックした位置の時刻(レーン・目盛りの左端が 0)。 */
  const timeAt = (event: React.MouseEvent<HTMLElement>): Ms =>
    ((event.clientX - event.currentTarget.getBoundingClientRect().left) / pxPerSecond) * 1000

  const onItemContextMenu = (event: React.MouseEvent, item: Item): void => {
    // 選んでいないアイテムを右クリックしたら、それ(とそのグループ)だけを選び直す。
    if (!selectedItemIds.includes(item.id)) setSelection(withGroups(project.items, [item.id]))
    openContextMenu(event, itemMenu(project, item, menuContext))
  }

  return (
    <section className="pane pane--timeline" data-testid="timeline">
      <header className="pane__header">
        <h2>タイムライン</h2>
        <button type="button" className="button--small" onClick={() => void addMedia()} data-testid="add-media">
          素材を追加
        </button>
        <label className="timeline__previewQuality" title="これから読み込む動画のプレビューの画質(書き出しは常に元の画質)。読み込んだ後はインスペクタで動画ごとに変えられます">
          プレビュー画質
          <select
            value={String(previewDefault)}
            onChange={(event) => void useSettingsStore.getState().update({ media: { previewResolution: parsePreview(event.target.value) } })}
            data-testid="import-preview-quality"
          >
            {PREVIEW_RESOLUTIONS.map((value) => (
              <option key={value} value={String(value)}>
                {PREVIEW_SHORT_LABELS[String(value)]}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="button--small" onClick={addCaption} data-testid="add-caption">
          テロップ
        </button>
        <button type="button" className="button--small" onClick={() => setSourcesOpen(true)} data-testid="open-free-sources" title="フリー BGM・効果音のサイト一覧">
          フリー素材サイト
        </button>
        <label className="timeline__zoom">
          拡大
          <input
            type="range"
            min={MIN_PX_PER_SECOND}
            max={MAX_PX_PER_SECOND}
            step={1}
            value={Math.round(pxPerSecond)}
            onChange={(event) => setPxPerSecond(Number(event.target.value))}
            aria-label="タイムラインの拡大"
            title="目盛りの上でマウスホイールを回しても拡大・縮小できます"
            data-testid="timeline-zoom"
          />
        </label>
        <span className="pane__count">{project.items.length}アイテム</span>
      </header>

      <div className="timeline__scroll" ref={scrollRef}>
        <div className="timeline__body" style={{ width: `${contentWidth + HEADER_WIDTH}px` }}>
          <div className="timeline__row timeline__row--ruler">
            <div className="timeline__header timeline__header--corner" />
            <div
              className="timeline__ruler"
              ref={rulerRef}
              onPointerDown={scrub}
              onContextMenu={(event) => openContextMenu(event, rulerMenu(timeAt(event), menuContext))}
              data-testid="timeline-ruler"
            >
              {liveMarkers.map((marker) => (
                <span
                  key={marker.key}
                  className="timeline__marker"
                  style={{ left: `${msToPx(marker.atMs)}px` }}
                  title={`ライブの目印: ${marker.text}`}
                  data-testid="timeline-live-marker"
                  onPointerDown={(event) => {
                    event.stopPropagation()
                    setPlayhead(marker.atMs)
                  }}
                >
                  ★
                </span>
              ))}
              {Array.from({ length: Math.ceil(visibleMs / 1000 / step) + 1 }, (_, index) => (
                <span key={index} className="timeline__tick" style={{ left: `${index * step * pxPerSecond}px` }}>
                  {formatMs(index * step * 1000).replace(/\.\d+$/, '')}
                </span>
              ))}
            </div>
          </div>

          {layersFrontFirst.map((layer) => (
            <div key={layer.id} className="timeline__row" data-testid={`layer-${layer.id}`}>
              <LayerHeader layer={layer} run={run} onContextMenu={(event) => openContextMenu(event, layerMenu(layer, menuContext))} />
              <div
                className={layer.visible ? 'timeline__lane' : 'timeline__lane timeline__lane--hidden'}
                onPointerDown={(event) => {
                  if (event.target === event.currentTarget && event.button === 0) setSelection([])
                }}
                onContextMenu={(event) => {
                  if (event.target === event.currentTarget) openContextMenu(event, laneMenu(project, layer, timeAt(event), menuContext))
                }}
                data-testid={`lane-${layer.id}`}
              >
                {(itemsByLayer.get(layer.id) ?? []).map((item) => {
                  const dragging = drag?.moved && (drag.itemId === item.id || (drag.mode === 'move' && drag.group.includes(item.id))) ? drag : null
                  const start = item.startMs + (dragging && dragging.mode !== 'end' ? dragging.deltaMs : 0)
                  const end = itemEndMs(item) + (dragging && dragging.mode !== 'start' ? dragging.deltaMs : 0)
                  const offsetRows = dragging?.layerOffset ?? 0
                  return (
                    <TimelineItem
                      key={item.id}
                      project={project}
                      item={item}
                      left={msToPx(start)}
                      width={Math.max(msToPx(end - start), 6)}
                      top={offsetRows * ROW_HEIGHT}
                      dragging={dragging !== null}
                      selected={selectedItemIds.includes(item.id)}
                      locked={item.locked || layer.locked}
                      onPointerDown={beginDrag}
                      onContextMenu={onItemContextMenu}
                    />
                  )
                })}
              </div>
            </div>
          ))}

          <div
            className="timeline__playhead"
            style={{ left: `${HEADER_WIDTH + msToPx(playheadMs)}px` }}
            data-testid="timeline-playhead"
          />
        </div>
      </div>
      {sourcesOpen && <FreeSourcesDialog onClose={() => setSourcesOpen(false)} />}
    </section>
  )
}

/** ドラッグの結果をコマンドにする。移動とレイヤーの移動は1回の取り消しで戻るよう、まとめて送る。 */
function commitDrag(
  project: Project,
  item: Item,
  drag: DragState,
  layersFrontFirst: Layer[],
  run: (commands: Command[], label: string) => void
): void {
  const deltaMs = Math.round(drag.deltaMs)
  if (drag.mode === 'start') {
    run([{ op: 'item.trim', itemId: item.id, startMs: item.startMs + deltaMs }], '長さの変更')
    return
  }
  if (drag.mode === 'end') {
    run([{ op: 'item.trim', itemId: item.id, endMs: itemEndMs(item) + deltaMs }], '長さの変更')
    return
  }
  if (drag.group.length > 1) {
    const moving = project.items.filter((candidate) => drag.group.includes(candidate.id))
    if (deltaMs !== 0) run(moving.map((candidate) => ({ op: 'item.setTimeRange', itemId: candidate.id, startMs: candidate.startMs + deltaMs })), `まとめて移動(${moving.length}個)`)
    return
  }
  const commands: Command[] = []
  if (deltaMs !== 0) commands.push({ op: 'item.setTimeRange', itemId: item.id, startMs: item.startMs + deltaMs })
  if (drag.layerOffset !== 0) {
    const currentRow = layersFrontFirst.findIndex((layer) => layer.id === item.layerId)
    const target = layersFrontFirst[Math.min(layersFrontFirst.length - 1, Math.max(0, currentRow + drag.layerOffset))]
    if (target && target.id !== item.layerId && !target.locked) commands.push({ op: 'item.setLayer', itemId: item.id, layerId: target.id })
  }
  if (commands.length > 0) run(commands, 'アイテムの移動')
}

function labelStepSeconds(pxPerSecond: number): number {
  for (const step of [1, 2, 5, 10, 15, 30, 60, 120, 300, 600]) {
    if (step * pxPerSecond >= 64) return step
  }
  return 1200
}

function LayerHeader({
  layer,
  run,
  onContextMenu
}: {
  layer: Layer
  run: (commands: Command[], label: string) => void
  onContextMenu: (event: React.MouseEvent) => void
}): React.JSX.Element {
  const toggle = (key: 'visible' | 'muted' | 'locked', label: string): void =>
    run([{ op: 'layer.update', layerId: layer.id, [key]: !layer[key] }], label)
  return (
    <div className="timeline__header" onContextMenu={onContextMenu}>
      <button
        type="button"
        className={layer.color ? 'timeline__layerColor' : 'timeline__layerColor timeline__layerColor--none'}
        style={layer.color ? { background: layer.color } : undefined}
        onClick={() => pickColor(layer.color ?? '#3fa34d', (color) => run([{ op: 'layer.update', layerId: layer.id, color }], 'レイヤーの色の変更'))}
        title="このレイヤーの素材の色(右クリックで一覧から選ぶ・戻す)"
        aria-label={`${layer.name}の色`}
        data-testid={`layer-color-${layer.id}`}
      />
      <span className="timeline__layerName" title={layer.name}>
        {layer.name}
      </span>
      <span className="timeline__layerButtons">
        <button
          type="button"
          className={layer.visible ? 'timeline__toggle' : 'timeline__toggle timeline__toggle--off'}
          onClick={() => toggle('visible', 'レイヤーの表示の切り替え')}
          title={layer.visible ? '隠す' : '表示する'}
          aria-pressed={!layer.visible}
          aria-label={`${layer.name}を隠す`}
        >
          👁
        </button>
        <button
          type="button"
          className={layer.muted ? 'timeline__toggle timeline__toggle--on' : 'timeline__toggle'}
          onClick={() => toggle('muted', 'レイヤーのミュートの切り替え')}
          title={layer.muted ? 'ミュートを解除' : 'ミュート'}
          aria-pressed={layer.muted}
          aria-label={`${layer.name}をミュート`}
        >
          ♪
        </button>
        <button
          type="button"
          className={layer.locked ? 'timeline__toggle timeline__toggle--on' : 'timeline__toggle'}
          onClick={() => toggle('locked', 'レイヤーのロックの切り替え')}
          title={layer.locked ? 'ロックを解除' : 'ロック'}
          aria-pressed={layer.locked}
          aria-label={`${layer.name}をロック`}
        >
          🔒
        </button>
      </span>
    </div>
  )
}

function itemLabel(project: Project, item: Item): string {
  switch (item.type) {
    case 'voice':
      return item.text
    case 'video':
      return `${item.freeze ? '静止画: ' : ''}${assetName(project.assets[item.assetId])}`
    case 'image':
    case 'audio':
      return assetName(project.assets[item.assetId])
    case 'text':
      return item.text
    case 'shape':
      return item.shape === 'ellipse' ? '図形(楕円)' : '図形'
    case 'zoom':
      return `ズーム(${ZOOM_METHOD_LABELS[item.method]})`
    case 'portrait': {
      const name = project.characters[item.characterId]?.name ?? ''
      const kind = item.kind ?? 'show'
      const expression = item.expressionId ? project.characters[item.characterId]?.portrait?.expressions[item.expressionId]?.name : undefined
      const label = kind === 'hide' ? `隠す: ${name}` : kind === 'adjust' ? `調整: ${name}` : item.untilEnd ? `立ち絵: ${name}` : `登場: ${name}`
      return expression ? `${label}(${expression})` : label
    }
  }
}

interface TimelineItemProps {
  project: Project
  item: Item
  left: number
  width: number
  top: number
  dragging: boolean
  selected: boolean
  locked: boolean
  onPointerDown: (event: React.PointerEvent, item: Item, mode: DragMode) => void
  onContextMenu: (event: React.MouseEvent, item: Item) => void
}

function TimelineItem(props: TimelineItemProps): React.JSX.Element {
  const { project, item } = props
  const trimmable = item.type !== 'voice' && !props.locked
  const classes = ['timeline__item', `timeline__item--${item.type}`]
  if (props.selected) classes.push('timeline__item--selected')
  if (props.dragging) classes.push('timeline__item--dragging')
  if (props.locked) classes.push('timeline__item--locked')
  if (item.type === 'video' && item.freeze) classes.push('timeline__item--freeze')
  if (item.type === 'portrait') classes.push(`timeline__item--portrait-${item.kind ?? 'show'}`)
  // 「最後まで」の立ち絵の区間は、同じレーンに重ねて置く場面ごとの区間の下に描く(場面の区間を選べるように)。
  if (item.type === 'portrait' && item.untilEnd) classes.push('timeline__item--portrait-base')
  if (item.groupId !== undefined) classes.push('timeline__item--grouped')
  // 素材・レイヤーに色が付いていれば、種類ごとの色の代わりにその色で描く。
  const color = timelineColor(project, item)
  if (color) classes.push('timeline__item--colored')
  const asset = 'assetId' in item ? project.assets[item.assetId] : undefined
  const waveform = (item.type === 'audio' || (item.type === 'video' && !item.freeze && asset?.type === 'video' && asset.hasAudio)) && asset

  return (
    <div
      className={classes.join(' ')}
      style={
        {
          left: `${props.left}px`,
          width: `${props.width}px`,
          transform: `translateY(${props.top}px)`,
          ...(color ? { '--item-color': color } : {})
        } as React.CSSProperties
      }
      data-color={color ?? undefined}
      title={`${itemLabel(project, item)}\n${formatMs(item.startMs)} – ${formatMs(itemEndMs(item))}${item.groupId !== undefined ? '\nグループ(一緒に動く)' : ''}`}
      data-group-id={item.groupId}
      onPointerDown={(event) => props.onPointerDown(event, item, 'move')}
      onContextMenu={(event) => props.onContextMenu(event, item)}
      data-testid="timeline-item"
      data-item-type={item.type}
      data-item-id={item.id}
      data-asset-id={'assetId' in item ? item.assetId : undefined}
      role="button"
      aria-pressed={props.selected}
    >
      {waveform && (item.type === 'audio' || item.type === 'video') && <Waveform item={item} path={asset.path.absolute} />}
      {item.groupId !== undefined && <span className="timeline__groupMark" aria-label="グループ" />}
      <span className="timeline__itemLabel">{itemLabel(project, item)}</span>
      {trimmable && (
        <>
          <span
            className="timeline__handle timeline__handle--start"
            onPointerDown={(event) => props.onPointerDown(event, item, 'start')}
            data-testid="trim-start"
          />
          <span
            className="timeline__handle timeline__handle--end"
            onPointerDown={(event) => props.onPointerDown(event, item, 'end')}
            data-testid="trim-end"
          />
        </>
      )}
    </div>
  )
}

/** タイムラインの見出しに出す、プレビュー画質の短い名前。 */
const PREVIEW_SHORT_LABELS: Record<string, string> = {
  auto: '自動',
  original: '元の画質',
  1080: '1080p',
  720: '720p',
  540: '540p',
  360: '360p'
}
