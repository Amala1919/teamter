/**
 * The generated asset map and the interface strings.
 *
 * Both are build outputs that nothing else validates: a card with no subject
 * renders a blank silhouette, and a missing string renders its own key. Neither
 * fails loudly at runtime, so they are checked here.
 */
import { describe, expect, it } from 'vitest';
import art from '../src/data/generated/cardart.json';
import cards from '../src/data/generated/cards.json';
import { LANG, STRING_KEYS, t } from '../src/i18n';

const DATA = art as unknown as {
  source: string;
  license: string;
  author: string;
  url: string;
  map: Record<string, string>;
  icons: Record<string, { d: string[]; w: number; h: number }>;
};

const RAW = cards as unknown as { id: string }[];

describe('card art map', () => {
  it('records where the artwork came from and under what licence', () => {
    expect(DATA.source).toBeTruthy();
    expect(DATA.license).toBe('CC BY 3.0');
    expect(DATA.author).toBeTruthy();
    expect(DATA.url).toMatch(/^https:\/\//);
  });

  it('gives every card a subject', () => {
    const missing = RAW.filter((c) => !DATA.map[c.id]).map((c) => c.id);
    expect(missing, `cards with no illustration subject: ${missing.join(', ')}`).toEqual([]);
  });

  it('paints the class banners and leader portraits too', () => {
    for (const cls of ['forest', 'sword', 'rune', 'dragon', 'shadow', 'blood', 'haven', 'neutral']) {
      expect(DATA.map[`banner_${cls}`], `banner_${cls}`).toBeTruthy();
      expect(DATA.map[`leader_${cls}`], `leader_${cls}`).toBeTruthy();
    }
  });

  it('ships path data for every icon it names, and nothing more', () => {
    const referenced = new Set(Object.values(DATA.map));
    for (const name of referenced) {
      const icon = DATA.icons[name];
      expect(icon, `no path data for ${name}`).toBeDefined();
      expect(icon.d.length, name).toBeGreaterThan(0);
      for (const d of icon.d) expect(d.length, name).toBeGreaterThan(4);
      expect(icon.w, name).toBeGreaterThan(0);
      expect(icon.h, name).toBeGreaterThan(0);
    }
    // Unreferenced path data is dead weight in the bundle.
    for (const name of Object.keys(DATA.icons)) {
      expect(referenced.has(name), `${name} is shipped but unused`).toBe(true);
    }
  });
});

describe('interface strings', () => {
  it('has both languages for every key', () => {
    for (const key of STRING_KEYS) {
      const both = t(key);
      expect(both.length, key).toBeGreaterThan(0);
    }
  });

  it('defaults to Japanese', () => {
    // Node has no `location`, which is the same fallback the app uses.
    expect(LANG).toBe('ja');
    expect(t('hud.endTurn')).toBe('ターン終了');
  });

  it('substitutes every placeholder it is given', () => {
    expect(t('hud.turnLine', { n: 4, who: 'x' })).not.toContain('{');
    expect(t('deck.addMore', { n: 3 })).not.toContain('{');
  });
});
