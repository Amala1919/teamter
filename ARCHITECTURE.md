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
| Compiler | `src/data/compile.ts` | the effect DSL |
| Registry | `src/engine/registry.ts` | `CardDef` |
| Rules engine | `src/engine/game.ts` | cards, state, its own event stream |
| AI | `src/game/ai.ts` | the engine's **public** API only |
| Battle screen | `src/game/battle.ts` | engine state (read), renderer, HUD, audio |
| Renderer | `src/render/*` | Three.js, art |
| Art | `src/art/*` | canvas 2D; no engine state |
| HUD | `src/ui/*` | DOM; plain values passed in |
| Audio | `src/audio/*` | Web Audio; cue names only |

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

`gallery.html` renders a grid of card faces without booting the game; the main
entry accepts `?me=`, `?foe=`, `?seed=` and `?demo=<turn>` for reaching a
specific board state.
