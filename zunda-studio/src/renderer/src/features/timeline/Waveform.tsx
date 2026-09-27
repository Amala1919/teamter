import { useEffect, useRef } from 'react'

import { sourceSpanMs, sourceTimeMs } from '@shared/audio/envelope'
import type { AudioItem, VideoItem } from '@shared/project/types'

import { loadPeaks, useMediaStore } from '../../state/media'

/** 大きすぎる canvas を作らないための上限。長い素材は粗く描いて引き伸ばす。 */
const MAX_CANVAS_WIDTH = 4096

/** アイテムの区間の波形。ループする音声は素材の区間を繰り返して描く。 */
export function Waveform({ item, path }: { item: AudioItem | VideoItem; path: string }): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const peaks = useMediaStore((state) => state.peaks[path])

  useEffect(() => loadPeaks(path), [path])

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context || !peaks) return
    const width = Math.min(MAX_CANVAS_WIDTH, Math.max(1, Math.round(canvas.clientWidth)))
    const height = Math.max(1, Math.round(canvas.clientHeight))
    canvas.width = width
    canvas.height = height
    context.clearRect(0, 0, width, height)
    context.fillStyle = 'rgba(255, 255, 255, 0.35)'
    const span = item.type === 'audio' ? sourceSpanMs(item) : 0
    for (let x = 0; x < width; x++) {
      const fromMs = sourceTimeMs(item, (x / width) * item.durationMs)
      const toMs = item.type === 'audio' && item.loop && span > 0 ? fromMs + item.durationMs / width : sourceTimeMs(item, ((x + 1) / width) * item.durationMs)
      const from = Math.floor((fromMs / 1000) * peaks.samplesPerSecond)
      const to = Math.max(from + 1, Math.ceil((toMs / 1000) * peaks.samplesPerSecond))
      let peak = 0
      for (let index = from; index < to && index < peaks.data.length; index++) peak = Math.max(peak, peaks.data[index]!)
      const bar = (peak / 255) * height
      context.fillRect(x, (height - bar) / 2, 1, Math.max(1, bar))
    }
  }, [peaks, item])

  return <canvas ref={canvasRef} className="timeline__waveform" aria-hidden="true" />
}
