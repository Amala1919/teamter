import type { CardDef, ClassId, SetId } from './types';
import { SET_ORDER } from './types';

/**
 * Global card registry. Card data lives in `src/data/cards/*` as plain objects;
 * nothing here knows about rendering, and the engine only ever sees `CardDef`s.
 */
const defs = new Map<string, CardDef>();

export function registerCards(cards: readonly CardDef[]): void {
  for (const c of cards) {
    if (defs.has(c.id)) {
      throw new Error(`Duplicate card id: ${c.id} (${c.name})`);
    }
    defs.set(c.id, c);
  }
}

export function getCard(id: string): CardDef {
  const d = defs.get(id);
  if (!d) throw new Error(`Unknown card id: ${id}`);
  return d;
}

export function tryGetCard(id: string): CardDef | undefined {
  return defs.get(id);
}

export function allCards(): CardDef[] {
  return [...defs.values()];
}

/** Cards a player may put in a deck: non-token, in-class or neutral. */
export function collectibleCards(): CardDef[] {
  return allCards().filter((c) => !c.token);
}

export function cardsForClass(cls: ClassId): CardDef[] {
  return collectibleCards().filter((c) => c.cardClass === cls || c.cardClass === 'neutral');
}

export function cardsInSet(set: SetId): CardDef[] {
  return collectibleCards().filter((c) => c.set === set);
}

/** Sort used by the collection and deck-builder grids. */
export function collectionSort(a: CardDef, b: CardDef): number {
  if (a.cost !== b.cost) return a.cost - b.cost;
  const ra = RARITY_ORDER[a.rarity] - RARITY_ORDER[b.rarity];
  if (ra !== 0) return ra;
  const sa = SET_ORDER.indexOf(a.set) - SET_ORDER.indexOf(b.set);
  if (sa !== 0) return sa;
  return a.name.localeCompare(b.name);
}

export const RARITY_ORDER = { bronze: 0, silver: 1, gold: 2, legendary: 3 } as const;

/** Test hook — never called by the game itself. */
export function _resetRegistry(): void {
  defs.clear();
}
