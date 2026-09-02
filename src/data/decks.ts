/**
 * Deck construction helpers.
 *
 * Legality follows the original rules: 40 cards, at most 3 copies of any card,
 * and only cards of the deck's class plus Neutrals.
 */
import { builtCards } from './index';
import type { CardDef, ClassId } from '../engine/types';
import { RULES } from '../engine/types';
import type { DeckList } from '../engine/game';
import { CLASS_THEME } from '../art/theme';
import { cardName, className, t } from '../i18n';

export interface DeckValidation {
  ok: boolean;
  errors: string[];
}

export function validateDeck(deck: DeckList, pool = builtCards()): DeckValidation {
  const byId = new Map(pool.map((c) => [c.id, c]));
  const errors: string[] = [];

  if (deck.cards.length !== RULES.DECK_SIZE) {
    errors.push(t('deckerr.size', { max: RULES.DECK_SIZE, n: deck.cards.length }));
  }

  const counts = new Map<string, number>();
  for (const id of deck.cards) {
    const card = byId.get(id);
    if (!card) {
      errors.push(t('deckerr.unknown', { id }));
      continue;
    }
    if (card.token) errors.push(t('deckerr.token', { name: cardName(card) }));
    if (card.cardClass !== 'neutral' && card.cardClass !== deck.leaderClass) {
      errors.push(
        t('deckerr.class', { name: cardName(card), cls: className(CLASS_THEME[deck.leaderClass]) }),
      );
    }
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  for (const [id, n] of counts) {
    if (n > RULES.COPY_LIMIT) {
      const c = byId.get(id);
      errors.push(
        t('deckerr.copies', { name: c ? cardName(c) : id, n, max: RULES.COPY_LIMIT }),
      );
    }
  }

  return { ok: errors.length === 0, errors };
}

/** Cards a player may legally put in a deck of this class. */
export function deckPool(cls: ClassId, opts: { onlyImplemented?: boolean } = {}): CardDef[] {
  return builtCards().filter(
    (c) =>
      !c.token &&
      (c.cardClass === cls || c.cardClass === 'neutral') &&
      (!opts.onlyImplemented || c.implemented !== false),
  );
}

/**
 * Builds a playable 40-card deck for a class.
 *
 * The curve is the one a starter deck wants — heavy at 2-4, thinning toward
 * the top end — and only fully-implemented cards are used, so a generated deck
 * never contains a card that does less than it says.
 */
export function buildStarterDeck(cls: ClassId, seed = 1): DeckList {
  const pool = deckPool(cls, { onlyImplemented: true });

  // Deterministic shuffle so a class always yields the same starter deck.
  let s = (seed * 2654435761) >>> 0;
  const rnd = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  /** Target number of cards at each cost, summing to 40. */
  const curve: Record<number, number> = { 1: 4, 2: 8, 3: 8, 4: 7, 5: 5, 6: 4, 7: 2, 8: 2 };

  const byCost = new Map<number, CardDef[]>();
  for (const c of pool) {
    const bucket = Math.min(Math.max(c.cost, 1), 8);
    if (!byCost.has(bucket)) byCost.set(bucket, []);
    byCost.get(bucket)!.push(c);
  }
  for (const list of byCost.values()) {
    // Prefer the class's own cards over Neutrals, and followers over the rest,
    // which is what makes a generated deck feel like a deck.
    list.sort((a, b) => {
      const ca = a.cardClass === cls ? 0 : 1;
      const cb = b.cardClass === cls ? 0 : 1;
      if (ca !== cb) return ca - cb;
      const ta = a.type === 'follower' ? 0 : 1;
      const tb = b.type === 'follower' ? 0 : 1;
      if (ta !== tb) return ta - tb;
      return rnd() - 0.5;
    });
  }

  const cards: string[] = [];
  const used = new Map<string, number>();
  const take = (card: CardDef, n: number) => {
    const have = used.get(card.id) ?? 0;
    const add = Math.min(n, RULES.COPY_LIMIT - have);
    for (let i = 0; i < add; i++) cards.push(card.id);
    used.set(card.id, have + add);
    return add;
  };

  for (const [costStr, want] of Object.entries(curve)) {
    const cost = Number(costStr);
    let need = want;
    const list = byCost.get(cost) ?? [];
    for (const card of list) {
      if (need <= 0) break;
      need -= take(card, Math.min(3, need));
    }
  }

  // Top up from anywhere if the class is thin at some cost.
  const all = pool.slice().sort((a, b) => a.cost - b.cost || (rnd() < 0.5 ? -1 : 1));
  for (const card of all) {
    if (cards.length >= RULES.DECK_SIZE) break;
    take(card, RULES.DECK_SIZE - cards.length);
  }

  return { leaderClass: cls, cards: cards.slice(0, RULES.DECK_SIZE) };
}
