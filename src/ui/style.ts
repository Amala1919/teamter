/**
 * Shared screen chrome.
 *
 * One stylesheet, injected once, for every non-battle screen. Keeping it in a
 * single place is what makes the menu, collection and deck builder read as one
 * product rather than three.
 */
import { FONT, UI } from '../art/theme';

const CSS = `
:root { color-scheme: dark; }

.sv-screen {
  position: absolute; inset: 0;
  display: flex; flex-direction: column;
  font-family: ${FONT.ui};
  color: ${UI.text};
  background:
    radial-gradient(1200px 700px at 50% -10%, rgba(58,44,20,.35), transparent 70%),
    radial-gradient(900px 600px at 90% 110%, rgba(30,40,70,.35), transparent 70%),
    linear-gradient(180deg, ${UI.bg}, ${UI.bgDeep});
  overflow: hidden;
  opacity: 0;
  transform: scale(.994);
  transition: opacity .28s ease, transform .28s cubic-bezier(.2,.8,.2,1);
}
.sv-screen.in { opacity: 1; transform: none; }
.sv-screen * { box-sizing: border-box; }

/* A faint field of drifting motes, so no screen is ever dead flat. */
.sv-screen::before {
  content: ''; position: absolute; inset: -20%;
  background-image:
    radial-gradient(2px 2px at 20% 30%, rgba(255,232,190,.5), transparent),
    radial-gradient(2px 2px at 70% 60%, rgba(255,232,190,.35), transparent),
    radial-gradient(1px 1px at 45% 80%, rgba(190,220,255,.4), transparent),
    radial-gradient(1px 1px at 85% 20%, rgba(255,232,190,.3), transparent),
    radial-gradient(2px 2px at 10% 70%, rgba(190,220,255,.28), transparent);
  animation: sv-drift 42s linear infinite;
  pointer-events: none; opacity: .55;
}
@keyframes sv-drift {
  from { transform: translate3d(0,0,0); }
  to   { transform: translate3d(-6%, -8%, 0); }
}

/* ---- top bar ---------------------------------------------------------- */
.sv-topbar {
  position: relative; z-index: 2;
  display: flex; align-items: center; gap: 18px;
  padding: 14px 22px;
  border-bottom: 1px solid rgba(216,184,101,.22);
  background: linear-gradient(180deg, rgba(8,11,18,.9), rgba(8,11,18,.35));
  backdrop-filter: blur(6px);
}
.sv-title {
  font-family: ${FONT.display}; font-size: 21px; font-weight: 700;
  letter-spacing: .18em; text-transform: uppercase; color: ${UI.goldBright};
  text-shadow: 0 0 22px rgba(216,184,101,.35);
}
.sv-subtitle { font-size: 12px; letter-spacing: .1em; color: ${UI.textDim}; }
.sv-spacer { flex: 1; }

/* ---- buttons ---------------------------------------------------------- */
.sv-btn {
  cursor: pointer; border: none; border-radius: 9px;
  padding: 11px 22px;
  font-family: ${FONT.ui}; font-size: 13px; font-weight: 700;
  letter-spacing: .1em; text-transform: uppercase;
  color: ${UI.textDim};
  background: linear-gradient(180deg, rgba(28,36,52,.95), rgba(14,19,29,.95));
  border: 1px solid rgba(216,184,101,.26);
  transition: color .18s ease, border-color .18s ease, transform .12s ease, box-shadow .18s ease;
}
.sv-btn:hover { color: ${UI.goldBright}; border-color: rgba(216,184,101,.6); box-shadow: 0 0 20px rgba(216,184,101,.16); }
.sv-btn:active { transform: translateY(2px); }
.sv-btn.primary {
  color: #24180A;
  background: linear-gradient(180deg, #FFE9B0, ${UI.gold} 45%, #9A7526);
  border: none;
  box-shadow: 0 5px 0 #5C441A, 0 12px 26px rgba(0,0,0,.55), inset 0 1px 0 rgba(255,255,255,.6);
}
.sv-btn.primary:hover { filter: brightness(1.07); box-shadow: 0 5px 0 #5C441A, 0 14px 30px rgba(0,0,0,.6); }
.sv-btn.primary:active { transform: translateY(4px); box-shadow: 0 1px 0 #5C441A; }
.sv-btn[disabled] { cursor: default; opacity: .4; pointer-events: none; }
.sv-btn.danger:hover { color: #FF9A9A; border-color: rgba(255,90,90,.55); box-shadow: 0 0 20px rgba(255,90,90,.16); }

/* ---- panels ----------------------------------------------------------- */
.sv-panel {
  border-radius: 12px;
  background: linear-gradient(180deg, rgba(17,24,37,.92), rgba(9,13,21,.92));
  border: 1px solid rgba(216,184,101,.22);
  box-shadow: 0 18px 44px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,240,200,.07);
}
.sv-panel-title {
  font-family: ${FONT.display}; font-size: 13px; font-weight: 700;
  letter-spacing: .18em; text-transform: uppercase; color: ${UI.gold};
  padding: 12px 16px; border-bottom: 1px solid rgba(216,184,101,.18);
  display: flex; align-items: center; gap: 10px;
}

/* ---- chips / filters -------------------------------------------------- */
.sv-chiprow { display: flex; flex-wrap: wrap; gap: 7px; align-items: center; }
.sv-chip {
  cursor: pointer; user-select: none;
  padding: 6px 13px; border-radius: 999px;
  font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase;
  color: ${UI.textDim};
  background: rgba(12,17,27,.9);
  border: 1px solid rgba(216,184,101,.2);
  transition: all .16s ease;
}
.sv-chip:hover { color: ${UI.text}; border-color: rgba(216,184,101,.45); }
.sv-chip.on {
  color: #16120A; border-color: transparent;
  background: linear-gradient(180deg, #FFE9B0, ${UI.gold});
  box-shadow: 0 0 16px rgba(216,184,101,.35);
}
.sv-chip[data-class] { border-left: 3px solid var(--chip-color, transparent); }
.sv-chip.on[data-class] {
  background: linear-gradient(180deg, var(--chip-color), color-mix(in srgb, var(--chip-color) 55%, #000));
  color: #0B0E14;
}

/* ---- inputs ----------------------------------------------------------- */
.sv-input {
  padding: 9px 13px; border-radius: 8px; font-family: ${FONT.ui}; font-size: 13px;
  color: ${UI.text}; background: rgba(6,9,15,.9);
  border: 1px solid rgba(216,184,101,.22); outline: none;
  transition: border-color .18s ease;
}
.sv-input:focus { border-color: rgba(216,184,101,.6); }
.sv-input::placeholder { color: ${UI.textDisabled}; }

/* ---- scrollbars ------------------------------------------------------- */
.sv-scroll { overflow-y: auto; scrollbar-width: thin; scrollbar-color: rgba(216,184,101,.4) transparent; }
.sv-scroll::-webkit-scrollbar { width: 9px; }
.sv-scroll::-webkit-scrollbar-track { background: rgba(0,0,0,.25); border-radius: 9px; }
.sv-scroll::-webkit-scrollbar-thumb { background: rgba(216,184,101,.35); border-radius: 9px; }
.sv-scroll::-webkit-scrollbar-thumb:hover { background: rgba(216,184,101,.6); }

/* ---- card grid -------------------------------------------------------- */
.sv-grid {
  display: grid; gap: 14px; padding: 18px 22px 40px;
  grid-template-columns: repeat(auto-fill, minmax(148px, 1fr));
  align-content: start;
}
.sv-cardslot {
  position: relative; aspect-ratio: 512 / 716; cursor: pointer;
  border-radius: 10px;
  transition: transform .16s cubic-bezier(.2,.8,.2,1), filter .16s ease;
}
.sv-cardslot canvas { width: 100%; height: 100%; display: block; border-radius: 10px; }
.sv-cardslot:hover { transform: translateY(-8px) scale(1.045); z-index: 3; filter: drop-shadow(0 16px 26px rgba(0,0,0,.7)); }
.sv-cardslot.dim { filter: grayscale(.7) brightness(.5); }
.sv-cardslot.dim:hover { filter: grayscale(.4) brightness(.7) drop-shadow(0 16px 26px rgba(0,0,0,.7)); }
.sv-cardslot .placeholder {
  position: absolute; inset: 0; border-radius: 10px;
  background: linear-gradient(180deg, rgba(24,31,45,.9), rgba(11,15,23,.9));
  border: 1px solid rgba(216,184,101,.14);
}
.sv-count {
  position: absolute; right: 6px; bottom: 6px; z-index: 2;
  min-width: 30px; padding: 3px 8px; border-radius: 7px;
  font-family: ${FONT.numeral}; font-size: 15px; font-weight: 700; text-align: center;
  color: #1A1408; background: linear-gradient(180deg, #FFE9B0, ${UI.gold});
  box-shadow: 0 3px 10px rgba(0,0,0,.6);
}
.sv-badge {
  position: absolute; left: 6px; top: 6px; z-index: 2;
  padding: 3px 7px; border-radius: 6px;
  font-size: 9px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase;
  color: #FFD2A8; background: rgba(90,30,10,.92); border: 1px solid rgba(255,140,80,.5);
}
.sv-empty {
  padding: 60px 20px; text-align: center; color: ${UI.textDisabled};
  font-size: 14px; letter-spacing: .06em;
}

/* ---- deck list -------------------------------------------------------- */
.sv-deckrow {
  display: flex; align-items: center; gap: 9px;
  padding: 5px 10px; border-radius: 7px; cursor: pointer;
  border-left: 3px solid var(--row-color, transparent);
  background: rgba(255,255,255,.02);
  transition: background .14s ease;
}
.sv-deckrow:hover { background: rgba(216,184,101,.12); }
.sv-deckrow .cost {
  width: 24px; height: 24px; flex: none; border-radius: 50%;
  display: grid; place-items: center;
  font-family: ${FONT.numeral}; font-size: 13px; font-weight: 700; color: #fff;
  background: radial-gradient(circle at 32% 28%, #BFE4FF, ${UI.cost} 45%, ${UI.costDeep});
}
.sv-deckrow .name { flex: 1; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sv-deckrow .n { font-family: ${FONT.numeral}; font-size: 13px; color: ${UI.goldBright}; }

/* ---- cost curve ------------------------------------------------------- */
.sv-curve {
  display: flex; align-items: flex-end; gap: 4px; height: 62px;
  padding: 8px 14px; border-top: 1px solid rgba(216,184,101,.14);
}
.sv-curve .bar { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 3px; }
.sv-curve .fill {
  width: 100%; min-height: 2px; border-radius: 3px 3px 0 0;
  background: linear-gradient(180deg, ${UI.gold}, ${UI.goldDeep});
  transition: height .25s cubic-bezier(.2,.8,.2,1);
}
.sv-curve .lab { font-size: 9px; color: ${UI.textDisabled}; font-family: ${FONT.numeral}; }

/* ---- detail overlay --------------------------------------------------- */
.sv-detail {
  position: absolute; inset: 0; z-index: 20;
  display: none; align-items: center; justify-content: center; gap: 40px;
  padding: 40px;
  background: rgba(3,5,9,.86); backdrop-filter: blur(9px);
}
.sv-detail.open { display: flex; animation: sv-fade .2s ease; }
@keyframes sv-fade { from { opacity: 0 } to { opacity: 1 } }
.sv-detail canvas {
  border-radius: 16px; max-height: 82vh; width: auto;
  filter: drop-shadow(0 26px 60px rgba(0,0,0,.85));
  animation: sv-rise .32s cubic-bezier(.2,.8,.2,1);
}
@keyframes sv-rise { from { opacity: 0; transform: translateY(24px) scale(.96) } to { opacity: 1; transform: none } }
.sv-detail-info { max-width: 360px; display: flex; flex-direction: column; gap: 14px; }
.sv-detail-info h2 {
  margin: 0; font-family: ${FONT.display}; font-size: 30px; font-weight: 700;
  letter-spacing: .05em; color: ${UI.goldBright};
}
.sv-detail-info .meta { font-size: 12px; letter-spacing: .1em; text-transform: uppercase; color: ${UI.textDim}; }
.sv-detail-info .flavor { font-size: 13px; font-style: italic; color: ${UI.textDim}; line-height: 1.6; }
.sv-detail-info .warn {
  font-size: 12px; line-height: 1.6; color: #FFC08A;
  padding: 10px 12px; border-radius: 8px;
  background: rgba(90,40,10,.4); border: 1px solid rgba(255,140,80,.35);
}
`;

let injected = false;

export function ensureScreenStyles(): void {
  if (injected) return;
  const el = document.createElement('style');
  el.id = 'sv-style';
  el.textContent = CSS;
  document.head.appendChild(el);
  injected = true;
}

/** Small helper for building DOM without a framework. */
type ElProps<K extends keyof HTMLElementTagNameMap> = Omit<
  Partial<HTMLElementTagNameMap[K]>,
  'style' | 'className' | 'children'
> & {
  class?: string;
  style?: string;
  /** Stable hooks for the end-to-end test, unaffected by copy or language. */
  [key: `data-${string}`]: string | undefined;
  [key: `on${string}`]: unknown;
};

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: ElProps<K> = {} as ElProps<K>,
  ...children: (Node | string | null | undefined)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null) continue;
    if (k === 'class') node.className = String(v);
    else if (k === 'style') node.setAttribute('style', String(v));
    else if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    } else if (k in node) {
      (node as unknown as Record<string, unknown>)[k] = v;
    } else {
      node.setAttribute(k, String(v));
    }
  }
  for (const c of children) {
    if (c === null || c === undefined) continue;
    node.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}
