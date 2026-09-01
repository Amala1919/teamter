/**
 * Core vocabulary of the rules engine.
 *
 * Nothing in this file knows that a renderer exists. The engine's only output
 * to the outside world is the `GameEvent` stream at the bottom — the Three.js
 * layer subscribes to that and never mutates state directly.
 */

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export type ClassId =
  | 'forest'
  | 'sword'
  | 'rune'
  | 'dragon'
  | 'shadow'
  | 'blood'
  | 'haven'
  | 'neutral';

export const CRAFT_CLASSES: readonly ClassId[] = [
  'forest',
  'sword',
  'rune',
  'dragon',
  'shadow',
  'blood',
  'haven',
] as const;

/** Card sets from launch through the 5th pack, in release order. */
export type SetId = 'basic' | 'standard' | 'darkness' | 'bahamut' | 'tempest' | 'wonderland';

export const SET_ORDER: readonly SetId[] = [
  'basic',
  'standard',
  'darkness',
  'bahamut',
  'tempest',
  'wonderland',
] as const;

export type Rarity = 'bronze' | 'silver' | 'gold' | 'legendary';

export type CardType = 'follower' | 'spell' | 'amulet';

/** Follower tribes referenced by card text ("Officer", "Commander", ...). */
export type Trait =
  | 'Officer'
  | 'Commander'
  | 'Levin'
  | 'Machina'
  | 'Academic'
  | 'Mysteria'
  | 'Wonderland';

export type PlayerId = 0 | 1;

export const other = (p: PlayerId): PlayerId => (p === 0 ? 1 : 0);

// ---------------------------------------------------------------------------
// Keywords
// ---------------------------------------------------------------------------

export type Keyword =
  /** Cannot be bypassed: enemy followers must attack a Ward follower first. */
  | 'ward'
  /** May attack followers and the leader the turn it is played. */
  | 'storm'
  /** May attack followers (not the leader) the turn it is played. */
  | 'rush'
  /** Destroys any follower it deals combat damage to. */
  | 'bane'
  /** Damage dealt also restores that much defense to its owner's leader. */
  | 'drain'
  /** Cannot be attacked or targeted until it attacks or its owner's turn ends. */
  | 'ambush'
  /** Cannot be targeted by enemy spells or effects (rare in this era). */
  | 'untargetable'
  /** Combat damage taken is reduced to 0 once (Aura-like protection). */
  | 'barrier'
  /** Cannot attack at all. */
  | 'cantAttack'
  /** Cannot attack the enemy leader, only followers. */
  | 'cantAttackLeader'
  /** Cannot be chosen as the target of an attack. */
  | 'cantBeAttacked'
  /** Attacks are not stopped by enemy Ward followers. */
  | 'ignoreWard'
  /** Cannot be destroyed by effects (damage still applies). */
  | 'indestructible'
  /** Damage from effects is reduced to 0; combat damage still applies. */
  | 'effectImmune'
  /** May attack twice per turn. */
  | 'doubleAttack';

export const KEYWORD_LABEL: Record<Keyword, string> = {
  ward: 'Ward',
  storm: 'Storm',
  rush: 'Rush',
  bane: 'Bane',
  drain: 'Drain',
  ambush: 'Ambush',
  untargetable: 'Untargetable',
  barrier: 'Barrier',
  cantAttack: "Can't Attack",
  cantAttackLeader: "Can't Attack Leader",
  cantBeAttacked: "Can't Be Attacked",
  ignoreWard: 'Ignore Ward',
  indestructible: 'Indestructible',
  effectImmune: 'Effect Immune',
  doubleAttack: 'Double Attack',
};

export const KEYWORD_LABEL_JA: Record<Keyword, string> = {
  ward: '守護',
  storm: '疾走',
  rush: '突進',
  bane: '必殺',
  drain: 'ドレイン',
  ambush: '潜伏',
  untargetable: '対象不可',
  barrier: 'バリア',
  cantAttack: '攻撃不能',
  cantAttackLeader: 'リーダー攻撃不可',
  cantBeAttacked: '攻撃されない',
  ignoreWard: '守護無視',
  indestructible: '破壊されない',
  effectImmune: '効果ダメージ無効',
  doubleAttack: '連続攻撃',
};

// ---------------------------------------------------------------------------
// Selectors — "which things does this effect act on?"
// ---------------------------------------------------------------------------

export type Side = 'ally' | 'enemy' | 'both';

/** Predicate applied on top of a selector's scope. All fields AND together. */
export interface Filter {
  costMax?: number;
  costMin?: number;
  atkMax?: number;
  atkMin?: number;
  defMax?: number;
  defMin?: number;
  type?: CardType;
  cardClass?: ClassId;
  trait?: Trait;
  hasKeyword?: Keyword;
  lacksKeyword?: Keyword;
  evolved?: boolean;
  damaged?: boolean;
  /** Matches a specific card definition id. */
  defId?: string;
  /** Excludes the ability's own source entity. */
  notSelf?: boolean;
  /** Token cards only / never. */
  token?: boolean;
}

/** Leaders are addressable as targets via these sentinel uids. */
export const LEADER_UID = (p: PlayerId): number => (p === 0 ? -1 : -2);
export const leaderOfUid = (uid: number): PlayerId | null =>
  uid === -1 ? 0 : uid === -2 ? 1 : null;

export interface Selector {
  /**
   * - `target`  — chosen by the controller when the card is played/triggered
   * - `all`     — every matching entity
   * - `random`  — `count` matching entities chosen at random
   * - `self`    — the ability's own source entity
   * - `leader`  — a leader rather than a board entity
   * - `highest` / `lowest` — extremum by `by`, ties broken leftmost-first
   * - `other`   — the "other" participant of a combat/trigger context
   */
  scope: 'target' | 'all' | 'random' | 'self' | 'leader' | 'highest' | 'lowest' | 'other';
  side?: Side;
  /** Defaults to `follower` for board selectors. */
  kind?: 'follower' | 'amulet' | 'any';
  count?: number;
  filter?: Filter;
  by?: 'atk' | 'def' | 'cost';
  /** Also offers the matching leader(s), as "an enemy" does in card text. */
  includeLeader?: boolean;
  /** Only the leader, ignoring the board. */
  leaderOnly?: boolean;
  /** Zone to select from; defaults to the field. */
  zone?: 'field' | 'hand' | 'deck' | 'cemetery';
}

// ---------------------------------------------------------------------------
// Dynamic amounts — numbers that depend on game state
// ---------------------------------------------------------------------------

export type Amount =
  | number
  | { k: 'count'; of: Selector }
  | { k: 'shadows' }
  | { k: 'spellboost' }
  | { k: 'cardsPlayed' }
  | { k: 'handSize'; side?: Side }
  | { k: 'deckSize'; side?: Side }
  | { k: 'maxPP'; side?: Side }
  | { k: 'leaderDefenseLost'; side?: Side }
  | { k: 'sourceAtk' }
  | { k: 'sourceDef' }
  /** Value carried in the resolution context, e.g. damage just dealt. */
  | { k: 'ctx'; name: string }
  | { k: 'sum'; of: Amount[] }
  | { k: 'mul'; a: Amount; b: Amount }
  | { k: 'min'; a: Amount; b: Amount }
  | { k: 'max'; a: Amount; b: Amount };

// ---------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------

export type Condition =
  /** Bloodcraft: your leader is at 10 defense or less. */
  | { k: 'vengeance' }
  /** Dragoncraft: you have 7 or more maximum play points. */
  | { k: 'overflow' }
  /** Runecraft: your deck contains an even number of cards. */
  | { k: 'resonance' }
  /** Runecraft: you control an Earth Sigil amulet (does NOT consume it). */
  | { k: 'hasEarthSigil' }
  /** Cards played by the controller earlier this turn. */
  | { k: 'cardsPlayed'; n: number }
  /** True while it is not the controller's turn. */
  | { k: 'opponentTurn' }
  /** Shadowcraft: you have at least N shadows (does NOT spend them). */
  | { k: 'hasShadows'; n: number }
  | { k: 'atLeast'; a: Amount; b: Amount }
  | { k: 'greater'; a: Amount; b: Amount }
  | { k: 'equal'; a: Amount; b: Amount }
  | { k: 'exists'; sel: Selector }
  | { k: 'isEvolved'; sel?: Selector }
  | { k: 'not'; c: Condition }
  | { k: 'and'; cs: Condition[] }
  | { k: 'or'; cs: Condition[] };

// ---------------------------------------------------------------------------
// Effects — the data-driven vocabulary every card is built from
// ---------------------------------------------------------------------------

export type BuffDuration = 'permanent' | 'turn';

export type Effect =
  | { k: 'damage'; target: Selector; amount: Amount; drain?: boolean }
  | { k: 'heal'; target: Selector; amount: Amount }
  | { k: 'destroy'; target: Selector }
  | { k: 'banish'; target: Selector }
  | { k: 'buff'; target: Selector; atk?: Amount; def?: Amount; duration?: BuffDuration }
  | { k: 'setStats'; target: Selector; atk?: Amount; def?: Amount }
  | { k: 'grant'; target: Selector; keywords: Keyword[]; duration?: BuffDuration }
  | { k: 'revoke'; target: Selector; keywords: Keyword[] }
  | { k: 'summon'; defId: string; count?: Amount; side?: 'ally' | 'enemy' }
  | { k: 'transform'; target: Selector; into: string }
  | { k: 'returnToHand'; target: Selector }
  | { k: 'draw'; amount: Amount; side?: 'ally' | 'enemy' }
  | { k: 'discard'; amount: Amount; side?: 'ally' | 'enemy'; random?: boolean }
  | { k: 'toHand'; defId: string; count?: Amount }
  /** Search the deck for a matching card and put it in hand. */
  | { k: 'searchToHand'; filter: Filter; count?: Amount; random?: boolean }
  | { k: 'toDeck'; defId: string; count?: Amount; shuffle?: boolean }
  | { k: 'gainPP'; amount: Amount; empty?: boolean }
  | { k: 'gainMaxPP'; amount: Amount }
  | { k: 'gainEP'; amount: Amount }
  | { k: 'gainShadows'; amount: Amount }
  | { k: 'spendShadows'; amount: Amount }
  | { k: 'costMod'; target: Selector; delta: Amount; zone?: 'hand' }
  | { k: 'evolveTarget'; target: Selector; free?: boolean }
  /** Advance or delay a Countdown amulet. */
  | { k: 'countdown'; target: Selector; delta: Amount }
  | { k: 'spellboost'; amount?: Amount }
  /** Earth Rite: destroy one allied Earth Sigil, then run `then`. */
  | { k: 'earthRite'; then: Effect[]; else?: Effect[] }
  | { k: 'consumeSpellboost' }
  | { k: 'reduceLeaderDefense'; side: 'ally' | 'enemy'; amount: Amount }
  /** Set a named value in the resolution context for later `ctx` amounts. */
  | { k: 'store'; name: string; amount: Amount }
  | { k: 'if'; cond: Condition; then: Effect[]; else?: Effect[] }
  | { k: 'repeat'; times: Amount; body: Effect[] }
  /** Player picks one branch when the card is played. */
  | { k: 'chooseOne'; options: { label: string; effects: Effect[] }[] }
  /** Necromancy N: spend N shadows if available, then run `then`. */
  | { k: 'necromancy'; n: number; then: Effect[]; else?: Effect[] }
  /** No-op used to keep card text honest when an effect is purely cosmetic. */
  | { k: 'noop' };

// ---------------------------------------------------------------------------
// Triggers
// ---------------------------------------------------------------------------

export type TriggerKind =
  | 'fanfare' // ファンファーレ — on play from hand
  | 'lastWords' // ラストワード — on destruction
  | 'evolve' // 進化時 — when this follower evolves
  | 'clash' // 交戦時 — when this follower attacks or is attacked
  | 'strike' // 攻撃時 — when this follower attacks
  | 'onDamaged' // when this entity takes damage
  | 'onDestroyEnemy' // when this follower destroys a follower in combat
  | 'turnStart' // start of controller's turn
  | 'turnEnd' // end of controller's turn
  | 'enemyTurnEnd' // end of the opponent's turn
  | 'onAllyFollowerPlayed'
  | 'onAllySpellPlayed'
  | 'onAllyFollowerDestroyed'
  | 'onEnemyFollowerDestroyed'
  | 'onLeaderDamaged'
  | 'onHeal'
  | 'countdownEnd' // a Countdown amulet reaching 0
  | 'onEvolveAlly'
  | 'onSummon'; // when put onto the field by any means (not only from hand)

export interface Ability {
  on: TriggerKind;
  /** Gate the trigger; the ability simply does nothing when false. */
  cond?: Condition;
  effects: Effect[];
  /** Targets the controller must pick before the ability resolves. */
  targeting?: TargetSpec;
  /** Only fires on the evolved side. */
  evolvedOnly?: boolean;
  /** Only fires on the unevolved side. */
  baseOnly?: boolean;
  /** Fires at most this many times per game (0/undefined = unlimited). */
  once?: boolean;
  /** Human-readable label used by the log and by tooltips. */
  label?: string;
}

export interface EnhanceMode {
  cost: number;
  effects: Effect[];
  targeting?: TargetSpec;
  text?: string;
}

/** Describes an interactive target request raised to the controller. */
export interface TargetSpec {
  selector: Selector;
  /** When true the card is playable even with no legal target. */
  optional?: boolean;
  count?: number;
  prompt?: string;
}

// ---------------------------------------------------------------------------
// Continuous (aura) effects
// ---------------------------------------------------------------------------

export interface AuraDef {
  target: Selector;
  atk?: number;
  def?: number;
  keywords?: Keyword[];
  /** Flat reduction applied to every instance of damage taken. */
  damageReduce?: number;
  /** Applies to cards in hand rather than on the field (cost reduction auras). */
  costDelta?: number;
  cond?: Condition;
}

// ---------------------------------------------------------------------------
// Card definitions
// ---------------------------------------------------------------------------

export interface CardDef {
  id: string;
  name: string;
  nameJa?: string;
  cardClass: ClassId;
  set: SetId;
  rarity: Rarity;
  type: CardType;
  cost: number;

  /** Followers only. */
  atk?: number;
  def?: number;
  evoAtk?: number;
  evoDef?: number;

  /** Amulets only; absent means a permanent amulet. */
  countdown?: number;

  traits?: Trait[];
  keywords?: Keyword[];
  /** Keywords the follower gains only while evolved. */
  evoKeywords?: Keyword[];

  abilities?: Ability[];
  auras?: AuraDef[];

  /** Rules text as printed, used for card rendering. */
  text: string;
  textJa?: string;
  evoText?: string;
  flavor?: string;

  /** Target requested when the card itself is played. */
  targeting?: TargetSpec;

  /**
   * Enhance (introduced by Rise of Bahamut): paying the listed cost instead of
   * the printed one replaces the card's Fanfare with these effects.
   */
  enhance?: EnhanceMode[];

  /** Spellboost: each spell played reduces this card's cost by this much. */
  spellboostCost?: number;

  /** Tokens are not collectible and cannot be added to a deck. */
  token?: boolean;
  /**
   * False when part of the card's printed text has no engine implementation.
   * The deck builder flags these so a player is never silently handed a card
   * that does less than it says.
   */
  implemented?: boolean;
  /** Printed lines with no implementation, for the card detail view. */
  missingText?: string[];
  /** Cards this one can create — used by the collection screen and by tests. */
  creates?: string[];

  /** Deterministic art seed so procedural illustrations stay stable. */
  artSeed?: number;
  /** Optional external illustration path (personal-use assets). */
  art?: string;
  artEvolved?: string;
}

// ---------------------------------------------------------------------------
// Runtime entities
// ---------------------------------------------------------------------------

export type Zone = 'deck' | 'hand' | 'field' | 'cemetery' | 'banished' | 'limbo';

export interface Entity {
  uid: number;
  defId: string;
  owner: PlayerId;
  zone: Zone;

  /** Position within its zone; the field uses this as the board slot order. */
  slot: number;

  evolved: boolean;
  /** Damage marked on a follower; cleared only by healing. */
  damage: number;

  buffAtk: number;
  buffDef: number;
  tempAtk: number;
  tempDef: number;
  /** Absolute overrides applied after buffs (used by "becomes X/Y" effects). */
  setAtk: number | null;
  setDef: number | null;

  grantedKeywords: Keyword[];
  tempKeywords: Keyword[];
  removedKeywords: Keyword[];

  attacksThisTurn: number;
  /** Turn number on which the entity entered the field. */
  enteredTurn: number;
  /** Evolving lets a follower attack followers immediately. */
  canAttackFollowersEarly: boolean;

  countdown: number;
  costMod: number;
  spellboost: number;
  /** Ambush is consumed on attack or when the owner's turn ends. */
  ambushed: boolean;
  barrierCharges: number;

  firedOnce: Record<string, boolean>;
  /** Set while the entity is mid-destruction so Last Words cannot loop. */
  dying: boolean;
}

export interface PlayerState {
  id: PlayerId;
  leaderClass: ClassId;
  defense: number;
  maxDefense: number;
  pp: number;
  maxPp: number;
  ep: number;
  shadows: number;
  deck: number[]; // entity uids, index 0 = top
  hand: number[];
  field: number[];
  cemetery: number[];
  banished: number[];
  /** Number of cards burned by the hand limit, for the end-of-match summary. */
  burned: number;
  /** Reset each turn; drives "if at least N other cards were played" checks. */
  cardsPlayedThisTurn: number;
  hasEvolvedThisTurn: boolean;
  fatigue: number;
}

export type Phase = 'mulligan' | 'start' | 'main' | 'end' | 'over';

export interface GameState {
  turn: number;
  active: PlayerId;
  phase: Phase;
  players: [PlayerState, PlayerState];
  entities: Map<number, Entity>;
  nextUid: number;
  winner: PlayerId | 'draw' | null;
  /** True while an effect is resolving; blocks player input. */
  resolving: boolean;
}

// ---------------------------------------------------------------------------
// Constants (see docs/RULES.md for provenance)
// ---------------------------------------------------------------------------

export const RULES = {
  DECK_SIZE: 40,
  COPY_LIMIT: 3,
  LEADER_DEFENSE: 20,
  HAND_LIMIT: 9,
  BOARD_LIMIT: 5,
  MAX_PP: 10,
  MULLIGAN_HAND: 3,
  /** The player going second draws one extra card on their first turn. */
  SECOND_PLAYER_BONUS_DRAW: 1,
  EP_FIRST: 2,
  EP_SECOND: 3,
  EVOLVE_TURN_FIRST: 5,
  EVOLVE_TURN_SECOND: 4,
  EVOLVE_ATK: 2,
  EVOLVE_DEF: 2,
} as const;

// ---------------------------------------------------------------------------
// Presentation events
// ---------------------------------------------------------------------------

/**
 * The engine emits these in strict resolution order. The renderer replays them
 * as an animation queue; it may compress or skip, but must never reorder.
 */
export type GameEvent =
  | { t: 'gameStart'; first: PlayerId; seed: number }
  | { t: 'mulliganDone'; player: PlayerId; replaced: number }
  | { t: 'turnStart'; player: PlayerId; turn: number }
  | { t: 'turnEnd'; player: PlayerId; turn: number }
  | { t: 'ppChange'; player: PlayerId; pp: number; maxPp: number }
  | { t: 'epChange'; player: PlayerId; ep: number }
  | { t: 'draw'; player: PlayerId; uid: number; defId: string }
  | { t: 'burn'; player: PlayerId; defId: string }
  | { t: 'fatigue'; player: PlayerId; amount: number }
  | { t: 'play'; player: PlayerId; uid: number; defId: string; targets: number[] }
  | { t: 'summon'; player: PlayerId; uid: number; defId: string; slot: number }
  | { t: 'ability'; uid: number; kind: TriggerKind; label?: string }
  | { t: 'attack'; attacker: number; defender: number | { leader: PlayerId } }
  | { t: 'damage'; target: number | { leader: PlayerId }; amount: number; source: number | null }
  | { t: 'heal'; target: number | { leader: PlayerId }; amount: number }
  | { t: 'buff'; uid: number; atk: number; def: number }
  | { t: 'grant'; uid: number; keywords: Keyword[] }
  | { t: 'evolve'; uid: number; player: PlayerId }
  | { t: 'destroy'; uid: number; defId: string }
  | { t: 'banish'; uid: number; defId: string }
  | { t: 'transform'; uid: number; from: string; to: string }
  | { t: 'returnToHand'; uid: number; defId: string }
  | { t: 'toHand'; player: PlayerId; uid: number; defId: string }
  | { t: 'countdown'; uid: number; value: number }
  | { t: 'earthRite'; player: PlayerId; uid: number }
  | { t: 'shadows'; player: PlayerId; value: number }
  | { t: 'spellboost'; player: PlayerId }
  | { t: 'gameOver'; winner: PlayerId | 'draw' }
  | { t: 'log'; text: string };
