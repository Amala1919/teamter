import { NO_PART, type Character, type PartGroupId, type PartId, type PortraitConfig, type PortraitPartGroup, type PortraitTransform } from '../project/types'
import { layerKey, type PsdLayerNode, type PsdManifest } from '../psd/types'
import type { CanvasLike, Ctx2D, RenderResources } from './types'

/**
 * PSD 立ち絵の描画。パーツの選択から見えるレイヤーを決め、下から順に合成する。
 * 同じパーツの組み合わせは合成結果をキャッシュする。口パクとまばたきで組み合わせは限られるので、
 * 毎フレーム数十枚のレイヤーを合成し直さずに済む。
 */

interface CacheEntry {
  canvas: CanvasLike
}

const CACHE_LIMIT = 48
const caches = new WeakMap<RenderResources, Map<string, CacheEntry>>()

function cacheFor(resources: RenderResources): Map<string, CacheEntry> {
  let cache = caches.get(resources)
  if (!cache) {
    cache = new Map()
    caches.set(resources, cache)
  }
  return cache
}

/** 各レイヤーを表示するか。パーツグループでは選ばれた子だけ、それ以外は PSD の状態(と上書き)に従う。 */
export function visibilityResolver(
  portrait: PortraitConfig,
  selections: Record<PartGroupId, PartId>
): (node: PsdLayerNode) => boolean {
  const selectedChild = new Map<string, string>()
  for (const group of Object.values(portrait.partGroups) as PortraitPartGroup[]) {
    if (group.selection !== 'exclusive') continue
    const partId = selections[group.id]
    // 「なし」は、どの子とも一致しない値を入れてグループの中身を全て隠す。
    if (partId === NO_PART) {
      selectedChild.set(layerKey(group.layerPath), NO_PART)
      continue
    }
    const part = group.items.find((item) => item.id === partId)
    if (part) selectedChild.set(layerKey(group.layerPath), layerKey(part.layerPath))
  }
  return (node) => {
    const parentKey = layerKey(node.path.slice(0, -1))
    const chosen = selectedChild.get(parentKey)
    if (chosen !== undefined) return chosen === node.key
    return portrait.layerVisibility[node.key] ?? !node.hidden
  }
}

function blendOf(node: PsdLayerNode): string {
  return node.blend === 'pass-through' ? 'source-over' : node.blend
}

/** 描いたレイヤーがすべて読み込み済みだったか(未読み込みがあればキャッシュしない)。 */
interface DrawState {
  complete: boolean
}

function drawNodes(
  context: Ctx2D,
  nodes: readonly PsdLayerNode[],
  visible: (node: PsdLayerNode) => boolean,
  manifest: PsdManifest,
  resources: RenderResources,
  state: DrawState
): void {
  let index = 0
  while (index < nodes.length) {
    const base = nodes[index]!
    // クリッピングされたレイヤーは、直下のクリッピングされていないレイヤー(基底)の形で切り抜かれる。
    const clipped: PsdLayerNode[] = []
    let next = index + 1
    while (next < nodes.length && nodes[next]!.clipping) clipped.push(nodes[next++]!)
    index = next

    if (!visible(base)) continue
    const visibleClipped = clipped.filter(visible)
    if (visibleClipped.length === 0) {
      drawNode(context, base, visible, manifest, resources, state)
      continue
    }

    const baseCanvas = resources.createCanvas(manifest.width, manifest.height)
    const baseContext = baseCanvas.getContext('2d')!
    drawNode(baseContext, { ...base, blend: 'source-over', opacity: 1 }, visible, manifest, resources, state)

    const combined = resources.createCanvas(manifest.width, manifest.height)
    const combinedContext = combined.getContext('2d')!
    combinedContext.drawImage(baseCanvas, 0, 0)
    for (const layer of visibleClipped) drawNode(combinedContext, layer, visible, manifest, resources, state)
    combinedContext.globalCompositeOperation = 'destination-in'
    combinedContext.globalAlpha = 1
    combinedContext.drawImage(baseCanvas, 0, 0)

    context.save()
    context.globalAlpha = base.opacity
    context.globalCompositeOperation = blendOf(base)
    context.drawImage(combined, 0, 0)
    context.restore()
  }
}

function drawNode(
  context: Ctx2D,
  node: PsdLayerNode,
  visible: (node: PsdLayerNode) => boolean,
  manifest: PsdManifest,
  resources: RenderResources,
  state: DrawState
): void {
  if (node.kind === 'group') {
    if (node.blend === 'pass-through' && node.opacity >= 1) {
      drawNodes(context, node.children, visible, manifest, resources, state)
      return
    }
    const groupCanvas = resources.createCanvas(manifest.width, manifest.height)
    drawNodes(groupCanvas.getContext('2d')!, node.children, visible, manifest, resources, state)
    context.save()
    context.globalAlpha = node.opacity
    context.globalCompositeOperation = blendOf(node)
    context.drawImage(groupCanvas, 0, 0)
    context.restore()
    return
  }
  if (!node.image) return
  const image = resources.image(node.image)
  if (!image) {
    state.complete = false
    return
  }
  context.save()
  context.globalAlpha = node.opacity
  context.globalCompositeOperation = blendOf(node)
  context.drawImage(image, node.left, node.top)
  context.restore()
}

/** 立ち絵全体を PSD の大きさで合成したキャンバスを返す(キャッシュ付き)。 */
export function composePortrait(
  portrait: PortraitConfig,
  manifest: PsdManifest,
  selections: Record<PartGroupId, PartId>,
  resources: RenderResources
): CanvasLike | null {
  const visible = visibilityResolver(portrait, selections)
  const visibleKeys: string[] = []
  const collect = (nodes: readonly PsdLayerNode[]): void => {
    for (const node of nodes) {
      if (!visible(node)) continue
      visibleKeys.push(node.key)
      collect(node.children)
    }
  }
  collect(manifest.layers)
  const key = `${portrait.assetId}|${visibleKeys.join('|')}`

  const cache = cacheFor(resources)
  const cached = cache.get(key)
  if (cached) {
    // 最近使ったものを末尾へ(LRU)。
    cache.delete(key)
    cache.set(key, cached)
    return cached.canvas
  }

  const canvas = resources.createCanvas(manifest.width, manifest.height)
  const context = canvas.getContext('2d')
  if (!context) return null
  const state: DrawState = { complete: true }
  drawNodes(context, manifest.layers, visible, manifest, resources, state)
  if (state.complete) {
    if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!)
    cache.set(key, { canvas })
  }
  return canvas
}

export function portraitPlacement(
  transform: PortraitTransform,
  manifest: PsdManifest
): { x: number; y: number; width: number; height: number } {
  const width = manifest.width * transform.scale
  const height = manifest.height * transform.scale
  const [vertical, horizontal] = transform.anchor.includes('-')
    ? (transform.anchor.split('-') as [string, string])
    : ['center', 'center']
  const x = horizontal === 'left' ? transform.x : horizontal === 'right' ? transform.x - width : transform.x - width / 2
  const y = vertical === 'top' ? transform.y : vertical === 'bottom' ? transform.y - height : transform.y - height / 2
  return { x, y, width, height }
}

export function drawPortrait(
  context: Ctx2D,
  character: Character,
  manifest: PsdManifest,
  selections: Record<PartGroupId, PartId>,
  resources: RenderResources,
  transform: PortraitTransform = character.portrait!.transform
): void {
  const portrait = character.portrait
  if (!portrait) return
  const composed = composePortrait(portrait, manifest, selections, resources)
  if (!composed) return
  const placement = portraitPlacement(transform, manifest)
  context.save()
  if (transform.flipX) {
    context.translate(placement.x + placement.width, placement.y)
    context.scale(-1, 1)
    context.drawImage(composed, 0, 0, placement.width, placement.height)
  } else {
    context.drawImage(composed, placement.x, placement.y, placement.width, placement.height)
  }
  context.restore()
}
