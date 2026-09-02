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

  // A wing rising behind the shoulder, so the animal has a body attached to
  // the head rather than a neck leaving frame.
  const wingTone = ramp(shift(c.hide.base, 0.01, -0.03, -0.07), 1.0);
  for (const [s, back] of [[-1, true], [1, false]] as [number, boolean][]) {
    // Kept inside the art window: reach much past ~3 units and the scalloped
    // half of the wing is cropped away, leaving only the leading-edge blade.
    const reach = back ? 0.78 : 0.64;
    // Shoulder plus four finger tips, with the trailing edge scalloped back
    // toward the shoulder between them. A wing drawn as one tapered wedge is a
    // shard; the scallops are what make it a membrane on a hand.
    const shoulder: Pt = [s * 0.9, 2.1];
    const tips: Pt[] = [
      [s * 4.0 * reach, -2.6],
      [s * 3.9 * reach, -0.8],
      [s * 3.2 * reach, 0.7],
      [s * 2.3 * reach, 1.9],
    ];
    const membrane = (g: CanvasRenderingContext2D) => {
      g.beginPath();
      g.moveTo(shoulder[0], shoulder[1]);
      // Leading edge, bowed outward.
      g.bezierCurveTo(s * 1.6 * reach, 0.6, s * 3.0 * reach, -1.2, tips[0][0], tips[0][1]);
      for (let i = 0; i < tips.length - 1; i++) {
        const a = tips[i];
        const b = tips[i + 1];
        // Control point pulled toward the shoulder: a concave trailing edge.
        g.quadraticCurveTo(
          (a[0] + b[0]) / 2 + (shoulder[0] - (a[0] + b[0]) / 2) * 0.34,
          (a[1] + b[1]) / 2 + (shoulder[1] - (a[1] + b[1]) / 2) * 0.34,
          b[0],
          b[1],
        );
      }
      g.quadraticCurveTo(s * 1.3 * reach, 2.5, shoulder[0], shoulder[1]);
      g.closePath();
    };
    ctx.save();
    ctx.globalAlpha = back ? 0.82 : 1;
    cel(ctx, membrane, wingTone, { x: s > 0 ? 0.9 : -4.1, y: -2.4, w: 3.2, h: 5.0 }, {
      angle: light,
      coverage: back ? 0.56 : 0.42,
      line: c.lineColor,
      lineWidth: 0.06,
    });
    within(ctx, membrane, (g) => {
      // The finger bones, thick at the knuckle and tapering to the tip.
      for (const t of tips.slice(0, 3)) {
        g.fillStyle = rgba(wingTone.shade, 0.95);
        sliver(g, shoulder, t, 0.11, s * 0.18);
        g.fill();
        g.strokeStyle = rgba(c.lineColor, 0.45);
        g.lineWidth = 0.045;
        g.stroke();
      }
    });
    ctx.restore();
  }

  // Neck: an S from the jaw down into the shoulders. A vertical tube reads as
  // a pipe with a dragon head on it.
  const neck = (g: CanvasRenderingContext2D) => {
    g.beginPath();
    g.moveTo(0.45, 0.45);
    g.bezierCurveTo(0.95, 1.3, 1.05, 2.2, 0.92, 3.0);
    g.bezierCurveTo(1.4, 3.9, 2.1, 4.4, 2.5, 5.2);
    g.lineTo(-2.5, 5.2);
    g.bezierCurveTo(-2.1, 4.3, -1.5, 3.7, -1.16, 3.0);
    g.bezierCurveTo(-1.0, 2.1, -0.72, 1.2, -0.62, 0.3);
    g.closePath();
  };
  cel(ctx, neck, c.hide, { x: -2.5, y: 0.3, w: 5.0, h: 4.9 }, {
    angle: light,
    coverage: 0.3,
    line: c.lineColor,
    lineWidth: 0.07,
  });

  within(ctx, neck, (g) => {
    // Belly plates: chevrons following the front of the throat. Horizontal
    // bands turn the neck into a caterpillar.
    g.fillStyle = rgba(c.belly.base, 0.9);
    g.strokeStyle = rgba(c.lineColor, 0.3);
    g.lineWidth = 0.045;
    for (let i = 0; i < 7; i++) {
      const y = 0.85 + i * 0.55;
      const half = 0.34 + i * 0.09;
      const cx = 0.2 + i * 0.03;
      const dip = 0.16;
      g.beginPath();
      g.moveTo(cx - half, y);
      g.quadraticCurveTo(cx, y + dip * 2, cx + half, y);
      g.lineTo(cx + half, y + 0.3);
      g.quadraticCurveTo(cx, y + dip * 2 + 0.3, cx - half, y + 0.3);
      g.closePath();
      g.fill();
      g.stroke();
    }
    // Scale arcs over the rest of it.
    g.strokeStyle = rgba(c.hide.shade, 0.5);
    g.lineWidth = 0.04;
    for (let i = 0; i < 22; i++) {
      const x = rng.range(-1.6, 1.2);
      const y = rng.range(0.5, 4.6);
      g.beginPath();
      g.arc(x, y, rng.range(0.1, 0.19), Math.PI * 0.15, Math.PI * 0.85);
      g.stroke();
    }
  });

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
    coverage: 0.26,
    line: c.lineColor,
    lineWidth: 0.075,
    rim: rgba('#FFFFFF', 0.35),
    rimWidth: 0.05,
  });

  // Scale texture over the skull.
  within(ctx, skull, (g) => {
    g.strokeStyle = rgba(c.hide.shade, 0.55);
    g.lineWidth = 0.04;
    for (let i = 0; i < 14; i++) {
      const x = rng.range(-1.2, 1.6);
      const y = rng.range(-1.0, 0.4);
      g.beginPath();
      g.arc(x, y, rng.range(0.09, 0.17), Math.PI * 0.15, Math.PI * 0.85);
      g.stroke();
    }
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
    { angle: light, coverage: 0.44, line: c.lineColor, lineWidth: 0.06 },
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

  // Frill spines down the back of the neck, hugging it rather than splaying.
  for (let i = 0; i < 6; i++) {
    const y = 0.85 + i * 0.6;
    const root = -0.72 - i * 0.09;
    cel(
      ctx,
      (g) => sliver(g, [root, y], [root - 0.62 - i * 0.09, y - 0.42], 0.1, 0.07),
      c.accent,
      { x: -2.0, y: y - 0.6, w: 1.4, h: 0.9 },
      { angle: light, coverage: 0.45, line: c.lineColor, lineWidth: 0.05 },
    );
  }

  beastEye(ctx, c, 0.35 + j, -0.32, 0.23, true);

  // Brow ridge over the eye — what makes a dragon look angry rather than sleepy.
  ctx.save();
  ctx.strokeStyle = c.lineColor;
  ctx.lineWidth = 0.12;
  stroke(ctx, [
    [-0.15 + j, -0.66],
    [0.45 + j, -0.64],
    [0.9 + j, -0.44],
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
  const dark = 'rgba(11,8,15,0.94)';
  /** A bone is a *volume*, not a stroke: every one of these is a filled, shaded form. */
  const boneForm = (
    path: (g: CanvasRenderingContext2D) => void,
    b: { x: number; y: number; w: number; h: number },
    coverage = 0.4,
  ) => {
    cel(ctx, path, bone, b, {
      angle: light,
      coverage,
      line: c.lineColor,
      lineWidth: 0.065,
      edge: 0.03,
    });
  };
  const boneSliver = (from: Pt, to: Pt, width: number, bend = 0) => {
    const b = {
      x: Math.min(from[0], to[0]) - width,
      y: Math.min(from[1], to[1]) - width,
      w: Math.abs(to[0] - from[0]) + width * 2,
      h: Math.abs(to[1] - from[1]) + width * 2,
    };
    boneForm((g) => sliver(g, from, to, width, bend), b, 0.46);
  };

  // ---- Ribcage ------------------------------------------------------------
  // One shaded mass with the intercostal gaps carved out of it. Ribs drawn as
  // separate arcs read as a xylophone; carving the dark between them reads as
  // a chest. The gaps stop short of both the contour and the sternum, because
  // that is where ribs actually meet bone — a gap that runs edge to edge turns
  // the cage into a barrel.
  const cage = (g: CanvasRenderingContext2D) => {
    g.beginPath();
    g.moveTo(-0.78, 2.62);
    g.bezierCurveTo(-1.24, 2.72, -1.5, 3.2, -1.42, 3.72);
    g.bezierCurveTo(-1.34, 4.4, -0.9, 5.0, -0.34, 5.3);
    g.quadraticCurveTo(0, 5.42, 0.34, 5.3);
    g.bezierCurveTo(0.9, 5.0, 1.34, 4.4, 1.42, 3.72);
    g.bezierCurveTo(1.5, 3.2, 1.24, 2.72, 0.78, 2.62);
    g.quadraticCurveTo(0, 2.86, -0.78, 2.62);
    g.closePath();
  };
  boneForm(cage, { x: -1.5, y: 2.6, w: 3.0, h: 2.8 }, 0.44);
  within(ctx, cage, (g) => {
    g.fillStyle = dark;
    for (let i = 0; i < 4; i++) {
      const y = 3.02 + i * 0.52;
      const reach = 1.16 - i * 0.06;
      const sag = 0.3;
      const th = 0.19;
      for (const s2 of [-1, 1]) {
        g.beginPath();
        g.moveTo(s2 * 0.2, y);
        g.quadraticCurveTo(s2 * 0.8, y + sag, s2 * reach, y + sag * 1.5);
        g.lineTo(s2 * reach, y + sag * 1.5 + th);
        g.quadraticCurveTo(s2 * 0.8, y + sag + th, s2 * 0.2, y + th);
        g.closePath();
        g.fill();
      }
    }
    // The hollow behind the ribs, so the cage has an inside.
    g.fillStyle = 'rgba(10,7,14,0.45)';
    g.beginPath();
    g.ellipse(0, 4.1, 0.72, 1.2, 0, 0, Math.PI * 2);
    g.fill();
  });
  // Sternum, laid back over the carved gaps.
  boneForm(
    (g) => {
      g.beginPath();
      g.moveTo(-0.22, 2.72);
      g.quadraticCurveTo(0, 2.6, 0.22, 2.72);
      g.lineTo(0.14, 4.5);
      g.quadraticCurveTo(0, 4.7, -0.14, 4.5);
      g.closePath();
    },
    { x: -0.24, y: 2.6, w: 0.48, h: 2.1 },
    0.5,
  );

  // ---- Neck, then the shoulder girdle over the top of the cage ------------
  for (let i = 0; i < 3; i++) {
    const y = 1.64 + i * 0.3;
    boneForm(
      (g) => {
        g.beginPath();
        g.moveTo(-0.24 - i * 0.04, y - 0.1);
        g.quadraticCurveTo(0, y - 0.22, 0.24 + i * 0.04, y - 0.1);
        g.quadraticCurveTo(0.3 + i * 0.04, y + 0.1, 0, y + 0.13);
        g.quadraticCurveTo(-0.3 - i * 0.04, y + 0.1, -0.24 - i * 0.04, y - 0.1);
        g.closePath();
      },
      { x: -0.34, y: y - 0.24, w: 0.68, h: 0.4 },
      0.48,
    );
  }
  for (const s2 of [-1, 1]) {
    // Clavicle, scapula head, humerus — an arm hangs off a girdle, not a socket
    // drawn on the ribs.
    boneSliver([s2 * 0.14, 2.34], [s2 * 1.66, 2.6], 0.13, s2 * -0.2);
    boneForm(
      (g) => {
        g.beginPath();
        g.ellipse(s2 * 1.82, 2.78, 0.36, 0.42, s2 * 0.34, 0, Math.PI * 2);
      },
      { x: s2 * 1.82 - 0.4, y: 2.36, w: 0.8, h: 0.86 },
      0.44,
    );
    // Humerus, then an elbow and forearm, so the arm is a limb and not a pin.
    boneSliver([s2 * 1.88, 2.98], [s2 * 2.14, 4.34], 0.21, s2 * 0.13);
    boneForm(
      (g) => {
        g.beginPath();
        g.ellipse(s2 * 2.14, 4.38, 0.22, 0.2, 0, 0, Math.PI * 2);
      },
      { x: s2 * 2.14 - 0.24, y: 4.16, w: 0.48, h: 0.44 },
      0.46,
    );
    boneSliver([s2 * 2.12, 4.5], [s2 * 1.86, 5.9], 0.16, s2 * -0.1);
  }

  // ---- Mandible, behind the cranium so the cranium overhangs it ------------
  boneForm(
    (g) => {
      g.beginPath();
      g.moveTo(-0.82, 0.34);
      g.bezierCurveTo(-0.9, 1.12, -0.52, 1.44, 0, 1.44);
      g.bezierCurveTo(0.52, 1.44, 0.9, 1.12, 0.82, 0.34);
      g.lineTo(0.58, 0.34);
      g.bezierCurveTo(0.62, 1.0, 0.36, 1.16, 0, 1.16);
      g.bezierCurveTo(-0.36, 1.16, -0.62, 1.0, -0.58, 0.34);
      g.closePath();
    },
    { x: -0.9, y: 0.3, w: 1.8, h: 1.2 },
    0.44,
  );

  // ---- Cranium ------------------------------------------------------------
  const skull = (g: CanvasRenderingContext2D) => {
    g.beginPath();
    g.moveTo(-1.04, 0.02);
    g.bezierCurveTo(-1.3, -1.02, -0.78, -1.66, 0, -1.66);
    g.bezierCurveTo(0.78, -1.66, 1.3, -1.02, 1.04, 0.02);
    // Zygomatic arch out, then in to the maxilla.
    g.bezierCurveTo(1.0, 0.44, 0.82, 0.6, 0.6, 0.66);
    g.bezierCurveTo(0.64, 0.96, 0.42, 1.08, 0, 1.08);
    g.bezierCurveTo(-0.42, 1.08, -0.64, 0.96, -0.6, 0.66);
    g.bezierCurveTo(-0.82, 0.6, -1.0, 0.44, -1.04, 0.02);
    g.closePath();
  };
  cel(ctx, skull, bone, { x: -1.3, y: -1.7, w: 2.6, h: 2.8 }, {
    angle: light,
    coverage: 0.33,
    line: c.lineColor,
    lineWidth: 0.075,
    edge: 0.04,
    rim: rgba('#FFFFFF', 0.4),
    rimWidth: 0.05,
  });

  within(ctx, skull, (g) => {
    // Temporal hollow and brow ridge: the two planes that make a skull a skull.
    g.fillStyle = rgba(bone.shade, 0.85);
    for (const s2 of [-1, 1]) {
      g.beginPath();
      g.ellipse(s2 * 0.92, -0.55, 0.42, 0.55, s2 * 0.25, 0, Math.PI * 2);
      g.fill();
    }
    g.beginPath();
    g.moveTo(-1.0, -0.72);
    g.bezierCurveTo(-0.5, -0.92, 0.5, -0.92, 1.0, -0.72);
    g.lineTo(1.0, -0.5);
    g.bezierCurveTo(0.5, -0.66, -0.5, -0.66, -1.0, -0.5);
    g.closePath();
    g.fill();
    // Cranial suture.
    g.strokeStyle = rgba(c.lineColor, 0.28);
    g.lineWidth = 0.045;
    stroke(g, [
      [-0.95, -0.72],
      [-0.45, -1.3],
      [0.2, -1.5],
      [0.85, -1.15],
    ]);
    g.stroke();
  });

  // ---- Sockets, nose, teeth ----------------------------------------------
  for (const s2 of [-1, 1]) {
    flat(
      ctx,
      (g) => {
        g.beginPath();
        g.moveTo(s2 * 0.16, -0.42);
        g.bezierCurveTo(s2 * 0.34, -0.72, s2 * 0.82, -0.72, s2 * 0.86, -0.34);
        g.bezierCurveTo(s2 * 0.9, 0.02, s2 * 0.6, 0.24, s2 * 0.38, 0.12);
        g.bezierCurveTo(s2 * 0.2, 0.02, s2 * 0.14, -0.2, s2 * 0.16, -0.42);
        g.closePath();
      },
      '#120C18',
      rgba(c.lineColor, 0.8),
      0.05,
    );
    beastEye(ctx, c, s2 * 0.5, -0.24, 0.15, false);
    // Cheekbone.
    ctx.strokeStyle = rgba(c.lineColor, 0.35);
    ctx.lineWidth = 0.05;
    stroke(ctx, [
      [s2 * 0.94, 0.06],
      [s2 * 0.66, 0.38],
      [s2 * 0.44, 0.44],
    ]);
    ctx.stroke();
  }
  flat(
    ctx,
    (g) => {
      g.beginPath();
      g.moveTo(0, 0.18);
      g.bezierCurveTo(0.14, 0.34, 0.19, 0.5, 0.15, 0.58);
      g.bezierCurveTo(0.07, 0.5, -0.07, 0.5, -0.15, 0.58);
      g.bezierCurveTo(-0.19, 0.5, -0.14, 0.34, 0, 0.18);
      g.closePath();
    },
    '#120C18',
  );

  // The mouth: a dark gap with bone standing in it, not seven scratches.
  flat(
    ctx,
    (g) => {
      g.beginPath();
      g.moveTo(-0.56, 0.8);
      g.quadraticCurveTo(0, 0.9, 0.56, 0.8);
      g.quadraticCurveTo(0.5, 1.18, 0, 1.24);
      g.quadraticCurveTo(-0.5, 1.18, -0.56, 0.8);
      g.closePath();
    },
    '#0E0914',
  );
  within(
    ctx,
    (g) => {
      g.beginPath();
      g.moveTo(-0.56, 0.8);
      g.quadraticCurveTo(0, 0.9, 0.56, 0.8);
      g.quadraticCurveTo(0.5, 1.18, 0, 1.24);
      g.quadraticCurveTo(-0.5, 1.18, -0.56, 0.8);
      g.closePath();
    },
    (g) => {
      for (let i = 0; i < 6; i++) {
        const x = -0.46 + (i / 5) * 0.92;
        g.fillStyle = i % 2 === 0 ? bone.base : bone.shade;
        g.beginPath();
        g.rect(x - 0.07, 0.76, 0.14, 0.2);
        g.fill();
        g.fillStyle = i % 2 === 0 ? bone.shade : bone.base;
        g.beginPath();
        g.rect(x - 0.07, 1.02, 0.14, 0.22);
        g.fill();
      }
      g.strokeStyle = rgba(c.lineColor, 0.55);
      g.lineWidth = 0.04;
      stroke(g, [
        [-0.6, 0.98],
        [0, 1.04],
        [0.6, 0.98],
      ]);
      g.stroke();
    },
  );
  void rng;
}

function drawGhost(ctx: CanvasRenderingContext2D, c: Creature, rng: Rand, light: number): void {
  const shroud = ramp(shift(c.hide.base, 0, 0.04, -0.24), 0.9);

  // The shroud: shoulders, then a body that frays into separate tatters. A
  // single closed outline with a wavy hem reads as a lozenge with a scalloped
  // bottom, so the tatters are drawn as their own hanging shapes.
  ctx.save();
  ctx.globalAlpha = 0.9;
  const cloth = (g: CanvasRenderingContext2D) =>
    blob(
      g,
      [
        // Shoulders, kept as corners: smoothed away, the shroud becomes an egg.
        [-0.8, -0.3],
        [-1.72, 0.34],
        [-1.55, 1.2],
        [-2.02, 2.35],
        [-1.72, 3.5],
        [0, 3.9],
        [1.72, 3.5],
        [2.02, 2.35],
        [1.55, 1.2],
        [1.72, 0.34],
        [0.8, -0.3],
      ],
      0.62,
    );
  cel(ctx, cloth, shroud, { x: -2.1, y: -0.6, w: 4.2, h: 4.5 }, {
    angle: light,
    coverage: 0.44,
    line: rgba(c.lineColor, 0.55),
    lineWidth: 0.06,
  });
  // Tatters hanging off the hem.
  for (let i = 0; i < 7; i++) {
    const u = i / 6;
    const x = -1.75 + u * 3.5;
    const len = rng.range(0.7, 1.9);
    cel(
      ctx,
      (g) => sliver(g, [x, 3.1], [x + rng.range(-0.35, 0.35), 3.5 + len], rng.range(0.14, 0.3), rng.range(-0.25, 0.25)),
      shroud,
      { x: x - 0.5, y: 3.0, w: 1, h: len + 0.9 },
      { angle: light, coverage: 0.46, line: rgba(c.lineColor, 0.45), lineWidth: 0.05 },
    );
  }
  // Folds falling from the shoulders.
  within(ctx, cloth, (g) => {
    g.strokeStyle = rgba(shroud.shade, 0.8);
    g.lineCap = 'round';
    for (let i = 0; i < 5; i++) {
      const x = -1.3 + (i / 4) * 2.6;
      g.lineWidth = rng.range(0.05, 0.1);
      stroke(g, [
        [x * 0.5, 0.1],
        [x * 0.85, 1.7],
        [x, 3.4],
      ]);
      g.stroke();
    }
  });
  ctx.restore();

  // The cowl: a peaked hood whose opening is a void with two lights in it.
  const hood = (g: CanvasRenderingContext2D) => {
    g.beginPath();
    g.moveTo(-1.18, 0.35);
    g.bezierCurveTo(-1.32, -0.85, -0.85, -1.75, 0.06, -1.9);
    g.bezierCurveTo(0.95, -1.75, 1.32, -0.85, 1.18, 0.35);
    g.bezierCurveTo(0.8, 0.72, -0.8, 0.72, -1.18, 0.35);
    g.closePath();
  };
  cel(ctx, hood, ramp(shift(c.hide.base, 0, 0.06, -0.2), 0.95), { x: -1.35, y: -2.0, w: 2.7, h: 2.8 }, {
    angle: light,
    coverage: 0.42,
    line: rgba(c.lineColor, 0.7),
    lineWidth: 0.065,
  });
  flat(
    ctx,
    (g) => {
      g.beginPath();
      g.moveTo(-0.86, -0.62);
      g.bezierCurveTo(-0.95, -1.35, -0.5, -1.6, 0.04, -1.6);
      g.bezierCurveTo(0.58, -1.6, 0.95, -1.35, 0.86, -0.62);
      g.bezierCurveTo(0.6, 0.24, -0.6, 0.24, -0.86, -0.62);
      g.closePath();
    },
    '#0B0812',
  );
  beastEye(ctx, c, -0.34, -0.7, 0.17, false);
  beastEye(ctx, c, 0.34, -0.7, 0.17, false);

  // Skeletal hands reaching out of the sleeves at the shroud's edge.
  const boneTones = ramp('#DCD4C0', 0.9);
  for (const s of [-1, 1]) {
    cel(
      ctx,
      (g) => sliver(g, [s * 1.78, 1.85], [s * 1.42, 2.62], 0.19, s * 0.08),
      boneTones,
      { x: s > 0 ? 1.2 : -2.0, y: 1.7, w: 0.8, h: 1.1 },
      { angle: light, coverage: 0.44, line: rgba(c.lineColor, 0.65), lineWidth: 0.05 },
    );
    for (let i = 0; i < 3; i++) {
      cel(
        ctx,
        (g) => sliver(g, [s * (1.48 - i * 0.06), 2.5], [s * (1.16 + i * 0.3), 3.05 + i * 0.16], 0.085, s * 0.07),
        boneTones,
        { x: s > 0 ? 1.0 : -1.9, y: 2.4, w: 0.9, h: 0.9 },
        { angle: light, coverage: 0.44, line: rgba(c.lineColor, 0.6), lineWidth: 0.042 },
      );
    }
  }

  // Wisps drifting off it.
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 14; i++) {
    ctx.fillStyle = rgba(c.hide.light, rng.range(0.1, 0.35));
    ctx.beginPath();
    ctx.ellipse(rng.range(-2.4, 2.4), rng.range(-2, 4), rng.range(0.05, 0.17), rng.range(0.05, 0.17), 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawGolem(ctx: CanvasRenderingContext2D, c: Creature, rng: Rand, light: number): void {
  const j = c.jitter;
  /** A block of stone: cel-shaded, then a chipped facet cut off one corner. */
  const rock = (pts: Pt[], facet?: Pt[]) => {
    const xs = pts.map((q) => q[0]);
    const ys = pts.map((q) => q[1]);
    const path = (g: CanvasRenderingContext2D) => {
      g.beginPath();
      g.moveTo(pts[0][0], pts[0][1]);
      for (const q of pts.slice(1)) g.lineTo(q[0], q[1]);
      g.closePath();
    };
    cel(
      ctx,
      path,
      c.hide,
      {
        x: Math.min(...xs),
        y: Math.min(...ys),
        w: Math.max(...xs) - Math.min(...xs),
        h: Math.max(...ys) - Math.min(...ys),
      },
      {
        angle: light,
        coverage: 0.4,
        line: c.lineColor,
        lineWidth: 0.08,
        edge: 0,
        rim: rgba('#FFFFFF', 0.3),
        rimWidth: 0.05,
      },
    );
    if (facet) {
      within(ctx, path, (g) => {
        g.fillStyle = rgba(c.hide.light, 0.4);
        g.beginPath();
        g.moveTo(facet[0][0], facet[0][1]);
        for (const q of facet.slice(1)) g.lineTo(q[0], q[1]);
        g.closePath();
        g.fill();
        g.strokeStyle = rgba(c.lineColor, 0.4);
        g.lineWidth = 0.055;
        g.stroke();
      });
    }
  };

  // Arms hang off boulder shoulders; the torso is laid over their inner edge so
  // the figure is one mass rather than five slabs in a row.
  for (const s of [-1, 1]) {
    rock([
      [s * 1.5, 1.5],
      [s * 3.05, 1.85],
      [s * 3.2, 3.5],
      [s * 2.75, 5.4],
      [s * 1.7, 5.2],
      [s * 1.95, 3.3],
    ]);
    // A fist of three knuckle blocks.
    rock([
      [s * 1.68, 5.1],
      [s * 2.85, 5.3],
      [s * 2.95, 6.15],
      [s * 1.72, 6.0],
    ], [[s * 1.72, 5.55], [s * 2.9, 5.72], [s * 2.9, 5.86], [s * 1.72, 5.7]]);
    rock([
      [s * 1.25, 1.0],
      [s * 2.7, 1.25],
      [s * 3.0, 2.3],
      [s * 1.55, 2.5],
    ], [[s * 1.3, 1.06], [s * 2.68, 1.3], [s * 2.5, 1.72], [s * 1.4, 1.6]]);
  }

  rock(
    [
      [-1.9, 1.15],
      [-0.95, 0.62],
      [0.95, 0.62],
      [1.9, 1.15],
      [1.55, 3.6],
      [1.15, 5.6],
      [-1.15, 5.6],
      [-1.55, 3.6],
    ],
    [
      [-1.86, 1.18],
      [-0.9, 0.68],
      [-0.55, 1.5],
      [-1.42, 3.4],
    ],
  );

  // Head: a small block sunk between the shoulders, with a heavy brow.
  rock(
    [
      [-0.92 + j, -0.2],
      [-0.72 + j, -1.35],
      [0.74 + j, -1.4],
      [0.94 + j, -0.25],
      [0.62 + j, 0.78],
      [-0.6 + j, 0.75],
    ],
    [[-0.9 + j, -0.24], [-0.7 + j, -1.3], [-0.3 + j, -1.32], [-0.44 + j, 0.6]],
  );
  flat(
    ctx,
    (g) => {
      g.beginPath();
      g.moveTo(-0.9 + j, -0.6);
      g.lineTo(0.92 + j, -0.66);
      g.lineTo(0.86 + j, -0.28);
      g.lineTo(-0.84 + j, -0.22);
      g.closePath();
    },
    rgba(c.hide.shade, 0.95),
  );

  // The rune-light: eyes, a chest core, and the seams it leaks along.
  ctx.save();
  ctx.shadowColor = rgba(c.accent.light, 0.9);
  ctx.shadowBlur = 22;
  flat(
    ctx,
    (g) => {
      g.beginPath();
      g.moveTo(0, 1.9);
      g.lineTo(0.5, 2.7);
      g.lineTo(0, 3.5);
      g.lineTo(-0.5, 2.7);
      g.closePath();
    },
    c.accent.light,
  );
  ctx.restore();
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = rgba(c.accent.light, 0.75);
  ctx.lineCap = 'round';
  for (const s of [-1, 1]) {
    ctx.lineWidth = 0.09;
    stroke(ctx, [
      [s * 0.42, 2.6],
      [s * 0.95, 2.2],
      [s * 1.3, 1.4],
    ]);
    ctx.stroke();
    ctx.lineWidth = 0.07;
    stroke(ctx, [
      [s * 0.34, 3.1],
      [s * 0.8, 3.7],
      [s * 1.0, 4.8],
    ]);
    ctx.stroke();
  }
  ctx.restore();
  beastEye(ctx, c, j - 0.36, -0.42, 0.14, false);
  beastEye(ctx, c, j + 0.36, -0.42, 0.14, false);

  // Cracks in the stone, kept off the glowing seams.
  ctx.save();
  ctx.strokeStyle = rgba(c.lineColor, 0.45);
  for (let i = 0; i < 5; i++) {
    const x = rng.range(-1.5, 1.5);
    ctx.lineWidth = rng.range(0.04, 0.08);
    stroke(ctx, [
      [x, 1.3 + rng.range(0, 0.6)],
      [x + rng.range(-0.35, 0.35), 3.0],
      [x + rng.range(-0.5, 0.5), 4.6],
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
  const j = c.jitter;
  const skin = c.hide;

  // Ears first, so the head overlaps their roots. A gremlin's ear is a swept
  // blade with a thin cartilage ridge, not a triangle stuck on the side.
  for (const s of [-1, 1]) {
    const ear = (g: CanvasRenderingContext2D) => {
      g.beginPath();
      g.moveTo(s * 0.85, -0.5);
      g.bezierCurveTo(s * 1.36, -1.05, s * 1.86, -1.36, s * 2.08, -1.3);
      g.bezierCurveTo(s * 1.98, -0.88, s * 1.66, -0.2, s * 1.02, 0.28);
      g.closePath();
    };
    cel(ctx, ear, skin, { x: s > 0 ? 0.8 : -2.5, y: -1.6, w: 1.7, h: 2.0 }, {
      angle: light,
      coverage: 0.46,
      line: c.lineColor,
      lineWidth: 0.06,
    });
    within(ctx, ear, (g) => {
      g.fillStyle = rgba(shift(skin.base, 0.02, 0.06, -0.16), 0.9);
      g.beginPath();
      g.moveTo(s * 1.0, -0.42);
      g.bezierCurveTo(s * 1.4, -0.88, s * 1.76, -1.1, s * 1.88, -1.06);
      g.bezierCurveTo(s * 1.76, -0.8, s * 1.44, -0.32, s * 1.04, 0.02);
      g.closePath();
      g.fill();
    });
  }

  // Skinny arms reaching in front of the belly. They sit high on the chest:
  // a bust crop lands around y≈3, and an arm below that leaves a limbless lump.
  for (const s of [-1, 1]) {
    for (const [from, to, w] of [
      [[s * 0.86, 1.78], [s * 1.78, 2.66], 0.19],
      [[s * 1.78, 2.66], [s * 1.02, 3.42], 0.15],
    ] as [Pt, Pt, number][]) {
      // A shade darker than the chest: an arm in the body's own tone shows up
      // as an outline and nothing else.
      cel(ctx, (g) => sliver(g, from, to, w, s * 0.12), ramp(shift(skin.base, 0, 0.03, -0.09), 1), {
        x: Math.min(from[0], to[0]) - 0.3,
        y: Math.min(from[1], to[1]) - 0.3,
        w: Math.abs(to[0] - from[0]) + 0.6,
        h: Math.abs(to[1] - from[1]) + 0.6,
      }, { angle: light, coverage: 0.46, line: c.lineColor, lineWidth: 0.055 });
    }
    // A three-fingered hand.
    for (let i = 0; i < 3; i++) {
      cel(
        ctx,
        (g) => sliver(g, [s * (1.04 - i * 0.02), 3.34], [s * (0.7 + i * 0.16), 3.8 + i * 0.1], 0.075, s * 0.06),
        skin,
        { x: s > 0 ? 0.55 : -1.3, y: 3.28, w: 0.75, h: 0.7 },
        { angle: light, coverage: 0.46, line: c.lineColor, lineWidth: 0.045 },
      );
    }
  }

  // Neck, or the head floats above the shoulders.
  cel(
    ctx,
    (g) => {
      g.beginPath();
      g.moveTo(-0.36 + j, 0.7);
      g.lineTo(0.36 + j, 0.7);
      g.lineTo(0.42, 1.75);
      g.lineTo(-0.42, 1.75);
      g.closePath();
    },
    ramp(shift(skin.base, 0, 0.03, -0.12), 1),
    { x: -0.5, y: 0.7, w: 1.0, h: 1.1 },
    { angle: light, coverage: 0.55, line: c.lineColor, lineWidth: 0.06 },
  );

  // Narrow chest over a pot belly — the classic imp build.
  const body = (g: CanvasRenderingContext2D) =>
    blob(
      g,
      [
        [-0.78, 1.5],
        [-1.06, 2.35],
        [-1.34, 3.4],
        [-1.02, 4.5],
        [0, 4.85],
        [1.02, 4.5],
        [1.34, 3.4],
        [1.06, 2.35],
        [0.78, 1.5],
      ],
      0.9,
    );
  cel(ctx, body, skin, { x: -1.4, y: 1.4, w: 2.8, h: 3.5 }, {
    angle: light,
    coverage: 0.42,
    line: c.lineColor,
    lineWidth: 0.07,
  });
  within(ctx, body, (g) => {
    // Belly highlight and a ribbed chest, so the torso is not a bag.
    g.fillStyle = rgba(skin.light, 0.32);
    g.beginPath();
    g.ellipse(0.05, 3.85, 0.72, 0.62, 0, 0, Math.PI * 2);
    g.fill();
    // Two short rib marks per side. Long ones spanning the chest turn the
    // torso into a ladder.
    g.strokeStyle = rgba(c.lineColor, 0.28);
    g.lineWidth = 0.05;
    for (let i = 0; i < 2; i++) {
      const y = 2.2 + i * 0.36;
      for (const s of [-1, 1]) {
        stroke(g, [
          [s * 0.34, y],
          [s * 0.72, y + 0.18],
          [s * 0.9, y + 0.4],
        ]);
        g.stroke();
      }
    }
    // A rag knotted at the waist.
    g.fillStyle = rgba(shift(c.accent.base, 0, 0.05, -0.14), 0.95);
    g.beginPath();
    g.moveTo(-1.5, 4.3);
    g.quadraticCurveTo(0, 4.05, 1.5, 4.3);
    g.lineTo(1.5, 5.1);
    g.lineTo(-1.5, 5.1);
    g.closePath();
    g.fill();
  });

  // Head: a wedge, wide at the temples, tapering past a jutting jaw.
  const head = (g: CanvasRenderingContext2D) => {
    g.beginPath();
    g.moveTo(-1.02 + j, -0.42);
    g.bezierCurveTo(-1.06 + j, -1.24, -0.55 + j, -1.55, 0.05 + j, -1.52);
    g.bezierCurveTo(0.66 + j, -1.5, 1.06 + j, -1.16, 1.0 + j, -0.4);
    g.bezierCurveTo(0.96 + j, 0.16, 0.78 + j, 0.55, 0.5 + j, 0.72);
    g.bezierCurveTo(0.36 + j, 1.12, -0.2 + j, 1.24, -0.5 + j, 0.96);
    g.bezierCurveTo(-0.86 + j, 0.66, -1.0 + j, 0.2, -1.02 + j, -0.42);
    g.closePath();
  };
  cel(ctx, head, skin, { x: -1.2, y: -1.6, w: 2.4, h: 2.9 }, {
    angle: light,
    coverage: 0.38,
    line: c.lineColor,
    lineWidth: 0.075,
    rim: rgba('#FFFFFF', 0.3),
    rimWidth: 0.05,
  });
  within(ctx, head, (g) => {
    // Brow ridge — the one shape that turns a blob into a face.
    g.fillStyle = rgba(skin.shade, 0.9);
    g.beginPath();
    g.moveTo(-1.1 + j, -0.86);
    g.bezierCurveTo(-0.6 + j, -1.1, 0.6 + j, -1.1, 1.1 + j, -0.8);
    g.lineTo(1.1 + j, -0.5);
    g.bezierCurveTo(0.55 + j, -0.72, -0.55 + j, -0.72, -1.1 + j, -0.5);
    g.closePath();
    g.fill();
    // Cheek hollow.
    g.fillStyle = rgba(skin.shade, 0.55);
    for (const s of [-1, 1]) {
      g.beginPath();
      g.ellipse(s * 0.72 + j, 0.12, 0.24, 0.34, s * 0.3, 0, Math.PI * 2);
      g.fill();
    }
  });

  // Horns, swept back over the skull.
  for (const s of [-1, 1]) {
    cel(
      ctx,
      (g) => sliver(g, [s * 0.52 + j, -1.3], [s * 0.92 + j, -2.34], 0.14, s * 0.26),
      ramp('#D8CDBE', 0.9),
      { x: s > 0 ? 0.3 : -1.1, y: -2.4, w: 0.8, h: 1.2 },
      { angle: light, coverage: 0.42, line: c.lineColor, lineWidth: 0.05 },
    );
  }

  beastEye(ctx, c, -0.42 + j, -0.3, 0.2, true);
  beastEye(ctx, c, 0.44 + j, -0.3, 0.2, true);
  // A snub nose with two nostrils.
  ctx.save();
  ctx.strokeStyle = rgba(c.lineColor, 0.7);
  ctx.lineWidth = 0.055;
  stroke(ctx, [
    [-0.04 + j, 0.02],
    [0.14 + j, 0.3],
    [-0.02 + j, 0.36],
  ]);
  ctx.stroke();
  ctx.restore();
  // A wide, uneven grin with an underbite.
  flat(
    ctx,
    (g) => {
      g.beginPath();
      g.moveTo(-0.56 + j, 0.5);
      g.quadraticCurveTo(0 + j, 0.42, 0.56 + j, 0.52);
      g.quadraticCurveTo(0.1 + j, 1.0, -0.56 + j, 0.5);
      g.closePath();
    },
    '#3A1420',
    rgba(c.lineColor, 0.8),
    0.06,
  );
  for (const s of [-1, 1]) {
    flat(
      ctx,
      (g) => {
        g.beginPath();
        g.moveTo(s * 0.4 + j, 0.78);
        g.lineTo(s * 0.28 + j, 0.5);
        g.lineTo(s * 0.5 + j, 0.5);
        g.closePath();
      },
      '#F2ECD8',
    );
  }
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
  const j = c.jitter;

  // Ragged wings behind the shoulders.
  const wing = ramp(shift(c.hide.base, 0, 0.04, -0.2), 1.0);
  for (const s of [-1, 1]) {
    const shoulder: Pt = [s * 1.4, 2.2];
    const tips: Pt[] = [
      [s * 3.0, -1.9],
      [s * 3.0, -0.3],
      [s * 2.6, 1.0],
    ];
    cel(
      ctx,
      (g) => {
        g.beginPath();
        g.moveTo(shoulder[0], shoulder[1]);
        g.bezierCurveTo(s * 1.7, 0.4, s * 2.5, -1.0, tips[0][0], tips[0][1]);
        for (let i = 0; i < tips.length - 1; i++) {
          const a = tips[i];
          const b = tips[i + 1];
          g.quadraticCurveTo(
            (a[0] + b[0]) / 2 + (shoulder[0] - (a[0] + b[0]) / 2) * 0.36,
            (a[1] + b[1]) / 2 + (shoulder[1] - (a[1] + b[1]) / 2) * 0.36,
            b[0],
            b[1],
          );
        }
        g.quadraticCurveTo(s * 1.8, 1.9, shoulder[0], shoulder[1]);
        g.closePath();
      },
      wing,
      { x: s > 0 ? 1.2 : -3.2, y: -2.0, w: 2.0, h: 4.4 },
      { angle: light, coverage: 0.5, line: c.lineColor, lineWidth: 0.06 },
    );
  }

  // Arms first, so the torso overlaps where they meet the chest.
  for (const s of [-1, 1]) {
    cel(
      ctx,
      (g) => sliver(g, [s * 1.5, 2.0], [s * 2.65, 4.4], 0.52, s * 0.3),
      c.hide,
      { x: s > 0 ? 1.0 : -3.2, y: 1.8, w: 2.2, h: 2.9 },
      { angle: light, coverage: 0.46, line: c.lineColor, lineWidth: 0.075 },
    );
  }

  // Torso: broad chest tapering to the waist, with pectorals and an abdomen.
  const torso = (g: CanvasRenderingContext2D) => {
    g.beginPath();
    g.moveTo(-1.05, 1.05);
    g.bezierCurveTo(-1.9, 1.2, -2.35, 1.85, -2.3, 2.6);
    g.bezierCurveTo(-2.2, 3.6, -1.75, 4.6, -1.5, 5.4);
    g.lineTo(1.5, 5.4);
    g.bezierCurveTo(1.75, 4.6, 2.2, 3.6, 2.3, 2.6);
    g.bezierCurveTo(2.35, 1.85, 1.9, 1.2, 1.05, 1.05);
    g.closePath();
  };
  cel(ctx, torso, c.hide, { x: -2.4, y: 1.0, w: 4.8, h: 4.4 }, {
    angle: light,
    coverage: 0.42,
    line: c.lineColor,
    lineWidth: 0.08,
  });
  within(ctx, torso, (g) => {
    g.strokeStyle = rgba(c.lineColor, 0.45);
    g.lineCap = 'round';
    // Pectorals.
    g.lineWidth = 0.09;
    for (const s of [-1, 1]) {
      stroke(g, [
        [s * 0.1, 1.35],
        [s * 1.1, 1.6],
        [s * 1.85, 2.5],
      ]);
      g.stroke();
    }
    stroke(g, [
      [0, 1.3],
      [0, 2.9],
    ]);
    g.stroke();
    // Abdomen ridges.
    g.lineWidth = 0.06;
    for (let i = 0; i < 3; i++) {
      const y = 3.05 + i * 0.5;
      stroke(g, [
        [-1.0, y - 0.12],
        [0, y],
        [1.0, y - 0.12],
      ]);
      g.stroke();
    }
    // Belly, lighter.
    g.fillStyle = rgba(c.belly.base, 0.35);
    g.beginPath();
    g.ellipse(0, 3.9, 1.05, 1.5, 0, 0, Math.PI * 2);
    g.fill();
  });

  // Head: a horned skull with a snout and a heavy brow.
  const head = (g: CanvasRenderingContext2D) => {
    g.beginPath();
    g.moveTo(-1.08 + j, -0.35);
    g.bezierCurveTo(-1.14 + j, -1.2, -0.6 + j, -1.5, 0.04 + j, -1.48);
    g.bezierCurveTo(0.68 + j, -1.46, 1.12 + j, -1.14, 1.06 + j, -0.32);
    g.bezierCurveTo(1.02 + j, 0.2, 0.82 + j, 0.5, 0.5 + j, 0.62);
    g.bezierCurveTo(0.44 + j, 1.12, -0.3 + j, 1.2, -0.52 + j, 0.86);
    g.bezierCurveTo(-0.9 + j, 0.58, -1.06 + j, 0.2, -1.08 + j, -0.35);
    g.closePath();
  };
  cel(ctx, head, c.hide, { x: -1.3, y: -1.6, w: 2.6, h: 2.9 }, {
    angle: light,
    coverage: 0.38,
    line: c.lineColor,
    lineWidth: 0.075,
    rim: rgba('#FF9A6B', 0.4),
    rimWidth: 0.05,
  });
  within(ctx, head, (g) => {
    g.fillStyle = rgba(c.hide.shade, 0.9);
    g.beginPath();
    g.moveTo(-1.15 + j, -0.82);
    g.bezierCurveTo(-0.6 + j, -1.06, 0.6 + j, -1.06, 1.15 + j, -0.76);
    g.lineTo(1.15 + j, -0.44);
    g.bezierCurveTo(0.55 + j, -0.68, -0.55 + j, -0.68, -1.15 + j, -0.44);
    g.closePath();
    g.fill();
  });

  // Horns sweeping back and out.
  for (const s of [-1, 1]) {
    cel(
      ctx,
      (g) => {
        g.beginPath();
        g.moveTo(s * 0.72 + j, -1.15);
        g.bezierCurveTo(s * 1.75, -1.55, s * 2.2, -2.4, s * 1.95, -3.0);
        g.bezierCurveTo(s * 1.85, -2.15, s * 1.35, -1.55, s * 0.48 + j, -1.0);
        g.closePath();
      },
      ramp(shift(c.hide.base, 0, -0.1, -0.24), 1),
      { x: s > 0 ? 0.4 : -2.3, y: -3.1, w: 1.9, h: 2.2 },
      { angle: light, coverage: 0.42, line: c.lineColor, lineWidth: 0.06 },
    );
  }

  beastEye(ctx, c, -0.4 + j, -0.28, 0.2, true);
  beastEye(ctx, c, 0.42 + j, -0.28, 0.2, true);
  // Snarling mouth.
  flat(
    ctx,
    (g) => {
      g.beginPath();
      g.moveTo(-0.52 + j, 0.34);
      g.quadraticCurveTo(0 + j, 0.24, 0.52 + j, 0.36);
      g.quadraticCurveTo(0.06 + j, 0.94, -0.52 + j, 0.34);
      g.closePath();
    },
    '#2A0C14',
    rgba(c.lineColor, 0.8),
    0.055,
  );
  teeth(ctx, c, [-0.4 + j, 0.36], [0.4 + j, 0.38], 5, 0.12);
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
