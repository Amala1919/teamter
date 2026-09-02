/**
 * Leader portraits.
 *
 * Each leader is a framed portrait plinth on its side of the field with a
 * defense orb mounted below it. The portrait is generated from the class the
 * same way card art is, so the two read as one world.
 */
import * as THREE from 'three';
import type { CardDef, ClassId } from '../engine/types';
import { drawIllustration } from '../art/illustration';
import { className } from '../i18n';
import { CLASS_THEME, FONT, UI } from '../art/theme';

const PORTRAIT_W = 384;
const PORTRAIT_H = 512;

function rgba(hex: string, a: number): string {
  const v = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a})`;
}

function metal(ctx: CanvasRenderingContext2D, w: number, h: number): CanvasGradient {
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, UI.goldDeep);
  g.addColorStop(0.25, UI.goldBright);
  g.addColorStop(0.5, UI.goldDeep);
  g.addColorStop(0.75, UI.goldBright);
  g.addColorStop(1, UI.goldDeep);
  return g;
}

/** A pseudo-card used only to drive the illustration generator for a leader. */
function leaderArtCard(cls: ClassId, seed: number): CardDef {
  return {
    id: `leader_${cls}`,
    name: className(CLASS_THEME[cls]),
    cardClass: cls,
    set: 'basic',
    rarity: 'legendary',
    type: 'follower',
    cost: 8,
    atk: 0,
    def: 0,
    text: '',
    artSeed: seed,
  };
}

export class LeaderObject {
  readonly group = new THREE.Group();
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;
  private readonly material: THREE.MeshStandardMaterial;
  private readonly ring: THREE.Mesh;
  private readonly ringMaterial: THREE.MeshBasicMaterial;
  /**
   * The portrait lives inside its own group so animation can move it without
   * fighting the battle screen, which owns `group`'s placement.
   */
  private readonly body = new THREE.Group();
  private readonly halo: THREE.Mesh;
  private readonly haloMaterial: THREE.MeshBasicMaterial;
  private readonly height: number;

  private defense = 20;
  private maxDefense = 20;
  private shadows = 0;
  private readonly cls: ClassId;
  private readonly artCanvas: HTMLCanvasElement;
  /** Non-zero while the portrait is flashing from damage. */
  private flash = 0;
  /** Recoil from a hit: decays to zero, driving a knock-back and a tilt. */
  private recoil = 0;
  /** Lift from being healed: decays to zero, driving a rise and a green glow. */
  private uplift = 0;
  /** Whether it is this leader's turn, which brings the portrait forward. */
  private active = false;
  /** Runs from 0 to 1 once the leader is defeated, sinking the portrait. */
  private defeat = 0;
  /** Phase offset so two leaders never breathe in lockstep. */
  private readonly phase: number;

  constructor(cls: ClassId, seed: number, width = 2.35) {
    this.cls = cls;
    this.phase = (seed % 1000) / 159;

    // The illustration is painted once and reused; only the plate on top of it
    // is repainted when defense changes.
    this.artCanvas = document.createElement('canvas');
    this.artCanvas.width = PORTRAIT_W;
    this.artCanvas.height = PORTRAIT_H;
    const actx = this.artCanvas.getContext('2d');
    if (!actx) throw new Error('2D context unavailable');
    drawIllustration(actx, PORTRAIT_W, PORTRAIT_H, leaderArtCard(cls, seed));

    this.canvas = document.createElement('canvas');
    this.canvas.width = PORTRAIT_W;
    this.canvas.height = PORTRAIT_H;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2D context unavailable');
    this.ctx = ctx;

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;

    this.material = new THREE.MeshStandardMaterial({
      map: this.texture,
      emissive: new THREE.Color('#FFFFFF'),
      emissiveMap: this.texture,
      emissiveIntensity: 0.5,
      transparent: true,
      roughness: 0.6,
      metalness: 0.1,
    });

    const h = width * (PORTRAIT_H / PORTRAIT_W);
    this.height = h;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, h), this.material);
    mesh.castShadow = true;
    this.body.add(mesh);

    // A soft halo behind the portrait: brighter while it is this leader's turn,
    // flaring on a hit or a heal. It is a radial gradient rather than a disc —
    // a flat circle behind a portrait reads as a sticker, not as light.
    this.haloMaterial = new THREE.MeshBasicMaterial({
      map: haloTexture(),
      color: CLASS_THEME[cls].primary,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.halo = new THREE.Mesh(new THREE.PlaneGeometry(width * 1.9, h * 1.5), this.haloMaterial);
    this.halo.position.z = -0.05;
    this.body.add(this.halo);

    // A ground ring under the plinth ties the leader to the floor.
    this.ringMaterial = new THREE.MeshBasicMaterial({
      color: CLASS_THEME[cls].primary,
      transparent: true,
      opacity: 0.4,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(width * 0.3, width * 0.4, 48), this.ringMaterial);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = -h / 2 + 0.02;

    this.group.add(this.body, this.ring);
    this.redraw();
  }

  setDefense(defense: number, maxDefense: number): void {
    if (defense < this.defense) {
      this.flash = 1;
      // A bigger hit knocks the leader back further, up to a full recoil.
      this.recoil = Math.min(1, 0.45 + (this.defense - defense) / 12);
    } else if (defense > this.defense) {
      this.uplift = 1;
    }
    this.defense = defense;
    this.maxDefense = maxDefense;
    if (defense <= 0 && this.defeat === 0) this.defeat = 0.0001;
    this.redraw();
  }

  /** Brings the portrait forward while it is this leader's turn. */
  setActive(on: boolean): void {
    this.active = on;
  }

  setShadows(n: number): void {
    if (n === this.shadows) return;
    this.shadows = n;
    this.redraw();
  }

  private redraw(): void {
    const ctx = this.ctx;
    const W = PORTRAIT_W;
    const H = PORTRAIT_H;
    const theme = CLASS_THEME[this.cls];

    ctx.clearRect(0, 0, W, H);

    // Frame.
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(W * 0.5, 6);
    ctx.lineTo(W - 8, H * 0.16);
    ctx.lineTo(W - 8, H * 0.8);
    ctx.lineTo(W * 0.5, H - 6);
    ctx.lineTo(8, H * 0.8);
    ctx.lineTo(8, H * 0.16);
    ctx.closePath();
    ctx.fillStyle = '#05070C';
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.drawImage(this.artCanvas, 0, 0, W, H);
    // Darken toward the bottom so the defense orb reads.
    const fade = ctx.createLinearGradient(0, H * 0.5, 0, H);
    fade.addColorStop(0, 'rgba(5,7,12,0)');
    fade.addColorStop(1, 'rgba(5,7,12,0.9)');
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
    ctx.lineWidth = 10;
    ctx.strokeStyle = metal(ctx, W, H);
    ctx.stroke();
    ctx.restore();

    // Class name plate.
    ctx.save();
    ctx.font = `600 22px ${FONT.ui}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = rgba(theme.deep, 0.9);
    const label = className(theme).toUpperCase();
    const lw = ctx.measureText(label).width + 40;
    ctx.fillRect(W / 2 - lw / 2, H * 0.72, lw, 32);
    ctx.strokeStyle = rgba(UI.gold, 0.6);
    ctx.lineWidth = 1.5;
    ctx.strokeRect(W / 2 - lw / 2, H * 0.72, lw, 32);
    ctx.fillStyle = theme.accent;
    ctx.fillText(label, W / 2, H * 0.72 + 17);
    ctx.restore();

    // Defense orb.
    const cx = W / 2;
    const cy = H * 0.875;
    const r = 54;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur = 16;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    const low = this.defense <= this.maxDefense * 0.34;
    const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.1, cx, cy, r);
    g.addColorStop(0, low ? '#FFB9B9' : '#C8FFE4');
    g.addColorStop(0.5, low ? UI.damage : UI.defense);
    g.addColorStop(1, low ? '#4A0808' : UI.defenseDeep);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.shadowColor = 'transparent';

    ctx.lineWidth = 6;
    ctx.strokeStyle = metal(ctx, W, H);
    ctx.stroke();

    ctx.font = `700 ${r * 1.1}px ${FONT.numeral}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 9;
    ctx.strokeStyle = 'rgba(0,0,0,0.9)';
    ctx.lineJoin = 'round';
    ctx.strokeText(String(Math.max(0, this.defense)), cx, cy + 3);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(String(Math.max(0, this.defense)), cx, cy + 3);
    ctx.restore();

    // Shadow counter, only shown once the player has any.
    if (this.shadows > 0) {
      ctx.save();
      const sx = W * 0.5 + 96;
      const sy = H * 0.845;
      ctx.beginPath();
      ctx.arc(sx, sy, 24, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(20,10,32,0.95)';
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = rgba('#C79BFF', 0.85);
      ctx.stroke();
      ctx.font = `700 26px ${FONT.numeral}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#E4D0FF';
      ctx.fillText(String(this.shadows), sx, sy + 1);
      ctx.restore();
    }

    this.texture.needsUpdate = true;
  }

  /** Highlights the leader as a legal attack or spell target. */
  setTargetable(on: boolean): void {
    this.ringMaterial.opacity = on ? 0.95 : 0.4;
    this.ringMaterial.color.set(on ? UI.damage : CLASS_THEME[this.cls].primary);
  }

  update(dt: number, t: number): void {
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt * 2.6);
    }
    if (this.recoil > 0) this.recoil = Math.max(0, this.recoil - dt * 2.2);
    if (this.uplift > 0) this.uplift = Math.max(0, this.uplift - dt * 1.6);
    if (this.defeat > 0) this.defeat = Math.min(1, this.defeat + dt * 1.1);

    // Idle: a slow breath, and a sway a third as fast so the two never line up
    // into an obvious loop.
    const breath = Math.sin(t * 1.15 + this.phase) * 0.5 + 0.5;
    const sway = Math.sin(t * 0.41 + this.phase * 1.7);

    // Recoil is a sharp knock that eases back, not a linear slide.
    const knock = this.recoil * this.recoil;
    const fallen = this.defeat > 0 ? easeOut(this.defeat) : 0;

    this.body.position.y = breath * 0.035 + this.uplift * 0.09 - fallen * this.height * 0.28;
    this.body.position.z = knock * 0.34;
    this.body.rotation.z = sway * 0.012 - knock * 0.09 + fallen * 0.5;
    this.body.rotation.x = -knock * 0.12;
    this.body.scale.setScalar(1 - knock * 0.05 + this.uplift * 0.03);

    // Emissive carries three things at once: the base level, the damage flash,
    // and the lift from a heal.
    this.material.emissiveIntensity = 0.5 + this.flash * 1.6 + this.uplift * 0.5;
    this.material.opacity = 1 - fallen * 0.45;

    // The halo marks whose turn it is, and flares on a hit or a heal.
    const activeGlow = this.active ? 0.2 + breath * 0.08 : 0.05;
    this.haloMaterial.opacity = Math.min(0.75, activeGlow + this.flash * 0.35 + this.uplift * 0.25);
    this.haloMaterial.color.set(
      this.flash > 0.05 ? UI.damage : this.uplift > 0.05 ? UI.heal : CLASS_THEME[this.cls].primary,
    );
    this.halo.scale.setScalar(1 + breath * 0.05 + knock * 0.14 + this.uplift * 0.1);

    this.ring.scale.setScalar(1 + Math.sin(t * 1.8) * 0.03 + (this.active ? 0.06 : 0));
    this.ringMaterial.opacity = Math.max(this.ringMaterial.opacity, this.active ? 0.55 : 0.4);
  }

  dispose(): void {
    this.material.dispose();
    this.ringMaterial.dispose();
    this.haloMaterial.dispose();
    this.texture.dispose();
  }
}

/**
 * A soft radial falloff, shared by every leader. Built once: the halo is the
 * same shape for all of them, only the colour differs.
 */
let haloTex: THREE.CanvasTexture | null = null;
function haloTexture(): THREE.CanvasTexture {
  if (haloTex) return haloTex;
  const size = 256;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.42)');
    g.addColorStop(0.7, 'rgba(255,255,255,0.09)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  haloTex = new THREE.CanvasTexture(c);
  return haloTex;
}

/** Quadratic ease-out, for a movement that arrives rather than stops. */
function easeOut(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return 1 - (1 - c) * (1 - c);
}
