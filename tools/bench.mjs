#!/usr/bin/env node
/**
 * Measures what a card face costs to paint, in the browser, at the three sizes
 * that matter: the collection grid, the board, and the inspector.
 *
 *   node tools/bench.mjs [samples]
 *
 * Assumes `npm run dev` is already serving on 127.0.0.1:5173. Cards are chosen
 * deterministically across the pool so a run is comparable to the last one.
 *
 * Read p50 and p95. `max` is a garbage-collection pause: this hammers a
 * hundred-odd distinct cards back to back with no idle time, which the app
 * never does — it paints from a rAF queue behind an IntersectionObserver. The
 * pause lands at the same sample every run because the workload is
 * deterministic, which makes it look card-specific when it is not.
 */
import { chromium } from 'playwright';

const samples = Number(process.argv[2] ?? 120);

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--disable-gpu', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
page.on('pageerror', (e) => console.error('page error:', String(e)));

await page.goto('http://127.0.0.1:5173/gallery.html?ids=goblin', { waitUntil: 'networkidle' });

const result = await page.evaluate(async (n) => {
  // Real card faces are painted after the fonts are up; measure that state.
  await document.fonts.ready;
  const face = await import('/src/art/cardface.ts');
  const theme = await import('/src/art/theme.ts');
  const data = await import('/src/data/index.ts');
  const CARD = theme.CARD;
  data.loadCards();
  const cards = data.builtCards();

  const run = (scale) => {
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(CARD.W * scale);
    canvas.height = Math.ceil(CARD.H * scale);
    const ctx = canvas.getContext('2d');
    // A fresh canvas's first paint pays one-time surface and font setup that
    // has nothing to do with the card, so each canvas is warmed on itself.
    for (let i = 0; i < 5; i++) face.drawCardFace(ctx, cards[i], { scale });
    const rows = [];
    for (let i = 0; i < n; i++) {
      // Spread deterministically across the pool rather than taking a run of
      // adjacent (and similar) cards.
      const card = cards[Math.floor((i * 9973) % cards.length)];
      const t0 = performance.now();
      face.drawCardFace(ctx, card, { scale });
      rows.push([performance.now() - t0, card.id]);
    }
    const slowest = [...rows].sort((a, b) => b[0] - a[0]).slice(0, 5);
    const times = rows.map((r) => r[0]).sort((a, b) => a - b);
    return {
      slowest,
      mean: times.reduce((s, t) => s + t, 0) / times.length,
      p50: times[Math.floor(times.length * 0.5)],
      p95: times[Math.floor(times.length * 0.95)],
      max: times[times.length - 1],
    };
  };

  // Name fitting on its own: every card name, at the band the grid uses. This
  // one is stable, because it does no canvas painting for GC to interrupt.
  const name = await import('/src/art/cardname.ts');
  const fitAll = () => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const band = { x: 0, y: 0, w: 300, h: 54 };
    const t0 = performance.now();
    for (const c of cards) {
      name.fitName(ctx, c.nameJa ?? c.name, band, name.JA_NAME_STYLE);
      name.fitName(ctx, c.name, band, name.DEFAULT_NAME_STYLE);
    }
    return performance.now() - t0;
  };
  fitAll();
  const names = Math.min(fitAll(), fitAll(), fitAll());

  // One warm pass so JIT and font work does not land in the numbers.
  run(0.34);
  return { grid: run(0.34), board: run(0.55), detail: run(1), names, cards: cards.length, fonts: document.fonts.status };
}, samples);

await browser.close();

const fmt = (r) =>
  `mean ${r.mean.toFixed(1)}ms  p50 ${r.p50.toFixed(1)}ms  p95 ${r.p95.toFixed(1)}ms  max ${r.max.toFixed(1)}ms` +
  `\n                slowest: ${r.slowest.map(([t, id]) => `${id} ${t.toFixed(0)}ms`).join(', ')}`;
console.log(`samples ${samples}  fonts ${result.fonts}`);
console.log(`grid   (0.34x)  ${fmt(result.grid)}`);
console.log(`board  (0.55x)  ${fmt(result.board)}`);
console.log(`detail (1.00x)  ${fmt(result.detail)}`);
console.log(
  `name fitting    ${result.names.toFixed(0)}ms for ${result.cards} cards x2 languages ` +
    `(${((result.names / (result.cards * 2)) * 1000).toFixed(0)}us each)`,
);
