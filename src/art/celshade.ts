/**
 * The drawing primitives an anime illustration is actually made of.
 *
 * Anime art is not a gradient renderer. A form is a flat base colour, one
 * hard-edged shadow shape, sometimes one hard-edged highlight, and a line on
 * the contour. Everything in `portrait.ts` and `creature.ts` is built from the
 * helpers here so that the whole illustration shades consistently — one light
 * direction, one shadow ratio, one line weight.
 */

// ---------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)];
}

export function rgba(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

export function mix(a: string, b: string, t: number): string {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  const c = (i: number) => Math.round(A[i] + (B[i] - A[i]) * t);
  return `rgb(${c(0)},${c(1)},${c(2)})`;
}

function toHex(n: number): string {
  return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
}

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  const mx = Math.max(rr, gg, bb);
  const mn = Math.min(rr, gg, bb);
  const l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h: number;
  if (mx === rr) h = ((gg - bb) / d + (gg < bb ? 6 : 0)) / 6;
  else if (mx === gg) h = ((bb - rr) / d + 2) / 6;
  else h = ((rr - gg) / d + 4) / 6;
  return [h, s, l];
}

export function hslToHex(h: number, s: number, l: number): string {
  const hh = ((h % 1) + 1) % 1;
  const ss = Math.max(0, Math.min(1, s));
  const ll = Math.max(0, Math.min(1, l));
  if (ss === 0) {
    const v = ll * 255;
    return `#${toHex(v)}${toHex(v)}${toHex(v)}`;
  }
  const q = ll < 0.5 ? ll * (1 + ss) : ll + ss - ll * ss;
  const p = 2 * ll - q;
  const f = (t: number): number => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  return `#${toHex(f(hh + 1 / 3) * 255)}${toHex(f(hh) * 255)}${toHex(f(hh - 1 / 3) * 255)}`;
}

/** Shifts a colour in HSL space, for deriving a ramp from one base tone. */
export function shift(hex: string, dh: number, ds = 0, dl = 0): string {
  const [r, g, b] = hexToRgb(hex);
  const [h, s, l] = rgbToHsl(r, g, b);
  return hslToHex(h + dh, s + ds, l + dl);
}

/**
 * The three tones a cel-shaded surface needs. Anime shadow is not "the same
 * colour, darker": it rotates toward the cool end and gains saturation, which
 * is what stops flat fills looking like grey paint.
 */
export interface Ramp {
  base: string;
  shade: string;
  light: string;
}

export function ramp(base: string, strength = 1): Ramp {
  return {
    base,
    shade: shift(base, -0.045 * strength, 0.1 * strength, -0.17 * strength),
    light: shift(base, 0.012 * strength, -0.05 * strength, 0.11 * strength),
  };
}

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export type Pt = [number, number];

/** A closed shape through `pts`, smoothed with quadratic midpoint joins. */
export function blob(ctx: CanvasRenderingContext2D, pts: Pt[], tension = 1): void {
  if (pts.length < 3) return;
  ctx.beginPath();
  const mid = (a: Pt, b: Pt): Pt => [
    a[0] + (b[0] - a[0]) * 0.5,
    a[1] + (b[1] - a[1]) * 0.5,
  ];
  const first = mid(pts[pts.length - 1], pts[0]);
  ctx.moveTo(first[0], first[1]);
  for (let i = 0; i < pts.length; i++) {
    const cur = pts[i];
    const next = pts[(i + 1) % pts.length];
    const m = mid(cur, next);
    if (tension >= 1) ctx.quadraticCurveTo(cur[0], cur[1], m[0], m[1]);
    else {
      const c: Pt = [cur[0] * tension + m[0] * (1 - tension), cur[1] * tension + m[1] * (1 - tension)];
      ctx.quadraticCurveTo(c[0], c[1], m[0], m[1]);
    }
  }
  ctx.closePath();
}

/** An open polyline with quadratic smoothing, for hair strands and folds. */
export function stroke(ctx: CanvasRenderingContext2D, pts: Pt[]): void {
  if (pts.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2;
    const my = (pts[i][1] + pts[i + 1][1]) / 2;
    ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
  }
  const last = pts[pts.length - 1];
  ctx.lineTo(last[0], last[1]);
}

/** A tapered sliver — the shape a lock of hair or a cloth fold actually is. */
export function sliver(
  ctx: CanvasRenderingContext2D,
  from: Pt,
  to: Pt,
  width: number,
  bend = 0,
): void {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const cx = (from[0] + to[0]) / 2 + nx * bend;
  const cy = (from[1] + to[1]) / 2 + ny * bend;
  ctx.beginPath();
  ctx.moveTo(from[0] + nx * width, from[1] + ny * width);
  ctx.quadraticCurveTo(cx + nx * width * 0.7, cy + ny * width * 0.7, to[0], to[1]);
  ctx.quadraticCurveTo(cx - nx * width * 0.7, cy - ny * width * 0.7, from[0] - nx * width, from[1] - ny * width);
  ctx.closePath();
}

// ---------------------------------------------------------------------------
// Cel shading
// ---------------------------------------------------------------------------

/**
 * Fills the current path as a cel-shaded form: flat base, then a hard-edged
 * shadow on the side away from the light, then a line on the contour.
 *
 * `paint` re-declares the path each time it is called, because clipping and
 * filling both consume it.
 */
export interface CelOptions {
  /** Light direction in radians; 0 is from the right, -PI/2 from above. */
  angle: number;
  /** How much of the form the shadow covers, 0..1. */
  coverage?: number;
  /** Line colour and weight; 0 weight draws no line. */
  line?: string;
  lineWidth?: number;
  /** Adds a hard rim of light along the lit contour. */
  rim?: string;
  rimWidth?: number;
  /** Softens the shadow edge slightly — used on skin, never on metal. */
  soft?: number;
}

export function cel(
  ctx: CanvasRenderingContext2D,
  path: (c: CanvasRenderingContext2D) => void,
  tones: Ramp,
  bounds: { x: number; y: number; w: number; h: number },
  opts: CelOptions,
): void {
  const { angle, coverage = 0.42 } = opts;

  ctx.save();
  path(ctx);
  ctx.fillStyle = tones.base;
  ctx.fill();

  // Shadow: a half-plane rotated away from the light, clipped to the form.
  ctx.save();
  path(ctx);
  ctx.clip();
  const cx = bounds.x + bounds.w / 2;
  const cy = bounds.y + bounds.h / 2;
  const r = Math.hypot(bounds.w, bounds.h);
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  // Slide the half-plane along the light axis so `coverage` of the form is dark.
  const offset = (0.5 - coverage) * r * 0.72;
  ctx.translate(cx - dx * offset, cy - dy * offset);
  ctx.rotate(angle);
  if (opts.soft) ctx.filter = `blur(${opts.soft}px)`;
  ctx.fillStyle = tones.shade;
  ctx.fillRect(-r, -r, r, r * 2);
  ctx.restore();

  if (opts.rim && opts.rimWidth) {
    ctx.save();
    path(ctx);
    ctx.clip();
    ctx.translate(-dx * opts.rimWidth * 1.9, -dy * opts.rimWidth * 1.9);
    ctx.lineWidth = opts.rimWidth * 2.6;
    ctx.strokeStyle = opts.rim;
    path(ctx);
    ctx.stroke();
    ctx.restore();
  }

  if (opts.line && opts.lineWidth) {
    path(ctx);
    ctx.lineWidth = opts.lineWidth;
    ctx.strokeStyle = opts.line;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }
  ctx.restore();
}

/** Fills the current path flat, with a line — for small parts that need no ramp. */
export function flat(
  ctx: CanvasRenderingContext2D,
  path: (c: CanvasRenderingContext2D) => void,
  fill: string,
  line?: string,
  lineWidth = 0,
): void {
  ctx.save();
  path(ctx);
  ctx.fillStyle = fill;
  ctx.fill();
  if (line && lineWidth > 0) {
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = line;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }
  ctx.restore();
}

/** Runs `paint` clipped to `path`, for decorating a form without spilling. */
export function within(
  ctx: CanvasRenderingContext2D,
  path: (c: CanvasRenderingContext2D) => void,
  paint: (c: CanvasRenderingContext2D) => void,
): void {
  ctx.save();
  path(ctx);
  ctx.clip();
  paint(ctx);
  ctx.restore();
}
