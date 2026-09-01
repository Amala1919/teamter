/**
 * Headless AI-vs-AI soak test.
 *
 * Plays complete games across every class pairing using the real card pool,
 * which is the only practical way to exercise 800 cards' worth of compiled
 * abilities. Any thrown error, stalled turn or absurd game length is a bug.
 *
 *   npm run sim -- [games] [seed]
 */
import { loadCards } from '../src/data/index';
import { buildStarterDeck } from '../src/data/decks';
import { Game } from '../src/engine/game';
import { chooseAiTurn } from '../src/game/ai';
import { CRAFT_CLASSES, type PlayerId } from '../src/engine/types';

loadCards();

const games = Number(process.argv[2] ?? 60);
const baseSeed = Number(process.argv[3] ?? 1);

let wins = [0, 0];
let draws = 0;
let totalTurns = 0;
let failures = 0;
const errors = new Map<string, number>();
const turnHistogram = new Map<number, number>();

for (let i = 0; i < games; i++) {
  const a = CRAFT_CLASSES[i % CRAFT_CLASSES.length];
  const b = CRAFT_CLASSES[(i * 3 + 1) % CRAFT_CLASSES.length];
  const seed = baseSeed + i * 7919;

  try {
    const game = new Game([buildStarterDeck(a, seed), buildStarterDeck(b, seed + 1)], {
      seed,
      first: (i % 2) as PlayerId,
      skipMulligan: true,
    });

    let steps = 0;
    while (game.state.winner === null && steps++ < 4000) {
      const action = chooseAiTurn(game, game.state.active);
      const ok = game.apply(action);
      if (!ok) {
        // A refused action would loop forever; ending the turn always works.
        game.apply({ a: 'endTurn' });
      }
      game.drainEvents();
      if (game.state.turn > 120) break;
    }

    if (game.state.winner === 'draw') draws++;
    else if (game.state.winner !== null) wins[game.state.winner]++;
    totalTurns += game.state.turn;
    turnHistogram.set(game.state.turn, (turnHistogram.get(game.state.turn) ?? 0) + 1);

    if (game.state.winner === null) {
      failures++;
      errors.set(`stalled after ${game.state.turn} turns (${a} vs ${b})`, 1);
    }
  } catch (e) {
    failures++;
    const msg = e instanceof Error ? `${e.message}` : String(e);
    errors.set(msg, (errors.get(msg) ?? 0) + 1);
  }
}

console.log(`games        ${games}`);
console.log(`first wins   ${wins[0]}`);
console.log(`second wins  ${wins[1]}`);
console.log(`draws        ${draws}`);
console.log(`avg turns    ${(totalTurns / games).toFixed(1)}`);
console.log(`failures     ${failures}`);
if (errors.size > 0) {
  console.log('\nissues:');
  for (const [msg, n] of [...errors].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
    console.log(`  ${String(n).padStart(3)}  ${msg}`);
  }
}
process.exit(failures > 0 ? 1 : 0);
