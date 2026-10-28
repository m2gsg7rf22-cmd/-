// Procedural audio with the Web Audio API: mixer buses, synthesized SFX presets,
// 3D positional playback, a continuous engine sound, ambience beds, and an adaptive
// music sequencer (moods x intensity layers). No audio files needed.

const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);
const SCALES = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10], phrygian: [0, 1, 3, 5, 7, 8, 10], pentatonic: [0, 3, 5, 7, 10], lydian: [0, 2, 4, 6, 7, 9, 11] };

export const MOODS = {
  exploration: { bpm: 84, root: 50, scale: 'lydian', prog: [0, 4, 5, 3], pad: 'warm', drums: 'soft', lead: 0.5, swing: 0.1 },
  calm: { bpm: 72, root: 48, scale: 'major', prog: [0, 5, 3, 4], pad: 'warm', drums: 'none', lead: 0.35, swing: 0 },
  tension: { bpm: 96, root: 45, scale: 'phrygian', prog: [0, 1, 0, 6], pad: 'dark', drums: 'pulse', lead: 0.2, swing: 0 },
  combat: { bpm: 138, root: 45, scale: 'minor', prog: [0, 5, 6, 4], pad: 'dark', drums: 'driving', lead: 0.6, swing: 0 },
  driving: { bpm: 118, root: 45, scale: 'dorian', prog: [0, 6, 5, 4], pad: 'synth', drums: 'four', lead: 0.55, swing: 0 },
  heroic: { bpm: 108, root: 48, scale: 'major', prog: [0, 4, 5, 3], pad: 'brass', drums: 'march', lead: 0.7, swing: 0 },
  mystery: { bpm: 66, root: 47, scale: 'dorian', prog: [0, 3, 6, 4], pad: 'dark', drums: 'none', lead: 0.25, swing: 0 },
};

export class AudioEngine {
  constructor() {
    this.ctx = null; this.enabled = typeof window !== 'undefined' && !!(window.AudioContext || window.webkitAudioContext);
    this.volumes = { master: 0.8, music: 0.55, sfx: 0.9, ambience: 0.6, voice: 1 };
    this.listener = { x: 0, y: 0, z: 0, yaw: 0 };
    this.music = null; this.played = 0; this.loops = new Set();
  }
  // Must be called from a user gesture (click/keydown) before sound is audible.
  unlock() {
    if (!this.enabled) return false;
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      const c = this.ctx;
      this.master = c.createGain(); this.master.gain.value = this.volumes.master;
      const comp = c.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 4;
      this.master.connect(comp).connect(c.destination);
      this.buses = {};
      for (const b of ['music', 'sfx', 'ambience', 'voice']) { const g = c.createGain(); g.gain.value = this.volumes[b]; g.connect(this.master); this.buses[b] = g; }
      // shared reverb (generated impulse)
      this.reverb = c.createConvolver(); this.reverb.buffer = this._impulse(2.2, 2.5);
      this.reverbSend = c.createGain(); this.reverbSend.gain.value = 0.25; this.reverbSend.connect(this.reverb).connect(this.master);
      this.noiseBuf = this._noise(2);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return true;
  }
  get ready() { return !!this.ctx; }
  setVolume(bus, v) { this.volumes[bus] = v; if (!this.ctx) return; if (bus === 'master') this.master.gain.value = v; else this.buses[bus].gain.value = v; }
  _noise(sec) { const c = this.ctx, b = c.createBuffer(1, c.sampleRate * sec, c.sampleRate), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; return b; }
  _impulse(sec, decay) { const c = this.ctx, len = c.sampleRate * sec, b = c.createBuffer(2, len, c.sampleRate); for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay); } return b; }
  setListener(x, y, z, yaw) { Object.assign(this.listener, { x, y, z, yaw }); }
  // Spatial routing: distance attenuation + stereo pan relative to listener yaw.
  _spatial(pos, maxDist = 40) {
    const c = this.ctx, g = c.createGain(), pan = c.createStereoPanner ? c.createStereoPanner() : null;
    if (pos) {
      const dx = pos.x - this.listener.x, dz = pos.z - this.listener.z, d = Math.hypot(dx, dz, (pos.y || 0) - this.listener.y);
      g.gain.value = Math.max(0, 1 - d / maxDist) ** 1.5;
      if (pan) { const ang = Math.atan2(dx, dz) - this.listener.yaw; pan.pan.value = Math.max(-1, Math.min(1, -Math.sin(ang))); }
    }
    if (pan) { g.connect(pan); return { input: g, output: pan }; }
    return { input: g, output: g };
  }
  _out(bus, pos, reverb = 0.15, maxDist) {
    const s = this._spatial(pos, maxDist); s.output.connect(this.buses[bus]);
    if (reverb > 0) { const r = this.ctx.createGain(); r.gain.value = reverb; s.output.connect(r).connect(this.reverbSend); }
    return s.input;
  }
  _env(gainNode, t, a, d, peak = 1, sustain = 0, release = 0.05) {
    const g = gainNode.gain; g.cancelScheduledValues(t); g.setValueAtTime(0.0001, t);
    g.linearRampToValueAtTime(peak, t + a); g.exponentialRampToValueAtTime(Math.max(0.0001, sustain || 0.0001), t + a + d);
    if (sustain) g.exponentialRampToValueAtTime(0.0001, t + a + d + release);
  }
  _osc(type, freq, t, dur, dest, { gain = 0.3, a = 0.005, slide = null, detune = 0 } = {}) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t); o.detune.value = detune;
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, slide), t + dur);
    this._env(g, t, a, dur, gain); o.connect(g).connect(dest); o.start(t); o.stop(t + a + dur + 0.05);
    return o;
  }
  _noiseBurst(t, dur, dest, { gain = 0.4, type = 'bandpass', freq = 1000, q = 1, slide = null, a = 0.003 } = {}) {
    const c = this.ctx, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.noiseBuf; f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (slide) f.frequency.exponentialRampToValueAtTime(slide, t + dur);
    this._env(g, t, a, dur, gain); s.connect(f).connect(g).connect(dest); s.start(t, Math.random()); s.stop(t + dur + 0.1);
  }
  // FM voice: carrier modulated by an oscillator (bells, metal, sci-fi, growls). index = mod depth in Hz.
  _fm(freq, ratio, index, t, dur, dest, { gain = 0.3, a = 0.003, indexDecay = 0.5, type = 'sine', slide = null } = {}) {
    const c = this.ctx, car = c.createOscillator(), mod = c.createOscillator(), mg = c.createGain(), g = c.createGain();
    car.type = type; car.frequency.setValueAtTime(freq, t); if (slide) car.frequency.exponentialRampToValueAtTime(Math.max(20, slide), t + dur);
    mod.frequency.setValueAtTime(freq * ratio, t); mg.gain.setValueAtTime(index, t); mg.gain.exponentialRampToValueAtTime(Math.max(0.01, index * indexDecay), t + dur);
    mod.connect(mg).connect(car.frequency); this._env(g, t, a, dur, gain); car.connect(g).connect(dest);
    car.start(t); mod.start(t); car.stop(t + a + dur + 0.05); mod.stop(t + a + dur + 0.05);
  }
  // Plucked string (Karplus-Strong rendered into a buffer): guitars, harps, plinks, bowstrings.
  _pluck(freq, t, dur, dest, { gain = 0.4, damping = 0.996, brightness = 0.5 } = {}) {
    const c = this.ctx, n = Math.ceil(c.sampleRate * dur), b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0), period = Math.max(2, Math.round(c.sampleRate / freq));
    const ring = new Float32Array(period); for (let i = 0; i < period; i++) ring[i] = Math.random() * 2 - 1;
    let prev = 0; for (let i = 0; i < n; i++) { const k = i % period, v = ring[k]; d[i] = v; const nv = damping * (brightness * v + (1 - brightness) * (v + prev) * 0.5); prev = v; ring[k] = nv; }
    const s = c.createBufferSource(), g = c.createGain(); s.buffer = b; g.gain.value = gain; s.connect(g).connect(dest); s.start(t);
  }
  // Play a named SFX preset. opts: { pos, pitch, volume }
  play(name, opts = {}) {
    this.played++;
    if (!this.ctx) return false;
    const c = this.ctx, t = c.currentTime + 0.005, p = opts.pitch ?? (0.92 + Math.random() * 0.16), v = opts.volume ?? 1;
    const out = this._out(opts.bus || 'sfx', opts.pos, opts.reverb ?? 0.12, opts.maxDist);
    const vol = c.createGain(); vol.gain.value = v; vol.connect(out);
    const fx = SFX[name]; if (!fx) { console.warn('unknown sfx', name); return false; }
    fx(this, t, vol, p);
    return true;
  }
  // Continuous engine voice for vehicles; returns controller { set(rpm, load), stop() }
  engine({ pos = null, base = 38, voices = 3 } = {}) {
    if (!this.ctx) return { set() {}, stop() {}, setPos() {} };
    const c = this.ctx, out = this._out('sfx', pos, 0.05, 60), g = c.createGain(); g.gain.value = 0.0; g.connect(out);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; lp.connect(g);
    const oscs = [];
    for (let i = 0; i < voices; i++) { const o = c.createOscillator(); o.type = i === 0 ? 'sawtooth' : 'square'; o.frequency.value = base * (i + 1); const og = c.createGain(); og.gain.value = 0.18 / (i + 1); o.connect(og).connect(lp); o.start(); oscs.push(o); }
    const self = this;
    const ctl = {
      set(rpm, load = 0.5) { const f = base * (0.6 + rpm * 2.6); const t = c.currentTime; oscs.forEach((o, i) => o.frequency.setTargetAtTime(f * (i + 1) * (i === 2 ? 1.01 : 1), t, 0.05)); lp.frequency.setTargetAtTime(500 + rpm * 2200 + load * 800, t, 0.05); g.gain.setTargetAtTime(0.1 + load * 0.18 + rpm * 0.08, t, 0.08); },
      stop() { g.gain.setTargetAtTime(0, c.currentTime, 0.1); setTimeout(() => oscs.forEach((o) => o.stop()), 400); self.loops.delete(ctl); },
      setPos() {},
    };
    this.loops.add(ctl);
    return ctl;
  }
  // Looping filtered-noise ambience (wind, waves, city, rain). Returns { set(level), stop() }
  ambience(kind = 'wind') {
    if (!this.ctx) return { set() {}, stop() {} };
    const c = this.ctx, s = c.createBufferSource(); s.buffer = this._noise(4); s.loop = true;
    const f = c.createBiquadFilter(), g = c.createGain(), lfo = c.createOscillator(), lg = c.createGain();
    const cfg = { wind: ['bandpass', 500, 0.6, 0.12, 0.08], waves: ['lowpass', 700, 0.5, 0.25, 0.12], city: ['lowpass', 380, 0.4, 0.14, 0.2], rain: ['highpass', 2500, 0.3, 0.1, 1.5], forest: ['bandpass', 1800, 1.5, 0.05, 0.3] }[kind] || ['bandpass', 600, 0.5, 0.1, 0.1];
    f.type = cfg[0]; f.frequency.value = cfg[1]; f.Q.value = cfg[2]; g.gain.value = cfg[3];
    lfo.frequency.value = cfg[4]; lg.gain.value = cfg[1] * 0.4; lfo.connect(lg).connect(f.frequency); lfo.start();
    s.connect(f).connect(g).connect(this.buses.ambience); s.start();
    let birds = null;
    if (kind === 'forest') birds = setInterval(() => { if (Math.random() < 0.5) this.play('bird', { volume: 0.25, bus: 'ambience' }); }, 1800);
    return { set: (lv) => g.gain.setTargetAtTime(cfg[3] * lv, c.currentTime, 0.3), stop: () => { g.gain.setTargetAtTime(0, c.currentTime, 0.3); setTimeout(() => { s.stop(); lfo.stop(); }, 1500); if (birds) clearInterval(birds); } };
  }
  playMusic(mood = 'exploration', { intensity = 0.5, seed = 1 } = {}) {
    if (this.music && this.music.mood === mood) { this.music.intensity = intensity; return this.music; }
    if (this.music) this.music.stop();
    this.music = new MusicSequencer(this, mood, { intensity, seed });
    if (this.ctx) this.music.start();
    return this.music;
  }
  stopMusic() { if (this.music) { this.music.stop(); this.music = null; } }
  // Simple procedural "voice" babble for dialogue lines (Animal-Crossing-like blips).
  speak(text, { pitch = 1, rate = 1 } = {}) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    const syll = Math.min(24, Math.ceil(text.length / 4));
    const out = this._out('voice', null, 0.05);
    for (let i = 0; i < syll; i++) { const t = t0 + i * 0.075 / rate; const f = 180 * pitch * (1 + 0.25 * Math.sin(i * 1.7 + text.charCodeAt(i % text.length))); this._osc('triangle', f, t, 0.05, out, { gain: 0.06 }); this._osc('sine', f * 2.01, t, 0.04, out, { gain: 0.03 }); }
  }
}

// SFX presets: (engine, time, destination, pitch)
const SFX = {
  swing: (e, t, d, p) => e._noiseBurst(t, 0.18, d, { gain: 0.35, freq: 1800 * p, q: 1.2, slide: 600 * p }),
  hit: (e, t, d, p) => { e._osc('sine', 160 * p, t, 0.12, d, { gain: 0.6, slide: 50 }); e._noiseBurst(t, 0.08, d, { gain: 0.5, freq: 2500 * p, q: 0.8 }); },
  heavyHit: (e, t, d, p) => { e._osc('sine', 110 * p, t, 0.3, d, { gain: 0.9, slide: 35 }); e._noiseBurst(t, 0.25, d, { gain: 0.6, type: 'lowpass', freq: 1500, slide: 200 }); },
  clang: (e, t, d, p) => { for (const h of [1, 2.76, 5.4]) e._osc('sine', 820 * p * h, t, 0.4 / h, d, { gain: 0.18 / h }); e._noiseBurst(t, 0.05, d, { gain: 0.3, type: 'highpass', freq: 4000 }); },
  block: (e, t, d, p) => { e._osc('square', 300 * p, t, 0.06, d, { gain: 0.2, slide: 200 }); e._noiseBurst(t, 0.06, d, { gain: 0.3, freq: 1200 }); },
  hurt: (e, t, d, p) => { e._osc('sawtooth', 220 * p, t, 0.18, d, { gain: 0.25, slide: 120 }); },
  death: (e, t, d, p) => { e._osc('sawtooth', 200 * p, t, 0.7, d, { gain: 0.25, slide: 50 }); e._noiseBurst(t + 0.2, 0.4, d, { gain: 0.3, type: 'lowpass', freq: 600 }); },
  footstep: (e, t, d, p) => e._noiseBurst(t, 0.05, d, { gain: 0.18, type: 'lowpass', freq: 500 * p, q: 0.7 }),
  footstepGrass: (e, t, d, p) => e._noiseBurst(t, 0.07, d, { gain: 0.12, freq: 2800 * p, q: 0.5 }),
  jump: (e, t, d, p) => e._osc('sine', 220 * p, t, 0.15, d, { gain: 0.2, slide: 440 * p }),
  land: (e, t, d, p) => e._noiseBurst(t, 0.1, d, { gain: 0.3, type: 'lowpass', freq: 300 * p }),
  dodge: (e, t, d, p) => e._noiseBurst(t, 0.25, d, { gain: 0.25, freq: 900 * p, slide: 300, q: 0.6 }),
  pickup: (e, t, d, p) => { [0, 4, 7, 12].forEach((n, i) => e._osc('triangle', NOTE(76 + n) * p, t + i * 0.05, 0.12, d, { gain: 0.18 })); },
  coin: (e, t, d, p) => { e._osc('square', NOTE(83) * p, t, 0.06, d, { gain: 0.12 }); e._osc('square', NOTE(88) * p, t + 0.06, 0.18, d, { gain: 0.12 }); },
  powerup: (e, t, d, p) => { for (let i = 0; i < 8; i++) e._osc('triangle', NOTE(60 + i * 3) * p, t + i * 0.04, 0.1, d, { gain: 0.14 }); },
  levelUp: (e, t, d, p) => { [0, 4, 7, 12, 16].forEach((n, i) => { e._osc('triangle', NOTE(67 + n) * p, t + i * 0.09, 0.3, d, { gain: 0.16 }); e._osc('sine', NOTE(55 + n) * p, t + i * 0.09, 0.3, d, { gain: 0.1 }); }); },
  questComplete: (e, t, d, p) => { [[0, 4, 7], [5, 9, 12], [7, 11, 14], [12, 16, 19]].forEach((ch, i) => ch.forEach((n) => e._osc('triangle', NOTE(60 + n) * p, t + i * 0.16, 0.5, d, { gain: 0.09 }))); },
  questStart: (e, t, d, p) => { [0, 7, 12].forEach((n, i) => e._osc('sine', NOTE(64 + n) * p, t + i * 0.1, 0.35, d, { gain: 0.14 })); },
  uiClick: (e, t, d, p) => e._osc('square', 1200 * p, t, 0.03, d, { gain: 0.06 }),
  uiHover: (e, t, d, p) => e._osc('sine', 900 * p, t, 0.03, d, { gain: 0.04 }),
  uiBack: (e, t, d, p) => e._osc('square', 600 * p, t, 0.05, d, { gain: 0.06, slide: 400 }),
  explosion: (e, t, d, p) => { e._osc('sine', 80 * p, t, 0.8, d, { gain: 1, slide: 25 }); e._noiseBurst(t, 1.2, d, { gain: 0.9, type: 'lowpass', freq: 2500, slide: 120 }); },
  crash: (e, t, d, p) => { e._noiseBurst(t, 0.5, d, { gain: 0.8, type: 'lowpass', freq: 1800 * p, slide: 200 }); for (const h of [1, 2.3, 3.9]) e._osc('sine', 340 * h * p, t, 0.3, d, { gain: 0.1 }); },
  screech: (e, t, d, p) => { e._noiseBurst(t, 0.4, d, { gain: 0.25, freq: 2600 * p, q: 6 }); e._osc('sawtooth', 1300 * p, t, 0.35, d, { gain: 0.04 }); },
  horn: (e, t, d, p) => { e._osc('sawtooth', 415 * p, t, 0.45, d, { gain: 0.15 }); e._osc('sawtooth', 523 * p, t, 0.45, d, { gain: 0.12 }); },
  checkpoint: (e, t, d, p) => { e._osc('triangle', NOTE(79) * p, t, 0.1, d, { gain: 0.2 }); e._osc('triangle', NOTE(86) * p, t + 0.08, 0.3, d, { gain: 0.2 }); },
  countdown: (e, t, d, p) => e._osc('square', 440 * p, t, 0.15, d, { gain: 0.15 }),
  go: (e, t, d, p) => e._osc('square', 880 * p, t, 0.4, d, { gain: 0.18 }),
  magic: (e, t, d, p) => { for (let i = 0; i < 6; i++) e._osc('sine', NOTE(84 + i * 2) * p, t + i * 0.03, 0.4, d, { gain: 0.06 }); e._noiseBurst(t, 0.5, d, { gain: 0.15, type: 'highpass', freq: 5000 }); },
  shoot: (e, t, d, p) => { e._noiseBurst(t, 0.12, d, { gain: 0.6, type: 'lowpass', freq: 3000 * p, slide: 300 }); e._osc('square', 180 * p, t, 0.08, d, { gain: 0.2, slide: 60 }); },
  door: (e, t, d, p) => { e._noiseBurst(t, 0.3, d, { gain: 0.2, freq: 400 * p, q: 3 }); e._osc('sine', 90 * p, t + 0.25, 0.15, d, { gain: 0.3 }); },
  chest: (e, t, d, p) => { e._noiseBurst(t, 0.25, d, { gain: 0.2, freq: 600 * p, q: 4 }); [0, 4, 7, 11, 14].forEach((n, i) => e._osc('triangle', NOTE(72 + n) * p, t + 0.2 + i * 0.07, 0.4, d, { gain: 0.1 })); },
  splash: (e, t, d, p) => e._noiseBurst(t, 0.5, d, { gain: 0.4, type: 'lowpass', freq: 1200 * p, slide: 300 }),
  bird: (e, t, d, p) => { const f = 2400 + Math.random() * 1500; for (let i = 0; i < 3; i++) e._osc('sine', f * p, t + i * 0.09, 0.06, d, { gain: 0.08, slide: f * 1.3 }); },
  alarm: (e, t, d, p) => { for (let i = 0; i < 4; i++) e._osc('square', (i % 2 ? 660 : 880) * p, t + i * 0.18, 0.16, d, { gain: 0.1 }); },
  whoosh: (e, t, d, p) => e._noiseBurst(t, 0.45, d, { gain: 0.3, freq: 400 * p, slide: 1800 * p, q: 0.8, a: 0.15 }),
  thwip: (e, t, d, p) => { e._noiseBurst(t, 0.08, d, { gain: 0.3, type: 'highpass', freq: 3000 * p }); e._osc('sine', 1400 * p, t, 0.08, d, { gain: 0.08, slide: 600 }); },
};
export const SFX_NAMES = Object.keys(SFX);
/** Register a custom SFX recipe (e, t, dest, pitch) => void; then audio.play(name) works everywhere. */
export function defineSfx(name, recipe) { SFX[name] = recipe; if (!SFX_NAMES.includes(name)) SFX_NAMES.push(name); return recipe; }

/**
 * Render a recipe offline (browser only): returns a Promise<AudioBuffer>. Used by `gameforge sound`.
 * The recipe receives an engine-like object with ctx, noiseBuf and the helpers (_osc, _noiseBurst,
 * _fm, _pluck, _env, _noise, _impulse) — any raw WebAudio node from e.ctx is allowed too.
 */
export async function renderSfxOffline(recipe, { duration = 1.5, pitch = 1, sampleRate = 44100, reverb = 0 } = {}) {
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const ctx = new OAC(2, Math.ceil(duration * sampleRate), sampleRate);
  const e = Object.create(AudioEngine.prototype); e.ctx = ctx; e.noiseBuf = e._noise(2);
  const out = ctx.createGain(); out.connect(ctx.destination);
  if (reverb > 0) { const r = ctx.createConvolver(); r.buffer = e._impulse(2.2, 2.5); const s = ctx.createGain(); s.gain.value = reverb; out.connect(s).connect(r).connect(ctx.destination); }
  recipe(e, 0.01, out, pitch);
  return ctx.startRendering();
}

// Adaptive music: chord progression, bass, pad, arpeggio/lead and drum patterns
// scheduled with a lookahead timer. intensity (0..1) adds/removes layers.
export class MusicSequencer {
  constructor(audio, mood, { intensity = 0.5, seed = 1 } = {}) {
    this.audio = audio; this.mood = mood; this.cfg = MOODS[mood] || MOODS.exploration; this.intensity = intensity;
    this.step = 0; this.timer = null; this.seed = seed; this.nextTime = 0;
  }
  rand() { this.seed = (this.seed * 16807) % 2147483647; return this.seed / 2147483647; }
  start() {
    const a = this.audio, c = a.ctx; if (!c) return;
    this.out = c.createGain(); this.out.gain.value = 0; this.out.connect(a.buses.music);
    this.out.gain.setTargetAtTime(1, c.currentTime, 0.8);
    const rv = c.createGain(); rv.gain.value = 0.35; this.out.connect(rv).connect(a.reverbSend);
    this.nextTime = c.currentTime + 0.1;
    this.timer = setInterval(() => this._schedule(), 60);
  }
  stop() { if (!this.timer) return; clearInterval(this.timer); this.timer = null; const c = this.audio.ctx; this.out.gain.setTargetAtTime(0, c.currentTime, 0.5); const o = this.out; setTimeout(() => o.disconnect(), 3000); }
  _schedule() {
    const c = this.audio.ctx, spb = 60 / this.cfg.bpm / 4; // 16th notes
    while (this.nextTime < c.currentTime + 0.25) { this._play16(this.step, this.nextTime); this.nextTime += spb * (this.step % 2 ? 1 - this.cfg.swing : 1 + this.cfg.swing); this.step++; }
  }
  _deg(deg, oct = 0) { const sc = SCALES[this.cfg.scale]; const n = sc.length; const o = Math.floor(deg / n); return this.cfg.root + sc[((deg % n) + n) % n] + 12 * (o + oct); }
  _play16(s, t) {
    const a = this.audio, o = this.out, cfg = this.cfg, I = this.intensity;
    const bar = Math.floor(s / 16), beat = s % 16, chordDeg = cfg.prog[bar % cfg.prog.length];
    const chord = [chordDeg, chordDeg + 2, chordDeg + 4].map((d) => this._deg(d, 1));
    // pad on bar start
    if (beat === 0) {
      const dur = (60 / cfg.bpm) * 4;
      for (const n of chord) {
        const type = cfg.pad === 'synth' ? 'sawtooth' : cfg.pad === 'brass' ? 'sawtooth' : 'triangle';
        const osc = a.ctx.createOscillator(), g = a.ctx.createGain(), f = a.ctx.createBiquadFilter();
        osc.type = type; osc.frequency.value = NOTE(n); osc.detune.value = (this.rand() - 0.5) * 12;
        f.type = 'lowpass'; f.frequency.value = cfg.pad === 'dark' ? 700 : 1400 + I * 1200;
        g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.045, t + dur * 0.3); g.gain.linearRampToValueAtTime(0.0001, t + dur);
        osc.connect(f).connect(g).connect(o); osc.start(t); osc.stop(t + dur + 0.05);
      }
    }
    // bass
    if ((cfg.drums === 'four' || cfg.drums === 'driving') ? beat % 2 === 0 : beat % 8 === 0) a._osc(cfg.drums === 'driving' ? 'sawtooth' : 'triangle', NOTE(this._deg(chordDeg, -1)), t, 0.18, o, { gain: 0.16 });
    // arpeggio / lead
    if (I > 0.25 && beat % (I > 0.7 ? 2 : 4) === 0) { const n = chord[(s / 2) % 3 | 0] + (this.rand() < 0.3 ? 12 : 0); a._osc('triangle', NOTE(n), t, 0.14, o, { gain: 0.05 * cfg.lead + 0.02 }); }
    if (I > 0.6 && beat % 8 === 4 && this.rand() < cfg.lead) a._osc('square', NOTE(this._deg(chordDeg + Math.floor(this.rand() * 5), 2)), t, 0.35, o, { gain: 0.025 });
    // drums
    const d = cfg.drums; if (d === 'none' || I < 0.15) return;
    const kick = d === 'four' ? beat % 4 === 0 : d === 'driving' ? beat % 4 === 0 || beat === 10 : d === 'march' ? beat % 4 === 0 : d === 'pulse' ? beat % 8 === 0 : beat === 0 || beat === 10;
    if (kick) a._osc('sine', 120, t, 0.18, o, { gain: 0.5, slide: 40 });
    if ((beat === 4 || beat === 12) && d !== 'pulse') a._noiseBurst(t, 0.12, o, { gain: d === 'soft' ? 0.08 : 0.18, freq: 1800, q: 0.7 });
    if (I > 0.45 && beat % 2 === 0) a._noiseBurst(t, 0.03, o, { gain: 0.05, type: 'highpass', freq: 7000 });
    if (d === 'march' && beat % 2 === 1 && I > 0.5) a._noiseBurst(t, 0.05, o, { gain: 0.06, freq: 2000, q: 2 });
  }
}
