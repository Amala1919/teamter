# Testing

The rules engine is testable with no DOM, no WebGL and no timers. That is the
whole point of the layering in `ARCHITECTURE.md`: if a rule needs a browser to
verify, it is in the wrong place.

## Commands

| Command | What it covers |
|---|---|
| `npm test` | Rules unit tests (`tests/rules.test.ts`) |
| `npm run sim -- 300 99` | 300 AI-vs-AI matches over the real card pool, seeded |
| `npm run cards:report -- --lines` | Card-text compiler coverage and the unparsed remainder |
| `npm run typecheck` | `tsc --noEmit` over `src/`, `tests/` and the Vite config |
| `node tools/shoot.mjs <path> <out.png>` | Screenshot for visual review (dev server must be running) |

## Unit tests

`tests/rules.test.ts` — 52 tests over the engine. They run against a small
hand-written card set in `tests/helpers.ts` rather than the real card pool, so
a rules test never breaks because a card was rebalanced upstream.

Covered:

- **Setup** — deck size, 3-card mulligan for both players, mulligan shuffle
  behaviour, leader defense, determinism from a seed.
- **Turn structure** — play point gain and cap, refill, the going-second extra
  draw, evolution point grants for both seats including when player 1 goes
  first.
- **Playing cards** — cost payment, board limit, summon fizzling on a full
  board, Fanfare resolving with the follower already on board, spells reaching
  the cemetery, unplayable targeted spells with no legal target, hand-limit
  burn.
- **Attacking** — summoning sickness, Storm, Rush, Ward redirection, simultaneous
  combat damage, Bane, Drain (including that a defending Drain follower does
  *not* heal), the leader defense cap, Ambush hiding a follower from attacks and
  from enemy targeting, one attack per turn.
- **Evolution** — availability by turn, printed evolved stats rather than a
  blanket +2/+2, one evolution per turn, attacking followers but not the leader
  after evolving, Evolve abilities.
- **Effects** — Last Words, banish *not* firing Last Words, shadows granted on
  destruction but not banish, simultaneous Last Words ordering, aura application
  and removal, Countdown ticking and breaking, permanent vs until-end-of-turn
  buffs, transform discarding all modifiers, draws, leader targeting.
- **Win conditions** — lethal, simultaneous death as a draw, deck-out as an
  immediate loss, no actions after the game ends.

### Adding a test

Use the helpers rather than reaching into engine internals:

```ts
const g = newGame();                    // seeded, mulligan skipped
advanceToTurn(g, 5);                    // pass turns until turn 5
const uid = place(g, 0, 't_ward');      // straight onto the board, no cost
const card = toHand(g, 0, 't_bolt');    // into hand
g.playCard(card, [uid]);                // targets are supplied as uids
```

`place()` marks the entity as having entered on turn -1, so it can attack
immediately — pass through `playCard` instead when summoning sickness matters.

## The soak test

`tools/simulate.ts` plays complete AI-vs-AI matches over the **real** 888-card
pool. This is the only practical way to exercise several hundred compiled
abilities: any thrown error, any refused-action loop and any match that fails
to terminate is a bug.

```
$ npm run sim -- 300 99
games        300
first wins   144
second wins  156
draws        0
avg turns    16.1
failures     0
```

The first/second split is a rules canary as much as a balance one. It caught a
real bug: `Game.firstPlayer` used to read the first-turn seat out of the event
log, which the renderer drains every frame, so half of all matches unlocked
evolution on the wrong turn. The split was 90/210 before the fix and 144/156
after.

Because every match is seeded, any failure the soak reports is reproducible:
the seed for match `i` is `baseSeed + i * 7919`.

## Compiler coverage

```
$ npm run cards:report
cards            888
fully compiled   477
vanilla          74
hand-written     0
incomplete       337
coverage         62.0%
```

"Incomplete" cards have at least one printed line the compiler did not
understand. They carry `implemented: false` and `missingText`, are excluded
from generated decks, and are flagged in the collection UI — a card is never
silently weaker than it reads.

`--lines N` prints the most common unparsed lines, which is the work queue for
raising coverage.

## Visual review

There is no automated visual assertion; visual work is reviewed by
screenshotting and looking.

```
npm run dev &
node tools/shoot.mjs "/gallery.html?n=8&scale=0.8" screenshots/cards.png 1500 900
node tools/shoot.mjs "/?demo=13&me=dragon&foe=forest" screenshots/battle.png 1600 900
```

`gallery.html` accepts `?ids=`, `?class=`, `?n=`, `?scale=`, `?evolved=1`,
`?premium=1` and `?lang=ja`. The battle entry accepts `?me=`, `?foe=`, `?seed=`
and `?demo=<turn>` to fast-forward both sides with the AI.

## What is not covered yet

- No tests for the renderer, HUD or audio.
- No test asserts the *order* of the emitted `GameEvent` stream, only its
  effect on state.
- The 337 partly-implemented cards are covered only by the soak test not
  crashing on them.
