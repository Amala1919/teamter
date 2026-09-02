import { describe, expect, it } from 'vitest';
import { Game } from '../src/engine/game';
import { loadCards, builtCards } from '../src/data/index';
import { OVERRIDES } from '../src/data/overrides';
import { buildStarterDeck } from '../src/data/decks';
import { getCard } from '../src/engine/registry';
import { RULES, type CardDef, type PlayerId } from '../src/engine/types';

loadCards();

/**
 * Plays `card` on a board that has something to interact with, and returns the
 * game so the caller can assert. Any throw fails the test, which is the point:
 * these cards are hand-written and the engine has no other coverage of them.
 */
function playCard(card: CardDef, opts: { enemyFollowers?: number; allyFollowers?: number } = {}): Game {
  const cls = card.cardClass === 'neutral' ? 'sword' : card.cardClass;
  const g = new Game([buildStarterDeck(cls, 3), buildStarterDeck('shadow', 9)], {
    seed: 4242,
    first: 0,
    skipMulligan: true,
  });

  // Give the player room to act: full play points, evolution available, and a
  // board on both sides so targeted effects have something to choose.
  const me = g.player(0);
  me.pp = RULES.MAX_PP;
  me.maxPp = RULES.MAX_PP;
  me.ep = 2;
  me.shadows = 30;

  for (let i = 0; i < (opts.enemyFollowers ?? 2); i++) g.summonToken('goblin', 1, false);
  for (let i = 0; i < (opts.allyFollowers ?? 1); i++) g.summonToken('goblin', 0, false);

  const uid = g.addToHand(0, card.id);
  if (uid === null) throw new Error('hand full');

  // Supply a legal target for anything that asks for one.
  const spec = card.targeting;
  const targets = spec ? g.legalTargets(spec.selector, 0, g.ent(uid)).slice(0, spec.count ?? 1) : [];
  g.playCard(uid, targets);
  g.checkState();
  return g;
}

/** Invariants that must hold after any card resolves. */
function assertConsistent(g: Game, label: string): void {
  for (const p of [0, 1] as PlayerId[]) {
    const ps = g.player(p);
    expect(ps.field.length, `${label}: board over the limit`).toBeLessThanOrEqual(RULES.BOARD_LIMIT);
    expect(ps.hand.length, `${label}: hand over the limit`).toBeLessThanOrEqual(RULES.HAND_LIMIT);
    expect(ps.defense, `${label}: defense above maximum`).toBeLessThanOrEqual(ps.maxDefense);
    for (const uid of ps.field) {
      expect(g.ent(uid).zone, `${label}: field entity not in the field zone`).toBe('field');
      const st = g.stats(uid);
      expect(st.atk, `${label}: negative attack`).toBeGreaterThanOrEqual(0);
    }
    // Every uid appears in exactly one zone list.
    const all = [...ps.deck, ...ps.hand, ...ps.field, ...ps.cemetery, ...ps.banished];
    expect(new Set(all).size, `${label}: a card is in two zones at once`).toBe(all.length);
  }
}

describe('hand-written cards', () => {
  const ids = Object.keys(OVERRIDES);

  it('has an override for every id it names', () => {
    for (const id of ids) expect(() => getCard(id), id).not.toThrow();
  });

  it('marks every overridden card as implemented', () => {
    for (const id of ids) {
      expect(getCard(id).implemented, id).not.toBe(false);
    }
  });

  for (const id of ids) {
    it(`resolves ${id} without breaking the game state`, () => {
      const card = getCard(id);
      const g = playCard(card);
      assertConsistent(g, id);
    });
  }
});

describe('the whole card pool', () => {
  it('registers every card exactly once with a usable definition', () => {
    const cards = builtCards();
    const ids = new Set(cards.map((c) => c.id));
    expect(ids.size).toBe(cards.length);
    for (const c of cards) {
      expect(c.cost, c.id).toBeGreaterThanOrEqual(0);
      if (c.type === 'follower') {
        expect(c.atk, c.id).toBeGreaterThanOrEqual(0);
        expect(c.def, c.id).toBeGreaterThan(0);
        expect(c.evoAtk, c.id).toBeGreaterThanOrEqual(c.atk ?? 0);
      }
    }
  });

  it('only references cards that exist from summon and token effects', () => {
    for (const c of builtCards()) {
      for (const id of c.creates ?? []) {
        expect(() => getCard(id), `${c.id} creates ${id}`).not.toThrow();
      }
    }
  });

  it('never marks a card implemented while leaving printed text unhandled', () => {
    for (const c of builtCards()) {
      if (c.implemented === false) {
        expect(c.missingText?.length, c.id).toBeGreaterThan(0);
      } else {
        expect(c.missingText, c.id).toBeUndefined();
      }
    }
  });
});
