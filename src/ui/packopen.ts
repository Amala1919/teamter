/**
 * Pack opening.
 *
 * The original's opening ceremony is a beat, not a menu: the pack tears, a beam
 * of light escapes coloured by the best card inside, the cards fan out face
 * down, and you turn them over one at a time. This reproduces that shape.
 *
 * There is no economy behind it — every card is already in the collection —
 * so this is a card-viewing ritual rather than a reward. It still follows the
 * original's rarity odds so the pacing feels right.
 */
import type { CardDef, Rarity, SetId } from '../engine/types';
import { cardFaceCanvas } from '../art/cardface';
import { getCardBackTexture } from '../render/cardmesh';
import { FONT, RARITY_THEME, UI } from '../art/theme';
import { SET_LABEL } from './cardgrid';
import { CardDetail } from './detail';
import { el, ensureScreenStyles } from './style';
import { t } from '../i18n';
import { builtCards } from '../data/index';

const PACK_SIZE = 8;

/**
 * The original's pack odds: eight cards, the last of which is guaranteed
 * Silver or better.
 */
const ODDS: [Rarity, number][] = [
  ['bronze', 0.79],
  ['silver', 0.16],
  ['gold', 0.043],
  ['legendary', 0.007],
];

function rollRarity(rnd: () => number, floor: Rarity = 'bronze'): Rarity {
  const order: Rarity[] = ['bronze', 'silver', 'gold', 'legendary'];
  const minIndex = order.indexOf(floor);
  let r = rnd();
  for (const [rarity, p] of ODDS) {
    if (order.indexOf(rarity) < minIndex) continue;
    if (r < p) return rarity;
    r -= p;
  }
  return order[Math.max(minIndex, 0)];
}

const CSS = `
.pack {
  position: absolute; inset: 0; z-index: 25;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 26px;
  /* Opaque: the ceremony is a moment of its own, not a modal over the menu. */
  background:
    radial-gradient(1100px 760px at 50% 45%, rgba(46,34,14,.75), transparent 70%),
    linear-gradient(180deg, #090C13, #030509);
  backdrop-filter: blur(10px);
  font-family: ${FONT.ui}; color: ${UI.text};
  overflow: hidden;
}
.pack-beam {
  position: absolute; left: 50%; top: 50%; width: 3px; height: 0;
  transform: translate(-50%, -50%);
  pointer-events: none; opacity: 0;
}
.pack-beam.fire { animation: pack-beam 1s cubic-bezier(.15,.85,.25,1) forwards; }
@keyframes pack-beam {
  0%   { height: 0; width: 3px; opacity: 0; }
  22%  { height: 220vh; width: 10px; opacity: 1; }
  55%  { height: 220vh; width: 340px; opacity: .95; }
  100% { height: 220vh; width: 900px; opacity: 0; }
}
.pack-wrapper { position: relative; cursor: pointer; transition: transform .3s ease; }
.pack-wrapper:hover { transform: scale(1.04) translateY(-6px); }
.pack-wrapper.tearing { animation: pack-tear .75s cubic-bezier(.3,.8,.3,1) forwards; }
@keyframes pack-tear {
  0%   { transform: none; }
  18%  { transform: rotate(-2deg) scale(1.05); }
  36%  { transform: rotate(2deg) scale(1.03); }
  55%  { transform: rotate(-1deg) scale(1.12); }
  100% { transform: scale(1.7); opacity: 0; }
}
.pack-title {
  font-family: ${FONT.display}; font-size: 30px; font-weight: 700;
  letter-spacing: .22em; text-transform: uppercase; color: ${UI.goldBright};
  text-shadow: 0 0 30px rgba(216,184,101,.45);
}
.pack-hint { font-size: 12px; letter-spacing: .12em; color: ${UI.textDim}; }
.pack-fan { display: flex; gap: 12px; align-items: center; justify-content: center; flex-wrap: wrap; max-width: 94vw; }
.pack-slot {
  position: relative; width: 132px; aspect-ratio: 512/716;
  cursor: pointer; perspective: 900px;
}
.pack-slot .inner {
  position: absolute; inset: 0; transform-style: preserve-3d;
  transition: transform .5s cubic-bezier(.2,.8,.2,1);
}
.pack-slot.flipped .inner { transform: rotateY(180deg); }
.pack-slot .face, .pack-slot .back {
  position: absolute; inset: 0; backface-visibility: hidden;
  border-radius: 9px; overflow: hidden;
  box-shadow: 0 12px 26px rgba(0,0,0,.7);
}
.pack-slot .face { transform: rotateY(180deg); }
.pack-slot canvas, .pack-slot img { width: 100%; height: 100%; display: block; }
.pack-slot .halo {
  position: absolute; inset: -30%; border-radius: 50%;
  opacity: 0; pointer-events: none; transition: opacity .45s ease;
  filter: blur(22px);
}
.pack-slot.flipped .halo { opacity: 1; }
.pack-slot:not(.flipped):hover { transform: translateY(-8px); }
.pack-actions { display: flex; gap: 12px; }
@keyframes pack-in {
  from { opacity: 0; transform: translateY(26px) scale(.9) rotate(var(--tilt, 0deg)); }
  to   { opacity: 1; transform: none; }
}
.pack-slot.enter { animation: pack-in .45s cubic-bezier(.2,.8,.2,1) backwards; }
`;

export interface PackOpenOptions {
  container: HTMLElement;
  set?: SetId | 'all';
  onClose: () => void;
  onSound?: (cue: 'open' | 'reveal' | 'legendary') => void;
}

export class PackOpenOverlay {
  readonly root: HTMLDivElement;
  private readonly cards: CardDef[];
  private readonly detail: CardDetail;
  private revealed = 0;

  constructor(private readonly opts: PackOpenOptions) {
    ensureScreenStyles();
    if (!document.getElementById('pack-style')) {
      const style = document.createElement('style');
      style.id = 'pack-style';
      style.textContent = CSS;
      document.head.append(style);
    }

    this.cards = this.rollPack();
    this.root = el('div', { class: 'pack' });
    this.detail = new CardDetail(this.root);
    opts.container.append(this.root);
    this.showSealed();
  }

  // -------------------------------------------------------------------------

  private rollPack(): CardDef[] {
    const pool = builtCards().filter(
      (c) => !c.token && (this.opts.set === undefined || this.opts.set === 'all' || c.set === this.opts.set),
    );
    const byRarity = new Map<Rarity, CardDef[]>();
    for (const c of pool) {
      if (!byRarity.has(c.rarity)) byRarity.set(c.rarity, []);
      byRarity.get(c.rarity)!.push(c);
    }

    const rnd = Math.random;
    const out: CardDef[] = [];
    for (let i = 0; i < PACK_SIZE; i++) {
      // The last card is guaranteed Silver or better, as in the original.
      const rarity = rollRarity(rnd, i === PACK_SIZE - 1 ? 'silver' : 'bronze');
      const list = byRarity.get(rarity) ?? pool;
      out.push(list[Math.floor(rnd() * list.length)]);
    }
    return out;
  }

  private get bestRarity(): Rarity {
    const order: Rarity[] = ['bronze', 'silver', 'gold', 'legendary'];
    return this.cards.reduce<Rarity>(
      (best, c) => (order.indexOf(c.rarity) > order.indexOf(best) ? c.rarity : best),
      'bronze',
    );
  }

  // -------------------------------------------------------------------------

  private showSealed(): void {
    const label =
      this.opts.set && this.opts.set !== 'all' ? SET_LABEL[this.opts.set] : t('pack.allSets');

    const pack = el('div', { class: 'pack-wrapper' }, this.packArt());
    const beam = el('div', { class: 'pack-beam' });

    const close = el('button', { class: 'sv-btn' }, t('pack.close'));
    close.addEventListener('click', () => this.close());

    this.root.replaceChildren(
      beam,
      el('div', { class: 'pack-title' }, t('pack.title')),
      el('div', { class: 'pack-hint' }, label),
      pack,
      el('div', { class: 'pack-hint' }, t('pack.hint')),
      el('div', { class: 'pack-actions' }, close),
      this.detail.root,
    );

    let opened = false;
    pack.addEventListener('click', () => {
      if (opened) return;
      opened = true;

      const rt = RARITY_THEME[this.bestRarity];
      // The beam's colour is the tell: gold or that cyan means something good.
      beam.style.background = `linear-gradient(90deg, transparent, ${rt.gem}, #FFFFFF, ${rt.gem}, transparent)`;
      beam.style.filter = 'blur(2px)';
      beam.classList.add('fire');
      pack.classList.add('tearing');
      this.opts.onSound?.(this.bestRarity === 'legendary' ? 'legendary' : 'open');

      window.setTimeout(() => this.showCards(), 780);
    });
  }

  /** The sealed pack: an ornate wrapper, drawn rather than loaded. */
  private packArt(): HTMLCanvasElement {
    const W = 300;
    const H = 420;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d');
    if (!ctx) return c;

    const body = ctx.createLinearGradient(0, 0, W, H);
    body.addColorStop(0, '#2A1E3E');
    body.addColorStop(0.45, '#1A1428');
    body.addColorStop(1, '#0E0A18');
    ctx.fillStyle = body;
    ctx.fillRect(0, 0, W, H);

    // Foil sheen.
    const sheen = ctx.createLinearGradient(0, H, W, 0);
    sheen.addColorStop(0, 'rgba(255,120,220,0)');
    sheen.addColorStop(0.42, 'rgba(140,200,255,.14)');
    sheen.addColorStop(0.5, 'rgba(255,255,255,.2)');
    sheen.addColorStop(0.6, 'rgba(255,190,120,.14)');
    sheen.addColorStop(1, 'rgba(255,120,220,0)');
    ctx.fillStyle = sheen;
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = 'rgba(216,184,101,.85)';
    ctx.lineWidth = 6;
    ctx.strokeRect(12, 12, W - 24, H - 24);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(216,184,101,.4)';
    ctx.strokeRect(22, 22, W - 44, H - 44);

    // Tear strip.
    ctx.setLineDash([7, 7]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255,236,190,.5)';
    ctx.beginPath();
    ctx.moveTo(20, 62);
    ctx.lineTo(W - 20, 62);
    ctx.stroke();
    ctx.setLineDash([]);

    // Central rosette, echoing the card back.
    const cx = W / 2;
    const cy = H / 2 + 14;
    ctx.strokeStyle = 'rgba(216,184,101,.7)';
    for (const r of [W * 0.3, W * 0.22, W * 0.12]) {
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * W * 0.12, cy + Math.sin(a) * W * 0.12);
      ctx.lineTo(cx + Math.cos(a) * W * 0.3, cy + Math.sin(a) * W * 0.3);
      ctx.stroke();
    }
    const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, W * 0.16);
    core.addColorStop(0, 'rgba(255,236,190,.95)');
    core.addColorStop(1, 'rgba(255,236,190,0)');
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(cx, cy, W * 0.16, 0, Math.PI * 2);
    ctx.fill();

    ctx.font = `700 20px ${FONT.display}`;
    ctx.fillStyle = UI.goldBright;
    ctx.textAlign = 'center';
    ctx.letterSpacing = '4px';
    ctx.fillText(t('pack.label'), cx, 44);

    c.style.cssText = 'width:230px;height:auto;display:block;border-radius:10px;filter:drop-shadow(0 22px 44px rgba(0,0,0,.8));';
    return c;
  }

  // -------------------------------------------------------------------------

  private showCards(): void {
    const fan = el('div', { class: 'pack-fan' });

    const backSrc = (getCardBackTexture().image as HTMLCanvasElement).toDataURL();

    const slots: HTMLElement[] = [];
    this.cards.forEach((card, i) => {
      const rt = RARITY_THEME[card.rarity];
      const slot = el('div', { class: 'pack-slot enter' });
      slot.style.animationDelay = `${i * 55}ms`;

      const halo = el('div', { class: 'halo' });
      halo.style.background = `radial-gradient(circle, ${rt.gem}, transparent 70%)`;

      const back = el('div', { class: 'back' }, el('img', { src: backSrc, alt: '' }));

      const face = el('div', { class: 'face' });
      const canvas = cardFaceCanvas(card, { scale: 0.36 });
      const copy = document.createElement('canvas');
      copy.width = canvas.width;
      copy.height = canvas.height;
      copy.getContext('2d')?.drawImage(canvas, 0, 0);
      face.append(copy);

      slot.append(halo, el('div', { class: 'inner' }, back, face));

      slot.addEventListener('click', () => {
        if (!slot.classList.contains('flipped')) {
          slot.classList.add('flipped');
          this.revealed++;
          this.opts.onSound?.(card.rarity === 'legendary' ? 'legendary' : 'reveal');
          this.refreshActions();
          return;
        }
        this.detail.open(card);
      });

      slots.push(slot);
      fan.append(slot);
    });

    const revealAll = el('button', { class: 'sv-btn primary' }, t('pack.revealAll'));
    revealAll.addEventListener('click', () => {
      slots.forEach((slot, i) => {
        window.setTimeout(() => {
          if (!slot.classList.contains('flipped')) {
            slot.classList.add('flipped');
            this.revealed++;
            this.opts.onSound?.('reveal');
            this.refreshActions();
          }
        }, i * 90);
      });
    });

    const again = el('button', { class: 'sv-btn' }, t('pack.again'));
    again.addEventListener('click', () => {
      this.detail.close();
      this.root.remove();
      new PackOpenOverlay(this.opts);
    });

    const done = el('button', { class: 'sv-btn' }, t('pack.done'));
    done.addEventListener('click', () => this.close());

    this.actions = el('div', { class: 'pack-actions' }, revealAll, again, done);

    this.root.replaceChildren(
      el('div', { class: 'pack-title' }, t('pack.results')),
      el('div', { class: 'pack-hint' }, t('pack.resultsHint')),
      fan,
      this.actions,
      this.detail.root,
    );
  }

  private actions: HTMLElement | null = null;

  private refreshActions(): void {
    if (!this.actions) return;
    const revealAll = this.actions.firstElementChild as HTMLButtonElement | null;
    if (revealAll) revealAll.disabled = this.revealed >= this.cards.length;
  }

  private close(): void {
    this.root.remove();
    this.opts.onClose();
  }
}
