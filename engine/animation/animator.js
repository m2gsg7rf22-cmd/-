// Animation controller for procedural humanoids: speed-blended locomotion, one-shot
// actions with upper-body masking, crossfades, timed events (hit frames) and a small
// declarative state machine usable for any rig.
import * as THREE from '../vendor/three/three.module.js';
import { CLIP_LIBRARY, buildClip } from './clips.js';
import { BONES, UPPER_BODY } from '../character/humanoid.js';

const LOWER = new Set(BONES.filter((b) => !UPPER_BODY.has(b)));
const LOCO = ['idle', 'walk', 'run', 'sprint'];

export class HumanoidAnimator {
  constructor(character, { clips = Object.keys(CLIP_LIBRARY), locomotionSpeeds = { walk: 1.6, run: 4.8, sprint: 7.5 } } = {}) {
    this.character = character;
    this.mixer = new THREE.AnimationMixer(character);
    this.height = character.userData.height || 1.8;
    this.speeds = locomotionSpeeds;
    this.full = {}; this.upper = {}; this.lower = {};
    this.actions = {};
    for (const name of clips) {
      const def = CLIP_LIBRARY[name];
      this.full[name] = buildClip(name, def, { height: this.height });
      if (LOCO.includes(name) || name === 'combatIdle' || name === 'block') {
        this.upper[name] = buildClip(name, def, { height: this.height, boneFilter: UPPER_BODY, suffix: ':upper' });
        this.lower[name] = buildClip(name, def, { height: this.height, boneFilter: LOWER, suffix: ':lower' });
      } else if (def.events || ['cast', 'wave', 'interact'].includes(name)) {
        this.upper[name] = buildClip(name, def, { height: this.height, boneFilter: UPPER_BODY, suffix: ':upper' });
      }
    }
    // Locomotion layers always playing; weights driven by speed.
    this.loco = {};
    for (const n of LOCO) if (this.full[n]) {
      const lo = this.mixer.clipAction(this.lower[n]), up = this.mixer.clipAction(this.upper[n]);
      lo.play(); up.play(); lo.setEffectiveWeight(0); up.setEffectiveWeight(0);
      this.loco[n] = { lo, up };
    }
    this.speed = 0; this.grounded = true; this.stance = 'idle'; // 'idle' | 'combat' | 'block'
    this.current = null; // one-shot { name, action, upperOnly, t, duration, events, fired, onEnd }
    this.override = null; // full-body loop like 'sit', 'drive', 'fall'
    this.overrideWeight = 0;
    this.upperOverride = null; this.upperOverrideWeight = 0;
    this.listeners = {};
    this.phase = 0;
    this._actionWeight = 0;
  }
  on(evt, fn) { (this.listeners[evt] ||= []).push(fn); }
  _emit(evt, data) { for (const f of this.listeners[evt] || []) f(data); }
  setLocomotion(speed, grounded = true) { this.speed = speed; this.grounded = grounded; }
  // Full-body looping override (fall, sit, drive, fly, swing). null to clear.
  setOverride(name) {
    if (this.override?.name === name) return;
    if (this.override) this.override.action.fadeOut(0.2);
    if (!name) { this.override = null; return; }
    const a = this.mixer.clipAction(this.full[name]);
    a.reset().setLoop(CLIP_LIBRARY[name].loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    a.clampWhenFinished = true;
    a.setEffectiveWeight(1).fadeIn(0.2).play();
    this.override = { name, action: a };
  }
  setUpperOverride(name) { // looping upper-body pose e.g. 'block', 'talk', 'wave'
    if (this.upperOverride?.name === name) return;
    if (this.upperOverride) this.upperOverride.action.fadeOut(0.15);
    if (!name) { this.upperOverride = null; return; }
    const clip = this.upper[name] || buildClip(name, CLIP_LIBRARY[name], { height: this.height, boneFilter: UPPER_BODY, suffix: ':upper' });
    this.upper[name] = clip;
    const a = this.mixer.clipAction(clip); a.reset().setLoop(THREE.LoopRepeat, Infinity).fadeIn(0.15).play();
    this.upperOverride = { name, action: a };
  }
  // One-shot action. upperOnly keeps legs on locomotion (attack while moving).
  play(name, { upperOnly = false, speed = 1, onEnd, fade = 0.08 } = {}) {
    const def = CLIP_LIBRARY[name]; if (!def) throw new Error('unknown clip ' + name);
    if (this.current) this.current.action.fadeOut(fade);
    const clip = upperOnly && this.upper[name] ? this.upper[name] : this.full[name];
    const a = this.mixer.clipAction(clip);
    a.reset(); a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = !!def.clamp || name === 'death';
    a.timeScale = speed; a.setEffectiveWeight(1); a.fadeIn(fade); a.play();
    this.current = { name, action: a, upperOnly: upperOnly && !!this.upper[name], t: 0, duration: def.duration / speed, events: def.events || {}, fired: new Set(), onEnd, persistent: name === 'death' };
    return this.current;
  }
  isPlaying(name) { return this.current && (!name || this.current.name === name); }
  progress() { return this.current ? this.current.t / this.current.duration : 1; }
  update(dt) {
    // one-shot bookkeeping
    let actionW = 0;
    if (this.current) {
      const c = this.current; c.t += dt;
      for (const [ev, at] of Object.entries(c.events)) if (!c.fired.has(ev) && c.t >= at * c.duration) { c.fired.add(ev); this._emit(ev, c.name); }
      const remain = c.duration - c.t;
      if (remain <= 0 && !c.persistent) { c.action.fadeOut(0.12); this.current = null; c.onEnd?.(); this._emit('end', c.name); }
      else actionW = c.persistent ? 1 : Math.min(1, c.t / 0.08, Math.max(0, remain) / 0.12 + 0.0001);
    }
    this._actionWeight = actionW;
    // locomotion weights
    const v = this.speed, sp = this.speeds;
    const w = { idle: 0, walk: 0, run: 0, sprint: 0 };
    if (v < 0.05) w.idle = 1;
    else if (v < sp.walk) { const t = v / sp.walk; w.idle = 1 - t; w.walk = t; }
    else if (v < sp.run) { const t = (v - sp.walk) / (sp.run - sp.walk); w.walk = 1 - t; w.run = t; }
    else { const t = Math.min(1, (v - sp.run) / (sp.sprint - sp.run)); w.run = 1 - t; w.sprint = t; }
    // sync cycle time scale to speed
    if (this.loco.walk) { const rate = v < sp.walk ? Math.max(0.6, v / sp.walk) : v < sp.run ? 1 : v / sp.run; for (const n of ['walk', 'run', 'sprint']) if (this.loco[n]) { this.loco[n].lo.timeScale = this.loco[n].up.timeScale = rate; } }
    const ov = this.override ? 1 : 0;
    this.overrideWeight += (ov - this.overrideWeight) * Math.min(1, dt * 10);
    const fullBody = this.current && !this.current.upperOnly ? actionW : 0;
    const upperBlock = this.current && this.current.upperOnly ? actionW : 0;
    const upperOv = this.upperOverride ? 1 : 0;
    const base = 1 - Math.max(this.overrideWeight, fullBody);
    for (const n of LOCO) if (this.loco[n]) {
      this.loco[n].lo.setEffectiveWeight(w[n] * base);
      this.loco[n].up.setEffectiveWeight(w[n] * base * (1 - Math.max(upperBlock, upperOv)));
    }
    if (this.upperOverride) this.upperOverride.action.setEffectiveWeight(base * (1 - upperBlock));
    if (this.current) this.current.action.setEffectiveWeight(Math.max(0.0001, actionW));
    this.mixer.update(dt);
  }
}

// Generic finite state machine for gameplay-driven animation (works with any mixer).
export class AnimStateMachine {
  constructor(mixer, clips) { this.mixer = mixer; this.clips = clips; this.states = {}; this.state = null; this.params = {}; this.time = 0; }
  addState(name, { clip, loop = true, speed = 1, transitions = [] }) { this.states[name] = { clip, loop, speed, transitions }; return this; }
  set(param, value) { this.params[param] = value; }
  go(name, fade = 0.2) {
    const s = this.states[name]; if (!s) throw new Error('no state ' + name);
    const prev = this.state && this.states[this.state];
    const a = this.mixer.clipAction(this.clips[s.clip]);
    a.reset().setLoop(s.loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity); a.clampWhenFinished = !s.loop; a.timeScale = s.speed;
    if (prev) this.mixer.clipAction(this.clips[prev.clip]).fadeOut(fade);
    a.fadeIn(fade).play();
    this.state = name; this.time = 0;
  }
  update(dt) {
    this.time += dt;
    const s = this.states[this.state];
    if (s) for (const t of s.transitions) { if (t.when(this.params, this.time)) { this.go(t.to, t.fade ?? 0.2); break; } }
    this.mixer.update(dt);
  }
}
