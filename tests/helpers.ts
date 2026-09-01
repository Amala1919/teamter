import { Game, type DeckList } from '../src/engine/game';
import { registerCards, _resetRegistry } from '../src/engine/registry';
import type { CardDef, ClassId, PlayerId } from '../src/engine/types';

/**
 * Test fixtures use a small hand-written card set rather than the real card
 * pool, so a rules test never breaks because a card was rebalanced.
 */
export const TEST_CARDS: CardDef[] = [
  {
    id: 't_vanilla',
    name: 'Test Vanilla',
    cardClass: 'neutral',
    set: 'basic',
    rarity: 'bronze',
    type: 'follower',
    cost: 2,
    atk: 2,
    def: 2,
    evoAtk: 4,
    evoDef: 4,
    text: '',
  },
  {
    id: 't_big',
    name: 'Test Big',
    cardClass: 'neutral',
    set: 'basic',
    rarity: 'bronze',
    type: 'follower',
    cost: 5,
    atk: 5,
    def: 5,
    evoAtk: 7,
    evoDef: 7,
    text: '',
  },
  {
    id: 't_ward',
    name: 'Test Ward',
    cardClass: 'neutral',
    set: 'basic',
    rarity: 'bronze',
    type: 'follower',
    cost: 2,
    atk: 1,
    def: 4,
    evoAtk: 3,
    evoDef: 6,
    keywords: ['ward'],
    text: 'Ward.',
  },
  {
    id: 't_storm',
    name: 'Test Storm',
    cardClass: 'neutral',
    set: 'basic',
    rarity: 'bronze',
    type: 'follower',
    cost: 4,
    atk: 3,
    def: 3,
    evoAtk: 5,
    evoDef: 5,
    keywords: ['storm'],
    text: 'Storm.',
  },
  {
    id: 't_rush',
    name: 'Test Rush',
    cardClass: 'neutral',
    set: 'basic',
    rarity: 'bronze',
    type: 'follower',
    cost: 3,
    atk: 3,
    def: 2,
    evoAtk: 5,
    evoDef: 4,
    keywords: ['rush'],
    text: 'Rush.',
  },
  {
    id: 't_bane',
    name: 'Test Bane',
    cardClass: 'neutral',
    set: 'basic',
    rarity: 'bronze',
    type: 'follower',
    cost: 2,
    atk: 1,
    def: 1,
    evoAtk: 3,
    evoDef: 3,
    keywords: ['bane'],
    text: 'Bane.',
  },
  {
    id: 't_drain',
    name: 'Test Drain',
    cardClass: 'neutral',
    set: 'basic',
    rarity: 'bronze',
    type: 'follower',
    cost: 3,
    atk: 3,
    def: 3,
    evoAtk: 5,
    evoDef: 5,
    keywords: ['drain', 'storm'],
    text: 'Storm. Drain.',
  },
  {
    id: 't_ambush',
    name: 'Test Ambush',
    cardClass: 'neutral',
    set: 'basic',
    rarity: 'bronze',
    type: 'follower',
    cost: 2,
    atk: 2,
    def: 2,
    evoAtk: 4,
    evoDef: 4,
    keywords: ['ambush'],
    text: 'Ambush.',
  },
  {
    id: 't_token',
    name: 'Test Token',
    cardClass: 'neutral',
    set: 'basic',
    rarity: 'bronze',
    type: 'follower',
    cost: 1,
    atk: 1,
    def: 1,
    evoAtk: 3,
    evoDef: 3,
    token: true,
    text: '',
  },
  {
    id: 't_fanfare_summon',
    name: 'Test Summoner',
    cardClass: 'neutral',
    set: 'basic',
    rarity: 'bronze',
    type: 'follower',
    cost: 3,
    atk: 1,
    def: 1,
    evoAtk: 3,
    evoDef: 3,
    text: 'Fanfare: Summon 2 Test Tokens.',
    abilities: [{ on: 'fanfare', effects: [{ k: 'summon', defId: 't_token', count: 2 }] }],
  },
  {
    id: 't_lastwords',
    name: 'Test Last Words',
    cardClass: 'neutral',
    set: 'basic',
    rarity: 'bronze',
    type: 'follower',
    cost: 2,
    atk: 2,
    def: 1,
    evoAtk: 4,
    evoDef: 3,
    text: 'Last Words: Summon a Test Token.',
    abilities: [{ on: 'lastWords', effects: [{ k: 'summon', defId: 't_token' }] }],
  },
  {
    id: 't_bolt',
    name: 'Test Bolt',
    cardClass: 'neutral',
    set: 'basic',
    rarity: 'bronze',
    type: 'spell',
    cost: 1,
    text: 'Deal 3 damage to an enemy follower.',
    abilities: [
      {
        on: 'fanfare',
        effects: [{ k: 'damage', target: { scope: 'target', side: 'enemy', kind: 'follower' }, amount: 3 }],
      },
    ],
    targeting: { selector: { scope: 'target', side: 'enemy', kind: 'follower' } },
  },
  {
    id: 't_facebolt',
    name: 'Test Face Bolt',
    cardClass: 'neutral',
    set: 'basic',
    rarity: 'bronze',
    type: 'spell',
    cost: 1,
    text: 'Deal 3 damage to the enemy leader.',
    abilities: [{ on: 'fanfare', effects: [{ k: 'damage', target: { scope: 'leader', side: 'enemy' }, amount: 3 }] }],
  },
  {
    id: 't_heal',
    name: 'Test Heal',
    cardClass: 'neutral',
    set: 'basic',
    rarity: 'bronze',
    type: 'spell',
    cost: 1,
    text: 'Restore 4 defense to your leader.',
    abilities: [{ on: 'fanfare', effects: [{ k: 'heal', target: { scope: 'leader', side: 'ally' }, amount: 4 }] }],
  },
  {
    id: 't_banisher',
    name: 'Test Banisher',
    cardClass: 'neutral',
    set: 'basic',
    rarity: 'bronze',
    type: 'spell',
    cost: 2,
    text: 'Banish an enemy follower.',
    abilities: [{ on: 'fanfare', effects: [{ k: 'banish', target: { scope: 'target', side: 'enemy', kind: 'follower' } }] }],
    targeting: { selector: { scope: 'target', side: 'enemy', kind: 'follower' } },
  },
  {
    id: 't_buff',
    name: 'Test Buff',
    cardClass: 'neutral',
    set: 'basic',
    rarity: 'bronze',
    type: 'spell',
    cost: 1,
    text: 'Give +2/+2 to an allied follower.',
    abilities: [
      { on: 'fanfare', effects: [{ k: 'buff', target: { scope: 'target', side: 'ally', kind: 'follower' }, atk: 2, def: 2 }] },
    ],
    targeting: { selector: { scope: 'target', side: 'ally', kind: 'follower' } },
  },
  {
    id: 't_draw',
    name: 'Test Draw',
    cardClass: 'neutral',
    set: 'basic',
    rarity: 'bronze',
    type: 'spell',
    cost: 1,
    text: 'Draw 2 cards.',
    abilities: [{ on: 'fanfare', effects: [{ k: 'draw', amount: 2 }] }],
  },
  {
    id: 't_countdown',
    name: 'Test Countdown',
    cardClass: 'neutral',
    set: 'basic',
    rarity: 'bronze',
    type: 'amulet',
    cost: 2,
    countdown: 2,
    text: 'Countdown (2)\nLast Words: Summon a Test Token.',
    abilities: [{ on: 'lastWords', effects: [{ k: 'summon', defId: 't_token' }] }],
  },
  {
    id: 't_aura',
    name: 'Test Banner',
    cardClass: 'neutral',
    set: 'basic',
    rarity: 'bronze',
    type: 'amulet',
    cost: 2,
    text: 'Allied followers have +1/+0.',
    auras: [{ target: { scope: 'all', side: 'ally', kind: 'follower' }, atk: 1 }],
  },
  {
    id: 't_evolver',
    name: 'Test Evolver',
    cardClass: 'neutral',
    set: 'basic',
    rarity: 'bronze',
    type: 'follower',
    cost: 3,
    atk: 2,
    def: 2,
    evoAtk: 3,
    evoDef: 3,
    text: 'Evolve: Deal 2 damage to an enemy follower.',
    abilities: [
      {
        on: 'evolve',
        effects: [{ k: 'damage', target: { scope: 'random', side: 'enemy', kind: 'follower' }, amount: 2 }],
      },
    ],
  },
  {
    id: 't_transformer',
    name: 'Test Transformer',
    cardClass: 'neutral',
    set: 'basic',
    rarity: 'bronze',
    type: 'spell',
    cost: 2,
    text: 'Transform an enemy follower into a Test Token.',
    abilities: [
      { on: 'fanfare', effects: [{ k: 'transform', target: { scope: 'target', side: 'enemy', kind: 'follower' }, into: 't_token' }] },
    ],
    targeting: { selector: { scope: 'target', side: 'enemy', kind: 'follower' } },
  },
];

export function setupTestCards(): void {
  _resetRegistry();
  registerCards(TEST_CARDS);
}

/** Builds a 40-card deck by repeating `fill`, with `top` stacked on top. */
export function deck(cls: ClassId, top: string[] = [], fill = 't_vanilla'): DeckList {
  const cards = [...top];
  while (cards.length < 40) cards.push(fill);
  return { leaderClass: cls, cards: cards.slice(0, 40) };
}

export interface TestGameOptions {
  first?: PlayerId;
  seed?: number;
}

/** A started game with the mulligan already skipped. */
export function newGame(
  d0: DeckList = deck('neutral'),
  d1: DeckList = deck('neutral'),
  opts: TestGameOptions = {},
): Game {
  setupTestCards();
  return new Game([d0, d1], { seed: opts.seed ?? 1234, first: opts.first ?? 0, skipMulligan: true });
}

/** Puts a card straight onto the field, bypassing cost and Fanfare. */
export function place(g: Game, owner: PlayerId, defId: string, evolved = false): number {
  const e = g.summonToken(defId, owner, false);
  if (!e) throw new Error('board full');
  if (evolved) e.evolved = true;
  // Placed cards are treated as having been on board since the previous turn.
  e.enteredTurn = -1;
  return e.uid;
}

/** Puts a card into hand and returns its uid. */
export function toHand(g: Game, owner: PlayerId, defId: string): number {
  const uid = g.addToHand(owner, defId);
  if (uid === null) throw new Error('hand full');
  return uid;
}

/** Advances to the given absolute turn number, passing turns. */
export function advanceToTurn(g: Game, turn: number): void {
  let guard = 0;
  while (g.state.turn < turn && g.state.winner === null && guard++ < 40) g.endTurn();
}
