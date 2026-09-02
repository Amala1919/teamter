/**
 * Board-side card rendering.
 *
 * A follower in play is not shown as its full card: the rules text is already
 * known, and the board needs the art, the name and — above all — live attack
 * and defense numbers that change constantly. This renders that compact
 * plaque, keyed on the live state so a buff or a point of damage produces a
 * new texture without touching the hand-card renderer.
 */
import type { CardDef, Keyword } from '../engine/types';
import { KEYWORD_LABEL } from '../engine/types';
import { drawIllustration } from './illustration';
import { drawCardName } from './cardname';
import { cardName } from '../i18n';
import { CLASS_THEME, FONT, UI } from './theme';

export const BOARD_CARD = { W: 340, H: 476 } as const;

export interface BoardCardState {
  atk: number;
  def: number;
  maxDef: number;
  evolved: boolean;
  keywords: Keyword[];
  /** Countdown amulets show their remaining count instead of stats. */
  countdown?: number;
  /** Highlights the plaque as ready to attack. */
  ready?: boolean;
  /** Dims the plaque, e.g. an Ambushed follower or one that has attacked. */
  spent?: boolean;
}

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

function rgba(hex: string, a: number): string {
  const v = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a})`;
}

function metal(ctx: CanvasRenderingContext2D, w: number, h: number, light: string, dark: string): CanvasGradient {
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, dark);
  g.addColorStop(0.2, light);
  g.addColorStop(0.45, dark);
  g.addColorStop(0.7, light);
  g.addColorStop(1, dark);
  return g;
}

/** Compact icons for the keywords that change how a follower can be attacked. */
const ICON_KEYWORDS: Keyword[] = ['ward', 'storm', 'rush', 'bane', 'drain', 'ambush', 'cantAttack'];

function drawKeywordIcon(ctx: CanvasRenderingContext2D, kw: Keyword, cx: number, cy: number, r: number): void {
  ctx.save();
  ctx.translate(cx, cy);

  const colors: Partial<Record<Keyword, string>> = {
    ward: '#8FD0FF',
    storm: '#FFD86B',
    rush: '#FFA85C',
    bane: '#C77BFF',
    drain: '#FF6B7A',
    ambush: '#9AA6B8',
    cantAttack: '#7A8298',
  };
  const color = colors[kw] ?? UI.gold;

  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(6,9,15,0.86)';
  ctx.fill();
  ctx.lineWidth = r * 0.16;
  ctx.strokeStyle = rgba(color, 0.9);
  ctx.stroke();

  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = r * 0.18;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  switch (kw) {
    case 'ward':
      // Shield.
      ctx.beginPath();
      ctx.moveTo(-r * 0.42, -r * 0.42);
      ctx.lineTo(r * 0.42, -r * 0.42);
      ctx.quadraticCurveTo(r * 0.45, r * 0.2, 0, r * 0.56);
      ctx.quadraticCurveTo(-r * 0.45, r * 0.2, -r * 0.42, -r * 0.42);
      ctx.closePath();
      ctx.fill();
      break;
    case 'storm':
      // Lightning bolt.
      ctx.beginPath();
      ctx.moveTo(r * 0.12, -r * 0.55);
      ctx.lineTo(-r * 0.34, r * 0.06);
      ctx.lineTo(-r * 0.02, r * 0.06);
      ctx.lineTo(-r * 0.14, r * 0.58);
      ctx.lineTo(r * 0.36, -r * 0.08);
      ctx.lineTo(r * 0.02, -r * 0.08);
      ctx.closePath();
      ctx.fill();
      break;
    case 'rush':
      // Chevrons.
      ctx.beginPath();
      ctx.moveTo(-r * 0.4, -r * 0.35);
      ctx.lineTo(r * 0.05, 0);
      ctx.lineTo(-r * 0.4, r * 0.35);
      ctx.moveTo(-r * 0.02, -r * 0.35);
      ctx.lineTo(r * 0.43, 0);
      ctx.lineTo(-r * 0.02, r * 0.35);
      ctx.stroke();
      break;
    case 'bane':
      // Skull dot pair over a curve.
      ctx.beginPath();
      ctx.arc(-r * 0.17, -r * 0.12, r * 0.13, 0, Math.PI * 2);
      ctx.arc(r * 0.17, -r * 0.12, r * 0.13, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(0, r * 0.05, r * 0.35, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();
      break;
    case 'drain':
      // Droplet.
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.55);
      ctx.quadraticCurveTo(r * 0.45, r * 0.05, 0, r * 0.5);
      ctx.quadraticCurveTo(-r * 0.45, r * 0.05, 0, -r * 0.55);
      ctx.fill();
      break;
    case 'ambush':
      // Crescent.
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.45, 0.35 * Math.PI, 1.65 * Math.PI);
      ctx.stroke();
      break;
    default:
      ctx.beginPath();
      ctx.moveTo(-r * 0.35, -r * 0.35);
      ctx.lineTo(r * 0.35, r * 0.35);
      ctx.moveTo(r * 0.35, -r * 0.35);
      ctx.lineTo(-r * 0.35, r * 0.35);
      ctx.stroke();
      break;
  }
  ctx.restore();
}

function drawPlate(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  value: number,
  kind: 'atk' | 'def',
  tint: string,
): void {
  const light = kind === 'atk' ? UI.attack : UI.defense;
  const deep = kind === 'atk' ? UI.attackDeep : UI.defenseDeep;

  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.8)';
  ctx.shadowBlur = 10;
  ctx.beginPath();
  if (kind === 'atk') {
    ctx.moveTo(cx, cy - r * 1.12);
    ctx.lineTo(cx + r * 0.92, cy - r * 0.3);
    ctx.lineTo(cx + r * 0.62, cy + r * 0.86);
    ctx.lineTo(cx - r * 0.62, cy + r * 0.86);
    ctx.lineTo(cx - r * 0.92, cy - r * 0.3);
  } else {
    ctx.moveTo(cx - r * 0.95, cy - r * 0.7);
    ctx.lineTo(cx + r * 0.95, cy - r * 0.7);
    ctx.quadraticCurveTo(cx + r, cy + r * 0.35, cx, cy + r * 1.1);
    ctx.quadraticCurveTo(cx - r, cy + r * 0.35, cx - r * 0.95, cy - r * 0.7);
  }
  ctx.closePath();
  const g = ctx.createLinearGradient(cx, cy - r, cx, cy + r);
  g.addColorStop(0, light);
  g.addColorStop(0.55, deep);
  g.addColorStop(1, '#0A0D14');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = metal(ctx, BOARD_CARD.W, BOARD_CARD.H, UI.goldBright, UI.goldDeep);
  ctx.stroke();

  ctx.font = `700 ${r * 1.32}px ${FONT.numeral}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = r * 0.2;
  ctx.strokeStyle = 'rgba(0,0,0,0.9)';
  ctx.lineJoin = 'round';
  ctx.strokeText(String(value), cx, cy + r * 0.06);
  ctx.fillStyle = tint;
  ctx.fillText(String(value), cx, cy + r * 0.06);
  ctx.restore();
}

export function drawBoardCard(ctx: CanvasRenderingContext2D, card: CardDef, st: BoardCardState): void {
  const W = BOARD_CARD.W;
  const H = BOARD_CARD.H;
  const theme = CLASS_THEME[card.cardClass];

  ctx.clearRect(0, 0, W, H);
  ctx.save();

  // Frame.
  roundRect(ctx, 0, 0, W, H, 18);
  ctx.fillStyle = '#05070C';
  ctx.fill();

  roundRect(ctx, 3, 3, W - 6, H - 6, 16);
  ctx.lineWidth = 7;
  ctx.strokeStyle = st.evolved
    ? metal(ctx, W, H, '#FFD9A0', '#8A2A10')
    : metal(ctx, W, H, UI.goldBright, UI.goldDeep);
  ctx.stroke();

  // Art fills most of the plaque.
  const art = { x: 10, y: 10, w: W - 20, h: H - 88 };
  ctx.save();
  roundRect(ctx, art.x, art.y, art.w, art.h, 12);
  ctx.clip();
  ctx.translate(art.x, art.y);
  drawIllustration(ctx, art.w, art.h, card, { evolved: st.evolved });
  ctx.restore();

  // Name band across the lower art.
  const band = { x: 22, y: art.y + art.h - 74, w: W - 44, h: 48 };
  const fade = ctx.createLinearGradient(0, band.y - 40, 0, art.y + art.h);
  fade.addColorStop(0, 'rgba(5,7,12,0)');
  fade.addColorStop(1, 'rgba(5,7,12,0.85)');
  ctx.save();
  roundRect(ctx, art.x, art.y, art.w, art.h, 12);
  ctx.clip();
  ctx.fillStyle = fade;
  ctx.fillRect(art.x, band.y - 40, art.w, art.h);
  ctx.restore();

  drawCardName(ctx, cardName(card), band, {
    drawPlate: true,
    plateColor: rgba(theme.deep, 0.85),
    style: { maxSize: 30, minSize: 15, outlineRatio: 0.16 },
  });

  // Keyword icons run down the left edge of the art.
  const icons = ICON_KEYWORDS.filter((k) => st.keywords.includes(k));
  icons.slice(0, 4).forEach((kw, i) => {
    drawKeywordIcon(ctx, kw, 40, 44 + i * 56, 21);
  });

  // Stats.
  if (card.type === 'follower') {
    const damaged = st.def < st.maxDef;
    const baseAtk = st.evolved ? (card.evoAtk ?? (card.atk ?? 0) + 2) : card.atk ?? 0;
    const baseDef = st.evolved ? (card.evoDef ?? (card.def ?? 0) + 2) : card.def ?? 0;
    drawPlate(ctx, 46, H - 42, 34, st.atk, 'atk', st.atk > baseAtk ? '#B4FF9E' : '#FFFFFF');
    drawPlate(ctx, W - 46, H - 42, 34, st.def, 'def', damaged ? '#FF9A9A' : st.maxDef > baseDef ? '#B4FF9E' : '#FFFFFF');
  } else if (st.countdown !== undefined) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(W - 46, H - 42, 32, 0, Math.PI * 2);
    const g = ctx.createRadialGradient(W - 56, H - 52, 4, W - 46, H - 42, 32);
    g.addColorStop(0, '#F3E7C2');
    g.addColorStop(0.6, '#9C7A2E');
    g.addColorStop(1, '#2A1F08');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = metal(ctx, W, H, UI.goldBright, UI.goldDeep);
    ctx.stroke();
    ctx.font = `700 40px ${FONT.numeral}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.lineJoin = 'round';
    ctx.strokeText(String(st.countdown), W - 46, H - 40);
    ctx.fillStyle = '#FFF8E4';
    ctx.fillText(String(st.countdown), W - 46, H - 40);
    ctx.restore();
  }

  // State washes.
  if (st.spent) {
    roundRect(ctx, 3, 3, W - 6, H - 6, 16);
    ctx.fillStyle = 'rgba(2,4,8,0.45)';
    ctx.fill();
  }
  if (st.ready) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    roundRect(ctx, 5, 5, W - 10, H - 10, 15);
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(140, 240, 170, 0.5)';
    ctx.stroke();
    ctx.restore();
  }
  if (st.keywords.includes('ambush')) {
    roundRect(ctx, 3, 3, W - 6, H - 6, 16);
    ctx.fillStyle = 'rgba(20,30,50,0.4)';
    ctx.fill();
  }

  ctx.restore();
  void KEYWORD_LABEL;
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

const cache = new Map<string, HTMLCanvasElement>();

function key(card: CardDef, st: BoardCardState): string {
  return [
    card.id,
    st.atk,
    st.def,
    st.maxDef,
    st.evolved ? 1 : 0,
    st.countdown ?? '',
    st.ready ? 1 : 0,
    st.spent ? 1 : 0,
    st.keywords.slice().sort().join(','),
  ].join('|');
}

export function boardCardCanvas(card: CardDef, st: BoardCardState): HTMLCanvasElement {
  const k = key(card, st);
  const hit = cache.get(k);
  if (hit) return hit;

  const c = document.createElement('canvas');
  c.width = BOARD_CARD.W;
  c.height = BOARD_CARD.H;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable');
  drawBoardCard(ctx, card, st);

  // The cache is unbounded over a long session otherwise; a board never needs
  // more than a few hundred distinct states at once.
  if (cache.size > 400) cache.clear();
  cache.set(k, c);
  return c;
}
