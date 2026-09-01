# Shadowverse (Cygames, 2016–2017) — Visual & UX Reference

**Scope:** the ORIGINAL *Shadowverse* digital CCG, from launch (JP 17 Jun 2016 / global 28 Jun 2016) through the **Wonderland Dreams** expansion (5th card set, 29 Jun 2017). Standard/Rotation-era client, Unity, landscape-locked, iOS / Android / Windows / macOS.
**Explicitly NOT:** *Shadowverse: Worlds Beyond* (2025), *Shadowverse: Evolve* (physical TCG), *Shadowverse: Champion's Battle* (Switch).
**Audience:** engineers rebuilding the look & feel in Three.js for mobile portrait/landscape screens.

---

## 0. How to read this document

### 0.1 Confidence marking

The shipped Unity client is not open, and Cygames never published a UI spec. Everything here is reconstructed from the official play guide, the wiki, press coverage, gameplay footage descriptions and direct familiarity with the client. Numbers are therefore **design targets you can build against**, not measurements ripped from the binary.

- Unmarked statements = corroborated by a source in §9, or structurally certain (e.g. "there are 10 PP orbs").
- `> ⚠️ ESTIMATE:` = a reconstructed number, colour, or timing. Treat as a starting value and tune by eye against reference footage.

**Assume every hex code, every pixel coordinate, and every millisecond in this document is an estimate unless it is a stated game rule.** The rules (10 PP, 20 defence, 5 board slots, 40-card deck, 9-card hand, 90 s turn, EP counts) are hard facts.

### 0.2 Reference resolution

All layout numbers are given in a **1920 × 1080 virtual canvas** (16:9). The shipped game targeted 16:9 and letterboxed/pillarboxed wider or narrower devices.

> ⚠️ ESTIMATE: the client appears to render UI against a fixed-height reference (1080 virtual px) and scale uniformly, anchoring left-edge and right-edge clusters to the physical screen edges rather than to the 16:9 box. On a 19.5:9 iPhone the extra horizontal room went to the board/field, not to the HUD. Reproduce this: **uniform vertical fit, edge-anchored horizontal HUD.**

### 0.3 Coordinate convention

`(x, y)` = centre of the element, origin top-left, +y down. `w × h` in reference px. Percentages given alongside so you can drive a layout engine off normalized coordinates.

---

## 1. Battle Screen Layout

### 1.1 The one-sentence description

A dark, gilded stone arena viewed in **three-quarter perspective**: two leaders stacked vertically on the **left third** of the screen facing each other, a receding 3D **field plane** occupying the centre carrying two rows of five follower slots, a fan of cards along the **bottom centre**, and a vertical stack of gold-plated controls (End Turn, PP, deck) pinned to the **right edge**.

The signature reading of the screen is: **left = who, centre = what, right = when.**

### 1.2 ASCII layout map (1920 × 1080)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ [menu]                                                          [opp deck 27]│ y≈40
│  ┌────────┐                                                      [opp shadows]│
│  │ OPP    │        ╔══════ OPPONENT ROW — 5 slots ══════╗                     │ y≈250
│  │ LEADER │        ║  [ ] [ ] [ ] [ ] [ ]                ║                     │
│  │  ◯ 20  │        ╚══════════════════════════════════════╝    ┌─────────────┐│
│  └────────┘                                                     │  END TURN   ││ y≈560
│   EP ●●    ─────────── CENTRE LINE / TURN BANNER ────────────    └─────────────┘│
│                                                                                │
│  ┌────────┐        ╔═══════ YOUR ROW — 5 slots ══════════╗    ● ● ● ● ●        │ y≈720
│  │ YOUR   │        ║  [ ] [ ] [ ] [ ] [ ]                ║    ● ● ● ● ●   PP 6/8│ y≈820
│  │ LEADER │        ╚══════════════════════════════════════╝                     │
│  │  ◯ 20  │                                                    [your deck 24]  │
│  └────────┘   ╭──╮╭──╮╭──╮╭──╮╭──╮╭──╮                         [your shadows]  │
│   EP ●●      ╱ HAND FAN — up to 9 cards, arced ╲                               │ y≈1010
└──────────────────────────────────────────────────────────────────────────────┘
```

### 1.3 Element table

| # | Element | Centre (x, y) | Size (w × h) | Normalized centre | Notes |
|---|---------|---------------|--------------|-------------------|-------|
| 1 | Opponent leader portrait | 168, 236 | 200 × 200 (circle) | 8.8%, 21.9% | Circular art in an ornate gold ring |
| 2 | Opponent defence badge | 262, 310 | 92 × 92 | 13.6%, 28.7% | Red crest, number 20 → 0 |
| 3 | Opponent EP orbs | 64, 330 | 2 × (36 ⌀), 46 pitch | 3.3%, 30.6% | Vertical pair, left of portrait |
| 4 | Opponent class emblem | 168, 236 | 300 × 300 | — | Behind portrait, additive, 25 % opacity |
| 5 | Own leader portrait | 168, 844 | 200 × 200 | 8.8%, 78.1% | Mirror of #1 |
| 6 | Own defence badge | 262, 918 | 92 × 92 | 13.6%, 85.0% | |
| 7 | Own EP orbs | 64, 780 | as #3 | 3.3%, 72.2% | Lit gold when spendable |
| 8 | Opponent board row | 950, 300 | 5 slots, 168 × 236 each, 22 gap | 49.5%, 27.8% | Centred; row grows outward from centre |
| 9 | Own board row | 950, 690 | 5 slots, 190 × 266 each, 24 gap | 49.5%, 63.9% | Slightly larger (nearer the camera) |
| 10 | Field plane | 950, 500 | ~1300 × 700 projected | — | 3D quad, see §1.5 |
| 11 | Hand fan | 950, 1010 | arc, see §3 | 49.5%, 93.5% | Bottom-centre |
| 12 | End Turn button | 1748, 560 | 300 × 132 | 91.0%, 51.9% | Large gold plaque |
| 13 | Turn timer ring | 1748, 560 | 330 × 162 | — | Drains around #12 |
| 14 | PP orb tray | 1730, 800 | 340 × 130 | 90.1%, 74.1% | 10 orbs, 2 rows of 5 |
| 15 | PP numeric readout | 1878, 800 | 110 × 60 | 97.8%, 74.1% | "6/8" |
| 16 | Own deck count | 1848, 950 | 96 × 96 | 96.3%, 88.0% | Deck-back icon + number |
| 17 | Own shadow count | 1848, 1040 | 84 × 60 | 96.3%, 96.3% | Purple wisp icon + number |
| 18 | Opponent deck count | 1848, 100 | 96 × 96 | 96.3%, 9.3% | |
| 19 | Opponent shadow count | 1848, 186 | 84 × 60 | 96.3%, 17.2% | |
| 20 | Battle menu button | 62, 52 | 84 × 84 | 3.2%, 4.8% | Gear / hamburger, top-left |
| 21 | Battle log button | 158, 52 | 84 × 84 | 8.2%, 4.8% | Scroll icon |
| 22 | Emote button | 62, 1020 | 84 × 84 | 3.2%, 94.4% | Speech bubble, bottom-left |
| 23 | Turn banner | 960, 470 | 1920 × 220 | 50%, 43.5% | Transient sweep, see §4.11 |

> ⚠️ ESTIMATE: every coordinate in the table above. Structure (leaders left-stacked, End Turn right, PP bottom-right, hand bottom-centre, menu top-left) is solid; exact pixels are reconstructed.

### 1.4 Leaders

Both leaders occupy the **left column**, deliberately out of the way of the field. This is the single most identifying feature of original-Shadowverse framing and the biggest visual difference from Hearthstone (leaders centred) and from *Worlds Beyond* (leaders centred top/bottom).

**Anatomy of a leader unit:**

- **Portrait disc.** Circular mask, 200 ⌀. The character art is an anime bust crop, mostly head-and-shoulders, framed so the eyes sit at ~38 % down the disc. Art is a still 2D image with a very subtle idle parallax.
  > ⚠️ ESTIMATE: idle parallax ≈ ±4 px translation on a 6–8 s sine loop, plus a 1–2 % breathing scale. Enough to stop it reading as a sticker.
- **Ornate ring.** A gold/bronze cast metal ring, 22–26 px thick, with 4 cardinal bosses and filigree between them. Class-tinted inner bevel.
- **Class emblem plate.** A large, low-opacity heraldic emblem sits *behind* the disc, bleeding off the left screen edge. Additive blend, class colour, 20–30 % opacity, slow 20 s rotation drift.
- **Defence (HP) badge.** A shield/crest hanging at the lower-right of the ring, overlapping it by ~30 %. Base colour deep crimson `#8E1220`, gold rim, number in a heavy outlined numeral.
  Defence starts at **20** for both players. Numbers roll (odometer) rather than snap — see §4.9.
  > ⚠️ ESTIMATE: badge tints toward brighter red and gains a slow pulse below 10 defence; below 5 the pulse doubles in rate.
- **Evolution Point orbs.** Small gold-rimmed circular gems on the outer (screen-left) edge of the ring. **Player going first gets 2 EP; player going second gets 3 EP.** Unlit = dark bronze `#4A3A1C` with a dull inner shadow; lit = bright gold `#F2CF63` with a bloom and a slow rotating caustic.
- **Targeting affordance.** When a card in hand can target a leader, the whole leader unit gains a class-agnostic reticle: an expanding ring, 2 px, `#FFD86B`, 1200 ms loop, plus a soft outer glow.

**Leader damage feedback** is described in §4.9.

### 1.5 The field — the 3D perspective plane

This is the part that most needs to be *actually* 3D in Three.js. The board is not a flat sprite layer; it is a textured plane in perspective, with cards standing as billboards slightly above it.

**Recommended camera setup:**

- Perspective camera, **vertical FOV ≈ 32°**.
- Camera at roughly `(0, 5.6, 7.4)` in world units, looking at `(0, 0, -0.6)` — i.e. **pitched down ~37° from horizontal**.
- Field plane is a 16 × 10 unit quad on the XZ plane at y = 0.
- Result: the opponent row (far) renders at ~88 % the on-screen scale of the near row, and the far row sits visually "up and back". This matches the reference feel: the two rows are clearly not the same size.

> ⚠️ ESTIMATE: FOV, camera pitch and the exact 88 % near/far ratio. Tune until the far row's card height is ~0.86–0.90 × the near row's.

**Field surface:**

- A dark carved stone / obsidian slab with gold inlay. Base albedo around `#171A24` to `#20242F`, inlay `#8E7434`.
- A **centre divider**: a bright inlaid line running left-to-right across the middle of the plane, ~6 px thick on screen, with an ornament at the midpoint. This is the "no man's land" between the rows and is where the turn banner sweeps.
- Each of the 10 slots has a **socket decal**: a shallow inscribed rectangle/oval with a faint rune. Empty slots are dark; a legal drop target lights the socket in the class colour.
- **Vignette:** heavy. The corners of the field fall to near-black. A radial vignette multiplied over the whole frame at ~35 % strength keeps attention centre-screen and lets the gold HUD pop.
- **Cosmetic swap:** the field/mat, card sleeves, leader portrait and "flair" are all purchasable cosmetics, so the field material must be a swappable asset (texture set + emissive colour + optional particle layer).

**Atmospheric layer:** slow drifting motes/dust particles in the volume above the field, additive, `#C8B884` at 8–14 % opacity, 30–60 particles, 20–40 s lifetimes. Plus a very subtle god-ray/light-shaft pair from the upper corners.

> ⚠️ ESTIMATE: mote count and opacity.

### 1.6 Board rows

- **5 slots per side.** Hard rule: a player may have at most 5 followers/amulets in play.
- Slots are **centre-packed**: with 3 followers in play they occupy the middle 3 positions and are centred, not left-aligned. Adding a 4th re-flows all of them outward.
- Re-flow animation: 220 ms, `easeOutCubic`, positions interpolated, no scale change.
- Cards on the board are rendered as **billboards with a slight backward tilt** (~10–14° about X) so they catch the light and read as standing on the plane rather than lying on it.
  > ⚠️ ESTIMATE: the tilt angle. Zero tilt looks flat and wrong; more than ~20° makes text unreadable.
- Board cards are visually simplified vs. hand cards: art + name band + attack/defence plates + status icons. Full ability text is not shown at board scale; it appears in the inspect overlay (long-press / hover).

**Per-follower status affordances on the board:**

| State | Visual |
|---|---|
| Can attack (ready) | Soft cyan-white rim light `#9FE8FF` at 60 %, plus a faint upward ground glow |
| Cannot attack (summoning sickness / already attacked) | Desaturated to ~55 %, dimmed 20 %, no rim |
| Ward (taunt) | A translucent shield wall billboard in front of the card, `#7FD4FF` at 30 %, slow vertical scroll on the texture |
| Evolved | Gold/red frame, evolve sigil under the card, persistent ember particles — see §4.8 |
| Buffed this turn | Green `#6BE04A` flash on the stat plate + `+X/+Y` floater |
| Damaged | Defence number turns `#FF5A4A`; a crack/scar overlay on the frame at >50 % damage |
| Targetable by current action | Class-coloured pulsing outline, 900 ms loop |
| Aura / can't be targeted | A faint hexagonal shimmer barrier |

### 1.7 PP (Play Points) display

- **10 orbs maximum.** Each player starts on 0, gains **+1 max PP at the start of their turn**, and all spent PP refill at turn start.
- Layout: **two rows of five** in the bottom-right, forming a compact 5 × 2 block, with a numeric `current/max` readout to their right.
  > ⚠️ ESTIMATE: 2 × 5 vs. a single row of 10. A 2 × 5 block reads better on phones and matches the compact bottom-right cluster; if you have the width, a single arc of 10 following the End Turn button's curve is the more "Shadowverse" shape.
- **Orb states:**
  - *Unearned* (beyond max PP): empty socket, dark `#221B12`, thin bronze rim `#5A4520`, no fill.
  - *Available*: a faceted blue-white crystal, core `#7FD8FF`, rim highlight `#E8FBFF`, outer glow `#2F7BD8`. Slow internal caustic animation (~3 s loop).
  - *Spent this turn*: the crystal drains from top to bottom over 180 ms into a grey husk `#3E4654`, and the socket keeps a faint blue residue.
- **Spend animation:** when you play a 4-cost card, four orbs drain **right-to-left in sequence**, 60 ms apart, each drain 180 ms `easeInQuad`, with a small `#9FD4FF` spark at the moment of drain.
- **Refill at turn start:** all orbs refill **left-to-right**, 70 ms apart, each fill 220 ms `easeOutBack(1.3)` with a scale punch 1.0 → 1.18 → 1.0. The newly-earned max-PP orb fills *last* and gets a bigger flare + a distinct chime.
- **Affordability preview:** while dragging a card, the orbs that *would* be spent dim to 50 % and gain a dashed outline; if the card is unaffordable the whole tray does a 3-cycle red shake (`#FF4B3A`, ±6 px, 240 ms).

### 1.8 EP (Evolution Points) display

- Rendered as small gold orbs adjacent to each leader disc (see §1.4).
- **First player: 2 EP, usable from their 5th turn. Second player: 3 EP, usable from their 4th turn.**
- Before the evolve turn, the orbs are present but dark and slightly transparent (~40 %), signalling "coming later".
- On the turn evolution unlocks, the orbs **ignite**: 500 ms, each orb flashes white then settles to gold, with an expanding ring and a low choir swell. This is a deliberate "the game has entered phase 2" moment.
- Hovering/holding a board follower while EP is available shows a ghosted "EVOLVE" ribbon above it, and one EP orb pre-dims to preview the cost.

### 1.9 End Turn button

- The largest single interactive control on screen — roughly **300 × 132** at reference scale, right edge, vertically near centre. It has to be reachable by the right thumb in landscape.
- Shape: a horizontally-elongated gold plaque with cut corners and a raised bevel, filigree at both ends, text centred.
- **States:**

| State | Fill | Rim | Text | Behaviour |
|---|---|---|---|---|
| Your turn, actions remain | `#C9A24A` → `#8A6B24` vertical gradient | `#F2DFA0` 3 px | "End Turn", `#2A2118` | Idle: slow specular sweep across the plaque every 4 s |
| Your turn, **nothing else you can do** | brighter `#F0C64E` | `#FFF3C8` | same | Adds a 1200 ms breathing glow to nudge you |
| Opponent's turn | desaturated `#4A4740` | `#6E6A60` | "Opponent's Turn" or "Waiting…" | Non-interactive; a subtle horizontal shimmer indicates the opponent is thinking |
| Pressed | inset, −4 % scale | — | — | 90 ms down, 120 ms release |

- **Confirm-on-danger:** if you end turn with unspent PP that could still play a card, a small "PP remaining" tag appears above the button. It does not block the press.
  > ⚠️ ESTIMATE: this nudge; the base game's behaviour here was minimal.

### 1.10 Turn timer

- **90 seconds per turn.** When it expires, the turn is force-ended.
- Presentation: a **ring/arc gauge wrapped around the End Turn plaque**, draining clockwise from full. Colour ramp: `#7FD8FF` (fresh) → `#F0C64E` (< 30 s) → `#FF4B3A` (< 10 s).
- Under 10 s a numeric countdown appears inside the button and each second ticks with a click; the plaque pulses in sync.
- Under 5 s: the screen edges gain a faint red vignette pulse at 1 Hz.
- The opponent's timer is not shown numerically; their thinking is implied by the shimmer on the greyed button.

> ⚠️ ESTIMATE: colour ramp thresholds and the ring-gauge form (a straight bar under the button is the alternative).

### 1.11 Deck, graveyard and shadows

- **Deck count.** Both players show a remaining-deck number next to a stack-of-cards icon. The deck is 40 cards; running out means **fatigue-style loss** in Shadowverse terms (drawing from an empty deck deals escalating damage to the leader). The icon should visibly thin as the count drops.
  > ⚠️ ESTIMATE: the "thinning stack" treatment — a 3-state icon (thick / medium / thin) is enough.
- **Shadow count.** Shadowverse's graveyard is abstracted as **Shadows**: any follower or amulet destroyed, any spell played, and any card discarded becomes a shadow. Shadows cannot be inspected as individual cards. **All classes have a shadow count**, but only Shadowcraft spends them (Necromancy).
- Icon: a small purple wisp / soul flame, `#9B6BD8` core with `#3A1E5A` outer, a lazy flicker (~1.4 s). Number beside it.
- When shadows increase, the number pops (scale 1.0 → 1.25 → 1.0, 260 ms) and a wisp particle flies from the destroyed card's board position into the counter over ~500 ms along a curved path. This "souls flowing to the counter" motion is a strong, cheap piece of game feel.
- For a Shadowcraft player, the counter also shows a **threshold ring** when a card in hand has a Necromancy cost — filled proportion = shadows/threshold, turning gold when satisfied.

### 1.12 Emote / sticker system

- Original Shadowverse used **leader voice emotes**, not sticker images: a small set of canned lines ("Nice move.", "Thanks!", "Hmm…", "Good game.") spoken by your leader's voice actor with a text bubble.
- Interaction: tap the emote button (or your own leader portrait) → a radial/vertical list of 4–6 emote options fans out; tap one to fire. The list auto-closes after ~3 s of inactivity.
- Presentation: a speech bubble with a gold-rimmed parchment fill anchored to the *sender's* leader disc, pointing at it. 200 ms scale-in with `easeOutBack`, hold ~1800 ms, 180 ms fade-out.
- There is a **mute-opponent-emotes** toggle in the battle menu; muted emotes are fully suppressed (no bubble, no audio). Build this in from the start.

> ⚠️ ESTIMATE: bubble timings, fan-out geometry, the exact emote count.

### 1.13 Battle log

- A scrollable panel listing every discrete game action in order: draws (yours only), plays, attacks, damage, effect triggers, deaths.
- Opens as a right-side or centre drawer, ~620 px wide, dark translucent panel `#0C1220` at 88 %, gold hairline border, entries as one or two lines each with a small type icon and the card name in class colour.
- Slide-in 260 ms `easeOutCubic`; the board dims to 45 % behind it.
- Newest entry at the bottom, auto-scrolled.

### 1.14 Battle menu / surrender

- Opened from the **top-left** button. Contains: Settings (BGM/SE volume, animation speed, emote mute), Concede/Retire, Return to title, and Help.
- The menu is a centred modal card, ~700 × 800, dark panel, gold header band.
- **Concede requires a confirmation dialog** ("Retire from this match?" / Yes / No). Conceding still plays the defeat sequence and takes a few seconds to resolve — players notice this. Budget ~1.5–2.5 s from confirm to defeat screen.

---

## 2. The Card

### 2.1 Proportions

- **Aspect ratio ≈ 0.70 (w/h)** — taller and narrower than a poker card. Reference authoring size **420 × 600** logical px; the frame is designed at 2× for crispness.
- On-screen sizes at 1920 × 1080:

| Context | Size | Notes |
|---|---|---|
| Hand, resting | 168 × 240 | Only the top ~65 % is visible above the screen edge |
| Hand, hovered/focused | 320 × 457 | Lifted and enlarged; full text legible |
| Board, near row | 190 × 266 | Simplified layout |
| Board, far row | 168 × 236 | ~88 % of near |
| Inspect overlay | 560 × 800 | Full detail + flavour text |
| Deck builder grid | 200 × 286 | |
| Card detail screen | 640 × 914 | |

> ⚠️ ESTIMATE: all sizes.

### 2.2 Card type is encoded in the silhouette of the frame top

This is a verified, load-bearing detail: **the top edge of the card frame tells you the card type at a glance.**

- **Follower** → **rounded / arched top.**
- **Spell** → **flat top.**
- **Amulet** → **pointed / triangular top.**

Build the frame as three variants sharing a common body. On a phone this silhouette is far more readable than an icon, so do not flatten it.

### 2.3 Frame anatomy (follower)

Layered back-to-front:

1. **Drop shadow** — soft, offset +6 y, 18 px blur, black at 55 %.
2. **Outer bevel** — dark cast metal `#2A2118`, 6–8 px, catches a rim light from upper-left.
3. **Metallic band** — the main ornate frame. Brushed gold/bronze with engraved scrollwork. Base `#9C7C34`, highlights `#E8D08A`, shadows `#4A3714`. The frame is *not* uniform: corners carry heavier ornament, and the ornament density scales with rarity (§2.7).
4. **Class gem / class tint.** A faceted gem set into the frame (typically at the top centre or top corners) plus a **class-coloured tint wash over the whole metal band**, roughly 25–35 % overlay. This is how you tell Bloodcraft from Havencraft at a glance across the board. See §6.4 for class hexes.
5. **Art window.** The illustration, bled to the inner frame edge. In Shadowverse the art is a full-bleed anime illustration and is the visual star — the frame is deliberately thin so as much art as possible shows.
6. **Name plate band.** A horizontal ornamented band crossing the **upper-middle** of the art (roughly 26–32 % down the card), not the top edge. This is unusual and distinctive: the band sits *over* the illustration.
   - Band: a dark translucent plaque `#1A1208` at 78 %, with gold rules top and bottom and small end-caps.
   - Card name centred, light ivory `#F5EFE0`, with a 2 px dark outline so it survives against bright art.
   - Long names auto-shrink; below ~78 % of the base size they instead condense horizontally.
7. **Cost orb** — top-left, overlapping the frame edge.
8. **Attack plate** — bottom-left. **Defence plate** — bottom-right.
9. **Ability text box** — bottom band.
10. **Rarity gem** — see §2.7.
11. **Foil/premium layer** — see §2.10.

### 2.4 The cost orb

- Position: **top-left**, centre at roughly (14 %, 11 %) of the card, diameter ≈ 26 % of card width, so it overhangs the frame's outer edge on the left and top.
- Form: a **blue faceted crystal** set in a gold claw mount. Core `#2F7BD8`, inner light `#9FD4FF`, specular `#EAF8FF`, rim shadow `#123A78`, mount `#C9A24A`.
- A slow internal refraction/caustic animation (3–4 s loop) and a fixed specular hotspot at the upper-left facet.
- Number: heavy serif numeral, ivory `#F7F2E4`, 2.5 px dark-blue outline `#0E2A55`, slight inner bevel. Centred, optically (not geometrically) — a "1" needs nudging.
- **Cost reduction** (e.g. via effects) recolours the orb to green `#3FBF6A` and the number pulses; **cost increase** recolours to a dull violet `#7A5FA8`.
- **Unaffordable in hand:** the orb desaturates and the whole card is dimmed ~35 % with a subtle grey overlay. This is the primary "you can't play this" signal, reinforced by the card refusing to lift as high on hover.

### 2.5 Attack and defence plates (followers only)

- **Attack** — bottom-**left**, an orange/red plate. Base `#B33A18`, inner glow `#E0552A`, rim highlight `#FFC08A`, gold mount. Shape: a shield/blade-like escutcheon.
- **Defence** — bottom-**right**, a green/teal plate. Base `#1E7A63`, inner glow `#2FA88C`, rim highlight `#A8F0DC`, gold mount. Shape: a rounded shield.
- Numerals: same heavy serif, ivory with a dark outline, slightly larger than the cost numeral.
- **Dynamic states:**
  - Buffed above base → numeral turns `#7BE86A`, plate gains a green inner bloom.
  - Damaged / debuffed below base → numeral turns `#FF5A4A`, plate gains a red inner bloom.
  - At base → ivory.
- On the board these plates are the only numbers rendered, so keep them ≥ 34 px tall on a 1080-height screen.

### 2.6 Type differences

| | Follower | Spell | Amulet |
|---|---|---|---|
| Frame top | Rounded/arched | Flat | Pointed/triangular |
| Cost orb | Yes, top-left | Yes | Yes |
| Attack plate | Yes | **No** | **No** |
| Defence plate | Yes | **No** | **No** |
| Countdown | — | — | **Yes, if a countdown amulet** |
| Occupies board slot | Yes | No (resolves and goes to shadows) | Yes |
| Can attack | Yes | — | No |

**Countdown amulets** show a **countdown number** where a follower's stats would be — a single central plate at the bottom of the card, rendered as a **gold/amber gear or hourglass motif** rather than the red/green stat pair. The countdown decrements by 1 at the start of your turn, and the amulet is destroyed at 0 (usually triggering Last Words).

- Countdown decrement animation: the numeral spins down one step (120 ms), the gear icon rotates 60°, and a soft tick plays. At 1 the plate pulses amber. At 0 the amulet plays the destruction sequence (§4.10) with a distinct "shatter into gold dust" variant rather than the follower's death dissolve.
- **Non-countdown amulets** (permanent) show no number at all — the bottom of the card is just ornament, which is itself the signal that it will stay forever.

Spells fill the freed bottom area with a **larger ability text box** — spells are text-heavy, so give them roughly 1.4× the text-box height of a follower.

### 2.7 Rarity

Four tiers: **Bronze, Silver, Gold, Legendary.** Corroborated crafting costs (useful for the deck builder / collection UI): Bronze 50 vials, Silver 200, Gold 800, Legendary 3500. Every pack contains at least one Silver, Gold or Legendary.

Rarity is communicated by **two** channels simultaneously:

**(a) The rarity gem** — a small faceted stone set into the frame (bottom-centre of the frame band is the cleanest placement; the shipped game sets it into the lower ornament).

| Rarity | Gem core | Gem rim | Glow |
|---|---|---|---|
| Bronze | `#B0743C` | `#E0A96A` | none |
| Silver | `#C8CDD6` | `#F2F5FA` | very faint white |
| Gold | `#F0C64E` | `#FFF0B8` | warm `#FFD86B`, soft |
| Legendary | `#C24BE0` shifting | `#F3C8FF` | animated **prismatic** sweep across magenta→cyan→gold, 2.5 s loop |

**(b) Frame ornamentation** — the metal band itself gains complexity:

- Bronze: plain band, minimal engraving, matte finish, no corner ornament.
- Silver: light engraving along the band, small corner flourishes, semi-gloss.
- Gold: full scrollwork, four sculpted corner bosses, pronounced specular sweep on hover.
- Legendary: full scrollwork **plus** raised sculptural elements that break the card's rectangular silhouette (wings/spikes/crown at the top corners), a persistent faint particle emission along the frame, and an animated specular that never fully rests.

> ⚠️ ESTIMATE: the specific ornamentation ladder. The *principle* — rarity = silhouette complexity + gem colour + amount of motion — is right, and it is what makes a Legendary read as special from across a board.

**Legendary is the only tier that gets motion at rest.** Preserve that; if Golds also shimmer, Legendaries stop feeling rare.

### 2.8 Ability text box

- A dark inset panel across the bottom of the card, above the stat plates, roughly 22 % of card height for followers, ~32 % for spells.
- Fill `#120E08` at 72 %, inset shadow at the top edge, a thin gold rule above it.
- Text ivory `#EDE6D4`, keywords in **bold + class-tinted or gold** (`#F0C64E`) — e.g. **Fanfare**, **Last Words**, **Ward**, **Storm**, **Rush**, **Bane**, **Drain**, **Necromancy (X)**, **Enhance (X)**, **Accelerate (X)**.
- Keyword terms are tappable in the inspect overlay and open a small glossary tooltip.
- Text auto-scales down to a floor (~80 %); below that the box scrolls in the inspect overlay rather than shrinking further.
- **At hand-resting and board sizes this text is not rendered at all** — it is replaced by 1–3 small keyword icons in a row (a shield for Ward, a lightning bolt for Storm, a skull for Last Words…). This is essential for mobile legibility.

### 2.9 Evolved card frame

Evolution is Shadowverse's signature mechanic and it is given a **distinct card identity**, not just a stat bump:

- **The illustration changes.** Evolved followers use a different, usually more dramatic and vibrant artwork. This is the single most important thing to support in your asset pipeline: every follower needs two art assets.
- **Frame recolour:** the class tint is overridden toward **red/gold**. Metal band shifts from `#9C7C34` toward `#C8912E` with red heat in the shadows `#6E1E10`; highlights push to `#FFE9B0`.
- **Added ornament:** a crown/wing motif appears at the top of the frame, and a small **evolve sigil** (a stylised diamond/eye) is stamped at the frame's bottom centre.
- **Persistent effect:** a slow upward ember drift from the card's lower edge (6–10 particles, `#FF9A3C` → `#FFD98A`, 1.2–2.0 s lifetimes, additive) plus a warm rim light on the card's silhouette.
- **Ground rune:** on the board, an evolved follower sits on a glowing circular rune decal, class-coloured with red/gold overtones, ~1.15 × the card width, rotating at ~6°/s, pulsing opacity 0.35 ↔ 0.55 on a 2.2 s loop.
- Evolved stats are usually higher; the changed numerals should animate up during the evolve sequence (§4.8), not just swap.

### 2.10 Premium / animated cards

- **Every card has an ~8 % chance to be animated** when pulled from a pack. Animated cards are cosmetic-only.
- Three stacked visual treatments — implement them as separable shader layers so you can dial each:

1. **Animated illustration.** The art itself is a looping motion piece — parallaxed layers, drifting hair/cloth, flickering flame, falling petals. Typically a short seamless loop (3–6 s). In practice this is authored as a small sprite-sheet/video or as 3–5 parallax layers with per-layer motion.
   > ⚠️ ESTIMATE: the loop lengths and layer counts.
2. **Foil shimmer.** A moving anisotropic highlight across the metal frame and the art: a soft diagonal band, screen/add blend, that sweeps corner-to-corner every ~2.5–3.5 s with a slight rainbow chromatic split at its edges. On hover/tilt, the sweep position is driven by pointer/gyro instead of by time.
3. **Particle overlay.** Sparse sparkle motes on top of the card, additive, `#FFF6D8`, 12–20 particles, each a 200–500 ms twinkle (scale 0 → 1 → 0), spawned preferentially along the frame ornament and on bright areas of the art.

4. **3D parallax / tilt.** In hand-focus, inspect and card-detail views, the card responds to pointer position (desktop) or **device gyroscope** (mobile) with a ±8–12° rotation about X and Y, `easeOutQuad` with ~140 ms follow lag, plus an inner parallax where the art shifts ~6 px against the frame and the specular hotspot slides. This is a small effect that buys an enormous amount of perceived production value — apply it to **all** cards in inspect views, and to premium cards in hand too.

> ⚠️ ESTIMATE: tilt angles, follow lag, sweep periods.

---

## 3. Hand Interaction

### 3.1 The fan

- **Maximum hand size is 9.** Cards drawn beyond 9 are burned (destroyed) — show this explicitly (§4.2).
- The hand is an **arc** centred at the bottom of the screen, cards rotated to follow the arc's tangent.

**Arc math (build against these):**

- Let `n` = card count, `i` = index `0..n-1`, `t = n > 1 ? (i/(n-1)) - 0.5 : 0` → `t ∈ [-0.5, +0.5]`.
- **Angular spread** `A = clamp(n * 4.5°, 0°, 34°)` total. Card rotation = `t * A`.
- **Horizontal pitch** `P = clamp(1180 / max(n,1), 96, 168)` px. Card x = `centerX + t * P * (n-1)`.
  - With n ≤ 7 this gives no overlap-crowding; with n = 9 the pitch clamps at ~131 px against a 168 px card → **~22 % overlap**.
- **Arc rise** — cards at the ends sit lower: `y = baseY + (t*t) * 4 * R` where `R ≈ 46` px. So the centre card is ~46 px higher than the outermost.
- **Depth order:** centre-out is wrong; use **left-to-right z-order** so each card overlaps the one to its right consistently (or the reverse — pick one and never break it). The hovered card is forced to the top.
- `baseY ≈ 1010`, i.e. roughly **55 % of the card height is below the screen edge** at rest. You see art + name band + cost orb, not the text box.

> ⚠️ ESTIMATE: every constant above. They are chosen to produce the reference silhouette (a shallow, wide, gently-arced fan that never becomes a tight Hearthstone-style fan even at 9 cards).

- **Re-layout on add/remove:** 260 ms, `easeOutCubic`, all cards interpolate position + rotation simultaneously. Never snap.

### 3.2 Hover / focus

Two distinct states — do not collapse them into one:

**(a) Hover-lift (desktop pointer over, or finger down on mobile):**
- Translate up by **62 px**, scale to **1.12**, rotation eased to **0°** (the card straightens as it lifts), z forced to top.
- 140 ms in, `easeOutCubic`; 180 ms out, `easeOutQuad`.
- Neighbours slide away by 18 px (falling off with distance: `18 / (1 + dist)`) over 160 ms, so the lifted card gets breathing room.
- A soft drop shadow grows underneath (blur 18 → 34 px, alpha 0.35 → 0.55).
- A short crystalline "tick" SFX at ~35 % volume.

**(b) Focus / inspect (hover held > 400 ms, or long-press ≥ 450 ms on mobile, or right-click):**
- The card **detaches** from the fan and animates to a fixed inspect anchor — for hand cards, roughly (400, 560) on the left-centre so it does not sit under the thumb, at **320 × 457** (or full 560 × 800 for the deliberate inspect overlay).
- 220 ms, `easeOutBack(1.1)`.
- Full ability text fades in over 120 ms (it was not rendered at rest).
- The rest of the screen dims by 25 % (board stays visible — you need to read it while inspecting).
- 3D tilt-parallax becomes active (§2.10.4).
- Releasing returns the card to its fan slot in 200 ms `easeOutCubic`.

> ⚠️ ESTIMATE: the 400/450 ms thresholds and the anchor position.

### 3.3 Drag to play

- **Drag threshold:** 12 px of movement (or 10 px + 80 ms) before a press converts from "inspect" to "drag". This disambiguation matters enormously on touch.
- Once dragging: the card follows the finger with **a small lag** — position lerps toward the pointer at ~0.35/frame at 60 fps (≈ 90 ms settle) — plus **velocity-driven tilt**: rotate about Z by `clamp(-velX * 0.05, -14°, 14°)` and about X by `clamp(velY * 0.03, -10°, 10°)`. The card feels like it has mass.
- Scale during drag: **0.92** of hover scale (it shrinks slightly, which reads as "moving away from you toward the board").
- The card becomes ~90 % opaque and casts a projected shadow onto the field plane, giving a real height cue.
- The hand re-flows to close the gap over 200 ms.

### 3.4 Drop zones

- **Follower / amulet:** the drop zone is **your board row** (the whole row, not individual slots). When the drag enters it:
  - The row's socket decals light in the class colour, opacity 0 → 0.7 over 140 ms.
  - An **insertion gap** opens at the nearest slot boundary — existing followers slide apart by half a card width over 180 ms `easeOutCubic` — so you can choose the position. Board position matters in Shadowverse, so this must be precise and readable.
  - A ghost/outline of the card is drawn in the gap at 40 % opacity.
  - If the board is already full (5), the row flashes red and the drop is refused.
- **Non-targeted spell:** the drop zone is a large **central "cast" region** covering the middle of the field. Entering it draws an expanding class-coloured ring and the card scales up slightly.
- **Targeted spell / targeted Fanfare:** see §3.5.
- **Release outside any valid zone** = cancel (§3.6).

**Zone highlighting is exclusive:** exactly one zone is ever highlighted, chosen by nearest-centre. Never light two.

### 3.5 Targeting arrow / reticle

Triggered when a played card requires a target (targeted spell, targeted Fanfare, or when ordering a follower to attack).

- **Anchor:** the source (the card's resting position at the top of the field for a spell being cast; the follower's board position for an attack).
- **The arrow:** a **quadratic Bézier curve** from anchor to pointer, with the control point offset **upward** by ~35 % of the chord length. Rendered as a chain of ~14–20 tapered segments (a ribbon geometry in Three.js), widest at the head.
  - Colour: gold `#F2C75A` core with a white-hot centre line `#FFF6D8` and an outer bloom.
  - Segments scroll along the curve at ~1.6 curve-lengths/second, giving a flowing "energy stream" read.
  - When over an **illegal** target the whole ribbon turns red `#E03A2A` and the head becomes a "no" glyph.
- **The reticle at the head:** two counter-rotating rings (outer 96 ⌀ clockwise at 40°/s, inner 62 ⌀ counter-clockwise at 70°/s) plus 4 tick marks. When it snaps onto a legal target it **locks**: rings snap to aligned, scale-punch 1.0 → 1.15 → 1.0 over 180 ms, a sharp click SFX, and the target gains a bright outline.
- **Snapping:** the reticle magnetises to the nearest legal target within ~90 px. Legal targets pulse throughout the targeting state; illegal ones are dimmed to 45 %.
- **Attack targeting specifically:** when a **Ward** follower exists on the opposing board, only Wards and nothing else are legal; illegal targets show a small shield-block icon on hover so the player understands *why*.

> ⚠️ ESTIMATE: all curve/reticle numbers.

### 3.6 Cancel and return-to-hand

Three cancel affordances, all of which must exist:

1. **Drag back below the hand line** (y > ~940) → the drop zone deactivates, board sockets unlight, and releasing returns the card.
2. **Release on an invalid area** → returns.
3. **During targeting, release on nothing / press Escape / tap a "Cancel" chip** → the card returns to hand *and the PP is refunded* (in Shadowverse, PP is committed only once the target resolves).

**Return-to-hand animation:** the definitive "nope" motion.
- The card travels back along a **slight arc** (control point offset toward the screen centre) to its fan slot.
- **280 ms, `easeOutBack(1.15)`** — the tiny overshoot at the end is what makes it feel springy rather than sad.
- Rotation and scale interpolate back to fan values over the same duration.
- Neighbours re-flow simultaneously (they never wait).
- A soft paper/whoosh SFX, quieter than the play SFX.
- No particles. Cancels should be visually cheap; only successful actions get spectacle.

---

## 4. Animations & Timings

### 4.0 Global timing philosophy

Shadowverse's presentation is **deliberately generous** — it is a spectacle-first CCG and it takes its time on evolution and legendary plays. But it also shipped an **animation-speed setting** and skip-on-tap, because players do complain about the pacing on long turns.

**Build every sequence with:**
- a **normal** duration (the table below),
- a **fast** duration (× 0.6),
- a **tap-to-skip** that jumps to the end state (with the final impact still firing, so it never feels broken),
- and **coalescing**: if 6 followers die at once, run one shared death sequence with staggered starts, not 6 serial ones.

**Standard easings used throughout:**

| Name | Use |
|---|---|
| `easeOutCubic` | almost all UI motion, settles |
| `easeOutBack(1.1–1.3)` | pops, returns, orb refills |
| `easeInQuad` | departures, drains, things leaving |
| `easeInOutCubic` | camera moves, banner sweeps |
| `easeOutElastic(0.6, 0.3)` | impact recoils, damage number pops |
| linear | particle lifetimes, scrolling textures |

### 4.1 Match start

| Step | Duration | Detail |
|---|---|---|
| Fade from black | 400 ms | |
| Field materialises | 600 ms | Plane fades in with an inlay-light sweep left→right |
| Leaders enter | 500 ms, 120 ms apart | Discs scale 0.7 → 1.0 `easeOutBack`, ring ignites |
| Versus card | 1200 ms hold | Both leader arts slam in from opposite sides, class emblems behind, names + class; a stinger |
| First/second indicator | 800 ms | "You go first" / "You go second" ribbon |
| Mulligan | user-paced | 3 cards dealt face-up centre-screen, 140 ms apart; tap to toggle a "redraw" X over a card; Confirm button |
| Redraw resolve | 700 ms | Selected cards flip over and swap, then all 3 fly to the hand fan |
| Turn banner | 900 ms | See §4.11 |

The **player going second draws one extra card** at the start of their first turn.

### 4.2 Draw

- Trigger: start of turn (both players draw 1), plus card effects.
- A card back rises off the deck stack (deck icon at the bottom-right for you, top-right for the opponent), travels along an arc toward the hand, **flips at ~55 % of the path** (Y-rotation 180° over 260 ms, `easeInOutCubic`), and settles into its fan slot.
- **Total 520 ms**, path `easeOutCubic`, with a 1.0 → 1.15 → 1.0 scale bump peaking at the flip.
- The hand re-flows to make room *during* the flight, not after.
- SFX: a paper slide + a small crystalline chime at the flip.
- **Opponent draws** are the same but the card stays face-down and flies to a simplified opponent hand indicator at the top; **240 ms**, no flip.
- **Burned card (hand at 9):** the card flies out of the deck, stops centre-screen, is struck by a red X and shatters into embers over 700 ms with a distinct dull crack. Make this unmistakable — it is a real loss.
- **Fatigue draw (empty deck):** deck icon cracks, a dark pulse runs from the deck to your leader, and the leader takes escalating damage with the standard damage treatment (§4.9).

### 4.3 Card play — the shared opening

Every play (follower, spell, amulet) shares an opening beat:

| Step | Duration | Detail |
|---|---|---|
| Commit | 0 ms | PP orbs begin draining (§1.7) |
| Card leaves hand | 180 ms | Rises and scales to 1.25, rotation → 0, `easeOutCubic` |
| Travel to stage point | 260 ms | Arcs to a "stage" position: centre-field for spells, the chosen board slot for followers/amulets |
| Type-specific | see below | |

For the **opponent's** play, the card is revealed face-up centre-screen at ~1.4 scale and **held for 900 ms** before continuing, so you can read it. This hold is essential — without it, opponent turns are illegible. Skippable by tap.

### 4.4 Follower summon

| Step | Start | Duration | Detail |
|---|---|---|---|
| Card arrives at slot | 440 ms | — | At 1.25 scale, still "card-like" |
| Flash | 440 | 120 ms | Full-white flash over the card, additive, alpha 0 → 1 → 0 |
| Ground rune blooms | 480 | 420 ms | A **class-coloured circular rune decal** on the field under the slot: scale 0.2 → 1.25 → 1.0, opacity 0 → 0.9, `easeOutBack`. The rune's glyphs are class-specific |
| Materialise burst | 500 | 500 ms | 26–40 particles bursting **outward and upward** from the rune, class-coloured core with white hot centres, additive, gravity −0.4, 0.4–0.9 s lifetimes; plus a single expanding ground ring (a torus scaling 0.3 → 2.2 with alpha 1 → 0) |
| Card settles to board size | 500 | 320 ms | 1.25 → 1.0 scale, `easeOutCubic`, with the backward tilt applied |
| Rune fades | 900 | 380 ms | Opacity → 0.15, then persists faintly for as long as the follower lives, or fully fades — pick one and be consistent |
| Voice line "Play" | 520 | — | Every follower has a **play line**; fire it here |
| **Fanfare** effect resolves | 1100 | varies | Only after the summon reads as complete |

**Total ≈ 1.4 s** for a plain follower.

**Legendary followers get an extended entrance:** an additional pre-burst (a vertical light pillar rising from the slot, 400 ms), a brief camera push-in of ~4 % (600 ms in, 500 ms out), and a heavier orchestral stinger. **Total ≈ 2.2 s.** Reserve this for Legendary rarity only.

### 4.5 Spell cast

| Step | Start | Duration | Detail |
|---|---|---|---|
| Card flies to centre-screen | 0 | 300 ms | `easeOutCubic` |
| Enlarge & hold | 300 | 260 ms in, **500 ms hold** | Scale to ~1.9, slight rotation settle, a class-coloured aura builds behind it, the background dims 40 % |
| Charge | 560 | 400 ms | Energy motes converge *inward* onto the card from off-screen; the card's frame glows white-hot |
| Shatter | 960 | 480 ms | The card breaks into **18–30 glass/crystal shards** that fly outward with rotation and gravity, fading over their 0.4–0.8 s lives; simultaneously a bright flash and a shockwave ring |
| Effect resolves | 1200 | varies | Damage numbers, destroys, buffs, etc. |
| Dim restores | 1440 | 300 ms | |

**Total ≈ 1.7 s.**

The shard shatter is the spell signature — shards should be **card-textured** (each shard shows the piece of art it broke from) for the first ~150 ms, then cross-fade to a plain emissive crystal material as they scatter. That trick is cheap and reads beautifully.

### 4.6 Amulet placement

Deliberately quieter than a follower — amulets are static objects, not creatures.

| Step | Start | Duration | Detail |
|---|---|---|---|
| Card descends into slot | 0 | 380 ms | `easeInOutCubic`, a **downward** motion rather than a burst |
| Seal ring | 300 | 500 ms | A hexagonal/circular seal inscribes itself on the field under the amulet, drawing progressively (an animated dash-offset around the ring) |
| Lock-in | 700 | 200 ms | A short flash, a low stone "thunk", the card settles with a 2 px vertical bounce |
| Countdown number appears | 800 | 240 ms | Scale 0 → 1.2 → 1.0 with a gear-turn |

**Total ≈ 1.0 s.** No voice line for most amulets.

### 4.7 Attack

The most-repeated animation in the game — it must be **snappy**. Total budget **≈ 900 ms**.

| Step | Start | Duration | Detail |
|---|---|---|---|
| Wind-up | 0 | 120 ms | Attacker pulls **back** ~14 px away from the target and squashes to 1.06 × 0.94, `easeOutQuad` |
| Lunge | 120 | 130 ms | Attacker translates ~70 % of the way to the target, stretched to 0.92 × 1.10, `easeInQuad`; a motion-blur streak / speed-line ribbon trails it |
| Impact | 250 | — | The frame everything happens on |
| — impact flash | 250 | 90 ms | A white radial flash at the contact point, additive, plus 8–14 spark particles |
| — screen shake | 250 | 180 ms | Decaying sine, amplitude 8 px, ~22 Hz, on the camera (not the UI layer) |
| — hit-stop | 250 | 60 ms | **Freeze all animation for 3–4 frames.** This single trick does more for impact than any particle |
| — target recoil | 310 | 260 ms | Target translates away 22 px and returns, `easeOutElastic` |
| — damage numbers | 320 | 700 ms | See below |
| Attacker returns | 380 | 260 ms | Back to its slot, `easeOutCubic` |
| Deaths resolve | 640 | 700 ms | See §4.10 |

**Damage number popup:** the numeral spawns at the impact point, scales 0.4 → 1.35 → 1.0 over 200 ms `easeOutBack`, rises 60 px over the following 500 ms with `easeOutQuad`, and fades over the last 250 ms.
- Colour: `#FF4B3A` fill, `#5A0A0A` outline 3 px, plus a white core flash for the first 80 ms.
- Heal numbers are `#5AE07A` with a `#0A3A18` outline and rise the same way.
- Simultaneous numbers on the same target stack with 90 ms offsets and a 14 px horizontal jitter so they don't overlap.

**Attacking the leader** additionally triggers §4.9.

**Storm/Rush** followers get a small horizontal streak effect on summon so their attack-readiness is legible before the attack itself.

### 4.8 Evolution — the signature effect

This is the moment the whole art direction exists to serve. Budget **≈ 2.4 s** at normal speed.

| Step | Start | Duration | Detail |
|---|---|---|---|
| Input | 0 | — | Player selects a follower and confirms evolve; one EP orb dims and drains |
| World dim | 0 | 260 ms | Everything except the target dims to **35 %**; the target gets a rim light. Time-of-day feel: the arena goes dark |
| Camera push | 0 | 700 ms | Dolly in ~9 % toward the target, `easeInOutCubic` |
| Card rises | 200 | 500 ms | The follower lifts **~90 px off the plane** and scales to 1.35, `easeOutCubic`, with a slow 6° rotation |
| Ground rune | 260 | 400 ms | A large red/gold evolve sigil inscribes under the follower, 1.6 × card width, rotating |
| Energy in-rush | 400 | 500 ms | Red/gold energy ribbons spiral **inward** and upward around the card — 5–7 ribbons on helical paths, additive, `#FF7A2A` → `#FFD98A` |
| **Burst of light** | 900 | 260 ms | A white-out at the card: a radial flash that briefly blows to near-full-screen white at ~85 % alpha, plus a lens-flare streak and a horizontal shockwave ring expanding to 2.5 × card width |
| **Art swap** | 980 | — | Hidden inside the white-out — swap to the evolved illustration and evolved frame here |
| **Leader portrait flash** | 900 | 400 ms | The **owning leader's disc flashes**: ring ignites gold-white, a burst behind the portrait, and the portrait art brightens. This is what ties evolution to the leader and makes it feel like *your* power |
| Stat roll-up | 1060 | 400 ms | Attack/defence numerals count up to their evolved values, with the plates pulsing green |
| Settle | 1160 | 460 ms | Card descends back to the plane and to 1.0 scale, `easeOutCubic`; embers begin |
| Aura established | 1400 | 400 ms | The persistent evolved aura fades in (§2.9): rim light, ember drift, ground rune at low opacity |
| Dim restores | 1500 | 400 ms | |
| Camera returns | 1400 | 600 ms | |
| Voice line "Evolve" | 950 | — | Followers have dedicated evolve lines; leaders may also react |
| Choir stinger | 900 | ~1.6 s | See §5 |

**Colour language:** evolution is **red + gold + white**, always, regardless of class. It overrides the class palette. That contrast — a green Forestcraft follower erupting in red-gold — is exactly why the effect reads as a state change.

> ⚠️ ESTIMATE: all timings. The *beat structure* (dim → rise → in-rush → white-out → swap → leader flash → settle) is the part to preserve.

### 4.9 Leader damage

| Step | Start | Duration | Detail |
|---|---|---|---|
| Impact flash on the disc | 0 | 100 ms | White then red |
| **Screen-edge red flash** | 0 | 420 ms | A full-screen vignette overlay, `#C41A1A`, alpha 0 → 0.45 → 0 with `easeOutQuad`. Strength scales with damage: `alpha = clamp(0.18 + dmg * 0.028, 0.18, 0.62)` |
| Camera shake | 0 | 260 ms | Decaying sine, amplitude `clamp(4 + dmg * 0.9, 4, 22)` px |
| Portrait recoil | 0 | 300 ms | The disc shifts 14 px away from the source and returns, `easeOutElastic` |
| Damage numeral | 60 | 800 ms | As §4.7 but ~1.4 × larger, spawned over the defence badge |
| **HP number rolls down** | 160 | `clamp(dmg * 55, 220, 900)` ms | An **odometer roll**, digit-by-digit, not a snap. Ticking SFX per unit. `easeOutQuad` on the roll rate |
| Badge pulse | 160 | 500 ms | Crest scales 1.0 → 1.18 → 1.0, glows red |
| Low-HP state | on cross | — | Below 10: the badge gains a persistent 1.4 s red pulse and a faint heartbeat SFX layer. Below 5: 0.8 s pulse, a thin red vignette becomes permanent at 10 %, and the leader's voice may fire a "hurt" line |
| Lethal | — | — | Damage sequence runs, the roll ends on 0, the number blows out white, then the defeat sequence begins after a 600 ms hold |

Healing runs the same structure inverted: green `#3FD46A` edge glow at half the intensity, no shake, the number rolls **up**, and a soft ascending chime.

### 4.10 Follower death

| Step | Start | Duration | Detail |
|---|---|---|---|
| Freeze + desaturate | 0 | 140 ms | The card goes grey and darkens |
| Crack | 100 | 160 ms | A crack texture propagates across the card (animated mask) |
| **Shatter / dissolve** | 240 | 520 ms | Two blended treatments: (a) the card breaks into 14–22 shards that fall with gravity and fade; (b) a **dissolve** — a noise-threshold burn from the bottom up, with a thin bright emissive edge at the dissolve line, `#B06BFF` for followers going to shadows |
| Soul wisp | 380 | 500 ms | 1–3 purple wisps rise from the remains and **fly along a curve into the shadow counter** (§1.11), where the number pops |
| Board re-flow | 500 | 220 ms | Survivors close ranks, `easeOutCubic` |
| Voice line "Death" | 240 | — | Every follower has a death line |

**Total ≈ 1.0 s**, and it must **coalesce**: multiple simultaneous deaths start 70 ms apart, share one board re-flow, and share one wisp-flight batch.

**Amulet destruction** uses a gold-dust variant: no crack, a 400 ms dissolve into `#F0C64E` motes that scatter and fade, plus the seal ring on the field cracking and vanishing.

### 4.11 Last Words

Last Words (death-triggered effects) need to be **legible as a separate beat** or players lose the plot.

- After the death sequence completes, a **Last Words banner** appears at the dead follower's former position: a small horizontal plaque, dark with a purple-gold rule, reading "Last Words" plus the card name.
- 180 ms scale-in `easeOutBack`, **hold 550 ms**, 200 ms fade.
- A purple energy pulse `#9B6BD8` expands from the position over 400 ms.
- Only *then* does the effect resolve.
- Keyword-trigger banners share this component: **Fanfare** (gold `#F0C64E`), **Last Words** (purple `#9B6BD8`), **Necromancy** (deep purple with a shadow-spend animation on the counter), **Enhance** (blue `#7FD8FF`), **Countdown reaching 0** (amber).

### 4.12 Turn transition banner

The most-seen non-card animation in the game.

- A **full-width horizontal band**, ~220 px tall, centred vertically on the field's centre line.
- Composition: a dark translucent core (`#0C1220` at 80 %) with bright gold rules at top and bottom and soft feathered ends, carrying large centred text.
- **Sweep in:** the band wipes in from the left, its leading edge a bright gold flare, **320 ms `easeOutCubic`**. The text is masked by the band and appears to be revealed by the wipe.
- **Hold:** 700 ms. During the hold the text has a gentle specular sweep and the band's rules shimmer.
- **Sweep out:** the band wipes out to the right, **280 ms `easeInCubic`**, leaving a brief gold streak.
- **Total ≈ 1.3 s.**
- Text: **"Your Turn"** (warm gold `#F5DFA0`, bright, with an upward-lifting sub-motion) vs **"Opponent's Turn"** (cool steel `#B8C4D8`, dimmer, sub-motion downward). Making the two visually opposite is what lets players read the state peripherally.
- SFX: a rising crystalline sweep for yours, a falling one for theirs.
- Simultaneously: PP orbs refill, the turn timer resets, the End Turn button changes state, and (for you) the draw fires at the tail of the banner.

### 4.13 Victory / defeat

| Step | Duration | Detail |
|---|---|---|
| Final blow hold | 600 ms | Everything freezes on the killing damage |
| World fade | 500 ms | The board desaturates and dims to 20 %; particles stop |
| Loser's leader reaction | 900 ms | The defeated leader's portrait cracks/darkens; a defeat voice line fires |
| **Banner slam** | 400 ms | "VICTORY" or "DEFEAT" scales in from 2.2 → 1.0 with `easeOutBack(1.4)`, plus a radial shockwave and a screen flash |
| — Victory | | Gold `#F2CF63` with a white core, gold light rays radiating and slowly rotating behind it, a rising confetti/mote field, a triumphant orchestral stinger |
| — Defeat | | Desaturated steel `#8A93A3` on near-black, cracked-glass overlay across the whole screen, a descending minor stinger, no particles |
| Hold | 1200 ms | |
| Results panel | 400 ms slide-up | Rank/RP change, rewards, opponent info, "Continue" / "Rematch" |
| RP bar fill | 900 ms `easeOutCubic` | Number counts up; on rank-up, a separate 1.5 s rank-up flourish with a new-rank emblem slam |
| Reward chest | 1.2 s | If a Victory-Rewards chest was in play, it appears and opens with a light burst |

### 4.14 Master timing table

| Event | Normal | Fast (×0.6) | Skippable |
|---|---|---|---|
| Draw (yours) | 520 ms | 310 ms | no |
| Draw (opponent) | 240 ms | 145 ms | no |
| Card burn (hand full) | 700 ms | 700 ms | no |
| Hover lift | 140 ms | 140 ms | — |
| Focus/inspect open | 220 ms | 220 ms | — |
| Return to hand | 280 ms | 280 ms | — |
| Board re-flow | 220 ms | 160 ms | — |
| Follower summon | 1400 ms | 840 ms | yes |
| Legendary summon | 2200 ms | 1320 ms | yes |
| Spell cast | 1700 ms | 1020 ms | yes |
| Amulet place | 1000 ms | 600 ms | yes |
| Attack | 900 ms | 540 ms | yes |
| Leader damage | 900 ms | 540 ms | yes |
| **Evolution** | 2400 ms | 1440 ms | yes |
| Follower death | 1000 ms | 600 ms | yes |
| Last Words banner | 930 ms | 560 ms | yes |
| Turn banner | 1300 ms | 780 ms | yes |
| Opponent card reveal hold | 900 ms | 540 ms | yes (tap) |
| PP orb refill (full) | ~900 ms | 540 ms | no |
| Victory/defeat sequence | ~4.5 s | ~3.0 s | partially |

> ⚠️ ESTIMATE: the entire table. Anchor points that feel right and are worth defending: attack ≈ 0.9 s, summon ≈ 1.4 s, evolution ≈ 2.4 s, turn banner ≈ 1.3 s.

---

## 5. Audio

Music by **Yoshihiro Ike** (who also scored the *Shadowverse* anime). The soundtrack is fully orchestral and was released as *Shadowverse Original Soundtracks* (Cymusic/Cygames, 19 Jul 2017, 21 tracks) — the exact Wonderland Dreams-era library.

### 5.1 The overall sound identity

Three layers that never fight each other:

1. **Orchestral BGM** — deep, dark-fantasy, live-sounding orchestra. Low strings and horns carry the harmonic bed; choir appears at climaxes. Occupies the low-mid; heavily side-chained/ducked under stingers.
2. **Crystalline UI** — everything you touch sounds like struck glass or crystal, in the 2–8 kHz range. Short (40–140 ms), bright, with a small pitched tail. This is the game's most recognisable audio signature and it belongs to *every* HUD interaction.
3. **Physical/material SFX** — cards are paper and metal; boards are stone; impacts are heavy and low. This layer occupies the low-mid and gives weight.

### 5.2 BGM behaviour

- Battle BGM is looped with an intro. Distinct tracks for home/menu, deck building, shop/pack opening, battle, and boss/story battles.
- **Intensity layering:** add a percussion/brass layer once either leader falls below ~40 % defence, and a further choir layer below ~20 %. Crossfade layers over 2 bars rather than switching tracks.
  > ⚠️ ESTIMATE: the thresholds and whether the original layered at all — the *feel* of escalation is definitely present.
- BGM ducks by **−6 dB over 120 ms** under any voice line or major stinger, recovering over 600 ms.

### 5.3 SFX catalogue

| Event | Character | Length | Notes |
|---|---|---|---|
| Button hover | Soft glass tick | 40 ms | Very quiet, −18 dB |
| Button press | Crystal click + metal latch | 90 ms | |
| Card hover in hand | Light chime | 60 ms | Pitch varies ±2 semitones per card so a scan across the hand sounds musical, not machine-gun |
| Card drag start | Paper lift | 120 ms | |
| Card whoosh (travel) | Airy swish, doppler-pitched by speed | 200–400 ms | The core "card is moving" sound |
| Card lands on board | Low stone thunk + paper slap | 180 ms | |
| Draw | Paper slide + chime at the flip | 300 ms | |
| PP orb spend | Descending glass pluck, one per orb | 70 ms each | Sequenced with the visual drain |
| PP orb refill | Ascending glass pluck | 70 ms each | The final max-PP orb gets a brighter bell |
| EP unlock | Low choir swell + bell | 900 ms | |
| Summon (normal) | Magical bloom + a low impact | 700 ms | Class-tinted timbre (see below) |
| Summon (legendary) | Brass hit + choir + bloom | 1.4 s | |
| Spell charge | Rising shimmer / riser | 600 ms | |
| Spell shatter | Glass smash, bright | 400 ms | |
| Amulet place | Stone set + seal hum | 600 ms | |
| Attack lunge | Sharp whoosh | 130 ms | |
| Impact | Layered: transient crack + body thud + metal ring | 300 ms | Pitch/weight scaled by damage |
| Leader damage | Deeper thud + sub-bass drop + a brief distorted "bruise" | 500 ms | |
| Follower death | Crack, then a descending dissolve shimmer | 600 ms | |
| Shadow gained | Short dark whisper | 250 ms | |
| **Evolution** | The signature: a **choir stinger** — a sustained mixed-voice "aah" swelling under a brass/orchestral hit, with a bright bell at the white-out and a low sub-drop as it settles | ~1.6 s | Do not reuse this sound anywhere else. It is the single most identity-defining cue in the game |
| Last Words trigger | Low bell + reversed whisper | 500 ms | |
| Turn start (yours) | Ascending crystalline sweep + soft bell | 700 ms | |
| Turn start (opponent) | Descending, duller sweep | 600 ms | |
| Timer tick (<10 s) | Dry clock tick | 40 ms | |
| Victory | Rising orchestral fanfare + choir | 3 s | |
| Defeat | Descending minor cadence + a glass-crack | 3 s | |
| Pack tear | Foil rip | 500 ms | |
| Card reveal (bronze/silver) | Light chime | 300 ms | |
| Card reveal (gold) | Bright bell + shimmer | 600 ms | |
| Card reveal (legendary) | Full choir + brass hit + long shimmer tail | 1.8 s | |

> ⚠️ ESTIMATE: lengths and layer descriptions. The categories and the "crystalline UI + orchestral music + heavy physical impacts" identity are solid.

**Class-tinted summon timbre** (a cheap, high-value trick): filter/layer the summon bloom per class — Forestcraft gets wind and wood chimes; Swordcraft steel-on-steel; Runecraft a synthetic arcane shimmer; Dragoncraft a low roar/rumble; Shadowcraft a reversed whisper; Bloodcraft a wet, visceral pulse; Havencraft a bell and choir; Neutral a plain bloom.

### 5.4 Voice

Voice is a very large part of the game's character and budget.

- **Every follower card is fully voiced**, with at minimum: a **play line**, an **attack line**, and a **death line**. Evolved followers commonly have additional **evolve** lines. Cards are credited with both illustrator and CV (voice actor) in the card detail screen.
- **Leaders** have lines for: match start, turn start, evolving, taking heavy damage, low health, winning, and losing — plus the canned **emote** lines (§1.12).
- **Mixing rules:**
  - Voice sits above everything; duck BGM −6 dB and SFX −3 dB during a line.
  - **Never overlap two voice lines.** Queue them, and drop stale entries — if 4 followers die at once, play one death line (the highest-rarity or first) and discard the rest.
  - Play lines fire ~80 ms after the summon flash, not at the start of the travel.
  - Voice language is a setting (JP/EN); the global release shipped Japanese voice with English text as the default experience for many players. Support a voice-language independent of the text language.

---

## 6. Typography & Colour

### 6.1 Fonts

> ⚠️ ESTIMATE: exact typeface identifications. Cygames did not publish them. These are close-match recommendations that will read correctly.

**Japanese:** a heavy gothic (sans) with strong, squared terminals — visually in the family of Morisawa **Shin Go Bold / Ultra** or **A-OTF Gothic MB101 Bold**, used for card names, numbers and headings. Body/ability text uses a lighter weight of the same family for legibility at small sizes.
Free substitutes: **Noto Sans JP** (Bold/Black), **M PLUS 1p** (Bold), **Zen Kaku Gothic New** (Bold).

**English/global:** a serif/sans hybrid — card names and headings use a **high-contrast display serif with slightly flared stems and small-caps-ish proportions**; body/ability text uses a humanist sans for legibility.
- Display / card names / banners: **Cinzel**, **Marcellus**, **Trajan Pro**, or **Cormorant Garamond SemiBold**.
- Body / ability text / UI labels: **Lato**, **Source Sans 3**, **Noto Sans**, or **Open Sans Semibold**.
- Numerals (cost/attack/defence/HP): a **heavy slab or bracketed serif** with strong verticals, always with a 2–3 px dark outline and a subtle inner bevel. **Cinzel Black**, **Bitter Bold** or **Zilla Slab Bold** are good stand-ins. Numerals must be **tabular/lining** so odometer rolls don't jitter.

**Type scale** (at 1080 reference height):

| Role | Size | Weight | Tracking |
|---|---|---|---|
| Turn banner / VICTORY | 96 px | Black | +0.08 em |
| Screen headings | 48 px | Bold | +0.04 em |
| Card name (inspect, 560 px card) | 34 px | Semibold | +0.02 em |
| Card name (hand, 168 px card) | 15 px | Semibold | +0.02 em |
| Ability text (inspect) | 24 px | Regular | 0 |
| Keywords | 24 px | Bold | 0 |
| Flavour text | 20 px | Italic | +0.01 em |
| Cost numeral (inspect card) | 56 px | Black | 0 |
| Attack/Defence numeral (inspect) | 62 px | Black | 0 |
| Leader HP numeral | 52 px | Black | 0 |
| Damage floater | 64 px | Black | 0 |
| PP readout | 34 px | Bold | 0 |
| Button label | 30 px | Bold | +0.06 em |
| Small counters (deck/shadows) | 26 px | Bold | 0 |

**Legibility rules:** every numeral and every piece of text that sits over artwork gets an outline (2–3 px) *and* a drop shadow (0, 2, 4 px, black 60 %). Never rely on the art being dark.

### 6.2 The core UI palette — gold on dark

The whole interface is **warm metal on cold darkness.** Gold and bronze are the only saturated hues in the chrome; everything else is near-neutral.

| Token | Hex | Use |
|---|---|---|
| `gold/bright` | `#F2DFA0` | Rim highlights, hot edges, hover states |
| `gold/primary` | `#C9A24A` | The main UI metal, button fills, frame band |
| `gold/deep` | `#8A6B24` | Gradient bottoms, shadowed metal |
| `bronze/dark` | `#4A3714` | Engraved recesses |
| `metal/shadow` | `#2A2118` | Outer bevels, frame outlines |
| `ink/900` | `#080B14` | Deepest background, vignette |
| `navy/800` | `#0C1220` | Panel backgrounds, battle bg |
| `navy/700` | `#121A2B` | Raised panels |
| `slate/600` | `#1A2233` | Cards/list rows |
| `slate/400` | `#3A4356` | Dividers, disabled |
| `ivory/100` | `#F5EFE0` | Primary text |
| `ivory/300` | `#D6CDB8` | Secondary text |
| `grey/500` | `#8A93A3` | Tertiary/disabled text |

**Functional accents:**

| Token | Hex | Use |
|---|---|---|
| `pp/crystal` | `#7FD8FF` core, `#2F7BD8` glow | PP orbs, cost orb |
| `pp/spent` | `#3E4654` | Drained orbs |
| `cost/orb` | `#2F7BD8` | Card cost |
| `atk/plate` | `#E0552A` on `#B33A18` | Attack |
| `def/plate` | `#2FA88C` on `#1E7A63` | Defence |
| `damage` | `#FF4B3A` | Damage numbers, HP loss |
| `heal` | `#3FD46A` | Healing |
| `buff` | `#7BE86A` | Stat increases |
| `debuff` | `#B06BFF` | Stat decreases, curses |
| `shadow` | `#9B6BD8` on `#3A1E5A` | Shadows / Necromancy |
| `evolve` | `#FF7A2A` → `#FFD98A` | Evolution, evolved frames |
| `ward` | `#7FD4FF` | Ward barriers |
| `danger` | `#C41A1A` | Leader damage vignette, warnings |

### 6.3 Rarity colours

| Rarity | Hex | Glow |
|---|---|---|
| Bronze | `#B0743C` | none |
| Silver | `#C8CDD6` | faint white |
| Gold | `#F0C64E` | warm `#FFD86B` |
| Legendary | `#C24BE0` base, animated prismatic | magenta→cyan→gold sweep |

### 6.4 Class colours

Eight identities (seven classes + Neutral) in the Wonderland Dreams era. Portalcraft did not exist yet — it arrived in 2018 with *Brigade of the Sky* — so a period-accurate build has **seven playable classes**.

| Class | Identity | Primary | Deep | Accent | Emblem motif |
|---|---|---|---|---|---|
| **Forestcraft** | Fairies, nature, wide boards | `#4CA64C` | `#1E5B2E` | `#8FD44A` | Leaf / vine |
| **Swordcraft** | Knights, officers, gold | `#E8C24A` | `#A87A18` | `#FFEBAE` | Crossed swords / crest |
| **Runecraft** | Witches, spellboosting | `#4A7BE8` | `#2A2F8A` | `#9A5CE0` | Arcane circle / rune |
| **Dragoncraft** | Dragons, ramp, fire | `#E88B2A` | `#A03B10` | `#FFC46B` | Dragon wing / claw |
| **Shadowcraft** | Undead, shadows, necromancy | `#8B5CC7` | `#2B1240` | `#C79BFF` | Skull / soul flame |
| **Bloodcraft** | Vampires, self-damage, vengeance | `#C8203C` | `#5A0A18` | `#FF6B7A` | Bat wing / blood drop |
| **Havencraft** | Angels, amulets, defence | `#F0E6C8` | `#C9A227` | `#FFFFFF` | Halo / feathered wing |
| **Neutral** | Colourless, playable in any deck | `#B8BCC4` | `#4A4F58` | `#E8EBEF` | Plain gem |

> ⚠️ ESTIMATE: all class hexes. Cygames never published class colour values; these are matched to the in-game emblem and frame tints. What matters is the *relationships* — Havencraft must be the lightest, Shadowcraft and Bloodcraft the darkest, Swordcraft must not be confusable with the neutral gold chrome (which is why Swordcraft's gold skews warmer and more saturated than `gold/primary`).

**Where class colour is applied:**
- Card frame tint wash (25–35 %) and class gem.
- Summon ground rune and materialise particle colour.
- Board socket highlight when a drop is legal.
- Leader class emblem behind the portrait.
- Deck-builder class tab and deck-list header.
- Battle-log card name colour.
- Pack/collection class filter chips.

**Where it is deliberately NOT applied:** evolution (always red/gold), damage (always red), the End Turn button and PP tray (always neutral gold), and the turn banner (gold vs steel). Keeping the functional HUD class-agnostic is what stops the screen becoming a colour soup.

### 6.5 Accessibility notes

- The green defence plate against the red attack plate is a **red/green pair on the most important numbers in the game**. Add a colour-blind mode that changes the *shapes* (blade escutcheon vs. round shield — already different) and swaps the defence plate to blue `#2F86D8`.
- Damage red on dark navy passes contrast; buff green `#7BE86A` on the dark plate passes; do not put `#8A93A3` disabled text on `#1A2233` (fails) — lift to `#A6AFBF`.

---

## 7. Other Screens

### 7.1 Home / main menu

- **Layout:** a full-bleed animated background (the current expansion's key art with parallax layers and drifting particles), a large character/leader render, and UI furniture over it.
- **Top bar:** player name + level, rupies, crystals (with a `+` to buy), a mail/crate button in the top-right for claiming rewards, and settings.
- **Bottom navigation bar:** a row of large gold-plated tabs — **Home / Solo (story & missions) / Battle / Cards (deck builder + collection) / Shop / Menu**. Each ~230 × 130 with an icon above a label.
  > ⚠️ ESTIMATE: exact tab set and labels; "Shop", "Cards", "Crate", "Decks" are corroborated.
- **Centre-right:** a large primary **Battle** call-to-action, and a rotating banner carousel for events/campaigns.
- **Notification badges:** small red discs with a count, on Crate, Shop (free daily pack) and Missions. These badges do a 1-second attention pulse on entry to Home.
- Transitions between top-level screens: 300 ms cross-fade plus a 5 % scale-in on the incoming screen; a gold wipe for entering Battle.

### 7.2 Deck builder

The single most-used non-battle screen; design it for one-handed landscape use.

**Layout (1920 × 1080):**

- **Left / centre (≈ 68 % width): card list grid.** 5 columns × 2 visible rows of card thumbnails at 200 × 286, gutter 20 px, vertically scrolling with momentum. Owned-count badge (`×2`) on each; cards you own 0 of are greyed with a "craft" cost shown; cards already at 3 in the deck are dimmed and non-interactive.
- **Right panel (≈ 32 %, ~600 px): the deck list.** A vertical list of **rows, not cards** — each row is ~72 px tall showing: cost orb (left), a thin art strip as the row background (heavily darkened, class-tinted), the card name, and a copy count `×2` on the right. Rows are sorted by cost then name. Tap a row to remove one copy.
- **Panel header:** deck name (editable), class emblem, and the **card counter `36/40`** rendered large — it turns from `#FF4B3A` to `#7BE86A` when the deck is legal.
- **Cost curve** sits at the top or bottom of the right panel: a compact bar chart, 10 bars for costs 1–8+, each bar a gold gradient with the count above it, ~140 px tall total. Bars animate their height over 220 ms `easeOutCubic` on every change.
- **Filters** across the top of the grid as chips: **class** (your class + Neutral), **cost** (0,1,2,…,8+), **type** (Follower / Spell / Amulet), **rarity** (Bronze/Silver/Gold/Legendary), **card set/pack**, plus a **text search** and a **sort** dropdown. Active chips fill gold; inactive are outlined.
- **Add/remove feedback:** tapping a grid card flies a small ghost of it into the deck panel over 280 ms along an arc, the deck row scales-punches, the counter increments with a pop, and the cost-curve bar grows. Removal reverses it. A short crystalline click each way.
- **Rules surfaced in-UI:** exactly **40 cards**, max **3 copies** of any card, single class + Neutral only.
- **Footer:** Save, Auto-build/Complete deck, Copy, Delete, and a deck-code share.

### 7.3 Card collection

- The same grid as the deck builder but full-width: 7 columns × 2.5 visible rows at ~230 × 328.
- **Class tabs** across the top: 8 tabs (7 classes + Neutral), each an emblem + name, the active tab lifted and class-tinted with a gold underline.
- Secondary filter row identical to §7.2, plus toggles for "Owned only", "Animated only", "Craftable".
- Un-owned cards render at ~20 % brightness and fully desaturated with a small lock/craft icon — a strong, immediately-readable completion state.
- Owned counts as `×1 / ×2 / ×3`; at 3 the badge turns gold.
- A completion meter per set: "Wonderland Dreams — 68 / 104".
- **Craft / liquefy** happens from the card detail view; costs are Bronze 50 / Silver 200 / Gold 800 / Legendary 3500 vials.

### 7.4 Card detail view

Opened by tapping a card in the collection or long-pressing in the deck builder.

- Background blurs and dims to 25 %; a modal takes the screen.
- **Left: the card, large** (640 × 914), with full 3D tilt-parallax (gyro on mobile). If the card is animated/premium, the animated art and foil sweep play here at full quality.
- **Right: an info column** —
  - Card name (display serif), class emblem, rarity gem + label, card type, expansion/set.
  - Cost / Attack / Defence as three large plates.
  - Full ability text with tappable keywords.
  - **Flavour text** in italic ivory `#D6CDB8`, offset in its own bordered box — Shadowverse's flavour text is a real draw and deserves prominence.
  - **Illustrator** and **CV (voice actor)** credits.
  - Owned count, craft cost, liquefy value, and Create/Liquefy buttons.
- **Toggle: Base ⇄ Evolved.** A prominent switch that flips the card with a 360 ms Y-rotation and swaps the art + frame. Non-followers hide this control.
- **Voice playback row:** buttons for **Play / Attack / Death / Evolve** lines; the active one shows a small waveform and the card gets a subtle pulse in sync.
- **Animation playback:** for animated cards, a play/pause and a loop indicator.

### 7.5 Pack opening ceremony

The highest-spectacle screen in the game outside evolution. Budget ~12–18 s for a 8-card pack at normal speed, all skippable.

| Step | Duration | Detail |
|---|---|---|
| Pack presented | 900 ms | The pack (an ornate foil sleeve with the expansion's key art) floats in from below, scaling 0.6 → 1.0 `easeOutBack`, rotating gently; the background is a dark starfield with drifting gold motes |
| Tap-to-open prompt | — | "Tap to open" pulses |
| **Tear** | 700 ms | The pack tears open along the top with a foil-rip SFX; a **light bursts out of the tear**, blowing to near-white; the pack halves fly apart and dissolve |
| **The rarity beam** | 600 ms | This is the moment everyone plays for: **a vertical column of light** erupts from the pack, colour-coded to the best card inside — see the table below. It holds, pulses, and the audience knows the outcome before a single card is shown |
| Cards fan out | 900 ms | The cards emerge face-down and arrange into a **fan/arc across the screen** (typically 8 cards), staggered 90 ms apart, `easeOutCubic`, with a slight rotation |
| **Tap-to-reveal** | user-paced | Each card flips on tap: 380 ms Y-rotation `easeInOutCubic`, scale bump to 1.15 at the midpoint, a per-rarity flash and SFX at the reveal instant. There is also a "Reveal All" button |
| Legendary reveal | +1.8 s | A Legendary interrupts the flow: the card scales to fill the centre, a **rainbow/prismatic burst** radiates outward, gold-white rays rotate behind it, a full choir stinger fires, and the whole screen tints briefly. Then it settles back into the fan |
| Summary | 600 ms | New cards get a "NEW" ribbon; duplicates beyond 3 show the vials awarded; a Continue / Open Another footer |

**Rarity beam colours:**

| Best card in pack | Beam |
|---|---|
| Silver | Cool white / pale blue `#BFE4FF` |
| Gold | Warm gold `#FFD86B`, brighter, with rotating rays |
| Legendary | **Rainbow / prismatic** — a beam cycling magenta `#E04BC8` → cyan `#4BE0E0` → gold `#F0C64E`, widest and brightest, with a screen-wide shockwave |

> ⚠️ ESTIMATE: the exact beam colours and that Silver gets its own beam (blue for "at least Gold" and rainbow for Legendary is the other plausible split). Every pack is guaranteed at least one Silver, Gold or Legendary, so a "nothing special" beam should be rare or absent.

Each card has an **~8 % chance to be animated**; an animated pull adds a shimmer sweep and a distinct sparkle SFX on top of its rarity reveal, so an animated Bronze still feels like something.

### 7.6 Results / rewards screens

- Post-match results (§4.13): rank emblem, RP bar with a counting number, win streak, rewards earned.
- Mission complete: a slide-in toast from the top-right, gold-rimmed, with a checkmark stamp animation (scale 1.6 → 1.0, 240 ms `easeOutBack`) and a reward icon.
- Crate/mailbox: a list with per-item Claim and a Claim All; claiming plays a small burst per item, staggered 80 ms.

---

## 8. Mobile-Specific

### 8.1 Orientation

- **The game is landscape-locked.** There is no portrait battle layout, and there should not be one — the two-row board with a 5-wide field and a 9-card fan does not survive a portrait aspect.
- If your product requires a portrait entry point, restrict it to non-battle screens (home, collection, shop) and force a rotate-prompt before battle. Give the prompt a 500 ms rotating-phone animation and hold until orientation changes.
- Supported aspect range in practice: **16:9 to ~20:9**. Design at 16:9 and let extra width go to the field, not the HUD.

### 8.2 Safe areas

- **Notch/Dynamic Island side (landscape left or right depending on rotation):** reserve **44 pt** (≈ 88 px at 2×). Nothing interactive and no text inside it.
- **Home indicator edge (bottom in landscape):** reserve **21 pt** (≈ 42 px). This is directly under the hand fan — raise `baseY` by the inset so the bottom of the fan is not swallowed, and never place a tap target there.
- **Android gesture nav:** reserve 24–48 px on the gesture edge; the back-gesture edge swipe conflicts with a drag started near the screen edge — add an **edge-drag exclusion** region (`systemGestureExclusionRects` equivalent) along the hand fan's left and right ends.
- **Rounded corners:** keep the leader discs and the deck/shadow counters ≥ 24 px inside the corner radius.
- Implement as CSS `env(safe-area-inset-*)` equivalents fed into your layout as a padding rect, applied to the **HUD layer only** — the 3D field should render edge-to-edge behind it.

### 8.3 Touch targets

| Element | Visual size | Hit size | Notes |
|---|---|---|---|
| End Turn | 300 × 132 | 340 × 170 | The most important target; oversized on purpose |
| Card in hand | 168 × 240 | 168 × 280, extended **downward** off-screen | Extending the hitbox below the visible card catches low thumb taps |
| Board follower | 190 × 266 | 210 × 286 | |
| Leader | 200 ⌀ | 240 ⌀ | |
| PP tray | — | non-interactive | Info only |
| Menu / log / emote buttons | 84 × 84 | 110 × 110 | |
| Deck-builder grid card | 200 × 286 | full cell incl. gutter | |
| Filter chip | 150 × 56 | 150 × 76 | |

**Minimum hit target: 44 × 44 pt (≈ 88 × 88 px at 2× on a 1080-tall reference).** Nothing interactive goes below it.

**Hit-target overlap resolution:** in the hand fan, cards overlap by up to ~22 %. Resolve taps by **topmost-first z-order**, and additionally bias the hit test toward the card whose *visible* (unoccluded) region was hit — a per-card visible-region test, not just a bounding box. Getting this wrong is the number-one source of "I tapped the wrong card" complaints.

### 8.4 The hand fan and thumbs

In landscape both thumbs rest at the **lower-left and lower-right corners**. That drives the whole layout:

- The hand fan is **bottom-centre**, between the thumbs — reachable by either, occluded by neither at rest.
- The **End Turn button is bottom-right-ish** (right thumb, the most frequent action).
- The **emote button is bottom-left** (left thumb, low frequency).
- **Leaders are on the left edge but vertically centred-ish**, so the left thumb does not sit on top of your own leader portrait.

**Thumb-occlusion rules:**

1. **Never put critical feedback under the dragging finger.** The inspect/focus panel for a hand card anchors to the **left-centre** (400, 560), i.e. diagonally opposite the typical right-thumb drag origin.
2. During a drag, the **card renders offset ~60 px above the touch point** so the finger doesn't cover the card being played. This offset is the single most impactful mobile-CCG tweak.
3. Damage numbers and floaters spawn **above** their subject, never below.
4. The targeting reticle is drawn at the touch point but the *reticle rings* are 96 px across, so the lock state is visible around the fingertip.

**Fan reachability:** at 9 cards the fan spans ~1180 px of a 1920 canvas (61 %). A thumb arc from the bottom-right corner comfortably covers roughly the right 55 % of the screen at the bottom. The **left-most 2 cards may be out of easy right-thumb reach** — mitigate with:
- horizontal **drag-scrub** on the fan (swipe along it to bring cards toward centre with a rubber-band), and
- a **tap-to-select-then-tap-to-place** alternative to dragging, which is also the accessibility path.

### 8.5 Input model — support both

1. **Drag-and-drop** (primary, expressive): press → 12 px threshold → drag → release on a zone.
2. **Tap-tap** (accessibility + one-handed): tap a card to select (it lifts and stays), the legal zones highlight persistently, tap a zone to play, tap elsewhere to cancel. Also the only workable path for targeting on small screens.

Both must produce identical animations from the commit point onward.

### 8.6 Performance budget

- Target **60 fps** on a mid-tier 2016-era phone equivalent; degrade gracefully to 30.
- Draw calls: keep the whole battle scene under ~120. Atlas every card frame, plate, orb and icon into 2–3 texture atlases.
- Card art: stream at 2 resolutions (a 256-px thumbnail for hand/board, a 1024-px for inspect/detail). Never load full-res art for 9 hand cards.
- Particles: instanced, one draw call per emitter type, hard cap ~800 live particles; drop to ~250 on the low tier and shorten evolution's in-rush.
- Post-processing: bloom is essential to the look (all that gold and all those crystals). Use a cheap 2-pass downsampled bloom; drop to a simple additive glow-sprite approach on low-tier. **Vignette is free and non-negotiable.**
- Shadows: do **not** use real-time shadow maps. Use a blob/gradient shadow decal under each card projected onto the field plane — it is indistinguishable at this camera angle.
- Text: SDF/MSDF text so card names and numbers stay crisp through the hover scale from 168 px to 560 px card width without re-rasterising.
- Hit-stop (§4.7) is free and buys more perceived impact than any effect — spend there first.

### 8.7 Settings that must exist

- **Animation speed** (Normal / Fast) and **skip on tap** — Shadowverse shipped these and players use them.
- BGM / SE / Voice volume sliders, independently.
- Voice language.
- Mute opponent emotes.
- Reduced-motion mode (disables camera shake, screen flashes, and the evolution white-out — swap the white-out for a 200 ms cross-dissolve). This is both an accessibility need and a photosensitivity concern: the evolution and pack-opening flashes are bright, high-contrast and frequent.

---

## 9. Sources

Corroborating sources consulted for this document. Note that several are *Worlds Beyond* / *Evolve* pages that describe mechanics shared with the original; where they differ, the original's behaviour is what is documented above.

**Official (Cygames):**
- Play Guide — https://shadowverse.com/gameguide/playguide.php
- Cards / Game Guide — https://shadowverse.com/gameguide/cards.php
- Help — https://shadowverse.com/help/
- FAQ — https://shadowverse.com/faq/
- Getting Started with Shadowverse — https://shadowverse.com/articles/detail.php?id=post-149
- Wonderland Dreams card list — https://shadowverse.com/cards/cardpack/wonderlanddreams?lang=en
- Draw rates (pack contents / animated-card rate) — https://shadowverse.com/drawrates/?pack_id=10002
- Shadowverse Portal (deck builder, class filters, card list) — https://shadowverse-portal.com/cards?lang=en
- NieR:Automata tie-in (leader skins / cosmetics) — https://shadowverse.com/collaboration/nierautomata
- Battles (Worlds Beyond, shared mechanics reference) — https://shadowverse-wb.com/en/system/cardbattle/battle/
- Card Collection (Worlds Beyond) — https://shadowverse-wb.com/en/system/cardbattle/card/

**Wiki:**
- Shadowverse Wiki — https://shadowverse.fandom.com/wiki/Shadowverse
- Card — https://shadowverse.fandom.com/wiki/Card
- Leader — https://shadowverse.fandom.com/wiki/Leader
- Class — https://shadowverse.fandom.com/wiki/Class
- Evolve — https://shadowverse.fandom.com/wiki/Evolve
- Amulet — https://shadowverse.fandom.com/wiki/Amulet
- Necromancy — https://shadowverse.fandom.com/wiki/Necromancy
- Shadowcraft — https://shadowverse.fandom.com/wiki/Shadowcraft
- Glossary — https://shadowverse.fandom.com/wiki/Glossary
- Ranked Match — https://shadowverse.fandom.com/wiki/Ranked_Match
- Wonderland Dreams — https://shadowverse.fandom.com/wiki/Wonderland_Dreams
- Rarity (archive wiki) — https://shadowverse-archive.fandom.com/wiki/Rarity

**Press / reviews:**
- TouchArcade, "'Shadowverse' Is a Cool Looking Story-Based CCG…" (Jun 2016) — https://toucharcade.com/2016/06/21/shadowverse-is-a-cool-looking-story-based-ccg-with-some-clever-twists-to-the-formula/
- PCGamesN, Wonderland Dreams expansion — https://www.pcgamesn.com/shadowverse/shadowverse-wonderland-dreams
- PC Gamer, Wonderland Dreams card preview — https://www.pcgamer.com/weve-got-a-sneak-peak-at-5-new-cards-from-the-next-shadowverse-expansion/
- TechRaptor, Cygames interview on Shadowverse — https://techraptor.net/gaming/interview/updated-cygames-interview-ccg-shadowverse
- KeenGamer review — https://www.keengamer.com/articles/reviews/shadowverse-review/
- MMOHuts review — https://mmohuts.com/review/shadowverse
- Metacritic (aggregate) — https://www.metacritic.com/game/shadowverse/
- Gamepressure, Wonderland Dreams database entry — https://www.gamepressure.com/games/shadowverse-wonderland-dreams/z44d6f

**Community / technical:**
- Steam discussion — card borders & rarity — https://steamcommunity.com/app/453480/discussions/0/152391995404346699/
- Steam discussion — time per turn (90 s) — https://steamcommunity.com/app/453480/discussions/0/152392549359765071/
- Steam discussion — deck size — https://steamcommunity.com/app/453480/discussions/0/1735507984419760702/
- Steam discussion — where to find card packs — https://steamcommunity.com/app/453480/discussions/0/276237094331921012/
- Steam discussion — victory rewards — https://steamcommunity.com/app/453480/discussions/0/1733210552684791833/
- SVGDB (card & full-art asset database) — https://svgdb.me/
- sv-cardgenerator (community card-frame reconstruction — useful frame reference) — https://github.com/zxt/sv-cardgenerator
- Temple of Mick, getting-started guide — http://www.templeofmick.com/?p=4835
- Deck Building Guide (Medium) — https://medium.com/@tomanderson_47035/deck-building-guide-shadowverse-b3bfeae4554c
- YouthfulLaughter, guide to evolution — https://youthfullaughter.wordpress.com/2016/08/12/games-shadowverse-evolving-and-building-your-first-deck/

**Audio:**
- VGMdb — *Shadowverse Original Soundtracks* (CYGM-0017) — https://vgmdb.net/album/68829
- Khinsider — Shadowverse Original Soundtracks (2017) — https://downloads.khinsider.com/game-soundtracks/album/shadowverse-original-soundtracks

**Reference / background:**
- Wikipedia, Shadowverse — https://en.wikipedia.org/wiki/Shadowverse
- Google Play listing — https://play.google.com/store/apps/details?id=com.cygames.Shadowverse
- App Store listing (Shadowverse CCG) — https://apps.apple.com/us/app/-/id1091512762
- TV Tropes, Shadowverse — https://tvtropes.org/pmwiki/pmwiki.php/VideoGame/Shadowverse

---

## 10. Build-order recommendation

If you are standing this up in Three.js, the order that gets you to "that's Shadowverse" fastest:

1. **Camera + field plane + vignette + bloom.** The 37° pitched perspective plane with gold inlay on near-black, plus a heavy vignette, is 40 % of the identity before a single card exists.
2. **The card frame system** — three top silhouettes, class tint wash, cost orb, atk/def plates, name band over the art. Get the *proportions* right; the ornament can be placeholder.
3. **The hand fan with hover-lift and drag** — arc math, lag-follow, velocity tilt, return-to-hand with `easeOutBack`.
4. **PP orbs.** The drain/refill sequencing is disproportionately satisfying and cheap.
5. **Attack with hit-stop + shake + damage floater.** The single highest game-feel-per-hour item in the list.
6. **Turn banner.** Establishes the rhythm of the match.
7. **Summon with ground rune + burst.**
8. **Evolution.** Do it last and do it properly — it is the payoff the entire palette and camera exist for.
