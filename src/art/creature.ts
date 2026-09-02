/**
 * The creature illustrator.
 *
 * The card pool is not all people: dragons, wolves, skeletons, ghosts, golems
 * and slimes need the same cel-shaded treatment the portraits get, or they end
 * up as symbols on a gradient next to drawn characters.
 *
 * Like `portrait.ts`, everything is laid out in **head units** — the creature's
 * head is 2 units wide, the origin is its centre — so one transform seats any
 * of them in the art window.
 */
import { blob, cel, flat, ramp, rgba, shift, sliver, stroke, within, type Pt, type Ramp } from './celshade';
import type { Rand } from './portrait';

export type CreatureKind =
  | 'dragon'
  | 'wolf'
  | 'bird'
  | 'serpent'
  | 'skeleton'
  | 'ghost'
  | 'golem'
  | 'slime'
  | 'insect'
  | 'demon'
  | 'imp';

export interface CreatureSpec {
  kind: CreatureKind;
  /** Horns, crests and spines scale with this: 0 plain, 1 ornate. */
  ornate?: number;
}

export interface Creature {
  spec: CreatureSpec;
  hide: Ramp;
  belly: Ramp;
  accent: Ramp;
  eye: string;
  lineColor: string;
  /** Slight asymmetry so two of the same kind are not the same drawing. */
  jitter: number;
}

const LINE = '#1E1820';

const HIDES: Record<CreatureKind, string[]> = {
  dragon: ['#B8452A', '#2E6E8C', '#4A7A34', '#7A3A6B', '#C97A2E', '#3A4A6B'],
  wolf: ['#6B6558', '#4A4640', '#8A8276', '#3A3A44'],
  bird: ['#8C6A3A', '#B8A05C', '#6B7A8C', '#3A3A44'],
  serpent: ['#3E7A46', '#2E6E8C', '#7A6A2E', '#5C3A6B'],
  skeleton: ['#E4DCC8', '#D8CFB8', '#CFC6AE'],
  ghost: ['#8FD0FF', '#C7A8FF', '#A8E4D8'],
  golem: ['#7A7266', '#5C6470', '#8A7A5C', '#6B5C4A'],
  slime: ['#5CC48C', '#5C9CC4', '#C45C9C', '#C4B85C'],
  insect: ['#4A5C2E', '#6B4A2E', '#3A3A4A', '#7A6A2E'],
  demon: ['#8C2E2E', '#5C2A4A', '#3A2A3A', '#7A3A1E'],
  imp: ['#B85C4A', '#8C4A6B', '#6B4A8C'],
};

const CREATURE_EYES = ['#FFD24A', '#FF6B4A', '#8FE3FF', '#B8FF6B', '#FF4A6B', '#E8E8FF'];

export function rollCreature(rng: Rand, spec: CreatureSpec, classAccent: string): Creature {
  const hideBase = rng.pick(HIDES[spec.kind]);
  return {
    spec,
    hide: ramp(hideBase, 1.05),
    belly: ramp(shift(hideBase, 0.02, -0.22, 0.2), 0.85),
    accent: ramp(classAccent, 0.9),
    eye: spec.kind === 'ghost' || spec.kind === 'skeleton' ? rng.pick(['#8FE3FF', '#B8FF6B', '#FF6B4A']) : rng.pick(CREATURE_EYES),
    lineColor: LINE,
    jitter: rng.range(-0.12, 0.12),
  };
}

// ---------------------------------------------------------------------------
// Shared parts
// ---------------------------------------------------------------------------

/** A glowing eye, used by everything that is not a person. */
function beastEye(ctx: CanvasRenderingContext2D, c: Creature, x: number, y: number, r: number, slit: boolean): void {
  ctx.save();
  ctx.shadowColor = rgba(c.eye, 0.9);
  ctx.shadowBlur = 12;
  flat(
    ctx,
    (g) => {
      g.beginPath();
      g.ellipse(x, y, r, r * 0.8, 0, 0, Math.PI * 2);
    },
    c.eye,
  );
  ctx.restore();
  if (slit) {
    flat(
      ctx,
      (g) => {
        g.beginPath();
        g.ellipse(x, y, r * 0.22, r * 0.72, 0, 0, Math.PI * 2);
      },
      rgba('#160C12', 0.92),
    );
  }
  flat(
    ctx,
    (g) => {
      g.beginPath();
      g.ellipse(x - r * 0.3, y - r * 0.3, r * 0.2, r * 0.16, 0, 0, Math.PI * 2);
    },
    rgba('#FFFFFF', 0.85),
  );
}

/** A row of teeth along a jaw line. */
function teeth(ctx: CanvasRenderingContext2D, c: Creature, from: Pt, to: Pt, n: number, size: number): void {
  for (let i = 0; i < n; i++) {
    const u = (i + 0.5) / n;
    const x = from[0] + (to[0] - from[0]) * u;
    const y = from[1] + (to[1] - from[1]) * u;
    flat(
      ctx,
      (g) => {
        g.beginPath();
        g.moveTo(x - size * 0.4, y);
        g.lineTo(x + size * 0.4, y);
        g.lineTo(x, y + size * 1.5);
        g.closePath();
      },
      '#F2ECD8',
      rgba(c.lineColor, 0.6),
      0.03,
    );
  }
}

// ---------------------------------------------------------------------------
// The creatures
// ---------------------------------------------------------------------------

function drawDragon(ctx: CanvasRenderingContext2D, c: Creature, rng: Rand, light: number): void {
  const j = c.jitter;
  const ornate = c.spec.ornate ?? 0.6;

  // Neck, running down out of frame behind the head.
  cel(
    ctx,
    (g) =>
      blob(
        g,
        [
          [-0.55, 0.4],
          [-1.5, 2.0],
          [-1.7, 4.4],
          [1.0, 4.4],
          [0.7, 2.0],
          [0.5, 0.5],
        ],
        0.88,
      ),
    c.hide,
    { x: -1.8, y: 0.4, w: 3, h: 4 },
    { angle: light, coverage: 0.42, line: c.lineColor, lineWidth: 0.07 },
  );

  // Skull: a long wedge with a heavy brow.
  const skull = (g: CanvasRenderingContext2D) => {
    g.beginPath();
    g.moveTo(-1.35 + j, -0.62);
    g.bezierCurveTo(-0.6, -1.25, 0.7, -1.1, 1.15, -0.5);
    g.bezierCurveTo(1.75, -0.2, 2.1, 0.15, 2.0, 0.5);
    g.bezierCurveTo(1.5, 0.72, 0.7, 0.62, 0.2, 0.5);
    g.bezierCurveTo(-0.5, 0.75, -1.2, 0.5, -1.45, 0.0);
    g.closePath();
  };
  cel(ctx, skull, c.hide, { x: -1.5, y: -1.3, w: 3.6, h: 2.1 }, {
    angle: light,
    coverage: 0.4,
    line: c.lineColor,
    lineWidth: 0.075,
    rim: rgba('#FFFFFF', 0.35),
    rimWidth: 0.05,
  });

  // Snout underside, lighter.
  within(ctx, skull, (g) => {
    g.fillStyle = rgba(c.belly.base, 0.85);
    g.beginPath();
    g.moveTo(0.1, 0.3);
    g.bezierCurveTo(1.0, 0.24, 1.8, 0.34, 2.05, 0.55);
    g.lineTo(0.2, 0.62);
    g.closePath();
    g.fill();
  });

  // Jaw, open a little so it reads as alive.
  cel(
    ctx,
    (g) => {
      g.beginPath();
      g.moveTo(0.2, 0.5);
      g.bezierCurveTo(1.0, 0.5, 1.7, 0.62, 1.95, 0.78);
      g.bezierCurveTo(1.4, 1.12, 0.5, 1.05, 0.1, 0.82);
      g.closePath();
    },
    c.hide,
    { x: 0, y: 0.4, w: 2, h: 0.8 },
    { angle: light, coverage: 0.5, line: c.lineColor, lineWidth: 0.06 },
  );
  teeth(ctx, c, [0.55, 0.56], [1.8, 0.7], 4, 0.14);

  // Horns sweeping back off the skull.
  const horns = 1 + Math.round(ornate * 2);
  for (let i = 0; i < horns; i++) {
    const u = i / Math.max(1, horns - 1);
    const rootX = -0.9 + u * 0.9;
    const len = 1.5 - u * 0.5;
    cel(
      ctx,
      (g) => sliver(g, [rootX, -0.85], [rootX - len * 0.9, -0.85 - len * 0.75], 0.17 - u * 0.04, -0.3),
      ramp('#D8CDBE', 0.95),
      { x: rootX - 2, y: -2.6, w: 2.2, h: 2 },
      { angle: light, coverage: 0.42, line: c.lineColor, lineWidth: 0.055 },
    );
  }

  // Frill spines down the neck.
  for (let i = 0; i < 5; i++) {
    const y = 0.9 + i * 0.75;
    cel(
      ctx,
      (g) => sliver(g, [-0.9 - i * 0.15, y], [-1.7 - i * 0.3, y - 0.5], 0.12, 0.1),
      c.accent,
      { x: -2.2, y: y - 0.7, w: 1.6, h: 1 },
      { angle: light, coverage: 0.45, line: c.lineColor, lineWidth: 0.05 },
    );
  }

  beastEye(ctx, c, 0.35 + j, -0.32, 0.19, true);

  // Brow ridge over the eye — what makes a dragon look angry rather than sleepy.
  ctx.save();
  ctx.strokeStyle = c.lineColor;
  ctx.lineWidth = 0.11;
  stroke(ctx, [
    [-0.15 + j, -0.62],
    [0.45 + j, -0.6],
    [0.85 + j, -0.42],
  ]);
  ctx.stroke();
  ctx.restore();

  // Nostril.
  flat(
    ctx,
    (g) => {
      g.beginPath();
      g.ellipse(1.72, 0.18, 0.1, 0.07, -0.3, 0, Math.PI * 2);
    },
    rgba(c.lineColor, 0.7),
  );
  void rng;
}

function drawWolf(ctx: CanvasRenderingContext2D, c: Creature, rng: Rand, light: number): void {
  const j = c.jitter;

  // Shoulders and chest.
  cel(
    ctx,
    (g) => blob(g, [[-1.7, 1.1], [-2.2, 2.6], [-2.0, 4.4], [2.0, 4.4], [2.2, 2.6], [1.7, 1.1]], 0.88),
    c.hide,
    { x: -2.3, y: 1, w: 4.6, h: 3.5 },
    { angle: light, coverage: 0.44, line: c.lineColor, lineWidth: 0.07 },
  );

  // Head: a wedge with a long muzzle.
  const head = (g: CanvasRenderingContext2D) => {
    g.beginPath();
    g.moveTo(-1.15 + j, -0.35);
    g.bezierCurveTo(-1.0, -1.0, 1.0, -1.0, 1.15 + j, -0.35);
    g.bezierCurveTo(1.25, 0.35, 0.75, 0.85, 0.35, 1.05);
    g.bezierCurveTo(0.15, 1.35, -0.15, 1.35, -0.35, 1.05);
    g.bezierCurveTo(-0.75, 0.85, -1.25, 0.35, -1.15 + j, -0.35);
    g.closePath();
  };
  cel(ctx, head, c.hide, { x: -1.3, y: -1.1, w: 2.6, h: 2.5 }, {
    angle: light,
    coverage: 0.4,
    line: c.lineColor,
    lineWidth: 0.07,
    rim: rgba('#FFFFFF', 0.35),
    rimWidth: 0.05,
  });

  // Ears.
  for (const s of [-1, 1]) {
    cel(
      ctx,
      (g) => {
        g.beginPath();
        g.moveTo(s * 0.55, -0.75);
        g.lineTo(s * 1.05, -1.85);
        g.lineTo(s * 1.15, -0.55);
        g.closePath();
      },
      c.hide,
      { x: s > 0 ? 0.5 : -1.2, y: -1.9, w: 0.7, h: 1.4 },
      { angle: light, coverage: 0.42, line: c.lineColor, lineWidth: 0.06 },
    );
  }

  // Muzzle and snout.
  within(ctx, head, (g) => {
    g.fillStyle = rgba(c.belly.base, 0.9);
    g.beginPath();
    g.ellipse(0, 0.72, 0.5, 0.48, 0, 0, Math.PI * 2);
    g.fill();
  });
  flat(
    ctx,
    (g) => {
      g.beginPath();
      g.ellipse(0, 0.62, 0.19, 0.14, 0, 0, Math.PI * 2);
    },
    '#221A20',
  );
  teeth(ctx, c, [-0.3, 0.95], [0.3, 0.95], 3, 0.13);

  beastEye(ctx, c, -0.45 + j, -0.18, 0.17, false);
  beastEye(ctx, c, 0.45 + j, -0.18, 0.17, false);
  void rng;
}

function drawSkeleton(ctx: CanvasRenderingContext2D, c: Creature, rng: Rand, light: number): void {
  const bone = c.hide;

  // Ribcage and shoulders.
  cel(
    ctx,
    (g) => blob(g, [[-1.5, 1.5], [-1.9, 2.6], [-1.5, 4.4], [1.5, 4.4], [1.9, 2.6], [1.5, 1.5]], 0.85),
    ramp(shift(bone.base, 0, 0, -0.12), 0.9),
    { x: -2, y: 1.4, w: 4, h: 3 },
    { angle: light, coverage: 0.46, line: c.lineColor, lineWidth: 0.07 },
  );
  ctx.save();
  ctx.strokeStyle = rgba(c.lineColor, 0.65);
  ctx.lineCap = 'round';
  for (let i = 0; i < 4; i++) {
    const y = 2.1 + i * 0.5;
    ctx.lineWidth = 0.1;
    stroke(ctx, [
      [-1.1, y],
      [0, y + 0.22],
      [1.1, y],
    ]);
    ctx.stroke();
  }
  ctx.lineWidth = 0.13;
  stroke(ctx, [
    [0, 1.7],
    [0, 4.2],
  ]);
  ctx.stroke();
  ctx.restore();

  // Skull.
  const skull = (g: CanvasRenderingContext2D) => {
    g.beginPath();
    g.moveTo(-1.0, -0.2);
    g.bezierCurveTo(-1.05, -1.2, 1.05, -1.2, 1.0, -0.2);
    g.bezierCurveTo(0.95, 0.35, 0.6, 0.55, 0.42, 0.6);
    g.lineTo(0.42, 1.05);
    g.lineTo(-0.42, 1.05);
    g.lineTo(-0.42, 0.6);
    g.bezierCurveTo(-0.6, 0.55, -0.95, 0.35, -1.0, -0.2);
    g.closePath();
  };
  cel(ctx, skull, bone, { x: -1.1, y: -1.3, w: 2.2, h: 2.4 }, {
    angle: light,
    coverage: 0.38,
    line: c.lineColor,
    lineWidth: 0.07,
    rim: rgba('#FFFFFF', 0.4),
    rimWidth: 0.05,
  });

  // Sockets, with the light burning inside them.
  for (const s of [-1, 1]) {
    flat(
      ctx,
      (g) => {
        g.beginPath();
        g.ellipse(s * 0.42, -0.18, 0.3, 0.34, s * 0.15, 0, Math.PI * 2);
      },
      '#140E18',
    );
    beastEye(ctx, c, s * 0.42, -0.14, 0.13, false);
  }
  flat(
    ctx,
    (g) => {
      g.beginPath();
      g.moveTo(0, 0.12);
      g.lineTo(0.14, 0.42);
      g.lineTo(-0.14, 0.42);
      g.closePath();
    },
    '#140E18',
  );
  // Jaw line and teeth.
  ctx.save();
  ctx.strokeStyle = rgba(c.lineColor, 0.7);
  ctx.lineWidth = 0.05;
  for (let i = 0; i < 6; i++) {
    const x = -0.36 + (i / 5) * 0.72;
    stroke(ctx, [
      [x, 0.6],
      [x, 1.02],
    ]);
    ctx.stroke();
  }
  ctx.restore();
  void rng;
}

function drawGhost(ctx: CanvasRenderingContext2D, c: Creature, rng: Rand, light: number): void {
  // A body that dissolves into tatters at the bottom.
  const tail: Pt[] = [[-1.3, -0.2], [-1.6, 1.6]];
  for (let i = 0; i <= 6; i++) {
    const u = i / 6;
    tail.push([-1.5 + u * 3.0, 3.4 + Math.sin(u * Math.PI * 3) * 0.55]);
  }
  tail.push([1.6, 1.6], [1.3, -0.2]);

  ctx.save();
  ctx.globalAlpha = 0.88;
  cel(ctx, (g) => blob(g, tail, 0.9), c.hide, { x: -1.7, y: -0.4, w: 3.4, h: 4.2 }, {
    angle: light,
    coverage: 0.44,
    line: rgba(c.lineColor, 0.6),
    lineWidth: 0.06,
  });
  ctx.restore();

  // Hood/head.
  cel(
    ctx,
    (g) => blob(g, [[-1.15, 0.1], [-1.2, -0.9], [0, -1.55], [1.2, -0.9], [1.15, 0.1], [0, 0.5]], 0.9),
    ramp(shift(c.hide.base, 0, 0.05, -0.16), 0.9),
    { x: -1.3, y: -1.6, w: 2.6, h: 2.2 },
    { angle: light, coverage: 0.42, line: rgba(c.lineColor, 0.7), lineWidth: 0.06 },
  );
  flat(
    ctx,
    (g) => {
      g.beginPath();
      g.ellipse(0, -0.35, 0.82, 0.72, 0, 0, Math.PI * 2);
    },
    rgba('#0E0A14', 0.88),
  );
  beastEye(ctx, c, -0.34, -0.35, 0.16, false);
  beastEye(ctx, c, 0.34, -0.35, 0.16, false);

  // Wisps drifting off it.
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 12; i++) {
    ctx.fillStyle = rgba(c.hide.light, rng.range(0.1, 0.35));
    ctx.beginPath();
    ctx.ellipse(rng.range(-2, 2), rng.range(-1.5, 3.5), rng.range(0.05, 0.16), rng.range(0.05, 0.16), 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawGolem(ctx: CanvasRenderingContext2D, c: Creature, rng: Rand, light: number): void {
  // Blocky mass: slabs rather than curves.
  const slab = (x: number, y: number, w: number, h: number, rot: number) =>
    cel(
      ctx,
      (g) => {
        g.save();
        g.translate(x, y);
        g.rotate(rot);
        g.beginPath();
        g.moveTo(-w, -h);
        g.lineTo(w * 0.86, -h * 0.92);
        g.lineTo(w, h);
        g.lineTo(-w * 0.9, h * 0.94);
        g.closePath();
        g.restore();
      },
      c.hide,
      { x: x - w, y: y - h, w: w * 2, h: h * 2 },
      { angle: light, coverage: 0.42, line: c.lineColor, lineWidth: 0.08, rim: rgba('#FFFFFF', 0.3), rimWidth: 0.05 },
    );

  slab(0, 2.6, 1.9, 1.5, 0.03);
  for (const s of [-1, 1]) slab(s * 2.1, 2.3, 0.7, 1.2, s * 0.16);
  slab(c.jitter, -0.3, 1.05, 1.0, 0.04);

  // The rune-light in its chest and eyes.
  ctx.save();
  ctx.shadowColor = rgba(c.accent.light, 0.9);
  ctx.shadowBlur = 20;
  flat(
    ctx,
    (g) => {
      g.beginPath();
      g.moveTo(0, 2.0);
      g.lineTo(0.42, 2.55);
      g.lineTo(0, 3.1);
      g.lineTo(-0.42, 2.55);
      g.closePath();
    },
    c.accent.light,
  );
  ctx.restore();
  beastEye(ctx, c, c.jitter - 0.4, -0.35, 0.15, false);
  beastEye(ctx, c, c.jitter + 0.4, -0.35, 0.15, false);

  // Cracks.
  ctx.save();
  ctx.strokeStyle = rgba(c.lineColor, 0.5);
  ctx.lineWidth = 0.06;
  for (let i = 0; i < 5; i++) {
    const x = rng.range(-1.7, 1.7);
    stroke(ctx, [
      [x, 1.4],
      [x + rng.range(-0.3, 0.3), 2.4],
      [x + rng.range(-0.4, 0.4), 3.6],
    ]);
    ctx.stroke();
  }
  ctx.restore();
}

function drawSlime(ctx: CanvasRenderingContext2D, c: Creature, rng: Rand, light: number): void {
  const body = (g: CanvasRenderingContext2D) =>
    blob(
      g,
      [
        [-1.9, 2.6],
        [-1.5, 0.4],
        [-0.4, -1.0],
        [0.9, -0.7],
        [1.6, 0.6],
        [2.0, 2.6],
        [1.4, 3.5],
        [-1.4, 3.5],
      ],
      0.92,
    );
  ctx.save();
  ctx.globalAlpha = 0.9;
  cel(ctx, body, c.hide, { x: -2, y: -1.1, w: 4, h: 4.7 }, {
    angle: light,
    coverage: 0.4,
    line: c.lineColor,
    lineWidth: 0.07,
    rim: rgba('#FFFFFF', 0.5),
    rimWidth: 0.06,
  });
  ctx.restore();

  // The highlight blob that makes jelly look wet.
  within(ctx, body, (g) => {
    g.fillStyle = rgba('#FFFFFF', 0.5);
    g.beginPath();
    g.ellipse(-0.6, -0.1, 0.42, 0.28, -0.4, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = rgba('#FFFFFF', 0.25);
    g.beginPath();
    g.ellipse(0.7, 1.6, 0.7, 0.4, 0.3, 0, Math.PI * 2);
    g.fill();
  });
  beastEye(ctx, c, -0.45, 0.65, 0.2, false);
  beastEye(ctx, c, 0.55, 0.6, 0.2, false);
  // A grin.
  ctx.save();
  ctx.strokeStyle = rgba(c.lineColor, 0.75);
  ctx.lineWidth = 0.08;
  stroke(ctx, [
    [-0.4, 1.35],
    [0.05, 1.6],
    [0.5, 1.3],
  ]);
  ctx.stroke();
  ctx.restore();
  void rng;
}

function drawImp(ctx: CanvasRenderingContext2D, c: Creature, rng: Rand, light: number): void {
  // Small body, big head — a gremlin silhouette.
  cel(
    ctx,
    (g) => blob(g, [[-1.15, 1.3], [-1.5, 2.6], [-1.2, 4.2], [1.2, 4.2], [1.5, 2.6], [1.15, 1.3]], 0.88),
    c.hide,
    { x: -1.6, y: 1.2, w: 3.2, h: 3 },
    { angle: light, coverage: 0.44, line: c.lineColor, lineWidth: 0.07 },
  );

  const head = (g: CanvasRenderingContext2D) =>
    blob(g, [[-1.15 + c.jitter, -0.5], [-0.7, -1.3], [0.7, -1.3], [1.15 + c.jitter, -0.5], [0.6, 0.9], [-0.6, 0.9]], 0.9);
  cel(ctx, head, c.hide, { x: -1.3, y: -1.4, w: 2.6, h: 2.4 }, {
    angle: light,
    coverage: 0.4,
    line: c.lineColor,
    lineWidth: 0.07,
    rim: rgba('#FFFFFF', 0.3),
    rimWidth: 0.05,
  });

  // Big pointed ears and small horns.
  for (const s of [-1, 1]) {
    cel(
      ctx,
      (g) => {
        g.beginPath();
        g.moveTo(s * 1.0, -0.55);
        g.lineTo(s * 2.3, -1.35);
        g.lineTo(s * 1.05, 0.25);
        g.closePath();
      },
      c.hide,
      { x: s > 0 ? 0.9 : -2.4, y: -1.4, w: 1.5, h: 1.7 },
      { angle: light, coverage: 0.45, line: c.lineColor, lineWidth: 0.06 },
    );
    cel(
      ctx,
      (g) => sliver(g, [s * 0.5, -1.15], [s * 0.75, -1.95], 0.11, s * 0.12),
      ramp('#D8CDBE', 0.9),
      { x: s > 0 ? 0.3 : -0.9, y: -2, w: 0.7, h: 1 },
      { angle: light, coverage: 0.42, line: c.lineColor, lineWidth: 0.05 },
    );
  }

  beastEye(ctx, c, -0.4 + c.jitter, -0.35, 0.19, true);
  beastEye(ctx, c, 0.42 + c.jitter, -0.35, 0.19, true);
  ctx.save();
  ctx.strokeStyle = rgba(c.lineColor, 0.8);
  ctx.lineWidth = 0.07;
  stroke(ctx, [
    [-0.45, 0.32],
    [0, 0.5],
    [0.45, 0.3],
  ]);
  ctx.stroke();
  ctx.restore();
  teeth(ctx, c, [-0.3, 0.42], [0.3, 0.42], 3, 0.11);
  void rng;
}

function drawBird(ctx: CanvasRenderingContext2D, c: Creature, rng: Rand, light: number): void {
  // Wings spread behind.
  for (const s of [-1, 1]) {
    for (let i = 0; i < 5; i++) {
      const u = i / 4;
      cel(
        ctx,
        (g) => sliver(g, [s * 0.9, 1.0], [s * (2.0 + u * 2.2), 1.0 - (1.0 - u * 0.4) * 2.0], 0.3 - u * 0.06, s * 0.35),
        ramp(shift(c.hide.base, 0, 0, -0.06), 0.95),
        { x: s > 0 ? 0.5 : -4.5, y: -1.5, w: 4, h: 3.5 },
        { angle: light, coverage: 0.44, line: c.lineColor, lineWidth: 0.055 },
      );
    }
  }
  // Body.
  cel(
    ctx,
    (g) => blob(g, [[-1.0, 0.9], [-1.3, 2.4], [0, 4.2], [1.3, 2.4], [1.0, 0.9]], 0.9),
    c.hide,
    { x: -1.4, y: 0.8, w: 2.8, h: 3.5 },
    { angle: light, coverage: 0.42, line: c.lineColor, lineWidth: 0.07 },
  );
  // Head.
  const head = (g: CanvasRenderingContext2D) => {
    g.beginPath();
    g.ellipse(c.jitter, -0.2, 0.95, 0.9, 0, 0, Math.PI * 2);
  };
  cel(ctx, head, c.hide, { x: -1, y: -1.1, w: 2, h: 1.9 }, {
    angle: light,
    coverage: 0.4,
    line: c.lineColor,
    lineWidth: 0.07,
    rim: rgba('#FFFFFF', 0.35),
    rimWidth: 0.05,
  });
  // Beak.
  cel(
    ctx,
    (g) => {
      g.beginPath();
      g.moveTo(0.5, 0.0);
      g.lineTo(1.9, 0.3);
      g.lineTo(0.55, 0.62);
      g.closePath();
    },
    ramp('#E8B23A', 1),
    { x: 0.4, y: -0.1, w: 1.6, h: 0.8 },
    { angle: light, coverage: 0.42, line: c.lineColor, lineWidth: 0.06 },
  );
  beastEye(ctx, c, 0.15 + c.jitter, -0.28, 0.19, false);
  void rng;
}

function drawSerpent(ctx: CanvasRenderingContext2D, c: Creature, rng: Rand, light: number): void {
  // A coil looping through the frame.
  ctx.save();
  ctx.strokeStyle = c.hide.base;
  ctx.lineWidth = 0.95;
  ctx.lineCap = 'round';
  stroke(ctx, [
    [-2.4, 4.2],
    [-1.2, 2.6],
    [-2.0, 1.5],
    [-0.6, 0.9],
    [0.9, 1.6],
    [1.2, 3.0],
    [2.4, 4.2],
  ]);
  ctx.stroke();
  ctx.strokeStyle = rgba(c.hide.shade, 0.85);
  ctx.lineWidth = 0.4;
  ctx.stroke();
  ctx.strokeStyle = rgba(c.lineColor, 0.75);
  ctx.lineWidth = 0.07;
  ctx.stroke();
  ctx.restore();

  // Head.
  const head = (g: CanvasRenderingContext2D) =>
    blob(g, [[-1.1 + c.jitter, -0.35], [-0.5, -1.0], [0.9, -0.85], [1.5, -0.1], [0.9, 0.7], [-0.6, 0.7]], 0.9);
  cel(ctx, head, c.hide, { x: -1.2, y: -1.1, w: 2.8, h: 1.9 }, {
    angle: light,
    coverage: 0.4,
    line: c.lineColor,
    lineWidth: 0.07,
    rim: rgba('#FFFFFF', 0.35),
    rimWidth: 0.05,
  });
  beastEye(ctx, c, 0.35 + c.jitter, -0.35, 0.17, true);
  // Forked tongue.
  ctx.save();
  ctx.strokeStyle = '#E8506B';
  ctx.lineWidth = 0.08;
  stroke(ctx, [
    [1.35, 0.35],
    [2.1, 0.6],
  ]);
  ctx.stroke();
  stroke(ctx, [
    [2.1, 0.6],
    [2.5, 0.42],
  ]);
  ctx.stroke();
  stroke(ctx, [
    [2.1, 0.6],
    [2.5, 0.82],
  ]);
  ctx.stroke();
  ctx.restore();
  void rng;
}

function drawInsect(ctx: CanvasRenderingContext2D, c: Creature, rng: Rand, light: number): void {
  // Segmented body.
  for (let i = 0; i < 3; i++) {
    cel(
      ctx,
      (g) => {
        g.beginPath();
        g.ellipse(0, 1.5 + i * 1.05, 1.35 - i * 0.12, 0.75, 0, 0, Math.PI * 2);
      },
      c.hide,
      { x: -1.4, y: 0.8 + i * 1.05, w: 2.8, h: 1.6 },
      { angle: light, coverage: 0.42, line: c.lineColor, lineWidth: 0.07, rim: rgba('#FFFFFF', 0.3), rimWidth: 0.05 },
    );
  }
  // Legs.
  ctx.save();
  ctx.strokeStyle = c.hide.shade;
  ctx.lineWidth = 0.15;
  for (const s of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      stroke(ctx, [
        [s * 1.1, 1.4 + i * 0.9],
        [s * 2.2, 1.0 + i * 1.0],
        [s * 2.7, 2.0 + i * 1.0],
      ]);
      ctx.stroke();
    }
  }
  ctx.restore();
  // Head with mandibles.
  const head = (g: CanvasRenderingContext2D) => {
    g.beginPath();
    g.ellipse(c.jitter, -0.1, 1.0, 0.85, 0, 0, Math.PI * 2);
  };
  cel(ctx, head, c.hide, { x: -1.1, y: -1, w: 2.2, h: 1.8 }, {
    angle: light,
    coverage: 0.4,
    line: c.lineColor,
    lineWidth: 0.07,
  });
  for (const s of [-1, 1]) {
    cel(
      ctx,
      (g) => sliver(g, [s * 0.6, 0.55], [s * 1.35, 1.3], 0.13, s * 0.25),
      ramp('#D8CDBE', 0.9),
      { x: s > 0 ? 0.5 : -1.5, y: 0.4, w: 1, h: 1.1 },
      { angle: light, coverage: 0.42, line: c.lineColor, lineWidth: 0.05 },
    );
  }
  // Antennae.
  ctx.save();
  ctx.strokeStyle = c.lineColor;
  ctx.lineWidth = 0.07;
  for (const s of [-1, 1]) {
    stroke(ctx, [
      [s * 0.4, -0.8],
      [s * 1.0, -1.7],
      [s * 1.7, -2.0],
    ]);
    ctx.stroke();
  }
  ctx.restore();
  beastEye(ctx, c, -0.45 + c.jitter, -0.25, 0.24, false);
  beastEye(ctx, c, 0.45 + c.jitter, -0.25, 0.24, false);
  void rng;
}

function drawDemon(ctx: CanvasRenderingContext2D, c: Creature, rng: Rand, light: number): void {
  // A heavy torso with a horned skull-like head.
  cel(
    ctx,
    (g) => blob(g, [[-1.9, 1.4], [-2.5, 2.6], [-2.2, 4.4], [2.2, 4.4], [2.5, 2.6], [1.9, 1.4]], 0.88),
    c.hide,
    { x: -2.6, y: 1.3, w: 5.2, h: 3.2 },
    { angle: light, coverage: 0.44, line: c.lineColor, lineWidth: 0.08 },
  );
  const head = (g: CanvasRenderingContext2D) =>
    blob(g, [[-1.15 + c.jitter, -0.45], [-0.85, -1.25], [0.85, -1.25], [1.15 + c.jitter, -0.45], [0.55, 0.95], [-0.55, 0.95]], 0.9);
  cel(ctx, head, c.hide, { x: -1.3, y: -1.4, w: 2.6, h: 2.5 }, {
    angle: light,
    coverage: 0.4,
    line: c.lineColor,
    lineWidth: 0.075,
    rim: rgba('#FF9A6B', 0.4),
    rimWidth: 0.05,
  });
  for (const s of [-1, 1]) {
    cel(
      ctx,
      (g) => {
        g.beginPath();
        g.moveTo(s * 0.75, -1.05);
        g.bezierCurveTo(s * 1.7, -1.5, s * 2.1, -2.3, s * 1.85, -2.9);
        g.bezierCurveTo(s * 1.8, -2.05, s * 1.3, -1.5, s * 0.5, -0.95);
        g.closePath();
      },
      ramp('#3A2A2E', 1),
      { x: s > 0 ? 0.4 : -2.2, y: -3, w: 1.8, h: 2.1 },
      { angle: light, coverage: 0.42, line: c.lineColor, lineWidth: 0.06 },
    );
  }
  beastEye(ctx, c, -0.42 + c.jitter, -0.3, 0.2, true);
  beastEye(ctx, c, 0.42 + c.jitter, -0.3, 0.2, true);
  teeth(ctx, c, [-0.42, 0.42], [0.42, 0.42], 5, 0.13);
  void rng;
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

export interface CreatureFrame {
  cx: number;
  cy: number;
  unit: number;
}

export function drawCreature(
  ctx: CanvasRenderingContext2D,
  c: Creature,
  rng: Rand,
  frame: CreatureFrame,
  lightAngle: number,
): void {
  ctx.save();
  ctx.translate(frame.cx, frame.cy);
  ctx.scale(frame.unit, frame.unit);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  // Same rule as the portraits: light from the side, never from a diagonal.
  const light = Math.cos(lightAngle) >= 0 ? 0 : Math.PI;

  switch (c.spec.kind) {
    case 'dragon':
      drawDragon(ctx, c, rng, light);
      break;
    case 'wolf':
      drawWolf(ctx, c, rng, light);
      break;
    case 'bird':
      drawBird(ctx, c, rng, light);
      break;
    case 'serpent':
      drawSerpent(ctx, c, rng, light);
      break;
    case 'skeleton':
      drawSkeleton(ctx, c, rng, light);
      break;
    case 'ghost':
      drawGhost(ctx, c, rng, light);
      break;
    case 'golem':
      drawGolem(ctx, c, rng, light);
      break;
    case 'slime':
      drawSlime(ctx, c, rng, light);
      break;
    case 'insect':
      drawInsect(ctx, c, rng, light);
      break;
    case 'demon':
      drawDemon(ctx, c, rng, light);
      break;
    case 'imp':
      drawImp(ctx, c, rng, light);
      break;
    default:
      break;
  }

  ctx.restore();
}
