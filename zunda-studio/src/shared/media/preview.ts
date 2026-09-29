import type { PreviewResolution } from '../project/types'

/**
 * プレビューに元のファイルを使うか、軽い動画を作るか。maxHeight は軽い動画の高さの上限
 * (undefined は設定の高さ、0 は元の大きさ)。
 */
export function previewPlan(preview: PreviewResolution, sourceHeight: number, playable: boolean): { direct: boolean; maxHeight?: number } {
  if (preview === 'auto') return playable ? { direct: true } : { direct: false }
  if (preview === 'original') return playable ? { direct: true } : { direct: false, maxHeight: 0 }
  // 高さを選んだとき: 元がその高さ以下で、そのまま再生できるなら元のまま
  if (playable && sourceHeight <= preview) return { direct: true }
  return { direct: false, maxHeight: preview }
}
