# Visual reference

The research behind this is `docs/research/VISUAL_RESEARCH.md` — a
reconstruction of the original Shadowverse client's layout, timing, palette and
audio language. Cygames never published pixel coordinates, ms timings or class
colour values, so much of it is marked as an estimate. This file records what
the implementation actually does.

Because official card artwork is unreachable here (see `ASSET_LICENSES.md`),
side-by-side comparison against real screenshots was not possible in this
environment. The design targets the *language* of the original — ornate gold
chrome on deep navy, a defined stone field, engraved serif names, class-coloured
identity — rather than a pixel copy.

## Palette

`src/art/theme.ts` is the single source. Change a colour there, not at a call
site.

### Classes

| Class | Primary | Deep | Accent |
|---|---|---|---|
| Forestcraft | `#4CA64C` | `#1E5B2E` | `#8FD44A` |
| Swordcraft | `#E8C24A` | `#A87A18` | `#FFEBAE` |
| Runecraft | `#4A7BE8` | `#2A2F8A` | `#9A5CE0` |
| Dragoncraft | `#E88B2A` | `#A03B10` | `#FFC46B` |
| Shadowcraft | `#8B5CC7` | `#2B1240` | `#C79BFF` |
| Bloodcraft | `#C8203C` | `#5A0A18` | `#FF6B7A` |
| Havencraft | `#F0E6C8` | `#C9A227` | `#FFFFFF` |
| Neutral | `#B8BCC4` | `#4A4F58` | `#E8EBEF` |

Class colour appears on: the card frame wash, the class/type plate, the board
mat halves and row bands, summon particles, the leader ground ring, and the
drop-slot highlight.

It deliberately does **not** appear on: evolution (always red/gold), damage
(always red), the play-point tray, or the End Turn button. Keeping the
functional HUD class-agnostic is what stops the screen becoming a colour soup.

### Rarity

| Rarity | Gem | Frame metal | Footer pips |
|---|---|---|---|
| Bronze | `#C88A54` | `#9E8468` | 0 |
| Silver | `#D6DEE8` | `#B9C3D0` | 1 |
| Gold | `#FFD65C` | `#E3B75A` | 2 |
| Legendary | `#8FE3FF` | `#F0D9A0` | 3 + halo |

### Chrome

Gold `#D8B865`, bright gold `#F5E4A8`, deep gold `#7A5F22`, text `#F2EEE4`,
dim text `#A6AFBF`, backgrounds `#080B12` / `#04060A`, attack `#FF8A3D`,
defense `#63D6A8`, cost `#6FB8FF`, damage `#FF4747`, heal `#7BE86A`.

Attack and defense are a red/green pair on the game's two most important
numbers, so the plates differ in **silhouette** as well as colour — a pointed
blade escutcheon for attack, a round shield for defense.

## Typography

| Role | Face | Notes |
|---|---|---|
| Card names, banners, End Turn | Cinzel 700 | engraved Roman caps |
| Numerals (cost, attack, defense) | Cinzel 700 | |
| Rules text, HUD labels | Noto Sans JP | carries both scripts |
| Japanese card names | Noto Serif JP 700 | no tracking; letterspacing kana reads as a mistake |

## The card

512 × 716 at scale 1 (`CARD` in `theme.ts`), 0.715 aspect.

| Element | Position |
|---|---|
| Class/type plate | top rail, centred |
| Cost orb | (62, 62), r 44 |
| Art window | (30, 40) 452 × 430, radius 14 |
| Name band | (44, 372) 424 × 62 |
| Rarity gem | centre, at the art/text seam |
| Rules text box | (42, 452) 428 × 190 |
| Attack plate | (66, H−62), r 42 |
| Defense plate | (W−66, H−62), r 42 |
| Footer ornament | between the plates |

Rules text is auto-fitted: the block shrinks from 19px until it fits the box,
and ability keywords are set in gold to keep a dense card scannable at board
size. A vanilla card shows its flavour line instead, elided with an ellipsis
rather than cut mid-sentence.

### Card names

`src/art/cardname.ts` is deliberately a standalone system, because official
card images ship the decorative name band without the lettering. The same code
draws a name over generated art and over a supplied official image, so an added
name reads as part of the frame rather than as an overlay:

- centred in the band, engraved serif, warm-gold vertical gradient
- auto-fitted from 40px down to 21px before wrapping
- wraps to two lines only when a single line would fall below the minimum,
  breaking at the comma in names like "Albert, Levin Saber" and at the midpoint
  for Japanese
- horizontal condensation as a last resort rather than overflowing the band
- dark outline at 14% of the font size, soft drop shadow, and a hairline of
  warm light along the top edge

### Board plaques

A follower in play is not shown as its full card — the rules text is already
known and the board needs live numbers. `src/art/boardcard.ts` renders a
340 × 476 plaque: art, name band, live attack/defense, and up to four keyword
icons down the left edge. Buffed numbers are green, damaged defense is red.

## Battle screen

Landscape. Leaders occupy the left column, the two five-slot rows sit right of
centre, the hand fans across the bottom.

| Element | World position |
|---|---|
| Enemy row | z −2.6 |
| Ally row | z +0.5 |
| Row centre | x +1.35, slot spacing 1.78 |
| Leaders | x −5.1 |
| Hand fan | z +4.15, y 0.62 |
| Camera | (0.6, 9.6, 11.2) looking at (0.6, 0, 0.5), 36° |

The camera pulls back on narrow aspect ratios so five slots and a full hand
stay in frame on a phone held in landscape.

The field is a **bordered mat**, not an endless floor — that is what stops the
board reading as a corridor. Its two halves carry the players' class washes,
the row bands are painted to line up with the actual slot positions, and a gold
inlay runs down the centre.

Rows stay centred as followers come and go; sockets show one dim slot ahead of
the current count rather than five fixed positions.

## Motion

`TIMING` in `theme.ts`, milliseconds:

| Beat | Duration |
|---|---|
| Draw | 420 |
| Play | 380 |
| Summon | 520 |
| Spell cast | 700 |
| Attack lunge / hit-stop / return | 220 / 60 / 180 |
| Evolution | 1200 |
| Damage number | 700 |
| Destroy | 520 |
| Turn banner | 1100 |
| Card hover / focus / return to hand | 140 / 180 / 280 |

Cards do not play keyframed animations. Each holds a target transform and
springs toward it, so an interruption resolves smoothly instead of snapping.

Effects are additive, short-lived and pooled. The constraint the whole VFX
layer follows is that an effect may never obscure information: particles stay
off card faces, damage numbers float above them, and the targeting ribbon draws
over everything but is a thin arc rather than a beam.

## Audio

Everything is synthesised at runtime (`src/audio/audio.ts`) — no audio files.
The palette is narrow on purpose: a card game plays the same twenty sounds
thousands of times, and anything sharper becomes fatiguing. Crystalline UI
ticks, a woody card thud, filtered noise for impacts, a harmonic stack with a
delayed upper voice for evolution, and an ambient bed of a low drone with
sparse pentatonic bells under everything.

## Open visual work

- Mulligan, deck builder, collection, card detail and pack opening screens.
- Premium (animated) card treatment exists as a baked sheen; it should be a
  live shader with parallax.
- No leader animations or voice lines.
- Bloom / post-processing is not yet wired; glows are all additive geometry.
