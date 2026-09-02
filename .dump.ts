import { loadCards } from './src/data/index';
import { getCard } from './src/engine/registry';
loadCards();
for (const id of process.argv.slice(2)) {
  const c = getCard(id);
  console.log('###', id, '—', c.text.replace(/\n/g, ' | '));
  console.log(JSON.stringify({ abilities: c.abilities, enhance: c.enhance, targeting: c.targeting }, null, 1));
  console.log();
}
