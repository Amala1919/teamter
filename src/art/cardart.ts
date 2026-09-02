/**
 * Key-art subjects.
 *
 * Official Shadowverse illustrations are not obtainable in this environment
 * (every host that serves them is blocked by the network policy — see
 * `ASSET_LICENSES.md`), so the subject of each card's illustration is a real
 * hand-drawn shape from the **Game Icons** collection (CC BY 3.0) rather than
 * something assembled out of ellipses. `tools/build-cardart.mjs` maps every
 * card to an icon by name — "Fairy Whisperer" to a fairy, "Ninja Master" to a
 * ninja — and emits only the path data actually referenced.
 *
 * The icons are single-colour silhouettes, which is exactly what the
 * illustration pipeline wants: it lights, rims and models the shape itself.
 */

import art from '../data/generated/cardart.json';

interface IconData {
  /** SVG path `d` strings, drawn in order. */
  d: string[];
  w: number;
  h: number;
}

const DATA = art as unknown as {
  source: string;
  license: string;
  author: string;
  url: string;
  map: Record<string, string>;
  icons: Record<string, IconData>;
};

/** Credit line shown in-app and recorded in `ASSET_LICENSES.md`. */
export const CARD_ART_CREDIT = {
  source: DATA.source,
  license: DATA.license,
  author: DATA.author,
  url: DATA.url,
};

export interface Subject {
  /** Icon name, for debugging and for the asset audit tool. */
  icon: string;
  paths: Path2D[];
  /** Source viewBox, so the drawing code can fit it into any box. */
  w: number;
  h: number;
}

const cache = new Map<string, Subject | null>();

/** The icon chosen for a card, or `undefined` if it has none. */
export function iconNameFor(cardId: string): string | undefined {
  return DATA.map[cardId];
}

/**
 * The subject for a card. Path2D objects are built once per icon and shared —
 * an 825-card grid touches maybe forty distinct icons.
 */
export function subjectFor(cardId: string): Subject | null {
  const icon = DATA.map[cardId];
  if (!icon) return null;
  const hit = cache.get(icon);
  if (hit !== undefined) return hit;

  const data = DATA.icons[icon];
  let built: Subject | null = null;
  if (data && typeof Path2D !== 'undefined') {
    built = { icon, paths: data.d.map((d) => new Path2D(d)), w: data.w, h: data.h };
  }
  cache.set(icon, built);
  return built;
}

/**
 * Applies the transform that fits `subject` into a box of half-size `r`
 * centred on (cx, cy), then runs `paint`. The subject keeps its aspect ratio
 * and is nudged up slightly so a figure's mass sits above the centre line,
 * which is where the illustration seats its contact shadow.
 */
export function withSubjectTransform(
  ctx: CanvasRenderingContext2D,
  subject: Subject,
  cx: number,
  cy: number,
  r: number,
  flip: boolean,
  paint: (ctx: CanvasRenderingContext2D) => void,
): void {
  // 2r is the box height; icons are square-ish so this keeps them comparable.
  const scale = (r * 2.15) / Math.max(subject.w, subject.h);
  ctx.save();
  ctx.translate(cx, cy);
  if (flip) ctx.scale(-1, 1);
  ctx.scale(scale, scale);
  ctx.translate(-subject.w / 2, -subject.h / 2);
  paint(ctx);
  ctx.restore();
}

/** Fills the subject's silhouette in `color`. */
export function fillSubject(
  ctx: CanvasRenderingContext2D,
  subject: Subject,
  cx: number,
  cy: number,
  r: number,
  flip: boolean,
  color: string,
): void {
  withSubjectTransform(ctx, subject, cx, cy, r, flip, (c) => {
    c.fillStyle = color;
    for (const p of subject.paths) c.fill(p);
  });
}
