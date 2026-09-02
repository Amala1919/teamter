/**
 * Home screen: pick a deck, pick an opponent, and go.
 */
import type { ClassId } from '../engine/types';
import { CRAFT_CLASSES } from '../engine/types';
import { CLASS_THEME, FONT, UI } from '../art/theme';
import { drawIllustration } from '../art/illustration';
import {
  createDeck,
  deckSize,
  deleteDeck,
  listDecks,
  saveDeck,
  selectedDeckId,
  setSelectedDeckId,
  statusOf,
  type SavedDeck,
} from './decks';
import { el, ensureScreenStyles } from './style';
import { className, isJa, t } from '../i18n';
import { DECK_SIZE } from './decks';

export interface MenuCallbacks {
  onPlay: (deck: SavedDeck, opponentClass: ClassId) => void;
  onEditDeck: (deck: SavedDeck) => void;
  onCollection: () => void;
  onOpenPack: () => void;
}

/** A small class emblem panel, painted with the illustration generator. */
function classBanner(cls: ClassId, w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (ctx) {
    drawIllustration(ctx, w, h, {
      id: `banner_${cls}`,
      name: className(CLASS_THEME[cls]),
      cardClass: cls,
      set: 'basic',
      rarity: 'legendary',
      type: 'follower',
      cost: 6,
      atk: 0,
      def: 0,
      text: '',
      artSeed: 0x3f10a7 ^ cls.charCodeAt(0) * 977,
    });
  }
  return c;
}

export class MenuScreen {
  readonly root: HTMLDivElement;
  private opponent: ClassId = 'shadow';
  private selected: string | null = selectedDeckId();
  private readonly deckList: HTMLDivElement;
  private readonly hero: HTMLDivElement;

  constructor(private readonly cb: MenuCallbacks) {
    ensureScreenStyles();

    const bar = el(
      'div',
      { class: 'sv-topbar' },
      el('div', { class: 'sv-title' }, t('menu.title')),
      el('div', { class: 'sv-subtitle' }, t('menu.tagline')),
      el('div', { class: 'sv-spacer' }),
      (() => {
        const b = el('button', { class: 'sv-btn', 'data-act': 'pack' }, t('menu.pack'));
        b.addEventListener('click', () => this.cb.onOpenPack());
        return b;
      })(),
      (() => {
        const b = el('button', { class: 'sv-btn', 'data-act': 'collection' }, t('menu.collection'));
        b.addEventListener('click', () => this.cb.onCollection());
        return b;
      })(),
    );

    this.deckList = el('div', { class: 'sv-scroll', style: 'flex:1;padding:10px;display:flex;flex-direction:column;gap:8px;' });
    this.hero = el('div', {
      style: 'flex:1;position:relative;display:flex;flex-direction:column;justify-content:flex-end;padding:34px;gap:20px;min-width:0;',
    });

    const newDeck = el('button', { class: 'sv-btn', 'data-act': 'new-deck', style: 'margin:10px;' }, t('menu.newDeckBtn'));
    newDeck.addEventListener('click', () => {
      const deck = createDeck('sword', t('menu.newDeck'));
      saveDeck(deck);
      this.cb.onEditDeck(deck);
    });

    const decksPanel = el(
      'div',
      { class: 'sv-panel', style: 'width:300px;flex:none;display:flex;flex-direction:column;margin:18px;' },
      el('div', { class: 'sv-panel-title' }, t('menu.decks')),
      this.deckList,
      newDeck,
    );

    this.root = el(
      'div',
      { class: 'sv-screen' },
      bar,
      el('div', { style: 'flex:1;display:flex;min-height:0;' }, decksPanel, this.hero),
    );

    this.refresh();
  }

  private refresh(): void {
    const decks = listDecks();
    if (!this.selected && decks[0]) this.selected = decks[0].id;

    this.deckList.replaceChildren(
      ...(decks.length === 0
        ? [el('div', { class: 'sv-empty', style: 'padding:30px 10px;' }, t('menu.noDecks'))]
        : decks.map((deck) => this.deckRow(deck))),
    );

    this.refreshHero(decks.find((d) => d.id === this.selected));
  }

  private deckRow(deck: SavedDeck): HTMLElement {
    const theme = CLASS_THEME[deck.leaderClass];
    const status = statusOf(deck);
    const size = deckSize(deck);
    const on = deck.id === this.selected;

    const row = el('div', {
      style: [
        'display:flex;align-items:center;gap:11px;padding:10px 12px;border-radius:9px;cursor:pointer;',
        `border:1px solid ${on ? 'rgba(216,184,101,.65)' : 'rgba(216,184,101,.16)'};`,
        `background:${on ? 'rgba(216,184,101,.13)' : 'rgba(255,255,255,.02)'};`,
        'transition:all .16s ease;',
      ].join(''),
    });

    row.append(
      el('div', {
        style: `width:6px;align-self:stretch;border-radius:3px;background:${theme.primary};box-shadow:0 0 12px ${theme.primary}66;`,
      }),
      el(
        'div',
        { style: 'flex:1;min-width:0;' },
        el('div', { style: 'font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' }, deck.name),
        el(
          'div',
          { style: `font-size:11px;letter-spacing:.06em;color:${status.legal ? UI.textDim : UI.damage};` },
          `${className(theme)} · ${size}/${DECK_SIZE}${status.legal ? '' : t('menu.incomplete')}`,
        ),
      ),
    );

    const edit = el('button', { class: 'sv-btn', 'data-act': 'edit-deck', style: 'padding:6px 11px;font-size:10px;' }, t('menu.edit'));
    edit.addEventListener('click', (e) => {
      e.stopPropagation();
      this.cb.onEditDeck(deck);
    });
    const del = el('button', { class: 'sv-btn danger', style: 'padding:6px 10px;font-size:10px;' }, '✕');
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteDeck(deck.id);
      if (this.selected === deck.id) this.selected = null;
      this.refresh();
    });
    row.append(edit, del);

    row.addEventListener('click', () => {
      this.selected = deck.id;
      setSelectedDeckId(deck.id);
      this.refresh();
    });
    return row;
  }

  private refreshHero(deck: SavedDeck | undefined): void {
    this.hero.replaceChildren();
    if (!deck) {
      this.hero.append(el('div', { class: 'sv-empty' }, t('menu.createFirst')));
      return;
    }

    const theme = CLASS_THEME[deck.leaderClass];
    const status = statusOf(deck);

    // Full-bleed class art behind the panel.
    // A wide canvas keeps the generated figure small relative to the panel.
    const art = classBanner(deck.leaderClass, 1600, 460);
    art.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.42;' +
      '-webkit-mask-image:linear-gradient(180deg,transparent,#000 45%);mask-image:linear-gradient(180deg,transparent,#000 45%);';
    this.hero.append(art);

    const heading = el(
      'div',
      { style: 'position:relative;' },
      el(
        'div',
        {
          style: `font-family:${FONT.display};font-size:52px;font-weight:700;letter-spacing:.08em;color:${theme.accent};text-shadow:0 6px 30px rgba(0,0,0,.9);`,
        },
        deck.name,
      ),
      el(
        'div',
        { style: `font-size:13px;letter-spacing:.16em;text-transform:uppercase;color:${UI.textDim};margin-top:4px;` },
        `${className(theme)} · ${isJa ? theme.label : theme.labelJa}`,
      ),
    );

    const oppRow = el(
      'div',
      { class: 'sv-chiprow', style: 'position:relative;' },
      el('span', { style: 'font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:#6B7386;' }, t('menu.opponent')),
    );
    for (const cls of CRAFT_CLASSES) {
      const chip = el('div', { class: 'sv-chip' + (cls === this.opponent ? ' on' : '') }, className(CLASS_THEME[cls]).replace('craft', ''));
      chip.setAttribute('data-class', '1');
      chip.style.setProperty('--chip-color', CLASS_THEME[cls].primary);
      chip.addEventListener('click', () => {
        this.opponent = cls;
        this.refreshHero(deck);
      });
      oppRow.append(chip);
    }

    const play = el('button', { class: 'sv-btn primary', 'data-act': 'battle', style: 'position:relative;align-self:flex-start;font-size:17px;padding:16px 46px;' }, t('menu.battle'));
    play.disabled = !status.legal;
    play.addEventListener('click', () => this.cb.onPlay(deck, this.opponent));

    const note = status.legal
      ? status.partial.length > 0
        ? el('div', { style: 'position:relative;font-size:12px;color:#FFC08A;' }, t('menu.partialNote', { n: status.partial.length }))
        : null
      : el('div', { style: `position:relative;font-size:12px;color:${UI.damage};` }, status.errors[0] ?? t('menu.illegal'));

    this.hero.append(heading, oppRow, play, note ?? el('div'));
  }

  dispose(): void {
    this.root.remove();
  }
}
