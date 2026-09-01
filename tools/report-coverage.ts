/** Prints how much of the card pool the text compiler understands. */
import { loadCards, builtCards } from '../src/data/index';

const report = loadCards();
const cards = builtCards();
const known = report.total - report.partial.length;
const pct = ((known / report.total) * 100).toFixed(1);

console.log(`cards            ${report.total}`);
console.log(`fully compiled   ${report.fullyCompiled}`);
console.log(`vanilla          ${report.vanilla}`);
console.log(`hand-written     ${report.overridden}`);
console.log(`incomplete       ${report.partial.length}`);
console.log(`coverage         ${pct}%`);
console.log(`abilities built  ${cards.reduce((n, c) => n + (c.abilities?.length ?? 0), 0)}`);

if (process.argv.includes('--lines')) {
  const freq = new Map<string, number>();
  for (const p of report.partial) {
    for (const l of p.lines) freq.set(l, (freq.get(l) ?? 0) + 1);
  }
  const limit = Number(process.argv[process.argv.indexOf('--lines') + 1]) || 60;
  console.log(`\n${freq.size} distinct unparsed lines:`);
  for (const [l, n] of [...freq].sort((a, b) => b[1] - a[1]).slice(0, limit)) {
    console.log(`  ${String(n).padStart(3)}  ${l}`);
  }
}
