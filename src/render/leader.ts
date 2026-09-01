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
    name: CLASS_THEME[cls].label,
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

  private defense = 20;
  private maxDefense = 20;
  private shadows = 0;
  private readonly cls: ClassId;
  private readonly artCanvas: HTMLCanvasElement;
  /** Non-zero while the portrait is flashing from damage. */
  private flash = 0;

  constructor(cls: ClassId, seed: number, width = 2.35) {
    this.cls = cls;

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
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, h), this.material);
    mesh.castShadow = true;

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

    this.group.add(mesh, this.ring);
    this.redraw();
  }

  setDefense(defense: number, maxDefense: number): void {
    if (defense < this.defense) this.flash = 1;
    this.defense = defense;
    this.maxDefense = maxDefense;
    this.redraw();
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
    const label = theme.label.toUpperCase();
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
      this.material.emissiveIntensity = 0.5 + this.flash * 1.6;
    }
    this.ring.scale.setScalar(1 + Math.sin(t * 1.8) * 0.03);
  }
}
