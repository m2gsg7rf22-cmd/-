// Ranged enemy AI for the shooter kit, built on engine/ai/behavior.js behaviour trees.
// Priorities (re-evaluated every tick): disabled → reload (hide first) → take cover (when
// exposed and a protected spot exists) → flank (after a stalemate) → peek-shoot from cover →
// open-ground engage (strafe + bursts at a preferred range) → patrol. Accuracy degrades with
// distance, own movement, target movement and warms up over a burst (first shots are fair
// warnings). Squads share a CoverSystem so cover spots are claimed, not stacked.
import * as THREE from '../vendor/three/three.module.js';
import { Enemy } from './actors.js';
import { bt, BehaviorTree, Steering, RUNNING, SUCCESS, FAILURE } from '../ai/behavior.js';
import { WeaponSystem, weaponDef } from './shooter.js';
import { CoverSystem } from './cover.js';
import { clamp } from '../core/rng.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const DEG = Math.PI / 180;

/** AI aim error cone (radians). skill 1 = baseline; lower is better aim. warmup 0..1. */
export function aiAimError({ distance = 10, moving = 0, targetSpeed = 0, warmup = 1, skill = 1, targetInCover = false } = {}) {
  const deg = skill * (0.5 + distance * 0.05) * (1 + 0.9 * clamp(moving, 0, 1)) * (1 + 0.1 * Math.min(targetSpeed, 8)) * (1.9 - 0.9 * clamp(warmup, 0, 1)) * (targetInCover ? 1.3 : 1);
  return deg * DEG;
}

export const RANGED_TYPES = {
  rifleman: { hp: 90, weapon: 'rifle', look: { outfit: 'armor', armor: true, top: 0x3a4a3a, bottom: 0x2a2f2a, accent: 0x6a7a5a, hairStyle: 'buzz', helmet: true },
    stats: { moveSpeed: 3.6, sight: 45, skill: 1, damageMult: 0.45, reaction: 0.45, hide: [1.1, 2.0], peek: [1.4, 2.4], flankAfter: 9, preferred: [10, 24], aggression: 0.4 } },
  gunner: { hp: 80, weapon: 'smg', look: { outfit: 'casual', coat: true, top: 0x2a2a3a, bottom: 0x1a1a22, hairStyle: 'short' },
    stats: { moveSpeed: 4.4, sight: 35, skill: 1.2, damageMult: 0.4, reaction: 0.35, hide: [0.8, 1.4], peek: [1.2, 2], flankAfter: 5, preferred: [5, 12], aggression: 0.8 } },
  marksman: { hp: 70, weapon: 'sniper', look: { outfit: 'robe', top: 0x3a3428, accent: 0x8a7a5a, hairStyle: 'ponytail' },
    stats: { moveSpeed: 3.2, sight: 70, skill: 0.55, damageMult: 0.35, reaction: 1.1, hide: [2, 3], peek: [1.6, 2.4], flankAfter: 99, preferred: [25, 60], aggression: 0.1 } },
  shotgunner: { hp: 110, weapon: 'shotgun', look: { outfit: 'armor', armor: true, top: 0x4a2a22, accent: 0x9a4a2a, hairStyle: 'mohawk' },
    stats: { moveSpeed: 4.6, sight: 30, skill: 1.1, damageMult: 0.35, reaction: 0.3, hide: [0.6, 1.0], peek: [0.8, 1.2], flankAfter: 3, preferred: [3, 8], aggression: 1 } },
};

export class RangedEnemy extends Enemy {
  constructor(app, opts = {}) {
    const kind = opts.type || 'rifleman', def = RANGED_TYPES[kind] || RANGED_TYPES.rifleman;
    super(app, { ...opts, type: 'grunt', weapon: null, hp: opts.hp ?? def.hp, look: { ...def.look, ...(opts.look || {}) }, stats: { ...def.stats, range: 0, ...(opts.stats || {}) } });
    this.type = kind; this.tags.add('ranged');
    this.cover = opts.cover || app.__coverSystem || (app.__coverSystem = new CoverSystem(app.physics));
    this.foes = opts.targets || (() => (this.target ? [this.target] : []));
    const wd = weaponDef(opts.weapon || def.weapon);
    this.weapons = new WeaponSystem(app, this, { weapons: [wd], ammo: { infinite: true }, targets: () => this.foes(), seed: (opts.seed ?? 5) * 13 + 1, damageMult: this.stats.damageMult, colors: opts.weaponColors });
    this.ai = { inCover: false, spot: null, phase: 'hide', timer: 0, aimT: 0, burstLeft: 0, burstShots: 0, coverT: 0, noLos: 0, flanked: false, searchT: 0, noCoverUntil: 0, suppressed: 0, lastDamage: -99, strafeDir: this.rng.sign(), visited: new Set() };
    this.shotsFired = 0; this.hitsOnTarget = 0;
    this.weapons.on('shot', () => { this.shotsFired++; this.ai.burstShots++; });
    this.weapons.on('hit', (e) => { if (e.target === this.target) this.hitsOnTarget++; });
    this.on('damage', () => { this.ai.suppressed = 1.2; this.ai.lastDamage = app.loop.time; this.perception.aware = 1; if (this.target) this.perception.lastSeen = this.target.position.clone(); });
    this.on('death', () => { this.cover.release(this); this.weapons.setTrigger(false); this.forcedOverride = null; this.crouching = false; });
  }
  // ---- helpers
  _eye(pos = this.position, crouch = this.crouching) { return V(pos.x, pos.y + (crouch ? 0.95 : 1.55), pos.z); }
  hasLos(from = this.position, crouch = false) {
    if (!this.target) return false;
    const a = this._eye(from, crouch), b = this.target.position.clone().setY(this.target.position.y + (this.target.crouching ? 0.85 : 1.3));
    const d = b.clone().sub(a), len = d.length(); d.divideScalar(len);
    const h = this.app.physics.raycast(a, d, len, { bodies: false });
    return !h || h.distance > len - 0.3;
  }
  _setState(s) { this.state = s; this.ai.visited.add(s); }
  _findSpot({ flank = false } = {}) {
    if (!this.target || this.app.loop.time < this.ai.noCoverUntil) return null;
    const t = this.target.position, pref = this.stats.preferred;
    const pts = this.cover.points(this.position, t, { radius: flank ? 22 : 16 });
    let best = null, bs = Infinity;
    const myAng = Math.atan2(this.position.x - t.x, this.position.z - t.z);
    for (const p of pts) {
      if (this.cover.claimedBy(p.position) && this.cover.claimedBy(p.position) !== this) continue;
      if (p.threatDistance < 3) continue;
      let s = p.distance + Math.max(0, pref[0] - p.threatDistance) * 1.5 + Math.max(0, p.threatDistance - pref[1]) * 0.6;
      if (flank) { const a = Math.atan2(p.position.x - t.x, p.position.z - t.z); let da = Math.abs(a - myAng); if (da > Math.PI) da = Math.PI * 2 - da; if (da < 40 * DEG) continue; s -= da * 4; }
      if (this.ai.spot && p.position.distanceTo(this.ai.spot.position) < 0.5 && flank) continue;
      if (s < bs) { bs = s; best = p; }
    }
    return best;
  }
  _aimAt(dt, { moving = 0 } = {}) {
    const t = this.target; if (!t) return;
    const chest = t.position.clone().setY(t.position.y + (t.crouching ? 0.75 : 1.2));
    const eye = this._eye(this.position, false);
    const dist = eye.distanceTo(chest);
    this.ai.aimT += dt;
    const err = aiAimError({ distance: dist, moving, targetSpeed: t.ctrl ? t.ctrl.horizontalSpeed() : 0, warmup: Math.min(1, this.ai.aimT / 1.2), skill: this.stats.skill, targetInCover: !!t.crouching });
    // re-roll the aim offset each shot so the error is a real spread, not a fixed bias
    if (!this._aimOff || this.ai.burstShots !== this._aimShot) { this._aimShot = this.ai.burstShots; const u = this.rng.next(), ph = this.rng.next() * Math.PI * 2, r = Math.tan(err) * Math.sqrt(u) * dist; this._aimOff = V(Math.cos(ph) * r, Math.sin(ph) * r * 0.7, Math.sin(ph) * r * 0.5); }
    const aimP = chest.add(this._aimOff);
    this.weapons.aim.origin.copy(eye); this.weapons.aim.dir.copy(aimP.sub(eye).normalize());
    this.faceTowards(t.position, dt, 10);
  }
  _burst(dt) { // returns true when the burst is complete
    const w = this.weapons, def = w.def, ai = this.ai;
    if (ai.burstLeft <= 0) { const [a, b] = def.ai.burst; ai.burstLeft = this.rng.int(a, b); ai.burstStart = ai.burstShots; }
    const fired = ai.burstShots - ai.burstStart;
    if (fired >= ai.burstLeft || w.mag === 0) { w.setTrigger(false); ai.burstLeft = 0; return true; }
    if (def.mode === 'auto') w.setTrigger(true);
    else w.setTrigger(!w.current.trigger && w.current.cooldown <= 0); // tap
    return false;
  }
  _buildTree() {
    const self = this, ai = () => self.ai;
    const aware = () => !!self.target && (self.perception.aware > 0.55 || self.app.loop.time - self.ai.lastDamage < 4);
    const stop = () => { self.weapons.setTrigger(false); };
    return new BehaviorTree(bt.sel(
      bt.cond(() => { if (!self.alive || self.stagger > 0) { stop(); self.state = self.alive ? 'stagger' : 'dead'; return true; } return false; }, 'disabled'),
      // reload (hide first when in cover)
      bt.seq(bt.cond(() => self.weapons.mag === 0 || self.weapons.reloading || (ai().inCover && ai().phase === 'hide' && self.weapons.mag < self.weapons.def.magazine * 0.3), 'needReload'),
        bt.act((c, dt) => {
          self._setState('reload'); stop(); self.move = V();
          if (ai().inCover) { self.crouching = !!ai().spot?.low; self._holdSpot(); }
          if (!self.weapons.reloading) self.weapons.reload();
          if (self.target) self.faceTowards(self.target.position, dt, 6);
          return self.weapons.reloading ? RUNNING : SUCCESS;
        }, 'reload')),
      // take cover when exposed
      bt.seq(bt.cond(() => aware() && self._needsCover(), 'exposed'),
        bt.act((c, dt, st) => {
          if (!st.spot) { st.spot = self._findSpot(); st.t = 0; if (!st.spot) { ai().noCoverUntil = self.app.loop.time + 2; return FAILURE; } self.cover.claim(st.spot.position, self); }
          st.t += dt; self._setState('takeCover'); self.crouching = false; ai().inCover = false;
          const to = st.spot.position.clone().sub(self.position).setY(0); const d = to.length();
          if (d < 0.35) { ai().spot = st.spot; ai().inCover = true; ai().phase = 'hide'; ai().timer = self.rng.range(...self.stats.hide) * 0.6; ai().coverT = 0; return SUCCESS; }
          if (st.t > 6) { ai().noCoverUntil = self.app.loop.time + 3; return FAILURE; }
          self.move = Steering.arrive(self.position, st.spot.position, self.stats.moveSpeed, 1.2);
          // run-and-gun with heavy movement penalty
          if (self.hasLos() && self.rng.next() < self.stats.aggression * 0.05 + 0.01) { self._aimAt(dt, { moving: 1 }); self._burst(dt); } else { stop(); self.faceTowards(self.position.clone().add(to), dt, 10); }
          return RUNNING;
        }, 'takeCover')),
      // flank after a stalemate
      bt.seq(bt.cond(() => aware() && ai().inCover && ai().coverT > self.stats.flankAfter && ai().noLos > 2.5, 'stalemate'),
        bt.act((c, dt, st) => {
          if (!st.spot) { st.spot = self._findSpot({ flank: true }); st.t = 0; if (!st.spot) { ai().coverT = 0; return FAILURE; } self.cover.claim(st.spot.position, self); }
          st.t += dt; self._setState('flank'); self.crouching = false; stop();
          const d = st.spot.position.distanceTo(self.position.clone().setY(st.spot.position.y));
          if (d < 0.35 || st.t > 8) { ai().spot = st.spot; ai().inCover = d < 0.35; ai().coverT = 0; ai().noLos = 0; ai().phase = 'hide'; ai().timer = 0.4; return SUCCESS; }
          self.move = Steering.arrive(self.position, st.spot.position, self.stats.moveSpeed * 1.1, 1);
          self.faceTowards(st.spot.position, dt, 10);
          return RUNNING;
        }, 'flank')),
      // peek-shoot cycle from cover
      bt.seq(bt.cond(() => aware() && ai().inCover && !!ai().spot, 'inCover'),
        bt.act((c, dt) => {
          const a = ai(), spot = a.spot; a.coverT += dt; a.timer -= dt; a.suppressed = Math.max(0, a.suppressed - dt);
          if (a.phase === 'hide') {
            self._setState('cover'); stop(); self.crouching = !!spot.low; self._holdSpot();
            if (self.target) self.faceTowards(self.target.position, dt, 4);
            if (a.timer <= 0 && a.suppressed <= 0) { a.phase = 'peek'; a.timer = self.rng.range(...self.stats.peek); a.aimT = 0; a.burstLeft = 0; a.peekLos = false; }
            return RUNNING;
          }
          // peek
          self._setState('peek'); self.crouching = false;
          const peek = spot.peek || spot.position;
          const to = peek.clone().sub(self.position).setY(0);
          if (to.length() > 0.15) { self.move = Steering.arrive(self.position, peek, self.stats.moveSpeed, 0.6); stop(); }
          else {
            const los = self.hasLos();
            if (los) { a.noLos = 0; a.peekLos = true; self._aimAt(dt); if (a.aimT > self.stats.reaction) self._burst(dt); }
            else { a.noLos += dt; stop(); if (self.target) self.faceTowards(self.target.position, dt, 8); }
          }
          if (a.timer <= 0 || a.suppressed > 0.8) { a.phase = 'hide'; a.timer = self.rng.range(...self.stats.hide); stop(); }
          return RUNNING;
        }, 'coverCombat')),
      // open ground: hold preferred range, strafe, shoot
      bt.seq(bt.cond(aware, 'awareOpen'),
        bt.act((c, dt, st) => {
          self._setState('engage'); self.crouching = false;
          const t = self.target.position, d = self.position.distanceTo(t), [lo, hi] = self.stats.preferred;
          st.flip = (st.flip ?? self.rng.range(1.5, 3)) - dt; if (st.flip <= 0) { ai().strafeDir *= -1; st.flip = self.rng.range(1.5, 3); }
          const los = self.hasLos();
          if (!los) { self.move = Steering.arrive(self.position, self.perception.lastSeen || t, self.stats.moveSpeed, 2); stop(); self.faceTowards(t, dt, 8); return RUNNING; }
          let mv = d > hi ? Steering.seek(self.position, t, self.stats.moveSpeed) : d < lo ? Steering.flee(self.position, t, self.stats.moveSpeed * 0.8) : Steering.orbit(self.position, t, d, self.stats.moveSpeed * 0.45, ai().strafeDir);
          self.move = mv;
          const moving = Math.min(1, mv.length() / self.ctrl.runSpeed);
          self._aimAt(dt, { moving });
          if (ai().aimT > self.stats.reaction) { if (self._burst(dt)) ai().aimT = self.stats.reaction * 0.3; }
          return RUNNING;
        }, 'engage')),
      // patrol
      bt.act((c, dt) => {
        self._setState('patrol'); stop(); self.crouching = false;
        if (self.position.distanceTo(self.home) > 8) self.move = Steering.seek(self.position, self.home, 1.4);
        else self.move = Steering.wander(self.wanderState, 1.4, () => self.rng.next());
        return RUNNING;
      }, 'patrol'),
    ));
  }
  _holdSpot() { const s = this.ai.spot; if (!s) return; const to = s.position.clone().sub(this.position).setY(0); this.move = to.length() > 0.1 ? Steering.arrive(this.position, s.position, this.stats.moveSpeed, 0.5) : V(); }
  _needsCover() {
    const a = this.ai;
    if (this.app.loop.time < a.noCoverUntil) return false;
    if (!a.inCover) return true;
    a.searchT -= 1 / 60;
    if (a.searchT <= 0) { a.searchT = 0.5; a.compromised = !this.cover.isProtected(a.spot.position, this.target.position, { height: a.spot.low ? 0.85 : 1.3 }); }
    if (a.compromised) { a.inCover = false; this.cover.release(this); return true; }
    return false;
  }
  think(dt, target) {
    this.target = target && target.alive !== false ? target : null;
    if (this.target) {
      this.perception.sense(this.app.loop.time, this._eye(this.position, false).setY(this.position.y), this.facing, this.target.position, this.app.physics, { dt });
      const n = this.app.shooterNoise; // gunshots are loud
      if (n && n.owner !== this && this.app.loop.time - n.time < 0.1 && n.position.distanceTo(this.position) < 40) { this.perception.aware = Math.min(1, this.perception.aware + 0.4); this.perception.lastSeen = n.position.clone(); }
    }
    this.move = V();
    this.tree.tick(dt);
  }
  update(dt) {
    this.forcedOverride = this.alive && this.crouching ? 'crouch' : null;
    const engaged = this.alive && (this.state === 'peek' || this.state === 'engage' || this.state === 'takeCover');
    if (this.alive) this.anim.setUpperOverride(engaged ? this.weapons.def.pose : this.weapons.def.hold);
    super.update(dt);
    this.weapons.moving = Math.min(1, this.ctrl.horizontalSpeed() / this.ctrl.runSpeed);
    this.weapons.crouched = this.crouching;
    if (this.alive) this.weapons.update(dt);
  }
  debug() { return { type: this.type, state: this.state, hp: Math.round(this.health.value), inCover: this.ai.inCover, crouching: this.crouching, shots: this.shotsFired, hits: this.hitsOnTarget, ammo: this.weapons.mag, visited: [...this.ai.visited] }; }
}
