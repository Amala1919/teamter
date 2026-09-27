import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import { findItem, isVoiceItem, itemsAt, projectDurationMs } from '@shared/project/queries'
import { renderFrame } from '@shared/render/compositor'
import type { Ctx2D } from '@shared/render/types'
import { defaultRegion, zoomProgress } from '@shared/render/zoom'

import { formatMs } from '../../lib/time'
import { player, togglePlayback, usePlaybackStore } from '../../playback/player'
import { browserResources, useResourceStore } from '../../render/browser-resources'
import { useMediaStore } from '../../state/media'
import { hasClipboard, pasteAt, splitAtPlayhead } from '../../state/edit-actions'
import { deleteSelection, useEditorStore } from '../../state/store'
import { openContextMenu, type MenuEntry } from '../../ui/ContextMenu'
import { insertZoom } from '../timeline/timeline-menus'
import { ZoomFrameEditor } from './ZoomFrameEditor'

/** ズーム枠を置いたときの既定の尺。 */
const DEFAULT_ZOOM_MS = 3000

export function PreviewPane({ onError }: { onError: (message: string) => void }): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const project = useEditorStore((state) => state.project)
  const playheadMs = useEditorStore((state) => state.playheadMs)
  const setPlayhead = useEditorStore((state) => state.setPlayhead)
  const selectedItemIds = useEditorStore((state) => state.selectedItemIds)
  const setSelection = useEditorStore((state) => state.setSelection)
  const dispatch = useEditorStore((state) => state.dispatch)
  const durationMs = projectDurationMs(project)
  const caption = itemsAt(project, playheadMs)
    .filter(isVoiceItem)
    .map((item) => `${project.characters[item.characterId]?.name ?? ''}「${item.text}」`)
    .join(' ')
  const playing = usePlaybackStore((state) => state.playing)
  const loading = usePlaybackStore((state) => state.loading)
  // 画像や PSD・動画のコマの読み込みが終わったら描き直す。
  const resourceVersion = useResourceStore((state) => state.version)
  const mediaSources = useMediaStore((state) => state.sources)
  const [checkZoom, setCheckZoom] = useState(false)
  const [overlayBox, setOverlayBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null)

  const selected = selectedItemIds[0] === undefined ? undefined : findItem(project, selectedItemIds[0])
  const zoomItem = selected?.type === 'zoom' ? selected : null
  // 枠の編集中は拡大前の画面を見せる。「拡大して確認」か再生中は拡大した結果を見せる(Z-6)。
  const applyZoom = zoomItem === null || checkZoom || playing

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) return
    renderFrame(context as unknown as Ctx2D, project, playheadMs, browserResources.bind(project), { applyZoom })
  }, [project, playheadMs, resourceVersion, mediaSources, applyZoom])

  // 枠は表示中の canvas にぴったり重ねる。
  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const update = (): void =>
      setOverlayBox({ left: canvas.offsetLeft, top: canvas.offsetTop, width: canvas.clientWidth, height: canvas.clientHeight })
    update()
    const observer = new ResizeObserver(update)
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [])

  const building = Object.values(mediaSources).find((source) => source.state === 'building')
  const failed = Object.values(mediaSources).find((source) => source.state === 'error')

  const addZoom = (): void => {
    const result = dispatch(
      [{ op: 'zoom.insert', atMs: playheadMs, durationMs: DEFAULT_ZOOM_MS, region: defaultRegion(project.canvas), tempId: 'zoom' }],
      'ズーム枠の追加'
    )
    if (!result.ok) {
      onError(result.message)
      return
    }
    if (result.resolvedIds['zoom']) setSelection([result.resolvedIds['zoom']])
    setCheckZoom(false)
  }

  const report = (message: string | null): void => {
    if (message) onError(message)
  }

  /** プレビューの右クリック。クリックした所を中心にズーム枠を置けるようにする。 */
  const onCanvasContextMenu = (event: React.MouseEvent<HTMLCanvasElement>): void => {
    const rect = event.currentTarget.getBoundingClientRect()
    const point = {
      x: ((event.clientX - rect.left) / Math.max(1, rect.width)) * project.canvas.width,
      y: ((event.clientY - rect.top) / Math.max(1, rect.height)) * project.canvas.height
    }
    const entries: MenuEntry[] = [
      { label: playing ? '停止' : '再生', shortcut: 'Space', onSelect: togglePlayback },
      'separator',
      {
        label: 'ここを中心にズーム枠を置く',
        onSelect: () => {
          report(insertZoom(project, playheadMs, DEFAULT_ZOOM_MS, point))
          setCheckZoom(false)
        },
        testId: 'menu-preview-zoom'
      },
      { label: '再生位置で分割', shortcut: 'S', onSelect: () => report(splitAtPlayhead()) },
      { label: '再生位置に貼り付け', shortcut: 'Ctrl+V', disabled: !hasClipboard(), onSelect: () => report(pasteAt()) }
    ]
    if (selected && 'transform' in selected) {
      const reset = (patch: { x?: number; y?: number; scale?: number; rotation?: number }, label: string): void => {
        const result = dispatch([{ op: 'item.setTransform', itemId: selected.id, ...patch }], label)
        if (!result.ok) onError(result.message)
      }
      entries.push(
        'separator',
        { label: '選んだものを中央に戻す', onSelect: () => reset({ x: project.canvas.width / 2, y: project.canvas.height / 2 }, '位置を戻す') },
        { label: '選んだものの大きさ・回転を元に戻す', onSelect: () => reset({ scale: 1, rotation: 0 }, '大きさを戻す') },
        { label: '選んだものをクリックした所へ', onSelect: () => reset(point, '位置の変更') }
      )
    }
    if (selected) {
      entries.push('separator', { label: '選んだものを削除', shortcut: 'Delete', danger: true, onSelect: () => report(deleteSelection()) })
    }
    openContextMenu(event, entries)
  }

  return (
    <section className="pane pane--preview">
      <header className="pane__header">
        <h2>プレビュー</h2>
        <button type="button" className="button--small" onClick={addZoom} data-testid="add-zoom" title="再生位置にズーム枠を置く">
          ズーム枠を置く
        </button>
        {zoomItem && (
          <label className="preview__zoomCheck">
            <input
              type="checkbox"
              checked={checkZoom}
              onChange={(event) => {
                setCheckZoom(event.target.checked)
                // 寄り切っている区間の外にいれば、確かめやすいよう寄り切った時刻へ移る。
                if (event.target.checked && zoomProgress(zoomItem, playheadMs - zoomItem.startMs) < 1) {
                  const settled = zoomItem.startMs + Math.min(zoomItem.durationMs / 2, zoomItem.method === 'slowPush' ? zoomItem.durationMs - zoomItem.outMs - 1 : zoomItem.inMs + 1)
                  setPlayhead(settled)
                }
              }}
              data-testid="zoom-check"
            />
            拡大して確認
          </label>
        )}
        <span className="pane__count">
          {project.canvas.width}×{project.canvas.height} / {project.canvas.fps}fps
        </span>
      </header>
      {building && building.state === 'building' && (
        <p className="status" data-testid="proxy-status">
          編集用の動画を作成中… {Math.round(building.ratio * 100)}%
        </p>
      )}
      {failed && failed.state === 'error' && <p className="status status--error">{failed.message}</p>}
      <div className="preview__stage">
        <canvas
          ref={canvasRef}
          width={project.canvas.width}
          height={project.canvas.height}
          className="preview__canvas"
          onContextMenu={onCanvasContextMenu}
          data-testid="preview-canvas"
        />
        {zoomItem && !applyZoom && overlayBox && (
          <div className="preview__overlay" style={overlayBox}>
            <ZoomFrameEditor
              canvas={project.canvas}
              region={zoomItem.region}
              scale={project.canvas.width / Math.max(1, overlayBox.width)}
              onCommit={(region) => {
                const result = dispatch([{ op: 'zoom.update', itemId: zoomItem.id, region }], 'ズーム枠の変更')
                if (!result.ok) onError(result.message)
              }}
            />
          </div>
        )}
        {/* 画面の字幕は canvas に描くため、読み上げ用に同じ内容を文字でも出す。 */}
        <p className="sr-only" aria-live="polite" data-testid="current-subtitle">
          {caption}
        </p>
      </div>
      <div className="preview__controls">
        <button
          type="button"
          className="preview__play"
          onClick={togglePlayback}
          disabled={loading}
          aria-label={playing ? '停止' : '再生'}
          data-testid="play-toggle"
        >
          {loading ? '…' : playing ? '■' : '▶'}
        </button>
        <span className="preview__time" data-testid="playhead">
          {formatMs(playheadMs)} / {formatMs(durationMs)}
        </span>
        <input
          type="range"
          min={0}
          max={Math.max(durationMs, 1000)}
          step={10}
          value={Math.min(playheadMs, Math.max(durationMs, 1000))}
          onChange={(event) => {
            player.stop()
            setPlayhead(Number(event.target.value))
          }}
          aria-label="再生位置"
        />
      </div>
    </section>
  )
}
