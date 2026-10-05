import { create } from 'zustand'

import type { ItemId } from '@shared/project/types'

/** プレビューでの編集の道具(インスペクタやメニューから切り替える)。 */
interface PreviewToolsState {
  /** プレビューで切り抜きを編集している動画・画像。 */
  cropItemId: ItemId | null
  setCropItem: (itemId: ItemId | null) => void
}

export const usePreviewTools = create<PreviewToolsState>((set) => ({
  cropItemId: null,
  setCropItem: (cropItemId) => set({ cropItemId })
}))
