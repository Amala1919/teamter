import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox','--disable-gpu','--use-gl=swiftshader','--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1440, height: 810 } });
p.on('console', (m) => console.log(m.type().toUpperCase(), m.text()));
p.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await p.goto('http://127.0.0.1:5173/?battle=1&me=dragon&foe=forest', { waitUntil: 'networkidle' });
await p.waitForTimeout(1200);
await p.click('[data-act="mull-confirm"]').catch(() => console.log('no mulligan'));
await p.waitForTimeout(2000);
for (let i = 0; i < 6; i++) {
  const n = await p.locator('.hud-endturn:not(.hud-exit)').count();
  console.log('round', i, 'endturn buttons:', n, 'result shown:', await p.locator('.hud-result.show').count());
  if (n === 0) break;
  const btn = p.locator('.hud-endturn:not(.hud-exit)');
  if (await btn.isDisabled()) { await p.waitForTimeout(1500); continue; }
  await btn.click();
  await p.waitForTimeout(2200);
}
await p.screenshot({ path: process.argv[2] });
await b.close();
