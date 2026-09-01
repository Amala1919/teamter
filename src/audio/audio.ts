/**
 * Sound.
 *
 * Every sound is synthesised with the Web Audio API rather than loaded from a
 * file, so the project ships no audio assets and every cue is tunable in code.
 * The palette is deliberately narrow — crystalline UI ticks, a woody card
 * thud, metal on impact, a choir-ish swell for evolution — because a card game
 * plays the same twenty sounds thousands of times and anything sharper than
 * this becomes fatiguing.
 */

export type Cue =
  | 'hover'
  | 'pick'
  | 'play'
  | 'summon'
  | 'spell'
  | 'attack'
  | 'hit'
  | 'hitLeader'
  | 'destroy'
  | 'banish'
  | 'draw'
  | 'evolve'
  | 'buff'
  | 'heal'
  | 'deny'
  | 'turnMine'
  | 'turnTheirs'
  | 'victory'
  | 'defeat';

interface ToneSpec {
  /** Base frequency in Hz. */
  freq: number;
  /** Frequency at the end of the sweep; equal to `freq` for a steady tone. */
  to?: number;
  type?: OscillatorType;
  /** Seconds. */
  attack?: number;
  decay: number;
  gain?: number;
  /** Added noise burst level, for impacts. */
  noise?: number;
  /** Stacked harmonics as multipliers of `freq`. */
  harmonics?: number[];
  /** Delay before the tone starts, for layered cues. */
  delay?: number;
  /** Low-pass cutoff in Hz. */
  cutoff?: number;
}

const CUES: Record<Cue, ToneSpec[]> = {
  hover: [{ freq: 1750, to: 2050, type: 'sine', decay: 0.055, gain: 0.045 }],
  pick: [{ freq: 620, to: 880, type: 'triangle', decay: 0.09, gain: 0.1 }],
  play: [
    { freq: 190, to: 120, type: 'sine', decay: 0.16, gain: 0.22 },
    { freq: 1200, type: 'triangle', decay: 0.06, gain: 0.06, noise: 0.18 },
  ],
  summon: [
    { freq: 150, to: 96, type: 'sine', decay: 0.3, gain: 0.26 },
    { freq: 520, to: 780, type: 'triangle', decay: 0.32, gain: 0.11, harmonics: [1, 1.5, 2] },
  ],
  spell: [
    { freq: 380, to: 1500, type: 'sine', decay: 0.4, gain: 0.13, harmonics: [1, 2, 3] },
    { freq: 2400, type: 'sine', decay: 0.22, gain: 0.05, noise: 0.3, delay: 0.04 },
  ],
  attack: [
    { freq: 240, to: 90, type: 'sawtooth', decay: 0.13, gain: 0.16, cutoff: 1800 },
    { freq: 90, type: 'sine', decay: 0.1, gain: 0.14, noise: 0.35 },
  ],
  hit: [
    { freq: 160, to: 70, type: 'square', decay: 0.11, gain: 0.16, cutoff: 1200 },
    { freq: 60, type: 'sine', decay: 0.14, gain: 0.2, noise: 0.5 },
  ],
  hitLeader: [
    { freq: 110, to: 42, type: 'sawtooth', decay: 0.34, gain: 0.3, cutoff: 900 },
    { freq: 44, type: 'sine', decay: 0.42, gain: 0.34, noise: 0.6 },
  ],
  destroy: [
    { freq: 300, to: 70, type: 'triangle', decay: 0.34, gain: 0.18 },
    { freq: 1400, type: 'sine', decay: 0.24, gain: 0.06, noise: 0.5, delay: 0.02 },
  ],
  banish: [{ freq: 900, to: 2400, type: 'sine', decay: 0.5, gain: 0.1, harmonics: [1, 1.5, 2.5] }],
  draw: [{ freq: 900, to: 1500, type: 'triangle', decay: 0.1, gain: 0.07, noise: 0.12 }],
  evolve: [
    { freq: 140, to: 300, type: 'sine', decay: 0.7, gain: 0.24, harmonics: [1, 2, 3, 4] },
    { freq: 660, to: 990, type: 'triangle', decay: 0.85, gain: 0.12, harmonics: [1, 1.25, 1.5], delay: 0.08 },
    { freq: 2200, type: 'sine', decay: 0.4, gain: 0.05, noise: 0.35, delay: 0.02 },
  ],
  buff: [{ freq: 760, to: 1250, type: 'sine', decay: 0.2, gain: 0.09, harmonics: [1, 1.5] }],
  heal: [{ freq: 620, to: 940, type: 'sine', decay: 0.42, gain: 0.1, harmonics: [1, 1.5, 2] }],
  deny: [{ freq: 200, to: 150, type: 'square', decay: 0.12, gain: 0.09, cutoff: 900 }],
  turnMine: [
    { freq: 330, to: 495, type: 'sine', decay: 0.55, gain: 0.16, harmonics: [1, 1.5, 2] },
    { freq: 990, type: 'triangle', decay: 0.3, gain: 0.05, delay: 0.12 },
  ],
  turnTheirs: [{ freq: 220, to: 165, type: 'sine', decay: 0.5, gain: 0.13, harmonics: [1, 1.5] }],
  victory: [
    { freq: 392, type: 'sine', decay: 0.8, gain: 0.16, harmonics: [1, 1.25, 1.5, 2] },
    { freq: 523, type: 'sine', decay: 0.9, gain: 0.14, harmonics: [1, 1.25, 1.5], delay: 0.18 },
    { freq: 659, type: 'sine', decay: 1.2, gain: 0.14, harmonics: [1, 1.5, 2], delay: 0.36 },
  ],
  defeat: [
    { freq: 220, to: 165, type: 'sine', decay: 1.1, gain: 0.16, harmonics: [1, 1.2] },
    { freq: 110, to: 82, type: 'sine', decay: 1.4, gain: 0.14, delay: 0.2 },
  ],
};

export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private musicTimer = 0;
  private noiseBuffer: AudioBuffer | null = null;

  private _muted = false;
  private _volume = 0.7;

  /** Lazily created so the context starts only after a user gesture. */
  private ensure(): AudioContext | null {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return this.ctx;
    }
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this._muted ? 0 : this._volume;
      this.master.connect(this.ctx.destination);
      return this.ctx;
    } catch {
      return null;
    }
  }

  get muted(): boolean {
    return this._muted;
  }

  setMuted(muted: boolean): void {
    this._muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : this._volume;
  }

  setVolume(v: number): void {
    this._volume = Math.max(0, Math.min(1, v));
    if (this.master && !this._muted) this.master.gain.value = this._volume;
  }

  private getNoise(ctx: AudioContext): AudioBuffer {
    if (this.noiseBuffer) return this.noiseBuffer;
    const len = Math.floor(ctx.sampleRate * 0.4);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buf;
    return buf;
  }

  play(cue: Cue): void {
    const ctx = this.ensure();
    if (!ctx || !this.master || this._muted) return;
    const specs = CUES[cue];
    if (!specs) return;

    for (const spec of specs) {
      const start = ctx.currentTime + (spec.delay ?? 0);
      const gainValue = spec.gain ?? 0.12;
      const attack = spec.attack ?? 0.006;

      const bus = ctx.createGain();
      bus.gain.setValueAtTime(0, start);
      bus.gain.linearRampToValueAtTime(gainValue, start + attack);
      bus.gain.exponentialRampToValueAtTime(0.0001, start + attack + spec.decay);

      let sink: AudioNode = bus;
      if (spec.cutoff) {
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = spec.cutoff;
        bus.connect(filter);
        sink = filter;
      }
      sink.connect(this.master);

      for (const mult of spec.harmonics ?? [1]) {
        const osc = ctx.createOscillator();
        osc.type = spec.type ?? 'sine';
        osc.frequency.setValueAtTime(spec.freq * mult, start);
        if (spec.to) {
          osc.frequency.exponentialRampToValueAtTime(
            Math.max(20, spec.to * mult),
            start + attack + spec.decay,
          );
        }
        const h = ctx.createGain();
        // Higher harmonics quieter, or the stack turns into a buzz.
        h.gain.value = mult === 1 ? 1 : 0.4 / mult;
        osc.connect(h).connect(bus);
        osc.start(start);
        osc.stop(start + attack + spec.decay + 0.05);
      }

      if (spec.noise) {
        const src = ctx.createBufferSource();
        src.buffer = this.getNoise(ctx);
        const ng = ctx.createGain();
        ng.gain.setValueAtTime(spec.noise * gainValue, start);
        ng.gain.exponentialRampToValueAtTime(0.0001, start + spec.decay * 0.7);
        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = spec.freq * 3;
        filter.Q.value = 0.8;
        src.connect(filter).connect(ng).connect(this.master);
        src.start(start);
        src.stop(start + spec.decay + 0.05);
      }
    }
  }

  /**
   * A slow ambient bed: a drone plus sparse bell tones on a pentatonic scale.
   * It is intentionally almost-not-there — battle audio has to sit on top.
   */
  startMusic(): void {
    const ctx = this.ensure();
    if (!ctx || !this.master || this.musicGain) return;

    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = 0.16;
    this.musicGain.connect(this.master);

    const drone = ctx.createOscillator();
    drone.type = 'sine';
    drone.frequency.value = 55;
    const droneGain = ctx.createGain();
    droneGain.gain.value = 0.5;
    drone.connect(droneGain).connect(this.musicGain);
    drone.start();

    const fifth = ctx.createOscillator();
    fifth.type = 'sine';
    fifth.frequency.value = 82.4;
    const fifthGain = ctx.createGain();
    fifthGain.gain.value = 0.22;
    fifth.connect(fifthGain).connect(this.musicGain);
    fifth.start();

    const scale = [261.6, 293.7, 329.6, 392.0, 440.0, 523.3];
    const tick = () => {
      if (!this.musicGain || !this.ctx) return;
      this.musicTimer = window.setTimeout(tick, 2600 + Math.random() * 3400);
      const f = scale[Math.floor(Math.random() * scale.length)] * (Math.random() < 0.3 ? 2 : 1);
      const now = this.ctx.currentTime;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(0.09, now + 0.4);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 4.5);
      g.connect(this.musicGain);
      for (const mult of [1, 2, 3]) {
        const o = this.ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = f * mult;
        const hg = this.ctx.createGain();
        hg.gain.value = mult === 1 ? 1 : 0.25 / mult;
        o.connect(hg).connect(g);
        o.start(now);
        o.stop(now + 4.8);
      }
    };
    tick();
  }

  stopMusic(): void {
    if (this.musicTimer) window.clearTimeout(this.musicTimer);
    this.musicTimer = 0;
    this.musicGain?.disconnect();
    this.musicGain = null;
  }
}
