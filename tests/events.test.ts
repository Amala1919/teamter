/**
 * The event stream.
 *
 * The renderer is driven entirely by `drainEvents()`, and it animates events in
 * the order it receives them. State-based tests cannot see that order, so a
 * reordering — a death announced before the damage that caused it, a Fanfare
 * before the card is on the board — passes every other test in the suite and
 * still produces a battle that plays backwards on screen.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { GameEvent, PlayerId } from '../src/engine/types';
import { LEADER_UID } from '../src/engine/types';
import { deck, newGame, place, setupTestCards, toHand } from './helpers';
import type { Game } from '../src/engine/game';

beforeEach(setupTestCards);

/** The event kinds emitted since the last drain, in order. */
function kinds(g: Game): GameEvent['t'][] {
  return g.drainEvents().map((e) => e.t);
}

/** Index of the first event matching `pred`, or -1. */
function indexOf(events: GameEvent[], pred: (e: GameEvent) => boolean): number {
  return events.findIndex(pred);
}

describe('event order when a card is played', () => {
  it('puts the card on the board before its Fanfare resolves', () => {
    const g = newGame(deck('neutral', ['t_fanfare_summon']));
    g.drainEvents();
    const uid = toHand(g, 0, 't_fanfare_summon');
    g.player(0).pp = 10;
    g.drainEvents();

    g.playCard(uid);
    const ev = g.drainEvents();
    const played = indexOf(ev, (e) => e.t === 'play');
    const summoned = indexOf(ev, (e) => e.t === 'summon' && e.uid === uid);
    const ability = indexOf(ev, (e) => e.t === 'ability' && e.kind === 'fanfare');
    const token = indexOf(ev, (e) => e.t === 'summon' && e.defId === 't_token');

    expect(played).toBeGreaterThanOrEqual(0);
    expect(summoned).toBeGreaterThan(played);
    expect(ability).toBeGreaterThan(summoned);
    expect(token).toBeGreaterThan(ability);
  });

  it('announces a spell before the damage it deals', () => {
    const g = newGame(deck('neutral', ['t_bolt']));
    place(g, 1, 't_big');
    g.player(0).pp = 10;
    const uid = toHand(g, 0, 't_bolt');
    const target = g.player(1).field[0];
    g.drainEvents();

    g.playCard(uid, [target]);
    const ev = g.drainEvents();
    expect(indexOf(ev, (e) => e.t === 'play')).toBeLessThan(
      indexOf(ev, (e) => e.t === 'damage'),
    );
  });
});

describe('event order in combat', () => {
  it('reports the attack, then the damage, then the death', () => {
    const g = newGame();
    const atk = place(g, 0, 't_big');
    const def = place(g, 1, 't_vanilla');
    g.drainEvents();

    g.attack(atk, def);
    const ev = g.drainEvents();
    const attack = indexOf(ev, (e) => e.t === 'attack');
    const damage = indexOf(ev, (e) => e.t === 'damage' && e.target === def);
    const destroy = indexOf(ev, (e) => e.t === 'destroy' && e.uid === def);

    expect(attack).toBeGreaterThanOrEqual(0);
    expect(damage).toBeGreaterThan(attack);
    expect(destroy).toBeGreaterThan(damage);
  });

  it('deals both sides’ damage before either death is announced', () => {
    // Two 2/2s trade: the renderer must be able to show the clash, not one
    // follower dying and then hitting back from the graveyard.
    const g = newGame();
    const a = place(g, 0, 't_vanilla');
    const b = place(g, 1, 't_vanilla');
    g.drainEvents();

    g.attack(a, b);
    const ev = g.drainEvents();
    const lastDamage = ev.map((e) => e.t).lastIndexOf('damage');
    const firstDestroy = ev.map((e) => e.t).indexOf('destroy');
    expect(firstDestroy).toBeGreaterThan(lastDamage);
    expect(ev.filter((e) => e.t === 'destroy')).toHaveLength(2);
  });

  it('runs Last Words after the death that triggered it', () => {
    const g = newGame();
    const dying = place(g, 1, 't_lastwords');
    const atk = place(g, 0, 't_big');
    g.drainEvents();

    g.attack(atk, dying);
    const ev = g.drainEvents();
    const destroy = indexOf(ev, (e) => e.t === 'destroy' && e.uid === dying);
    const ability = indexOf(ev, (e) => e.t === 'ability' && e.kind === 'lastWords');
    expect(destroy).toBeGreaterThanOrEqual(0);
    expect(ability).toBeGreaterThan(destroy);
  });

  it('emits an attack on the leader as a leader-targeted damage event', () => {
    const g = newGame();
    const atk = place(g, 0, 't_big');
    g.drainEvents();

    g.attack(atk, 'leader');
    const ev = g.drainEvents();
    const attack = ev.find((e) => e.t === 'attack');
    expect(attack).toMatchObject({ defender: { leader: 1 } });
    expect(ev.find((e) => e.t === 'damage')).toMatchObject({ target: { leader: 1 } });
    expect(LEADER_UID(1 as PlayerId)).toBeLessThan(0);
  });
});

describe('event order at a turn boundary', () => {
  it('ends the turn, then starts the next, then draws for it', () => {
    const g = newGame();
    g.drainEvents();
    g.endTurn();
    const ev = kinds(g);
    const end = ev.indexOf('turnEnd');
    const start = ev.indexOf('turnStart');
    const draw = ev.indexOf('draw');
    expect(end).toBeGreaterThanOrEqual(0);
    expect(start).toBeGreaterThan(end);
    // The draw is the last step of the start-of-turn sequence.
    expect(draw).toBeGreaterThan(start);
  });

  it('reports the play-point change before the draw', () => {
    const g = newGame();
    g.drainEvents();
    g.endTurn();
    const ev = kinds(g);
    expect(ev.indexOf('ppChange')).toBeLessThan(ev.indexOf('draw'));
  });
});

describe('the stream is a queue, not a log', () => {
  it('hands each event out exactly once', () => {
    const g = newGame();
    const first = g.drainEvents();
    expect(first.length).toBeGreaterThan(0);
    expect(g.drainEvents()).toEqual([]);
  });

  it('opens with the game start and the seat that goes first', () => {
    const g = newGame(deck('neutral'), deck('neutral'), { first: 1, seed: 5 });
    const ev = g.drainEvents();
    expect(ev[0]).toMatchObject({ t: 'gameStart', first: 1, seed: 5 });
  });

  it('ends with a game-over event and nothing after it', () => {
    const g = newGame();
    g.player(1).defense = 1;
    const atk = place(g, 0, 't_big');
    g.drainEvents();
    g.attack(atk, 'leader');
    const ev = g.drainEvents();
    const over = indexOf(ev, (e) => e.t === 'gameOver');
    expect(over).toBeGreaterThanOrEqual(0);
    expect(ev.slice(over + 1).filter((e) => e.t !== 'log')).toEqual([]);
  });
});
