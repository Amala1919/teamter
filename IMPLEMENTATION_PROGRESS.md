# Implementation progress

Read this first if you are picking the project up. It records what exists, what
is known-broken, and what to do next.

Last updated: after the battle screen, rules corrections and documentation pass.

## State of play

| Milestone | Status |
|---|---|
| 0 — Research and specification | **Done.** `docs/research/RULES_RESEARCH.md` (909 lines, sourced, with uncertainty flagged) and `docs/research/VISUAL_RESEARCH.md` (1176 lines). |
| 1 — Rules engine, deterministic simulation | **Done.** 52 unit tests; 300-game AI-vs-AI soak with 0 failures. |
| 2 — Card data and the Standard set | **Done.** All 888 cards (825 collectible + 63 tokens) from Basic through Wonderland Dreams, from the official card database. |
| 3 — Three.js battle screen and card renderer | **Done.** |
| 4 — Playable battle flow | **Done** apart from the mulligan screen. |
| 5 — UI reproduction and feel | **Partial.** Battle HUD done; menu, mulligan, deck builder and collection are not built. |
| 6 — All cards through Wonderland Dreams | **Partial.** All cards are present and playable; 62% have every printed line implemented. |
| 7 — Evolution, effects, particles, audio | **Done.** Premium card treatment is baked rather than live. |
| 8 — Deck builder and collection | **Not started.** |
| 9 — Visual comparison and QA | **Partial.** Iterated by screenshot; no side-by-side against real captures — official screenshots are unreachable from this environment. |
| 10 — Optimisation and final polish | **Not started.** |

## What works

- Full battle against an AI: play cards, target, attack, evolve, win or lose.
- 888 cards loaded from the official database with EN and JA names, correct
  printed evolved stats, traits, tokens and flavour text.
- Rules: turn structure, play points, evolution economy for both seats, Ward /
  Storm / Rush / Bane / Drain / Ambush, combat, Last Words batching, banish vs
  destroy, transform, Countdown amulets, Spellboost, Necromancy, Earth Rite,
  Vengeance, Overflow, Enhance, board and hand limits, deck-out.
- Procedural art for every card, leader and board surface; synthesised audio.

## Known gaps

### Card implementation — 337 of 888 cards

Cards with at least one printed line the compiler does not understand carry
`implemented: false` and `missingText`, and are excluded from generated decks.
They are still playable but do less than they say.

`npm run cards:report -- --lines 60` prints the work queue. The largest
remaining clusters:

- "Give all other allied followers the following effect …" — granting a
  *composite* effect to other cards has no representation in the DSL yet.
- "Randomly summon 1 of the following — A, B, or C."
- Deck manipulation: "Replace your deck with …", "Put a random N-cost follower
  from your deck into play".
- "It can't attack next turn" — needs a duration the engine does not model.
- Leader-attached persistent effects (Queen Medb, Bloody Mary).

### Missing screens

There is no main menu, mulligan, deck builder, collection, card detail or pack
opening. The battle boots directly from `src/main.ts` with generated starter
decks. `src/data/decks.ts` already has `deckPool`, `validateDeck` and
`buildStarterDeck`, so the deck builder has its data layer ready.

### Other

- Mulligan is skipped (`skipMulligan: true`); `Game.mulligan` is implemented and
  tested but nothing drives it.
- No turn timer.
- No bloom or post-processing; glows are additive geometry.
- No leader animations or voice lines.
- Enhance is implemented in the engine and compiled from card text, but the
  battle UI has no way to *choose* an Enhance level — `Battle` never passes
  `enhance`.
- `Effects.lunge` uses `setTimeout`, which does not respect a paused or
  fast-forwarded game.

## Recommended next steps

1. **Mulligan screen.** Small, and it is the one missing piece of the core loop.
2. **Deck builder and collection.** The data layer exists; this is a UI job.
   Show the `implemented` flag prominently.
3. **Raise compiler coverage.** Each cluster above is worth 10-30 cards. Add
   `grantEffect` (a follower granting an ability to others) and a
   `duration: 'nextTurn'` to the buff system first — between them they unlock
   the two largest clusters.
4. **Enhance in the UI.** The engine supports it; the player cannot reach it.
5. **Event-order tests.** Nothing currently asserts the `GameEvent` sequence,
   only its effect on state.

## Environment notes

Two constraints shaped the project and will shape anyone continuing it:

- **Network egress is restricted** to package registries and
  `raw.githubusercontent.com`. Card *data* was reachable through a GitHub
  mirror of the official Portal API; card *artwork*, the Fandom wiki, and every
  official Shadowverse host were not. All art is generated (see
  `ASSET_LICENSES.md`), and the renderer is built to accept official art if it
  is ever supplied.
- **This project is personal-use only.** Do not distribute, publish, host
  publicly or package it.

## Bugs fixed along the way

Worth knowing about, because each was invisible until something specific
exercised it:

- `Game.firstPlayer` read the first-turn seat out of the event log, which the
  renderer drains every frame. Half of all matches unlocked evolution on the
  wrong turn. Caught by the AI soak's first/second win split being 90/210
  instead of 144/156.
- Amulets were destroyed the instant they were played, because the state-based
  death check treated their absent defense stat as 0.
- Empty board sockets marched off to the right, because unused slots were laid
  out with the spacing of the occupied row.
- `Countdown (2)` lost its value: the card-text preprocessor stripped trailing
  parentheses as reminder text.
