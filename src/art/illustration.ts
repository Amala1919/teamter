/**
 * Procedural card illustration.
 *
 * Official Shadowverse artwork is not reachable from this environment (see
 * docs/ASSET_LICENSES.md), so every card gets a generated key-art panel.
 * Generation is deterministic per card: the same `seed` always paints the same
 * picture, so art never shifts between sessions.
 *
 * The panel is built the way key art is: a graded sky, a horizon, background
 * architecture, a rim-lit subject silhouette, foreground occlusion and
 * atmosphere. Only the *subject* is a real drawing: each card is matched by
 * name to a hand-drawn shape from the Game Icons collection (CC BY 3.0, see
 * `cardart.ts` and `ASSET_LICENSES.md`), which this file then lights, models
 * and rims. Everything around it is generated.
 *
 * If official art is later dropped into `public/assets/official/`,
 * `cardface.ts` prefers it and this becomes the fallback.
 */
import type { CardDef, ClassId } from '../engine/types';
import { CLASS_THEME, RARITY_THEME } from './theme';
import { fillSubject, subjectFor, type Subject } from './cardart';

// ---------------------------------------------------------------------------
// Seeded randomness
// ---------------------------------------------------------------------------

class Seeded {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0 || 1;
  }
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number): number {
    return a + this.next() * (b - a);
  }
  int(n: number): number {
    return Math.floor(this.next() * n);
  }
  pick<T>(arr: readonly T[]): T {
    return arr[this.int(arr.length)];
  }
  bool(p = 0.5): boolean {
    return this.next() < p;
  }
  /** Gaussian-ish, for values that should cluster around the middle. */
  around(mid: number, spread: number): number {
    return mid + (this.next() + this.next() - 1) * spread;
  }
}

// ---------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const v = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function rgba(color: string, a: number): string {
  const [r, g, b] = hexToRgb(color);
  return `rgba(${r},${g},${b},${a})`;
}

function mix(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  const f = (x: number, y: number) => Math.round(x + (y - x) * t);
  return rgbToHex(f(r1, r2), f(g1, g2), f(b1, b2));
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  h = ((h % 1) + 1) % 1;
  s = Math.max(0, Math.min(1, s));
  l = Math.max(0, Math.min(1, l));
  if (s === 0) {
    const v = Math.round(l * 255);
    return rgbToHex(v, v, v);
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => {
    t = ((t % 1) + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return rgbToHex(Math.round(f(h + 1 / 3) * 255), Math.round(f(h) * 255), Math.round(f(h - 1 / 3) * 255));
}

/** Rotates a colour's hue and nudges its saturation/lightness. */
function shift(hex: string, dh: number, ds = 0, dl = 0): string {
  const [h, s, l] = rgbToHsl(...hexToRgb(hex));
  return hslToHex(h + dh, s + ds, l + dl);
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

interface Scene {
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
  rng: Seeded;
  lightX: number;
  lightY: number;
  /** Subject-defining colour: rim light, glows, magic. */
  key: string;
  /** Deep shadow colour of the world. */
  deep: string;
  /** Brightest accent, near the light source. */
  accent: string;
  /** Sky gradient endpoints. */
  skyTop: string;
  skyBottom: string;
  /** Height of the horizon in 0..1 panel space. */
  horizon: number;
}

function glow(s: Scene, x: number, y: number, r: number, color: string, alpha: number): void {
  const { ctx } = s;
  if (r <= 0 || alpha <= 0) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, rgba(color, alpha));
  g.addColorStop(0.3, rgba(color, alpha * 0.5));
  g.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Ragged horizontal ridge: mountains, canopy, rooftops, dunes. */
function ridge(
  s: Scene,
  baseY: number,
  amp: number,
  color: string,
  opts: { rough?: number; detail?: number; alpha?: number; phase?: number } = {},
): void {
  const { ctx, w, h, rng } = s;
  const detail = opts.detail ?? 9;
  const rough = opts.rough ?? 0.5;
  const pts: [number, number][] = [];
  for (let i = 0; i <= detail; i++) {
    const x = (i / detail) * w;
    const jag = Math.pow(rng.next(), 1 - rough * 0.6);
    pts.push([x, baseY - jag * amp]);
  }
  ctx.save();
  ctx.globalAlpha = opts.alpha ?? 1;
  ctx.beginPath();
  ctx.moveTo(-2, h + 2);
  ctx.lineTo(pts[0][0] - 2, pts[0][1]);
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const mx = (x0 + x1) / 2;
    ctx.quadraticCurveTo(mx, y0 * (1 - rough) + Math.min(y0, y1) * rough, x1, y1);
  }
  ctx.lineTo(w + 2, h + 2);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

function rays(s: Scene, count: number, color: string, alpha: number): void {
  const { ctx, w, h, rng } = s;
  const ox = s.lightX * w;
  const oy = s.lightY * h;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < count; i++) {
    const a = rng.range(0, Math.PI * 2);
    const spread = rng.range(0.015, 0.07);
    const len = rng.range(0.8, 1.7) * Math.max(w, h);
    const g = ctx.createLinearGradient(ox, oy, ox + Math.cos(a) * len, oy + Math.sin(a) * len);
    g.addColorStop(0, rgba(color, alpha));
    g.addColorStop(0.4, rgba(color, alpha * 0.4));
    g.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.lineTo(ox + Math.cos(a - spread) * len, oy + Math.sin(a - spread) * len);
    ctx.lineTo(ox + Math.cos(a + spread) * len, oy + Math.sin(a + spread) * len);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function motes(s: Scene, count: number, color: string, size: number, alpha: number): void {
  const { ctx, w, h, rng } = s;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < count; i++) {
    const x = rng.next() * w;
    const y = rng.next() * h;
    const d = Math.hypot(x - s.lightX * w, y - s.lightY * h) / Math.max(w, h);
    const r = size * rng.range(0.4, 1.8) * (1.3 - d * 0.6);
    const a = alpha * Math.max(0, 1.2 - d) * rng.range(0.35, 1);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r * 3);
    g.addColorStop(0, rgba(color, a));
    g.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function scumble(s: Scene, count: number, color: string, alpha: number, mode: GlobalCompositeOperation): void {
  const { ctx, w, h, rng } = s;
  ctx.save();
  ctx.globalCompositeOperation = mode;
  ctx.lineCap = 'round';
  for (let i = 0; i < count; i++) {
    const x = rng.next() * w;
    const y = rng.next() * h;
    const len = rng.range(w * 0.05, w * 0.34);
    const a = rng.range(-0.6, 0.6);
    ctx.globalAlpha = alpha * rng.range(0.25, 1);
    ctx.lineWidth = rng.range(2, 12);
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + Math.cos(a) * len * 0.5, y + Math.sin(a) * len * 0.35, x + Math.cos(a) * len, y + Math.sin(a) * len);
    ctx.stroke();
  }
  ctx.restore();
}

function grain(s: Scene, strength: number): void {
  const { ctx, w, h, rng } = s;
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rng.next() - 0.5) * strength;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
}

function vignette(s: Scene, strength: number): void {
  const { ctx, w, h } = s;
  const g = ctx.createRadialGradient(w * 0.5, h * 0.44, Math.min(w, h) * 0.22, w * 0.5, h * 0.5, Math.max(w, h) * 0.8);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, `rgba(0,0,0,${strength})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

// ---------------------------------------------------------------------------
// Background architecture
// ---------------------------------------------------------------------------

type Structure = 'pillars' | 'arch' | 'spires' | 'trees' | 'stones' | 'banners' | 'none';

const CLASS_STRUCTURES: Record<ClassId, Structure[]> = {
  forest: ['trees', 'trees', 'stones', 'arch'],
  sword: ['banners', 'pillars', 'spires', 'arch'],
  rune: ['pillars', 'arch', 'spires', 'none'],
  dragon: ['spires', 'stones', 'none', 'arch'],
  shadow: ['stones', 'stones', 'arch', 'pillars'],
  blood: ['spires', 'arch', 'pillars', 'stones'],
  haven: ['pillars', 'arch', 'arch', 'banners'],
  neutral: ['pillars', 'trees', 'stones', 'spires', 'none', 'banners'],
};

function drawStructure(s: Scene, kind: Structure, y: number, scale: number, color: string): void {
  const { ctx, w, rng } = s;
  if (kind === 'none') return;
  ctx.save();
  ctx.fillStyle = color;

  switch (kind) {
    case 'pillars': {
      const n = 2 + rng.int(3);
      for (let i = 0; i < n; i++) {
        const x = rng.range(w * 0.05, w * 0.95);
        const pw = w * rng.range(0.05, 0.1) * scale;
        const ph = s.h * rng.range(0.3, 0.55) * scale;
        // Fluted column with a capital and a base.
        ctx.fillRect(x - pw * 0.62, y - ph - pw * 0.28, pw * 1.24, pw * 0.28);
        ctx.fillRect(x - pw / 2, y - ph, pw, ph);
        ctx.fillRect(x - pw * 0.7, y - pw * 0.22, pw * 1.4, pw * 0.22);
        // Break the top off some of them.
        if (rng.bool(0.3)) {
          ctx.save();
          ctx.globalCompositeOperation = 'destination-out';
          ctx.beginPath();
          ctx.moveTo(x - pw, y - ph - pw * 0.4);
          ctx.lineTo(x + pw, y - ph - pw * 0.4);
          ctx.lineTo(x + pw, y - ph + pw * rng.range(0.3, 1.2));
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
      }
      break;
    }
    case 'arch': {
      const cx = w * rng.range(0.3, 0.7);
      const aw = w * rng.range(0.4, 0.72) * scale;
      const ah = s.h * rng.range(0.4, 0.62) * scale;
      const t = aw * 0.11;
      ctx.beginPath();
      ctx.moveTo(cx - aw / 2 - t, y);
      ctx.lineTo(cx - aw / 2 - t, y - ah * 0.55);
      ctx.quadraticCurveTo(cx, y - ah * 1.5, cx + aw / 2 + t, y - ah * 0.55);
      ctx.lineTo(cx + aw / 2 + t, y);
      ctx.lineTo(cx + aw / 2, y);
      ctx.lineTo(cx + aw / 2, y - ah * 0.55);
      ctx.quadraticCurveTo(cx, y - ah * 1.28, cx - aw / 2, y - ah * 0.55);
      ctx.lineTo(cx - aw / 2, y);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'spires': {
      const n = 3 + rng.int(4);
      for (let i = 0; i < n; i++) {
        const x = rng.range(0, w);
        const sw = w * rng.range(0.03, 0.08) * scale;
        const sh = s.h * rng.range(0.28, 0.62) * scale;
        ctx.beginPath();
        ctx.moveTo(x, y - sh);
        ctx.lineTo(x + sw, y - sh * 0.6);
        ctx.lineTo(x + sw * 0.8, y);
        ctx.lineTo(x - sw * 0.8, y);
        ctx.lineTo(x - sw, y - sh * 0.6);
        ctx.closePath();
        ctx.fill();
      }
      break;
    }
    case 'trees': {
      const n = 4 + rng.int(5);
      for (let i = 0; i < n; i++) {
        const x = rng.range(-w * 0.05, w * 1.05);
        const th = s.h * rng.range(0.25, 0.55) * scale;
        const tw = th * rng.range(0.1, 0.16);
        ctx.fillRect(x - tw * 0.16, y - th * 0.55, tw * 0.32, th * 0.55);
        // Canopy as a stack of shrinking lobes.
        const lobes = 3 + rng.int(3);
        for (let k = 0; k < lobes; k++) {
          const t = k / lobes;
          ctx.beginPath();
          ctx.ellipse(
            x + rng.range(-tw * 0.4, tw * 0.4),
            y - th * (0.55 + t * 0.42),
            tw * (1.5 - t) * rng.range(0.8, 1.15),
            th * 0.14 * (1.4 - t),
            0,
            0,
            Math.PI * 2,
          );
          ctx.fill();
        }
      }
      break;
    }
    case 'stones': {
      const n = 3 + rng.int(5);
      for (let i = 0; i < n; i++) {
        const x = rng.range(0, w);
        const sw = w * rng.range(0.035, 0.075) * scale;
        const sh = s.h * rng.range(0.1, 0.28) * scale;
        const lean = rng.range(-0.18, 0.18);
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(lean);
        ctx.beginPath();
        ctx.moveTo(-sw / 2, 0);
        ctx.lineTo(-sw / 2, -sh * 0.78);
        ctx.quadraticCurveTo(0, -sh * 1.1, sw / 2, -sh * 0.78);
        ctx.lineTo(sw / 2, 0);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      break;
    }
    case 'banners': {
      const n = 2 + rng.int(3);
      for (let i = 0; i < n; i++) {
        const x = rng.range(w * 0.08, w * 0.92);
        const bh = s.h * rng.range(0.35, 0.6) * scale;
        const bw = bh * rng.range(0.16, 0.24);
        ctx.fillRect(x - bw * 0.05, y - bh, bw * 0.1, bh);
        ctx.beginPath();
        ctx.moveTo(x - bw / 2, y - bh * 0.95);
        ctx.lineTo(x + bw / 2, y - bh * 0.95);
        ctx.lineTo(x + bw / 2, y - bh * 0.35);
        ctx.lineTo(x, y - bh * 0.5);
        ctx.lineTo(x - bw / 2, y - bh * 0.35);
        ctx.closePath();
        ctx.fill();
      }
      break;
    }
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// The subject silhouette
// ---------------------------------------------------------------------------

/**
 * A card's subject: the Game Icons shape chosen for it by name (see
 * `cardart.ts`), plus the small per-card variation the illustration rolls so a
 * shared icon does not produce two identical panels.
 *
 * The shape arrives as a flat silhouette, which is what the rest of this file
 * wants — it does the lighting, the interior modelling and the rim itself.
 */
interface Figure {
  subject: Subject | null;
  flip: boolean;
  /** Slight off-vertical lean, so a row of cards is not a row of statues. */
  tilt: number;
  /** Extra scale on top of the framing radius. */
  scale: number;
}

function rollFigure(rng: Seeded, card: CardDef): Figure {
  return {
    subject: subjectFor(card.id),
    flip: rng.bool(0.4),
    tilt: rng.range(-0.055, 0.055),
    scale: rng.range(0.94, 1.1),
  };
}

function drawFigure(s: Scene, fig: Figure, cx: number, cy: number, r: number, color: string): void {
  const { ctx } = s;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(fig.tilt);
  ctx.translate(-cx, -cy);
  if (fig.subject) {
    fillSubject(ctx, fig.subject, cx, cy, r * fig.scale, fig.flip, color);
  } else {
    // No icon mapped: a plain mass, so the lighting pipeline still has a form
    // to work on rather than an empty panel.
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(cx, cy, r * 0.6, r * 0.95, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Class palettes — several variants each, so a class is a family, not a colour
// ---------------------------------------------------------------------------

interface Palette {
  skyTop: string;
  skyBottom: string;
  rough: number;
  detail: number;
}

const CLASS_PALETTES: Record<ClassId, Palette[]> = {
  forest: [
    { skyTop: '#0C2A1E', skyBottom: '#4E8F3C', rough: 0.35, detail: 14 },
    { skyTop: '#1A2C10', skyBottom: '#93A83A', rough: 0.3, detail: 16 },
    { skyTop: '#08201F', skyBottom: '#2E7F6E', rough: 0.45, detail: 12 },
  ],
  sword: [
    { skyTop: '#2A2415', skyBottom: '#B8942E', rough: 0.75, detail: 8 },
    { skyTop: '#171B2C', skyBottom: '#8A7CA8', rough: 0.6, detail: 10 },
    { skyTop: '#33210E', skyBottom: '#D08A34', rough: 0.7, detail: 9 },
  ],
  rune: [
    { skyTop: '#0F1638', skyBottom: '#4A3EA8', rough: 0.55, detail: 10 },
    { skyTop: '#141032', skyBottom: '#7A3EA0', rough: 0.5, detail: 11 },
    { skyTop: '#071A30', skyBottom: '#2E6FA8', rough: 0.6, detail: 9 },
  ],
  dragon: [
    { skyTop: '#3A1408', skyBottom: '#C0561A', rough: 0.85, detail: 7 },
    { skyTop: '#231008', skyBottom: '#8A3010', rough: 0.9, detail: 6 },
    { skyTop: '#2A1A06', skyBottom: '#D89A2A', rough: 0.8, detail: 8 },
  ],
  shadow: [
    { skyTop: '#0E0A1C', skyBottom: '#4A2A70', rough: 0.6, detail: 9 },
    { skyTop: '#0A1018', skyBottom: '#2E4A5A', rough: 0.65, detail: 10 },
    { skyTop: '#140A18', skyBottom: '#6A3A6A', rough: 0.55, detail: 11 },
  ],
  blood: [
    { skyTop: '#22060C', skyBottom: '#8A1424', rough: 0.7, detail: 8 },
    { skyTop: '#180A14', skyBottom: '#5A1848', rough: 0.65, detail: 9 },
    { skyTop: '#2A0A0A', skyBottom: '#B03A2A', rough: 0.75, detail: 7 },
  ],
  haven: [
    { skyTop: '#1A2038', skyBottom: '#A8AEDA', rough: 0.3, detail: 11 },
    { skyTop: '#241E2E', skyBottom: '#E0CFA0', rough: 0.35, detail: 12 },
    { skyTop: '#0E1C2E', skyBottom: '#7ABEDA', rough: 0.28, detail: 13 },
  ],
  neutral: [
    { skyTop: '#101828', skyBottom: '#4A6A8A', rough: 0.5, detail: 10 },
    { skyTop: '#1E1A14', skyBottom: '#9A7A4A', rough: 0.65, detail: 9 },
    { skyTop: '#0A1A1A', skyBottom: '#3A8A7A', rough: 0.4, detail: 12 },
    { skyTop: '#1A1024', skyBottom: '#6A4A8A', rough: 0.55, detail: 11 },
    { skyTop: '#221016', skyBottom: '#A05A5A', rough: 0.7, detail: 8 },
    { skyTop: '#141C20', skyBottom: '#8A9AA8', rough: 0.45, detail: 13 },
  ],
};

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

type Framing = 'portrait' | 'vista' | 'close' | 'arcane';

export interface IllustrationOptions {
  /** Draws the evolved variant: hotter light, red rim, more embers. */
  evolved?: boolean;
}

export function drawIllustration(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  card: CardDef,
  opts: IllustrationOptions = {},
): void {
  const rng = new Seeded((card.artSeed ?? 1) ^ (opts.evolved ? 0x5bf03635 : 0));
  const theme = CLASS_THEME[card.cardClass];
  const rarity = RARITY_THEME[card.rarity];

  // Each card takes a palette from its class family and then shifts the hue a
  // little, so two cards of the same class never look like reprints.
  const pal = rng.pick(CLASS_PALETTES[card.cardClass]);
  const hueJitter = rng.range(-0.045, 0.045);
  const evolved = !!opts.evolved;

  const skyTop = evolved
    ? mix(shift(pal.skyTop, hueJitter), '#3A0A04', 0.55)
    : shift(pal.skyTop, hueJitter, rng.range(-0.06, 0.08), rng.range(-0.03, 0.03));
  const skyBottom = evolved
    ? mix(shift(pal.skyBottom, hueJitter), '#C8440E', 0.5)
    : shift(pal.skyBottom, hueJitter, rng.range(-0.08, 0.06), rng.range(-0.05, 0.05));

  const s: Scene = {
    ctx,
    w,
    h,
    rng,
    lightX: rng.range(0.2, 0.8),
    lightY: rng.range(0.12, 0.36),
    key: evolved ? mix(theme.primary, '#FF6A3C', 0.5) : shift(theme.primary, hueJitter),
    deep: shift(theme.deep, hueJitter),
    accent: evolved ? '#FFD08A' : shift(theme.accent, hueJitter),
    skyTop,
    skyBottom,
    horizon: rng.range(0.52, 0.72),
  };

  const framing: Framing =
    card.type === 'spell'
      ? 'arcane'
      : card.type === 'amulet'
        ? rng.pick(['vista', 'vista', 'portrait', 'arcane'] as const)
        : rng.pick(['portrait', 'portrait', 'close', 'vista'] as const);

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.clip();

  // --- sky ----------------------------------------------------------------
  const sky = ctx.createLinearGradient(0, 0, 0, h * (s.horizon + 0.15));
  sky.addColorStop(0, skyTop);
  sky.addColorStop(0.62, mix(skyTop, skyBottom, 0.75));
  sky.addColorStop(1, skyBottom);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  // Ground plane below the horizon, darker and warmer.
  const ground = ctx.createLinearGradient(0, h * s.horizon, 0, h);
  ground.addColorStop(0, mix(skyBottom, s.deep, 0.55));
  ground.addColorStop(1, mix(s.deep, '#000000', 0.55));
  ctx.fillStyle = ground;
  ctx.fillRect(0, h * s.horizon, w, h * (1 - s.horizon) + 2);

  // --- key light ----------------------------------------------------------
  const lx = s.lightX * w;
  const ly = s.lightY * h;
  glow(s, lx, ly, Math.max(w, h) * 0.7, s.accent, 0.45);
  glow(s, lx, ly, Math.max(w, h) * 0.18, '#FFFFFF', 0.6);
  rays(s, 6 + rng.int(7), s.accent, 0.05);

  // --- distant ridges -----------------------------------------------------
  const ridgeLayers = 2 + rng.int(2);
  for (let i = 0; i < ridgeLayers; i++) {
    const t = ridgeLayers === 1 ? 0 : i / (ridgeLayers - 1);
    const y = h * (s.horizon - 0.04 + t * 0.12);
    const col = mix(mix(s.deep, skyBottom, 0.6 - t * 0.5), '#000000', t * 0.4);
    ridge(s, y, h * (0.26 - t * 0.08), col, { rough: pal.rough, detail: pal.detail + i * 3, alpha: 0.92 });
  }

  // --- background architecture -------------------------------------------
  if (framing !== 'close') {
    const structure = rng.pick(CLASS_STRUCTURES[card.cardClass]);
    drawStructure(s, structure, h * (s.horizon + 0.05), framing === 'vista' ? 1.15 : 0.85, mix(s.deep, '#000000', 0.45));
  }

  // --- subject ------------------------------------------------------------
  const cx = w * (framing === 'vista' ? rng.range(0.3, 0.7) : rng.around(0.5, 0.07));
  const baseR = Math.min(w, h);
  const rByFraming = { portrait: 0.27, close: 0.32, vista: 0.21, arcane: 0.3 } as const;
  const r = baseR * rByFraming[framing] * (1 + Math.min(card.cost, 10) * 0.01);
  // Seat the subject across the horizon rather than floating in the sky, then
  // clamp it into the part of the art panel the frame actually leaves visible:
  // the name band covers the bottom, so nothing may hang below 0.76.
  const half = r * 1.12;
  const wanted = h * (framing === 'close' ? 0.47 : framing === 'vista' ? s.horizon - 0.1 : s.horizon - 0.16);
  const lo = h * 0.05 + half;
  const hi = h * 0.76 - half;
  const cy = hi > lo ? Math.min(hi, Math.max(lo, wanted)) : (lo + hi) / 2;

  glow(s, cx, cy, r * 2.4, s.key, 0.4);

  if (framing === 'arcane') {
    drawArcaneSigil(s, cx, cy, r, card, evolved);
  } else {
    const fig = rollFigure(rng, card);

    // Contact shadow on the ground plane.
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = '#000000';
    ctx.filter = 'blur(8px)';
    ctx.beginPath();
    ctx.ellipse(cx, cy + r * 1.05, r * 0.9, r * 0.15, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Silhouette mass, kept very dark so the shape reads against the sky.
    ctx.save();
    ctx.shadowColor = rgba('#000000', 0.75);
    ctx.shadowBlur = r * 0.22;
    drawFigure(s, fig, cx, cy, r, mix('#03050A', s.deep, 0.22));
    ctx.restore();

    // Interior modelling: a soft vertical gradient inside the silhouette,
    // clipped to the figure, so it is a form rather than a cut-out.
    withFigureMask(s, fig, cx, cy, r, (mctx) => {
      // Vertical falloff: lit from above, sinking into the ground plane.
      const g = mctx.createLinearGradient(0, cy - r * 1.15, 0, cy + r * 1.15);
      g.addColorStop(0, rgba(s.key, 0.46));
      g.addColorStop(0.5, rgba(s.deep, 0.2));
      g.addColorStop(1, 'rgba(0,0,0,0)');
      mctx.fillStyle = g;
      mctx.fillRect(0, 0, s.w, s.h);

      // A soft bounce of the key light on the side facing it, so the mass
      // turns rather than reading as a sticker.
      const b = mctx.createRadialGradient(lx, ly, 0, lx, ly, Math.max(s.w, s.h) * 0.8);
      b.addColorStop(0, rgba(s.accent, 0.3));
      b.addColorStop(1, 'rgba(0,0,0,0)');
      mctx.globalCompositeOperation = 'lighter';
      mctx.fillStyle = b;
      mctx.fillRect(0, 0, s.w, s.h);
    });

    // Rim light: the figure drawn offset toward the key light, with the
    // un-offset figure punched out. What survives is a crescent along the lit
    // edge, which is what a rim light actually is.
    drawRim(s, fig, cx, cy, r, lx, ly, s.accent, 0.62);
    drawRim(s, fig, cx, cy, r, lx, ly, '#FFFFFF', 0.26);
    drawRim(s, fig, cx, cy, r, w - lx, h - ly, s.key, 0.4);

    if (card.type === 'amulet') {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = rgba(s.key, 0.45);
      ctx.lineWidth = Math.max(1.5, r * 0.035);
      ctx.beginPath();
      ctx.ellipse(cx, cy + r * 1.2, r * 1.15, r * 0.3, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      glow(s, cx, cy + r * 1.2, r * 1.0, s.key, 0.3);
    }
  }

  // --- foreground occlusion ----------------------------------------------
  ridge(s, h * 1.06, h * 0.2, mix('#03050A', s.deep, 0.2), { rough: 0.85, detail: 5, alpha: 0.96 });

  // --- atmosphere ---------------------------------------------------------
  motes(s, 30 + rng.int(30), s.accent, baseR * 0.006, 0.5);
  if (evolved) motes(s, 46, '#FF8A3D', baseR * 0.008, 0.6);
  scumble(s, 24, s.accent, 0.05, 'overlay');
  scumble(s, 16, '#000000', 0.07, 'multiply');

  if (card.rarity === 'legendary' || card.rarity === 'gold') {
    glow(s, w * (1 - s.lightX), h * 0.75, Math.max(w, h) * 0.34, rarity.gem, 0.16);
  }

  vignette(s, 0.55);
  grain(s, 11);

  ctx.restore();
}

/**
 * Runs `paint` with the figure's silhouette as a clipping mask, on a scratch
 * layer that is then composited over the scene.
 */
function withFigureMask(
  s: Scene,
  fig: Figure,
  cx: number,
  cy: number,
  r: number,
  paint: (ctx: CanvasRenderingContext2D) => void,
): void {
  const layer = scratch(s.w, s.h);
  const lc = layer.getContext('2d');
  if (!lc) return;
  drawFigure({ ...s, ctx: lc }, fig, cx, cy, r, '#FFFFFF');
  lc.globalCompositeOperation = 'source-in';
  paint(lc);
  s.ctx.drawImage(layer, 0, 0);
}

/**
 * A crescent of light along the edge of the figure facing (lx, ly).
 * Built by subtracting the figure from a copy of itself nudged toward the
 * light, which keeps the highlight tight instead of washing out the mass.
 */
function drawRim(
  s: Scene,
  fig: Figure,
  cx: number,
  cy: number,
  r: number,
  lx: number,
  ly: number,
  color: string,
  alpha: number,
): void {
  const layer = scratch(s.w, s.h);
  const lc = layer.getContext('2d');
  if (!lc) return;

  const dx = lx - cx;
  const dy = ly - cy;
  const len = Math.hypot(dx, dy) || 1;
  const push = Math.max(1.5, r * 0.028);
  const ox = (dx / len) * push;
  const oy = (dy / len) * push;

  lc.save();
  lc.translate(ox, oy);
  drawFigure({ ...s, ctx: lc }, fig, cx, cy, r, color);
  lc.restore();

  lc.globalCompositeOperation = 'destination-out';
  drawFigure({ ...s, ctx: lc }, fig, cx, cy, r, '#000000');

  s.ctx.save();
  s.ctx.globalCompositeOperation = 'lighter';
  s.ctx.globalAlpha = alpha;
  s.ctx.filter = 'blur(0.8px)';
  s.ctx.drawImage(layer, 0, 0);
  s.ctx.restore();
}

/** Reusable offscreen canvases, so a card render does not allocate per pass. */
const scratchPool = new Map<string, HTMLCanvasElement>();

function scratch(w: number, h: number): HTMLCanvasElement {
  const key = `${w}x${h}`;
  let c = scratchPool.get(key);
  if (!c) {
    c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    scratchPool.set(key, c);
  }
  const ctx = c.getContext('2d');
  if (ctx) ctx.clearRect(0, 0, w, h);
  return c;
}

/**
 * Spells and some amulets are drawn as pure light rather than a body. Three
 * shapes share the same lighting so a screen of spells does not read as one
 * repeated ring: an inscribed sigil, a vertical pillar of light, and a
 * shockwave of concentric arcs.
 */
function drawArcaneSigil(s: Scene, cx: number, cy: number, r: number, card: CardDef, evolved: boolean): void {
  const { ctx, rng } = s;
  const color = evolved ? '#FFB070' : s.accent;
  const shape = rng.pick(['sigil', 'pillar', 'shockwave', 'sigil'] as const);

  if (shape === 'pillar') {
    drawPillar(s, cx, cy, r, color, card);
    return;
  }
  if (shape === 'shockwave') {
    drawShockwave(s, cx, cy, r, color, card);
    return;
  }

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.translate(cx, cy);

  const rings = 2 + rng.int(3);
  for (let i = 0; i < rings; i++) {
    const rr = r * (0.42 + i * rng.range(0.2, 0.34));
    ctx.strokeStyle = rgba(color, 0.55 - i * 0.1);
    ctx.lineWidth = Math.max(1.4, r * rng.range(0.012, 0.035));
    ctx.beginPath();
    ctx.arc(0, 0, rr, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Inscribed polygon(s).
  const shapes = 1 + rng.int(2);
  for (let k = 0; k < shapes; k++) {
    const n = 3 + rng.int(5);
    const rot = rng.range(0, Math.PI);
    const rr = r * rng.range(0.5, 0.95);
    ctx.strokeStyle = rgba(color, 0.5);
    ctx.lineWidth = Math.max(1.2, r * 0.018);
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rot;
      const x = Math.cos(a) * rr;
      const y = Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
  }

  // Radiating glyph ticks.
  const ticks = 8 + rng.int(16);
  ctx.strokeStyle = rgba(color, 0.42);
  ctx.lineWidth = Math.max(1.2, r * 0.02);
  for (let i = 0; i < ticks; i++) {
    const a = (i / ticks) * Math.PI * 2;
    const r0 = r * rng.range(0.98, 1.06);
    const r1 = r0 + r * rng.range(0.05, 0.18);
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
    ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
    ctx.stroke();
  }
  ctx.restore();

  glow(s, cx, cy, r * 1.6, color, 0.55);
  glow(s, cx, cy, r * 0.5, '#FFFFFF', 0.5);

  // A burst of energy shards for higher-cost spells.
  const shards = 5 + Math.min(card.cost, 10);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < shards; i++) {
    const a = rng.range(0, Math.PI * 2);
    const d0 = r * rng.range(0.9, 1.4);
    const len = r * rng.range(0.15, 0.5);
    ctx.strokeStyle = rgba(color, rng.range(0.2, 0.6));
    ctx.lineWidth = Math.max(1, r * rng.range(0.01, 0.03));
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * d0, cy + Math.sin(a) * d0);
    ctx.lineTo(cx + Math.cos(a) * (d0 + len), cy + Math.sin(a) * (d0 + len));
    ctx.stroke();
  }
  ctx.restore();
}

/** A column of light striking the ground, with a rune ring at its base. */
function drawPillar(s: Scene, cx: number, cy: number, r: number, color: string, card: CardDef): void {
  const { ctx, rng, h } = s;
  const groundY = cy + r * 1.15;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  // The shaft, widening slightly toward the top.
  const shaft = ctx.createLinearGradient(cx, 0, cx, groundY);
  shaft.addColorStop(0, rgba(color, 0));
  shaft.addColorStop(0.35, rgba(color, 0.4));
  shaft.addColorStop(1, rgba(color, 0.85));
  ctx.fillStyle = shaft;
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.5, 0);
  ctx.lineTo(cx + r * 0.5, 0);
  ctx.lineTo(cx + r * 0.3, groundY);
  ctx.lineTo(cx - r * 0.3, groundY);
  ctx.closePath();
  ctx.fill();

  // Inner core.
  ctx.fillStyle = rgba('#FFFFFF', 0.5);
  ctx.fillRect(cx - r * 0.08, 0, r * 0.16, groundY);

  // Rune ring at the base.
  ctx.strokeStyle = rgba(color, 0.75);
  ctx.lineWidth = Math.max(1.5, r * 0.03);
  for (const k of [1, 0.72]) {
    ctx.beginPath();
    ctx.ellipse(cx, groundY, r * k, r * k * 0.28, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  const ticks = 10 + rng.int(10);
  for (let i = 0; i < ticks; i++) {
    const a = (i / ticks) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r * 0.75, groundY + Math.sin(a) * r * 0.21);
    ctx.lineTo(cx + Math.cos(a) * r * 1.02, groundY + Math.sin(a) * r * 0.29);
    ctx.stroke();
  }

  // Motes rising along the shaft.
  for (let i = 0; i < 22 + card.cost * 2; i++) {
    const y = rng.range(0, groundY);
    const x = cx + rng.range(-r * 0.45, r * 0.45);
    const rr = r * rng.range(0.015, 0.05);
    ctx.fillStyle = rgba('#FFFFFF', rng.range(0.15, 0.6));
    ctx.beginPath();
    ctx.arc(x, y, rr, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  glow(s, cx, groundY, r * 2, color, 0.6);
  glow(s, cx, h * 0.1, r * 1.2, color, 0.35);
}

/** Concentric arcs blasting outward from a bright core. */
function drawShockwave(s: Scene, cx: number, cy: number, r: number, color: string, card: CardDef): void {
  const { ctx, rng } = s;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  const rings = 4 + rng.int(4);
  for (let i = 0; i < rings; i++) {
    const t = i / rings;
    const rr = r * (0.5 + t * 1.5);
    ctx.strokeStyle = rgba(color, 0.55 * (1 - t));
    ctx.lineWidth = Math.max(1.5, r * 0.06 * (1 - t * 0.6));
    const start = rng.range(0, Math.PI * 2);
    const sweep = rng.range(Math.PI * 0.7, Math.PI * 1.9);
    ctx.beginPath();
    ctx.ellipse(cx, cy, rr, rr * rng.range(0.7, 1), 0, start, start + sweep);
    ctx.stroke();
  }

  // Radiating shards, more of them on an expensive spell.
  const shards = 10 + Math.min(card.cost, 10) * 2;
  for (let i = 0; i < shards; i++) {
    const a = rng.range(0, Math.PI * 2);
    const d0 = r * rng.range(0.35, 0.9);
    const len = r * rng.range(0.3, 1.1);
    const grad = ctx.createLinearGradient(
      cx + Math.cos(a) * d0,
      cy + Math.sin(a) * d0,
      cx + Math.cos(a) * (d0 + len),
      cy + Math.sin(a) * (d0 + len),
    );
    grad.addColorStop(0, rgba(color, 0.7));
    grad.addColorStop(1, rgba(color, 0));
    ctx.strokeStyle = grad;
    ctx.lineWidth = Math.max(1, r * rng.range(0.015, 0.05));
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * d0, cy + Math.sin(a) * d0);
    ctx.lineTo(cx + Math.cos(a) * (d0 + len), cy + Math.sin(a) * (d0 + len));
    ctx.stroke();
  }
  ctx.restore();

  glow(s, cx, cy, r * 1.8, color, 0.6);
  glow(s, cx, cy, r * 0.45, '#FFFFFF', 0.75);
}

/** Renders an illustration to a standalone canvas — used by tools and tests. */
export function renderIllustration(
  w: number,
  h: number,
  card: CardDef,
  opts: IllustrationOptions = {},
): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable');
  drawIllustration(ctx, w, h, card, opts);
  return c;
}
