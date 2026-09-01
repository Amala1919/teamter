/**
 * Development gallery: renders a grid of card faces so the art pipeline can be
 * eyeballed and screenshotted without booting the game.
 *
 * `?ids=a,b,c` renders specific cards; `?class=dragon` filters by class;
 * `?n=24` limits the count. Used by tools/shoot.mjs for visual QA.
 */
import '@fontsource/cinzel/400.css';
import '@fontsource/cinzel/600.css';
import '@fontsource/cinzel/700.css';
import '@fontsource/noto-sans-jp/japanese-400.css';
import '@fontsource/noto-sans-jp/japanese-700.css';
import '@fontsource/noto-serif-jp/japanese-700.css';
import { loadCards, builtCards } from './data/index';
import { cardFaceCanvas } from './art/cardface';
import { UI } from './art/theme';
import type { CardDef } from './engine/types';

loadCards();

const params = new URLSearchParams(location.search);
const all = builtCards().filter((c) => !c.token);

let cards: CardDef[];
const ids = params.get('ids');
if (ids) {
  const want = ids.split(',');
  cards = want.map((id) => all.find((c) => c.id === id)).filter((c): c is CardDef => !!c);
} else {
  const cls = params.get('class');
  cards = all.filter((c) => !cls || c.cardClass === cls);
  const n = Number(params.get('n') ?? 18);
  // Spread the sample across rarities and types rather than taking a prefix.
  const step = Math.max(1, Math.floor(cards.length / n));
  cards = cards.filter((_, i) => i % step === 0).slice(0, n);
}

const evolved = params.get('evolved') === '1';
const premium = params.get('premium') === '1';
const lang = (params.get('lang') as 'en' | 'ja') ?? 'en';
const scale = Number(params.get('scale') ?? 0.62);

document.body.style.cssText = `margin:0;background:${UI.bgDeep};min-height:100vh;`;
const app = document.getElementById('app')!;
app.style.cssText =
  'display:flex;flex-wrap:wrap;gap:22px;padding:26px;justify-content:center;align-items:flex-start;';

async function render(): Promise<void> {
  await document.fonts.ready;
  for (const card of cards) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:relative;filter:drop-shadow(0 12px 24px rgba(0,0,0,.7));';
    const canvas = cardFaceCanvas(card, {
      scale,
      evolved: evolved && card.type === 'follower',
      premium,
      lang,
    });
    canvas.style.cssText = 'display:block;';
    wrap.appendChild(canvas);
    app.appendChild(wrap);
  }
  document.body.dataset.ready = '1';
}

void render();
