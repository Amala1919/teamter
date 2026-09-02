#!/usr/bin/env node
/**
 * Chooses an illustration subject for every card.
 *
 * Official Shadowverse artwork is unreachable from this environment (see
 * ASSET_LICENSES.md), so each card is matched to a drawn icon from the
 * Game Icons collection — 4133 hand-drawn fantasy subjects under CC BY 3.0.
 *
 * Matching is deliberately explicit rather than fuzzy: a hand-authored table
 * maps the nouns that actually appear in Shadowverse card names to candidate
 * icons, and anything unmatched falls back to a curated pool for its class and
 * card type. A wrong-but-plausible subject is much worse than a generic one,
 * so the fallbacks are broad and the keyword matches are narrow.
 *
 * Output: src/data/generated/cardart.json — the card-to-icon map plus the SVG
 * path data for only the icons actually used.
 *
 *   node tools/build-cardart.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const iconSet = require('@iconify-json/game-icons/icons.json');
const ICONS = iconSet.icons;

const cards = JSON.parse(readFileSync(resolve(root, 'src/data/generated/cards.json'), 'utf8'));

// ---------------------------------------------------------------------------
// Keyword table
// ---------------------------------------------------------------------------

/**
 * Card-name keyword -> candidate icons, best first. Keys are matched against
 * lowercased whole words in the card name, longest key first, so "dragon
 * knight" prefers the "dragon knight" entry over either single word.
 */
const KEYWORDS = {
  // --- dragons and beasts ---
  'dragon knight': ['dragon-orb', 'dragon-head'],
  dragon: ['dragon-head', 'dragon-spiral', 'spiked-dragon-head', 'dragon-breath'],
  wyrm: ['dragon-head', 'sea-dragon'],
  drake: ['dragon-head', 'dragon-breath'],
  wyvern: ['dragonfly', 'dragon-spiral'],
  bahamut: ['dragon-breath', 'dragon-head'],
  serpent: ['sea-serpent', 'snake'],
  snake: ['snake', 'sea-serpent'],
  hydra: ['hydra', 'sea-serpent'],
  wolf: ['wolf-head', 'wolf-howl'],
  fenrir: ['wolf-howl', 'wolf-head'],
  bear: ['bear-head'],
  tiger: ['tiger-head', 'tiger'],
  lion: ['lion', 'tiger-head'],
  cat: ['cat', 'tiger-head'],
  fox: ['fox-head', 'fox'],
  rabbit: ['rabbit-head', 'rabbit'],
  hare: ['rabbit-head'],
  boar: ['boar-tusks'],
  horse: ['horse-head', 'galloping-horse'],
  pegasus: ['pegasus', 'horse-head'],
  unicorn: ['unicorn', 'horse-head'],
  hound: ['wolf-head', 'hound'],
  cerberus: ['wolf-howl', 'wolf-head'],
  spider: ['spider-alt', 'spider-face'],
  scorpion: ['scorpion', 'scorpion-tail'],
  beetle: ['scarab-beetle', 'beetle-shell'],
  hornet: ['bee', 'wasp-sting'],
  bee: ['bee'],
  bat: ['bat', 'bat-wing'],
  bird: ['raven', 'eagle-head'],
  raven: ['raven', 'crow-dive'],
  crow: ['raven', 'crow-dive'],
  eagle: ['eagle-head', 'eagle-emblem'],
  falcon: ['eagle-head', 'falcon-moon'],
  hawk: ['eagle-head'],
  owl: ['owl'],
  phoenix: ['fire-silhouette', 'feathered-wing'],
  fish: ['fish-corpse', 'jumping-fish'],
  shark: ['shark-jaws'],
  octopus: ['octopus', 'octopus-tentacle'],
  kraken: ['giant-squid', 'octopus'],
  whale: ['sperm-whale', 'whale-tail'],
  crab: ['crab', 'crab-claw'],
  turtle: ['turtle', 'turtle-shell'],
  frog: ['frog', 'frog-foot'],
  toad: ['frog'],
  worm: ['worm-mouth'],
  rat: ['rat', 'rat-relief'],
  mouse: ['rat'],
  deer: ['deer-head', 'deer'],
  elk: ['deer-head'],
  goat: ['goat', 'ram'],
  ram: ['ram', 'goat'],
  bull: ['bull-horns', 'minotaur'],
  minotaur: ['minotaur', 'bull-horns'],
  griffin: ['griffin-symbol', 'griffin-shield'],
  chimera: ['beast-eye', 'triple-claws'],
  golem: ['rock-golem', 'golem-head'],
  gargoyle: ['gargoyle'],
  slime: ['transparent-slime', 'gooey-molecule'],

  // --- people ---
  knight: ['knight-banner', 'visored-helm', 'crested-helmet'],
  paladin: ['templar-shield', 'knight-banner'],
  crusader: ['templar-shield'],
  templar: ['templar-shield'],
  soldier: ['spartan', 'swordman'],
  warrior: ['swordman', 'barbarian'],
  fighter: ['swordman', 'boxing-glove'],
  swordsman: ['swordman'],
  swordmaster: ['swordman', 'sword-brandish'],
  samurai: ['samurai-helmet', 'katana'],
  ninja: ['ninja-head', 'ninja-mask'],
  kunoichi: ['ninja-mask', 'ninja-head'],
  assassin: ['hood', 'ninja-head'],
  rogue: ['hood', 'daggers'],
  thief: ['robber', 'hood'],
  bandit: ['robber'],
  pirate: ['pirate-flag', 'pirate-captain'],
  buccaneer: ['pirate-captain', 'pirate-flag'],
  viking: ['viking-helmet', 'viking-longhouse'],
  archer: ['archer', 'bowman'],
  hunter: ['archer', 'hunting-horn'],
  ranger: ['archer'],
  mage: ['wizard-face', 'magic-swirl'],
  wizard: ['wizard-face', 'wizard-staff'],
  wizardess: ['witch-face', 'wizard-face'],
  witch: ['witch-face', 'pointy-hat'],
  sorcerer: ['wizard-face', 'magic-swirl'],
  warlock: ['wizard-face', 'evil-book'],
  necromancer: ['grim-reaper', 'crowned-skull'],
  alchemist: ['bubbling-flask', 'fire-flask'],
  scholar: ['book-cover', 'open-book'],
  sage: ['open-book', 'wisdom'],
  priest: ['praying-mantis', 'prayer'],
  priestess: ['prayer', 'holy-symbol'],
  cleric: ['prayer', 'holy-symbol'],
  bishop: ['holy-symbol', 'prayer'],
  nun: ['prayer', 'holy-symbol'],
  monk: ['monk-face', 'prayer'],
  angel: ['angel-wings', 'holy-symbol'],
  seraph: ['angel-wings'],
  archangel: ['angel-wings', 'winged-shield'],
  demon: ['daemon-skull', 'horned-skull'],
  devil: ['daemon-skull', 'imp'],
  imp: ['imp', 'daemon-skull'],
  fiend: ['daemon-skull'],
  vampire: ['vampire-dracula', 'vampire-cape'],
  lich: ['crowned-skull', 'grim-reaper'],
  zombie: ['shambling-zombie', 'raise-zombie'],
  ghoul: ['shambling-zombie'],
  skeleton: ['bone-knife', 'skeleton-inside'],
  ghost: ['ghost', 'spectre'],
  spirit: ['ghost', 'spectre'],
  phantom: ['ghost', 'spectre'],
  wraith: ['grim-reaper', 'ghost'],
  reaper: ['grim-reaper', 'scythe'],
  elf: ['elf-helmet', 'elf-ear'],
  fairy: ['fairy', 'fairy-wand'],
  pixie: ['fairy'],
  dwarf: ['dwarf-face', 'dwarf-helmet'],
  goblin: ['goblin-head', 'goblin-camp'],
  orc: ['orc-head'],
  ogre: ['ogre', 'orc-head'],
  troll: ['troll', 'ogre'],
  giant: ['giant', 'rock-golem'],
  titan: ['giant'],
  mermaid: ['mermaid', 'siren'],
  merman: ['mermaid', 'trident'],
  siren: ['siren', 'mermaid'],
  king: ['crown', 'king'],
  queen: ['queen-crown', 'crown'],
  prince: ['crown', 'king'],
  princess: ['queen-crown', 'crown'],
  emperor: ['crown', 'king'],
  lord: ['crown', 'king'],
  captain: ['pirate-captain', 'captain-hat-profile'],
  commander: ['knight-banner', 'crested-helmet'],
  general: ['knight-banner', 'crested-helmet'],
  admiral: ['captain-hat-profile', 'anchor'],
  sergeant: ['spartan'],
  lancer: ['spear-hook', 'trident'],
  cavalier: ['horse-head', 'galloping-horse'],
  rider: ['horse-head', 'galloping-horse'],
  dancer: ['flute', 'lyre'],
  bard: ['flute', 'harp'],
  maid: ['dress'],
  child: ['baby-face', 'shining-heart'],
  girl: ['baby-face'],
  boy: ['baby-face'],
  gardener: ['flower-pot', 'shears'],
  farmer: ['wheat', 'farm-tractor'],
  smith: ['blacksmith', 'anvil'],
  blacksmith: ['blacksmith', 'anvil'],
  guard: ['guards', 'shield'],
  guardian: ['guards', 'shield-reflect'],
  defender: ['shield-reflect', 'guards'],
  sentry: ['guards', 'watchtower'],
  scout: ['binoculars', 'archer'],
  messenger: ['scroll-unfurled', 'winged-scepter'],
  oracle: ['crystal-ball', 'eye-of-horus'],
  seer: ['crystal-ball', 'third-eye'],
  prophet: ['scroll-unfurled', 'holy-symbol'],
  executioner: ['executioner-hood', 'axe-in-stump'],
  gladiator: ['gladius', 'spartan'],
  barbarian: ['barbarian', 'axe-in-stump'],
  berserker: ['barbarian', 'axe-swing'],

  // --- objects ---
  sword: ['broadsword', 'sword-brandish'],
  blade: ['broadsword', 'sword-brandish'],
  saber: ['sabers-choc', 'broadsword'],
  katana: ['katana'],
  dagger: ['daggers', 'plain-dagger'],
  knife: ['bowie-knife', 'plain-dagger'],
  axe: ['battle-axe', 'axe-swing'],
  hammer: ['thor-hammer', 'war-pick'],
  mace: ['spiked-mace'],
  spear: ['spear-hook', 'trident'],
  lance: ['spear-hook'],
  bow: ['pocket-bow', 'high-shot'],
  arrow: ['arrow-cluster', 'high-shot'],
  shield: ['shield', 'templar-shield'],
  armor: ['breastplate', 'abdominal-armor'],
  helm: ['visored-helm', 'crested-helmet'],
  helmet: ['visored-helm', 'crested-helmet'],
  banner: ['flying-flag', 'knight-banner'],
  flag: ['flying-flag'],
  staff: ['wizard-staff', 'orb-wand'],
  wand: ['orb-wand', 'fairy-wand'],
  scepter: ['winged-scepter'],
  orb: ['orb-direction', 'crystal-ball'],
  crystal: ['crystal-cluster', 'crystal-shine'],
  gem: ['emerald', 'gems'],
  jewel: ['gems', 'emerald'],
  crown: ['crown', 'queen-crown'],
  ring: ['ring', 'gold-ring'],
  amulet: ['gem-pendant', 'ankh'],
  talisman: ['gem-pendant'],
  charm: ['gem-pendant'],
  potion: ['round-potion', 'bubbling-flask'],
  elixir: ['round-potion'],
  book: ['book-cover', 'open-book'],
  tome: ['evil-book', 'book-cover'],
  grimoire: ['evil-book'],
  scroll: ['scroll-unfurled', 'tied-scroll'],
  bell: ['ringing-bell'],
  candle: ['candle-flame', 'candlestick-phone'],
  lantern: ['lantern-flame', 'old-lantern'],
  mirror: ['mirror-mirror'],
  clock: ['pocket-watch', 'alarm-clock'],
  hourglass: ['sands-of-time', 'hourglass'],
  key: ['key', 'skeleton-key'],
  chest: ['chest', 'open-treasure-chest'],
  coin: ['two-coins', 'coins'],
  gold: ['coins', 'two-coins'],
  cannon: ['cannon', 'cannon-shot'],
  gun: ['revolver', 'pistol-gun'],
  ship: ['galleon', 'sailboat'],
  boat: ['sailboat'],
  anchor: ['anchor'],
  wheel: ['cartwheel', 'ship-wheel'],
  machine: ['gears', 'clockwork'],
  golem_machine: ['clockwork'],
  clockwork: ['clockwork', 'gears'],
  puppet: ['marionette', 'wooden-pegasus'],
  doll: ['marionette'],
  mask: ['curly-mask', 'tragedy-mask'],
  throne: ['throne-king', 'stone-throne'],
  gate: ['gate', 'stone-tower'],
  tower: ['stone-tower', 'watchtower'],
  castle: ['castle', 'medieval-gate'],
  temple: ['greek-temple', 'temple-gate'],
  church: ['church', 'greek-temple'],
  shrine: ['temple-gate', 'shinto-shrine-mirror'],
  altar: ['stone-tablet', 'temple-gate'],
  grave: ['tombstone', 'grave-flowers'],
  tomb: ['tombstone'],
  coffin: ['coffin', 'tombstone'],
  cauldron: ['cauldron', 'bubbling-flask'],
  forge: ['anvil', 'blacksmith'],

  // --- elements and nature ---
  flame: ['flame', 'burning-embers'],
  fire: ['flame', 'burning-embers'],
  blaze: ['flame', 'fire-silhouette'],
  inferno: ['burning-embers', 'flame'],
  ember: ['burning-embers'],
  ice: ['ice-cube', 'frozen-orb'],
  frost: ['frozen-orb', 'snowflake-2'],
  snow: ['snowflake-2', 'snowman'],
  blizzard: ['snowflake-2', 'frozen-orb'],
  storm: ['lightning-storm', 'lightning-trio'],
  thunder: ['lightning-trio', 'lightning-storm'],
  lightning: ['lightning-trio', 'thunder-struck'],
  wind: ['tornado', 'whirlwind'],
  gale: ['tornado', 'whirlwind'],
  cyclone: ['tornado'],
  tempest: ['tornado', 'lightning-storm'],
  earth: ['stone-block', 'rock'],
  stone: ['rock', 'stone-block'],
  rock: ['rock'],
  water: ['water-drop', 'splash'],
  sea: ['big-wave', 'water-drop'],
  ocean: ['big-wave'],
  wave: ['big-wave'],
  rain: ['raining', 'water-drop'],
  light: ['sun', 'sunbeams'],
  sun: ['sun', 'sunbeams'],
  moon: ['moon', 'crescent-blade'],
  star: ['star-formation', 'shiny-entrance'],
  shadow: ['spectre', 'evil-moon'],
  dark: ['evil-moon', 'spectre'],
  darkness: ['evil-moon'],
  night: ['moon', 'evil-moon'],
  void: ['black-hole-bolas', 'evil-moon'],
  abyss: ['black-hole-bolas'],
  chaos: ['star-swirl'],
  soul: ['soul-vessel', 'ghost'],
  blood: ['blood', 'bleeding-heart'],
  bone: ['bone-knife', 'bones'],
  skull: ['crowned-skull', 'horned-skull'],
  heart: ['bleeding-heart', 'shining-heart'],
  eye: ['eye-of-horus', 'third-eye'],
  wing: ['angel-wings', 'bat-wing'],
  wings: ['angel-wings', 'bat-wing'],
  claw: ['triple-scratches', 'claws'],
  fang: ['fangs', 'crossed-claws'],
  tree: ['oak', 'tree-branch'],
  forest: ['forest', 'oak'],
  wood: ['oak', 'wood-pile'],
  leaf: ['oak-leaf', 'leaf-swirl'],
  vine: ['vines', 'leaf-swirl'],
  thorn: ['thorny-vine', 'vines'],
  flower: ['daisy', 'flower-pot'],
  rose: ['rose', 'daisy'],
  petal: ['daisy'],
  seed: ['acorn', 'plant-seed'],
  root: ['tree-roots', 'plant-roots'],
  mushroom: ['mushroom', 'mushrooms-cluster'],
  garden: ['flower-pot', 'daisy'],
  field: ['wheat'],
  mountain: ['mountains', 'mountain-cave'],
  cave: ['mountain-cave', 'cave-entrance'],
  desert: ['desert', 'cactus'],
  swamp: ['swamp-bat', 'water-drop'],

  // --- abstract ---
  rune: ['rune-stone', 'triple-yin'],
  magic: ['magic-swirl', 'sparkles'],
  spell: ['magic-swirl', 'spell-book'],
  curse: ['screaming', 'evil-moon'],
  hex: ['screaming'],
  blessing: ['holy-symbol', 'sun'],
  prayer: ['prayer', 'holy-symbol'],
  wisdom: ['open-book', 'wisdom'],
  fate: ['crystal-ball', 'sands-of-time'],
  dream: ['dream-catcher', 'moon'],
  nightmare: ['devil-mask', 'night-sleep'],
  song: ['flute', 'harp'],
  dance: ['flute'],
  feast: ['meal', 'chicken-leg'],
  banquet: ['meal'],
  party: ['party-popper', 'meal'],
  war: ['crossed-swords', 'battle-gear'],
  battle: ['crossed-swords', 'battle-gear'],
  wrath: ['fire-silhouette', 'angry-eyes'],
  glory: ['laurels', 'trophy'],
  victory: ['laurels', 'trophy'],
  oath: ['holy-symbol', 'scroll-unfurled'],
  pact: ['scroll-unfurled', 'handshake'],
  gift: ['present', 'gift-trap'],
  wonder: ['sparkles', 'star-formation'],
  looking: ['mirror-mirror', 'magnifying-glass'],
  glass: ['mirror-mirror', 'glass-shot'],
  card: ['card-play', 'card-random'],
  wonderland: ['rabbit-head', 'mirror-mirror'],
  alice: ['dress', 'rabbit-head'],
  cheshire: ['cat', 'grinning-face'],
};

/** Broad fallbacks, picked deterministically when no keyword matches. */
/**
 * Fallback pools, split by card type so a spell never gets a swordsman and a
 * neutral follower never gets a treasure chest. Chosen deterministically from
 * the card id, so the same card always lands on the same icon.
 */
const FOLLOWER_POOL = {
  forest: ['elf-helmet', 'fairy', 'archer', 'deer-head', 'wolf-head', 'oak', 'elf-ear', 'bowman', 'mineral-heart', 'fairy-wings'],
  sword: ['knight-banner', 'visored-helm', 'swordman', 'spartan', 'crested-helmet', 'templar-shield', 'gladius', 'mounted-knight', 'guards', 'barbarian'],
  rune: ['wizard-face', 'witch-face', 'orb-wand', 'bubbling-flask', 'magic-palm', 'pointy-hat', 'wizard-staff', 'crystal-ball', 'brainstorm', 'wizard-staff'],
  dragon: ['dragon-head', 'spiked-dragon-head', 'sea-dragon', 'dragon-spiral', 'dragon-breath', 'wyvern', 'lizardman', 'flame-claws', 'burning-embers', 'salamander'],
  shadow: ['crowned-skull', 'grim-reaper', 'shambling-zombie', 'ghost', 'spectre', 'horned-skull', 'raise-zombie', 'skeleton', 'gooey-daemon', 'mummy-head'],
  blood: ['vampire-dracula', 'bat', 'imp', 'daemon-skull', 'fangs', 'vampire-cape', 'devil-mask', 'horned-helm', 'bleeding-heart', 'bat-wing'],
  haven: ['angel-wings', 'prayer', 'winged-shield', 'holy-symbol', 'griffin-symbol', 'unicorn', 'monk-face', 'winged-sword', 'winged-emblem', 'templar-shield'],
  neutral: ['swordman', 'barbarian', 'archer', 'mineral-heart', 'guards', 'wolf-head', 'ogre', 'centaur', 'minotaur', 'hooded-figure'],
};

const SPELL_POOL = {
  forest: ['leaf-swirl', 'vines', 'flamed-leaf', 'wind-slap', 'sprout'],
  sword: ['crossed-swords', 'flying-flag', 'sword-brandish', 'blade-fall', 'battle-gear'],
  rune: ['magic-swirl', 'star-swirl', 'sparkles', 'lightning-trio', 'magic-palm'],
  dragon: ['fire-silhouette', 'flame', 'dragon-breath', 'explosion-rays', 'volcano'],
  shadow: ['ghost', 'tombstone', 'bone-knife', 'screaming', 'evil-moon'],
  blood: ['blood', 'bleeding-heart', 'dripping-blade', 'bat', 'chalice-drops'],
  haven: ['sunbeams', 'holy-symbol', 'prayer', 'sun', 'angel-wings'],
  neutral: ['magic-swirl', 'sparkles', 'star-swirl', 'explosion-rays', 'lightning-trio'],
};

const AMULET_POOL = {
  forest: ['oak', 'forest', 'acorn', 'flower-pot', 'daisy'],
  sword: ['flying-flag', 'castle', 'anvil', 'stone-tablet', 'battle-gear'],
  rune: ['rune-stone', 'crystal-cluster', 'open-book', 'crystal-ball', 'stone-tablet'],
  dragon: ['mountains', 'volcano', 'gem-pendant', 'dragon-spiral', 'burning-embers'],
  shadow: ['tombstone', 'coffin', 'candle-flame', 'stone-tablet', 'ankh'],
  blood: ['vampire-cape', 'gem-pendant', 'chalice-drops', 'candle-flame', 'evil-moon'],
  haven: ['greek-temple', 'church', 'ankh', 'temple-gate', 'ringing-bell'],
  neutral: ['stone-tablet', 'gem-pendant', 'chest', 'crystal-ball', 'temple-gate'],
};

const TYPE_POOLS = { follower: FOLLOWER_POOL, spell: SPELL_POOL, amulet: AMULET_POOL };

/**
 * Trait pools. A neutral follower with no matchable name noun is still a
 * soldier if the card is tagged Officer, which beats a generic class pick.
 */
const TRAIT_POOL = {
  Officer: ['swordman', 'spartan', 'crested-helmet', 'guards', 'gladius'],
  Commander: ['knight-banner', 'visored-helm', 'mounted-knight', 'flying-flag', 'crown'],
  'Earth Sigil': ['rune-stone', 'stone-tablet', 'crystal-cluster'],
  Levin: ['lightning-trio', 'lightning-storm', 'thunder-struck'],
};

/**
 * Proper nouns. Mythological and fairy-tale names carry no matchable noun, and
 * these are the marquee cards, so they are named individually.
 */
const BY_NAME = {
  athena: ['spartan', 'crested-helmet'],
  gabriel: ['winged-emblem', 'angel-wings'],
  uriel: ['winged-emblem', 'angel-wings'],
  israfil: ['winged-emblem', 'angel-wings'],
  sahaquiel: ['winged-emblem', 'angel-wings'],
  lucifer: ['evil-wings', 'angel-wings'],
  'prince of darkness': ['evil-wings', 'devil-mask'],
  odin: ['mounted-knight', 'spear-hook'],
  zeus: ['lightning-trio', 'lightning-storm'],
  hector: ['spartan', 'crested-helmet'],
  neptune: ['trident', 'sea-dragon'],
  urd: ['sands-of-time', 'hourglass'],
  'wind god': ['tornado'],
  rapunzel: ['tower-fall', 'castle'],
  arriet: ['lyre', 'harp'],
  'demonic simulacrum': ['gooey-daemon', 'daemon-skull'],
  'harnessed glass': ['mirror-mirror'],
  medusa: ['medusa-head', 'snake-tongue'],
  cerberus: ['wolf-howl', 'fangs'],
  pluto: ['grim-reaper', 'crowned-skull'],
  furiae: ['evil-wings', 'bat-wing'],
  erinyes: ['evil-wings', 'bat-wing'],
  azazel: ['imp', 'daemon-skull'],
  mastema: ['evil-wings', 'devil-mask'],
  belphegor: ['imp', 'daemon-skull'],
  'lord of the flies': ['fly', 'daemon-skull'],
  balor: ['beast-eye', 'eyeball'],
  ouroboros: ['ouroboros', 'dragon-spiral'],
  fafnir: ['spiked-dragon-head', 'volcano'],
  bahamut: ['dragon-breath', 'spiked-dragon-head'],
  hydra: ['hydra'],
  jabberwock: ['sea-dragon', 'dragon-head'],
  merlin: ['wizard-face', 'wizard-staff'],
  kaguya: ['moon', 'sunbeams'],
  jeanne: ['flying-flag', 'templar-shield'],
  alexander: ['crested-helmet', 'gladius'],
  leonidas: ['spartan', 'crossed-swords'],
  gawain: ['mounted-knight', 'visored-helm'],
  roland: ['visored-helm', 'templar-shield'],
  cinderella: ['ballerina-shoes', 'crystal-shine'],
  'beauty and the beast': ['rose', 'beast-eye'],
  nephthys: ['ankh', 'egyptian-bird'],
  eachtar: ['crowned-skull', 'bone-knife'],
  ceridwen: ['bubbling-flask', 'witch-face'],
  mordecai: ['shambling-zombie', 'skeleton'],
  tsubaki: ['katana', 'daisy'],
  'date masamune': ['samurai-helmet', 'katana'],
  zirnitra: ['dragon-breath', 'evil-wings'],
  rahab: ['sea-dragon', 'sea-serpent'],
  grimnir: ['tornado', 'spear-hook'],
  maahes: ['lion', 'ankh'],
  'heavenly aegis': ['winged-shield'],
  'lord atomy': ['crowned-skull', 'horned-skull'],
  'moon al-mi\'raj': ['rabbit-head', 'moon'],
  garuda: ['griffin-symbol', 'feathered-wing'],
  seraph: ['winged-emblem', 'angel-wings'],
  bloody: ['mirror-mirror', 'blood'],
  vania: ['queen-crown', 'vampire-cape'],
  'soul dealer': ['soul-vessel', 'daemon-skull'],
  'queen of the dread sea': ['pirate-flag', 'queen-crown'],
  'snow, whitecat sage': ['cat', 'open-book'],
  'alice, wonderland explorer': ['rabbit-head', 'pocket-watch'],
  'wizardess of oz': ['witch-face', 'pointy-hat'],
  'wonderland dreams': ['pocket-watch'],
};

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

const missing = new Set();

function firstAvailable(names) {
  for (const n of names) {
    if (ICONS[n]) return n;
    missing.add(n);
  }
  return null;
}

/** Deterministic 32-bit hash, so a card always gets the same fallback. */
function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const KEYS = Object.keys(KEYWORDS).sort((a, b) => b.length - a.length);
const NAME_KEYS = Object.keys(BY_NAME).sort((a, b) => b.length - a.length);

function pickIcon(card) {
  const name = card.name.toLowerCase();

  // Proper nouns first — "Athena" has no matchable common noun in it.
  for (const key of NAME_KEYS) {
    if (name.includes(key)) {
      const icon = firstAvailable(BY_NAME[key]);
      if (icon) return { icon, via: 'name' };
    }
  }

  // Longest keyword first, so "dragon knight" beats "dragon".
  for (const key of KEYS) {
    const re = new RegExp(`(^|[^a-z])${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z])`);
    if (re.test(name)) {
      const icon = firstAvailable(KEYWORDS[key]);
      if (icon) return { icon, via: 'keyword' };
    }
  }

  // Tribe, when the card has one — an Officer is a soldier whatever it is called.
  for (const trait of (card.traits ?? [])) {
    const pool = TRAIT_POOL[trait];
    if (!pool) continue;
    const available = pool.filter((n) => ICONS[n]);
    for (const n of pool) if (!ICONS[n]) missing.add(n);
    if (available.length > 0) {
      return { icon: available[hash(card.id) % available.length], via: 'trait' };
    }
  }

  const pool = (TYPE_POOLS[card.type] ?? FOLLOWER_POOL)[card.cardClass] ?? FOLLOWER_POOL.neutral;
  const available = pool.filter((n) => ICONS[n]);
  for (const n of pool) if (!ICONS[n]) missing.add(n);
  if (available.length === 0) return { icon: 'crossed-swords', via: 'default' };
  return { icon: available[hash(card.id) % available.length], via: 'pool' };
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

/**
 * Non-card subjects the interface also paints: the class banners on the home
 * screen go through the same illustration generator, so they need a subject in
 * the same map rather than a special case in the renderer.
 */
const BANNERS = {
  banner_forest: 'elf-helmet',
  banner_sword: 'knight-banner',
  banner_rune: 'wizard-face',
  banner_dragon: 'spiked-dragon-head',
  banner_shadow: 'crowned-skull',
  banner_blood: 'vampire-dracula',
  banner_haven: 'winged-shield',
  banner_neutral: 'swordman',
  leader_forest: 'elf-ear',
  leader_sword: 'crested-helmet',
  leader_rune: 'pointy-hat',
  leader_dragon: 'dragon-head',
  leader_shadow: 'grim-reaper',
  leader_blood: 'vampire-cape',
  leader_haven: 'prayer',
  leader_neutral: 'swordman',
};

const map = {};
const used = new Set();
const stats = { name: 0, keyword: 0, trait: 0, pool: 0, default: 0 };

for (const card of cards) {
  const { icon, via } = pickIcon(card);
  map[card.id] = icon;
  used.add(icon);
  stats[via]++;
}

for (const [id, icon] of Object.entries(BANNERS)) {
  if (!ICONS[icon]) {
    missing.add(icon);
    continue;
  }
  map[id] = icon;
  used.add(icon);
}

/** Extracts just the path data; every Game Icon is a single filled path. */
function pathsOf(body) {
  return [...body.matchAll(/\sd="([^"]+)"/g)].map((m) => m[1]);
}

const icons = {};
for (const name of used) {
  const ic = ICONS[name];
  if (!ic) continue;
  icons[name] = {
    d: pathsOf(ic.body),
    // Game Icons are drawn on a 512 grid unless the entry overrides it.
    w: ic.width ?? iconSet.width ?? 512,
    h: ic.height ?? iconSet.height ?? 512,
  };
}

const out = {
  source: 'Game Icons (game-icons.net) via @iconify-json/game-icons',
  license: 'CC BY 3.0',
  author: 'Game-icons.net contributors',
  url: 'https://game-icons.net/',
  map,
  icons,
};

const dir = resolve(root, 'src/data/generated');
mkdirSync(dir, { recursive: true });
writeFileSync(resolve(dir, 'cardart.json'), JSON.stringify(out) + '\n');

console.log(`cards          ${cards.length}`);
console.log(`  by name      ${stats.name}`);
console.log(`  by keyword   ${stats.keyword}`);
console.log(`  by trait     ${stats.trait}`);
console.log(`  by pool      ${stats.pool}`);
console.log(`  by default   ${stats.default}`);
console.log(`distinct icons ${used.size}`);
console.log(`bytes          ${(JSON.stringify(out).length / 1024).toFixed(0)} kB`);
if (missing.size > 0) {
  console.log(`\n${missing.size} icon names in the tables do not exist:`);
  console.log('  ' + [...missing].sort().join(', '));
}
