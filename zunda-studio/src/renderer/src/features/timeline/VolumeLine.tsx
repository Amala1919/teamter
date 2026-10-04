import { useState } from 'react'

import { keyGainAt, normalizeKeys } from '@shared/audio/volume-keys'
import type { AudioItem, Ms, VideoItem, VolumeKey } from '@shared/project/types'

import { useEditorStore } from '../../state/store'

/** 線の一番上の倍率(200%)。点はそれより上にはドラッグできない(インスペクタでは 400% まで入れられる)。 */
const TOP_GAIN = 2

/** 素材の高さの中の位置と、倍率の行き来(上が大きい)。 */
function gainToY(gain: number, height: number): number {
  return height * (1 - Math.min(TOP_GAIN, gain) / TOP_GAIN)
}

function yToGain(y: number, height: number): number {
  return Math.round(Math.min(TOP_GAIN, Math.max(0, (1 - y / Math.max(1, height)) * TOP_GAIN)) * 100) / 100
}

/** 音量の点を置き換える。 */
export function setVolumeKeys(item: AudioItem | VideoItem, keys: VolumeKey[] | null, label: string): string | null {
  const result = useEditorStore.getState().dispatch([{ op: 'item.setVolumeKeys', itemId: item.id, keys }], label)
  return result.ok ? null : result.message
}

/** アイテム内の時刻に点を足す(その時刻の今の倍率のまま)。 */
export function addVolumeKey(item: AudioItem | VideoItem, relMs: Ms, gain?: number): string | null {
  const at = Math.min(item.durationMs, Math.max(0, Math.round(relMs)))
  const keys = normalizeKeys([...(item.volumeKeys ?? []), { atMs: at, gain: gain ?? keyGainAt(item.volumeKeys, at) }])
  return setVolumeKeys(item, keys, '音量の点を足す')
}

/**
 * 音量の線(タイムラインの音のあるアイテムの上)。選んでいるときは点をドラッグして音量を変えられる。
 * Alt+クリックで点を足し、点をダブルクリックで消す。線の真ん中が 100%、上の端が 200%。
 */
export function VolumeLine({
  item,
  width,
  editable,
  onError
}: {
  item: AudioItem | VideoItem
  width: number
  editable: boolean
  onError: (message: string) => void
}): React.JSX.Element | null {
  const [draft, setDraft] = useState<{ index: number; key: VolumeKey } | null>(null)
  const height = 29
  const keys = item.volumeKeys ?? []
  if (keys.length === 0 && !editable) return null
  const shown = keys.map((key, index) => (draft?.index === index ? draft.key : key))
  const toX = (atMs: Ms): number => (atMs / Math.max(1, item.durationMs)) * width
  const points = shown.length === 0 ? [{ atMs: 0, gain: 1 }, { atMs: item.durationMs, gain: 1 }] : shown
  // 線は最初の点より前・最後の点より後も、端まで伸ばす。
  const linePoints = [
    { atMs: 0, gain: points[0]!.gain },
    ...points,
    { atMs: item.durationMs, gain: points.at(-1)!.gain }
  ]
    .map((key) => `${toX(key.atMs).toFixed(1)},${gainToY(key.gain, height).toFixed(1)}`)
    .join(' ')

  const report = (message: string | null): void => {
    if (message) onError(message)
  }

  const beginDrag = (event: React.PointerEvent, index: number): void => {
    if (event.button !== 0) return
    event.stopPropagation()
    event.preventDefault()
    const original = keys[index]!
    const svg = (event.currentTarget as SVGElement).ownerSVGElement
    const rect = svg?.getBoundingClientRect()
    if (!rect) return
    const previous = keys[index - 1]?.atMs ?? 0
    const next = keys[index + 1]?.atMs ?? item.durationMs
    let latest = original
    const onMove = (move: PointerEvent): void => {
      const x = move.clientX - rect.left
      const y = move.clientY - rect.top
      const atMs = Math.round(Math.min(next, Math.max(previous, (x / Math.max(1, rect.width)) * item.durationMs)))
      latest = { atMs, gain: yToGain(y, rect.height) }
      setDraft({ index, key: latest })
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      setDraft(null)
      if (latest !== original) report(setVolumeKeys(item, keys.map((key, position) => (position === index ? latest : key)), '音量の点を動かす'))
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp, { once: true })
  }

  return (
    <svg
      className={editable ? 'volume-line volume-line--editable' : 'volume-line'}
      width={width}
      height={height}
      onPointerDown={(event) => {
        // Alt+クリックで、その位置・高さに点を足す。
        if (!editable || !event.altKey || event.button !== 0) return
        event.stopPropagation()
        const rect = event.currentTarget.getBoundingClientRect()
        const relMs = ((event.clientX - rect.left) / Math.max(1, rect.width)) * item.durationMs
        report(addVolumeKey(item, relMs, yToGain(event.clientY - rect.top, rect.height)))
      }}
      data-testid="volume-line"
    >
      <polyline points={linePoints} className="volume-line__path" />
      {editable &&
        shown.map((key, index) => (
          <circle
            key={index}
            cx={toX(key.atMs)}
            cy={gainToY(key.gain, height)}
            r={4}
            className="volume-line__point"
            onPointerDown={(event) => beginDrag(event, index)}
            onDoubleClick={(event) => {
              event.stopPropagation()
              report(setVolumeKeys(item, keys.filter((_, position) => position !== index), '音量の点を消す'))
            }}
            data-testid="volume-point"
          >
            <title>{`${Math.round(key.gain * 100)}%(ドラッグで動かす・ダブルクリックで消す)`}</title>
          </circle>
        ))}
    </svg>
  )
}
