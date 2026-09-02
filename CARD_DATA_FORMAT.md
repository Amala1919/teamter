# Card data format

Cards are data, not code. A card's behaviour is a tree of `Effect` values that
the engine interprets; there is no per-card branch anywhere in
`src/engine/game.ts`.

## Pipeline

```
.cache/en.json  ┐
                ├─► tools/build-cards.mjs ─► src/data/generated/cards.json
.cache/ja.json  ┘                                      │
                                                       ▼
                                    src/data/compile.ts  (text ─► effects)
                                                       │
                              src/data/overrides.ts ───┤  (hand-written cards)
                                                       ▼
                                                  CardDef[]  ─► registry

tools/build-cardart.mjs ─► src/data/generated/cardart.json  (illustration subjects)
```

`.cache/*.json` are mirrors of the official Shadowverse Portal card API. See
`ASSET_LICENSES.md`. Regenerate with:

```
curl -o .cache/en.json https://raw.githubusercontent.com/user6174/shadowverse-json/master/en/all.json
curl -o .cache/ja.json https://raw.githubusercontent.com/user6174/shadowverse-json/master/ja/all.json
npm run cards:build
```

## The generated record

```jsonc
{
  "id": "dread_dragon",          // engine-facing slug, stable
  "officialId": 102341010,       // Portal card id, for tracing back
  "name": "Dread Dragon",
  "nameJa": "ドレッドドラゴン",
  "cardClass": "dragon",         // forest|sword|rune|dragon|shadow|blood|haven|neutral
  "set": "bahamut",              // basic|standard|darkness|bahamut|tempest|wonderland
  "rarity": "silver",            // bronze|silver|gold|legendary
  "type": "follower",            // follower|spell|amulet
  "cost": 7,
  "atk": 4, "def": 4,
  "evoAtk": 6, "evoDef": 6,      // printed evolved stats, NOT assumed base+2
  "traits": ["Officer"],
  "text": "Fanfare: Deal 4 damage to an enemy follower.",
  "textJa": "…",
  "evoText": "",                 // only what the evolved side adds
  "flavor": "…",
  "flavorJa": "…",
  "evoTextJa": "…",
  "artSeed": 2748193042,         // deterministic seed for the generated art
  "token": false,
  "creates": ["knight"]          // cards this one can put into play or hand
}
```

Tokens are pulled in transitively: anything an in-scope card can create is
present even when the token itself is filed under the "Token" expansion.

Every text field is carried in both languages. Nothing in this project
translates card text: the interface reads whichever field the current language
names (see `src/i18n.ts`).

## The illustration subject map

`src/data/generated/cardart.json` maps every card id to one Game Icons name,
and carries the SVG path data for only the icons actually referenced:

```jsonc
{
  "source": "Game Icons (game-icons.net) via @iconify-json/game-icons",
  "license": "CC BY 3.0",
  "author": "Game-icons.net contributors",
  "url": "https://game-icons.net/",
  "map": { "dread_dragon": "spiked-dragon-head", "banner_forest": "elf-helmet" },
  "icons": { "spiked-dragon-head": { "d": ["M256 …"], "w": 512, "h": 512 } }
}
```

`tools/build-cardart.mjs` chooses each subject in four passes, most specific
first: a proper-noun table (Athena, Bahamut, Cinderella), a hand-authored
noun table matched on whole words longest-first ("dragon knight" beats
"dragon"), the card's tribe, then a curated pool for its class and card type.
The choice is deterministic — a card's subject never changes between runs — and
the script reports any icon name in the tables that does not exist upstream.

The map also covers the non-card art the interface paints through the same
generator: `banner_<class>` for the home screen and `leader_<class>` for the
battle portraits.

## The compiled `CardDef`

`src/data/index.ts` turns each record into a `CardDef` (`src/engine/types.ts`)
by compiling `text`, then merging any override. Added fields:

| Field | Meaning |
|---|---|
| `keywords` | innate keywords parsed from bare lines (`Ward.`, `Storm.`, …) |
| `evoKeywords` | keywords the evolved side adds |
| `abilities` | `{ on: TriggerKind, effects: Effect[], cond?, evolvedOnly? }[]` |
| `auras` | continuous effects, recomputed on every stat read |
| `enhance` | alternative printed costs |
| `spellboostCost` | cost reduction per accumulated Spellboost |
| `targeting` | the target request raised when the card is played |
| `countdown` | for Countdown amulets |
| `implemented` | `false` when some printed line has no implementation |
| `missingText` | the lines that were not understood |

## The effect vocabulary

All defined in `src/engine/types.ts`.

**Effects** — `damage`, `heal`, `destroy`, `banish`, `buff`, `setStats`,
`grant`, `revoke`, `summon`, `transform`, `returnToHand`, `draw`, `discard`,
`toHand`, `searchToHand`, `toDeck`, `gainPP`, `gainMaxPP`, `gainEP`,
`gainShadows`, `spendShadows`, `costMod`, `evolveTarget`, `countdown`,
`spellboost`, `earthRite`, `necromancy`, `if`, `repeat`, `chooseOne`, `store`,
`withTarget`, `freeze`, `untilFull`, `win`, `grantAbility`, `silence`, `noop`.

`withTarget` binds one entity for the effects inside it, which is how "X equals
that follower's defense" can still be read after the follower has been
destroyed. `win` ends the match outright, for Seraph. `grantAbility` hands whole
abilities to other cards; `silence` takes a card's printed abilities, keywords
and auras away, which is what stops Princess Snow White resurrecting herself
forever.

`summon` binds what it summoned as the context's `other`, so "Summon a Pluto and
give **it** +X/+Y" acts on the new follower and not on another copy already in
play.

**Selectors** describe *what* an effect acts on:

```ts
{ scope: 'target' | 'all' | 'random' | 'self' | 'leader' | 'highest' | 'lowest' | 'other',
  side?: 'ally' | 'enemy' | 'both',
  kind?: 'follower' | 'amulet' | 'any',
  count?: number,
  filter?: Filter,          // cost/atk/def bounds, trait, keyword, evolved, damaged…
  includeLeader?: boolean,  // "an enemy" means follower OR leader
  zone?: 'field' | 'hand' | 'deck' | 'cemetery' }
```

**Amounts** can be dynamic: `{ k: 'count', of: Selector }`, `{ k: 'shadows' }`,
`{ k: 'spellboost' }`, `{ k: 'handSize' }`, `{ k: 'cardsPlayed' }`,
`{ k: 'pp' }`, `{ k: 'sum' | 'mul' | 'min' | 'max' }`, and
`{ k: 'statOf', of: Selector, stat: 'atk' | 'def' | 'cost', pick: 'max' | 'min' | 'sum' }`
for "the attack of the strongest enemy follower in play".

**Conditions**: `vengeance`, `overflow`, `resonance`, `hasEarthSigil`,
`hasShadows`, `cardsPlayed`, `opponentTurn`, `exists`, `atLeast`, `isEvolved`,
and the usual `and` / `or` / `not`.

## The text compiler

`src/data/compile.ts` parses printed text compositionally rather than by
whole-sentence template:

```
line  := [trigger prefix] [Necromancy(N)|Earth Rite] sentence+ [condition clause]
sentence := verb object-phrase
object-phrase := determiner [random] [other] [side] [trait] noun [qualifier]
```

So "Deal 3 damage to a random enemy follower with 2 defense or less" and
"Restore 2 defense to an allied Officer follower" share the same object-phrase
grammar rather than needing separate rules.

Modifier lines patch the line above them: `Spellboost: Deal 1 more.` rewrites
the preceding damage amount to `base + 1 × spellboost`; `Necromancy (2): Deal 5
damage instead.` wraps it in a conditional.

### "Instead"

An "instead" clause varies the line before it, and comes in three shapes:

1. **A new number.** "Deal 6 damage instead" rewrites the first damage amount
   in the preceding effects and leaves everything else alone.
2. **A new verb on the same target.** "Banish it instead" — the pronoun
   resolves to the replaced effect's own target *selector*, not to text, so it
   banishes exactly what the transform would have transformed.
3. **A different effect entirely.** "Destroy an enemy follower or amulet
   instead" is compiled as a whole sentence and replaces the base outright.

A conditional instead keeps both branches: the original becomes the `else`.
A bare `<clause> instead.` line varies the line above it, but only when it is a
single sentence with no keyword prefix — otherwise "Necromancy (6): Deal 3
damage instead." would lose its shadow cost.

### Pronouns and "that follower"

Card text refers back constantly, and each reference resolves differently:

| Text | Resolves to |
|---|---|
| "it" in an instead clause | the replaced effect's target selector |
| "it" after a trigger | `scope: 'other'` — the entity the trigger is about |
| "that follower" after "If another allied follower is in play" | the condition's selector, as a target the player picks |
| "that follower's defense" in an X binding | an entity bound by `withTarget`, so the stat survives the follower being destroyed |

The third one matters: compiling it to `scope: 'other'` would have produced a
Fanfare that destroys nothing while looking perfectly implemented.

Current coverage: **79.6% of 888 cards** compile with no unparsed line. Check it
with `npm run cards:report -- --lines`.

## Adding a card by hand

When the compiler cannot express a card, add an entry to
`src/data/overrides.ts`:

```ts
export const OVERRIDES: Record<string, Override> = {
  // "Fanfare: Discard your hand and gain +1/+1 for each card discarded."
  hulking_giant: (base) => ({
    abilities: [
      {
        on: 'fanfare',
        effects: [
          { k: 'store', name: 'n', amount: { k: 'handSize' } },
          { k: 'discard', amount: { k: 'handSize' } },
          { k: 'buff', target: { scope: 'self' },
            atk: { k: 'ctx', name: 'n' }, def: { k: 'ctx', name: 'n' } },
        ],
      },
      ...(base.abilities ?? []),
    ],
  }),
};
```

The override receives the partially-built definition and returns the fields to
merge over it, so it can extend the compiled abilities rather than replacing
them. Overriding a card clears its `implemented: false` flag, so only add one
once the card genuinely works — and add a test in `tests/` for anything with
non-obvious timing.

## Adding a new effect kind

1. Add the variant to `Effect` in `src/engine/types.ts`.
2. Handle it in `Game.runEffect`.
3. If it can raise a target request, add it to `findTargetSelector` in
   `compile.ts`.
4. Teach the compiler to produce it, if the printed wording is regular.
5. Add a test.
