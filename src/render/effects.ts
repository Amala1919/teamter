/**
 * Battle VFX.
 *
 * Everything here is additive, short-lived and pooled: bursts, floating damage
 * numbers, the targeting ribbon, screen flashes and card dissolves. The rule
 * the whole file follows is that an effect may never obscure the information a
 * player needs — particles stay off the card faces and numbers stay above them.
 */
import * as THREE from 'three';
import type { Stage } from './stage';
import type { CardObject } from './cardmesh';
import { FONT, UI } from '../art/theme';

// ---------------------------------------------------------------------------
// Shared textures
// ---------------------------------------------------------------------------

let sparkTexture: THREE.Texture | null = null;

function getSparkTexture(): THREE.Texture {
  if (sparkTexture) return sparkTexture;
  const S = 128;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.72)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  sparkTexture = new THREE.CanvasTexture(c);
  return sparkTexture;
}

// ---------------------------------------------------------------------------
// Particle burst
// ---------------------------------------------------------------------------

interface Burst {
  points: THREE.Points;
  velocities: Float32Array;
  life: number;
  maxLife: number;
  gravity: number;
  material: THREE.PointsMaterial;
}

interface FloatingLabel {
  sprite: THREE.Sprite;
  life: number;
  maxLife: number;
  velocity: number;
  material: THREE.SpriteMaterial;
}

export class Effects {
  private readonly group = new THREE.Group();
  private readonly bursts: Burst[] = [];
  private readonly labels: FloatingLabel[] = [];
  private readonly ribbon: THREE.Line;
  private readonly ribbonMat: THREE.LineBasicMaterial;
  private readonly reticle: THREE.Mesh;
  private flashEl: HTMLDivElement | null = null;
  private dissolving: { obj: CardObject; t: number }[] = [];

  constructor(private readonly stage: Stage) {
    stage.root.add(this.group);

    this.ribbonMat = new THREE.LineBasicMaterial({
      color: new THREE.Color(UI.damage),
      transparent: true,
      opacity: 0,
      depthTest: false,
    });
    const geom = new THREE.BufferGeometry().setFromPoints(
      Array.from({ length: 24 }, () => new THREE.Vector3()),
    );
    this.ribbon = new THREE.Line(geom, this.ribbonMat);
    this.ribbon.renderOrder = 999;
    this.group.add(this.ribbon);

    this.reticle = new THREE.Mesh(
      new THREE.RingGeometry(0.28, 0.38, 32),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(UI.damage),
        transparent: true,
        opacity: 0,
        depthTest: false,
        side: THREE.DoubleSide,
      }),
    );
    this.reticle.rotation.x = -Math.PI / 2;
    this.reticle.renderOrder = 999;
    this.group.add(this.reticle);
  }

  // -------------------------------------------------------------------------
  // Bursts
  // -------------------------------------------------------------------------

  private spawnBurst(
    origin: THREE.Vector3,
    count: number,
    color: string,
    opts: { speed?: number; size?: number; life?: number; gravity?: number; upward?: number } = {},
  ): void {
    const speed = opts.speed ?? 2.4;
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      positions[i * 3] = origin.x;
      positions[i * 3 + 1] = origin.y;
      positions[i * 3 + 2] = origin.z;
      // Cone biased upward: sparks fly off the card rather than into the floor.
      const a = Math.random() * Math.PI * 2;
      const up = (opts.upward ?? 0.6) + Math.random() * 0.7;
      const r = Math.random() * speed;
      velocities[i * 3] = Math.cos(a) * r;
      velocities[i * 3 + 1] = up * speed * (0.4 + Math.random() * 0.8);
      velocities[i * 3 + 2] = Math.sin(a) * r * 0.6;
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const material = new THREE.PointsMaterial({
      color: new THREE.Color(color),
      size: opts.size ?? 0.19,
      map: getSparkTexture(),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });

    const points = new THREE.Points(geom, material);
    this.group.add(points);
    this.bursts.push({
      points,
      velocities,
      life: 0,
      maxLife: opts.life ?? 0.85,
      gravity: opts.gravity ?? 4.2,
      material,
    });
  }

  summonBurst(at: THREE.Vector3, color: string): void {
    this.spawnBurst(at, 44, color, { speed: 2.1, size: 0.2, life: 0.75 });
    this.spawnBurst(at, 18, '#FFFFFF', { speed: 1.3, size: 0.13, life: 0.5 });
  }

  spellBurst(at: THREE.Vector3, color: string): void {
    this.spawnBurst(at, 70, color, { speed: 3.6, size: 0.22, life: 0.95, upward: 0.2 });
    this.spawnBurst(at, 26, '#FFFFFF', { speed: 2.2, size: 0.15, life: 0.6, upward: 0.2 });
  }

  evolveBurst(at: THREE.Vector3): void {
    this.spawnBurst(at, 90, UI.evolve, { speed: 3.2, size: 0.26, life: 1.1 });
    this.spawnBurst(at, 50, UI.evolveGold, { speed: 2.2, size: 0.2, life: 0.9 });
    this.screenFlash(UI.evolveGold, 0.22);
  }

  buffFlash(at: THREE.Vector3): void {
    this.spawnBurst(at, 22, UI.heal, { speed: 1.5, size: 0.15, life: 0.6, gravity: -1.4 });
  }

  banish(obj: CardObject): void {
    this.spawnBurst(obj.group.position, 60, '#BFD8FF', { speed: 1.8, size: 0.17, life: 0.9, gravity: -2 });
    this.dissolving.push({ obj, t: 0 });
  }

  dissolve(obj: CardObject): void {
    this.spawnBurst(obj.group.position, 46, '#FF7A5C', { speed: 2.2, size: 0.2, life: 0.8 });
    this.dissolving.push({ obj, t: 0 });
  }

  // -------------------------------------------------------------------------
  // Floating numbers
  // -------------------------------------------------------------------------

  damageNumber(at: THREE.Vector3, amount: number, color: string, prefix = '-'): void {
    const S = 256;
    const c = document.createElement('canvas');
    c.width = S;
    c.height = S / 2;
    const ctx = c.getContext('2d')!;
    ctx.font = `700 76px ${FONT.numeral}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const text = `${prefix}${amount}`;
    ctx.lineWidth = 12;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,0.9)';
    ctx.strokeText(text, S / 2, S / 4);
    ctx.fillStyle = color;
    ctx.fillText(text, S / 2, S / 4);

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(material);
    sprite.position.copy(at).add(new THREE.Vector3(0, 0.85, 0.1));
    sprite.scale.set(1.5, 0.75, 1);
    sprite.renderOrder = 1000;
    this.group.add(sprite);
    this.labels.push({ sprite, life: 0, maxLife: 0.9, velocity: 1.5, material });
  }

  // -------------------------------------------------------------------------
  // Targeting ribbon
  // -------------------------------------------------------------------------

  setTargetingRibbon(from: THREE.Vector3, to: THREE.Vector3): void {
    const pts: THREE.Vector3[] = [];
    const n = 24;
    const lift = Math.min(2.4, from.distanceTo(to) * 0.42);
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      // A quadratic arc reads as a deliberate throw rather than a straight line.
      const x = from.x + (to.x - from.x) * t;
      const z = from.z + (to.z - from.z) * t;
      const y = from.y + (to.y - from.y) * t + Math.sin(t * Math.PI) * lift;
      pts.push(new THREE.Vector3(x, y, z));
    }
    this.ribbon.geometry.setFromPoints(pts);
    this.ribbonMat.opacity = 0.95;
    (this.reticle.material as THREE.MeshBasicMaterial).opacity = 0.9;
    this.reticle.position.set(to.x, 0.06, to.z);
  }

  clearTargetingRibbon(): void {
    this.ribbonMat.opacity = 0;
    (this.reticle.material as THREE.MeshBasicMaterial).opacity = 0;
  }

  // -------------------------------------------------------------------------
  // Screen flash
  // -------------------------------------------------------------------------

  screenFlash(color: string, strength: number): void {
    if (!this.flashEl) {
      const el = document.createElement('div');
      el.style.cssText =
        'position:absolute;inset:0;pointer-events:none;opacity:0;transition:opacity .35s ease;mix-blend-mode:screen;';
      this.stage.renderer.domElement.parentElement?.appendChild(el);
      this.flashEl = el;
    }
    const el = this.flashEl;
    el.style.background = `radial-gradient(circle at 50% 50%, ${color}00 40%, ${color} 130%)`;
    el.style.transition = 'none';
    el.style.opacity = String(strength);
    // Next frame, fade it back out.
    requestAnimationFrame(() => {
      el.style.transition = 'opacity .4s ease';
      el.style.opacity = '0';
    });
  }

  /** A short forward lunge, used when a follower attacks. */
  lunge(attacker: CardObject, toward: THREE.Vector3): void {
    const dir = new THREE.Vector3().subVectors(toward, attacker.group.position).normalize();
    attacker.offset.copy(dir.multiplyScalar(0.55));
    attacker.setSpeed(30);
    setTimeout(() => {
      attacker.offset.set(0, 0, 0);
      attacker.setSpeed(14);
    }, 190);
  }

  // -------------------------------------------------------------------------
  // Frame
  // -------------------------------------------------------------------------

  update(dt: number): void {
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      b.life += dt;
      const attr = b.points.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = attr.array as Float32Array;
      for (let k = 0; k < arr.length; k += 3) {
        b.velocities[k + 1] -= b.gravity * dt;
        arr[k] += b.velocities[k] * dt;
        arr[k + 1] += b.velocities[k + 1] * dt;
        arr[k + 2] += b.velocities[k + 2] * dt;
      }
      attr.needsUpdate = true;
      const t = b.life / b.maxLife;
      b.material.opacity = Math.max(0, 1 - t * t);
      b.material.size *= 1 - dt * 0.5;
      if (b.life >= b.maxLife) {
        this.group.remove(b.points);
        b.points.geometry.dispose();
        b.material.dispose();
        this.bursts.splice(i, 1);
      }
    }

    for (let i = this.labels.length - 1; i >= 0; i--) {
      const l = this.labels[i];
      l.life += dt;
      const t = l.life / l.maxLife;
      l.sprite.position.y += l.velocity * dt * (1 - t * 0.6);
      l.sprite.scale.setScalar(1.5 * (1 + t * 0.25));
      l.sprite.scale.y = 0.75 * (1 + t * 0.25);
      l.material.opacity = t < 0.15 ? t / 0.15 : Math.max(0, 1 - (t - 0.15) / 0.85);
      if (l.life >= l.maxLife) {
        this.group.remove(l.sprite);
        l.material.map?.dispose();
        l.material.dispose();
        this.labels.splice(i, 1);
      }
    }

    for (let i = this.dissolving.length - 1; i >= 0; i--) {
      const d = this.dissolving[i];
      d.t += dt;
      const k = Math.min(1, d.t / 0.45);
      d.obj.material.opacity = 1 - k;
      d.obj.group.scale.setScalar(d.obj.group.scale.x * (1 - dt * 0.6));
      d.obj.group.position.y += dt * 0.4;
      if (k >= 1) this.dissolving.splice(i, 1);
    }
  }

  dispose(): void {
    this.flashEl?.remove();
    this.group.removeFromParent();
  }
}
