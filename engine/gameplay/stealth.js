// Stealth kit: light-aware vision, a suspicion meter with readable states, noise propagation,
// patrol → investigate → search → alert guard brains, hiding spots, silent takedowns and body
// discovery. Engine-agnostic: guards and the player are any objects with { position, facing }
// (Actor/Player/NPC fit as-is); movement goes through a `moveTo(guard, point, speed, dt)` adapter
// (Steering, a NavGrid or a navmesh planner) so the kit works in any level.
//
//   const stealth = new StealthSystem({ physics: app.physics, lightLevel: lightProbe(scene, atmosphere) });
//   const g = stealth.addGuard(npc, { route: [[0,0,0],[10,0,0]], moveTo });
//   stealth.setPlayer(player, () => ({ crouched, speed }));
//   stealth.noise(pos, 12, 'bottle');              // distractions, footsteps, gunshots
//   stealth.update(dt);  stealth.playerVisibility  // 0..1 for the HUD eye
//   stealth.on('alert', ({ guard, at }) => wanted.reportCrime('assault', at))
import * as THREE from '../vendor/three/three.module.js';
import { Actor } from './actors.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
export const GUARD_STATES = ['patrol', 'suspicious', 'investigate', 'search', 'alert', 'down'];

/**
 * lightProbe(scene, { sunDir, sunIntensity, ambient, physics }) → (point) => 0..1 light level.
 * Sums the sun (if not shadowed — physics raycast towards the sun), every PointLight/SpotLight in
 * range (inverse-square, cone, line of sight) and an ambient floor. Cached per 0.5 m cell for 0.25 s.
 * sunDir/sunIntensity may be functions (time of day). Pass { atmosphere } to read them from Atmosphere.
 */
export function lightProbe(scene, { physics = null, sunDir = V(0.3, 1, 0.2).normalize(), sunIntensity = 1, ambient = 0.08, atmosphere = null, cell = 0.5, ttl = 0.25 } = {}) {
  const cache = new Map(); let clock = 0, lights = null, lightsAge = 99;
  const fn = (p, now = clock) => {
    clock = now; const k = `${Math.round(p.x / cell)},${Math.round(p.y / cell)},${Math.round(p.z / cell)}`, c = cache.get(k);
    if (c && now - c.t < ttl) return c.v;
    if (!lights || lightsAge > 2) { lights = []; scene.traverse((o) => { if ((o.isPointLight || o.isSpotLight) && o.visible) lights.push(o); }); lightsAge = 0; }
    let L = ambient;
    const sd = atmosphere?.sunDir || (typeof sunDir === 'function' ? sunDir() : sunDir), si = atmosphere ? atmosphere.daylight ?? 1 : (typeof sunIntensity === 'function' ? sunIntensity() : sunIntensity);
    if (si > 0.01 && sd && sd.y > 0) { const blocked = physics?.raycast(p.clone().addScaledVector(sd, 0.2), sd, 200, { bodies: false }); if (!blocked) L += Math.min(1, si) * Math.min(1, sd.y * 2.5); }
    for (const l of lights) {
      const lp = l.getWorldPosition(V()), d = lp.distanceTo(p), range = l.distance || 25; if (d > range) continue;
      let a = l.intensity / (1 + d * d) * (l.distance ? Math.max(0, 1 - d / l.distance) : 1);
      if (l.isSpotLight) { const dir = l.target.getWorldPosition(V()).sub(lp).normalize(), cos = dir.dot(p.clone().sub(lp).normalize()); a *= THREE.MathUtils.smoothstep(cos, Math.cos(l.angle), Math.cos(l.angle * (1 - l.penumbra * 0.9))); }
      if (a < 0.01) continue;
      if (physics) { const dir = p.clone().sub(lp), len = dir.length(); const h = physics.raycast(lp, dir.normalize(), len - 0.2, { bodies: false }); if (h) continue; }
      L += a * 0.35;
    }
    const v = Math.min(1, L); cache.set(k, { v, t: now }); if (cache.size > 4000) cache.clear(); lightsAge += 0.016;
    return v;
  };
  fn.invalidate = () => { cache.clear(); lights = null; };
  return fn;
}

export class StealthSystem {
  /**
   * opts: physics (raycast occlusion), lightLevel (point → 0..1; default 1 = daylight everywhere),
   * radio: seconds before an alerted guard's alarm reaches the others (Infinity = no radio).
   */
  constructor({ physics = null, lightLevel = () => 1, radio = 2.5, eyeHeight = 1.6 } = {}) {
    Object.assign(this, { physics, lightLevel, radio, eyeHeight });
    this.guards = []; this.hiding = []; this.bodies = []; this.noises = []; this.listeners = {};
    this.player = null; this.playerState = () => ({}); this.playerVisibility = 0; this._light = 1; this._stance = 1; this.time = 0; this.alarm = null;
  }
  on(e, f) { (this.listeners[e] ||= []).push(f); return this; }
  emit(e, d) { for (const f of this.listeners[e] || []) f(d); }
  setPlayer(p, state = () => ({})) { this.player = p; this.playerState = state; return this; }
  /** Hiding volume (bush, locker, shadow nook): { center, radius } or { box: Box3 }; visibility × factor while inside. */
  addHidingSpot(spot) { this.hiding.push({ factor: 0.15, ...spot }); return this; }
  /**
   * Register a guard. opts: route [[x,y,z] | {pos, wait, look}], moveTo(guard, point, speed, dt) → arrived?,
   * navmesh (routes around walls via navMover), sight 18 m, fov 110° (+ peripheral 160° at 35 %), hearing 1, walk 1.4, run 3.6, suspicionRate 1.
   */
  addGuard(actor, opts = {}) {
    const g = {
      actor, state: 'patrol', suspicion: 0, route: (opts.route || [actor.position.toArray()]).map((r) => (Array.isArray(r) ? { pos: V(...r), wait: 1.5 } : { wait: 1.5, ...r, pos: V(...(r.pos.toArray ? r.pos.toArray() : r.pos)) })),
      wp: 0, wait: 0, target: null, searchPts: [], stateT: 0, lastKnown: null, seesPlayer: false,
      opts: { sight: 18, fov: 110 * Math.PI / 180, peripheral: 160 * Math.PI / 180, hearing: 1, walk: 1.4, run: 3.6, suspicionRate: 1, ...opts, moveTo: opts.moveTo || (opts.navmesh ? navMover(opts.navmesh) : defaultMoveTo) },
    };
    if (actor.ctrl && actor instanceof Actor) { // game Actor/NPC/Enemy: drive it through its controller + animation
      const a = actor; g.body = a; g._move = null;
      g.actor = { get position() { return a.position; }, get facing() { return a.ctrl.facing; }, set facing(v) { a.ctrl.facing = v; }, userData: a.model.userData };
      const steer = (A, point, speed) => { const d = point.clone().sub(a.position).setY(0); if (d.length() < 0.4) { g._move = null; return true; } g._move = { dir: d.normalize(), speed }; return false; };
      g.opts.moveTo = opts.navmesh ? navMover(opts.navmesh, { inner: steer }) : opts.moveTo || steer;
    }
    this.guards.push(g); return g;
  }
  /** A sound at `pos` audible within `radius` metres (walls halve it). kind is passed to listeners. */
  noise(pos, radius = 10, kind = 'noise') { this.noises.push({ pos: pos.clone(), radius, kind, t: this.time }); this.emit('noise', { pos, radius, kind }); }
  /** Silent takedown: player behind (≥ 110° from the guard's facing) within `reach`, guard not alerted. */
  canTakedown(g, reach = 1.4) {
    if (!this.player || g.state === 'down' || g.state === 'alert') return false;
    const to = this.player.position.clone().sub(g.actor.position); if (to.length() > reach) return false;
    const ang = Math.abs(wrap(Math.atan2(to.x, to.z) - (g.actor.facing ?? 0)));
    return ang > 110 * Math.PI / 180 || g.suspicion < 0.25;
  }
  takedown(g) {
    if (!this.canTakedown(g)) return false;
    g.state = 'down'; g.suspicion = 0; g.actor.userData && (g.actor.userData.down = true);
    if (g.body) g.body.health?.damage(1e6, { silent: true, source: this.player }); // plays death / ragdoll
    this.bodies.push({ pos: g.actor.position.clone(), guard: g, found: false });
    this.noise(g.actor.position, 3, 'takedown'); this.emit('takedown', { guard: g }); return true;
  }
  nearestTakedown(reach = 1.4) { return this.guards.find((g) => this.canTakedown(g, reach)) || null; }

  // ---------------------------------------------------------------- per-frame
  update(dt) {
    this.time += dt; const P = this.player, ps = P ? this.playerState() || {} : {};
    this.noises = this.noises.filter((n) => this.time - n.t < 0.15);
    // player visibility = light at the player × stance (crouch, speed) × hiding spot
    if (P) {
      const p = P.position.clone().setY(P.position.y + (ps.crouched ? 0.7 : 1.1));
      this._light = Math.max(0.05, this.lightLevel(p, this.time));
      let st = (ps.crouched ? 0.55 : 1) * (1 + Math.min(1, (ps.speed || 0) / 5) * 0.35);
      for (const h of this.hiding) if (h.box ? h.box.containsPoint(P.position) : P.position.distanceTo(h.center) < h.radius) st *= h.factor;
      this._stance = st; this.playerVisibility = Math.min(1, this._light * st);
      if (ps.speed > 3.2 && !ps.crouched) this.noise(P.position, ps.speed * 1.6, 'footsteps'); // running is loud
    }
    for (const g of this.guards) this._guard(g, dt, P, ps);
    if (this.alarm && this.time >= this.alarm.at) { for (const g of this.guards) if (g.state !== 'down' && g.state !== 'alert') this._setState(g, 'alert', this.alarm.pos); this.alarm = null; }
  }
  _eye(a) { return a.position.clone().setY(a.position.y + this.eyeHeight); }
  _occluded(a, b) { if (!this.physics) return false; const d = b.clone().sub(a), len = d.length(); const h = this.physics.raycast(a, d.normalize(), len, { bodies: false }); return !!(h && h.distance < len - 0.3); }
  /** 0..1 how well guard g sees a world point right now (distance, cone, light, occlusion). */
  sightOf(g, point, light = 1) {
    const eye = this._eye(g.actor), to = point.clone().sub(eye), d = to.length(); if (d > g.opts.sight) return 0;
    const ang = Math.abs(wrap(Math.atan2(to.x, to.z) - (g.actor.facing ?? 0)));
    let s = ang < g.opts.fov / 2 ? 1 : ang < g.opts.peripheral / 2 ? 0.35 : d < 1.2 ? 0.6 : 0; if (!s) return 0;
    s *= 1 - Math.pow(d / g.opts.sight, 1.5) * 0.85;           // distance falloff
    s *= Math.max(0.08 + 0.92 * Math.pow(Math.min(1, light / 0.5), 1.3), d < 2.5 ? 0.6 : 0); // dark areas hide you (not at arm's length)
    return this._occluded(eye, point) ? 0 : s;
  }
  _setState(g, s, at) {
    if (g.state === s) return; const prev = g.state; g.state = s; g.stateT = 0;
    if (at) g.lastKnown = at.clone();
    if (g.body?.setMarker) g.body.setMarker(s === 'alert' ? '!' : s === 'patrol' || s === 'down' ? null : '?'); // readable state over the guard's head
    if (s === 'search') { g.searchPts = []; for (let i = 0; i < 4; i++) { const a = i * 1.7 + g.actor.position.x, r = 3 + (i % 2) * 3; g.searchPts.push(g.lastKnown.clone().add(V(Math.cos(a) * r, 0, Math.sin(a) * r))); } }
    if (s === 'alert' && Number.isFinite(this.radio) && !this.alarm) this.alarm = { at: this.time + this.radio, pos: (at || g.actor.position).clone() };
    this.emit('state', { guard: g, from: prev, to: s }); if (s === 'alert') this.emit('alert', { guard: g, at: g.lastKnown || g.actor.position });
  }
  _guard(g, dt, P, ps) {
    this._think(g, dt, P, ps);
    if (g.body) { const m = g._move; Actor.prototype.update.call(g.body, dt, m ? m.dir : new THREE.Vector3(), m ? m.speed : 0); g._move = null; }
  }
  _think(g, dt, P, ps) {
    if (g.state === 'down') return;
    g.stateT += dt; const o = g.opts;
    // senses
    g.seesPlayer = false; let gain = 0;
    if (P && !P.dead) {
      const tp = P.position.clone().setY(P.position.y + (ps.crouched ? 0.7 : 1.2));
      const s = this.sightOf(g, tp, this._light);
      if (s > 0) { g.seesPlayer = s * this._stance > 0.05; gain = s * Math.min(1.3, this._stance) * 1.4 * o.suspicionRate; if (g.seesPlayer) g.lastKnown = P.position.clone(); }
    }
    for (const n of this.noises) {
      let r = n.radius * o.hearing; if (this._occluded(this._eye(g.actor), n.pos.clone().setY(n.pos.y + 0.5))) r *= 0.5;
      if (g.actor.position.distanceTo(n.pos) < r && n.kind !== 'takedown-silent') { if (g.state === 'patrol' || g.state === 'suspicious') { g.suspicion = Math.max(g.suspicion, 0.55); this._setState(g, 'investigate', n.pos); } else if (g.state !== 'alert') g.lastKnown = n.pos.clone(); }
    }
    for (const b of this.bodies) if (!b.found && this.sightOf(g, b.pos.clone().setY(b.pos.y + 0.3), this.lightLevel(b.pos, this.time)) > 0.25) { b.found = true; this.emit('bodyFound', { guard: g, body: b }); g.suspicion = 1; this._setState(g, 'alert', b.pos); }
    // suspicion meter: rises while seen, decays otherwise (slower once alarmed)
    // suspicion meter: sight evidence minus a constant decay, so faint glimpses (darkness, hiding, distance) never add up
    g.suspicion = Math.min(1, Math.max(0, g.suspicion + (gain - (g.state === 'patrol' || g.state === 'suspicious' ? 0.25 : 0.08)) * dt));
    if (g.suspicion >= 1 && g.seesPlayer) this._setState(g, 'alert', P.position);
    else if (g.state === 'patrol' && g.suspicion > 0.3) this._setState(g, 'suspicious', g.lastKnown);
    else if (g.state === 'suspicious' && g.suspicion > 0.6) this._setState(g, 'investigate', g.lastKnown);
    else if (g.state === 'suspicious' && g.suspicion <= 0.05) this._setState(g, 'patrol');
    // behaviour
    const A = g.actor;
    const face = (p) => { const d = p.clone().sub(A.position); if (d.lengthSq() > 1e-4) A.facing = Math.atan2(d.x, d.z); };
    switch (g.state) {
      case 'patrol': {
        const wp = g.route[g.wp];
        if (g.wait > 0) { g.wait -= dt; if (wp.look !== undefined) A.facing = wp.look; break; }
        if (o.moveTo(A, wp.pos, o.walk, dt)) { g.wait = wp.wait; g.wp = (g.wp + 1) % g.route.length; }
        break;
      }
      case 'suspicious': if (g.lastKnown) face(g.lastKnown); break; // stop and stare ("?")
      case 'investigate': if (!g.lastKnown || o.moveTo(A, g.lastKnown, o.walk * 1.3, dt)) { g.lastKnown = g.lastKnown || A.position.clone(); this._setState(g, 'search'); } break;
      case 'search': {
        if (!g.searchPts.length || g.stateT > 20) { g.suspicion = Math.min(g.suspicion, 0.25); this._setState(g, 'patrol'); break; }
        if (o.moveTo(A, g.searchPts[0], o.walk * 1.2, dt)) { g.searchPts.shift(); A.facing += 1.2; }
        if (g.seesPlayer && g.suspicion > 0.5) this._setState(g, 'investigate', P.position);
        break;
      }
      case 'alert': if (g.lastKnown) { face(g.lastKnown); if (!g.seesPlayer) o.moveTo(A, g.lastKnown, o.run, dt); } break;
    }
  }
  /** Debug view: one cone per guard coloured by state (green patrol, yellow suspicious/search, orange investigate, red alert). */
  debugGroup() {
    const grp = new THREE.Group(); grp.name = 'stealth-debug'; const cols = { patrol: 0x3fbf5f, suspicious: 0xe0d040, investigate: 0xe08a30, search: 0xe0c040, alert: 0xe03030, down: 0x555555 };
    for (const g of this.guards) {
      const geo = new THREE.CircleGeometry(g.opts.sight, 24, Math.PI / 2 - g.opts.fov / 2, g.opts.fov); geo.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: cols.patrol, transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide }));
      const edge = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: cols.patrol, transparent: true, opacity: 0.6 })); m.add(edge);
      m.userData.guard = g; m.renderOrder = -1; grp.add(m);
    }
    grp.userData.update = () => { for (const m of grp.children) { const g = m.userData.guard; m.position.copy(g.actor.position).setY(g.actor.position.y + 0.05); m.rotation.y = (g.actor.facing ?? 0) + Math.PI; m.material.color.setHex(cols[g.state]); m.children[0].material.color.setHex(cols[g.state]); m.visible = g.state !== 'down'; } };
    return grp;
  }
  serialize() { return { guards: this.guards.map((g) => ({ state: g.state, suspicion: g.suspicion, wp: g.wp, pos: g.actor.position.toArray(), facing: g.actor.facing })), bodies: this.bodies.map((b) => ({ pos: b.pos.toArray(), found: b.found, guard: this.guards.indexOf(b.guard) })) }; }
  load(d) { d.guards?.forEach((s, i) => { const g = this.guards[i]; if (!g) return; Object.assign(g, { state: s.state, suspicion: s.suspicion, wp: s.wp }); g.actor.position.fromArray(s.pos); g.actor.facing = s.facing; }); this.bodies = (d.bodies || []).map((b) => ({ pos: V(...b.pos), found: b.found, guard: this.guards[b.guard] })); }
}

/** Straight-line mover for open levels/tests; swap for a navmesh/NavGrid planner in real levels. */
export function defaultMoveTo(actor, point, speed, dt) {
  const d = point.clone().sub(actor.position); d.y = 0; const len = d.length();
  if (len < 0.25) return true;
  actor.facing = Math.atan2(d.x, d.z); actor.position.addScaledVector(d.normalize(), Math.min(len, speed * dt));
  return false;
}

/**
 * navMover(navmesh) → moveTo adapter for addGuard: guards follow navmesh paths (A* + funnel) instead of
 * straight lines, re-planning when the goal moves > 1 m or the navmesh changes (doors, parked cars).
 * Works with plain objects and game Actors (pass it as `moveTo`; Actors still move through their controller).
 */
export function navMover(navmesh, { inner = defaultMoveTo } = {}) {
  const plans = new WeakMap();
  return (actor, point, speed, dt) => {
    let p = plans.get(actor);
    if (!p || p.goal.distanceTo(point) > 1 || p.version !== navmesh.version) {
      const path = navmesh.findPath(actor.position, point);
      p = { goal: point.clone(), version: navmesh.version, path: path ? path.slice(1) : [point.clone()] }; plans.set(actor, p);
    }
    while (p.path.length > 1 && actor.position.distanceTo(p.path[0]) < 0.35) p.path.shift();
    const next = p.path[0] || point, arrived = inner(actor, next, speed, dt);
    if (arrived && p.path.length <= 1) { plans.delete(actor); return true; }
    if (arrived) p.path.shift();
    return false;
  };
}
