import { loadCards, builtCards } from './src/data/index';
loadCards();
console.log(builtCards().filter((c) => c.implemented !== false).map((c) => c.id).sort().join('\n'));
