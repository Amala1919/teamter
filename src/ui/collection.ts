/**
 * Card collection: every card in the game, filterable, with a detail view.
 */
import { builtCards } from '../data/index';
import type { CardDef } from '../engine/types';
import { UI } from '../art/theme';
import { CardGrid, DEFAULT_FILTERS, applyFilters, buildFilterBar, type GridFilters } from './cardgrid';
import { CardDetail } from './detail';
import { el, ensureScreenStyles } from './style';

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
      .sort((a, b) => a.cost - b.cost || a.cardClass.localeCompare(b.cardClass) || a.name.localeCompare(b.name));

    this.countLabel = el('div', { class: 'sv-subtitle' });

    const back = el('button', { class: 'sv-btn' }, '← Back');
    back.addEventListener('click', () => this.onBack());

    const bar = el(
      'div',
      { class: 'sv-topbar' },
      back,
      el('div', { class: 'sv-title' }, 'Collection'),
      this.countLabel,
      el('div', { class: 'sv-spacer' }),
      el('div', { class: 'sv-subtitle' }, 'Right-click or long-press a card for details'),
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
      `${shown.length} of ${this.all.length}` + (partial > 0 ? ` · ${partial} partial` : '');
    this.countLabel.style.color = partial > 0 ? '#FFC08A' : UI.textDim;
  }

  dispose(): void {
    this.grid.dispose();
    this.root.remove();
  }
}
