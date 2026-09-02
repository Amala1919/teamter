# Rules as implemented

The authority for this project is `docs/research/RULES_RESEARCH.md`, which
compiles the original Shadowverse ruleset (Basic/Standard through *Wonderland
Dreams*, June 2017) with sources and explicit uncertainty markers. This file
records what the engine in `src/engine/` actually does, and where it knowingly
diverges.

Rule references like **[R-12]** point at the research document.

## Match setup

| Rule | Value | Where |
|---|---|---|
| Deck size | exactly 40 | `RULES.DECK_SIZE` |
| Copies of a card | at most 3 | `validateDeck` |
| Deck classes | one craft class + Neutral | `validateDeck` |
| Classes | 7 crafts + Neutral (**no Portalcraft** — added Dec 2017) | `CRAFT_CLASSES` |
| Leader defense | 20, max 20 | `RULES.LEADER_DEFENSE` |
| Opening hand | **3 for both players** | `Game` constructor |
| Mulligan | one simultaneous redraw; rejected cards go back and the deck is shuffled **before** replacements are drawn | `Game.mulligan` |
| Second player's first turn | draws **2** cards | `beginTurn` |
| Evolution points | first player 2, second player 3 | `RULES.EP_FIRST` / `EP_SECOND` |
| Evolution unlocks | first player turn 5, second player turn 4 | `evolveTurnFor` |

> The mulligan shuffle-back order is **[R-10]/⚠️** in the research: sources do
> not settle whether a rejected card can come straight back. This engine draws
> replacements *first*, then returns the rejects and shuffles, so a rejected
> card cannot be handed straight back on the same mulligan.

## Turn structure

`Game.beginTurn` runs, in order:

1. Clear attack counts and the "evolved this turn" flag; reset the per-turn
   cards-played counter.
2. **Play points**: gain one orb (cap 10) and refill to maximum.
3. **Evolution points**, if this is the turn they unlock.
4. **Start-of-turn abilities** — turn player's board in play order, then the
   opponent's `enemyTurnEnd` abilities.
5. **Countdown decrement** on the turn player's amulets; any reaching 0 is
   destroyed and its Last Words resolve.
6. **Draw** — last, per **[R-18]**, so a Last Words draw resolves before it.

End of turn runs `turnEnd` abilities, then expires until-end-of-turn buffs,
temporary keywords and Ambush, then passes.

> **[R-18]** matters: a Countdown amulet whose Last Words draws a card resolves
> before the turn draw, so deck-out ordering is observable.

## Play points

Start at 0/0. One orb per turn to a maximum of 10; refilled every turn. Cost
modifications floor at 0. `Game.costOf` applies, in order: the printed cost,
per-entity `costMod`, Spellboost reduction, then cost-reducing auras.

## Evolution

- Costs 1 EP; one evolution per turn.
- Uses the card's **printed** evolved stats, not a blanket +2/+2. Followers
  with an `Evolve:` ability usually gain only +1/+1, and a handful are bespoke
  (Lucifer +3/+1, Zirnitra +0/+0). The values come from the official card data.
- Evolving lets a follower attack **enemy followers** immediately, but never
  the enemy leader on the same turn unless it also has Storm.
- Evolve abilities fire on evolution. Amulets and spells cannot evolve.
- Effects that evolve a follower for free (`evolveTarget`) cost no EP and do
  not consume the once-per-turn evolution.

## Attacking and combat

- A follower cannot attack the turn it is played unless it has **Storm** (may
  attack anything) or **Rush** (followers only), or it evolved this turn
  (followers only).
- **Ward** on any enemy follower forces attacks into a Ward follower — the
  leader and non-Ward followers cannot be attacked. **Ignore Ward** bypasses
  this.
- **Ambush** hides a follower from attacks and from enemy targeting until it
  attacks or its controller's turn ends.
- Combat damage is **simultaneous** (**[R-72]**). A defender reduced to 0
  defense still deals its damage back.
- **Bane** destroys any follower it damages in combat, after damage is
  exchanged, and can itself die in the same exchange.
- **Drain** heals the attacker's leader for damage dealt — **only while
  attacking** (**[R-63]**). A Drain follower that is attacked and strikes back
  does not heal.
- Order per attack: `strike` → `clash` (attacker, then defender) → simultaneous
  damage → Drain → Bane → destruction check → Last Words.

## Zones and limits

| Limit | Value | Behaviour |
|---|---|---|
| Board | 5 per player, followers and amulets share the slots | further plays are illegal; effect summons silently fizzle |
| Hand | 9 | a card that would enter a full hand is **burned** (destroyed) |
| Deck | 40 | attempting to draw from an empty deck **loses immediately** — no fatigue damage (**[R-85]**) |

## Destruction, banish, transform

- **Destroy** and lethal damage both fire Last Words and grant the owner a
  shadow (followers only).
- **Banish** removes a card without firing Last Words and without granting a
  shadow.
- **Transform** replaces the card entirely: buffs, damage and evolution are all
  discarded, and the new card takes the same slot.
- **Returning to hand** resets every board-acquired modifier.

Simultaneous deaths are batched: everything is removed from the field first,
then Last Words resolve, turn player's board leftmost-first, then the
opponent's. A Last Words that counts followers therefore sees the post-death
board.

## Class mechanics

| Mechanic | Class | Implementation |
|---|---|---|
| **Vengeance** | Bloodcraft | active at leader defense ≤ 10 |
| **Overflow** | Dragoncraft | active at 7 or more maximum play points |
| **Necromancy (N)** | Shadowcraft | spends N shadows if available |
| **Spellboost** | Runecraft | every card in hand accrues a counter per spell played; only cards that print Spellboost read it |
| **Earth Rite** | Runecraft | destroys one allied Earth Sigil amulet (leftmost first) |
| **Resonance** | Runecraft | deck contains an even number of cards |
| **Enhance (N)** | from *Rise of Bahamut* | alternative printed cost that replaces the Fanfare |

> **Enhance is era-correct.** It was introduced by *Rise of Bahamut* (the third
> pack, Dec 2016), not after Wonderland Dreams: 0 Darkness Evolved cards use it,
> then 17 RoB, 11 ToG and 3 WD do. *Accelerate* and *Crystallize* genuinely
> post-date the era and appear on no card in scope.

## Win and loss

- Leader defense reaches 0 or less → that player loses.
- A draw attempted from an empty deck → that player loses immediately.
- Both leaders dying at once → draw.
- A card that says so ends the match outright — Seraph Lapis, Glory Be's
  "Last Words: Win the match" is the only one in this card pool.

### Damage ceilings

A few cards cap a *single instance* of damage rather than reducing it: "Can't
take more than 3 damage at a time". That is not the same as a flat reduction —
at 9 incoming damage a cap of 3 takes 3 and a reduction of 3 takes 6 — and the
engine models them separately (`damageCap` and `damageReduce`). A ceiling can
apply to a follower, to the leader, or to both.

## Known divergences

| Divergence | Why |
|---|---|
| No turn timer | The original gives 90 seconds a turn. Single-player against an AI has no reason to rush the player. |
| Mulligan shuffle order | See **[R-10]** above — genuinely ambiguous in the sources. |
| Buff expiry vs end-of-turn triggers | Triggers resolve first, then buffs expire (**[R-207]/⚠️**, unverified in the sources). |
| Card text is modern wording | The card database mirrors the official Portal API as it stands today, so a small number of cards carry post-era rebalances and retroactively renamed keywords (`Overflow` for "if you have at least 7 play points", `Earth Rite` for "destroy an Earth Sigil"). Semantics are unchanged. |
| 185 of 888 cards partly implemented | Their unparsed lines are listed by `npm run cards:report -- --lines`; they carry `implemented: false` and are excluded from generated decks. |
