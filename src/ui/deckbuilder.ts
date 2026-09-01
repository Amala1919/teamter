/**
 * Deck builder: the card pool on the left, the deck list on the right.
 *
 * Legality is enforced live — class, copy limit and the 40-card total — and a
 * card that cannot be added is dimmed rather than silently refused.
 */
import type { CardDef, ClassId } from '../engine/types';
import { CRAFT_CLASSES } from '../engine/types';
import { deckPool } from '../data/decks';
import { tryGetCard } from '../engine/registry';
import { CLASS_THEME, FONT, UI } from '../art/theme';
import { CardGrid, DEFAULT_FILTERS, applyFilters, buildFilterBar, type GridFilters } from './cardgrid';
import { CardDetail } from './detail';
import { COPY_LIMIT, DECK_SIZE, deckSize, saveDeck, statusOf, type SavedDeck } from './decks';
import { el, ensureScreenStyles } from './style';

export class DeckBuilderScreen {
  readonly root: HTMLDivElement;
  private readonly grid = new CardGrid();
  private readonly detail: CardDetail;
  private filters: GridFilters = { ...DEFAULT_FILTERS };

  private readonly listEl: HTMLDivElement;
  private readonly statusEl: HTMLDivElement;
  private readonly curveEl: HTMLDivElement;
  private readonly titleInput: HTMLInputElement;
  private readonly countEl: HTMLElement;

  private deck: SavedDeck;
  private pool: CardDef[] = [];

  constructor(
    deck: SavedDeck,
    private readonly onBack: () => void,
  ) {
    ensureScreenStyles();
    this.deck = { ...deck, cards: { ...deck.cards } };

    const back = el('button', { class: 'sv-btn' }, '← Save & back');
    back.addEventListener('click', () => {
      saveDeck(this.deck);
      this.onBack();
    });

    this.titleInput = el('input', {
      class: 'sv-input',
      value: this.deck.name,
      style: 'width:220px;font-family:' + FONT.display + ';letter-spacing:.06em;',
    }) as HTMLInputElement;
    this.titleInput.addEventListener('input', () => {
      this.deck.name = this.titleInput.value;
    });

    this.countEl = el('div', { class: 'sv-subtitle' });

    const classRow = el('div', { class: 'sv-chiprow' });
    for (const cls of CRAFT_CLASSES) {
      const chip = el('div', { class: 'sv-chip' + (cls === this.deck.leaderClass ? ' on' : '') }, CLASS_THEME[cls].label.replace('craft', ''));
      chip.setAttribute('data-class', '1');
      chip.style.setProperty('--chip-color', CLASS_THEME[cls].primary);
      chip.addEventListener('click', () => this.changeClass(cls));
      classRow.append(chip);
    }

    const bar = el(
      'div',
      { class: 'sv-topbar' },
      back,
      this.titleInput,
      this.countEl,
      el('div', { class: 'sv-spacer' }),
      classRow,
    );

    const filterBar = buildFilterBar(this.filters, (next) => {
      this.filters = next;
      this.refreshGrid();
    }, { showPlayableToggle: true });

    // --- right-hand deck panel -------------------------------------------
    this.listEl = el('div', { class: 'sv-scroll', style: 'flex:1;padding:8px 10px;display:flex;flex-direction:column;gap:3px;' });
    this.curveEl = el('div', { class: 'sv-curve' });
    this.statusEl = el('div', {
      style: 'padding:10px 14px;font-size:12px;line-height:1.6;border-top:1px solid rgba(216,184,101,.18);',
    });

    const panel = el(
      'div',
      { class: 'sv-panel', style: 'width:320px;flex:none;display:flex;flex-direction:column;margin:14px 14px 14px 0;' },
      el('div', { class: 'sv-panel-title' }, 'Deck'),
      this.listEl,
      this.curveEl,
      this.statusEl,
    );

    const body = el(
      'div',
      { style: 'flex:1;display:flex;min-height:0;' },
      el('div', { style: 'flex:1;display:flex;flex-direction:column;min-width:0;' }, this.grid.root),
      panel,
    );

    this.root = el('div', { class: 'sv-screen' }, bar, filterBar, body);
    this.detail = new CardDetail(this.root);

    this.grid.setOptions({
      counts: new Map(),
      onPick: (card) => this.add(card),
      onInspect: (card) => this.detail.open(card),
      isDimmed: (card) => this.atCopyLimit(card),
    });

    this.rebuildPool();
  }

  // -------------------------------------------------------------------------

  private changeClass(cls: ClassId): void {
    if (cls === this.deck.leaderClass) return;
    // Cards of the old class are no longer legal, so drop them rather than
    // leaving an illegal deck behind.
    for (const id of Object.keys(this.deck.cards)) {
      const card = tryGetCard(id);
      if (card && card.cardClass !== 'neutral' && card.cardClass !== cls) delete this.deck.cards[id];
    }
    this.deck.leaderClass = cls;
    for (const chip of Array.from(this.root.querySelectorAll('.sv-topbar .sv-chip'))) {
      chip.classList.toggle('on', chip.textContent === CLASS_THEME[cls].label.replace('craft', ''));
    }
    this.rebuildPool();
  }

  private rebuildPool(): void {
    this.pool = deckPool(this.deck.leaderClass).sort(
      (a, b) => a.cost - b.cost || a.name.localeCompare(b.name),
    );
    this.refreshGrid();
    this.refreshDeck();
  }

  private refreshGrid(): void {
    this.grid.setCards(applyFilters(this.pool, this.filters));
    this.syncGridBadges();
  }

  private syncGridBadges(): void {
    const counts = new Map(Object.entries(this.deck.cards));
    this.grid.setOptions({ counts, isDimmed: (card) => this.atCopyLimit(card) });
  }

  private canAdd(card: CardDef): boolean {
    if (deckSize(this.deck) >= DECK_SIZE) return false;
    return (this.deck.cards[card.id] ?? 0) < COPY_LIMIT;
  }

  /**
   * Only the copy limit dims a card. Greying the whole grid the moment the
   * deck hits 40 reads as a broken screen rather than as "you are done" — the
   * card counter in the top bar carries that instead.
   */
  private atCopyLimit(card: CardDef): boolean {
    return (this.deck.cards[card.id] ?? 0) >= COPY_LIMIT;
  }

  private add(card: CardDef): void {
    if (!this.canAdd(card)) return;
    this.deck.cards[card.id] = (this.deck.cards[card.id] ?? 0) + 1;
    this.afterChange();
  }

  private remove(cardId: string): void {
    const n = this.deck.cards[cardId] ?? 0;
    if (n <= 1) delete this.deck.cards[cardId];
    else this.deck.cards[cardId] = n - 1;
    this.afterChange();
  }

  private afterChange(): void {
    this.syncGridBadges();
    this.refreshDeck();
    saveDeck(this.deck);
  }

  // -------------------------------------------------------------------------

  private refreshDeck(): void {
    const entries = Object.entries(this.deck.cards)
      .map(([id, n]) => ({ card: tryGetCard(id), n }))
      .filter((e): e is { card: CardDef; n: number } => !!e.card)
      .sort((a, b) => a.card.cost - b.card.cost || a.card.name.localeCompare(b.card.name));

    const rows = entries.map(({ card, n }) => {
      const row = el('div', { class: 'sv-deckrow' });
      row.style.setProperty('--row-color', CLASS_THEME[card.cardClass].primary);
      row.append(el('div', { class: 'cost' }, String(card.cost)), el('div', { class: 'name' }, card.name));
      if (card.implemented === false) {
        row.append(el('span', { style: 'font-size:9px;color:#FFC08A;letter-spacing:.08em;' }, 'PARTIAL'));
      }
      row.append(el('div', { class: 'n' }, `×${n}`));
      row.title = `${card.name} — click to remove one`;
      row.addEventListener('click', () => this.remove(card.id));
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.detail.open(card);
      });
      return row;
    });

    this.listEl.replaceChildren(
      ...(rows.length > 0 ? rows : [el('div', { class: 'sv-empty', style: 'padding:30px 10px;' }, 'Click cards to add them.')]),
    );

    // Cost curve, 1..7+.
    const buckets = new Array(7).fill(0) as number[];
    for (const { card, n } of entries) buckets[Math.min(Math.max(card.cost, 1), 7) - 1] += n;
    const peak = Math.max(1, ...buckets);
    this.curveEl.replaceChildren(
      ...buckets.map((v, i) =>
        el(
          'div',
          { class: 'bar' },
          el('div', { class: 'fill', style: `height:${(v / peak) * 34}px;opacity:${v ? 1 : 0.25};` }),
          el('div', { class: 'lab' }, i === 6 ? '7+' : String(i + 1)),
        ),
      ),
    );

    const size = deckSize(this.deck);
    const status = statusOf(this.deck);
    this.countEl.textContent = `${size} / ${DECK_SIZE}${size >= DECK_SIZE ? ' — full' : ''}`;
    this.countEl.style.color = size === DECK_SIZE ? UI.heal : size > DECK_SIZE ? UI.damage : UI.textDim;

    const lines: (Node | string)[] = [];
    if (size !== DECK_SIZE) {
      lines.push(
        el(
          'div',
          { style: `color:${UI.textDim};` },
          size < DECK_SIZE ? `Add ${DECK_SIZE - size} more card${DECK_SIZE - size === 1 ? '' : 's'}.` : `Remove ${size - DECK_SIZE}.`,
        ),
      );
    } else if (status.legal) {
      lines.push(el('div', { style: `color:${UI.heal};font-weight:700;` }, 'Legal deck — ready to play.'));
    }
    for (const err of status.errors.slice(0, 3)) {
      lines.push(el('div', { style: `color:${UI.damage};` }, err));
    }
    if (status.partial.length > 0) {
      lines.push(
        el(
          'div',
          { style: 'color:#FFC08A;' },
          `${status.partial.length} card${status.partial.length === 1 ? '' : 's'} not fully implemented.`,
        ),
      );
    }
    this.statusEl.replaceChildren(...lines);
  }

  dispose(): void {
    saveDeck(this.deck);
    this.grid.dispose();
    this.root.remove();
  }
}
