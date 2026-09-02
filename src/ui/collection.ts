/**
 * Card collection: every card in the game, filterable, with a detail view.
 */
import { builtCards } from '../data/index';
import type { CardDef } from '../engine/types';
import { UI } from '../art/theme';
import { CardGrid, DEFAULT_FILTERS, applyFilters, buildFilterBar, type GridFilters } from './cardgrid';
import { CardDetail } from './detail';
import { el, ensureScreenStyles } from './style';
import { cardName, t } from '../i18n';

export class CollectionScreen {
  readonly root: HTMLDivElement;
  private readonly grid = new CardGrid();
  private readonly detail: CardDetail;
  private filters: GridFilters = { ...DEFAULT_FILTERS };
  private readonly countLabel: HTMLElement;
  private readonly all: CardDef[];

  constructor(private readonly onBack: () => void) {
    ensureScreenStyles();
    this.all = builtCards()
      .filter((c) => !c.token)
      .sort((a, b) => a.cost - b.cost || a.cardClass.localeCompare(b.cardClass) || cardName(a).localeCompare(cardName(b), 'ja'));

    this.countLabel = el('div', { class: 'sv-subtitle' });

    const back = el('button', { class: 'sv-btn', 'data-act': 'back' }, t('collection.back'));
    back.addEventListener('click', () => this.onBack());

    const bar = el(
      'div',
      { class: 'sv-topbar' },
      back,
      el('div', { class: 'sv-title' }, t('collection.title')),
      this.countLabel,
      el('div', { class: 'sv-spacer' }),
      el('div', { class: 'sv-subtitle' }, t('collection.hint')),
    );

    const filterBar = buildFilterBar(this.filters, (next) => {
      this.filters = next;
      this.refresh();
    }, { showPlayableToggle: true });

    this.root = el('div', { class: 'sv-screen' }, bar, filterBar, this.grid.root);
    this.detail = new CardDetail(this.root);

    this.grid.setOptions({
      onPick: (card) => this.detail.open(card),
      onInspect: (card) => this.detail.open(card),
    });

    this.refresh();
  }

  private refresh(): void {
    const shown = applyFilters(this.all, this.filters);
    this.grid.setCards(shown);
    const partial = shown.filter((c) => c.implemented === false).length;
    this.countLabel.textContent =
      t('collection.count', { n: shown.length, total: this.all.length }) +
      (partial > 0 ? t('collection.partialCount', { n: partial }) : '');
    this.countLabel.style.color = partial > 0 ? '#FFC08A' : UI.textDim;
  }

  dispose(): void {
    this.grid.dispose();
    this.root.remove();
  }
}
