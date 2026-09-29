import { itemEndMs } from '../project/queries'
import type { Ms, Project, VideoItem, ZoomRegion } from '../project/types'
import type { Command } from './types'

/**
 * ズームを置くコマンド。設定(editing.zoomOnStill)で選んでいれば、その時点の動画のコマを静止画にして、
 * ズームと静止画をグループにする(ズームは画像を見せたいときに使うことが多いため)。
 * 静止画にするのは、その時刻に映っている一番上のレイヤーの動画。動画が無ければズームだけを置く。
 * ズームは tempId 'zoom'、静止画は 'still' で受け取れる。
 */
export function zoomCommands(project: Project, atMs: Ms, durationMs: Ms, region: ZoomRegion): Command[] {
  const zoom: Command = { op: 'zoom.insert', atMs, durationMs, region, tempId: 'zoom' }
  const mode = project.editing.zoomOnStill ?? 'overwrite'
  if (mode === 'off') return [zoom]
  const video = videoAt(project, atMs)
  if (!video) return [zoom]
  return [
    { op: 'item.freezeFrame', itemId: video.id, atMs, durationMs, mode, tempId: 'still' },
    zoom,
    { op: 'item.group', itemIds: ['still', 'zoom'] }
  ]
}

/** その時刻に映っている、一番上の(見えている)レイヤーの動画(静止画は除く)。 */
export function videoAt(project: Project, atMs: Ms): VideoItem | null {
  const layers = new Map(project.layers.map((layer) => [layer.id, layer]))
  return (
    project.items
      .filter(
        (item): item is VideoItem =>
          item.type === 'video' && !item.freeze && !item.locked && item.startMs <= atMs && atMs < itemEndMs(item) && layers.get(item.layerId)?.visible !== false && layers.get(item.layerId)?.locked !== true
      )
      .sort((a, b) => (layers.get(b.layerId)?.index ?? 0) - (layers.get(a.layerId)?.index ?? 0))[0] ?? null
  )
}
