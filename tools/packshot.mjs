#!/usr/bin/env node
/** Screenshots the pack-opening ceremony, sealed and revealed. */
import { chromium } from 'playwright';

const b = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--disable-gpu', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const p = await b.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
const errs = [];
p.on('pageerror', (e) => errs.push(String(e)));
p.on('console', (m) => {
  if (m.type() === 'error') errs.push(m.text());
});

await p.goto('http://127.0.0.1:5173/?screen=pack', { waitUntil: 'networkidle' });
await p.waitForTimeout(1400);
await p.screenshot({ path: 'screenshots/pack-sealed.png' });

// The wrapper animates on hover, which defeats Playwright's actionability
// checks, so dispatch the click directly.
await p.evaluate(() => document.querySelector('.pack-wrapper').click());
await p.waitForTimeout(1500);
await p.evaluate(() => document.querySelector('.pack-actions .sv-btn.primary').click());
await p.waitForTimeout(1600);
await p.screenshot({ path: 'screenshots/pack-open.png' });

await b.close();
if (errs.length) {
  console.log('errors:');
  errs.slice(0, 6).forEach((e) => console.log('  ' + e));
  process.exit(1);
}
console.log('no errors');
