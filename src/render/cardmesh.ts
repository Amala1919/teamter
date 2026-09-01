/**
 * A card in 3D.
 *
 * Every card on screen — in hand, on the board, mid-flight — is one of these.
 * Motion is spring-damped toward a target transform rather than keyframed, so
 * the layout code can simply say where a card belongs and the card finds its
 * way there smoothly no matter what interrupted it.
 */
import * as THREE from 'three';
import type { CardDef } from '../engine/types';
import { cardFaceCanvas } from '../art/cardface';
import { boardCardCanvas, type BoardCardState } from '../art/boardcard';
import { CLASS_THEME, UI } from '../art/theme';

const CARD_ASPECT = 716 / 512;

/** Critically-damped spring step; `speed` is roughly 1/settling-time. */
function spring(current: number, target: number, velocity: number, speed: number, dt: number): [number, number] {
  const omega = speed;
  const x = current - target;
  const exp = Math.exp(-omega * dt);
  const newV = (velocity - omega * omega * x * dt) * exp;
  const newX = target + (x + (velocity + omega * x) * dt) * exp;
  return [newX, newV];
}

let glowTexture: THREE.Texture | null = null;

function getGlowTexture(): THREE.Texture {
  if (glowTexture) return glowTexture;
  const S = 256;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(S / 2, S / 2, S * 0.18, S / 2, S / 2, S * 0.5);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.28)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  glowTexture = new THREE.CanvasTexture(c);
  return glowTexture;
}

let backTexture: THREE.Texture | null = null;

/** The card back, used for the deck and the opponent's hand. */
export function getCardBackTexture(): THREE.Texture {
  if (backTexture) return backTexture;
  const W = 256;
  const H = Math.round(W * CARD_ASPECT);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;

  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#1A1428');
  bg.addColorStop(0.5, '#2A1E3E');
  bg.addColorStop(1, '#120E1E');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = 'rgba(216,184,101,0.7)';
  ctx.lineWidth = 5;
  ctx.strokeRect(9, 9, W - 18, H - 18);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(216,184,101,0.35)';
  ctx.strokeRect(18, 18, W - 36, H - 36);

  // A rosette in the middle, echoing the rune sockets on the board.
  const cx = W / 2;
  const cy = H / 2;
  ctx.strokeStyle = 'rgba(216,184,101,0.65)';
  for (const r of [W * 0.3, W * 0.22, W * 0.12]) {
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.lineWidth = 2;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * W * 0.12, cy + Math.sin(a) * W * 0.12);
    ctx.lineTo(cx + Math.cos(a) * W * 0.3, cy + Math.sin(a) * W * 0.3);
    ctx.stroke();
  }
  const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, W * 0.14);
  core.addColorStop(0, 'rgba(255,236,190,0.85)');
  core.addColorStop(1, 'rgba(255,236,190,0)');
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(cx, cy, W * 0.14, 0, Math.PI * 2);
  ctx.fill();

  backTexture = new THREE.CanvasTexture(c);
  backTexture.colorSpace = THREE.SRGBColorSpace;
  return backTexture;
}

export type CardView = 'hand' | 'board' | 'back';

export interface CardObjectOptions {
  def: CardDef;
  view: CardView;
  width: number;
}

export class CardObject {
  readonly group = new THREE.Group();
  readonly mesh: THREE.Mesh;
  readonly glow: THREE.Mesh;
  readonly material: THREE.MeshStandardMaterial;
  private readonly glowMaterial: THREE.MeshBasicMaterial;

  def: CardDef;
  view: CardView;

  /** Target transform; the render loop springs the group toward it. */
  readonly target = {
    position: new THREE.Vector3(),
    rotation: new THREE.Euler(),
    scale: 1,
  };

  /** Extra offset layered on top of the target, for lifts and lunges. */
  readonly offset = new THREE.Vector3();

  private readonly vel = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, s: 0 };
  private speed = 12;
  private texture: THREE.Texture | null = null;
  private lastKey = '';
  private glowPulse = 0;

  constructor(opts: CardObjectOptions) {
    this.def = opts.def;
    this.view = opts.view;

    const w = opts.width;
    const h = w * CARD_ASPECT;

    this.material = new THREE.MeshStandardMaterial({
      transparent: true,
      roughness: 0.62,
      metalness: 0.08,
      // The face texture is already a lit painting, so it doubles as an
      // emissive map at low intensity: cards stay readable in shadow without
      // looking flat.
      emissive: new THREE.Color('#FFFFFF'),
      emissiveIntensity: 0.72,
      side: THREE.DoubleSide,
      alphaTest: 0.02,
    });

    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), this.material);
    this.mesh.castShadow = true;

    this.glowMaterial = new THREE.MeshBasicMaterial({
      map: getGlowTexture(),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0,
      color: new THREE.Color(UI.gold),
    });
    this.glow = new THREE.Mesh(new THREE.PlaneGeometry(w * 1.9, h * 1.55), this.glowMaterial);
    this.glow.position.z = -0.012;
    this.glow.renderOrder = -1;

    this.group.add(this.glow, this.mesh);
    this.refresh();
  }

  /** Rebuilds the texture when the card's displayed state changes. */
  refresh(state?: BoardCardState, opts?: { evolved?: boolean; premium?: boolean; lang?: 'en' | 'ja' }): void {
    let canvas: HTMLCanvasElement;
    let key: string;

    if (this.view === 'back') {
      if (this.texture !== getCardBackTexture()) {
        this.texture = getCardBackTexture();
        this.material.map = this.texture;
        this.material.emissiveMap = this.texture;
        this.material.needsUpdate = true;
      }
      return;
    }

    if (this.view === 'board' && state) {
      key = `b|${state.atk}|${state.def}|${state.maxDef}|${state.evolved}|${state.countdown ?? ''}|${state.ready}|${state.spent}|${state.keywords.join(',')}`;
      if (key === this.lastKey) return;
      canvas = boardCardCanvas(this.def, state);
    } else {
      key = `h|${opts?.evolved ? 1 : 0}|${opts?.premium ? 1 : 0}|${opts?.lang ?? 'en'}`;
      if (key === this.lastKey) return;
      canvas = cardFaceCanvas(this.def, {
        scale: 0.62,
        evolved: opts?.evolved,
        premium: opts?.premium,
        lang: opts?.lang,
      });
    }

    this.lastKey = key;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    this.texture?.dispose();
    this.texture = tex;
    this.material.map = tex;
    this.material.emissiveMap = tex;
    this.material.needsUpdate = true;
  }

  /** Switches between the hand card layout and the compact board plaque. */
  setView(view: CardView, width: number): void {
    if (this.view === view) return;
    this.view = view;
    this.lastKey = '';
    const h = width * (view === 'board' ? 476 / 340 : CARD_ASPECT);
    this.mesh.geometry.dispose();
    this.mesh.geometry = new THREE.PlaneGeometry(width, h);
    this.glow.geometry.dispose();
    this.glow.geometry = new THREE.PlaneGeometry(width * 1.9, h * 1.55);
  }

  /** Sets the highlight ring. `intensity` of 0 turns it off. */
  setGlow(intensity: number, color?: string): void {
    this.glowMaterial.opacity = intensity;
    if (color) this.glowMaterial.color.set(color);
  }

  /** A slow breathing pulse on the glow, used for "this can attack". */
  setGlowPulse(amount: number): void {
    this.glowPulse = amount;
  }

  /** Snaps to the target without springing — used when a card first appears. */
  snap(): void {
    this.group.position.copy(this.target.position).add(this.offset);
    this.group.rotation.copy(this.target.rotation);
    this.group.scale.setScalar(this.target.scale);
    this.vel.x = this.vel.y = this.vel.z = 0;
    this.vel.rx = this.vel.ry = this.vel.rz = 0;
    this.vel.s = 0;
  }

  setSpeed(speed: number): void {
    this.speed = speed;
  }

  update(dt: number, t: number): void {
    const p = this.group.position;
    const tp = this.target.position;
    [p.x, this.vel.x] = spring(p.x, tp.x + this.offset.x, this.vel.x, this.speed, dt);
    [p.y, this.vel.y] = spring(p.y, tp.y + this.offset.y, this.vel.y, this.speed, dt);
    [p.z, this.vel.z] = spring(p.z, tp.z + this.offset.z, this.vel.z, this.speed, dt);

    const r = this.group.rotation;
    const tr = this.target.rotation;
    [r.x, this.vel.rx] = spring(r.x, tr.x, this.vel.rx, this.speed, dt);
    [r.y, this.vel.ry] = spring(r.y, tr.y, this.vel.ry, this.speed, dt);
    [r.z, this.vel.rz] = spring(r.z, tr.z, this.vel.rz, this.speed, dt);

    let s = this.group.scale.x;
    [s, this.vel.s] = spring(s, this.target.scale, this.vel.s, this.speed, dt);
    this.group.scale.setScalar(s);

    if (this.glowPulse > 0) {
      this.glowMaterial.opacity = this.glowPulse * (0.62 + Math.sin(t * 3.4) * 0.38);
    }
  }

  /** Class colour, used by effects that key off the card's identity. */
  get classColor(): string {
    return CLASS_THEME[this.def.cardClass].primary;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.glow.geometry.dispose();
    this.material.dispose();
    this.glowMaterial.dispose();
    this.texture?.dispose();
    this.group.removeFromParent();
  }
}
