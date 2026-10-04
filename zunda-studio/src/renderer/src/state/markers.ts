import { create } from 'zustand'

import type { Marker, Ms } from '@shared/project/types'

import { useEditorStore } from './store'

/** 目印のメモを書いている目印(ダイアログを開いている間)。 */
interface MarkerUiState {
  editingId: string | null
  setEditing: (markerId: string | null) => void
}

export const useMarkerUi = create<MarkerUiState>((set) => ({
  editingId: null,
  setEditing: (editingId) => set({ editingId })
}))

/** 目印の色の選択肢。 */
export const MARKER_COLORS: { color: string; name: string }[] = [
  { color: '#f5c518', name: '黄' },
  { color: '#ff5c5c', name: '赤' },
  { color: '#4dabf7', name: '青' },
  { color: '#51cf66', name: '緑' },
  { color: '#cc5de8', name: '紫' },
  { color: '#ffffff', name: '白' }
]

/** 目印を置く(既定は再生位置)。同じ時刻に既にあれば置かない。置いた目印の ID を返す。 */
export function addMarker(atMs?: Ms, options: { edit?: boolean } = {}): { error: string | null; markerId: string | null } {
  const { project, playheadMs, dispatch } = useEditorStore.getState()
  const at = Math.max(0, Math.round(atMs ?? playheadMs))
  const existing = (project.markers ?? []).find((marker) => Math.abs(marker.atMs - at) < 1)
  if (existing) {
    if (options.edit) useMarkerUi.getState().setEditing(existing.id)
    return { error: null, markerId: existing.id }
  }
  const result = dispatch([{ op: 'marker.add', atMs: at, tempId: 'marker' }], '目印を置く')
  if (!result.ok) return { error: result.message, markerId: null }
  const markerId = result.resolvedIds['marker'] ?? null
  if (options.edit && markerId) useMarkerUi.getState().setEditing(markerId)
  return { error: null, markerId }
}

export function updateMarker(marker: Marker, patch: { atMs?: Ms; text?: string; color?: string }, label: string): string | null {
  const result = useEditorStore.getState().dispatch([{ op: 'marker.update', markerId: marker.id, ...patch }], label)
  return result.ok ? null : result.message
}

export function removeMarker(marker: Marker): string | null {
  const result = useEditorStore.getState().dispatch([{ op: 'marker.remove', markerId: marker.id }], '目印を消す')
  return result.ok ? null : result.message
}

/** 再生位置の前後の目印へ飛ぶ。 */
export function jumpToMarker(direction: 1 | -1): void {
  const { project, playheadMs, setPlayhead } = useEditorStore.getState()
  const times = (project.markers ?? []).map((marker) => marker.atMs).sort((a, b) => a - b)
  const next = direction > 0 ? times.find((at) => at > playheadMs + 1) : [...times].reverse().find((at) => at < playheadMs - 1)
  if (next !== undefined) setPlayhead(next)
}
