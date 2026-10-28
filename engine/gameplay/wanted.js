// Generic heat / wanted system (police in a modern city, guards in a fantasy town, security
// drones in sci-fi): crimes add heat, heat maps to levels 0..maxLevel, each level fields more
// pursuers (spawned/despawned through callbacks), pursuers chase on sight and search the last
// known position otherwise; breaking line of sight long enough starts a cooldown that lowers
// the level. Pure logic + callbacks so it works with any actor type; HUD stars via app.ui.stars.
import * as THREE from '../vendor/three/three.module.js';
import { RNG } from '../core/rng.js';
import { Steering } from '../ai/behavior.js';

// Heat added per crime (witnessed). Games add their own: wanted.crimes.poaching = 0.8.
export const CRIMES = { trespass: 0.4, vandalism: 0.6, theft: 0.8, assault: 1.2, vehicleTheft: 1.5, shooting: 2.2, assaultOfficer: 2.6, murder: 3.2, killOfficer: 4.5 };
// Heat needed to reach each level (index = level).
export const WANTED_LEVELS = [0, 1, 3, 6, 10, 15];

export function levelForHeat(heat, levels = WANTED_LEVELS) { let l = 0; for (let i = 1; i < levels.length; i++) if (heat >= levels[i]) l = i; return l; }

/**
 * Pursuit target selection (pure). Returns one assignment per unit:
 *   { unit, mode: 'chase' | 'flank' | 'search' | 'converge', goal: Vector3 }
 * seen: the target is visible to at least one unit. Nearest `closeIn` units chase the target,
 * the rest take flanking points spread around it (cut off escape routes); when unseen, the
 * nearest unit converges on the last known position and the others search points around it.
 */
export function assignPursuit(units, targetPos, lastKnown, { seen = true, closeIn = 2, flank = 7, searchRadius = 14, seed = 1 } = {}) {
  const rng = new RNG(seed);
  const ref = seen ? targetPos : lastKnown || targetPos;
  const order = units.map((u) => ({ u, d: Math.hypot(u.position.x - ref.x, u.position.z - ref.z) })).sort((a, b) => a.d - b.d);
  const out = [];
  const base = rng.range(0, Math.PI * 2);
  order.forEach(({ u }, i) => {
    if (seen) {
      if (i < closeIn) out.push({ unit: u, mode: 'chase', goal: new THREE.Vector3(targetPos.x, 0, targetPos.z) });
      else {
        // flank slots: angles spread evenly around the target, offset from the unit's own approach
        const k = i - closeIn, n = Math.max(1, order.length - closeIn);
        const approach = Math.atan2(u.position.x - targetPos.x, u.position.z - targetPos.z);
        const a = approach + Math.PI + ((k + 1) / (n + 1) - 0.5) * Math.PI * 1.4;
        out.push({ unit: u, mode: 'flank', goal: new THREE.Vector3(targetPos.x + Math.sin(a) * flank, 0, targetPos.z + Math.cos(a) * flank) });
      }
    } else if (i === 0) out.push({ unit: u, mode: 'converge', goal: new THREE.Vector3(ref.x, 0, ref.z) });
    else {
      const a = base + (i / Math.max(1, order.length - 1)) * Math.PI * 2;
      out.push({ unit: u, mode: 'search', goal: new THREE.Vector3(ref.x + Math.sin(a) * searchRadius, 0, ref.z + Math.cos(a) * searchRadius) });
    }
  });
  return out;
}

/**
 * WantedSystem
 *   new WantedSystem({ spawn(pos, i) -> unit{position}, despawn(unit), canSee(unit, target) -> bool,
 *                      events (EventBus), unitsPerLevel, levels, cooldown(level) -> s, spawnRadius })
 *   .commit('assault', { position, witnessed })      crime -> heat -> level
 *   .update(dt, target)                                sight, cooldown, spawning, assignments
 * States: 'clear' | 'pursuit' (target seen recently) | 'search' (lost sight, cooldown running).
 */
export class WantedSystem {
  constructor({ levels = WANTED_LEVELS, crimes = {}, maxLevel = levels.length - 1, unitsPerLevel = [0, 2, 3, 5, 7, 9], cooldown = (lvl) => 6 + lvl * 3, unseenFactor = 0.3,
    spawnRadius = [28, 45], spawnPoint = null, spawn = null, despawn = null, canSee = null, sightRange = 35, events = null, decay = 'level', seed = 7, name = 'police', update = null } = {}) {
    this.levels = levels; this.crimes = { ...CRIMES, ...crimes };
    Object.assign(this, { maxLevel, unitsPerLevel, cooldown, unseenFactor, spawnRadius, spawnPoint, spawnFn: spawn, despawnFn: despawn, canSeeFn: canSee, sightRange, events, decay, name, unitUpdate: update });
    this.rng = new RNG(seed);
    this.heat = 0; this.level = 0; this.state = 'clear'; this.lastKnown = null; this.timer = 0; this.seenTime = 0; this.unseenTime = 0;
    this.units = []; this.assignments = [];
    this.history = []; this.stats = { crimes: 0, spawned: 0, despawned: 0, peakLevel: 0, lostCount: 0 };
  }
  _emit(type, data) { this.events?.emit?.(type, { system: this.name, level: this.level, heat: this.heat, ...data }); }
  /** Register a crime. witnessed=false adds only `unseenFactor` of the heat (nobody saw it). */
  commit(crime, { position = null, witnessed = true, heat = null } = {}) {
    const base = heat ?? (typeof crime === 'number' ? crime : this.crimes[crime] ?? 1);
    const add = base * (witnessed ? 1 : this.unseenFactor);
    this.stats.crimes++; this.history.push({ crime, add, witnessed });
    this.heat = Math.min(this.levels[this.maxLevel] + 5, this.heat + add);
    const lvl = Math.min(this.maxLevel, levelForHeat(this.heat, this.levels));
    this._emit('wanted:crime', { crime, add, witnessed });
    if (witnessed && position) this.lastKnown = new THREE.Vector3(position.x, 0, position.z);
    if (lvl > this.level) this._setLevel(lvl, 'crime');
    if (this.level > 0 && witnessed) { this.state = 'pursuit'; this.timer = this.cooldown(this.level); this.unseenTime = 0; }
    return this.level;
  }
  setLevel(n, { position } = {}) { if (position) this.lastKnown = new THREE.Vector3(position.x, 0, position.z); this.heat = this.levels[Math.max(0, Math.min(this.maxLevel, n))]; this._setLevel(Math.min(this.maxLevel, n), 'set'); if (n > 0) { this.state = 'pursuit'; this.timer = this.cooldown(this.level); } }
  clear() { this.heat = 0; this._setLevel(0, 'clear'); }
  _setLevel(n, reason) {
    const prev = this.level; this.level = n; this.stats.peakLevel = Math.max(this.stats.peakLevel, n);
    if (n === 0) { this.state = 'clear'; this.heat = Math.min(this.heat, this.levels[1] * 0.5); }
    if (n !== prev) this._emit('wanted:level', { from: prev, to: n, reason });
    if (n === 0 && prev > 0) this._emit('wanted:clear', {});
  }
  // Default line of sight: distance + optional physics raycast (eye height 1.6 m).
  canSee(unit, target) {
    if (this.canSeeFn) return this.canSeeFn(unit, target);
    return Math.hypot(unit.position.x - target.position.x, unit.position.z - target.position.z) < this.sightRange;
  }
  _spawnPos(center) {
    if (this.spawnPoint) return this.spawnPoint(center, this.rng);
    const a = this.rng.range(0, Math.PI * 2), r = this.rng.range(...this.spawnRadius);
    return new THREE.Vector3(center.x + Math.sin(a) * r, 0, center.z + Math.cos(a) * r);
  }
  update(dt, target) {
    const tp = target?.position;
    // --- sight & cooldown ---
    if (this.level > 0 && tp) {
      const seen = this.units.some((u) => u.alive !== false && this.canSee(u, target));
      if (seen) {
        if (this.state !== 'pursuit') this._emit('wanted:spotted', {});
        this.state = 'pursuit'; this.lastKnown = new THREE.Vector3(tp.x, 0, tp.z); this.timer = this.cooldown(this.level); this.unseenTime = 0; this.seenTime += dt;
      } else {
        this.unseenTime += dt;
        if (this.state === 'pursuit' && (this.units.length > 0 || this.unseenTime > 1)) { this.state = 'search'; this.stats.lostCount++; this._emit('wanted:lost', {}); }
        if (this.state === 'search') {
          this.timer -= dt;
          if (this.timer <= 0) {
            const next = this.decay === 'clear' ? 0 : this.level - 1;
            this.heat = this.levels[next]; this._setLevel(next, 'cooldown');
            if (next > 0) this.timer = this.cooldown(next);
          }
        }
      }
    }
    // --- spawn / despawn to the level's quota ---
    const quota = this.unitsPerLevel[this.level] ?? this.unitsPerLevel[this.unitsPerLevel.length - 1];
    const center = this.lastKnown || tp;
    if (this.spawnFn && center) while (this.units.filter((u) => u.alive !== false).length < quota) {
      const u = this.spawnFn(this._spawnPos(center), this.units.length); if (!u) break;
      this.units.push(u); this.stats.spawned++;
    }
    const alive = this.units.filter((u) => u.alive !== false);
    if (alive.length > quota) {
      // retire the furthest units that cannot see the target
      const extra = alive.filter((u) => !tp || !this.canSee(u, target)).sort((a, b) => (tp ? b.position.distanceTo(tp) - a.position.distanceTo(tp) : 0)).slice(0, alive.length - quota);
      for (const u of extra) this._remove(u);
    }
    for (const u of this.units.filter((x) => x.alive === false && x.removeWhenDead !== false)) this._remove(u);
    // --- assignments ---
    if (this.units.length && tp) {
      this.assignments = assignPursuit(this.units.filter((u) => u.alive !== false), tp, this.lastKnown, { seen: this.state === 'pursuit', seed: Math.floor(this.timer) });
      for (const a of this.assignments) { a.unit.mode = a.mode; a.unit.goal = a.goal; this.unitUpdate?.(a.unit, dt, a); }
    } else this.assignments = [];
    return this.level;
  }
  _remove(u) { const i = this.units.indexOf(u); if (i >= 0) this.units.splice(i, 1); this.despawnFn?.(u); this.stats.despawned++; }
  // Steering helper for simple pursuers: desired velocity toward the unit's goal.
  static steer(unit, { speed = 4.5, chaseSpeed = 5.5, stop = 1.2 } = {}) {
    if (!unit.goal) return new THREE.Vector3();
    const sp = unit.mode === 'chase' ? chaseSpeed : speed;
    return Steering.arrive(unit.position, unit.goal, sp, unit.mode === 'chase' ? stop : 2.5);
  }
  debug() { return { heat: +this.heat.toFixed(2), level: this.level, state: this.state, units: this.units.length, timer: +this.timer.toFixed(2), modes: this.assignments.map((a) => a.mode) }; }
}

// Raycast line-of-sight test for canSee: physics world + range + optional field of view.
export function lineOfSight(physics, { range = 35, eye = 1.6, fov = null } = {}) {
  return (unit, target) => {
    const a = unit.position, b = target.position, d = Math.hypot(b.x - a.x, b.z - a.z);
    if (d > range) return false;
    if (fov && unit.facing !== undefined && d > 3) { const ang = Math.atan2(b.x - a.x, b.z - a.z) - unit.facing; if (Math.abs(Math.atan2(Math.sin(ang), Math.cos(ang))) > fov / 2) return false; }
    if (!physics) return true;
    const o = new THREE.Vector3(a.x, (a.y || 0) + eye, a.z), t = new THREE.Vector3(b.x, (b.y || 0) + 1.2, b.z), dir = t.clone().sub(o); const len = dir.length(); dir.normalize();
    const hit = physics.raycast(o, dir, len, { bodies: false });
    return !(hit && hit.distance < len - 0.5);
  };
}

// HUD: stars widget bound to a WantedSystem (flashes while the pursuers search).
export function wantedHUD(ui, wanted, { corner = 'tr', icon = '★', label = '' } = {}) {
  const w = ui.stars('wanted', { max: wanted.maxLevel, corner, icon, label });
  return { widget: w, update: () => w.set(wanted.level, { flash: wanted.state === 'search' }) };
}
