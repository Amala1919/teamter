/**
 * The anime character illustrator.
 *
 * Every follower that is a person gets a drawn portrait rather than a symbol:
 * head, hair, face, shoulders, costume, weapon, drawn the way cel animation
 * draws them — flat colour, one hard-edged shadow, a line on the contour, and
 * eyes that carry the whole face.
 *
 * Everything is laid out in **head units**: the head is 2 units wide and the
 * origin sits at its centre, so a change to one proportion moves everything
 * that depends on it. `drawPortrait` applies the transform that fits those
 * units into the art window.
 *
 * The parameters come from `CharacterSpec`, which `tools/build-cardart.mjs`
 * derives from the card's own name, so "Elf Guard" is an elf with a spear and
 * "Ninja Master" is a masked figure with a blade — deterministically, and the
 * same on every run.
 */
import {
  blob,
  cel,
  clampLightness,
  flat,
  mix,
  ramp,
  rgba,
  separate,
  shift,
  sliver,
  stroke,
  within,
  type Pt,
  type Ramp,
} from './celshade';

// ---------------------------------------------------------------------------
// What a character is
// ---------------------------------------------------------------------------

export type Archetype =
  | 'knight'
  | 'warrior'
  | 'mage'
  | 'priest'
  | 'archer'
  | 'rogue'
  | 'noble'
  | 'elf'
  | 'fairy'
  | 'vampire'
  | 'necromancer'
  | 'monk'
  | 'pirate'
  | 'samurai'
  | 'ninja'
  | 'angel'
  | 'demon'
  | 'child'
  | 'dwarf'
  | 'giant';

export type Weapon =
  | 'none'
  | 'sword'
  | 'greatsword'
  | 'staff'
  | 'bow'
  | 'spear'
  | 'scythe'
  | 'axe'
  | 'dagger'
  | 'wand'
  | 'book'
  | 'shield';

export type Headgear =
  | 'none'
  | 'horns'
  | 'elfEars'
  | 'halo'
  | 'hood'
  | 'crown'
  | 'hat'
  | 'mask'
  | 'helm'
  | 'bandana'
  | 'tiara';

export type Wings = 'none' | 'feathered' | 'bat' | 'fairy';

export interface CharacterSpec {
  archetype: Archetype;
  weapon?: Weapon;
  headgear?: Headgear;
  wings?: Wings;
  /** Overrides the archetype's default, for "Dark Angel" and friends. */
  dark?: boolean;
}

/** A random source with the small helpers the drawing code wants. */
export interface Rand {
  next(): number;
  range(a: number, b: number): number;
  int(n: number): number;
  pick<T>(arr: readonly T[]): T;
  bool(p?: number): boolean;
}

// ---------------------------------------------------------------------------
// Palettes
// ---------------------------------------------------------------------------

const SKINS = ['#FFE0CB', '#FBD3B8', '#F2C29E', '#E0AC86', '#C98F6C', '#A97553'];
const PALE_SKINS = ['#F6E6E4', '#EFDCDD', '#E7D2D6'];

const HAIRS = [
  '#2B2620', // black-brown
  '#1C1A22', // blue-black
  '#4A3226', // dark brown
  '#7A4A2B', // chestnut
  '#B07B3E', // honey
  '#E3C46A', // blonde
  '#F0E2C0', // platinum
  '#B33C3C', // red
  '#7E3B6B', // violet
  '#3B5EA8', // blue
  '#3E8A6B', // green
  '#C86C9A', // pink
  '#8E97A8', // ash
  '#E8EDF5', // white
];

const EYES = ['#3E7BD8', '#2FA07A', '#C4462F', '#8B5CC7', '#C9A227', '#4B4F5C', '#C86C9A', '#2AB0C4'];

/** Class-flavoured cloth colours, so a Bloodcraft card reads as one. */
const CLOTH: Record<string, string[]> = {
  forest: ['#3E7A46', '#2E5F52', '#6B8E3A', '#8FAF5C'],
  sword: ['#2E4E8C', '#8C2E3A', '#C9A227', '#D8DEE8'],
  rune: ['#3A3E8C', '#5B3A8C', '#2A6C8C', '#8C6ACD'],
  dragon: ['#8C4A1E', '#A8531B', '#6B2E1E', '#C97A2E'],
  shadow: ['#3A2A50', '#2A2333', '#5C3A6B', '#4A4458'],
  blood: ['#7A1428', '#3A1420', '#A82640', '#5A2038'],
  haven: ['#EDE5D2', '#D8CBA8', '#C9A227', '#F5EFE2'],
  neutral: ['#5A6070', '#7A6A54', '#46506B', '#8C8272'],
};

export interface Portrait {
  spec: CharacterSpec;
  skin: Ramp;
  hair: Ramp;
  hairStyle: 'short' | 'long' | 'ponytail' | 'twin' | 'bob' | 'wild' | 'braid';
  fringe: 'straight' | 'parted' | 'swept' | 'spiky';
  eye: string;
  cloth: Ramp;
  trim: Ramp;
  metal: Ramp;
  /** Turn of the head, in head units of horizontal offset. */
  turn: number;
  /** 0 = calm, 1 = fierce; drives brows and mouth. */
  fierce: number;
  /**
   * `soft` is the wide-eyed shoujo face; `sharp` is the narrow-eyed, heavy-browed,
   * square-jawed one. Without both, eight hundred cards are one character.
   */
  face: 'soft' | 'sharp';
  lineColor: string;
}

const LINE = '#241A1C';

/** Archetypes that read wrong with a soft face. */
function sharpFaced(a: Archetype): boolean {
  return (
    a === 'warrior' ||
    a === 'knight' ||
    a === 'dwarf' ||
    a === 'giant' ||
    a === 'samurai' ||
    a === 'pirate' ||
    a === 'monk' ||
    a === 'demon'
  );
}

export function rollPortrait(rng: Rand, spec: CharacterSpec, cardClass: string, cost: number): Portrait {
  const a = spec.archetype;
  const undead = a === 'necromancer' || a === 'vampire' || spec.dark === true;
  const skinBase = undead || a === 'demon' ? rng.pick(PALE_SKINS) : rng.pick(SKINS);

  // Hair colour leans on the class, then jitters, so a Runecraft mage is
  // usually cool-haired without every one of them matching.
  const classHair: Record<string, string[]> = {
    forest: ['#3E8A6B', '#E3C46A', '#B07B3E', '#F0E2C0'],
    sword: ['#E3C46A', '#7A4A2B', '#2B2620', '#B33C3C'],
    rune: ['#3B5EA8', '#7E3B6B', '#F0E2C0', '#C86C9A'],
    dragon: ['#B33C3C', '#7A4A2B', '#E3C46A', '#2B2620'],
    shadow: ['#1C1A22', '#7E3B6B', '#8E97A8', '#E8EDF5'],
    blood: ['#1C1A22', '#B33C3C', '#7E3B6B', '#E8EDF5'],
    haven: ['#F0E2C0', '#E3C46A', '#E8EDF5', '#B07B3E'],
    neutral: HAIRS,
  };
  const hairBase = rng.bool(0.78) ? rng.pick(classHair[cardClass] ?? HAIRS) : rng.pick(HAIRS);

  // A near-black garment on a dark card is a hole in the illustration: the
  // torso loses its silhouette and the figure ends at the chin.
  const clothBase = separate(rng.pick(CLOTH[cardClass] ?? CLOTH.neutral), '#000000', 0.2);
  const trimBase =
    cardClass === 'haven' || cardClass === 'sword'
      ? rng.pick(['#E8C24A', '#F5E4A8', '#D8DEE8'])
      : rng.pick(['#C9A227', '#D8DEE8', '#8C7A54', shift(clothBase, 0.02, 0, 0.24)]);

  const longish: Portrait['hairStyle'][] = ['long', 'ponytail', 'twin', 'braid'];
  const shortish: Portrait['hairStyle'][] = ['short', 'bob', 'wild'];
  const hairStyle =
    a === 'knight' || a === 'samurai' || a === 'monk' || a === 'dwarf'
      ? rng.pick(shortish)
      : a === 'fairy' || a === 'noble' || a === 'angel'
        ? rng.pick(longish)
        : rng.pick([...shortish, ...longish]);

  return {
    spec,
    skin: ramp(skinBase, 0.75),
    // Very dark hair loses its locks entirely against a dark background; very
    // pale hair goes the other way and every lock turns into a white blade with
    // no shading left in it. Both ends get pulled back into the usable band.
    hair: ramp(clampLightness(shift(hairBase, 0, 0, 0.06), 0.26, 0.8), 1.1),
    hairStyle,
    fringe: rng.pick(['straight', 'parted', 'swept', 'spiky'] as const),
    eye: undead ? rng.pick(['#C4462F', '#8B5CC7', '#C9A227']) : rng.pick(EYES),
    cloth: ramp(clothBase),
    // Trim and armour are drawn *on* the garment. If they land within a couple
    // of steps of its lightness the costume detail disappears and the torso is
    // one flat slab, which is exactly what makes card art look cheap.
    trim: ramp(separate(trimBase, clothBase, 0.18), 0.8),
    metal: ramp(
      separate(rng.pick(['#B9C3D0', '#C9A227', '#8E97A8', '#D8B865']), clothBase, 0.22),
      1.15,
    ),
    turn: rng.range(-0.18, 0.18),
    face: sharpFaced(a) ? (rng.bool(0.82) ? 'sharp' : 'soft') : rng.bool(0.3) ? 'sharp' : 'soft',
    // Bigger, costlier cards look more formidable.
    fierce: Math.min(1, cost / 9 + (a === 'demon' || a === 'warrior' || a === 'vampire' ? 0.35 : 0)),
    lineColor: LINE,
  };
}

// ---------------------------------------------------------------------------
// Geometry, in head units
// ---------------------------------------------------------------------------

const HEAD: { top: number; wide: number; jaw: number; chin: number } = {
  top: -1.22,
  wide: -0.08,
  jaw: 0.34,
  chin: 0.98,
};

function headPath(p: Portrait): (c: CanvasRenderingContext2D) => void {
  const t = p.turn;
  // A sharp face keeps its width down to the jaw instead of tapering to a point.
  const j = p.face === 'sharp' ? 1.16 : 1;
  return (c) => {
    c.beginPath();
    c.moveTo(t * 0.5, HEAD.top);
    // Right side of the skull down to the jaw and chin.
    c.bezierCurveTo(0.72 + t * 0.4, HEAD.top + 0.04, 1.0 + t * 0.25, -0.62, 1.0 + t * 0.2, HEAD.wide);
    c.bezierCurveTo(1.0 + t * 0.2, 0.2, 0.86 * j + t * 0.3, HEAD.jaw, 0.6 * j + t * 0.4, 0.62);
    c.bezierCurveTo(0.4 * j + t * 0.5, 0.85, 0.2 * j + t * 0.6, HEAD.chin, t * 0.6, HEAD.chin);
    // Left side, mirrored.
    c.bezierCurveTo(-0.2 * j + t * 0.6, HEAD.chin, -0.4 * j + t * 0.5, 0.85, -0.6 * j + t * 0.4, 0.62);
    c.bezierCurveTo(-0.86 * j + t * 0.3, HEAD.jaw, -1.0 + t * 0.2, 0.2, -1.0 + t * 0.2, HEAD.wide);
    c.bezierCurveTo(-1.0 + t * 0.25, -0.62, -0.72 + t * 0.4, HEAD.top + 0.04, t * 0.5, HEAD.top);
    c.closePath();
  };
}

// ---------------------------------------------------------------------------
// Eyes
// ---------------------------------------------------------------------------

function drawEye(
  ctx: CanvasRenderingContext2D,
  p: Portrait,
  cx: number,
  cy: number,
  w: number,
  h: number,
  flip: number,
): void {
  const lw = 0.045;

  // The white, with the upper lid cutting into it.
  const shape = (c: CanvasRenderingContext2D) => {
    c.beginPath();
    c.moveTo(cx - w * 0.5, cy + h * 0.02);
    c.bezierCurveTo(cx - w * 0.42, cy - h * 0.58, cx + w * 0.34, cy - h * 0.62, cx + w * 0.5, cy - h * 0.1);
    c.bezierCurveTo(cx + w * 0.46, cy + h * 0.42, cx - w * 0.2, cy + h * 0.54, cx - w * 0.5, cy + h * 0.02);
    c.closePath();
  };
  flat(ctx, shape, '#FBF6F4');

  within(ctx, shape, (c) => {
    // Iris: a tall oval, dark at the top and luminous at the bottom.
    const ir = w * 0.42;
    const g = c.createLinearGradient(cx, cy - ir, cx, cy + ir * 1.25);
    g.addColorStop(0, shift(p.eye, 0, 0.1, -0.26));
    g.addColorStop(0.55, p.eye);
    g.addColorStop(1, shift(p.eye, 0.01, 0.05, 0.22));
    c.fillStyle = g;
    c.beginPath();
    c.ellipse(cx, cy + h * 0.02, ir, ir * 1.22, 0, 0, Math.PI * 2);
    c.fill();

    // Pupil and the ring of darker iris around it.
    c.fillStyle = rgba('#120C14', 0.9);
    c.beginPath();
    c.ellipse(cx, cy + h * 0.03, ir * 0.42, ir * 0.62, 0, 0, Math.PI * 2);
    c.fill();

    // Light gathering at the bottom of the iris — the anime "wet" look.
    c.fillStyle = rgba(shift(p.eye, 0.02, 0, 0.34), 0.85);
    c.beginPath();
    c.ellipse(cx, cy + ir * 0.72, ir * 0.62, ir * 0.34, 0, 0, Math.PI * 2);
    c.fill();

    // Shadow cast by the upper lid across the top of the eye.
    c.fillStyle = rgba('#2A1A2A', 0.32);
    c.fillRect(cx - w, cy - h, w * 2, h * 0.52);
  });

  // Specular highlights: one big, one small, opposite corners.
  flat(
    ctx,
    (c) => {
      c.beginPath();
      c.ellipse(cx - flip * w * 0.16, cy - h * 0.2, w * 0.15, w * 0.19, 0.3, 0, Math.PI * 2);
      c.closePath();
    },
    '#FFFFFF',
  );
  flat(
    ctx,
    (c) => {
      c.beginPath();
      c.ellipse(cx + flip * w * 0.2, cy + h * 0.24, w * 0.08, w * 0.07, 0, 0, Math.PI * 2);
      c.closePath();
    },
    rgba('#FFFFFF', 0.8),
  );

  // Upper lash line: the heaviest line on the whole face.
  ctx.save();
  ctx.strokeStyle = p.lineColor;
  ctx.lineCap = 'round';
  ctx.lineWidth = lw * 2.4;
  stroke(ctx, [
    [cx - w * 0.54, cy + h * 0.04],
    [cx - w * 0.3, cy - h * 0.52],
    [cx + w * 0.2, cy - h * 0.56],
    [cx + w * 0.54, cy - h * 0.1],
  ]);
  ctx.stroke();
  // Outer lash flick.
  ctx.lineWidth = lw * 1.6;
  stroke(ctx, [
    [cx + flip * w * 0.5, cy - h * 0.14],
    [cx + flip * w * 0.66, cy - h * 0.34],
  ]);
  ctx.stroke();
  // Lower lid, much lighter.
  ctx.lineWidth = lw * 0.9;
  ctx.strokeStyle = rgba(p.lineColor, 0.55);
  stroke(ctx, [
    [cx - w * 0.42, cy + h * 0.2],
    [cx - w * 0.05, cy + h * 0.46],
    [cx + w * 0.42, cy + h * 0.3],
  ]);
  ctx.stroke();
  ctx.restore();
}

function drawBrow(
  ctx: CanvasRenderingContext2D,
  p: Portrait,
  cx: number,
  cy: number,
  w: number,
  flip: number,
): void {
  // A fierce character's brows angle down toward the nose.
  const inner = cy + p.fierce * 0.1;
  const outer = cy - p.fierce * 0.05;
  ctx.save();
  ctx.strokeStyle = mix(p.hair.shade, p.lineColor, 0.35);
  ctx.lineCap = 'round';
  ctx.lineWidth = p.face === 'sharp' ? 0.1 : 0.062;
  stroke(ctx, [
    [cx - flip * w * 0.5, inner],
    [cx, outer - 0.03],
    [cx + flip * w * 0.5, outer + 0.02],
  ]);
  ctx.stroke();
  ctx.restore();
}

function drawFace(ctx: CanvasRenderingContext2D, p: Portrait): void {
  const t = p.turn;
  const sharp = p.face === 'sharp';
  const eyeY = sharp ? 0.24 : 0.2;
  const eyeW = sharp ? 0.52 : 0.5;
  const eyeH = sharp ? 0.37 : 0.45;
  const sep = 0.43;

  drawEye(ctx, p, t * 0.75 - sep, eyeY, eyeW, eyeH, -1);
  drawEye(ctx, p, t * 0.75 + sep, eyeY, eyeW, eyeH, 1);
  drawBrow(ctx, p, t * 0.8 - sep, eyeY - (sharp ? 0.32 : 0.4), 0.44, -1);
  drawBrow(ctx, p, t * 0.8 + sep, eyeY - (sharp ? 0.32 : 0.4), 0.44, 1);

  // A touch of blush warms a soft face; a sharp one does not get it.
  if (!sharp) {
    ctx.save();
    ctx.globalAlpha = 0.32;
    ctx.fillStyle = '#F0785E';
    ctx.filter = 'blur(3px)';
    for (const s2 of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(t * 0.85 + s2 * 0.62, 0.5, 0.24, 0.11, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // Nose: one short stroke, no nostrils. Anything more reads as western art.
  ctx.save();
  ctx.strokeStyle = rgba(p.skin.shade, 0.85);
  ctx.lineCap = 'round';
  ctx.lineWidth = 0.05;
  stroke(ctx, [
    [t * 0.9 + 0.04, 0.5],
    [t * 0.9 + 0.09, 0.6],
    [t * 0.9 + 0.02, 0.63],
  ]);
  ctx.stroke();

  // Mouth: a small line, curved by mood.
  const mx = t * 0.95;
  const my = 0.76;
  ctx.strokeStyle = mix(p.skin.shade, p.lineColor, 0.55);
  ctx.lineWidth = 0.05;
  const curve = 0.05 - p.fierce * 0.09;
  stroke(ctx, [
    [mx - 0.14, my],
    [mx, my + curve],
    [mx + 0.14, my],
  ]);
  ctx.stroke();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Hair
// ---------------------------------------------------------------------------

function drawBackHair(ctx: CanvasRenderingContext2D, p: Portrait, rng: Rand, light: number): void {
  const style = p.hairStyle;
  if (style === 'short') return;

  const drop = style === 'long' || style === 'braid' ? 3.5 : style === 'bob' ? 1.5 : 2.6;
  // Wider than the head, but not so much wider that the part left visible above
  // the shoulders is a plain dome with the face parked in front of it.
  const spread = style === 'wild' ? 1.66 : 1.3;
  const tones = {
    base: shift(p.hair.shade, 0, 0.02, -0.05),
    shade: shift(p.hair.shade, 0, 0.04, -0.15),
    light: p.hair.base,
  };

  // The mass, then pointed tips hanging off it. A rounded blob reads as a
  // helmet; hair ends in points.
  const path = (c: CanvasRenderingContext2D) =>
    blob(
      c,
      [
        // Narrow at the crown so the mass tucks behind the head instead of
        // doming over it, widest at cheek height, then tapering to the tips.
        [-0.48, -1.42],
        [-spread * 0.84, -0.62],
        [-spread, 0.55],
        [-spread * 1.02, drop * 0.6],
        [-spread * 0.62, drop * 0.94],
        [0, drop],
        [spread * 0.62, drop * 0.94],
        [spread * 1.02, drop * 0.6],
        [spread, 0.55],
        [spread * 0.84, -0.62],
        [0.48, -1.42],
      ],
      0.9,
    );
  cel(ctx, path, tones, { x: -spread, y: -1.2, w: spread * 2, h: drop + 1.2 }, {
    angle: light,
    coverage: 0.5,
    line: p.lineColor,
    lineWidth: 0.055,
  });

  // Tips, which is where the silhouette gets its character.
  const tips = style === 'wild' ? 7 : 5;
  for (let i = 0; i < tips; i++) {
    const u = i / (tips - 1);
    const x = -spread * 0.85 + u * spread * 1.7;
    const len = rng.range(0.5, 1.15) * (style === 'wild' ? 1.3 : 1);
    const from: Pt = [x, drop * (0.62 + rng.range(-0.1, 0.1))];
    const to: Pt = [x * 1.25 + rng.range(-0.2, 0.2), drop * 0.92 + len];
    cel(ctx, (c) => sliver(c, from, to, rng.range(0.16, 0.3), rng.range(-0.2, 0.2)), tones, {
      x: x - 0.5,
      y: from[1],
      w: 1,
      h: len + 0.5,
    }, { angle: light, coverage: 0.5, line: p.lineColor, lineWidth: 0.05 });
  }

  within(ctx, path, (c) => {
    c.strokeStyle = rgba(shift(p.hair.shade, 0, 0, -0.13), 0.85);
    c.lineCap = 'round';
    for (let i = 0; i < 7; i++) {
      const x = -spread * 0.8 + (i / 6) * spread * 1.6 + rng.range(-0.1, 0.1);
      c.lineWidth = rng.range(0.035, 0.08);
      stroke(c, [
        [x * 0.55, -0.8],
        [x * 0.85, drop * 0.45],
        [x, drop * 0.95],
      ]);
      c.stroke();
    }
  });

  if (style === 'twin') {
    for (const s of [-1, 1]) {
      const tail = (c: CanvasRenderingContext2D) =>
        blob(
          c,
          [
            [s * 1.0, -0.5],
            [s * 1.8, 0.2],
            [s * 2.0, 1.7],
            [s * 1.35, 2.9],
            [s * 1.15, 1.4],
            [s * 0.9, 0.3],
          ],
          0.88,
        );
      cel(ctx, tail, p.hair, { x: s > 0 ? 0.9 : -2.1, y: -0.6, w: 1.2, h: 3.6 }, {
        angle: light,
        coverage: 0.46,
        line: p.lineColor,
        lineWidth: 0.05,
      });
    }
  }
  if (style === 'ponytail') {
    const s = p.turn >= 0 ? 1 : -1;
    const tail = (c: CanvasRenderingContext2D) =>
      blob(
        c,
        [
          [s * 0.6, -1.15],
          [s * 1.9, -0.75],
          [s * 2.45, 0.8],
          [s * 1.9, 2.6],
          [s * 1.5, 2.5],
          [s * 1.25, 0.9],
          [s * 0.8, -0.2],
        ],
        0.88,
      );
    cel(ctx, tail, p.hair, { x: s > 0 ? 0.5 : -2.5, y: -1.3, w: 2, h: 4 }, {
      angle: light,
      coverage: 0.46,
      line: p.lineColor,
      lineWidth: 0.05,
    });
  }
}

function drawFrontHair(ctx: CanvasRenderingContext2D, p: Portrait, rng: Rand, light: number): void {
  const t = p.turn;
  // A closed helm covers the hairline; a fringe under it shows through the eye
  // opening as a row of pale spikes.
  const helmeted = (p.spec.headgear ?? 'none') === 'helm';

  // The cap over the skull, reaching low enough that the fringe grows out of
  // it rather than being stuck on below it.
  const cap = (c: CanvasRenderingContext2D) => {
    c.beginPath();
    c.moveTo(-1.1 + t * 0.2, 0.1);
    c.bezierCurveTo(-1.18 + t * 0.2, -0.9, -0.7 + t * 0.4, -1.5, t * 0.5, -1.5);
    c.bezierCurveTo(0.7 + t * 0.4, -1.5, 1.18 + t * 0.2, -0.9, 1.1 + t * 0.2, 0.1);
    c.bezierCurveTo(1.0 + t * 0.2, -0.42, 0.62 + t * 0.3, -0.62, t * 0.5, -0.6);
    c.bezierCurveTo(-0.62 + t * 0.3, -0.62, -1.0 + t * 0.2, -0.42, -1.1 + t * 0.2, 0.1);
    c.closePath();
  };
  if (!helmeted) {
    cel(ctx, cap, p.hair, { x: -1.25, y: -1.6, w: 2.5, h: 1.8 }, {
      angle: light,
      coverage: 0.44,
      line: p.lineColor,
      lineWidth: 0.055,
    });
    // The gloss band across the crown: one arc, broken into segments, following
    // the curve of the skull. Free-floating ellipses read as paint spatter.
    // It belongs to the cap, so it goes down *before* the fringe — painted over
    // the locks it turns them into a row of pale tabs.
    within(ctx, cap, (c) => {
      c.fillStyle = rgba(p.hair.light, 0.5);
      const top: Pt[] = [];
      const bot: Pt[] = [];
      for (let i = 0; i <= 12; i++) {
        const u = i / 12;
        const x = -0.98 + u * 1.96 + t * 0.25;
        const off = Math.abs(x - t * 0.25);
        const y = -1.06 + off * off * 0.26;
        // A wave, so the band is not a flat stripe.
        const wob = Math.sin(u * Math.PI * 3.1) * 0.04;
        top.push([x, y - 0.08 + wob]);
        bot.push([x, y + 0.08 + wob]);
      }
      c.beginPath();
      c.moveTo(top[0][0], top[0][1]);
      for (const q of top.slice(1)) c.lineTo(q[0], q[1]);
      for (const q of bot.reverse()) c.lineTo(q[0], q[1]);
      c.closePath();
      c.fill();
    });
  }

  // Fringe. Locks are wide and overlap by about half, drawn outward from the
  // parting so the later ones sit over the earlier ones.
  const n = p.fringe === 'spiky' ? 11 : 9;
  const partAt = p.fringe === 'parted' ? rng.range(-0.4, 0.4) : 99;
  const order: number[] = [];
  for (let i = 0; i < n; i++) order.push(i);
  order.sort((a, b) => Math.abs(b - (n - 1) / 2) - Math.abs(a - (n - 1) / 2));
  for (const i of helmeted ? [] : order) {
    const u = i / (n - 1);
    const x = -1.05 + u * 2.1 + t * 0.25;
    const off = x - t * 0.25;
    if (Math.abs(off - partAt) < 0.2) continue;
    // Roots sit up under the crown so a lock is long enough to *hang*: a short,
    // wide one is a plank, and eleven of them are a picket fence.
    const rootY = -1.34 + Math.abs(off) * 0.1;
    const sweep = p.fringe === 'swept' ? 0.38 : p.fringe === 'spiky' ? rng.range(-0.28, 0.28) : 0;
    // Locks stop just above the eyes; one or two hang past them for interest.
    // Eyes sit at y≈0.2 with their tops near −0.2, so a lock that reaches much
    // past y≈0 is hanging in front of the face rather than framing it.
    const long = rng.bool(0.16);
    const len = (long ? rng.range(1.26, 1.46) : rng.range(0.86, 1.16)) * (p.fringe === 'spiky' ? rng.range(0.9, 1.12) : 1);
    const tipX = x + sweep + off * 0.22;
    const tipY = rootY + len;
    const w = rng.range(0.18, 0.27);
    const lock = (c: CanvasRenderingContext2D) => sliver(c, [x, rootY], [tipX, tipY], w, rng.range(-0.16, 0.16));
    cel(ctx, lock, p.hair, { x: x - 0.5, y: rootY - 0.2, w: 1, h: len + 0.4 }, {
      angle: light,
      coverage: 0.46,
      line: p.lineColor,
      lineWidth: 0.042,
      edge: 0,
    });
    // The gloss, drawn inside the lock so it can never land on skin.
    within(ctx, lock, (c) => {
      c.fillStyle = rgba(p.hair.light, 0.68);
      c.beginPath();
      c.ellipse(x + sweep * 0.24, rootY + 0.52, w * 0.6, 0.22, 0, 0, Math.PI * 2);
      c.fill();
    });
  }

  // Side locks framing the cheeks. They stop around the jaw: run them to the
  // collarbone and they read as tusks rather than hair.
  for (const s of [-1, 1]) {
    const len = p.hairStyle === 'bob' ? 1.15 : 1.6;
    const lock = (c: CanvasRenderingContext2D) =>
      sliver(c, [s * (1.02 + t * 0.2), -0.72], [s * (0.94 + t * 0.3), len], 0.17, s * 0.14);
    cel(ctx, lock, p.hair, { x: s > 0 ? 0.6 : -1.3, y: -0.8, w: 0.8, h: len + 0.9 }, {
      angle: light,
      coverage: 0.46,
      line: p.lineColor,
      lineWidth: 0.045,
      edge: 0,
    });
  }

}

// ---------------------------------------------------------------------------
// Body and costume
// ---------------------------------------------------------------------------

/** Shoulder half-width and where the frame crops the figure, per archetype. */
function build(p: Portrait): { sw: number; neck: number; bottom: number } {
  const a = p.spec.archetype;
  const broad = a === 'warrior' || a === 'knight' || a === 'giant' || a === 'dwarf' || a === 'samurai';
  const slight = a === 'child' || a === 'fairy' || a === 'mage' || a === 'noble';
  return {
    sw: broad ? 2.15 : slight ? 1.6 : 1.85,
    neck: broad ? 0.38 : slight ? 0.27 : 0.32,
    bottom: 4.2,
  };
}

/** The silhouette of the shoulders, chest and upper arms. */
function torsoPath(p: Portrait): (c: CanvasRenderingContext2D) => void {
  const { sw, bottom } = build(p);
  const t = p.turn;
  return (c) => {
    c.beginPath();
    c.moveTo(-0.34 + t * 0.3, 1.42);
    // Trapezius out to the shoulder, then the shoulder ball.
    c.bezierCurveTo(-0.95 + t * 0.2, 1.5, -sw * 0.82, 1.62, -sw, 2.02);
    // Outer arm, dropping and widening a little.
    c.bezierCurveTo(-sw - 0.13, 2.5, -sw - 0.16, 3.2, -sw - 0.12, bottom);
    c.lineTo(sw + 0.12, bottom);
    c.bezierCurveTo(sw + 0.16, 3.2, sw + 0.13, 2.5, sw, 2.02);
    c.bezierCurveTo(sw * 0.82, 1.62, 0.95 + t * 0.2, 1.5, 0.34 + t * 0.3, 1.42);
    c.closePath();
  };
}

function drawCloak(ctx: CanvasRenderingContext2D, p: Portrait, light: number): void {
  const a = p.spec.archetype;
  if (!(a === 'mage' || a === 'rogue' || a === 'vampire' || a === 'necromancer' || a === 'noble' || a === 'priest')) {
    return;
  }
  const { sw, bottom } = build(p);
  cel(
    ctx,
    (c) =>
      blob(
        c,
        [
          [-sw * 0.95, 1.75],
          [-sw * 1.7, 2.6],
          [-sw * 1.55, bottom],
          [sw * 1.55, bottom],
          [sw * 1.7, 2.6],
          [sw * 0.95, 1.75],
        ],
        0.85,
      ),
    ramp(shift(p.cloth.base, 0.01, 0.06, -0.19)),
    { x: -sw * 1.8, y: 1.7, w: sw * 3.6, h: bottom - 1.7 },
    { angle: light, coverage: 0.52, line: p.lineColor, lineWidth: 0.06 },
  );
}

function drawBody(ctx: CanvasRenderingContext2D, p: Portrait, rng: Rand, light: number): void {
  const a = p.spec.archetype;
  const { sw, neck, bottom } = build(p);
  const t = p.turn;

  // Neck, with the shadow the jaw casts on it.
  cel(
    ctx,
    (c) => {
      c.beginPath();
      c.moveTo(-neck + t * 0.5, 0.66);
      c.bezierCurveTo(-neck - 0.03 + t * 0.45, 1.1, -neck - 0.06 + t * 0.4, 1.3, -neck - 0.12 + t * 0.35, 1.5);
      c.lineTo(neck + 0.12 + t * 0.35, 1.5);
      c.bezierCurveTo(neck + 0.06 + t * 0.4, 1.3, neck + 0.03 + t * 0.45, 1.1, neck + t * 0.5, 0.66);
      c.closePath();
    },
    p.skin,
    { x: -neck - 0.2, y: 0.6, w: neck * 2 + 0.4, h: 0.95 },
    { angle: light, coverage: 0.68, line: p.lineColor, lineWidth: 0.05 },
  );
  flat(
    ctx,
    (c) => {
      c.beginPath();
      c.ellipse(t * 0.5, 0.78, neck + 0.1, 0.3, 0, 0, Math.PI * 2);
    },
    rgba(p.skin.shade, 0.85),
  );

  // Body.
  const torso = torsoPath(p);
  cel(ctx, torso, p.cloth, { x: -sw - 0.2, y: 1.4, w: sw * 2 + 0.4, h: bottom - 1.4 }, {
    angle: light,
    coverage: 0.34,
    line: p.lineColor,
    lineWidth: 0.065,
  });

  within(ctx, torso, (c) => {
    // Where each arm meets the chest. Without these the torso is one lump.
    c.strokeStyle = rgba(p.cloth.shade, 0.9);
    c.lineCap = 'round';
    c.lineWidth = 0.075;
    for (const s of [-1, 1]) {
      stroke(c, [
        [s * (sw - 0.42), 2.25],
        [s * (sw - 0.52), 3.0],
        [s * (sw - 0.46), bottom],
      ]);
      c.stroke();
    }
    // A few folds in the cloth between them.
    c.lineWidth = 0.05;
    c.strokeStyle = rgba(p.cloth.shade, 0.6);
    for (let i = 0; i < 4; i++) {
      const x = rng.range(-sw * 0.6, sw * 0.6);
      stroke(c, [
        [x, 2.4 + rng.range(0, 0.5)],
        [x + rng.range(-0.2, 0.2), bottom],
      ]);
      c.stroke();
    }
  });

  // Collar and neckline.
  if (a === 'priest' || a === 'monk' || a === 'angel' || a === 'noble' || a === 'mage') {
    cel(
      ctx,
      (c) => {
        c.beginPath();
        c.moveTo(-0.78 + t * 0.3, 1.46);
        c.bezierCurveTo(-0.66 + t * 0.3, 2.02, 0.66 + t * 0.3, 2.02, 0.78 + t * 0.3, 1.46);
        c.lineTo(0.42 + t * 0.35, 1.4);
        c.bezierCurveTo(0.34 + t * 0.35, 1.76, -0.34 + t * 0.35, 1.76, -0.42 + t * 0.35, 1.4);
        c.closePath();
      },
      p.trim,
      { x: -0.85, y: 1.35, w: 1.7, h: 0.8 },
      { angle: light, coverage: 0.4, line: p.lineColor, lineWidth: 0.05 },
    );
    flat(
      ctx,
      (c) => {
        c.beginPath();
        c.moveTo(-0.17, 1.95);
        c.lineTo(0.17, 1.95);
        c.lineTo(0.24, bottom);
        c.lineTo(-0.24, bottom);
        c.closePath();
      },
      p.trim.base,
      p.lineColor,
      0.045,
    );
  } else {
    within(ctx, torso, (c) => {
      c.fillStyle = rgba(p.cloth.shade, 0.85);
      c.beginPath();
      c.moveTo(-0.66 + t * 0.3, 1.45);
      c.lineTo(t * 0.3, 2.62);
      c.lineTo(0.66 + t * 0.3, 1.45);
      c.closePath();
      c.fill();
    });
    // A strap or belt across the chest for the unarmoured archetypes.
    if (a === 'archer' || a === 'rogue' || a === 'pirate' || a === 'ninja' || a === 'warrior') {
      within(ctx, torso, (c) => {
        c.strokeStyle = p.trim.base;
        c.lineWidth = 0.26;
        stroke(c, [
          [-sw * 0.95, 2.35],
          [0, 3.0],
          [sw * 0.95, 2.2],
        ]);
        c.stroke();
        c.strokeStyle = rgba(p.lineColor, 0.55);
        c.lineWidth = 0.04;
        c.stroke();
      });
    }
  }

  // Costume detail. A flat colour with two arm seams is a board with sleeves;
  // these are the marks that make it read as a garment.
  within(ctx, torso, (c) => {
    if (a === 'knight' || a === 'warrior' || a === 'samurai' || a === 'giant' || a === 'dwarf') {
      // Breastplate: a curved plate with a raised centre ridge.
      c.fillStyle = rgba(p.metal.base, 0.95);
      c.beginPath();
      c.moveTo(-sw * 0.62, 2.05);
      c.bezierCurveTo(-sw * 0.5, 2.6, -sw * 0.34, 3.4, 0, 3.9);
      c.bezierCurveTo(sw * 0.34, 3.4, sw * 0.5, 2.6, sw * 0.62, 2.05);
      c.bezierCurveTo(sw * 0.3, 2.35, -sw * 0.3, 2.35, -sw * 0.62, 2.05);
      c.closePath();
      c.fill();
      c.strokeStyle = rgba(p.lineColor, 0.6);
      c.lineWidth = 0.055;
      c.stroke();
      c.strokeStyle = rgba(p.metal.light, 0.8);
      c.lineWidth = 0.07;
      stroke(c, [
        [0, 2.35],
        [0, 3.8],
      ]);
      c.stroke();
    } else if (a === 'priest' || a === 'monk' || a === 'angel' || a === 'noble' || a === 'mage') {
      // A stole hanging over the shoulders.
      c.fillStyle = rgba(p.trim.base, 0.9);
      for (const s2 of [-1, 1]) {
        c.beginPath();
        c.moveTo(s2 * 0.42, 1.9);
        c.lineTo(s2 * 0.86, 2.0);
        c.lineTo(s2 * 1.05, bottom);
        c.lineTo(s2 * 0.55, bottom);
        c.closePath();
        c.fill();
      }
      c.strokeStyle = rgba(p.lineColor, 0.45);
      c.lineWidth = 0.05;
      c.stroke();
    } else {
      // A laced or buttoned front.
      c.fillStyle = rgba(p.trim.base, 0.55);
      for (let i = 0; i < 4; i++) {
        c.beginPath();
        c.ellipse(0, 2.6 + i * 0.42, 0.075, 0.075, 0, 0, Math.PI * 2);
        c.fill();
      }
    }
  });

  // Pauldrons: caps that sit on the shoulder, following its curve.
  if (a === 'knight' || a === 'warrior' || a === 'samurai' || a === 'giant') {
    for (const s of [-1, 1]) {
      const plate = (c: CanvasRenderingContext2D) => {
        c.beginPath();
        c.moveTo(s * (sw * 0.62), 1.8);
        c.bezierCurveTo(s * (sw * 0.92), 1.6, s * (sw + 0.16), 1.8, s * (sw + 0.22), 2.2);
        c.lineTo(s * (sw + 0.1), 2.66);
        c.lineTo(s * (sw * 0.66), 2.52);
        c.closePath();
      };
      cel(ctx, plate, p.metal, { x: s > 0 ? sw * 0.4 : -sw - 0.4, y: 1.5, w: sw * 0.8, h: 1.5 }, {
        angle: light,
        coverage: 0.4,
        line: p.lineColor,
        lineWidth: 0.06,
        rim: rgba('#FFFFFF', 0.6),
        rimWidth: 0.05,
      });
      within(ctx, plate, (c) => {
        // A ridge across the plate and a trim strip along its lower edge.
        c.strokeStyle = rgba(p.lineColor, 0.5);
        c.lineWidth = 0.055;
        stroke(c, [
          [s * (sw * 0.5), 2.16],
          [s * (sw * 0.85), 2.02],
          [s * (sw + 0.3), 2.2],
        ]);
        c.stroke();
        c.strokeStyle = p.trim.base;
        c.lineWidth = 0.09;
        stroke(c, [
          [s * (sw * 0.62), 2.46],
          [s * (sw + 0.16), 2.6],
        ]);
        c.stroke();
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Headgear, wings, weapon
// ---------------------------------------------------------------------------

/**
 * A hood or hat sits directly over the hair, so it has to differ from it. A
 * dark hood on dark hair is one silhouette with a face in it.
 */
function hoodTone(p: Portrait): string {
  return separate(shift(p.cloth.base, 0, 0.04, -0.1), p.hair.base, 0.14);
}

function drawHeadgear(ctx: CanvasRenderingContext2D, p: Portrait, light: number): void {
  const g = p.spec.headgear ?? 'none';
  const t = p.turn;

  switch (g) {
    case 'elfEars':
      for (const s of [-1, 1]) {
        cel(
          ctx,
          (c) => {
            c.beginPath();
            c.moveTo(s * (0.92 + t * 0.2), -0.12);
            c.quadraticCurveTo(s * (1.6 + t * 0.2), -0.62, s * (1.72 + t * 0.2), -1.02);
            c.quadraticCurveTo(s * (1.2 + t * 0.2), -0.6, s * (0.9 + t * 0.2), 0.26);
            c.closePath();
          },
          p.skin,
          { x: s > 0 ? 0.8 : -1.8, y: -1.1, w: 1, h: 1.4 },
          { angle: light, coverage: 0.5, line: p.lineColor, lineWidth: 0.045 },
        );
      }
      break;
    case 'horns':
      for (const s of [-1, 1]) {
        cel(
          ctx,
          (c) => {
            c.beginPath();
            c.moveTo(s * (0.62 + t * 0.3), -1.12);
            c.bezierCurveTo(s * (1.3 + t * 0.3), -1.5, s * (1.5 + t * 0.3), -2.1, s * (1.18 + t * 0.3), -2.42);
            c.bezierCurveTo(s * (1.24 + t * 0.3), -1.86, s * (0.98 + t * 0.3), -1.44, s * (0.42 + t * 0.3), -1.02);
            c.closePath();
          },
          ramp('#D8CDBE', 0.9),
          { x: s > 0 ? 0.4 : -1.6, y: -2.5, w: 1.2, h: 1.6 },
          { angle: light, coverage: 0.44, line: p.lineColor, lineWidth: 0.05 },
        );
      }
      break;
    case 'halo':
      ctx.save();
      ctx.strokeStyle = '#FFE9A8';
      ctx.lineWidth = 0.11;
      ctx.shadowColor = 'rgba(255,230,150,0.9)';
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.ellipse(t * 0.5, -1.72, 0.86, 0.24, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      break;
    case 'crown':
    case 'tiara':
      cel(
        ctx,
        (c) => {
          c.beginPath();
          const y = -1.16;
          c.moveTo(-0.86 + t * 0.3, y);
          c.lineTo(-0.86 + t * 0.3, y - 0.16);
          c.lineTo(-0.52 + t * 0.3, y - 0.52);
          c.lineTo(-0.18 + t * 0.4, y - 0.18);
          c.lineTo(t * 0.45, y - 0.66);
          c.lineTo(0.18 + t * 0.4, y - 0.18);
          c.lineTo(0.52 + t * 0.3, y - 0.52);
          c.lineTo(0.86 + t * 0.3, y - 0.16);
          c.lineTo(0.86 + t * 0.3, y);
          c.closePath();
        },
        ramp('#E8C24A', 1.1),
        { x: -0.9, y: -1.9, w: 1.8, h: 0.8 },
        { angle: light, coverage: 0.4, line: p.lineColor, lineWidth: 0.05, rim: rgba('#FFF6D8', 0.7), rimWidth: 0.04 },
      );
      break;
    case 'hood':
      cel(
        ctx,
        (c) =>
          blob(
            c,
            [
              [-1.34 + t * 0.2, 0.55],
              [-1.42 + t * 0.2, -0.85],
              [t * 0.4, -1.85],
              [1.42 + t * 0.2, -0.85],
              [1.34 + t * 0.2, 0.55],
              [0.95 + t * 0.3, 0.1],
              [t * 0.4, -0.5],
              [-0.95 + t * 0.3, 0.1],
            ],
            0.9,
          ),
        ramp(hoodTone(p)),
        { x: -1.5, y: -1.9, w: 3, h: 2.5 },
        { angle: light, coverage: 0.46, line: p.lineColor, lineWidth: 0.06 },
      );
      break;
    case 'hat':
      // A wide brim plus a cone — the witch silhouette.
      cel(
        ctx,
        (c) => {
          c.beginPath();
          c.ellipse(t * 0.4, -1.12, 1.85, 0.42, 0, 0, Math.PI * 2);
        },
        ramp(hoodTone(p)),
        { x: -1.9, y: -1.6, w: 3.8, h: 0.9 },
        { angle: light, coverage: 0.44, line: p.lineColor, lineWidth: 0.06 },
      );
      cel(
        ctx,
        (c) => {
          c.beginPath();
          c.moveTo(-0.85 + t * 0.4, -1.18);
          c.bezierCurveTo(-0.7 + t * 0.4, -2.3, -0.2 + t * 0.4, -2.8, 0.55 + t * 0.4, -3.1);
          c.bezierCurveTo(0.5 + t * 0.4, -2.3, 0.72 + t * 0.4, -1.5, 0.85 + t * 0.4, -1.18);
          c.closePath();
        },
        ramp(shift(hoodTone(p), 0, 0, 0.05)),
        { x: -1, y: -3.2, w: 2, h: 2.1 },
        { angle: light, coverage: 0.44, line: p.lineColor, lineWidth: 0.06 },
      );
      break;
    case 'helm': {
      // A brow band and cheek guards around an open face, plus a crest. A plain
      // dome over the hair reads as a swimming cap.
      const shell = (c: CanvasRenderingContext2D) => {
        c.beginPath();
        c.moveTo(-1.16 + t * 0.2, 0.3);
        c.bezierCurveTo(-1.26 + t * 0.2, -0.9, -0.72 + t * 0.4, -1.62, t * 0.5, -1.62);
        c.bezierCurveTo(0.72 + t * 0.4, -1.62, 1.26 + t * 0.2, -0.9, 1.16 + t * 0.2, 0.3);
        // One wide opening. Splitting it with a nose guard turns the helm into
        // a pair of goggles at this size.
        c.lineTo(0.9 + t * 0.3, 0.34);
        c.bezierCurveTo(0.92 + t * 0.3, -0.3, 0.6 + t * 0.35, -0.56, t * 0.4, -0.56);
        c.bezierCurveTo(-0.6 + t * 0.35, -0.56, -0.92 + t * 0.3, -0.3, -0.9 + t * 0.3, 0.34);
        c.closePath();
      };
      cel(ctx, shell, p.metal, { x: -1.3, y: -1.7, w: 2.6, h: 2.1 }, {
        angle: light,
        coverage: 0.4,
        line: p.lineColor,
        lineWidth: 0.06,
        rim: rgba('#FFFFFF', 0.6),
        rimWidth: 0.05,
      });
      within(ctx, shell, (c) => {
        c.strokeStyle = rgba(p.trim.base, 0.95);
        c.lineWidth = 0.13;
        stroke(c, [
          [-1.2 + t * 0.2, -0.66],
          [t * 0.4, -0.86],
          [1.2 + t * 0.2, -0.66],
        ]);
        c.stroke();
      });
      // Crest.
      cel(
        ctx,
        (c) => sliver(c, [t * 0.5, -1.55], [t * 0.5 - 0.1, -2.35], 0.16, 0.1),
        p.trim,
        { x: -0.4, y: -2.4, w: 0.8, h: 1 },
        { angle: light, coverage: 0.42, line: p.lineColor, lineWidth: 0.05 },
      );
      break;
    }
    case 'bandana':
    case 'mask':
      flat(
        ctx,
        (c) => {
          c.beginPath();
          c.moveTo(-1.02 + t * 0.2, g === 'mask' ? 0.42 : -0.62);
          c.lineTo(1.02 + t * 0.2, g === 'mask' ? 0.34 : -0.7);
          c.lineTo(1.0 + t * 0.2, g === 'mask' ? 1.0 : -0.28);
          c.lineTo(-1.0 + t * 0.2, g === 'mask' ? 1.05 : -0.2);
          c.closePath();
        },
        g === 'mask' ? rgba('#1E1A22', 0.94) : p.trim.base,
        p.lineColor,
        0.05,
      );
      break;
    default:
      break;
  }
}

function drawWings(ctx: CanvasRenderingContext2D, p: Portrait, light: number): void {
  const w = p.spec.wings ?? 'none';
  if (w === 'none') return;

  ctx.save();
  for (const s of [-1, 1]) {
    if (w === 'feathered') {
      const tones = ramp(p.spec.dark ? '#3A3242' : '#F6F2E8', 0.7);
      for (let i = 0; i < 5; i++) {
        const u = i / 4;
        const len = 3.4 - u * 0.7;
        cel(
          ctx,
          (c) => sliver(c, [s * 1.5, 1.5], [s * (1.4 + len * 0.85), 1.5 - len * (0.62 - u * 0.5)], 0.34 - u * 0.06, s * 0.4),
          tones,
          { x: s > 0 ? 1 : -5, y: -2, w: 4, h: 5 },
          { angle: light, coverage: 0.42, line: rgba(p.lineColor, 0.7), lineWidth: 0.05 },
        );
      }
    } else if (w === 'bat') {
      cel(
        ctx,
        (c) => {
          c.beginPath();
          c.moveTo(s * 1.4, 1.6);
          c.quadraticCurveTo(s * 3.4, -0.9, s * 4.5, -1.5);
          c.quadraticCurveTo(s * 4.0, -0.2, s * 4.2, 0.5);
          c.quadraticCurveTo(s * 3.4, 0.1, s * 3.3, 1.0);
          c.quadraticCurveTo(s * 2.6, 0.5, s * 2.4, 1.5);
          c.quadraticCurveTo(s * 1.9, 1.2, s * 1.4, 1.6);
          c.closePath();
        },
        ramp('#3A2030', 1.05),
        { x: s > 0 ? 1 : -4.6, y: -1.6, w: 3.6, h: 3.4 },
        { angle: light, coverage: 0.46, line: p.lineColor, lineWidth: 0.06 },
      );
    } else {
      // Fairy wings: translucent, veined, catching the light.
      ctx.save();
      ctx.globalAlpha = 0.55;
      cel(
        ctx,
        (c) => {
          c.beginPath();
          c.ellipse(s * 2.5, 0.5, 1.5, 0.75, s * -0.55, 0, Math.PI * 2);
        },
        ramp('#CFF3FF', 0.5),
        { x: s > 0 ? 1 : -4, y: -1.5, w: 3, h: 3 },
        { angle: light, coverage: 0.35, line: rgba('#8FD0FF', 0.8), lineWidth: 0.05 },
      );
      ctx.restore();
    }
  }
  ctx.restore();
}

/** A fist closed around the grip, at the weapon's local origin. */
function drawGrip(ctx: CanvasRenderingContext2D, p: Portrait, light: number, at: number): void {
  const glove = p.spec.archetype === 'mage' || p.spec.archetype === 'priest' ? p.skin : ramp(shift(p.cloth.base, 0, 0.04, -0.22), 0.9);
  const fist = (c: CanvasRenderingContext2D) => {
    c.beginPath();
    c.ellipse(0, at, 0.29, 0.34, 0, 0, Math.PI * 2);
  };
  cel(ctx, fist, glove, { x: -0.32, y: at - 0.36, w: 0.64, h: 0.72 }, {
    angle: light,
    coverage: 0.44,
    line: p.lineColor,
    lineWidth: 0.05,
  });
  within(ctx, fist, (c) => {
    c.strokeStyle = rgba(p.lineColor, 0.45);
    c.lineWidth = 0.042;
    for (let i = 0; i < 3; i++) {
      const y = at - 0.16 + i * 0.16;
      stroke(c, [
        [-0.26, y],
        [0.26, y - 0.03],
      ]);
      c.stroke();
    }
  });
}

function drawWeapon(ctx: CanvasRenderingContext2D, p: Portrait, lightIn: number): void {
  const w = p.spec.weapon ?? 'none';
  if (w === 'none') return;
  const s = p.turn >= 0 ? 1 : -1;
  const light = s < 0 ? Math.PI - lightIn : lightIn;
  const wood = ramp('#6B4A2E', 0.9);

  // A long haft drawn at full length leaves the art window and reads as a bare
  // stick: only the shaft is inside the frame. Long weapons are scaled about
  // the grip so the head stays visible; the hand is drawn at full size after.
  const REACH: Partial<Record<Weapon, number>> = {
    staff: 0.72,
    scythe: 0.68,
    spear: 0.74,
    greatsword: 0.84,
    axe: 0.9,
  };
  const reach = REACH[w] ?? 1;

  // The art window leaves about 1.7 head-units above the head's centre and 2.9
  // to the side, so a weapon's head has to land in the upper outer corner: any
  // further up is cropped, any further in is behind the face.
  ctx.save();
  ctx.translate(s * 1.85, 1.0);
  // Mirrored so every weapon can be authored for the right hand with +x
  // pointing away from the figure. Without this an asymmetric weapon — a bow,
  // an axe head — keeps its handedness when the figure swaps sides and ends up
  // outside the art window, or across the face.
  ctx.scale(s, 1);
  ctx.rotate(0.26);
  ctx.save();
  ctx.scale(reach, reach);

  const blade = (len: number, wide: number) =>
    cel(
      ctx,
      (c) => {
        c.beginPath();
        c.moveTo(-wide, 0);
        c.lineTo(-wide * 0.8, -len);
        c.lineTo(0, -len - wide * 1.8);
        c.lineTo(wide * 0.8, -len);
        c.lineTo(wide, 0);
        c.closePath();
      },
      p.metal,
      { x: -wide, y: -len - wide * 2, w: wide * 2, h: len + wide * 2 },
      { angle: light, coverage: 0.38, line: p.lineColor, lineWidth: 0.055, rim: rgba('#FFFFFF', 0.75), rimWidth: 0.05 },
    );
  const grip = (len: number) =>
    flat(
      ctx,
      (c) => {
        c.beginPath();
        c.rect(-0.09, 0, 0.18, len);
      },
      wood.base,
      p.lineColor,
      0.045,
    );

  switch (w) {
    case 'sword':
    case 'greatsword': {
      const len = w === 'greatsword' ? 3.6 : 2.7;
      const wide = w === 'greatsword' ? 0.3 : 0.2;
      blade(len, wide);
      flat(
        ctx,
        (c) => {
          c.beginPath();
          c.rect(-0.55, -0.06, 1.1, 0.2);
        },
        p.trim.base,
        p.lineColor,
        0.045,
      );
      grip(0.75);
      break;
    }
    case 'dagger':
      blade(1.2, 0.15);
      grip(0.5);
      break;
    case 'axe':
      flat(ctx, (c) => { c.beginPath(); c.rect(-0.1, -2.8, 0.2, 3.3); }, wood.base, p.lineColor, 0.045);
      // A bearded head: flat back against the haft, crescent edge swept out.
      cel(
        ctx,
        (c) => {
          c.beginPath();
          c.moveTo(-0.06, -2.72);
          c.lineTo(-1.02, -2.5);
          c.quadraticCurveTo(-1.5, -1.86, -1.0, -1.2);
          c.lineTo(-0.06, -1.42);
          c.closePath();
        },
        p.metal,
        { x: -1.55, y: -2.8, w: 1.6, h: 1.7 },
        { angle: light, coverage: 0.4, line: p.lineColor, lineWidth: 0.055, rim: rgba('#FFFFFF', 0.6), rimWidth: 0.05 },
      );
      // The cheek line that separates the edge from the body of the head.
      ctx.save();
      ctx.strokeStyle = rgba(p.lineColor, 0.45);
      ctx.lineWidth = 0.05;
      stroke(ctx, [
        [-0.86, -2.44],
        [-1.16, -1.9],
        [-0.86, -1.34],
      ]);
      ctx.stroke();
      ctx.restore();
      break;
    case 'spear':
      flat(ctx, (c) => { c.beginPath(); c.rect(-0.08, -3.6, 0.16, 4.4); }, wood.base, p.lineColor, 0.045);
      ctx.translate(0, -3.6);
      blade(0.55, 0.17);
      break;
    case 'scythe':
      flat(ctx, (c) => { c.beginPath(); c.rect(-0.09, -3.7, 0.18, 4.5); }, wood.base, p.lineColor, 0.045);
      // The blade hooks back over the top of the haft. Swept the other way it
      // crosses the face, and the weapon is drawn behind the figure, so it
      // simply disappears.
      cel(
        ctx,
        (c) => {
          c.beginPath();
          c.moveTo(0.02, -3.62);
          c.quadraticCurveTo(-1.4, -4.15, -2.25, -3.25);
          c.quadraticCurveTo(-1.3, -3.6, 0.02, -3.28);
          c.closePath();
        },
        p.metal,
        { x: -2.35, y: -4.2, w: 2.5, h: 1.1 },
        { angle: light, coverage: 0.38, line: p.lineColor, lineWidth: 0.055, rim: rgba('#FFFFFF', 0.7), rimWidth: 0.05 },
      );
      break;
    case 'staff':
    case 'wand': {
      const len = w === 'staff' ? 3.5 : 2.2;
      flat(ctx, (c) => { c.beginPath(); c.rect(-0.09, -len, 0.18, len + 0.9); }, wood.base, p.lineColor, 0.045);
      // A binding at the shaft, so it is a made object and not a dowel.
      for (const y of [-len * 0.32, -len * 0.32 - 0.16]) {
        flat(ctx, (c) => { c.beginPath(); c.rect(-0.14, y, 0.28, 0.1); }, p.trim.base);
      }
      // The head: two claws closed around the stone.
      for (const side of [-1, 1]) {
        cel(
          ctx,
          (c) =>
            sliver(
              c,
              [side * 0.1, -len + 0.16],
              [side * 0.46, -len - 0.66],
              0.09,
              side * 0.14,
            ),
          p.metal,
          { x: -0.6, y: -len - 0.8, w: 1.2, h: 1.1 },
          { angle: light, coverage: 0.4, line: p.lineColor, lineWidth: 0.045 },
        );
      }
      // The gem, which is also the illustration's second light source.
      ctx.save();
      ctx.shadowColor = rgba(p.trim.light, 0.95);
      ctx.shadowBlur = 22;
      flat(
        ctx,
        (c) => {
          c.beginPath();
          c.ellipse(0, -len - 0.24, 0.3, 0.36, 0, 0, Math.PI * 2);
        },
        p.trim.light,
        p.lineColor,
        0.05,
      );
      ctx.restore();
      break;
    }
    case 'bow': {
      // Curved around the hand that holds it. Drawn off to one side the whole
      // bow falls outside the art window and the archer holds nothing.
      const r = 1.55;
      const cxB = 0.3;
      const gy = -0.35;
      const a0 = Math.PI * 0.6;
      const a1 = Math.PI * 1.4;
      const tip = (a: number): Pt => [cxB + Math.cos(a) * r, gy + Math.sin(a) * r];
      ctx.save();
      ctx.lineCap = 'round';
      // The limbs, thick enough to read against a dark background and rimmed
      // on the lit side like every other solid form in the figure.
      ctx.strokeStyle = p.lineColor;
      ctx.lineWidth = 0.3;
      ctx.beginPath();
      ctx.arc(cxB, gy, r, a0, a1);
      ctx.stroke();
      ctx.strokeStyle = wood.base;
      ctx.lineWidth = 0.21;
      ctx.beginPath();
      ctx.arc(cxB, gy, r, a0, a1);
      ctx.stroke();
      ctx.strokeStyle = rgba(wood.light, 0.8);
      ctx.lineWidth = 0.07;
      ctx.beginPath();
      ctx.arc(cxB - 0.04, gy - 0.04, r, a0 + 0.12, a1 - 0.12);
      ctx.stroke();
      // Grip wrap.
      ctx.strokeStyle = p.trim.base;
      ctx.lineWidth = 0.24;
      ctx.beginPath();
      ctx.arc(cxB, gy, r, Math.PI * 0.94, Math.PI * 1.06);
      ctx.stroke();
      // The string, and an arrow nocked on it.
      const t0 = tip(a0);
      const t1 = tip(a1);
      ctx.strokeStyle = rgba('#EDE6D8', 0.9);
      ctx.lineWidth = 0.06;
      ctx.beginPath();
      ctx.moveTo(t0[0], t0[1]);
      ctx.lineTo(t1[0], t1[1]);
      ctx.stroke();
      ctx.strokeStyle = wood.shade;
      ctx.lineWidth = 0.08;
      ctx.beginPath();
      ctx.moveTo((t0[0] + t1[0]) / 2, (t0[1] + t1[1]) / 2);
      ctx.lineTo(cxB - r * 0.95, gy);
      ctx.stroke();
      ctx.restore();
      break;
    }
    case 'book':
      cel(
        ctx,
        (c) => {
          c.beginPath();
          c.moveTo(-0.85, -0.5);
          c.lineTo(0.85, -0.75);
          c.lineTo(0.85, 0.5);
          c.lineTo(-0.85, 0.75);
          c.closePath();
        },
        ramp(shift(p.cloth.base, 0.05, 0.05, -0.05)),
        { x: -0.9, y: -0.8, w: 1.8, h: 1.6 },
        { angle: light, coverage: 0.4, line: p.lineColor, lineWidth: 0.055 },
      );
      break;
    case 'shield':
      cel(
        ctx,
        (c) => {
          c.beginPath();
          c.moveTo(-0.95, -1.6);
          c.lineTo(0.95, -1.6);
          c.quadraticCurveTo(1.05, 0.4, 0, 1.4);
          c.quadraticCurveTo(-1.05, 0.4, -0.95, -1.6);
          c.closePath();
        },
        p.metal,
        { x: -1, y: -1.7, w: 2, h: 3.2 },
        { angle: light, coverage: 0.4, line: p.lineColor, lineWidth: 0.06, rim: rgba('#FFFFFF', 0.6), rimWidth: 0.05 },
      );
      break;
    default:
      break;
  }

  ctx.restore();

  // The hand, last, so it closes over whatever shaft was drawn.
  const gripAt: Partial<Record<Weapon, number>> = {
    sword: 0.42,
    greatsword: 0.42,
    dagger: 0.28,
    axe: 0.35,
    spear: 0.45,
    scythe: 0.45,
    staff: 0.5,
    wand: 0.5,
    bow: -0.6,
  };
  const at = gripAt[w];
  if (at !== undefined) drawGrip(ctx, p, light, at * reach);

  ctx.restore();
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

export interface PortraitFrame {
  /** Where the head centre sits, in canvas pixels. */
  cx: number;
  cy: number;
  /** Half the head's width, in canvas pixels — the unit everything scales by. */
  unit: number;
}

/**
 * Draws the character. The caller has already painted the background; this
 * adds the figure on top, in the light direction the scene is lit from.
 */
/** Long hafted weapons read better rising behind the shoulder than in front. */
function behindShoulder(p: Portrait): boolean {
  const w = p.spec.weapon ?? 'none';
  return w === 'staff' || w === 'spear' || w === 'scythe' || w === 'greatsword';
}

export function drawPortrait(
  ctx: CanvasRenderingContext2D,
  p: Portrait,
  rng: Rand,
  frame: PortraitFrame,
  lightAngle: number,
): void {
  ctx.save();
  ctx.translate(frame.cx, frame.cy);
  ctx.scale(frame.unit, frame.unit);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // Cel shading takes the light from the side, never from a diagonal. A rotated
  // half-plane cuts a face in half at an angle, which reads as a scar rather
  // than as light; snapping to left or right gives the vertical shadow edge
  // that animation actually uses.
  const light = Math.cos(lightAngle) >= 0 ? 0 : Math.PI;

  // Back to front, so nothing has to composite behind what is already drawn.
  drawWings(ctx, p, light);
  drawBackHair(ctx, p, rng, light);
  drawCloak(ctx, p, light);
  if (behindShoulder(p)) drawWeapon(ctx, p, light);
  drawBody(ctx, p, rng, light);

  const head = headPath(p);
  cel(ctx, head, p.skin, { x: -1.1, y: HEAD.top, w: 2.2, h: HEAD.chin - HEAD.top }, {
    angle: light,
    coverage: 0.22,
    line: p.lineColor,
    lineWidth: 0.055,
    soft: 0.6,
  });

  // The fringe's shadow across the forehead — the detail that seats hair on a
  // head instead of leaving it floating in front of one.
  within(ctx, head, (c) => {
    c.fillStyle = rgba(p.skin.shade, 0.42);
    c.beginPath();
    c.ellipse(p.turn * 0.4, -1.02, 1.15, 0.5, 0, 0, Math.PI * 2);
    c.fill();
  });

  // The jaw, drawn as its own line so the chin does not vanish into the neck.
  ctx.save();
  ctx.strokeStyle = rgba(p.lineColor, 0.55);
  ctx.lineWidth = 0.05;
  stroke(ctx, [
    [-0.72 + p.turn * 0.4, 0.44],
    [-0.34 + p.turn * 0.55, 0.9],
    [p.turn * 0.6, 0.99],
    [0.34 + p.turn * 0.55, 0.9],
    [0.72 + p.turn * 0.4, 0.44],
  ]);
  ctx.stroke();
  ctx.restore();

  drawFace(ctx, p);
  // Ears sit in front of the hair; everything else sits on top of it.
  if ((p.spec.headgear ?? 'none') === 'elfEars') drawHeadgear(ctx, p, light);
  drawFrontHair(ctx, p, rng, light);
  if ((p.spec.headgear ?? 'none') !== 'elfEars') drawHeadgear(ctx, p, light);
  if (!behindShoulder(p)) drawWeapon(ctx, p, light);

  ctx.restore();
}
