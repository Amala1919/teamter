/**
 * The battle arena: floor, slot sockets, leader plinths and the backdrop.
 *
 * Textures are generated procedurally at load so the project ships no binary
 * art, and every surface is tinted from the two players' classes.
 */
import * as THREE from 'three';
import type { ClassId } from '../engine/types';
import { CLASS_THEME, UI } from '../art/theme';

export const BOARD = {
  /** Five slots per side. */
  SLOTS: 5,
  /** Horizontal spacing between slot centres, in world units. */
  SLOT_SPACING: 1.78,
  /**
   * The rows sit right of centre because the leaders occupy the left column,
   * which is the arrangement the original uses.
   */
  ROW_X: 1.35,
  /** Depth of the two board rows. */
  ROW_Z: { enemy: -2.6, ally: 0.5 },
  /** Card size on the board, in world units. */
  CARD_W: 1.36,
  CARD_H: 1.9,
  /** Where the leaders stand. */
  LEADER_X: -5.1,
  /** Hand fan centre. */
  HAND_Z: 3.95,
  HAND_Y: 0.62,
} as const;

/** World position of a board slot. */
export function slotPosition(side: 'ally' | 'enemy', index: number, count: number): THREE.Vector3 {
  // Rows stay centred as followers come and go, which is how the original
  // packs its board rather than leaving gaps.
  const span = (count - 1) * BOARD.SLOT_SPACING;
  const x = BOARD.ROW_X - span / 2 + index * BOARD.SLOT_SPACING;
  return new THREE.Vector3(x, 0.02, BOARD.ROW_Z[side]);
}

// ---------------------------------------------------------------------------
// Procedural textures
// ---------------------------------------------------------------------------

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable');
  return [c, ctx];
}

function rgba(hex: string, a: number): string {
  const v = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a})`;
}

/**
 * The battlefield mat: a bordered stone slab rather than an endless floor.
 * Giving the play area a defined edge is what stops the board reading as a
 * corridor, and it is how the original frames its field.
 *
 * The texture is laid out in the same proportions as the mesh, so the two row
 * bands drawn here line up with the slot positions in world space.
 */
function makeFloorTexture(allyClass: ClassId, enemyClass: ClassId): THREE.Texture {
  const W = 1024;
  const H = 700;
  const [c, ctx] = canvas(W, H);

  const ally = CLASS_THEME[allyClass];
  const enemy = CLASS_THEME[enemyClass];

  // Base stone.
  const base = ctx.createLinearGradient(0, 0, 0, H);
  base.addColorStop(0, mixHex(enemy.deep, '#141A26', 0.66));
  base.addColorStop(0.45, '#1A202E');
  base.addColorStop(0.55, '#1A202E');
  base.addColorStop(1, mixHex(ally.deep, '#141A26', 0.66));
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, H);

  // Marble veining, kept low-contrast so it never competes with cards.
  let seed = 12345;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  ctx.lineCap = 'round';
  for (let i = 0; i < 220; i++) {
    ctx.beginPath();
    let x = rnd() * W;
    let y = rnd() * H;
    ctx.moveTo(x, y);
    for (let k = 0, steps = 4 + Math.floor(rnd() * 7); k < steps; k++) {
      x += (rnd() - 0.5) * W * 0.14;
      y += (rnd() - 0.5) * H * 0.14;
      ctx.lineTo(x, y);
    }
    ctx.lineWidth = 0.5 + rnd() * 2.4;
    ctx.strokeStyle = `rgba(200,214,236,${0.015 + rnd() * 0.035})`;
    ctx.stroke();
  }

  // The two row bands. `rowBand` values match ROW_Z mapped into texture space.
  // Bands are positioned from the world-space row depths so the paint lines up
  // with where cards actually sit. See MAT_* below for the mapping.
  const bandFor = (yc: number, color: string) => {
    const bh = H * 0.2;
    const g = ctx.createLinearGradient(0, yc - bh / 2, 0, yc + bh / 2);
    g.addColorStop(0, rgba(color, 0));
    g.addColorStop(0.5, rgba(color, 0.22));
    g.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = g;
    const x0 = W * 0.29;
    const x1 = W * 0.85;
    ctx.fillRect(x0, yc - bh / 2, x1 - x0, bh);
    ctx.strokeStyle = rgba(color, 0.34);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x0, yc - bh / 2);
    ctx.lineTo(x1, yc - bh / 2);
    ctx.moveTo(x0, yc + bh / 2);
    ctx.lineTo(x1, yc + bh / 2);
    ctx.stroke();
  };
  bandFor(H * 0.337, enemy.primary);
  bandFor(H * 0.663, ally.primary);

  // Centre inlay.
  ctx.strokeStyle = rgba(UI.gold, 0.5);
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(W * 0.07, H * 0.5);
  ctx.lineTo(W * 0.93, H * 0.5);
  ctx.stroke();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = rgba(UI.gold, 0.22);
  for (const dy of [-9, 9]) {
    ctx.beginPath();
    ctx.moveTo(W * 0.07, H * 0.5 + dy);
    ctx.lineTo(W * 0.93, H * 0.5 + dy);
    ctx.stroke();
  }
  // Centre boss.
  const bx = W * 0.57;
  const by = H * 0.5;
  ctx.fillStyle = rgba(UI.gold, 0.35);
  ctx.beginPath();
  ctx.moveTo(bx, by - 26);
  ctx.lineTo(bx + 38, by);
  ctx.lineTo(bx, by + 26);
  ctx.lineTo(bx - 38, by);
  ctx.closePath();
  ctx.fill();

  // Mat border.
  const inset = 16;
  ctx.strokeStyle = rgba(UI.gold, 0.75);
  ctx.lineWidth = 8;
  ctx.strokeRect(inset, inset, W - inset * 2, H - inset * 2);
  ctx.strokeStyle = rgba(UI.gold, 0.3);
  ctx.lineWidth = 2;
  ctx.strokeRect(inset + 16, inset + 16, W - (inset + 16) * 2, H - (inset + 16) * 2);
  // Corner pieces.
  ctx.fillStyle = rgba(UI.gold, 0.5);
  for (const [cx2, cy2] of [
    [inset, inset],
    [W - inset, inset],
    [inset, H - inset],
    [W - inset, H - inset],
  ]) {
    ctx.beginPath();
    ctx.arc(cx2, cy2, 16, 0, Math.PI * 2);
    ctx.fill();
  }

  // A warm pool of light over the middle of the mat.
  const pool = ctx.createRadialGradient(W * 0.55, H * 0.5, 0, W * 0.55, H * 0.5, W * 0.55);
  pool.addColorStop(0, 'rgba(255,238,206,0.2)');
  pool.addColorStop(1, 'rgba(255,238,206,0)');
  ctx.fillStyle = pool;
  ctx.fillRect(0, 0, W, H);

  // Edge falloff so the mat sinks into the dark rather than ending abruptly.
  const edge = ctx.createRadialGradient(W / 2, H / 2, H * 0.32, W / 2, H / 2, W * 0.62);
  edge.addColorStop(0, 'rgba(0,0,0,0)');
  edge.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = edge;
  ctx.fillRect(0, 0, W, H);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function mixHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.replace('#', ''), 16);
  const pb = parseInt(b.replace('#', ''), 16);
  const f = (sh: number) => {
    const x = (pa >> sh) & 255;
    const y = (pb >> sh) & 255;
    return Math.round(x + (y - x) * t);
  };
  return `rgb(${f(16)},${f(8)},${f(0)})`;
}

/** A soft round socket the size of one board slot, used as a decal. */
function makeSocketTexture(color: string): THREE.Texture {
  const S = 256;
  const [c, ctx] = canvas(S, S);
  const g = ctx.createRadialGradient(S / 2, S / 2, S * 0.1, S / 2, S / 2, S * 0.5);
  g.addColorStop(0, rgba(color, 0.5));
  g.addColorStop(0.55, rgba(color, 0.18));
  g.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);

  // Rune ring.
  ctx.strokeStyle = rgba(color, 0.55);
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, S * 0.36, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, S * 0.42, 0, Math.PI * 2);
  ctx.stroke();
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(S / 2 + Math.cos(a) * S * 0.37, S / 2 + Math.sin(a) * S * 0.37);
    ctx.lineTo(S / 2 + Math.cos(a) * S * 0.41, S / 2 + Math.sin(a) * S * 0.41);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Vertical backdrop: a vignetted hall with distant light. */
function makeBackdropTexture(allyClass: ClassId, enemyClass: ClassId): THREE.Texture {
  const W = 1024;
  const H = 512;
  const [c, ctx] = canvas(W, H);

  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#05070C');
  sky.addColorStop(0.55, rgba(CLASS_THEME[enemyClass].deep, 0.9));
  sky.addColorStop(1, rgba(CLASS_THEME[allyClass].deep, 0.7));
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  // Distant colonnade.
  ctx.fillStyle = 'rgba(4,6,11,0.85)';
  for (let i = 0; i < 9; i++) {
    const x = (i / 8) * W;
    const w = W * 0.035;
    const h = H * (0.42 + ((i * 37) % 11) / 40);
    ctx.fillRect(x - w / 2, H - h, w, h);
    ctx.fillRect(x - w * 0.8, H - h - H * 0.03, w * 1.6, H * 0.03);
  }

  // Hall light behind the columns.
  const glow = ctx.createRadialGradient(W / 2, H * 0.62, 0, W / 2, H * 0.62, W * 0.4);
  glow.addColorStop(0, 'rgba(255,220,170,0.3)');
  glow.addColorStop(1, 'rgba(255,220,170,0)');
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'source-over';

  const vig = ctx.createRadialGradient(W / 2, H / 2, H * 0.2, W / 2, H / 2, W * 0.6);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.85)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------------------------------------------------------------------------
// Board object
// ---------------------------------------------------------------------------

export class Board {
  readonly group = new THREE.Group();
  private readonly sockets: { ally: THREE.Mesh[]; enemy: THREE.Mesh[] } = { ally: [], enemy: [] };
  private readonly socketMat: THREE.MeshBasicMaterial;
  private readonly time = { t: 0 };

  constructor(allyClass: ClassId, enemyClass: ClassId) {
    // --- floor ------------------------------------------------------------
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(14, 9.5),
      new THREE.MeshStandardMaterial({
        map: makeFloorTexture(allyClass, enemyClass),
        roughness: 0.55,
        metalness: 0.12,
        color: '#FFFFFF',
      }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0.4, 0, -1.05);
    floor.receiveShadow = true;
    this.group.add(floor);

    const voidPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(80, 60),
      new THREE.MeshBasicMaterial({ color: '#04060B' }),
    );
    voidPlane.rotation.x = -Math.PI / 2;
    voidPlane.position.set(0, -0.05, -1);
    this.group.add(voidPlane);

    // --- backdrop ---------------------------------------------------------
    const backdrop = new THREE.Mesh(
      new THREE.PlaneGeometry(46, 22),
      new THREE.MeshBasicMaterial({ map: makeBackdropTexture(allyClass, enemyClass), depthWrite: false }),
    );
    backdrop.position.set(0, 6.5, -14);
    this.group.add(backdrop);

    // --- slot sockets -----------------------------------------------------
    this.socketMat = new THREE.MeshBasicMaterial({
      map: makeSocketTexture(UI.gold),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      opacity: 0.35,
    });

    for (const side of ['ally', 'enemy'] as const) {
      for (let i = 0; i < BOARD.SLOTS; i++) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5), this.socketMat.clone());
        m.rotation.x = -Math.PI / 2;
        const p = slotPosition(side, i, BOARD.SLOTS);
        m.position.set(p.x, 0.012, p.z);
        this.group.add(m);
        this.sockets[side].push(m);
      }
    }
  }

  /**
   * Highlights the drop targets for a card being dragged. `count` is how many
   * followers are already on the row, so the sockets shift to match where the
   * card would actually land.
   */
  showDropSlots(count: number, active: boolean, color = UI.gold): void {
    const n = Math.min(count + 1, BOARD.SLOTS);
    this.sockets.ally.forEach((m, i) => {
      const mat = m.material as THREE.MeshBasicMaterial;
      m.visible = i < n;
      if (!m.visible) return;
      mat.opacity = active ? 0.85 : i < count ? 0.42 : 0.2;
      mat.color.set(active ? color : '#FFFFFF');
      m.position.x = slotPosition('ally', i, n).x;
    });
  }

  /**
   * Re-seats the sockets under however many cards each row holds. A row of two
   * followers shows two sockets centred under them plus one dim socket for the
   * next card — showing all five would imply fixed positions the game does not
   * actually have.
   */
  layoutSockets(allyCount: number, enemyCount: number): void {
    for (const [side, count] of [
      ['ally', allyCount],
      ['enemy', enemyCount],
    ] as const) {
      const shown = Math.min(Math.max(count + 1, 1), BOARD.SLOTS);
      this.sockets[side].forEach((m, i) => {
        m.visible = i < shown;
        if (!m.visible) return;
        const p = slotPosition(side, i, shown);
        m.position.x = p.x;
        const mat = m.material as THREE.MeshBasicMaterial;
        mat.opacity = i < count ? 0.42 : 0.2;
      });
    }
  }

  update(dt: number): void {
    // A slow pulse on the sockets keeps the board from feeling like a static
    // image between turns.
    this.time.t += dt;
    const pulse = 0.9 + Math.sin(this.time.t * 1.6) * 0.1;
    for (const side of ['ally', 'enemy'] as const) {
      for (const m of this.sockets[side]) {
        m.scale.setScalar(pulse);
      }
    }
  }
}
