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
  priest: ['prayer', 'holy-symbol'],
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
// Icon -> drawn subject
// ---------------------------------------------------------------------------

/**
 * The icon chosen above is a good classifier for *what a card is about*, so it
 * doubles as the key to the drawn subject: which character archetype, creature,
 * or — for genuinely inanimate cards — which emblem to fall back on.
 *
 * `c:` a character, `b:` a beast, `o:` an object (the icon is drawn as before).
 */
const SUBJECT = {
  // --- characters -----------------------------------------------------------
  'knight-banner': { c: 'knight', weapon: 'sword', headgear: 'none' },
  swordman: { c: 'warrior', weapon: 'sword' },
  spartan: { c: 'warrior', weapon: 'spear', headgear: 'helm' },
  guards: { c: 'knight', weapon: 'spear', headgear: 'helm' },
  gladius: { c: 'warrior', weapon: 'sword' },
  broadsword: { c: 'knight', weapon: 'greatsword' },
  'sword-brandish': { c: 'warrior', weapon: 'sword' },
  'blade-fall': { c: 'warrior', weapon: 'greatsword' },
  'sabers-choc': { c: 'knight', weapon: 'sword' },
  'crossed-swords': { c: 'warrior', weapon: 'sword' },
  'battle-gear': { c: 'knight', weapon: 'axe', headgear: 'helm' },
  'battle-axe': { c: 'warrior', weapon: 'axe' },
  'templar-shield': { c: 'knight', weapon: 'shield', headgear: 'helm' },
  shield: { c: 'knight', weapon: 'shield' },
  'shield-reflect': { c: 'knight', weapon: 'shield', headgear: 'helm' },
  breastplate: { c: 'knight', weapon: 'sword', headgear: 'helm' },
  'visored-helm': { c: 'knight', weapon: 'sword', headgear: 'helm' },
  'crested-helmet': { c: 'knight', weapon: 'spear', headgear: 'helm' },
  'horned-helm': { c: 'warrior', weapon: 'axe', headgear: 'helm' },
  'viking-helmet': { c: 'warrior', weapon: 'axe', headgear: 'helm' },
  'mounted-knight': { c: 'knight', weapon: 'spear', headgear: 'helm' },
  'flying-flag': { c: 'knight', weapon: 'spear' },
  'samurai-helmet': { c: 'samurai', weapon: 'sword', headgear: 'helm' },
  katana: { c: 'samurai', weapon: 'sword' },
  'ninja-head': { c: 'ninja', weapon: 'dagger', headgear: 'mask' },
  'ninja-mask': { c: 'ninja', weapon: 'dagger', headgear: 'mask' },
  hood: { c: 'rogue', weapon: 'dagger', headgear: 'hood' },
  'hooded-figure': { c: 'rogue', weapon: 'dagger', headgear: 'hood' },
  'executioner-hood': { c: 'rogue', weapon: 'axe', headgear: 'hood' },
  robber: { c: 'rogue', weapon: 'dagger', headgear: 'bandana' },
  'curly-mask': { c: 'rogue', weapon: 'dagger', headgear: 'mask' },
  archer: { c: 'archer', weapon: 'bow' },
  bowman: { c: 'archer', weapon: 'bow' },
  'wizard-face': { c: 'mage', weapon: 'staff', headgear: 'hat' },
  'witch-face': { c: 'mage', weapon: 'staff', headgear: 'hat' },
  'pointy-hat': { c: 'mage', weapon: 'wand', headgear: 'hat' },
  'wizard-staff': { c: 'mage', weapon: 'staff', headgear: 'hood' },
  'orb-wand': { c: 'mage', weapon: 'wand' },
  'magic-palm': { c: 'mage', weapon: 'none' },
  'bubbling-flask': { c: 'mage', weapon: 'book', headgear: 'none' },
  cauldron: { c: 'mage', weapon: 'book', headgear: 'hat' },
  'evil-book': { c: 'necromancer', weapon: 'book', headgear: 'hood' },
  'open-book': { c: 'mage', weapon: 'book' },
  'book-cover': { c: 'mage', weapon: 'book' },
  'crystal-ball': { c: 'mage', weapon: 'wand', headgear: 'hood' },
  prayer: { c: 'priest', weapon: 'none', headgear: 'none' },
  'holy-symbol': { c: 'priest', weapon: 'wand' },
  'monk-face': { c: 'monk', weapon: 'staff' },
  'winged-shield': { c: 'priest', weapon: 'shield', wings: 'feathered' },
  'winged-sword': { c: 'angel', weapon: 'sword', wings: 'feathered' },
  'angel-wings': { c: 'angel', weapon: 'none', headgear: 'halo', wings: 'feathered' },
  'winged-emblem': { c: 'angel', weapon: 'wand', headgear: 'halo', wings: 'feathered' },
  'elf-helmet': { c: 'elf', weapon: 'bow', headgear: 'elfEars' },
  'elf-ear': { c: 'elf', weapon: 'dagger', headgear: 'elfEars' },
  fairy: { c: 'fairy', weapon: 'wand', headgear: 'elfEars', wings: 'fairy' },
  'fairy-wings': { c: 'fairy', weapon: 'none', headgear: 'elfEars', wings: 'fairy' },
  'vampire-dracula': { c: 'vampire', weapon: 'dagger', wings: 'bat' },
  'vampire-cape': { c: 'vampire', weapon: 'none', wings: 'bat' },
  'grim-reaper': { c: 'necromancer', weapon: 'scythe', headgear: 'hood' },
  'raise-zombie': { c: 'necromancer', weapon: 'staff', headgear: 'hood' },
  'soul-vessel': { c: 'necromancer', weapon: 'wand', headgear: 'hood' },
  'queen-crown': { c: 'noble', weapon: 'none', headgear: 'crown' },
  crown: { c: 'noble', weapon: 'sword', headgear: 'crown' },
  dress: { c: 'noble', weapon: 'none', headgear: 'tiara' },
  'ballerina-shoes': { c: 'noble', weapon: 'none', headgear: 'tiara' },
  rose: { c: 'noble', weapon: 'none', headgear: 'tiara' },
  'pirate-captain': { c: 'pirate', weapon: 'sword', headgear: 'bandana' },
  'captain-hat-profile': { c: 'pirate', weapon: 'sword', headgear: 'bandana' },
  'pirate-flag': { c: 'pirate', weapon: 'sword', headgear: 'bandana' },
  'dwarf-face': { c: 'dwarf', weapon: 'axe' },
  giant: { c: 'giant', weapon: 'axe' },
  ogre: { c: 'giant', weapon: 'axe' },
  minotaur: { c: 'giant', weapon: 'axe', headgear: 'horns' },
  centaur: { c: 'warrior', weapon: 'bow' },
  'baby-face': { c: 'child', weapon: 'none' },
  flute: { c: 'noble', weapon: 'none' },
  lyre: { c: 'noble', weapon: 'none' },
  'spear-hook': { c: 'warrior', weapon: 'spear' },
  trident: { c: 'warrior', weapon: 'spear' },
  mermaid: { c: 'noble', weapon: 'none', headgear: 'tiara' },
  siren: { c: 'noble', weapon: 'none', headgear: 'tiara' },
  'goblin-head': { b: 'imp' },
  'medusa-head': { c: 'demon', weapon: 'bow', headgear: 'horns' },
  'devil-mask': { c: 'demon', weapon: 'scythe', headgear: 'horns', wings: 'bat' },
  'evil-wings': { c: 'demon', weapon: 'sword', headgear: 'horns', wings: 'bat' },
  'horned-skull': { c: 'demon', weapon: 'scythe', headgear: 'horns' },
  anvil: { c: 'dwarf', weapon: 'axe' },
  'card-play': { c: 'rogue', weapon: 'dagger' },
  'dripping-blade': { c: 'rogue', weapon: 'dagger' },
  'thorny-vine': { c: 'elf', weapon: 'staff', headgear: 'elfEars' },
  vines: { c: 'elf', weapon: 'staff', headgear: 'elfEars' },
  'flamed-leaf': { c: 'elf', weapon: 'wand', headgear: 'elfEars' },
  'leaf-swirl': { c: 'elf', weapon: 'staff', headgear: 'elfEars' },
  'flower-pot': { c: 'elf', weapon: 'none', headgear: 'elfEars' },
  daisy: { c: 'fairy', weapon: 'wand', headgear: 'elfEars', wings: 'fairy' },
  acorn: { c: 'fairy', weapon: 'none', headgear: 'elfEars', wings: 'fairy' },
  'mineral-heart': { c: 'noble', weapon: 'none', headgear: 'tiara' },
  'gem-pendant': { c: 'noble', weapon: 'wand', headgear: 'tiara' },
  screaming: { c: 'necromancer', weapon: 'none', headgear: 'hood' },
  'chalice-drops': { c: 'vampire', weapon: 'none', wings: 'bat' },
  blood: { c: 'vampire', weapon: 'dagger', wings: 'bat' },
  'bleeding-heart': { c: 'vampire', weapon: 'none', wings: 'bat' },
  'evil-moon': { c: 'vampire', weapon: 'none', wings: 'bat' },
  'black-hole-bolas': { c: 'necromancer', weapon: 'staff', headgear: 'hood' },
  'star-swirl': { c: 'mage', weapon: 'staff', headgear: 'hat' },
  'magic-swirl': { c: 'mage', weapon: 'staff', headgear: 'hat' },
  sparkles: { c: 'mage', weapon: 'wand', headgear: 'hat' },
  'lightning-trio': { c: 'mage', weapon: 'staff', headgear: 'hood' },
  'lightning-storm': { c: 'mage', weapon: 'staff', headgear: 'hood' },
  'snowflake-2': { c: 'mage', weapon: 'staff', headgear: 'hood' },
  'water-drop': { c: 'mage', weapon: 'wand', headgear: 'hood' },
  'wind-slap': { c: 'mage', weapon: 'wand', headgear: 'hood' },
  tornado: { c: 'mage', weapon: 'staff', headgear: 'hood' },
  'explosion-rays': { c: 'mage', weapon: 'staff', headgear: 'hat' },
  'fire-silhouette': { c: 'mage', weapon: 'staff', headgear: 'hood' },
  flame: { c: 'mage', weapon: 'staff', headgear: 'hood' },
  'burning-embers': { c: 'mage', weapon: 'staff', headgear: 'hood' },
  'triple-scratches': { c: 'rogue', weapon: 'dagger' },
  'flame-claws': { c: 'demon', weapon: 'none', headgear: 'horns' },
  fangs: { c: 'vampire', weapon: 'none', wings: 'bat' },
  'beast-eye': { c: 'demon', weapon: 'none', headgear: 'horns' },
  sun: { c: 'priest', weapon: 'wand', headgear: 'halo' },
  ankh: { c: 'priest', weapon: 'staff' },
  church: { c: 'priest', weapon: 'none' },
  'ringing-bell': { c: 'priest', weapon: 'none' },
  'greek-temple': { c: 'priest', weapon: 'staff' },
  'temple-gate': { c: 'priest', weapon: 'staff' },
  'candle-flame': { c: 'priest', weapon: 'wand', headgear: 'hood' },
  'scroll-unfurled': { c: 'mage', weapon: 'book' },
  'rune-stone': { c: 'mage', weapon: 'staff', headgear: 'hood' },
  'crystal-cluster': { c: 'mage', weapon: 'wand', headgear: 'hood' },
  'stone-tablet': { c: 'monk', weapon: 'staff' },
  'sands-of-time': { c: 'mage', weapon: 'staff', headgear: 'hood' },
  'mirror-mirror': { c: 'noble', weapon: 'none', headgear: 'tiara' },
  cannon: { c: 'pirate', weapon: 'none', headgear: 'bandana' },
  'horse-head': { c: 'knight', weapon: 'spear', headgear: 'helm' },
  pegasus: { c: 'angel', weapon: 'spear', wings: 'feathered' },
  unicorn: { c: 'noble', weapon: 'spear', headgear: 'tiara' },
  'griffin-symbol': { c: 'angel', weapon: 'spear', wings: 'feathered' },
  lion: { c: 'warrior', weapon: 'axe' },
  'boar-tusks': { c: 'warrior', weapon: 'axe' },
  'tower-fall': { c: 'noble', weapon: 'none', headgear: 'tiara' },
  'stone-block': { c: 'monk', weapon: 'staff' },
  castle: { c: 'knight', weapon: 'spear', headgear: 'helm' },
  desert: { c: 'rogue', weapon: 'dagger', headgear: 'hood' },
  meal: { c: 'noble', weapon: 'none' },
  chest: { c: 'rogue', weapon: 'dagger', headgear: 'bandana' },
  cat: { c: 'rogue', weapon: 'dagger' },
  'moon': { c: 'noble', weapon: 'wand', headgear: 'tiara' },
  'dragon-orb': { c: 'knight', weapon: 'greatsword', headgear: 'horns' },

  // --- beasts and things ----------------------------------------------------
  'dragon-head': { b: 'dragon' },
  'spiked-dragon-head': { b: 'dragon', ornate: 1 },
  'dragon-breath': { b: 'dragon', ornate: 0.8 },
  'dragon-spiral': { b: 'dragon', ornate: 0.9 },
  'sea-dragon': { b: 'dragon', ornate: 0.7 },
  wyvern: { b: 'dragon', ornate: 0.5 },
  salamander: { b: 'dragon', ornate: 0.3 },
  hydra: { b: 'dragon', ornate: 1 },
  ouroboros: { b: 'serpent' },
  'sea-serpent': { b: 'serpent' },
  'wolf-head': { b: 'wolf' },
  'wolf-howl': { b: 'wolf' },
  'fox-head': { b: 'wolf' },
  'tiger-head': { b: 'wolf' },
  'deer-head': { b: 'wolf' },
  'eagle-head': { b: 'bird' },
  raven: { b: 'bird' },
  'sperm-whale': { b: 'serpent' },
  crab: { b: 'insect' },
  frog: { b: 'slime' },
  'praying-mantis': { b: 'insect' },
  'scarab-beetle': { b: 'insect' },
  bee: { b: 'insect' },
  scorpion: { b: 'insect' },
  fly: { b: 'insect' },
  dragonfly: { b: 'insect' },
  ghost: { b: 'ghost' },
  spectre: { b: 'ghost' },
  'crowned-skull': { b: 'skeleton' },
  skeleton: { b: 'skeleton' },
  'bone-knife': { b: 'skeleton' },
  'mummy-head': { b: 'skeleton' },
  'shambling-zombie': { b: 'skeleton' },
  tombstone: { b: 'ghost' },
  'daemon-skull': { b: 'demon' },
  imp: { b: 'imp' },
  'gooey-daemon': { b: 'slime' },
  gargoyle: { b: 'demon' },
  'rock-golem': { b: 'golem' },
  bat: { b: 'imp' },
  'bat-wing': { b: 'imp' },
  'rabbit-head': { b: 'imp' },
  'goblin-camp': { b: 'imp' },
  troll: { b: 'imp' },

  // --- objects: the icon is still the best drawing --------------------------
  // A Forestcraft *follower* called "Treant" is a creature; the same icon on an
  // amulet is scenery, which `subjectFor` sorts out by card type.
  forest: { b: 'golem', ornate: 0.3 },
  oak: { b: 'golem', ornate: 0.3 },
  mountains: { o: 1 },
  volcano: { o: 1 },
  'crystal-shine': { o: 1 },
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

/**
 * Extracts just the path data; every Game Icon is a single filled path.
 *
 * Coordinates are rounded to one decimal. The icons are drawn on a 512 grid and
 * shown at most 452 px wide, so a tenth of a unit is a fifth of a pixel — well
 * below anything visible — and it takes about a fifth off the shipped size.
 */
function pathsOf(body) {
  return [...body.matchAll(/\sd="([^"]+)"/g)].map((m) =>
    m[1].replace(/-?\d+\.\d+/g, (n) => String(Math.round(parseFloat(n) * 10) / 10)),
  );
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

/**
 * Turns the icon choice into a drawn subject. Anything with no entry, and every
 * spell and amulet, falls back to the icon itself — a spell is an event, not a
 * person, and drawing a character for one would be a lie about the card.
 */
function subjectFor(card, icon) {
  const s = SUBJECT[icon];
  if (!s) return { kind: 'emblem' };
  if (s.o) return { kind: 'emblem' };
  if (s.b) return { kind: 'creature', creature: s.b, ornate: s.ornate ?? 0.6 };
  const out = { kind: 'character', archetype: s.c };
  if (s.weapon) out.weapon = s.weapon;
  if (s.headgear) out.headgear = s.headgear;
  if (s.wings) out.wings = s.wings;
  if (s.small) out.small = true;
  // Only followers are people. A spell showing a wizard is showing the caster,
  // which is not what the card is.
  if (card.type !== 'follower') return { kind: 'emblem' };
  return out;
}

const subjects = {};
let charCount = 0;
let beastCount = 0;
for (const card of cards) {
  const sub = subjectFor(card, map[card.id]);
  subjects[card.id] = sub;
  if (sub.kind === 'character') charCount++;
  else if (sub.kind === 'creature') beastCount++;
}
// The class banners and leader plates are always characters.
for (const cls of ['forest', 'sword', 'rune', 'dragon', 'shadow', 'blood', 'haven', 'neutral']) {
  const s = SUBJECT[BANNERS[`leader_${cls}`]];
  subjects[`leader_${cls}`] = s && s.c ? { kind: 'character', archetype: s.c, weapon: s.weapon, headgear: s.headgear, wings: s.wings } : { kind: 'emblem' };
  subjects[`banner_${cls}`] = { kind: 'emblem' };
}

const out = {
  source: 'Game Icons (game-icons.net) via @iconify-json/game-icons',
  license: 'CC BY 3.0',
  author: 'Game-icons.net contributors',
  url: 'https://game-icons.net/',
  map,
  subjects,
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
console.log(`characters     ${charCount}`);
console.log(`creatures      ${beastCount}`);
console.log(`emblems        ${cards.length - charCount - beastCount}`);
console.log(`bytes          ${(JSON.stringify(out).length / 1024).toFixed(0)} kB`);
if (missing.size > 0) {
  console.log(`\n${missing.size} icon names in the tables do not exist:`);
  console.log('  ' + [...missing].sort().join(', '));
}
