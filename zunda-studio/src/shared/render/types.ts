import type { AssetId, Ms, VideoItem } from '../project/types'
import type { PsdManifest } from '../psd/types'

/**
 * Compositor が使う描画 API の最小集合。
 * ブラウザの CanvasRenderingContext2D と、書き出しで使う @napi-rs/canvas の両方が満たす。
 */
export interface Ctx2D {
  /** この描画先のキャンバス。ズームで描いた内容を拡大し直すのに使う。 */
  readonly canvas: unknown
  save(): void
  restore(): void
  clearRect(x: number, y: number, width: number, height: number): void
  fillRect(x: number, y: number, width: number, height: number): void
  strokeRect(x: number, y: number, width: number, height: number): void
  fillText(text: string, x: number, y: number): void
  strokeText(text: string, x: number, y: number): void
  measureText(text: string): { width: number }
  drawImage(image: unknown, dx: number, dy: number): void
  drawImage(image: unknown, dx: number, dy: number, dw: number, dh: number): void
  drawImage(
    image: unknown,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number
  ): void
  translate(x: number, y: number): void
  scale(x: number, y: number): void
  rotate(angle: number): void
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void
  setLineDash(segments: number[]): void
  beginPath(): void
  ellipse(x: number, y: number, rx: number, ry: number, rotation: number, start: number, end: number): void
  fill(): void
  fillStyle: unknown
  strokeStyle: unknown
  lineWidth: number
  lineJoin: string
  globalAlpha: number
  globalCompositeOperation: string
  /** CSS のフィルタ(立ち絵を暗くするのに使う)。対応していない環境もある。 */
  filter?: string
  font: string
  textAlign: string
  textBaseline: string
  shadowColor: string
  shadowOffsetX: number
  shadowOffsetY: number
  shadowBlur: number
}

export interface CanvasLike {
  width: number
  height: number
  getContext(type: '2d'): Ctx2D | null
}

/**
 * 描画に使う素材の供給元。プレビュー(ブラウザ)と書き出し(Node)で実装が異なるが、Compositor は区別しない。
 * 画像がまだ読み込まれていなければ null を返してよい(その部分は描かれず、読み込み後に再描画される)。
 */
export interface RenderResources {
  psd(assetId: AssetId): PsdManifest | null
  image(path: string): unknown
  /** 動画アイテムの、素材上の時刻 sourceMs のコマ。まだ用意できていなければ null。 */
  video(item: VideoItem, sourceMs: Ms): unknown
  createCanvas(width: number, height: number): CanvasLike
}
