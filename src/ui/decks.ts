/**
 * Saved decks.
 *
 * Stored in localStorage as ids plus counts, so a saved deck survives a change
 * to the card database as long as the ids hold. Anything unknown on load is
 * dropped and reported rather than silently swallowed.
 */
import type { ClassId } from '../engine/types';
import { RULES } from '../engine/types';
import type { DeckList } from '../engine/game';
import { tryGetCard } from '../engine/registry';
import { buildStarterDeck, validateDeck } from '../data/decks';
import { CRAFT_CLASSES } from '../engine/types';

const KEY = 'teamter.decks.v1';
const SELECTED_KEY = 'teamter.selectedDeck.v1';

export interface SavedDeck {
  id: string;
  name: string;
  leaderClass: ClassId;
  /** Card id -> copies. */
  cards: Record<string, number>;
  updated: number;
}

function newId(): string {
  return `deck_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
}

function read(): SavedDeck[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SavedDeck[]) : [];
  } catch {
    return [];
  }
}

function write(decks: SavedDeck[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(decks));
  } catch {
    // Storage can be unavailable (private windows, blocked site data). A deck
    // that cannot be saved is not worth losing the session over.
  }
}

export function listDecks(): SavedDeck[] {
  return read().sort((a, b) => b.updated - a.updated);
}

export function saveDeck(deck: SavedDeck): void {
  const all = read().filter((d) => d.id !== deck.id);
  all.push({ ...deck, updated: Date.now() });
  write(all);
}

export function deleteDeck(id: string): void {
  write(read().filter((d) => d.id !== id));
}

export function createDeck(leaderClass: ClassId, name?: string): SavedDeck {
  return {
    id: newId(),
    name: name ?? `New ${leaderClass} deck`,
    leaderClass,
    cards: {},
    updated: Date.now(),
  };
}

export function deckSize(deck: SavedDeck): number {
  return Object.values(deck.cards).reduce((n, k) => n + k, 0);
}

/** Expands a saved deck into the flat card list the engine wants. */
export function toDeckList(deck: SavedDeck): DeckList {
  const cards: string[] = [];
  for (const [id, n] of Object.entries(deck.cards)) {
    if (!tryGetCard(id)) continue;
    for (let i = 0; i < n; i++) cards.push(id);
  }
  return { leaderClass: deck.leaderClass, cards };
}

export interface DeckStatus {
  size: number;
  legal: boolean;
  errors: string[];
  /** Cards in the deck whose printed text is not fully implemented. */
  partial: string[];
}

export function statusOf(deck: SavedDeck): DeckStatus {
  const list = toDeckList(deck);
  const { ok, errors } = validateDeck(list);
  const partial: string[] = [];
  for (const id of Object.keys(deck.cards)) {
    const card = tryGetCard(id);
    if (card?.implemented === false) partial.push(card.name);
  }
  return { size: list.cards.length, legal: ok, errors, partial };
}

export function selectedDeckId(): string | null {
  try {
    return localStorage.getItem(SELECTED_KEY);
  } catch {
    return null;
  }
}

export function setSelectedDeckId(id: string): void {
  try {
    localStorage.setItem(SELECTED_KEY, id);
  } catch {
    /* see write() */
  }
}

/**
 * The deck the player takes into battle: their selection if it is legal, else
 * a generated starter deck so the game is always playable.
 */
export function activeDeck(fallbackClass: ClassId = 'sword'): { list: DeckList; name: string } {
  const id = selectedDeckId();
  const deck = id ? listDecks().find((d) => d.id === id) : undefined;
  if (deck) {
    const status = statusOf(deck);
    if (status.legal) return { list: toDeckList(deck), name: deck.name };
  }
  return { list: buildStarterDeck(fallbackClass), name: `${fallbackClass} starter` };
}

/** Seeds one starter deck per class the first time the game is opened. */
export function ensureStarterDecks(): void {
  if (read().length > 0) return;
  const decks: SavedDeck[] = [];
  for (const cls of CRAFT_CLASSES) {
    const list = buildStarterDeck(cls);
    const counts: Record<string, number> = {};
    for (const id of list.cards) counts[id] = (counts[id] ?? 0) + 1;
    decks.push({
      id: newId(),
      name: `${cls} starter`,
      leaderClass: cls,
      cards: counts,
      updated: Date.now(),
    });
  }
  write(decks);
  if (!selectedDeckId() && decks[0]) setSelectedDeckId(decks[0].id);
}

export const DECK_SIZE = RULES.DECK_SIZE;
export const COPY_LIMIT = RULES.COPY_LIMIT;
