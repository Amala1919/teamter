/**
 * Application entry point.
 *
 * Boots the card database, then hands off to the shell that owns screen
 * transitions. Fonts are imported here so every screen shares one set.
 */
import '@fontsource/cinzel/400.css';
import '@fontsource/cinzel/600.css';
import '@fontsource/cinzel/700.css';
import '@fontsource/noto-sans-jp/japanese-400.css';
import '@fontsource/noto-sans-jp/japanese-500.css';
import '@fontsource/noto-sans-jp/japanese-700.css';
import '@fontsource/noto-serif-jp/japanese-700.css';

import { loadCards } from './data/index';
import { buildStarterDeck } from './data/decks';
import { Battle } from './game/battle';
import type { ClassId } from './engine/types';
import { UI } from './art/theme';

const report = loadCards();
if (import.meta.env.DEV) {
  const known = report.total - report.partial.length;
  console.info(
    `[cards] ${report.total} loaded — ${known} fully implemented (${((known / report.total) * 100).toFixed(1)}%)`,
  );
}

document.body.style.cssText = `margin:0;background:${UI.bgDeep};overflow:hidden;`;
const app = document.getElementById('app');
if (!app) throw new Error('#app missing');
app.style.cssText = 'position:fixed;inset:0;overflow:hidden;';

// Debug/deep-link parameters, used by the screenshot tooling and for quick
// manual testing of a specific matchup.
const params = new URLSearchParams(location.search);
const allyClass = (params.get('me') as ClassId) ?? 'sword';
const enemyClass = (params.get('foe') as ClassId) ?? 'shadow';
const seed = Number(params.get('seed') ?? 20170622);

const battle = new Battle({
  container: app,
  decks: [buildStarterDeck(allyClass, seed), buildStarterDeck(enemyClass, seed + 7)],
  human: 0,
  seed,
});

const demoTurn = Number(params.get('demo') ?? 0);
if (demoTurn > 0) battle.fastForward(demoTurn);

// Audio may only start after a gesture, so arm it on the first interaction.
const armAudio = () => {
  battle.audio.startMusic();
  window.removeEventListener('pointerdown', armAudio);
};
window.addEventListener('pointerdown', armAudio);

if (import.meta.env.DEV) {
  (window as unknown as { battle: Battle }).battle = battle;
}
