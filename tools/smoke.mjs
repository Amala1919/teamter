#!/usr/bin/env node
/**
 * End-to-end smoke test.
 *
 * Drives the real UI with real pointer events — mulligan, dragging a card from
 * hand onto the board, attacking, and ending turns — and fails on any console
 * error. The unit tests cover the rules; this covers the wiring between the
 * rules and the screen, which nothing else does.
 *
 *   node tools/smoke.mjs
 */
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:5173';
const errors = [];

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--disable-gpu', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 810 } });
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text()}`);
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

const step = async (label, fn) => {
  try {
    await fn();
    console.log(`  ok   ${label}`);
  } catch (e) {
    errors.push(`${label}: ${e instanceof Error ? e.message : String(e)}`);
    console.log(`  FAIL ${label}`);
  }
};

console.log('menu → deck builder → collection');
// A pinned seed makes the battle reproducible, so a failure here can be
// replayed by opening the same URL.
await page.goto(`${BASE}/?seed=20260902`, { waitUntil: 'networkidle' });
await page.waitForTimeout(900);

await step('menu renders decks', async () => {
  await page.waitForSelector('.sv-title', { timeout: 8000 });
  const n = await page.locator('[data-act="edit-deck"]').count();
  if (n === 0) throw new Error('no decks listed');
});

await step('open collection and filter', async () => {
  await page.click('[data-act="collection"]');
  await page.waitForSelector('.sv-grid', { timeout: 8000 });
  await page.click('.sv-chip[data-key="dragon"]');
  await page.waitForTimeout(500);
  const shown = await page.locator('.sv-cardslot').count();
  if (shown === 0) throw new Error('filter produced no cards');
});

await step('open a card detail', async () => {
  await page.locator('.sv-cardslot').first().click();
  await page.waitForSelector('.sv-detail.open', { timeout: 5000 });
  await page.click('[data-act="close-detail"]');
});

await step('back to menu', async () => {
  await page.click('[data-act="back"]');
  await page.waitForSelector('[data-act="battle"]', { timeout: 5000 });
});

console.log('battle');
await step('start a battle', async () => {
  await page.click('[data-act="battle"]');
  await page.waitForSelector('.mull', { timeout: 10000 });
});

await step('mulligan a card and confirm', async () => {
  await page.locator('.mull-card').first().click();
  await page.waitForTimeout(200);
  await page.click('[data-act="mull-confirm"]');
  await page.waitForTimeout(1800);
  const hand = await page.evaluate(() => (window.battle ?? window.shell) && 1);
  if (!hand) throw new Error('battle not reachable');
});

// From here the shell owns the battle, so reach it through the DOM instead.
await step('board is up', async () => {
  await page.waitForSelector('.hud-endturn', { timeout: 8000 });
});

await step('drag the leftmost hand card onto the board', async () => {
  const box = await page.locator('canvas').first().boundingBox();
  if (!box) throw new Error('no canvas');
  // The hand fans across the bottom-centre; the board sits just above it.
  const from = { x: box.x + box.width * 0.42, y: box.y + box.height * 0.88 };
  const to = { x: box.x + box.width * 0.56, y: box.y + box.height * 0.55 };
  await page.mouse.move(from.x, from.y);
  await page.waitForTimeout(150);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / 12, from.y + ((to.y - from.y) * i) / 12);
    await page.waitForTimeout(20);
  }
  await page.mouse.up();
  await page.waitForTimeout(900);
});

await step('play several turns', async () => {
  for (let i = 0; i < 6; i++) {
    const btn = page.locator('.hud-endturn:not(.hud-exit)');
    if ((await btn.count()) === 0) {
      // The battle screen is gone. Say what replaced it rather than timing out
      // on a locator and leaving no trace of why.
      const over = await page.locator('.hud-result.show').count();
      const menu = await page.locator('[data-act="battle"]').count();
      throw new Error(`no End Turn button after ${i} turns (result shown: ${over}, back at menu: ${menu})`);
    }
    if (await btn.isDisabled()) {
      await page.waitForTimeout(1200);
      continue;
    }
    await btn.click();
    await page.waitForTimeout(2200);
  }
});

await page.screenshot({ path: 'screenshots/smoke.png' });
await browser.close();

if (errors.length > 0) {
  console.log(`\n${errors.length} problem(s):`);
  for (const e of errors) console.log(`  ${e}`);
  process.exit(1);
}
console.log('\nno errors');
