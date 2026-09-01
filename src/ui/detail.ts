/**
 * Card detail overlay: the full-size card, its evolved side, and everything
 * printed on it that will not fit on the frame.
 */
import type { CardDef } from '../engine/types';
import { KEYWORD_LABEL } from '../engine/types';
import { cardFaceCanvas } from '../art/cardface';
import { CLASS_THEME, RARITY_THEME } from '../art/theme';
import { SET_LABEL } from './cardgrid';
import { el } from './style';
import { tryGetCard } from '../engine/registry';

export class CardDetail {
  readonly root: HTMLDivElement;
  private card: CardDef | null = null;
  private showEvolved = false;
  private readonly stage: HTMLDivElement;
  private readonly info: HTMLDivElement;

  constructor(container: HTMLElement) {
    this.stage = el('div', { style: 'display:flex;flex-direction:column;align-items:center;gap:14px;' });
    this.info = el('div', { class: 'sv-detail-info' });
    this.root = el('div', { class: 'sv-detail' }, this.stage, this.info);

    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) this.close();
    });
    container.append(this.root);
  }

  open(card: CardDef): void {
    this.card = card;
    this.showEvolved = false;
    this.render();
    this.root.classList.add('open');
  }

  close(): void {
    this.root.classList.remove('open');
  }

  get isOpen(): boolean {
    return this.root.classList.contains('open');
  }

  private render(): void {
    const card = this.card;
    if (!card) return;
    const theme = CLASS_THEME[card.cardClass];
    const rarity = RARITY_THEME[card.rarity];

    // Card face, at a scale that stays sharp on a large screen.
    const canvas = cardFaceCanvas(card, { scale: 1, evolved: this.showEvolved });
    const copy = document.createElement('canvas');
    copy.width = canvas.width;
    copy.height = canvas.height;
    copy.getContext('2d')?.drawImage(canvas, 0, 0);

    this.stage.replaceChildren(copy);

    if (card.type === 'follower') {
      const toggle = el('button', { class: 'sv-btn' }, this.showEvolved ? 'Base form' : 'Evolved form');
      toggle.addEventListener('click', () => {
        this.showEvolved = !this.showEvolved;
        this.render();
      });
      this.stage.append(toggle);
    }

    const rows: (Node | string)[] = [
      el('h2', {}, card.name),
      card.nameJa ? el('div', { class: 'meta', style: 'font-size:15px;text-transform:none;letter-spacing:.04em;' }, card.nameJa) : null,
      el(
        'div',
        { class: 'meta' },
        `${theme.label} · ${card.type} · ${rarity.label} · ${SET_LABEL[card.set]}`,
      ),
    ].filter(Boolean) as Node[];

    const stats: string[] = [`${card.cost} PP`];
    if (card.type === 'follower') {
      stats.push(`${card.atk}/${card.def}`, `evolved ${card.evoAtk}/${card.evoDef}`);
    }
    if (card.countdown !== undefined) stats.push(`Countdown ${card.countdown}`);
    if (card.traits?.length) stats.push(card.traits.join(', '));
    rows.push(el('div', { class: 'meta' }, stats.join('  ·  ')));

    if (card.text) {
      rows.push(
        el('div', { style: 'font-size:14px;line-height:1.7;white-space:pre-wrap;' }, card.text),
      );
    }
    if (card.evoText && card.evoText !== card.text) {
      rows.push(
        el(
          'div',
          { style: 'font-size:13px;line-height:1.7;white-space:pre-wrap;color:#FFC08A;' },
          `Evolved:\n${card.evoText}`,
        ),
      );
    }

    const kws = card.keywords ?? [];
    if (kws.length > 0) {
      rows.push(
        el(
          'div',
          { class: 'sv-chiprow' },
          ...kws.map((k) => el('div', { class: 'sv-chip on' }, KEYWORD_LABEL[k])),
        ),
      );
    }

    if (card.creates?.length) {
      const names = card.creates.map((id) => tryGetCard(id)?.name ?? id);
      rows.push(el('div', { class: 'meta' }, `Creates: ${names.join(', ')}`));
    }

    if (card.implemented === false) {
      rows.push(
        el(
          'div',
          { class: 'warn' },
          'Not fully implemented yet. These lines have no engine behaviour:\n' +
            (card.missingText ?? []).map((l) => `• ${l}`).join('\n'),
        ),
      );
    }

    if (card.flavor) rows.push(el('div', { class: 'flavor' }, `“${card.flavor}”`));

    const close = el('button', { class: 'sv-btn', style: 'align-self:flex-start;' }, 'Close');
    close.addEventListener('click', () => this.close());
    rows.push(close);

    this.info.replaceChildren(...rows);
  }
}
