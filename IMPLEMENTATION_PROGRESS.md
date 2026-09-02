# Implementation progress

Read this first if you are picking the project up. It records what exists, what
is known-broken, and what to do next.

Last updated: after the artwork rework, the Japanese interface, the in-battle
card inspector, the compiler-coverage push and the leader animations.

## State of play

| Milestone | Status |
|---|---|
| 0 — Research and specification | **Done.** `docs/research/RULES_RESEARCH.md` (909 lines, sourced, with uncertainty flagged) and `docs/research/VISUAL_RESEARCH.md` (1176 lines). |
| 1 — Rules engine, deterministic simulation | **Done.** 167 unit tests; 250-game AI-vs-AI soak with 0 failures. |
| 2 — Card data and the Standard set | **Done.** All 888 cards (825 collectible + 63 tokens) from Basic through Wonderland Dreams, from the official card database, in both languages. |
| 3 — Three.js battle screen and card renderer | **Done.** |
| 4 — Playable battle flow | **Done,** including the mulligan. |
| 5 — UI reproduction and feel | **Done.** Battle HUD, menu, mulligan, deck builder, collection, card detail, in-battle inspector. |
| 6 — All cards through Wonderland Dreams | **Partial.** All cards are present and playable; **79%** have every printed line implemented. |
| 7 — Evolution, effects, particles, audio | **Done.** Bloom, particles, camera shake, synthesised audio, leader animation. |
| 8 — Deck builder and collection | **Done.** Decks persist to localStorage and are validated live. |
| 9 — Visual comparison and QA | **Partial.** Iterated by screenshot; no side-by-side against real captures — official screenshots are unreachable from this environment. |
| 10 — Optimisation and final polish | **Partial.** Card-face painting is 41% faster and the grid no longer paints a screenful in one callback; the bundle is 224 kB smaller. Nothing profiled beyond that. |

## What works

- Full battle against an AI: play cards, target, attack, evolve, win or lose.
- 888 cards loaded from the official database with names, rules text, evolved
  text and flavour in **both English and Japanese**, correct printed evolved
  stats, traits and tokens.
- Rules: turn structure, play points, evolution economy for both seats, Ward /
  Storm / Rush / Bane / Drain / Ambush, combat, Last Words batching, banish vs
  destroy, transform, Countdown amulets, Spellboost, Necromancy, Earth Rite,
  Vengeance, Overflow, Enhance, board and hand limits, deck-out, damage
  ceilings, outright wins.
- **Japanese interface** by default (`?lang=en` for English), including
  Japanese line breaking and simplified kinsoku in card text.
- **Card artwork** built from real drawn subjects (Game Icons, CC BY 3.0) lit
  and composited into a generated scene, deterministic per card.
- **In-battle card inspector**: any card in a public zone can be opened full
  size with its live stats, evolved state, remaining countdown and current
  keywords — right-click, long-press, or tap a card you cannot act on.
- Leader animation: idle breath, active-turn glow, recoil scaled to the hit,
  a lift on healing, and a sink on defeat.

## Known gaps

### Card implementation — 185 of 888 cards

Cards with at least one printed line the compiler does not understand carry
`implemented: false` and `missingText`, and are excluded from generated decks.
They are still playable but do less than they say, and the collection, deck
builder and card detail all say so.

`npm run cards:report -- --lines 60` prints the work queue. What is left is a
genuine long tail — the largest remaining cluster is four cards — but these
groups still repeat:

- **Granting a composite effect.** "Give all other allied followers the
  following effect until the end of the turn — Reduce damage to 0." The DSL can
  grant keywords and stats, not abilities.
- **Leader-attached effects.** "Give your leader the following effect:
  Followers can't be played" (Queen Medb, Carabosse, Wordwielder Ginger).
- **Damage replacement.** "Deal any damage dealt to your leader to the enemy
  leader instead" (Bloody Mary).
- **Deck manipulation.** "Replace your deck with an Apocalypse Deck", "Put a
  random N-cost follower from your deck into play".
- **An extra turn** (Dimension Shift).

### Other

- No turn timer.
- No leader voice lines.
- No progression economy — the pack ceremony is a card-viewing ritual rather
  than a reward, since the whole collection is available from the start.
- Premium (animated) cards are a baked sheen, not a live shader.

## Recommended next steps

1. **`grantEffect`** — a follower granting an *ability* to others, and the same
   thing attached to a leader. Between them these two unlock the largest
   remaining clusters, and both need a new place to hang abilities that are not
   on a card definition.
2. **Optimisation (milestone 10), continued.** A card face is 7.0 ms to paint
   at collection scale, of which 4.6 ms is the illustration; the three
   full-canvas rim-light passes are the obvious next target. The battle scene
   itself has never been profiled.
3. **Leader voice lines**, the last part of the original's presentation with no
   equivalent here.

## Environment notes

Two constraints shaped the project and will shape anyone continuing it:

- **Network egress is restricted** to package registries and
  `raw.githubusercontent.com`. Card *data* was reachable through a GitHub
  mirror of the official Portal API; card *artwork*, the Fandom wiki, and every
  official Shadowverse host were not. Illustration subjects therefore come from
  the copyright-free Game Icons collection and everything around them is
  generated (see `ASSET_LICENSES.md`); the renderer is built to prefer official
  art if it is ever supplied.
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
- "Subtract 1 from the cost of this card" reduced the cost of *every* card in
  hand: the `costMod` effect ignored its own selector.
- "If another allied follower is in play, destroy that follower" compiled to
  the trigger's `other` binding, which is empty during a Fanfare — the card
  destroyed nothing while reporting itself fully implemented.
- The card inspector subtracted damage twice, because `stats().def` already
  nets it out and `maxDef` is the undamaged value.
- The card-name table was keyed by printed capitalisation while lookups came
  from lowercased text, so a name only resolved when the two happened to agree.
- `Effects.lunge` reset the attacker with `setTimeout`, so a lunge could land
  after the battle screen had been disposed and ignored any animation speed-up.
  It is frame-driven now.
- Film grain read the whole canvas back with `getImageData` and walked it a
  pixel at a time, for every card, which was two fifths of the cost of painting
  a card face. It is a repeating tile with a random offset now.
- Rules text longer than the frame was designed for spilled over the stat
  plates instead of staying in its box.
