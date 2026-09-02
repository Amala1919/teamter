/**
 * The card grid shared by the collection and the deck builder.
 *
 * Card faces are painted on demand: rendering 800 canvases up front would cost
 * several seconds and hundreds of megabytes, so slots start as empty plates and
 * an IntersectionObserver fills them as they scroll into view.
 */
import type { CardDef, ClassId, Rarity, SetId } from '../engine/types';
import { CRAFT_CLASSES, SET_ORDER } from '../engine/types';
import { cardFaceCanvas } from '../art/cardface';
import { CLASS_THEME, RARITY_THEME } from '../art/theme';
import { el } from './style';
import { className, t } from '../i18n';

export interface GridFilters {
  text: string;
  cardClass: ClassId | 'all';
  set: SetId | 'all';
  rarity: Rarity | 'all';
  type: CardDef['type'] | 'all';
  cost: number | 'all';
  /** Hides cards with unimplemented rules text. */
  playableOnly: boolean;
}

export const DEFAULT_FILTERS: GridFilters = {
  text: '',
  cardClass: 'all',
  set: 'all',
  rarity: 'all',
  type: 'all',
  cost: 'all',
  playableOnly: false,
};

export function applyFilters(cards: CardDef[], f: GridFilters): CardDef[] {
  const needle = f.text.trim().toLowerCase();
  return cards.filter((c) => {
    if (f.cardClass !== 'all' && c.cardClass !== f.cardClass) return false;
    if (f.set !== 'all' && c.set !== f.set) return false;
    if (f.rarity !== 'all' && c.rarity !== f.rarity) return false;
    if (f.type !== 'all' && c.type !== f.type) return false;
    if (f.cost !== 'all') {
      // The top bucket is "7 or more", as in the original's filter row.
      if (f.cost >= 7 ? c.cost < 7 : c.cost !== f.cost) return false;
    }
    if (f.playableOnly && c.implemented === false) return false;
    if (needle) {
      const hay =
        `${c.name} ${c.nameJa ?? ''} ${c.text} ${c.textJa ?? ''} ${c.traits?.join(' ') ?? ''}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
}

export interface CardGridOptions {
  /** Copies already in the deck, shown as a count badge. */
  counts?: Map<string, number>;
  onPick?: (card: CardDef, ev: MouseEvent) => void;
  onInspect?: (card: CardDef) => void;
  /** Renders a card that cannot currently be added as dimmed. */
  isDimmed?: (card: CardDef) => boolean;
}

export class CardGrid {
  readonly root: HTMLDivElement;
  private readonly observer: IntersectionObserver;
  private cards: CardDef[] = [];
  private opts: CardGridOptions;
  /** The card each slot shows, so painting does not search the list. */
  private readonly slotCard = new WeakMap<HTMLElement, CardDef>();
  /** Slots waiting to be painted, drained a few per frame. */
  private queue: HTMLElement[] = [];
  private raf = 0;

  constructor(opts: CardGridOptions = {}) {
    this.opts = opts;
    this.root = el('div', { class: 'sv-grid sv-scroll' });
    this.root.style.flex = '1';

    // Painting a card face is a few milliseconds; doing it only for visible
    // slots keeps scrolling smooth over the whole 825-card collection.
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const slot = entry.target as HTMLElement;
          this.observer.unobserve(slot);
          this.queue.push(slot);
        }
        // A fast scroll can reveal thirty slots in one callback. Painting them
        // all here would drop a frame; the queue spreads them out instead.
        this.schedule();
      },
      { root: this.root, rootMargin: '400px 0px' },
    );
  }

  /** Paints a few queued slots per frame, so scrolling never stalls. */
  private schedule(): void {
    if (this.raf || this.queue.length === 0) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      const budget = 3;
      for (let i = 0; i < budget && this.queue.length > 0; i++) {
        const slot = this.queue.shift();
        if (slot?.isConnected) this.paint(slot);
      }
      this.schedule();
    });
  }

  setCards(cards: CardDef[]): void {
    this.cards = cards;
    this.render();
  }

  setOptions(opts: CardGridOptions): void {
    this.opts = { ...this.opts, ...opts };
    this.refreshBadges();
  }

  private render(): void {
    this.observer.disconnect();
    this.queue = [];
    this.root.replaceChildren();

    if (this.cards.length === 0) {
      this.root.append(el('div', { class: 'sv-empty' }, t('grid.noMatch')));
      return;
    }

    for (const card of this.cards) {
      const slot = el('div', { class: 'sv-cardslot' });
      slot.dataset.id = card.id;
      this.slotCard.set(slot, card);
      slot.append(el('div', { class: 'placeholder' }));

      slot.addEventListener('click', (e) => this.opts.onPick?.(card, e));
      slot.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.opts.onInspect?.(card);
      });
      // Long-press opens the detail view on touch, where there is no right
      // click and no hover.
      let timer = 0;
      slot.addEventListener('pointerdown', () => {
        timer = window.setTimeout(() => this.opts.onInspect?.(card), 480);
      });
      for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) {
        slot.addEventListener(ev, () => window.clearTimeout(timer));
      }

      this.root.append(slot);
      this.observer.observe(slot);
    }
    this.refreshBadges();
  }

  private paint(slot: HTMLElement): void {
    const card = this.slotCard.get(slot);
    if (!card || slot.querySelector('canvas')) return;
    const canvas = cardFaceCanvas(card, { scale: 0.42 });
    // The cache hands back one canvas per card; the grid needs its own copy so
    // the same card can appear in more than one place.
    const copy = document.createElement('canvas');
    copy.width = canvas.width;
    copy.height = canvas.height;
    copy.getContext('2d')?.drawImage(canvas, 0, 0);
    slot.querySelector('.placeholder')?.remove();
    slot.prepend(copy);
  }

  /** Updates count badges and dimming without repainting any card face. */
  refreshBadges(): void {
    for (const slot of Array.from(this.root.children) as HTMLElement[]) {
      const id = slot.dataset.id;
      if (!id) continue;
      const card = this.cards.find((c) => c.id === id);
      if (!card) continue;

      slot.querySelector('.sv-count')?.remove();
      slot.querySelector('.sv-badge')?.remove();

      const n = this.opts.counts?.get(id) ?? 0;
      if (n > 0) slot.append(el('div', { class: 'sv-count' }, `×${n}`));
      if (card.implemented === false) slot.append(el('div', { class: 'sv-badge' }, t('grid.partial')));
      slot.classList.toggle('dim', !!this.opts.isDimmed?.(card));
    }
  }

  dispose(): void {
    this.observer.disconnect();
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.queue = [];
    this.root.remove();
  }
}

// ---------------------------------------------------------------------------
// Filter bar
// ---------------------------------------------------------------------------

export function buildFilterBar(
  filters: GridFilters,
  onChange: (next: GridFilters) => void,
  opts: { showPlayableToggle?: boolean } = {},
): HTMLElement {
  const bar = el('div', {
    class: 'sv-chiprow',
    style: 'padding:12px 22px;gap:14px;border-bottom:1px solid rgba(216,184,101,.16);',
  });

  const state = { ...filters };
  const emit = () => onChange({ ...state });

  const search = el('input', {
    class: 'sv-input',
    placeholder: t('filter.search'),
    value: state.text,
    style: 'width:200px;',
  }) as HTMLInputElement;
  search.addEventListener('input', () => {
    state.text = search.value;
    emit();
  });
  bar.append(search);

  const group = (label: string, items: { key: string; label: string; color?: string }[], get: () => string, set: (k: string) => void) => {
    // `data-group` / `data-key` give the end-to-end test stable handles that do
    // not move when the interface language or the copy changes.
    const wrap = el('div', { class: 'sv-chiprow', style: 'gap:5px;' });
    wrap.append(
      el('span', { style: 'font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#6B7386;margin-right:2px;' }, label),
    );
    for (const item of items) {
      // `data-key` gives the end-to-end test a handle that does not move when
      // the interface language changes.
      const chip = el('div', { class: 'sv-chip' }, item.label);
      chip.setAttribute('data-key', item.key);
      if (item.color) {
        chip.setAttribute('data-class', '1');
        chip.style.setProperty('--chip-color', item.color);
      }
      chip.addEventListener('click', () => {
        set(item.key);
        for (const c of Array.from(wrap.querySelectorAll('.sv-chip'))) c.classList.remove('on');
        chip.classList.add('on');
        emit();
      });
      if (get() === item.key) chip.classList.add('on');
      wrap.append(chip);
    }
    bar.append(wrap);
  };

  group(
    t('filter.class'),
    [
      { key: 'all', label: t('filter.all') },
      ...CRAFT_CLASSES.map((c) => ({ key: c, label: className(CLASS_THEME[c]).replace('craft', ''), color: CLASS_THEME[c].primary })),
      { key: 'neutral', label: className(CLASS_THEME.neutral), color: CLASS_THEME.neutral.primary },
    ],
    () => state.cardClass,
    (k) => (state.cardClass = k as GridFilters['cardClass']),
  );

  group(
    t('filter.cost'),
    [{ key: 'all', label: t('filter.all') }, ...[1, 2, 3, 4, 5, 6, 7].map((n) => ({ key: String(n), label: n === 7 ? '7+' : String(n) }))],
    () => String(state.cost),
    (k) => (state.cost = k === 'all' ? 'all' : Number(k)),
  );

  group(
    t('filter.type'),
    [
      { key: 'all', label: t('filter.all') },
      { key: 'follower', label: t('type.follower') },
      { key: 'spell', label: t('type.spell') },
      { key: 'amulet', label: t('type.amulet') },
    ],
    () => state.type,
    (k) => (state.type = k as GridFilters['type']),
  );

  group(
    t('filter.rarity'),
    [
      { key: 'all', label: t('filter.all') },
      ...(['bronze', 'silver', 'gold', 'legendary'] as Rarity[]).map((r) => ({
        key: r,
        label: t(`rarity.${r}` as const),
        color: RARITY_THEME[r].gem,
      })),
    ],
    () => state.rarity,
    (k) => (state.rarity = k as GridFilters['rarity']),
  );

  group(
    t('filter.set'),
    [
      { key: 'all', label: t('filter.all') },
      ...SET_ORDER.map((s) => ({ key: s, label: SET_LABEL[s] })),
    ],
    () => state.set,
    (k) => (state.set = k as GridFilters['set']),
  );

  if (opts.showPlayableToggle) {
    const chip = el('div', { class: 'sv-chip' + (state.playableOnly ? ' on' : '') }, t('filter.implemented'));
    chip.setAttribute('data-key', 'implemented-only');
    chip.title = t('filter.implementedHint');
    chip.addEventListener('click', () => {
      state.playableOnly = !state.playableOnly;
      chip.classList.toggle('on', state.playableOnly);
      emit();
    });
    bar.append(chip);
  }

  return bar;
}

export const SET_LABEL: Record<SetId, string> = {
  basic: t('set.basic'),
  standard: t('set.standard'),
  darkness: t('set.darkness'),
  bahamut: t('set.bahamut'),
  tempest: t('set.tempest'),
  wonderland: t('set.wonderland'),
};
