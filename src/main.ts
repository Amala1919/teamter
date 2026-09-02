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
import { App } from './app';
import type { ClassId } from './engine/types';
import { UI } from './art/theme';
import { loadAllSuppliedArt } from './art/suppliedart';

const report = loadCards();
if (import.meta.env.DEV) {
  const known = report.total - report.partial.length;
  console.info(
    `[cards] ${report.total} loaded — ${known} fully implemented (${((known / report.total) * 100).toFixed(1)}%)`,
  );
}

document.body.style.cssText = `margin:0;background:${UI.bgDeep};overflow:hidden;`;
const root = document.getElementById('app');
if (!root) throw new Error('#app missing');
// Narrowed once here; `boot` runs later, and TypeScript will not carry a
// control-flow narrowing across that gap on its own.
const app: HTMLElement = root;
app.style.cssText = 'position:fixed;inset:0;overflow:hidden;';

const params = new URLSearchParams(location.search);

/**
 * Card faces paint synchronously, so any user-supplied card images have to be
 * decoded before the first screen is built — otherwise a dropped-in image only
 * appears once something happens to repaint that card. Resolves immediately
 * when no images are supplied, which is the default.
 */
void loadAllSuppliedArt().then(boot);

function boot(): void {
  /**
   * `?battle=1` jumps straight into a match, which is how the screenshot tooling
   * and quick manual testing reach a board without going through the menu.
   * `?demo=<turn>` then fast-forwards both sides with the AI.
   */
  if (params.has('battle') || params.has('demo')) {
    const allyClass = (params.get('me') as ClassId) ?? 'sword';
    const enemyClass = (params.get('foe') as ClassId) ?? 'shadow';
    const seed = Number(params.get('seed') ?? 20170622);

    const battle = new Battle({
      container: app,
      decks: [buildStarterDeck(allyClass, seed), buildStarterDeck(enemyClass, seed + 7)],
      human: 0,
      seed,
      // The demo fast-forward needs the match already underway.
      skipMulligan: params.has('demo'),
    });

    const demoTurn = Number(params.get('demo') ?? 0);
    if (demoTurn > 0) battle.fastForward(demoTurn);

    const armAudio = () => {
      battle.audio.startMusic();
      window.removeEventListener('pointerdown', armAudio);
    };
    window.addEventListener('pointerdown', armAudio);

    if (import.meta.env.DEV) (window as unknown as { battle: Battle }).battle = battle;
  } else {
    const shell = new App(app);
    if (import.meta.env.DEV) (window as unknown as { shell: App }).shell = shell;
  }
}
