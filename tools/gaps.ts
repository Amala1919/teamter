/** Groups unimplemented cards by rarity and set, so the work queue is ordered
 * by what a player would actually notice. */
import { loadCards, builtCards } from '../src/data/index';
loadCards();
const cards = builtCards().filter((c) => !c.token);
const partial = cards.filter((c) => c.implemented === false);
const by = new Map<string, number>();
for (const c of cards) {
  const k = c.rarity;
  by.set(k, (by.get(k) ?? 0) + 1);
}
const byP = new Map<string, number>();
for (const c of partial) byP.set(c.rarity, (byP.get(c.rarity) ?? 0) + 1);
console.log('rarity      partial / total');
for (const r of ['legendary', 'gold', 'silver', 'bronze']) {
  console.log(`  ${r.padEnd(11)} ${String(byP.get(r) ?? 0).padStart(3)} / ${String(by.get(r) ?? 0).padStart(3)}`);
}
if (process.argv.includes('--list')) {
  const want = process.argv[process.argv.indexOf('--list') + 1] ?? 'legendary';
  console.log(`\n${want} cards still partial:`);
  for (const c of partial.filter((c) => c.rarity === want)) {
    console.log(`  ${c.id.padEnd(30)} ${(c.missingText ?? []).join(' | ').slice(0, 110)}`);
  }
}
