# Architecture

The project is layered so that the rules never depend on the renderer, and the
renderer never mutates the rules. Data flows one way down, and player intent
flows one way back up.

```
  card data (JSON)  ──►  card-text compiler  ──►  CardDef[]  ──►  registry
                                                                    │
                                                                    ▼
   player intent ─────────────────► Game (rules engine) ────► GameEvent[]
        ▲                                  │                       │
        │                                  ▼                       ▼
        └──────────── Battle (screen) ◄─ state reads ───────  animation queue
                            │                                      │
                            ├──► Stage / Board / CardObject (Three.js)
                            ├──► Effects (particles, ribbons, flashes)
                            ├──► Hud (DOM overlay)
                            └──► Audio (Web Audio synthesis)
```

## Layers

| Layer | Path | Knows about |
|---|---|---|
| Card data | `src/data/generated/cards.json` | nothing — plain records |
| Illustration subjects | `src/data/generated/cardart.json` | nothing — an id-to-subject table, an id-to-icon map and path data |
| Compiler | `src/data/compile.ts` | the effect DSL |
| Registry | `src/engine/registry.ts` | `CardDef` |
| Rules engine | `src/engine/game.ts` | cards, state, its own event stream |
| AI | `src/game/ai.ts` | the engine's **public** API only |
| Battle screen | `src/game/battle.ts` | engine state (read), renderer, HUD, audio |
| Renderer | `src/render/*` | Three.js, art |
| Art | `src/art/*` | canvas 2D; no engine state |
| HUD | `src/ui/*` | DOM; plain values passed in |
| Audio | `src/audio/*` | Web Audio; cue names only |
| Interface language | `src/i18n.ts` | nothing — a string table and the card record's own fields |

### The one-way rule

`src/engine/**` imports nothing from `src/render`, `src/ui`, `src/game` or
`src/art`. The engine's only outbound channel is `GameEvent`, drained by the
presentation layer with `game.drainEvents()`.

This is what makes the engine testable headlessly: `tests/rules.test.ts` and
`tools/simulate.ts` both drive full matches with no DOM at all.

### The event stream

The engine appends a `GameEvent` for everything a player could see: draws,
plays, summons, attacks, damage, heals, evolutions, destructions, banishes,
countdown ticks, shadows and game over. Events are emitted **in resolution
order**. The renderer may compress or skip them, but must never reorder them —
event order is the game's causal order.

`Battle.drainQueue` plays them one beat at a time, holding for a per-event
duration so a Fanfare that kills three followers reads as three deaths rather
than one frame of state change.

## Key design decisions

### Data-driven cards

A card's rules text is compiled into an `Effect[]` tree rather than into
per-card code. The vocabulary (`Effect`, `Selector`, `Condition`, `Amount` in
`src/engine/types.ts`) is small and closed; the engine is an interpreter for
it. Cards the grammar cannot express get a hand-written entry in
`src/data/overrides.ts` and are marked `implemented: false` until they do.

See `CARD_DATA_FORMAT.md`.

### Pull-model auras

Continuous effects ("allied followers have +1/+0") are not applied as stored
buffs. `Game.stats()` recomputes them on every read by walking the board. The
board never exceeds ten entities, so the cost is irrelevant, and it removes a
whole class of stale-buff bugs — when the source leaves, the buff is simply
gone on the next read.

### Spring-damped card motion

`CardObject` holds a *target* transform and springs toward it each frame
(`src/render/cardmesh.ts`). Layout code says where a card belongs; it never
animates. Any interruption — a card played mid-flight, a board re-centring
under a new follower — resolves smoothly with no keyframe bookkeeping.

### DOM for the HUD, WebGL for the world

Text in a WebGL canvas is either blurry or expensive. Everything with a number
or a label on it (play points, evolution points, End Turn, the log, results)
is DOM layered over the canvas; everything spatial is Three.js.

### One language switch, no language plumbing

`src/i18n.ts` reads the language once from the URL and exposes `t(key)` plus
four card accessors (`cardName`, `cardText`, `cardEvoText`, `cardFlavor`).
Nothing threads a locale through its call chain, and no component takes a
language parameter it then has to pass on. The card renderer is the one
exception: `drawCardFace` accepts an explicit `lang` so the gallery tool can
render both languages side by side, and defaults to the app's.

The card database carries both languages already, so a card's name and rules
text are never translated by this project — they are read from the field the
current language names.

### Leaders are not entities

Everything on the board is an `Entity` with a uid, and effects address entities
through a `Selector`. A leader is not one — it is a few fields on `PlayerState`
— which is why leaders are reached through sentinel uids (`LEADER_UID`) for
damage and healing, and why "give your leader the following effect" needs its
own effect kind rather than reusing `grantAbility`.

`PlayerState.leaderEffects` holds them. Each entry carries flags, abilities, or
both, plus the turn index at which it lapses:

- **Flags** are named restrictions, each checked at exactly one place in the
  engine (`cantPlayFollowers` in `canPlay`, `noPlayPointGain` in `beginTurn`,
  `noFanfare` where Fanfare fires). Anything a card asks for that is not in the
  list fails to compile rather than being approximated.
- **Abilities** fire alongside every entity's, from `fireLeaderTriggers`, with
  no source entity — so `scope: 'self'` does not resolve, and the cards that
  grant them never use it.

### Illustrations are drawn, not composed

`src/art` has three layers under `illustration.ts`, and they are separate on
purpose:

| Module | Responsibility |
|---|---|
| `celshade.ts` | The drawing vocabulary — HSL ramps, the cel shader, smoothed blobs, tapered slivers, and the colour-separation rules |
| `portrait.ts` | Anime characters: 20 archetypes, weapons, headgear, wings |
| `creature.ts` | 11 creature kinds |

Both figure modules work in **head units** — the head is 2 units wide with its
origin at the centre — so `illustration.ts` seats any of them with one
transform and never needs to know how a figure is built. Neither imports the
other; both import only `celshade.ts`. The subject a card gets is decided
offline by `tools/build-cardart.mjs` and read back through
`subjectKindFor(cardId)`, so the renderer makes no naming decisions at runtime.

### Deterministic randomness

Every random decision goes through `Rng` (`src/engine/rng.ts`), seeded per
match. A seed reproduces a match exactly, which is what makes the soak test in
`tools/simulate.ts` meaningful and makes any bug it finds reproducible.

## Build and tooling

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server on 127.0.0.1:5173 |
| `npm test` | Vitest — headless rules tests |
| `npm run sim -- 300` | AI-vs-AI soak across the real card pool |
| `npm run cards:build` | Regenerates `src/data/generated/cards.json` from `.cache/` |
| `npm run cards:report -- --lines` | Card-text compiler coverage, and what is still unparsed |
| `npm run typecheck` | `tsc --noEmit` |
| `node tools/shoot.mjs <path> <out.png>` | Screenshot a page for visual review |
| `node tools/build-cardart.mjs` | Regenerates the subject table and card-to-icon map in `src/data/generated/cardart.json` |
| `node tools/smoke.mjs` | End-to-end browser test against a running dev server |

`gallery.html` renders a grid of card faces without booting the game; the main
entry accepts `?me=`, `?foe=`, `?seed=`, `?lang=en` and `?demo=<turn>` for
reaching a specific board state.

### Test hooks in the interface

The end-to-end test drives the real UI, so it needs handles that do not move
when the copy or the language does. Buttons carry `data-act` and filter chips
carry `data-key`; `tools/smoke.mjs` selects on those and never on text.
