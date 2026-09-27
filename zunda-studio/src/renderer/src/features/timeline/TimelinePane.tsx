import { useMemo, useState } from 'react'

import { itemEndMs, projectDurationMs } from '@shared/project/queries'
import type { Item } from '@shared/project/types'

import { formatMs } from '../../lib/time'
import { useEditorStore } from '../../state/store'

const MIN_VISIBLE_MS = 10_000

export function TimelinePane(): React.JSX.Element {
  const project = useEditorStore((state) => state.project)
  const playheadMs = useEditorStore((state) => state.playheadMs)
  const setPlayhead = useEditorStore((state) => state.setPlayhead)
  const selectedItemIds = useEditorStore((state) => state.selectedItemIds)
  const setSelection = useEditorStore((state) => state.setSelection)
  const [pxPerSecond, setPxPerSecond] = useState(60)

  const visibleMs = Math.max(projectDurationMs(project), MIN_VISIBLE_MS)
  const contentWidth = (visibleMs / 1000) * pxPerSecond

  const itemsByLayer = useMemo(() => {
    const grouped = new Map<string, Item[]>()
    for (const layer of project.layers) grouped.set(layer.id, [])
    for (const item of project.items) {
      grouped.get(item.layerId)?.push(item)
    }
    return grouped
  }, [project])

  const layersFrontFirst = [...project.layers].sort((a, b) => b.index - a.index)

  return (
    <section className="pane pane--timeline">
      <header className="pane__header">
        <h2>タイムライン</h2>
        <label className="timeline__zoom">
          拡大
          <input
            type="range"
            min={10}
            max={240}
            step={10}
            value={pxPerSecond}
            onChange={(event) => setPxPerSecond(Number(event.target.value))}
          />
        </label>
        <span className="pane__count">{project.items.length}アイテム</span>
      </header>

      <div className="timeline__scroll">
        <div className="timeline__body" style={{ width: `${contentWidth}px` }}>
          <div
            className="timeline__ruler"
            onClick={(event) => {
              const bounds = event.currentTarget.getBoundingClientRect()
              setPlayhead(((event.clientX - bounds.left) / pxPerSecond) * 1000)
            }}
          >
            {Array.from({ length: Math.ceil(visibleMs / 1000) + 1 }, (_, second) => (
              <span
                key={second}
                className="timeline__tick"
                style={{ left: `${second * pxPerSecond}px` }}
              >
                {second % 5 === 0 ? formatMs(second * 1000) : ''}
              </span>
            ))}
          </div>

          {layersFrontFirst.map((layer) => (
            <div key={layer.id} className="timeline__layer">
              <span className="timeline__layerName">{layer.name}</span>
              {(itemsByLayer.get(layer.id) ?? []).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={
                    selectedItemIds.includes(item.id)
                      ? `timeline__item timeline__item--${item.type} timeline__item--selected`
                      : `timeline__item timeline__item--${item.type}`
                  }
                  style={{
                    left: `${(item.startMs / 1000) * pxPerSecond}px`,
                    width: `${Math.max((item.durationMs / 1000) * pxPerSecond, 8)}px`
                  }}
                  title={`${formatMs(item.startMs)} - ${formatMs(itemEndMs(item))}`}
                  onClick={() => {
                    setSelection([item.id])
                    setPlayhead(item.startMs)
                  }}
                >
                  {item.type === 'voice' ? item.text : item.type}
                </button>
              ))}
            </div>
          ))}

          <div className="timeline__playhead" style={{ left: `${(playheadMs / 1000) * pxPerSecond}px` }} />
        </div>
      </div>
      <p className="note">ドラッグでの移動・伸縮は Phase 3 で実装する。</p>
    </section>
  )
}
