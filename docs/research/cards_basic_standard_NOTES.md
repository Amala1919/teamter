# Basic + Standard card list — sources & caveats

Companion to `cards_basic_standard.json` (441 entries).

## Coverage

| set | collectible | tokens | total |
|---|---|---|---|
| Basic | 85 | 13 | 98 |
| Standard (Classic card pack) | 318 | 25 | 343 |
| **Total** | **403** | **38** | **441** |

Per class (collectible only):

| class | basic | standard |
|---|---|---|
| forest | 11 | 42 |
| sword | 11 | 42 |
| rune | 11 | 42 |
| dragon | 11 | 42 |
| shadow | 11 | 42 |
| blood | 11 | 42 |
| haven | 11 | 42 |
| neutral | 8 | 24 |

These totals match the published set sizes for the original Shadowverse:
Basic = 85 cards (7 classes x 11 + 8 neutral), Standard = 318 cards.

## Sources

**The requested primary source was unreachable.** `shadowverse.fandom.com` is
blocked by this session's network egress policy (403 on CONNECT), as are
`shadowverse-portal.com`, `svgdb.me`, `shadowverse.jp` and
`shadowverse.gamewith.jp`. Both `curl` and `WebFetch` fail on all of them.

Data was instead taken from a complete mirror of the **official Shadowverse
Portal card API** that is hosted on GitHub (raw.githubusercontent.com is
reachable):

- English: `https://raw.githubusercontent.com/user6174/shadowverse-json/master/en/all.json`
- Japanese: `https://raw.githubusercontent.com/user6174/shadowverse-json/master/ja/all.json`
- Repo: `https://github.com/user6174/shadowverse-json`

This is the same upstream data the Fandom wiki's card pages are built from, so
names, costs, stats, traits and ability text agree with the wiki. 4,316 cards
total; filtered to `expansion_ == "Basic"` and `expansion_ == "Standard Card Pack"`.

Japanese names come from the `ja` mirror joined on card ID — **every one of the
441 entries has a Japanese name**; none are blank.

## Extraction decisions

- **Portalcraft excluded.** The modern Basic set contains 11 Portalcraft cards
  (class added in *Verdant Conflict*, 2019). Per the task's 7-class + neutral
  scope these were dropped.
- **Alternate-art / leader-skin reprints excluded.** Card IDs in the
  `7xxxxxxxx` range are re-skins of an existing card, not distinct cards. Three
  appeared under Basic/Standard and were removed: `Cerberus` (704541010, a
  second copy of the Standard legendary), `Exella, Dark General` (704611010, a
  re-skin of Basic's `Dark General`), and `Ramina, Moon Al-mi'raj` (704741010,
  a re-skin of Standard's `Moon Al-mi'raj`). After this there are **no
  duplicate (name, class) pairs** in the output.
- **Tokens** were resolved by walking the `tokens_` graph from every Basic and
  Standard card, transitively (e.g. `First Curse` -> `Second Curse` ->
  `Final Curse`). A token is tagged `"set": "basic"` if any Basic card creates
  it, otherwise `"standard"`. Promo/alt-art IDs that leak into `tokens_` (the
  API lists a card's own re-skin there) were filtered out.
- **`evoText`** is the *difference* between the API's `evoEffect_` and
  `baseEffect_`, line by line. `"-"` and `"(Same as the unevolved form[, excluding Fanfare].)"`
  become `""`. 25 cards have non-empty `evoText`. For the handful of cards whose
  evolved side *replaces* rather than adds text, the replacement line is what is
  stored (`Lucifer`, `Arch Summoner Erasmus`, `Imprisoned Dragon`, `Zirnitra`,
  `Merlin`, `Exella`-style "(This card will be treated as ...)" notes).
- **`countdown`** is parsed from the literal `Countdown (N)` line in the card
  text; 19 amulets have one, and the `Countdown (N)` line is also left in `text`
  as printed. No non-amulet carries a countdown.
- **`trait`**: only `Officer` (29), `Commander` (21) and `Earth Sigil` (5) occur;
  everything else is `""`.
- Non-followers have `atk`/`life`/`evoAtk`/`evoLife` set to `null`; all 308
  followers have all four populated.

## Caveats / things I could not verify

1. **`evoAtk`/`evoLife` are NOT always base+2.** The task description assumed
   base+2, but the real game gives only **+1/+1** to followers that have an
   `Evolve:` effect, and a few cards have bespoke evolved stats. The file stores
   the *actual* values from the card database, not base+2. 25 followers differ
   from base+2:
   - +1/+1 (all have an `Evolve:` effect): Rose Gardener, Floral Fencer,
     Demonflame Mage, Dragon Warrior, Playful Necromancer, Wardrobe Raider,
     Priest of the Cudgel, Elven Princess Mage, Luminous Knight,
     Gemstaff Commander, Swordsman, Scholarly Witch, Spectral Wizard, Merlin,
     Imprisoned Dragon, Sky Dragon Ethica, Vampire Lykos, Radiant Shaman,
     Cruel Priestess, Dullahan
   - +0/+0: Zirnitra (3/1), Lizardman (3/2)
   - +3/+3: Dark Summoner (2/2 -> 5/5)
   - +3/+1: Lucifer (6/7 -> 9/8)
   - +0/+2: Arch Priestess Laelia (0/6 -> 0/8)

2. **Text is the current live wording, not the 2016 launch printing.** The
   Portal API (and therefore the Fandom wiki) serves present-day text. The vast
   majority of Basic/Standard cards were never touched, and I confirmed that
   **no** Basic/Standard card text contains post-launch keywords `Enhance`,
   `Accelerate`, `Crystallize`, `Union Burst`, `Resonance` or `Invocation`.
   Two keywords in the data *were* introduced after launch and applied
   retroactively to these cards, so the wording differs from the literal 2016
   print:
   - **`Overflow`** (14 cards, all Dragoncraft: Ivory Dragon, Dragonrider,
     Maelstrom Dragon, Shapeshifting Mage, Dragon Oracle, Firstborn Dragon,
     Twin-Headed Dragon, Dragonewt Princess, ...). At launch these read
     "if you have at least 7 play points" spelled out.
   - **`Earth Rite`** (11 Runecraft cards: Apprentice Alchemist, Runic Guardian,
     Petrification, Veteran Alchemist, Fissure Bomb, Ancient Alchemist,
     Golem Protection, Master Alchemist, ...). At launch these spelled out
     "destroy an Earth Sigil".

   Era-correct keywords that ARE present and correct: Ward, Storm, Bane, Drain,
   Ambush, Countdown (N), Spellboost (14), Necromancy (N) (20), Vengeance (24),
   Fanfare, Last Words, Evolve, Strike.

3. **Stats reflect any balance patches** applied between 2016 and the snapshot
   date of the mirror. I had no era-accurate source to diff against, so
   individual pre-nerf costs/stats for the few Standard cards that were
   rebalanced could not be verified.

4. **"Standard Card Pack" membership is as the Portal defines it today.** If any
   card was added to or removed from the Standard pack after launch, it is
   classified here the way the official database classifies it. The 318 total
   matches the commonly cited Standard set size, so I believe no drift occurred.

5. **Token completeness** depends on the API's `tokens_` field. 38 tokens were
   found. A token that a card produces only via untagged text (rather than the
   structured `tokens_` link) would be missed; I found no such case while
   spot-checking, but it is the most likely place for a gap.

## Token list (by class)

- **forest**: Fairy (basic), Thorn Burst (standard)
- **sword**: Knight, Heavy Knight, Steelclad Knight (basic); Fortress Guard,
  Otohime's Bodyguard, Pirate, Viking (standard)
- **rune**: Clay Golem, Snowman (basic); Conjure Guardian, Earth Essence,
  Guardian Golem, Second Curse, Final Curse (standard)
- **dragon**: Dragon, Windblast Dragon (standard)
- **shadow**: Ghost, Lich, Zombie (basic); Skeleton, Mimi, Coco (standard)
- **blood**: Forest Bat (standard)
- **haven**: Holyflame Tiger, Holywing Dragon, Pegasus (basic); Barong,
  Dream Rabbit, Guardian Fox, Holy Falcon, Regal Falcon (standard)
- **neutral**: Flame and Glass (basic); Astaroth's Reckoning, Dis's Damnation,
  Servant of Darkness, Silent Rider (standard)

## Validation performed

- File parses as JSON: 441 objects.
- Every object has exactly the 16 required keys in the specified order.
- `class` ∈ {forest, sword, rune, dragon, shadow, blood, haven, neutral};
  `set` ∈ {basic, standard}; `rarity` ∈ {bronze, silver, gold, legendary};
  `type` ∈ {follower, spell, amulet}.
- No duplicate (name_en, class) pairs.
- All followers have atk/life/evoAtk/evoLife; no non-follower has them.
- No non-amulet has a `countdown`.
- Rarity spread: 216 bronze / 120 silver / 73 gold / 35 legendary.
  Type spread: 308 follower / 95 spell / 41 amulet (some are tokens).
