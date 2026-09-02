import { Rng } from './rng';
import { getCard } from './registry';
import type {
  Amount,
  AuraDef,
  BuffDuration,
  CardDef,
  Condition,
  Effect,
  Entity,
  Filter,
  GameEvent,
  GameState,
  Keyword,
  LeaderFlag,
  PlayerId,
  PlayerState,
  Selector,
  Side,
  TriggerKind,
} from './types';
import { LEADER_UID, RULES, leaderOfUid, other } from './types';

/**
 * Earth Sigil amulets, by card id. Earth Rite consumes one of these; the
 * original game marks them with a line of reminder text rather than a trait.
 */
export const EARTH_SIGILS = new Set<string>(['earth_essence']);

// ---------------------------------------------------------------------------
// Public action surface
// ---------------------------------------------------------------------------

export type Action =
  | { a: 'mulligan'; player: PlayerId; replace: number[] }
  | { a: 'play'; uid: number; targets?: number[]; slot?: number; option?: number; enhance?: number }
  | { a: 'attack'; attacker: number; target: number | 'leader' }
  | { a: 'evolve'; uid: number; targets?: number[] }
  | { a: 'endTurn' };

export interface DeckList {
  leaderClass: import('./types').ClassId;
  /** Card definition ids, 40 entries. */
  cards: string[];
}

export interface GameOptions {
  seed?: number;
  /** Skips the mulligan phase and deals opening hands directly. */
  skipMulligan?: boolean;
  /** Player index that takes the first turn; random when omitted. */
  first?: PlayerId;
}

/** Computed, aura-inclusive view of a follower. */
export interface Stats {
  atk: number;
  def: number;
  maxDef: number;
  keywords: Set<Keyword>;
}

interface ResolveCtx {
  source: Entity | null;
  controller: PlayerId;
  /** Targets supplied by the acting player, consumed in order. */
  targets: number[];
  ti: number;
  option: number;
  vars: Record<string, number>;
  /** The "other" participant, e.g. the defender during a Clash. */
  other?: Entity | null;
  depth: number;
}

// ---------------------------------------------------------------------------
// Game
// ---------------------------------------------------------------------------

export class Game {
  readonly state: GameState;
  readonly rng: Rng;
  readonly events: GameEvent[] = [];
  readonly seed: number;

  /** Set while a Fanfare/Last Words chain is resolving. */
  private triggerDepth = 0;
  /** Set while an aura's own condition is being tested; see `activeAuras`. */
  private auraDepth = 0;
  private pendingDeaths: number[] = [];

  constructor(decks: [DeckList, DeckList], opts: GameOptions = {}) {
    this.seed = opts.seed ?? (Math.random() * 0xffffffff) >>> 0;
    this.rng = new Rng(this.seed);

    const first: PlayerId = opts.first ?? ((this.rng.int(2) as PlayerId) || 0);
    this._first = first;

    this.state = {
      turn: 0,
      active: first,
      phase: 'mulligan',
      players: [this.makePlayer(0, decks[0]), this.makePlayer(1, decks[1])],
      entities: new Map(),
      nextUid: 1,
      winner: null,
      resolving: false,
    };

    for (const p of [0, 1] as PlayerId[]) {
      const list = decks[p];
      const uids: number[] = [];
      for (const id of list.cards) {
        uids.push(this.createEntity(id, p, 'deck').uid);
      }
      this.rng.shuffle(uids);
      this.state.players[p].deck = uids;
      uids.forEach((u, i) => (this.ent(u).slot = i));
    }

    this.emit({ t: 'gameStart', first, seed: this.seed });

    // Both players mulligan exactly three cards. The going-second package is
    // paid out later: two cards on their first turn, and more EP sooner.
    for (const p of [0, 1] as PlayerId[]) {
      for (let i = 0; i < RULES.MULLIGAN_HAND; i++) this.drawCard(p, true);
    }

    if (opts.skipMulligan) {
      this.state.phase = 'start';
      this.beginTurn();
    }
  }

  private makePlayer(id: PlayerId, deck: DeckList): PlayerState {
    return {
      id,
      leaderClass: deck.leaderClass,
      defense: RULES.LEADER_DEFENSE,
      maxDefense: RULES.LEADER_DEFENSE,
      pp: 0,
      maxPp: 0,
      ep: 0,
      shadows: 0,
      deck: [],
      hand: [],
      field: [],
      cemetery: [],
      banished: [],
      burned: 0,
      cardsPlayedThisTurn: 0,
      hasEvolvedThisTurn: false,
      fatigue: 0,
      leaderEffects: [],
    };
  }

  // -------------------------------------------------------------------------
  // Entity helpers
  // -------------------------------------------------------------------------

  private createEntity(defId: string, owner: PlayerId, zone: Entity['zone']): Entity {
    const def = getCard(defId);
    const e: Entity = {
      uid: this.state.nextUid++,
      defId,
      owner,
      zone,
      slot: 0,
      evolved: false,
      damage: 0,
      buffAtk: 0,
      buffDef: 0,
      temps: [],
      setAtk: null,
      setDef: null,
      grantedKeywords: [],
      grantedAbilities: [],
      silenced: false,
      removedKeywords: [],
      attacksThisTurn: 0,
      enteredTurn: -1,
      canAttackFollowersEarly: false,
      countdown: def.countdown ?? 0,
      costMod: 0,
      spellboost: 0,
      ambushed: (def.keywords ?? []).includes('ambush'),
      frozenUntilTurn: -1,
      barrierCharges: (def.keywords ?? []).includes('barrier') ? 1 : 0,
      firedOnce: {},
      dying: false,
    };
    this.state.entities.set(e.uid, e);
    return e;
  }

  ent(uid: number): Entity {
    const e = this.state.entities.get(uid);
    if (!e) throw new Error(`No entity ${uid}`);
    return e;
  }

  def(uidOrEnt: number | Entity): CardDef {
    const e = typeof uidOrEnt === 'number' ? this.ent(uidOrEnt) : uidOrEnt;
    return getCard(e.defId);
  }

  player(p: PlayerId): PlayerState {
    return this.state.players[p];
  }

  private emit(ev: GameEvent): void {
    this.events.push(ev);
  }

  /** Drains the event queue; the renderer calls this each frame. */
  drainEvents(): GameEvent[] {
    return this.events.splice(0, this.events.length);
  }

  // -------------------------------------------------------------------------
  // Stats & auras
  // -------------------------------------------------------------------------

  /**
   * Full stat line including every aura currently on the board. Auras are
   * recomputed on read rather than cached: the board never exceeds ten
   * entities, and a pull model removes a whole class of stale-buff bugs.
   */
  stats(uidOrEnt: number | Entity): Stats {
    const e = typeof uidOrEnt === 'number' ? this.ent(uidOrEnt) : uidOrEnt;
    const d = this.def(e);

    let atk = d.atk ?? 0;
    let maxDef = d.def ?? 0;
    if (e.evolved) {
      atk = d.evoAtk ?? atk + RULES.EVOLVE_ATK;
      maxDef = d.evoDef ?? maxDef + RULES.EVOLVE_DEF;
    }

    if (e.setAtk !== null) atk = e.setAtk;
    if (e.setDef !== null) maxDef = e.setDef;

    atk += e.buffAtk;
    maxDef += e.buffDef;
    for (const t of e.temps) {
      atk += t.atk ?? 0;
      maxDef += t.def ?? 0;
    }

    // A silenced follower keeps its stats but loses everything printed on it.
    const keywords = new Set<Keyword>(e.silenced ? [] : (d.keywords ?? []));
    if (e.evolved && !e.silenced) for (const k of d.evoKeywords ?? []) keywords.add(k);
    for (const k of e.grantedKeywords) keywords.add(k);
    for (const t of e.temps) for (const k of t.keywords ?? []) keywords.add(k);

    // `auraDepth` is non-zero only while an aura's own condition is being
    // tested; see `testAuraCondition`.
    if (e.zone === 'field' && this.auraDepth === 0) {
      for (const aura of this.activeAuras()) {
        if (!this.matchesAura(aura, e)) continue;
        atk += aura.aura.atk ?? 0;
        maxDef += aura.aura.def ?? 0;
        for (const k of aura.aura.keywords ?? []) keywords.add(k);
      }
    }

    // Ambush is shorthand for "cannot be attacked or targeted", so the derived
    // keywords are added here rather than repeated on every card.
    if (e.ambushed && keywords.has('ambush')) {
      keywords.add('cantBeAttacked');
      keywords.add('untargetable');
    } else {
      keywords.delete('ambush');
    }

    for (const k of e.removedKeywords) keywords.delete(k);

    atk = Math.max(0, atk);
    maxDef = Math.max(0, maxDef);
    return { atk, def: maxDef - e.damage, maxDef, keywords };
  }

  /** Total flat damage reduction applying to an entity from active auras. */
  damageReduction(e: Entity): number {
    let n = 0;
    for (const a of this.activeAuras()) {
      if (!a.aura.damageReduce) continue;
      if (this.matchesAura(a, e)) n += a.aura.damageReduce;
    }
    return n;
  }

  /** The smallest single-instance damage ceiling that applies, if any. */
  damageCap(e: Entity | { leaderOf: PlayerId }): number | null {
    let cap: number | null = null;
    for (const a of this.activeAuras()) {
      if (a.aura.damageCap === undefined) continue;
      const applies =
        'leaderOf' in e
          ? !!a.aura.leader && a.src.owner === e.leaderOf
          : this.matchesAura(a, e);
      if (!applies) continue;
      cap = cap === null ? a.aura.damageCap : Math.min(cap, a.aura.damageCap);
    }
    return cap;
  }

  /** Whether a leader effect currently imposes this restriction on `p`. */
  leaderHas(p: PlayerId, flag: LeaderFlag): boolean {
    return this.player(p).leaderEffects.some((l) => (l.flags ?? []).includes(flag));
  }

  /**
   * The turn index at the end of which a grant of this duration lapses, or
   * null when it never does. `turn` is this turn; `opponentTurn` runs through
   * the next one, which is the opponent's.
   */
  private expiryFor(d: BuffDuration | undefined): number | null {
    switch (d ?? 'permanent') {
      case 'turn':
        return this.state.turn;
      case 'opponentTurn':
        return this.state.turn + 1;
      default:
        return null;
    }
  }

  private activeAuras(): { src: Entity; aura: AuraDef }[] {
    const out: { src: Entity; aura: AuraDef }[] = [];
    for (const p of [0, 1] as PlayerId[]) {
      for (const uid of this.player(p).field) {
        const src = this.ent(uid);
        if (src.silenced) continue;
        const d = this.def(src);
        for (const aura of d.auras ?? []) {
          if (aura.cond && !this.testAuraCondition(aura.cond, src)) continue;
          out.push({ src, aura });
        }
      }
    }
    return out;
  }

  /**
   * Tests an aura's condition with aura effects switched off underneath it.
   *
   * An aura whose condition counts the board — Bahamut's "can't attack the
   * enemy leader if 2 or more enemy followers are in play" — resolves a
   * selector, and resolving a selector reads `stats` to check for Ambush,
   * which asks for the active auras again. Left alone that recurses until the
   * stack gives out. Conditions therefore see printed-and-buffed stats, never
   * aura-modified ones; auras cannot depend on each other, which is both
   * terminating and what the printed cards mean.
   */
  private testAuraCondition(cond: Condition, src: Entity): boolean {
    this.auraDepth++;
    try {
      return this.testCondition(cond, {
        source: src,
        controller: src.owner,
        targets: [],
        ti: 0,
        option: 0,
        vars: {},
        depth: 0,
      });
    } finally {
      this.auraDepth--;
    }
  }

  private matchesAura(a: { src: Entity; aura: AuraDef }, e: Entity): boolean {
    const sel = a.aura.target;
    if (sel.scope === 'self') return e.uid === a.src.uid;
    const side = sel.side ?? 'ally';
    const sameSide = e.owner === a.src.owner;
    if (side === 'ally' && !sameSide) return false;
    if (side === 'enemy' && sameSide) return false;
    if (!this.matchesKind(e, sel.kind ?? 'follower')) return false;
    if (sel.filter && !this.matchesFilter(e, sel.filter, a.src)) return false;
    return true;
  }

  private matchesKind(e: Entity, kind: 'follower' | 'amulet' | 'any'): boolean {
    if (kind === 'any') return true;
    return this.def(e).type === kind;
  }

  private matchesFilter(e: Entity, f: Filter, source: Entity | null): boolean {
    const d = this.def(e);
    if (f.notSelf && source && e.uid === source.uid) return false;
    if (f.defId && d.id !== f.defId) return false;
    if (f.type && d.type !== f.type) return false;
    if (f.cardClass && d.cardClass !== f.cardClass) return false;
    if (f.trait && !(d.traits ?? []).includes(f.trait)) return false;
    if (f.token !== undefined && !!d.token !== f.token) return false;
    if (f.evolved !== undefined && e.evolved !== f.evolved) return false;

    const cost = Math.max(0, d.cost + e.costMod);
    if (f.costMax !== undefined && cost > f.costMax) return false;
    if (f.costMin !== undefined && cost < f.costMin) return false;

    if (
      f.atkMax !== undefined ||
      f.atkMin !== undefined ||
      f.defMax !== undefined ||
      f.defMin !== undefined ||
      f.hasKeyword ||
      f.lacksKeyword ||
      f.damaged !== undefined
    ) {
      const s = this.stats(e);
      if (f.atkMax !== undefined && s.atk > f.atkMax) return false;
      if (f.atkMin !== undefined && s.atk < f.atkMin) return false;
      if (f.defMax !== undefined && s.def > f.defMax) return false;
      if (f.defMin !== undefined && s.def < f.defMin) return false;
      if (f.hasKeyword && !s.keywords.has(f.hasKeyword)) return false;
      if (f.lacksKeyword && s.keywords.has(f.lacksKeyword)) return false;
      if (f.damaged !== undefined && e.damage > 0 !== f.damaged) return false;
    }
    return true;
  }

  // -------------------------------------------------------------------------
  // Turn flow
  // -------------------------------------------------------------------------

  /** Replaces the chosen opening-hand cards. Both players must call this. */
  mulligan(player: PlayerId, replace: number[]): void {
    if (this.state.phase !== 'mulligan') return;
    const p = this.player(player);
    const toReplace = replace.filter((u) => p.hand.includes(u));

    // Cards go back only after the replacements are drawn, so a replaced card
    // can never be handed straight back to the same player.
    const drawn: number[] = [];
    for (let i = 0; i < toReplace.length; i++) {
      const top = p.deck.shift();
      if (top !== undefined) drawn.push(top);
    }
    for (const u of toReplace) {
      const idx = p.hand.indexOf(u);
      if (idx >= 0) p.hand.splice(idx, 1);
      this.ent(u).zone = 'deck';
      p.deck.push(u);
    }
    this.rng.shuffle(p.deck);
    for (const u of drawn) {
      this.ent(u).zone = 'hand';
      p.hand.push(u);
    }
    this.emit({ t: 'mulliganDone', player, replaced: toReplace.length });

    this.mulliganDone.add(player);
    if (this.mulliganDone.size === 2) {
      this.state.phase = 'start';
      this.beginTurn();
    }
  }

  private mulliganDone = new Set<PlayerId>();

  private beginTurn(): void {
    const s = this.state;
    s.turn++;
    s.phase = 'start';
    const p = this.player(s.active);
    p.hasEvolvedThisTurn = false;
    p.cardsPlayedThisTurn = 0;
    this.destroyedThisTurn = [0, 0];

    for (const uid of p.field) {
      const e = this.ent(uid);
      e.attacksThisTurn = 0;
      e.canAttackFollowersEarly = false;
    }

    // 1. Play points: gain an orb (to a cap of 10) and refill. Carabosse's
    // leader effect withholds the orb; the refill still happens.
    if (!this.leaderHas(s.active, 'noPlayPointGain')) {
      p.maxPp = Math.min(RULES.MAX_PP, p.maxPp + 1);
    }
    p.pp = p.maxPp;
    this.emit({ t: 'turnStart', player: s.active, turn: s.turn });
    this.emit({ t: 'ppChange', player: s.active, pp: p.pp, maxPp: p.maxPp });

    // 2. Evolution points become available on turn 5 (first) / turn 4 (second).
    this.grantEpIfDue(s.active);

    // 3. Start-of-turn abilities, turn player first, then the opponent's.
    this.fireTriggers('turnStart', s.active);
    this.fireTriggers('enemyTurnEnd', other(s.active));

    // 4. Countdown amulets tick and any that reach zero break here.
    this.tickCountdowns(s.active);

    // 5. Draw last, so a Last Words draw resolves before the turn draw.
    const draws = s.active !== this.firstPlayer && this.turnsTaken[s.active] === 0
      ? RULES.SECOND_PLAYER_FIRST_TURN_DRAW
      : 1;
    for (let i = 0; i < draws && s.winner === null; i++) this.drawCard(s.active);
    this.turnsTaken[s.active]++;

    this.checkState();
    if (s.winner === null) s.phase = 'main';
  }

  /**
   * Evolution points arrive all at once on the turn evolution unlocks: two for
   * the player going first (on turn 5), three for the player going second (on
   * turn 4).
   */
  private grantEpIfDue(p: PlayerId): void {
    if (this.epGranted.has(p)) return;
    if (this.state.turn < this.evolveTurnFor(p)) return;
    const ps = this.player(p);
    ps.ep = this.firstPlayer === p ? RULES.EP_FIRST : RULES.EP_SECOND;
    this.epGranted.add(p);
    this.emit({ t: 'epChange', player: p, ep: ps.ep });
  }

  private epGranted = new Set<PlayerId>();
  /** Followers each player has lost this turn; reset at the start of a turn. */
  private destroyedThisTurn: [number, number] = [0, 0];
  /** Turns each player has begun, used for the going-second extra draw. */
  private turnsTaken: [number, number] = [0, 0];

  /** The player who took the first turn. Fixed for the life of the match. */
  get firstPlayer(): PlayerId {
    return this._first;
  }

  private _first: PlayerId = 0;

  /** Absolute turn number on which `p` may first evolve. */
  evolveTurnFor(p: PlayerId): number {
    return this.firstPlayer === p ? RULES.EVOLVE_TURN_FIRST : RULES.EVOLVE_TURN_SECOND;
  }

  endTurn(): void {
    const s = this.state;
    if (s.phase === 'over') return;
    s.phase = 'end';

    this.fireTriggers('turnEnd', s.active);
    this.checkState();
    if (s.winner !== null) return;

    // Ambush lapses at the end of its controller's turn if the follower has
    // not attacked; temporary grants lapse here too, each on its own turn.
    for (const side of [0, 1] as PlayerId[]) {
      for (const uid of [...this.player(side).field]) {
        const e = this.state.entities.get(uid);
        if (!e) continue;
        if (e.temps.length > 0) e.temps = e.temps.filter((t) => t.until > s.turn);
      }
      const ps = this.player(side);
      if (ps.leaderEffects.length > 0) {
        ps.leaderEffects = ps.leaderEffects.filter((l) => l.until === null || l.until > s.turn);
      }
    }

    this.emit({ t: 'turnEnd', player: s.active, turn: s.turn });
    s.active = other(s.active);
    this.beginTurn();
  }

  private tickCountdowns(p: PlayerId): void {
    for (const uid of [...this.player(p).field]) {
      const e = this.state.entities.get(uid);
      if (!e || e.zone !== 'field') continue;
      const d = this.def(e);
      if (d.type !== 'amulet' || d.countdown === undefined) continue;
      e.countdown = Math.max(0, e.countdown - 1);
      this.emit({ t: 'countdown', uid, value: e.countdown });
      if (e.countdown === 0) {
        this.fireEntityTriggers(e, 'countdownEnd');
        // A Countdown amulet is destroyed when it hits 0, which also fires
        // its Last Words.
        this.destroyEntity(e);
      }
    }
    this.checkState();
  }

  // -------------------------------------------------------------------------
  // Drawing
  // -------------------------------------------------------------------------

  drawCard(p: PlayerId, silent = false): number | null {
    const ps = this.player(p);
    const uid = ps.deck.shift();
    if (uid === undefined) {
      // Attempting to draw from an empty deck loses the game immediately.
      // Shadowverse has no fatigue damage.
      ps.fatigue++;
      this.emit({ t: 'deckOut', player: p });
      this.finish(other(p));
      return null;
    }
    const e = this.ent(uid);
    if (ps.hand.length >= RULES.HAND_LIMIT) {
      e.zone = 'cemetery';
      ps.cemetery.push(uid);
      ps.burned++;
      this.emit({ t: 'burn', player: p, defId: e.defId });
      return null;
    }
    e.zone = 'hand';
    ps.hand.push(uid);
    if (!silent) this.emit({ t: 'draw', player: p, uid, defId: e.defId });
    else this.emit({ t: 'draw', player: p, uid, defId: e.defId });
    return uid;
  }

  /** Creates a brand-new card directly in hand (token generation). */
  addToHand(p: PlayerId, defId: string): number | null {
    const ps = this.player(p);
    if (ps.hand.length >= RULES.HAND_LIMIT) {
      ps.burned++;
      this.emit({ t: 'burn', player: p, defId });
      return null;
    }
    const e = this.createEntity(defId, p, 'hand');
    ps.hand.push(e.uid);
    this.emit({ t: 'toHand', player: p, uid: e.uid, defId });
    return e.uid;
  }

  // -------------------------------------------------------------------------
  // Playing cards
  // -------------------------------------------------------------------------

  /** Cost to play a card, optionally at the given Enhance level (its cost). */
  costOf(uid: number, enhance?: number): number {
    const e = this.ent(uid);
    const d = this.def(e);
    // Enhance is an alternative printed cost; cost reductions do not apply to
    // it in the original game, so it is returned as-is.
    if (enhance !== undefined && (d.enhance ?? []).some((m) => m.cost === enhance)) return enhance;
    let cost = d.cost + e.costMod;
    if (d.spellboostCost) cost -= d.spellboostCost * e.spellboost;
    for (const { src, aura } of this.activeAuras()) {
      if (aura.costDelta === undefined) continue;
      const sel = aura.target;
      if ((sel.side ?? 'ally') === 'ally' && e.owner !== src.owner) continue;
      if ((sel.side ?? 'ally') === 'enemy' && e.owner === src.owner) continue;
      if (sel.filter && !this.matchesFilter(e, sel.filter, src)) continue;
      cost += aura.costDelta;
    }
    return Math.max(0, cost);
  }

  canPlay(uid: number, player: PlayerId = this.state.active, enhance?: number): boolean {
    if (this.state.phase !== 'main' || this.state.active !== player) return false;
    const e = this.state.entities.get(uid);
    if (!e || e.zone !== 'hand' || e.owner !== player) return false;
    const ps = this.player(player);
    if (this.costOf(uid, enhance) > ps.pp) return false;
    const d = this.def(e);
    if (d.type !== 'spell' && ps.field.length >= RULES.BOARD_LIMIT) return false;
    if (d.type === 'follower' && this.leaderHas(player, 'cantPlayFollowers')) return false;
    // A card that must choose a target is unplayable with no legal target.
    const mode = enhance !== undefined ? (d.enhance ?? []).find((m) => m.cost === enhance) : undefined;
    const spec = mode ? mode.targeting : d.targeting;
    if (spec && !spec.optional) {
      if (this.legalTargets(spec.selector, player, e).length === 0) return false;
    }
    return true;
  }

  /** Enhance levels this card can currently be played at, cheapest first. */
  availableEnhance(uid: number): number[] {
    const e = this.state.entities.get(uid);
    if (!e) return [];
    const d = this.def(e);
    const pp = this.player(e.owner).pp;
    return (d.enhance ?? [])
      .map((m) => m.cost)
      .filter((c) => c <= pp)
      .sort((a, b) => a - b);
  }

  playCard(uid: number, targets: number[] = [], slot?: number, option = 0, enhance?: number): boolean {
    if (!this.canPlay(uid, this.state.active, enhance)) return false;
    const e = this.ent(uid);
    const d = this.def(e);
    const p = this.player(e.owner);

    const enhanceMode =
      enhance !== undefined ? (d.enhance ?? []).find((m) => m.cost === enhance) : undefined;
    p.pp -= this.costOf(uid, enhance);
    this.emit({ t: 'ppChange', player: e.owner, pp: p.pp, maxPp: p.maxPp });

    const hi = p.hand.indexOf(uid);
    if (hi >= 0) p.hand.splice(hi, 1);

    this.emit({ t: 'play', player: e.owner, uid, defId: d.id, targets });

    const ctx: ResolveCtx = {
      source: e,
      controller: e.owner,
      targets,
      ti: 0,
      option,
      vars: {},
      depth: 0,
    };

    if (d.type === 'spell') {
      e.zone = 'limbo';
      // Spellboost accumulates on cards in hand each time a spell is played.
      this.onSpellPlayed(e.owner);
      if (enhanceMode) this.runEffects(enhanceMode.effects, ctx);
      else if (!this.leaderHas(e.owner, 'noFanfare')) this.runAbilities(e, 'fanfare', ctx);
      // Only move to the cemetery if an effect has not already relocated it.
      if (e.zone === 'limbo') {
        e.zone = 'cemetery';
        p.cemetery.push(uid);
      }
    } else {
      this.putOnField(e, slot);
      if (d.type === 'follower') {
        this.fireTriggers('onAllyFollowerPlayed', e.owner, { exclude: e.uid, subject: e });
        this.fireTriggers('onEnemyFollowerPlayed', other(e.owner), { subject: e });
      } else if (d.type === 'amulet') {
        this.fireTriggers('onAllyAmuletPlayed', e.owner, { exclude: e.uid, subject: e });
      }
      if (enhanceMode) this.runEffects(enhanceMode.effects, ctx);
      else if (!this.leaderHas(e.owner, 'noFanfare')) this.runAbilities(e, 'fanfare', ctx);
      this.fireEntityTriggers(e, 'onSummon');
      // A 0-countdown amulet resolves and leaves immediately.
      if (d.type === 'amulet' && d.countdown !== undefined && e.countdown === 0) {
        this.fireEntityTriggers(e, 'countdownEnd');
        this.destroyEntity(e);
      }
    }

    // Counted after the card resolves, so "if at least N other cards were
    // played this turn" never counts the card asking the question.
    p.cardsPlayedThisTurn++;
    this.checkState();
    return true;
  }

  private onSpellPlayed(p: PlayerId): void {
    // Spellboost counters accumulate on every card in hand; only cards that
    // print Spellboost actually read them.
    for (const uid of this.player(p).hand) this.ent(uid).spellboost++;
    this.emit({ t: 'spellboost', player: p });
    this.fireTriggers('onAllySpellPlayed', p);
  }

  private putOnField(e: Entity, slot?: number): void {
    const ps = this.player(e.owner);
    e.zone = 'field';
    e.enteredTurn = this.state.turn;
    e.attacksThisTurn = 0;
    const at = slot === undefined ? ps.field.length : Math.max(0, Math.min(slot, ps.field.length));
    ps.field.splice(at, 0, e.uid);
    ps.field.forEach((u, i) => (this.ent(u).slot = i));
    this.emit({ t: 'summon', player: e.owner, uid: e.uid, defId: e.defId, slot: at });
  }

  /** Creates and summons a token/copy. Fizzles silently if the board is full. */
  summonToken(defId: string, owner: PlayerId, fromEffect = true): Entity | null {
    const ps = this.player(owner);
    if (ps.field.length >= RULES.BOARD_LIMIT) return null;
    const e = this.createEntity(defId, owner, 'limbo');
    this.putOnField(e);
    if (fromEffect) {
      this.fireEntityTriggers(e, 'onSummon');
      if (this.def(e).type === 'follower') {
        this.fireTriggers('onAllyFollowerPlayed', owner, { exclude: e.uid, subject: e });
        this.fireTriggers('onEnemyFollowerPlayed', other(owner), { subject: e });
      }
    }
    return e;
  }

  // -------------------------------------------------------------------------
  // Evolution
  // -------------------------------------------------------------------------

  canEvolve(uid: number, player: PlayerId = this.state.active): boolean {
    if (this.state.phase !== 'main' || this.state.active !== player) return false;
    const e = this.state.entities.get(uid);
    if (!e || e.zone !== 'field' || e.owner !== player) return false;
    if (this.def(e).type !== 'follower' || e.evolved) return false;
    const ps = this.player(player);
    if (ps.ep <= 0 || ps.hasEvolvedThisTurn) return false;
    if (this.state.turn < this.evolveTurnFor(player)) return false;
    return true;
  }

  evolve(uid: number, targets: number[] = []): boolean {
    if (!this.canEvolve(uid)) return false;
    const e = this.ent(uid);
    const ps = this.player(e.owner);
    ps.ep--;
    ps.hasEvolvedThisTurn = true;
    this.emit({ t: 'epChange', player: e.owner, ep: ps.ep });
    this.applyEvolve(e, targets);
    return true;
  }

  /** Evolution granted by a card effect: no EP cost, no once-per-turn lock. */
  forceEvolve(uid: number, targets: number[] = []): boolean {
    const e = this.state.entities.get(uid);
    if (!e || e.zone !== 'field' || e.evolved) return false;
    if (this.def(e).type !== 'follower') return false;
    this.applyEvolve(e, targets);
    return true;
  }

  private applyEvolve(e: Entity, targets: number[]): void {
    e.evolved = true;
    // Evolving lets a follower attack enemy followers at once, but never the
    // enemy leader on the same turn unless it also has Storm.
    e.canAttackFollowersEarly = true;
    this.emit({ t: 'evolve', uid: e.uid, player: e.owner });
    this.runAbilities(e, 'evolve', {
      source: e,
      controller: e.owner,
      targets,
      ti: 0,
      option: 0,
      vars: {},
      depth: 0,
    });
    this.fireTriggers('onEvolveAlly', e.owner, { exclude: e.uid, subject: e });
    // "Whenever another follower evolves" watches both boards.
    for (const p of [0, 1] as PlayerId[]) {
      this.fireTriggers('onEvolveAny', p, { exclude: e.uid, subject: e });
    }
    this.checkState();
  }

  // -------------------------------------------------------------------------
  // Combat
  // -------------------------------------------------------------------------

  /** Enemy Ward followers that must be attacked before anything else. */
  wardsOf(p: PlayerId): number[] {
    return this.player(p).field.filter((u) => {
      const e = this.ent(u);
      if (this.def(e).type !== 'follower') return false;
      const st = this.stats(e);
      if (st.keywords.has('cantBeAttacked')) return false;
      return st.keywords.has('ward');
    });
  }

  canAttack(uid: number, target: number | 'leader'): boolean {
    const s = this.state;
    if (s.phase !== 'main') return false;
    const e = this.state.entities.get(uid);
    if (!e || e.zone !== 'field' || e.owner !== s.active) return false;
    if (this.def(e).type !== 'follower') return false;

    const st = this.stats(e);
    if (st.keywords.has('cantAttack')) return false;
    if (s.turn <= e.frozenUntilTurn) return false;
    if (st.atk <= 0) return false;

    const maxAttacks = st.keywords.has('doubleAttack') ? 2 : 1;
    if (e.attacksThisTurn >= maxAttacks) return false;

    const sick = e.enteredTurn === s.turn;
    if (sick) {
      const canHitFollowers =
        st.keywords.has('storm') || st.keywords.has('rush') || e.canAttackFollowersEarly;
      if (target === 'leader') {
        if (!st.keywords.has('storm')) return false;
      } else if (!canHitFollowers) {
        return false;
      }
    } else if (target === 'leader' && e.canAttackFollowersEarly && !st.keywords.has('storm')) {
      // Evolved this turn on a follower that was already able to attack: the
      // early-attack grant only covers followers, so a leader swing needs the
      // follower to have been on board since last turn (it has), which is fine.
    }

    if (target === 'leader' && st.keywords.has('cantAttackLeader')) return false;

    const enemy = other(s.active);
    if (!st.keywords.has('ignoreWard')) {
      const wards = this.wardsOf(enemy);
      if (wards.length > 0) {
        if (target === 'leader') return false;
        if (!wards.includes(target)) return false;
      }
    }

    if (target !== 'leader') {
      const d = this.state.entities.get(target);
      if (!d || d.zone !== 'field' || d.owner !== enemy) return false;
      if (this.def(d).type !== 'follower') return false;
      if (this.stats(d).keywords.has('cantBeAttacked')) return false;
    }
    return true;
  }

  attack(uid: number, target: number | 'leader'): boolean {
    if (!this.canAttack(uid, target)) return false;
    const atk = this.ent(uid);
    atk.attacksThisTurn++;
    // Cards that watch attacks fire before anything else in the exchange.
    for (const p of [0, 1] as PlayerId[]) {
      this.fireTriggers('onAnyAttack', p, { exclude: uid, subject: atk });
    }
    if (atk.zone !== 'field') return true;
    // Attacking always breaks Ambush.
    atk.ambushed = false;

    if (target === 'leader') {
      const enemy = other(atk.owner);
      this.emit({ t: 'attack', attacker: uid, defender: { leader: enemy } });
      this.fireEntityTriggers(atk, 'strike');
      if (atk.zone !== 'field') return true;
      const st = this.stats(atk);
      this.damageLeader(enemy, st.atk, atk);
      if (st.keywords.has('drain') && st.atk > 0) this.healLeader(atk.owner, st.atk);
      this.checkState();
      return true;
    }

    const def = this.ent(target);
    this.emit({ t: 'attack', attacker: uid, defender: target });

    // Strike carries the follower being attacked, so "Follower Strike: Destroy
    // the enemy follower" knows which one it means.
    this.fireEntityTriggers(atk, 'strike', def);
    this.fireEntityTriggers(atk, 'clash', def);
    this.fireEntityTriggers(def, 'clash', atk);
    if (atk.zone !== 'field' || def.zone !== 'field') {
      this.checkState();
      return true;
    }

    const as = this.stats(atk);
    const ds = this.stats(def);

    // Combat damage is simultaneous: both followers are struck with the stats
    // they had at the moment of the clash.
    const aDealt = this.dealDamage(def, as.atk, atk);
    const dDealt = this.dealDamage(atk, ds.atk, def);

    // Drain heals only when its follower is the attacker; a Drain follower
    // that is attacked and strikes back does not heal.
    if (as.keywords.has('drain') && aDealt > 0) this.healLeader(atk.owner, aDealt);

    // Bane destroys any follower it damages, regardless of remaining defense.
    if (as.keywords.has('bane') && aDealt > 0 && def.zone === 'field') this.markDeath(def);
    if (ds.keywords.has('bane') && dDealt > 0 && atk.zone === 'field') this.markDeath(atk);

    this.checkState();

    if (def.zone !== 'field' && atk.zone === 'field') {
      this.fireEntityTriggers(atk, 'onDestroyEnemy', def);
      this.checkState();
    }
    return true;
  }

  // -------------------------------------------------------------------------
  // Damage / healing / destruction
  // -------------------------------------------------------------------------

  /** Applies damage to a follower or amulet; returns damage actually dealt. */
  dealDamage(e: Entity, amount: number, source: Entity | null, fromEffect = false): number {
    if (amount <= 0 || e.zone !== 'field') return 0;
    const kw = this.stats(e).keywords;
    if (kw.has('damageImmune')) return 0;
    if (fromEffect && kw.has('effectImmune')) return 0;
    amount = Math.max(0, amount - this.damageReduction(e));
    const cap = this.damageCap(e);
    if (cap !== null) amount = Math.min(amount, cap);
    if (amount === 0) return 0;
    if (e.barrierCharges > 0) {
      e.barrierCharges--;
      this.emit({ t: 'log', text: `${this.def(e).name} barrier absorbed the damage` });
      return 0;
    }
    e.damage += amount;
    this.emit({ t: 'damage', target: e.uid, amount, source: source ? source.uid : null });
    this.fireEntityTriggers(e, 'onDamaged', source);
    if (this.isDead(e)) this.markDeath(e);
    return amount;
  }

  damageLeader(p: PlayerId, amount: number, source: Entity | null): number {
    if (amount <= 0) return 0;
    const cap = this.damageCap({ leaderOf: p });
    if (cap !== null) amount = Math.min(amount, cap);
    if (amount <= 0) return 0;
    const ps = this.player(p);
    ps.defense -= amount;
    this.emit({ t: 'damage', target: { leader: p }, amount, source: source ? source.uid : null });
    this.fireTriggers('onLeaderDamaged', p);
    return amount;
  }

  healLeader(p: PlayerId, amount: number): number {
    if (amount <= 0) return 0;
    const ps = this.player(p);
    const healed = Math.min(amount, ps.maxDefense - ps.defense);
    if (healed <= 0) return 0;
    ps.defense += healed;
    this.emit({ t: 'heal', target: { leader: p }, amount: healed });
    this.fireTriggers('onHeal', p);
    return healed;
  }

  healEntity(e: Entity, amount: number): number {
    if (amount <= 0 || e.zone !== 'field') return 0;
    const healed = Math.min(amount, e.damage);
    e.damage -= healed;
    if (healed > 0) this.emit({ t: 'heal', target: e.uid, amount: healed });
    return healed;
  }

  /**
   * Only followers die from having no defense left. Amulets have no defense
   * stat at all and leave play through their Countdown or an explicit effect.
   */
  private isDead(e: Entity): boolean {
    if (e.zone !== 'field') return false;
    if (this.def(e).type !== 'follower') return false;
    return this.stats(e).def <= 0;
  }

  private markDeath(e: Entity): void {
    if (e.dying || e.zone !== 'field') return;
    if (this.stats(e).keywords.has('indestructible') && this.stats(e).def > 0) return;
    e.dying = true;
    this.pendingDeaths.push(e.uid);
  }

  /**
   * Destroys an entity immediately (effect-driven destruction). Last Words fire
   * as part of the same resolution step.
   */
  destroyEntity(e: Entity): void {
    if (e.zone !== 'field') return;
    this.markDeath(e);
    this.resolveDeaths();
  }

  banishEntity(e: Entity): void {
    if (e.zone !== 'field') return;
    const ps = this.player(e.owner);
    const i = ps.field.indexOf(e.uid);
    if (i >= 0) ps.field.splice(i, 1);
    ps.field.forEach((u, k) => (this.ent(u).slot = k));
    e.zone = 'banished';
    ps.banished.push(e.uid);
    // Banished cards leave play without triggering Last Words and grant no
    // shadows.
    this.emit({ t: 'banish', uid: e.uid, defId: e.defId });
  }

  /**
   * Resolves every pending death together. Simultaneous Last Words resolve in
   * board order (leftmost first) for the active player, then the opponent —
   * matching the order the original game plays the animations in.
   */
  private resolveDeaths(): void {
    let guard = 0;
    while (this.pendingDeaths.length > 0 && guard++ < 64) {
      const batch = this.pendingDeaths;
      this.pendingDeaths = [];

      const ordered = batch
        .map((u) => this.state.entities.get(u))
        .filter((e): e is Entity => !!e && e.zone === 'field')
        .sort((a, b) => {
          const pa = a.owner === this.state.active ? 0 : 1;
          const pb = b.owner === this.state.active ? 0 : 1;
          if (pa !== pb) return pa - pb;
          return a.slot - b.slot;
        });

      // Remove all of them from the field first, so a Last Words that counts
      // followers sees the post-death board.
      for (const e of ordered) {
        const ps = this.player(e.owner);
        const i = ps.field.indexOf(e.uid);
        if (i >= 0) ps.field.splice(i, 1);
        ps.field.forEach((u, k) => (this.ent(u).slot = k));
        e.zone = 'cemetery';
        ps.cemetery.push(e.uid);
        this.emit({ t: 'destroy', uid: e.uid, defId: e.defId });
        if (this.def(e).type === 'follower') {
          ps.shadows++;
          this.destroyedThisTurn[e.owner]++;
          this.emit({ t: 'shadows', player: e.owner, value: ps.shadows });
        }
      }

      for (const e of ordered) {
        this.fireEntityTriggers(e, 'lastWords');
        e.dying = false;
        const kind = this.def(e).type;
        if (kind === 'follower') {
          this.fireTriggers('onAllyFollowerDestroyed', e.owner, { subject: e });
          this.fireTriggers('onEnemyFollowerDestroyed', other(e.owner), { subject: e });
        }
      }
    }
  }

  /** Checks deaths and win conditions; safe to call as often as needed. */
  checkState(): void {
    for (const p of [0, 1] as PlayerId[]) {
      for (const uid of [...this.player(p).field]) {
        const e = this.state.entities.get(uid);
        if (e && this.isDead(e)) this.markDeath(e);
      }
    }
    this.resolveDeaths();

    if (this.state.winner !== null) return;
    const dead0 = this.player(0).defense <= 0;
    const dead1 = this.player(1).defense <= 0;
    if (dead0 && dead1) this.finish('draw');
    else if (dead0) this.finish(1);
    else if (dead1) this.finish(0);
  }

  private finish(w: PlayerId | 'draw'): void {
    this.state.winner = w;
    this.state.phase = 'over';
    this.emit({ t: 'gameOver', winner: w });
  }

  // -------------------------------------------------------------------------
  // Triggers
  // -------------------------------------------------------------------------

  private fireEntityTriggers(
    e: Entity,
    kind: TriggerKind,
    otherEnt?: Entity | null,
    vars: Record<string, number> = {},
  ): void {
    this.runAbilities(e, kind, {
      source: e,
      controller: e.owner,
      targets: [],
      ti: 0,
      option: 0,
      vars: { ...vars },
      other: otherEnt ?? null,
      depth: this.triggerDepth,
    });
  }

  private fireTriggers(
    kind: TriggerKind,
    p: PlayerId,
    opts: { exclude?: number; subject?: Entity | null; vars?: Record<string, number> } = {},
  ): void {
    for (const uid of [...this.player(p).field]) {
      if (uid === opts.exclude) continue;
      const e = this.state.entities.get(uid);
      if (!e || e.zone !== 'field') continue;
      // `subject` is the card the trigger is *about* — the follower that just
      // arrived, say — which card text refers to as "it".
      this.fireEntityTriggers(e, kind, opts.subject ?? null, opts.vars);
    }
    this.fireLeaderTriggers(kind, p, opts.vars);
  }

  /**
   * Abilities hung on a leader rather than a follower — Carabosse's "At the end
   * of your turn, draw a card and deal 1 damage to the enemy leader". They have
   * no source entity, so effects that read one (`scope: 'self'`) do not apply;
   * the cards that grant them never use one.
   */
  private fireLeaderTriggers(
    kind: TriggerKind,
    p: PlayerId,
    vars?: Record<string, number>,
  ): void {
    const effects = this.player(p).leaderEffects;
    if (effects.length === 0) return;
    const abilities = effects.flatMap((l) => (l.abilities ?? []).filter((a) => a.on === kind));
    if (abilities.length === 0) return;
    if (this.triggerDepth > 24) return;
    const ctx: ResolveCtx = {
      source: null,
      controller: p,
      targets: [],
      ti: 0,
      option: 0,
      vars: vars ?? {},
      depth: 0,
    };
    this.triggerDepth++;
    try {
      for (const ab of abilities) {
        if (ab.cond && !this.testCondition(ab.cond, ctx)) continue;
        this.runEffects(ab.effects, ctx);
      }
    } finally {
      this.triggerDepth--;
    }
    if (this.triggerDepth === 0) this.resolveDeaths();
  }

  private runAbilities(e: Entity, kind: TriggerKind, ctx: ResolveCtx): void {
    const d = this.def(e);
    const abilities = [
      ...(e.silenced ? [] : (d.abilities ?? [])),
      ...e.grantedAbilities,
      ...e.temps.flatMap((t) => t.abilities ?? []),
    ].filter((a) => a.on === kind);
    if (abilities.length === 0) return;
    if (this.triggerDepth > 24) return;
    this.triggerDepth++;
    try {
      for (const ab of abilities) {
        if (ab.evolvedOnly && !e.evolved) continue;
        if (ab.baseOnly && e.evolved) continue;
        const key = `${kind}:${ab.label ?? ''}`;
        if (ab.once && e.firedOnce[key]) continue;
        if (ab.cond && !this.testCondition(ab.cond, ctx)) continue;
        if (ab.once) e.firedOnce[key] = true;
        this.emit({ t: 'ability', uid: e.uid, kind, label: ab.label });
        this.runEffects(ab.effects, ctx);
      }
    } finally {
      this.triggerDepth--;
    }
    if (this.triggerDepth === 0) this.resolveDeaths();
  }

  // -------------------------------------------------------------------------
  // Effect resolution
  // -------------------------------------------------------------------------

  runEffects(effects: Effect[], ctx: ResolveCtx): void {
    for (const eff of effects) this.runEffect(eff, ctx);
  }

  private runEffect(eff: Effect, ctx: ResolveCtx): void {
    const g = this;
    switch (eff.k) {
      case 'win': {
        const winner = eff.side === 'enemy' ? other(ctx.controller) : ctx.controller;
        this.finish(winner);
        return;
      }

      case 'noop':
        return;

      case 'store':
        ctx.vars[eff.name] = this.amount(eff.amount, ctx);
        return;

      case 'if': {
        if (this.testCondition(eff.cond, ctx)) this.runEffects(eff.then, ctx);
        else if (eff.else) this.runEffects(eff.else, ctx);
        return;
      }

      case 'repeat': {
        const n = this.amount(eff.times, ctx);
        for (let i = 0; i < n && i < 32; i++) this.runEffects(eff.body, ctx);
        return;
      }

      case 'chooseOne': {
        const opt = eff.options[Math.max(0, Math.min(ctx.option, eff.options.length - 1))];
        if (opt) this.runEffects(opt.effects, ctx);
        return;
      }

      case 'necromancy': {
        const ps = this.player(ctx.controller);
        if (ps.shadows >= eff.n) {
          ps.shadows -= eff.n;
          this.emit({ t: 'shadows', player: ctx.controller, value: ps.shadows });
          this.runEffects(eff.then, ctx);
          // "Whenever you perform Necromancy" means the cost was actually paid.
          this.fireTriggers('onNecromancy', ctx.controller);
        } else if (eff.else) {
          this.runEffects(eff.else, ctx);
        }
        return;
      }

      case 'damage': {
        const amt = this.amount(eff.amount, ctx);
        const targets = this.resolveSelector(eff.target, ctx);
        let total = 0;
        for (const t of targets) {
          if (t === 'leader0') total += this.damageLeader(0, amt, ctx.source);
          else if (t === 'leader1') total += this.damageLeader(1, amt, ctx.source);
          else total += this.dealDamage(t, amt, ctx.source, true);
        }
        if (eff.drain && total > 0) this.healLeader(ctx.controller, total);
        return;
      }

      case 'heal': {
        const amt = this.amount(eff.amount, ctx);
        for (const t of this.resolveSelector(eff.target, ctx)) {
          if (t === 'leader0') this.healLeader(0, amt);
          else if (t === 'leader1') this.healLeader(1, amt);
          else this.healEntity(t, amt);
        }
        return;
      }

      case 'destroy': {
        const list = this.resolveSelector(eff.target, ctx)
          .filter(isEntity)
          .filter((t) => !this.stats(t).keywords.has('indestructible'));
        for (const t of list) this.markDeath(t);
        this.resolveDeaths();
        return;
      }

      case 'banish': {
        for (const t of this.resolveSelector(eff.target, ctx).filter(isEntity)) this.banishEntity(t);
        return;
      }

      case 'buff': {
        const a = eff.atk ? this.amount(eff.atk, ctx) : 0;
        const d = eff.def ? this.amount(eff.def, ctx) : 0;
        const until = this.expiryFor(eff.duration);
        for (const t of this.resolveSelector(eff.target, ctx).filter(isEntity)) {
          if (until === null) {
            t.buffAtk += a;
            t.buffDef += d;
          } else {
            t.temps.push({ atk: a, def: d, until });
          }
          this.emit({ t: 'buff', uid: t.uid, atk: a, def: d });
        }
        return;
      }

      case 'setStats': {
        const a = eff.atk !== undefined ? this.amount(eff.atk, ctx) : null;
        const d = eff.def !== undefined ? this.amount(eff.def, ctx) : null;
        for (const t of this.resolveSelector(eff.target, ctx).filter(isEntity)) {
          if (a !== null) t.setAtk = a;
          if (d !== null) {
            t.setDef = d;
            t.damage = 0;
          }
          this.emit({ t: 'buff', uid: t.uid, atk: 0, def: 0 });
        }
        return;
      }

      case 'grant': {
        const until = this.expiryFor(eff.duration);
        for (const t of this.resolveSelector(eff.target, ctx).filter(isEntity)) {
          const fresh: Keyword[] = [];
          for (const k of eff.keywords) {
            if (until === null) {
              if (!t.grantedKeywords.includes(k)) t.grantedKeywords.push(k);
            } else {
              fresh.push(k);
            }
            if (k === 'barrier') t.barrierCharges = Math.max(t.barrierCharges, 1);
            if (k === 'ambush') t.ambushed = true;
          }
          if (until !== null && fresh.length > 0) t.temps.push({ keywords: fresh, until });
          this.emit({ t: 'grant', uid: t.uid, keywords: eff.keywords });
        }
        return;
      }

      case 'grantAbility': {
        const until = this.expiryFor(eff.duration);
        for (const t of this.resolveSelector(eff.target, ctx).filter(isEntity)) {
          if (until === null) for (const ability of eff.abilities) t.grantedAbilities.push(ability);
          else t.temps.push({ abilities: [...eff.abilities], until });
          this.emit({ t: 'grant', uid: t.uid, keywords: [] });
        }
        return;
      }

      case 'grantLeader': {
        const side = eff.side === 'enemy' ? other(ctx.controller) : ctx.controller;
        this.player(side).leaderEffects.push({
          flags: eff.flags ? [...eff.flags] : undefined,
          abilities: eff.abilities ? [...eff.abilities] : undefined,
          until: this.expiryFor(eff.duration),
        });
        this.emit({ t: 'log', text: `${this.def(ctx.source ?? this.ent(0)).name} altered a leader` });
        return;
      }

      case 'silence': {
        for (const t of this.resolveSelector(eff.target, ctx).filter(isEntity)) {
          t.silenced = true;
          t.grantedKeywords = [];
          t.grantedAbilities = [];
          t.temps = [];
          t.barrierCharges = 0;
          t.ambushed = false;
          this.emit({ t: 'log', text: `${this.def(t).name} lost its abilities` });
        }
        this.checkState();
        return;
      }

      case 'revoke': {
        for (const t of this.resolveSelector(eff.target, ctx).filter(isEntity)) {
          for (const k of eff.keywords) {
            if (!t.removedKeywords.includes(k)) t.removedKeywords.push(k);
            if (k === 'ambush') t.ambushed = false;
          }
        }
        return;
      }

      case 'summon': {
        const n = eff.count ? this.amount(eff.count, ctx) : 1;
        const owner = eff.side === 'enemy' ? other(ctx.controller) : ctx.controller;
        for (let i = 0; i < n; i++) {
          const summoned = this.summonToken(eff.defId, owner);
          // "Summon a Pluto and give it +X/+Y" — the rest of the effect list
          // refers to what was just summoned, so bind it as the context's other.
          if (summoned) ctx.other = summoned;
        }
        return;
      }

      case 'transform': {
        for (const t of this.resolveSelector(eff.target, ctx).filter(isEntity)) {
          const from = t.defId;
          const ps = this.player(t.owner);
          const slot = ps.field.indexOf(t.uid);
          // Transform replaces the card entirely: buffs, damage and evolution
          // are all discarded.
          if (slot >= 0) ps.field.splice(slot, 1);
          t.zone = 'limbo';
          const fresh = this.createEntity(eff.into, t.owner, 'limbo');
          this.putOnField(fresh, slot >= 0 ? slot : undefined);
          this.emit({ t: 'transform', uid: fresh.uid, from, to: eff.into });
        }
        return;
      }

      case 'returnToHand': {
        for (const t of this.resolveSelector(eff.target, ctx).filter(isEntity)) {
          const ps = this.player(t.owner);
          const i = ps.field.indexOf(t.uid);
          if (i >= 0) ps.field.splice(i, 1);
          ps.field.forEach((u, k) => (this.ent(u).slot = k));
          this.emit({ t: 'returnToHand', uid: t.uid, defId: t.defId });
          // Returning to hand resets every board-acquired modifier.
          this.resetEntity(t);
          if (ps.hand.length >= RULES.HAND_LIMIT) {
            t.zone = 'cemetery';
            ps.cemetery.push(t.uid);
            ps.burned++;
            this.emit({ t: 'burn', player: t.owner, defId: t.defId });
          } else {
            t.zone = 'hand';
            ps.hand.push(t.uid);
          }
        }
        return;
      }

      case 'draw': {
        const n = this.amount(eff.amount, ctx);
        const who = eff.side === 'enemy' ? other(ctx.controller) : ctx.controller;
        for (let i = 0; i < n; i++) this.drawCard(who);
        return;
      }

      case 'discard': {
        const n = this.amount(eff.amount, ctx);
        const who = eff.side === 'enemy' ? other(ctx.controller) : ctx.controller;
        const ps = this.player(who);
        let discarded = 0;
        // "Discard all spells in your hand" only ever reaches the spells.
        const eligible = (): number[] =>
          eff.type ? ps.hand.filter((u) => this.def(this.ent(u)).type === eff.type) : ps.hand;
        for (let i = 0; i < n && eligible().length > 0; i++) {
          const pick = eligible();
          let idx: number;
          if (eff.pick) {
            // Narrow to the cheapest (or dearest) cards, then pick among them.
            const costs = pick.map((u) => this.def(this.ent(u)).cost);
            const want = eff.pick === 'lowestCost' ? Math.min(...costs) : Math.max(...costs);
            const pool = pick.filter((_, j) => costs[j] === want);
            idx = ps.hand.indexOf(this.rng.pick(pool) ?? pool[0]);
          } else {
            idx = ps.hand.indexOf(
              eff.random ? (this.rng.pick(pick) ?? pick[0]) : pick[pick.length - 1],
            );
          }
          const uid = ps.hand.splice(idx, 1)[0];
          const e = this.ent(uid);
          e.zone = 'cemetery';
          ps.cemetery.push(uid);
          this.emit({ t: 'log', text: `Discarded ${this.def(e).name}` });
          discarded++;
        }
        if (discarded > 0) this.fireTriggers('onDiscard', who, { vars: { discarded } });
        return;
      }

      case 'toHand': {
        const n = eff.count ? this.amount(eff.count, ctx) : 1;
        for (let i = 0; i < n; i++) this.addToHand(ctx.controller, eff.defId);
        return;
      }

      case 'searchToHand': {
        const n = eff.count ? this.amount(eff.count, ctx) : 1;
        const ps = this.player(ctx.controller);
        const matches = ps.deck.filter((u) => this.matchesFilter(this.ent(u), eff.filter, ctx.source));
        const chosen = eff.random === false ? matches.slice(0, n) : this.rng.sample(matches, n);
        for (const uid of chosen) {
          const i = ps.deck.indexOf(uid);
          if (i >= 0) ps.deck.splice(i, 1);
          const e = this.ent(uid);
          if (ps.hand.length >= RULES.HAND_LIMIT) {
            e.zone = 'cemetery';
            ps.cemetery.push(uid);
            ps.burned++;
            this.emit({ t: 'burn', player: ctx.controller, defId: e.defId });
          } else {
            e.zone = 'hand';
            ps.hand.push(uid);
            this.emit({ t: 'toHand', player: ctx.controller, uid, defId: e.defId });
          }
        }
        return;
      }

      case 'toDeck': {
        const n = eff.count ? this.amount(eff.count, ctx) : 1;
        const ps = this.player(ctx.controller);
        for (let i = 0; i < n; i++) {
          const e = this.createEntity(eff.defId, ctx.controller, 'deck');
          ps.deck.push(e.uid);
        }
        if (eff.shuffle !== false) this.rng.shuffle(ps.deck);
        return;
      }

      case 'gainPP': {
        const ps = this.player(ctx.controller);
        ps.pp = Math.min(RULES.MAX_PP, ps.pp + this.amount(eff.amount, ctx));
        this.emit({ t: 'ppChange', player: ctx.controller, pp: ps.pp, maxPp: ps.maxPp });
        return;
      }

      case 'gainMaxPP': {
        const ps = this.player(ctx.controller);
        ps.maxPp = Math.min(RULES.MAX_PP, ps.maxPp + this.amount(eff.amount, ctx));
        this.emit({ t: 'ppChange', player: ctx.controller, pp: ps.pp, maxPp: ps.maxPp });
        return;
      }

      case 'gainEP': {
        const ps = this.player(ctx.controller);
        ps.ep += this.amount(eff.amount, ctx);
        this.emit({ t: 'epChange', player: ctx.controller, ep: ps.ep });
        return;
      }

      case 'gainShadows': {
        const ps = this.player(ctx.controller);
        ps.shadows += this.amount(eff.amount, ctx);
        this.emit({ t: 'shadows', player: ctx.controller, value: ps.shadows });
        return;
      }

      case 'spendShadows': {
        const ps = this.player(ctx.controller);
        ps.shadows = Math.max(0, ps.shadows - this.amount(eff.amount, ctx));
        this.emit({ t: 'shadows', player: ctx.controller, value: ps.shadows });
        return;
      }

      case 'costMod': {
        const delta = this.amount(eff.delta, ctx);
        // "Subtract 1 from the cost of this card" must hit only that card, so
        // the selector is resolved rather than assumed to mean the whole hand.
        const sel: Selector = { ...eff.target, zone: eff.target.zone ?? eff.zone ?? 'hand' };
        for (const t of this.resolveSelector(sel, ctx).filter(isEntity)) {
          t.costMod += delta;
        }
        return;
      }

      case 'evolveTarget': {
        for (const t of this.resolveSelector(eff.target, ctx).filter(isEntity)) {
          this.forceEvolve(t.uid);
        }
        return;
      }

      case 'countdown': {
        const delta = this.amount(eff.delta, ctx);
        for (const t of this.resolveSelector(eff.target, ctx).filter(isEntity)) {
          t.countdown = Math.max(0, t.countdown + delta);
          this.emit({ t: 'countdown', uid: t.uid, value: t.countdown });
          if (t.countdown === 0) {
            this.fireEntityTriggers(t, 'countdownEnd');
            this.destroyEntity(t);
          }
        }
        return;
      }

      case 'spellboost': {
        const n = eff.amount ? this.amount(eff.amount, ctx) : 1;
        for (const uid of this.player(ctx.controller).hand) this.ent(uid).spellboost += n;
        this.emit({ t: 'spellboost', player: ctx.controller });
        return;
      }

      case 'earthRite': {
        const sigils = this.earthSigils(ctx.controller);
        if (sigils.length > 0) {
          const victim = sigils[0];
          this.emit({ t: 'earthRite', player: ctx.controller, uid: victim.uid });
          this.destroyEntity(victim);
          this.runEffects(eff.then, ctx);
        } else if (eff.else) {
          this.runEffects(eff.else, ctx);
        }
        return;
      }

      case 'freeze': {
        // "Can't attack next turn" — the follower is locked out through its
        // controller's next turn, which is two absolute turns away.
        for (const t of this.resolveSelector(eff.target, ctx).filter(isEntity)) {
          t.frozenUntilTurn = Math.max(t.frozenUntilTurn, this.state.turn + 2);
          this.emit({ t: 'grant', uid: t.uid, keywords: ['cantAttack'] });
        }
        return;
      }

      case 'setCost': {
        const target = this.amount(eff.cost, ctx);
        for (const t of this.resolveSelector(eff.target, ctx).filter(isEntity)) {
          t.costMod = target - this.def(t).cost;
        }
        return;
      }

      case 'untilFull': {
        const ps = this.player(ctx.controller);
        const cap = eff.where === 'field' ? RULES.BOARD_LIMIT : RULES.HAND_LIMIT;
        let guard = 0;
        while (guard++ < cap + 2) {
          const size = eff.where === 'field' ? ps.field.length : ps.hand.length;
          if (size >= cap) break;
          this.runEffects(eff.body, ctx);
          const after = eff.where === 'field' ? ps.field.length : ps.hand.length;
          // If the body did not actually add anything, stop rather than spin.
          if (after <= size) break;
        }
        return;
      }

      case 'withTarget': {
        // Bind the chosen entity so later effects in `body` can read its stats
        // even after it has left play.
        for (const t of this.resolveSelector(eff.target, ctx).filter(isEntity)) {
          this.runEffects(eff.body, { ...ctx, other: t });
        }
        return;
      }

      case 'searchToField': {
        const ps = this.player(ctx.controller);
        const n = eff.count ? this.amount(eff.count, ctx) : 1;
        let pool = ps.deck.filter((u) => this.matchesFilter(this.ent(u), eff.filter, ctx.source));
        const chosen: number[] = [];
        const usedCosts = new Set<number>();
        while (chosen.length < n && pool.length > 0) {
          if (ps.field.length + chosen.length >= RULES.BOARD_LIMIT) break;
          const pick = this.rng.pick(pool);
          if (pick === undefined) break;
          const cost = this.def(pick).cost;
          if (eff.distinctCost && usedCosts.has(cost)) {
            pool = pool.filter((u) => this.def(u).cost !== cost);
            continue;
          }
          usedCosts.add(cost);
          chosen.push(pick);
          pool = pool.filter((u) => u !== pick);
        }
        for (const uid of chosen) {
          const i = ps.deck.indexOf(uid);
          if (i >= 0) ps.deck.splice(i, 1);
          const e = this.ent(uid);
          e.zone = 'limbo';
          if (ps.field.length >= RULES.BOARD_LIMIT) break;
          this.putOnField(e);
          this.fireEntityTriggers(e, 'onSummon');
        }
        return;
      }

      case 'copy': {
        const n = eff.count ? this.amount(eff.count, ctx) : 1;
        for (const t of this.resolveSelector(eff.target, ctx).filter(isEntity)) {
          for (let i = 0; i < n; i++) {
            if (eff.to === 'hand') this.addToHand(ctx.controller, t.defId);
            else this.summonToken(t.defId, ctx.controller);
          }
        }
        return;
      }

      case 'discardMatching': {
        const ps = this.player(ctx.controller);
        const doomed = ps.hand.filter((u) => this.matchesFilter(this.ent(u), eff.filter, ctx.source));
        for (const uid of doomed) {
          const i = ps.hand.indexOf(uid);
          if (i >= 0) ps.hand.splice(i, 1);
          const e = this.ent(uid);
          e.zone = 'cemetery';
          ps.cemetery.push(uid);
        }
        ctx.vars.discarded = doomed.length;
        if (doomed.length > 0) {
          this.fireTriggers('onDiscard', ctx.controller, { vars: { discarded: doomed.length } });
        }
        return;
      }

      case 'summonRandom': {
        const n = eff.count ? this.amount(eff.count, ctx) : 1;
        for (let i = 0; i < n; i++) {
          const pick = this.rng.pick(eff.defIds);
          if (pick) this.summonToken(pick, ctx.controller);
        }
        return;
      }

      case 'restoreFully': {
        for (const t of this.resolveSelector(eff.target, ctx).filter(isEntity)) {
          this.healEntity(t, t.damage);
        }
        return;
      }

      case 'consumeSpellboost': {
        if (ctx.source) ctx.source.spellboost = 0;
        return;
      }

      case 'reduceLeaderDefense': {
        const who = eff.side === 'enemy' ? other(ctx.controller) : ctx.controller;
        this.damageLeader(who, this.amount(eff.amount, ctx), ctx.source);
        return;
      }

      default: {
        const never: never = eff;
        void never;
        void g;
        return;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Selectors
  // -------------------------------------------------------------------------

  /** Board entities (and leader tokens) a selector resolves to. */
  private resolveSelector(sel: Selector, ctx: ResolveCtx): (Entity | 'leader0' | 'leader1')[] {
    const ctrl = ctx.controller;

    if (sel.scope === 'self') return ctx.source ? [ctx.source] : [];
    if (sel.scope === 'other') return ctx.other ? [ctx.other] : [];

    if (sel.scope === 'leader' || sel.leaderOnly) {
      const side = sel.side ?? 'enemy';
      const out: ('leader0' | 'leader1')[] = [];
      if (side === 'ally' || side === 'both') out.push(ctrl === 0 ? 'leader0' : 'leader1');
      if (side === 'enemy' || side === 'both') out.push(ctrl === 0 ? 'leader1' : 'leader0');
      return out;
    }

    const pool = this.candidatePool(sel, ctrl, ctx.source);

    switch (sel.scope) {
      case 'all': {
        if (!sel.includeLeader) return pool;
        return [...pool, ...this.leaderRefs(sel.side ?? 'both', ctrl)];
      }
      case 'target': {
        const picked: (Entity | 'leader0' | 'leader1')[] = [];
        const n = sel.count ?? 1;
        const legal = new Set(this.legalTargets(sel, ctrl, ctx.source));
        for (let i = 0; i < n; i++) {
          const uid = ctx.targets[ctx.ti++];
          if (uid === undefined) break;
          if (!legal.has(uid)) continue;
          const lead = leaderOfUid(uid);
          if (lead !== null) {
            picked.push(lead === 0 ? 'leader0' : 'leader1');
            continue;
          }
          const e = this.state.entities.get(uid);
          if (e && pool.includes(e)) picked.push(e);
        }
        // A supplied target that is no longer legal simply does nothing, which
        // matches the original game's behaviour when a target dies mid-chain.
        return picked;
      }
      case 'random': {
        const withLeaders: (Entity | 'leader0' | 'leader1')[] = [...pool];
        if (sel.includeLeader) {
          for (const l of this.leaderRefs(sel.side ?? 'both', ctrl)) withLeaders.push(l);
        }
        return this.rng.sample(withLeaders, sel.count ?? 1);
      }
      case 'highest':
      case 'lowest': {
        if (pool.length === 0) return [];
        const key = (e: Entity) => {
          const s = this.stats(e);
          return sel.by === 'def' ? s.def : sel.by === 'cost' ? this.def(e).cost : s.atk;
        };
        const sorted = [...pool].sort((a, b) =>
          sel.scope === 'highest' ? key(b) - key(a) || a.slot - b.slot : key(a) - key(b) || a.slot - b.slot,
        );
        const best = key(sorted[0]);
        const tied = sorted.filter((e) => key(e) === best);
        // Ties among equal extremes are broken at random, as in the original.
        const n = sel.count ?? 1;
        return tied.length > n ? this.rng.sample(tied, n) : sorted.slice(0, n);
      }
      default:
        return [];
    }
  }

  private candidatePool(sel: Selector, ctrl: PlayerId, source: Entity | null): Entity[] {
    const side: Side = sel.side ?? 'both';
    const zone = sel.zone ?? 'field';
    const sides: PlayerId[] =
      side === 'ally' ? [ctrl] : side === 'enemy' ? [other(ctrl)] : [ctrl, other(ctrl)];

    const out: Entity[] = [];
    for (const p of sides) {
      const ps = this.player(p);
      const uids =
        zone === 'field' ? ps.field : zone === 'hand' ? ps.hand : zone === 'deck' ? ps.deck : ps.cemetery;
      for (const uid of uids) {
        const e = this.state.entities.get(uid);
        if (!e) continue;
        if (zone === 'field' && e.zone !== 'field') continue;
        if (!this.matchesKind(e, sel.kind ?? 'follower')) continue;
        // Ambush and Untargetable both hide a follower from enemy effects.
        if (zone === 'field' && e.owner !== ctrl && this.stats(e).keywords.has('untargetable')) continue;
        if (sel.filter && !this.matchesFilter(e, sel.filter, source)) continue;
        out.push(e);
      }
    }
    return out;
  }

  /** Legal targets for an interactive target request, as uids. */
  legalTargets(sel: Selector, controller: PlayerId, source: Entity | null): number[] {
    const side = sel.side ?? 'both';
    if (sel.scope === 'leader' || sel.leaderOnly) {
      const out: number[] = [];
      if (side === 'ally' || side === 'both') out.push(LEADER_UID(controller));
      if (side === 'enemy' || side === 'both') out.push(LEADER_UID(other(controller)));
      return out;
    }
    const out = this.candidatePool(sel, controller, source).map((e) => e.uid);
    if (sel.includeLeader) {
      if (side === 'ally' || side === 'both') out.push(LEADER_UID(controller));
      if (side === 'enemy' || side === 'both') out.push(LEADER_UID(other(controller)));
    }
    return out;
  }

  private leaderRefs(side: Side, ctrl: PlayerId): ('leader0' | 'leader1')[] {
    const out: ('leader0' | 'leader1')[] = [];
    if (side === 'ally' || side === 'both') out.push(ctrl === 0 ? 'leader0' : 'leader1');
    if (side === 'enemy' || side === 'both') out.push(ctrl === 0 ? 'leader1' : 'leader0');
    return out;
  }

  // -------------------------------------------------------------------------
  // Amounts & conditions
  // -------------------------------------------------------------------------

  amount(a: Amount, ctx: ResolveCtx): number {
    return Math.floor(this.rawAmount(a, ctx));
  }

  private rawAmount(a: Amount, ctx: ResolveCtx): number {
    if (typeof a === 'number') return a;
    switch (a.k) {
      case 'count':
        return this.resolveSelector(a.of, { ...ctx, ti: 0 }).length;
      case 'statOf': {
        const picked = this.resolveSelector(a.of, { ...ctx, ti: 0 }).filter(isEntity);
        const values = picked.map((e) => {
          if (a.stat === 'cost') return this.def(e).cost;
          const st = this.stats(e);
          return a.stat === 'atk' ? st.atk : st.def;
        });
        if (values.length === 0) return 0;
        if (a.pick === 'sum') return values.reduce((s, v) => s + v, 0);
        return a.pick === 'max' ? Math.max(...values) : Math.min(...values);
      }
      case 'shadows':
        return this.player(ctx.controller).shadows;
      case 'spellboost':
        return ctx.source ? ctx.source.spellboost : 0;
      case 'cardsPlayed':
        return this.player(ctx.controller).cardsPlayedThisTurn;
      case 'handSize':
        return this.player(this.sideToPlayer(a.side ?? 'ally', ctx.controller)).hand.length;
      case 'deckSize':
        return this.player(this.sideToPlayer(a.side ?? 'ally', ctx.controller)).deck.length;
      case 'pp':
        return this.player(ctx.controller).pp;
      case 'maxPP':
        return this.player(this.sideToPlayer(a.side ?? 'ally', ctx.controller)).maxPp;
      case 'leaderDefenseLost': {
        const ps = this.player(this.sideToPlayer(a.side ?? 'ally', ctx.controller));
        return Math.max(0, ps.maxDefense - ps.defense);
      }
      case 'sourceAtk':
        return ctx.source ? this.stats(ctx.source).atk : 0;
      case 'sourceDef':
        return ctx.source ? this.stats(ctx.source).def : 0;
      case 'otherAtk':
        return ctx.other ? this.stats(ctx.other).atk : 0;
      case 'otherDef':
        return ctx.other ? this.stats(ctx.other).def : 0;
      case 'otherCost':
        return ctx.other ? this.def(ctx.other).cost : 0;
      case 'destroyedThisTurn': {
        const side = a.side ?? 'ally';
        const p = side === 'enemy' ? other(ctx.controller) : ctx.controller;
        return this.destroyedThisTurn[p];
      }
      case 'leaderDefense':
        return this.player(this.sideToPlayer(a.side ?? 'ally', ctx.controller)).defense;
      case 'ctx':
        return ctx.vars[a.name] ?? 0;
      case 'sum':
        return a.of.reduce<number>((s, x) => s + this.rawAmount(x, ctx), 0);
      case 'mul':
        return this.rawAmount(a.a, ctx) * this.rawAmount(a.b, ctx);
      case 'min':
        return Math.min(this.rawAmount(a.a, ctx), this.rawAmount(a.b, ctx));
      case 'max':
        return Math.max(this.rawAmount(a.a, ctx), this.rawAmount(a.b, ctx));
      default:
        return 0;
    }
  }

  /** Allied Earth Sigil amulets, leftmost first — the order Earth Rite eats. */
  earthSigils(p: PlayerId): Entity[] {
    return this.player(p)
      .field.map((u) => this.ent(u))
      .filter((e) => e.zone === 'field' && EARTH_SIGILS.has(e.defId));
  }

  private sideToPlayer(side: Side, ctrl: PlayerId): PlayerId {
    return side === 'enemy' ? other(ctrl) : ctrl;
  }

  testCondition(c: Condition, ctx: ResolveCtx): boolean {
    switch (c.k) {
      case 'vengeance':
        return this.player(ctx.controller).defense <= 10;
      case 'overflow':
        return this.player(ctx.controller).maxPp >= 7;
      case 'resonance':
        return this.player(ctx.controller).deck.length % 2 === 0;
      case 'hasEarthSigil':
        return this.earthSigils(ctx.controller).length > 0;
      case 'cardsPlayed':
        return this.player(ctx.controller).cardsPlayedThisTurn >= c.n;
      case 'opponentTurn':
        return this.state.active !== ctx.controller;
      case 'subject':
        return !!ctx.other && this.matchesFilter(ctx.other, c.filter, ctx.source);
      case 'hasShadows':
        return this.player(ctx.controller).shadows >= c.n;
      case 'atLeast':
        return this.amount(c.a, ctx) >= this.amount(c.b, ctx);
      case 'greater':
        return this.amount(c.a, ctx) > this.amount(c.b, ctx);
      case 'equal':
        return this.amount(c.a, ctx) === this.amount(c.b, ctx);
      case 'exists':
        return this.resolveSelector(c.sel, { ...ctx, ti: 0 }).length > 0;
      case 'isEvolved': {
        const list = c.sel
          ? this.resolveSelector(c.sel, { ...ctx, ti: 0 }).filter(isEntity)
          : ctx.source
            ? [ctx.source]
            : [];
        return list.some((e) => e.evolved);
      }
      case 'not':
        return !this.testCondition(c.c, ctx);
      case 'and':
        return c.cs.every((x) => this.testCondition(x, ctx));
      case 'or':
        return c.cs.some((x) => this.testCondition(x, ctx));
      default:
        return false;
    }
  }

  private resetEntity(e: Entity): void {
    e.evolved = false;
    e.damage = 0;
    e.buffAtk = 0;
    e.buffDef = 0;
    e.temps = [];
    e.setAtk = null;
    e.setDef = null;
    e.grantedKeywords = [];
    e.removedKeywords = [];
    e.attacksThisTurn = 0;
    e.canAttackFollowersEarly = false;
    e.costMod = 0;
    e.countdown = this.def(e).countdown ?? 0;
    e.ambushed = (this.def(e).keywords ?? []).includes('ambush');
    e.frozenUntilTurn = -1;
    e.barrierCharges = (this.def(e).keywords ?? []).includes('barrier') ? 1 : 0;
    e.firedOnce = {};
    e.dying = false;
  }

  // -------------------------------------------------------------------------
  // Action dispatch (used by the UI and the AI alike)
  // -------------------------------------------------------------------------

  apply(action: Action): boolean {
    switch (action.a) {
      case 'mulligan':
        this.mulligan(action.player, action.replace);
        return true;
      case 'play':
        return this.playCard(
          action.uid,
          action.targets ?? [],
          action.slot,
          action.option ?? 0,
          action.enhance,
        );
      case 'attack':
        return this.attack(action.attacker, action.target);
      case 'evolve':
        return this.evolve(action.uid, action.targets ?? []);
      case 'endTurn':
        this.endTurn();
        return true;
      default:
        return false;
    }
  }
}

function isEntity(x: Entity | 'leader0' | 'leader1'): x is Entity {
  return typeof x !== 'string';
}
