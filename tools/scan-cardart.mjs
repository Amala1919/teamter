#!/usr/bin/env node
/**
 * Builds the manifest of supplied card images.
 *
 *   node tools/scan-cardart.mjs
 *
 * A browser cannot list a directory, so the files dropped into
 * `public/assets/cards/` have to be enumerated here and written out for the
 * renderer to read. Run it after adding or removing images.
 *
 * A file is matched to a card by its basename: `goblin.png` supplies the art
 * for the card whose id is `goblin`. Names that match no card are reported and
 * skipped rather than silently ignored, because a typo in a filename is
 * otherwise invisible — the card just keeps its generated illustration.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, extname, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'public/assets/cards');
const out = join(root, 'src/data/generated/suppliedart.json');
const creditsPath = join(dir, 'credits.json');

const EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.avif', '.gif']);

const ids = new Set(
  JSON.parse(readFileSync(join(root, 'src/data/generated/cards.json'), 'utf8')).map((c) => c.id),
);

// Optional, hand-written: where each image came from and under what licence.
const credits = existsSync(creditsPath) ? JSON.parse(readFileSync(creditsPath, 'utf8')) : {};

if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

const map = {};
const unmatched = [];
const uncredited = [];
for (const name of existsSync(dir) ? readdirSync(dir).sort() : []) {
  const ext = extname(name).toLowerCase();
  if (!EXT.has(ext)) continue;
  const id = basename(name, ext);
  if (!ids.has(id)) {
    unmatched.push(name);
    continue;
  }
  map[id] = name;
  if (!credits[id]) uncredited.push(id);
}

writeFileSync(out, `${JSON.stringify({ dir: '/assets/cards/', map, credits }, null, 2)}\n`);

console.log(`supplied images  ${Object.keys(map).length}`);
console.log(`wrote            ${out.replace(`${root}/`, '')}`);
if (unmatched.length) {
  console.log(`\nno card with that id (${unmatched.length}) — check the filename:`);
  for (const n of unmatched.slice(0, 20)) console.log(`  ${n}`);
  if (unmatched.length > 20) console.log(`  ... and ${unmatched.length - 20} more`);
}
if (uncredited.length) {
  console.log(
    `\n${uncredited.length} image(s) have no entry in public/assets/cards/credits.json.` +
      `\nASSET_LICENSES.md requires source, author, URL and licence for third-party art:`,
  );
  for (const n of uncredited.slice(0, 20)) console.log(`  ${n}`);
}
