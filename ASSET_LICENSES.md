# Assets and licensing

**This project is for the author's personal use only. It is not distributed,
sold, published, publicly hosted, or packaged for release.**

## Official Shadowverse material

### Card data — used

| | |
|---|---|
| **What** | Card names (EN + JA), classes, sets, rarities, types, costs, base and evolved stats, traits, ability text, flavour text, token relationships |
| **Source** | A GitHub mirror of the official Shadowverse Portal card API: `https://raw.githubusercontent.com/user6174/shadowverse-json` (`master/en/all.json`, `master/ja/all.json`) |
| **Upstream** | Cygames, Inc. — Shadowverse Portal |
| **Rights** | © Cygames, Inc. All rights reserved. Not licensed for redistribution. |
| **In this repo** | `src/data/generated/cards.json` — filtered to Basic through *Wonderland Dreams* and normalised; the raw mirrors live in `.cache/` and are gitignored |
| **Processing** | Filtered by expansion and class, alternate-art reprints removed, tokens resolved transitively, ability text normalised, ids slugified |

### Card artwork — **not** used

Official card illustrations were **not obtainable** in this environment.
`shadowverse-portal.com`, `shadowverse.jp`, `svgdb.me` and every other art host
are blocked by the network egress policy (403 on CONNECT); only
`raw.githubusercontent.com` and package registries are reachable. No mirror of
the era's card images was reachable either.

Every illustration in the game is therefore **drawn by this project**: a
cel-shaded anime character or creature for cards that depict a being, and a
Game Icons silhouette for the rest, composited into a procedurally generated
scene. The split, over the 904 cards that carry key art:

| Subject | Cards | Drawn by |
|---|---|---|
| Character | 464 | `src/art/portrait.ts` — original, no third-party content |
| Creature | 226 | `src/art/creature.ts` — original, no third-party content |
| Emblem | 214 | A Game Icons silhouette (below), lit and modelled |

The renderer is nonetheless built to prefer official art if it is ever
supplied: drop images into `public/assets/official/` keyed by card id and pass
them through `CardFaceOptions.officialArt`, and the card-name renderer will
draw the name onto the frame's name band exactly as it does over generated art.

## Third-party artwork — Game Icons

| | |
|---|---|
| **What** | 4133 hand-drawn fantasy icons; 195 of them are used — as the *subject* of the 214 emblem cards (spells, amulets and anything that is a thing rather than a being), and for class banners and leader portraits |
| **Name** | Game Icons |
| **Source** | <https://game-icons.net/> — obtained as the npm package [`@iconify-json/game-icons`](https://www.npmjs.com/package/@iconify-json/game-icons), which mirrors <https://github.com/game-icons/icons> |
| **Author** | Game-icons.net contributors (Lorc, Delapouite, John Colburn, Felbrigg, Skoll, and others — see the upstream repository for per-icon authorship) |
| **Licence** | **CC BY 3.0** — <https://creativecommons.org/licenses/by/3.0/>, licence text at <https://github.com/game-icons/icons/blob/master/license.txt> |
| **Attribution required** | Yes. Credited in-app (`credits.art` in `src/i18n.ts`), in `README.md`, and here. |
| **In this repo** | `src/data/generated/cardart.json` — the card-to-icon map, the per-card subject table, plus the SVG path data for only the icons actually referenced |
| **Modifications** | Path data extracted from the SVG bodies at build time (`tools/build-cardart.mjs`) and coordinates rounded to one decimal — a fifth of a pixel at the size these are drawn. At render time each icon is scaled, optionally mirrored, tilted a few degrees, filled as a dark silhouette, then lit, interior-shaded and rim-lit by `src/art/illustration.ts`. The outlines are otherwise unmodified; everything around them is generated. |

Each card is matched to an icon by name — proper nouns first (Athena to a
crested helmet), then a hand-authored noun table (a "Ninja Master" to a ninja),
then the card's tribe, then a curated pool for its class and card type. The
mapping is deterministic, so a card's subject never changes between sessions.

The icon is then classified: names that denote a *person* become a character
spec (archetype, weapon, headgear, wings) and names that denote a *beast*
become a creature spec, both of which are drawn from scratch rather than from
the icon. Only what is left — a spell's sigil, an amulet, a weapon on its own —
still draws the licensed silhouette itself.

## Generated assets (original to this project)

All authored by this project, no third-party content:

| Asset | Where | How |
|---|---|---|
| Card illustration scenes | `src/art/illustration.ts` | Seeded procedural key art: graded sky, ridge lines, background architecture, contact shadow, rim light, foreground occlusion, atmosphere and grain. Deterministic per card via `artSeed`. |
| Character illustrations (464 cards) | `src/art/portrait.ts` | An original cel-shaded anime figure per card: face, eyes, brows, hair (cap, crown gloss, fringe locks, side locks, back mass, tails), body, costume by archetype, collar, pauldrons, headgear, wings and a weapon held in a drawn fist. Rolled deterministically from the card's seed, class and cost. |
| Creature illustrations (226 cards) | `src/art/creature.ts` | Original cel-shaded dragons, wolves, birds, serpents, skeletons, ghosts, golems, slimes, insects, demons and imps. |
| Cel-shading vocabulary | `src/art/celshade.ts` | HSL ramps, the wandering-terminator half-plane, smoothed blobs, tapered slivers, and the lightness-separation rules that stop one form merging into another. |
| Card frames, cost orbs, stat plates, rarity gems | `src/art/cardface.ts` | Canvas 2D |
| Board plaques and keyword icons | `src/art/boardcard.ts` | Canvas 2D |
| Card name typesetting | `src/art/cardname.ts` | Canvas 2D |
| Battlefield mat, sockets, backdrop | `src/render/board.ts` | Canvas 2D → `THREE.CanvasTexture` |
| Leader portraits | `src/render/leader.ts` | Canvas 2D over generated art |
| Card back | `src/render/cardmesh.ts` | Canvas 2D |
| Particles, damage numbers, targeting ribbon | `src/render/effects.ts` | Three.js + Canvas 2D |
| All sound effects and music | `src/audio/audio.ts` | Synthesised live with the Web Audio API. No audio files. |

## Third-party code and fonts

| Package | Version | Licence | Use |
|---|---|---|---|
| [three](https://github.com/mrdoob/three.js) | ^0.169 | MIT | WebGL rendering |
| [vite](https://vitejs.dev) | ^5.4 | MIT | Build and dev server |
| [vitest](https://vitest.dev) | ^2.1 | MIT | Tests |
| [typescript](https://www.typescriptlang.org) | ^5.6 | Apache-2.0 | Types |
| [playwright](https://playwright.dev) | ^1 | Apache-2.0 | Screenshot tooling (dev only) |
| [@fontsource/cinzel](https://fontsource.org/fonts/cinzel) | latest | **SIL OFL 1.1** | Display / numerals |
| [@fontsource/cinzel-decorative](https://fontsource.org/fonts/cinzel-decorative) | latest | **SIL OFL 1.1** | Display accents |
| [@fontsource/noto-serif-jp](https://fontsource.org/fonts/noto-serif-jp) | latest | **SIL OFL 1.1** | Japanese card names |
| [@fontsource/noto-sans-jp](https://fontsource.org/fonts/noto-sans-jp) | latest | **SIL OFL 1.1** | UI and rules text |

SIL Open Font License 1.1 permits bundling and embedding, including in a
project like this one; the fonts are not sold or offered as fonts.

## Attribution

**Shadowverse** is a trademark of Cygames, Inc. This project is an unofficial,
non-commercial, personal study of its design. It is not affiliated with,
endorsed by, or connected to Cygames in any way.

## Rules for future contributors

1. Do not add binary art, audio or font files without recording them here with
   source, author, URL, licence and any attribution requirement.
2. Do not add anything under a licence that forbids modification or private
   use.
3. Official Cygames material stays confined to `src/data/generated/cards.json`
   and `.cache/`. Keep generated, third-party and official assets separable —
   third-party artwork lives only in `src/data/generated/cardart.json`.
4. Do not distribute, publish, host publicly, or package this project for
   release.
