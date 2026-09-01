/**
 * Card-name rendering.
 *
 * Some official Shadowverse card images ship with the decorative name band but
 * without the name lettering baked in. This module is the one place that draws
 * a card name onto that band, so a name added here sits exactly where the
 * printed one would and is styled to match: centred in the band, engraved
 * serif caps, warm gold fill, dark outline and a soft drop shadow.
 *
 * It is deliberately independent of where the pixels come from. It works the
 * same over a procedurally generated illustration and over a supplied official
 * image, which is what keeps a supplied image and a generated one looking like
 * the same product.
 */

export interface NameBand {
  /** Band rectangle in destination-canvas pixels. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface NameStyle {
  /** Font family stack. Latin and Japanese names want different stacks. */
  family: string;
  weight: number | string;
  /** Upper bound; the renderer shrinks from here until the name fits. */
  maxSize: number;
  /** Never shrink below this — past it we wrap to two lines instead. */
  minSize: number;
  fill: string | { top: string; bottom: string };
  outline: string;
  /** Outline width as a fraction of the font size. */
  outlineRatio: number;
  shadow: string;
  shadowBlur: number;
  shadowOffsetY: number;
  /** Extra letter spacing as a fraction of the font size. */
  tracking: number;
  /** Fraction of the band width the text may occupy. */
  widthRatio: number;
  uppercase: boolean;
  /** Allow a second line when a single line would fall below `minSize`. */
  allowWrap: boolean;
}

/**
 * The house style. Tuned against the original game's plates: names are set in
 * an engraved serif, warm-gold, tightly fitted to the band with generous
 * outline so they stay legible over bright artwork.
 */
export const DEFAULT_NAME_STYLE: NameStyle = {
  family: '"Cinzel", "Noto Serif JP", Georgia, serif',
  weight: 700,
  maxSize: 40,
  minSize: 21,
  fill: { top: '#FFF6DE', bottom: '#E7C983' },
  outline: 'rgba(10, 8, 4, 0.92)',
  outlineRatio: 0.14,
  shadow: 'rgba(0, 0, 0, 0.75)',
  shadowBlur: 8,
  shadowOffsetY: 2,
  tracking: 0.03,
  widthRatio: 0.9,
  uppercase: false,
  allowWrap: true,
};

/**
 * Japanese names are set in a heavy serif with no tracking and no uppercase —
 * letterspacing kana the way Latin caps are spaced looks wrong immediately.
 */
export const JA_NAME_STYLE: NameStyle = {
  ...DEFAULT_NAME_STYLE,
  family: '"Noto Serif JP", serif',
  weight: 700,
  maxSize: 38,
  minSize: 19,
  tracking: 0,
  uppercase: false,
};

interface Fitted {
  lines: string[];
  size: number;
}

function fontString(style: NameStyle, size: number): string {
  return `${style.weight} ${size}px ${style.family}`;
}

/** Width of `text` at `size`, including the style's tracking. */
function measure(ctx: CanvasRenderingContext2D, text: string, style: NameStyle, size: number): number {
  ctx.font = fontString(style, size);
  const base = ctx.measureText(text).width;
  const extra = style.tracking * size * Math.max(0, text.length - 1);
  return base + extra;
}

/**
 * Splits a name across two lines at the most balanced word break. Returns null
 * when the name has no break point (a single long word).
 */
function splitTwoLines(text: string): [string, string] | null {
  // Prefer breaking at a comma, which is where long Shadowverse names name
  // their subject: "Albert, Levin Saber".
  const comma = text.indexOf(',');
  if (comma > 0 && comma < text.length - 1) {
    return [text.slice(0, comma + 1).trim(), text.slice(comma + 1).trim()];
  }
  const words = text.split(/\s+/);
  if (words.length < 2) return null;
  let best: [string, string] | null = null;
  let bestDelta = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' ');
    const b = words.slice(i).join(' ');
    const delta = Math.abs(a.length - b.length);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = [a, b];
    }
  }
  return best;
}

/** Japanese has no spaces, so a wrap point is simply the midpoint. */
function splitCjk(text: string): [string, string] | null {
  if (text.length < 4) return null;
  const mid = Math.ceil(text.length / 2);
  return [text.slice(0, mid), text.slice(mid)];
}

const CJK = /[　-ヿ㐀-䶿一-鿿豈-﫿]/;

export function isCjk(text: string): boolean {
  return CJK.test(text);
}

/**
 * Chooses the largest size at which the name fits the band, wrapping to two
 * lines only when a single line would have to shrink below `minSize`.
 */
export function fitName(
  ctx: CanvasRenderingContext2D,
  text: string,
  band: NameBand,
  style: NameStyle,
): Fitted {
  const maxW = band.w * style.widthRatio;
  const label = style.uppercase ? text.toUpperCase() : text;

  // Single line, shrinking from the top size.
  for (let size = style.maxSize; size >= style.minSize; size -= 0.5) {
    if (measure(ctx, label, style, size) <= maxW) return { lines: [label], size };
  }

  if (style.allowWrap) {
    const parts = isCjk(label) ? splitCjk(label) : splitTwoLines(label);
    if (parts) {
      // Two lines must also fit the band's height, so the ceiling drops.
      const twoLineMax = Math.min(style.maxSize, band.h * 0.46);
      for (let size = twoLineMax; size >= style.minSize * 0.72; size -= 0.5) {
        const w = Math.max(measure(ctx, parts[0], style, size), measure(ctx, parts[1], style, size));
        if (w <= maxW) return { lines: parts, size };
      }
    }
  }

  // Nothing fits: condense the single line to the smallest allowed size and let
  // the horizontal scale below squeeze it the rest of the way.
  return { lines: [label], size: style.minSize };
}

/** Draws one line with tracking applied, honouring the current transform. */
function drawTracked(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  y: number,
  style: NameStyle,
  size: number,
  stroke: boolean,
): void {
  const track = style.tracking * size;
  if (track === 0) {
    if (stroke) ctx.strokeText(text, cx, y);
    else ctx.fillText(text, cx, y);
    return;
  }
  const total = measure(ctx, text, style, size);
  let x = cx - total / 2;
  for (const ch of text) {
    const w = ctx.measureText(ch).width;
    if (stroke) ctx.strokeText(ch, x + w / 2, y);
    else ctx.fillText(ch, x + w / 2, y);
    x += w + track;
  }
}

export interface DrawNameOptions {
  style?: Partial<NameStyle>;
  /** Draws the band's own plate before the text. Off when the art has one. */
  drawPlate?: boolean;
  plateColor?: string;
  /** Debug aid: outlines the band rectangle. */
  debugBand?: boolean;
}

/**
 * Draws `name` into `band`. Safe to call over any artwork — it only paints
 * inside the band and restores the context it was given.
 */
export function drawCardName(
  ctx: CanvasRenderingContext2D,
  name: string,
  band: NameBand,
  opts: DrawNameOptions = {},
): void {
  if (!name) return;
  const base = isCjk(name) ? JA_NAME_STYLE : DEFAULT_NAME_STYLE;
  const style: NameStyle = { ...base, ...opts.style };

  ctx.save();

  if (opts.drawPlate) {
    drawNamePlate(ctx, band, opts.plateColor ?? 'rgba(8, 10, 16, 0.72)');
  }

  const { lines, size } = fitName(ctx, name, band, style);
  ctx.font = fontString(style, size);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const cx = band.x + band.w / 2;
  const lineHeight = size * 1.06;
  const totalH = lineHeight * lines.length;
  const startY = band.y + band.h / 2 - totalH / 2 + lineHeight / 2;

  // If even the minimum size overflows, condense horizontally rather than
  // letting the name run past the band. Real card frames do the same.
  const widest = Math.max(...lines.map((l) => measure(ctx, l, style, size)));
  const maxW = band.w * style.widthRatio;
  const squeeze = widest > maxW ? maxW / widest : 1;
  if (squeeze < 1) {
    ctx.translate(cx, 0);
    ctx.scale(squeeze, 1);
    ctx.translate(-cx, 0);
  }

  const fill =
    typeof style.fill === 'string'
      ? style.fill
      : (() => {
          const g = ctx.createLinearGradient(0, startY - size * 0.6, 0, startY + totalH);
          g.addColorStop(0, (style.fill as { top: string }).top);
          g.addColorStop(1, (style.fill as { bottom: string }).bottom);
          return g;
        })();

  lines.forEach((line, i) => {
    const y = startY + i * lineHeight;

    // Shadow first, on the outline pass only, so the fill stays crisp.
    ctx.save();
    ctx.shadowColor = style.shadow;
    ctx.shadowBlur = style.shadowBlur;
    ctx.shadowOffsetY = style.shadowOffsetY;
    ctx.lineWidth = size * style.outlineRatio;
    ctx.strokeStyle = style.outline;
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    drawTracked(ctx, line, cx, y, style, size, true);
    ctx.restore();

    ctx.fillStyle = fill;
    drawTracked(ctx, line, cx, y, style, size, false);

    // A hairline of warm light along the top edge sells the engraved look.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = '#FFF9E8';
    drawTracked(ctx, line, cx, y - size * 0.035, style, size, false);
    ctx.restore();
  });

  ctx.restore();

  if (opts.debugBand) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,0,255,0.8)';
    ctx.lineWidth = 2;
    ctx.strokeRect(band.x, band.y, band.w, band.h);
    ctx.restore();
  }
}

/**
 * The decorative plate a name sits on: a dark translucent lozenge with gold
 * hairlines, tapered at both ends. Used when the artwork does not supply one.
 */
export function drawNamePlate(ctx: CanvasRenderingContext2D, band: NameBand, color: string): void {
  const { x, y, w, h } = band;
  const taper = h * 0.55;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x + taper, y);
  ctx.lineTo(x + w - taper, y);
  ctx.lineTo(x + w, y + h / 2);
  ctx.lineTo(x + w - taper, y + h);
  ctx.lineTo(x + taper, y + h);
  ctx.lineTo(x, y + h / 2);
  ctx.closePath();

  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, 'rgba(0,0,0,0.15)');
  g.addColorStop(0.5, color);
  g.addColorStop(1, 'rgba(0,0,0,0.25)');
  ctx.fillStyle = g;
  ctx.fill();

  ctx.strokeStyle = 'rgba(216, 184, 101, 0.55)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Inner hairline, offset inwards, for the double-rule look of the original.
  ctx.strokeStyle = 'rgba(255, 240, 200, 0.16)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + taper + 3, y + 4);
  ctx.lineTo(x + w - taper - 3, y + 4);
  ctx.stroke();

  ctx.restore();
}
