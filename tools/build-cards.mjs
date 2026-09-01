#!/usr/bin/env node
/**
 * Normalises the official Shadowverse card database into the shape the engine
 * consumes.
 *
 * Input:  .cache/en.json and .cache/ja.json — mirrors of the official
 *         Shadowverse Portal card API (see docs/ASSET_LICENSES.md).
 * Output: src/data/generated/cards.json
 *
 * Scope is the original game's launch set through the fifth card pack. Tokens
 * are pulled in transitively, so anything a in-scope card can create is present
 * even when the token itself is filed under the "Token" expansion.
 *
 *   node tools/build-cards.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const SET_MAP = new Map([
  ['Basic', 'basic'],
  ['Standard Card Pack', 'standard'],
  ['Darkness Evolved', 'darkness'],
  ['Rise of Bahamut', 'bahamut'],
  ['Tempest of the Gods', 'tempest'],
  ['Wonderland Dreams', 'wonderland'],
]);

const CLASS_MAP = new Map([
  ['Forestcraft', 'forest'],
  ['Swordcraft', 'sword'],
  ['Runecraft', 'rune'],
  ['Dragoncraft', 'dragon'],
  ['Shadowcraft', 'shadow'],
  ['Bloodcraft', 'blood'],
  ['Havencraft', 'haven'],
  ['Neutral', 'neutral'],
]);

const RARITY_MAP = new Map([
  ['Bronze', 'bronze'],
  ['Silver', 'silver'],
  ['Gold', 'gold'],
  ['Legendary', 'legendary'],
]);

const TYPE_MAP = new Map([
  ['Follower', 'follower'],
  ['Spell', 'spell'],
  ['Amulet', 'amulet'],
]);

const en = JSON.parse(readFileSync(resolve(root, '.cache/en.json'), 'utf8'));
const ja = JSON.parse(readFileSync(resolve(root, '.cache/ja.json'), 'utf8'));

/** Alternate-art reprints share a card's rules text but are not distinct cards. */
const isAltArt = (id) => Number(id) >= 700000000 && Number(id) < 800000000;

/** Portalcraft was added years after Wonderland Dreams. */
const inScopeClass = (c) => CLASS_MAP.has(c);

const collectible = new Map();
for (const [id, v] of Object.entries(en)) {
  if (isAltArt(id)) continue;
  if (!SET_MAP.has(v.expansion_)) continue;
  if (!inScopeClass(v.craft_)) continue;
  if (!TYPE_MAP.has(v.type_)) continue;
  collectible.set(id, v);
}

// Pull in every token reachable from an in-scope card, following chains such as
// First Curse -> Second Curse -> Final Curse.
const tokens = new Map();
const queue = [...collectible.values()].flatMap((v) => v.tokens_ ?? []);
const seen = new Set();
while (queue.length) {
  const tid = String(queue.shift());
  if (seen.has(tid)) continue;
  seen.add(tid);
  if (collectible.has(tid)) continue;
  const v = en[tid];
  if (!v || isAltArt(tid) || !inScopeClass(v.craft_) || !TYPE_MAP.has(v.type_)) continue;
  tokens.set(tid, v);
  for (const t of v.tokens_ ?? []) queue.push(String(t));
}

/** Stable, readable, collision-free slug used as the engine-facing card id. */
const usedSlugs = new Map();
function slugify(name, id) {
  let base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’.]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!base) base = `card_${id}`;
  const prior = usedSlugs.get(base);
  if (prior === undefined) {
    usedSlugs.set(base, id);
    return base;
  }
  if (prior === id) return base;
  let n = 2;
  while (usedSlugs.has(`${base}_${n}`)) n++;
  usedSlugs.set(`${base}_${n}`, id);
  return `${base}_${n}`;
}

const TRAITS = new Set(['Officer', 'Commander', 'Levin', 'Machina', 'Academic', 'Mysteria', 'Wonderland']);

/** Deterministic 32-bit hash, used to seed each card's procedural artwork. */
function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function clean(s) {
  if (!s) return '';
  return String(s)
    .replace(/\r/g, '')
    // The source uses a run of dashes as a visual separator between the two
    // halves of a double-sided card; it carries no rules meaning.
    .replace(/^-+$/gm, '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && l !== '-')
    .join('\n')
    .trim();
}

function convert(id, v, isToken) {
  const type = TYPE_MAP.get(v.type_);
  const name = v.name_;
  const jaRec = ja[id];
  const out = {
    id: slugify(name, id),
    officialId: Number(id),
    name,
    nameJa: jaRec?.name_ ?? '',
    cardClass: CLASS_MAP.get(v.craft_),
    set: isToken ? tokenSetOf(id) : SET_MAP.get(v.expansion_),
    rarity: RARITY_MAP.get(v.rarity_) ?? 'bronze',
    type,
    cost: v.pp_ ?? 0,
    text: clean(v.baseEffect_),
    textJa: clean(jaRec?.baseEffect_),
    evoText: clean(v.evoEffect_),
    evoTextJa: clean(jaRec?.evoEffect_),
    flavor: clean(v.baseFlair_).split('\n')[0] ?? '',
    artSeed: hash(`${id}:${name}`),
  };
  if (TRAITS.has(v.trait_)) out.traits = [v.trait_];
  if (type === 'follower') {
    out.atk = v.baseAtk_ ?? 0;
    out.def = v.baseDef_ ?? 0;
    // Evolved stats are read from the source rather than assumed to be +2/+2:
    // followers with an Evolve effect usually gain only +1/+1, and a handful of
    // cards are bespoke.
    out.evoAtk = v.evoAtk_ ?? out.atk + 2;
    out.evoDef = v.evoDef_ ?? out.def + 2;
  }
  if (isToken) out.token = true;
  if (v.tokens_?.length) {
    out.creates = v.tokens_.map(String).filter((t) => en[t] && !isAltArt(t));
  }
  return out;
}

/** Tokens inherit the set of the earliest in-scope card that creates them. */
const tokenSet = new Map();
for (const [id, v] of collectible) {
  for (const t of v.tokens_ ?? []) {
    const k = String(t);
    if (!tokenSet.has(k)) tokenSet.set(k, SET_MAP.get(v.expansion_));
  }
}
function tokenSetOf(id) {
  return tokenSet.get(String(id)) ?? 'basic';
}

const all = [];
for (const [id, v] of collectible) all.push(convert(id, v, false));
for (const [id, v] of tokens) all.push(convert(id, v, true));

// `creates` is stored as official ids above; rewrite it to engine slugs now that
// every card has one.
const byOfficial = new Map(all.map((c) => [String(c.officialId), c.id]));
for (const c of all) {
  if (!c.creates) continue;
  c.creates = c.creates.map((t) => byOfficial.get(t)).filter(Boolean);
  if (c.creates.length === 0) delete c.creates;
}

all.sort((a, b) => a.officialId - b.officialId);

const outDir = resolve(root, 'src/data/generated');
mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, 'cards.json'), JSON.stringify(all, null, 0) + '\n');

const bySet = {};
for (const c of all) {
  const k = c.token ? `${c.set} (token)` : c.set;
  bySet[k] = (bySet[k] ?? 0) + 1;
}
console.log(`Wrote ${all.length} cards to src/data/generated/cards.json`);
for (const [k, n] of Object.entries(bySet).sort()) console.log(`  ${k.padEnd(24)} ${n}`);
