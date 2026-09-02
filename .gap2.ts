import { loadCards, builtCards } from './src/data/index';
loadCards();
const re = new RegExp(process.argv[2] ?? 'instead', 'i');
const out = new Map<string, string[]>();
for (const c of builtCards()) {
  for (const l of c.missingText ?? []) {
    if (!re.test(l)) continue;
    const arr = out.get(l) ?? [];
    arr.push(c.id);
    out.set(l, arr);
  }
}
for (const [l, ids] of [...out].sort()) console.log(`${ids.length}  ${l}\n      ${ids.slice(0,3).join(', ')}`);
console.log('\nlines', out.size);
