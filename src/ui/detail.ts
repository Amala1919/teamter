/**
 * Card detail overlay: the full-size card, its evolved side, and everything
 * printed on it that will not fit on the frame.
 */
import type { CardDef, Keyword } from '../engine/types';
import { KEYWORD_LABEL, KEYWORD_LABEL_JA } from '../engine/types';
import { cardFaceCanvas } from '../art/cardface';
import { CLASS_THEME } from '../art/theme';
import { SET_LABEL } from './cardgrid';
import { el } from './style';
import { tryGetCard } from '../engine/registry';
import { cardEvoText, cardFlavor, cardName, cardText, className, isJa, t } from '../i18n';

/**
 * Live state for a card that is actually on the board, shown above the printed
 * text. During a match a card's real stats and keywords routinely differ from
 * what is printed on it, and the printed side alone would be misleading.
 */
export interface LiveCardState {
  owner: 'you' | 'foe';
  atk?: number;
  def?: number;
  maxDef?: number;
  evolved?: boolean;
  countdown?: number;
  keywords?: Keyword[];
}

export class CardDetail {
  readonly root: HTMLDivElement;
  private card: CardDef | null = null;
  private live: LiveCardState | null = null;
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

  open(card: CardDef, live?: LiveCardState): void {
    this.card = card;
    this.live = live ?? null;
    this.showEvolved = live?.evolved ?? false;
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

    // Card face, at a scale that stays sharp on a large screen.
    const canvas = cardFaceCanvas(card, { scale: 1, evolved: this.showEvolved });
    const copy = document.createElement('canvas');
    copy.width = canvas.width;
    copy.height = canvas.height;
    copy.getContext('2d')?.drawImage(canvas, 0, 0);

    this.stage.replaceChildren(copy);

    if (card.type === 'follower') {
      const toggle = el('button', { class: 'sv-btn', 'data-act': 'toggle-evolved' }, t(this.showEvolved ? 'detail.baseForm' : 'detail.evolvedForm'));
      toggle.addEventListener('click', () => {
        this.showEvolved = !this.showEvolved;
        this.render();
      });
      this.stage.append(toggle);
    }

    const rows: (Node | string)[] = [
      el('h2', {}, cardName(card)),
      // The other language's name, so a card is findable under either.
      el(
        'div',
        { class: 'meta', style: 'font-size:15px;text-transform:none;letter-spacing:.04em;' },
        isJa ? card.name : (card.nameJa ?? card.name),
      ),
      el(
        'div',
        { class: 'meta' },
        `${className(theme)} · ${t(`type.${card.type}` as const)} · ${t(`rarity.${card.rarity}` as const)} · ${SET_LABEL[card.set]}`,
      ),
    ].filter(Boolean) as Node[];

    const stats: string[] = [t('detail.pp', { n: card.cost })];
    if (card.type === 'follower') {
      stats.push(
        t('detail.stats', { atk: card.atk ?? 0, def: card.def ?? 0 }),
        t('detail.evoStats', { atk: card.evoAtk ?? 0, def: card.evoDef ?? 0 }),
      );
    }
    if (card.countdown !== undefined) stats.push(t('detail.countdown', { n: card.countdown }));
    if (card.traits?.length) stats.push(card.traits.join(', '));
    rows.push(el('div', { class: 'meta' }, stats.join('  ·  ')));

    // Live board state first: during a match this is what the player needs.
    const live = this.live;
    if (live) {
      const bits: string[] = [t(live.owner === 'you' ? 'inspect.owner.you' : 'inspect.owner.foe')];
      if (live.atk !== undefined && live.def !== undefined) {
        // Damage already taken shows as "current of maximum".
        const def =
          live.maxDef !== undefined && live.maxDef !== live.def
            ? `${live.def} (${live.maxDef})`
            : String(live.def);
        bits.push(t('inspect.stats', { atk: live.atk, def }));
      }
      if (live.evolved) bits.push(t('inspect.evolvedNow'));
      if (live.countdown !== undefined) bits.push(t('inspect.countdownNow', { n: live.countdown }));
      rows.push(
        el(
          'div',
          { class: 'meta', style: 'color:#FFD98A;text-transform:none;letter-spacing:.04em;' },
          `${t('inspect.onBoard')} — ${bits.join('  ·  ')}`,
        ),
      );
      if (live.keywords?.length) {
        rows.push(
          el(
            'div',
            { class: 'sv-chiprow' },
            ...live.keywords.map((k) =>
              el('div', { class: 'sv-chip on' }, (isJa ? KEYWORD_LABEL_JA : KEYWORD_LABEL)[k]),
            ),
          ),
        );
      }
    }

    const text = cardText(card);
    const evoText = cardEvoText(card);
    if (text) {
      rows.push(el('div', { style: 'font-size:14px;line-height:1.7;white-space:pre-wrap;' }, text));
    }
    if (evoText && evoText !== text) {
      rows.push(
        el(
          'div',
          { style: 'font-size:13px;line-height:1.7;white-space:pre-wrap;color:#FFC08A;' },
          `${t('detail.evolved')}\n${evoText}`,
        ),
      );
    }

    // The printed keywords are redundant once the live ones are listed.
    const kws = live ? [] : (card.keywords ?? []);
    if (kws.length > 0) {
      rows.push(
        el(
          'div',
          { class: 'sv-chiprow' },
          ...kws.map((k) => el('div', { class: 'sv-chip on' }, (isJa ? KEYWORD_LABEL_JA : KEYWORD_LABEL)[k])),
        ),
      );
    }

    if (card.creates?.length) {
      const names = card.creates.map((id) => {
        const c = tryGetCard(id);
        return c ? cardName(c) : id;
      });
      rows.push(el('div', { class: 'meta' }, `${t('detail.creates')} ${names.join('、')}`));
    }

    if (card.implemented === false) {
      rows.push(
        el(
          'div',
          { class: 'warn' },
          `${t('detail.missingLead')}\n` + (card.missingText ?? []).map((l) => `• ${l}`).join('\n'),
        ),
      );
    }

    const flavor = cardFlavor(card);
    if (flavor) rows.push(el('div', { class: 'flavor' }, `“${flavor}”`));

    const close = el('button', { class: 'sv-btn', 'data-act': 'close-detail', style: 'align-self:flex-start;' }, t('detail.close'));
    close.addEventListener('click', () => this.close());
    rows.push(close);

    this.info.replaceChildren(...rows);
  }
}
