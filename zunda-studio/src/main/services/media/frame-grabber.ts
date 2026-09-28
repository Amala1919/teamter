import { sourceTimeMs } from '@shared/audio/envelope'
import type { AiImage } from '@shared/ai/types'
import { formatMs } from '@shared/lib/time'
import type { Ms, Project, VideoItem } from '@shared/project/types'

import { AppError } from '../../core/errors'
import { runProcessBuffer } from '../../core/process'
import type { FfmpegLocator } from './ffmpeg'

/** AI に見せるコマの横幅。細かすぎると送る量が増えるだけなので、画面の様子が分かる程度にする。 */
const FRAME_WIDTH = 768

/** その時刻に映っている動画(一番前面のもの)と、素材上の時刻。 */
export function videoAt(project: Project, timeMs: Ms): { item: VideoItem; path: string; sourceMs: Ms } | null {
  const layerIndex = new Map(project.layers.map((layer) => [layer.id, layer.index]))
  const hidden = new Set(project.layers.filter((layer) => !layer.visible).map((layer) => layer.id))
  const candidates = project.items
    .filter((item): item is VideoItem => item.type === 'video' && !hidden.has(item.layerId) && item.startMs <= timeMs && timeMs < item.startMs + item.durationMs)
    .sort((a, b) => (layerIndex.get(b.layerId) ?? 0) - (layerIndex.get(a.layerId) ?? 0))
  const item = candidates[0]
  if (!item) return null
  const asset = project.assets[item.assetId]
  if (!asset || asset.type !== 'video') return null
  return { item, path: asset.path.absolute, sourceMs: sourceTimeMs(item, timeMs - item.startMs) }
}

/**
 * 動画のその時刻のコマを JPEG で取り出す(ゲームの録画そのもの。立ち絵や字幕は重ねない)。
 * 映像の無い時刻は飛ばす。
 */
export async function grabFrames(
  project: Project,
  times: readonly Ms[],
  ffmpeg: FfmpegLocator,
  allow: (path: string) => Promise<void>
): Promise<{ images: AiImage[]; shownTimes: Ms[] }> {
  const images: AiImage[] = []
  const shownTimes: Ms[] = []
  const binary = await ffmpeg.ffmpeg()
  for (const timeMs of times) {
    const found = videoAt(project, timeMs)
    if (!found) continue
    await allow(found.path)
    const run = await runProcessBuffer({
      command: binary,
      args: [
        '-hide_banner',
        '-loglevel',
        'error',
        '-ss',
        (found.sourceMs / 1000).toFixed(3),
        '-i',
        found.path,
        '-frames:v',
        '1',
        '-vf',
        `scale='min(${FRAME_WIDTH},iw)':-2`,
        '-f',
        'image2pipe',
        '-vcodec',
        'mjpeg',
        '-q:v',
        '5',
        '-'
      ],
      env: ffmpeg.processEnv,
      timeoutMs: 30_000
    })
    if (run.exitCode !== 0 || run.stdout.length === 0) {
      throw new AppError('FFMPEG_FAILED', '画面のコマを取り出せませんでした', run.stderr.slice(-1000))
    }
    images.push({ mediaType: 'image/jpeg', data: run.stdout.toString('base64'), caption: `動画の ${formatMs(timeMs)} の画面` })
    shownTimes.push(timeMs)
  }
  return { images, shownTimes }
}
