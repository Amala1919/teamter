/**
 * Screen shell.
 *
 * Owns which screen is mounted and the crossfade between them. Screens know
 * nothing about each other; they call back with intent and the shell decides
 * what to show next.
 */
import type { ClassId } from './engine/types';
import { buildStarterDeck } from './data/decks';
import { Battle } from './game/battle';
import { Audio } from './audio/audio';
import { CollectionScreen } from './ui/collection';
import { DeckBuilderScreen } from './ui/deckbuilder';
import { MenuScreen } from './ui/menu';
import { PackOpenOverlay } from './ui/packopen';
import { ensureScreenStyles } from './ui/style';
import { ensureStarterDecks, listDecks, toDeckList, type SavedDeck } from './ui/decks';

interface Screen {
  root: HTMLElement;
  dispose(): void;
}

export class App {
  private current: Screen | null = null;
  private battle: Battle | null = null;
  private readonly audio = new Audio();

  constructor(private readonly container: HTMLElement) {
    ensureScreenStyles();
    ensureStarterDecks();

    // Audio contexts may only start after a gesture.
    const arm = () => {
      this.audio.startMusic();
      window.removeEventListener('pointerdown', arm);
    };
    window.addEventListener('pointerdown', arm);

    // Deep links, used by the screenshot tooling and for quick manual testing.
    const screen = new URLSearchParams(location.search).get('screen');
    if (screen === 'collection') this.showCollection();
    else if (screen === 'pack') {
      this.showMenu();
      this.openPack();
    } else if (screen === 'deck') {
      const first = listDecks()[0];
      if (first) this.showDeckBuilder(first);
      else this.showMenu();
    } else this.showMenu();
  }

  private mount(screen: Screen): void {
    this.current?.dispose();
    this.current = screen;
    this.container.append(screen.root);
    // One frame later, so the entry transition actually runs.
    requestAnimationFrame(() => screen.root.classList.add('in'));
  }

  showMenu(): void {
    this.audio.startMusic();
    this.mount(
      new MenuScreen({
        onPlay: (deck, opponent) => this.startBattle(deck, opponent),
        onEditDeck: (deck) => this.showDeckBuilder(deck),
        onCollection: () => this.showCollection(),
        onOpenPack: () => this.openPack(),
      }),
    );
  }

  /** The pack ceremony sits over whatever screen is showing. */
  openPack(): void {
    new PackOpenOverlay({
      container: this.container,
      set: 'all',
      onClose: () => {},
      onSound: (cue) => {
        this.audio.play(cue === 'legendary' ? 'evolve' : cue === 'open' ? 'spell' : 'draw');
      },
    });
  }

  showCollection(): void {
    this.mount(new CollectionScreen(() => this.showMenu()));
  }

  showDeckBuilder(deck: SavedDeck): void {
    this.mount(new DeckBuilderScreen(deck, () => this.showMenu()));
  }

  startBattle(deck: SavedDeck, opponentClass: ClassId): void {
    this.current?.dispose();
    this.current = null;
    this.audio.stopMusic();

    const host = document.createElement('div');
    host.style.cssText = 'position:absolute;inset:0;';
    this.container.append(host);

    // A seed in the URL makes a match reproducible, which the end-to-end test
    // relies on: a failure it cannot reproduce is not a failure it can fix.
    const pinned = new URLSearchParams(location.search).get('seed');
    const seed = pinned !== null ? Number(pinned) >>> 0 : (Math.random() * 0xffffffff) >>> 0;
    this.battle = new Battle({
      container: host,
      decks: [toDeckList(deck), buildStarterDeck(opponentClass, seed)],
      human: 0,
      seed,
      onExit: () => {
        host.remove();
        this.battle = null;
        this.showMenu();
      },
    });
  }

  /** Leaves a battle in progress and returns to the menu. */
  exitBattle(): void {
    this.battle?.dispose();
  }
}
