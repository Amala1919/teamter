import { createCanvas, loadImage, type Image } from '@napi-rs/canvas'

import type { AssetId, ItemId, VideoItem } from '@shared/project/types'
import { walkLayers, type PsdManifest } from '@shared/psd/types'
import type { CanvasLike, RenderResources } from '@shared/render/types'

/**
 * 書き出し(と Node 上のテスト)で Compositor に素材を渡す。
 * ブラウザと違い画像の読み込みを待てないので、描画前に preload で全て読み込んでおく。
 */
export class NodeRenderResources implements RenderResources {
  private readonly manifests = new Map<AssetId, PsdManifest>()
  private readonly images = new Map<string, Image>()
  /** 書き出しでは、1コマ描く前に各動画アイテムの今のコマをここに置く。 */
  private readonly videoFrames = new Map<ItemId, unknown>()

  async addPsd(assetId: AssetId, manifest: PsdManifest): Promise<void> {
    this.manifests.set(assetId, manifest)
    const paths: string[] = []
    walkLayers(manifest.layers, (node) => {
      if (node.image) paths.push(node.image)
    })
    await Promise.all(paths.map((path) => this.loadImage(path)))
  }

  async loadImage(path: string): Promise<void> {
    if (this.images.has(path)) return
    this.images.set(path, await loadImage(path))
  }

  psd(assetId: AssetId): PsdManifest | null {
    return this.manifests.get(assetId) ?? null
  }

  image(path: string): unknown {
    return this.images.get(path) ?? null
  }

  setVideoFrame(itemId: ItemId, frame: unknown): void {
    if (frame === null) this.videoFrames.delete(itemId)
    else this.videoFrames.set(itemId, frame)
  }

  video(item: VideoItem): unknown {
    return this.videoFrames.get(item.id) ?? null
  }

  createCanvas(width: number, height: number): CanvasLike {
    return createCanvas(Math.max(1, Math.ceil(width)), Math.max(1, Math.ceil(height))) as unknown as CanvasLike
  }
}
