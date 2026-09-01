/**
 * The Three.js stage: renderer, camera, lighting and post-processing.
 *
 * This module owns nothing about the game — it is a presentation surface that
 * `battle.ts` populates. Keeping it separate means the board can be re-lit or
 * re-framed without touching anything that knows the rules.
 */
import * as THREE from 'three';

export interface StageOptions {
  container: HTMLElement;
  /** Caps devicePixelRatio; 2 is plenty and keeps mid-range phones smooth. */
  maxPixelRatio?: number;
}

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly root = new THREE.Group();
  /** Objects drawn above the board, e.g. the hand and dragged cards. */
  readonly overlay = new THREE.Group();

  readonly keyLight: THREE.DirectionalLight;
  readonly rimLight: THREE.PointLight;

  private readonly clock = new THREE.Clock();
  private readonly resizeObserver: ResizeObserver;
  private frame = 0;
  private raf = 0;
  private updates: ((dt: number, t: number) => void)[] = [];

  /** Camera shake state, driven by `shake()`. */
  private shakeAmp = 0;
  private shakeDecay = 0;
  private readonly baseCameraPos = new THREE.Vector3();

  constructor(opts: StageOptions) {
    const { container } = opts;

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, opts.maxPixelRatio ?? 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;';

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#05070C');
    this.scene.fog = new THREE.Fog('#070A11', 22, 48);
    this.scene.add(this.root, this.overlay);

    // A fairly long lens keeps the board from splaying outward at the edges,
    // which is what makes a card game read as a table rather than a corridor.
    this.camera = new THREE.PerspectiveCamera(36, 16 / 9, 0.1, 140);
    this.camera.position.set(0.6, 9.6, 11.2);
    this.camera.lookAt(0.6, 0, 0.5);
    this.baseCameraPos.copy(this.camera.position);

    // Lighting: a warm key from above-front, a cool fill, and a rim that picks
    // out the top edge of every card.
    const ambient = new THREE.AmbientLight('#9DB4D2', 0.85);
    this.keyLight = new THREE.DirectionalLight('#FFE9C4', 2.1);
    this.keyLight.position.set(-5, 12, 7);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.set(1024, 1024);
    this.keyLight.shadow.camera.near = 1;
    this.keyLight.shadow.camera.far = 40;
    const cam = this.keyLight.shadow.camera as THREE.OrthographicCamera;
    cam.left = -12;
    cam.right = 12;
    cam.top = 12;
    cam.bottom = -12;
    cam.updateProjectionMatrix();
    this.keyLight.shadow.bias = -0.0012;

    const fill = new THREE.DirectionalLight('#7FA6FF', 0.75);
    fill.position.set(6, 5, 4);

    this.rimLight = new THREE.PointLight('#FFC98A', 16, 30, 2);
    this.rimLight.position.set(0, 3.2, -6);

    this.scene.add(ambient, this.keyLight, fill, this.rimLight);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }

  private resize(): void {
    const el = this.renderer.domElement.parentElement;
    if (!el) return;
    const w = el.clientWidth || 1;
    const h = el.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;

    // Pull the camera back on narrow screens so the five board slots and the
    // hand all stay in frame on a phone held in landscape.
    const widen = Math.max(1, 1.78 / this.camera.aspect);
    this.baseCameraPos.set(0.6, 9.6 * widen ** 0.4, 11.2 * widen ** 0.85);
    this.camera.position.copy(this.baseCameraPos);
    this.camera.lookAt(0.6, 0, 0.5);
    this.camera.updateProjectionMatrix();
  }

  /** Registers a per-frame callback. Returns an unsubscribe function. */
  onUpdate(fn: (dt: number, t: number) => void): () => void {
    this.updates.push(fn);
    return () => {
      const i = this.updates.indexOf(fn);
      if (i >= 0) this.updates.splice(i, 1);
    };
  }

  /** Impulse camera shake, used for attacks and leader damage. */
  shake(amplitude: number, decay = 6): void {
    this.shakeAmp = Math.max(this.shakeAmp, amplitude);
    this.shakeDecay = decay;
  }

  start(): void {
    if (this.raf) return;
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(this.clock.getDelta(), 0.05);
      const t = this.clock.elapsedTime;
      for (const fn of this.updates) fn(dt, t);

      if (this.shakeAmp > 0.0005) {
        this.shakeAmp *= Math.exp(-this.shakeDecay * dt);
        const a = this.shakeAmp;
        this.camera.position.set(
          this.baseCameraPos.x + Math.sin(t * 71) * a,
          this.baseCameraPos.y + Math.sin(t * 53) * a * 0.7,
          this.baseCameraPos.z + Math.sin(t * 97) * a * 0.4,
        );
        this.camera.lookAt(0.6, 0, 0.5);
      } else if (this.shakeAmp !== 0) {
        this.shakeAmp = 0;
        this.camera.position.copy(this.baseCameraPos);
        this.camera.lookAt(0.6, 0, 0.5);
      }

      this.renderer.render(this.scene, this.camera);
      this.frame++;
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  dispose(): void {
    this.stop();
    this.resizeObserver.disconnect();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  get frameCount(): number {
    return this.frame;
  }
}
