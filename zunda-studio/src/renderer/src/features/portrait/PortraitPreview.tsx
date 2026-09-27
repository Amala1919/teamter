import { useEffect, useRef } from 'react'

import { blinkPartAt, mouthPartFor } from '@shared/portrait/animation'
import type { PartGroupId, PartId, PortraitConfig, Vowel } from '@shared/project/types'
import type { PsdManifest } from '@shared/psd/types'
import { composePortrait } from '@shared/render/portrait'

import { browserResources, useResourceStore } from '../../render/browser-resources'

const VOWEL_CYCLE: Vowel[] = ['a', 'i', 'u', 'e', 'o', 'N', 'pau']

interface PortraitPreviewProps {
  portrait: PortraitConfig
  manifest: PsdManifest
  expressionId: string | null
  /** 口パクとまばたきを動かして確かめる。 */
  animate: boolean
  size?: number
}

/** 素材マネージャーの試し表示。本番と同じ合成処理(composePortrait)で描く。 */
export function PortraitPreview({ portrait, manifest, expressionId, animate, size = 360 }: PortraitPreviewProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const resourceVersion = useResourceStore((state) => state.version)

  useEffect(() => {
    let frame = 0
    const started = performance.now()
    const draw = (): void => {
      const canvas = canvasRef.current
      const context = canvas?.getContext('2d')
      if (!canvas || !context) return
      const elapsed = animate ? performance.now() - started : 0
      const expression = expressionId ? portrait.expressions[expressionId] : undefined
      const selections: Record<PartGroupId, PartId> = { ...(expression?.selections ?? {}) }

      if (animate && portrait.blink) {
        const eye = portrait.partGroups[portrait.blink.partGroupId]
        if (eye?.blinkSequence && selections[eye.id] === eye.blinkSequence[0]) {
          // 試し表示では確認しやすいよう、間隔を短くしてまばたきさせる。
          const blinking = blinkPartAt(1, 'preview', { ...portrait.blink, intervalMs: 1500, jitterMs: 300 }, eye.blinkSequence, elapsed)
          if (blinking) selections[eye.id] = blinking
        }
      }
      if (portrait.lipSync) {
        const mouth = portrait.partGroups[portrait.lipSync.partGroupId]
        const vowel = animate ? VOWEL_CYCLE[Math.floor(elapsed / 180) % VOWEL_CYCLE.length]! : 'pau'
        const part = mouth ? mouthPartFor(mouth, portrait.lipSync.mode, vowel) : null
        if (mouth && part) selections[mouth.id] = part
      }

      const scale = size / Math.max(manifest.width, manifest.height)
      canvas.width = Math.round(manifest.width * scale)
      canvas.height = Math.round(manifest.height * scale)
      context.clearRect(0, 0, canvas.width, canvas.height)
      const composed = composePortrait(portrait, manifest, selections, browserResources)
      if (composed) context.drawImage(composed as unknown as CanvasImageSource, 0, 0, canvas.width, canvas.height)
      if (animate) frame = requestAnimationFrame(draw)
    }
    draw()
    return () => cancelAnimationFrame(frame)
  }, [portrait, manifest, expressionId, animate, size, resourceVersion])

  return <canvas ref={canvasRef} className="portrait-preview" data-testid="portrait-preview" />
}
