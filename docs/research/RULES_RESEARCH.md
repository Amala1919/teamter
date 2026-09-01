# Shadowverse (Cygames, 2016) — Rules Research & Implementation Specification

**Target era:** Original *Shadowverse* digital CCG, from the Basic/Standard set (JP 2016-06, global 2016-10) through the 5th expansion **Wonderland Dreams (WLD)**, released **June 2017**.

**Explicitly NOT in scope:**
- *Shadowverse: Worlds Beyond* (2025 sequel) — different setup numbers, different keywords.
- *Shadowverse: Evolve* (physical TCG, 2022) — different deck sizes, different evolve economy, different simultaneous-loss rule.
- Any original-Shadowverse mechanic introduced after WLD (Starforged Legends 2017-09 and later). These are catalogued in §17 as **out-of-era** so an implementer does not accidentally build them.

**Document status:** compiled from the Shadowverse Wiki (Fandom), Cygames' official play guide, XSEED's *Champion's Battle* official rules pages (a faithful port of the original digital ruleset), and Japanese community rules references (GameWith rules/effect-processing articles and Q&A, おんJシャドバ部 wiki). Where the sources conflict or are silent, the point is flagged.

---

## 0. Conventions used in this document

| Marker | Meaning |
|---|---|
| **[R-n]** | A numbered normative rule intended to be implemented literally. |
| `> ⚠️ UNVERIFIED:` | I could not confirm this from a reliable era-appropriate source. My best belief and the reason are stated. Do not treat as settled. |
| `> ⏳ ERA:` | A note about when a mechanic entered or left the game, relevant to the WLD cutoff. |

Terminology note: this document uses the **English** client's terms (Fanfare, Last Words, Ward, Storm, …) with the Japanese original in parentheses, because the JP terms are what most rules-detail sources use.

Two spelling conventions matter for a rules engine:
- **"Defense"** is Shadowverse's word for HP/life/toughness. Both leaders and followers have *defense*. There is no separate "health" stat.
- A follower's printed stat line is written **attack/defense** (e.g. `2/2`).

---

## 1. Match setup and deck construction

### 1.1 Deck construction

| Rule | Value |
|---|---|
| Deck size | Exactly **40** cards |
| Copy limit | **3** copies of any single card |
| Class restriction | All cards must be of **one chosen class** or **Neutral** |
| Tokens in deck | **Not allowed** — token cards are only created during a match |

**[R-1]** A legal deck contains exactly 40 cards. There is no minimum/maximum range in the original digital game; it is a fixed 40. (The 40–50 range that appears in search results belongs to *Shadowverse: Evolve*, the physical TCG — do not use it.)

**[R-2]** A deck may contain at most 3 copies of any given card, counted by card identity (not by rarity or by art variant).

**[R-3]** A deck is built around exactly one class. Cards of that class plus Neutral cards are legal; cards of any other class are not.

**[R-4]** There is **no separate "evolve deck"** in the original digital game. (The 10-card evolve deck is a *Shadowverse: Evolve* TCG construct.) Evolved forms are attached to the follower card itself and are not drawn.

### 1.2 The classes

**[R-5]** During the Basic→WLD era there are **seven** playable classes plus Neutral:

| # | Class (EN) | Class (JP) | Signature era mechanics |
|---|---|---|---|
| 1 | Forestcraft | エルフ (Elf) | Fairy / Fairy Wisp tokens, "play 2+ cards this turn" conditions, wide boards, bounce |
| 2 | Swordcraft | ロイヤル (Royal) | Officer / Commander traits, follower-centric tempo, cheap wide boards |
| 3 | Runecraft | ウィッチ (Witch) | **Spellboost** (スペルブースト), **Earth Rite** (土の秘術) / Earth Sigil amulets, direct damage |
| 4 | Dragoncraft | ドラゴン (Dragon) | PP ramp (empty play point orbs), **Overflow** (覚醒) at 7+ max PP |
| 5 | Shadowcraft | ネクロマンサー (Necromancer) | **Necromancy** (ネクロマンス) spending **shadows** (墓場) |
| 6 | Bloodcraft | ヴァンパイア (Vampire) | Self-damage, **Vengeance** (復讐) at ≤10 leader defense, **Drain** |
| 7 | Havencraft | ビショップ (Bishop) | **Countdown** amulets, healing, banish removal |
| — | Neutral | ニュートラル | Playable in any deck |

**[R-6] CONFIRMED: Portalcraft did NOT exist during this era.** Portalcraft (ネメシス / Nemesis) — together with the Artifact trait and the Resonance keyword — was introduced in **Chronogenesis**, the **7th** card set, released **December 2017**, i.e. two full expansions after WLD. A WLD-era engine must have exactly 7 classes + Neutral.

### 1.3 Leaders and starting state

| Rule | Value |
|---|---|
| Leader starting defense | **20** |
| Leader maximum defense | **20** (see §14.3) |
| Leader attack | None — leaders never attack |
| Starting hand (both players) | **3** cards |
| First player draw on their turn 1 | **1** card |
| Second player draw on their turn 1 | **2** cards |
| Evolution points, first player | **2** |
| Evolution points, second player | **3** |

**[R-7]** Each player's leader begins the match with **20 defense**. Reducing the enemy leader's defense to **0 or less** wins the game.

**[R-8]** Turn order is decided **randomly** at the start of the match. Neither player chooses.

### 1.4 Mulligan / Redraw

**[R-9]** After turn order is decided, **both players draw an opening hand of 3 cards**, simultaneously and secretly, then each may select any subset of those 3 cards to replace.

**[R-10]** Redraw is a **single, simultaneous, one-shot** step. There is no second mulligan and no card-count penalty (unlike Magic's "mulligan to 6"). The player always ends the redraw with exactly 3 cards.

**[R-11]** Both players redraw at the same time, before the first turn begins. Neither player sees the other's hand or choices.

> ⚠️ **UNVERIFIED — mulligan shuffle-back timing.** The wiki and official guides say only "choose any unwanted cards and replace them with other random cards from the deck." My strong belief, from long-standing community consensus and from the way the original client animates the redraw, is that the rejected cards are **returned to the deck and the deck is shuffled *before* the replacement cards are drawn**, meaning **you can draw the same card back**. I could not find an explicit primary source stating this. If your engine must pick one, implement: (a) remove the kept cards from consideration; (b) put the rejected cards back into the deck; (c) shuffle; (d) draw the same number of replacements. Note that the opposite convention (draw replacements first, then shuffle rejects back) is what Hearthstone does, and the wiki does describe Shadowverse's redraw as "basically the same as Hearthstone" — so this is genuinely ambiguous and should be treated as a configurable flag.

### 1.5 Second-player compensation ("the going-second package")

**[R-12]** The player going second receives three compensating advantages, all of which must be implemented:

1. **An extra card**: on the second player's *first* turn they draw **2** cards instead of 1 (opening hand 3 + 2 = 5 cards in hand at the start of their turn 1, versus the first player's 3 + 1 = 4).
2. **An extra evolution point**: 3 EP instead of 2.
3. **Earlier evolution access**: they may evolve from their **4th** turn, versus the first player's **5th**.

**[R-13]** Both players draw on their own first turn. The first player is **not** skipped. (This differs from *Shadowverse: Evolve*, where the first player skips their turn-1 draw.)

> ⚠️ **UNVERIFIED — exact form of the second player's extra card.** All sources I could reach describe it as "the player going second draws 2 cards on the first turn" (official *Champion's Battle* guide; Shadowverse Wiki). This is consistent with "one extra card folded into the normal turn-1 draw," which is how I would implement it. I found no era source describing it as a separate pre-game extra card or as a distinct "compensation card" object, so implement it as: *second player's turn-1 start-of-turn draw = 2*.

---

## 2. Game state model (recommended object model)

Per player:

| Field | Notes |
|---|---|
| `leader.defense` | current, starts 20 |
| `leader.maxDefense` | starts 20; can be *lowered* by effects; nothing in the era raises it (§14.3) |
| `deck` | ordered list, starts 40 |
| `hand` | max 9 (§7.2) |
| `field` | **5 shared slots** for followers *and* amulets (§7.1); ordered by play order |
| `shadows` | integer count (Shadowcraft resource, but every class accumulates them) |
| `playPoints.current` | spendable this turn |
| `playPoints.max` | orb count, cap 10 |
| `evolutionPoints` | 0 until granted; 2 (first) or 3 (second) |
| `hasEvolvedThisTurn` | bool, reset each of the player's turns |

Per follower on the field:

| Field | Notes |
|---|---|
| `attack`, `defense`, `maxDefense` | damage = `maxDefense - defense`, and it **persists across turns** |
| `isEvolved` | bool |
| `canAttackTarget` | derived: none / followers-only / followers+leader |
| `attacksMadeThisTurn` | normally capped at 1 |
| `enteredPlayOnTurn` | for summoning sickness |
| `keywords` | Ward, Storm, Rush, Bane, Drain, Ambush, … |
| `playOrderIndex` | monotonically increasing; drives simultaneous-resolution order (§13.2) |

Amulets have `countdown` (nullable — `null` means a permanent amulet) and no attack/defense.

---

## 3. Turn structure

### 3.1 Phase list

**[R-14]** A turn consists of three phases, in this order:

1. **Start of turn** (automatic, no player input)
2. **Main phase** (player acts freely)
3. **End of turn** (automatic, triggered by the player passing or by the turn timer)

**[R-15]** Turns strictly alternate. There are no interrupts, instants, or responses on the opponent's turn: **the non-turn player takes no actions whatsoever during the turn player's turn.** Every "opponent-side" effect in Shadowverse is a passive/triggered ability resolved automatically by the engine.

**[R-16]** "Turn N" is **per-player**. The first player's turns are their turns 1, 2, 3, …; the second player's turns are likewise numbered from 1. A player's turn number equals their maximum play points until the 10 PP cap is reached. This is why "evolve from turn 5 (first) / turn 4 (second)" lines up with 5 PP / 4 PP.

### 3.2 Start-of-turn sequence — exact order

**[R-17]** The recommended implementation order (see the flag below for the one genuinely contested step):

| Step | Action |
|---|---|
| **S1** | Turn begins; the turn player becomes the active player. |
| **S2** | **Play points**: `max = min(max + 1, 10)`; then `current = max`. (Both increment and refill happen here; unspent PP from last turn does not carry.) |
| **S3** | **Evolution unlock / EP grant**: on the first player's 5th turn, grant 2 EP and enable evolution; on the second player's 4th turn, grant 3 EP and enable evolution. Grant happens once, in full. |
| **S4** | **Reset per-turn flags**: `attacksMadeThisTurn = 0` for all the turn player's followers; `hasEvolvedThisTurn = false`; every follower that was already on the field at the start of this turn loses summoning sickness. |
| **S5** | **"At the start of your turn" triggered abilities** on the turn player's cards in play, resolved in play order (oldest first). |
| **S6** | **Countdown decrement**: every Countdown amulet the turn player controls has its Countdown reduced by 1. Any amulet reaching 0 is destroyed and its Last Words resolve. Multiple such amulets resolve in board/play order, left to right. |
| **S7** | **Draw**: the turn player draws 1 card (2 on the second player's first turn). |
| **S8** | Main phase begins. |

**[R-18]** The **draw is last**. Both Japanese rules references agree on this, and it matters: Last Words on a Countdown amulet that says "draw a card" resolves *before* your normal draw, so the drawn cards arrive in that order, and a deck-out caused by a Last Words draw kills you before the turn draw is attempted.

> ⚠️ **UNVERIFIED — S5 vs S6 ordering (start-of-turn abilities vs Countdown decrement).** Sources conflict:
> - **GameWith's "効果処理について学ぼう（基礎編）"** (the main Japanese rules explainer for the original game) gives the order as **① start-of-turn effects → ② amulet Countdowns → ③ draw 1**. This is the order encoded above and is my primary recommendation because it is an original-game source.
> - A Worlds-Beyond-era ordering reference gives **① Countdown advances by 1 → ② leader-attached "at start of your turn" effects (crests, in play order) → ③ board cards' start-of-turn effects, *left/oldest first*, with the Last Words of amulets broken by the Countdown firing at this same timing → ④ draw**.
>
> Notice the second model is not really contradictory: the *numeric decrement* happens first, but the *Last Words that result from a Countdown hitting 0* are interleaved with the other start-of-turn abilities in board order. That interleaved model is probably closest to the real engine, and it is the one I would build if you need maximum fidelity:
> **S5′** decrement all Countdowns numerically → **S6′** walk the turn player's field in play order and, for each card, resolve either its "at the start of your turn" ability or (if its Countdown just hit 0) its destruction + Last Words → **S7** draw.
> Either model is indistinguishable in the overwhelming majority of board states; they only diverge when an amulet's start-of-turn ability interacts with another amulet that breaks the same turn.

> ⚠️ **UNVERIFIED — whether the *opponent's* "at the start of your opponent's turn" effects resolve inside S5.** The おんJシャドバ部 turn-order page describes an interleaving where the turn player's start-of-turn leader effects resolve first, then the *non*-turn player's "at the start of the enemy turn" leader effects, then further card effects, and then the turn player's draw. Implement it as: **turn player's triggers first (play order), then non-turn player's triggers (play order), then draw** — this is consistent with the universal turn-player-priority rule in §13.2. Very few WLD-era cards trigger on the opponent's turn start, so the practical risk is low.

### 3.3 Main phase

**[R-19]** During the main phase the turn player may, in **any order and any number of times** subject to resources:
- play a card from hand by paying its play-point cost;
- evolve one follower (once per turn, if EP and evolution access are available);
- attack with any eligible follower (each follower normally once per turn);
- pass the turn.

**[R-20]** There is no "attack phase". Playing cards and attacking are freely interleaved. (Official guide: "You are free to play cards and attack in any order you wish.")

**[R-21]** Each action is fully resolved — including all triggered abilities and all state-based destruction — before the player may take the next action. There is no stack that the opponent can respond to.

### 3.4 End of turn

**[R-22]** End-of-turn sequence:

| Step | Action |
|---|---|
| **E1** | Turn player declares end of turn (or the 90-second turn timer expires and it is declared automatically). |
| **E2** | Turn player's "at the end of your turn" triggered abilities resolve, in play order. |
| **E3** | Non-turn player's "at the end of the enemy turn" triggered abilities resolve, in play order. |
| **E4** | "Until the end of the turn" continuous effects expire (temporary buffs/debuffs, temporary keyword grants, temporary cost changes). |
| **E5** | Turn passes to the other player. |

**[R-23]** Turn timer: each turn automatically ends after **90 seconds** in the original client. A rules engine may treat this as an optional/UI concern, but if you model a timeout, it must produce exactly the same result as a voluntary pass (E1 → E5).

> ⚠️ **UNVERIFIED — E4 vs E2/E3 ordering.** I could not find a source that pins down whether "until end of turn" buffs wear off before or after end-of-turn triggered abilities. My belief is that **triggers resolve first and expiry happens after** (so an "at the end of your turn, deal damage equal to this follower's attack" ability sees the buffed attack value), because that is the intuitive read of the animations and the only ordering that makes buff-then-endstep cards behave as players expect. Flag it and make it configurable.

> ⚠️ **UNVERIFIED — is there a maximum turn count / draw-by-timeout?** I found no evidence of a turn cap in the original game. The intended clock is deck-out (§11.3). I believe there is no turn limit; if one exists it is high enough never to be reached in practice.

---

## 4. Play Points (PP)

### 4.1 Core numbers

| Rule | Value |
|---|---|
| Starting max PP (both players) | **0** before the first turn; **1** after their first start-of-turn increment |
| PP gained per turn | **+1** to max |
| Max PP cap | **10** |
| Refill | Full — `current = max` every start of turn |
| Carryover | **None** — unspent PP is lost at end of turn |
| Minimum card cost after reduction | **0** |

**[R-24]** At the start of a player's turn: `maxPP = min(maxPP + 1, 10)`, then `currentPP = maxPP`. Both players are on the same PP curve; going second confers **no** PP advantage. On each player's turn 1 they have 1 PP; on turn 10 and every turn after, 10 PP.

**[R-25]** Playing a card costs its **current cost** in play points, deducted from `currentPP`. A card may only be played if `currentPP >= cost`.

**[R-26]** Evolving costs **0 play points**. It costs 1 evolution point (§5). PP and EP are entirely separate currencies in the original game.

### 4.2 Empty play point orbs (ramp)

**[R-27]** Some cards (Dragoncraft, chiefly) "**gain an empty play point orb**". This increases `maxPP` by 1 **without** filling it — `currentPP` is unchanged. The orb becomes usable from the next start-of-turn refill.

**[R-28]** The 10-orb cap applies to ramp as well: an effect that would raise `maxPP` above 10 does nothing (the excess is wasted). Effects worded "gain X play points" (as opposed to orbs) that add to `currentPP` are likewise capped at `maxPP`.

> ⚠️ **UNVERIFIED — whether `currentPP` can ever exceed `maxPP`.** I believe it cannot, and that "restore N play points"-style effects clamp at `maxPP`. I found a Steam thread titled "How to gain 11 play point orbs" but could not read it, which suggests there may be an edge case (possibly a later-era card or a bug). For the WLD era, clamp both `currentPP` and `maxPP` at 10.

### 4.3 Cost modification

**[R-29]** Cost reduction/increase is applied to the card's cost wherever it lives (hand, and for some effects, deck). **The floor is 0** — no card ever has a negative cost, and reductions past 0 are simply lost. This is confirmed for the original game (「コストは0以下には下がらない」).

**[R-30]** Cost modifications come in two persistence classes and the engine must distinguish them:
- **Permanent / accumulating** — e.g. Spellboost cost reductions, and one-off "reduce the cost of a card in your hand by X" effects. These stick to the card object and survive across turns, and survive the card being shuffled back or bounced **only if the source says so** (default: a card returned to the deck loses hand-applied modifications).
- **This turn only** — effects that lower costs "during this turn" expire at E4.

**[R-31]** Cost is evaluated at the moment of play. A card whose cost was reduced while in hand is played at the reduced cost.

> ⚠️ **UNVERIFIED — whether a Spellboosted card that leaves hand and returns keeps its Spellboost count.** My belief: Spellboost counters are tracked on the card instance in hand; returning a card to the deck resets it, but bouncing/copying behaviour varies per card. Treat per-card.

---

## 5. Evolution

### 5.1 The evolution economy

| Rule | First player | Second player |
|---|---|---|
| Evolution points granted | **2** | **3** |
| Granted at the start of | their **5th** turn | their **4th** turn |
| Evolutions allowed per turn (via EP) | **1** | **1** |
| PP cost to evolve | **0** | **0** |

**[R-32]** Evolution points are granted **all at once** at the start of the unlocking turn (2 or 3 respectively), not one per turn. They form a pool that is spent 1 per evolution.

**[R-33]** A player may spend **at most 1 evolution point per turn**, i.e. at most one EP-driven evolution per turn, regardless of how many EP remain.

**[R-34]** Unspent evolution points **carry over indefinitely**. They have no other use and do not decay.

**[R-35]** Evolution may only be performed **on your own turn, during your main phase**, on a follower **you control**.

**[R-36]** Card effects that evolve a follower ("**Evolve this follower**", "evolve an allied follower") do **not** consume an evolution point and do **not** count against the once-per-turn limit. They are commonly called "free evolves" (無料進化) and can be used before evolution is otherwise unlocked.

> ⚠️ **UNVERIFIED — whether free evolves are truly unrestricted before turn 4/5.** The wiki states "Followers can be evolved once per turn through the use of Evolution Points **or any number of times with card effects**," which supports this. I could not find an era source explicitly confirming a card-effect evolve works on, say, turn 2. My belief is yes, it does.

### 5.2 What evolving does

**[R-37]** Evolving a follower:
1. Replaces its unevolved form with its **evolved form**, whose stat line is printed on the card. **The standard increase is +2/+2**, and the overwhelming majority of era followers follow it. A minority have non-standard evolved stats (e.g. +1/+1, +3/+3, or a stat line with a different shape) — always read the printed evolved stats; do not hardcode +2/+2. (The always-+2/+2 rule belongs to *Worlds Beyond*.)
2. Applies the increase to **both `maxDefense` and current `defense`** by the same amount. **Existing damage is preserved.** A `2/2` that has taken 1 damage (currently 2 attack / 1 defense of 2) becomes, on a +2/+2 evolve, `4 attack / 3 defense of 4`.
3. Grants the follower's **evolved-form keyword abilities** (which may add, replace, or differ from the unevolved form's).
4. Triggers its **On Evolve / Evolve (進化時)** abilities, if any.
5. Grants the follower a **Rush-like attack permission for this turn** — see [R-38].

**[R-38] CRITICAL — evolving and summoning sickness.** A follower that evolves **may attack enemy followers this turn even if it was played this turn**, but **may NOT attack the enemy leader** that turn. This is exactly Rush, not Storm. Verified: *"If a follower evolves the same turn it comes into play, it may attack enemy followers (but not the enemy leader until the following turn) as though it had the Rush keyword."* Beware the official play guide's loose phrasing ("if a follower is played and evolved on the same turn, it gets to attack that turn, too!") — it omits the leader restriction, which is real.

**[R-39]** If the follower has **Storm**, evolving it changes nothing about targeting: it could already attack the leader. If the follower had been on the field since a previous turn, evolving likewise changes nothing about targeting: it could already attack the leader.

**[R-40]** Evolving does **not** refresh a follower's attack for the turn. A follower that has already attacked this turn and then evolves does **not** get a second attack.

> ⚠️ **UNVERIFIED — [R-40].** I could not find a source stating this in so many words, but it follows directly from the fact that evolution grants a Rush-like *permission*, not an extra attack, and from universal community practice (evolving after attacking is a standard "value" play used only for the +2/+2 and the On Evolve trigger). Implement as stated; if a WLD-era card explicitly grants an extra attack, it says so on the card.

**[R-41]** Evolving is available only to **followers**. **Spells and amulets cannot evolve** — spells never touch the field, and amulets have no evolved form.

**[R-42]** Evolution has no effect on **Ward**: an evolved follower keeps Ward if it has it, gains Ward if its evolved form grants it, and loses Ward if (rarely) its evolved form does not have it. There is no rule that evolving grants or removes Ward. Attacking restrictions imposed on the *attacker* by enemy Ward apply to evolved followers exactly as to any other (§6.4).

**[R-43]** The evolved follower is the **same permanent**: it keeps its damage, its accumulated buffs and debuffs, its "attacked this turn" flag, its Ambush state, and any granted keywords.

### 5.3 Evolution internal processing order

**[R-44]** Per the Japanese community spec, evolution processes in this order:
1. The evolution is declared and paid for (EP spent, once-per-turn flag set).
2. A follower with the **evolved stat line but no abilities** ("vanilla") is put onto the field on top of the unevolved card.
3. The abilities printed on the **evolved form** are granted.
4. The abilities the follower had **before** evolving are inherited/re-applied.
5. **On Evolve (進化時)** abilities trigger and resolve.

This order matters for edge cases where an ability was granted to the unevolved body by an outside effect: it survives, because step 4 re-applies it after the evolved body exists.

> ⚠️ **UNVERIFIED — exact position of the On Evolve trigger relative to steps 3–4.** The source describes steps 1–4; I have placed the On Evolve trigger after ability inheritance, which is the only ordering that lets an On Evolve ability see the follower's full final ability set. Low confidence on the precise interleaving, high confidence that On Evolve resolves after the evolved body is fully on the field.

**[R-45]** "**While evolved**" conditional abilities read `isEvolved == true`. A follower that gains evolved status by any means (EP, card effect) satisfies them; there is no distinction in the era between "evolved by EP" and "evolved by effect" for the purpose of these conditions.

---

## 6. Attacking

### 6.1 Attack eligibility

**[R-46]** A follower may attack if **all** of the following hold:
- it is controlled by the turn player;
- it has not already attacked this turn (`attacksMadeThisTurn == 0`);
- it is not summoning-sick, **or** it has Storm, **or** it has Rush (followers only), **or** it evolved this turn (followers only);
- a legal target exists (§6.4).

**[R-47] Summoning sickness.** "Followers can't attack on the turn they are played unless they have the ability Rush or Storm." A follower is summoning-sick from the moment it enters the field until the start of its controller's next turn (step S4). This applies to followers put into play by **any** means — played from hand, summoned by an effect, resurrected, transformed into, or returned from hand.

**[R-48]** **Amulets can never attack and can never be attacked.** They are inert targets on the board that occupy a slot; they are removed only by Countdown, by Last Words self-destruction, or by card effects.

**[R-49]** Leaders never attack.

**[R-50]** A follower attacks **once per turn** by default. Effects granting extra attacks exist but must say so.

### 6.2 Storm (疾走)

**[R-51]** **Storm**: the follower may attack **enemy followers and the enemy leader** on the turn it comes into play. It fully bypasses summoning sickness.

> ⏳ **ERA:** Storm is a Basic-set evergreen keyword. Present throughout the era.

### 6.3 Rush (突進) — era question, answered

**[R-52]** **Rush**: the follower may attack **enemy followers only** on the turn it comes into play. It may **not** attack the enemy leader that turn. From its controller's next turn onward it behaves normally (and may attack the leader).

> ⏳ **ERA — Rush DID exist during the WLD era.** The Shadowverse Wiki states Rush is an evergreen keyword **introduced in Darkness Evolved**, the **2nd** card set (September 2016 JP), i.e. three sets before Wonderland Dreams. A WLD-era engine must implement Rush.
>
> ⚠️ **UNVERIFIED — retroactive keywording.** I could not find patch notes confirming whether some Basic-set followers originally printed the ability as full text ("This follower can attack enemy followers on the turn it comes into play") and were later re-templated to the Rush keyword. Because the *semantics* are identical either way, this does not affect a rules engine; it only affects how you render card text for Basic-set cards. If you are reproducing exact 2017 card text, verify per card.

**[R-53]** Rush and Storm are not cumulative in any meaningful way; Storm strictly supersedes Rush. A follower with both behaves as Storm.

### 6.4 Ward (守護) and target legality

**[R-54]** **Ward**: *"When your opponent has a follower with Ward in play, you can't attack any other enemies until you have destroyed it."*

Formally, for the turn player choosing an attack target:
- Let `W` = the set of enemy followers with Ward that **can legally be attacked** (i.e. not in Ambush, not otherwise unattackable).
- If `W` is non-empty, the only legal attack targets are the members of `W`.
- If `W` is empty, legal targets are all attackable enemy followers plus the enemy leader (subject to Rush/summoning-sickness restrictions).

**[R-55]** Ward restricts **attacks only**. **Spells and card effects always ignore Ward** — a damage spell, a destroy effect, or a targeted debuff may hit any enemy follower, Ward or not, and may hit the enemy leader while an enemy Ward is in play.

**[R-56] Ward + Ambush interaction (important edge case).** If the only enemy Ward follower also has **Ambush** (or any other "cannot be attacked" property), **the Ward is effectively negated**: because that follower cannot be attacked, it does not enter set `W`, and the attacker may attack other followers or the leader freely.

**[R-57]** Ward on an **amulet** does not exist in this era in the sense of an attackable body; amulets cannot be attacked and therefore cannot present a Ward wall.

> ⚠️ **UNVERIFIED — [R-57].** I did not find an era amulet with Ward. Amulets being unattackable makes Ward meaningless on them, so I believe none exist. If your card data includes one, treat the Ward as inert.

### 6.5 Bane (必殺)

**[R-58]** **Bane**: *"Automatically destroy any other followers that this follower attacks. Followers that attack them are automatically destroyed."*

Formally: in a **follower-vs-follower battle** involving a Bane follower, the *other* follower is destroyed at the destruction check (combat step ⑦, §6.8) **regardless of how much damage it took**, including 0 damage.

**[R-59]** Bane applies **symmetrically to attacking and being attacked** — a Bane follower that is attacked destroys its attacker.

**[R-60]** Bane is a **combat-only** property. It does **not** apply to damage dealt by abilities or spells, and it has **no effect on leaders** (a Bane follower attacking the enemy leader just deals its attack as damage).

**[R-61]** Bane's destruction happens **after** damage is exchanged. The Bane follower still takes the defender's attack as damage, and can itself die in the same exchange. Both followers dying simultaneously is normal and both sets of Last Words fire (§13.2 governs order).

### 6.6 Drain (ドレイン)

**[R-62]** **Drain**: when a follower with Drain deals combat damage **while attacking**, its controller's leader **restores defense equal to the damage dealt**.

**[R-63]** Drain triggers only on **attacking**. A Drain follower that is *attacked* and deals defender's damage back does **not** heal. Confirmed for the original game (「自分が攻撃された場合はドレインは発動しない」).

**[R-64]** Drain applies whether the target is a **follower or the leader**.

**[R-65]** The heal is equal to **damage actually dealt**. If damage is reduced to 0 by any effect, Drain restores 0.

**[R-66] Bane + Drain interaction.** These are independent and both apply. In a Bane+Drain follower's attack on an enemy follower: damage is dealt normally, Drain heals for the damage dealt (step ⑥), and then Bane destroys the defender (step ⑦). Note that **Drain heals for the damage number, not for the defender's remaining defense** — Bane's "overkill" destruction does not increase the Drain heal. A `1/1` Bane+Drain follower attacking a `10/10` heals **1**, and destroys it.

**[R-67]** Drain healing is capped by the leader's maximum defense (§14.3); excess is wasted.

### 6.7 Ambush (潜伏)

**[R-68]** **Ambush**: *"The follower can't be targeted by enemy followers, spells, or effects."* Concretely, while a follower is in Ambush:
- it **cannot be attacked** by enemy followers;
- it **cannot be chosen** as the target of enemy spells or enemy card effects;
- it does **not** count as a Ward wall for the enemy (§6.56);
- it still occupies a board slot, still attacks normally, and is still visible to the opponent (Ambush is not hidden information in Shadowverse).

**[R-69] Losing Ambush.** *"Followers lose Ambush if they deal damage, either by attacking or by an effect."* Implement as: the moment the Ambush follower deals damage to anything (leader or follower), by attack or by its own ability, `hasAmbush` becomes false — permanently, unless re-granted.

**[R-70] Ambush and non-targeting effects.** Ambush protects against **selection**, not against **area damage**. *"Any ability that doesn't target directly can affect a follower with Ambush active"* — so "deal 2 damage to all enemy followers", "destroy all followers", and similar sweep effects **do** hit Ambush followers.

> ⚠️ **UNVERIFIED — Ambush and *random* enemy effects.** Japanese effect-processing sources state that random-selection damage effects can get around "cannot be targeted by the opponent's abilities" protection. My belief is that **random effects (e.g. "deal 1 damage to a random enemy follower") CAN hit an Ambush follower**, because the game treats random selection as non-targeting. This is a meaningful engine decision — flag it and confirm against specific WLD cards (Runecraft's random-damage cards are the obvious test cases) before shipping.

### 6.8 Combat resolution — exact step order

**[R-71]** When a follower attacks an **enemy follower**, resolve in this exact order (this ordering is from the Japanese rules Q&A for the original game and is the single most important sequence in the engine):

| Step | Action |
|---|---|
| ① | **Turn player's "on attack" (攻撃時) effects** on the attacking follower. |
| ② | **Defending player's "when attacked" (攻撃時反応 / on being attacked) effects** on the defending follower. |
| ③ | **Turn player's Clash (交戦時) effects.** |
| ④ | **Defending player's Clash (交戦時) effects.** |
| ⑤ | **Damage exchange — simultaneous.** The attacker deals damage equal to its attack to the defender, and the defender deals damage equal to its attack to the attacker, **at the same time**. Neither is "destroyed first"; a defender reduced to 0 defense still deals its damage back. |
| ⑥ | **Attack-attached effects**: Drain healing, and similar "when this follower deals damage" riders. |
| ⑦ | **Destruction check**: any follower with `defense <= 0`, **or** that was struck by a Bane follower in this battle, is destroyed. |
| ⑧ | Last Words and other destruction triggers from ⑦ resolve, ordered per §13.2. |

**[R-72] Damage is simultaneous — the defender is NOT destroyed before dealing damage.** This is the correct answer to the question posed in the task. A `3/1` attacking a `1/5` results in the `1/5` taking 3 (surviving at 2) and the `3/1` taking 1 (dying). Trading is symmetric.

**[R-73]** When a follower attacks the **enemy leader**:
- Steps ① and ③-equivalents that require a *follower* target do not fire. **Clash (交戦時) effects specifically do NOT activate when attacking the enemy leader.**
- "On attack" style effects that are worded to trigger on any attack **do** fire.
- The leader takes damage equal to the attacker's attack; the leader deals **no damage back**.
- Drain still heals (§6.64).
- Bane is irrelevant.

**[R-74]** A follower's attack value at the moment of step ⑤ is what matters; buffs applied during steps ①–④ (e.g. by a Clash ability) are counted.

**[R-75]** Attacking is not optional-after-declaration: once declared, the sequence resolves fully. There is no "cancel" and no opponent response window.

---

## 7. Board, hand, and deck limits

### 7.1 Board limit — 5 shared slots

**[R-76] CONFIRMED: each player's field has exactly 5 slots, shared between followers and amulets.** *"Amulets occupy one of the 5 spaces in the player's board, just like followers do."* A player with 3 followers and 2 amulets has a full board.

**[R-77]** A card that would occupy a board slot (follower or amulet) **cannot be played from hand** when the controller's field already holds 5 cards. The client greys the card out; the engine must reject the play as illegal (not "play and fizzle").

**[R-78] Board-full during effect resolution — partial resolution / fizzle.** If an effect would summon followers/amulets and the board is full, the summon **fizzles** for as many as do not fit. Effects summoning multiple bodies fill slots until full and the remainder is lost. This is checked **per body, at the moment that body would enter**, not up front — so if an effect summons 2 and destroys 1 in between, the freed slot can be used.

**[R-79]** The rest of the effect still resolves. Board-full does not abort the whole ability; only the summon portion is lost. Example: "Fanfare: Summon two X. Draw a card." with a full board still draws the card.

> ⚠️ **UNVERIFIED — [R-78]/[R-79] granularity.** Japanese sources confirm the general principle ("if the board is full, the follower is not summoned; followers that should appear from subsequent effects overflow off the board") but I could not find a formal statement about per-body checking versus up-front checking. Per-body is what I believe the engine does and is the safer model.

**[R-80] Board ordering.** New cards are appended in **play order**; the oldest card is leftmost. Play order (not visual index) is what drives simultaneous-resolution ordering (§13.2).

> ⚠️ **UNVERIFIED — whether the player chooses a placement slot.** In *Worlds Beyond* the player can choose where to insert a card. For the original game I could not confirm; my belief is that cards append to the right end and cannot be reordered. Because the authoritative Japanese rule for simultaneous resolution is worded as "**the follower played earlier** is processed first" (先に出したフォロワーから), implement resolution ordering by **play order index**, which is correct regardless of how placement works.

### 7.2 Hand limit — 9, with burn

**[R-81]** The hand limit is **9** cards.

**[R-82] Burn.** If a player would draw or otherwise gain a card while holding 9, the card is **destroyed instead of entering the hand**. In the original client this is called "burning" the card. The card is **not** returned to the deck and is **not** put back — it is gone.

**[R-83]** Burn applies to **every** way a card would enter the hand — the turn draw, effect draws, "add a card to your hand", token creation into hand, and bounce (return-to-hand) effects.

> ⚠️ **UNVERIFIED — do burned cards become shadows?** The Shadows rule says a card **discarded** becomes a shadow. Whether an overdraw-burned card counts as "discarded" for shadow purposes I could not confirm. My belief is **yes, a burned card becomes a shadow** for its owner (relevant only to Shadowcraft's Necromancy count). Low confidence; make it a flag.

**[R-84]** Bounce effects that would return a follower to a full hand: my belief is the follower **leaves the field and the card is burned** rather than the bounce failing. Flagged below.

> ⚠️ **UNVERIFIED — [R-84].** No source found. Both behaviours (bounce-then-burn vs. bounce fizzles) are plausible. Bounce-then-burn is my belief because it matches the "burn applies to everything entering hand" rule.

### 7.3 Deck-out

**[R-85] A player who must draw a card from an empty deck immediately LOSES the game.** There is **no fatigue damage** (unlike Hearthstone). The loss is immediate at the moment the draw is attempted, not at end of turn.

**[R-86]** This is checked per individual draw. A "draw 2" with 1 card left draws the 1 card and then loses on the second attempted draw.

**[R-87]** Because the turn draw is the **last** step of the start of turn (§3.2 S7), a Last Words or start-of-turn effect that draws can deck you out before your normal draw is attempted.

**[R-88]** Having 0 cards in the deck is **not** by itself a loss. Only *attempting a draw* with an empty deck is. A player at 0 cards who never draws (impossible in normal play because of the automatic turn draw, but reachable mid-turn) does not lose until the draw.

> ⚠️ **UNVERIFIED — "Reaper" flavour.** One wiki phrasing mentions "gets the Reaper at the bottom of his deck," which reads like a description of a visual/UI element or possibly a conflation with another game. The mechanical rule (attempt-to-draw-from-empty = loss) is well supported; treat the Reaper reference as cosmetic or spurious.

---

## 8. Card types

**[R-89]** There are **three playable card types** plus two structural ones:

| Type | Occupies a board slot? | Can attack? | Can be attacked? | Can evolve? | Notes |
|---|---|---|---|---|---|
| **Follower** | Yes | Yes | Yes | **Yes** | Has attack/defense. The only card type that fights. |
| **Amulet** | Yes | No | **No** | No | Static/triggered abilities. Two sub-kinds below. |
| **Spell** | **No** | — | — | No | Resolves once, then becomes a shadow immediately. |
| **Leader** | — | No | Yes (by attacks & effects) | No | Not a card in the deck; the player avatar with 20 defense. |
| **Token** | (depends on its own type) | — | — | — | A follower/spell/amulet that **cannot be put into a deck**; created only by card abilities during a match. |

**[R-90] Amulet sub-kinds:**
- **Countdown Amulet** — displays a Countdown number N. N decreases by 1 at the start of its controller's turn; at 0 the amulet is **destroyed** (which triggers its Last Words). N is also modifiable by effects.
- **Permanent Amulet** — no Countdown; stays on the field until removed by a card effect or by its own Last Words/self-destruction clause.

**[R-91]** Tokens are otherwise ordinary cards of their type: token followers can be evolved, have keywords, become shadows on destruction, etc. They cannot be crafted, cannot appear in packs, and cannot be deck-built.

**[R-92]** Spells never enter the field and never occupy a slot. A spell becomes a **shadow** for its caster the moment it resolves.

---

## 9. Playing a card

**[R-93]** Sequence for playing a card from hand:
1. Legality check: `currentPP >= cost`; for followers/amulets, a free board slot exists; for spells and abilities with mandatory targets, the target requirement is satisfiable (§13.5).
2. Pay the cost (`currentPP -= cost`).
3. **Followers/amulets**: the card is **placed onto the field first**, then its **Fanfare** resolves. **Spells**: the effect resolves, then the card becomes a shadow.
4. All resulting triggers, then state-based destruction (§15), then control returns to the player.

**[R-94] Fanfare (ファンファーレ)** activates **only when the card is played from hand by paying its cost**. Cards put onto the field by any other means (summon effects, resurrection, transformation, "put into play from deck") do **not** trigger Fanfare unless the effect explicitly says the Fanfare activates.

**[R-95]** Only **followers and amulets** can have Fanfare. Spells cannot (their whole text is their effect).

**[R-96]** Because of step 3, the follower **is already on the field when its own Fanfare resolves**. Consequences:
- A Fanfare worded "all followers" or "all allied followers" **includes the follower itself**. This is why the era's card templating carefully says "**all other** followers" when self-exclusion is intended (e.g. Neutral 8-cost `Flame Destroyer`: "Fanfare: Deal 2 damage to all **other** followers").
- A Fanfare that counts allied followers counts itself.
- A Fanfare can therefore destroy the follower that produced it.
- A Fanfare that would summon a body must contend with the fact that the played card has already consumed a slot (relevant to §7.1: playing a follower onto a 4-occupied board leaves 0 free slots for its own Fanfare summons).

> ⚠️ **UNVERIFIED — [R-96].** I could not retrieve a source that states "the follower is on the field before its Fanfare resolves" in so many words for the original game. My confidence is nonetheless high, because (a) the card templating convention of "all **other** followers" only makes sense under this model, and (b) the wiki's On Evolve description uses the parallel construction ("activates once the follower evolves **and its evolved card comes onto the field**"). Verify against a specific WLD-era self-including Fanfare before relying on it for a corner case.

---

## 10. Keyword and ability catalogue (WLD era)

### 10.1 Evergreen keywords present in the era

| Keyword (EN) | JP | Semantics | In era? |
|---|---|---|---|
| **Fanfare** | ファンファーレ | Triggers when the card is played from hand. Followers & amulets only. | ✅ Basic |
| **Last Words** | ラストワード | Triggers when the card **in play** is **destroyed** and goes to the graveyard. Followers & amulets. Does **not** trigger on banish or transform. | ✅ Basic |
| **Evolve / On Evolve** | 進化時 | Triggers when this follower evolves. | ✅ Basic |
| **Ward** | 守護 | Enemy followers must attack this before any other enemy target. Ignored by spells/effects. | ✅ Basic |
| **Storm** | 疾走 | May attack followers **and** the leader on the turn it enters play. | ✅ Basic |
| **Rush** | 突進 | May attack **enemy followers only** on the turn it enters play. | ✅ **Darkness Evolved (set 2, 2016)** |
| **Bane** | 必殺 | Destroys any follower it battles (attacking or defending), after damage. | ✅ Basic |
| **Drain** | ドレイン | Restores leader defense equal to damage dealt **while attacking**. | ✅ Basic |
| **Ambush** | 潜伏 | Cannot be attacked or targeted by enemy spells/effects; lost when it deals damage. | ✅ Basic |
| **Countdown** | カウントダウン | Amulet timer; −1 at start of controller's turn; destroyed at 0. | ✅ Basic |
| **Clash** | 交戦時 | Triggers when this follower attacks an enemy follower **or is attacked by one**; resolves **before** combat damage. Does **not** trigger when attacking the enemy leader. | ✅ **Rise of Bahamut (set 3, Dec 2016)** |
| **Enhance** | エンハンス | If you have at least the Enhance cost in PP when you play the card, you pay the Enhance cost instead and get an alternative/expanded effect. Enhance costs are always **higher** than the base cost. **Automatically applied** if affordable — the player cannot decline it. | ✅ **Rise of Bahamut (set 3, Dec 2016)** |

> ⏳ **ERA CORRECTION — Enhance.** The task brief guessed that Enhance/Accelerate arrived after WLD. **Enhance did exist by WLD**: the Shadowverse Wiki attributes it to Rise of Bahamut (3rd set, December 2016), two sets before Wonderland Dreams. **Accelerate**, by contrast, did **not** exist — it arrived in Brigade of the Sky (June 2018).
>
> ⚠️ **UNVERIFIED — Enhance auto-activation.** The wiki says "Enhance effects are automatically activated if the available play points are enough to pay the Enhance cost." I believe this is correct for the original game (no opt-out), but note there is a well-known player complaint pattern about being unable to decline Enhance, which supports it. If a card offers a choice, it will say so.

### 10.2 Keywords that did **NOT** exist in the era

| Keyword | First appeared | Verdict |
|---|---|---|
| **Strike** (攻撃時, keyworded) | **Rebirth of Glory** (13th set, June 2019) | ❌ **Not a keyword in the WLD era.** "When this follower attacks…" effects existed as *written-out card text* and are correctly modelled as step ① of §6.8; just don't render or match on the keyword name "Strike". |
| **Accelerate** | Brigade of the Sky (June 2018) | ❌ |
| **Resonance** (共鳴) | Chronogenesis (Dec 2017), a Portalcraft mechanic | ❌ |
| **Artifact** trait | Chronogenesis (Dec 2017) | ❌ |
| **Reanimate**, **Burial Rite** | Chronogenesis (Dec 2017) | ❌ |
| **Stack** (Earth Sigil stacking) | Dawn of Calamity (2021) | ❌ — in the WLD era, **each Earth Sigil is a separate amulet occupying its own board slot**, so at most 5 can exist at once. |
| **Aura** | *Shadowverse: Evolve* (physical TCG) / Worlds Beyond | ❌ |
| **Barrier** | Worlds Beyond / Evolve | ❌ |
| **Engage** | Worlds Beyond | ❌ |
| **Super Evolve** (超進化) | Worlds Beyond | ❌ |
| **Crest** (リーダー付与) as a formal concept | Later original-SV sets / WB | ⚠️ see below |

> ⚠️ **UNVERIFIED — "cannot be targeted" in the WLD era.** Aura and Barrier are definitely out of era as **keywords**. However, the *effect* "this cannot be selected by enemy card effects" did exist in the original game as plain card text on a small number of cards. Model it as a per-card property (`untargetableByEnemyEffects`), not as a keyword, and make sure §13.5's targeting rules consult it. Similarly, "reduce damage taken to 0" style shields existed as card text (mainly leader-attached, e.g. "damage to your leader is reduced to 0 until the end of the opponent's next turn") without being called Barrier.

### 10.3 Class mechanics (all present in the era)

| Mechanic | Class | Exact semantics |
|---|---|---|
| **Spellboost** (スペルブースト) | Runecraft | Every time you play a **spell**, every card **in your hand** with a Spellboost ability gains one Spellboost counter. The counters modify that card (most commonly reducing its cost by 1 each, but also increasing damage, follower counts, etc.). Counters accumulate while the card sits in hand. Cost floors at 0. |
| **Necromancy N** (ネクロマンス) | Shadowcraft | If your **shadow** count ≥ N at the moment the ability checks, **N shadows are spent automatically** and the Necromancy effect activates. It is **not optional** and there is no choice to decline. If shadows < N, the Necromancy clause simply does not activate (the rest of the card still works). |
| **Shadows** (墓場) | all classes accumulate; only Shadowcraft consumes | You gain **1 shadow** whenever: a card **you control on the field is destroyed** (follower or amulet); **you play a spell**; **a card is discarded** from your hand. Banished, transformed, or otherwise removed-without-destruction cards do **not** become shadows. Shadows are per-player. |
| **Vengeance** (復讐) | Bloodcraft | Active while **your leader's defense is 10 or less**. It is a continuous state, checked live — it turns on the instant you drop to 10 and turns off the instant you heal above 10. Cards check it at the moment their ability resolves. |
| **Self-damage** | Bloodcraft | Not a keyword. Card text like "deal 2 damage to your leader" is ordinary damage: it can activate Vengeance, and it **can kill you** (there is no protection from self-damage). |
| **Overflow** (覚醒) | Dragoncraft | Active while your **maximum play points are 7 or more**. Note this reads `maxPP`, **not** `currentPP` — you are in Overflow at 7 max PP even after spending all of it. Empty-orb ramp therefore accelerates Overflow. |
| **Earth Rite** (土の秘術) | Runecraft | Activated by **destroying** allied **Earth Sigil** amulets in play. A plain Earth Rite destroys **1** Earth Sigil; larger Earth Rites destroy as many as their cost states. If you have fewer Earth Sigils than required, the Earth Rite clause does not activate (rest of the card still works). Destroying an Earth Sigil this way is a **destruction** and therefore triggers its Last Words and produces a shadow. |
| **Earth Sigil** (土の印) | Runecraft | A **trait** on certain amulets (most commonly the token amulet **Earth Essence**). In this era each Earth Sigil is its own amulet occupying its own board slot — max 5 at once, and they compete with your followers for space. |

**[R-97]** Necromancy, Overflow, Vengeance, Spellboost, and Earth Rite are all **conditional clauses on a card**, not standalone keywords with their own triggers. A card typically reads: `Fanfare: <base effect>. Necromancy (6): <extra effect>.` The base effect always happens; the conditional clause happens only if the condition is met at the moment the card's ability resolves.

> ⚠️ **UNVERIFIED — maximum shadow count.** I could not find a cap on shadows. My belief is there is no hard cap (or a cap high enough to be irrelevant). Implement as unbounded.

> ⚠️ **UNVERIFIED — Overflow's introducing set.** Overflow (覚醒) is unquestionably present and central in the WLD era. I could not get the wiki to state which set introduced it; my belief is the **Basic set**, since Dragoncraft's whole identity from launch was ramping to Overflow thresholds. Low risk either way — it's in era.

### 10.4 Forestcraft's and Swordcraft's era identity (no formal keyword)

**[R-98]** Neither class has a named keyword in this era.
- **Forestcraft** cards check "**if you have played 2 or more cards this turn**" (or similar counts) as plain card text, and generate **Fairy** / **Fairy Wisp** token followers into hand. Implement a per-turn `cardsPlayedThisTurn` counter.
- **Swordcraft** cards reference the **Officer** and **Commander** traits on followers as a subtype condition ("give all allied Officers +1/+0"). Implement traits as a tag set on cards.

---

## 11. Win, loss, and draw

**[R-99] Loss conditions.** A player loses immediately when either occurs:
1. Their **leader's defense reaches 0 or less**.
2. They **must draw from an empty deck** (§7.3).

**[R-100] Simultaneous loss — the original digital game does NOT draw.** When both players' loss conditions are satisfied at the same moment, the **turn player loses**.

This falls directly out of the universal turn-player-priority resolution rule (§13.2): "effects that affect you and the opponent simultaneously resolve with priority to the turn player," so the turn player's leader is reduced to 0 first and the loss check fires for them first.

Confirmed with two concrete Japanese community examples for the app:
- Both leaders at 1 defense; the turn player plays a spell dealing 1 damage to both leaders → **the player who cast it loses**.
- Both leaders at 3 defense; the turn player evolves a follower whose On Evolve deals 3 to both leaders → **the turn player loses**.

> ⚠️ **CONFLICTING SOURCES — read carefully.** English-language search results returned "if both players would win or lose simultaneously, the game ends in a draw." **That statement is from the *Shadowverse: Evolve* physical TCG comprehensive rules, not the digital game**, and Japanese sources explicitly note the app behaves differently from Evolve on exactly this point (「これはアプリ版の処理とは異なります」). The task brief's assumption of "simultaneous loss = draw" reflects the TCG, not the 2016 digital game.
>
> My recommendation: implement **turn player loses**, and expose it as a configuration flag named something like `simultaneousLossRule: "turnPlayerLoses" | "draw"` so the TCG rule can be swapped in. Confidence: high for the app, but this is the single rule I would most want a developer to re-verify against a replay if fidelity matters.

**[R-101]** There is no "concede = draw"; conceding is a loss for the conceding player. Disconnect handling is outside the rules engine.

---

## 12. Removal semantics: destroy vs. banish vs. transform vs. damage

**[R-102]** Four distinct removal-ish operations with different downstream consequences:

| Operation | JP | Triggers Last Words? | Produces a shadow? | Notes |
|---|---|---|---|---|
| **Destroy** | 破壊 | ✅ **Yes** | ✅ Yes | The default. Includes destruction by lethal damage, by Bane, by Countdown reaching 0, and by "destroy" effects. |
| **Damage** (lethal) | ダメージ | ✅ Yes (via the resulting destruction) | ✅ Yes | Damage does not remove anything by itself; it lowers defense and the **state-based check** destroys anything at ≤0 (§15). |
| **Banish** | 消滅 | ❌ **No** | ❌ **No** | Removes the card from the game entirely. Cards in hand and deck can also be banished. This is Havencraft's signature answer to Last Words value. |
| **Transform** | 変身 | ❌ **No** | ❌ **No** | The original card is removed from play and a different card takes its place in the same slot. Mechanically a banish + summon. **There is no way to revert a transformed card.** The replacement is a fresh object: it is summoning-sick, it did not "enter by being played" so **no Fanfare**, and it has none of the original's buffs, damage, or granted keywords. |

**[R-103]** "Destroy" bypassing Last Words is **not** a thing in this era — if a source says a card is destroyed, Last Words fire. The way to bypass Last Words is **banish** (or transform), full stop.

**[R-104]** Returning a follower to hand ("bounce") is also **not** a destruction: no Last Words, no shadow. The card resets to its printed state.

**[R-105]** Silence-like effects ("**remove all abilities from** an enemy follower") strip abilities **including Last Words**, so a subsequently destroyed silenced follower produces no Last Words. It still becomes a shadow (it was destroyed).

> ⚠️ **UNVERIFIED — [R-105] on whether silence also removes stat buffs.** In Shadowverse the era's wording is typically "remove all abilities" or "make it a X/Y with no abilities", and different cards do different things. Treat per-card rather than as a general keyword; do **not** assume a Hearthstone-style unified Silence.

---

## 13. Effect resolution

### 13.1 The resolution model

**[R-106]** Shadowverse has **no stack and no priority passing.** Only the turn player acts, one action at a time, and each action resolves to completion (including all cascading triggers) before the next action can begin.

**[R-107]** Resolution is a **queue**, not a stack. Per the Japanese effect-processing reference: *"resolve the entire originating effect first, then process the triggered effects."* That is:
1. Resolve the originating effect (the played card / the attack / the start-of-turn step) **completely**.
2. Collect every ability that triggered during (1) into a queue.
3. Resolve that queue in order (§13.2), collecting any further triggers into the back of the queue.
4. Repeat until the queue is empty.

This is FIFO, first-in-first-out — the opposite of Magic's LIFO stack. If effect A triggers B and C, and B triggers D, the resolution order is **B, C, D**.

> ⚠️ **UNVERIFIED — strict FIFO.** The "resolve the origin fully, then process triggered effects" statement is well sourced; whether newly-spawned triggers go to the back of the same queue or form a nested sub-queue is not something I could confirm. FIFO with append-to-back is my belief and the more common implementation for this style of engine.

### 13.2 Simultaneous-effect ordering — the master rule

**[R-108]** When multiple abilities trigger at the same moment, resolve them in this order:

1. **Turn player's abilities first**, then the non-turn player's. ("複数の効果が同時に発動する場合、ターンプレイヤーの効果が先に発動します")
2. Within one player's abilities, **the card that entered play earlier resolves first** ("先に出したフォロワーから処理"), which visually corresponds to **left to right** on the board.

**[R-109]** This applies to **Last Words** specifically: when several followers/amulets with Last Words are destroyed simultaneously (a board wipe, a mutual-destruction trade), the turn player's Last Words resolve first, in play order; then the opponent's, in play order. This is the answer to "leftmost-to-rightmost or order of destruction" — **it is board/play order, not destruction order**, with turn-player priority layered on top.

**[R-110]** The same rule governs simultaneous start-of-turn abilities, simultaneous end-of-turn abilities, and simultaneously-breaking Countdown amulets ("multiple amulet countdowns reaching 0 are processed from left to right").

**[R-111]** This rule is also what produces the simultaneous-loss outcome in §11 [R-100].

### 13.3 Board-full during resolution

See §7.1 [R-77]–[R-79]. Summary: from hand → illegal play; during resolution → that body's summon is silently skipped, the rest of the effect continues.

### 13.4 Damage, destruction, and interleaving

**[R-112]** Effects that deal damage to multiple targets deal all the damage **first**, then run one destruction check, then resolve all resulting Last Words per §13.2. Do **not** destroy-and-trigger target-by-target during a sweep.

> ⚠️ **UNVERIFIED — [R-112].** This is the standard behaviour in comparable engines and matches the observed batch-animation of AoE spells in Shadowverse, but I did not find an explicit source. The alternative (per-target destroy-and-trigger) produces visibly different results when a Last Words heals or buffs the remaining targets, so it is worth verifying against a specific WLD card such as a Shadowcraft board wipe interacting with a Last Words that summons.

### 13.5 Targeting rules

**[R-113] The critical asymmetry — spells vs. followers/amulets:**

| Card type | Behaviour when there are not enough legal targets |
|---|---|
| **Spell with a "choose"/"select" requirement** | **Cannot be played at all.** The play is illegal and the client greys the card out. "スペルで対象を選ぶ能力を持つカードは、指定された数すべてを選ぶことができるときのみプレイできる" — a spell that says "select an enemy follower" is unplayable when the enemy has no followers. |
| **Follower/amulet with a "choose" Fanfare** | **Can always be played.** The Fanfare "chooses as many as it can" — if there are zero legal targets, the choosing part simply does nothing while the rest of the card (the body, the other clauses) resolves normally. |

**[R-114]** This asymmetry exists because a follower/amulet always has a body worth playing, whereas a spell with no legal target would be a pure waste. Implement it as a hard rule on the play-legality check, keyed off card type.

**[R-115]** Targets must be legal at the moment of selection: **Ambush** followers and cards with "cannot be selected by enemy effects" are excluded from the enemy's legal-target set (§6.7). They are **not** excluded from your own effects' target sets — Ambush only protects from the **enemy**.

**[R-116] Random selection.** "A random enemy follower", "a random card in your deck" etc. select uniformly at random from the qualifying set at the moment of resolution. If the qualifying set is empty, that part of the effect does nothing (and, per [R-113], a *spell* whose only mode is random-with-no-targets is generally still playable, because random selection is not "choosing" — see the flag).

> ⚠️ **UNVERIFIED — whether random-selection spells are playable with an empty candidate set, and whether random selection can pick Ambush followers.** Japanese sources distinguish "選択する" (choose/target) from random effects and note that random effects bypass "cannot be targeted" protection. My belief: **random ≠ targeting**, therefore (a) random spells are playable with no candidates and simply do nothing, and (b) random effects **can** hit Ambush followers. Both are engine-visible decisions; verify before shipping.

**[R-117]** Effects worded "**all** X" are non-targeting sweeps: they ignore Ambush and untargetable protections (§6.70).

---

## 14. Buffs, debuffs, damage, and healing

### 14.1 Follower damage persists

**[R-118]** Damage marked on a follower **persists across turns**. There is no end-of-turn healing. A `4/4` that took 3 damage stays a `4/1` until something restores its defense, and it is destroyed by 1 more damage next turn.

**[R-119]** Model it as `defense` (current) and `maxDefense`. Damage lowers `defense`. "Restore N defense to a follower" raises `defense` up to `maxDefense`, never beyond.

### 14.2 Buffs and debuffs

**[R-120]** Two persistence classes; the engine must distinguish them:
- **Permanent** — "Give an allied follower **+2/+2**." Applies to `attack` and to **both** `defense` and `maxDefense`. Persists indefinitely, survives across turns, survives evolution.
- **Until end of turn** — "Give an allied follower **+2/+0 until the end of the turn**." Expires at end-of-turn step E4.

**[R-121]** A `+X/+Y` buff raises **`maxDefense` by Y and current `defense` by Y**. It does **not** heal existing damage: a `2/2` that took 1 damage (`2/1` of 2) buffed +0/+2 becomes `2/3` of 4.

**[R-122]** A `−X/−Y` debuff lowers `attack` (floor 0 — attack is never negative) and lowers **`maxDefense` by Y and current `defense` by Y**. If the resulting `defense <= 0`, the follower is destroyed by the state-based check (§15) — a debuff kill is a **destruction** and triggers Last Words.

> ⚠️ **UNVERIFIED — [R-122] on whether defense-reducing debuffs lower current defense by the full amount or clamp current defense to the new max.** Both models give the same answer for an undamaged follower. My belief is "lower both by Y" (so damage taken is preserved). Flag it.

**[R-123]** When a temporary buff expires at E4, subtract the same amounts. If `maxDefense` drops such that `defense > maxDefense`, clamp `defense` down. If `defense <= 0` after expiry, the follower is destroyed at the next state-based check.

### 14.3 Leader defense and healing cap

**[R-124]** A leader's defense is capped at its **maximum defense**, which starts at **20**. Healing above the cap is wasted (no overheal).

**[R-125]** **No card in the original Shadowverse raises a leader's maximum defense above 20.** This is a deliberate design decision by Cygames (the stated goal was matches resolving around turn 10; raising max defense would lengthen games). Cards that *lower* a leader's maximum defense do exist.

**[R-126]** When maximum defense is lowered, **current defense is clamped down** to the new maximum. When maximum defense later returns to a higher value, **current defense does not go back up** — it stays where it was and must be healed. (Example from the Japanese Q&A: max 20 → reduced to 10, current becomes 10; max restored to 20, current remains 10.)

**[R-127]** The healing cap uses the **current** maximum, whatever it is at that moment.

**[R-128]** Vengeance (§10.3) reads the **current defense value ≤ 10**, independently of the maximum. A Bloodcraft leader whose maximum was reduced to 10 and who is at full 10 defense is in Vengeance.

---

## 15. State-based actions (destruction checkpoints)

**[R-129]** The engine must run a **destruction check** at well-defined checkpoints, not continuously mid-effect. A follower with `defense <= 0`, or that was struck by Bane in the current battle, is destroyed at the next check.

**[R-130]** Checkpoints:

| # | Checkpoint |
|---|---|
| C1 | After combat step ⑥ of an attack (§6.8) — this is step ⑦. |
| C2 | After a played card's effect (including its Fanfare) has fully resolved. |
| C3 | After each triggered ability in the resolution queue has fully resolved. |
| C4 | After each start-of-turn and end-of-turn step. |
| C5 | After an evolution's On Evolve ability has resolved. |

**[R-131]** Destruction produces: the card leaves the field → its owner gains a shadow → its **Last Words** trigger and go into the resolution queue (ordered per §13.2) → the board slot is freed.

**[R-132]** **Countdown reaching 0** is a destruction, not a separate removal. It happens:
- at start-of-turn step S6 for the normal per-turn decrement; **or**
- **immediately**, mid-resolution, if a card effect reduces the Countdown to 0 during the main phase. Effects that "reduce the Countdown of an allied amulet by 2" destroy it on the spot if that reaches 0, and its Last Words go into the queue.

**[R-133]** **Leader death check** runs at the same checkpoints. A leader at `defense <= 0` loses immediately at the check, with turn-player-priority ordering (§11 [R-100]) if both leaders qualify.

> ⚠️ **UNVERIFIED — [R-130] checkpoint granularity.** No source enumerates checkpoints for the original game. The list above is a reconstruction that reproduces all the specific behaviours that *are* sourced (notably combat step ⑦ and the batch-then-check behaviour of AoE). Treat the list as an implementation recommendation, not a citation.

---

## 16. Animation and timing notes that matter for players

These are presentation-level facts that nonetheless shape what players believe the rules are, and that a faithful implementation should preserve.

**[R-134]** The **evolve animation** shows the evolved card sliding on top of the unevolved card. This visually reflects the real processing model (§5.3): the evolved body enters first as a stat-only card, then abilities are attached. Players who see "evolve, then the On Evolve effect fires" are seeing the actual order.

**[R-135]** **Fanfare fires after the follower lands on the board** (§9 [R-96]). Players routinely misjudge self-inclusive Fanfares because the animation is fast; the "all **other** followers" templating exists precisely to disambiguate.

**[R-136]** The **evolution orb** in the UI counts down the turns until evolution unlocks and glows yellow when evolution is available. It is the player's only indicator of the turn-4/turn-5 asymmetry.

**[R-137]** **Countdown numbers visibly tick at the start of your turn**, before the card draw animation — matching [R-18]. A Countdown amulet whose Last Words draws will visibly deliver its card before the turn draw.

**[R-138]** **Ambush** followers are **fully visible** to the opponent (they are shown with a distinctive shroud effect, not hidden). Ambush is not hidden information. An opponent can see that they cannot attack it.

**[R-139]** **Rush** is rendered as a glowing yellow border on the card; **Storm** has its own distinct treatment. This is the only in-client cue distinguishing them at a glance.

**[R-140]** The **90-second turn timer** ends the turn automatically. Long resolution chains (many Last Words, many summons) consume real time and can cost a player their turn — a fidelity concern for any client, irrelevant to a headless engine.

**[R-141]** Damage numbers on followers are shown as a reduced current defense next to the printed maximum, reinforcing [R-118] (damage persists).

---

## 17. What changed after Wonderland Dreams (do NOT implement)

| Change | When | Note |
|---|---|---|
| **Portalcraft** (8th class) + **Artifact** trait + **Resonance** | Chronogenesis, Dec 2017 | Keep 7 classes. |
| **Reanimate**, **Burial Rite** (Shadowcraft) | Chronogenesis, Dec 2017 | — |
| **Accelerate** | Brigade of the Sky, Jun 2018 | — |
| **Strike** as a formal keyword | Rebirth of Glory, Jun 2019 | The *effect* existed as card text in the WLD era; the *keyword* did not. |
| **Stack** (Earth Sigils merging, >5 on board) | Dawn of Calamity, 2021 | In the WLD era each Earth Sigil is its own amulet in its own slot. |
| **Rotation** format and card rotation | Introduced later | The WLD era predates the Rotation/Unlimited split as it later existed; all sets were legal together. |
| **Aura / Barrier / Engage / Super Evolve** | Evolve TCG (2022) / Worlds Beyond (2025) | Not original-SV mechanics at all. |
| Opening hand of **4** and **1** card drawn by both on turn 1 | Worlds Beyond (2025) | The WLD era is 3 cards + second-player draws 2 on turn 1. |
| Evolution point economy of **0 (first) / 3 (second)** | Shadowverse: Evolve TCG | The WLD era is 2 / 3. |
| Hand limit **7**, discard down at end of turn | Shadowverse: Evolve TCG | The WLD era is 9 with **burn** (destroyed on draw, no discard step). |
| Deck size **40–50** + a 10-card **evolve deck** | Shadowverse: Evolve TCG | The WLD era is exactly 40, no evolve deck. |
| **Simultaneous loss = draw** | Shadowverse: Evolve TCG | The WLD-era app makes the **turn player lose**. |

Balance changes (individual card nerfs/buffs) within the era are out of scope for this document; if you are targeting a specific patch, check the card-level changelog for that patch.

---

## 18. Consolidated list of open questions

Ranked by how much a wrong answer would distort gameplay.

| # | Question | My belief | Risk if wrong |
|---|---|---|---|
| 1 | Simultaneous leader death: turn player loses, or draw? | **Turn player loses** (app); draw is the TCG rule | High — decides games |
| 2 | Start-of-turn: countdown decrement before or after other start-of-turn abilities? | Interleaved: decrement numerically, then resolve broken-amulet Last Words in board order alongside other start-of-turn abilities; draw last | Medium |
| 3 | Mulligan: are rejected cards shuffled back before replacements are drawn (can you redraw the same card)? | **Yes, shuffled back first** | Medium — affects opening-hand distributions |
| 4 | Can random effects hit Ambush followers? | **Yes** (random ≠ targeting) | Medium |
| 5 | Is the follower on the board when its own Fanfare resolves? | **Yes** | Medium |
| 6 | AoE: batch all damage then one destruction check, or per-target? | **Batch** | Medium |
| 7 | Do overdraw-burned cards become shadows? | **Yes** | Low–Medium (Shadowcraft only) |
| 8 | Bounce to a full hand: does the follower leave the field and burn, or does the bounce fizzle? | **Leaves and burns** | Low |
| 9 | Do "until end of turn" buffs expire before or after end-of-turn triggers? | **After** triggers | Low |
| 10 | Does evolving refresh a follower's attack for the turn? | **No** | Low |
| 11 | Are free (card-effect) evolves usable before turn 4/5? | **Yes** | Low |
| 12 | Can the player choose a board placement slot when playing a card? | **No** — appends right; resolution uses play order regardless | Low (resolution order is play-order-based either way) |
| 13 | Maximum shadow count | **Unbounded** | Low |
| 14 | Which set introduced Overflow | Basic set | None (in era regardless) |
| 15 | Whether some Basic-set followers printed Rush as full text rather than the keyword | Possibly | None mechanically; card-text rendering only |

---

## 19. Quick-reference constant table

```
DECK_SIZE                     = 40
COPY_LIMIT                    = 3
CLASSES                       = 7 (+ Neutral)         // Portalcraft NOT in era
LEADER_STARTING_DEFENSE       = 20
LEADER_MAX_DEFENSE            = 20                    // no era card raises it
STARTING_HAND                 = 3                     // both players
FIRST_PLAYER_TURN1_DRAW       = 1
SECOND_PLAYER_TURN1_DRAW      = 2
DRAW_PER_TURN                 = 1                     // thereafter
MULLIGAN_ROUNDS               = 1                     // simultaneous, no card loss
PP_START_MAX                  = 0                     // becomes 1 at first start-of-turn
PP_GAIN_PER_TURN              = 1
PP_MAX                        = 10
PP_CARRYOVER                  = false
MIN_CARD_COST                 = 0
EP_FIRST_PLAYER               = 2
EP_SECOND_PLAYER              = 3
EP_UNLOCK_TURN_FIRST          = 5                     // player's own turn 5
EP_UNLOCK_TURN_SECOND         = 4                     // player's own turn 4
EP_SPENT_PER_TURN_MAX         = 1
EVOLVE_PP_COST                = 0
EVOLVE_DEFAULT_STAT_GAIN      = +2/+2                 // read printed evolved stats
BOARD_SLOTS                   = 5                     // followers + amulets SHARED
HAND_LIMIT                    = 9                     // overdraw = burn (destroyed)
DECK_OUT                      = immediate loss on attempted draw from empty deck
VENGEANCE_THRESHOLD           = leader defense <= 10
OVERFLOW_THRESHOLD            = max play points >= 7
TURN_TIMER_SECONDS            = 90
SIMULTANEOUS_LOSS             = turn player loses     // ⚠️ see §11
```

---

## 20. Sources

Primary / official:
- [Play Guide | Game Guide | Shadowverse | Cygames](https://shadowverse.com/gameguide/playguide.php) — official play guide (play points, evolution points, evolve turn timings)
- [Cards | Game Guide | Shadowverse | Cygames](https://shadowverse.com/gameguide/cards.php) — official card-type guide
- [Outline | Game Guide | Shadowverse | Cygames](https://shadowverse.com/gameguide/)
- [How to Play: The Flow of Battle | SHADOWVERSE: Champion's Battle | XSEED Games](https://shadowversecb.com/howtoplay/theflowofbattle/) — official English rules for the faithful console port
- [How to Play: Game Overview | SHADOWVERSE: Champion's Battle](https://shadowversecb.com/howtoplay/gameoverview/)
- [Glossary | SHADOWVERSE: Champion's Battle](https://shadowversecb.com/glossary/)
- [Cards / Classes | SHADOWVERSE: Champion's Battle](https://shadowversecb.com/cards-classes/)

Shadowverse Wiki (Fandom) — mechanics pages:
- [Shadowverse](https://shadowverse.fandom.com/wiki/Shadowverse) · [Glossary](https://shadowverse.fandom.com/wiki/Glossary) · [Class](https://shadowverse.fandom.com/wiki/Class) · [Card](https://shadowverse.fandom.com/wiki/Card) · [Leader](https://shadowverse.fandom.com/wiki/Leader)
- [Follower](https://shadowverse.fandom.com/wiki/Follower) · [Amulet](https://shadowverse.fandom.com/wiki/Amulet) · [Spell](https://shadowverse.fandom.com/wiki/Spell) · [Token](https://shadowverse.fandom.com/wiki/Token)
- [Evolve](https://shadowverse.fandom.com/wiki/Evolve) · [Redraw](https://shadowverse.fandom.com/wiki/Redraw)
- [Fanfare](https://shadowverse.fandom.com/wiki/Fanfare) · [Last Words](https://shadowverse.fandom.com/wiki/Last_Words) · [Countdown](https://shadowverse.fandom.com/wiki/Countdown) · [Clash](https://shadowverse.fandom.com/wiki/Clash) · [Strike](https://shadowverse.fandom.com/wiki/Strike) · [Enhance](https://shadowverse.fandom.com/wiki/Enhance) · [Accelerate](https://shadowverse.fandom.com/wiki/Accelerate)
- [Ward](https://shadowverse.fandom.com/wiki/Ward) · [Storm](https://shadowverse.fandom.com/wiki/Storm) · [Rush](https://shadowverse.fandom.com/wiki/Rush) · [Bane](https://shadowverse.fandom.com/wiki/Bane) · [Drain](https://shadowverse.fandom.com/wiki/Drain) · [Ambush](https://shadowverse.fandom.com/wiki/Ambush)
- [Banish](https://shadowverse.fandom.com/wiki/Banish) · [Transform](https://shadowverse.fandom.com/wiki/Transform)
- [Spellboost](https://shadowverse.fandom.com/wiki/Spellboost) · [Necromancy](https://shadowverse.fandom.com/wiki/Necromancy) · [Shadows](https://shadowverse.fandom.com/wiki/Shadows) · [Vengeance](https://shadowverse.fandom.com/wiki/Vengeance) · [Overflow](https://shadowverse.fandom.com/wiki/Overflow) · [Earth Rite](https://shadowverse.fandom.com/wiki/Earth_Rite) · [Earth Sigil](https://shadowverse.fandom.com/wiki/Earth_Sigil) · [Earth Essence](https://shadowverse.fandom.com/wiki/Earth_Essence) · [Stack](https://shadowverse.fandom.com/wiki/Stack) · [Resonance](https://shadowverse.fandom.com/wiki/Resonance) · [Engage](https://shadowverse.fandom.com/wiki/Engage)
- Classes: [Forestcraft](https://shadowverse.fandom.com/wiki/Class) · [Swordcraft](https://shadowverse.fandom.com/wiki/Swordcraft) · [Runecraft](https://shadowverse.fandom.com/wiki/Runecraft) · [Dragoncraft](https://shadowverse.fandom.com/wiki/Dragoncraft) · [Shadowcraft](https://shadowverse.fandom.com/wiki/Shadowcraft) · [Bloodcraft](https://shadowverse.fandom.com/wiki/Bloodcraft) · [Havencraft](https://shadowverse.fandom.com/wiki/Havencraft) · [Portalcraft](https://shadowverse.fandom.com/wiki/Portalcraft)
- Sets: [Basic](https://shadowverse.fandom.com/wiki/Basic) · [Darkness Evolved](https://shadowverse.fandom.com/wiki/Darkness_Evolved) · [Rise of Bahamut](https://shadowverse.fandom.com/wiki/Rise_of_Bahamut) · [Tempest of the Gods](https://shadowverse.fandom.com/wiki/Tempest_of_the_Gods) · [Wonderland Dreams](https://shadowverse.fandom.com/wiki/Wonderland_Dreams) · [Starforged Legends](https://shadowverse.fandom.com/wiki/Starforged_Legends) · [Chronogenesis](https://shadowverse.fandom.com/wiki/Chronogenesis) · [Rebirth of Glory](https://shadowverse.fandom.com/wiki/Rebirth_of_Glory) · [Category:Expansions](https://shadowverse.fandom.com/wiki/Category:Expansions)

Japanese rules references (original game):
- [【シャドバ】効果処理について学ぼう（基礎編）— GameWith](https://shadowverse.gamewith.jp/article/show/172849) — turn-start order, simultaneous-effect ordering, Last Words ordering
- [【シャドバ】効果処理について学ぼう（発展編）— GameWith](https://shadowverse.gamewith.jp/article/show/172850) — Fanfare conditions, board-full summon overflow, random vs. targeting
- [【シャドバ】ルールについて解説 — GameWith](https://shadowverse.gamewith.jp/article/show/22424) — general rules
- [【シャドバQ&A】攻撃時の処理の順序について (No.132085)](https://shadowverse.gamewith.jp/questions/show/132085) — the 7-step combat resolution order
- [【シャドバQ&A】同時死の処理 (No.213014)](https://shadowverse.gamewith.jp/questions/show/213014) — simultaneous leader death: turn player loses
- [【シャドバQ&A】ドレインについて (No.184936)](https://shadowverse.gamewith.jp/questions/show/184936) · [(No.148378)](https://shadowverse.gamewith.jp/questions/show/148378) — Drain only on attack
- [【シャドバQ&A】ラストワードの処理順について (No.209731)](https://shadowverse.gamewith.jp/questions/show/209731)
- [【シャドバQ&A】体力の最大値について (No.255282)](https://shadowverse.gamewith.jp/questions/show/255282) · [体力最大値上げるカード (No.275267)](https://shadowverse.gamewith.jp/questions/show/275267) — 20 cap, no cards raise it
- [コストについて — シャドバ効果処理wiki](https://w.atwiki.jp/svkoukasyori/pages/17.html) — cost floor 0
- [効果処理の流れまとめ — シャドバ効果処理wiki](https://w.atwiki.jp/svkoukasyori/pages/16.html) — resolution queue model
- [シャドバの仕様 — おんJシャドバ部](https://onj-shadowverse.game-info.wiki/d/%A5%B7%A5%E3%A5%C9%A5%D0%A4%CE%BB%C5%CD%CD) — evolution internal processing, turn-player priority
- [ターン開始時/終了時処理の順番 — おんJシャドバ部](https://onj-shadowverse.game-info.wiki/d/%A5%BF%A1%BC%A5%F3%B3%AB%BB%CF%BB%FE/%BD%AA%CE%BB%BB%FE%BD%E8%CD%FD%A4%CE%BD%E7%C8%D6)
- [ラストワード — おんJシャドバ部](https://onj-shadowverse.game-info.wiki/d/%A5%E9%A5%B9%A5%C8%A5%EF%A1%BC%A5%C9) · [ドレイン](https://onj-shadowverse.game-info.wiki/d/%A5%C9%A5%EC%A5%A4%A5%F3) · [ネクロマンス](https://onj-shadowverse.game-info.wiki/d/%A5%CD%A5%AF%A5%ED%A5%DE%A5%F3%A5%B9) · [ライブラリーアウト](https://onj-shadowverse.game-info.wiki/d/%A5%E9%A5%A4%A5%D6%A5%E9%A5%EA%A1%BC%A5%A2%A5%A6%A5%C8)
- [効果の処理順 — sv-gotobeyond.com](https://sv-gotobeyond.com/effect-order/) — alternative start-of-turn ordering model (**note: Worlds Beyond-era source**)

Contrast sources (used only to identify what is NOT the original digital game):
- [RULES – Play Guide — Shadowverse: Evolve](https://en.shadowverse-evolve.com/rules/play-guide/) and the [Comprehensive Rules PDFs](https://en.shadowverse-evolve.com/wordpress/wp-content/uploads/2025/03/26124240/SVEE-Comprehensive-Rules_v1.16.0_250204.pdf) — physical TCG; source of the 40–50 deck, evolve deck, 0/3 EP, 7-card hand, and simultaneous-loss-is-a-draw rules that must **not** be used here
- [Battles | Card Battles | Shadowverse: Worlds Beyond | Cygames](https://shadowverse-wb.com/en/system/cardbattle/battle/) — the 2025 sequel; source of the 4-card opening hand and always-+2/+2 evolve
- [Wonderland Dreams expansion announcement — Steam](https://store.steampowered.com/news/app/453480/view/4545777198788061459) and [Anime News Network](https://www.animenewsnetwork.com/press-release/2017-06-30/wonderland-dreams-new-expansion-released-for-shadowverse/.118248) — WLD release timing (June 2017)

### Access note

`shadowverse.fandom.com`, `shadowverse.com`, `shadowversecb.com`, `w.atwiki.jp`, `en.wikipedia.org`, `web.archive.org`, `reddit.com`, `shadowverse.gamewith.jp`, `svgdb.me` and `shadowverse-portal.com` were all **blocked at the network egress proxy** for this research session (403 on CONNECT). All content above was obtained through the search tool's page summaries rather than by direct page fetch. This is the main reason several points carry `⚠️ UNVERIFIED` markers: I could read what the summariser extracted but could not read full page text, check tables, or follow in-page "History"/"Notes" sections. Anyone re-verifying this document with direct access to those sites should prioritise the questions in §18.
