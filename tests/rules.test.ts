import { describe, expect, it } from 'vitest';
import { Game } from '../src/engine/game';
import { LEADER_UID, RULES } from '../src/engine/types';
import { advanceToTurn, deck, newGame, place, setupTestCards, toHand } from './helpers';

// ---------------------------------------------------------------------------
// Setup, turn structure, resources
// ---------------------------------------------------------------------------

describe('match setup', () => {
  it('deals both players a 3-card mulligan hand', () => {
    setupTestCards();
    const g = new Game([deck('neutral'), deck('neutral')], { seed: 1, first: 0 });
    expect(g.player(0).hand.length).toBe(RULES.MULLIGAN_HAND);
    expect(g.player(1).hand.length).toBe(RULES.MULLIGAN_HAND);
  });

  it('draws two cards on the second player’s first turn and one thereafter', () => {
    const g = newGame();
    // Player 0 went first: 3 + 1 drawn on turn 1.
    expect(g.player(0).hand.length).toBe(RULES.MULLIGAN_HAND + 1);
    g.endTurn();
    expect(g.player(1).hand.length).toBe(RULES.MULLIGAN_HAND + 2);
    advanceToTurn(g, 4);
    expect(g.player(1).hand.length).toBe(RULES.MULLIGAN_HAND + 3);
  });

  it('starts both leaders at 20 defense', () => {
    const g = newGame();
    expect(g.player(0).defense).toBe(20);
    expect(g.player(1).defense).toBe(20);
  });

  it('is deterministic for a given seed', () => {
    setupTestCards();
    const a = new Game([deck('neutral'), deck('neutral')], { seed: 99, first: 0, skipMulligan: true });
    const b = new Game([deck('neutral'), deck('neutral')], { seed: 99, first: 0, skipMulligan: true });
    expect(a.player(0).deck).toEqual(b.player(0).deck);
    a.endTurn();
    b.endTurn();
    expect(a.player(1).hand).toEqual(b.player(1).hand);
  });

  it('returns mulliganed cards to the deck and draws replacements', () => {
    setupTestCards();
    const g = new Game([deck('neutral'), deck('neutral')], { seed: 7, first: 0 });
    const before = [...g.player(0).hand];
    g.mulligan(0, before.slice(0, 2));
    const after = g.player(0).hand;
    expect(after.length).toBe(3);
    // The two replaced uids cannot come straight back on the same mulligan.
    expect(after.filter((u) => before.slice(0, 2).includes(u)).length).toBe(0);
  });
});

describe('turn structure', () => {
  it('grants one play point orb per turn, capped at 10', () => {
    const g = newGame();
    expect(g.player(0).maxPp).toBe(1);
    advanceToTurn(g, 3);
    expect(g.player(0).maxPp).toBe(2);
    advanceToTurn(g, 25);
    expect(g.player(0).maxPp).toBe(RULES.MAX_PP);
  });

  it('refills play points at the start of each turn', () => {
    const g = newGame();
    g.player(0).pp = 0;
    g.endTurn();
    g.endTurn();
    expect(g.player(0).pp).toBe(g.player(0).maxPp);
  });

  it('gives the first player 2 EP on turn 5 and the second 3 EP on turn 4', () => {
    const g = newGame();
    advanceToTurn(g, 4);
    expect(g.state.active).toBe(1);
    expect(g.player(1).ep).toBe(RULES.EP_SECOND);
    expect(g.player(0).ep).toBe(0);
    advanceToTurn(g, 5);
    expect(g.player(0).ep).toBe(RULES.EP_FIRST);
  });

  it('remembers who went first even after the event log is drained', () => {
    setupTestCards();
    const g = new Game([deck('neutral'), deck('neutral')], { seed: 5, first: 1, skipMulligan: true });
    g.drainEvents();
    expect(g.firstPlayer).toBe(1);
    expect(g.evolveTurnFor(1)).toBe(RULES.EVOLVE_TURN_FIRST);
    expect(g.evolveTurnFor(0)).toBe(RULES.EVOLVE_TURN_SECOND);
  });

  it('gives evolution points to the right seat when player 1 goes first', () => {
    setupTestCards();
    const g = new Game([deck('neutral'), deck('neutral')], { seed: 5, first: 1, skipMulligan: true });
    advanceToTurn(g, 4);
    // Player 0 is going second here, so they unlock first with 3 EP.
    expect(g.player(0).ep).toBe(RULES.EP_SECOND);
    expect(g.player(1).ep).toBe(0);
    advanceToTurn(g, 5);
    expect(g.player(1).ep).toBe(RULES.EP_FIRST);
  });

  it('draws one card at the start of every turn', () => {
    const g = newGame();
    const n = g.player(0).hand.length;
    g.endTurn();
    g.endTurn();
    expect(g.player(0).hand.length).toBe(n + 1);
  });
});

// ---------------------------------------------------------------------------
// Playing cards
// ---------------------------------------------------------------------------

describe('playing cards', () => {
  it('refuses a card that costs more than the available play points', () => {
    const g = newGame();
    const uid = toHand(g, 0, 't_big');
    expect(g.canPlay(uid)).toBe(false);
    expect(g.playCard(uid)).toBe(false);
  });

  it('spends play points and puts a follower on the board', () => {
    const g = newGame();
    advanceToTurn(g, 5);
    const uid = toHand(g, 0, 't_vanilla');
    expect(g.playCard(uid)).toBe(true);
    expect(g.player(0).field).toContain(uid);
    expect(g.player(0).pp).toBe(g.player(0).maxPp - 2);
  });

  it('resolves Fanfare after the follower is on the board', () => {
    const g = newGame();
    advanceToTurn(g, 5);
    const uid = toHand(g, 0, 't_fanfare_summon');
    g.playCard(uid);
    expect(g.player(0).field.length).toBe(3);
  });

  it('caps the board at 5 and refuses further followers', () => {
    const g = newGame();
    advanceToTurn(g, 11);
    g.player(0).hand.length = 0;
    for (let i = 0; i < RULES.BOARD_LIMIT; i++) place(g, 0, 't_vanilla');
    const uid = toHand(g, 0, 't_vanilla');
    expect(g.canPlay(uid)).toBe(false);
  });

  it('silently drops a summon when the board is full', () => {
    const g = newGame();
    advanceToTurn(g, 11);
    g.player(0).hand.length = 0;
    for (let i = 0; i < 4; i++) place(g, 0, 't_vanilla');
    const uid = toHand(g, 0, 't_fanfare_summon');
    g.playCard(uid);
    // Summoner takes the fifth slot; both tokens fizzle.
    expect(g.player(0).field.length).toBe(RULES.BOARD_LIMIT);
  });

  it('sends a spell to the cemetery after it resolves', () => {
    const g = newGame();
    advanceToTurn(g, 5);
    place(g, 1, 't_vanilla');
    const uid = toHand(g, 0, 't_bolt');
    g.playCard(uid, [g.player(1).field[0]]);
    expect(g.player(0).cemetery).toContain(uid);
  });

  it('refuses a targeted spell with no legal target', () => {
    const g = newGame();
    advanceToTurn(g, 5);
    const uid = toHand(g, 0, 't_bolt');
    expect(g.canPlay(uid)).toBe(false);
  });

  it('burns a drawn card when the hand is full', () => {
    const g = newGame();
    while (g.player(0).hand.length < RULES.HAND_LIMIT) toHand(g, 0, 't_vanilla');
    expect(g.player(0).hand.length).toBe(RULES.HAND_LIMIT);
    const before = g.player(0).burned;
    g.drawCard(0);
    expect(g.player(0).burned).toBe(before + 1);
    expect(g.player(0).hand.length).toBe(RULES.HAND_LIMIT);
  });
});

// ---------------------------------------------------------------------------
// Attacking
// ---------------------------------------------------------------------------

describe('attacking', () => {
  it('stops a freshly played follower from attacking', () => {
    const g = newGame();
    advanceToTurn(g, 5);
    const uid = toHand(g, 0, 't_vanilla');
    g.playCard(uid);
    expect(g.canAttack(uid, 'leader')).toBe(false);
  });

  it('lets Storm attack the leader immediately', () => {
    const g = newGame();
    advanceToTurn(g, 7);
    const uid = toHand(g, 0, 't_storm');
    g.playCard(uid);
    expect(g.canAttack(uid, 'leader')).toBe(true);
    g.attack(uid, 'leader');
    expect(g.player(1).defense).toBe(17);
  });

  it('lets Rush attack a follower but not the leader', () => {
    const g = newGame();
    advanceToTurn(g, 7);
    const enemy = place(g, 1, 't_vanilla');
    const uid = toHand(g, 0, 't_rush');
    g.playCard(uid);
    expect(g.canAttack(uid, 'leader')).toBe(false);
    expect(g.canAttack(uid, enemy)).toBe(true);
  });

  it('forces attacks into a Ward follower', () => {
    const g = newGame();
    const attacker = place(g, 0, 't_big');
    const ward = place(g, 1, 't_ward');
    const plain = place(g, 1, 't_vanilla');
    expect(g.canAttack(attacker, 'leader')).toBe(false);
    expect(g.canAttack(attacker, plain)).toBe(false);
    expect(g.canAttack(attacker, ward)).toBe(true);
  });

  it('deals combat damage simultaneously', () => {
    const g = newGame();
    const a = place(g, 0, 't_vanilla');
    const b = place(g, 1, 't_vanilla');
    g.attack(a, b);
    // 2/2 into 2/2 trades: both die.
    expect(g.player(0).field).not.toContain(a);
    expect(g.player(1).field).not.toContain(b);
  });

  it('destroys any follower it damages when it has Bane', () => {
    const g = newGame();
    const bane = place(g, 0, 't_bane');
    const big = place(g, 1, 't_big');
    g.attack(bane, big);
    expect(g.player(1).field).not.toContain(big);
  });

  it('does not heal when a Drain follower is the defender', () => {
    const g = newGame();
    g.player(1).defense = 10;
    const drainer = place(g, 1, 't_drain');
    const attacker = place(g, 0, 't_big');
    g.attack(attacker, drainer);
    expect(g.player(1).defense).toBe(10);
  });

  it('restores defense equal to damage dealt when it has Drain', () => {
    const g = newGame();
    g.player(0).defense = 10;
    const d = place(g, 0, 't_drain');
    g.attack(d, 'leader');
    expect(g.player(1).defense).toBe(17);
    expect(g.player(0).defense).toBe(13);
  });

  it('never heals a leader above its maximum defense', () => {
    const g = newGame();
    g.player(0).defense = 19;
    const d = place(g, 0, 't_drain');
    g.attack(d, 'leader');
    expect(g.player(0).defense).toBe(20);
  });

  it('hides an Ambush follower from attacks and enemy targeting', () => {
    const g = newGame();
    const hidden = place(g, 1, 't_ambush');
    const attacker = place(g, 0, 't_big');
    expect(g.canAttack(attacker, hidden)).toBe(false);
    const bolt = toHand(g, 0, 't_bolt');
    g.player(0).pp = 10;
    expect(g.canPlay(bolt)).toBe(false);
  });

  it('breaks Ambush once the follower attacks', () => {
    const g = newGame();
    const hidden = place(g, 0, 't_ambush');
    g.attack(hidden, 'leader');
    expect(g.ent(hidden).ambushed).toBe(false);
  });

  it('allows only one attack per turn', () => {
    const g = newGame();
    const a = place(g, 0, 't_big');
    expect(g.attack(a, 'leader')).toBe(true);
    expect(g.canAttack(a, 'leader')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Evolution
// ---------------------------------------------------------------------------

describe('evolution', () => {
  it('is unavailable before the class-appropriate turn', () => {
    const g = newGame();
    const uid = place(g, 0, 't_vanilla');
    expect(g.canEvolve(uid)).toBe(false);
  });

  it('adds +2/+2 and spends one EP', () => {
    const g = newGame();
    advanceToTurn(g, 5);
    const uid = place(g, 0, 't_vanilla');
    expect(g.canEvolve(uid)).toBe(true);
    g.evolve(uid);
    const s = g.stats(uid);
    expect(s.atk).toBe(4);
    expect(s.maxDef).toBe(4);
    expect(g.player(0).ep).toBe(RULES.EP_FIRST - 1);
  });

  it('allows only one evolution per turn', () => {
    const g = newGame();
    advanceToTurn(g, 5);
    const a = place(g, 0, 't_vanilla');
    const b = place(g, 0, 't_vanilla');
    g.evolve(a);
    expect(g.canEvolve(b)).toBe(false);
  });

  it('lets a follower played this turn attack followers once evolved, but not the leader', () => {
    const g = newGame();
    advanceToTurn(g, 5);
    const uid = toHand(g, 0, 't_vanilla');
    g.playCard(uid);
    const enemy = place(g, 1, 't_vanilla');
    expect(g.canAttack(uid, enemy)).toBe(false);
    g.evolve(uid);
    expect(g.canAttack(uid, enemy)).toBe(true);
    expect(g.canAttack(uid, 'leader')).toBe(false);
  });

  it('fires the Evolve ability', () => {
    const g = newGame();
    advanceToTurn(g, 5);
    const enemy = place(g, 1, 't_big');
    const uid = place(g, 0, 't_evolver');
    g.evolve(uid);
    expect(g.ent(enemy).damage).toBe(2);
  });

  it('uses the card’s printed evolved stats rather than a blanket +2/+2', () => {
    const g = newGame();
    advanceToTurn(g, 5);
    const uid = place(g, 0, 't_evolver');
    g.evolve(uid);
    // t_evolver prints 3/3 evolved, not 4/4.
    expect(g.stats(uid).atk).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

describe('effects', () => {
  it('fires Last Words when a follower is destroyed', () => {
    const g = newGame();
    const uid = place(g, 0, 't_lastwords');
    g.dealDamage(g.ent(uid), 5, null);
    g.checkState();
    expect(g.player(0).field.length).toBe(1);
    expect(g.def(g.player(0).field[0]).id).toBe('t_token');
  });

  it('does not fire Last Words when a follower is banished', () => {
    const g = newGame();
    advanceToTurn(g, 5);
    const victim = place(g, 1, 't_lastwords');
    const uid = toHand(g, 0, 't_banisher');
    g.playCard(uid, [victim]);
    expect(g.player(1).field.length).toBe(0);
    expect(g.player(1).banished).toContain(victim);
  });

  it('grants a shadow for each destroyed follower but not for banished ones', () => {
    const g = newGame();
    const a = place(g, 0, 't_vanilla');
    g.destroyEntity(g.ent(a));
    expect(g.player(0).shadows).toBe(1);
    const b = place(g, 0, 't_vanilla');
    g.banishEntity(g.ent(b));
    expect(g.player(0).shadows).toBe(1);
  });

  it('resolves simultaneous Last Words in board order', () => {
    const g = newGame();
    place(g, 0, 't_lastwords');
    place(g, 0, 't_lastwords');
    for (const uid of [...g.player(0).field]) g.dealDamage(g.ent(uid), 5, null);
    g.checkState();
    expect(g.player(0).field.length).toBe(2);
    expect(g.player(0).field.every((u) => g.def(u).id === 't_token')).toBe(true);
  });

  it('applies aura buffs and removes them when the source leaves', () => {
    const g = newGame();
    const banner = place(g, 0, 't_aura');
    const f = place(g, 0, 't_vanilla');
    expect(g.stats(f).atk).toBe(3);
    g.destroyEntity(g.ent(banner));
    expect(g.stats(f).atk).toBe(2);
  });

  it('ticks a Countdown amulet down each turn and fires Last Words at zero', () => {
    const g = newGame();
    advanceToTurn(g, 5);
    const uid = toHand(g, 0, 't_countdown');
    g.playCard(uid);
    expect(g.ent(uid).countdown).toBe(2);
    advanceToTurn(g, 7);
    expect(g.ent(uid).countdown).toBe(1);
    advanceToTurn(g, 9);
    expect(g.player(0).field.some((u) => g.def(u).id === 't_token')).toBe(true);
  });

  it('keeps buffs permanent and clears until-end-of-turn buffs', () => {
    const g = newGame();
    advanceToTurn(g, 5);
    const f = place(g, 0, 't_vanilla');
    const buff = toHand(g, 0, 't_buff');
    g.playCard(buff, [f]);
    expect(g.stats(f).atk).toBe(4);
    g.ent(f).tempAtk = 3;
    expect(g.stats(f).atk).toBe(7);
    g.endTurn();
    expect(g.stats(f).atk).toBe(4);
  });

  it('replaces a follower entirely on transform', () => {
    const g = newGame();
    advanceToTurn(g, 5);
    const victim = place(g, 1, 't_big');
    g.ent(victim).buffAtk = 5;
    const uid = toHand(g, 0, 't_transformer');
    g.playCard(uid, [victim]);
    expect(g.player(1).field.length).toBe(1);
    const now = g.player(1).field[0];
    expect(g.def(now).id).toBe('t_token');
    expect(g.stats(now).atk).toBe(1);
  });

  it('draws the requested number of cards', () => {
    const g = newGame();
    advanceToTurn(g, 5);
    const n = g.player(0).hand.length;
    const uid = toHand(g, 0, 't_draw');
    g.playCard(uid);
    expect(g.player(0).hand.length).toBe(n + 2);
  });

  it('lets a spell target the enemy leader', () => {
    const g = newGame();
    advanceToTurn(g, 5);
    const uid = toHand(g, 0, 't_facebolt');
    g.playCard(uid);
    expect(g.player(1).defense).toBe(17);
  });

  it('offers leaders as legal targets when the selector includes them', () => {
    const g = newGame();
    const targets = g.legalTargets(
      { scope: 'target', side: 'enemy', kind: 'follower', includeLeader: true },
      0,
      null,
    );
    expect(targets).toContain(LEADER_UID(1));
  });
});

// ---------------------------------------------------------------------------
// Win conditions
// ---------------------------------------------------------------------------

describe('win conditions', () => {
  it('ends the game when a leader reaches zero defense', () => {
    const g = newGame();
    g.player(1).defense = 2;
    const uid = place(g, 0, 't_big');
    g.attack(uid, 'leader');
    expect(g.state.winner).toBe(0);
    expect(g.state.phase).toBe('over');
  });

  it('is a draw when both leaders die at once', () => {
    const g = newGame();
    g.player(0).defense = 1;
    g.player(1).defense = 1;
    g.damageLeader(0, 5, null);
    g.damageLeader(1, 5, null);
    g.checkState();
    expect(g.state.winner).toBe('draw');
  });

  it('loses immediately when a draw is attempted from an empty deck', () => {
    const g = newGame();
    g.player(0).deck = [];
    const before = g.player(0).defense;
    g.drawCard(0);
    // Deck-out is an outright loss, not fatigue damage.
    expect(g.player(0).defense).toBe(before);
    expect(g.state.winner).toBe(1);
  });

  it('cannot act after the game is over', () => {
    const g = newGame();
    g.player(1).defense = 1;
    const uid = place(g, 0, 't_big');
    g.attack(uid, 'leader');
    const card = toHand(g, 0, 't_vanilla');
    expect(g.canPlay(card)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Cost modification
// ---------------------------------------------------------------------------

describe('cost modification', () => {
  it('reduces only the card its selector names', () => {
    const g = newGame();
    const a = toHand(g, 0, 't_big');
    const b = toHand(g, 0, 't_big');
    g.runEffects(
      [{ k: 'costMod', target: { scope: 'self' }, delta: -2 }],
      // The source is the card whose own cost is being reduced.
      { source: g.ent(a), controller: 0, targets: [], ti: 0, option: 0, vars: {}, depth: 0 },
    );
    expect(g.costOf(a)).toBe(3);
    expect(g.costOf(b)).toBe(5);
  });

  it('never lets a cost fall below zero', () => {
    const g = newGame();
    const uid = toHand(g, 0, 't_vanilla');
    g.ent(uid).costMod = -10;
    expect(g.costOf(uid)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Damage ceilings and outright wins
// ---------------------------------------------------------------------------

describe('a damage ceiling', () => {
  it('caps a single instance rather than subtracting from it', () => {
    const g = newGame();
    const uid = place(g, 0, 't_big');
    // Luxhorn Sarissa's line: "Can't take more than 3 damage at a time."
    g.ent(uid).grantedKeywords = [];
    const src = g.ent(place(g, 0, 't_vanilla'));
    // Stand in the aura by hand: the compiler emits exactly this shape.
    (g.def(src) as { auras?: unknown[] }).auras = [{ target: { scope: 'self' }, damageCap: 3 }];
    const dealt = g.dealDamage(src, 9, null, true);
    expect(dealt).toBe(3);
  });

  it('caps damage to the leader too', () => {
    const g = newGame();
    const src = g.ent(place(g, 0, 't_vanilla'));
    (g.def(src) as { auras?: unknown[] }).auras = [
      { target: { scope: 'self' }, leader: true, damageCap: 3 },
    ];
    const before = g.player(0).defense;
    g.damageLeader(0, 8, null);
    expect(g.player(0).defense).toBe(before - 3);
  });
});

describe('the win effect', () => {
  it('ends the match for the controller', () => {
    const g = newGame();
    const src = g.ent(place(g, 0, 't_vanilla'));
    g.runEffects([{ k: 'win' }], {
      source: src,
      controller: 0,
      targets: [],
      ti: 0,
      option: 0,
      vars: {},
      depth: 0,
    });
    expect(g.state.winner).toBe(0);
    expect(g.state.phase).toBe('over');
  });
});

// ---------------------------------------------------------------------------
// Granted abilities and silencing
// ---------------------------------------------------------------------------

describe('granted abilities', () => {
  it('fires on the follower they were given to', () => {
    const g = newGame();
    const target = place(g, 0, 't_vanilla');
    const src = g.ent(place(g, 0, 't_big'));
    g.runEffects(
      [
        {
          k: 'grantAbility',
          target: { scope: 'all', side: 'ally', kind: 'follower', filter: { notSelf: true } },
          abilities: [{ on: 'lastWords', effects: [{ k: 'draw', amount: 1 }] }],
        },
      ],
      { source: src, controller: 0, targets: [], ti: 0, option: 0, vars: {}, depth: 0 },
    );
    const before = g.player(0).hand.length;
    g.destroyEntity(g.ent(target));
    g.checkState();
    expect(g.player(0).hand.length).toBe(before + 1);
  });

  it('expires at the end of the turn when granted for a turn', () => {
    const g = newGame();
    const target = place(g, 0, 't_vanilla');
    const src = g.ent(place(g, 0, 't_big'));
    g.runEffects(
      [
        {
          k: 'grantAbility',
          target: { scope: 'all', side: 'ally', kind: 'follower', filter: { notSelf: true } },
          abilities: [{ on: 'lastWords', effects: [{ k: 'draw', amount: 1 }] }],
          duration: 'turn',
        },
      ],
      { source: src, controller: 0, targets: [], ti: 0, option: 0, vars: {}, depth: 0 },
    );
    g.endTurn();
    g.endTurn();
    const before = g.player(0).hand.length;
    g.destroyEntity(g.ent(target));
    g.checkState();
    expect(g.player(0).hand.length).toBe(before);
  });
});

describe('silencing', () => {
  it('removes printed keywords and abilities but keeps stats', () => {
    const g = newGame();
    const uid = place(g, 0, 't_ward');
    expect(g.stats(uid).keywords.has('ward')).toBe(true);
    const atk = g.stats(uid).atk;

    g.runEffects([{ k: 'silence', target: { scope: 'all', side: 'ally', kind: 'follower' } }], {
      source: g.ent(uid),
      controller: 0,
      targets: [],
      ti: 0,
      option: 0,
      vars: {},
      depth: 0,
    });

    expect(g.stats(uid).keywords.has('ward')).toBe(false);
    expect(g.stats(uid).atk).toBe(atk);
  });

  it('stops a Last Words from firing', () => {
    const g = newGame();
    const uid = place(g, 0, 't_lastwords');
    g.runEffects([{ k: 'silence', target: { scope: 'all', side: 'ally', kind: 'follower' } }], {
      source: g.ent(uid),
      controller: 0,
      targets: [],
      ti: 0,
      option: 0,
      vars: {},
      depth: 0,
    });
    const before = g.player(0).field.length;
    g.destroyEntity(g.ent(uid));
    g.checkState();
    // The Last Words summon must not have happened.
    expect(g.player(0).field.length).toBe(before - 1);
  });
});

describe('"summon and then act on it"', () => {
  it('binds the summoned follower as the context\'s other', () => {
    const g = newGame();
    const src = g.ent(place(g, 0, 't_big'));
    g.runEffects(
      [
        { k: 'summon', defId: 't_vanilla' },
        { k: 'buff', target: { scope: 'other' }, atk: 3, def: 0 },
      ],
      { source: src, controller: 0, targets: [], ti: 0, option: 0, vars: {}, depth: 0 },
    );
    const summoned = g.player(0).field.map((u) => g.ent(u)).find((e) => e.defId === 't_vanilla');
    expect(summoned).toBeDefined();
    expect(g.stats(summoned!.uid).atk).toBe(5);
  });
});
