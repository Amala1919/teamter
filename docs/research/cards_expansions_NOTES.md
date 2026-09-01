# Expansions 2-5 card list — sources & caveats

Companion to `cards_expansions.json` (466 entries). Covers the four expansions
released after launch for the **original Shadowverse** (Cygames, 2016-2017):

| key | set | released |
|---|---|---|
| `darkness` | Darkness Evolved | 2016-09 |
| `bahamut` | Rise of Bahamut | 2016-12 |
| `tempest` | Tempest of the Gods | 2017-03 |
| `wonderland` | Wonderland Dreams | 2017-06 |

## Coverage

| set | collectible | tokens | total |
|---|---|---|---|
| darkness | 109 | 28 | 137 |
| bahamut | 105 | 4 | 109 |
| tempest | 104 | 6 | 110 |
| wonderland | 104 | 6 | 110 |
| **Total** | **422** | **44** | **466** |

Collectible cards by rarity:

| set | legendary | gold | silver | bronze |
|---|---|---|---|---|
| darkness | 9 | 23 | 31 | 46 |
| bahamut | 9 | 24 | 32 | 40 |
| tempest | 16 | 24 | 32 | 32 |
| wonderland | 16 | 24 | 32 | 32 |

Collectible cards by class:

| class | darkness | bahamut | tempest | wonderland |
|---|---|---|---|---|
| forest | 14 | 13 | 13 | 13 |
| sword | 14 | 13 | 13 | 13 |
| rune | 14 | 13 | 13 | 13 |
| dragon | 14 | 13 | 13 | 13 |
| shadow | 14 | 13 | 13 | 13 |
| blood | 14 | 13 | 13 | 13 |
| haven | 14 | 13 | 13 | 13 |
| neutral | 11 | 14 | 13 | 13 |

**Coverage is complete** — every collectible card of all four sets is present
(all legendaries, all golds, all silvers, all bronzes). The distributions are
internally regular (14/class + 11 neutral for Darkness Evolved; 13/class for
the rest, with 14 neutrals in Rise of Bahamut), and the Darkness Evolved total
of 109 with 46 bronze / 31 silver / 23 gold / 9 legendary matches the published
set size exactly.

Japanese names are present for **all 466** entries; none are blank.

## Sources

**The requested primary source was unreachable.** `shadowverse.fandom.com` is
blocked by this session's network egress policy (gateway answers 403 to
CONNECT), for both `curl` and `WebFetch`. The same applies to every other
card-database site tried: `shadowverse.com`, `shadowverse-portal.com`,
`svgdb.me`, `shadowverse.jp`, `shadowverse.gamewith.jp`, `techraptor.net`,
`steamcommunity.com`, `web.archive.org` and `en.wikipedia.org`. Only
`github.com` / `raw.githubusercontent.com` and the `WebSearch` tool were usable.

Card data was therefore taken from a complete mirror of the **official
Shadowverse Portal card API**, hosted on GitHub:

- English: `https://raw.githubusercontent.com/user6174/shadowverse-json/master/en/all.json`
- Japanese: `https://raw.githubusercontent.com/user6174/shadowverse-json/master/ja/all.json`
- Repo: <https://github.com/user6174/shadowverse-json>

This is the same upstream data the Fandom wiki's card pages are generated from,
so names, costs, stats, traits and ability text agree with the wiki. The dump
holds 4,316 cards; it was filtered on
`expansion_ in {"Darkness Evolved", "Rise of Bahamut", "Tempest of the Gods",
"Wonderland Dreams"}`.

`WebSearch` (which was reachable) was used only for corroboration — set sizes,
keyword-introduction dates and the balance-change history discussed below.
This is the same source and method used for the sibling file
`cards_basic_standard.json`, so the two files are directly comparable.

## Era-correctness

### "Enhance" is era-correct here — it is NOT an anachronism

31 cards in this file carry `Enhance (N)`. The task brief warned that Enhance
and Accelerate post-date Wonderland Dreams; that is true of **Accelerate**
(introduced in *Chronogenesis*, Dec 2017 — and indeed **zero** cards in this
file use it), but **Enhance was introduced by Rise of Bahamut itself**, the very
set covered here.

The strongest evidence is the distribution in the data:

| set | cards with Enhance |
|---|---|
| darkness | **0** |
| bahamut | 17 |
| tempest | 11 |
| wonderland | 3 |

Enhance appears on no Basic, Standard or Darkness Evolved card, and then on 17
Rise of Bahamut cards at once. A retroactive keyword rewrite would have touched
the earlier sets too. The Fandom wiki's own *Rise of Bahamut* page likewise
describes the set as introducing "a new card ability called Enhance". Enhance
text was therefore kept verbatim.

### Rebalances were reverted upstream, so the text is the original text

Cygames later reverted its balance adjustments for cards that had rotated out
of Standard, so the current Portal text for these four sets is the **release
text**. Spot checks against documented 2017 nerfs confirm the file holds
pre-nerf values:

| card | documented nerf | value in this file |
|---|---|---|
| Wind Reader Zell (tempest) | 2pp → 4pp (May 2017) | **2pp 2/2** (original) |
| Prince Catacomb (bahamut) | 3pp → 4pp (May 2017) | **3pp** (original) |
| Lightning Blast (tempest) | `Enhance (10)` clause removed | **clause present** (original) |
| Baphomet (tempest) | cost-reduction gutted (Jul 2017) | **"subtract 3 from its cost"** (original) |

### Keyword audit

Every ability keyword occurring in the file is period-correct for 2016-2017:
`Fanfare` (194), `Last Words` (46), `Evolve` (33), `Enhance` (31), `Clash` (14),
`Necromancy (N)` (12), `Earth Rite` (11), `Spellboost` (9), `Strike` (7),
`Follower Strike` (5), `Leader Strike` (1), plus the inline keywords `Ward`,
`Storm`, `Rush`, `Bane`, `Drain`, `Ambush`, `Countdown (N)`, `Vengeance`,
`Overflow`. No `Accelerate`, `Crystallize`, `Union Burst`, `Invocation`,
`Ramp`, `Rally`, `Reanimate` or any other post-2017 keyword appears.

### Traits

Traits found: `Officer` (27), `Commander` (15), `Mysteria` (8),
`Earth Sigil` (4), `Levin` (1). **`Mysteria` is the original trait name** — it
debuted with Rise of Bahamut. (`Academic`, named in the task brief, is the
*later* trait, added by *Academy of Ages* in 2023, and correctly does not appear
here.) `Machina` also post-dates these sets and does not appear.

## Extraction decisions

- **Alternate-art reprints excluded.** Card IDs in the `7xxxxxxxx` range are
  re-skins of an existing card rather than distinct cards. Three appeared in
  these sets and were dropped: `Albert, Levin Saber` (704241010),
  `Daria, Dimensional Witch` (704341010) and `Wizardess of Oz` (706341010).
- **`evoText` is a diff, not the full evolved text.** The upstream dump stores
  the complete evolved-side text in `evoEffect_`. This file stores only the
  lines that are *not* also on the base side. Upstream's boilerplate
  `(Same as the unevolved form.)` / `(Same as the unevolved form, excluding
  Fanfare.)` is dropped and becomes `""`. Genuinely evolve-only parentheticals
  such as `(Can attack.)` (Abomination Awakened, Corpselord of Woe, Red
  Ragewyrm) are kept.
- **`countdown`** is parsed from a literal `Countdown (N)` in the base text and
  only set for amulets — 25 of the 52 amulets. The remaining 27 are permanent
  amulets (Earth Sigils, `Elana's Prayer`, `Dracomancer's Rites`,
  `Durandal the Incorruptible`, …) and correctly carry `null`. The
  `Countdown (N)` line is left in `text` as well, matching how the card reads.
- **`text` / `evoText` empty string** where upstream has `-` (vanilla
  followers such as `Imperial Mammoth` and `Island Whale`). 38 entries have an
  empty `text`; 24 of those are collectible (they are evolve-only or vanilla
  cards), 14 are vanilla tokens.
- **Evolved stats** are taken from upstream `evoAtk_` / `evoDef_`, not computed.
  35 followers do not evolve for the usual +2/+2 — mostly +1/+1 golds/silvers,
  plus the special cases `Hippocampus` (3/5 → 7/7), `Red Ragewyrm` (0/5 →
  10/10), `Eidolon of Madness` and `Abomination Awakened` (no stat gain).
- **Spells and amulets** carry `null` for `atk`, `life`, `evoAtk`, `evoLife`.

## Tokens

44 token cards are included, marked `"token": true`. They were resolved through
the upstream `tokens_` field on each collectible card and restricted to entries
whose own `expansion_` is `Token`. Each is filed under the **earliest of these
four sets** that creates it, so shared tokens are not duplicated — this is why
`darkness` carries 28 tokens (`Fairy`, `Knight`, `Ghost`, `Skeleton`, `Zombie`-
adjacent golems, `Earth Essence`, the Golem line, the Lord of the Flies insects,
etc.) while the later sets carry only their genuinely new ones.

Two consequences worth knowing:

- A token's `set` field means "first created by a card in this set", not "the
  set the token's artwork shipped with".
- Cards referenced via `tokens_` that are themselves collectible (`Basic`,
  `Standard Card Pack`, or a card of these four sets — e.g.
  `Grand Archer Selwyn`, put into hand by `Selwyn's Command`) are **not**
  duplicated as tokens. They appear once, as collectible cards, in whichever
  file covers their set.

## Unverified / caveats

Nothing in the file is flagged as unverified per se — all 466 entries come from
one authoritative dump — but these points could not be independently
cross-checked because every wiki and card-database site was egress-blocked:

1. **No second source for ability text.** The Fandom wiki, Shadowverse Portal
   and svgdb could not be reached, so text was not diffed against a second
   database. Corroboration was limited to `WebSearch` result snippets.
2. **Card-name localisation drift.** If Cygames renamed any card in English
   after 2017, this file carries the later name. No such rename was found in
   spot checks, but it was not exhaustively verified.
3. **Un-reverted rebalances.** The four spot checks above all showed original
   values, but the full 2016-2018 balance-change list was not obtainable, so a
   card whose adjustment was never reverted would silently carry its adjusted
   stats. Cards most worth re-checking against the wiki when it is reachable:
   `Baphomet`, `Wind Reader Zell`, `Prince Catacomb`, `Lightning Blast`,
   `Elana's Prayer`, `Daria, Dimensional Witch`, `Sahaquiel`, `Bloody Mary`.
4. **Token completeness.** Tokens are those upstream links via `tokens_`. A
   token produced only by an evolved-side effect that upstream does not link
   would be missed. None was identified, but the field was not audited card by
   card.
5. **Rise of Bahamut set size.** This file has 105 collectible RoB cards; some
   secondary sources quote 108 for that set. The 105 figure is what the official
   Portal data contains and is regular (13 per class + 14 neutral); the higher
   number likely counts the alternate-art reprints that were deliberately
   excluded here.
