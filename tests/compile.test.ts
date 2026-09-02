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
