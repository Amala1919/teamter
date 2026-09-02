/**
 * Mulligan overlay.
 *
 * Shown once at the start of a match. Both players redraw simultaneously and
 * one time only; tapping a card marks it for replacement, and confirming
 * returns the marked cards to the deck.
 */
import type { CardDef } from '../engine/types';
import { cardFaceCanvas } from '../art/cardface';
import { FONT, UI } from '../art/theme';
import { el, ensureScreenStyles } from './style';
import { t } from '../i18n';

const CSS = `
.mull {
  position: absolute; inset: 0; z-index: 30;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 30px;
  background: radial-gradient(900px 600px at 50% 40%, rgba(24,20,12,.82), rgba(2,3,6,.96));
  backdrop-filter: blur(7px);
  font-family: ${FONT.ui}; color: ${UI.text};
  opacity: 0; transition: opacity .3s ease;
}
.mull.in { opacity: 1; }
.mull h1 {
  margin: 0; font-family: ${FONT.display}; font-size: 34px; font-weight: 700;
  letter-spacing: .22em; text-transform: uppercase; color: ${UI.goldBright};
  text-shadow: 0 0 34px rgba(216,184,101,.45);
}
.mull p { margin: 0; font-size: 13px; letter-spacing: .1em; color: ${UI.textDim}; }
.mull-hand { display: flex; gap: 26px; align-items: flex-end; }
.mull-card {
  position: relative; cursor: pointer;
  transition: transform .2s cubic-bezier(.2,.8,.2,1), filter .2s ease;
  transform-origin: bottom center;
}
.mull-card canvas { display: block; border-radius: 14px; filter: drop-shadow(0 18px 34px rgba(0,0,0,.75)); }
.mull-card:hover { transform: translateY(-14px) scale(1.03); }
.mull-card.swap { filter: grayscale(.65) brightness(.55); transform: translateY(10px) scale(.97); }
.mull-card.swap:hover { transform: translateY(2px) scale(.99); }
.mull-mark {
  position: absolute; inset: auto 0 -14px 0; text-align: center;
  font-size: 11px; font-weight: 700; letter-spacing: .16em; text-transform: uppercase;
  color: #FFC08A; opacity: 0; transition: opacity .18s ease;
}
.mull-card.swap .mull-mark { opacity: 1; }
.mull-actions { display: flex; gap: 14px; align-items: center; }
`;

export interface MulliganOptions {
  container: HTMLElement;
  cards: { uid: number; def: CardDef }[];
  onConfirm: (replaceUids: number[]) => void;
}

export class MulliganOverlay {
  readonly root: HTMLDivElement;
  private readonly replace = new Set<number>();
  private readonly summary: HTMLElement;

  constructor(private readonly opts: MulliganOptions) {
    ensureScreenStyles();
    if (!document.getElementById('mull-style')) {
      const style = document.createElement('style');
      style.id = 'mull-style';
      style.textContent = CSS;
      document.head.append(style);
    }

    const hand = el('div', { class: 'mull-hand' });
    for (const { uid, def } of opts.cards) {
      const face = cardFaceCanvas(def, { scale: 0.56 });
      const copy = document.createElement('canvas');
      copy.width = face.width;
      copy.height = face.height;
      copy.getContext('2d')?.drawImage(face, 0, 0);

      const slot = el('div', { class: 'mull-card' }, copy, el('div', { class: 'mull-mark' }, t('mull.mark')));
      slot.addEventListener('click', () => {
        if (this.replace.has(uid)) this.replace.delete(uid);
        else this.replace.add(uid);
        slot.classList.toggle('swap', this.replace.has(uid));
        this.refresh();
      });
      hand.append(slot);
    }

    this.summary = el('p', {});

    const keepAll = el('button', { class: 'sv-btn' }, t('mull.keepAll'));
    keepAll.addEventListener('click', () => {
      this.replace.clear();
      for (const s of Array.from(hand.querySelectorAll('.mull-card'))) s.classList.remove('swap');
      this.refresh();
    });

    const confirm = el('button', { class: 'sv-btn primary', 'data-act': 'mull-confirm', style: 'font-size:16px;padding:15px 44px;' }, t('mull.confirm'));
    confirm.addEventListener('click', () => this.close());

    this.root = el(
      'div',
      { class: 'mull' },
      el('h1', {}, t('mull.title')),
      el('p', {}, t('mull.hint')),
      hand,
      this.summary,
      el('div', { class: 'mull-actions' }, keepAll, confirm),
    );

    opts.container.append(this.root);
    requestAnimationFrame(() => this.root.classList.add('in'));
    this.refresh();
  }

  private refresh(): void {
    const n = this.replace.size;
    this.summary.textContent =
      n === 0 ? t('mull.keeping') : t('mull.redrawing', { n });
  }

  private close(): void {
    const picks = [...this.replace];
    this.root.classList.remove('in');
    window.setTimeout(() => {
      this.root.remove();
      this.opts.onConfirm(picks);
    }, 260);
  }
}
