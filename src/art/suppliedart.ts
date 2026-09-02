/**
 * Card images supplied by the user.
 *
 * Official Shadowverse illustrations are unreachable from the build
 * environment, and no free corpus of matching artwork exists to substitute for
 * them (see `ASSET_LICENSES.md`), so every card is drawn by `illustration.ts`.
 * That is the default, not a lock-in: drop an image named after a card id into
 * `public/assets/cards/`, run `npm run art:scan`, and the card uses it instead.
 *
 * Loading is deliberately lazy and non-blocking. A card face is painted
 * synchronously and cached, so an image that has not arrived yet must not stall
 * the paint — the generated illustration is drawn, and `onSuppliedArt` fires
 * when the image lands so the caller can drop its cache and repaint.
 */
import manifest from '../data/generated/suppliedart.json';

const DATA = manifest as {
  dir: string;
  map: Record<string, string>;
  credits: Record<string, { source?: string; author?: string; url?: string; license?: string }>;
};

/** Decoded images, by card id. `null` means "tried, and it failed to load". */
const loaded = new Map<string, HTMLImageElement | null>();
const pending = new Set<string>();
const listeners = new Set<(cardId: string) => void>();

/** Whether the user has supplied an image for this card. */
export function hasSuppliedArt(cardId: string): boolean {
  return cardId in DATA.map;
}

/** How many cards are covered by supplied images. */
export function suppliedArtCount(): number {
  return Object.keys(DATA.map).length;
}

/** The recorded provenance for a supplied image, for the credits screen. */
export function suppliedArtCredit(cardId: string): {
  source?: string;
  author?: string;
  url?: string;
  license?: string;
} | undefined {
  return DATA.credits[cardId];
}

/**
 * The decoded image for a card, or `undefined` if there is none or it has not
 * finished loading. Starts the load on first ask; never throws and never waits.
 */
export function suppliedArtFor(cardId: string): HTMLImageElement | undefined {
  const hit = loaded.get(cardId);
  if (hit !== undefined) return hit ?? undefined;

  const file = DATA.map[cardId];
  if (!file || pending.has(cardId)) return undefined;
  if (typeof Image === 'undefined') return undefined;

  pending.add(cardId);
  const img = new Image();
  img.decoding = 'async';
  img.onload = () => {
    pending.delete(cardId);
    loaded.set(cardId, img);
    for (const fn of listeners) fn(cardId);
  };
  img.onerror = () => {
    // Remembered as a failure so a broken file is not retried on every paint.
    // Listeners are still told, so a caller waiting on this image stops
    // waiting; there is simply nothing new to paint.
    pending.delete(cardId);
    loaded.set(cardId, null);
    for (const fn of listeners) fn(cardId);
  };
  img.src = DATA.dir + encodeURIComponent(file);
  return undefined;
}

/**
 * Registers a callback for when a supplied image finishes loading. The card was
 * already painted with its generated illustration by then, so the caller has to
 * discard that cached face and paint again.
 */
export function onSuppliedArt(fn: (cardId: string) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Starts loading the images for these cards, for a grid about to be painted. */
export function preloadSuppliedArt(cardIds: Iterable<string>): void {
  for (const id of cardIds) suppliedArtFor(id);
}

/**
 * Loads every supplied image, resolving once they have all settled.
 *
 * Card faces are painted synchronously, so an image that arrives after the
 * first paint shows nothing until something repaints. Awaiting this before the
 * first paint is what makes a dropped-in image simply appear. It resolves even
 * if some images fail, and immediately when none are supplied, so an entry
 * point can await it unconditionally.
 */
export async function loadAllSuppliedArt(): Promise<void> {
  const ids = Object.keys(DATA.map);
  if (ids.length === 0 || typeof Image === 'undefined') return;
  await Promise.all(
    ids.map(
      (id) =>
        new Promise<void>((resolve) => {
          if (loaded.has(id)) return resolve();
          const off = onSuppliedArt((who) => {
            if (who !== id) return;
            off();
            resolve();
          });
          suppliedArtFor(id);
          // `suppliedArtFor` may have resolved from cache or failed outright,
          // neither of which notifies.
          if (loaded.has(id)) {
            off();
            resolve();
          }
        }),
    ),
  );
}
