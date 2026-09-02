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
  BuffDuration,
  LeaderFlag,
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
  /**
   * Lowercased card name -> engine id, for "Summon a Knight" style references.
   * Lowercased because the printed text capitalises names inconsistently.
   */
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
  [/^reduce damage from effects to 0$/i, 'effectImmune'],
  // Without the qualifier this stops combat damage too, which is a different
  // thing entirely — Athena would otherwise not survive a trade.
  [/^reduce damage to 0$/i, 'damageImmune'],
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
  const key = tidy(name).toLowerCase();
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
/**
 * The engine id for a card named in rules text, trying the plural forms the
 * printed text actually uses. Returns null when the phrase names no card.
 */
function namedCard(
  noun: string,
  ctx: CompileCtx | undefined,
): { id: string; plural: boolean } | null {
  if (!ctx) return null;
  const tries: [string, boolean][] = [[noun, false]];
  if (noun.endsWith('ies')) tries.push([`${noun.slice(0, -3)}y`, true]);
  if (noun.endsWith('es')) tries.push([noun.slice(0, -2), true]);
  if (noun.endsWith('s')) tries.push([noun.slice(0, -1), true]);
  for (const [t, plural] of tries) {
    const id = ctx.names.get(t);
    if (id) return { id, plural };
  }
  return null;
}

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
  let plural = false;
  let determined = false;

  if (/^(all|each|every)\s+/.test(s)) {
    scope = 'all';
    determined = true;
    s = s.replace(/^(all|each|every)\s+/, '');
  } else {
    const d = s.match(/^(\d+|a|an|the|two|three|another|other)\s+/);
    if (d) {
      const w = d[1];
      determined = true;
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

  // State qualifiers. The printed text puts these on either side of the
  // allegiance word — "an evolved allied follower", "an allied damaged
  // follower" — so the peel runs before and after it.
  const peelState = (): void => {
    for (let i = 0; i < 2; i++) {
      if (/^evolved\s+/.test(s)) {
        filter.evolved = true;
        s = s.replace(/^evolved\s+/, '');
      }
      if (/^damaged\s+/.test(s)) {
        filter.damaged = true;
        s = s.replace(/^damaged\s+/, '');
      }
    }
  };
  peelState();

  // Side.
  let side: Selector['side'] = 'both';
  if (/^(enemy|opposing)\s+/.test(s)) {
    side = 'enemy';
    s = s.replace(/^(enemy|opposing)\s+/, '');
  } else if (/^(allied|friendly|your)\s+/.test(s)) {
    side = 'ally';
    s = s.replace(/^(allied|friendly|your)\s+/, '');
  }
  peelState();

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
  plural = /s$/.test(s);
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
    default: {
      // A card named outright — "allied Zombies", "an allied Forest Bat".
      // These are nearly always tokens the same card also creates, so the
      // definition id is an exact match and the head noun carries no kind.
      const named = namedCard(s, _ctx);
      if (named === null) return null;
      filter.defId = named.id;
      kind = 'any';
      plural = named.plural;
      break;
    }
  }

  // A bare plural with no determiner means every one of them: "Give +0/+1 and
  // Ward to allied Zombies" buffs the whole graveyard's worth, not one the
  // player picks. Without this they compile to a single chosen target, which
  // is a different card.
  if (plural && !determined && scope === 'target') scope = 'all';

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

// ---------------------------------------------------------------------------
// Durations
// ---------------------------------------------------------------------------

/**
 * The trailing "until ..." clause, as an optional group. Anything outside this
 * set makes the surrounding rule fail to match, which leaves the card partial
 * — better than silently giving it a shorter effect than it prints.
 */
const UNTIL = `(?: until the (?:end of (?:the|this|your|your opponent['’]s|the opponent['’]s) turn|start of your next turn))?`;

/** The duration named by a clause, or null when the engine cannot honour it. */
function durationOfClause(clause: string): BuffDuration | null {
  const u = tidy(clause).toLowerCase().replace(/\.$/, '').replace(/^until\s+/, '');
  if (/^the end of (?:the|this|your) turn$/.test(u)) return 'turn';
  // "Until the start of your next turn" is the same span as the opponent's
  // turn ending, and the printed cards use the two interchangeably.
  if (/^the end of (?:your |the )?opponent['’]s turn$/.test(u)) return 'opponentTurn';
  if (/^the start of your next turn$/.test(u)) return 'opponentTurn';
  return null;
}

/**
 * A restriction the engine enforces on a leader, or null. Each of these is
 * checked at exactly one place in the engine, so the phrasing is matched
 * exactly rather than approximated — a near miss leaves the card partial.
 */
function leaderFlag(phrase: string): LeaderFlag | null {
  const p = tidy(phrase).toLowerCase().replace(/\.$/, '');
  if (/^followers can'?t be played$/.test(p)) return 'cantPlayFollowers';
  if (/^you will not gain a play point at the start of your turn$/.test(p)) return 'noPlayPointGain';
  if (/^allied fanfare effects will not activate$/.test(p)) return 'noFanfare';
  return null;
}

/** The duration of a matched line, reading its last "until" clause. */
function durationIn(text: string): BuffDuration | null {
  const i = text.toLowerCase().lastIndexOf(' until ');
  if (i < 0) return 'permanent';
  return durationOfClause(text.slice(i + 1));
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

  m = s.match(/^(.*?),?\s*if at least (\d+) (?:other )?cards? (?:were|was|have been|has been) played this turn\.?$/i);
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

  // "…if their defense is higher than yours" — a comparison between leaders.
  m = s.match(/^(.*?),?\s*if (?:their|the enemy leader's|the leader's) defense is higher than yours\.?$/i);
  if (m) {
    return {
      body: m[1],
      cond: {
        k: 'greater',
        a: { k: 'leaderDefense', side: 'enemy' },
        b: { k: 'leaderDefense', side: 'ally' },
      },
    };
  }

  // "If another allied follower is in play, …" and its relatives. The noun
  // phrase is parsed as a selector, so "an evolved allied follower" and
  // "an allied Officer follower" work the same way.
  m = s.match(/^if (?:there (?:is|are) )?(.+?) (?:is|are) in play,\s*(.*)$/i);
  if (m) {
    const sel = parseSelector(m[1]);
    if (sel) return { body: m[2], cond: { k: 'exists', sel: { ...sel, scope: 'all' } } };
  }
  m = s.match(/^(.*?),?\s*if (?:there (?:is|are) )?(.+?) (?:is|are) in play\.?$/i);
  if (m) {
    const sel = parseSelector(m[2]);
    if (sel) return { body: m[1], cond: { k: 'exists', sel: { ...sel, scope: 'all' } } };
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
  m = p.match(/^(?:(?:each )?of )?your (?:remaining )?play points?$/);
  if (m) return { k: 'pp' };

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

/** "Ward and Bane", "Rush, and Bane" — the keywords named in a list. */
function keywordList(text: string): Keyword[] {
  return text
    .split(/,|\band\b/i)
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean)
    .map((w) => KEYWORD_WORDS[w])
    .filter((k): k is Keyword => !!k);
}

/** A stat change token with its sign: "-2" in "Give an enemy follower -2/-0". */
function signed(sign: string, token: string, ctx: CompileCtx): Amount | null {
  const v = amt(token, ctx);
  if (v === null) return null;
  if (sign !== '-') return v;
  // `-0` and `0` are the same stat change, but not the same value; normalise so
  // compiled effects compare equal whichever way the text spelled it.
  return typeof v === 'number' ? (v === 0 ? 0 : -v) : { k: 'mul', a: -1, b: v };
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
    re: new RegExp(`^give \\+${N}/\\+${N} and (${KW_ALT}) to (.+?)${UNTIL}$`, 'i'),
    build: (m, ctx) => {
      const t = parseSelector(m[4], ctx);
      const a = amt(m[1], ctx);
      const d = amt(m[2], ctx);
      if (!t || a === null || d === null) return null;
      const duration = durationIn(m[0]);
      if (duration === null) return null;
      return [
        { k: 'buff', target: t, atk: a, def: d, duration },
        { k: 'grant', target: t, keywords: [KEYWORD_WORDS[m[3].toLowerCase()]], duration },
      ];
    },
  },
  {
    // "Give an allied follower +3/+3 and Rush." — the ditransitive order with a
    // keyword rider.
    re: new RegExp(
      `^give (?![-+])(.+?) \\+${N}/\\+${N} and (${KW_ALT})${UNTIL}$`,
      'i',
    ),
    build: (m, ctx) => {
      const t = parseSelector(m[1], ctx);
      const a = amt(m[2], ctx);
      const d = amt(m[3], ctx);
      if (!t || a === null || d === null) return null;
      const duration = durationIn(m[0]);
      if (duration === null) return null;
            return [
        { k: 'buff', target: t, atk: a, def: d, duration },
        { k: 'grant', target: t, keywords: [KEYWORD_WORDS[m[4].toLowerCase()]], duration },
      ];
    },
  },
  {
    // "Gain +1/+1, Ward and Bane." — any number of keywords after the stats.
    re: new RegExp(
      `^gain \\+${N}/\\+${N},? (?:and )?((?:${KW_ALT})(?:,? (?:and )?(?:${KW_ALT}))*)${UNTIL}$`,
      'i',
    ),
    build: (m, ctx) => {
      const a = amt(m[1], ctx);
      const d = amt(m[2], ctx);
      const keywords = keywordList(m[3]);
      if (a === null || d === null || keywords.length === 0) return null;
      const duration = durationIn(m[0]);
      if (duration === null) return null;
            return [
        { k: 'buff', target: { scope: 'self' }, atk: a, def: d, duration },
        { k: 'grant', target: { scope: 'self' }, keywords, duration },
      ];
    },
  },
  {
    // The ditransitive word order, and debuffs: "Give all other allied
    // followers +0/+1", "Give an enemy follower -10/-0".
    re: new RegExp(
      `^give (?![-+])(.+?) ([-+])${N}/([-+])${N}${UNTIL}$`,
      'i',
    ),
    build: (m, ctx) => {
      const t = parseSelector(m[1], ctx);
      const a = signed(m[2], m[3], ctx);
      const d = signed(m[4], m[5], ctx);
      if (!t || a === null || d === null) return null;
      const duration = durationIn(m[0]);
      if (duration === null) return null;
      return [{ k: 'buff', target: t, atk: a, def: d, duration }];
    },
  },
  {
    re: new RegExp(
      `^give ([-+])${N}/([-+])${N} to (.+?)${UNTIL}$`,
      'i',
    ),
    build: (m, ctx) => {
      const t = parseSelector(m[5], ctx);
      const a = signed(m[1], m[2], ctx);
      const d = signed(m[3], m[4], ctx);
      if (!t || a === null || d === null) return null;
      const duration = durationIn(m[0]);
      if (duration === null) return null;
      return [{ k: 'buff', target: t, atk: a, def: d, duration }];
    },
  },
  {
    re: new RegExp(`^give (?:it|that follower) ([-+])${N}/([-+])${N}${UNTIL}$`, 'i'),
    build: (m, ctx) => {
      const a = signed(m[1], m[2], ctx);
      const d = signed(m[3], m[4], ctx);
      if (a === null || d === null) return null;
      const duration = durationIn(m[0]);
      if (duration === null) return null;
      return [{ k: 'buff', target: { scope: 'other' }, atk: a, def: d, duration }];
    },
  },
  {
    /**
     * "Give your leader the following effect: Followers can't be played."
     *
     * A leader is not an entity, so these cannot go through `grantAbility`.
     * The clause after the dash is one or more sentences, each either a named
     * restriction the engine knows how to enforce or an ability hung on the
     * leader. Anything else fails the whole line rather than dropping a part
     * of it.
     */
    re: /^give (your|the enemy|the opponent's) leader the following effects?( until [^-:—]+?)?\s*[-:—]\s*(.+)$/i,
    build: (m, ctx) => {
      const until = (m[2] ?? '').trim();
      const duration = until ? durationOfClause(until) : 'permanent';
      if (duration === null) return null;

      const flags: LeaderFlag[] = [];
      const abilities: Ability[] = [];
      // "At the end of *this* turn" fires once; "at the end of *your* turn"
      // fires every turn. Left permanent, the one-shot version would discard
      // the hand again on every turn for the rest of the match.
      let oneShot = false;
      for (const raw of m[3].split(/(?<=\.)\s+/)) {
        const part = tidy(raw).replace(/\.$/, '');
        if (!part) continue;
        const flag = leaderFlag(part);
        if (flag) {
          flags.push(flag);
          continue;
        }
        const ab = compileGrantedAbility(part, ctx);
        if (!ab) return null;
        if (/^at the (?:end|start) of this turn,/i.test(part)) oneShot = true;
        abilities.push(...ab);
      }
      if (flags.length === 0 && abilities.length === 0) return null;
      // A one-shot cannot be mixed with anything meant to outlast the turn.
      if (oneShot && (flags.length > 0 || duration === 'opponentTurn')) return null;

      const eff: Effect = {
        k: 'grantLeader',
        side: /your/i.test(m[1]) ? 'ally' : 'enemy',
        duration: oneShot ? 'turn' : duration,
      };
      if (flags.length > 0) eff.flags = flags;
      if (abilities.length > 0) eff.abilities = abilities;
      return [eff];
    },
  },
  {
    /**
     * "Give all other allied followers the following effect until the end of
     * the turn - Reduce damage to 0."
     *
     * The clause after the dash is itself card text, so it is compiled the same
     * way any line is: as a keyword if it names one, otherwise as a whole
     * ability handed to the target.
     */
    re: /^give (.+?) the following effects?( until [^-:—]+?)?\s*[-:—]\s*(.+)$/i,
    build: (m, ctx) => {
      const t = parseSelector(m[1], ctx);
      if (!t) return null;

      // "Until this follower leaves play" and the like outlive every duration
      // the engine can express, and it has nowhere to hang them — such a card
      // stays partial rather than quietly getting a shorter effect than it
      // prints.
      const until = (m[2] ?? '').trim();
      const duration = until ? durationOfClause(until) : 'permanent';
      if (duration === null) return null;

      const clause = tidy(m[3]).replace(/\.$/, '');
      const kw = phraseKeyword(clause) ?? KEYWORD_WORDS[clause.toLowerCase()];
      if (kw) return [{ k: 'grant', target: t, keywords: [kw], duration }];

      const granted = compileGrantedAbility(clause, ctx);
      return granted ? [{ k: 'grantAbility', target: t, abilities: granted, duration }] : null;
    },
  },
  {
    // "Give an allied follower Rush." — the keyword grant in the same order.
    re: new RegExp(`^give (.+?) (${KW_ALT})${UNTIL}$`, 'i'),
    build: (m, ctx) => {
      const t = parseSelector(m[1], ctx);
      if (!t) return null;
      const duration = durationIn(m[0]);
      if (duration === null) return null;
      return [
        {
          k: 'grant',
          target: t,
          keywords: [KEYWORD_WORDS[m[2].toLowerCase()]],
          duration,
        },
      ];
    },
  },
  {
    re: new RegExp(`^give \\+${N}/\\+${N} to (.+?)${UNTIL}$`, 'i'),
    build: (m, ctx) => {
      const t = parseSelector(m[3], ctx);
      const a = amt(m[1], ctx);
      const d = amt(m[2], ctx);
      if (!t || a === null || d === null) return null;
      const duration = durationIn(m[0]);
      if (duration === null) return null;
      return [{ k: 'buff', target: t, atk: a, def: d, duration }];
    },
  },
  {
    re: new RegExp(`^gain \\+${N}/\\+${N} and (${KW_ALT})${UNTIL}$`, 'i'),
    build: (m, ctx) => {
      const a = amt(m[1], ctx);
      const d = amt(m[2], ctx);
      if (a === null || d === null) return null;
      const duration = durationIn(m[0]);
      if (duration === null) return null;
      return [
        { k: 'buff', target: { scope: 'self' }, atk: a, def: d, duration },
        { k: 'grant', target: { scope: 'self' }, keywords: [KEYWORD_WORDS[m[3].toLowerCase()]], duration },
      ];
    },
  },
  {
    re: new RegExp(`^gain \\+${N}/\\+${N}${UNTIL}$`, 'i'),
    build: (m, ctx) => {
      const a = amt(m[1], ctx);
      const d = amt(m[2], ctx);
      if (a === null || d === null) return null;
      const duration = durationIn(m[0]);
      if (duration === null) return null;
      return [{ k: 'buff', target: { scope: 'self' }, atk: a, def: d, duration }];
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
    re: new RegExp(`^gain (${KW_ALT})${UNTIL}$`, 'i'),
    build: (m) => {
      const duration = durationIn(m[0]);
      if (duration === null) return null;
      return [
        {
          k: 'grant',
          target: { scope: 'self' },
          keywords: [KEYWORD_WORDS[m[1].toLowerCase()]],
          duration,
        },
      ];
    },
  },
  {
    re: new RegExp(`^give (?:it|that follower) \\+${N}/\\+${N}${UNTIL}$`, 'i'),
    build: (m, ctx) => {
      const a = amt(m[1], ctx);
      const d = amt(m[2], ctx);
      if (a === null || d === null) return null;
      const duration = durationIn(m[0]);
      if (duration === null) return null;
      return [{ k: 'buff', target: { scope: 'other' }, atk: a, def: d, duration }];
    },
  },
  {
    // "That follower gains Last Words: Summon a Zombie."
    re: /^(?:that follower|it|they) gains? ((?:fanfare|last words|evolve|clash|strike|follower strike)\s*[-:—].+)$/i,
    build: (m, ctx) => {
      const abilities = compileGrantedAbility(m[1], ctx);
      return abilities ? [{ k: 'grantAbility', target: { scope: 'other' }, abilities }] : null;
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
    // "Randomly discard 1 of the lowest-cost cards in your hand" — the pool is
    // the cheapest cards, and the randomness only breaks ties among them.
    re: /^randomly discard (a|\d+) (?:of the )?(lowest|highest)-cost cards? (?:in|from) your hand$/i,
    build: (m) => [
      {
        k: 'discard',
        amount: num(m[1], 1),
        random: true,
        pick: m[2].toLowerCase() === 'lowest' ? 'lowestCost' : 'highestCost',
      },
    ],
  },
  {
    re: /^randomly discard (a|\d+) cards?(?: (?:in|from) your hand)?$/i,
    build: (m) => [{ k: 'discard', amount: num(m[1], 1), random: true }],
  },
  {
    // "Discard all spells in your hand." The count is the hand size, which the
    // type filter then narrows — there is never more of a type than that.
    re: /^discard all (followers?|spells?|amulets?) (?:in|from) your hand$/i,
    build: (m) => [
      {
        k: 'discard',
        amount: { k: 'handSize' },
        type: m[1].toLowerCase().replace(/s$/, '') as 'follower' | 'spell' | 'amulet',
      },
    ],
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
  { re: /^win the (?:match|game)$/i, build: () => [{ k: 'win' }] },
  {
    // "Deal damage to the enemy leader until their defense drops to 0."
    re: /^deal damage to the enemy leader until (?:their|its) defense drops to (\d+)$/i,
    build: (m) => [
      {
        k: 'damage',
        target: { scope: 'leader', side: 'enemy' },
        amount: {
          k: 'max',
          a: 0,
          b: { k: 'sum', of: [{ k: 'leaderDefense', side: 'enemy' }, -num(m[1])] },
        },
      },
    ],
  },
  { re: /^gain (\d+) evolution points?$/i, build: (m) => [{ k: 'gainEP', amount: num(m[1]) }] },
  { re: /^recover (\d+) evolution points?$/i, build: (m) => [{ k: 'gainEP', amount: num(m[1]) }] },

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
      const duration = durationIn(m[0]);
      if (duration === null) return null;
      return [{ k: 'grant', target: t, keywords: [kw], duration }];
      void ctx;
    },
  },
  {
    re: /^gain the following effect\s*[-:]\s*(.+)$/i,
    build: (m) => {
      const kw = phraseKeyword(m[1]);
      if (!kw) return null;
      const duration = durationIn(m[0]);
      if (duration === null) return null;
      return [{ k: 'grant', target: { scope: 'self' }, keywords: [kw], duration }];
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
    re: /^transform (.+?) into (?:(?:an?|the) )?([\w' -]+)$/i,
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

/**
 * "If another allied follower is in play, destroy that follower …" — "that
 * follower" is the one the condition just named, and the player picks which.
 * Without this the effect compiles to the trigger's `other` binding, which is
 * empty in a Fanfare and would silently destroy nothing.
 */
function bindOtherToCondition(effects: Effect[], cond: Condition | undefined): Effect[] {
  if (!cond || cond.k !== 'exists') return effects;
  const target: Selector = { ...cond.sel, scope: 'target' };
  const walk = (list: Effect[]): Effect[] =>
    list.map((e) => {
      if ('target' in e && e.target && (e.target as Selector).scope === 'other') {
        return { ...e, target } as Effect;
      }
      if (e.k === 'if') return { ...e, then: walk(e.then), ...(e.else ? { else: walk(e.else) } : {}) };
      if (e.k === 'repeat') return { ...e, body: walk(e.body) };
      return e;
    });
  return walk(effects);
}

/**
 * Compiles the clause of a "give X the following effect: …" line into the
 * abilities to hand over. The clause is ordinary card text — "Follower Strike -
 * Destroy the enemy follower", "When this card is banished, destroy it instead"
 * — so it goes through the same prefix matching as a printed line.
 */
function compileGrantedAbility(clause: string, ctx: CompileCtx): Ability[] | null {
  const prefix = matchPrefix(clause, ctx);
  if (!prefix) return null;
  const effects = compileSentences(prefix.rest, ctx);
  if (!effects) return null;
  const wrapped = prefix.wrap ? prefix.wrap(effects) : effects;
  return prefix.triggers.map((on) => {
    const ability: Ability = { on, effects: wrapped };
    if (prefix.cond) ability.cond = prefix.cond;
    return ability;
  });
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
    const bound = bindOtherToCondition(eff, peeled.cond);
    return peeled.cond ? [{ k: 'if', cond: peeled.cond, then: bound }] : bound;
  }
  return null;
}

/**
 * "Select an enemy follower. It can't attack next turn." is one instruction
 * printed as two sentences: the first names the target, the second says what
 * happens to it. When the naming sentence has no effect of its own, it is
 * folded into the one that follows so the pair can be read as a whole.
 */
function mergeSelectClauses(sentences: string[], ctx: CompileCtx): string[] {
  const out: string[] = [];
  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i];
    const next = sentences[i + 1];
    if (next && /^(?:select|choose) /i.test(s) && !parseSentence(s.replace(/\.$/, ''), ctx)) {
      out.push(`${s} ${next}`);
      i++;
      continue;
    }
    // "Give your leader the following effects - <A>. <B>." lists the granted
    // effects as separate sentences. Splitting there orphans everything after
    // the first, so the clause swallows the rest of the line.
    if (/\bthe following effects?\s*[-:—]/i.test(s)) {
      out.push(sentences.slice(i).join(' '));
      break;
    }
    out.push(s);
  }
  return out;
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
  const sentences = mergeSelectClauses(splitSentences(bound), ctx);
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

  // "Give +2/+0 to an allied follower. That follower gains Last Words: …" —
  // the second sentence refers to the first sentence's target. Outside a
  // trigger there is nothing bound to `other`, so the line binds it itself.
  if (opts.bindOther !== false) {
    const named = out.findIndex(
      (e) => 'target' in e && e.target && (e.target as Selector).scope !== 'other',
    );
    const refers = out.findIndex(
      (e) => 'target' in e && e.target && (e.target as Selector).scope === 'other',
    );
    if (named >= 0 && refers > named) {
      const sel = primaryTarget(out);
      if (sel) return [{ k: 'withTarget', target: sel, body: out }];
    }
  }
  return out;
}

/** Splits "Destroy an allied follower and summon a Lich." into two effects. */
function splitConjunction(sentence: string, ctx: CompileCtx): Effect[] | null {
  const peeled = peelCondition(sentence);
  const body = tidy(peeled.body);
  // A bare comma is last: it only splits when both halves parse on their own,
  // which is what makes "Summon a Club Soldier, a Heart Guardian, and a Spade
  // Raider" work without mis-splitting ordinary commas.
  for (const sep of [', and then ', ' and then ', ', and ', ' and ', ', ']) {
    let idx = body.toLowerCase().indexOf(sep);
    while (idx > 0) {
      const left = body.slice(0, idx);
      const right = body.slice(idx + sep.length);
      const a = parseSentence(left, ctx);
      if (a) {
        // "Summon a Pirate and a Viking" — the right half has no verb of its
        // own, so it borrows the left one. The right half may itself be a list,
        // as in "a Club Soldier, a Heart Guardian, and a Spade Raider".
        const verb = left.match(/^(\w+)\s/);
        const tryBoth = (text: string) => parseSentence(text, ctx) ?? splitConjunction(text, ctx);
        const b = tryBoth(right) ?? (verb ? tryBoth(`${verb[1]} ${right}`) : null);
        if (b) {
          const both = bindOtherToCondition([...a, ...b], peeled.cond);
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

function matchPrefix(line: string, ctx?: CompileCtx): PrefixMatch | null {
  const l = line.trim();

  // A dash separates the trigger from its body as often as a colon does, and
  // always does inside a "give ... the following effect" clause.
  const SEP = '\\s*[-:\u2014]\\s*';
  const simple: [RegExp, TriggerKind[]][] = [
    [new RegExp(`^fanfare and last words${SEP}`, 'i'), ['fanfare', 'lastWords']],
    [new RegExp(`^fanfare${SEP}`, 'i'), ['fanfare']],
    [new RegExp(`^last words${SEP}`, 'i'), ['lastWords']],
    [new RegExp(`^evolve${SEP}`, 'i'), ['evolve']],
    [new RegExp(`^clash${SEP}`, 'i'), ['clash']],
    [new RegExp(`^follower strike${SEP}`, 'i'), ['strike']],
    [new RegExp(`^strike${SEP}`, 'i'), ['strike']],
  ];
  for (const [re, triggers] of simple) {
    const m = l.match(re);
    if (m) return withInner(triggers, l.slice(m[0].length));
  }

  const timed: [RegExp, TriggerKind[]][] = [
    // Some cards spell Fanfare out instead of naming it.
    [/^when this (?:follower|card|amulet) comes into play,\s*/i, ['fanfare']],
    [/^at the end of (?:your|this) turn,\s*/i, ['turnEnd']],
    [/^at the start of (?:your|this) turn,\s*/i, ['turnStart']],
    [/^at the end of (?:the opponent's|your opponent's) turn,\s*/i, ['enemyTurnEnd']],
    [/^whenever (?:an|another) allied follower comes into play,\s*/i, ['onAllyFollowerPlayed']],
    [/^whenever (?:another allied follower|an allied follower) is destroyed,\s*/i, ['onAllyFollowerDestroyed']],
    [/^whenever an enemy follower is destroyed,\s*/i, ['onEnemyFollowerDestroyed']],
    [/^whenever (?:you|this player) (?:cast|play) a spell,\s*/i, ['onAllySpellPlayed']],
    [/^whenever your leader takes damage,\s*/i, ['onLeaderDamaged']],
    [/^whenever this follower (?:attacks|is attacked),\s*/i, ['clash']],
    [/^whenever this follower attacks,\s*/i, ['strike']],
    // "Another follower" includes the opponent's; "an allied follower" does not.
    [/^whenever another follower evolves,\s*/i, ['onEvolveAny']],
    [/^whenever an allied follower evolves,\s*/i, ['onEvolveAlly']],
    [/^whenever you perform necromancy,\s*/i, ['onNecromancy']],
    [/^whenever you discard cards from your hand,\s*/i, ['onDiscard']],
    [/^whenever your leader's defense is restored,\s*/i, ['onHeal']],
    [/^whenever an enemy follower comes into play,\s*/i, ['onEnemyFollowerPlayed']],
    // The engine only fires this one when the attacker survives, which is what
    // the printed "if this follower is not destroyed" says.
    [
      /^whenever this follower attacks and destroys an enemy follower,(?: if this follower is not destroyed,)?\s*/i,
      ['onDestroyEnemy'],
    ],
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
  const subject = l.match(/^whenever an allied (.+?) comes into play,?\s*/i);
  if (subject) {
    const filter: Record<string, unknown> = {};
    let phrase = subject[1].trim();

    const cost = phrase.match(/^(.*?)\s*that originally costs (\d+) play points?$/i);
    if (cost) {
      phrase = cost[1].trim();
      filter.costMin = num(cost[2]);
      filter.costMax = num(cost[2]);
    }
    // "Officer follower" and "Fairy" both name the subject; the noun is
    // optional because a card name stands on its own.
    phrase = phrase.replace(/\s*(?:follower|card)$/i, '').trim();

    if (phrase) {
      const word = phrase.toLowerCase();
      const t = TRAIT_WORDS.find((x) => x.toLowerCase() === word);
      // "Whenever an allied Fairy comes into play" names a card, not a tribe.
      const named = ctx?.names.get(word);
      if (t) filter.trait = t;
      else if (word === 'neutral') filter.cardClass = 'neutral';
      else if (named) filter.defId = named;
      else return null;
    }
    const inner = withInner(['onAllyFollowerPlayed'], l.slice(subject[0].length));
    inner.cond = { k: 'subject', filter: filter as never };
    return inner;
  }

  // "…during your turn" narrows a trigger that otherwise fires on both turns.
  const duringYourTurn = l.match(/^whenever an enemy follower is destroyed during your turn,\s*/i);
  if (duringYourTurn) {
    const inner = withInner(['onEnemyFollowerDestroyed'], l.slice(duringYourTurn[0].length));
    inner.cond = { k: 'not', c: { k: 'opponentTurn' } };
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
    'reduce damage to 0': 'damageImmune',
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

  // "Can't take more than 3 damage at a time." — a ceiling on each instance,
  // not a flat reduction.
  const capSelf = l.match(/^can'?t take more than (\d+) damage at a time$/);
  if (capSelf) {
    res.auras.push({ target: { scope: 'self' }, damageCap: num(capSelf[1]) });
    return true;
  }
  const capLeader = l.match(
    /^(?:while this (?:amulet|follower) is in play, )?your leader (?:and all allied followers(?: in play and that come into play)? )?can'?t take more than (\d+) damage at a time$/,
  );
  if (capLeader) {
    const n = num(capLeader[1]);
    res.auras.push({ target: { scope: 'self' }, leader: true, damageCap: n });
    if (/allied followers/.test(l)) {
      res.auras.push({ target: { scope: 'all', side: 'ally', kind: 'follower' }, damageCap: n });
    }
    return true;
  }

  // "Fanfare: Reduce damage to your leader to 0 until this follower leaves
  // play." and "Fanfare: Activate Vengeance ... until this amulet leaves play."
  //
  // A Fanfare that lasts exactly as long as its card is in play is an aura:
  // auras switch on when the card arrives and off when it goes, which is the
  // printed duration exactly, and needs no expiry keyed to an entity lifetime.
  // This only holds where the effect targets the leader or the whole game —
  // "give all allied Officer followers ... until this follower leaves play"
  // picks its targets once, at Fanfare time, and an aura would also catch the
  // ones that arrive later, so that one stays partial.
  const leaderImmune = l.match(
    /^(?:fanfare:\s*)?reduce damage to your leader to 0 until this (?:follower|amulet) leaves play$/,
  );
  if (leaderImmune) {
    res.auras.push({ target: { scope: 'self' }, leader: true, damageCap: 0 });
    return true;
  }
  if (
    /^(?:fanfare:\s*)?activate vengeance even if your leader's defense is greater than 10\.?$/.test(
      l.replace(/\s*this effect lasts until this (?:amulet|follower) leaves play\.?$/, '').trim(),
    )
  ) {
    res.auras.push({ target: { scope: 'self' }, forceVengeance: true });
    return true;
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
    if (splitSentences(line).length === 1 && !matchPrefix(line, ctx)) {
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

    const prefix = matchPrefix(line, ctx);
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
