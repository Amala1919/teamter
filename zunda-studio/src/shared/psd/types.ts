/**
 * PSD を解析した結果。各レイヤーは PNG としてキャッシュに書き出され、描画時はそれを読む。
 * レイヤーの並びは PSD と同じく「下から上」。
 */

/** Canvas の globalCompositeOperation で表現できる合成方法。pass-through はグループ専用。 */
export type LayerBlend =
  | 'source-over'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'color-burn'
  | 'hard-light'
  | 'soft-light'
  | 'difference'
  | 'exclusion'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity'
  | 'lighter'
  | 'pass-through'

export interface PsdLayerNode {
  /** ルートからのパスを '/' で繋いだもの。同じ名前が並ぶ場合は「名前#2」のように番号を付けて区別する。 */
  key: string
  name: string
  /** key を分解したもの。プロジェクトのパーツ定義(LayerPath)はこれで指す。 */
  path: string[]
  kind: 'group' | 'layer'
  /** PSD 上で非表示になっているか。 */
  hidden: boolean
  opacity: number
  blend: LayerBlend
  /** 下のレイヤーでクリッピングされているか。 */
  clipping: boolean
  left: number
  top: number
  width: number
  height: number
  /** レイヤーの画像(PNG)の絶対パス。グループや空のレイヤーは null。 */
  image: string | null
  children: PsdLayerNode[]
}

export interface PsdManifest {
  width: number
  height: number
  layers: PsdLayerNode[]
  /** 再現できない要素(レイヤー効果・グループのマスク・未対応の合成モード)の説明。 */
  warnings: string[]
}

export const LAYER_KEY_SEPARATOR = '/'

export function layerKey(path: readonly string[]): string {
  return path.join(LAYER_KEY_SEPARATOR)
}

/** 名前に含まれる区切り文字をエスケープする(レイヤー名に / が入ることがある)。 */
export function escapeLayerName(name: string): string {
  return name.replace(/\//g, '／')
}

export function walkLayers(layers: readonly PsdLayerNode[], visit: (node: PsdLayerNode) => void): void {
  for (const node of layers) {
    visit(node)
    walkLayers(node.children, visit)
  }
}

export function findLayer(layers: readonly PsdLayerNode[], key: string): PsdLayerNode | null {
  let found: PsdLayerNode | null = null
  walkLayers(layers, (node) => {
    if (!found && node.key === key) found = node
  })
  return found
}
