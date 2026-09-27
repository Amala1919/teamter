import { useEffect, useRef } from 'react'

import { isVoiceItem, itemsAt, projectDurationMs } from '@shared/project/queries'
import { renderFrame } from '@shared/render/compositor'
import type { Ctx2D } from '@shared/render/types'

import { browserResources, useResourceStore } from '../../render/browser-resources'
import { formatMs } from '../../lib/time'
import { player, togglePlayback, usePlaybackStore } from '../../playback/player'
import { useEditorStore } from '../../state/store'

export function PreviewPane(): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const project = useEditorStore((state) => state.project)
  const playheadMs = useEditorStore((state) => state.playheadMs)
  const setPlayhead = useEditorStore((state) => state.setPlayhead)
  const durationMs = projectDurationMs(project)
  const caption = itemsAt(project, playheadMs)
    .filter(isVoiceItem)
    .map((item) => `${project.characters[item.characterId]?.name ?? ''}「${item.text}」`)
    .join(' ')
  const playing = usePlaybackStore((state) => state.playing)
  const loading = usePlaybackStore((state) => state.loading)
  // 画像や PSD の読み込みが終わったら描き直す。
  const resourceVersion = useResourceStore((state) => state.version)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) return
    renderFrame(context as unknown as Ctx2D, project, playheadMs, browserResources.bind(project))
  }, [project, playheadMs, resourceVersion])

  return (
    <section className="pane pane--preview">
      <header className="pane__header">
        <h2>プレビュー</h2>
        <span className="pane__count">
          {project.canvas.width}×{project.canvas.height} / {project.canvas.fps}fps
        </span>
      </header>
      <div className="preview__stage">
        <canvas
          ref={canvasRef}
          width={project.canvas.width}
          height={project.canvas.height}
          className="preview__canvas"
        />
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
