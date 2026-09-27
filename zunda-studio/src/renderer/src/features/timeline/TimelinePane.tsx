import { useEffect, useMemo, useRef, useState } from 'react'

import type { Command } from '@shared/commands/types'
import { itemEndMs, projectDurationMs } from '@shared/project/queries'
import type { Item, Layer, Ms, Project } from '@shared/project/types'
import { ZOOM_METHOD_LABELS } from '@shared/render/zoom'

import { formatMs } from '../../lib/time'
import { usePlaybackStore } from '../../playback/player'
import { assetName, importMediaFiles } from '../../state/media'
import { useEditorStore } from '../../state/store'
import { Waveform } from './Waveform'

const MIN_VISIBLE_MS = 10_000
/** 最後のアイテムの後ろに空けておく余白(そこへドラッグで伸ばせるように)。 */
const TAIL_MS = 10_000
const ROW_HEIGHT = 36
const HEADER_WIDTH = 112
/** これより動かなければドラッグではなくクリックとみなす。 */
const DRAG_THRESHOLD_PX = 3
const SNAP_PX = 8

type DragMode = 'move' | 'start' | 'end'

interface DragState {
  itemId: string
  mode: DragMode
  originX: number
  originY: number
  moved: boolean
  deltaMs: Ms
  layerOffset: number
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
  const scrollRef = useRef<HTMLDivElement>(null)

  const visibleMs = Math.max(projectDurationMs(project) + TAIL_MS, MIN_VISIBLE_MS)
  const contentWidth = (visibleMs / 1000) * pxPerSecond
  const msToPx = (ms: Ms): number => (ms / 1000) * pxPerSecond

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
    if (!event.shiftKey) setSelection([item.id])
    else setSelection(selectedItemIds.includes(item.id) ? selectedItemIds : [...selectedItemIds, item.id])
    if (item.locked || layer?.locked) return
    setDrag({ itemId: item.id, mode, originX: event.clientX, originY: event.clientY, moved: false, deltaMs: 0, layerOffset: 0 })
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
        deltaMs = Math.max(-item.startMs, deltaMs)
      } else if (drag.mode === 'start') {
        deltaMs = snapDelta([item.startMs], deltaMs, item.id)
        deltaMs = Math.min(Math.max(-item.startMs, deltaMs), item.durationMs - 10)
      } else {
        deltaMs = snapDelta([itemEndMs(item)], deltaMs, item.id)
        deltaMs = Math.max(10 - item.durationMs, deltaMs)
      }
      const layerOffset = drag.mode === 'move' ? Math.round(dy / ROW_HEIGHT) : 0
      setDrag({ ...drag, moved, deltaMs, layerOffset })
    }
    const onUp = (): void => {
      setDrag(null)
      if (!drag.moved) {
        setPlayhead(item.startMs)
        return
      }
      commitDrag(item, drag, layersFrontFirst, run)
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

  const addCaption = (): void => {
    const result = dispatch([{ op: 'media.placeText', text: 'テロップ', atMs: playheadMs, durationMs: 3000, tempId: 'text' }], 'テロップの追加')
    if (!result.ok) onError(result.message)
    else if (result.resolvedIds['text']) setSelection([result.resolvedIds['text']])
  }

  const step = labelStepSeconds(pxPerSecond)

  return (
    <section className="pane pane--timeline" data-testid="timeline">
      <header className="pane__header">
        <h2>タイムライン</h2>
        <button type="button" className="button--small" onClick={() => void addMedia()} data-testid="add-media">
          素材を追加
        </button>
        <button type="button" className="button--small" onClick={addCaption} data-testid="add-caption">
          テロップ
        </button>
        <label className="timeline__zoom">
          拡大
          <input
            type="range"
            min={5}
            max={300}
            step={5}
            value={pxPerSecond}
            onChange={(event) => setPxPerSecond(Number(event.target.value))}
            aria-label="タイムラインの拡大"
          />
        </label>
        <span className="pane__count">{project.items.length}アイテム</span>
      </header>

      <div className="timeline__scroll" ref={scrollRef}>
        <div className="timeline__body" style={{ width: `${contentWidth + HEADER_WIDTH}px` }}>
          <div className="timeline__row timeline__row--ruler">
            <div className="timeline__header timeline__header--corner" />
            <div className="timeline__ruler" onPointerDown={scrub} data-testid="timeline-ruler">
              {Array.from({ length: Math.ceil(visibleMs / 1000 / step) + 1 }, (_, index) => (
                <span key={index} className="timeline__tick" style={{ left: `${index * step * pxPerSecond}px` }}>
                  {formatMs(index * step * 1000).replace(/\.\d+$/, '')}
                </span>
              ))}
            </div>
          </div>

          {layersFrontFirst.map((layer) => (
            <div key={layer.id} className="timeline__row" data-testid={`layer-${layer.id}`}>
              <LayerHeader layer={layer} run={run} />
              <div
                className={layer.visible ? 'timeline__lane' : 'timeline__lane timeline__lane--hidden'}
                onPointerDown={(event) => {
                  if (event.target === event.currentTarget) setSelection([])
                }}
              >
                {(itemsByLayer.get(layer.id) ?? []).map((item) => {
                  const dragging = drag?.itemId === item.id && drag.moved ? drag : null
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
    </section>
  )
}

/** ドラッグの結果をコマンドにする。移動とレイヤーの移動は1回の取り消しで戻るよう、まとめて送る。 */
function commitDrag(
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

function LayerHeader({ layer, run }: { layer: Layer; run: (commands: Command[], label: string) => void }): React.JSX.Element {
  const toggle = (key: 'visible' | 'muted' | 'locked', label: string): void =>
    run([{ op: 'layer.update', layerId: layer.id, [key]: !layer[key] }], label)
  return (
    <div className="timeline__header">
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
    case 'image':
    case 'audio':
      return assetName(project.assets[item.assetId])
    case 'text':
      return item.text
    case 'shape':
      return item.shape === 'ellipse' ? '図形(楕円)' : '図形'
    case 'zoom':
      return `ズーム(${ZOOM_METHOD_LABELS[item.method]})`
    case 'portrait':
      return `立ち絵: ${project.characters[item.characterId]?.name ?? ''}`
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
}

function TimelineItem(props: TimelineItemProps): React.JSX.Element {
  const { project, item } = props
  const trimmable = item.type !== 'voice' && !props.locked
  const classes = ['timeline__item', `timeline__item--${item.type}`]
  if (props.selected) classes.push('timeline__item--selected')
  if (props.dragging) classes.push('timeline__item--dragging')
  if (props.locked) classes.push('timeline__item--locked')
  const asset = 'assetId' in item ? project.assets[item.assetId] : undefined
  const waveform = (item.type === 'audio' || (item.type === 'video' && asset?.type === 'video' && asset.hasAudio)) && asset

  return (
    <div
      className={classes.join(' ')}
      style={{ left: `${props.left}px`, width: `${props.width}px`, transform: `translateY(${props.top}px)` }}
      title={`${itemLabel(project, item)}\n${formatMs(item.startMs)} – ${formatMs(itemEndMs(item))}`}
      onPointerDown={(event) => props.onPointerDown(event, item, 'move')}
      data-testid="timeline-item"
      data-item-type={item.type}
      data-item-id={item.id}
      role="button"
      aria-pressed={props.selected}
    >
      {waveform && (item.type === 'audio' || item.type === 'video') && <Waveform item={item} path={asset.path.absolute} />}
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
