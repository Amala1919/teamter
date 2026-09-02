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

Every illustration in the game is therefore built from a **copyright-free
subject** (Game Icons, below) composited into a **procedurally generated scene**
(next section). The renderer is nonetheless built to prefer official art if it
is ever supplied: drop images into `public/assets/official/` keyed by card id
and pass them through `CardFaceOptions.officialArt`, and the card-name renderer
will draw the name onto the frame's name band exactly as it does over generated
art.

## Third-party artwork — Game Icons

| | |
|---|---|
| **What** | 4133 hand-drawn fantasy icons; 196 of them are used as the *subject* of card illustrations, class banners and leader portraits |
| **Name** | Game Icons |
| **Source** | <https://game-icons.net/> — obtained as the npm package [`@iconify-json/game-icons`](https://www.npmjs.com/package/@iconify-json/game-icons), which mirrors <https://github.com/game-icons/icons> |
| **Author** | Game-icons.net contributors (Lorc, Delapouite, John Colburn, Felbrigg, Skoll, and others — see the upstream repository for per-icon authorship) |
| **Licence** | **CC BY 3.0** — <https://creativecommons.org/licenses/by/3.0/>, licence text at <https://github.com/game-icons/icons/blob/master/license.txt> |
| **Attribution required** | Yes. Credited in-app (`credits.art` in `src/i18n.ts`), in `README.md`, and here. |
| **In this repo** | `src/data/generated/cardart.json` — the card-to-icon map plus the SVG path data for only the icons actually referenced |
| **Modifications** | Path data extracted from the SVG bodies at build time (`tools/build-cardart.mjs`); at render time each icon is scaled, optionally mirrored, tilted a few degrees, filled as a dark silhouette, then lit, interior-shaded and rim-lit by `src/art/illustration.ts`. The original outlines are unmodified; everything around them is generated. |

Each card is matched to an icon by name — proper nouns first (Athena to a
crested helmet), then a hand-authored noun table (a "Ninja Master" to a ninja),
then the card's tribe, then a curated pool for its class and card type. The
mapping is deterministic, so a card's subject never changes between sessions.

## Generated assets (original to this project)

All authored by this project, no third-party content:

| Asset | Where | How |
|---|---|---|
| Card illustration scenes | `src/art/illustration.ts` | Seeded procedural key art: graded sky, ridge lines, background architecture, contact shadow, interior modelling, rim light, foreground occlusion, atmosphere and grain. The *subject* inside the scene is a Game Icons shape (above); everything else is generated. Deterministic per card via `artSeed`. |
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
