/**
 * 図形・装飾の描き方。プレビューと書き出しは compositor からこれを呼ぶ。
 *
 * 形はすべて点の並び(折れ線)にしてから描く。曲線も細かく区切って点にする。
 * こうすると「線を描いていく」(途中まで描く)・手書き風のゆらぎ・吹き出しのしっぽを、どの形にも同じやり方で付けられる。
 * 動く装飾(集中線・流線・紙吹雪・キラキラ)は、時刻と renderSeed とアイテムIDから決定論的に描く(compositor.ts の決まり)。
 */

import { hashString, mulberry32 } from '../portrait/animation'
import type { Ms, ShapeItem, ShapeKind } from '../project/types'
import { ease } from './easing'
import type { Ctx2D } from './types'

type Point = [number, number]

interface Polyline {
  points: Point[]
  closed: boolean
}

/** 形の中身。fills は塗る輪郭、lines は太さ(thickness)で描く線。 */
interface Geometry {
  fills: Polyline[]
  lines: Polyline[]
  /** 描いていくとき、線をたどる(trace)か、左から右へ見せていく(wipe)か。 */
  reveal: 'trace' | 'wipe'
}

/** 線で描く形(塗らずに太さのある線を引く)。 */
export const LINE_KINDS: readonly ShapeKind[] = ['line', 'wave', 'check', 'cross', 'handCircle', 'corners', 'curveArrow']

/** 決まった描き方をする動く装飾。 */
const SPECIAL_KINDS: readonly ShapeKind[] = ['focusLines', 'speedLines', 'spotlight', 'confetti', 'sparkles']

/** 形ごとの既定(置いたときの大きさ・色など)。 */
export const SHAPE_DEFAULTS: Record<ShapeKind, { width: number; height: number; label: string }> = {
  rect: { width: 480, height: 270, label: '四角' },
  roundRect: { width: 480, height: 270, label: '角丸の四角' },
  ellipse: { width: 360, height: 360, label: '円' },
  triangle: { width: 320, height: 280, label: '三角' },
  diamond: { width: 300, height: 300, label: 'ひし形' },
  star: { width: 300, height: 300, label: '星' },
  burst: { width: 520, height: 400, label: '爆発' },
  heart: { width: 300, height: 280, label: 'ハート' },
  arrow: { width: 420, height: 160, label: '矢印' },
  curveArrow: { width: 460, height: 240, label: '曲がった矢印' },
  line: { width: 520, height: 40, label: '線' },
  wave: { width: 520, height: 60, label: '波線' },
  check: { width: 260, height: 220, label: 'チェック' },
  cross: { width: 260, height: 260, label: 'バツ' },
  handCircle: { width: 420, height: 300, label: '手書きの丸' },
  corners: { width: 560, height: 360, label: 'カギ枠' },
  bubble: { width: 560, height: 260, label: '吹き出し' },
  shout: { width: 600, height: 340, label: '叫び吹き出し' },
  cloud: { width: 560, height: 300, label: 'もくもく吹き出し' },
  band: { width: 900, height: 120, label: '帯' },
  focusLines: { width: 900, height: 520, label: '集中線' },
  speedLines: { width: 1920, height: 1080, label: '流線' },
  spotlight: { width: 520, height: 380, label: 'スポットライト' },
  confetti: { width: 1920, height: 1080, label: '紙吹雪' },
  sparkles: { width: 600, height: 400, label: 'キラキラ' }
}

export function isLineKind(kind: ShapeKind): boolean {
  return LINE_KINDS.includes(kind)
}

/** 図形の基準の大きさ(拡大率 1 のとき)。以前の図形(大きさを持たない)は画面いっぱい。 */
export function shapeSize(item: Pick<ShapeItem, 'width' | 'height'>, canvas: { width: number; height: number }): { width: number; height: number } {
  return { width: item.width ?? canvas.width, height: item.height ?? canvas.height }
}

/** 線の形の既定の太さ。 */
function defaultThickness(item: ShapeItem, width: number, height: number): number {
  if (item.thickness !== undefined) return item.thickness
  if (item.shape === 'line' || item.shape === 'wave') return Math.max(4, Math.min(height, 24))
  if (item.shape === 'curveArrow') return Math.max(6, Math.min(width, height) * 0.14)
  return Math.max(6, Math.min(width, height) * 0.07)
}

// ---------------------------------------------------------------- 形(点の並び)

function ellipsePoints(rx: number, ry: number, steps = 96, start = -Math.PI / 2, turn = 1): Point[] {
  const points: Point[] = []
  for (let i = 0; i < steps; i++) {
    const angle = start + (Math.PI * 2 * turn * i) / steps
    points.push([Math.cos(angle) * rx, Math.sin(angle) * ry])
  }
  return points
}

function roundRectPoints(width: number, height: number, radius: number): Point[] {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2))
  const x0 = -width / 2
  const y0 = -height / 2
  const x1 = width / 2
  const y1 = height / 2
  if (r <= 0.5) return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
  const corner = (cx: number, cy: number, from: number): Point[] =>
    Array.from({ length: 9 }, (_, i) => {
      const angle = from + (Math.PI / 2) * (i / 8)
      return [cx + Math.cos(angle) * r, cy + Math.sin(angle) * r] as Point
    })
  return [...corner(x1 - r, y0 + r, -Math.PI / 2), ...corner(x1 - r, y1 - r, 0), ...corner(x0 + r, y1 - r, Math.PI / 2), ...corner(x0 + r, y0 + r, Math.PI)]
}

function starPoints(width: number, height: number, count: number, inner: number, jitter: number, seed: number): Point[] {
  const random = mulberry32(seed)
  const points: Point[] = []
  const n = Math.max(3, Math.round(count))
  for (let i = 0; i < n * 2; i++) {
    const angle = -Math.PI / 2 + (Math.PI * i) / n
    const outer = i % 2 === 0
    const wobble = jitter > 0 ? 1 - jitter + random() * jitter * 2 : 1
    const ratio = (outer ? 1 : inner) * wobble
    points.push([Math.cos(angle) * (width / 2) * Math.min(1, ratio), Math.sin(angle) * (height / 2) * Math.min(1, ratio)])
  }
  return points
}

function heartPoints(width: number, height: number): Point[] {
  const points: Point[] = []
  // ハートの式。x: 16sin³t、y: 13cos t − 5cos 2t − 2cos 3t − cos 4t(上が正なので反転する)。
  for (let i = 0; i < 120; i++) {
    const t = (Math.PI * 2 * i) / 120
    const x = 16 * Math.pow(Math.sin(t), 3)
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)
    points.push([(x / 17) * (width / 2), (-(y + 2.5) / 15.5) * (height / 2)])
  }
  return points
}

/** 吹き出しの本体に、しっぽを差し込む。本体は中心を囲む閉じた形。 */
function withTail(body: Point[], tail: Point, baseWidth: number): Point[] {
  if (body.length < 6) return body
  const angle = Math.atan2(tail[1], tail[0])
  let nearest = 0
  let best = Number.POSITIVE_INFINITY
  body.forEach(([x, y], index) => {
    const difference = Math.abs(Math.atan2(Math.sin(Math.atan2(y, x) - angle), Math.cos(Math.atan2(y, x) - angle)))
    if (difference < best) {
      best = difference
      nearest = index
    }
  })
  // しっぽの付け根の幅だけ、本体の点を両側へたどる。
  const half = baseWidth / 2
  const walk = (direction: 1 | -1): number => {
    let distance = 0
    let index = nearest
    for (let step = 0; step < body.length / 3; step++) {
      const next = (index + direction + body.length) % body.length
      const [ax, ay] = body[index]!
      const [bx, by] = body[next]!
      distance += Math.hypot(bx - ax, by - ay)
      index = next
      if (distance >= half) break
    }
    return index
  }
  const before = walk(-1)
  const after = walk(1)
  const result: Point[] = []
  for (let index = after; index !== before; index = (index + 1) % body.length) result.push(body[index]!)
  result.push(body[before]!, tail)
  return result
}

function cloudPoints(width: number, height: number, bumps: number): Point[] {
  const points: Point[] = []
  const rx = width / 2
  const ry = height / 2
  for (let i = 0; i < bumps; i++) {
    const a0 = -Math.PI / 2 + (Math.PI * 2 * i) / bumps
    const a1 = -Math.PI / 2 + (Math.PI * 2 * (i + 1)) / bumps
    // 隣の点との間を外へふくらむ弧にする。
    for (let s = 0; s < 12; s++) {
      const t = s / 12
      const angle = a0 + (a1 - a0) * t
      const bulge = 1 + 0.16 * Math.sin(Math.PI * t)
      points.push([Math.cos(angle) * rx * 0.86 * bulge, Math.sin(angle) * ry * 0.86 * bulge])
    }
  }
  return points
}

function arrowPoints(width: number, height: number, headSize: number): Point[] {
  const x0 = -width / 2
  const x1 = width / 2
  const shaft = height * 0.42
  const head = Math.min(width * 0.55, height * 0.95 * headSize)
  return [
    [x0, -shaft / 2],
    [x1 - head, -shaft / 2],
    [x1 - head, -height / 2],
    [x1, 0],
    [x1 - head, height / 2],
    [x1 - head, shaft / 2],
    [x0, shaft / 2]
  ]
}

/** 曲がった矢印の軸(二次曲線)と、先の向き。 */
function curveArrowGeometry(width: number, height: number, bend: number, thickness: number, headSize: number): Geometry {
  const head = Math.max(thickness * 3.4 * headSize, 16)
  const start: Point = [-width / 2, height / 2 - thickness]
  const end: Point = [width / 2, height / 2 - thickness]
  const control: Point = [0, height / 2 - thickness - height * 1.6 * bend]
  const curve: Point[] = []
  for (let i = 0; i <= 48; i++) {
    const t = i / 48
    const mt = 1 - t
    curve.push([mt * mt * start[0] + 2 * mt * t * control[0] + t * t * end[0], mt * mt * start[1] + 2 * mt * t * control[1] + t * t * end[1]])
  }
  // 先の向きは曲線の終わりの接線。軸は頭の付け根で止める。
  const [tx, ty] = [end[0] - control[0], end[1] - control[1]]
  const length = Math.max(1, Math.hypot(tx, ty))
  const ux = tx / length
  const uy = ty / length
  const base: Point = [end[0] - ux * head, end[1] - uy * head]
  const trimmed = curve.filter(([x, y]) => (x - base[0]) * ux + (y - base[1]) * uy < 0)
  trimmed.push(base)
  const side = head * 0.75
  const tip: Polyline = {
    points: [
      [end[0], end[1]],
      [base[0] - uy * side, base[1] + ux * side],
      [base[0] + uy * side, base[1] - ux * side]
    ],
    closed: true
  }
  return { fills: [tip], lines: [{ points: trimmed, closed: false }], reveal: 'trace' }
}

function geometryOf(item: ShapeItem, width: number, height: number, seed: number): Geometry {
  const x0 = -width / 2
  const y0 = -height / 2
  const x1 = width / 2
  const y1 = height / 2
  const fill = (points: Point[], reveal: Geometry['reveal'] = 'trace'): Geometry => ({ fills: [{ points, closed: true }], lines: [], reveal })
  const line = (polylines: Polyline[], reveal: Geometry['reveal'] = 'trace'): Geometry => ({ fills: [], lines: polylines, reveal })
  const tail = (): Point => (item.tail ? [item.tail.x, item.tail.y] : [-width * 0.22, height * 0.85])
  switch (item.shape) {
    case 'rect':
      return fill([[x0, y0], [x1, y0], [x1, y1], [x0, y1]])
    case 'roundRect':
      return fill(roundRectPoints(width, height, item.cornerRadius ?? Math.min(width, height) * 0.18))
    case 'ellipse':
      return fill(ellipsePoints(width / 2, height / 2))
    case 'triangle':
      return fill([[0, y0], [x1, y1], [x0, y1]])
    case 'diamond':
      return fill([[0, y0], [x1, 0], [0, y1], [x0, 0]])
    case 'star':
      return fill(starPoints(width, height, item.points ?? 5, item.innerRatio ?? 0.45, 0, 0))
    case 'burst':
      return fill(starPoints(width, height, item.points ?? 14, item.innerRatio ?? 0.7, 0.12, seed))
    case 'heart':
      return fill(heartPoints(width, height))
    case 'arrow':
      return fill(arrowPoints(width, height, item.headSize ?? 1), 'wipe')
    case 'band': {
      const slant = Math.min(height * 0.45, width * 0.2)
      return fill([[x0 + slant, y0], [x1, y0], [x1 - slant, y1], [x0, y1]], 'wipe')
    }
    case 'bubble': {
      const body = roundRectPoints(width, height, item.cornerRadius ?? Math.min(width, height) * 0.45)
      return fill(withTail(resample(body, true, 6), tail(), Math.min(width, height) * 0.32))
    }
    case 'shout': {
      const body = starPoints(width, height, item.points ?? 18, item.innerRatio ?? 0.82, 0.08, seed)
      return fill(withTail(body, tail(), Math.min(width, height) * 0.3))
    }
    case 'cloud': {
      const body = cloudPoints(width, height, item.points ?? 9)
      const [tx, ty] = tail()
      // しっぽの代わりに小さな丸を2つ並べる。
      const bubble = (t: number, r: number): Polyline => ({
        points: ellipsePoints(r, r, 32).map(([x, y]) => [x + tx * t, y + ty * t] as Point),
        closed: true
      })
      const radius = Math.min(width, height) * 0.07
      return { fills: [{ points: body, closed: true }, bubble(0.82, radius), bubble(1, radius * 0.6)], lines: [], reveal: 'trace' }
    }
    case 'line':
      return line([{ points: [[x0, 0], [x1, 0]], closed: false }], 'wipe')
    case 'wave': {
      const points: Point[] = []
      for (let i = 0; i <= 80; i++) {
        const t = i / 80
        points.push([x0 + width * t, Math.sin(t * Math.PI * 2 * 2.5) * (height / 2) * 0.7])
      }
      return line([{ points, closed: false }], 'wipe')
    }
    case 'check':
      return line([{ points: [[x0 + width * 0.08, height * 0.02], [x0 + width * 0.38, y1 - height * 0.12], [x1 - width * 0.06, y0 + height * 0.1]], closed: false }])
    case 'cross': {
      const inset = 0.12
      return line([
        { points: [[x0 + width * inset, y0 + height * inset], [x1 - width * inset, y1 - height * inset]], closed: false },
        { points: [[x1 - width * inset, y0 + height * inset], [x0 + width * inset, y1 - height * inset]], closed: false }
      ])
    }
    case 'handCircle': {
      // 1周より少し多く回し、終わりを少しずらす(手で丸を付けたように)。
      const points: Point[] = []
      const steps = 120
      for (let i = 0; i <= steps; i++) {
        const t = i / steps
        const angle = -Math.PI * 0.35 + Math.PI * 2 * 1.1 * t
        const spread = 1 - 0.07 * t
        points.push([Math.cos(angle) * (width / 2) * spread, Math.sin(angle) * (height / 2) * (spread + 0.04 * Math.sin(t * Math.PI))])
      }
      return line([{ points, closed: false }])
    }
    case 'corners': {
      const arm = Math.min(width, height) * 0.24
      return line([
        { points: [[x0, y0 + arm], [x0, y0], [x0 + arm, y0]], closed: false },
        { points: [[x1 - arm, y0], [x1, y0], [x1, y0 + arm]], closed: false },
        { points: [[x1, y1 - arm], [x1, y1], [x1 - arm, y1]], closed: false },
        { points: [[x0 + arm, y1], [x0, y1], [x0, y1 - arm]], closed: false }
      ])
    }
    case 'curveArrow':
      return curveArrowGeometry(width, height, item.bend ?? 0.45, defaultThickness(item, width, height), item.headSize ?? 1)
    case 'focusLines':
    case 'speedLines':
    case 'spotlight':
    case 'confetti':
    case 'sparkles':
      return { fills: [], lines: [], reveal: 'trace' }
  }
}

// ---------------------------------------------------------------- 点の加工

/** だいたい spacing の間隔で点を打ち直す(手書き風のゆらぎを、形の大きさによらず同じ細かさで付けるため)。 */
function resample(points: Point[], closed: boolean, spacing: number): Point[] {
  if (points.length < 2) return points
  const source = closed ? [...points, points[0]!] : points
  const result: Point[] = [source[0]!]
  for (let i = 1; i < source.length; i++) {
    const [ax, ay] = source[i - 1]!
    const [bx, by] = source[i]!
    const length = Math.hypot(bx - ax, by - ay)
    const parts = Math.max(1, Math.ceil(length / spacing))
    for (let s = 1; s <= parts; s++) result.push([ax + ((bx - ax) * s) / parts, ay + ((by - ay) * s) / parts])
  }
  if (closed) result.pop()
  return result
}

/** 手書き風に、点をなめらかにゆらす。step を変えるとゆらぎ方が変わる(ゆらゆら動かすとき)。 */
function roughen(polyline: Polyline, amount: number, key: string, step: number): Polyline {
  if (amount <= 0) return polyline
  const random = mulberry32(hashString(`${key}:${step}`))
  const phases = [random() * 10, random() * 10, random() * 10, random() * 10]
  const points = resample(polyline.points, polyline.closed, 10).map(([x, y], index) => {
    const dx = Math.sin(index * 0.19 + phases[0]!) * 0.6 + Math.sin(index * 0.053 + phases[1]!) * 0.4
    const dy = Math.sin(index * 0.17 + phases[2]!) * 0.6 + Math.sin(index * 0.047 + phases[3]!) * 0.4
    return [x + dx * amount, y + dy * amount] as Point
  })
  return { points, closed: polyline.closed }
}

function pathLength(polyline: Polyline): number {
  const { points } = polyline
  let length = 0
  for (let i = 1; i < points.length; i++) length += Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1])
  if (polyline.closed && points.length > 1) length += Math.hypot(points[0]![0] - points.at(-1)![0], points[0]![1] - points.at(-1)![1])
  return length
}

/** 折れ線のはじめから length だけの部分。 */
function partial(polyline: Polyline, length: number): Point[] {
  const points = polyline.closed && polyline.points.length > 0 ? [...polyline.points, polyline.points[0]!] : polyline.points
  if (points.length === 0) return []
  const result: Point[] = [points[0]!]
  let remaining = length
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1]!
    const [bx, by] = points[i]!
    const segment = Math.hypot(bx - ax, by - ay)
    if (segment >= remaining) {
      const t = segment > 0 ? remaining / segment : 0
      result.push([ax + (bx - ax) * t, ay + (by - ay) * t])
      return result
    }
    result.push([bx, by])
    remaining -= segment
  }
  return result
}

function tracePath(context: Ctx2D, points: readonly Point[], closed: boolean): void {
  if (points.length === 0) return
  context.moveTo(points[0]![0], points[0]![1])
  for (let i = 1; i < points.length; i++) context.lineTo(points[i]![0], points[i]![1])
  if (closed) context.closePath()
}

// ---------------------------------------------------------------- 描く

export interface ShapeDrawContext {
  /** アイテム内の相対時刻。 */
  relMs: Ms
  seed: number
  canvas: { width: number; height: number }
}

/** 塗りの色(グラデーションがあればその塗り)。 */
function paint(context: Ctx2D, item: ShapeItem, width: number, height: number): unknown {
  const gradient = item.gradient
  if (!gradient) return item.fill
  if (gradient.radial) {
    const radial = context.createRadialGradient(0, 0, 0, 0, 0, Math.max(width, height) / 2)
    radial.addColorStop(0, item.fill)
    radial.addColorStop(1, gradient.color)
    return radial
  }
  const angle = (gradient.angle * Math.PI) / 180
  const reach = (Math.abs(Math.cos(angle)) * width + Math.abs(Math.sin(angle)) * height) / 2
  const linear = context.createLinearGradient(-Math.cos(angle) * reach, -Math.sin(angle) * reach, Math.cos(angle) * reach, Math.sin(angle) * reach)
  linear.addColorStop(0, item.fill)
  linear.addColorStop(1, gradient.color)
  return linear
}

function dashOf(item: ShapeItem, widthPx: number): number[] {
  if (item.dash === 'dash') return [widthPx * 3, widthPx * 2]
  if (item.dash === 'dot') return [0.01, widthPx * 2]
  return []
}

/**
 * 図形を、中心を原点にして描く(変形とエフェクトは呼ぶ側で掛けておく)。
 * 描く順: 影 → 外側の縁 → 縁取り → 本体。縁は本体の下に太く描くので、本体の外側にだけ見える。
 */
export function drawShape(context: Ctx2D, item: ShapeItem, draw: ShapeDrawContext): void {
  const { width, height } = shapeSize(item, draw.canvas)
  if (width <= 0 || height <= 0) return
  if (SPECIAL_KINDS.includes(item.shape)) {
    drawSpecial(context, item, width, height, draw)
    return
  }
  const key = `${draw.seed}:${item.id}`
  const geometry = geometryOf(item, width, height, hashString(key))
  const roughness = item.roughness ?? (item.shape === 'handCircle' ? 0.35 : 0)
  const amount = roughness * (Math.min(width, height) * 0.035 + 2)
  const step = item.wiggle ? Math.floor(draw.relMs / 110) : 0
  const fills = geometry.fills.map((polyline, index) => roughen(polyline, amount, `${key}:f${index}`, step))
  const lines = geometry.lines.map((polyline, index) => roughen(polyline, amount, `${key}:l${index}`, step))

  const progress = item.drawMs && item.drawMs > 0 ? ease('easeInOutCubic', draw.relMs / item.drawMs) : 1
  const thickness = defaultThickness(item, width, height)
  const fillOpacity = item.fillOpacity ?? 1
  const filled = fillOpacity > 0
  const stroke = item.stroke && item.stroke.widthPx > 0 ? item.stroke : null
  const outer = item.outerStroke && item.outerStroke.widthPx > 0 ? item.outerStroke : null

  context.save()
  context.lineJoin = 'round'
  context.lineCap = 'round'
  // 左から右へ見せていく(矢印が伸びる・帯が出る)。
  if (progress < 1 && geometry.reveal === 'wipe') {
    const margin = (stroke?.widthPx ?? 0) + (outer?.widthPx ?? 0) + thickness + 40
    context.beginPath()
    context.rect(-width / 2 - margin, -height / 2 - margin, (width + margin * 2) * progress, height + margin * 2)
    context.clip()
  }
  const trace = progress < 1 && geometry.reveal === 'trace'
  const totalLength = trace ? [...fills, ...lines].reduce((sum, polyline) => sum + pathLength(polyline), 0) : 0
  /** 描いていく途中なら、全体の長さのうち今見えている分だけ、順に線をたどる。 */
  const visible = (polylines: Polyline[], offset: number): { points: Point[]; closed: boolean }[] => {
    if (!trace) return polylines
    let start = offset
    return polylines.map((polyline) => {
      const length = pathLength(polyline)
      const shown = Math.max(0, Math.min(length, totalLength * progress - start))
      start += length
      return { points: shown >= length ? polyline.points : partial(polyline, shown), closed: polyline.closed && shown >= length }
    })
  }
  const fillOutline = visible(fills, 0)
  const lineOutline = visible(lines, fills.reduce((sum, polyline) => sum + pathLength(polyline), 0))

  let shadowPending = item.shadow ?? null
  const applyShadow = (): void => {
    if (!shadowPending) return
    context.shadowColor = shadowPending.color
    context.shadowOffsetX = shadowPending.offsetX
    context.shadowOffsetY = shadowPending.offsetY
    context.shadowBlur = shadowPending.blurPx
    shadowPending = null
  }
  const clearShadow = (): void => {
    context.shadowColor = 'transparent'
    context.shadowBlur = 0
    context.shadowOffsetX = 0
    context.shadowOffsetY = 0
  }
  /** 輪郭と線を、色と太さを変えて描く(縁の層)。 */
  const strokeAll = (color: unknown, outlineWidth: number, lineWidth: number, dash: number[]): void => {
    context.strokeStyle = color
    context.setLineDash(dash)
    if (outlineWidth > 0 && fillOutline.length > 0) {
      context.lineWidth = outlineWidth
      context.beginPath()
      for (const polyline of fillOutline) tracePath(context, polyline.points, polyline.closed)
      context.stroke()
    }
    if (lineWidth > 0 && lineOutline.length > 0) {
      context.lineWidth = lineWidth
      context.beginPath()
      for (const polyline of lineOutline) tracePath(context, polyline.points, polyline.closed)
      context.stroke()
    }
    context.setLineDash([])
  }

  // 塗る形の縁は、塗るなら本体の下に倍の太さで(外側だけ見える)、塗らないなら線の真ん中で描く。
  const edge = (widthPx: number): number => (filled ? widthPx * 2 : widthPx)
  const strokeWidth = stroke?.widthPx ?? 0
  const outerWidth = outer?.widthPx ?? 0
  if (outer) {
    applyShadow()
    strokeAll(outer.color, edge(strokeWidth + outerWidth), thickness + (strokeWidth + outerWidth) * 2, [])
    clearShadow()
  }
  if (stroke) {
    applyShadow()
    strokeAll(stroke.color, filled ? strokeWidth * 2 : strokeWidth, thickness + strokeWidth * 2, filled ? [] : dashOf(item, strokeWidth))
    clearShadow()
  }
  const color = paint(context, item, width, height)
  // 本体の線(線の形)。塗りの濃さは線にも掛ける(マーカーのように透かせる)。
  if (lineOutline.length > 0) {
    applyShadow()
    context.save()
    context.globalAlpha *= fillOpacity
    strokeAll(color, 0, thickness, dashOf(item, thickness))
    context.restore()
    clearShadow()
  }
  // 本体の塗り。描いていく途中は、線が半分ほど描けたところから塗りを出す。
  if (filled && fills.length > 0) {
    const fillAlpha = trace ? Math.max(0, Math.min(1, (progress - 0.4) / 0.6)) : 1
    if (fillAlpha > 0) {
      applyShadow()
      context.save()
      context.globalAlpha *= fillOpacity * fillAlpha
      context.fillStyle = color
      context.beginPath()
      for (const polyline of fills) tracePath(context, polyline.points, true)
      context.fill()
      context.restore()
      clearShadow()
    }
  }
  context.restore()
}

// ---------------------------------------------------------------- 動く装飾

function drawSpecial(context: Ctx2D, item: ShapeItem, width: number, height: number, draw: ShapeDrawContext): void {
  const density = Math.min(3, Math.max(0.2, item.density ?? 1))
  const speed = Math.max(0, item.speed ?? 1)
  const time = draw.relMs * speed
  const key = `${draw.seed}:${item.id}`
  const opacity = item.fillOpacity ?? (item.shape === 'spotlight' ? 0.7 : 1)
  context.save()
  context.globalAlpha *= opacity
  if (item.shadow) {
    context.shadowColor = item.shadow.color
    context.shadowBlur = item.shadow.blurPx
    context.shadowOffsetX = item.shadow.offsetX
    context.shadowOffsetY = item.shadow.offsetY
  }
  switch (item.shape) {
    case 'focusLines':
      drawFocusLines(context, item, width, height, density, Math.floor(time / 90), key)
      break
    case 'speedLines':
      drawSpeedLines(context, item, width, height, density, time, key)
      break
    case 'spotlight':
      drawSpotlight(context, item, width, height)
      break
    case 'confetti':
      drawConfetti(context, item, width, height, density, time, key)
      break
    case 'sparkles':
      drawSparkles(context, item, width, height, density, time, key)
      break
    default:
      break
  }
  context.restore()
}

/** 集中線。枠の内側(楕円)を空けて、外から中心へ向かう細いくさびを並べる。少しずつ形を変えてちらつかせる。 */
function drawFocusLines(context: Ctx2D, item: ShapeItem, width: number, height: number, density: number, step: number, key: string): void {
  const random = mulberry32(hashString(`${key}:focus:${step}`))
  const count = Math.round(110 * density)
  const reach = 4000
  context.fillStyle = item.fill
  context.beginPath()
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * (i + random() * 0.8)) / count
    const inner = 1 + random() * 0.35
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    const startX = cos * (width / 2) * inner
    const startY = sin * (height / 2) * inner
    const spread = ((Math.PI * 2) / count) * (0.15 + random() * 0.45)
    context.moveTo(startX, startY)
    context.lineTo(Math.cos(angle - spread / 2) * reach, Math.sin(angle - spread / 2) * reach)
    context.lineTo(Math.cos(angle + spread / 2) * reach, Math.sin(angle + spread / 2) * reach)
    context.closePath()
  }
  context.fill()
}

/** 流線(スピード感)。枠の中を横に流れる細い線。 */
function drawSpeedLines(context: Ctx2D, item: ShapeItem, width: number, height: number, density: number, time: number, key: string): void {
  const random = mulberry32(hashString(`${key}:speed`))
  const count = Math.round(46 * density)
  context.fillStyle = item.fill
  context.beginPath()
  for (let i = 0; i < count; i++) {
    const y = -height / 2 + random() * height
    const length = width * (0.12 + random() * 0.35)
    const thick = 2 + random() * 6
    const velocity = 1.6 + random() * 2.4
    const offset = random()
    // 右から左へ流れ、端まで行ったら右から出直す。
    const travel = width + length
    const x = width / 2 - (((offset * travel + (time / 1000) * velocity * width) % travel) + travel) % travel
    context.moveTo(x, y)
    context.lineTo(x + length, y - thick / 2)
    context.lineTo(x + length, y + thick / 2)
    context.closePath()
  }
  context.fill()
}

/** スポットライト。枠の楕円の外を暗くする(縁はぼかす)。 */
function drawSpotlight(context: Ctx2D, item: ShapeItem, width: number, height: number): void {
  const rx = width / 2
  const ratio = height / Math.max(1, width)
  const feather = Math.min(0.9, Math.max(0.02, item.innerRatio ?? 0.25))
  context.save()
  context.scale(1, ratio)
  const gradient = context.createRadialGradient(0, 0, rx * (1 - feather), 0, 0, rx)
  gradient.addColorStop(0, 'rgba(0,0,0,0)')
  gradient.addColorStop(1, item.fill)
  context.fillStyle = gradient
  const reach = 8000
  context.fillRect(-reach, -reach / ratio, reach * 2, (reach * 2) / ratio)
  context.restore()
}

const CONFETTI_COLORS = ['#ffd43b', '#ff6b6b', '#4dabf7', '#51cf66', '#ffffff', '#cc5de8', '#ff922b']

/** 紙吹雪。上から舞い落ちる色とりどりの紙。 */
function drawConfetti(context: Ctx2D, item: ShapeItem, width: number, height: number, density: number, time: number, key: string): void {
  const random = mulberry32(hashString(`${key}:confetti`))
  const count = Math.round(90 * density)
  const seconds = time / 1000
  for (let i = 0; i < count; i++) {
    const x0 = -width / 2 + random() * width
    const fall = 0.18 + random() * 0.22
    const start = random()
    const sway = 20 + random() * 60
    const swayRate = 1 + random() * 2.5
    const spin = (random() - 0.5) * 12
    const flip = 3 + random() * 6
    const size = 18 + random() * 18
    const color = i % 3 === 0 ? item.fill : CONFETTI_COLORS[Math.floor(random() * CONFETTI_COLORS.length)]!
    // 上の外から下の外まで落ち、また上から降る。
    const span = height * 1.3
    const y = ((((start + seconds * fall) * span) % span) + span) % span - height / 2 - height * 0.15
    const x = x0 + Math.sin(seconds * swayRate + i) * sway
    context.save()
    context.translate(x, y)
    context.rotate(seconds * spin + i)
    context.scale(1, Math.cos(seconds * flip + i))
    context.fillStyle = color
    context.fillRect(-size / 2, -size * 0.3, size, size * 0.6)
    context.restore()
  }
}

/** キラキラ。枠の中で光る小さな星が、点いたり消えたりする。 */
function drawSparkles(context: Ctx2D, item: ShapeItem, width: number, height: number, density: number, time: number, key: string): void {
  const random = mulberry32(hashString(`${key}:sparkle`))
  const count = Math.round(16 * density)
  const seconds = time / 1000
  context.fillStyle = item.fill
  for (let i = 0; i < count; i++) {
    const x = -width / 2 + random() * width
    const y = -height / 2 + random() * height
    const size = 26 + random() * 44
    const rate = 0.8 + random() * 1.4
    const phase = random()
    const level = Math.max(0, Math.sin((seconds * rate + phase) * Math.PI * 2))
    if (level <= 0.02) continue
    const radius = size * level
    context.save()
    context.translate(x, y)
    context.rotate(seconds * 0.8 + i)
    context.beginPath()
    // 4つの角のきらめき(細い星)。
    for (let p = 0; p < 8; p++) {
      const angle = (Math.PI * p) / 4
      const r = p % 2 === 0 ? radius : radius * 0.18
      const px = Math.cos(angle) * r
      const py = Math.sin(angle) * r
      if (p === 0) context.moveTo(px, py)
      else context.lineTo(px, py)
    }
    context.closePath()
    context.fill()
    context.restore()
  }
}
