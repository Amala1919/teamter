/**
 * Card-text compiler.
 *
 * Shadowverse's rules text is highly templated, so rather than hand-writing a
 * script per card we parse the printed text into the engine's effect DSL. The
 * grammar is compositional — a trigger prefix, a verb, an object phrase and an
 * optional condition clause — which covers far more of the card pool than a
 * flat table of whole-sentence templates would.
 *
 * Anything the grammar cannot express is reported in `unparsed`, and
 * `src/data/overrides.ts` supplies hand-written abilities for those cards.
 * `npm run cards:report -- --lines` prints what is still missing.
 */
import type {
  Ability,
  Amount,
  AuraDef,
  Condition,
  Effect,
  EnhanceMode,
  Keyword,
  Selector,
  TargetSpec,
  TriggerKind,
} from '../engine/types';

export interface CompileCtx {
  /** Card name -> engine id, for "Summon a Knight" style references. */
  names: Map<string, string>;
  selfType: 'follower' | 'spell' | 'amulet';
  selfId: string;
  /** Value bound by an "X equals ..." sentence on the current line. */
  x?: Amount;
  /**
   * Set when the line's X reads a stat off "that follower" — the thing an
   * earlier sentence acted on. Those effects have to be wrapped in `withTarget`
   * so the entity is still readable after it has been destroyed or banished.
   */
  usesOther?: boolean;
}

export interface CompileResult {
  keywords: Keyword[];
  abilities: Ability[];
  auras: AuraDef[];
  enhance: EnhanceMode[];
  spellboostCost?: number;
  unparsed: string[];
  /** Lines recognised as reminder text and deliberately ignored. */
  ignored: string[];
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const NUM_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

function num(s: string | undefined, fallback = 1): number {
  if (s === undefined) return fallback;
  const t = s.trim().toLowerCase();
  if (t in NUM_WORDS) return NUM_WORDS[t];
  const n = parseInt(t, 10);
  return Number.isNaN(n) ? fallback : n;
}

const KEYWORD_WORDS: Record<string, Keyword> = {
  ward: 'ward',
  storm: 'storm',
  rush: 'rush',
  bane: 'bane',
  drain: 'drain',
  ambush: 'ambush',
};

const KW_ALT = 'ward|storm|rush|bane|drain|ambush';

/**
 * Phrases that cards use to describe a granted property. Card text writes
 * these out longhand ("the following effect - Can't be targeted by enemy
 * effects") rather than as a keyword, so they are matched as whole phrases.
 */
const EFFECT_PHRASES: [RegExp, Keyword][] = [
  [/^can't be targeted by enemy (?:effects|spells)$/i, 'untargetable'],
  [/^reduce damage (?:from effects )?to 0$/i, 'effectImmune'],
  [/^can't be destroyed by effects$/i, 'indestructible'],
  [/^can't be attacked$/i, 'cantBeAttacked'],
  [/^can't attack$/i, 'cantAttack'],
  [/^can't attack the enemy leader$/i, 'cantAttackLeader'],
  [/^ignore ward$/i, 'ignoreWard'],
];

function phraseKeyword(text: string): Keyword | null {
  const t = tidy(text);
  for (const [re, kw] of EFFECT_PHRASES) if (re.test(t)) return kw;
  const bare = t.toLowerCase();
  return bare in KEYWORD_WORDS ? KEYWORD_WORDS[bare] : null;
}

function tidy(s: string): string {
  return s.replace(/\s+/g, ' ').replace(/[.\s]+$/, '').trim();
}

const TRAIT_WORDS = ['Officer', 'Commander', 'Levin', 'Machina', 'Academic', 'Mysteria', 'Wonderland'];

/** Resolves a printed card name — including plurals — to an engine id. */
function cardId(name: string, ctx: CompileCtx): string | null {
  const key = tidy(name);
  const candidates = [
    key,
    key.replace(/ies$/, 'y'),
    key.replace(/ves$/, 'f'),
    key.replace(/([^s])s$/, '$1'),
    key.replace(/es$/, ''),
  ];
  for (const c of candidates) {
    const id = ctx.names.get(c);
    if (id) return id;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Object phrases -> selectors
// ---------------------------------------------------------------------------

/**
 * Parses phrases such as "all other allied Officer followers with Ward" into a
 * selector. Returns null when the phrase is outside the grammar.
 */
export function parseSelector(raw: string, _ctx?: CompileCtx): Selector | null {
  let s = tidy(raw).toLowerCase();
  if (!s) return null;

  if (/^(this (follower|card|amulet)|itself)$/.test(s)) return { scope: 'self' };
  if (/^it$/.test(s)) return { scope: 'other' };
  if (/^(the )?enemy leader$/.test(s)) return { scope: 'leader', side: 'enemy' };
  if (/^your leader$/.test(s)) return { scope: 'leader', side: 'ally' };
  if (/^(each|both|all) leaders?$/.test(s)) return { scope: 'leader', side: 'both' };
  if (/^(the enemy follower|that follower|it)$/.test(s)) return { scope: 'other' };
  if (/^all allies and enemies$/.test(s)) {
    return { scope: 'all', side: 'both', kind: 'follower', includeLeader: true };
  }
  if (/^all (followers|other followers)$/.test(s)) {
    const sel: Selector = { scope: 'all', side: 'both', kind: 'follower' };
    if (s.includes('other')) sel.filter = { notSelf: true };
    return sel;
  }

  const filter: Record<string, unknown> = {};

  // Trailing qualifiers, peeled off before the head noun is read.
  const trailing: [RegExp, (m: RegExpMatchArray) => void][] = [
    [/ with (\d+) defense or less$/, (m) => void (filter.defMax = num(m[1]))],
    [/ with (?:at least )?(\d+) defense(?: or more)?$/, (m) => void (filter.defMin = num(m[1]))],
    [/ with (\d+) attack or less$/, (m) => void (filter.atkMax = num(m[1]))],
    [/ with (?:at least )?(\d+) attack(?: or more)?$/, (m) => void (filter.atkMin = num(m[1]))],
    [new RegExp(` with (${KW_ALT})$`), (m) => void (filter.hasKeyword = KEYWORD_WORDS[m[1]])],
    [/ that costs? (\d+) (?:play points? )?or less$/, (m) => void (filter.costMax = num(m[1]))],
    [/ that costs? (\d+) (?:play points? )?or more$/, (m) => void (filter.costMin = num(m[1]))],
  ];
  for (const [re, apply] of trailing) {
    const m = s.match(re);
    if (m) {
      apply(m);
      s = s.slice(0, m.index).trim();
    }
  }

  // Leading "N-play-point" / "N-attack" qualifiers.
  let m = s.match(/(\d+)-play-point /);
  if (m) {
    filter.costMax = num(m[1]);
    filter.costMin = num(m[1]);
    s = s.replace(m[0], '');
  }
  m = s.match(/(\d+)-attack /);
  if (m) {
    filter.atkMax = num(m[1]);
    filter.atkMin = num(m[1]);
    s = s.replace(m[0], '');
  }

  // Determiner.
  let scope: Selector['scope'] = 'target';
  let count = 1;
  let random = false;

  if (/^(all|each|every)\s+/.test(s)) {
    scope = 'all';
    s = s.replace(/^(all|each|every)\s+/, '');
  } else {
    const d = s.match(/^(\d+|a|an|the|two|three|another|other)\s+/);
    if (d) {
      const w = d[1];
      if (w !== 'the' && w !== 'another' && w !== 'other') count = num(w, 1);
      if (w === 'another' || w === 'other') filter.notSelf = true;
      s = s.slice(d[0].length);
    }
  }

  for (let i = 0; i < 2; i++) {
    if (/^random\s+/.test(s)) {
      random = true;
      s = s.replace(/^random\s+/, '');
    }
    if (/^other\s+/.test(s)) {
      filter.notSelf = true;
      s = s.replace(/^other\s+/, '');
    }
  }

  // Side.
  let side: Selector['side'] = 'both';
  if (/^(enemy|opposing)\s+/.test(s)) {
    side = 'enemy';
    s = s.replace(/^(enemy|opposing)\s+/, '');
  } else if (/^(allied|friendly|your)\s+/.test(s)) {
    side = 'ally';
    s = s.replace(/^(allied|friendly|your)\s+/, '');
  }

  // Trait / class.
  for (const t of TRAIT_WORDS) {
    const re = new RegExp(`^${t.toLowerCase()}\\s+`);
    if (re.test(s)) {
      filter.trait = t;
      s = s.replace(re, '');
      break;
    }
  }
  if (/^neutral\s+/.test(s)) {
    filter.cardClass = 'neutral';
    s = s.replace(/^neutral\s+/, '');
  }

  if (random) scope = 'random';

  // Head noun.
  let kind: Selector['kind'] = 'follower';
  let includeLeader = false;
  switch (s) {
    case 'follower':
    case 'followers':
      break;
    case 'amulet':
    case 'amulets':
      kind = 'amulet';
      break;
    case 'follower or amulet':
    case 'followers or amulets':
    case 'card':
    case 'cards':
      kind = 'any';
      break;
    case 'enemy':
    case 'enemies':
      side = 'enemy';
      includeLeader = true;
      break;
    case 'ally':
    case 'allies':
      side = 'ally';
      includeLeader = true;
      break;
    case 'leader':
    case 'leaders':
      return { scope: 'leader', side };
    default:
      return null;
  }

  const sel: Selector = { scope, side, kind };
  if (count > 1) sel.count = count;
  if (includeLeader) sel.includeLeader = true;
  if (Object.keys(filter).length > 0) sel.filter = filter as Selector['filter'];
  return sel;
}

// ---------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------

const CLASS_COND = /(vengeance|overflow|resonance)/i;

function classCondition(word: string, negated: boolean): Condition {
  const c: Condition = { k: word.toLowerCase() as 'vengeance' | 'overflow' | 'resonance' };
  return negated ? { k: 'not', c } : c;
}

interface Peeled {
  body: string;
  cond?: Condition;
}

/** Removes a leading or trailing conditional clause from a sentence. */
function peelCondition(sentence: string): Peeled {
  const s = sentence.trim();

  let m = s.match(new RegExp(`^(.*?),?\\s*if ${CLASS_COND.source} is (not )?active for you\\.?$`, 'i'));
  if (m) return { body: m[1], cond: classCondition(m[2], !!m[3]) };

  m = s.match(new RegExp(`^if ${CLASS_COND.source} is (not )?active for you,\\s*(.*)$`, 'i'));
  if (m) return { body: m[3], cond: classCondition(m[1], !!m[2]) };

  m = s.match(new RegExp(`^if ${CLASS_COND.source} is already active for you when this card is played,\\s*(.*)$`, 'i'));
  if (m) return { body: m[2], cond: classCondition(m[1], false) };

  m = s.match(/^(.*?),?\s*if at least (\d+) other cards? (?:were|was|have been|has been) played this turn\.?$/i);
  if (m) return { body: m[1], cond: { k: 'cardsPlayed', n: num(m[2]) } };

  m = s.match(/^if at least (\d+) (?:other )?cards? (?:were|was|have been|has been) played this turn,\s*(.*)$/i);
  if (m) return { body: m[2], cond: { k: 'cardsPlayed', n: num(m[1]) } };

  m = s.match(/^(.*?),?\s*if you have at least (\d+) shadows?\.?$/i);
  if (m) return { body: m[1], cond: { k: 'hasShadows', n: num(m[2]) } };

  m = s.match(/^(.*?),?\s*if an? (allied|enemy) (\w+) card is in play\.?$/i);
  if (m) {
    const trait = TRAIT_WORDS.find((t) => t.toLowerCase() === m![3].toLowerCase());
    if (trait) {
      return {
        body: m[1],
        cond: {
          k: 'exists',
          sel: { scope: 'all', side: m[2].toLowerCase() === 'allied' ? 'ally' : 'enemy', kind: 'any', filter: { trait: trait as never } },
        },
      };
    }
  }

  m = s.match(/^(.*?),?\s*if (?:you have|there (?:are|is)) (?:at least )?(\d+) (?:or more )?(allied|enemy) followers? in play\.?$/i);
  if (m) {
    return {
      body: m[1],
      cond: {
        k: 'atLeast',
        a: { k: 'count', of: { scope: 'all', side: m[3].toLowerCase() === 'allied' ? 'ally' : 'enemy', kind: 'follower' } },
        b: num(m[2]),
      },
    };
  }

  m = s.match(/^during (?:the opponent's|your opponent's) turn,\s*(.*)$/i);
  if (m) return { body: m[1], cond: { k: 'opponentTurn' } };
  m = s.match(/^(.*?),?\s*during (?:the opponent's|your opponent's) turn\.?$/i);
  if (m) return { body: m[1], cond: { k: 'opponentTurn' } };

  return { body: s };
}

// ---------------------------------------------------------------------------
// Dynamic amounts ("X equals the number of ...")
// ---------------------------------------------------------------------------

function parseCountPhrase(phrase: string, ctx: CompileCtx): Amount | null {
  const p = tidy(phrase).toLowerCase();

  let m = p.match(/^(?:the number of )?other cards in your hand$/);
  if (m) return { k: 'sum', of: [{ k: 'handSize' }, -1] };
  m = p.match(/^(?:the number of )?cards in your hand$/);
  if (m) return { k: 'handSize' };
  m = p.match(/^(?:the number of )?cards in your deck$/);
  if (m) return { k: 'deckSize' };
  m = p.match(/^(?:the number of )?(?:your )?shadows$/);
  if (m) return { k: 'shadows' };
  m = p.match(/^(?:the number of )?(?:other )?cards? (?:that were )?played this turn$/);
  if (m) return { k: 'cardsPlayed' };
  m = p.match(/^(?:the number of )?cards? discarded$/);
  if (m) return { k: 'ctx', name: 'discarded' };
  // "the attack of the strongest enemy follower in play"
  m = p.match(/^the (attack|defense|cost) of the (strongest|weakest) (.+?)(?: in play)?$/);
  if (m) {
    const sel = parseSelector(m[3], ctx);
    if (sel) {
      return {
        k: 'statOf',
        of: { ...sel, scope: 'all' },
        stat: m[1] === 'attack' ? 'atk' : m[1] === 'defense' ? 'def' : 'cost',
        pick: m[2] === 'strongest' ? 'max' : 'min',
      };
    }
  }

  // "this follower's attack" — the ability's own source.
  m = p.match(/^this (?:follower|card|amulet)'s (attack|defense)$/);
  if (m) return m[1] === 'attack' ? { k: 'sourceAtk' } : { k: 'sourceDef' };

  // "that follower's attack" — whatever an earlier sentence acted on. The
  // caller has to bind it with `withTarget`; the flag says so.
  m = p.match(/^(?:that|the selected|the) (?:follower|card|amulet)'s (attack|defense|cost)$/);
  if (m) {
    ctx.usesOther = true;
    return m[1] === 'attack' ? { k: 'otherAtk' } : m[1] === 'defense' ? { k: 'otherDef' } : { k: 'otherCost' };
  }

  // "the number of other Neutral cards in your hand"
  m = p.match(/^(?:the number of )?(?:other )?(.+?) (?:cards? )?in your hand$/);
  if (m) {
    const sel = parseSelector(m[1], ctx);
    if (sel) return { k: 'count', of: { ...sel, scope: 'all', side: 'ally', zone: 'hand' } };
  }

  m = p.match(/^(?:the number of )?(.+?) in play$/);
  if (m) {
    const sel = parseSelector(m[1], ctx);
    if (sel) return { k: 'count', of: { ...sel, scope: 'all' } };
  }
  return null;
}

/** Pulls an "X equals ..." definition out of a line and binds it to ctx.x. */
function bindX(line: string, ctx: CompileCtx): string {
  const m = line.match(/\bX equals ([^.]+)\.?/i);
  if (!m) return line;
  const amount = parseCountPhrase(m[1], ctx);
  if (amount) ctx.x = amount;
  return line.replace(m[0], '').trim();
}

/** Resolves a numeric token that may be the literal "X". */
function amt(token: string, ctx: CompileCtx): Amount | null {
  if (/^x$/i.test(token)) return ctx.x ?? null;
  return num(token);
}

// ---------------------------------------------------------------------------
// Sentence -> effects
// ---------------------------------------------------------------------------

type Rule = {
  re: RegExp;
  build: (m: RegExpMatchArray, ctx: CompileCtx) => Effect[] | null;
};

const N = '(\\d+|X)';

const RULES_TABLE: Rule[] = [
  // --- damage --------------------------------------------------------------
  {
    re: new RegExp(`^deal ${N} damage to (.+?) and ${N} damage to (.+)$`, 'i'),
    build: (m, ctx) => {
      const a = parseSelector(m[2], ctx);
      const b = parseSelector(m[4], ctx);
      const x = amt(m[1], ctx);
      const y = amt(m[3], ctx);
      if (!a || !b || x === null || y === null) return null;
      return [
        { k: 'damage', target: a, amount: x },
        { k: 'damage', target: b, amount: y },
      ];
    },
  },
  {
    re: new RegExp(`^deal ${N} damage to (.+)$`, 'i'),
    build: (m, ctx) => {
      const t = parseSelector(m[2], ctx);
      const x = amt(m[1], ctx);
      return t && x !== null ? [{ k: 'damage', target: t, amount: x }] : null;
    },
  },
  {
    re: new RegExp(`^deal ${N} damage$`, 'i'),
    build: (m, ctx) => {
      const x = amt(m[1], ctx);
      return x === null ? null : [{ k: 'damage', target: { scope: 'other' }, amount: x }];
    },
  },
  {
    re: /^deal damage equal to (?:this follower's|its) attack to (.+)$/i,
    build: (m, ctx) => {
      const t = parseSelector(m[1], ctx);
      return t ? [{ k: 'damage', target: t, amount: { k: 'sourceAtk' } }] : null;
    },
  },

  // --- healing -------------------------------------------------------------
  {
    re: new RegExp(`^restore ${N} defense to (.+)$`, 'i'),
    build: (m, ctx) => {
      const t = parseSelector(m[2], ctx);
      const x = amt(m[1], ctx);
      return t && x !== null ? [{ k: 'heal', target: t, amount: x }] : null;
    },
  },

  // --- removal -------------------------------------------------------------
  {
    re: /^destroy (.+)$/i,
    build: (m, ctx) => {
      const t = parseSelector(m[1], ctx);
      return t ? [{ k: 'destroy', target: t }] : null;
    },
  },
  {
    re: /^banish (.+)$/i,
    build: (m, ctx) => {
      const t = parseSelector(m[1], ctx);
      return t ? [{ k: 'banish', target: t }] : null;
    },
  },
  {
    re: /^return (.+?) to (?:your|its owner's|the owner's|the players'|the opponent's) hands?$/i,
    build: (m, ctx) => {
      const t = parseSelector(m[1], ctx);
      return t ? [{ k: 'returnToHand', target: t }] : null;
    },
  },

  // --- stat changes --------------------------------------------------------
  {
    re: new RegExp(`^give \\+${N}/\\+${N} and (${KW_ALT}) to (.+?)(?: until the end of (?:the|this|your) turn)?$`, 'i'),
    build: (m, ctx) => {
      const t = parseSelector(m[4], ctx);
      const a = amt(m[1], ctx);
      const d = amt(m[2], ctx);
      if (!t || a === null || d === null) return null;
      const temp = /until the end of/i.test(m[0]);
      return [
        { k: 'buff', target: t, atk: a, def: d, duration: temp ? 'turn' : 'permanent' },
        { k: 'grant', target: t, keywords: [KEYWORD_WORDS[m[3].toLowerCase()]], duration: temp ? 'turn' : 'permanent' },
      ];
    },
  },
  {
    re: new RegExp(`^give \\+${N}/\\+${N} to (.+?)(?: until the end of (?:the|this|your) turn)?$`, 'i'),
    build: (m, ctx) => {
      const t = parseSelector(m[3], ctx);
      const a = amt(m[1], ctx);
      const d = amt(m[2], ctx);
      if (!t || a === null || d === null) return null;
      const temp = /until the end of/i.test(m[0]);
      return [{ k: 'buff', target: t, atk: a, def: d, duration: temp ? 'turn' : 'permanent' }];
    },
  },
  {
    re: new RegExp(`^gain \\+${N}/\\+${N} and (${KW_ALT})(?: until the end of (?:the|this|your) turn)?$`, 'i'),
    build: (m, ctx) => {
      const a = amt(m[1], ctx);
      const d = amt(m[2], ctx);
      if (a === null || d === null) return null;
      const temp = /until the end of/i.test(m[0]);
      return [
        { k: 'buff', target: { scope: 'self' }, atk: a, def: d, duration: temp ? 'turn' : 'permanent' },
        { k: 'grant', target: { scope: 'self' }, keywords: [KEYWORD_WORDS[m[3].toLowerCase()]], duration: temp ? 'turn' : 'permanent' },
      ];
    },
  },
  {
    re: new RegExp(`^gain \\+${N}/\\+${N}(?: until the end of (?:the|this|your) turn)?$`, 'i'),
    build: (m, ctx) => {
      const a = amt(m[1], ctx);
      const d = amt(m[2], ctx);
      if (a === null || d === null) return null;
      const temp = /until the end of/i.test(m[0]);
      return [{ k: 'buff', target: { scope: 'self' }, atk: a, def: d, duration: temp ? 'turn' : 'permanent' }];
    },
  },
  {
    re: new RegExp(`^gain \\+${N}/\\+${N} for each (.+)$`, 'i'),
    build: (m, ctx) => {
      const per = parseCountPhrase(m[3], ctx) ?? parseCountPhrase(`the number of ${m[3]}`, ctx);
      const a = amt(m[1], ctx);
      const d = amt(m[2], ctx);
      if (!per || a === null || d === null) return null;
      return [
        {
          k: 'buff',
          target: { scope: 'self' },
          atk: { k: 'mul', a, b: per },
          def: { k: 'mul', a: d, b: per },
        },
      ];
    },
  },
  {
    re: new RegExp(`^gain (${KW_ALT})(?: until the end of (?:the|this|your) turn)?$`, 'i'),
    build: (m) => {
      const temp = /until the end of/i.test(m[0]);
      return [
        {
          k: 'grant',
          target: { scope: 'self' },
          keywords: [KEYWORD_WORDS[m[1].toLowerCase()]],
          duration: temp ? 'turn' : 'permanent',
        },
      ];
    },
  },
  {
    re: new RegExp(`^give (?:it|that follower) \\+${N}/\\+${N}(?: until the end of (?:the|this|your) turn)?$`, 'i'),
    build: (m, ctx) => {
      const a = amt(m[1], ctx);
      const d = amt(m[2], ctx);
      if (a === null || d === null) return null;
      const temp = /until the end of/i.test(m[0]);
      return [{ k: 'buff', target: { scope: 'other' }, atk: a, def: d, duration: temp ? 'turn' : 'permanent' }];
    },
  },
  {
    re: new RegExp(`^give (?:it|that follower) (${KW_ALT})$`, 'i'),
    build: (m) => [{ k: 'grant', target: { scope: 'other' }, keywords: [KEYWORD_WORDS[m[1].toLowerCase()]] }],
  },
  {
    re: /^transform (?:it|that follower) into (?:an?|the) ([\w' -]+)$/i,
    build: (m, ctx) => {
      const id = cardId(m[1], ctx);
      return id ? [{ k: 'transform', target: { scope: 'other' }, into: id }] : null;
    },
  },
  {
    re: new RegExp(`^give (${KW_ALT}) to (.+)$`, 'i'),
    build: (m, ctx) => {
      const t = parseSelector(m[2], ctx);
      return t ? [{ k: 'grant', target: t, keywords: [KEYWORD_WORDS[m[1].toLowerCase()]] }] : null;
    },
  },
  {
    re: new RegExp(`^change (?:the )?(.+?)(?:'s)? (attack|defense) to ${N}$`, 'i'),
    build: (m, ctx) => {
      const t = parseSelector(m[1].replace(/^the /, ''), ctx);
      const v = amt(m[3], ctx);
      if (!t || v === null) return null;
      return [m[2].toLowerCase() === 'attack' ? { k: 'setStats', target: t, atk: v } : { k: 'setStats', target: t, def: v }];
    },
  },

  // --- cards ---------------------------------------------------------------
  {
    re: new RegExp(`^draw (?:${N}|a|two|three) cards?$`, 'i'),
    build: (m, ctx) => {
      const raw = m[1] ?? m[0].split(' ')[1];
      const x = /^x$/i.test(raw ?? '') ? ctx.x : num(raw, 1);
      return x === null || x === undefined ? null : [{ k: 'draw', amount: x }];
    },
  },
  { re: /^both players draw a card$/i, build: () => [{ k: 'draw', amount: 1 }, { k: 'draw', amount: 1, side: 'enemy' }] },
  {
    re: /^(?:your opponent|the opponent) draws? (a|\d+) cards?$/i,
    build: (m) => [{ k: 'draw', amount: num(m[1], 1), side: 'enemy' }],
  },
  {
    re: /^discard (a card|\d+ cards?|your hand)$/i,
    build: (m) =>
      /your hand/i.test(m[1])
        ? [{ k: 'discard', amount: { k: 'handSize' } }]
        : [{ k: 'discard', amount: num(m[1].split(' ')[0], 1), random: true }],
  },
  {
    re: /^put (an?|\d+|two|three) ([\w' -]+?) into your hand$/i,
    build: (m, ctx) => {
      const id = cardId(m[2], ctx);
      return id ? [{ k: 'toHand', defId: id, count: num(m[1], 1) }] : null;
    },
  },
  {
    re: /^put an? random ([\w' -]+?) (?:card )?from your deck into your hand$/i,
    build: (m) => {
      const trait = TRAIT_WORDS.find((t) => t.toLowerCase() === m[1].toLowerCase().trim());
      if (trait) return [{ k: 'searchToHand', filter: { trait: trait as never }, count: 1 }];
      return null;
    },
  },
  {
    re: /^summon (an?|\d+|two|three) ([\w' -]+?)$/i,
    build: (m, ctx) => {
      const id = cardId(m[2], ctx);
      return id ? [{ k: 'summon', defId: id, count: num(m[1], 1) }] : null;
    },
  },

  // --- resources -----------------------------------------------------------
  { re: /^gain (\d+) shadows?$/i, build: (m) => [{ k: 'gainShadows', amount: num(m[1]) }] },
  { re: /^gain an empty play point orb$/i, build: () => [{ k: 'gainMaxPP', amount: 1 }] },
  {
    re: new RegExp(`^(?:gain|recover) ${N} (?:extra )?play points?$`, 'i'),
    build: (m, ctx) => {
      const x = amt(m[1], ctx);
      return x === null ? null : [{ k: 'gainPP', amount: x }];
    },
  },
  { re: /^gain (\d+) evolution points?$/i, build: (m) => [{ k: 'gainEP', amount: num(m[1]) }] },

  // --- countdown / cost ----------------------------------------------------
  {
    re: /^subtract (\d+) from the countdown of (.+)$/i,
    build: (m, ctx) => {
      const t = parseSelector(m[2], ctx);
      return t ? [{ k: 'countdown', target: { ...t, kind: 'amulet' }, delta: -num(m[1]) }] : null;
    },
  },
  {
    re: /^add (\d+) to the countdown of (.+)$/i,
    build: (m, ctx) => {
      const t = parseSelector(m[2], ctx);
      return t ? [{ k: 'countdown', target: { ...t, kind: 'amulet' }, delta: num(m[1]) }] : null;
    },
  },
  {
    re: /^subtract (\d+) from the cost of this card$/i,
    build: (m) => [{ k: 'costMod', target: { scope: 'self' }, delta: -num(m[1]) }],
  },
  {
    re: /^gain (\d+) shadows?$/i,
    build: (m) => [{ k: 'gainShadows', amount: num(m[1]) }],
  },

  // --- misc ----------------------------------------------------------------
  // "Give <target> the following effect - <phrase>" and "Gain the following
  // effect: <phrase>".
  {
    re: /^give (.+?) the following effect\s*[-:]\s*(.+)$/i,
    build: (m, ctx) => {
      const t = parseSelector(m[1]);
      const kw = phraseKeyword(m[2]);
      if (!t || !kw) return null;
      const temp = /until the end of (?:the|this|your) turn/i.test(m[0]);
      return [{ k: 'grant', target: t, keywords: [kw], duration: temp ? 'turn' : 'permanent' }];
      void ctx;
    },
  },
  {
    re: /^gain the following effect\s*[-:]\s*(.+)$/i,
    build: (m) => {
      const kw = phraseKeyword(m[1]);
      if (!kw) return null;
      const temp = /until the end of (?:the|this|your) turn/i.test(m[0]);
      return [{ k: 'grant', target: { scope: 'self' }, keywords: [kw], duration: temp ? 'turn' : 'permanent' }];
    },
  },
  // "Select an enemy follower. It can't attack next turn." and friends.
  {
    re: /^(?:select |choose )?(.+?)\.? ?(?:it |they )?can'?t attack next turn$/i,
    build: (m) => {
      const t = parseSelector(m[1]);
      return t ? [{ k: 'freeze', target: t }] : null;
    },
  },
  {
    re: /^(.+?) in play can'?t attack next turn$/i,
    build: (m) => {
      const t = parseSelector(m[1]);
      return t ? [{ k: 'freeze', target: { ...t, scope: 'all' } }] : null;
    },
  },
  // Cost manipulation on cards already in hand.
  {
    re: /^change the cost of (.+?) in your hand to (\d+)$/i,
    build: (m, ctx) => {
      const id = cardId(m[1].replace(/^(an?|the|each|all) /i, ''), ctx);
      const filter = id ? { defId: id } : undefined;
      if (!filter) return null;
      return [{ k: 'setCost', target: { scope: 'all', side: 'ally', kind: 'any', zone: 'hand', filter }, cost: num(m[2]) }];
    },
  },
  {
    re: /^subtract (\d+) from the cost of (?:an?|the) cards? in your hand$/i,
    build: (m) => [
      { k: 'costMod', target: { scope: 'random', side: 'ally', kind: 'any', zone: 'hand' }, delta: -num(m[1]) },
    ],
  },
  // Deck search with a filter rather than a named card.
  {
    re: /^put an? random (.+?) from your deck into your hand$/i,
    build: (m) => {
      const filter = searchFilter(m[1]);
      return filter ? [{ k: 'searchToHand', filter, count: 1 }] : null;
    },
  },
  {
    re: /^destroy a damaged enemy follower$/i,
    build: () => [
      { k: 'destroy', target: { scope: 'target', side: 'enemy', kind: 'follower', filter: { damaged: true } } },
    ],
  },
  {
    re: /^spellboost the cards in your hand$/i,
    build: () => [{ k: 'spellboost', amount: 1 }],
  },
  {
    re: new RegExp(`^give (.+?) the ability to ignore ward$`, 'i'),
    build: (m) => {
      const t = parseSelector(m[1]);
      return t ? [{ k: 'grant', target: t, keywords: ['ignoreWard'] }] : null;
    },
  },
  {
    re: /^put an? random ([\w -]+?) from your deck into play$/i,
    build: (m) => {
      const t = parseSelector(`a ${m[1]}`);
      if (!t || !t.filter) return null;
      return [{ k: 'searchToHand', filter: t.filter, count: 1 }];
    },
  },
  {
    re: new RegExp(`^gain (${KW_ALT}) and (${KW_ALT})$`, 'i'),
    build: (m) => [
      {
        k: 'grant',
        target: { scope: 'self' },
        keywords: [KEYWORD_WORDS[m[1].toLowerCase()], KEYWORD_WORDS[m[2].toLowerCase()]],
      },
    ],
  },
  {
    re: /^evolve (.+)$/i,
    build: (m, ctx) => {
      const t = parseSelector(m[1], ctx);
      return t ? [{ k: 'evolveTarget', target: t }] : null;
    },
  },
  { re: /^evolve$/i, build: () => [{ k: 'evolveTarget', target: { scope: 'self' } }] },
  {
    re: /^transform (.+?) into (?:an?|the) ([\w' -]+)$/i,
    build: (m, ctx) => {
      const t = parseSelector(m[1], ctx);
      const id = cardId(m[2], ctx);
      return t && id ? [{ k: 'transform', target: t, into: id }] : null;
    },
  },
];

/** Turns "spell with Spellboost" / "card that costs at least 5 play points"
 * into a deck-search filter. */
function searchFilter(phrase: string): Record<string, unknown> | null {
  const p = tidy(phrase).toLowerCase();
  const filter: Record<string, unknown> = {};

  let m = p.match(/costs? at least (\d+)/);
  if (m) filter.costMin = num(m[1]);
  m = p.match(/costs? (\d+) (?:play points? )?or less/);
  if (m) filter.costMax = num(m[1]);

  if (/^spell\b/.test(p) || / spell\b/.test(p)) filter.type = 'spell';
  else if (/^follower\b/.test(p) || / follower\b/.test(p)) filter.type = 'follower';
  else if (/^amulet\b/.test(p) || / amulet\b/.test(p)) filter.type = 'amulet';

  for (const t of TRAIT_WORDS) {
    if (p.includes(t.toLowerCase())) filter.trait = t;
  }

  return Object.keys(filter).length > 0 ? filter : null;
}

function parseSentence(sentence: string, ctx: CompileCtx): Effect[] | null {
  const peeled = peelCondition(sentence);
  const body = tidy(peeled.body);
  if (!body) return null;

  for (const rule of RULES_TABLE) {
    const m = body.match(rule.re);
    if (!m) continue;
    const eff = rule.build(m, ctx);
    if (!eff) continue;
    return peeled.cond ? [{ k: 'if', cond: peeled.cond, then: eff }] : eff;
  }
  return null;
}

function splitSentences(line: string): string[] {
  return line
    .split(/(?<=\.)\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function compileSentences(
  text: string,
  ctx: CompileCtx,
  opts: { bindOther?: boolean } = {},
): Effect[] | null {
  const bound = bindX(text, ctx);
  const sentences = splitSentences(bound);
  if (sentences.length === 0) return null;

  const out: Effect[] = [];
  for (const raw of sentences) {
    const s = raw.replace(/^(?:then|and then)\s+/i, '');

    // "Do this N times." repeats everything parsed so far on this line.
    const rep = s.match(/^do this (\d+|X|two|three) times?\.?$/i);
    if (rep && out.length > 0) {
      const times = /^x$/i.test(rep[1]) ? ctx.x : num(rep[1]);
      if (times === undefined || times === null) return null;
      const body = out.splice(0, out.length);
      out.push({ k: 'repeat', times, body });
      continue;
    }

    // "..., deal N damage instead." re-runs the preceding effect at a new
    // value, optionally gated by the same conditional clauses as any sentence.
    const insteadPeeled = peelCondition(s);
    const instead = tidy(insteadPeeled.body).match(/^(.*)\binstead$/i);
    if (instead && out.length > 0) {
      const patched = applyInstead(out, instead[1], ctx);
      if (patched) {
        const base = out.splice(0, out.length);
        if (insteadPeeled.cond) out.push({ k: 'if', cond: insteadPeeled.cond, then: patched, else: base });
        else out.push(...patched);
        continue;
      }
    }

    // "Summon Otohime's Bodyguards until your area is full."
    const untilFull = s.match(/^(.*?) until (?:your area|the field) is full\.?$/i);
    if (untilFull) {
      const body = parseSentence(untilFull[1], ctx);
      if (body) {
        out.push({ k: 'untilFull', where: 'field', body });
        continue;
      }
    }
    const untilHand = s.match(/^(.*?) until (?:it|your hand) is full\.?$/i);
    if (untilHand) {
      const body = parseSentence(untilHand[1], ctx);
      if (body) {
        out.push({ k: 'untilFull', where: 'hand', body });
        continue;
      }
    }

    const eff = parseSentence(s, ctx);
    if (eff) {
      out.push(...eff);
      continue;
    }

    // "<A> and <B>" / "<A>, and then <B>" — two effects in one sentence.
    const joined = splitConjunction(s, ctx);
    if (!joined) return null;
    out.push(...joined);
  }
  if (out.length === 0) return null;

  // "Destroy an allied follower. Restore X defense to your leader. X equals
  // that follower's defense." — the stat has to be read from the follower that
  // was just destroyed, so the whole line runs bound to it.
  if (ctx.usesOther && opts.bindOther !== false) {
    const sel = primaryTarget(out);
    if (!sel) return null;
    return [{ k: 'withTarget', target: sel, body: out }];
  }
  return out;
}

/** Splits "Destroy an allied follower and summon a Lich." into two effects. */
function splitConjunction(sentence: string, ctx: CompileCtx): Effect[] | null {
  const peeled = peelCondition(sentence);
  const body = tidy(peeled.body);
  for (const sep of [', and then ', ' and then ', ', and ', ' and ']) {
    let idx = body.toLowerCase().indexOf(sep);
    while (idx > 0) {
      const left = body.slice(0, idx);
      const right = body.slice(idx + sep.length);
      const a = parseSentence(left, ctx);
      if (a) {
        // "Summon a Pirate and a Viking" — the right half has no verb of its
        // own, so it borrows the left one.
        const verb = left.match(/^(\w+)\s/);
        const b = parseSentence(right, ctx) ?? (verb ? parseSentence(`${verb[1]} ${right}`, ctx) : null);
        if (b) {
          const both = [...a, ...b];
          return peeled.cond ? [{ k: 'if', cond: peeled.cond, then: both }] : both;
        }
      }
      idx = body.toLowerCase().indexOf(sep, idx + 1);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// "instead" / "N more" modifiers
// ---------------------------------------------------------------------------

/** Deep-clones effects while replacing the first primary numeric value. */
function patchPrimary(effects: Effect[], patch: (e: Effect) => Effect | null): Effect[] | null {
  let done = false;
  const walk = (list: Effect[]): Effect[] =>
    list.map((e) => {
      if (done) return e;
      if (e.k === 'if') return { ...e, then: walk(e.then), ...(e.else ? { else: walk(e.else) } : {}) };
      if (e.k === 'repeat') return { ...e, body: walk(e.body) };
      if (e.k === 'necromancy' || e.k === 'earthRite') {
        return { ...e, then: walk(e.then), ...(e.else ? { else: walk(e.else) } : {}) };
      }
      const p = patch(e);
      if (p) {
        done = true;
        return p;
      }
      return e;
    });
  const out = walk(effects);
  return done ? out : null;
}

/**
 * The selector the first targeting effect in `effects` acts on. "Banish it
 * instead" means "banish whatever the sentence I am replacing acted on", so the
 * pronoun resolves to this rather than to any text.
 */
function primaryTarget(effects: Effect[]): Selector | null {
  // "that follower" is never the leader, so a leader-only selector does not
  // count as the thing a later sentence is talking about.
  const picksEntities = (sel: Selector) =>
    sel.scope !== 'leader' && !sel.leaderOnly;

  for (const e of effects) {
    if ('target' in e && e.target && picksEntities(e.target as Selector)) return e.target as Selector;
    if (e.k === 'if') {
      const inner = primaryTarget(e.then) ?? (e.else ? primaryTarget(e.else) : null);
      if (inner) return inner;
    }
    if (e.k === 'necromancy' || e.k === 'earthRite') {
      const inner = primaryTarget(e.then) ?? (e.else ? primaryTarget(e.else) : null);
      if (inner) return inner;
    }
    if (e.k === 'repeat') {
      const inner = primaryTarget(e.body);
      if (inner) return inner;
    }
  }
  return null;
}

/**
 * "Destroy it instead", "Banish it instead", "Return it to the opponent's hand
 * instead" — a new verb applied to the target the replaced effect already had.
 */
function pronounInstead(clause: string, sel: Selector, ctx: CompileCtx): Effect[] | null {
  const c = tidy(clause);
  if (/^destroy (?:it|them)$/i.test(c)) return [{ k: 'destroy', target: sel }];
  if (/^banish (?:it|them)$/i.test(c)) return [{ k: 'banish', target: sel }];
  if (/^return (?:it|them) to (?:the opponent's|your|the player's|its owner's) hand$/i.test(c)) {
    return [{ k: 'returnToHand', target: sel }];
  }
  const t = c.match(/^transform (?:it|them) into (?:an?|the) (.+)$/i);
  if (t) {
    const id = cardId(t[1], ctx);
    if (id) return [{ k: 'transform', target: sel, into: id }];
  }
  const d = c.match(new RegExp(`^deal ${N} damage to (?:it|them)$`, 'i'));
  if (d) {
    const v = amt(d[1], ctx);
    if (v !== null) return [{ k: 'damage', target: sel, amount: v }];
  }
  return null;
}

/**
 * Handles "Deal 5 damage instead", "Give +4/+4 instead", "Summon 2 instead" —
 * and, failing those, an "instead" clause that replaces the whole effect rather
 * than one of its numbers ("Banish it instead", "Destroy an enemy follower or
 * amulet instead").
 */
function applyInstead(base: Effect[], clause: string, ctx: CompileCtx): Effect[] | null {
  const c = tidy(clause);

  let m = c.match(new RegExp(`^deal ${N} damage$`, 'i'));
  if (m) {
    const v = amt(m[1], ctx);
    if (v === null) return null;
    return patchPrimary(base, (e) => (e.k === 'damage' ? { ...e, amount: v } : null));
  }
  m = c.match(new RegExp(`^restore ${N} defense$`, 'i'));
  if (m) {
    const v = amt(m[1], ctx);
    if (v === null) return null;
    return patchPrimary(base, (e) => (e.k === 'heal' ? { ...e, amount: v } : null));
  }
  m = c.match(new RegExp(`^give \\+${N}/\\+${N}$`, 'i'));
  if (m) {
    const a = amt(m[1], ctx);
    const d = amt(m[2], ctx);
    if (a === null || d === null) return null;
    return patchPrimary(base, (e) => (e.k === 'buff' ? { ...e, atk: a, def: d } : null));
  }
  m = c.match(/^summon (\d+)$/i);
  if (m) {
    const n = num(m[1]);
    return patchPrimary(base, (e) => (e.k === 'summon' ? { ...e, count: n } : null));
  }
  m = c.match(new RegExp(`^draw ${N}(?: cards?)?$`, 'i'));
  if (m) {
    const v = amt(m[1], ctx);
    if (v !== null) {
      const patched = patchPrimary(base, (e) => (e.k === 'draw' ? { ...e, amount: v } : null));
      if (patched) return patched;
    }
  }

  // Not a numeric variation: the clause replaces the effect outright.
  const sel = primaryTarget(base);
  if (sel) {
    const pronoun = pronounInstead(c, sel, ctx);
    if (pronoun) return pronoun;
  }
  return parseSentence(c, ctx) ?? splitConjunction(c, ctx);
}

/** Handles "Spellboost: Deal 1 more." style scaling of an existing ability. */
function applyMore(base: Effect[], clause: string, per: Amount): Effect[] | null {
  const c = tidy(clause);
  const scale = (cur: Amount | undefined, step: number): Amount => ({
    k: 'sum',
    of: [cur ?? 0, { k: 'mul', a: step, b: per }],
  });

  let m = c.match(/^deal (\d+) more$/i);
  if (m) {
    const step = num(m[1]);
    return patchPrimary(base, (e) => (e.k === 'damage' ? { ...e, amount: scale(e.amount, step) } : null));
  }
  m = c.match(/^restore (\d+) more$/i);
  if (m) {
    const step = num(m[1]);
    return patchPrimary(base, (e) => (e.k === 'heal' ? { ...e, amount: scale(e.amount, step) } : null));
  }
  m = c.match(/^summon (\d+) more$/i);
  if (m) {
    const step = num(m[1]);
    return patchPrimary(base, (e) => (e.k === 'summon' ? { ...e, count: scale(e.count, step) } : null));
  }
  m = c.match(/^repeat (\d+) times?$/i);
  if (m) {
    const step = num(m[1]);
    return [{ k: 'repeat', times: { k: 'sum', of: [1, { k: 'mul', a: step, b: per }] }, body: base }];
  }
  m = c.match(/^draw (\d+) more$/i);
  if (m) {
    const step = num(m[1]);
    return patchPrimary(base, (e) => (e.k === 'draw' ? { ...e, amount: scale(e.amount, step) } : null));
  }
  m = c.match(/^(?:give|gain) \+(\d+)\/\+(\d+) more$/i);
  if (m) {
    const a = num(m[1]);
    const d = num(m[2]);
    return patchPrimary(base, (e) => (e.k === 'buff' ? { ...e, atk: scale(e.atk, a), def: scale(e.def, d) } : null));
  }
  return null;
}

// ---------------------------------------------------------------------------
// Trigger prefixes
// ---------------------------------------------------------------------------

interface PrefixMatch {
  triggers: TriggerKind[];
  rest: string;
  cond?: Condition;
  wrap?: (effects: Effect[]) => Effect[];
}

const NECRO_RE = /^(?:if any targetable [^,]+ are in play, )?perform necromancy \((\d+)\)\s*[-:]\s*|^necromancy \((\d+)\)\s*[-:]\s*/i;
const EARTH_RE = /^earth rite\s*[-:]\s*/i;

function matchPrefix(line: string): PrefixMatch | null {
  const l = line.trim();

  const simple: [RegExp, TriggerKind[]][] = [
    [/^fanfare and last words:\s*/i, ['fanfare', 'lastWords']],
    [/^fanfare:\s*/i, ['fanfare']],
    [/^last words:\s*/i, ['lastWords']],
    [/^evolve:\s*/i, ['evolve']],
    [/^clash:\s*/i, ['clash']],
    [/^strike:\s*/i, ['strike']],
    [/^follower strike:\s*/i, ['strike']],
  ];
  for (const [re, triggers] of simple) {
    const m = l.match(re);
    if (m) return withInner(triggers, l.slice(m[0].length));
  }

  const timed: [RegExp, TriggerKind[]][] = [
    [/^at the end of your turn,\s*/i, ['turnEnd']],
    [/^at the start of your turn,\s*/i, ['turnStart']],
    [/^at the end of (?:the opponent's|your opponent's) turn,\s*/i, ['enemyTurnEnd']],
    [/^whenever (?:an|another) allied follower comes into play,\s*/i, ['onAllyFollowerPlayed']],
    [/^whenever (?:another allied follower|an allied follower) is destroyed,\s*/i, ['onAllyFollowerDestroyed']],
    [/^whenever an enemy follower is destroyed,\s*/i, ['onEnemyFollowerDestroyed']],
    [/^whenever (?:you|this player) (?:cast|play) a spell,\s*/i, ['onAllySpellPlayed']],
    [/^whenever your leader takes damage,\s*/i, ['onLeaderDamaged']],
    [/^whenever this follower (?:attacks|is attacked),\s*/i, ['clash']],
    [/^whenever this follower attacks,\s*/i, ['strike']],
  ];
  for (const [re, triggers] of timed) {
    const m = l.match(re);
    if (m) return withInner(triggers, l.slice(m[0].length));
  }

  // "Whenever an allied <Trait> follower comes into play, <effect>" — the
  // effect applies to the follower that arrived, which the engine exposes as
  // the trigger's "other" participant.
  // "Whenever an allied <Trait|Neutral|N-cost> follower comes into play, …" —
  // the condition tests the follower that arrived, not the board.
  const subject = l.match(
    /^whenever an allied (?:(\w+) )?(?:follower|card)(?: that originally costs (\d+) play points?)? comes into play,\s*/i,
  );
  if (subject && (subject[1] || subject[2])) {
    const filter: Record<string, unknown> = {};
    if (subject[2]) {
      filter.costMin = num(subject[2]);
      filter.costMax = num(subject[2]);
    }
    if (subject[1]) {
      const t = TRAIT_WORDS.find((x) => x.toLowerCase() === subject[1].toLowerCase());
      if (t) filter.trait = t;
      else if (subject[1].toLowerCase() === 'neutral') filter.cardClass = 'neutral';
      else if (subject[1].toLowerCase() !== 'follower') return null;
    }
    const inner = withInner(['onAllyFollowerPlayed'], l.slice(subject[0].length));
    inner.cond = { k: 'subject', filter: filter as never };
    return inner;
  }

  const anyAttack = l.match(/^whenever an enemy follower attacks,\s*/i);
  if (anyAttack) {
    const inner = withInner(['onAnyAttack'], l.slice(anyAttack[0].length));
    inner.cond = { k: 'subject', filter: {} as never };
    return inner;
  }

  const allyAttack = l.match(
    /^whenever (?:another allied|an allied)(?: (\w+))? (?:(\d+)-attack )?follower attacks,\s*/i,
  );
  if (allyAttack) {
    const filter: Record<string, unknown> = { notSelf: true };
    if (allyAttack[2]) {
      filter.atkMin = num(allyAttack[2]);
      filter.atkMax = num(allyAttack[2]);
    }
    if (allyAttack[1]) {
      const t = TRAIT_WORDS.find((x) => x.toLowerCase() === allyAttack[1].toLowerCase());
      if (t) filter.trait = t;
    }
    const inner = withInner(['onAnyAttack'], l.slice(allyAttack[0].length));
    inner.cond = { k: 'subject', filter: filter as never };
    return inner;
  }

  return null;

  function withInner(triggers: TriggerKind[], rest: string): PrefixMatch {
    const out: PrefixMatch = { triggers, rest };
    const nm = rest.match(NECRO_RE);
    if (nm) {
      out.rest = rest.slice(nm[0].length);
      const n = num(nm[1] ?? nm[2]);
      out.wrap = (fx) => [{ k: 'necromancy', n, then: fx }];
      return out;
    }
    const em = rest.match(EARTH_RE);
    if (em) {
      out.rest = rest.slice(em[0].length);
      out.wrap = (fx) => [{ k: 'earthRite', then: fx }];
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// Static / continuous lines
// ---------------------------------------------------------------------------

/** Lines that describe a permanent property rather than a triggered effect. */
function matchStatic(line: string, res: CompileResult): boolean {
  const l = tidy(line).toLowerCase();

  const bare: Record<string, Keyword> = {
    "can't attack": 'cantAttack',
    "can't be attacked": 'cantBeAttacked',
    "can't attack the enemy leader": 'cantAttackLeader',
    'ignore ward': 'ignoreWard',
    "can't be destroyed by effects": 'indestructible',
    "can't be targeted by enemy effects": 'untargetable',
    "can't be targeted by enemy spells": 'untargetable',
    'reduce damage from effects to 0': 'effectImmune',
    'can only attack the enemy leader and followers with ward': 'ignoreWard',
  };
  const stripped = l.replace(/^-/, '').trim();
  if (stripped in bare) {
    res.keywords.push(bare[stripped]);
    return true;
  }
  if (/^can attack (\d+|two|up to \d+) times per turn$/.test(stripped)) {
    res.keywords.push('doubleAttack');
    return true;
  }
  const reduce = stripped.match(/^subtract (\d+) from damage taken by this follower$/);
  if (reduce) {
    res.auras.push({ target: { scope: 'self' }, damageReduce: num(reduce[1]) });
    return true;
  }

  // "Gain +2/+0 during the opponent's turn." and friends become conditional
  // auras on the card itself.
  const peeled = peelCondition(line);
  if (peeled.cond) {
    const body = tidy(peeled.body).toLowerCase();
    let m = body.match(/^gain \+(\d+)\/\+(\d+)$/);
    if (m) {
      res.auras.push({ target: { scope: 'self' }, atk: num(m[1]), def: num(m[2]), cond: peeled.cond });
      return true;
    }
    m = body.match(new RegExp(`^gain (${KW_ALT})$`));
    if (m) {
      res.auras.push({ target: { scope: 'self' }, keywords: [KEYWORD_WORDS[m[1]]], cond: peeled.cond });
      return true;
    }
    if (/^can only attack$/.test(body)) {
      res.auras.push({ target: { scope: 'self' }, keywords: ['cantAttack'], cond: { k: 'not', c: peeled.cond } });
      return true;
    }
    if (/^this follower can't be attacked$/.test(body)) {
      res.auras.push({ target: { scope: 'self' }, keywords: ['cantBeAttacked'], cond: peeled.cond });
      return true;
    }
    m = body.match(/^this card costs (\d+) less(?: play points?)?$/);
    if (m) {
      res.auras.push({ target: { scope: 'self', zone: 'hand' }, costDelta: -num(m[1]), cond: peeled.cond });
      return true;
    }
    m = body.match(/^subtract (\d+) from damage taken by this follower$/);
    if (m) {
      res.auras.push({ target: { scope: 'self' }, damageReduce: num(m[1]), cond: peeled.cond });
      return true;
    }
    m = body.match(/^all allied followers gain \+(\d+)\/\+(\d+)$/);
    if (m) {
      res.auras.push({
        target: { scope: 'all', side: 'ally', kind: 'follower' },
        atk: num(m[1]),
        def: num(m[2]),
        cond: peeled.cond,
      });
      return true;
    }
  }

  // Unconditional cost reduction printed as a static line.
  const cost = l.match(/^this (?:card|follower) costs (\d+) less(?: play points?)?$/);
  if (cost) {
    res.auras.push({ target: { scope: 'self', zone: 'hand' }, costDelta: -num(cost[1]) });
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Whole-card compilation
// ---------------------------------------------------------------------------

const IGNORE_LINE = /^\(.*\)$|^this card (?:cannot|can't) be (?:included|added)/i;

export function compileCardText(text: string, baseCtx: CompileCtx): CompileResult {
  const res: CompileResult = {
    keywords: [],
    abilities: [],
    auras: [],
    enhance: [],
    unparsed: [],
    ignored: [],
  };
  if (!text) return res;

  for (const rawLine of text.split('\n')) {
    // Trailing parentheses are reminder text ("(A hand can hold 9 cards.)")
    // unless they carry the value itself, as in "Countdown (2)".
    const line = rawLine.replace(/\s*\([^)]*\s[^)]*\)\s*$/, '').trim();
    if (!line) continue;
    const ctx: CompileCtx = { ...baseCtx };

    if (IGNORE_LINE.test(line)) {
      res.ignored.push(line);
      continue;
    }

    // Bare keyword lines.
    const kw = line.replace(/\.$/, '').toLowerCase();
    if (kw in KEYWORD_WORDS) {
      res.keywords.push(KEYWORD_WORDS[kw]);
      continue;
    }
    if (/^countdown \(\d+\)$/i.test(line)) continue; // taken from the card record

    if (matchStatic(line, res)) continue;

    // Enhance is an alternative printed cost on its own line.
    const enh = line.match(/^enhance \((\d+)\):\s*(.*)$/i);
    if (enh) {
      // "Enhance (5): Destroy it instead." varies the line above rather than
      // describing a separate body, so it is resolved against that line.
      const insteadEnh = enh[2].match(/^(.*)\binstead\.?$/i);
      const prevEnh = res.abilities[res.abilities.length - 1];
      if (insteadEnh && prevEnh) {
        const upgraded = applyInstead(prevEnh.effects, insteadEnh[1], ctx);
        if (upgraded) {
          res.enhance.push({ cost: num(enh[1]), effects: upgraded, text: line });
          continue;
        }
      }
      const effects = compileSentences(enh[2], ctx);
      if (effects) res.enhance.push({ cost: num(enh[1]), effects, text: line });
      else res.unparsed.push(line);
      continue;
    }


    // Spellboost and Rally modify the line above them.
    const sb = line.match(/^spellboost:\s*(.*)$/i);
    if (sb) {
      const body = sb[1];
      const cheaper = body.match(/^subtract (\d+) from the cost of this card\.?$/i);
      if (cheaper) {
        res.spellboostCost = num(cheaper[1]);
        continue;
      }
      const last = res.abilities[res.abilities.length - 1];
      if (last) {
        const patched = applyMore(last.effects, body.replace(/\.$/, ''), { k: 'spellboost' });
        if (patched) {
          last.effects = patched;
          continue;
        }
        const insteadClause = body.match(/^(.*)\binstead\.?$/i);
        if (insteadClause) {
          const patched2 = applyInstead(last.effects, insteadClause[1], ctx);
          if (patched2) {
            last.effects = patched2;
            continue;
          }
        }
      }
      res.unparsed.push(line);
      continue;
    }

    // Necromancy / Rally as a standalone upgrade line.
    const upgrade = line.match(/^(?:necromancy \((\d+)\)|rally \((\d+)\))\s*[-:]\s*(.*)$/i);
    if (upgrade) {
      const last = res.abilities[res.abilities.length - 1];
      const clause = upgrade[3].match(/^(.*)\binstead\.?$/i);
      if (last && clause) {
        const upgraded = applyInstead(last.effects, clause[1], ctx);
        if (upgraded) {
          const cond: Condition = upgrade[1]
            ? { k: 'hasShadows', n: num(upgrade[1]) }
            : {
                k: 'atLeast',
                a: { k: 'count', of: { scope: 'all', side: 'ally', kind: 'follower' } },
                b: num(upgrade[2]),
              };
          const base = last.effects;
          last.effects = upgrade[1]
            ? [{ k: 'if', cond, then: [{ k: 'necromancy', n: num(upgrade[1]), then: upgraded, else: base }], else: base }]
            : [{ k: 'if', cond, then: upgraded, else: base }];
          continue;
        }
      }
      // Without an "instead" clause a Necromancy line is simply an extra,
      // conditional effect on the trigger above it.
      if (upgrade[1]) {
        const extra = compileSentences(upgrade[3], ctx);
        if (extra) {
          const wrapped: Effect[] = [{ k: 'necromancy', n: num(upgrade[1]), then: extra }];
          const prev = res.abilities[res.abilities.length - 1];
          if (prev) prev.effects = [...prev.effects, ...wrapped];
          else res.abilities.push({ on: 'fanfare', effects: wrapped });
          continue;
        }
      }
      res.unparsed.push(line);
      continue;
    }

    // An Earth Rite line with no "instead" behaves the same way.
    const earthLine = line.match(/^earth rite\s*[-:]\s*(.*)$/i);
    if (earthLine) {
      const clause = earthLine[1].match(/^(.*)\binstead\.?$/i);
      const prev = res.abilities[res.abilities.length - 1];
      if (prev && clause) {
        const upgraded = applyInstead(prev.effects, clause[1], ctx);
        if (upgraded) {
          prev.effects = [{ k: 'earthRite', then: upgraded, else: prev.effects }];
          continue;
        }
      }
      const extra = compileSentences(earthLine[1], ctx);
      if (extra) {
        const wrapped: Effect[] = [{ k: 'earthRite', then: extra }];
        if (prev) prev.effects = [...prev.effects, ...wrapped];
        else res.abilities.push({ on: 'fanfare', effects: wrapped });
        continue;
      }
      res.unparsed.push(line);
      continue;
    }

    // A line that is nothing but "<clause> instead.", optionally conditional,
    // varies the previous line's ability rather than adding one of its own.
    // Only a single unprefixed sentence qualifies: the keyword forms above
    // ("Necromancy (6): Deal 3 damage instead.") are already handled, and a
    // multi-sentence line resolves its own "instead" inside compileSentences.
    if (splitSentences(line).length === 1 && !matchPrefix(line)) {
      const peeled = peelCondition(line.replace(/\.$/, ''));
      const m = tidy(peeled.body).match(/^(.*)\binstead$/i);
      const prev = res.abilities[res.abilities.length - 1];
      if (m && prev) {
        const upgraded = applyInstead(prev.effects, m[1], ctx);
        if (upgraded) {
          prev.effects = peeled.cond
            ? [{ k: 'if', cond: peeled.cond, then: upgraded, else: prev.effects }]
            : upgraded;
          continue;
        }
      }
    }

    const prefix = matchPrefix(line);
    if (prefix) {
      const nested = prefix.rest.match(/^enhance \((\d+)\)\s*[-:]\s*(.*)$/i);
      if (nested) {
        const effects = compileSentences(nested[2], ctx);
        if (effects) res.enhance.push({ cost: num(nested[1]), effects, text: line });
        else res.unparsed.push(line);
        continue;
      }
      const effects = compileSentences(prefix.rest, ctx);
      if (effects) {
        const wrapped = prefix.wrap ? prefix.wrap(effects) : effects;
        for (const on of prefix.triggers) {
          const ability: Ability = { on, effects: wrapped };
          if (prefix.cond) ability.cond = prefix.cond;
          res.abilities.push(ability);
        }
      } else {
        res.unparsed.push(line);
      }
      continue;
    }

    // A prefix-less line on a spell is the spell's own effect. On a follower or
    // amulet it is a static rule, which `matchStatic` has already had a go at.
    if (baseCtx.selfType === 'spell' || baseCtx.selfType === 'amulet') {
      const effects = compileSentences(line, ctx);
      if (effects) {
        res.abilities.push({ on: baseCtx.selfType === 'spell' ? 'fanfare' : 'countdownEnd', effects });
        continue;
      }
    }

    // "Banish an enemy follower." / "Restore X defense to your leader. X equals
    // that follower's defense." — the second line reads a stat off the first
    // line's target, so the two become one ability bound to that entity.
    const carryCtx: CompileCtx = { ...baseCtx };
    const carried = compileSentences(line, carryCtx, { bindOther: false });
    if (carried && carryCtx.usesOther) {
      const prev = res.abilities[res.abilities.length - 1];
      const sel = prev ? primaryTarget(prev.effects) : null;
      if (prev && sel) {
        prev.effects = [{ k: 'withTarget', target: sel, body: [...prev.effects, ...carried] }];
        continue;
      }
    }

    res.unparsed.push(line);
  }

  return res;
}

// ---------------------------------------------------------------------------
// Targeting inference
// ---------------------------------------------------------------------------

/** Infers the target request a card raises when played, from its effects. */
export function inferTargeting(abilities: Ability[]): TargetSpec | undefined {
  for (const ab of abilities) {
    if (ab.on !== 'fanfare') continue;
    const sel = findTargetSelector(ab.effects);
    if (sel) return { selector: sel };
  }
  return undefined;
}

function findTargetSelector(effects: Effect[]): Selector | undefined {
  for (const e of effects) {
    switch (e.k) {
      case 'damage':
      case 'heal':
      case 'destroy':
      case 'banish':
      case 'buff':
      case 'grant':
      case 'revoke':
      case 'setStats':
      case 'returnToHand':
      case 'transform':
      case 'evolveTarget':
      case 'countdown':
        if (e.target.scope === 'target') return e.target;
        break;
      case 'if': {
        const s = findTargetSelector(e.then) ?? (e.else ? findTargetSelector(e.else) : undefined);
        if (s) return s;
        break;
      }
      case 'repeat': {
        const s = findTargetSelector(e.body);
        if (s) return s;
        break;
      }
      case 'necromancy':
      case 'earthRite': {
        const s = findTargetSelector(e.then) ?? (e.else ? findTargetSelector(e.else) : undefined);
        if (s) return s;
        break;
      }
      case 'chooseOne':
        for (const o of e.options) {
          const s = findTargetSelector(o.effects);
          if (s) return s;
        }
        break;
      default:
        break;
    }
  }
  return undefined;
}
