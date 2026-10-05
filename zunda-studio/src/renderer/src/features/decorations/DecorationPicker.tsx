import { useEffect, useRef, useState } from 'react'

import { createEmptyProject } from '@shared/project/factory'
import type { Project, ShapeItem } from '@shared/project/types'
import { renderFrame } from '@shared/render/compositor'
import { SHAPE_PRESET_CATEGORIES, SHAPE_PRESETS, type ShapePreset, type ShapePresetCategory } from '@shared/render/shape-presets'
import type { Ctx2D, RenderResources } from '@shared/render/types'

import { placeDecoration, scaledPresetProps } from '../../state/decorations'
import { Modal } from '../../ui/Modal'

/** 見本の大きさ。見本は小さな画面で、動画と同じ描き方(compositor)で描く。 */
const THUMB_WIDTH = 192
const THUMB_HEIGHT = 108

const thumbResources: RenderResources = {
  psd: () => null,
  image: () => null,
  video: () => null,
  createCanvas: (width, height) => {
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.ceil(width))
    canvas.height = Math.max(1, Math.ceil(height))
    return canvas as unknown as ReturnType<RenderResources['createCanvas']>
  }
}

/** 見本の画面。ひな形を 1920×1080 の画面に置いたときと同じ見た目を、縮めて描く。 */
function previewProject(preset: ShapePreset): Project {
  const project = createEmptyProject({ width: THUMB_WIDTH, height: THUMB_HEIGHT, renderSeed: 11 })
  project.canvas.backgroundColor = '#4a5d73'
  const base = createEmptyProject({ width: 1920, height: 1080 })
  const scale = THUMB_WIDTH / 1920
  const props = scaledPresetProps(preset, base)
  const item: ShapeItem = {
    ...props,
    id: `preview-${preset.id}`,
    type: 'shape',
    layerId: project.layers[0]!.id,
    startMs: 0,
    durationMs: preset.durationMs,
    effects: preset.effects ?? [],
    locked: false,
    shape: preset.shape,
    fill: preset.fill,
    transform: { x: THUMB_WIDTH / 2, y: THUMB_HEIGHT / 2, scale, rotation: 0, opacity: 1 }
  }
  project.items.push(item)
  return project
}

/** 見本。マウスを乗せると動きを繰り返して見せる。 */
function PresetThumb({ preset, animate }: { preset: ShapePreset; animate: boolean }): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const projectRef = useRef<Project | null>(null)
  projectRef.current ??= previewProject(preset)

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    const project = projectRef.current
    if (!canvas || !context || !project) return
    const draw = (timeMs: number): void => renderFrame(context as unknown as Ctx2D, project, timeMs, thumbResources)
    if (!animate) {
      draw(Math.min(preset.durationMs * 0.6, 1400))
      return
    }
    let frame = 0
    const started = performance.now()
    const loop = (now: number): void => {
      // 最後まで行ったら、少し間を置いて最初から。
      draw((now - started) % (preset.durationMs + 400))
      frame = requestAnimationFrame(loop)
    }
    frame = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(frame)
  }, [animate, preset])

  return <canvas ref={canvasRef} width={THUMB_WIDTH} height={THUMB_HEIGHT} className="decoration-card__thumb" />
}

interface DecorationPickerProps {
  onClose: () => void
  onError: (message: string) => void
  /** 置く場所(プレビューで右クリックした所)。無ければ画面の中央。 */
  point?: { x: number; y: number }
}

/** 装飾のひな形を選んで、再生位置に置く。 */
export function DecorationPicker({ onClose, onError, point }: DecorationPickerProps): React.JSX.Element {
  const [category, setCategory] = useState<ShapePresetCategory>('point')
  const [hovered, setHovered] = useState<string | null>(null)
  const shown = SHAPE_PRESETS.filter((preset) => preset.category === category)

  const place = (preset: ShapePreset): void => {
    const error = placeDecoration(preset, point ? { point } : {})
    if (error) onError(error)
    else onClose()
  }

  return (
    <Modal title="装飾を置く" onClose={onClose} wide>
      <p className="note">
        再生位置に置きます{point ? '(右クリックした所が中心)' : '(画面の中央)'}。置いたあとはプレビューの枠で位置・大きさ・向きを、インスペクタで色・縁取り・動きを変えられます。
        マウスを乗せると動きを確かめられます。
      </p>
      <div className="segmented" role="radiogroup" aria-label="装飾の種類">
        {SHAPE_PRESET_CATEGORIES.map(({ id, label }) => (
          <label key={id}>
            <input type="radio" name="decoration-category" checked={category === id} onChange={() => setCategory(id)} data-testid={`decoration-category-${id}`} />
            {label}
          </label>
        ))}
      </div>
      <div className="decoration-grid" data-testid="decoration-grid">
        {shown.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className="decoration-card"
            onClick={() => place(preset)}
            onMouseEnter={() => setHovered(preset.id)}
            onMouseLeave={() => setHovered((current) => (current === preset.id ? null : current))}
            data-testid={`decoration-${preset.id}`}
          >
            <PresetThumb preset={preset} animate={hovered === preset.id} />
            <span className="decoration-card__name">{preset.name}</span>
          </button>
        ))}
      </div>
    </Modal>
  )
}
