/**
 * Opponent AI.
 *
 * The AI returns one action at a time rather than a whole turn, so the battle
 * screen can animate between its decisions exactly as it does for the player.
 * It plays a greedy but sensible game: develop the board on curve, trade
 * favourably, evolve when evolving wins a trade, and go face when lethal is on.
 *
 * It reads the same public `Game` API the player's UI uses — it has no special
 * access, so it can never do something a player could not.
 */
import type { Action, Game } from '../engine/game';
import type { PlayerId } from '../engine/types';
import { LEADER_UID, leaderOfUid, other } from '../engine/types';

interface ScoredAction {
  action: Action;
  score: number;
}

/** How much a follower on the board is worth, roughly. */
function bodyValue(atk: number, def: number): number {
  return atk * 1.15 + def * 0.95;
}

export function chooseAiTurn(game: Game, me: PlayerId): Action {
  const foe = other(me);
  const ps = game.player(me);
  const fs = game.player(foe);

  // ---- 1. Lethal check -----------------------------------------------------
  // If the total damage available to the face is enough, swing everything.
  const wards = game.wardsOf(foe);
  if (wards.length === 0) {
    let reach = 0;
    for (const uid of ps.field) {
      if (game.canAttack(uid, 'leader')) reach += game.stats(uid).atk;
    }
    if (reach >= fs.defense) {
      for (const uid of ps.field) {
        if (game.canAttack(uid, 'leader')) return { a: 'attack', attacker: uid, target: 'leader' };
      }
    }
  }

  // ---- 2. Play a card ------------------------------------------------------
  const plays: ScoredAction[] = [];
  for (const uid of ps.hand) {
    if (!game.canPlay(uid, me)) continue;
    const def = game.def(uid);
    const cost = game.costOf(uid);

    let score = 6 + cost * 2.2;

    if (def.type === 'follower') {
      score += bodyValue(def.atk ?? 0, def.def ?? 0) * 0.9;
      const kws = def.keywords ?? [];
      if (kws.includes('ward')) score += 3;
      if (kws.includes('storm')) score += 3.5;
      if (kws.includes('rush')) score += 2;
      if (kws.includes('bane')) score += 2;
      // Board presence matters more when behind.
      if (ps.field.length < fs.field.length) score += 4;
    } else if (def.type === 'spell') {
      // Only cast a targeted spell when there is something worth hitting.
      const spec = def.targeting;
      if (spec) {
        const legal = game.legalTargets(spec.selector, me, game.ent(uid));
        const enemyTargets = legal.filter((t) => {
          const lead = leaderOfUid(t);
          if (lead !== null) return lead === foe;
          const e = game.state.entities.get(t);
          return !!e && e.owner === foe;
        });
        if (enemyTargets.length === 0 && (spec.selector.side ?? 'both') === 'enemy') continue;
        score += 4;
      } else {
        score += 3;
      }
    } else {
      score += 3.5;
    }

    // Prefer spending the turn's play points efficiently.
    score += cost === ps.pp ? 3 : 0;

    const action = buildPlayAction(game, me, uid);
    if (action) plays.push({ action, score });
  }

  plays.sort((a, b) => b.score - a.score);
  if (plays.length > 0 && plays[0].score > 0) return plays[0].action;

  // ---- 3. Evolve -----------------------------------------------------------
  if (ps.ep > 0 && !ps.hasEvolvedThisTurn && game.state.turn >= game.evolveTurnFor(me)) {
    let best: { uid: number; score: number } | null = null;
    for (const uid of ps.field) {
      if (!game.canEvolve(uid, me)) continue;
      const st = game.stats(uid);
      const evoAtk = st.atk + 2;
      let score = 1;
      // Evolving is worth most when it lets a follower kill something it
      // otherwise could not, or survive a trade it otherwise would not.
      for (const t of fs.field) {
        const ts = game.stats(t);
        const killsNow = st.atk >= ts.def;
        const killsEvolved = evoAtk >= ts.def;
        const survives = st.maxDef + 2 - (game.ent(uid).damage + ts.atk) > 0;
        if (!killsNow && killsEvolved) score += 6 + ts.atk;
        if (survives && st.def <= ts.atk) score += 4;
      }
      // A fresh follower gains a whole attack from evolving.
      if (game.ent(uid).enteredTurn === game.state.turn && fs.field.length > 0) score += 3;
      if (!best || score > best.score) best = { uid, score };
    }
    if (best && best.score >= 4) return { a: 'evolve', uid: best.uid };
  }

  // ---- 4. Attack -----------------------------------------------------------
  const attacks: ScoredAction[] = [];
  for (const uid of ps.field) {
    const st = game.stats(uid);
    if (st.atk <= 0) continue;

    if (game.canAttack(uid, 'leader')) {
      // Going face is the default when the board is safe.
      const pressure = fs.defense <= st.atk ? 100 : 4 + st.atk * 1.1;
      attacks.push({ action: { a: 'attack', attacker: uid, target: 'leader' }, score: pressure });
    }

    for (const t of fs.field) {
      if (!game.canAttack(uid, t)) continue;
      const ts = game.stats(t);
      const kills = st.atk >= ts.def || st.keywords.has('bane');
      const dies = ts.atk >= st.def && !st.keywords.has('bane');
      let score = 2;
      if (kills) score += bodyValue(ts.atk, ts.maxDef);
      if (dies) score -= bodyValue(st.atk, st.maxDef) * 0.85;
      // Clearing a Ward is worth extra because it unblocks everything else.
      if (ts.keywords.has('ward') && kills) score += 4;
      // A one-sided trade is always worth taking.
      if (kills && !dies) score += 5;
      attacks.push({ action: { a: 'attack', attacker: uid, target: t }, score });
    }
  }

  attacks.sort((a, b) => b.score - a.score);
  if (attacks.length > 0 && attacks[0].score > 1) return attacks[0].action;

  return { a: 'endTurn' };
}

/** Fills in targets and a board slot for a card the AI has decided to play. */
function buildPlayAction(game: Game, me: PlayerId, uid: number): Action | null {
  const def = game.def(uid);
  const foe = other(me);
  const targets: number[] = [];

  const spec = def.targeting;
  if (spec) {
    const legal = game.legalTargets(spec.selector, me, game.ent(uid));
    if (legal.length === 0) {
      if (!spec.optional) return null;
    } else {
      const side = spec.selector.side ?? 'both';
      // Damage and destruction go at the enemy; buffs go at our own best body.
      const preferEnemy = side === 'enemy' || side === 'both';
      const scored = legal
        .map((t) => {
          const lead = leaderOfUid(t);
          if (lead !== null) {
            return { t, score: lead === foe ? (preferEnemy ? 5 : -100) : -100 };
          }
          const e = game.state.entities.get(t);
          if (!e) return { t, score: -100 };
          const st = game.stats(e);
          const enemyOwned = e.owner === foe;
          const value = bodyValue(st.atk, st.def);
          return { t, score: enemyOwned === preferEnemy ? value : -value };
        })
        .sort((a, b) => b.score - a.score);
      if (scored[0] && scored[0].score > -50) targets.push(scored[0].t);
      else if (!spec.optional) return null;
    }
  }

  // Ward followers go on the outside so they cover the row visually; anything
  // else takes the rightmost slot.
  const slot = (def.keywords ?? []).includes('ward') ? 0 : game.player(me).field.length;
  return { a: 'play', uid, targets, slot };
}

/** Mulligan policy: keep cheap cards, throw back anything above 4 play points. */
export function chooseAiMulligan(game: Game, me: PlayerId): number[] {
  return game.player(me).hand.filter((uid) => game.def(uid).cost > 4);
}

void LEADER_UID;
