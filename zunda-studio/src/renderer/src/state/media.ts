import { create } from 'zustand'

import type { Command } from '@shared/commands/types'
import type { MediaProbe, ProxyFormat } from '@shared/media/types'
import type { Asset, AssetId, MediaCodecs, Ms, Project } from '@shared/project/types'

import { api, toAppError } from '../api'
import { useEditorStore } from './store'

/**
 * 素材の読み込みと、プレビューで再生する実体(元ファイルかプロキシか)の管理。
 */

type SourceState =
  | { state: 'direct'; path: string }
  | { state: 'building'; ratio: number }
  | { state: 'ready'; path: string }
  | { state: 'error'; message: string }

interface MediaState {
  /** 素材の絶対パス → プレビューで使う実体。 */
  sources: Record<string, SourceState>
  /** 素材の絶対パス → 波形(0〜255 の振幅、1秒あたり samplesPerSecond 個)。 */
  peaks: Record<string, { samplesPerSecond: number; data: Uint8Array } | null>
}

export const useMediaStore = create<MediaState>(() => ({ sources: {}, peaks: {} }))

let progressSubscribed = false

function subscribeProgress(): void {
  if (progressSubscribed) return
  progressSubscribed = true
  api.subscribe('media:proxy-progress', ({ path, ratio }) => {
    const current = useMediaStore.getState().sources[path]
    if (current?.state !== 'building' || ratio >= 1) return
    setSource(path, { state: 'building', ratio })
  })
}

function setSource(path: string, source: SourceState): void {
  useMediaStore.setState((state) => ({ sources: { ...state.sources, [path]: source } }))
}

// ---------------------------------------------------------------- 再生できるか

let probeElement: HTMLVideoElement | null = null

/** この画面(Chromium)で、その符号化方式の動画をそのまま再生できるか。 */
export function canPlayDirectly(codecs: MediaCodecs | undefined): boolean {
  if (!codecs) return false
  probeElement ??= document.createElement('video')
  const type = videoMime(codecs)
  return type !== null && probeElement.canPlayType(type) !== ''
}

const VIDEO_CODECS: Record<string, string> = { h264: 'avc1.640028', hevc: 'hvc1.1.6.L93.B0', vp8: 'vp8', vp9: 'vp9', av1: 'av01.0.05M.08' }
const AUDIO_CODECS: Record<string, string> = { aac: 'mp4a.40.2', opus: 'opus', vorbis: 'vorbis', mp3: 'mp3' }

function videoMime(codecs: MediaCodecs): string | null {
  const video = codecs.video ? VIDEO_CODECS[codecs.video] : undefined
  const audio = codecs.audio === null ? null : AUDIO_CODECS[codecs.audio]
  if (!video || audio === undefined) return null
  const list = [video, audio].filter(Boolean).join(', ')
  // mkv は Chromium が webm として扱える範囲(VP8/VP9/AV1 + Opus/Vorbis)だけ直接再生する。
  if (codecs.container.includes('webm') || codecs.container.includes('matroska')) {
    const webmOk = ['vp8', 'vp9', 'av01.0.05M.08'].includes(video) && (audio === null || audio === 'opus' || audio === 'vorbis')
    return webmOk ? `video/webm; codecs="${list}"` : null
  }
  if (codecs.container.includes('mp4') || codecs.container.includes('mov')) return `video/mp4; codecs="${list}"`
  return null
}

function proxyFormat(): ProxyFormat {
  probeElement ??= document.createElement('video')
  return probeElement.canPlayType('video/mp4; codecs="avc1.42E01E, mp4a.40.2"') !== '' ? 'mp4' : 'webm'
}

/**
 * プレビューで再生する実体の場所。そのまま再生できない動画はプロキシを作り、できるまで null を返す。
 */
export function playableSource(asset: Asset): string | null {
  if (asset.type !== 'video') return asset.path.absolute
  const path = asset.path.absolute
  const current = useMediaStore.getState().sources[path]
  if (current) return current.state === 'direct' || current.state === 'ready' ? current.path : null
  if (canPlayDirectly(asset.codecs)) {
    setSource(path, { state: 'direct', path })
    return path
  }
  subscribeProgress()
  setSource(path, { state: 'building', ratio: 0 })
  api
    .invoke('media:proxy', path, proxyFormat())
    .then((proxy) => setSource(path, { state: 'ready', path: proxy }))
    .catch((error: unknown) => setSource(path, { state: 'error', message: toAppError(error).message }))
  return null
}

// ---------------------------------------------------------------- 波形

export function loadPeaks(path: string): void {
  if (path in useMediaStore.getState().peaks) return
  useMediaStore.setState((state) => ({ peaks: { ...state.peaks, [path]: null } }))
  api
    .invoke('media:peaks', path)
    .then((peaks) => {
      const binary = atob(peaks.data)
      const data = new Uint8Array(binary.length)
      for (let index = 0; index < binary.length; index++) data[index] = binary.charCodeAt(index)
      useMediaStore.setState((state) => ({ peaks: { ...state.peaks, [path]: { samplesPerSecond: peaks.samplesPerSecond, data } } }))
    })
    .catch(() => {
      // 波形は補助的な表示なので、作れなくても編集は続けられる。
    })
}

// ---------------------------------------------------------------- 取り込み

/** 画像を置くときの既定の尺。 */
const DEFAULT_IMAGE_MS = 5000

function codecsOf(probe: MediaProbe): MediaCodecs {
  return { video: probe.videoCodec, audio: probe.audioCodec, container: probe.container }
}

/** 調べた結果から、素材の登録と配置のコマンドを作る。 */
export function importCommands(project: Project, path: string, probe: MediaProbe, atMs: Ms, tempId: string): Command[] {
  const license = { source: '', creditRequired: probe.kind !== 'video', creditText: '' }
  switch (probe.kind) {
    case 'video':
      return [
        {
          op: 'asset.add',
          asset: {
            type: 'video',
            path: { absolute: path, relative: null },
            // ゲーム録画は自分で撮ったものが多いので、既定ではクレジット不要にしておく。
            license: { ...license, source: '自分で録画' },
            durationMs: probe.durationMs,
            width: probe.width,
            height: probe.height,
            fps: probe.fps,
            hasAudio: probe.hasAudio,
            codecs: codecsOf(probe)
          },
          tempId
        },
        { op: 'media.placeVideo', assetId: tempId, atMs }
      ]
    case 'audio':
      return [
        {
          op: 'asset.add',
          asset: { type: 'audio', path: { absolute: path, relative: null }, license, durationMs: probe.durationMs, codecs: codecsOf(probe) },
          tempId
        },
        // 1分以上の音声は BGM とみなして下げる対象に、短い音声は効果音とみなす。
        { op: 'media.placeAudio', assetId: tempId, atMs, duckable: probe.durationMs >= 60_000, volume: probe.durationMs >= 60_000 ? 0.4 : 1 }
      ]
    case 'image': {
      const fit = Math.min(1, project.canvas.width / Math.max(1, probe.width), project.canvas.height / Math.max(1, probe.height))
      return [
        { op: 'asset.add', asset: { type: 'image', path: { absolute: path, relative: null }, license, width: probe.width, height: probe.height }, tempId },
        { op: 'media.placeImage', assetId: tempId, atMs, durationMs: DEFAULT_IMAGE_MS, transform: { scale: Math.round(fit * 1000) / 1000 } }
      ]
    }
  }
}

/** ファイルを選んで、再生位置に置く。置いたアイテムのIDを返す。 */
export async function importMediaFiles(): Promise<{ itemIds: string[]; errors: string[] }> {
  const picked = await api.invoke('dialog:pick', { kind: 'media', multiple: true })
  if (!picked || picked.length === 0) return { itemIds: [], errors: [] }
  const itemIds: string[] = []
  const errors: string[] = []
  for (const path of picked) {
    try {
      const probe = await api.invoke('media:probe', path)
      const { project, playheadMs, dispatch } = useEditorStore.getState()
      const commands = importCommands(project, path, probe, playheadMs, 'asset')
      const before = new Set(project.items.map((item) => item.id))
      const result = dispatch(commands, '素材の追加')
      if (!result.ok) {
        errors.push(result.message)
        continue
      }
      const added = useEditorStore.getState().project.items.find((item) => !before.has(item.id))
      if (added) itemIds.push(added.id)
    } catch (error) {
      errors.push(`${path.split(/[\\/]/).at(-1)}: ${toAppError(error).message}`)
    }
  }
  if (itemIds.length > 0) useEditorStore.getState().setSelection(itemIds.slice(-1))
  return { itemIds, errors }
}

export function assetName(asset: Asset | undefined): string {
  return asset?.path.absolute.split(/[\\/]/).at(-1) ?? '(素材が見つかりません)'
}

export type { AssetId }
