import art from '../src/data/generated/cardart.json';
const a = art as any;
for (const id of ['archer','elf_tracker','elf_child_may','water_fairy','dwarf_perfumer','skullfane','snake_priestess','spectre','healing_angel']) {
  console.log(id.padEnd(18), a.map[id]?.padEnd(16), JSON.stringify(a.subjects[id]));
}
const counts: Record<string, number> = {};
for (const s of Object.values<any>(a.subjects)) {
  if (s.kind === 'character') counts[s.weapon ?? 'none'] = (counts[s.weapon ?? 'none'] ?? 0) + 1;
}
console.log('weapon counts:', JSON.stringify(counts));
