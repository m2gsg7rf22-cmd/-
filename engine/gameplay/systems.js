// Core gameplay systems: health/damage with i-frames and resistances, stamina, melee hit
// detection (arc sweeps) with combos, projectiles, inventory, XP/levels/skills, and a
// lightweight entity registry. All systems are serializable for SaveSystem.
import * as THREE from '../vendor/three/three.module.js';

export class Health {
  constructor(max = 100, { regen = 0, regenDelay = 3, armor = 0, onDeath, onDamage } = {}) {
    this.max = max; this.value = max; this.regen = regen; this.regenDelay = regenDelay; this.armor = armor;
    this.invulnerable = 0; this.sinceHit = 99; this.dead = false; this.onDeath = onDeath; this.onDamage = onDamage; this.shield = 0;
  }
  get ratio() { return this.value / this.max; }
  damage(amount, info = {}) {
    if (this.dead || this.invulnerable > 0) return 0;
    let a = Math.max(1, amount * (1 - this.armor));
    if (this.shield > 0) { const s = Math.min(this.shield, a); this.shield -= s; a -= s; }
    this.value = Math.max(0, this.value - a); this.sinceHit = 0;
    this.onDamage?.(a, info);
    if (this.value <= 0) { this.dead = true; this.onDeath?.(info); }
    return a;
  }
  heal(a) { if (this.dead) return; this.value = Math.min(this.max, this.value + a); }
  revive(ratio = 1) { this.dead = false; this.value = this.max * ratio; }
  update(dt) {
    this.invulnerable = Math.max(0, this.invulnerable - dt); this.sinceHit += dt;
    if (!this.dead && this.regen > 0 && this.sinceHit > this.regenDelay) this.heal(this.regen * dt);
  }
  toJSON() { return { max: this.max, value: this.value }; }
  load(d) { this.max = d.max; this.value = d.value; this.dead = this.value <= 0; }
}

export class Stamina {
  constructor(max = 100, regen = 25, delay = 0.8) { this.max = max; this.value = max; this.regen = regen; this.delay = delay; this.since = 0; }
  use(a) { if (this.value < a) return false; this.value -= a; this.since = 0; return true; }
  drain(rate, dt) { this.value = Math.max(0, this.value - rate * dt); this.since = 0; return this.value > 0; }
  update(dt) { this.since += dt; if (this.since > this.delay) this.value = Math.min(this.max, this.value + this.regen * dt); }
  get ratio() { return this.value / this.max; }
}

// Melee: test targets inside an arc in front of the attacker.
export function meleeSweep(origin, facing, targets, { range = 2.2, arc = Math.PI * 0.6, heightTolerance = 1.6 } = {}) {
  const hits = [];
  for (const t of targets) {
    if (!t.alive) continue;
    const to = new THREE.Vector3().subVectors(t.position, origin);
    if (Math.abs(to.y) > heightTolerance) continue; to.y = 0;
    const d = to.length(); if (d > range + (t.radius || 0.4)) continue;
    let ang = Math.atan2(to.x, to.z) - facing; while (ang > Math.PI) ang -= Math.PI * 2; while (ang < -Math.PI) ang += Math.PI * 2;
    if (Math.abs(ang) <= arc / 2 || d < 0.8) hits.push({ target: t, distance: d, direction: to.normalize() });
  }
  return hits.sort((a, b) => a.distance - b.distance);
}

// Combo chain with input buffering and timing windows.
export class ComboSystem {
  constructor(chain = ['attack1', 'attack2', 'attack3'], { window = 0.45, damage = [10, 12, 22] } = {}) { this.chain = chain; this.window = window; this.damage = damage; this.index = -1; this.timer = 0; this.buffered = false; }
  // call when attack pressed; returns clip name to play or null if buffered
  request(isBusy, progress) {
    if (isBusy && progress < 0.55) { this.buffered = true; return null; }
    this.index = this.timer > 0 ? (this.index + 1) % this.chain.length : 0;
    this.timer = this.window + 0.6; this.buffered = false;
    return this.chain[this.index];
  }
  consumeBuffer(isBusy, progress) { if (this.buffered && (!isBusy || progress > 0.55)) return this.request(false, 1); return null; }
  update(dt) { this.timer = Math.max(0, this.timer - dt); if (this.timer === 0) this.index = -1; }
  currentDamage() { return this.damage[Math.max(0, this.index)] ?? 10; }
}

export class ProjectileSystem {
  constructor(scene, world) { this.scene = scene; this.world = world; this.list = []; }
  spawn({ position, velocity, mesh, damage = 10, owner = null, gravity = 0, life = 4, radius = 0.25, onHit }) {
    const p = { position: position.clone(), velocity: velocity.clone(), mesh, damage, owner, gravity, life, radius, onHit };
    if (mesh) { mesh.position.copy(position); this.scene.add(mesh); }
    this.list.push(p); return p;
  }
  update(dt, targets = []) {
    for (const p of this.list) {
      p.life -= dt; p.velocity.y += p.gravity * dt;
      const step = p.velocity.clone().multiplyScalar(dt), len = step.length();
      const hit = this.world ? this.world.raycast(p.position, step.clone().normalize(), len, { bodies: false }) : null;
      if (hit) { p.onHit?.(null, hit.point, p); p.life = 0; }
      p.position.add(step);
      for (const t of targets) if (t !== p.owner && t.alive && t.position.clone().setY(t.position.y + 1).distanceTo(p.position) < (t.radius || 0.5) + p.radius) { p.onHit?.(t, p.position.clone(), p); p.life = 0; break; }
      if (p.mesh) { p.mesh.position.copy(p.position); if (len > 1e-4) p.mesh.lookAt(p.position.clone().add(p.velocity)); }
    }
    for (const p of this.list.filter((q) => q.life <= 0)) if (p.mesh) this.scene.remove(p.mesh);
    this.list = this.list.filter((q) => q.life > 0);
  }
}

export class Inventory {
  constructor(defs = {}) { this.items = {}; this.defs = defs; this.money = 0; this.onChange = null; }
  add(id, n = 1) { this.items[id] = (this.items[id] || 0) + n; this.onChange?.(id, this.items[id]); return this.items[id]; }
  remove(id, n = 1) { if ((this.items[id] || 0) < n) return false; this.items[id] -= n; if (!this.items[id]) delete this.items[id]; this.onChange?.(id, this.items[id] || 0); return true; }
  has(id, n = 1) { return (this.items[id] || 0) >= n; }
  count(id) { return this.items[id] || 0; }
  use(id, ctx) { const d = this.defs[id]; if (!d || !d.use || !this.has(id)) return false; d.use(ctx); if (d.consumable !== false) this.remove(id); return true; }
  list() { return Object.entries(this.items).map(([id, n]) => ({ id, n, ...(this.defs[id] || { name: id }) })); }
  toJSON() { return { items: this.items, money: this.money }; }
  load(d) { this.items = { ...d.items }; this.money = d.money || 0; }
}

export class Progression {
  constructor({ curve = (lvl) => Math.round(100 * Math.pow(lvl, 1.5)), skills = {} } = {}) { this.level = 1; this.xp = 0; this.curve = curve; this.skillPoints = 0; this.skills = skills; this.unlocked = new Set(); this.onLevel = null; }
  get next() { return this.curve(this.level); }
  addXP(n) { this.xp += n; let ups = 0; while (this.xp >= this.next) { this.xp -= this.next; this.level++; this.skillPoints++; ups++; this.onLevel?.(this.level); } return ups; }
  unlock(id) { const s = this.skills[id]; if (!s || this.unlocked.has(id) || this.skillPoints < (s.cost || 1) || (s.requires && !s.requires.every((r) => this.unlocked.has(r)))) return false; this.skillPoints -= s.cost || 1; this.unlocked.add(id); s.apply?.(); return true; }
  has(id) { return this.unlocked.has(id); }
  toJSON() { return { level: this.level, xp: this.xp, skillPoints: this.skillPoints, unlocked: [...this.unlocked] }; }
  load(d) { Object.assign(this, { level: d.level, xp: d.xp, skillPoints: d.skillPoints }); this.unlocked = new Set(d.unlocked); }
}

// Simple entity registry with tag queries and per-frame update.
export class Entities {
  constructor() { this.list = []; this.nextId = 1; }
  add(e) { e.id = e.id ?? this.nextId++; e.tags = new Set(e.tags || []); e.alive = e.alive ?? true; this.list.push(e); return e; }
  remove(e) { this.list = this.list.filter((x) => x !== e); }
  withTag(t) { return this.list.filter((e) => e.tags.has(t)); }
  alive(t) { return this.list.filter((e) => e.alive && (!t || e.tags.has(t))); }
  update(dt, ctx) { for (const e of [...this.list]) e.update?.(dt, ctx); }
  nearest(pos, tag, maxDist = Infinity) { let best = null, bd = maxDist; for (const e of this.alive(tag)) { const d = e.position.distanceTo(pos); if (d < bd) { bd = d; best = e; } } return best; }
}
