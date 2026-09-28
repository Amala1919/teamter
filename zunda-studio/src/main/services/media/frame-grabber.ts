import { sourceTimeMs } from '@shared/audio/envelope'
import { clampRegion, isWholeFrame, VISION_MAX_EDGE, type VisionOptions } from '@shared/ai/cohost'
import type { AiImage } from '@shared/ai/types'
import { formatMs } from '@shared/lib/time'
import type { Ms, Project, VideoItem } from '@shared/project/types'

import { AppError } from '../../core/errors'
import { runProcessBuffer } from '../../core/process'
import type { FfmpegLocator } from './ffmpeg'

/**
 * コマの取り出しに使う ffmpeg のフィルタ。範囲があれば切り出し、長辺を maxEdge までに縮める(元より大きくはしない)。
 * 標準は長辺 768px(画面の様子が分かる程度。送る量を抑える)、高画質は 1568px(細かい文字も読める)。
 */
export function frameFilter(maxEdge: number, region?: VisionOptions['region']): string {
  const scale = `scale='if(gte(iw,ih),min(${maxEdge},iw),-2)':'if(gte(iw,ih),-2,min(${maxEdge},ih))'`
  if (isWholeFrame(region)) return scale
  const { x, y, width, height } = clampRegion(region!)
  const n = (value: number): string => value.toFixed(4)
  // 幅・高さは偶数にそろえる(JPEG の色の間引きで端が欠けないように)。
  return `crop=trunc(iw*${n(width)}/2)*2:trunc(ih*${n(height)}/2)*2:trunc(iw*${n(x)}):trunc(ih*${n(y)}),${scale}`
}

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
  allow: (path: string) => Promise<void>,
  options: VisionOptions & { maxEdge?: number } = {}
): Promise<{ images: AiImage[]; shownTimes: Ms[] }> {
  const filter = frameFilter(options.maxEdge ?? VISION_MAX_EDGE[options.quality ?? 'standard'], options.region)
  const partial = !isWholeFrame(options.region)
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
        filter,
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
    images.push({
      mediaType: 'image/jpeg',
      data: run.stdout.toString('base64'),
      caption: `動画の ${formatMs(timeMs)} の画面${partial ? '(一部を切り出したもの)' : ''}`
    })
    shownTimes.push(timeMs)
  }
  return { images, shownTimes }
}
