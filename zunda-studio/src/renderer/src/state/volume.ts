import { keyGainAt, normalizeKeys } from '@shared/audio/volume-keys'
import type { AudioItem, Ms, VideoItem } from '@shared/project/types'

import { useEditorStore } from './store'

/** 下げるときに、元の音量からなめらかに移る時間。 */
const RAMP_MS = 300

/**
 * アイテム内の時刻 relMs の前後 spanMs だけ、音量を level 倍に下げる(その前後はなめらかに戻す)。
 * 「ここだけ BGM を下げる」「ゲーム音を一瞬消す」に使う。
 */
export function dipVolume(item: AudioItem | VideoItem, relMs: Ms, spanMs: Ms = 1000, level = 0.3): string | null {
  const from = Math.max(0, relMs - spanMs)
  const to = Math.min(item.durationMs, relMs + spanMs)
  const before = keyGainAt(item.volumeKeys, Math.max(0, from - RAMP_MS))
  const after = keyGainAt(item.volumeKeys, Math.min(item.durationMs, to + RAMP_MS))
  // 下げる区間の中にあった点は外し、区間の前後に戻す点を置く。
  const kept = (item.volumeKeys ?? []).filter((key) => key.atMs < from - RAMP_MS || key.atMs > to + RAMP_MS)
  const keys = normalizeKeys([
    ...kept,
    { atMs: Math.max(0, from - RAMP_MS), gain: before },
    { atMs: from, gain: before * level },
    { atMs: to, gain: after * level },
    { atMs: Math.min(item.durationMs, to + RAMP_MS), gain: after }
  ])
  const result = useEditorStore.getState().dispatch([{ op: 'item.setVolumeKeys', itemId: item.id, keys }], 'ここだけ音量を下げる')
  return result.ok ? null : result.message
}
