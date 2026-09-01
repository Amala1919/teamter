import { loadCards, RAW_CARDS } from '../src/data/index';
const r = loadCards();
const byId = new Map(RAW_CARDS.map(c=>[c.id,c]));
// group unparsed lines by their leading verb after stripping prefix
const STRIP = /^(fanfare and last words|fanfare|last words|evolve|clash|strike|follower strike|enhance \(\d+\)|spellboost|necromancy \(\d+\)|earth rite|rally \(\d+\))\s*[-:]\s*/i;
const verbs = new Map<string,{n:number,ex:string}>();
for (const p of r.partial) {
  for (const l of p.lines) {
    const body = l.replace(STRIP,'').replace(/^(at the (end|start) of [^,]+|whenever [^,]+|while [^,]+|once [^,]+|during [^,]+|if [^,]+),\s*/i,'');
    const key = body.toLowerCase().split(/\s+/).slice(0,2).join(' ');
    const cur = verbs.get(key);
    if (cur) cur.n++; else verbs.set(key,{n:1,ex:l});
  }
}
console.log(`${r.partial.length} incomplete cards`);
for (const [k,v] of [...verbs].sort((a,b)=>b[1].n-a[1].n).slice(0,45)) {
  console.log(String(v.n).padStart(4), k.padEnd(22), '|', v.ex.slice(0,96));
}
