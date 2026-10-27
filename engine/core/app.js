// GameApp: wires renderer, scene, camera, atmosphere, physics, input, audio, UI, VFX,
// save system and the fixed-step loop, and exposes window.__GF test hooks so automated
// playtests can drive the game deterministically.
import * as THREE from '../vendor/three/three.module.js';
import { createRenderer } from '../render/renderer.js';
import { Atmosphere } from '../render/sky.js';
import { SHARED_UNIFORMS, updateNightLights, MaterialLibrary } from '../render/materials.js';
import { GameLoop } from './loop.js';
import { Input, createTouchControls } from './input.js';
import { EventBus } from './events.js';
import { SaveSystem } from './save.js';
import { PhysicsWorld } from '../physics/world.js';
import { AudioEngine } from '../audio/audio.js';
import { UI } from '../ui/ui.js';
import { VFX } from '../render/particles.js';

export const ENGINE_VERSION = '0.1.0';

export class GameApp {
  constructor({ id = 'game', title = 'GameForge Game', container = document.body, quality, timeOfDay = 15, dayLength = 0, theme = {}, fov = 60, far = 2500, atmosphere = {}, touchButtons } = {}) {
    this.id = id; this.title = title;
    this.events = new EventBus();
    this.ui = new UI({ container, title, theme, gameId: id });
    const settings = this.ui.settings;
    this.gfx = createRenderer({ container, quality: quality ?? settings.quality ?? 'auto' });
    this.renderer = this.gfx.renderer;
    this.ui.canvas = this.renderer.domElement; this.ui.applySettings();
    MaterialLibrary.anisotropy = this.gfx.tier.maxAniso;
    if (this.gfx.tier.name === 'low') MaterialLibrary.textureSize = 128;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(fov, innerWidth / innerHeight, 0.1, far);
    this.gfx.setup(this.scene, this.camera);
    this.atmosphere = new Atmosphere(this.scene, this.renderer, { timeOfDay, dayLength, shadowSize: this.gfx.tier.shadowSize, ...atmosphere });
    // camera-relative fill light: keeps characters readable at night (fades out in daylight)
    this.fill = new THREE.DirectionalLight(0x9fb4ff, 0); this.scene.add(this.fill, this.fill.target);
    this.lightPools = [];
    this.physics = new PhysicsWorld();
    this.physics.events = this.events;
    this.input = new Input(window);
    this.input.sensitivity = settings.sensitivity; this.input.invertY = settings.invertY;
    this.audio = new AudioEngine();
    this.ui.sound = (n) => this.audio.play(n);
    this.vfx = new VFX(this.scene);
    this.save = new SaveSystem(id);
    this.loop = new GameLoop();
    this.state = 'boot';
    this.timers = [];
    this.stats = { startTime: 0 };
    this.debugState = () => ({});
    this.errors = [];
    this.touch = createTouchControls(this.input, container, touchButtons);
    this.ui.onSettings = (s) => {
      this.audio.setVolume('master', s.master); this.audio.setVolume('music', s.music); this.audio.setVolume('sfx', s.sfx);
      this.input.sensitivity = s.sensitivity; this.input.invertY = s.invertY;
      this.shakeScale = s.reducedMotion ? 0.3 * s.shake : s.shake;
    };
    this.ui.onSettings(settings);
    // unlock audio on first gesture
    const unlock = () => { if (this.audio.unlock()) { this.audio.setVolume('master', this.ui.settings.master); this.audio.setVolume('music', this.ui.settings.music); this.audio.setVolume('sfx', this.ui.settings.sfx); this.events.emit('audio:unlocked'); } };
    addEventListener('pointerdown', unlock, { once: false }); addEventListener('keydown', unlock, { once: false });
    this.loop.add((dt) => this._preUpdate(dt), -1000);
    this.loop.add(() => this.input.endFrame(), 1000);
    this.loop.onRender(() => this._render());
    this._installHooks();
  }
  // Register per-step logic; runs only in states listed (default: playing).
  add(fn, { order = 0, states = ['playing'] } = {}) { return this.loop.add((dt, t) => { if (states === 'all' || states.includes(this.state)) fn(dt, t); }, order); }
  setState(s) { const prev = this.state; this.state = s; if (s !== 'playing') this.ui.prompt(null); this.events.emit('state', { from: prev, to: s }); }
  // Run fn after `seconds` of simulated time (deterministic under test stepping).
  after(seconds, fn) { this.timers.push({ t: seconds, fn }); }
  // Enable realistic parametric humans for every Actor/Player/NPC/Enemy created afterwards.
  // H = the module namespace of engine/humans.js, data = await H.loadHumanData().
  useHumans(H, data, { textureSize } = {}) {
    const tex = textureSize ?? (this.gfx.tier.name === 'low' ? 512 : 1024);
    this.humans = {
      H, data,
      create: (look = {}) => {
        const spec = H.lookToHumanSpec(look);
        const h = H.assembleHuman(data, { textureSize: tex, ...spec });
        if (look.armed) h.userData.retargeter?.setHands(0.35, 1.1); // right hand grips a weapon
        return h;
      },
    };
    return this;
  }

  _preUpdate(dt) {
    for (let i = this.timers.length - 1; i >= 0; i--) { this.timers[i].t -= dt; if (this.timers[i].t <= 0) { const f = this.timers[i].fn; this.timers.splice(i, 1); f(); } }
    this.input.pollGamepad();
    this.ui.update(dt);
    SHARED_UNIFORMS.uTime.value += dt;
    if (this.state !== 'paused') {
      this.atmosphere.update(dt);
      updateNightLights(this.atmosphere.daylight);
      const night = 1 - this.atmosphere.daylight;
      this.fill.intensity = 0.9 * night;
      this.fill.position.copy(this.camera.position).add(new THREE.Vector3(0, 6, 0)); this.fill.target.position.copy(this.camera.position).add(this.camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(10));
      for (const p of this.lightPools) p.update(dt, this.atmosphere.follow, this.atmosphere.daylight);
      this.physics.step(dt);
      this.vfx.update(dt);
    }
  }
  _render() {
    if (this.onBeforeRender) this.onBeforeRender();
    this.gfx.render(this.loop.time);
  }
  shake(amount) { for (const c of this.cameraRigs || []) c.shake.add(amount * (this.shakeScale ?? 1)); }
  hitStop(seconds = 0.06) { if (!this.ui.settings.reducedMotion) this.loop.hitStop = Math.max(this.loop.hitStop, seconds); }
  start() { this.stats.startTime = performance.now(); this.loop.start(); window.__GF.ready = true; this.events.emit('ready'); }
  _installHooks() {
    const app = this;
    addEventListener('error', (e) => app.errors.push(String(e.message || e)));
    addEventListener('unhandledrejection', (e) => app.errors.push('unhandled: ' + (e.reason?.message || e.reason)));
    const releases = [];
    app.loop.add(() => { for (let i = releases.length - 1; i >= 0; i--) if (--releases[i].frames <= 0) { app.input.setVirtual(releases[i].action, 0); releases.splice(i, 1); } }, 999);
    window.__GF = {
      ready: false, version: ENGINE_VERSION, app,
      state: () => ({ state: app.state, time: app.loop.time, frame: app.loop.frame, fps: app.loop.fps, ...app.debugState() }),
      pause: () => { app.loop.manual = true; },
      resume: () => { app.loop.manual = false; },
      step: (frames = 1) => { app.loop.manual = true; app.loop.advance(frames); return window.__GF.state(); },
      // Hold an action for N simulation frames (also registers a "pressed" edge).
      press: (action, frames = 1, value = 1) => { app.input.tap(action); app.input.setVirtual(action, value); releases.push({ action, frames }); },
      hold: (action, value = 1) => app.input.setVirtual(action, value),
      release: (action) => app.input.setVirtual(action, 0),
      releaseAll: () => app.input.clearVirtual(),
      look: (dx, dy = 0) => { app.input.mouseDelta.x += dx; app.input.mouseDelta.y += dy; },
      setTime: (h) => app.atmosphere.setTime(h),
      metrics: () => ({ fps: app.loop.fps, frameMs: app.loop.frameMs, ...app.gfx.stats(), errors: app.errors.length, audioEvents: app.audio.played, particles: app.vfx.emitted }),
      errors: app.errors,
      events: (type) => app.events.count(type),
      render: () => app._render(),
    };
  }
}
