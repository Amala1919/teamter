import { create } from 'zustand'

import type { SavedCharacter } from '@shared/project/character-library'

/**
 * アプリに保存したキャラクターの一覧(main の characters.json の写し)。
 * 新しいプロジェクトを作るとき(store.ts)にも読むので、ほかの状態に依存しない小さな置き場にしておく。
 */
export const useLibraryEntries = create<{ entries: SavedCharacter[]; loaded: boolean }>(() => ({ entries: [], loaded: false }))

export function setLibraryEntries(entries: SavedCharacter[]): void {
  useLibraryEntries.setState({ entries, loaded: true })
}
