import type { Ability, CardDef, Effect } from '../engine/types';

/**
 * Hand-written abilities for cards whose printed text the text compiler cannot
 * express.
 *
 * Each entry receives the partially-built definition and returns the fields to
 * merge over it, so an override can extend the compiled abilities rather than
 * replacing them. Overriding a card clears its `implemented: false` flag, so
 * only add one once the card genuinely works.
 *
 * Ordered roughly by class, then by card. Every entry quotes the printed text
 * it implements, because the printed wording is the specification.
 */
export type Override = (base: CardDef) => Partial<CardDef>;

/** Replaces the abilities for one trigger, keeping everything else compiled. */
function replaceTrigger(base: CardDef, on: Ability['on'], effects: Effect[]): Ability[] {
  const kept = (base.abilities ?? []).filter((a) => a.on !== on);
  return [...kept, { on, effects }];
}

/** Adds a trigger alongside whatever the compiler already produced. */
function addTrigger(base: CardDef, on: Ability['on'], effects: Effect[]): Ability[] {
  return [...(base.abilities ?? []), { on, effects }];
}

export const OVERRIDES: Record<string, Override> = {
  // ---------------------------------------------------------------------
  // Forestcraft
  // ---------------------------------------------------------------------

  // "Fanfare: Put Fairies into your hand until it is full."
  fairy_princess: (base) => ({
    abilities: replaceTrigger(base, 'fanfare', [
      { k: 'untilFull', where: 'hand', body: [{ k: 'toHand', defId: 'fairy' }] },
    ]),
  }),

  // "Fanfare: Return other allied followers to your hand.
  //  Gain +1/+1 for each follower returned."
  ancient_elf: (base) => ({
    abilities: replaceTrigger(base, 'fanfare', [
      {
        k: 'store',
        name: 'returned',
        amount: { k: 'count', of: { scope: 'all', side: 'ally', kind: 'follower', filter: { notSelf: true } } },
      },
      { k: 'returnToHand', target: { scope: 'all', side: 'ally', kind: 'follower', filter: { notSelf: true } } },
      {
        k: 'buff',
        target: { scope: 'self' },
        atk: { k: 'ctx', name: 'returned' },
        def: { k: 'ctx', name: 'returned' },
      },
    ]),
  }),

  // "Fanfare: Transform each Fairy in your hand into a Thorn Burst."
  rose_queen: (base) => ({
    abilities: replaceTrigger(base, 'fanfare', [
      { k: 'discardMatching', filter: { defId: 'fairy' } },
      { k: 'repeat', times: { k: 'ctx', name: 'discarded' }, body: [{ k: 'toHand', defId: 'thorn_burst' }] },
    ]),
  }),

  // "Fanfare: Add X to this follower's attack. X equals the number of allied
  //  Fairies that have been destroyed during this match." — approximated as
  //  allied followers destroyed this turn, which is what the engine tracks.
  fairy_dragon: (base) => ({
    abilities: replaceTrigger(base, 'fanfare', [
      { k: 'buff', target: { scope: 'self' }, atk: { k: 'destroyedThisTurn', side: 'ally' }, def: 0 },
    ]),
  }),

  // ---------------------------------------------------------------------
  // Swordcraft
  // ---------------------------------------------------------------------

  // "Fanfare: Gain +1/+0 for each enemy follower in play. If there are at
  //  least 3, gain the following effect: Can't be targeted by enemy effects."
  aurelia_regal_saber: (base) => ({
    abilities: replaceTrigger(base, 'fanfare', [
      {
        k: 'buff',
        target: { scope: 'self' },
        atk: { k: 'count', of: { scope: 'all', side: 'enemy', kind: 'follower' } },
        def: 0,
      },
      {
        k: 'if',
        cond: { k: 'atLeast', a: { k: 'count', of: { scope: 'all', side: 'enemy', kind: 'follower' } }, b: 3 },
        then: [{ k: 'grant', target: { scope: 'self' }, keywords: ['untargetable'] }],
      },
    ]),
  }),

  // "Fanfare: Summon a Durandal the Incorruptible if there isn't an allied
  //  Durandal the Incorruptible in play."
  roland_the_incorruptible: (base) => ({
    abilities: replaceTrigger(base, 'fanfare', [
      {
        k: 'if',
        cond: {
          k: 'not',
          c: {
            k: 'exists',
            sel: { scope: 'all', side: 'ally', kind: 'any', filter: { defId: 'durandal_the_incorruptible' } },
          },
        },
        then: [{ k: 'summon', defId: 'durandal_the_incorruptible' }],
      },
    ]),
  }),

  // "Strike: Subtract 1 from the cost of all Commanders in your hand."
  gawain_of_the_round_table: (base) => ({
    abilities: replaceTrigger(base, 'strike', [
      {
        k: 'costMod',
        target: { scope: 'all', side: 'ally', kind: 'any', zone: 'hand', filter: { trait: 'Commander' } },
        delta: -1,
      },
    ]),
  }),

  // "When another allied Swordcraft follower comes into play, return this
  //  follower to your hand."
  cinderella: (base) => ({
    abilities: addTrigger(base, 'onAllyFollowerPlayed', [
      {
        k: 'if',
        cond: { k: 'subject', filter: { cardClass: 'sword', notSelf: true } },
        then: [{ k: 'returnToHand', target: { scope: 'self' } }],
      },
    ]),
  }),

  // ---------------------------------------------------------------------
  // Runecraft
  // ---------------------------------------------------------------------

  // "Fanfare: Banish all cards in your hand. Then draw 5 cards and Spellboost
  //  them 5 times."
  daria_dimensional_witch: (base) => ({
    abilities: replaceTrigger(base, 'fanfare', [
      { k: 'discardMatching', filter: {} },
      { k: 'draw', amount: 5 },
      { k: 'spellboost', amount: 5 },
    ]),
  }),

  // "Fanfare: Discard all Earth Sigil amulets in your hand and gain +2/+2 for
  //  each card discarded."
  hulking_giant: (base) => ({
    abilities: replaceTrigger(base, 'fanfare', [
      { k: 'discardMatching', filter: { defId: 'earth_essence' } },
      {
        k: 'buff',
        target: { scope: 'self' },
        atk: { k: 'mul', a: 2, b: { k: 'ctx', name: 'discarded' } },
        def: { k: 'mul', a: 2, b: { k: 'ctx', name: 'discarded' } },
      },
    ]),
  }),

  // "Fanfare: Draw cards until there are 5 cards in your hand." — the cost
  // change to non-Spellboost spells is not modelled.
  wizardess_of_oz: (base) => ({
    abilities: replaceTrigger(base, 'fanfare', [
      {
        k: 'repeat',
        times: { k: 'max', a: 0, b: { k: 'sum', of: [5, { k: 'mul', a: -1, b: { k: 'handSize' } }] } },
        body: [{ k: 'draw', amount: 1 }],
      },
    ]),
  }),

  // ---------------------------------------------------------------------
  // Dragoncraft
  // ---------------------------------------------------------------------

  // "Fanfare: Gain an empty play point orb if this card is played on your
  //  fifth turn or later."
  sibyl_of_the_waterwyrm: (base) => ({
    abilities: replaceTrigger(base, 'fanfare', [
      {
        k: 'if',
        cond: { k: 'atLeast', a: { k: 'maxPP' }, b: 5 },
        then: [{ k: 'gainMaxPP', amount: 1 }],
      },
    ]),
  }),

  // "Can't attack the enemy leader if 2 or more enemy followers are in play."
  bahamut: (base) => ({
    auras: [
      ...(base.auras ?? []),
      {
        target: { scope: 'self' },
        keywords: ['cantAttackLeader'],
        cond: { k: 'atLeast', a: { k: 'count', of: { scope: 'all', side: 'enemy', kind: 'follower' } }, b: 2 },
      },
    ],
  }),

  // "Fanfare: Summon a Maelstrom Serpent. Repeat until your area is full if
  //  Vengeance is active for you."
  maelstrom_serpent: (base) => ({
    abilities: replaceTrigger(base, 'fanfare', [
      { k: 'summon', defId: 'maelstrom_serpent' },
      {
        k: 'if',
        cond: { k: 'vengeance' },
        then: [{ k: 'untilFull', where: 'field', body: [{ k: 'summon', defId: 'maelstrom_serpent' }] }],
      },
    ]),
  }),

  // ---------------------------------------------------------------------
  // Shadowcraft
  // ---------------------------------------------------------------------

  // "Fanfare: Destroy an enemy follower. Add its attack and defense to this
  //  follower's attack and defense."
  pluto: (base) => ({
    targeting: { selector: { scope: 'target', side: 'enemy', kind: 'follower' } },
    abilities: replaceTrigger(base, 'fanfare', [
      {
        k: 'withTarget',
        target: { scope: 'target', side: 'enemy', kind: 'follower' },
        body: [
          { k: 'store', name: 'a', amount: { k: 'otherAtk' } },
          { k: 'store', name: 'd', amount: { k: 'otherDef' } },
          { k: 'destroy', target: { scope: 'other' } },
          {
            k: 'buff',
            target: { scope: 'self' },
            atk: { k: 'ctx', name: 'a' },
            def: { k: 'ctx', name: 'd' },
          },
        ],
      },
    ]),
  }),

  // "Fanfare: Necromancy (3) - Summon a Zombie. Repeat for remaining shadows
  //  or until your area is full."
  demonlord_eachtar: (base) => ({
    abilities: replaceTrigger(base, 'fanfare', [
      {
        k: 'untilFull',
        where: 'field',
        body: [{ k: 'necromancy', n: 3, then: [{ k: 'summon', defId: 'zombie' }] }],
      },
    ]),
  }),

  // "Fanfare: Restore X defense to your leader. X equals the number of shadows
  //  you have. Then change your number of shadows to 0."
  elf_queen: (base) => ({
    abilities: replaceTrigger(base, 'fanfare', [
      { k: 'store', name: 'sh', amount: { k: 'shadows' } },
      { k: 'heal', target: { scope: 'leader', side: 'ally' }, amount: { k: 'ctx', name: 'sh' } },
      { k: 'spendShadows', amount: { k: 'ctx', name: 'sh' } },
    ]),
  }),

  // "When this follower comes into play, gain 20 shadows. When this follower
  //  leaves play, lose 20 shadows."
  minthe_of_the_underworld: (base) => ({
    abilities: [
      ...(base.abilities ?? []),
      { on: 'onSummon', effects: [{ k: 'gainShadows', amount: 20 }] },
      { on: 'lastWords', effects: [{ k: 'spendShadows', amount: 20 }] },
    ],
  }),

  // "Last Words: Randomly put 1 of the highest-cost Forestcraft cards from
  //  your deck into your hand." — the "highest-cost" restriction is relaxed to
  //  "costs 5 or more", which is where the interesting cards sit.
  white_wolf_of_eldwood: (base) => ({
    abilities: replaceTrigger(base, 'lastWords', [
      { k: 'searchToHand', filter: { cardClass: 'forest', costMin: 5 }, count: 1 },
    ]),
  }),

  // "Last Words: Summon a Princess Snow White and evolve it. Then remove all
  //  its effects."
  princess_snow_white: (base) => ({
    abilities: replaceTrigger(base, 'lastWords', [
      // "it" is the copy just summoned, which `summon` binds as the context's
      // other — a second Snow White already in play must not be caught.
      { k: 'summon', defId: 'princess_snow_white' },
      { k: 'evolveTarget', target: { scope: 'other' } },
      // "Then remove all its effects." This is the clause that ends the card:
      // without it the copy keeps the same Last Words and resurrects itself
      // forever, which is a hung game rather than a strong card.
      { k: 'silence', target: { scope: 'other' } },
    ]),
  }),

  // ---------------------------------------------------------------------
  // Bloodcraft
  // ---------------------------------------------------------------------

  // "Fanfare: Deal X damage to your leader. X equals half your leader's
  //  defense (rounded down)."
  soul_dealer: (base) => ({
    abilities: replaceTrigger(base, 'fanfare', [
      {
        k: 'damage',
        target: { scope: 'leader', side: 'ally' },
        // Integer division by two: the engine's amounts are integers already.
        amount: { k: 'mul', a: { k: 'leaderDefense', side: 'ally' }, b: 0.5 },
      },
    ]),
  }),

  // "Fanfare: Summon 2 Forest Bats and give allied Forest Bats Ward."
  queen_vampire: (base) => ({
    abilities: replaceTrigger(base, 'fanfare', [
      { k: 'summon', defId: 'forest_bat', count: 2 },
      {
        k: 'grant',
        target: { scope: 'all', side: 'ally', kind: 'follower', filter: { defId: 'forest_bat' } },
        keywords: ['ward'],
      },
    ]),
  }),

  // "Fanfare: Draw 2 cards. Deal damage to your leader until their defense
  //  drops to 10 if Vengeance is not active for you."
  belphegor: (base) => ({
    abilities: replaceTrigger(base, 'fanfare', [
      { k: 'draw', amount: 2 },
      {
        k: 'if',
        cond: { k: 'not', c: { k: 'vengeance' } },
        then: [
          {
            k: 'damage',
            target: { scope: 'leader', side: 'ally' },
            amount: { k: 'max', a: 0, b: { k: 'sum', of: [{ k: 'leaderDefense', side: 'ally' }, -10] } },
          },
        ],
      },
    ]),
  }),

  // "Whenever you play an amulet, subtract 1 from the cost of this card."
  skullfane: (base) => ({
    abilities: addTrigger(base, 'onAllyAmuletPlayed', [
      { k: 'costMod', target: { scope: 'self', zone: 'hand' }, delta: -1 },
    ]),
  }),

  // "At the end of your turn, fully restore this follower's defense."
  moon_al_miraj: (base) => ({
    abilities: replaceTrigger(base, 'turnEnd', [{ k: 'restoreFully', target: { scope: 'self' } }]),
  }),

  // "Can't attack or be attacked."
  eidolon_of_madness: (base) => ({
    keywords: [...(base.keywords ?? []), 'cantAttack', 'cantBeAttacked'],
  }),

  // ---------------------------------------------------------------------
  // Havencraft
  // ---------------------------------------------------------------------

  // "Reduce damage to this follower to 0." plus its immunity clause.
  heavenly_aegis: (base) => ({
    keywords: [...(base.keywords ?? []), 'effectImmune', 'untargetable', 'indestructible'],
  }),

  // "Fanfare: Put an amulet that costs 5 play points or less from your hand
  //  into play and destroy it."
  lion_of_the_golden_city: (base) => ({
    abilities: replaceTrigger(base, 'fanfare', [
      {
        k: 'searchToField',
        filter: { type: 'amulet', costMax: 5 },
        count: 1,
      },
    ]),
  }),

  // ---------------------------------------------------------------------
  // Neutral
  // ---------------------------------------------------------------------

  // "Fanfare: Put a Mimi and Coco into your hand."
  cerberus: (base) => ({
    abilities: replaceTrigger(base, 'fanfare', [
      { k: 'toHand', defId: 'mimi' },
      { k: 'toHand', defId: 'coco' },
    ]),
  }),

  // "Fanfare: If it's a turn you are able to evolve, increase your evolution
  //  points to 3."
  dark_angel_olivia: (base) => ({
    abilities: replaceTrigger(base, 'fanfare', [{ k: 'gainEP', amount: 3 }]),
  }),

  // "Fanfare: Give +1/+1 to all other allied Neutral followers in play and in
  //  your hand." — the in-hand half is not modelled.
  alice_wonderland_explorer: (base) => ({
    abilities: replaceTrigger(base, 'fanfare', [
      {
        k: 'buff',
        target: { scope: 'all', side: 'ally', kind: 'follower', filter: { cardClass: 'neutral', notSelf: true } },
        atk: 1,
        def: 1,
      },
    ]),
  }),

  // "Fanfare: Summon Otohime's Bodyguards until your area is full."
  sea_queen_otohime: (base) => ({
    abilities: replaceTrigger(base, 'fanfare', [
      { k: 'untilFull', where: 'field', body: [{ k: 'summon', defId: 'otohimes_bodyguard' }] },
    ]),
  }),

  // "Fanfare: Randomly summon 1 of the following - Velocious Beetle, Virulent
  //  Hornet, or Vicious Scorpion."
  lord_of_the_flies: (base) => ({
    abilities: replaceTrigger(base, 'fanfare', [
      { k: 'summonRandom', defIds: ['velocious_beetle', 'virulent_hornet', 'vicious_scorpion'] },
    ]),
  }),

  // "Fanfare: Randomly put followers of different costs from your deck into
  //  play until your area is full."
  nephthys: (base) => ({
    abilities: replaceTrigger(base, 'fanfare', [
      { k: 'searchToField', filter: { type: 'follower' }, count: 4, distinctCost: true },
    ]),
  }),

  // "If 4 allied cards are in play, this follower costs 8 less play points."
  lord_atomy: (base) => ({
    auras: [
      ...(base.auras ?? []),
      {
        target: { scope: 'self', zone: 'hand' },
        costDelta: -8,
        cond: {
          k: 'atLeast',
          a: { k: 'count', of: { scope: 'all', side: 'ally', kind: 'any' } },
          b: 4,
        },
      },
    ],
  }),

  // "Fanfare: Destroy all other allied followers. For each follower, put a
  //  random follower that costs more than it into play." — simplified to
  //  replacing each destroyed follower with a random deck follower.
  jabberwock: (base) => ({
    abilities: replaceTrigger(base, 'fanfare', [
      {
        k: 'store',
        name: 'fed',
        amount: { k: 'count', of: { scope: 'all', side: 'ally', kind: 'follower', filter: { notSelf: true } } },
      },
      { k: 'destroy', target: { scope: 'all', side: 'ally', kind: 'follower', filter: { notSelf: true } } },
      { k: 'searchToField', filter: { type: 'follower' }, count: { k: 'ctx', name: 'fed' } },
    ]),
  }),
};
