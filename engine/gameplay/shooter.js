// Shooter kit (ranged combat) — reusable for third-person (over-the-shoulder) and first-person
// games. Layers, from pure to engine-bound:
//   1. Data + math (pure, unit-tested): WEAPONS / defineWeapon / weaponDef, damageAtDistance,
//      zoneMultiplier, spreadAngle, coneDirection, timeToKill.
//   2. WeaponState: ammo / fire-mode (auto|semi|burst) / reload / equip / bloom / recoil state machine.
//   3. Hit detection: actorHitboxes (head/body/limb), rayHitbox, hitscan (PhysicsWorld + hitboxes).
//   4. WeaponSystem: weapons attached to any actor (player or AI): equip/switch, fire, reload, ADS,
//      hitscan + projectiles (ProjectileSystem), splash, muzzle flash/tracer/impact VFX, sounds,
//      events (shot, hit, kill, reload, empty, equip) + app.events 'weapon:*'.
//   5. ShootingTarget: practice / pop-up targets with hitboxes (ranges, tutorials).
//   6. ShooterController: drives a GF.Player — aim mode camera, first/third-person views,
//      viewmodel, snap-to-cover with peek/aim, aim assist, crosshair + ammo HUD.
// RangedEnemy (AI) lives in shooter-ai.js, CoverSystem in cover.js, meshes in weapon-models.js.
import * as THREE from '../vendor/three/three.module.js';
import { RNG, clamp, damp, dampAngle, wrapAngle } from '../core/rng.js';
import { raySphere } from '../physics/world.js';
import { ProjectileSystem, Health } from './systems.js';
import { defineClip, CLIP_LIBRARY } from '../animation/clips.js';
import { defineSfx } from '../audio/audio.js';
import { attach } from '../character/humanoid.js';
import { FirstPersonCamera } from '../camera/cameras.js';
import { CoverSystem } from './cover.js';
import { weaponModel, weaponSocketWorld } from './weapon-models.js';
import { UI } from '../ui/ui.js';

const DEG = Math.PI / 180;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

// ---------------------------------------------------------------- 1. weapon data
// Angles in degrees, distances in metres, times in seconds. spread.* are cone half-angles.
export const WEAPON_DEFAULTS = {
  name: 'Weapon', mode: 'auto', rpm: 600, burst: 3, burstDelay: 0.25, damage: 20, pellets: 1, headMult: 2, limbMult: 0.75,
  falloff: { start: 20, end: 50, min: 0.6 }, range: 120,
  spread: { hip: 2, ads: 0.4, move: 1.5, air: 3, crouch: 0.75, bloom: 0.3, bloomMax: 3, recovery: 6, pellet: 0 },
  recoil: { pattern: [[0, 1]], kick: 0.5, jitter: 0.15, recover: 0.5, reset: 0.35, adsMult: 0.6 },
  magazine: 30, reserve: 120, reloadTime: 2, reloadEmptyTime: null, reloadPerShell: 0, equipTime: 0.45, autoReload: true,
  adsTime: 0.2, adsFov: 45, adsSpeed: 0.6, moveSpeed: 1, hitscan: true, projectile: null,
  sound: 'gunshot', pitch: 1, volume: 1, tracer: { every: 1, color: 0xffd27a, width: 0.02 }, flash: 1,
  knockback: 0.4, stagger: 0.12, impulse: 2.5, model: 'rifle', pose: 'aimRifle', hold: 'holdRifle',
  ai: { burst: [3, 6], accuracy: 1, range: [8, 28] },
};
export const WEAPONS = {};
const RECOIL_RIFLE = [[0, 1], [0.15, 1], [-0.2, 1.05], [0.25, 0.95], [-0.3, 0.9], [0.35, 0.8], [-0.35, 0.8], [0.3, 0.7], [-0.25, 0.7], [0.2, 0.6]];
/** Register (or override) a weapon; fields merge with WEAPON_DEFAULTS (nested objects too). */
export function defineWeapon(id, def) {
  const d = { ...WEAPON_DEFAULTS, ...def, id };
  for (const k of ['falloff', 'spread', 'recoil', 'tracer', 'ai']) d[k] = def[k] === null ? null : { ...WEAPON_DEFAULTS[k], ...(def[k] || {}) };
  if (d.reloadEmptyTime == null) d.reloadEmptyTime = d.reloadTime;
  Object.defineProperty(d, '__def', { value: true });
  WEAPONS[id] = d; return d;
}
/** Normalise an id or a partial definition into a full weapon definition. */
export function weaponDef(w) { if (typeof w === 'string') { if (!WEAPONS[w]) throw new Error('unknown weapon ' + w); return WEAPONS[w]; } return w.__def ? w : defineWeaponLocal(w); }
function defineWeaponLocal(def) { const base = def.base ? WEAPONS[def.base] : {}; const d = { ...WEAPON_DEFAULTS, ...base, ...def }; for (const k of ['falloff', 'spread', 'recoil', 'tracer', 'ai']) d[k] = def[k] === null ? null : { ...WEAPON_DEFAULTS[k], ...(base[k] || {}), ...(def[k] || {}) }; if (d.reloadEmptyTime == null) d.reloadEmptyTime = d.reloadTime; d.id = d.id || def.base || 'custom'; Object.defineProperty(d, '__def', { value: true }); return d; }

defineWeapon('rifle', { name: 'Assault Rifle', mode: 'auto', rpm: 620, damage: 24, headMult: 2, falloff: { start: 25, end: 60, min: 0.6 }, range: 150,
  spread: { hip: 2.2, ads: 0.3, move: 1.6, bloom: 0.3, bloomMax: 3 }, recoil: { pattern: RECOIL_RIFLE, kick: 0.55, jitter: 0.15 },
  magazine: 30, reserve: 120, reloadTime: 2.1, reloadEmptyTime: 2.5, adsFov: 42, adsSpeed: 0.6, tracer: { every: 2 }, model: 'rifle', ai: { burst: [3, 6], range: [10, 30] } });
defineWeapon('carbine', { name: 'Burst Carbine', mode: 'burst', burst: 3, rpm: 900, burstDelay: 0.28, damage: 26, headMult: 2, falloff: { start: 22, end: 55, min: 0.62 }, range: 140,
  spread: { hip: 2, ads: 0.25, move: 1.4, bloom: 0.2, bloomMax: 2 }, recoil: { pattern: RECOIL_RIFLE, kick: 0.45 },
  magazine: 24, reserve: 120, reloadTime: 2, adsFov: 40, model: 'carbine', ai: { burst: [3, 3], range: [10, 30] } });
defineWeapon('smg', { name: 'SMG', mode: 'auto', rpm: 900, damage: 16, headMult: 1.6, falloff: { start: 10, end: 32, min: 0.5 }, range: 80,
  spread: { hip: 2.6, ads: 0.9, move: 0.8, bloom: 0.22, bloomMax: 2.5, recovery: 8 }, recoil: { pattern: RECOIL_RIFLE, kick: 0.35, jitter: 0.3 },
  magazine: 32, reserve: 160, reloadTime: 1.8, reloadEmptyTime: 2.1, adsFov: 52, adsSpeed: 0.75, moveSpeed: 1.05, model: 'smg', pose: 'aimRifle', ai: { burst: [5, 9], range: [5, 16] } });
defineWeapon('pistol', { name: 'Pistol', mode: 'semi', rpm: 420, damage: 30, headMult: 2.2, falloff: { start: 15, end: 40, min: 0.55 }, range: 80,
  spread: { hip: 1.4, ads: 0.35, move: 0.9, bloom: 0.6, bloomMax: 2.5, recovery: 7 }, recoil: { pattern: [[0, 1], [0.2, 1], [-0.2, 1]], kick: 1.2, jitter: 0.3, reset: 0.5 },
  magazine: 12, reserve: 60, reloadTime: 1.4, reloadEmptyTime: 1.7, equipTime: 0.3, adsFov: 52, adsSpeed: 0.8, moveSpeed: 1.05, sound: 'gunshotLight', model: 'pistol', pose: 'aimPistol', hold: 'holdPistol', ai: { burst: [2, 4], range: [6, 20] } });
defineWeapon('shotgun', { name: 'Shotgun', mode: 'semi', rpm: 70, damage: 14, pellets: 9, headMult: 1.5, limbMult: 0.9, falloff: { start: 6, end: 22, min: 0.15 }, range: 40,
  spread: { hip: 1.5, ads: 0.8, move: 0.8, bloom: 0, bloomMax: 0, pellet: 4.5 }, recoil: { pattern: [[0, 1]], kick: 3.5, jitter: 0.6, reset: 1 },
  magazine: 6, reserve: 30, reloadTime: 0.55, reloadPerShell: 0.55, adsFov: 55, sound: 'gunshotHeavy', knockback: 1.2, stagger: 0.35, impulse: 4, model: 'shotgun', ai: { burst: [1, 1], range: [3, 12] } });
defineWeapon('sniper', { name: 'Sniper Rifle', mode: 'semi', rpm: 45, damage: 95, headMult: 2.5, limbMult: 0.8, falloff: { start: 80, end: 220, min: 0.85 }, range: 320,
  spread: { hip: 6, ads: 0.02, move: 4, air: 8, bloom: 0, bloomMax: 0 }, recoil: { pattern: [[0, 1]], kick: 4, jitter: 0.5, reset: 1.2 },
  magazine: 5, reserve: 25, reloadTime: 3, adsTime: 0.35, adsFov: 14, adsSpeed: 0.4, moveSpeed: 0.9, sound: 'gunshotHeavy', tracer: { every: 1, color: 0xfff0c0, width: 0.03 }, knockback: 1, stagger: 0.5, model: 'sniper', ai: { burst: [1, 1], range: [25, 80], accuracy: 0.6 } });
defineWeapon('launcher', { name: 'Rocket Launcher', mode: 'semi', rpm: 40, damage: 40, headMult: 1, limbMult: 1, falloff: null, range: 200, hitscan: false,
  projectile: { speed: 38, gravity: -4, radius: 0.18, life: 6, splash: { radius: 5, damage: 120, min: 0.15 }, color: 0xffa040 },
  spread: { hip: 1.2, ads: 0.3, move: 1, bloom: 0, bloomMax: 0 }, recoil: { pattern: [[0, 1]], kick: 3, reset: 1.5 },
  magazine: 1, reserve: 6, reloadTime: 2.8, equipTime: 0.7, adsFov: 45, adsSpeed: 0.5, moveSpeed: 0.85, sound: 'launch', tracer: null, stagger: 1, knockback: 6, model: 'launcher', ai: { burst: [1, 1], range: [12, 40] } });

// ---------------------------------------------------------------- pure math
/** Damage of one pellet/bullet at distance d (linear falloff between start and end, 0 past range). */
export function damageAtDistance(def, d) {
  def = weaponDef(def);
  if (d > def.range) return 0;
  const f = def.falloff; if (!f) return def.damage;
  if (d <= f.start) return def.damage;
  if (d >= f.end) return def.damage * f.min;
  return def.damage * (1 + (f.min - 1) * (d - f.start) / (f.end - f.start));
}
export function zoneMultiplier(def, zone) { def = weaponDef(def); return zone === 'head' ? def.headMult : zone === 'limb' ? def.limbMult : 1; }
/** Cone half-angle (radians) for the next shot. moving in 0..1 (fraction of run speed). */
export function spreadAngle(def, { ads = false, moving = 0, airborne = false, crouched = false, bloom = 0 } = {}) {
  const s = weaponDef(def).spread;
  let deg = (ads ? s.ads : s.hip) + s.move * clamp(moving, 0, 1) + (airborne ? s.air : 0) + bloom;
  if (crouched) deg *= s.crouch;
  return deg * DEG;
}
/** Uniformly distributed direction inside a cone of half-angle `half` around unit vector `dir`. */
export function coneDirection(dir, half, rng = Math.random, out = new THREE.Vector3()) {
  const r = typeof rng === 'function' ? rng : () => rng.next();
  if (half <= 0) return out.copy(dir);
  const a = Math.tan(half) * Math.sqrt(r()), phi = r() * Math.PI * 2;
  const up = Math.abs(dir.y) < 0.99 ? V(0, 1, 0) : V(1, 0, 0);
  const u = V().crossVectors(dir, up).normalize(), w = V().crossVectors(u, dir).normalize();
  return out.copy(dir).addScaledVector(u, Math.cos(phi) * a).addScaledVector(w, Math.sin(phi) * a).normalize();
}
/** Time-to-kill math for tuning: shots to kill and seconds (first shot at t=0, reloads included). */
export function timeToKill(def, hp, { distance = 0, zone = 'body', accuracy = 1, armor = 0 } = {}) {
  def = weaponDef(def);
  const perShot = damageAtDistance(def, distance) * zoneMultiplier(def, zone) * def.pellets * accuracy * (1 - armor);
  if (perShot <= 0) return { shots: Infinity, seconds: Infinity, perShot: 0 };
  const shots = Math.ceil(hp / perShot - 1e-9);
  const interval = def.mode === 'burst' ? (def.burst * 60 / def.rpm + def.burstDelay) / def.burst : 60 / def.rpm;
  const reloads = Math.floor((shots - 1) / def.magazine);
  return { shots, perShot, seconds: (shots - 1) * interval + reloads * def.reloadTime };
}

// ---------------------------------------------------------------- 2. WeaponState
export class WeaponState {
  constructor(def, { mag, reserve, seed = 7 } = {}) {
    this.def = weaponDef(def);
    this.mag = mag ?? this.def.magazine; this.reserve = reserve ?? this.def.reserve;
    this.cooldown = 0; this.reloadT = 0; this.reloadDur = 0; this.equipT = 0; this.burstLeft = 0;
    this.trigger = false; this.pressBuffer = 0; this.bloom = 0; this.recoilIndex = 0; this.sinceShot = 99; this.shots = 0;
    this.rng = new RNG(seed); this.listeners = {};
  }
  on(e, f) { (this.listeners[e] ||= []).push(f); return this; }
  emit(e, d) { for (const f of this.listeners[e] || []) f(d); }
  get reloading() { return this.reloadT > 0; }
  get reloadProgress() { return this.reloadT > 0 ? 1 - this.reloadT / this.reloadDur : null; }
  get state() { return this.equipT > 0 ? 'equipping' : this.reloadT > 0 ? 'reloading' : this.mag <= 0 ? 'empty' : this.cooldown > 0 || this.burstLeft > 0 ? 'cycling' : 'ready'; }
  get canReload() { return this.mag < this.def.magazine && this.reserve > 0 && this.reloadT <= 0; }
  equip() { this.equipT = this.def.equipTime; this.reloadT = 0; this.burstLeft = 0; this.pressBuffer = 0; this.emit('equip', this); }
  setTrigger(down) { if (down && !this.trigger) this.pressBuffer = 0.12; this.trigger = !!down; }
  reload() {
    if (!this.canReload || this.equipT > 0) return false;
    this.burstLeft = 0;
    this.reloadDur = this.def.reloadPerShell > 0 ? this.def.reloadPerShell : this.mag === 0 ? this.def.reloadEmptyTime : this.def.reloadTime;
    this.reloadT = this.reloadDur; this.emit('reloadStart', this); return true;
  }
  cancelReload() { if (this.reloadT > 0) { this.reloadT = 0; this.emit('reloadCancel', this); } }
  addAmmo(n) { this.reserve += n; }
  _fire(out) {
    const r = this.def.recoil, d = this.def;
    this.mag--; this.shots++; this.cooldown += 60 / d.rpm; this.sinceShot = 0;
    const bloom = this.bloom; this.bloom = Math.min(d.spread.bloomMax, this.bloom + d.spread.bloom);
    let kick = { yaw: 0, pitch: 0 };
    if (r) { const p = r.pattern[this.recoilIndex % r.pattern.length]; kick = { yaw: (p[0] * r.kick + (this.rng.next() - 0.5) * r.jitter) * DEG, pitch: p[1] * r.kick * DEG }; }
    this.recoilIndex++;
    const shot = { index: this.shots, bloom, recoil: kick, mag: this.mag };
    out.push(shot); this.emit('shot', shot);
  }
  // Advance dt seconds; returns the shots fired during this step.
  update(dt) {
    const d = this.def, out = [];
    this.sinceShot += dt; this.pressBuffer = Math.max(0, this.pressBuffer - dt);
    if (d.recoil && this.sinceShot > d.recoil.reset) this.recoilIndex = 0;
    if (this.sinceShot > 60 / d.rpm * 1.2) this.bloom = Math.max(0, this.bloom - d.spread.recovery * dt);
    this.cooldown = Math.max(this.cooldown - dt, -dt);
    if (this.equipT > 0) { this.equipT -= dt; return out; }
    if (this.reloadT > 0) {
      if (d.reloadPerShell > 0 && this.mag > 0 && this.pressBuffer > 0) this.cancelReload(); // shell reload can be interrupted
      else {
        this.reloadT -= dt;
        if (this.reloadT <= 0) {
          if (d.reloadPerShell > 0) {
            this.mag++; this.reserve--; this.emit('reloadShell', this);
            if (this.mag < d.magazine && this.reserve > 0) { this.reloadT = d.reloadPerShell; this.reloadDur = d.reloadPerShell; } else { this.reloadT = 0; this.emit('reload', this); }
          } else { const n = Math.min(d.magazine - this.mag, this.reserve); this.mag += n; this.reserve -= n; this.reloadT = 0; this.emit('reload', this); }
        }
        return out;
      }
    }
    if (this.burstLeft > 0) {
      while (this.burstLeft > 0 && this.cooldown <= 0 && this.mag > 0) { this._fire(out); this.burstLeft--; }
      if (this.mag <= 0) this.burstLeft = 0;
      if (this.burstLeft === 0 && out.length) this.cooldown += d.burstDelay;
      return out;
    }
    const wants = d.mode === 'auto' ? this.trigger : this.pressBuffer > 0;
    if (!wants || this.cooldown > 0) return out;
    if (this.mag <= 0) {
      if (this.pressBuffer > 0) { this.pressBuffer = 0; this.emit('empty', this); if (d.autoReload) this.reload(); }
      return out;
    }
    this.pressBuffer = 0;
    if (d.mode === 'burst') { this.burstLeft = d.burst; while (this.burstLeft > 0 && this.cooldown <= 0 && this.mag > 0) { this._fire(out); this.burstLeft--; } if (this.burstLeft === 0) this.cooldown += d.burstDelay; }
    else if (d.mode === 'semi') this._fire(out);
    else while (this.cooldown <= 0 && this.mag > 0) this._fire(out);
    if (this.mag <= 0) this.emit('magEmpty', this);
    return out;
  }
  toJSON() { return { id: this.def.id, mag: this.mag, reserve: this.reserve }; }
}

// ---------------------------------------------------------------- 3. hit detection
/** Hitboxes of an actor-like target. Override per target with target.hitboxes = () => [...].
 * Types: { type:'sphere', center, r } | { type:'cylinder', x, z, y0, y1, r } | { type:'box', min, max }; each with zone. */
export function actorHitboxes(t) {
  if (typeof t.hitboxes === 'function') return t.hitboxes();
  const p = t.position, sc = t.model?.scale?.y || 1;
  const H = (t.ctrl?.height ?? (t.model?.userData?.height || 1.8) * sc) * (t.crouching ? 0.6 : 1);
  const r = (t.radius || 0.4) * 0.85;
  return [
    { type: 'sphere', zone: 'head', center: V(p.x, p.y + H * 0.925, p.z), r: Math.max(0.1, H * 0.068) },
    { type: 'cylinder', zone: 'body', x: p.x, z: p.z, y0: p.y + H * 0.45, y1: p.y + H * 0.86, r },
    { type: 'cylinder', zone: 'limb', x: p.x, z: p.z, y0: p.y, y1: p.y + H * 0.45, r: r * 0.85 },
  ];
}
function rayCylinderY(o, d, x, z, r, y0, y1) {
  const ox = o.x - x, oz = o.z - z;
  const a = d.x * d.x + d.z * d.z, b = ox * d.x + oz * d.z, c = ox * ox + oz * oz - r * r;
  let best = null;
  if (a > 1e-9) {
    const disc = b * b - a * c;
    if (disc >= 0) { const t = (-b - Math.sqrt(disc)) / a; if (t >= 0) { const y = o.y + d.y * t; if (y >= y0 && y <= y1) best = t; } else if (c <= 0) { const y = o.y; if (y >= y0 && y <= y1) best = 0; } }
  }
  if (Math.abs(d.y) > 1e-9) for (const yc of [y0, y1]) { const t = (yc - o.y) / d.y; if (t < 0 || (best !== null && t >= best)) continue; const px = ox + d.x * t, pz = oz + d.z * t; if (px * px + pz * pz <= r * r) best = t; }
  return best;
}
function rayBox(o, d, mn, mx) {
  let t0 = 0, t1 = Infinity;
  for (const k of ['x', 'y', 'z']) {
    if (Math.abs(d[k]) < 1e-9) { if (o[k] < mn[k] || o[k] > mx[k]) return null; continue; }
    let a = (mn[k] - o[k]) / d[k], b = (mx[k] - o[k]) / d[k]; if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, b); if (t0 > t1) return null;
  }
  return t0;
}
/** Distance along the ray to a hitbox, or null. */
export function rayHitbox(o, d, hb) {
  if (hb.type === 'sphere') return raySphere(o, d, hb.center, hb.r);
  if (hb.type === 'cylinder') return rayCylinderY(o, d, hb.x, hb.z, hb.r, hb.y0, hb.y1);
  if (hb.type === 'box') return rayBox(o, d, hb.min, hb.max);
  return null;
}
/** Hitscan: nearest of world geometry (terrain, statics, bodies) and target hitboxes.
 * Returns { distance, point, normal, kind: 'actor'|'static'|'body'|'terrain', target, zone, shape } or null. */
export function hitscan(world, origin, dir, maxDist, targets = [], { ignore = null, bodies = true } = {}) {
  let best = null;
  if (world) {
    const h = world.raycast(origin, dir, maxDist, { bodies });
    if (h) best = { distance: h.distance, point: h.point, normal: h.normal, shape: h.shape, target: null, zone: null, kind: !h.shape ? 'terrain' : h.shape.velocity ? 'body' : 'static' };
  }
  for (const t of targets) {
    if (!t || t === ignore || t.alive === false) continue;
    for (const hb of actorHitboxes(t)) {
      const d = rayHitbox(origin, dir, hb);
      if (d === null || d > maxDist || (best && d >= best.distance)) continue;
      const point = origin.clone().addScaledVector(dir, d);
      best = { distance: d, point, normal: dir.clone().negate(), shape: null, target: t, zone: hb.zone || 'body', hitbox: hb, kind: 'actor' };
    }
  }
  return best;
}
/** Apply weapon damage to a target (Player.receive aware). Returns damage actually dealt. */
export function applyDamage(target, amount, info) {
  if (!target || target.alive === false) return 0;
  if (typeof target.receive === 'function') return target.receive(amount, info) || 0;
  return target.health ? target.health.damage(amount, info) : 0;
}

// ---------------------------------------------------------------- animation poses + sounds
// Upper-body poses (degrees, same conventions as CLIP_LIBRARY): rifle shouldered, pistol two-hand,
// low-ready holds; full-body crouch for cover; one-shot reload.
if (!CLIP_LIBRARY.aimRifle) {
  defineClip('aimRifle', { duration: 1, loop: true, pose: () => ({ spine: [4, 8, 0], chest: [2, 10, 0], head: [0, -14, 0], upperArm_R: [-82, 0, 28], lowerArm_R: [-28, 0, 0], hand_R: [0, 0, 0], upperArm_L: [-88, 0, -38], lowerArm_L: [-46, 0, 0], hand_L: [0, 0, 0] }) });
  defineClip('aimPistol', { duration: 1, loop: true, pose: () => ({ spine: [3, 0, 0], chest: [2, 0, 0], upperArm_R: [-88, 0, 10], lowerArm_R: [-6, 0, 0], upperArm_L: [-84, 0, -22], lowerArm_L: [-20, 0, 0] }) });
  defineClip('holdRifle', { duration: 2, loop: true, pose: (p) => ({ chest: [1.5 * Math.sin(p * Math.PI * 2), 6, 0], upperArm_R: [-42, 0, 22], lowerArm_R: [-52, 0, 0], upperArm_L: [-58, 0, -30], lowerArm_L: [-62, 0, 0] }) });
  defineClip('holdPistol', { duration: 2, loop: true, pose: () => ({ upperArm_R: [-30, 0, 12], lowerArm_R: [-40, 0, 0], upperArm_L: [-20, 0, -12], lowerArm_L: [-40, 0, 0] }) });
  defineClip('crouch', { duration: 2, loop: true, pose: (p) => ({ hipsY: -0.5, hips: [-8, 0, 0], spine: [22 + Math.sin(p * Math.PI * 2), 0, 0], upperLeg_L: [-95, 0, 6], lowerLeg_L: [118, 0, 0], foot_L: [-22, 0, 0], upperLeg_R: [-60, 0, -6], lowerLeg_R: [125, 0, 0], foot_R: [-40, 0, 0], upperArm_R: [-40, 0, 20], lowerArm_R: [-60, 0, 0], upperArm_L: [-55, 0, -25], lowerArm_L: [-65, 0, 0] }) });
  defineClip('reload', { duration: 1.2, loop: false, events: { mag: 0.5 }, pose: (p) => { const c = Math.sin(Math.min(1, p) * Math.PI); return { chest: [8 * c, 6, 0], head: [12 * c, 0, 0], upperArm_R: [-45, 0, 22], lowerArm_R: [-60, 0, 0], upperArm_L: [-40 + 25 * c, 0, -30 + 10 * c], lowerArm_L: [-70 - 30 * c, 0, 0] }; } });
}
const GUN_SFX = {
  gunshot: (e, t, d, p) => { e._noiseBurst(t, 0.16, d, { gain: 0.75, type: 'lowpass', freq: 4200 * p, slide: 500 }); e._osc('square', 150 * p, t, 0.07, d, { gain: 0.3, slide: 60 }); e._osc('sine', 70 * p, t, 0.14, d, { gain: 0.5, slide: 40 }); },
  gunshotLight: (e, t, d, p) => { e._noiseBurst(t, 0.1, d, { gain: 0.55, type: 'lowpass', freq: 5200 * p, slide: 900 }); e._osc('square', 260 * p, t, 0.05, d, { gain: 0.2, slide: 120 }); },
  gunshotHeavy: (e, t, d, p) => { e._noiseBurst(t, 0.4, d, { gain: 0.95, type: 'lowpass', freq: 2600 * p, slide: 200 }); e._osc('sine', 55 * p, t, 0.35, d, { gain: 0.8, slide: 30 }); e._noiseBurst(t + 0.05, 0.5, d, { gain: 0.25, type: 'lowpass', freq: 700 * p }); },
  launch: (e, t, d, p) => { e._noiseBurst(t, 0.6, d, { gain: 0.7, freq: 900 * p, slide: 2600 * p, q: 0.7 }); e._osc('sine', 90 * p, t, 0.25, d, { gain: 0.5, slide: 40 }); },
  reload: (e, t, d, p) => { e._noiseBurst(t, 0.04, d, { gain: 0.25, type: 'highpass', freq: 2500 * p }); e._osc('square', 900 * p, t + 0.12, 0.03, d, { gain: 0.08 }); e._noiseBurst(t + 0.14, 0.05, d, { gain: 0.3, type: 'bandpass', freq: 1800 * p, q: 3 }); },
  dryFire: (e, t, d, p) => { e._osc('square', 1400 * p, t, 0.02, d, { gain: 0.08 }); e._noiseBurst(t, 0.02, d, { gain: 0.12, type: 'highpass', freq: 4000 * p }); },
  bulletImpact: (e, t, d, p) => { e._noiseBurst(t, 0.06, d, { gain: 0.25, type: 'bandpass', freq: 2200 * p, q: 1.5 }); },
  hitMarker: (e, t, d, p) => { e._osc('triangle', 1800 * p, t, 0.04, d, { gain: 0.08 }); },
  weaponSwap: (e, t, d, p) => { e._noiseBurst(t, 0.08, d, { gain: 0.15, type: 'bandpass', freq: 1200 * p, q: 2 }); e._osc('square', 600 * p, t + 0.06, 0.03, d, { gain: 0.05 }); },
};
for (const [n, r] of Object.entries(GUN_SFX)) defineSfx(n, r);

// ---------------------------------------------------------------- tracers
class TracerPool {
  constructor(scene, n = 40) {
    this.scene = scene; this.items = [];
    const geo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5);
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      m.visible = false; m.frustumCulled = false; m.renderOrder = 6; m.userData.noHitscan = true; scene.add(m); this.items.push({ m, life: 0, max: 1 });
    }
    this.i = 0;
  }
  spawn(a, b, { color = 0xffd27a, width = 0.02, life = 0.06 } = {}) {
    const it = this.items[this.i++ % this.items.length], len = a.distanceTo(b); if (len < 0.05) return;
    it.m.position.copy(a); it.m.lookAt(b); it.m.scale.set(width, width, len); it.m.material.color.setHex(color);
    it.m.visible = true; it.life = it.max = life; it.m.material.opacity = 1;
  }
  update(dt) { for (const it of this.items) if (it.life > 0) { it.life -= dt; it.m.material.opacity = Math.max(0, it.life / it.max); if (it.life <= 0) it.m.visible = false; } }
}

// Attach a firearm model to an actor's right hand. Realistic humans use the weapon convention
// directly (grip origin, +Z muzzle); the stylized mannequin socket is sword-oriented, so wrap.
export function attachFirearm(actor, model) {
  const ch = actor.model || actor;
  if (ch.userData.kind === 'human') { ch.userData.sockets.hand_R.add(model); ch.userData.retargeter?.setHands?.(0.35, 1.1); return model; }
  const wrap = new THREE.Group(); wrap.name = 'firearmMount'; wrap.rotation.set(0, Math.PI, 0); wrap.add(model);
  attach(ch, 'hand_R', wrap); return model;
}

// ---------------------------------------------------------------- 4. WeaponSystem
export class WeaponSystem {
  constructor(app, owner, { weapons = ['rifle'], ammo = {}, targets = () => [], seed = 1234, visual = true, damageMult = 1, projectiles = null, colors = {} } = {}) {
    this.app = app; this.owner = owner; this.targets = targets; this.damageMult = damageMult; this.visual = visual;
    this.rng = new RNG(seed);
    this.slots = weapons.map((w, i) => {
      const def = weaponDef(w), a = ammo[def.id] || {};
      const st = new WeaponState(def, { mag: a.mag, reserve: ammo.infinite ? Infinity : a.reserve, seed: seed + i * 31 });
      st.model = visual && def.model ? weaponModel(def.model, colors) : null;
      if (st.model) { st.model.visible = false; attachFirearm(owner, st.model); }
      for (const e of ['reloadStart', 'reload', 'empty', 'reloadShell']) st.on(e, () => this._emitState(e, st));
      return st;
    });
    this.index = -1; this.aiming = false; this.aimBlend = 0; this.trigger = false;
    this.aim = { origin: V(), dir: V(0, 0, 1) };
    this.aimPoint = V(); this.aimHit = null;
    this.moving = 0; this.airborne = false; this.crouched = false;
    this.projectiles = projectiles || new ProjectileSystem(app.scene, app.physics);
    this.tracers = app.__tracers || (app.__tracers = new TracerPool(app.scene));
    this.recoil = { yaw: 0, pitch: 0 }; this.recoilDebt = 0; // share of the climb that recovers after firing
    this.stats = { shots: 0, hits: 0, headshots: 0, kills: 0, damage: 0 };
    this.listeners = {};
    this.muzzleOverride = null; // () => Vector3 (first-person viewmodel)
    this.lastShotTime = -99;
    this.equip(0, { instant: true });
  }
  on(e, f) { (this.listeners[e] ||= []).push(f); return this; }
  emit(e, d) { for (const f of this.listeners[e] || []) f(d); this.app.events?.emit('weapon:' + e, { owner: this.owner, ...d }); }
  _emitState(e, st) {
    const pos = this.owner.position;
    if (e === 'reloadStart') { this.app.audio?.play('reload', { pos, volume: 0.8 }); if (this.owner.anim?.upper?.reload) this.owner.anim.play('reload', { upperOnly: true, speed: 1.2 / Math.max(0.3, st.reloadDur) }); }
    if (e === 'empty') this.app.audio?.play('dryFire', { pos });
    if (e === 'reload') this.app.audio?.play('reload', { pos, pitch: 1.3, volume: 0.6 });
    this.emit(e === 'reloadStart' ? 'reloadStart' : e, { weapon: st.def.id, mag: st.mag, reserve: st.reserve });
  }
  get current() { return this.slots[this.index]; }
  get def() { return this.current.def; }
  get mag() { return this.current.mag; }
  get reserve() { return this.current.reserve; }
  get reloading() { return this.current.reloading; }
  equip(i, { instant = false } = {}) {
    if (typeof i === 'string') i = this.slots.findIndex((s) => s.def.id === i);
    if (i < 0 || i >= this.slots.length || i === this.index) return false;
    const prev = this.current; if (prev) { prev.setTrigger(false); prev.cancelReload(); if (prev.model) prev.model.visible = false; }
    this.index = i; const cur = this.current; cur.equip(); if (instant) cur.equipT = 0;
    if (cur.model) cur.model.visible = true;
    if (!instant) this.app.audio?.play('weaponSwap', { pos: this.owner.position });
    this.emit('equip', { weapon: cur.def.id, index: i });
    return true;
  }
  next(dir = 1) { return this.slots.length > 1 && this.equip((this.index + dir + this.slots.length) % this.slots.length); }
  setTrigger(down) { this.trigger = !!down; this.current.setTrigger(down); }
  setAim(on) { this.aiming = !!on; }
  reload() { return this.current.reload(); }
  addAmmo(id, n) { const s = this.slots.find((x) => x.def.id === id); if (s) s.addAmmo(n); return !!s; }
  muzzleWorld(out = V()) {
    if (this.muzzleOverride) return out.copy(this.muzzleOverride());
    const m = this.current.model;
    if (m && m.visible && this.owner.model?.visible !== false) { m.updateWorldMatrix(true, true); return weaponSocketWorld(m, 'muzzle', out); }
    const p = this.owner.position, f = this.owner.ctrl ? this.owner.ctrl.forward() : V(0, 0, 1);
    return out.set(p.x + f.x * 0.55, p.y + (this.owner.crouching ? 0.95 : 1.42), p.z + f.z * 0.55);
  }
  _targets() { return this.targets().filter((t) => t && t !== this.owner && t.alive !== false); }
  update(dt) {
    const st = this.current, def = st.def;
    this.aimBlend = damp(this.aimBlend, this.aiming ? 1 : 0, 3 / Math.max(0.05, def.adsTime), dt);
    this.recoil.yaw = 0; this.recoil.pitch = 0;
    const targets = this._targets();
    this.aimHit = hitscan(this.app.physics, this.aim.origin, this.aim.dir, def.range, targets, { ignore: this.owner });
    if (this.aimHit) this.aimPoint.copy(this.aimHit.point); else this.aimPoint.copy(this.aim.origin).addScaledVector(this.aim.dir, def.range);
    const alive = this.owner.alive !== false;
    if (!alive) st.setTrigger(false);
    const shots = st.update(dt);
    for (const s of shots) this._fire(s, targets);
    // recoil recovery: the aim settles back by recoil.recover of the climb once firing stops
    if (!shots.length && this.recoilDebt > 1e-5 && st.sinceShot > 0.08) { const r = this.recoilDebt * (1 - Math.exp(-9 * dt)); this.recoil.pitch -= r; this.recoilDebt -= r; }
    this.projectiles.update(dt, targets);
    this.tracers.update(dt);
  }
  currentSpread() { const st = this.current; return spreadAngle(st.def, { ads: this.aimBlend > 0.6, moving: this.moving, airborne: this.airborne, crouched: this.crouched, bloom: st.bloom }); }
  _fire(shot, targets) {
    const app = this.app, st = this.current, def = st.def;
    const muzzle = this.muzzleWorld();
    let base = this.aimPoint.clone().sub(muzzle);
    if (base.length() < 0.6 || base.clone().normalize().dot(this.aim.dir) < 0.5) base = this.aim.dir.clone(); else base.normalize();
    const spread = spreadAngle(def, { ads: this.aimBlend > 0.6, moving: this.moving, airborne: this.airborne, crouched: this.crouched, bloom: shot.bloom });
    const rnd = () => this.rng.next();
    const center = coneDirection(base, spread, rnd);
    this.stats.shots++; this.lastShotTime = app.loop?.time ?? 0;
    app.shooterNoise = { position: this.owner.position.clone(), time: this.lastShotTime, owner: this.owner };
    if (def.hitscan) {
      for (let k = 0; k < def.pellets; k++) {
        const dir = def.pellets > 1 ? coneDirection(center, def.spread.pellet * DEG, rnd) : center;
        const h = hitscan(app.physics, muzzle, dir, def.range, targets, { ignore: this.owner });
        const end = h ? h.point : muzzle.clone().addScaledVector(dir, Math.min(def.range, 120));
        if (def.tracer && (def.pellets > 1 ? k < 3 : shot.index % def.tracer.every === 0)) this.tracers.spawn(muzzle, end, { color: def.tracer.color, width: def.tracer.width });
        this._impact(h, dir, def);
      }
    } else if (def.projectile) {
      const pr = def.projectile;
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(pr.radius, 8, 6), new THREE.MeshBasicMaterial({ color: pr.color || 0xffa040 }));
      mesh.userData.noHitscan = true;
      this.projectiles.spawn({ position: muzzle.clone().addScaledVector(center, 0.2), velocity: center.clone().multiplyScalar(pr.speed), mesh, damage: def.damage, owner: this.owner, gravity: pr.gravity, life: pr.life, radius: pr.radius,
        onHit: (target, point) => this._explode(def, target, point) });
      app.vfx?.emit('smoke', muzzle.clone(), { count: 4, direction: center.clone().negate() });
    }
    // feedback
    if (app.vfx) app.vfx.emit('muzzle', muzzle, { direction: center, scale: def.flash });
    app.audio?.play(def.sound, { pos: muzzle, pitch: def.pitch * (0.96 + this.rng.next() * 0.08), volume: def.volume });
    const r = shot.recoil, m = this.aimBlend > 0.6 && def.recoil ? def.recoil.adsMult : 1;
    this.recoil.yaw += r.yaw * m; this.recoil.pitch += r.pitch * m; this.recoilDebt += r.pitch * m * (def.recoil?.recover ?? 0);
    this.emit('shot', { weapon: def.id, mag: st.mag, reserve: st.reserve, index: shot.index, muzzle });
  }
  _explode(def, direct, point) {
    const app = this.app, sp = def.projectile.splash;
    if (direct) this._damage(direct, def.damage * this.damageMult, 'body', point, V().subVectors(direct.position, point).setY(0).normalize(), def, 0);
    if (sp) {
      for (const t of this._targets()) {
        const c = t.position.clone().setY(t.position.y + 1), d = c.distanceTo(point); if (d > sp.radius) continue;
        const dmg = sp.damage * (1 + (sp.min - 1) * d / sp.radius) * this.damageMult;
        const dir = c.clone().sub(point).setY(0); if (dir.lengthSq() < 1e-4) dir.set(0, 0, 1); dir.normalize();
        this._damage(t, dmg, 'body', c, dir, def, d, { knockback: def.knockback * (1 - d / sp.radius), up: 3 });
      }
      for (const b of app.physics.bodies || []) { const d = b.position.distanceTo(point); if (d < sp.radius) app.physics.applyImpulse(b, b.position.clone().sub(point).normalize().multiplyScalar(12 * (1 - d / sp.radius) * b.mass)); }
    }
    app.vfx?.emit('fire', point, { count: 30, scale: 2.5 }); app.vfx?.emit('smoke', point, { count: 14, scale: 2 }); app.vfx?.emit('debris', point, { count: 18 });
    app.audio?.play('explosion', { pos: point }); app.shake?.(0.5);
    this.emit('explode', { point, weapon: def.id });
  }
  _damage(target, amount, zone, point, dir, def, distance, extra = {}) {
    const wasDead = target.health?.dead;
    const isPlayer = target.tags?.has?.('player');
    const info = { source: this.owner, zone, weapon: def.id, point, hitDirection: dir, knockback: def.knockback, up: 0, stagger: def.stagger, noStagger: isPlayer || def.stagger <= 0, direction: isPlayer ? undefined : dir, ...extra };
    const dealt = applyDamage(target, amount, info);
    const kill = !wasDead && !!target.health?.dead;
    this.stats.hits++; this.stats.damage += dealt; if (zone === 'head') this.stats.headshots++; if (kill) this.stats.kills++;
    if (this.owner.stats) { this.owner.stats.damageDealt = (this.owner.stats.damageDealt || 0) + dealt; if (kill) this.owner.stats.kills = (this.owner.stats.kills || 0) + 1; }
    this.emit('hit', { target, damage: dealt, zone, point, distance, kill, weapon: def.id });
    if (kill) { this.emit('kill', { target, zone, weapon: def.id }); if (this.owner.tags?.has?.('player') && target.tags?.has?.('enemy')) this.app.events?.emit('enemy:killed', { enemy: target }); }
    return dealt;
  }
  _impact(h, dir, def) {
    if (!h) return;
    const app = this.app;
    if (h.kind === 'actor') {
      const dmg = damageAtDistance(def, h.distance) * zoneMultiplier(def, h.zone) * this.damageMult;
      this._damage(h.target, dmg, h.zone, h.point, dir.clone().setY(0).normalize(), def, h.distance);
      if (h.target.tags?.has?.('target')) app.vfx?.emit('sparks', h.point, { count: 5, direction: h.normal });
      else app.vfx?.emit('blood', h.point, { direction: dir });
      return;
    }
    app.vfx?.emit('impact', h.point, { direction: h.normal });
    if (h.kind !== 'terrain') app.vfx?.emit('sparks', h.point, { count: 3, direction: h.normal });
    if (this.rng.next() < 0.35) app.audio?.play('bulletImpact', { pos: h.point, pitch: 0.8 + this.rng.next() * 0.5, volume: 0.6 });
    if (h.kind === 'body' && h.shape) app.physics.applyImpulse(h.shape, dir.clone().multiplyScalar(def.impulse), h.point);
    this.emit('impact', { point: h.point, normal: h.normal, kind: h.kind, shape: h.shape });
  }
  toJSON() { return { index: this.index, slots: this.slots.map((s) => s.toJSON()) }; }
  load(d) { d.slots?.forEach((s, i) => { if (this.slots[i]) { this.slots[i].mag = s.mag; this.slots[i].reserve = s.reserve ?? Infinity; } }); if (d.index != null) this.equip(d.index, { instant: true }); }
}

// ---------------------------------------------------------------- 5. ShootingTarget
/** Practice / pop-up target: a plate on a post with head + body zones. Falls on kill and
 * resets after resetTime (0 = stays down). Usable anywhere an actor target is expected. */
export class ShootingTarget {
  constructor(app, { position = V(), facing = 0, hp = 100, resetTime = 3, size = 1, color = 0xd8d2c4, name = 'Target' } = {}) {
    this.app = app; this.name = name; this.tags = new Set(['target']); this.alive = true; this.resetTime = resetTime; this.size = size;
    this.position = position.clone(); this.facing = facing; this.radius = 0.35 * size;
    this.listeners = {};
    this.health = new Health(hp, { onDeath: () => this._down(), onDamage: (a, info) => this.emit('damage', { amount: a, info }) });
    const g = new THREE.Group(); g.position.copy(this.position); g.rotation.y = facing;
    const plateMat = new THREE.MeshStandardMaterial({ color, roughness: 0.8 }), ring = new THREE.MeshStandardMaterial({ color: 0xc0302a, roughness: 0.6 });
    const pivot = new THREE.Group(); pivot.position.y = 0.05; g.add(pivot);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.9 * size, 0.06), new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.7 })); post.position.y = 0.45 * size; pivot.add(post);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.55 * size, 0.7 * size, 0.04), plateMat); body.position.y = 1.15 * size; pivot.add(body);
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.15 * size, 0.15 * size, 0.04, 20).rotateX(Math.PI / 2), plateMat); head.position.y = 1.68 * size; pivot.add(head);
    const bull = new THREE.Mesh(new THREE.CylinderGeometry(0.1 * size, 0.1 * size, 0.045, 20).rotateX(Math.PI / 2), ring); bull.position.y = 1.2 * size; pivot.add(bull);
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.userData.actor = this; } });
    this.model = g; this.pivot = pivot; app.scene.add(g);
    this.downT = 0; this.fall = 0; this.hits = 0;
  }
  on(e, f) { (this.listeners[e] ||= []).push(f); }
  emit(e, d) { for (const f of this.listeners[e] || []) f(d); }
  hitboxes() {
    if (!this.alive) return [];
    const s = this.size, p = this.position, c = Math.cos(this.facing), sn = Math.sin(this.facing);
    const hw = 0.3 * s, hd = 0.06; const ex = Math.abs(c) * hw + Math.abs(sn) * hd, ez = Math.abs(sn) * hw + Math.abs(c) * hd;
    return [
      { type: 'sphere', zone: 'head', center: V(p.x, p.y + 1.73 * s, p.z), r: 0.15 * s },
      { type: 'box', zone: 'body', min: V(p.x - ex, p.y + 0.85 * s, p.z - ez), max: V(p.x + ex, p.y + 1.55 * s, p.z + ez) },
    ];
  }
  receive(amount, info) { const d = this.health.damage(amount, info); if (d > 0) { this.hits++; this.emit('hit', { amount: d, zone: info.zone }); } return d; }
  _down() { this.alive = false; this.downT = this.resetTime; this.emit('death', {}); this.app.audio?.play('clang', { pos: this.position, pitch: 0.8 }); }
  reset() { this.health.revive(1); this.alive = true; this.emit('reset', {}); }
  update(dt) {
    this.fall = damp(this.fall, this.alive ? 0 : 1, 10, dt);
    this.pivot.rotation.x = -this.fall * Math.PI / 2;
    if (!this.alive && this.resetTime > 0) { this.downT -= dt; if (this.downT <= 0) this.reset(); }
  }
  remove() { this.app.scene.remove(this.model); }
}

// ---------------------------------------------------------------- 6. ShooterController (player)
/** Drives a GF.Player as a shooter. Call shooter.control(dt) instead of player.control(dt). */
export class ShooterController {
  constructor(app, player, { weapons = ['rifle', 'pistol'], ammo = {}, targets = () => player.targets(), view = 'third', cover = true, hud = true, aimToggle = false,
    aimAssist = { strength: 0, angle: 6, friction: 0.5, magnetism: 0 }, adsSensitivity = 0.6, firstPerson = {}, colors = {} } = {}) {
    this.app = app; this.player = player;
    this.weapons = new WeaponSystem(app, player, { weapons, ammo, targets, colors, seed: 99 });
    this.cover = cover === true ? new CoverSystem(app.physics) : cover || null;
    this.aimToggle = aimToggle; this.aimAssist = { strength: 0, angle: 6, friction: 0.5, magnetism: 0, ...aimAssist }; this.adsSensitivity = adsSensitivity;
    this.tpCam = player.cam;
    this.fpCam = new FirstPersonCamera(app.camera, { height: (player.ctrl.height || 1.75) * 0.93, fov: 72, ...firstPerson });
    app.cameraRigs = [...(app.cameraRigs || []), this.fpCam];
    if (!app.camera.parent) app.scene.add(app.camera);
    this.view = 'third'; this.aiming = false; this._aimLatch = false; this.sinceFire = 99;
    this.coverState = null; // { face, low, peeking, peekPos, home }
    this.viewmodels = this.weapons.slots.map((s) => {
      if (!s.def.model) return null;
      const vm = weaponModel(s.def.model, colors); vm.visible = false; vm.rotation.y = Math.PI;
      vm.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.renderOrder = 8; } });
      app.camera.add(vm); return vm;
    });
    this.vmKick = 0;
    this.weapons.on('shot', () => { this.sinceFire = 0; this.vmKick = Math.min(1, this.vmKick + 0.6); });
    this.weapons.on('hit', (e) => { this.hud?.reticle.hit(e.kill ? 'kill' : e.zone === 'head' ? 'head' : 'hit'); if (e.damage > 0) { const s = UI.project(e.point, app.camera); if (s.visible && e.target.tags?.has?.('enemy')) app.ui.damageNumber(s.x, s.y, e.damage, e.zone === 'head'); app.audio.play('hitMarker', { volume: 0.5, pitch: e.zone === 'head' ? 1.3 : 1 }); } });
    this.weapons.on('equip', (e) => { this.weapons.current.model && (this.weapons.current.model.visible = this.view === 'third'); this.viewmodels.forEach((v, i) => v && (v.visible = this.view === 'first' && i === e.index)); });
    if (hud && app.ui.reticle) {
      this.hud = { reticle: app.ui.reticle(), ammo: app.ui.ammoCounter(), hits: app.ui.hitIndicator() };
      player.on('damage', ({ info }) => { const d = info?.hitDirection; if (d) { const a = Math.atan2(-d.x, -d.z) - Math.atan2(-Math.sin(this.rig.yaw), -Math.cos(this.rig.yaw)); this.hud.hits.show(-a); } });
    }
    this.setView(view);
  }
  get rig() { return this.view === 'first' ? this.fpCam : this.tpCam; }
  get inCover() { return !!this.coverState; }
  setView(v) {
    if (v === this.view && this.player.cam === this.rig) return;
    const from = this.rig; this.view = v; const to = this.rig;
    to.yaw = from.yaw; to.pitch = clamp(v === 'first' ? from.pitch * 0.5 : Math.max(0.05, from.pitch), to.minPitch, to.maxPitch);
    this.player.cam = to;
    const fp = v === 'first';
    this.player.model.visible = !fp;
    this.weapons.muzzleOverride = fp ? () => { const vm = this.viewmodels[this.weapons.index]; if (!vm) return this.app.camera.position.clone(); vm.updateWorldMatrix(true, true); return weaponSocketWorld(vm, 'muzzle'); } : null;
    this.viewmodels.forEach((vm, i) => vm && (vm.visible = fp && i === this.weapons.index));
    const m = this.weapons.current.model; if (m) m.visible = !fp;
  }
  // ---- cover
  enterCover() {
    if (!this.cover) return false;
    const p = this.player, f = this.cover.find(p.position, { radius: 2.2, preferDir: this.rig.groundForward() });
    if (!f) return false;
    this.coverState = { face: f, low: f.low, peeking: false, home: f.snap.clone(), snapping: true, away: 0 };
    p.crouching = f.low; this.app.audio.play('land', { pos: p.position, volume: 0.5 });
    this.weapons.emit('cover', { enter: true, low: f.low });
    return true;
  }
  exitCover() { if (!this.coverState) return; this.coverState = null; this.player.crouching = false; this.player.forcedOverride = null; this.player.moveFilter = null; this.weapons.emit('cover', { enter: false }); }
  _coverFilter(dir, speed, dt) {
    const cs = this.coverState, f = cs.face, p = this.player.position;
    // keep the face up to date (slide along it)
    const nf = this.cover.face(f.shape, p.x, p.z); if (nf) { this.cover.decorate(nf); cs.face = Object.assign(f, nf); }
    const target = cs.peeking && cs.peekPos ? cs.peekPos : null;
    if (cs.snapping || target) {
      const goal = target || (cs.snapping ? cs.face.snap : null);
      const to = V(goal.x - p.x, 0, goal.z - p.z), d = to.length();
      if (d < 0.06) { cs.snapping = false; return { dir: V(), speed: 0 }; }
      return { dir: to.normalize(), speed: Math.min(7, d * 12) };
    }
    if (speed < 0.01) { // hold to the wall
      const gap = V(cs.face.snap.x - p.x, 0, cs.face.snap.z - p.z); const d = gap.length();
      return d > 0.05 ? { dir: gap.normalize(), speed: Math.min(2, d * 8) } : { dir: V(), speed: 0 };
    }
    const away = dir.dot(cs.face.normal);
    cs.away = away > 0.75 ? cs.away + dt : 0;
    if (cs.away > 0.25) { this.exitCover(); return { dir, speed }; }
    let t = dir.dot(cs.face.tangent);
    if ((t > 0 && cs.face.distRight < 0.25) || (t < 0 && cs.face.distLeft < 0.25)) t = 0; // stop at the edge
    const out = cs.face.tangent.clone().multiplyScalar(t);
    const gap = V(cs.face.snap.x - p.x, 0, cs.face.snap.z - p.z); out.addScaledVector(gap, 4);
    const l = out.length(); if (l < 1e-3) return { dir: V(), speed: 0 };
    return { dir: out.divideScalar(l), speed: Math.min(speed, 2.6) * Math.min(1, Math.abs(t) + 0.2) };
  }
  _updateCoverPose() {
    const cs = this.coverState, p = this.player;
    if (!cs) { p.moveFilter = null; if (p.forcedOverride === 'crouch') p.forcedOverride = null; return; }
    const exposing = this.aiming || this.sinceFire < 0.4;
    if (cs.low) { p.crouching = !exposing; cs.peeking = false; }
    else {
      if (exposing && !cs.peeking) { const e = this.cover.nearEdge(cs.face, 1.0); if (e) { cs.peeking = true; cs.peekPos = this.cover.peekPosition(cs.face, 1.0); this.tpCam.shoulderSide = e.side * (cs.face.tangent.dot(this.tpCam.groundRight()) >= 0 ? 1 : -1); } }
      if (!exposing && cs.peeking) { cs.peeking = false; cs.peekPos = null; cs.snapping = true; }
      p.crouching = false;
    }
    p.forcedOverride = p.crouching ? 'crouch' : null;
    p.moveFilter = (dir, speed, dt) => this._coverFilter(dir, speed, dt);
  }
  // ---- aim assist (accessibility / gamepad): snap on ADS start + friction near targets
  _assist(justAimed) {
    const a = this.aimAssist; if (!a.strength) return 1;
    const cam = this.app.camera, fwd = cam.getWorldDirection(V()), eye = cam.position;
    let best = null, bestAng = a.angle * DEG;
    for (const t of this.weapons._targets()) {
      const hb = actorHitboxes(t).find((h) => h.zone === 'body') || actorHitboxes(t)[0]; if (!hb) continue;
      const c = hb.type === 'sphere' ? hb.center : hb.type === 'box' ? hb.min.clone().add(hb.max).multiplyScalar(0.5) : V(hb.x, (hb.y0 + hb.y1) / 2, hb.z);
      const to = c.clone().sub(eye); const ang = to.angleTo(fwd);
      if (ang < bestAng) { const hit = this.app.physics.raycast(eye, to.clone().normalize(), to.length(), { bodies: false }); if (!hit || hit.distance > to.length() - 0.3) { bestAng = ang; best = to.normalize(); } }
    }
    if (!best) return 1;
    if (justAimed) { // rotate the rig towards the target
      const wantYaw = Math.atan2(-best.x, -best.z), wantPitch = -Math.asin(clamp(best.y, -1, 1));
      const r = this.rig; r.yaw += wrapAngle(wantYaw - r.yaw) * a.strength;
      if (this.view === 'first') r.pitch += (wantPitch - r.pitch) * a.strength;
    }
    return 1 - a.friction * a.strength;
  }
  control(dt) {
    const app = this.app, input = app.input, p = this.player, w = this.weapons;
    if (!p.alive) { w.setTrigger(false); p.aimFacing = null; p.control(dt); w.update(dt); this._hud(); return; }
    // switching / view / shoulder
    for (let i = 1; i <= 4; i++) if (input.pressed('weapon' + i)) w.equip(i - 1);
    if (input.pressed('weaponNext') || input.wheel > 0) w.next(1); else if (input.pressed('weaponPrev') || input.wheel < 0) w.next(-1);
    if (input.pressed('camera')) this.setView(this.view === 'first' ? 'third' : 'first');
    if (input.pressed('shoulderSwap')) this.tpCam.shoulderSide = -(this.tpCam.shoulderSide || 1);
    if (input.pressed('reload')) w.reload();
    if (input.pressed('cover') && this.cover) { if (this.coverState) this.exitCover(); else this.enterCover(); }
    if (this.coverState && (input.pressed('jump') || input.held('sprint') && input.moveVector().y > 0.5 && !this.coverState.low)) this.exitCover();
    // aim
    const wasAiming = this.aiming;
    if (this.aimToggle) { if (input.pressed('aim')) this._aimLatch = !this._aimLatch; this.aiming = this._aimLatch; } else this.aiming = input.held('aim');
    if (w.reloading && w.def.adsSpeed < 0.5) this.aiming = false;
    const firing = input.held('fire');
    this.sinceFire += dt;
    this._updateCoverPose();
    w.setAim(this.aiming);
    this.tpCam.aiming = this.aiming; this.tpCam.aimFovOverride = w.def.adsFov; this.fpCam.aiming = this.aiming; this.fpCam.aimFov = w.def.adsFov;
    const engaged = this.aiming || firing || this.sinceFire < 0.8 || this.view === 'first';
    p.aimFacing = engaged ? this.rig.yaw + Math.PI : null;
    p.speedScale = (this.aiming ? w.def.adsSpeed : 1) * w.def.moveSpeed;
    p.lookScale = (this.aiming ? this.adsSensitivity * (w.def.adsFov / 45) ** 0.5 : 1) * this._assist(this.aiming && !wasAiming);
    p.upperPose = this.view === 'first' ? null : engaged ? w.def.pose : w.def.hold;
    p.control(dt);
    // aim ray from the camera, started level with the player so nothing behind them is hit
    const cam = app.camera, dir = cam.getWorldDirection(V()), origin = cam.position.clone();
    const eye = p.position.clone().setY(p.position.y + (p.crouching ? 1.0 : 1.55));
    origin.addScaledVector(dir, Math.max(0, eye.clone().sub(origin).dot(dir)));
    w.aim.origin.copy(origin); w.aim.dir.copy(dir);
    if (this.aimAssist.magnetism > 0 && this.aimAssist.strength > 0) this._magnetism(w);
    w.moving = clamp(p.ctrl.horizontalSpeed() / p.ctrl.runSpeed, 0, 1); w.airborne = !p.ctrl.grounded; w.crouched = !!p.crouching;
    w.setTrigger(firing && !(this.coverState?.snapping) && !(this.coverState?.peeking && this.coverState.peekPos && p.position.distanceTo(this.coverState.peekPos) > 0.3));
    w.update(dt);
    if (w.recoil.yaw || w.recoil.pitch) this.rig.look(w.recoil.yaw, -w.recoil.pitch);
    this._viewmodel(dt);
    this._hud();
  }
  _magnetism(w) {
    const h = w.aimHit; if (h && h.kind === 'actor') return;
    const a = this.aimAssist, max = a.magnetism * DEG; let best = null, bd = max;
    for (const t of w._targets()) for (const hb of actorHitboxes(t)) {
      if (hb.zone !== 'body') continue;
      const c = hb.type === 'box' ? hb.min.clone().add(hb.max).multiplyScalar(0.5) : hb.type === 'sphere' ? hb.center : V(hb.x, (hb.y0 + hb.y1) / 2, hb.z);
      const ang = c.clone().sub(w.aim.origin).angleTo(w.aim.dir); if (ang < bd) { bd = ang; best = c; }
    }
    if (best) w.aim.dir.lerp(best.clone().sub(w.aim.origin).normalize(), a.strength).normalize();
  }
  _viewmodel(dt) {
    if (this.view !== 'first') return;
    const vm = this.viewmodels[this.weapons.index]; if (!vm) return;
    const st = this.weapons.current, a = this.weapons.aimBlend, sp = this.player.ctrl.horizontalSpeed();
    this.vmKick = damp(this.vmKick, 0, 14, dt);
    this.vmBob = (this.vmBob || 0) + dt * sp * 1.6;
    const bob = Math.sin(this.vmBob) * 0.008 * Math.min(1, sp / 4) * (1 - a * 0.8);
    const sight = vm.userData.sockets?.sight || [0, 0.17, -0.05];
    const hip = V(0.17, -0.19, -0.42), ads = V(-sight[0], -(sight[1] + 0.035), -0.36); // eye just above the sight line
    const pos = hip.lerp(ads, a); pos.y += bob - (st.reloading ? 0.12 : 0) - (st.equipT > 0 ? st.equipT * 0.5 : 0); pos.z += this.vmKick * 0.05;
    vm.position.copy(pos); vm.rotation.set(this.vmKick * 0.08 + (st.reloading ? -0.5 : 0), Math.PI, 0);
  }
  _hud() {
    if (!this.hud) return;
    const w = this.weapons, st = w.current, cam = this.app.camera;
    const px = Math.tan(w.currentSpread()) / Math.tan(cam.fov * DEG / 2) * (innerHeight / 2);
    this.hud.reticle.set({ gap: 3 + px, visible: this.player.alive && !(this.view === 'first' && w.aimBlend > 0.9 && st.def.adsFov < 25), ads: w.aimBlend > 0.6, scope: this.view !== 'third' && w.aimBlend > 0.9 && st.def.adsFov < 25 });
    this.hud.ammo.set({ name: st.def.name, mag: st.mag, magSize: st.def.magazine, reserve: st.reserve, reload: st.reloadProgress });
  }
  debug() {
    const w = this.weapons, st = w.current;
    return { weapon: st.def.id, ammo: st.mag, reserve: st.reserve, reloading: st.reloading, weaponState: st.state, aiming: this.aiming, aimBlend: +w.aimBlend.toFixed(2), view: this.view, fov: +this.app.camera.fov.toFixed(1),
      inCover: this.inCover, coverLow: this.coverState?.low ?? null, peeking: !!this.coverState?.peeking, crouching: !!this.player.crouching, shots: w.stats.shots, hits: w.stats.hits, headshots: w.stats.headshots, kills: w.stats.kills };
  }
}
