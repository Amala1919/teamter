# Teamter

A Three.js digital collectible card game built as a close study of the original
*Shadowverse* (Cygames, 2016), covering the launch set through the fifth card
pack, *Wonderland Dreams* (June 2017).

**Personal use only.** This project is not distributed, sold, published,
publicly hosted, or packaged for release. See `ASSET_LICENSES.md`.

---

## Running it

Requires **Node.js 20 or newer** (developed on 22).

```bash
npm install
npm run dev
```

Then open **http://localhost:5173**.

That is the whole setup — the card database and the illustration subject map
ship in the repository (`src/data/generated/`), the artwork around those
subjects is generated at runtime, and all audio is synthesised, so there is
nothing to download or unpack.

The interface is **Japanese** by default, matching the card database. Append
`?lang=en` to any URL for English.

### Production build

```bash
npm run build     # typechecks, then builds to dist/
npm run preview   # serves dist/ on http://localhost:4173
```

---

## Playing

The game is designed for **landscape** — a phone held sideways, a tablet, or a
desktop browser.

| Action | How |
|---|---|
| Play a card | Drag it from your hand onto the board |
| Choose a target | The card highlights legal targets — click one |
| Attack | Drag one of your followers onto an enemy follower or leader |
| Evolve | Click the **Evolve** button that appears over the follower |
| Enhance | Drop the card, then pick the cost you want to pay |
| Read a card | Right-click or long-press it — including the opponent's board, whose cards are otherwise too small to read. Tapping a card you cannot act on opens it straight away. |
| End your turn | The **End Turn** button, bottom right |

Seven starter decks — one per class — are created the first time you open the
game. The deck builder and collection cover all 825 collectible cards.

### Cards marked "Partial"

The card database is complete, but not every card's printed text has an engine
implementation yet (currently **80%** do). Cards that fall short are badged
**Partial** in the collection and deck builder, and their card detail view
lists exactly which lines have no behaviour. They are playable, but they do
less than they say. Generated starter decks never include them.

---

## Development

| Command | What it does |
|---|---|
| `npm run dev` | Dev server on 127.0.0.1:5173 |
| `npm test` | Rules and card tests (Vitest, no browser needed) |
| `npm run sim -- 300` | 300 AI-vs-AI matches over the real card pool |
| `npm run cards:report -- --lines` | Card-text compiler coverage, and what is still unparsed |
| `npm run typecheck` | `tsc --noEmit` |
| `node tools/smoke.mjs` | End-to-end browser test (needs `npm run dev` running) |
| `node tools/shoot.mjs <path> <out.png>` | Screenshot a page for visual review |

### URL parameters

Useful for jumping straight to a screen while working on it:

| URL | Goes to |
|---|---|
| `/?screen=collection` | Card collection |
| `/?screen=deck` | Deck builder |
| `/?screen=pack` | Pack opening |
| `/?battle=1&me=dragon&foe=forest` | Straight into a match |
| `/?demo=13&me=dragon&foe=forest` | A match fast-forwarded to turn 13 |
| `/gallery.html?n=8&scale=0.8` | A grid of card faces, no game |
| `/?lang=en` | Any of the above in English |

### Regenerating the card database

Only needed if the upstream data changes:

```bash
mkdir -p .cache
curl -o .cache/en.json https://raw.githubusercontent.com/user6174/shadowverse-json/master/en/all.json
curl -o .cache/ja.json https://raw.githubusercontent.com/user6174/shadowverse-json/master/ja/all.json
npm run cards:build
```

### Regenerating the illustration subject map

Only needed when the card database or the keyword tables change:

```bash
node tools/build-cardart.mjs
```

It prints how each card was matched and names any icon in the tables that does
not exist upstream.

---

## Documentation

| File | Contents |
|---|---|
| `IMPLEMENTATION_PROGRESS.md` | **Start here** — what exists, what is broken, what is next |
| `ARCHITECTURE.md` | How the layers fit together and why |
| `RULES.md` | The rules as implemented, and where they knowingly diverge |
| `CARD_DATA_FORMAT.md` | The card data pipeline and the effect DSL |
| `TESTING.md` | What is tested and how to add to it |
| `VISUAL_REFERENCE.md` | Palette, typography, layout and timing |
| `ASSET_LICENSES.md` | Every asset, where it came from, and under what terms |
| `docs/research/` | The source research: a 900-line rules specification and a 1200-line visual reference |

---

## A note on artwork

Official Shadowverse card illustrations were **not obtainable** in the
environment this was built in — the network policy blocks every host that
serves them. Card *data* was reachable through a mirror of the official Portal
API, so names, stats and rules text are accurate.

Each card's illustration is therefore drawn here, in a generated scene.
`tools/build-cardart.mjs` matches every card to a subject by name — proper
nouns first, then a hand-authored noun table, then the card's tribe, then a
curated pool for its class and type — and classifies it:

- **464 cards depict a person.** `src/art/portrait.ts` draws an original
  cel-shaded anime figure: face, eyes, hair, costume by archetype, headgear,
  wings and a weapon held in a drawn fist, rolled from the card's seed, class
  and cost.
- **226 depict a beast.** `src/art/creature.ts` draws dragons, wolves, birds,
  serpents, skeletons, ghosts, golems, slimes, insects, demons and imps.
- **214 are spells, amulets or objects.** Those use a silhouette from **[Game
  Icons](https://game-icons.net/)** (CC BY 3.0, by the game-icons.net
  contributors), lit and modelled.

`src/art/illustration.ts` seats the subject inside a procedurally graded sky,
horizon, architecture and atmosphere. The result is deterministic per card, so
art never shifts between sessions. Full attribution is in `ASSET_LICENSES.md`.

The renderer is nonetheless built to prefer official art if it is ever
supplied: drop images into `public/assets/official/` and pass them through
`CardFaceOptions.officialArt`. The card-name renderer draws onto the frame's
name band the same way either way, so a supplied image and a generated one look
like the same product.
