import { create } from 'zustand'

import type { AssetId, Ms, Project, VideoItem } from '@shared/project/types'
import type { PsdManifest } from '@shared/psd/types'
import type { CanvasLike, RenderResources } from '@shared/render/types'

import { api } from '../api'
import { videoPool } from '../playback/video-pool'

/**
 * プレビュー用の素材供給。画像や PSD は非同期に読み込み、読み込めたら version を上げて再描画を促す。
 * Compositor は読み込み中の素材を飛ばして描き、次の描画で埋まる。
 */
interface ResourceState {
  version: number
  errors: Record<string, string>
}

export const useResourceStore = create<ResourceState>(() => ({ version: 0, errors: {} }))

function bump(): void {
  useResourceStore.setState((state) => ({ version: state.version + 1 }))
}

videoPool.setFrameListener(bump)

class BrowserResources implements RenderResources {
  private readonly manifests = new Map<AssetId, PsdManifest>()
  private readonly manifestRequests = new Map<string, Promise<PsdManifest>>()
  private readonly images = new Map<string, HTMLImageElement | null>()
  private project: Project | null = null

  /** 描画のたびに今のプロジェクトを渡す(素材IDからファイルの場所を引くため)。 */
  bind(project: Project): this {
    if (this.project !== project) videoPool.prune(project)
    this.project = project
    return this
  }

  psd(assetId: AssetId): PsdManifest | null {
    const cached = this.manifests.get(assetId)
    if (cached) return cached
    const asset = this.project?.assets[assetId]
    if (!asset || asset.type !== 'psd') return null
    void this.loadManifest(assetId, asset.path.absolute)
    return null
  }

  /** PSD を読み込む(未読み込みなら解析を依頼する)。立ち絵の設定画面から直接使う。 */
  loadManifest(assetId: AssetId, path: string): Promise<PsdManifest> {
    const existing = this.manifests.get(assetId)
    if (existing) return Promise.resolve(existing)
    let request = this.manifestRequests.get(path)
    if (!request) {
      request = api.invoke('psd:load', path)
      this.manifestRequests.set(path, request)
      request
        .then((manifest) => {
          this.manifests.set(assetId, manifest)
          bump()
        })
        .catch((error: unknown) => {
          this.manifestRequests.delete(path)
          useResourceStore.setState((state) => ({ errors: { ...state.errors, [assetId]: String(error) } }))
        })
    }
    return request
  }

  /** 既に読み込んだ PSD を素材IDに結び付ける(読み込み直しを避ける)。 */
  remember(assetId: AssetId, manifest: PsdManifest): void {
    this.manifests.set(assetId, manifest)
    bump()
  }

  image(path: string): unknown {
    const cached = this.images.get(path)
    if (cached !== undefined) return cached && cached.complete ? cached : null
    const image = new Image()
    this.images.set(path, image)
    image.onload = bump
    image.onerror = () => this.images.set(path, null)
    image.src = api.mediaUrl(path)
    return null
  }

  video(item: VideoItem, sourceMs: Ms): unknown {
    return this.project ? videoPool.frame(this.project, item, sourceMs) : null
  }

  createCanvas(width: number, height: number): CanvasLike {
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.ceil(width))
    canvas.height = Math.max(1, Math.ceil(height))
    return canvas as unknown as CanvasLike
  }
}

export const browserResources = new BrowserResources()
