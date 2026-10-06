import type { Surface } from '../world/blocks';

/** Fully procedural sound (no external assets): filtered noise bursts + simple tones. */

interface SurfaceSound {
  type: BiquadFilterType;
  freq: number;
  q: number;
  dur: number;
  tone?: number;
  gain: number;
}

const SURFACES: Record<Surface, SurfaceSound> = {
  grass: { type: 'bandpass', freq: 1700, q: 0.7, dur: 0.09, gain: 0.5 },
  stone: { type: 'bandpass', freq: 850, q: 1.8, dur: 0.07, gain: 0.7, tone: 140 },
  wood: { type: 'bandpass', freq: 520, q: 2.5, dur: 0.08, gain: 0.7, tone: 190 },
  sand: { type: 'highpass', freq: 2600, q: 0.5, dur: 0.12, gain: 0.45 },
  snow: { type: 'bandpass', freq: 2300, q: 0.4, dur: 0.12, gain: 0.45 },
  gravel: { type: 'bandpass', freq: 1300, q: 0.9, dur: 0.11, gain: 0.6 },
  glass: { type: 'highpass', freq: 3500, q: 1, dur: 0.06, gain: 0.4, tone: 2100 },
  plant: { type: 'bandpass', freq: 3200, q: 0.6, dur: 0.06, gain: 0.35 },
  water: { type: 'lowpass', freq: 700, q: 1, dur: 0.22, gain: 0.6 },
};

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private fx!: GainNode;
  private amb!: GainNode;
  private mus!: GainNode;
  private musicDelay!: DelayNode;
  private nextPhrase = 25;
  private phraseEnd = 0;
  private nextNote = 0;
  private scale: number[] = [];
  private noise!: AudioBuffer;
  private wind: { src: AudioBufferSourceNode; gain: GainNode; filter: BiquadFilterNode } | null = null;
  private volumes = { master: 0.8, effects: 0.9, ambient: 0.6, music: 0.5 };
  private nextChirp = 0;
  failed = false;

  /** Must be called from a user gesture (autoplay policies). Safe to call repeatedly. */
  unlock(): void {
    if (this.failed) return;
    try {
      if (!this.ctx) {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) throw new Error('Web Audio unsupported');
        this.ctx = new Ctor();
        this.master = this.ctx.createGain();
        this.fx = this.ctx.createGain();
        this.amb = this.ctx.createGain();
        this.mus = this.ctx.createGain();
        this.fx.connect(this.master);
        this.amb.connect(this.master);
        // Music bus with a soft feedback echo.
        this.musicDelay = this.ctx.createDelay(1.5);
        this.musicDelay.delayTime.value = 0.42;
        const fb = this.ctx.createGain();
        fb.gain.value = 0.35;
        const lp = this.ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 2200;
        this.mus.connect(this.master);
        this.mus.connect(this.musicDelay);
        this.musicDelay.connect(lp).connect(fb).connect(this.musicDelay);
        lp.connect(this.master);
        this.master.connect(this.ctx.destination);
        const len = this.ctx.sampleRate;
        this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        this.applyVolumes();
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
    } catch (e) {
      console.warn('[BlockForge] audio disabled:', e);
      this.failed = true;
    }
  }

  setVolumes(master: number, effects: number, ambient: number, music = this.volumes.music): void {
    this.volumes = { master, effects, ambient, music };
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (!this.ctx) return;
    this.master.gain.value = this.volumes.master;
    this.fx.gain.value = this.volumes.effects;
    this.amb.gain.value = this.volumes.ambient;
    this.mus.gain.value = this.volumes.music * 0.5;
  }

  /** A soft mallet/pad note on the music bus. */
  private musicNote(freq: number, at: number, dur: number, vol: number, type: OscillatorType): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(vol, at + Math.min(0.6, dur * 0.25));
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g).connect(this.mus);
    o.start(at);
    o.stop(at + dur + 0.05);
  }

  /**
   * Generative background music: occasional calm phrases (pentatonic, major by day,
   * minor at night/underground) with long silences in between. Call every frame.
   */
  updateMusic(now: number, day: number, underground: boolean): void {
    if (!this.ready || this.volumes.music <= 0) return;
    const ctx = this.ctx!;
    if (now < this.phraseEnd) {
      if (now >= this.nextNote) {
        const t = ctx.currentTime + 0.05;
        const f = this.scale[Math.floor(Math.random() * this.scale.length)];
        this.musicNote(f, t, 1.6 + Math.random() * 1.4, 0.07, 'triangle');
        if (Math.random() < 0.35) this.musicNote(f * 2, t + 0.25, 1.2, 0.025, 'sine');
        this.nextNote = now + 0.9 + Math.random() * 1.6;
      }
      return;
    }
    if (now < this.nextPhrase) return;
    // Start a new phrase.
    const minor = day < 0.4 || underground;
    const root = [196, 220, 174.6, 233.1][Math.floor(Math.random() * 4)];
    const steps = minor ? [0, 3, 5, 7, 10, 12, 15] : [0, 2, 4, 7, 9, 12, 14];
    this.scale = steps.map((st) => root * Math.pow(2, st / 12));
    const len = 28 + Math.random() * 22;
    this.phraseEnd = now + len;
    this.nextPhrase = this.phraseEnd + 60 + Math.random() * 120;
    this.nextNote = now + 1;
    // Pad chord under the phrase.
    const t = ctx.currentTime + 0.1;
    for (const k of [0, 2, 4]) this.musicNote(this.scale[k] / 2, t, len, 0.03, 'sine');
  }

  private get ready(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  private burst(s: SurfaceSound, volume: number, pitch = 1, out?: AudioNode): void {
    if (!this.ready) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = pitch;
    const f = ctx.createBiquadFilter();
    f.type = s.type;
    f.frequency.value = s.freq * pitch;
    f.Q.value = s.q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(s.gain * volume, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + s.dur);
    src.connect(f).connect(g).connect(out ?? this.fx);
    src.start(t, Math.random() * 0.5, s.dur + 0.05);
    if (s.tone) this.tone(s.tone * pitch, s.dur * 0.8, 0.25 * volume, 'triangle');
  }

  private tone(freq: number, dur: number, vol: number, type: OscillatorType = 'sine', slideTo?: number, delay = 0): void {
    if (!this.ready) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.fx);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  step(surface: Surface): void {
    this.burst(SURFACES[surface], 0.35, 0.9 + Math.random() * 0.2);
  }
  hit(surface: Surface): void {
    this.burst(SURFACES[surface], 0.45, 0.8 + Math.random() * 0.3);
  }
  breakBlock(surface: Surface): void {
    const s = SURFACES[surface];
    this.burst({ ...s, dur: s.dur * 2.2 }, 0.8, 0.75);
    this.burst(s, 0.5, 1.1);
  }
  place(surface: Surface): void {
    this.burst({ ...SURFACES[surface], dur: 0.08 }, 0.7, 0.7);
  }
  jump(): void {
    this.burst(SURFACES.grass, 0.18, 1.3);
  }
  land(intensity: number, surface: Surface): void {
    this.burst({ ...SURFACES[surface], dur: 0.12 }, Math.min(1, 0.3 + intensity), 0.6);
  }
  splash(): void {
    this.burst(SURFACES.water, 0.9, 0.9);
    this.burst({ ...SURFACES.water, type: 'bandpass', freq: 1500, dur: 0.3 }, 0.5, 1.2);
  }
  damage(): void {
    this.tone(220, 0.18, 0.35, 'square', 110);
    this.burst(SURFACES.gravel, 0.5, 0.5);
  }
  eat(): void {
    for (let i = 0; i < 3; i++) this.tone(300 + Math.random() * 120, 0.06, 0.12, 'triangle', undefined, i * 0.09);
  }
  pickup(): void {
    this.tone(880, 0.07, 0.12, 'sine', 1320);
  }
  click(): void {
    this.tone(660, 0.05, 0.1, 'triangle');
  }
  craft(): void {
    this.tone(520, 0.08, 0.15, 'triangle');
    this.tone(780, 0.12, 0.15, 'triangle', undefined, 0.07);
    this.burst(SURFACES.wood, 0.4, 1.2);
  }
  openInventory(): void {
    this.burst(SURFACES.plant, 0.4, 0.7);
  }
  toolBreak(): void {
    this.tone(900, 0.2, 0.2, 'square', 200);
  }
  death(): void {
    this.tone(330, 0.6, 0.3, 'sawtooth', 80);
  }
  mobGrunt(pitch: number): void {
    this.tone(120 * pitch, 0.25, 0.18, 'sawtooth', 80 * pitch);
  }
  mobShoot(pitch: number): void {
    this.tone(320 * pitch, 0.12, 0.12, 'square', 140 * pitch);
  }
  /** Teleport / rift whoosh. */
  blink(): void {
    this.tone(180, 0.35, 0.16, 'sine', 900);
    this.burst({ type: 'bandpass', freq: 1400, q: 1.2, dur: 0.35, gain: 0.3 }, 0.3, 0.6);
  }
  mobHiss(): void {
    this.burst({ type: 'highpass', freq: 3000, q: 0.5, dur: 0.4, gain: 0.5 }, 0.5, 0.8);
  }

  /** Ambient bed: wind (louder high up) + birds by day. Call every frame. */
  updateAmbient(now: number, altitude: number, day: number, underground: boolean): void {
    if (!this.ready) return;
    const ctx = this.ctx!;
    if (!this.wind) {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 400;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(filter).connect(gain).connect(this.amb);
      src.start();
      this.wind = { src, gain, filter };
    }
    const windLevel = underground ? 0.02 : 0.05 + Math.max(0, altitude - 60) * 0.003;
    const wob = 0.6 + 0.4 * Math.sin(now * 0.37) * Math.sin(now * 0.13);
    this.wind.gain.gain.setTargetAtTime(windLevel * wob, ctx.currentTime, 0.5);
    this.wind.filter.frequency.setTargetAtTime(300 + wob * 300, ctx.currentTime, 0.5);
    if (!underground && day > 0.6 && now > this.nextChirp) {
      this.nextChirp = now + 4 + Math.random() * 9;
      const base = 1800 + Math.random() * 1400;
      const n = 2 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) this.tone(base, 0.08, 0.04, 'sine', base * 1.35, i * 0.12);
    }
  }

  suspend(): void {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend().catch(() => undefined);
  }

  resume(): void {
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
  }
}

export const audio = new AudioEngine();
