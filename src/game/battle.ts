/**
 * The battle screen.
 *
 * This is the seam between the rules engine and the presentation layer. It
 * owns no rules: it reads `Game` state to lay the board out, turns the engine's
 * `GameEvent` stream into animations, and sends player intent back as actions.
 * The engine never calls into here.
 */
import * as THREE from 'three';
import { Game, type Action, type DeckList } from '../engine/game';
import type { GameEvent, PlayerId } from '../engine/types';
import { LEADER_UID, RULES, leaderOfUid, other } from '../engine/types';
import { tryGetCard } from '../engine/registry';
import { Stage } from '../render/stage';
import { BOARD, Board, slotPosition } from '../render/board';
import { CardObject } from '../render/cardmesh';
import { LeaderObject } from '../render/leader';
import { Effects } from '../render/effects';
import { Hud } from '../ui/hud';
import { CLASS_THEME, TIMING, UI } from '../art/theme';
import { Audio } from '../audio/audio';
import { chooseAiMulligan, chooseAiTurn } from './ai';
import { MulliganOverlay } from '../ui/mulligan';
import { CardDetail, type LiveCardState } from '../ui/detail';
import { ensureScreenStyles } from '../ui/style';
import { cardName, t } from '../i18n';

const HAND_CARD_W = 1.34;
const BOARD_CARD_W = 1.06;

type Pointer = { x: number; y: number };

/** What the player is currently doing with the pointer. */
type Interaction =
  | { kind: 'idle' }
  | { kind: 'dragCard'; uid: number; pointer: Pointer }
  | { kind: 'chooseTarget'; uid: number; enhance?: number; slot?: number; legal: number[]; from: 'play' | 'evolve' }
  | { kind: 'attackFrom'; uid: number; pointer: Pointer };

export interface BattleOptions {
  container: HTMLElement;
  decks: [DeckList, DeckList];
  /** Which seat the human occupies. */
  human?: PlayerId;
  seed?: number;
  /** Skips the redraw step — used by the screenshot tooling. */
  skipMulligan?: boolean;
  onExit?: () => void;
}

export class Battle {
  readonly game: Game;
  readonly stage: Stage;
  readonly board: Board;
  readonly hud: Hud;
  readonly effects: Effects;
  readonly audio = new Audio();

  private readonly human: PlayerId;
  private readonly leaders: Record<PlayerId, LeaderObject>;
  private readonly cards = new Map<number, CardObject>();
  private interaction: Interaction = { kind: 'idle' };
  private hovered: number | null = null;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  /** Queue of engine events waiting to be animated. */
  private queue: GameEvent[] = [];
  private animating = false;
  private aiTimer = 0;
  private disposed = false;
  /** A card dropped on the board that is waiting for an Enhance choice. */
  private pendingEnhance: { uid: number; slot: number } | null = null;
  /** Reads out any card on the board, including the opponent's. */
  private readonly inspector: CardDetail;
  /** Press-and-hold state, so a long press inspects instead of acting. */
  private holdTimer = 0;
  private holdUid: number | null = null;

  constructor(private readonly opts: BattleOptions) {
    this.human = opts.human ?? 0;
    this.game = new Game(opts.decks, {
      seed: opts.seed,
      first: 0,
      skipMulligan: opts.skipMulligan ?? false,
    });

    this.stage = new Stage({ container: opts.container });
    this.board = new Board(opts.decks[this.human].leaderClass, opts.decks[other(this.human)].leaderClass);
    this.stage.root.add(this.board.group);

    this.effects = new Effects(this.stage);

    this.leaders = {
      0: new LeaderObject(opts.decks[0].leaderClass, 0x51a2f3, 1.95),
      1: new LeaderObject(opts.decks[1].leaderClass, 0x9c33af, 1.95),
    } as Record<PlayerId, LeaderObject>;

    const allyLeader = this.leaders[this.human];
    const enemyLeader = this.leaders[other(this.human)];
    allyLeader.group.position.set(BOARD.LEADER_X, 1.24, BOARD.ROW_Z.ally + 1.0);
    allyLeader.group.rotation.set(-0.4, 0.3, 0);
    enemyLeader.group.position.set(BOARD.LEADER_X, 1.24, BOARD.ROW_Z.enemy - 1.0);
    enemyLeader.group.rotation.set(-0.4, 0.3, 0);
    this.stage.root.add(allyLeader.group, enemyLeader.group);

    this.hud = new Hud(opts.container, {
      onEndTurn: () => this.requestEndTurn(),
      onSurrender: () => this.concede(),
      onExit: () => this.dispose(),
    });
    this.hud.applyClassTheme(opts.decks[this.human].leaderClass, this.human);

    // The opponent's cards are otherwise unreadable at board scale, so any card
    // in a public zone can be opened full size with its live state.
    ensureScreenStyles();
    this.inspector = new CardDetail(opts.container);

    this.bindInput();
    this.stage.onUpdate((dt, t) => this.update(dt, t));
    this.stage.start();

    // Drain the events the constructor already produced (draws, first turn).
    this.queue.push(...this.game.drainEvents());
    this.syncAll(true);

    this.hud.addLog(t('battle.inspectHint'));

    if (this.game.state.phase === 'mulligan') this.startMulligan();
    else this.hud.showTurnBanner(this.game.state.active === this.human);
  }

  /**
   * Both players redraw simultaneously, so the AI's choice is applied at the
   * same moment the player confirms theirs.
   */
  private startMulligan(): void {
    const hand = this.game
      .player(this.human)
      .hand.map((uid) => ({ uid, def: this.game.def(uid) }));

    new MulliganOverlay({
      container: this.opts.container,
      cards: hand,
      onConfirm: (replace) => {
        const foe = other(this.human);
        this.game.mulligan(this.human, replace);
        this.game.mulligan(foe, chooseAiMulligan(this.game, foe));
        this.queue.push(...this.game.drainEvents());
        this.syncAll(true);
        this.hud.showTurnBanner(this.game.state.active === this.human);
        this.audio.play('turnMine');
      },
    });
  }

  // -------------------------------------------------------------------------
  // Card objects
  // -------------------------------------------------------------------------

  private cardFor(uid: number): CardObject {
    let obj = this.cards.get(uid);
    if (!obj) {
      const def = this.game.def(uid);
      obj = new CardObject({ def, view: 'hand', width: HAND_CARD_W });
      this.cards.set(uid, obj);
      this.stage.root.add(obj.group);
    }
    return obj;
  }

  private removeCard(uid: number): void {
    const obj = this.cards.get(uid);
    if (!obj) return;
    obj.dispose();
    this.cards.delete(uid);
  }

  // -------------------------------------------------------------------------
  // Layout
  // -------------------------------------------------------------------------

  /** Re-derives every card's target transform from the current game state. */
  private syncAll(snap = false): void {
    const g = this.game;
    const seen = new Set<number>();

    for (const p of [0, 1] as PlayerId[]) {
      const ps = g.player(p);
      const side = p === this.human ? 'ally' : 'enemy';

      // --- board ---------------------------------------------------------
      ps.field.forEach((uid, i) => {
        seen.add(uid);
        const obj = this.cardFor(uid);
        obj.setView('board', BOARD_CARD_W);
        const e = g.ent(uid);
        const st = g.stats(uid);
        const def = g.def(uid);
        const canAct =
          p === this.human &&
          g.state.active === this.human &&
          def.type === 'follower' &&
          (g.canAttack(uid, 'leader') || this.anyAttackTarget(uid));
        obj.refresh({
          atk: st.atk,
          def: st.def,
          maxDef: st.maxDef,
          evolved: e.evolved,
          keywords: [...st.keywords],
          countdown: def.type === 'amulet' && def.countdown !== undefined ? e.countdown : undefined,
          ready: canAct,
          spent: def.type === 'follower' && p === this.human && !canAct && g.state.active === this.human,
        });

        const pos = slotPosition(side, i, ps.field.length);
        obj.target.position.set(pos.x, 0.7, pos.z);
        // Board cards lean back slightly so the camera sees their faces.
        obj.target.rotation.set(-0.5, 0, 0);
        obj.target.scale = 1;
        obj.setGlowPulse(canAct ? 0.5 : 0);
        if (!canAct) obj.setGlow(0);
        else obj.setGlow(0.5, '#8CF0AA');
        if (snap) obj.snap();
      });

      // --- hand ----------------------------------------------------------
      this.layoutHand(p, ps.hand, seen, snap);
    }

    for (const uid of [...this.cards.keys()]) {
      if (!seen.has(uid)) this.removeCard(uid);
    }

    this.board.layoutSockets(
      g.player(this.human).field.length,
      g.player(other(this.human)).field.length,
    );
    this.syncHud();
  }

  /**
   * Fans a hand along an arc. The player's hand is large and face-up at the
   * bottom of the screen; the opponent's is a small row of card backs above.
   */
  private layoutHand(p: PlayerId, hand: number[], seen: Set<number>, snap: boolean): void {
    const mine = p === this.human;
    const n = hand.length;
    if (n === 0) return;

    // Cards overlap more as the hand grows, so a full hand still fits.
    const spread = mine ? Math.min(1.12, 8.2 / Math.max(n, 1)) : 0.42;
    const arc = mine ? 0.085 : 0.02;
    const rise = mine ? 0.34 : 0.1;

    hand.forEach((uid, i) => {
      seen.add(uid);
      const obj = this.cardFor(uid);
      obj.setView(mine ? 'hand' : 'back', mine ? HAND_CARD_W : HAND_CARD_W * 0.62);
      if (mine) obj.refresh(undefined, { lang: 'en' });
      else obj.refresh();

      const mid = (n - 1) / 2;
      const off = i - mid;
      const x = off * spread;
      // A shallow arc: cards rise toward the middle and tilt outward.
      // The fan rises toward the middle and the ends tuck back a little.
      const y = (mine ? BOARD.HAND_Y : 1.55) + (mine ? -Math.abs(off) * rise * 0.16 : 0);
      const z = (mine ? BOARD.HAND_Z : -4.55) + Math.abs(off) * (mine ? 0.13 : 0.04);

      // A card waiting on an Enhance choice stays raised, so the buttons over
      // it clearly belong to it.
      const choosing = mine && this.pendingEnhance?.uid === uid;
      const focused = choosing || (mine && this.hovered === uid && this.interaction.kind === 'idle');
      const dragging = this.interaction.kind === 'dragCard' && this.interaction.uid === uid;

      if (dragging) {
        obj.target.scale = 1.02;
        obj.setGlow(0.7, this.canAffordGlow(uid));
      } else {
        // A focused card lifts and tilts toward the camera but stays over the
      // hand — pulling it onto the board would hide the thing being played to.
      obj.target.position.set(
        BOARD.ROW_X * (mine ? 0.7 : 1) + x,
        focused ? y + 0.85 : y,
        focused ? z - 0.35 : z,
      );
        obj.target.rotation.set(mine ? (focused ? -0.78 : -0.92) : -0.42, 0, mine ? -off * arc : 0);
        obj.target.scale = focused ? 1.45 : 1;
        obj.setGlow(mine && this.game.canPlay(uid, p) && this.game.state.active === p ? 0.34 : 0, UI.gold);
      }
      obj.group.renderOrder = i;
      if (snap) obj.snap();
    });
  }

  private canAffordGlow(uid: number): string {
    return this.game.canPlay(uid) ? '#8CF0AA' : UI.damage;
  }

  private anyAttackTarget(uid: number): boolean {
    const enemy = other(this.game.ent(uid).owner);
    return this.game.player(enemy).field.some((t) => this.game.canAttack(uid, t));
  }

  private syncHud(): void {
    const g = this.game;
    const me = g.player(this.human);
    const foe = g.player(other(this.human));
    this.hud.setPlayPoints(me.pp, me.maxPp);
    const epCapacity = g.state.turn >= g.evolveTurnFor(this.human)
      ? (g.firstPlayer === this.human ? RULES.EP_FIRST : RULES.EP_SECOND)
      : 0;
    this.hud.setEvolutionPoints(
      me.ep,
      epCapacity,
      g.state.active === this.human && !me.hasEvolvedThisTurn && me.ep > 0,
    );
    this.hud.setDeckCounts(me.deck.length, foe.deck.length, me.hand.length, foe.hand.length);
    this.hud.setTurn(g.state.turn, g.state.active === this.human && !this.animating);
    this.leaders[this.human].setDefense(me.defense, me.maxDefense);
    this.leaders[this.human].setShadows(me.shadows);
    this.leaders[other(this.human)].setDefense(foe.defense, foe.maxDefense);
    this.leaders[other(this.human)].setShadows(foe.shadows);
    // The active leader stands forward, so whose turn it is reads off the board
    // itself rather than only off the HUD.
    this.leaders[0].setActive(g.state.winner === null && g.state.active === 0);
    this.leaders[1].setActive(g.state.winner === null && g.state.active === 1);
  }

  // -------------------------------------------------------------------------
  // Input
  // -------------------------------------------------------------------------

  private bindInput(): void {
    const el = this.stage.renderer.domElement;
    el.addEventListener('pointermove', (e) => this.onPointerMove(e));
    el.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    el.addEventListener('pointerup', (e) => this.onPointerUp(e));
    el.addEventListener('pointercancel', () => {
      this.clearHold();
      this.cancelInteraction();
    });
    // Right-click reads a card out rather than opening the browser menu.
    el.addEventListener('contextmenu', (e) => {
      this.setPointer(e as unknown as PointerEvent);
      const uid = this.pick();
      if (uid !== null && this.inspect(uid)) e.preventDefault();
    });
  }

  // -------------------------------------------------------------------------
  // Card inspector
  // -------------------------------------------------------------------------

  /**
   * Opens the full card for `uid` if the player is allowed to see it. Cards in
   * the opponent's hand or deck are face down and stay that way; everything on
   * the board is public information and readable by either side.
   */
  private inspect(uid: number): boolean {
    const ent = this.game.state.entities.get(uid);
    if (!ent) return false;
    const visible = ent.zone === 'field' || ent.owner === this.human;
    if (!visible) return false;
    const def = this.game.def(uid);

    let live: LiveCardState | undefined;
    if (ent.zone === 'field') {
      const st = this.game.stats(uid);
      const on: LiveCardState = {
        owner: ent.owner === this.human ? 'you' : 'foe',
        evolved: ent.evolved,
        keywords: [...st.keywords],
      };
      if (def.type === 'follower') {
        // `stats()` already nets out damage taken; maxDef is the undamaged value.
        on.atk = st.atk;
        on.def = st.def;
        on.maxDef = st.maxDef;
      }
      if (def.type === 'amulet' && ent.countdown !== undefined) on.countdown = ent.countdown;
      live = on;
    }

    this.inspector.open(def, live);
    this.audio.play('hover');
    return true;
  }

  private setPointer(e: PointerEvent): void {
    const rect = this.stage.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  /** Card uid under the pointer, nearest first. */
  private pick(): number | null {
    this.raycaster.setFromCamera(this.pointer, this.stage.camera);
    const meshes: THREE.Object3D[] = [];
    const owner = new Map<THREE.Object3D, number>();
    for (const [uid, obj] of this.cards) {
      meshes.push(obj.mesh);
      owner.set(obj.mesh, uid);
    }
    const hits = this.raycaster.intersectObjects(meshes, false);
    if (hits.length === 0) return null;
    // Prefer the highest render order among near-coincident hits so a fanned
    // hand picks the card visually on top.
    return owner.get(hits[0].object) ?? null;
  }

  private pickLeader(): PlayerId | null {
    this.raycaster.setFromCamera(this.pointer, this.stage.camera);
    for (const p of [0, 1] as PlayerId[]) {
      const hits = this.raycaster.intersectObject(this.leaders[p].group, true);
      if (hits.length > 0) return p;
    }
    return null;
  }

  /** Where the pointer ray meets the board plane. */
  private groundPoint(): THREE.Vector3 {
    this.raycaster.setFromCamera(this.pointer, this.stage.camera);
    const out = new THREE.Vector3();
    this.raycaster.ray.intersectPlane(this.plane, out);
    return out;
  }

  private onPointerMove(e: PointerEvent): void {
    this.setPointer(e);
    if (this.holdTimer) this.clearHold();
    const it = this.interaction;

    if (it.kind === 'dragCard') {
      const g = this.groundPoint();
      const obj = this.cardFor(it.uid);
      obj.target.position.set(g.x, 1.7, g.z);
      obj.target.rotation.set(-0.75, 0, 0);
      obj.setSpeed(26);
      const playable = this.game.canPlay(it.uid);
      const def = this.game.def(it.uid);
      this.board.showDropSlots(
        this.game.player(this.human).field.length,
        playable && def.type !== 'spell' && g.z > -1.6,
        CLASS_THEME[def.cardClass].primary,
      );
      return;
    }

    if (it.kind === 'attackFrom') {
      const g = this.groundPoint();
      this.effects.setTargetingRibbon(this.cardFor(it.uid).group.position, new THREE.Vector3(g.x, 0.9, g.z));
      return;
    }

    if (it.kind === 'chooseTarget') {
      const g = this.groundPoint();
      const src = this.cards.get(it.uid);
      if (src) this.effects.setTargetingRibbon(src.group.position, new THREE.Vector3(g.x, 0.9, g.z));
      return;
    }

    const uid = this.pick();
    const inHand = uid !== null && this.game.player(this.human).hand.includes(uid);
    const next = inHand ? uid : null;
    if (next !== this.hovered) {
      this.hovered = next;
      if (next !== null) this.audio.play('hover');
      this.syncAll();
    }
  }

  /** Cancels a pending press-and-hold. */
  private clearHold(): void {
    if (this.holdTimer) window.clearTimeout(this.holdTimer);
    this.holdTimer = 0;
    this.holdUid = null;
  }

  private onPointerDown(e: PointerEvent): void {
    this.setPointer(e);
    this.clearHold();
    if (this.inspector.isOpen) return;

    const hit = this.pick();

    // Press and hold reads a card out. It is armed in every phase — including
    // the opponent's turn — and cancelled the moment the pointer moves or
    // lifts, so it never competes with dragging.
    if (hit !== null) {
      this.holdUid = hit;
      this.holdTimer = window.setTimeout(() => {
        this.holdTimer = 0;
        const uid = this.holdUid;
        this.holdUid = null;
        if (uid !== null && this.inspect(uid)) this.cancelInteraction();
      }, 420);
    }

    // A card the player cannot act on is a card they can only read: tapping an
    // opponent's follower, or one of their own amulets, opens it at once.
    if (hit !== null && !this.isActionable(hit)) {
      this.clearHold();
      this.inspect(hit);
      return;
    }

    if (this.game.state.winner !== null || this.animating) return;
    if (this.game.state.active !== this.human) return;

    const it = this.interaction;

    if (this.pendingEnhance && this.pick() === null) {
      this.pendingEnhance = null;
      this.syncAll();
      return;
    }

    // Resolving a target request.
    if (it.kind === 'chooseTarget') {
      const uid = this.pick();
      const leader = uid === null ? this.pickLeader() : null;
      const chosen = uid !== null ? uid : leader !== null ? LEADER_UID(leader) : null;
      if (chosen !== null && it.legal.includes(chosen)) {
        this.commitTargeted(it, [chosen]);
      } else {
        this.cancelInteraction();
      }
      return;
    }

    if (it.kind === 'attackFrom') return;

    const uid = this.pick();
    if (uid === null) return;

    const me = this.game.player(this.human);

    if (me.hand.includes(uid)) {
      this.interaction = { kind: 'dragCard', uid, pointer: { x: e.clientX, y: e.clientY } };
      this.cardFor(uid).setSpeed(26);
      this.audio.play('pick');
      return;
    }

    if (me.field.includes(uid)) {
      const def = this.game.def(uid);
      if (def.type !== 'follower') return;
      // Shift/right-click evolves; a plain drag attacks.
      if (e.button === 2 || e.shiftKey) {
        this.tryEvolve(uid);
        return;
      }
      if (this.game.canAttack(uid, 'leader') || this.anyAttackTarget(uid)) {
        this.interaction = { kind: 'attackFrom', uid, pointer: { x: e.clientX, y: e.clientY } };
        this.highlightAttackTargets(uid, true);
        this.audio.play('pick');
      }
    }
  }

  /** Whether tapping `uid` starts a play, an attack or a target choice. */
  private isActionable(uid: number): boolean {
    if (this.game.state.winner !== null || this.animating) return false;
    if (this.interaction.kind === 'chooseTarget') return true;
    if (this.game.state.active !== this.human) return false;
    const me = this.game.player(this.human);
    if (me.hand.includes(uid)) return true;
    if (!me.field.includes(uid)) return false;
    return this.game.def(uid).type === 'follower';
  }

  private onPointerUp(e: PointerEvent): void {
    this.setPointer(e);
    this.clearHold();
    const it = this.interaction;

    if (it.kind === 'dragCard') {
      const ground = this.groundPoint();
      const def = this.game.def(it.uid);
      const dropped = def.type === 'spell' ? true : ground.z > -1.7 && ground.z < 3.4;
      this.board.showDropSlots(0, false);
      this.cardFor(it.uid).setSpeed(12);

      if (dropped && this.game.canPlay(it.uid)) {
        const slot = this.slotFromX(ground.x);
        // A card with an affordable Enhance asks which cost to pay rather than
        // guessing for the player.
        if (this.game.availableEnhance(it.uid).length > 0) {
          this.interaction = { kind: 'idle' };
          this.pendingEnhance = { uid: it.uid, slot };
          this.syncAll();
        } else {
          this.beginPlay(it.uid, slot);
        }
      } else {
        this.interaction = { kind: 'idle' };
        this.syncAll();
      }
      return;
    }

    if (it.kind === 'attackFrom') {
      const uid = this.pick();
      const leader = uid === null ? this.pickLeader() : null;
      this.effects.clearTargetingRibbon();
      this.highlightAttackTargets(it.uid, false);
      this.interaction = { kind: 'idle' };

      if (leader !== null && leader !== this.human && this.game.canAttack(it.uid, 'leader')) {
        this.apply({ a: 'attack', attacker: it.uid, target: 'leader' });
      } else if (uid !== null && this.game.canAttack(it.uid, uid)) {
        this.apply({ a: 'attack', attacker: it.uid, target: uid });
      } else {
        this.audio.play('deny');
        this.syncAll();
      }
      return;
    }

    void e;
  }

  private slotFromX(x: number): number {
    const count = this.game.player(this.human).field.length;
    const n = Math.min(count + 1, BOARD.SLOTS);
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < n; i++) {
      const d = Math.abs(slotPosition('ally', i, n).x - x);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  /** Starts playing a card, pausing for a target if the card needs one. */
  private beginPlay(uid: number, slot: number, enhance?: number): void {
    const def = this.game.def(uid);
    const mode = enhance !== undefined ? (def.enhance ?? []).find((m) => m.cost === enhance) : undefined;
    const spec = mode ? mode.targeting : def.targeting;
    if (spec) {
      const legal = this.game.legalTargets(spec.selector, this.human, this.game.ent(uid));
      if (legal.length > 0) {
        this.interaction = { kind: 'chooseTarget', uid, slot, legal, from: 'play', enhance };
        this.highlightTargets(legal, true);
        this.hud.addLog('<b>Choose a target</b>');
        return;
      }
    }
    this.interaction = { kind: 'idle' };
    this.apply({ a: 'play', uid, slot, enhance });
  }

  private commitTargeted(it: Extract<Interaction, { kind: 'chooseTarget' }>, targets: number[]): void {
    this.highlightTargets(it.legal, false);
    this.effects.clearTargetingRibbon();
    this.interaction = { kind: 'idle' };
    if (it.from === 'play') this.apply({ a: 'play', uid: it.uid, targets, slot: it.slot, enhance: it.enhance });
    else this.apply({ a: 'evolve', uid: it.uid, targets });
  }

  private tryEvolve(uid: number): void {
    if (!this.game.canEvolve(uid)) {
      this.audio.play('deny');
      return;
    }
    this.apply({ a: 'evolve', uid });
  }

  private highlightTargets(legal: number[], on: boolean): void {
    for (const uid of legal) {
      const lead = leaderOfUid(uid);
      if (lead !== null) {
        this.leaders[lead].setTargetable(on);
        continue;
      }
      this.cards.get(uid)?.setGlow(on ? 0.9 : 0, UI.damage);
    }
  }

  private highlightAttackTargets(attacker: number, on: boolean): void {
    const enemy = other(this.human);
    for (const uid of this.game.player(enemy).field) {
      if (this.game.canAttack(attacker, uid)) this.cards.get(uid)?.setGlow(on ? 0.9 : 0, UI.damage);
    }
    if (this.game.canAttack(attacker, 'leader')) this.leaders[enemy].setTargetable(on);
  }

  private cancelInteraction(): void {
    this.pendingEnhance = null;
    const it = this.interaction;
    if (it.kind === 'chooseTarget') this.highlightTargets(it.legal, false);
    if (it.kind === 'attackFrom') this.highlightAttackTargets(it.uid, false);
    this.effects.clearTargetingRibbon();
    this.board.showDropSlots(0, false);
    this.interaction = { kind: 'idle' };
    this.syncAll();
  }

  private requestEndTurn(): void {
    if (this.game.state.active !== this.human || this.animating) return;
    this.cancelInteraction();
    this.apply({ a: 'endTurn' });
  }

  private concede(): void {
    if (this.game.state.winner !== null) return;
    this.game.state.winner = other(this.human);
    this.game.state.phase = 'over';
    this.queue.length = 0;
    this.audio.play('defeat');
    this.hud.showResult('lose', t('hud.conceded'));
  }

  // -------------------------------------------------------------------------
  // Applying actions and animating events
  // -------------------------------------------------------------------------

  private apply(action: Action): void {
    const ok = this.game.apply(action);
    if (!ok) {
      this.audio.play('deny');
      this.syncAll();
      return;
    }
    this.queue.push(...this.game.drainEvents());
    this.syncAll();
  }

  // -------------------------------------------------------------------------
  // Frame loop
  // -------------------------------------------------------------------------

  private update(dt: number, t: number): void {
    if (this.disposed) return;

    for (const obj of this.cards.values()) obj.update(dt, t);
    this.leaders[0].update(dt, t);
    this.leaders[1].update(dt, t);
    this.board.update(dt);
    this.effects.update(dt);

    this.drainQueue(dt);
    this.refreshAnchors();

    // AI takes its turn once the animation queue is quiet.
    if (
      this.game.state.winner === null &&
      this.game.state.active !== this.human &&
      this.queue.length === 0 &&
      !this.animating
    ) {
      this.aiTimer += dt;
      if (this.aiTimer > 0.55) {
        this.aiTimer = 0;
        const action = chooseAiTurn(this.game, this.game.state.active);
        this.apply(action);
      }
    } else {
      this.aiTimer = 0;
    }
  }

  /**
   * Evolve and Enhance need a visible affordance — they are core actions, not
   * shortcuts. Both are surfaced as buttons pinned over the card they act on.
   */
  private refreshAnchors(): void {
    const g = this.game;
    const buttons: Parameters<Hud['setAnchoredButtons']>[0] = [];

    if (g.state.winner === null && g.state.active === this.human && !this.animating) {
      if (this.pendingEnhance) {
        // Choosing how to play a card the player has already dropped.
        const { uid, slot } = this.pendingEnhance;
        const def = g.def(uid);
        const obj = this.cards.get(uid);
        if (obj) {
          const p = this.toScreen(obj.group.position, 0.9);
          buttons.push({
            id: `play_${uid}`,
            label: t('battle.play', { n: g.costOf(uid) }),
            x: p.x - 78,
            y: p.y,
            onClick: () => {
              this.pendingEnhance = null;
              this.beginPlay(uid, slot);
            },
          });
          for (const cost of g.availableEnhance(uid)) {
            buttons.push({
              id: `enh_${uid}_${cost}`,
              label: t('battle.enhance', { n: cost }),
              x: p.x + 78,
              y: p.y,
              kind: 'enhance',
              onClick: () => {
                this.pendingEnhance = null;
                this.beginPlay(uid, slot, cost);
              },
            });
          }
          void def;
        }
      } else if (this.interaction.kind === 'idle') {
        for (const uid of g.player(this.human).field) {
          if (!g.canEvolve(uid)) continue;
          const obj = this.cards.get(uid);
          if (!obj) continue;
          const p = this.toScreen(obj.group.position, 1.15);
          buttons.push({
            id: `evo_${uid}`,
            label: t('battle.evolve'),
            x: p.x,
            y: p.y,
            onClick: () => this.tryEvolve(uid),
          });
        }
      }
    }

    this.hud.setAnchoredButtons(buttons);
  }

  /** Projects a world point to CSS pixels within the canvas. */
  private toScreen(world: THREE.Vector3, yOffset = 0): { x: number; y: number } {
    const v = world.clone();
    v.y += yOffset;
    v.project(this.stage.camera);
    const rect = this.stage.renderer.domElement.getBoundingClientRect();
    return {
      x: ((v.x + 1) / 2) * rect.width,
      y: ((1 - v.y) / 2) * rect.height,
    };
  }

  /** Plays queued engine events as animations, one beat at a time. */
  private holdUntil = 0;

  private drainQueue(dt: number): void {
    this.holdUntil -= dt;
    if (this.holdUntil > 0) {
      this.animating = true;
      return;
    }
    if (this.queue.length === 0) {
      if (this.animating) {
        this.animating = false;
        this.syncAll();
      }
      return;
    }
    this.animating = true;

    // Consume as many instantaneous events as possible per frame; only events
    // with a visible beat set a hold.
    let guard = 0;
    while (this.queue.length > 0 && this.holdUntil <= 0 && guard++ < 40) {
      const ev = this.queue.shift()!;
      this.holdUntil = this.playEvent(ev);
    }
  }

  /** Returns how long to hold before the next event, in seconds. */
  private playEvent(ev: GameEvent): number {
    const ms = (n: number) => n / 1000;

    switch (ev.t) {
      case 'turnStart':
        this.hud.showTurnBanner(ev.player === this.human);
        this.audio.play(ev.player === this.human ? 'turnMine' : 'turnTheirs');
        this.hud.addLog(`<b>Turn ${ev.turn}</b> — ${ev.player === this.human ? 'you' : 'opponent'}`);
        this.syncAll();
        return ms(TIMING.turnBanner * 0.5);

      case 'draw':
        this.audio.play('draw');
        this.syncAll();
        return ms(ev.player === this.human ? 90 : 60);

      case 'play': {
        const def = this.game.def(ev.uid);
        this.hud.addLog(
          t('battle.played', {
            who: t(ev.player === this.human ? 'battle.you' : 'battle.foe'),
            card: cardName(def),
          }),
        );
        this.audio.play(def.type === 'spell' ? 'spell' : 'play');
        if (def.type === 'spell') {
          const obj = this.cards.get(ev.uid);
          if (obj) this.effects.spellBurst(obj.group.position, CLASS_THEME[def.cardClass].primary);
        }
        return ms(TIMING.play);
      }

      case 'summon': {
        const obj = this.cards.get(ev.uid);
        const def = this.game.def(ev.uid);
        this.syncAll();
        if (obj) {
          // Rise into the slot from just below the board.
          obj.group.position.copy(obj.target.position).add(new THREE.Vector3(0, -0.9, 0.35));
          obj.group.scale.setScalar(0.7);
          this.effects.summonBurst(obj.target.position, CLASS_THEME[def.cardClass].primary);
        }
        this.audio.play('summon');
        return ms(TIMING.summon * 0.5);
      }

      case 'attack': {
        const attacker = this.cards.get(ev.attacker);
        if (attacker) {
          const to =
            typeof ev.defender === 'number'
              ? this.cards.get(ev.defender)?.group.position
              : this.leaders[ev.defender.leader].group.position;
          if (to) this.effects.lunge(attacker, to);
        }
        this.audio.play('attack');
        this.stage.shake(0.05);
        return ms(TIMING.attackLunge);
      }

      case 'damage': {
        const isLeader = typeof ev.target !== 'number';
        const pos = isLeader
          ? this.leaders[(ev.target as { leader: PlayerId }).leader].group.position
          : this.cards.get(ev.target as number)?.group.position;
        if (pos) this.effects.damageNumber(pos, ev.amount, UI.damage);
        if (isLeader) {
          this.stage.shake(0.16);
          this.stage.flashBloom(0.3);
          this.audio.play('hitLeader');
          this.effects.screenFlash(UI.damage, 0.32);
        } else {
          this.stage.shake(0.06);
          this.audio.play('hit');
        }
        this.syncAll();
        return ms(200);
      }

      case 'heal': {
        const isLeader = typeof ev.target !== 'number';
        const pos = isLeader
          ? this.leaders[(ev.target as { leader: PlayerId }).leader].group.position
          : this.cards.get(ev.target as number)?.group.position;
        if (pos) this.effects.damageNumber(pos, ev.amount, UI.heal, '+');
        this.audio.play('heal');
        this.syncAll();
        return ms(160);
      }

      case 'evolve': {
        const obj = this.cards.get(ev.uid);
        if (obj) this.effects.evolveBurst(obj.group.position);
        this.audio.play('evolve');
        this.stage.shake(0.12);
        this.stage.flashBloom(0.85);
        this.syncAll();
        return ms(TIMING.evolve * 0.55);
      }

      case 'destroy': {
        const obj = this.cards.get(ev.uid);
        if (obj) this.effects.dissolve(obj);
        this.audio.play('destroy');
        this.hud.addLog(`<b>${this.defName(ev.defId)}</b> was destroyed`);
        return ms(TIMING.destroy * 0.6);
      }

      case 'banish': {
        const obj = this.cards.get(ev.uid);
        if (obj) this.effects.banish(obj);
        this.audio.play('banish');
        this.hud.addLog(`<b>${this.defName(ev.defId)}</b> was banished`);
        return ms(320);
      }

      case 'ability':
        this.syncAll();
        return ms(120);

      case 'buff':
      case 'grant': {
        const obj = this.cards.get(ev.uid);
        if (obj) this.effects.buffFlash(obj.group.position);
        this.audio.play('buff');
        this.syncAll();
        return ms(140);
      }

      case 'gameOver': {
        const kind = ev.winner === 'draw' ? 'draw' : ev.winner === this.human ? 'win' : 'lose';
        this.audio.play(kind === 'win' ? 'victory' : 'defeat');
        this.hud.showResult(kind, t(kind === 'win' ? 'hud.wonBecause' : 'hud.lostBecause'));
        return ms(400);
      }

      default:
        this.syncAll();
        return 0;
    }
  }

  private defName(defId: string): string {
    return tryGetCard(defId)?.name ?? defId;
  }

  /**
   * Runs both sides with the AI until the given turn, then hands control back.
   * Development aid only — used by the screenshot tooling to reach a mid-game
   * board without playing one by hand.
   */
  fastForward(untilTurn: number): void {
    let guard = 0;
    while (this.game.state.turn < untilTurn && this.game.state.winner === null && guard++ < 600) {
      const action = chooseAiTurn(this.game, this.game.state.active);
      if (!this.game.apply(action)) this.game.apply({ a: 'endTurn' });
    }
    // Both seats were played by the AI to get here, so hand the player's
    // evolution points back — a fast-forwarded board should look like a turn
    // the player is about to take, not one already spent.
    const me = this.game.player(this.human);
    if (this.game.state.turn >= this.game.evolveTurnFor(this.human)) {
      me.ep = this.game.firstPlayer === this.human ? RULES.EP_FIRST : RULES.EP_SECOND;
      me.hasEvolvedThisTurn = false;
    }
    this.game.drainEvents();
    this.queue.length = 0;
    this.holdUntil = 0;
    this.animating = false;
    this.syncAll(true);
  }

  dispose(): void {
    this.disposed = true;
    this.clearHold();
    for (const obj of this.cards.values()) obj.dispose();
    this.cards.clear();
    this.inspector.root.remove();
    this.leaders[0].dispose();
    this.leaders[1].dispose();
    this.hud.dispose();
    this.effects.dispose();
    this.stage.dispose();
    this.opts.onExit?.();
  }
}
