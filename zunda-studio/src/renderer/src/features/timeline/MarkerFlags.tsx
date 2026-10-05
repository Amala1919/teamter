import { useEffect, useState } from 'react'

import type { Marker, Ms } from '@shared/project/types'

import { formatMs } from '../../lib/time'
import { MARKER_COLORS, removeMarker, updateMarker, useMarkerUi } from '../../state/markers'
import { useEditorStore } from '../../state/store'
import { openContextMenu } from '../../ui/ContextMenu'
import { Modal } from '../../ui/Modal'

/** これより動かなければドラッグではなくクリックとみなす。 */
const DRAG_THRESHOLD_PX = 3

/**
 * 目盛りの上の目印(編集中のメモ)。クリックでその時刻へ、ドラッグで動かし、ダブルクリックでメモを書く。
 */
export function MarkerFlags({ markers, pxPerSecond, onError }: { markers: Marker[]; pxPerSecond: number; onError: (message: string) => void }): React.JSX.Element {
  const setPlayhead = useEditorStore((state) => state.setPlayhead)
  const setEditing = useMarkerUi((state) => state.setEditing)
  const [drag, setDrag] = useState<{ id: string; deltaMs: Ms } | null>(null)

  const report = (message: string | null): void => {
    if (message) onError(message)
  }

  const begin = (event: React.PointerEvent, marker: Marker): void => {
    if (event.button !== 0) return
    event.stopPropagation()
    const originX = event.clientX
    let moved = false
    let deltaMs = 0
    const onMove = (move: PointerEvent): void => {
      const dx = move.clientX - originX
      if (!moved && Math.abs(dx) < DRAG_THRESHOLD_PX) return
      moved = true
      deltaMs = Math.max(-marker.atMs, (dx / pxPerSecond) * 1000)
      setDrag({ id: marker.id, deltaMs })
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      setDrag(null)
      if (moved) report(updateMarker(marker, { atMs: marker.atMs + deltaMs }, '目印を動かす'))
      else setPlayhead(marker.atMs)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp, { once: true })
  }

  return (
    <>
      {markers.map((marker) => {
        const atMs = marker.atMs + (drag?.id === marker.id ? drag.deltaMs : 0)
        return (
          <span
            key={marker.id}
            className="timeline__flag"
            style={{ left: `${(atMs / 1000) * pxPerSecond}px`, '--flag-color': marker.color } as React.CSSProperties}
            title={`${formatMs(marker.atMs)} ${marker.text || '(メモなし)'}\nクリックで移動・ドラッグで動かす・ダブルクリックでメモ`}
            onPointerDown={(event) => begin(event, marker)}
            onDoubleClick={(event) => {
              event.stopPropagation()
              setEditing(marker.id)
            }}
            onContextMenu={(event) => {
              event.stopPropagation()
              openContextMenu(event, [
                { label: 'メモを書く…', onSelect: () => setEditing(marker.id), testId: 'menu-marker-edit' },
                {
                  label: '色',
                  submenu: MARKER_COLORS.map(({ color, name }) => ({ label: name, checked: marker.color === color, onSelect: () => report(updateMarker(marker, { color }, '目印の色')) }))
                },
                { label: '再生位置へ動かす', onSelect: () => report(updateMarker(marker, { atMs: useEditorStore.getState().playheadMs }, '目印を動かす')) },
                'separator',
                { label: '目印を消す', danger: true, onSelect: () => report(removeMarker(marker)), testId: 'menu-marker-remove' }
              ])
            }}
            data-testid="timeline-marker"
            data-marker-id={marker.id}
          >
            <span className="timeline__flagText">{marker.text.split('\n')[0]}</span>
          </span>
        )
      })}
    </>
  )
}

/** 目印のメモを書く。 */
export function MarkerEditor({ onError }: { onError: (message: string) => void }): React.JSX.Element | null {
  const editingId = useMarkerUi((state) => state.editingId)
  const setEditing = useMarkerUi((state) => state.setEditing)
  const marker = useEditorStore((state) => state.project.markers?.find((candidate) => candidate.id === editingId))
  const [text, setText] = useState(marker?.text ?? '')
  useEffect(() => setText(marker?.text ?? ''), [marker?.id, marker?.text])
  if (!marker) return null
  const close = (): void => setEditing(null)
  const save = (): void => {
    if (text !== marker.text) {
      const error = updateMarker(marker, { text }, '目印のメモ')
      if (error) onError(error)
    }
    close()
  }
  return (
    <Modal
      title={`目印のメモ(${formatMs(marker.atMs)})`}
      onClose={save}
      footer={
        <>
          <button
            type="button"
            className="button--danger"
            onClick={() => {
              const error = removeMarker(marker)
              if (error) onError(error)
              close()
            }}
            data-testid="marker-remove"
          >
            消す
          </button>
          <button type="button" onClick={save} data-testid="marker-save">
            閉じる
          </button>
        </>
      }
    >
      <textarea
        className="marker-editor__text"
        rows={4}
        value={text}
        autoFocus
        placeholder="例: ここでボス登場 / BGMを変える / 字幕を確認"
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) save()
        }}
        data-testid="marker-text"
      />
      <div className="chip-row">
        {MARKER_COLORS.map(({ color, name }) => (
          <button
            key={color}
            type="button"
            className={marker.color === color ? 'button--small button--active' : 'button--small'}
            onClick={() => {
              const error = updateMarker(marker, { color }, '目印の色')
              if (error) onError(error)
            }}
          >
            <span className="marker-editor__swatch" style={{ background: color }} /> {name}
          </button>
        ))}
      </div>
      <p className="note">1行目はタイムラインに出ます。投稿文の「目印からチャプターを作る」で、メモのある目印がチャプターになります(Ctrl+Enter で閉じる)。</p>
    </Modal>
  )
}
