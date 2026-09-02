/**
 * The card-text compiler.
 *
 * These assert the *shape* the compiler produces, not just that a card ends up
 * marked implemented: an "instead" clause that silently loses its condition, or
 * a stat read that is not bound to the entity it names, both still produce a
 * card that looks finished and plays wrong.
 */
import { describe, expect, it } from 'vitest';
import { Game } from '../src/engine/game';
import { loadCards } from '../src/data/index';
import { getCard } from '../src/engine/registry';
import { buildStarterDeck } from '../src/data/decks';
import { compileCardText } from '../src/data/compile';
import { RULES, type Effect } from '../src/engine/types';

loadCards();

/** All effects in a tree, flattened, so a test can look for one by kind. */
function flatten(effects: Effect[]): Effect[] {
  const out: Effect[] = [];
  const walk = (list: Effect[]) => {
    for (const e of list) {
      out.push(e);
      if (e.k === 'if') walk([...e.then, ...(e.else ?? [])]);
      else if (e.k === 'repeat') walk(e.body);
      else if (e.k === 'withTarget') walk(e.body);
      else if (e.k === 'untilFull') walk(e.body);
      else if (e.k === 'necromancy' || e.k === 'earthRite') walk([...e.then, ...(e.else ?? [])]);
    }
  };
  walk(effects);
  return out;
}

function abilityEffects(id: string): Effect[] {
  return (getCard(id).abilities ?? []).flatMap((a) => a.effects);
}

describe('"instead" clauses', () => {
  it('keeps both branches when the variation is conditional', () => {
    // "Deal 3 damage to an enemy follower." / "Deal 6 damage instead if
    // Vengeance is active for you."
    const [eff] = abilityEffects('blood_rage');
    expect(eff.k).toBe('if');
    if (eff.k !== 'if') return;
    expect(eff.cond).toEqual({ k: 'vengeance' });
    expect(flatten(eff.then).find((e) => e.k === 'damage')).toMatchObject({ amount: 6 });
    expect(eff.else && flatten(eff.else).find((e) => e.k === 'damage')).toMatchObject({ amount: 3 });
  });

  it('resolves a pronoun to the replaced effect’s own target', () => {
    // "Transform an enemy follower or amulet into a Clay Golem." /
    // "Earth Rite: Banish it instead." — "it" is that same follower.
    const [eff] = abilityEffects('petrification');
    expect(eff.k).toBe('earthRite');
    if (eff.k !== 'earthRite') return;
    const banish = eff.then.find((e) => e.k === 'banish');
    const transform = eff.else?.find((e) => e.k === 'transform');
    expect(banish).toBeDefined();
    expect(transform).toBeDefined();
    if (banish?.k !== 'banish' || transform?.k !== 'transform') return;
    expect(banish.target).toEqual(transform.target);
  });

  it('replaces the whole effect when the clause is a different verb', () => {
    // "Destroy an enemy follower that costs 3 play points or less." /
    // "Enhance (5): Destroy an enemy follower or amulet instead."
    const card = getCard('rite_of_exorcism');
    const enh = card.enhance?.find((e) => e.cost === 5);
    expect(enh).toBeDefined();
    const destroy = flatten(enh!.effects).find((e) => e.k === 'destroy');
    expect(destroy).toMatchObject({ target: { kind: 'any', side: 'enemy' } });
    // The printed line, not the Enhance body, is what the base ability does.
    expect(flatten(abilityEffects('rite_of_exorcism')).find((e) => e.k === 'destroy')).toMatchObject({
      target: { filter: { costMax: 3 } },
    });
  });

  it('does not swallow a keyword line that merely ends in "instead"', () => {
    // "Necromancy (6): Deal 3 damage instead." is a Necromancy upgrade, not a
    // bare instead line; it has to keep its shadow cost.
    const [eff] = abilityEffects('foul_tempest');
    expect(flatten([eff]).some((e) => e.k === 'necromancy')).toBe(true);
  });
});

describe('"X equals ..." amounts', () => {
  it('reads a stat off the strongest follower in play', () => {
    // Hamsa: "Fanfare: Gain +X/+0. X equals the attack of the strongest enemy
    // follower in play."
    const buff = flatten(abilityEffects('hamsa')).find((e) => e.k === 'buff');
    expect(buff).toMatchObject({
      atk: { k: 'statOf', stat: 'atk', pick: 'max', of: { side: 'enemy', kind: 'follower' } },
    });
  });

  it('binds "that follower" so the stat survives the follower being destroyed', () => {
    // Dark Offering: "Destroy an allied follower. Restore X defense to your
    // leader and draw X cards. X equals that follower's defense." Reading the
    // defense after the destroy only works inside a withTarget.
    const [eff] = abilityEffects('dark_offering');
    expect(eff.k).toBe('withTarget');
    if (eff.k !== 'withTarget') return;
    expect(eff.body.map((e) => e.k)).toEqual(['destroy', 'heal', 'draw']);
    expect(eff.target).toMatchObject({ side: 'ally', kind: 'follower' });
  });

  it('binds "that follower" across two printed lines', () => {
    // Acolyte's Light prints the banish and the heal on separate lines.
    const effects = abilityEffects('acolytes_light');
    const bound = effects.find((e) => e.k === 'withTarget');
    expect(bound).toBeDefined();
    if (bound?.k !== 'withTarget') return;
    expect(bound.body.map((e) => e.k)).toEqual(['banish', 'heal']);
    expect(bound.target).not.toMatchObject({ scope: 'leader' });
  });
});

describe('new trigger kinds fire on the right event', () => {
  /** A game with full play points and evolution available for seat 0. */
  function ready(cls: Parameters<typeof buildStarterDeck>[0]): Game {
    const g = new Game([buildStarterDeck(cls, 5), buildStarterDeck('shadow', 6)], {
      seed: 77,
      first: 0,
      skipMulligan: true,
    });
    const me = g.player(0);
    me.pp = RULES.MAX_PP;
    me.maxPp = RULES.MAX_PP;
    me.ep = 2;
    me.shadows = 30;
    return g;
  }

  it('"whenever another follower evolves" sees the opponent evolve too', () => {
    // Elf Bard: "Whenever another follower evolves, put a Fairy into your hand."
    const g = ready('forest');
    g.summonToken('elf_bard', 0, false);
    const foe = g.summonToken('goblin', 1, false);
    expect(foe).not.toBeNull();
    const before = g.player(0).hand.length;
    expect(g.forceEvolve(foe!.uid)).toBe(true);
    expect(g.player(0).hand.length).toBe(before + 1);
  });

  it('separates "another follower" from "an allied follower"', () => {
    const ctx = { names: new Map<string, string>(), selfType: 'follower' as const, selfId: 'x' };
    const any = compileCardText('Whenever another follower evolves, draw a card.', ctx);
    const ally = compileCardText('Whenever an allied follower evolves, draw a card.', ctx);
    expect(any.abilities[0]?.on).toBe('onEvolveAny');
    expect(ally.abilities[0]?.on).toBe('onEvolveAlly');
    expect(getCard('elf_bard').abilities?.some((a) => a.on === 'onEvolveAny')).toBe(true);
  });

  it('"whenever an enemy follower is destroyed during your turn" is turn-gated', () => {
    const ability = getCard('professor_of_taboos').abilities?.find(
      (a) => a.on === 'onEnemyFollowerDestroyed',
    );
    expect(ability?.cond).toEqual({ k: 'not', c: { k: 'opponentTurn' } });
  });

  it('a discard trigger sees how many cards were discarded', () => {
    // Dracomancer's Rites: "Whenever you discard cards from your hand, draw X
    // cards. X equals the number of cards discarded."
    const ability = getCard('dracomancers_rites').abilities?.find((a) => a.on === 'onDiscard');
    expect(ability).toBeDefined();
    const draw = flatten(ability!.effects).find((e) => e.k === 'draw');
    expect(draw).toMatchObject({ amount: { k: 'ctx', name: 'discarded' } });
  });
});

describe('sentence forms the printed text keeps using', () => {
  const ctx = () => ({ names: new Map<string, string>(), selfType: 'follower' as const, selfId: 'x' });

  it('reads a stat change in either word order, and either sign', () => {
    const a = compileCardText('Fanfare: Give all other allied followers +0/+1.', ctx());
    const b = compileCardText('Fanfare: Give +0/+1 to all other allied followers.', ctx());
    expect(a.unparsed).toEqual([]);
    expect(a.abilities[0].effects).toEqual(b.abilities[0].effects);

    const debuff = compileCardText('Fanfare: Give an enemy follower -2/-0.', ctx());
    expect(debuff.abilities[0].effects[0]).toMatchObject({ k: 'buff', atk: -2, def: 0 });
  });

  it('folds a "Select ..." sentence into the one that acts on it', () => {
    // Fen Sprite prints the selection and the effect as two sentences.
    const r = compileCardText("Fanfare: Select an enemy follower. It can't attack next turn.", ctx());
    expect(r.unparsed).toEqual([]);
    expect(r.abilities[0].effects[0]).toMatchObject({
      k: 'freeze',
      target: { scope: 'target', side: 'enemy', kind: 'follower' },
    });
  });

  it('points "that follower" at the follower the condition named', () => {
    // Necroassassin: "If another allied follower is in play, destroy that
    // follower ..." — the player picks which. Compiling this to the trigger's
    // `other` binding would destroy nothing at all in a Fanfare.
    const destroy = flatten(abilityEffects('necroassassin')).find((e) => e.k === 'destroy');
    expect(destroy).toMatchObject({
      target: { scope: 'target', side: 'ally', kind: 'follower', filter: { notSelf: true } },
    });
    expect(getCard('necroassassin').targeting?.selector).toMatchObject({ scope: 'target', side: 'ally' });
  });

  it('narrows a "lowest-cost" discard to the cheapest cards', () => {
    const eff = flatten(abilityEffects('golden_dragons_den')).find((e) => e.k === 'discard');
    expect(eff).toMatchObject({ pick: 'lowestCost', random: true });
  });

  it('compares the two leaders for "if their defense is higher than yours"', () => {
    const [eff] = abilityEffects('succubus');
    expect(eff.k).toBe('if');
    if (eff.k !== 'if') return;
    expect(eff.cond).toEqual({
      k: 'greater',
      a: { k: 'leaderDefense', side: 'enemy' },
      b: { k: 'leaderDefense', side: 'ally' },
    });
  });
});

describe('the compiled cards actually run', () => {
  const ids = [
    'blood_rage',
    'petrification',
    'rite_of_exorcism',
    'dark_offering',
    'acolytes_light',
    'hamsa',
    'serpent_force',
    'glimmering_wings',
    'wrath_drake',
    'pure_healer',
    'swords_to_woodlands',
    'calamitous_curse',
    'secrets_of_erasmus',
    'fangblade_slayer',
    'necroassassin',
    'dolorblade_warrior',
    'mad_hatter',
    'fen_sprite',
    'cybele',
    'golden_dragons_den',
    'succubus',
    'rahab',
    'sky_sprite',
    'elder_tortoise',
  ];

  for (const id of ids) {
    it(`resolves ${id}`, () => {
      const card = getCard(id);
      const cls = card.cardClass === 'neutral' ? 'sword' : card.cardClass;
      const g = new Game([buildStarterDeck(cls, 7), buildStarterDeck('shadow', 11)], {
        seed: 909,
        first: 0,
        skipMulligan: true,
      });
      const me = g.player(0);
      me.pp = RULES.MAX_PP;
      me.maxPp = RULES.MAX_PP;
      me.shadows = 30;
      g.summonToken('goblin', 1, false);
      g.summonToken('goblin', 1, false);
      g.summonToken('goblin', 0, false);

      const uid = g.addToHand(0, id);
      expect(uid).not.toBeNull();
      const spec = card.targeting;
      const targets = spec
        ? g.legalTargets(spec.selector, 0, g.ent(uid!)).slice(0, spec.count ?? 1)
        : [];
      expect(() => g.playCard(uid!, targets)).not.toThrow();
      g.checkState();
      // Nothing may end up in two zones or over a limit.
      for (const p of [0, 1] as const) {
        const ps = g.player(p);
        const all = [...ps.deck, ...ps.hand, ...ps.field, ...ps.cemetery, ...ps.banished];
        expect(new Set(all).size).toBe(all.length);
        expect(ps.field.length).toBeLessThanOrEqual(RULES.BOARD_LIMIT);
      }
    });
  }
});
