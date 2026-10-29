// Weather system: states (clear, cloudy, rain, storm, snow, fog) blended smoothly; drives the
// Atmosphere (cloud dome, fog, sun/hemi/IBL intensity, exposure), a wind vector (foliage shader
// uniform + bound Cloth sims), GPU precipitation around the camera (instanced streaks / flakes,
// budgeted per quality tier, zero CPU per drop), optional ground splashes, lightning flashes with
// distance-delayed synthesized thunder, wet-surface and snow-cover looks (terrain via shared
// uniforms, any MeshStandardMaterial via registerWet), a seeded forecast and gameplay events.
//
// Runs headless (Node unit tests) when no scene is passed: parameters, transitions, forecast,
// wind, wetness, temperature, lightning scheduling and events all work without rendering.
// See skills/gameforge/references/weather.md.
import * as THREE from '../vendor/three/three.module.js';
import { RNG, Noise, hashString } from '../core/rng.js';
import { EventBus } from '../core/events.js';
import { SHARED_UNIFORMS } from './materials.js';
import { defineSfx } from '../audio/audio.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);
const r3 = (v) => Math.round(v * 1000) / 1000;

// Parameters per state. cloud 0..1 coverage, fog = fog density multiplier, sun = direct light
// factor, rain/snow 0..1 precipitation, wind m/s, gust 0..1, lightning strikes/s, temp °C offset,
// exposure multiplier, dark = cloud darkness 0..1.
export const WEATHER_STATES = {
  clear: { cloud: 0.12, fog: 1, sun: 1, rain: 0, snow: 0, wind: 2.5, gust: 0.25, lightning: 0, temp: 0, exposure: 1, dark: 0 },
  cloudy: { cloud: 0.62, fog: 1.5, sun: 0.5, rain: 0, snow: 0, wind: 4.5, gust: 0.35, lightning: 0, temp: -2, exposure: 0.95, dark: 0.25 },
  rain: { cloud: 0.9, fog: 2.6, sun: 0.22, rain: 0.65, snow: 0, wind: 6, gust: 0.4, lightning: 0, temp: -4, exposure: 0.88, dark: 0.55 },
  storm: { cloud: 1, fog: 3.4, sun: 0.1, rain: 1, snow: 0, wind: 13, gust: 0.6, lightning: 0.2, temp: -6, exposure: 0.8, dark: 0.85 },
  snow: { cloud: 0.85, fog: 3, sun: 0.35, rain: 0, snow: 0.85, wind: 3.5, gust: 0.3, lightning: 0, temp: -14, exposure: 0.95, dark: 0.3 },
  fog: { cloud: 0.5, fog: 7, sun: 0.4, rain: 0, snow: 0, wind: 1, gust: 0.1, lightning: 0, temp: -2, exposure: 0.95, dark: 0.15 },
};
const KEYS = Object.keys(WEATHER_STATES.clear);

// Markov forecast weights: from -> { to: weight }. Override with opts.transitions.
export const WEATHER_TRANSITIONS = {
  clear: { clear: 2, cloudy: 4, fog: 1 },
  cloudy: { clear: 3, cloudy: 1, rain: 3, snow: 0.5, fog: 0.5 },
  rain: { cloudy: 3, rain: 1, storm: 2 },
  storm: { rain: 3, cloudy: 1 },
  snow: { cloudy: 2, snow: 1, clear: 1 },
  fog: { clear: 2, cloudy: 2 },
};

// Synthesized thunder: a near crack (filtered noise) then a long low rumble with a sub tone.
defineSfx('thunder', (e, t, d, p) => {
  e._noiseBurst(t, 0.18 * p, d, { gain: 0.55 * p, type: 'highpass', freq: 1400, a: 0.002 });
  e._noiseBurst(t + 0.04, 3.6, d, { gain: 1, type: 'lowpass', freq: 520 * p, slide: 70, a: 0.12 });
  e._noiseBurst(t + 0.5, 2.8, d, { gain: 0.6, type: 'lowpass', freq: 260, slide: 50, a: 0.4 });
  e._osc('sine', 48, t + 0.05, 2.6, d, { gain: 0.35, slide: 26, a: 0.15 });
});

// ---------------------------------------------------------------------------------------------
// GPU precipitation: N instanced quads whose positions are computed in the vertex shader from a
// per-drop seed + time, wrapped in a world-anchored box around the camera (drops do not swim when
// the camera moves). Rain = velocity-aligned streaks; snow = round flakes with wobble.
// ---------------------------------------------------------------------------------------------
export class Precipitation {
  constructor({ kind = 'rain', count = 6000, radius = 22, height = 18, seed = 7 } = {}) {
    this.kind = kind; this.count = count; this.radius = radius; this.height = height;
    const rain = kind === 'rain';
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, -0.5, 1, 0, 0.5, 1, 0], 3));
    g.setIndex([0, 1, 2, 2, 1, 3]);
    const rng = new RNG(seed), s = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) s.set([rng.next(), rng.next(), rng.next(), rng.next()], i * 4);
    g.setAttribute('seed', new THREE.InstancedBufferAttribute(s, 4));
    g.instanceCount = 0;
    this.uniforms = {
      uTime: { value: 0 }, uRadius: { value: radius }, uHeight: { value: height }, uFall: { value: rain ? 9.5 : 1.1 },
      uWind: { value: new THREE.Vector3() }, uLen: { value: rain ? 0.75 : 0.09 }, uWidth: { value: rain ? 0.018 : 0.09 },
      uColor: { value: new THREE.Color(rain ? 0xc4d0dc : 0xf4f7ff) }, uOpacity: { value: rain ? 0.5 : 0.9 }, uLight: { value: 1 },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms, transparent: true, depthWrite: false, fog: false,
      vertexShader: `attribute vec4 seed; uniform float uTime, uRadius, uHeight, uFall, uLen, uWidth; uniform vec3 uWind;
        varying vec2 vUv; varying float vFade;
        void main(){
          vec3 box = vec3(2.0 * uRadius, uHeight, 2.0 * uRadius);
          float fall = uFall * (0.85 + 0.3 * seed.w);
          vec3 vel = vec3(uWind.x, -fall, uWind.z);
          vec3 p = seed.xyz * box + vel * uTime;
          ${rain ? '' : 'p.x += sin(uTime * 1.3 + seed.w * 40.0) * 0.35; p.z += cos(uTime * 1.1 + seed.w * 23.0) * 0.35;'}
          vec3 lo = cameraPosition - vec3(uRadius, uHeight * 0.45, uRadius);
          p = lo + mod(p - lo, box);
          vec3 toCam = normalize(cameraPosition - p);
          vec3 axis = ${rain ? 'normalize(vel)' : 'normalize(vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]))'};
          vec3 side = normalize(cross(axis, toCam));
          float len = ${rain ? 'uLen * (0.7 + 0.6 * seed.w)' : 'uWidth * (0.6 + 0.8 * seed.w)'};
          float wid = ${rain ? 'uWidth' : 'uWidth * (0.6 + 0.8 * seed.w)'};
          vec3 wp = p + side * position.x * wid + axis * (position.y - 0.5) * len;
          float d = length(p - cameraPosition);
          vFade = smoothstep(uRadius, uRadius * 0.55, d) * smoothstep(0.25, 1.2, d);
          vUv = vec2(position.x + 0.5, position.y);
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        }`,
      fragmentShader: `uniform vec3 uColor; uniform float uOpacity, uLight; varying vec2 vUv; varying float vFade;
        void main(){
          ${rain
            ? 'float a = (1.0 - abs(vUv.x * 2.0 - 1.0)) * smoothstep(0.0, 0.35, vUv.y) * (0.55 + 0.45 * vUv.y);'
            : 'vec2 q = vUv - vec2(0.5); q.y = (vUv.y - 0.5); float a = smoothstep(0.5, 0.15, length(q));'}
          gl_FragColor = vec4(uColor * uLight, a * uOpacity * vFade);
        }`,
    });
    this.mesh = new THREE.Mesh(g, this.material); this.mesh.frustumCulled = false; this.mesh.renderOrder = 6; this.mesh.visible = false;
    this.mesh.name = 'precipitation:' + kind;
  }
  set(intensity, { time, wind, light = 1 }) {
    const n = Math.floor(this.count * clamp(intensity, 0, 1));
    this.mesh.geometry.instanceCount = n; this.mesh.visible = n > 0;
    this.uniforms.uTime.value = time; this.uniforms.uWind.value.copy(wind).multiplyScalar(this.kind === 'rain' ? 0.6 : 0.5);
    this.uniforms.uLight.value = light;
  }
  get visible() { return this.mesh.visible ? this.mesh.geometry.instanceCount : 0; }
}

// Procedural cloud dome (fbm in the fragment shader) that follows the camera; coverage, darkness
// and drift come from the weather; the horizon blends into the scene fog colour.
function cloudDome() {
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide, transparent: true, depthWrite: false, fog: false,
    uniforms: { uCover: { value: 0 }, uDark: { value: 0 }, uLit: { value: new THREE.Color(1, 1, 1) }, uShade: { value: new THREE.Color(0.5, 0.5, 0.55) }, uHorizon: { value: new THREE.Color() }, uDrift: { value: new THREE.Vector2() }, uFlash: { value: 0 } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p; }',
    fragmentShader: `uniform float uCover, uDark, uFlash; uniform vec3 uLit, uShade, uHorizon; uniform vec2 uDrift; varying vec3 vDir;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
      float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ s += a * n(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return s; }
      void main(){
        vec3 d = normalize(vDir);
        if (d.y < -0.02) discard;
        vec2 p = d.xz / (d.y + 0.15) * 1.6 + uDrift;
        float f = fbm(p), f2 = fbm(p * 2.7 + 4.0);
        float c = smoothstep(1.05 - uCover * 1.1, 1.3 - uCover * 1.1, f + f2 * 0.25);
        float a = clamp(c + uCover * uCover * 0.55, 0.0, 1.0);
        vec3 col = mix(uLit, uShade, clamp(f2 * 0.8 + uDark * 0.7, 0.0, 1.0));
        col += vec3(0.75, 0.8, 1.0) * uFlash * (0.5 + f);
        float hz = 1.0 - smoothstep(0.0, 0.32, d.y);
        col = mix(col, uHorizon, hz * 0.85);
        gl_FragColor = vec4(col, a * smoothstep(-0.02, 0.06, d.y));
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1200, 32, 16), m);
  mesh.renderOrder = -5; mesh.frustumCulled = false; mesh.name = 'cloud-dome';
  return mesh;
}

// ---------------------------------------------------------------------------------------------
export class Weather {
  // opts: { app } or { scene, camera, atmosphere, renderer, audio, events, vfx }, seed, state, auto,
  // durations [min,max] s, transition s, transitions (Markov weights), climate { mean, amplitude, peakHour },
  // particles { rain, snow, radius, height } counts (default by quality tier), ground (Heightfield or fn) for
  // splashes, splashes (bool), fogScale, windScale (m/s -> foliage uniform), hour () => h (when no atmosphere).
  constructor(opts = {}) {
    const app = opts.app;
    this.scene = opts.scene ?? app?.scene ?? null; this.camera = opts.camera ?? app?.camera ?? null;
    this.atmosphere = opts.atmosphere ?? app?.atmosphere ?? null; this.renderer = opts.renderer ?? app?.renderer ?? null;
    this.audio = opts.audio ?? app?.audio ?? null; this.vfx = opts.vfx ?? app?.vfx ?? null;
    this.events = opts.events ?? app?.events ?? new EventBus();
    this.seed = opts.seed ?? 1; this.rng = new RNG(hashString('weather:' + this.seed)); this.noise = new Noise(this.seed + 17);
    this.states = { ...WEATHER_STATES, ...(opts.states || {}) }; this.transitions = { ...WEATHER_TRANSITIONS, ...(opts.transitions || {}) };
    this.durations = opts.durations ?? [150, 360]; this.defaultTransition = opts.transition ?? 20;
    this.climate = { mean: 14, amplitude: 6, peakHour: 15, ...(opts.climate || {}) };
    this.fogScale = opts.fogScale ?? 1; this.windScale = opts.windScale ?? 0.11; this.hourFn = opts.hour ?? null;
    this.auto = !!opts.auto; this.clock = 0; this.cursor = 0; this.entryEnd = 0;
    const start = opts.state ?? 'clear';
    this.name = start; this.prev = start; this.params = { ...this.states[start] }; this.from = { ...this.params }; this.to = { ...this.params };
    this.blend = 1; this.transitionTime = 0;
    this.wind = new THREE.Vector3(); this.windDir = this.rng.range(0, Math.PI * 2);
    this.wetness = 0; this.snowCover = 0; this.flash = 0; this.flashAge = 99; this.lastStrike = null;
    this.stats = { strikes: 0, thunders: 0, changes: 0 };
    this._pending = []; this._wet = []; this._wetSet = new Set(); this._cloths = new Set();
    this.sheltering = false;
    this._schedule = [];
    this.nextStrike = Infinity;
    if (this.auto) this._startEntry(0);
    // visuals
    this.ground = opts.ground ? (typeof opts.ground === 'function' ? opts.ground : (x, z) => opts.ground.heightAt(x, z)) : null;
    this.splashes = opts.splashes ?? !!this.ground;
    if (this.scene) {
      const tier = opts.quality ?? app?.gfx?.tier?.name ?? 'medium';
      const budget = { low: [3500, 2500], medium: [8000, 5000], high: [14000, 8000] }[tier] || [8000, 5000];
      const P = opts.particles || {};
      this.rain = new Precipitation({ kind: 'rain', count: P.rain ?? budget[0], radius: P.radius ?? 18, height: P.height ?? 14, seed: this.seed + 1 });
      this.snow = new Precipitation({ kind: 'snow', count: P.snow ?? budget[1], radius: (P.radius ?? 18) * 0.9, height: (P.height ?? 14) * 0.85, seed: this.seed + 2 });
      this.dome = cloudDome();
      this.scene.add(this.rain.mesh, this.snow.mesh, this.dome);
      this.boltMat = new THREE.MeshBasicMaterial({ color: 0xeef2ff, transparent: true, opacity: 1, fog: false, depthWrite: false });
      this.baseFog = this.scene.fog?.density ?? 0.0012;
    }
    this._bases = {}; this._written = {};
    this._apply(0);
  }
  on(t, fn) { return this.events.on(t, fn); }
  get state() { return this.name; }
  get hour() { return this.atmosphere ? this.atmosphere.timeOfDay : this.hourFn ? this.hourFn() : 12; }
  // Ambient air temperature (°C) at an hour: climate day curve + current weather offset.
  temperatureAt(hour = this.hour) { const c = this.climate; return c.mean + c.amplitude * Math.cos(((hour - c.peakHour) / 24) * Math.PI * 2) + this.params.temp; }
  get temperature() { return this.temperatureAt(); }
  get windSpeed() { return this.wind.length(); }
  get rainIntensity() { return this.params.rain; }
  get snowIntensity() { return this.params.snow; }
  // Gameplay: should AI / players seek shelter right now?
  get shouldShelter() { return this.params.rain > 0.45 || this.params.lightning > 0.02 || this.params.snow > 0.6; }
  // Change weather. transition seconds (0 = instant). manual set() pauses the auto forecast unless keepAuto.
  set(name, { transition = this.defaultTransition, keepAuto = false } = {}) {
    if (!this.states[name]) throw new Error('unknown weather state ' + name);
    if (!keepAuto) this.auto = false;
    const prev = this.name; this.prev = prev; this.name = name;
    this.from = { ...this.params }; this.to = { ...this.states[name] }; this.transitionTime = transition; this.blend = transition > 0 ? 0 : 1;
    if (this.blend >= 1) this.params = { ...this.to };
    this.stats.changes++;
    this.events.emit('weather:change', { from: prev, to: name, transition });
    return this;
  }
  // Deterministic seeded forecast: the n entries starting at the current one, [{ state, start, duration, transition }].
  forecast(n = 5, from = this.auto ? this.cursor : 0) { const out = []; for (let i = from; i < from + n; i++) out.push({ ...this._entry(i) }); return out; }
  _entry(i) {
    while (this._schedule.length <= i) {
      const k = this._schedule.length, r = new RNG(hashString(`forecast:${this.seed}:${k}`));
      const prev = k ? this._schedule[k - 1] : null;
      const state = !prev ? this.name : r.weighted(Object.entries(this.transitions[prev.state] || { clear: 1 }));
      const duration = Math.round(r.range(this.durations[0], this.durations[1]));
      const start = prev ? prev.start + prev.duration : 0;
      this._schedule.push({ state, start, duration, transition: Math.round(Math.min(duration * 0.3, this.defaultTransition * r.range(0.7, 1.4))) });
    }
    return this._schedule[i];
  }
  startForecast() { this.auto = true; this._schedule = []; this.clock = 0; this._startEntry(0); return this; }
  _startEntry(i) { this.cursor = i; const e = this._entry(i); this.entryEnd = e.start + e.duration; if (e.state !== this.name || i === 0) this.set(e.state, { transition: i === 0 ? 0 : e.transition, keepAuto: true }); }
  // Register a material for the wet / snow look (darker albedo, lower roughness, white tint under snow).
  registerWet(mat, { darken = 0.35, roughness = 0.3, snow = 0.3 } = {}) {
    if (!mat || this._wetSet.has(mat) || !mat.color) return; this._wetSet.add(mat);
    this._wet.push({ mat, color: mat.color.clone(), rough: mat.roughness ?? 1, darken, wetRough: roughness, snow }); this._wetKey = -1;
  }
  // Register every opaque MeshStandardMaterial under root (filter(mesh, mat) can veto).
  registerScene(root, { filter = null, ...o } = {}) {
    root.traverse((m) => { if (!m.isMesh) return; for (const mat of [].concat(m.material)) if (mat?.isMeshStandardMaterial && !mat.transparent && !(mat.emissiveIntensity > 0.5 && mat.emissive?.getHex()) && (!filter || filter(m, mat))) this.registerWet(mat, o); });
    return this._wet.length;
  }
  bindCloth(cloth) { this._cloths.add(cloth); return () => this._cloths.delete(cloth); }
  // Force a lightning strike now (also used by the scheduler). distance in metres.
  strike({ distance, angle } = {}) {
    const d = distance ?? this.rng.range(120, 900), a = angle ?? this.rng.range(0, Math.PI * 2);
    const c = this.camera?.position ?? new THREE.Vector3();
    const pos = new THREE.Vector3(c.x + Math.sin(a) * d, 0, c.z + Math.cos(a) * d);
    this.flash = clamp(1.25 - d / 1200, 0.35, 1); this.flashAge = 0; this.stats.strikes++;
    const delay = d / 343;
    this.lastStrike = { position: pos, distance: d, delay, time: this.clock };
    this._pending.push({ t: this.clock + delay, distance: d, position: pos });
    if (this.scene) this._bolt(pos, d);
    this.events.emit('weather:lightning', { position: pos, distance: d, delay });
    return this.lastStrike;
  }
  _scheduleStrike(rate, minGap = 0) { this.nextStrike = rate > 0 ? this.clock + minGap - Math.log(1 - this.rng.next()) / rate : Infinity; }
  _bolt(pos, d) {
    if (this.bolt) this._dropBolt();
    const top = 260 + this.rng.range(0, 120), pts = [], segs = 14; let x = 0, z = 0;
    for (let i = 0; i <= segs; i++) { const y = top * (1 - i / segs); pts.push(new THREE.Vector3(pos.x + x, Math.max(0, y), pos.z + z)); x += this.rng.range(-14, 14); z += this.rng.range(-14, 14); }
    const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.1), r = clamp(d / 140, 1, 5);
    this.bolt = new THREE.Mesh(new THREE.TubeGeometry(curve, 48, r, 5, false), this.boltMat); this.bolt.frustumCulled = false; this.bolt.renderOrder = 4;
    if (!this.glowMat) this.glowMat = new THREE.MeshBasicMaterial({ color: 0x9fb4ff, transparent: true, opacity: 0.35, fog: false, depthWrite: false, blending: THREE.AdditiveBlending });
    const glow = new THREE.Mesh(new THREE.TubeGeometry(curve, 48, r * 4, 6, false), this.glowMat); glow.frustumCulled = false; this.bolt.add(glow);
    this.scene.add(this.bolt);
  }
  _dropBolt() { this.scene.remove(this.bolt); this.bolt.traverse((m) => m.geometry?.dispose()); this.bolt = null; }
  // Advance: transitions, forecast, wind, wetness/snow, lightning + thunder, visuals.
  update(dt) {
    this.clock += dt;
    if (this.auto && this.clock >= this.entryEnd) this._startEntry(this.cursor + 1);
    if (this.blend < 1) {
      this.blend = Math.min(1, this.blend + dt / Math.max(1e-3, this.transitionTime));
      const k = smooth(this.blend); for (const key of KEYS) this.params[key] = lerp(this.from[key], this.to[key], k);
    }
    const P = this.params;
    // wind: slowly veering direction + gusts (coherent noise, deterministic)
    this.windDir += this.noise.noise2(this.clock * 0.01, 3.3) * dt * 0.08;
    const gust = 1 + P.gust * (this.noise.noise2(this.clock * 0.35, 7.1) * 0.8 + this.noise.noise2(this.clock * 1.3, 1.9) * 0.4);
    const spd = Math.max(0, P.wind * gust);
    this.wind.set(Math.sin(this.windDir) * spd, 0, Math.cos(this.windDir) * spd);
    SHARED_UNIFORMS.uWind.value.set(this.wind.x * this.windScale, this.wind.z * this.windScale);
    for (const c of this._cloths) { c.wind.copy(this.wind); c.gust = P.gust; }
    // surfaces: rain soaks in ~15 s, drying takes ~2 min (faster in sun / wind); snow builds over ~1.5 min
    const temp = this.temperature;
    if (P.rain > 0.02) this.wetness = Math.min(1, this.wetness + P.rain * dt / 15);
    else this.wetness = Math.max(0, this.wetness - dt * (0.006 + 0.01 * P.sun + 0.0006 * spd));
    if (P.snow > 0.02 && temp < 2) this.snowCover = Math.min(1, this.snowCover + P.snow * dt / 60);
    else if (temp > 1) this.snowCover = Math.max(0, this.snowCover - dt * 0.004 * (temp - 0.5) * (1 + P.rain * 3));
    SHARED_UNIFORMS.uWet.value = this.wetness; SHARED_UNIFORMS.uSnowCover.value = this.snowCover;
    // lightning
    // Poisson process at the target rate, thinned by the current (blending) rate.
    const rate = Math.max(P.lightning, this.to.lightning);
    if (rate > 0.005) { if (!isFinite(this.nextStrike)) this._scheduleStrike(rate, 1.5); if (this.clock >= this.nextStrike) { if (this.rng.next() < P.lightning / rate) this.strike(); this._scheduleStrike(rate, 1.5); } }
    else this.nextStrike = Infinity;
    for (let i = this._pending.length - 1; i >= 0; i--) {
      const t = this._pending[i]; if (this.clock < t.t) continue; this._pending.splice(i, 1); this.stats.thunders++;
      this.audio?.play?.('thunder', { volume: clamp(1.3 - t.distance / 1100, 0.15, 1.2), pitch: t.distance < 300 ? 1 : 0.8, reverb: 0.35, bus: 'ambience' });
      this.events.emit('weather:thunder', { distance: t.distance, position: t.position });
    }
    this.flashAge += dt;
    const fa = this.flashAge; this.flash = fa > 1.2 ? 0 : this.flash; this._flashNow = this.flash * (Math.exp(-fa * 14) + (fa > 0.11 ? 0.7 * Math.exp(-(fa - 0.11) * 10) : 0) + (fa > 0.32 ? 0.35 * Math.exp(-(fa - 0.32) * 9) : 0));
    if (this.bolt) { this.bolt.visible = fa < 0.42 && (fa < 0.08 || fa > 0.11); this.boltMat.opacity = clamp(1 - fa / 0.42, 0, 1); if (this.glowMat) this.glowMat.opacity = 0.35 * this.boltMat.opacity; if (fa > 0.5) this._dropBolt(); }
    // shelter event for gameplay / AI
    const need = this.shouldShelter; if (need !== this.sheltering) { this.sheltering = need; this.events.emit('weather:shelter', { needed: need, state: this.name }); }
    this._apply(dt);
  }
  // Base value tracking: the Atmosphere rewrites sun/hemi/fog colour/exposure every frame; if it did not
  // (paused), reuse the last base instead of compounding our multipliers.
  _base(key, cur) { if (this._written[key] !== undefined && this._written[key] === cur) return this._bases[key]; this._bases[key] = cur; return cur; }
  _apply(dt) {
    const P = this.params, A = this.atmosphere, f = this._flashNow || 0;
    if (this.scene) {
      const daylight = A ? A.daylight : 1;
      const fog = this.scene.fog;
      const grey = new THREE.Color().setRGB(0.55, 0.58, 0.62).multiplyScalar(0.12 + 0.88 * daylight).multiplyScalar(1 - P.dark * 0.45);
      if (fog) {
        const fk = this._base('fogColor', fog.color.getHex());
        fog.color.setHex(fk).lerp(grey, clamp(P.cloud * 0.85 + (P.fog - 1) * 0.06, 0, 0.92));
        if (P.snow > 0.05) fog.color.lerp(new THREE.Color(0.78, 0.8, 0.84).multiplyScalar(0.15 + 0.85 * daylight), P.snow * 0.4);
        this._written.fogColor = fog.color.getHex();
        if (fog.density !== undefined) fog.density = this.baseFog * P.fog * this.fogScale;
      }
      if (A) {
        const sun = this._base('sun', A.sun.intensity); A.sun.intensity = sun * lerp(1, P.sun, 1) ; this._written.sun = A.sun.intensity;
        const hemi = this._base('hemi', A.hemi.intensity); A.hemi.intensity = hemi * (1 + P.cloud * 0.5) + f * 2.4; this._written.hemi = A.hemi.intensity;
        const env = this._base('env', this.scene.environmentIntensity ?? 1); this.scene.environmentIntensity = env * (1 - P.cloud * 0.35) + f * 0.6; this._written.env = this.scene.environmentIntensity;
        const sky = A.sky?.material?.uniforms; if (sky) { sky.turbidity.value = lerp(A.opts.turbidity, 14, P.cloud); sky.rayleigh.value = lerp(A.opts.rayleigh, 0.6, P.cloud); }
        if (A.stars) A.stars.material.opacity *= 1 - P.cloud * 0.9;
      }
      if (this.renderer) { const ex = this._base('exposure', this.renderer.toneMappingExposure); this.renderer.toneMappingExposure = ex * P.exposure * (1 + f * 0.9); this._written.exposure = this.renderer.toneMappingExposure; }
      // cloud dome
      const u = this.dome.material.uniforms, cam = this.camera?.position;
      if (cam) this.dome.position.copy(cam);
      u.uCover.value = P.cloud; u.uDark.value = P.dark; u.uFlash.value = f;
      const lit = (A ? A.sun.color.clone() : new THREE.Color(1, 1, 1)).lerp(new THREE.Color(1, 1, 1), 0.5).multiplyScalar((0.06 + 0.94 * daylight) * (1 - P.dark * 0.55));
      u.uLit.value.copy(lit); u.uShade.value.copy(lit).multiplyScalar(0.55 - P.dark * 0.15); u.uHorizon.value.copy(fog ? fog.color : grey);
      u.uDrift.value.x += (this.wind.x * dt) / 900; u.uDrift.value.y += (this.wind.z * dt) / 900;
      this.dome.visible = P.cloud > 0.02;
      // precipitation (lit by daylight + lightning)
      const light = clamp(0.25 + 0.85 * daylight * (1 - P.dark * 0.4) + f * 1.5, 0.15, 2.2);
      this.rain.set(P.rain, { time: this.clock, wind: this.wind, light }); this.snow.set(P.snow, { time: this.clock, wind: this.wind, light });
      // splashes (CPU, budgeted) on the ground around the camera
      if (this.splashes && this.ground && this.vfx && cam && P.rain > 0.15 && dt > 0) {
        this._splashAcc = (this._splashAcc || 0) + dt * 60 * P.rain;
        while (this._splashAcc >= 1) { this._splashAcc--; const a = this.rng.range(0, Math.PI * 2), r = Math.sqrt(this.rng.next()) * 9 + 0.8, x = cam.x + Math.sin(a) * r, z = cam.z + Math.cos(a) * r; this.vfx.emit('splash', new THREE.Vector3(x, this.ground(x, z) + 0.03, z), { count: 3, scale: 0.18 }); }
      }
      // wet / snow materials
      const key = Math.round(this.wetness * 100) * 1000 + Math.round(this.snowCover * 100);
      if (key !== this._wetKey) { this._wetKey = key; for (const w of this._wet) { w.mat.color.copy(w.color).multiplyScalar(1 - w.darken * this.wetness); if (this.snowCover > 0) w.mat.color.lerp(new THREE.Color(0.92, 0.94, 0.98), this.snowCover * w.snow); if (w.mat.roughness !== undefined) w.mat.roughness = lerp(w.rough, Math.min(w.rough, w.wetRough), this.wetness * (1 - this.snowCover)); } }
    }
    // ambience loops (created lazily once audio is unlocked)
    if (this.audio?.ready) {
      if (!this._amb) this._amb = { rain: this.audio.ambience('rain'), wind: this.audio.ambience('wind') };
      this._amb.rain.set(P.rain * 1.4); this._amb.wind.set(clamp(this.windSpeed / 8, 0.15, 1.6));
    }
  }
  debug() {
    const P = this.params;
    return { state: this.name, from: this.prev, blend: r3(this.blend), auto: this.auto, cloud: r3(P.cloud), fog: r3(P.fog), sun: r3(P.sun), rain: r3(P.rain), snow: r3(P.snow), lightning: r3(P.lightning),
      wind: r3(this.windSpeed), windDir: r3(this.windDir), wetness: r3(this.wetness), snowCover: r3(this.snowCover), temperature: r3(this.temperature), shelter: this.shouldShelter,
      strikes: this.stats.strikes, thunders: this.stats.thunders, rainDrops: this.rain?.visible ?? 0, snowFlakes: this.snow?.visible ?? 0, wetMaterials: this._wet.length };
  }
  toJSON() { return { name: this.name, prev: this.prev, from: this.from, to: this.to, params: this.params, blend: this.blend, transitionTime: this.transitionTime, clock: this.clock, auto: this.auto, cursor: this.cursor, entryEnd: this.entryEnd, wetness: this.wetness, snowCover: this.snowCover, windDir: this.windDir, rng: this.rng.state, nextStrike: isFinite(this.nextStrike) ? this.nextStrike : null }; }
  load(d) {
    Object.assign(this, { name: d.name, prev: d.prev, from: { ...d.from }, to: { ...d.to }, params: { ...d.params }, blend: d.blend, transitionTime: d.transitionTime, clock: d.clock, auto: d.auto, cursor: d.cursor, entryEnd: d.entryEnd, wetness: d.wetness, snowCover: d.snowCover, windDir: d.windDir });
    this.rng.state = d.rng; this.nextStrike = d.nextStrike ?? Infinity; this._pending = []; this.sheltering = this.shouldShelter; this._wetKey = -1; this._apply(0);
  }
}

// Convenience: create a Weather for a GameApp and update it every step (after the Atmosphere).
export function attachWeather(app, opts = {}) {
  const w = new Weather({ app, ...opts });
  app.add((dt) => w.update(dt), { order: opts.order ?? 40, states: opts.states ?? ['playing', 'dialogue', 'cutscene'] });
  return w;
}
