/**
 * Battle HUD.
 *
 * The heads-up layer is DOM rather than WebGL: text stays crisp at any device
 * pixel ratio, and hit-testing buttons is the browser's problem rather than
 * ours. It sits above the canvas and only forwards the events it owns.
 */
import { CLASS_THEME, FONT, UI } from '../art/theme';
import type { ClassId, PlayerId } from '../engine/types';

export interface HudCallbacks {
  onEndTurn: () => void;
  onSurrender?: () => void;
  onToggleLog?: () => void;
}

const CSS = `
.hud {
  position: absolute; inset: 0; pointer-events: none;
  font-family: ${FONT.ui};
  color: ${UI.text};
  user-select: none; -webkit-user-select: none;
}
.hud * { box-sizing: border-box; }
.hud-pp {
  position: absolute; right: 20px; bottom: 108px;
  display: flex; gap: 5px; align-items: center;
  padding: 8px 14px; border-radius: 999px;
  background: linear-gradient(180deg, rgba(12,17,28,.92), rgba(6,9,15,.92));
  border: 1px solid rgba(216,184,101,.42);
  box-shadow: 0 6px 22px rgba(0,0,0,.6), inset 0 1px 0 rgba(255,240,200,.14);
}
.hud-orb {
  width: 16px; height: 16px; border-radius: 50%;
  background: radial-gradient(circle at 32% 28%, #1C2A44, #0A1120);
  border: 1px solid rgba(140,180,240,.28);
  transition: background .22s ease, box-shadow .22s ease, transform .22s ease;
}
.hud-orb.filled {
  background: radial-gradient(circle at 32% 28%, #CFE9FF, ${UI.cost} 42%, ${UI.costDeep});
  box-shadow: 0 0 10px rgba(111,184,255,.75), inset 0 -2px 4px rgba(0,0,0,.4);
}
.hud-orb.spent { background: radial-gradient(circle at 32% 28%, #2A3550, #10182A); }
.hud-pp-count {
  margin-left: 10px; font-weight: 700; font-size: 19px;
  color: ${UI.goldBright}; letter-spacing: .02em; min-width: 54px; text-align: right;
  font-family: ${FONT.numeral};
}
.hud-ep {
  position: absolute; right: 20px; bottom: 156px;
  display: flex; gap: 6px; align-items: center;
  padding: 6px 13px; border-radius: 999px;
  background: linear-gradient(180deg, rgba(30,14,10,.92), rgba(12,6,4,.92));
  border: 1px solid rgba(255,138,61,.45);
  box-shadow: 0 6px 18px rgba(0,0,0,.55);
  font-size: 12px; letter-spacing: .1em; text-transform: uppercase; color: #FFC08A;
}
.hud-ep-pip {
  width: 13px; height: 13px;
  background: radial-gradient(circle at 32% 28%, #FFE0B8, #FF6A2A 45%, #6A1E06);
  clip-path: polygon(50% 0, 100% 50%, 50% 100%, 0 50%);
  box-shadow: 0 0 8px rgba(255,120,50,.8);
}
.hud-ep-pip.empty { background: #2A1A14; box-shadow: none; }
.hud-endturn {
  position: absolute; right: 22px; bottom: 22px;
  pointer-events: auto; cursor: pointer;
  min-width: 168px; padding: 15px 26px;
  border: none; border-radius: 10px;
  font-family: ${FONT.display}; font-size: 18px; font-weight: 700;
  letter-spacing: .1em; text-transform: uppercase;
  color: #24180A;
  background: linear-gradient(180deg, #FFE9B0, ${UI.gold} 45%, #9A7526);
  box-shadow: 0 6px 0 #5C441A, 0 12px 26px rgba(0,0,0,.6), inset 0 1px 0 rgba(255,255,255,.6);
  transition: transform .12s ease, box-shadow .12s ease, filter .2s ease;
}
.hud-endturn:hover { filter: brightness(1.08); }
.hud-endturn:active { transform: translateY(4px); box-shadow: 0 2px 0 #5C441A, 0 6px 14px rgba(0,0,0,.6); }
.hud-endturn[disabled] {
  cursor: default; filter: none; color: #6B7386;
  background: linear-gradient(180deg, #2A3244, #171D29);
  box-shadow: 0 4px 0 #0D111A, inset 0 1px 0 rgba(255,255,255,.06);
}
.hud-endturn.waiting {
  background: linear-gradient(180deg, #3A4560, #1E2636);
  color: #A6AFBF; box-shadow: 0 4px 0 #0D111A;
}
.hud-deck {
  position: absolute; display: flex; align-items: center; gap: 7px;
  padding: 5px 11px; border-radius: 8px;
  background: rgba(8,11,18,.85); border: 1px solid rgba(216,184,101,.3);
  font-size: 13px; font-weight: 600; color: ${UI.textDim};
}
.hud-deck .n { color: ${UI.goldBright}; font-family: ${FONT.numeral}; font-size: 16px; }
.hud-deck.ally { right: 20px; bottom: 200px; }
.hud-deck.enemy { right: 20px; top: 20px; }
.hud-banner {
  position: absolute; left: 0; right: 0; top: 40%;
  text-align: center; opacity: 0; pointer-events: none;
}
.hud-banner .plate {
  display: inline-block; padding: 16px 74px;
  font-family: ${FONT.display}; font-size: 40px; font-weight: 700;
  letter-spacing: .22em; text-transform: uppercase;
  color: ${UI.goldBright};
  text-shadow: 0 3px 16px rgba(0,0,0,.9), 0 0 30px rgba(216,184,101,.5);
  background: linear-gradient(90deg, rgba(8,11,18,0), rgba(8,11,18,.92) 18%, rgba(8,11,18,.92) 82%, rgba(8,11,18,0));
  border-top: 1px solid rgba(216,184,101,.6);
  border-bottom: 1px solid rgba(216,184,101,.6);
}
.hud-banner.enemy .plate { color: #B9C3D0; border-color: rgba(150,170,200,.5); }
@keyframes hud-banner-in {
  0%   { opacity: 0; transform: translateX(-38px) scaleX(.9); }
  18%  { opacity: 1; transform: translateX(0) scaleX(1); }
  78%  { opacity: 1; transform: translateX(0) scaleX(1); }
  100% { opacity: 0; transform: translateX(38px) scaleX(.9); }
}
.hud-banner.show { animation: hud-banner-in 1.4s cubic-bezier(.2,.8,.2,1) forwards; }
.hud-topbar {
  position: absolute; left: 18px; top: 14px;
  display: flex; gap: 10px; align-items: center;
}
.hud-chip {
  pointer-events: auto; cursor: pointer;
  padding: 7px 15px; border-radius: 8px; font-size: 12px; font-weight: 600;
  letter-spacing: .08em; text-transform: uppercase;
  color: ${UI.textDim}; background: rgba(8,11,18,.8);
  border: 1px solid rgba(216,184,101,.28);
  transition: color .18s ease, border-color .18s ease;
}
.hud-chip:hover { color: ${UI.goldBright}; border-color: rgba(216,184,101,.6); }
.hud-turn {
  position: absolute; left: 50%; bottom: 14px; transform: translateX(-50%);
  font-size: 12px; letter-spacing: .16em; text-transform: uppercase; color: ${UI.textDim};
}
.hud-log {
  position: absolute; left: 18px; top: 58px; width: 268px; max-height: 46%;
  overflow: hidden; display: none; flex-direction: column-reverse; gap: 4px;
  padding: 12px; border-radius: 10px;
  background: rgba(6,9,15,.88); border: 1px solid rgba(216,184,101,.24);
  font-size: 12px; line-height: 1.5; color: ${UI.textDim};
}
.hud-log.open { display: flex; }
.hud-log b { color: ${UI.goldBright}; font-weight: 600; }
.hud-result {
  position: absolute; inset: 0; display: none;
  align-items: center; justify-content: center; flex-direction: column; gap: 22px;
  background: radial-gradient(circle at 50% 45%, rgba(10,14,22,.7), rgba(2,3,6,.95));
  pointer-events: auto;
}
.hud-result.show { display: flex; }
.hud-result h1 {
  margin: 0; font-family: ${FONT.display}; font-size: 76px; font-weight: 700;
  letter-spacing: .2em; text-transform: uppercase;
}
.hud-result.win h1 { color: ${UI.goldBright}; text-shadow: 0 0 46px rgba(216,184,101,.75); }
.hud-result.lose h1 { color: #8794AB; text-shadow: 0 0 40px rgba(80,100,140,.6); }
.hud-result p { margin: 0; color: ${UI.textDim}; letter-spacing: .1em; }
`;

export class Hud {
  readonly root: HTMLDivElement;
  private readonly ppOrbs: HTMLDivElement[] = [];
  private readonly ppCount: HTMLDivElement;
  private readonly epRow: HTMLDivElement;
  private readonly endTurn: HTMLButtonElement;
  private readonly banner: HTMLDivElement;
  private readonly turnLabel: HTMLDivElement;
  private readonly deckAlly: HTMLDivElement;
  private readonly deckEnemy: HTMLDivElement;
  private readonly log: HTMLDivElement;
  private readonly result: HTMLDivElement;

  constructor(container: HTMLElement, private readonly cb: HudCallbacks) {
    if (!document.getElementById('hud-style')) {
      const style = document.createElement('style');
      style.id = 'hud-style';
      style.textContent = CSS;
      document.head.appendChild(style);
    }

    this.root = document.createElement('div');
    this.root.className = 'hud';

    // Play points.
    const pp = document.createElement('div');
    pp.className = 'hud-pp';
    for (let i = 0; i < 10; i++) {
      const orb = document.createElement('div');
      orb.className = 'hud-orb';
      pp.appendChild(orb);
      this.ppOrbs.push(orb);
    }
    this.ppCount = document.createElement('div');
    this.ppCount.className = 'hud-pp-count';
    pp.appendChild(this.ppCount);
    this.root.appendChild(pp);

    // Evolution points.
    this.epRow = document.createElement('div');
    this.epRow.className = 'hud-ep';
    this.root.appendChild(this.epRow);

    // End turn.
    this.endTurn = document.createElement('button');
    this.endTurn.className = 'hud-endturn';
    this.endTurn.textContent = 'End Turn';
    this.endTurn.addEventListener('click', () => this.cb.onEndTurn());
    this.root.appendChild(this.endTurn);

    // Deck counters.
    this.deckAlly = document.createElement('div');
    this.deckAlly.className = 'hud-deck ally';
    this.deckEnemy = document.createElement('div');
    this.deckEnemy.className = 'hud-deck enemy';
    this.root.appendChild(this.deckAlly);
    this.root.appendChild(this.deckEnemy);

    // Turn banner.
    this.banner = document.createElement('div');
    this.banner.className = 'hud-banner';
    this.banner.innerHTML = '<div class="plate"></div>';
    this.root.appendChild(this.banner);

    this.turnLabel = document.createElement('div');
    this.turnLabel.className = 'hud-turn';
    this.root.appendChild(this.turnLabel);

    // Log.
    this.log = document.createElement('div');
    this.log.className = 'hud-log';
    this.root.appendChild(this.log);

    const bar = document.createElement('div');
    bar.className = 'hud-topbar';
  
    const logChip = document.createElement('button');
    logChip.className = 'hud-chip';
    logChip.textContent = 'Log';
    logChip.addEventListener('click', () => {
      this.log.classList.toggle('open');
      this.cb.onToggleLog?.();
    });
    bar.appendChild(logChip);
    if (this.cb.onSurrender) {
      const s = document.createElement('button');
      s.className = 'hud-chip';
      s.textContent = 'Concede';
      s.addEventListener('click', () => this.cb.onSurrender?.());
      bar.appendChild(s);
    }
    this.root.appendChild(bar);

    // Result overlay.
    this.result = document.createElement('div');
    this.result.className = 'hud-result';
    this.result.innerHTML = '<h1></h1><p></p>';
    this.root.appendChild(this.result);

    container.appendChild(this.root);
  }

  setPlayPoints(pp: number, maxPp: number): void {
    this.ppOrbs.forEach((orb, i) => {
      orb.className = 'hud-orb';
      if (i < pp) orb.classList.add('filled');
      else if (i < maxPp) orb.classList.add('spent');
    });
    this.ppCount.textContent = `${pp} / ${maxPp}`;
  }

  setEvolutionPoints(ep: number, total: number, usable: boolean): void {
    this.epRow.replaceChildren();
    const label = document.createElement('span');
    label.textContent = 'EP';
    this.epRow.appendChild(label);
    for (let i = 0; i < Math.max(total, ep); i++) {
      const pip = document.createElement('div');
      pip.className = 'hud-ep-pip' + (i < ep ? '' : ' empty');
      this.epRow.appendChild(pip);
    }
    this.epRow.style.display = total > 0 || ep > 0 ? 'flex' : 'none';
    this.epRow.style.opacity = usable ? '1' : '0.5';
  }

  setDeckCounts(ally: number, enemy: number, allyHand: number, enemyHand: number): void {
    this.deckAlly.innerHTML = `Deck <span class="n">${ally}</span> · Hand <span class="n">${allyHand}</span>`;
    this.deckEnemy.innerHTML = `Deck <span class="n">${enemy}</span> · Hand <span class="n">${enemyHand}</span>`;
  }

  setTurn(turn: number, mine: boolean): void {
    this.turnLabel.textContent = `Turn ${turn} — ${mine ? 'your move' : 'opponent'}`;
    this.endTurn.disabled = !mine;
    this.endTurn.classList.toggle('waiting', !mine);
    this.endTurn.textContent = mine ? 'End Turn' : 'Opponent…';
  }

  /** Sweeping "Your Turn" / "Opponent's Turn" plate. */
  showTurnBanner(mine: boolean): void {
    const plate = this.banner.querySelector('.plate') as HTMLElement;
    plate.textContent = mine ? 'Your Turn' : "Opponent's Turn";
    this.banner.classList.toggle('enemy', !mine);
    this.banner.classList.remove('show');
    // Force a reflow so the animation restarts even on consecutive turns.
    void this.banner.offsetWidth;
    this.banner.classList.add('show');
  }

  addLog(html: string): void {
    const line = document.createElement('div');
    line.innerHTML = html;
    this.log.prepend(line);
    while (this.log.children.length > 60) this.log.lastChild?.remove();
  }

  showResult(kind: 'win' | 'lose' | 'draw', subtitle: string): void {
    this.result.className = `hud-result show ${kind === 'draw' ? 'lose' : kind}`;
    const h1 = this.result.querySelector('h1')!;
    const p = this.result.querySelector('p')!;
    h1.textContent = kind === 'win' ? 'Victory' : kind === 'lose' ? 'Defeat' : 'Draw';
    p.textContent = subtitle;
  }

  hideResult(): void {
    this.result.className = 'hud-result';
  }

  /** Tints the HUD to the player's class, tying it to the board. */
  applyClassTheme(cls: ClassId, _side: PlayerId): void {
    const theme = CLASS_THEME[cls];
    this.root.style.setProperty('--class-primary', theme.primary);
    this.root.style.setProperty('--class-accent', theme.accent);
  }

  dispose(): void {
    this.root.remove();
  }
}
