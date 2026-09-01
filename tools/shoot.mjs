#!/usr/bin/env node
/**
 * Screenshots a page from the dev server for visual review.
 *
 *   node tools/shoot.mjs <path> <out.png> [width] [height] [waitMs]
 *
 * Assumes `npm run dev` is already serving on 127.0.0.1:5173.
 */
import { chromium } from 'playwright';

const [, , path = '/', out = 'screenshots/shot.png', w = '1600', h = '1000', wait = '1200'] =
  process.argv;

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--disable-gpu', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({
  viewport: { width: Number(w), height: Number(h) },
  deviceScaleFactor: 2,
});

const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(`http://127.0.0.1:5173${path}`, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(Number(wait));
await page.screenshot({ path: out, fullPage: path.startsWith('/gallery') });
await browser.close();

if (errors.length) {
  console.log('page errors:');
  for (const e of errors.slice(0, 10)) console.log('  ' + e);
}
console.log(`wrote ${out}`);
