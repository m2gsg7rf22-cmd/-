// Actors: humanoid characters combining a procedural model, controller, animator and
// health. Enemy adds behavior-tree combat AI with perception, attack tokens (so only a
// few attack at once), telegraphed strikes, stagger and death. NPC adds idle/wander
// schedules, look-at and dialogue hooks.
import * as THREE from '../vendor/three/three.module.js';
import { createHumanoid, attach } from '../character/humanoid.js';
import { HumanoidAnimator } from '../animation/animator.js';
import { CharacterController, syncVisual } from '../physics/character.js';
import { Health, meleeSweep } from './systems.js';
import { bt, BehaviorTree, Steering, Perception, RUNNING, SUCCESS, FAILURE } from '../ai/behavior.js';
import { PROPS } from '../geometry/props.js';
import { RNG } from '../core/rng.js';

let ACTOR_ID = 1;

export class Actor {
  constructor(app, { look = {}, position = new THREE.Vector3(), facing = 0, hp = 100, weapon = null, name = 'Actor', tags = [], scale = 1, speed = {} } = {}) {
    this.app = app; this.id = 'a' + ACTOR_ID++; this.name = name; this.tags = new Set(tags);
    // Realistic humans when the app has the human system loaded (app.useHumans), unless the
    // look asks for the legacy stylized mannequin.
    this.realistic = !!(app.humans && look.style !== 'stylized');
    this.model = this.realistic ? app.humans.create({ ...look, armed: !!weapon }) : createHumanoid(look);
    if (scale !== 1) this.model.scale.setScalar(scale);
    app.scene.add(this.model);
    const h = this.model.userData.height * scale;
    this.ctrl = new CharacterController(app.physics, { position, radius: 0.34 * scale, height: h, ...speed });
    this.ctrl.facing = facing; this.model.rotation.y = facing;
    this.anim = new HumanoidAnimator(this.model);
    this.health = new Health(hp, { onDeath: (info) => this.onDeath(info), onDamage: (a, info) => this.onDamage(a, info) });
    this.radius = 0.4 * scale; this.alive = true;
    this.weapon = weapon ? attach(this.model, 'hand_R', typeof weapon === 'string' ? PROPS[weapon]({}) : weapon) : null;
    this.stagger = 0;
    this.listeners = {};
    this.footT = 0;
    this.model.traverse((o) => { if (o.isMesh) o.userData.actor = this; });
  }
  get position() { return this.ctrl.position; }
  get facing() { return this.ctrl.facing; }
  on(e, f) { (this.listeners[e] ||= []).push(f); }
  emit(e, d) { for (const f of this.listeners[e] || []) f(d); }
  onDamage(amount, info) {
    this.emit('damage', { amount, info });
    if (this.health.dead) return;
    if (info.direction) this.ctrl.knockback(info.direction, info.knockback ?? 3, info.up ?? 1.5);
    if (!info.noStagger) { this.stagger = info.stagger ?? 0.35; this.anim.play('hit'); }
  }
  onDeath(info) {
    this.alive = false; this.anim.play('death'); this.emit('death', info);
    this.ctrl.velocity.set(0, 0, 0);
  }
  faceTowards(p, dt, rate = 10) {
    const want = Math.atan2(p.x - this.position.x, p.z - this.position.z);
    let d = want - this.ctrl.facing; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
    this.ctrl.facing += d * (1 - Math.exp(-rate * dt));
  }
  // Base per-step update: physics, animation, visuals.
  update(dt, desired = new THREE.Vector3(), speed = 0, opts = {}) {
    this.health.update(dt);
    this.stagger = Math.max(0, this.stagger - dt);
    if (!this.alive || this.stagger > 0) { desired = new THREE.Vector3(); speed = 0; }
    this.ctrl.move(dt, desired, speed, opts);
    const hs = this.ctrl.horizontalSpeed();
    this.anim.setLocomotion(this.alive ? hs : 0, this.ctrl.grounded);
    if (this.alive) this.anim.setOverride(this.forcedOverride !== undefined && this.forcedOverride !== null ? this.forcedOverride : !this.ctrl.grounded && this.ctrl.velocity.y < -4 ? 'fall' : this.ctrl.swimming ? 'swing' : null);
    this.anim.update(dt);
    this.model.userData.face?.update(dt);
    syncVisual(this.model, this.ctrl, dt);
    // footsteps
    if (this.ctrl.grounded && hs > 1) { this.footT += dt * hs / 1.6; if (this.footT > 1) { this.footT = 0; this.emit('footstep', hs); } }
  }
  remove() { this.app.scene.remove(this.model); }
}

// Shared attack tokens so groups of enemies take turns ("kung-fu circle").
export class AttackTokens { constructor(max = 2) { this.max = max; this.holders = new Set(); } take(e) { if (this.holders.has(e)) return true; if (this.holders.size >= this.max) return false; this.holders.add(e); return true; } give(e) { this.holders.delete(e); } }

export class Enemy extends Actor {
  constructor(app, opts = {}) {
    const archetype = ENEMY_TYPES[opts.type || 'grunt'];
    super(app, { ...archetype, ...opts, look: { ...archetype.look, ...(opts.look || {}) }, tags: ['enemy', ...(opts.tags || [])] });
    this.type = opts.type || 'grunt';
    this.stats = { damage: 10, range: 1.9, attackCooldown: 1.6, moveSpeed: 3.6, sight: 20, ...archetype.stats, ...(opts.stats || {}) };
    this.home = this.position.clone();
    this.perception = new Perception({ sightRange: this.stats.sight, fov: Math.PI * 0.8 });
    this.tokens = opts.tokens || new AttackTokens(2);
    this.rng = new RNG(opts.seed ?? ACTOR_ID * 17);
    this.orbitDir = this.rng.sign();
    this.target = null; this.nextAttack = 0; this.state = 'idle';
    this.wanderState = {};
    this.tree = this._buildTree();
    this.on('death', () => this.tokens.give(this));
    this.on('damage', () => { this.perception.aware = 1; });
  }
  _buildTree() {
    const self = this;
    const dist = () => (self.target ? self.position.distanceTo(self.target.position) : Infinity);
    return new BehaviorTree(bt.sel(
      bt.cond(() => !self.alive || self.stagger > 0, 'disabled'),
      // flee when weak (cowardly types)
      bt.seq(bt.cond(() => self.stats.flee && self.health.ratio < 0.25 && dist() < 10), bt.act((c, dt) => { self.state = 'flee'; self.move = Steering.flee(self.position, self.target.position, self.stats.moveSpeed * 1.1); return RUNNING; }, 'flee')),
      // attack when in range and holding a token
      bt.seq(
        bt.cond(() => self.target && self.perception.aware > 0.6 && dist() < self.stats.range + 0.3, 'inRange'),
        bt.cond(() => self.app.loop.time >= self.nextAttack && self.tokens.take(self), 'token'),
        bt.act((c, dt, st) => {
          self.state = 'attack'; self.move = new THREE.Vector3();
          if (!st.started) { st.started = true; st.hit = false; self.faceTowards(self.target.position, 1, 100); const clip = self.rng.pick(self.stats.attacks || ['attack1']); self.anim.play(clip, { speed: self.stats.attackSpeed || 1 }); self.emit('windup', clip); }
          self.faceTowards(self.target.position, dt, 6);
          if (!self.anim.isPlaying()) { self.nextAttack = self.app.loop.time + self.stats.attackCooldown * self.rng.range(0.8, 1.3); self.tokens.give(self); return SUCCESS; }
          return RUNNING;
        }, 'attack', { onReset: () => {} }),
      ),
      // chase / circle
      bt.seq(
        bt.cond(() => { if (!self.target) return false; const s = self.perception.sense(self.app.loop.time, self.position, self.facing, self.target.position, self.app.physics, { dt: 1 / 60 }); return self.perception.aware > 0.6 || s.remembered && self.perception.aware > 0.3; }, 'aware'),
        bt.act((c, dt) => {
          const d = dist();
          self.faceTowards(self.target.position, dt, 8);
          if (d > self.stats.range + 2.5 || self.tokens.holders.size < self.tokens.max) { self.state = 'chase'; const stop = self.target.position.clone().add(self.position.clone().sub(self.target.position).setY(0).normalize().multiplyScalar(self.stats.range * 0.75)); self.move = Steering.arrive(self.position, stop, self.stats.moveSpeed, 1.5); }
          else { self.state = 'circle'; self.move = Steering.orbit(self.position, self.target.position, self.stats.range + 2.2, self.stats.moveSpeed * 0.5, self.orbitDir); }
          const others = self.app.__enemies?.filter((e) => e !== self && e.alive).map((e) => e.position) || [];
          self.move.add(Steering.separation(self.position, others, 1.6).multiplyScalar(2.5));
          return RUNNING;
        }, 'pursue'),
      ),
      // patrol / wander near home
      bt.act((c, dt) => {
        self.state = 'patrol';
        if (self.position.distanceTo(self.home) > 10) self.move = Steering.seek(self.position, self.home, 1.4);
        else self.move = Steering.wander(self.wanderState, 1.6, () => self.rng.next());
        if (self.target) self.perception.sense(self.app.loop.time, self.position, self.facing, self.target.position, self.app.physics, { dt });
        return RUNNING;
      }, 'patrol'),
    ));
  }
  // targets: actors the enemy may attack (usually [player])
  think(dt, target) {
    this.target = target && target.alive ? target : null;
    this.move = new THREE.Vector3();
    this.tree.tick(dt);
  }
  update(dt) {
    const m = this.move || new THREE.Vector3();
    const sp = Math.min(m.length(), this.stats.moveSpeed * 1.2);
    const dir = sp > 0.05 ? m.clone().normalize() : new THREE.Vector3();
    super.update(dt, dir, sp, { faceMovement: this.state === 'patrol' || this.state === 'flee' });
  }
  // called by the game on the animation 'hit' event; returns hits
  strike(targets) {
    return meleeSweep(this.position, this.facing, targets, { range: this.stats.range + 0.4, arc: Math.PI * 0.7 });
  }
}

export const ENEMY_TYPES = {
  grunt: { hp: 60, weapon: 'axe', look: { outfit: 'armor', armor: true, top: 0x4a3a28, bottom: 0x2a2a2a, accent: 0x6a5a4a, hairStyle: 'buzz', beard: true }, stats: { damage: 10, moveSpeed: 3.8, attacks: ['attack1', 'attack2'] } },
  brute: { hp: 160, scale: 1.25, weapon: 'axe', look: { build: 0.95, outfit: 'armor', armor: true, top: 0x3a2a2a, accent: 0x7a2a1a, helmet: true }, stats: { damage: 22, moveSpeed: 2.8, range: 2.3, attackCooldown: 2.4, attacks: ['heavy', 'attack3'], attackSpeed: 0.9 } },
  duelist: { hp: 80, weapon: 'sword', look: { outfit: 'robe', top: 0x2a2a3a, accent: 0xb02a2a, hairStyle: 'ponytail' }, stats: { damage: 12, moveSpeed: 4.6, attackCooldown: 1.1, attacks: ['attack1', 'attack2', 'attack3'], attackSpeed: 1.15 } },
  thug: { hp: 50, look: { outfit: 'casual', coat: true, top: 0x2a3a4a, bottom: 0x1a2a4a, hairStyle: 'mohawk' }, stats: { damage: 8, moveSpeed: 4.2, range: 1.5, attacks: ['punch', 'kick'], flee: true } },
};

export class NPC extends Actor {
  constructor(app, opts = {}) {
    super(app, { ...opts, tags: ['npc', ...(opts.tags || [])] });
    this.dialogue = opts.dialogue || null; this.role = opts.role || 'villager';
    this.home = this.position.clone(); this.waypoints = opts.waypoints || null; this.wpIndex = 0; this.wait = 0;
    this.talking = false; this.lookTarget = null; this.wanderRadius = opts.wanderRadius ?? 0;
    this.rng = new RNG(opts.seed ?? ACTOR_ID * 7);
    this.idleAnim = opts.idleAnim || null; if (this.idleAnim) this.anim.setUpperOverride(this.idleAnim);
    this.marker = null;
  }
  setMarker(kind) { // '!' quest available, '?' turn-in, null
    if (this.marker) { this.model.remove(this.marker); this.marker = null; }
    if (!kind) return;
    const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
    x.fillStyle = kind === '!' ? '#ffcf3a' : '#5ad1ff'; x.font = 'bold 56px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.strokeStyle = '#000'; x.lineWidth = 6; x.strokeText(kind, 32, 34); x.fillText(kind, 32, 34);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false })); s.scale.setScalar(0.6); s.position.y = this.model.userData.height + 0.45; s.renderOrder = 10;
    this.model.add(s); this.marker = s;
  }
  update(dt, player = null) {
    let dir = new THREE.Vector3(), speed = 0;
    if (this.talking && player) { this.faceTowards(player.position, dt, 6); }
    else if (this.waypoints && this.waypoints.length) {
      if (this.wait > 0) this.wait -= dt;
      else { const wp = this.waypoints[this.wpIndex]; const d = new THREE.Vector3(wp.x - this.position.x, 0, wp.z - this.position.z); if (d.length() < 0.6) { this.wpIndex = (this.wpIndex + 1) % this.waypoints.length; this.wait = wp.wait ?? 2; } else { dir = d.normalize(); speed = 1.4; } }
    } else if (this.wanderRadius > 0) {
      if (this.wait > 0) this.wait -= dt; else { if (!this.wanderTarget || this.position.distanceTo(this.wanderTarget) < 0.6) { this.wanderTarget = this.home.clone().add(new THREE.Vector3(this.rng.range(-1, 1) * this.wanderRadius, 0, this.rng.range(-1, 1) * this.wanderRadius)); this.wait = this.rng.range(1, 4); } else { dir = this.wanderTarget.clone().sub(this.position).setY(0).normalize(); speed = 1.3; } }
    }
    if (player && !this.talking && player.position.distanceTo(this.position) < 3.5 && speed === 0) this.faceTowards(player.position, dt, 3);
    if (this.marker) this.marker.position.y = this.model.userData.height + 0.45 + Math.sin(this.app.loop.time * 3) * 0.06;
    super.update(dt, dir, speed);
  }
}

// Push overlapping actors apart (circle vs circle on the ground plane).
export function separateActors(actors, padding = 0.05) {
  for (let i = 0; i < actors.length; i++) for (let j = i + 1; j < actors.length; j++) {
    const a = actors[i], b = actors[j]; if (!a.alive || !b.alive) continue;
    const dx = b.position.x - a.position.x, dz = b.position.z - a.position.z, d = Math.hypot(dx, dz), min = a.radius + b.radius + padding;
    if (d >= min || d < 1e-5) continue;
    const push = (min - d) / 2, nx = dx / d, nz = dz / d;
    const wa = a.tags.has('player') ? 0.3 : 1, wb = b.tags.has('player') ? 0.3 : 1;
    a.position.x -= nx * push * wa; a.position.z -= nz * push * wa; b.position.x += nx * push * wb; b.position.z += nz * push * wb;
  }
}
