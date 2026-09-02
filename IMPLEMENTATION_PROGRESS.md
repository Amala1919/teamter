# Implementation progress

Read this first if you are picking the project up. It records what exists, what
is known-broken, and what to do next.

Last updated: after the artwork rework, the Japanese interface, the in-battle
card inspector, the compiler-coverage push and the leader animations.

## State of play

| Milestone | Status |
|---|---|
| 0 — Research and specification | **Done.** `docs/research/RULES_RESEARCH.md` (909 lines, sourced, with uncertainty flagged) and `docs/research/VISUAL_RESEARCH.md` (1176 lines). |
| 1 — Rules engine, deterministic simulation | **Done.** 192 unit tests; 400-game AI-vs-AI soak with 0 failures. |
| 2 — Card data and the Standard set | **Done.** All 888 cards (825 collectible + 63 tokens) from Basic through Wonderland Dreams, from the official card database, in both languages. |
| 3 — Three.js battle screen and card renderer | **Done.** |
| 4 — Playable battle flow | **Done,** including the mulligan. |
| 5 — UI reproduction and feel | **Done.** Battle HUD, menu, mulligan, deck builder, collection, card detail, in-battle inspector. |
| 6 — All cards through Wonderland Dreams | **Partial.** All cards are present and playable; **81.9%** have every printed line implemented. |
| 7 — Evolution, effects, particles, audio | **Done.** Bloom, particles, camera shake, synthesised audio, leader animation. |
| 8 — Deck builder and collection | **Done.** Decks persist to localStorage and are validated live. |
| 9 — Visual comparison and QA | **Partial.** Iterated by screenshot; no side-by-side against real captures — official screenshots are unreachable from this environment. |
| 10 — Optimisation and final polish | **Partial.** Card-face painting is measured by `tools/bench.mjs`: p50 2.3 ms at grid scale, 2.6 ms at board scale. Name fitting on a repaint went from 550 µs to 3 µs a card. The grid no longer paints a screenful in one callback, and the bundle is 224 kB smaller. The battle scene itself has never been profiled. |

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
- **Card artwork** drawn per card: an original cel-shaded anime figure for the
  464 cards that depict a person, an original creature for the 226 that depict
  a beast, and a Game Icons silhouette (CC BY 3.0) for the 214 spells, amulets
  and objects — each composited into a generated scene, deterministic per card.
- **In-battle card inspector**: any card in a public zone can be opened full
  size with its live stats, evolved state, remaining countdown and current
  keywords — right-click, long-press, or tap a card you cannot act on.
- Leader animation: idle breath, active-turn glow, recoil scaled to the hit,
  a lift on healing, and a sink on defeat.

## Known gaps

### Card implementation — 161 of 888 cards

Cards with at least one printed line the compiler does not understand carry
`implemented: false` and `missingText`, and are excluded from generated decks.
They are still playable but do less than they say, and the collection, deck
builder and card detail all say so.

`npm run cards:report -- --lines 60` prints the work queue. What is left is a
genuine long tail — every remaining unparsed line is now unique to one card —
but these groups still repeat:

- **Durations tied to a card staying in play.** "Until this follower leaves
  play", "until this amulet leaves play". A grant now carries its own expiry
  turn — permanent, this turn, or through the opponent's turn — but nothing
  hangs an expiry on another entity's lifetime. Cards asking for that stay
  partial rather than getting a shorter effect than they print.
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

1. **Grants that pick their targets once and then persist.** Captain Lecia
   gives her effects to the Officers in play *at Fanfare time* and keeps them
   until she leaves. An aura is the wrong shape — it would also catch Officers
   that arrive later — and a grant has no expiry keyed to another entity's
   lifetime, so she stays partial.
2. **Optimisation (milestone 10), continued.** `tools/bench.mjs` reports p50
   2.3 ms at grid scale and 2.6 ms at board scale; the p95 tail (~5 ms grid,
   ~20 ms board) is the remaining target, and the battle scene itself has never
   been profiled.
3. **Leader voice lines**, the last part of the original's presentation with no
   equivalent here.

## Environment notes

Two constraints shaped the project and will shape anyone continuing it:

- **Network egress is restricted** to package registries and
  `raw.githubusercontent.com`. Card *data* was reachable through a GitHub
  mirror of the official Portal API; card *artwork*, the Fandom wiki, and every
  official Shadowverse host were not. Illustrations are therefore drawn by this
  project — original cel-shaded characters and creatures, with the
  copyright-free Game Icons collection covering only spells, amulets and
  objects (see `ASSET_LICENSES.md`); the renderer is built to prefer official
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
- Princess Snow White's hand-written entry dropped the "Then remove all its
  effects" clause, so the copy it summons kept the same Last Words and
  resurrected itself forever. The AI soak found it as a game that never ended.
- "Give +0/+1 and Ward to allied Zombies" compiled to a single player-chosen
  Zombie. A bare plural with no determiner carries no `all`, so it fell through
  to the default scope and quietly became a different card. Every card that
  names a tribe or a token in the plural was affected.
- Blood Moon forces Vengeance on by looking at what is in play, and several
  cards carry auras *gated on* Vengeance. Asking the aura list closed the loop
  and the soak found it as seven stack overflows in 200 games. An unconditional
  force answers without asking anything, so only a conditional one is skipped
  while an aura condition is being evaluated.
- Queen Medb, Carabosse and Mysterian Grimoire hang effects on a *leader*,
  which is not an entity and had nowhere to keep them. Leaders now carry their
  own effect list — named restrictions the engine enforces at one place each,
  plus triggered abilities that fire with no source entity.
- "At the end of this turn" and "at the end of your turn" read the same to the
  compiler, so Mysterian Grimoire's one-shot leader effect would have discarded
  the player's spells at the end of every turn for the rest of the match.
- Fitting a card name walked the font size down half a point at a time, up to
  eighty `ctx.font` assignments a card, each a font lookup — 380 ms on a long
  Japanese name, and it landed on the card *face*, so it looked like the
  illustration was at fault. It is a binary search now, with the full size
  tried first so a short name still costs one measurement.
- Temporary grants all expired at the end of whatever turn happened to be
  ending, so nothing could last through the opponent's turn. Each grant now
  carries its own expiry, which also means a this-turn grant landing on a
  follower no longer cuts short a longer one already on it.
- An aura whose condition counts the board recursed until the stack gave out:
  counting resolves a selector, resolving one reads `stats` to check for
  Ambush, and `stats` asks for the active auras again. Bahamut was the only
  card that could reach it, and only once its Fanfare stopped asking for a
  target. Aura conditions now see pre-aura stats.
- "Reduce damage to 0" and "Reduce damage from effects to 0" compiled to the
  same keyword, so Athena's followers still died in a trade.
