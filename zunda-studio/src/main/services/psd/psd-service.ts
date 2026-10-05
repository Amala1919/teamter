import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { createCanvas } from '@napi-rs/canvas'
import { initializeCanvas, readPsd, type BlendMode, type Layer } from 'ag-psd'

import {
  escapeLayerName,
  LAYER_KEY_SEPARATOR,
  type LayerBlend,
  type PsdLayerNode,
  type PsdManifest
} from '@shared/psd/types'

import { AppError } from '../../core/errors'
import { fileExists, writeFileAtomic } from '../../core/fs'

let canvasInitialized = false

/** ag-psd は Node でも画像データの生成にキャンバスを要求するため、一度だけ初期化する。 */
function ensureCanvas(): void {
  if (canvasInitialized) return
  type InitArgs = Parameters<typeof initializeCanvas>
  initializeCanvas(
    createCanvas as unknown as InitArgs[0],
    ((width: number, height: number) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) })) as unknown as InitArgs[1]
  )
  canvasInitialized = true
}

const BLEND_MAP: Partial<Record<BlendMode, LayerBlend>> = {
  'pass through': 'pass-through',
  normal: 'source-over',
  multiply: 'multiply',
  screen: 'screen',
  overlay: 'overlay',
  darken: 'darken',
  lighten: 'lighten',
  'color dodge': 'color-dodge',
  'color burn': 'color-burn',
  'hard light': 'hard-light',
  'soft light': 'soft-light',
  difference: 'difference',
  exclusion: 'exclusion',
  hue: 'hue',
  saturation: 'saturation',
  color: 'color',
  luminosity: 'luminosity',
  // 覆い焼き(リニア)- 加算。Canvas の lighter が同じ計算になる。
  'linear dodge': 'lighter'
}

const MANIFEST_VERSION = 1

/**
 * キャッシュの manifest に書かれたパーツの画像の場所を、今のキャッシュの場所に直す。
 * manifest は画像を絶対パスで持つので、キャッシュの置き場所を移す(設定 → 保存場所)と、移す前の場所を指したままになる。
 * 移す前の場所は配信が許されないため、立ち絵が出なくなっていた。画像はいつも manifest と同じフォルダにあるので、ファイル名だけを使う。
 */
export function relocateManifest(manifest: PsdManifest, directory: string): PsdManifest {
  const fix = (nodes: PsdLayerNode[]): PsdLayerNode[] =>
    nodes.map((node) => ({
      ...node,
      image: node.image === null ? null : join(directory, node.image.split(/[\\/]/).at(-1) ?? node.image),
      children: fix(node.children)
    }))
  return { ...manifest, layers: fix(manifest.layers) }
}

/**
 * PSD を解析し、レイヤーごとの PNG とレイヤーツリー(manifest)をキャッシュに書き出す。
 * キャッシュのキーはファイルの場所・大きさ・更新時刻で決め、PSD を描き直したら自動で作り直す。
 */
export class PsdService {
  private readonly inFlight = new Map<string, Promise<PsdManifest>>()

  constructor(private readonly cacheDirectory: string) {}

  async load(path: string): Promise<PsdManifest> {
    let info
    try {
      info = await stat(path)
    } catch {
      throw new AppError('NOT_FOUND', `PSD が見つかりません: ${path}`)
    }
    const key = createHash('sha256')
      .update(JSON.stringify([MANIFEST_VERSION, path, info.size, info.mtimeMs]))
      .digest('hex')
      .slice(0, 32)
    const directory = join(this.cacheDirectory, key)
    const manifestPath = join(directory, 'manifest.json')

    if (await fileExists(manifestPath)) {
      return relocateManifest(JSON.parse(await readFile(manifestPath, 'utf8')) as PsdManifest, directory)
    }
    const pending = this.inFlight.get(key)
    if (pending) return pending
    const task = this.extract(path, directory, manifestPath).finally(() => this.inFlight.delete(key))
    this.inFlight.set(key, task)
    return task
  }

  private async extract(path: string, directory: string, manifestPath: string): Promise<PsdManifest> {
    ensureCanvas()
    let psd
    try {
      psd = readPsd(await readFile(path), {
        useImageData: true,
        skipCompositeImageData: true,
        skipThumbnail: true
      })
    } catch (error) {
      throw new AppError('PSD_UNSUPPORTED', 'PSD を読み込めませんでした', String(error))
    }
    if ((psd.bitsPerChannel ?? 8) !== 8) {
      throw new AppError('PSD_UNSUPPORTED', '8bit 以外の PSD には対応していません。8bit/チャンネルで保存し直してください')
    }

    await rm(directory, { recursive: true, force: true })
    await mkdir(directory, { recursive: true })
    const warnings = new Set<string>()
    let counter = 0

    const convert = async (layers: readonly Layer[], parentPath: string[]): Promise<PsdLayerNode[]> => {
      const used = new Map<string, number>()
      const nodes: PsdLayerNode[] = []
      for (const layer of layers) {
        const baseName = escapeLayerName(layer.name ?? '')
        const count = (used.get(baseName) ?? 0) + 1
        used.set(baseName, count)
        const segment = count === 1 ? baseName : `${baseName}#${count}`
        const nodePath = [...parentPath, segment]
        const isGroup = layer.children !== undefined

        const mapped = BLEND_MAP[layer.blendMode ?? (isGroup ? 'pass through' : 'normal')]
        if (!mapped) warnings.add(`合成モード「${layer.blendMode}」は通常として描画します`)
        if (layer.effects && Object.keys(layer.effects).some((effect) => effect !== 'scale' && effect !== 'disabled')) {
          warnings.add('レイヤー効果(境界線・ドロップシャドウ等)は再現されません')
        }
        if (isGroup && layer.mask?.imageData) warnings.add('グループのマスクは再現されません')

        let image: string | null = null
        const left = layer.left ?? 0
        const top = layer.top ?? 0
        const width = Math.max(0, (layer.right ?? 0) - left)
        const height = Math.max(0, (layer.bottom ?? 0) - top)
        if (!isGroup && layer.imageData && width > 0 && height > 0) {
          const pixels = applyLayerMask(layer, left, top, width, height)
          const file = join(directory, `${String(counter++).padStart(4, '0')}.png`)
          await writeFile(file, encodePng(pixels, width, height))
          image = file
        }

        nodes.push({
          key: nodePath.join(LAYER_KEY_SEPARATOR),
          name: layer.name ?? '',
          path: nodePath,
          kind: isGroup ? 'group' : 'layer',
          hidden: layer.hidden ?? false,
          opacity: layer.opacity ?? 1,
          blend: mapped ?? (isGroup ? 'pass-through' : 'source-over'),
          clipping: layer.clipping ?? false,
          left,
          top,
          width,
          height,
          image,
          children: isGroup ? await convert(layer.children ?? [], nodePath) : []
        })
      }
      return nodes
    }

    const manifest: PsdManifest = {
      width: psd.width,
      height: psd.height,
      layers: await convert(psd.children ?? [], []),
      warnings: [...warnings]
    }
    await writeFileAtomic(manifestPath, JSON.stringify(manifest))
    return manifest
  }
}

/** レイヤーマスクを画素の不透明度に焼き込む。描画時にマスクを扱わずに済むようにするため。 */
function applyLayerMask(layer: Layer, left: number, top: number, width: number, height: number): Uint8ClampedArray {
  const source = layer.imageData!.data
  const pixels = new Uint8ClampedArray(source)
  const mask = layer.mask
  if (!mask || mask.disabled || !mask.imageData) return pixels

  const maskLeft = mask.left ?? 0
  const maskTop = mask.top ?? 0
  const maskWidth = mask.imageData.width
  const maskHeight = mask.imageData.height
  const outside = mask.defaultColor ?? 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const mx = left + x - maskLeft
      const my = top + y - maskTop
      const value =
        mx >= 0 && my >= 0 && mx < maskWidth && my < maskHeight ? mask.imageData.data[(my * maskWidth + mx) * 4]! : outside
      const index = (y * width + x) * 4 + 3
      pixels[index] = Math.round((pixels[index]! * value) / 255)
    }
  }
  return pixels
}

function encodePng(pixels: Uint8ClampedArray, width: number, height: number): Buffer {
  const canvas = createCanvas(width, height)
  const context = canvas.getContext('2d')
  const imageData = context.createImageData(width, height)
  imageData.data.set(pixels)
  context.putImageData(imageData, 0, 0)
  return canvas.toBuffer('image/png')
}
