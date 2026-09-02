/**
 * Card face composition.
 *
 * Draws a complete card — frame, art window, name band, cost orb, stat plates,
 * rarity gem and rules text — onto a 2D canvas that the Three.js layer uploads
 * as a texture. Everything here is resolution-independent: pass a bigger
 * `scale` for the focused/detail view and the same code produces a sharper
 * card rather than an upscaled one.
 */
import type { CardDef } from '../engine/types';
import { KEYWORD_LABEL, KEYWORD_LABEL_JA } from '../engine/types';
import { drawIllustration } from './illustration';
import { onSuppliedArt, suppliedArtFor } from './suppliedart';
import { drawCardName, type NameBand } from './cardname';
import { LANG } from '../i18n';
import { CARD, CLASS_THEME, FONT, RARITY_THEME, UI } from './theme';

export interface CardFaceOptions {
  evolved?: boolean;
  /** Multiplier over the base 512x716 layout. */
  scale?: number;
  /** Premium (animated) cards get a foil sheen baked into the face. */
  premium?: boolean;
  /** Renders the Japanese name and rules text. */
  lang?: 'en' | 'ja';
  /** Optional pre-loaded official illustration to use instead of generated art. */
  officialArt?: CanvasImageSource;
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

/**
 * A brushed-metal gradient running across the frame. Two bright bands rather
 * than one make it read as metal instead of plastic.
 */
function metalGradient(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  light: string,
  dark: string,
): CanvasGradient {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  g.addColorStop(0, dark);
  g.addColorStop(0.16, light);
  g.addColorStop(0.3, dark);
  g.addColorStop(0.52, light);
  g.addColorStop(0.68, dark);
  g.addColorStop(0.86, light);
  g.addColorStop(1, dark);
  return g;
}

function hexToRgba(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const v = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h, 16);
  return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a})`;
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

/**
 * The cost orb. A faceted blue crystal in the original; here a beveled disc
 * with an inner highlight and a numeral cut into it.
 */
function drawCostOrb(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, cost: number, s: number): void {
  ctx.save();

  ctx.shadowColor = 'rgba(0,0,0,0.65)';
  ctx.shadowBlur = 10 * s;
  ctx.shadowOffsetY = 3 * s;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = '#0A1424';
  ctx.fill();
  ctx.shadowColor = 'transparent';

  // Faceted body.
  const g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r);
  g.addColorStop(0, '#BFE4FF');
  g.addColorStop(0.35, UI.cost);
  g.addColorStop(0.78, '#1E4E8C');
  g.addColorStop(1, UI.costDeep);
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.93, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();

  // Facet lines.
  ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  ctx.lineWidth = 1 * s;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.4;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a) * r * 0.93, cy + Math.sin(a) * r * 0.93);
    ctx.stroke();
  }

  // Metal bezel.
  ctx.lineWidth = 4 * s;
  ctx.strokeStyle = metalGradient(ctx, cx - r, cy - r, cx + r, cy + r, UI.goldBright, UI.goldDeep);
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.95, 0, Math.PI * 2);
  ctx.stroke();

  // Specular.
  ctx.beginPath();
  ctx.ellipse(cx - r * 0.28, cy - r * 0.42, r * 0.32, r * 0.18, -0.5, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.fill();

  ctx.font = `700 ${r * 1.18}px ${FONT.numeral}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = r * 0.16;
  ctx.strokeStyle = 'rgba(4,10,22,0.9)';
  ctx.lineJoin = 'round';
  ctx.strokeText(String(cost), cx, cy + r * 0.04);
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText(String(cost), cx, cy + r * 0.04);

  ctx.restore();
}

/**
 * Attack and defense plates. They differ in silhouette as well as colour so
 * the two numbers stay distinguishable without relying on red/green.
 */
function drawStatPlate(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  value: number,
  kind: 'atk' | 'def',
  s: number,
  buffed = false,
): void {
  const light = kind === 'atk' ? UI.attack : UI.defense;
  const deep = kind === 'atk' ? UI.attackDeep : UI.defenseDeep;

  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.7)';
  ctx.shadowBlur = 10 * s;
  ctx.shadowOffsetY = 3 * s;

  ctx.beginPath();
  if (kind === 'atk') {
    // Blade escutcheon: pointed top and bottom.
    ctx.moveTo(cx, cy - r * 1.12);
    ctx.lineTo(cx + r * 0.92, cy - r * 0.3);
    ctx.lineTo(cx + r * 0.62, cy + r * 0.86);
    ctx.lineTo(cx - r * 0.62, cy + r * 0.86);
    ctx.lineTo(cx - r * 0.92, cy - r * 0.3);
  } else {
    // Round shield.
    ctx.moveTo(cx - r * 0.95, cy - r * 0.7);
    ctx.lineTo(cx + r * 0.95, cy - r * 0.7);
    ctx.quadraticCurveTo(cx + r * 1.0, cy + r * 0.35, cx, cy + r * 1.1);
    ctx.quadraticCurveTo(cx - r * 1.0, cy + r * 0.35, cx - r * 0.95, cy - r * 0.7);
  }
  ctx.closePath();

  const g = ctx.createLinearGradient(cx, cy - r, cx, cy + r);
  g.addColorStop(0, light);
  g.addColorStop(0.55, deep);
  g.addColorStop(1, '#0A0D14');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.shadowColor = 'transparent';

  ctx.lineWidth = 3.5 * s;
  ctx.strokeStyle = metalGradient(ctx, cx - r, cy - r, cx + r, cy + r, UI.goldBright, UI.goldDeep);
  ctx.stroke();

  ctx.font = `700 ${r * 1.3}px ${FONT.numeral}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = r * 0.18;
  ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.lineJoin = 'round';
  ctx.strokeText(String(value), cx, cy + r * 0.06);
  ctx.fillStyle = buffed ? '#B4FF9E' : '#FFFFFF';
  ctx.fillText(String(value), cx, cy + r * 0.06);

  ctx.restore();
}

/** Countdown ring used in place of stats on a Countdown amulet. */
function drawCountdown(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, value: number, s: number): void {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.7)';
  ctx.shadowBlur = 10 * s;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.1, cx, cy, r);
  g.addColorStop(0, '#F3E7C2');
  g.addColorStop(0.6, '#9C7A2E');
  g.addColorStop(1, '#2A1F08');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.shadowColor = 'transparent';

  ctx.lineWidth = 4 * s;
  ctx.strokeStyle = metalGradient(ctx, cx - r, cy - r, cx + r, cy + r, UI.goldBright, UI.goldDeep);
  ctx.stroke();

  ctx.font = `700 ${r * 1.2}px ${FONT.numeral}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = r * 0.16;
  ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.lineJoin = 'round';
  ctx.strokeText(String(value), cx, cy + r * 0.04);
  ctx.fillStyle = '#FFF8E4';
  ctx.fillText(String(value), cx, cy + r * 0.04);
  ctx.restore();
}

/** Rarity gem, mounted at the join between art window and text box. */
function drawRarityGem(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, card: CardDef, s: number): void {
  const rt = RARITY_THEME[card.rarity];
  ctx.save();

  // Mount.
  ctx.beginPath();
  ctx.arc(cx, cy, r * 1.45, 0, Math.PI * 2);
  ctx.fillStyle = '#0B0F18';
  ctx.fill();
  ctx.lineWidth = 3 * s;
  ctx.strokeStyle = metalGradient(ctx, cx - r, cy - r, cx + r, cy + r, UI.goldBright, UI.goldDeep);
  ctx.stroke();

  // Gem body — a cut lozenge, brighter with rarity.
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.lineTo(cx + r * 0.78, cy);
  ctx.lineTo(cx, cy + r);
  ctx.lineTo(cx - r * 0.78, cy);
  ctx.closePath();
  const g = ctx.createLinearGradient(cx, cy - r, cx, cy + r);
  g.addColorStop(0, '#FFFFFF');
  g.addColorStop(0.3, rt.gem);
  g.addColorStop(1, rt.gemDeep);
  ctx.fillStyle = g;
  ctx.fill();

  if (card.rarity === 'legendary') {
    // Legendary gems throw a halo, which is how the rarity reads at a glance.
    ctx.globalCompositeOperation = 'lighter';
    const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 3);
    halo.addColorStop(0, hexToRgba(rt.gem, 0.55));
    halo.addColorStop(1, hexToRgba(rt.gem, 0));
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * Rules text with keyword emphasis. Ability keywords are set in gold small
 * caps, which is what makes a dense card scannable at board size.
 */
function drawRulesText(
  ctx: CanvasRenderingContext2D,
  card: CardDef,
  box: { x: number; y: number; w: number; h: number },
  s: number,
  lang: 'en' | 'ja',
): void {
  const text = (lang === 'ja' ? card.textJa || card.text : card.text).trim();
  if (!text) {
    // A vanilla card shows its flavour line instead of an empty box.
    const flavor = (lang === 'ja' ? card.flavorJa || card.flavor : card.flavor) ?? '';
    if (!flavor) return;
    ctx.save();
    ctx.font = `italic ${15 * s}px ${FONT.ui}`;
    ctx.fillStyle = hexToRgba(UI.textDim, 0.7);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    wrapCentered(ctx, flavor, box, 19 * s, 4);
    ctx.restore();
    return;
  }

  // Ability names are emphasised in the printed text; both languages' names are
  // listed so the same tokenizer serves either.
  const KEYWORDS = [
    'ファンファーレ',
    'ラストワード',
    '進化時',
    '交戦時',
    '攻撃時',
    'エンハンス',
    'スペルブースト',
    'ネクロマンス',
    '復讐',
    'オーバーフロー',
    '土の秘術',
    'カウントダウン',
    'Fanfare',
    'Last Words',
    'Evolve',
    'Clash',
    'Strike',
    'Enhance',
    'Spellboost',
    'Necromancy',
    'Vengeance',
    'Overflow',
    'Earth Rite',
    'Countdown',
    ...Object.values(KEYWORD_LABEL),
    ...Object.values(KEYWORD_LABEL_JA),
  ];

  // Fit the whole block by shrinking until it fits the box. The floor is low
  // because a handful of cards (Minthe of the Underworld, Dragonsong Flute)
  // print far more text than the frame was designed for.
  const lines = text.split('\n');
  let size = 19 * s;
  let wrapped: { text: string; bold: boolean }[][] = [];
  for (; size >= 9 * s; size -= 0.5 * s) {
    ctx.font = `${size}px ${FONT.ui}`;
    wrapped = [];
    for (const line of lines) {
      for (const w of wrapRuns(ctx, tokenize(line, KEYWORDS), box.w - 12 * s, size, s)) wrapped.push(w);
    }
    if (wrapped.length * size * 1.3 <= box.h - 8 * s) break;
  }

  const lh = size * 1.3;
  let y = box.y + (box.h - wrapped.length * lh) / 2 + lh * 0.5;
  ctx.save();
  // Even at the floor a few cards do not fit. Clipping keeps the overflow
  // inside the text box instead of spilling over the stat plates; the full
  // text is always readable in the card detail view and the battle inspector.
  ctx.beginPath();
  ctx.rect(box.x, box.y, box.w, box.h);
  ctx.clip();
  ctx.textBaseline = 'middle';
  for (const runs of wrapped) {
    // Measure to centre the whole line, keeping mixed-weight runs aligned.
    let total = 0;
    for (const r of runs) {
      ctx.font = `${r.bold ? 700 : 400} ${size}px ${FONT.ui}`;
      total += ctx.measureText(r.text).width;
    }
    let x = box.x + (box.w - total) / 2;
    for (const r of runs) {
      ctx.font = `${r.bold ? 700 : 400} ${size}px ${FONT.ui}`;
      ctx.fillStyle = r.bold ? UI.goldBright : UI.text;
      ctx.shadowColor = 'rgba(0,0,0,0.8)';
      ctx.shadowBlur = 3 * s;
      ctx.textAlign = 'left';
      ctx.fillText(r.text, x, y);
      x += ctx.measureText(r.text).width;
    }
    y += lh;
  }
  ctx.restore();
}

interface Run {
  text: string;
  bold: boolean;
}

/** Splits a line into plain and keyword runs. */
function tokenize(line: string, keywords: string[]): Run[] {
  const escaped = keywords
    .slice()
    .sort((a, b) => b.length - a.length)
    .map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  const re = new RegExp(`(${escaped})`, 'g');
  const out: Run[] = [];
  let last = 0;
  for (const m of line.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > last) out.push({ text: line.slice(last, i), bold: false });
    out.push({ text: m[0], bold: true });
    last = i + m[0].length;
  }
  if (last < line.length) out.push({ text: line.slice(last), bold: false });
  return out.length > 0 ? out : [{ text: line, bold: false }];
}

/** Characters that may not open a line in Japanese (simplified kinsoku). */
const NO_LINE_START = '。、，．」』）｝】〕・ー々ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮ！？：；';

/** Word-wraps a run sequence, preserving each run's weight across breaks. */
function wrapRuns(ctx: CanvasRenderingContext2D, runs: Run[], maxW: number, size: number, s: number): Run[][] {
  const out: Run[][] = [];
  let line: Run[] = [];
  let width = 0;
  const push = () => {
    if (line.length > 0) out.push(line);
    line = [];
    width = 0;
  };
  for (const run of runs) {
    ctx.font = `${run.bold ? 700 : 400} ${size}px ${FONT.ui}`;
    // Japanese has no spaces, so fall back to per-character breaking.
    const cjk = /[^\x00-\x7F]/.test(run.text);
    const parts = cjk ? [...run.text] : run.text.split(/(\s+)/);
    let buf = '';
    for (const part of parts) {
      const w = ctx.measureText(part).width;
      // Simplified kinsoku: closing punctuation and small kana may not open a
      // line, so a sentence never ends with a lone 。 on a line of its own.
      if (cjk && NO_LINE_START.includes(part)) {
        buf += part;
        width += w;
        continue;
      }
      if (width + w > maxW && (buf.trim() || line.length > 0)) {
        if (buf) line.push({ text: buf, bold: run.bold });
        push();
        buf = part.trimStart();
        ctx.font = `${run.bold ? 700 : 400} ${size}px ${FONT.ui}`;
        width = ctx.measureText(buf).width;
      } else {
        buf += part;
        width += w;
      }
    }
    if (buf) line.push({ text: buf, bold: run.bold });
  }
  push();
  void s;
  return out;
}

function wrapCentered(
  ctx: CanvasRenderingContext2D,
  text: string,
  box: { x: number; y: number; w: number; h: number },
  lh: number,
  maxLines: number,
): void {
  // Japanese has no spaces, so it breaks per character; Latin breaks on words.
  const cjk = /[^\x00-\x7F]/.test(text);
  const parts = cjk ? [...text] : text.split(/\s+/);
  const join = (a: string, b: string) => (cjk || !a ? a + b : `${a} ${b}`);
  // Simplified kinsoku: these may not open a line.
  const noStart = NO_LINE_START;

  const lines: string[] = [];
  let cur = '';
  let truncated = false;
  for (const part of parts) {
    const test = join(cur, part);
    const tooWide = ctx.measureText(test).width > box.w - 24;
    if (tooWide && cur && !(cjk && noStart.includes(part))) {
      lines.push(cur);
      cur = part;
      if (lines.length === maxLines) {
        truncated = true;
        break;
      }
    } else {
      cur = test;
    }
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  else if (cur) truncated = true;
  // A flavour line cut mid-sentence looks like a bug, so mark the elision.
  if (truncated && lines.length > 0) {
    const last = lines.length - 1;
    lines[last] = lines[last].replace(/[,;:、，]$/, '') + '…';
  }
  let y = box.y + (box.h - lines.length * lh) / 2 + lh / 2;
  for (const l of lines) {
    ctx.fillText(l, box.x + box.w / 2, y);
    y += lh;
  }
}

// ---------------------------------------------------------------------------
// Full face
// ---------------------------------------------------------------------------

/**
 * Draws the complete card face. The canvas is sized `CARD.W * scale` by
 * `CARD.H * scale`; all internal geometry is expressed in the base layout and
 * scaled once, so the same code serves board-size and detail-view rendering.
 */
export function drawCardFace(ctx: CanvasRenderingContext2D, card: CardDef, opts: CardFaceOptions = {}): void {
  const s = opts.scale ?? 1;
  const W = CARD.W * s;
  const H = CARD.H * s;
  const theme = CLASS_THEME[card.cardClass];
  const rarity = RARITY_THEME[card.rarity];
  const evolved = !!opts.evolved && card.type === 'follower';
  const lang = opts.lang ?? LANG;

  ctx.save();
  ctx.clearRect(0, 0, W, H);

  // --- outer frame --------------------------------------------------------
  roundRect(ctx, 0, 0, W, H, CARD.RADIUS * s);
  ctx.fillStyle = '#05070C';
  ctx.fill();

  // Metal border, tinted by rarity, with an evolution overlay when evolved.
  const metalLight = evolved ? '#FFD9A0' : rarity.metal;
  const metalDark = evolved ? '#7A2410' : rarity.metalDeep;
  roundRect(ctx, 3 * s, 3 * s, W - 6 * s, H - 6 * s, (CARD.RADIUS - 2) * s);
  ctx.lineWidth = 9 * s;
  ctx.strokeStyle = metalGradient(ctx, 0, 0, W, H, metalLight, metalDark);
  ctx.stroke();

  // Class wash over the frame interior.
  roundRect(ctx, 9 * s, 9 * s, W - 18 * s, H - 18 * s, (CARD.RADIUS - 6) * s);
  const wash = ctx.createLinearGradient(0, 0, 0, H);
  wash.addColorStop(0, hexToRgba(theme.deep, 0.95));
  wash.addColorStop(0.55, '#0A0E16');
  wash.addColorStop(1, hexToRgba(theme.deep, 0.8));
  ctx.fillStyle = wash;
  ctx.fill();

  // Inner hairline.
  ctx.lineWidth = 1.5 * s;
  ctx.strokeStyle = hexToRgba(UI.gold, 0.35);
  ctx.stroke();

  // --- art window ---------------------------------------------------------
  const art = { x: CARD.ART.x * s, y: CARD.ART.y * s, w: CARD.ART.w * s, h: CARD.ART.h * s };
  ctx.save();
  roundRect(ctx, art.x, art.y, art.w, art.h, 14 * s);
  ctx.clip();
  // An explicit image wins; otherwise a user-supplied one for this card, if it
  // has finished loading; otherwise the generated illustration.
  const supplied = opts.officialArt ?? suppliedArtFor(card.id);
  if (supplied) {
    // Supplied artwork is cover-fitted so the subject is never letterboxed.
    drawCover(ctx, supplied, art);
  } else {
    ctx.save();
    ctx.translate(art.x, art.y);
    drawIllustration(ctx, art.w, art.h, card, { evolved });
    ctx.restore();
  }
  // Darken the lower third so the name band and frame read against the art.
  const fade = ctx.createLinearGradient(0, art.y + art.h * 0.45, 0, art.y + art.h);
  fade.addColorStop(0, 'rgba(5,7,12,0)');
  fade.addColorStop(1, 'rgba(5,7,12,0.72)');
  ctx.fillStyle = fade;
  ctx.fillRect(art.x, art.y, art.w, art.h);
  ctx.restore();

  // Art window bezel.
  roundRect(ctx, art.x, art.y, art.w, art.h, 14 * s);
  ctx.lineWidth = 4 * s;
  ctx.strokeStyle = metalGradient(ctx, art.x, art.y, art.x + art.w, art.y + art.h, metalLight, metalDark);
  ctx.stroke();

  // --- name band ----------------------------------------------------------
  const band: NameBand = {
    x: CARD.NAME_BAND.x * s,
    y: CARD.NAME_BAND.y * s,
    w: CARD.NAME_BAND.w * s,
    h: CARD.NAME_BAND.h * s,
  };
  const displayName = lang === 'ja' && card.nameJa ? card.nameJa : card.name;
  drawCardName(ctx, displayName, band, {
    drawPlate: true,
    plateColor: hexToRgba(theme.deep, 0.82),
    style: {
      maxSize: 40 * s,
      minSize: 21 * s,
      shadowBlur: 8 * s,
      shadowOffsetY: 2 * s,
    },
  });

  // --- rules text box -----------------------------------------------------
  const box = {
    x: CARD.TEXT_BOX.x * s,
    y: CARD.TEXT_BOX.y * s,
    w: CARD.TEXT_BOX.w * s,
    h: CARD.TEXT_BOX.h * s,
  };
  roundRect(ctx, box.x, box.y, box.w, box.h, 12 * s);
  const boxFill = ctx.createLinearGradient(0, box.y, 0, box.y + box.h);
  boxFill.addColorStop(0, 'rgba(8, 11, 18, 0.94)');
  boxFill.addColorStop(1, 'rgba(14, 18, 28, 0.88)');
  ctx.fillStyle = boxFill;
  ctx.fill();
  ctx.lineWidth = 1.5 * s;
  ctx.strokeStyle = hexToRgba(UI.gold, 0.28);
  ctx.stroke();

  drawRulesText(ctx, card, box, s, lang);

  // --- corner furniture ---------------------------------------------------
  drawCostOrb(ctx, 62 * s, 62 * s, 44 * s, card.cost, s);

  if (card.type === 'follower') {
    const atk = evolved ? (card.evoAtk ?? (card.atk ?? 0) + 2) : card.atk ?? 0;
    const def = evolved ? (card.evoDef ?? (card.def ?? 0) + 2) : card.def ?? 0;
    drawStatPlate(ctx, 66 * s, H - 62 * s, 42 * s, atk, 'atk', s);
    drawStatPlate(ctx, W - 66 * s, H - 62 * s, 42 * s, def, 'def', s);
  } else if (card.type === 'amulet' && card.countdown !== undefined) {
    drawCountdown(ctx, W - 66 * s, H - 62 * s, 40 * s, card.countdown, s);
  }

  drawFooterOrnament(ctx, W, H, card, s);
  drawRarityGem(ctx, W / 2, (CARD.TEXT_BOX.y - 6) * s, 16 * s, card, s);

  // Card-type marker: the original encodes type in the frame's top silhouette,
  // which a flat canvas cannot do, so it is stated as a small plate instead.
  drawTypePlate(ctx, W / 2, 22 * s, card, s, lang);

  // --- premium sheen ------------------------------------------------------
  if (opts.premium) {
    ctx.save();
    roundRect(ctx, 9 * s, 9 * s, W - 18 * s, H - 18 * s, (CARD.RADIUS - 6) * s);
    ctx.clip();
    ctx.globalCompositeOperation = 'lighter';
    const sheen = ctx.createLinearGradient(0, H, W, 0);
    sheen.addColorStop(0, 'rgba(255,120,220,0)');
    sheen.addColorStop(0.36, 'rgba(120,200,255,0.14)');
    sheen.addColorStop(0.5, 'rgba(255,255,255,0.2)');
    sheen.addColorStop(0.64, 'rgba(255,190,120,0.14)');
    sheen.addColorStop(1, 'rgba(255,120,220,0)');
    ctx.fillStyle = sheen;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  // Evolution glow along the frame.
  if (evolved) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    roundRect(ctx, 5 * s, 5 * s, W - 10 * s, H - 10 * s, (CARD.RADIUS - 3) * s);
    ctx.lineWidth = 6 * s;
    ctx.strokeStyle = 'rgba(255, 110, 60, 0.45)';
    ctx.stroke();
    ctx.restore();
  }

  ctx.restore();
}

/**
 * Filigree along the bottom rail between the two stat plates. Without it the
 * strip under the text box reads as unfinished.
 */
function drawFooterOrnament(ctx: CanvasRenderingContext2D, W: number, H: number, card: CardDef, s: number): void {
  const theme = CLASS_THEME[card.cardClass];
  const y = H - 62 * s;
  const x0 = 118 * s;
  const x1 = W - 118 * s;
  const mid = (x0 + x1) / 2;

  ctx.save();
  ctx.strokeStyle = hexToRgba(UI.gold, 0.42);
  ctx.lineWidth = 1.6 * s;
  ctx.beginPath();
  ctx.moveTo(x0, y);
  ctx.lineTo(mid - 26 * s, y);
  ctx.moveTo(mid + 26 * s, y);
  ctx.lineTo(x1, y);
  ctx.stroke();

  // Central diamond with the class colour, echoing the rarity gem above.
  ctx.beginPath();
  ctx.moveTo(mid, y - 11 * s);
  ctx.lineTo(mid + 15 * s, y);
  ctx.lineTo(mid, y + 11 * s);
  ctx.lineTo(mid - 15 * s, y);
  ctx.closePath();
  ctx.fillStyle = hexToRgba(theme.primary, 0.5);
  ctx.fill();
  ctx.strokeStyle = hexToRgba(UI.gold, 0.6);
  ctx.stroke();

  // Small flanking pips, one per rarity step, as a quiet rarity cue.
  const pips = { bronze: 0, silver: 1, gold: 2, legendary: 3 }[card.rarity];
  ctx.fillStyle = hexToRgba(UI.goldBright, 0.55);
  for (let i = 0; i < pips; i++) {
    for (const dir of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(mid + dir * (30 + i * 12) * s, y, 2.4 * s, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

/** Small plate naming the card type and class, sitting on the top rail. */
function drawTypePlate(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  card: CardDef,
  s: number,
  lang: 'en' | 'ja',
): void {
  const theme = CLASS_THEME[card.cardClass];
  const typeLabel =
    lang === 'ja'
      ? { follower: 'フォロワー', spell: 'スペル', amulet: 'アミュレット' }[card.type]
      : { follower: 'Follower', spell: 'Spell', amulet: 'Amulet' }[card.type];
  const label = `${lang === 'ja' ? theme.labelJa : theme.label} · ${typeLabel}`;

  ctx.save();
  ctx.font = `600 ${15 * s}px ${FONT.ui}`;
  const w = ctx.measureText(label).width + 34 * s;
  const h = 26 * s;
  const x = cx - w / 2;
  const y = cy - h / 2 + 4 * s;

  ctx.beginPath();
  ctx.moveTo(x + h * 0.45, y);
  ctx.lineTo(x + w - h * 0.45, y);
  ctx.lineTo(x + w, y + h / 2);
  ctx.lineTo(x + w - h * 0.45, y + h);
  ctx.lineTo(x + h * 0.45, y + h);
  ctx.lineTo(x, y + h / 2);
  ctx.closePath();
  ctx.fillStyle = hexToRgba(theme.deep, 0.92);
  ctx.fill();
  ctx.lineWidth = 1.4 * s;
  ctx.strokeStyle = hexToRgba(UI.gold, 0.5);
  ctx.stroke();

  ctx.fillStyle = hexToRgba(theme.accent, 0.95);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, cx, y + h / 2 + 1 * s);
  ctx.restore();
}

/** object-fit: cover for an image drawn into a box. */
function drawCover(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource,
  box: { x: number; y: number; w: number; h: number },
): void {
  const iw = (img as HTMLImageElement).width || box.w;
  const ih = (img as HTMLImageElement).height || box.h;
  const scale = Math.max(box.w / iw, box.h / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  // Bias the crop upward: card art almost always puts the subject high.
  ctx.drawImage(img, box.x + (box.w - dw) / 2, box.y + (box.h - dh) * 0.35, dw, dh);
}

// ---------------------------------------------------------------------------
// Canvas factory + cache
// ---------------------------------------------------------------------------

const cache = new Map<string, HTMLCanvasElement>();

/** Renders (and caches) a card face canvas. */
export function cardFaceCanvas(card: CardDef, opts: CardFaceOptions = {}): HTMLCanvasElement {
  const s = opts.scale ?? 1;
  // A supplied image that has not loaded yet paints as the generated
  // illustration, so the two are different faces and must not share a key.
  const art = opts.officialArt || suppliedArtFor(card.id) ? 'i' : '';
  const key = `${card.id}|${opts.evolved ? 'e' : 'b'}|${s}|${opts.premium ? 'p' : ''}|${opts.lang ?? 'en'}|${art}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const c = document.createElement('canvas');
  c.width = Math.round(CARD.W * s);
  c.height = Math.round(CARD.H * s);
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable');
  drawCardFace(ctx, card, opts);
  cache.set(key, c);
  return c;
}

export function clearCardFaceCache(): void {
  cache.clear();
}

// A supplied image arrives after the card has already been painted from its
// generated illustration, so the stale faces for that card are dropped and the
// next paint picks the image up.
onSuppliedArt((cardId) => {
  for (const key of [...cache.keys()]) {
    if (key.startsWith(`${cardId}|`)) cache.delete(key);
  }
});
