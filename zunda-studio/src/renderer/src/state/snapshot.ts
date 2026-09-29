import { renderFrame } from '@shared/render/compositor'
import type { Ctx2D } from '@shared/render/types'
import type { Ms, Project } from '@shared/project/types'

import { api } from '../api'
import { browserResources } from '../render/browser-resources'

/**
 * 今のコマを動画と同じ大きさの PNG で保存する(サムネイルの素材などに)。
 * プレビューと同じ描き方で、ズームは効かせる。保存したら保存先を、やめたら null を返す。
 */
export async function saveFrameImage(project: Project, timeMs: Ms, options: { subtitles: boolean }): Promise<string | null> {
  const seconds = Math.floor(timeMs / 1000)
  const stamp = `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, '0')}s`
  const picked = await api.invoke('dialog:pick', { kind: 'exportImage', defaultName: `${sanitize(project.meta.title)}_${stamp}.png` })
  const path = picked?.[0]
  if (!path) return null
  const canvas = document.createElement('canvas')
  canvas.width = project.canvas.width
  canvas.height = project.canvas.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('画像を作れませんでした')
  renderFrame(context as unknown as Ctx2D, project, timeMs, browserResources.bind(project), { applyZoom: true, subtitles: options.subtitles })
  const dataUrl = canvas.toDataURL('image/png')
  await api.invoke('export:image', path, dataUrl.slice(dataUrl.indexOf(',') + 1))
  return path
}

function sanitize(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]/g, '_').trim()
  return cleaned === '' ? 'frame' : cleaned
}
