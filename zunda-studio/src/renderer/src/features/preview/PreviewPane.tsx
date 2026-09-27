import { useEffect, useRef } from 'react'

import { projectDurationMs } from '@shared/project/queries'

import { renderFrame } from '../../compositor/render'
import { formatMs } from '../../lib/time'
import { useEditorStore } from '../../state/store'

export function PreviewPane(): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const project = useEditorStore((state) => state.project)
  const playheadMs = useEditorStore((state) => state.playheadMs)
  const setPlayhead = useEditorStore((state) => state.setPlayhead)
  const durationMs = projectDurationMs(project)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) return
    renderFrame(context, project, playheadMs)
  }, [project, playheadMs])

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
      </div>
      <div className="preview__controls">
        <span className="preview__time">
          {formatMs(playheadMs)} / {formatMs(durationMs)}
        </span>
        <input
          type="range"
          min={0}
          max={Math.max(durationMs, 1000)}
          step={10}
          value={Math.min(playheadMs, Math.max(durationMs, 1000))}
          onChange={(event) => setPlayhead(Number(event.target.value))}
          aria-label="再生位置"
        />
        <span className="note">再生は Phase 3(音声同期と同時に実装する)</span>
      </div>
    </section>
  )
}
