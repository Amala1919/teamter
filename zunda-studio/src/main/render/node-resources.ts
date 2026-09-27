import { createCanvas, loadImage, type Image } from '@napi-rs/canvas'

import type { AssetId } from '@shared/project/types'
import { walkLayers, type PsdManifest } from '@shared/psd/types'
import type { CanvasLike, RenderResources } from '@shared/render/types'

/**
 * 書き出し(と Node 上のテスト)で Compositor に素材を渡す。
 * ブラウザと違い画像の読み込みを待てないので、描画前に preload で全て読み込んでおく。
 */
export class NodeRenderResources implements RenderResources {
  private readonly manifests = new Map<AssetId, PsdManifest>()
  private readonly images = new Map<string, Image>()

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

  createCanvas(width: number, height: number): CanvasLike {
    return createCanvas(Math.max(1, Math.ceil(width)), Math.max(1, Math.ceil(height))) as unknown as CanvasLike
  }
}
