// Platformer kit: precise character feel as an optional CharacterController profile
// (coyote time, jump buffering, variable jump height, asymmetric gravity, wall slide /
// wall jump, ledge grab + climb, dash), level runtime pieces (static / moving (linear,
// circular, path) / crumbling platforms, springs, spike & lava kill volumes, checkpoints
// with respawn, collectibles, goal), jump-arc math with a reachability checker, a seeded
// level-chunk generator that only emits reachable sections, and an input bot that plays a
// generated level (automated playtests, attract mode).
//
//   const profile = platformerProfile({ jumpHeight: 2.4 });
//   const ctrl = new CharacterController(world, { position, profile });
//   const desc = generatePlatformerLevel({ seed: 7, pieces: 10, difficulty: 0.5, profile });
//   const level = new PlatformerLevel(world, { scene }).build(desc);
//   each step: level.update(dt, [ctrl]); ctrl.move(dt, dir, 0, { jump, jumpHeld, dash });
import * as THREE from '../vendor/three/three.module.js';
import { RNG, clamp, lerp } from '../core/rng.js';
import { solid, pbr } from '../render/materials.js';
import { roundedBox, boxUV } from '../geometry/builders.js';

// ---------------------------------------------------------------------------------------
// Game-feel parameters (metres, seconds). Jump is specified by height + time-to-apex; the
// gravity and launch velocity are derived (g = 2h/t², v = 2h/t). Falling uses g·fallMultiplier.
export const PLATFORMER_DEFAULTS = {
  runSpeed: 7.5, groundAccel: 75, groundDecel: 90, airAccel: 45, airDecel: 22, turnRate: 20,
  jumpHeight: 2.4, timeToApex: 0.36, fallMultiplier: 1.55, jumpCut: 0.45, maxFall: 24,
  coyoteTime: 0.1, jumpBuffer: 0.12, airJumps: 0,
  wallSlide: true, wallSlideSpeed: 2.8, wallJump: true, wallJumpUp: 11, wallJumpOut: 7.5, wallJumpLock: 0.16, wallCoyote: 0.1,
  ledgeGrab: true, ledgeReach: 0.35, climbTime: 0.26,
  dash: true, dashSpeed: 19, dashTime: 0.16, dashCooldown: 0.35, airDashes: 1,
  radius: 0.35, height: 1.8,
};

export function platformerParams(overrides = {}) {
  const src = overrides && overrides.params ? overrides.params : overrides; // accept a profile or plain params
  const p = { ...PLATFORMER_DEFAULTS, ...src };
  p.gravity = 2 * p.jumpHeight / (p.timeToApex * p.timeToApex);
  p.jumpVelocity = p.gravity * p.timeToApex;
  p.fallGravity = p.gravity * p.fallMultiplier;
  return p;
}

// Profile for CharacterController (ctrl.setProfile(platformerProfile()) or { profile } option).
// move(dt, dir, speed, { jump /*pressed edge*/, jumpHeld /*button down*/, dash /*pressed edge*/ })
// speed 0 = profile runSpeed. ctrl.pf exposes state + per-step events for animation/audio/VFX.
export function platformerProfile(overrides = {}) {
  const p = platformerParams(overrides);
  return {
    kind: 'platformer', params: p,
    attach(ctrl) { ctrl.pf = newPfState(p); ctrl.coyoteTime = p.coyoteTime; ctrl.jumpBufferTime = p.jumpBuffer; },
    control(ctrl, dt, desired, speed, opts) { return platformerControl(ctrl, p, dt, desired, speed, opts); },
  };
}

function newPfState(p) {
  return { coyote: 0, buffer: 0, jumping: false, wallTimer: 0, wallNormal: new THREE.Vector3(), wallShape: null, sliding: false, lock: 0,
    dashT: 0, dashCd: 0, dashDir: new THREE.Vector3(1, 0, 0), airDashes: p.airDashes, airJumps: p.airJumps, ledge: null, ledgeCd: 0,
    prevGrounded: false, state: 'air', events: {}, jumpCount: 0, wallJumps: 0, dashes: 0, ledgeGrabs: 0 };
}

const _t = new THREE.Vector3();
function platformerControl(ctrl, p, dt, desired, speed, { jump = false, jumpHeld, dash = false, faceMovement = true } = {}) {
  const s = ctrl.pf || (ctrl.pf = newPfState(p));
  if (jumpHeld === undefined) jumpHeld = true; // callers that only send "jump" get full-height jumps
  const ev = s.events = {};
  ctrl.justJumped = false;
  const v = ctrl.velocity, grounded = ctrl.grounded;
  // ---- timers
  if (jump) s.buffer = p.jumpBuffer; else s.buffer = Math.max(0, s.buffer - dt);
  if (grounded) {
    s.coyote = p.coyoteTime; s.airDashes = p.airDashes; s.airJumps = p.airJumps; s.jumping = false;
    if (!s.prevGrounded) ev.landed = true;
  } else s.coyote = Math.max(0, s.coyote - dt);
  s.prevGrounded = grounded;
  s.dashCd = Math.max(0, s.dashCd - dt); s.lock = Math.max(0, s.lock - dt); s.ledgeCd = Math.max(0, s.ledgeCd - dt);
  const hasInput = desired.lengthSq() > 0.01;
  // ---- ledge hang / climb (bypasses integration)
  if (s.ledge) return ledgeStep(ctrl, p, s, dt, desired, jump);
  // ---- dash
  if (dash && p.dash && s.dashCd <= 0 && s.dashT <= 0 && (grounded || s.airDashes > 0)) {
    if (hasInput) s.dashDir.set(desired.x, 0, desired.z).normalize(); else ctrl.forward(s.dashDir);
    s.dashT = p.dashTime; s.dashCd = p.dashCooldown + p.dashTime; if (!grounded) s.airDashes--;
    s.dashes++; ev.dashed = true;
  }
  if (s.dashT > 0) {
    s.dashT -= dt;
    v.set(s.dashDir.x * p.dashSpeed, 0, s.dashDir.z * p.dashSpeed);
    if (s.buffer > 0 && (grounded || s.coyote > 0)) { s.dashT = 0; doJump(ctrl, p, s, ev); } // dash-jump keeps momentum
    if (s.dashT <= 0) { const h = Math.hypot(v.x, v.z), cap = p.runSpeed * 1.15; if (h > cap) { v.x *= cap / h; v.z *= cap / h; } }
    s.state = 'dash'; ctrl.facing = Math.atan2(s.dashDir.x, s.dashDir.z);
    return;
  }
  // ---- horizontal: linear acceleration toward target (precise, frame-rate independent)
  const top = speed > 0 ? speed : p.runSpeed;
  const tx = desired.x * top, tz = desired.z * top;
  let acc = grounded ? (hasInput ? p.groundAccel : p.groundDecel) : (hasInput ? p.airAccel : p.airDecel);
  if (s.lock > 0) acc *= 0.15;
  const dx = tx - v.x, dz = tz - v.z, dl = Math.hypot(dx, dz), maxD = acc * dt;
  if (dl <= maxD) { v.x = tx; v.z = tz; } else { v.x += dx / dl * maxD; v.z += dz / dl * maxD; }
  if (faceMovement && hasInput && s.lock <= 0) {
    const yaw = Math.atan2(desired.x, desired.z);
    let d = yaw - ctrl.facing; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
    ctrl.facing += d * (1 - Math.exp(-p.turnRate * dt));
  }
  // ---- walls (from the previous integration's contacts)
  let wall = null;
  for (const h of ctrl.hits) if (!h.shape.userData?.noWall) { wall = h; break; }
  const pushing = wall && hasInput && (desired.x * wall.nx + desired.z * wall.nz) < -0.3;
  if (!grounded && wall && pushing) { s.wallTimer = p.wallCoyote; s.wallNormal.set(wall.nx, 0, wall.nz); s.wallShape = wall.shape; }
  else s.wallTimer = Math.max(0, s.wallTimer - dt);
  s.sliding = p.wallSlide && !grounded && !!pushing && v.y < 0;
  // ---- ledge grab: falling/slow-rising against a box whose top is at hand height
  if (p.ledgeGrab && !grounded && pushing && s.ledgeCd <= 0 && v.y <= 2 && wall.shape.type === 'box' && !wall.shape.userData?.noLedge) {
    const topY = wall.shape.maxY, hands = ctrl.position.y + ctrl.height * 0.9;
    if (topY >= hands - p.ledgeReach && topY <= hands + p.ledgeReach * 0.6 && ledgeIsFree(ctrl, wall, topY)) {
      s.ledge = { shape: wall.shape, normal: new THREE.Vector3(wall.nx, 0, wall.nz), t: 0, climbing: false, from: null, to: null };
      ctrl.position.y = topY - ctrl.height * 0.9; v.set(0, 0, 0); ctrl.grounded = false;
      ctrl.facing = Math.atan2(-wall.nx, -wall.nz); s.ledgeGrabs++; ev.ledgeGrab = true; s.state = 'ledge';
      return 'skip';
    }
  }
  // ---- jumps: ground/coyote, wall, air
  if (s.buffer > 0) {
    if (grounded || s.coyote > 0) doJump(ctrl, p, s, ev);
    else if (p.wallJump && s.wallTimer > 0) {
      v.y = p.wallJumpUp; v.x = s.wallNormal.x * p.wallJumpOut; v.z = s.wallNormal.z * p.wallJumpOut;
      s.lock = p.wallJumpLock; s.wallTimer = 0; s.buffer = 0; s.jumping = true; s.airDashes = p.airDashes;
      ctrl.facing = Math.atan2(s.wallNormal.x, s.wallNormal.z); s.wallJumps++; ev.wallJumped = true; ctrl.justJumped = true;
    } else if (s.airJumps > 0) { s.airJumps--; doJump(ctrl, p, s, ev); ev.airJump = true; }
  }
  // ---- variable jump height: releasing early cuts the rise
  if (s.jumping && !jumpHeld && v.y > 0) { v.y *= p.jumpCut; s.jumping = false; }
  if (v.y <= 0) s.jumping = false;
  // ---- gravity (lighter rising, heavier falling), wall slide clamp, terminal velocity
  if (!ctrl.grounded) {
    v.y -= (v.y > 0 ? p.gravity : p.fallGravity) * ctrl.gravityScale * dt;
    if (s.sliding) v.y = Math.max(v.y, -p.wallSlideSpeed);
    v.y = Math.max(v.y, -p.maxFall);
  }
  s.state = ctrl.grounded ? (Math.hypot(v.x, v.z) > 0.5 ? 'run' : 'idle') : s.sliding ? 'wallSlide' : v.y > 0 ? 'jump' : 'fall';
}

function doJump(ctrl, p, s, ev) {
  ctrl.velocity.y = p.jumpVelocity; s.buffer = 0; s.coyote = 0; s.jumping = true;
  ctrl.grounded = false; ctrl.jumps++; ctrl.justJumped = true; s.jumpCount++; ev.jumped = true;
}

function ledgeIsFree(ctrl, wall, topY) {
  // nothing solid right above the ledge where the body would stand
  const w = ctrl.world, nx = -wall.nx, nz = -wall.nz;
  const x = ctrl.position.x + nx * (ctrl.radius * 2 + 0.2), z = ctrl.position.z + nz * (ctrl.radius * 2 + 0.2);
  const r = w.resolveCylinder(x, z, ctrl.radius * 0.8, topY + 0.05, topY + ctrl.height);
  return r.hits.length === 0;
}

function ledgeStep(ctrl, p, s, dt, desired, jump) {
  const L = s.ledge, n = L.normal;
  ctrl.velocity.set(0, 0, 0); ctrl.grounded = false;
  if (!ctrl.world.statics.has(L.shape.id)) { s.ledge = null; s.ledgeCd = 0.3; return 'skip'; } // ledge crumbled away
  if (!L.climbing) {
    L.t += dt; s.state = 'ledge';
    const into = -(desired.x * n.x + desired.z * n.z), away = -into;
    if (L.t > 0.1 && jump && away > 0.5) { // jump away from the wall
      s.ledge = null; s.ledgeCd = 0.25;
      ctrl.velocity.set(n.x * p.wallJumpOut, p.wallJumpUp, n.z * p.wallJumpOut); s.lock = p.wallJumpLock; s.jumping = true; s.events.wallJumped = true;
      return 'skip';
    }
    if (L.t > 0.1 && (jump || into > 0.5)) {
      L.climbing = true; L.ct = 0; L.from = ctrl.position.clone();
      L.to = ctrl.position.clone().addScaledVector(n, -(ctrl.radius * 2 + 0.15)); L.to.y = L.shape.maxY;
      s.events.climb = true;
    } else if (L.t > 0.1 && away > 0.5) { s.ledge = null; s.ledgeCd = 0.35; }
    return 'skip';
  }
  L.ct += dt; s.state = 'climb';
  const k = Math.min(1, L.ct / p.climbTime), ky = Math.min(1, k * 1.7), kx = k * k;
  ctrl.position.set(lerp(L.from.x, L.to.x, kx), lerp(L.from.y, L.to.y, ky * ky * (3 - 2 * ky)), lerp(L.from.z, L.to.z, kx));
  if (k >= 1) {
    ctrl.position.copy(L.to); ctrl.grounded = true; ctrl.surface = L.shape; ctrl.lastGroundY = L.to.y;
    s.ledge = null; s.ledgeCd = 0.2; s.events.climbed = true; s.prevGrounded = true;
  }
  return 'skip';
}

// ---------------------------------------------------------------------------------------
// Jump-arc math & reachability.
export function jumpArc(params, launch) {
  const p = platformerParams(params), v0 = launch ?? p.jumpVelocity;
  const apex = v0 * v0 / (2 * p.gravity), tApex = v0 / p.gravity;
  return { apex, tApex, launch: v0, gravity: p.gravity, fallGravity: p.fallGravity, runSpeed: p.runSpeed,
    // feet height above takeoff at time t (full-height jump)
    heightAt: (t) => (t <= tApex ? v0 * t - 0.5 * p.gravity * t * t : apex - 0.5 * p.fallGravity * (t - tApex) ** 2) };
}
// Time in the air until the descending feet pass `rise` metres above the takeoff (null = never).
export function airTime(params, rise = 0, launch) {
  const a = jumpArc(params, launch);
  if (rise > a.apex) return null;
  return a.tApex + Math.sqrt(2 * (a.apex - rise) / a.fallGravity);
}
// Horizontal distance covered by a full-speed, full-height jump landing `rise` above takeoff.
export function jumpReach(params, rise = 0, { launch, speed, dash = false, safety = 1 } = {}) {
  const p = platformerParams(params), t = airTime(p, rise, launch);
  if (t === null) return 0;
  return (speed ?? p.runSpeed) * t * safety + (dash && p.dash ? p.dashSpeed * p.dashTime * 0.9 : 0);
}
// Can a gap (edge-to-edge horizontal distance) with height difference `rise` be jumped?
// kind: 'jump' (default), 'spring' (launch = spring power), 'ledge' (grab the target's edge).
export function canReach(params, { gap, rise = 0, kind = 'jump', launch } = {}, { margin = 0.3, safety = 0.9, dash = false } = {}) {
  const p = platformerParams(params);
  const v0 = kind === 'spring' ? launch : p.jumpVelocity;
  const apex = jumpArc(p, v0).apex;
  const ledgeBonus = kind === 'ledge' && p.ledgeGrab ? p.height * 0.9 + p.ledgeReach * 0.5 : 0;
  const maxRise = apex + ledgeBonus - margin;
  const required = Math.max(0, gap) + p.radius * 0.5;
  if (rise > maxRise) return { ok: false, reason: 'too-high', rise, maxRise, gap, required, reach: 0 };
  // ledge: you only need to reach the wall while the hands are still at/above the top
  const evalRise = kind === 'ledge' ? Math.min(rise, apex - margin) : rise;
  const reach = jumpReach(p, evalRise + (kind === 'ledge' ? 0 : margin * 0.5), { launch: v0, safety, dash });
  const ok = reach >= required;
  return { ok, reason: ok ? null : 'too-far', rise, maxRise, gap, required, reach, airTime: airTime(p, evalRise, v0) };
}
// Largest safe gap for a rise (used by the generator).
export function maxGap(params, rise = 0, opts = {}) {
  const p = platformerParams(params);
  return Math.max(0, jumpReach(p, rise + (opts.margin ?? 0.3) * 0.5, { safety: opts.safety ?? 0.9 }) - p.radius * 0.5);
}

// Recompute every link of a level description; returns { ok, links, failures }.
export function validateLevel(desc, params = desc.params) {
  const p = platformerParams(params);
  const failures = [];
  const links = desc.links.map((l) => {
    const r = canReach(p, l);
    const out = { ...l, ok: r.ok, reach: r.reach, required: r.required, maxRise: r.maxRise, reason: r.reason };
    if (!r.ok) failures.push(out);
    return out;
  });
  return { ok: failures.length === 0, links, failures };
}

// ---------------------------------------------------------------------------------------
// Moving platform motion: returns the platform top-centre at time t (seconds).
export function motionPose(m, t, out = new THREE.Vector3()) {
  const ph = (m.phase || 0);
  if (m.type === 'linear') {
    const k = 0.5 - 0.5 * Math.cos(2 * Math.PI * (t / m.period + ph));
    return out.set(lerp(m.from[0], m.to[0], k), lerp(m.from[1], m.to[1], k), lerp(m.from[2], m.to[2], k));
  }
  if (m.type === 'circular') {
    const a = 2 * Math.PI * (t / m.period + ph) * (m.clockwise ? -1 : 1) + (m.startAngle || 0);
    const [cx, cy, cz] = m.center;
    if (m.plane === 'xy') return out.set(cx + Math.cos(a) * m.radius, cy + Math.sin(a) * m.radius, cz);
    return out.set(cx + Math.cos(a) * m.radius, cy, cz + Math.sin(a) * m.radius);
  }
  if (m.type === 'path') {
    const pts = m.points; if (!m._len) { m._seg = []; let L = 0; for (let i = 0; i < pts.length - 1 + (m.loop ? 1 : 0); i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; const d = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]); m._seg.push(d); L += d; } m._len = L; }
    let d = (t * m.speed + ph * m._len);
    if (m.loop) d = ((d % m._len) + m._len) % m._len;
    else { const c = ((d % (2 * m._len)) + 2 * m._len) % (2 * m._len); d = c > m._len ? 2 * m._len - c : c; }
    for (let i = 0; i < m._seg.length; i++) {
      if (d <= m._seg[i] || i === m._seg.length - 1) { const a = pts[i], b = pts[(i + 1) % pts.length], k = m._seg[i] ? clamp(d / m._seg[i], 0, 1) : 0; return out.set(lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)); }
      d -= m._seg[i];
    }
  }
  return out.set(...(m.from || [0, 0, 0]));
}

// ---------------------------------------------------------------------------------------
// Level runtime: owns colliders (+ optional meshes) and resolves platform carrying, springs,
// crumbling, hazards, checkpoints, collectibles and the goal for a list of controllers.
const KIND_COLORS = { static: 0x8f9bb3, moving: 0xf2a541, crumble: 0xc08a5b, spring: 0x5b6475, floor: 0x59606e, wall: 0x7d8799 };

export class PlatformerLevel {
  constructor(world, { scene = null, visuals = !!scene, killY = -14, theme = {} } = {}) {
    this.world = world; this.scene = scene; this.visuals = visuals && !!scene; this.killY = killY;
    this.theme = { grass: 0x67b356, ...KIND_COLORS, ...theme };
    this.group = new THREE.Group(); this.group.name = 'platformer-level';
    if (this.visuals) scene.add(this.group);
    this.platforms = []; this.byId = new Map(); this.movers = []; this.crumbles = []; this.springs = [];
    this.hazards = []; this.checkpoints = []; this.collectibles = []; this.goal = null; this.spawn = new THREE.Vector3();
    this.time = 0; this.activeCheckpoint = -1;
    this.stats = { deaths: 0, collected: 0, total: 0, reachedGoal: false, goalTime: null, springs: 0, respawns: 0, lastDeath: null };
    this._riding = new Map();
    this.onDeath = null; this.onRespawn = null; this.onCheckpoint = null; this.onCollect = null; this.onGoal = null; this.onSpring = null; this.onCrumble = null;
  }
  // Box platform; y is the TOP surface height. { id, x, y, z, hx, hy, hz, kind }
  addPlatform(spec) {
    const { x, y, z = 0, hx = 2, hy = 0.5, hz = 1.5, kind = 'static' } = spec;
    const id = spec.id ?? `p${this.platforms.length}`;
    const e = { id, kind, spec: { ...spec, id, x, y, z, hx, hy, hz }, hx, hy, hz, mesh: null, collider: null };
    e.collider = this.world.addStatic({ type: 'box', x, y: y - hy, z, hx, hy, hz, yaw: 0 }, { platformId: id, kind, noLedge: spec.noLedge });
    if (this.visuals) e.mesh = this._platformMesh(e);
    this.platforms.push(e); this.byId.set(id, e);
    return e;
  }
  addMoving(spec) {
    const e = this.addPlatform({ ...spec, kind: 'moving' });
    e.motion = { ...spec.motion }; e.t0 = this.time; e.pos = motionPose(e.motion, 0); e.prev = e.pos.clone(); e.delta = new THREE.Vector3(); e.vel = new THREE.Vector3();
    this._placeMover(e);
    this.movers.push(e); return e;
  }
  addCrumble(spec) { const e = this.addPlatform({ ...spec, kind: 'crumble' }); e.delay = spec.delay ?? 0.45; e.respawnTime = spec.respawn ?? 2.5; e.state = 'solid'; e.timer = 0; e.fallV = 0; this.crumbles.push(e); return e; }
  // Spring pad: a platform whose top launches the player upward at `power` m/s.
  addSpring(spec) { const e = this.addPlatform({ ...spec, kind: 'spring' }); e.power = spec.power ?? 18; e.squash = 0; this.springs.push(e); return e; }
  // Kill volume: { kind: 'spikes'|'lava', min:[x,y,z], max:[x,y,z] }
  addHazard(spec) {
    const h = { kind: spec.kind || 'spikes', min: new THREE.Vector3(...spec.min), max: new THREE.Vector3(...spec.max), mesh: null };
    if (this.visuals) h.mesh = this._hazardMesh(h);
    this.hazards.push(h); return h;
  }
  addCheckpoint({ x, y, z = 0, r = 1.6 }) {
    const c = { index: this.checkpoints.length, position: new THREE.Vector3(x, y, z), r, active: false, mesh: null };
    if (this.visuals) c.mesh = this._checkpointMesh(c);
    this.checkpoints.push(c); return c;
  }
  addCollectible({ x, y, z = 0, r = 0.6, value = 1 }) {
    const c = { position: new THREE.Vector3(x, y, z), r, value, collected: false, mesh: null };
    if (this.visuals) { c.mesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.32, 0), solid(0xffd23f, { emissive: 0xffa500, emissiveIntensity: 1.6, roughness: 0.3, metalness: 0.4 })); c.mesh.position.copy(c.position); c.mesh.castShadow = true; this.group.add(c.mesh); }
    this.collectibles.push(c); this.stats.total += value; return c;
  }
  setGoal({ x, y, z = 0, r = 1.4 }) {
    this.goal = { position: new THREE.Vector3(x, y, z), r, mesh: null };
    if (this.visuals) {
      const g = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 3.2, 8), solid(0xe8e8e8, { metalness: 0.6, roughness: 0.3 })); pole.position.y = 1.6; g.add(pole);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.7), solid(0x31d17c, { emissive: 0x13a85a, emissiveIntensity: 0.6, side: THREE.DoubleSide })); flag.position.set(0.58, 2.8, 0); g.add(flag);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.06, 6, 40), solid(0x31d17c, { emissive: 0x31d17c, emissiveIntensity: 1.2 })); ring.rotation.x = Math.PI / 2; ring.position.y = 0.05; g.add(ring);
      g.position.copy(this.goal.position); this.group.add(g); this.goal.mesh = g; this.goal.flag = flag;
    }
    return this.goal;
  }
  setSpawn(p) { this.spawn.set(p.x ?? p[0], p.y ?? p[1], p.z ?? p[2] ?? 0); return this; }
  // Instantiate a generatePlatformerLevel() description.
  build(desc) {
    this.desc = desc;
    for (const pl of desc.platforms) {
      if (pl.kind === 'moving') this.addMoving(pl);
      else if (pl.kind === 'crumble') this.addCrumble(pl);
      else if (pl.kind === 'spring') this.addSpring(pl);
      else this.addPlatform(pl);
    }
    for (const h of desc.hazards) this.addHazard(h);
    for (const c of desc.checkpoints) this.addCheckpoint(c);
    for (const c of desc.collectibles) this.addCollectible(c);
    if (desc.goal) this.setGoal(desc.goal);
    this.setSpawn(desc.start);
    return this;
  }
  platformOf(ctrl) { return ctrl.grounded && ctrl.surface ? this.byId.get(ctrl.surface.userData?.platformId) || null : null; }
  respawnPoint() { return this.activeCheckpoint >= 0 ? this.checkpoints[this.activeCheckpoint].position : this.spawn; }
  kill(ctrl, cause = 'hazard') {
    this.stats.deaths++; this.stats.lastDeath = cause;
    this.onDeath?.(ctrl, cause);
    this.respawn(ctrl);
  }
  respawn(ctrl) {
    const p = this.respawnPoint();
    ctrl.teleport(new THREE.Vector3(p.x, p.y + 0.05, p.z)); ctrl.external.set(0, 0, 0); ctrl.grounded = false;
    if (ctrl.pf) { ctrl.pf.ledge = null; ctrl.pf.dashT = 0; ctrl.pf.jumping = false; ctrl.pf.buffer = 0; }
    for (const c of this.crumbles) if (c.state !== 'solid') this._restoreCrumble(c);
    this._riding.delete(ctrl); this.stats.respawns++;
    this.onRespawn?.(ctrl, p);
  }
  // Call once per fixed step BEFORE ctrl.move().
  update(dt, ctrls = []) {
    this.time += dt;
    // movers: move colliders, then carry whoever stands (or hangs) on them
    for (const m of this.movers) {
      m.prev.copy(m.pos); motionPose(m.motion, this.time - m.t0, m.pos);
      m.delta.subVectors(m.pos, m.prev); m.vel.copy(m.delta).divideScalar(Math.max(dt, 1e-6));
      this._placeMover(m);
    }
    for (const c of ctrls) {
      const on = this.platformOf(c);
      const hang = c.pf?.ledge ? this.byId.get(c.pf.ledge.shape.userData?.platformId) : null;
      const carrier = on?.motion ? on : hang?.motion ? hang : null;
      if (carrier) {
        c.position.add(carrier.delta);
        if (hang === carrier && c.pf.ledge.climbing) { c.pf.ledge.from.add(carrier.delta); c.pf.ledge.to.add(carrier.delta); }
        this._riding.set(c, carrier);
      } else if (this._riding.has(c)) { // left a mover: inherit its velocity (decays via ctrl.external)
        const m = this._riding.get(c); this._riding.delete(c);
        if (!c.grounded) c.external.set(m.vel.x, 0, m.vel.z);
      }
      // springs
      if (on && on.kind === 'spring') {
        c.velocity.y = on.power; c.grounded = false; c.position.y += 0.02; on.squash = 1; this.stats.springs++;
        if (c.pf) { c.pf.jumping = false; c.pf.coyote = 0; c.pf.buffer = 0; c.pf.airDashes = c.pf.airDashes || 0; }
        this.onSpring?.(on, c);
      }
      // crumbling platforms start shaking when stood on
      if (on && on.kind === 'crumble' && on.state === 'solid') { on.state = 'shaking'; on.timer = on.delay; this.onCrumble?.(on, 'shake'); }
    }
    for (const cr of this.crumbles) {
      if (cr.state === 'shaking') {
        cr.timer -= dt;
        if (cr.mesh) cr.mesh.position.set(cr.spec.x + Math.sin(this.time * 70) * 0.04, cr.spec.y - cr.hy, cr.spec.z + Math.cos(this.time * 55) * 0.03);
        if (cr.timer <= 0) { cr.state = 'fallen'; cr.timer = cr.respawnTime; cr.fallV = 0; this.world.removeStatic(cr.collider); this.onCrumble?.(cr, 'fall'); }
      } else if (cr.state === 'fallen') {
        cr.timer -= dt; cr.fallV += 20 * dt;
        if (cr.mesh) { cr.mesh.position.y -= cr.fallV * dt; cr.mesh.visible = cr.mesh.position.y > this.killY; }
        if (cr.timer <= 0) this._restoreCrumble(cr);
      }
    }
    // hazards, kill plane, checkpoints, collectibles, goal
    for (const c of ctrls) {
      const p = c.position, r = c.radius;
      if (p.y < this.killY) { this.kill(c, 'fall'); continue; }
      let dead = null;
      for (const h of this.hazards) {
        if (p.x + r > h.min.x && p.x - r < h.max.x && p.z + r > h.min.z && p.z - r < h.max.z && p.y < h.max.y && p.y + c.height > h.min.y) { dead = h.kind; break; }
      }
      if (dead) { this.kill(c, dead); continue; }
      for (const cp of this.checkpoints) {
        if (cp.index > this.activeCheckpoint && Math.hypot(p.x - cp.position.x, p.z - cp.position.z) < cp.r && p.y > cp.position.y - 0.6 && p.y < cp.position.y + 3) {
          this.activeCheckpoint = cp.index; cp.active = true;
          if (cp.mesh) cp.mesh.userData.flag.material = solid(0x31d17c, { emissive: 0x31d17c, emissiveIntensity: 0.8, side: THREE.DoubleSide });
          this.onCheckpoint?.(cp, c);
        }
      }
      for (const it of this.collectibles) {
        if (!it.collected && it.position.distanceTo(_t.set(p.x, p.y + c.height * 0.5, p.z)) < it.r + c.height * 0.5) {
          it.collected = true; this.stats.collected += it.value; if (it.mesh) it.mesh.visible = false; this.onCollect?.(it, c);
        }
      }
      if (this.goal && !this.stats.reachedGoal && Math.hypot(p.x - this.goal.position.x, p.z - this.goal.position.z) < this.goal.r && Math.abs(p.y - this.goal.position.y) < 2.5) {
        this.stats.reachedGoal = true; this.stats.goalTime = this.time; this.onGoal?.(c);
      }
    }
    // visuals
    if (this.visuals) {
      for (const it of this.collectibles) if (it.mesh && !it.collected) { it.mesh.rotation.y += dt * 2.5; it.mesh.position.y = it.position.y + Math.sin(this.time * 3 + it.position.x) * 0.12; }
      for (const s of this.springs) { s.squash = Math.max(0, s.squash - dt * 5); if (s.mesh?.userData.coil) s.mesh.userData.coil.scale.y = 1 - 0.45 * Math.sin(Math.min(1, s.squash) * Math.PI); }
      if (this.goal?.flag) this.goal.flag.rotation.y = Math.sin(this.time * 2) * 0.25;
    }
  }
  _restoreCrumble(cr) {
    cr.state = 'solid'; cr.timer = 0;
    if (!this.world.statics.has(cr.collider.id)) cr.collider = this.world.addStatic({ type: 'box', x: cr.spec.x, y: cr.spec.y - cr.hy, z: cr.spec.z, hx: cr.hx, hy: cr.hy, hz: cr.hz, yaw: 0 }, { platformId: cr.id, kind: 'crumble' });
    if (cr.mesh) { cr.mesh.visible = true; cr.mesh.position.set(cr.spec.x, cr.spec.y - cr.hy, cr.spec.z); }
  }
  _placeMover(m) {
    this.world.moveStatic(m.collider, m.pos.x, m.pos.y - m.hy, m.pos.z);
    if (m.mesh) m.mesh.position.set(m.pos.x, m.pos.y - m.hy, m.pos.z);
  }
  // ---- visuals
  _platformMesh(e) {
    const { hx, hy, hz } = e, g = new THREE.Group();
    const th = this.theme;
    const bodyGeo = boxUV(roundedBox(hx * 2, hy * 2, hz * 2, Math.min(0.12, hy * 0.4), 2), 0.5);
    const bodyMat = e.kind === 'static' || e.kind === 'floor' ? pbr('rock', { color: th.static, tint: 0xd8dce6 })
      : e.kind === 'crumble' ? pbr('planks', { color: th.crumble }) : e.kind === 'moving' ? pbr('paintedMetal', { color: th.moving }) : solid(th.spring, { roughness: 0.5, metalness: 0.5 });
    const body = new THREE.Mesh(bodyGeo, bodyMat); body.castShadow = true; body.receiveShadow = true; g.add(body);
    if (e.kind === 'static' && !e.spec.noCap) {
      const cap = new THREE.Mesh(boxUV(roundedBox(hx * 2 + 0.08, 0.16, hz * 2 + 0.08, 0.06, 1), 0.5), pbr('grass', { color: th.grass }));
      cap.position.y = hy - 0.05; cap.receiveShadow = true; g.add(cap);
    }
    if (e.kind === 'moving') { // hazard stripes on the edges so moving pieces read instantly
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(hx * 2 + 0.02, 0.08, hz * 2 + 0.02), solid(0x1d1d1f, { roughness: 0.6 })); stripe.position.y = hy - 0.18; g.add(stripe);
    }
    if (e.kind === 'spring') {
      const coil = new THREE.Group(); coil.position.y = hy;
      const spring = new THREE.Mesh(new THREE.CylinderGeometry(Math.min(hx, hz) * 0.55, Math.min(hx, hz) * 0.55, 0.22, 16), solid(0xe63946, { emissive: 0x6b0f17, emissiveIntensity: 0.6, roughness: 0.35 }));
      spring.position.y = 0.11; coil.add(spring); g.add(coil); g.userData.coil = coil;
    }
    g.position.set(e.spec.x, e.spec.y - hy, e.spec.z);
    this.group.add(g); return g;
  }
  _hazardMesh(h) {
    const size = new THREE.Vector3().subVectors(h.max, h.min), c = new THREE.Vector3().addVectors(h.min, h.max).multiplyScalar(0.5);
    const g = new THREE.Group();
    if (h.kind === 'lava') {
      const m = new THREE.Mesh(new THREE.BoxGeometry(size.x, Math.max(0.2, Math.min(size.y, 0.4)), size.z), solid(0xff5a1f, { emissive: 0xff3300, emissiveIntensity: 2.2, roughness: 0.4 }));
      m.position.set(c.x, h.max.y - 0.2, c.z); g.add(m);
    } else {
      const n = Math.max(1, Math.round(size.x / 0.5)), k = Math.max(1, Math.round(size.z / 0.5));
      const geo = new THREE.ConeGeometry(0.2, size.y, 6), mat = solid(0xb8bec9, { metalness: 0.85, roughness: 0.3 });
      const inst = new THREE.InstancedMesh(geo, mat, n * k); const mm = new THREE.Matrix4(); let i = 0;
      for (let a = 0; a < n; a++) for (let b = 0; b < k; b++) { mm.makeTranslation(h.min.x + (a + 0.5) * size.x / n, h.min.y + size.y / 2, h.min.z + (b + 0.5) * size.z / k); inst.setMatrixAt(i++, mm); }
      inst.castShadow = true; g.add(inst);
    }
    this.group.add(g); return g;
  }
  _checkpointMesh(c) {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.2, 8), solid(0xdddddd, { metalness: 0.5 })); pole.position.y = 1.1; g.add(pole);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.5), solid(0xe63946, { emissive: 0x6b0f17, emissiveIntensity: 0.5, side: THREE.DoubleSide })); flag.position.set(0.42, 1.9, 0); g.add(flag);
    g.userData.flag = flag; g.position.copy(c.position); this.group.add(g); return g;
  }
  debugState() {
    return { checkpoints: this.checkpoints.length, deaths: this.stats.deaths, respawns: this.stats.respawns, collected: this.stats.collected, total: this.stats.total, checkpoint: this.activeCheckpoint, reachedGoal: this.stats.reachedGoal, goalTime: this.stats.goalTime, springs: this.stats.springs, lastDeath: this.stats.lastDeath,
      crumbled: this.crumbles.filter((c) => c.state !== 'solid').length };
  }
}

// ---------------------------------------------------------------------------------------
// Level-chunk generator. Sections are laid out along +X (side-on course, depth along Z) from
// parameterised pieces (random from `kinds`, or a fixed `sequence` for authored rhythm); every link is checked with canReach() and pieces are re-rolled /
// shrunk until reachable, so the returned level is guaranteed solvable by the given profile.
export const PIECES = ['gap', 'stairs', 'drop', 'moving', 'circular', 'path', 'spring', 'crumble', 'spikes', 'lava', 'ledge'];

export function generatePlatformerLevel({ seed = 1, pieces = 10, difficulty = 0.5, profile, params, kinds = PIECES, checkpointEvery = 3, collectibles = true, depth = 3, startLength = 8, safety = 0.85, sequence = null } = {}) {
  const p = platformerParams(params || profile || {});
  const rng = new RNG(seed);
  const hz = depth / 2;
  const plats = [], hazards = [], checkpoints = [], items = [], links = [], path = [], sections = [];
  let nid = 0;
  const add = (spec) => { const pl = { id: `p${nid++}`, z: 0, hz, hy: 0.5, kind: 'static', ...spec }; plats.push(pl); return pl; };
  const onPath = (pl) => { path.push(pl.id); return pl; };
  const left = (pl) => pl.x - pl.hx, right = (pl) => pl.x + pl.hx;
  const link = (from, to, gap, rise, kind = 'jump', extra = {}) => { const l = { from: from.id, to: to.id, gap, rise, kind, ...extra }; const r = canReach(p, l); Object.assign(l, { ok: r.ok, reach: r.reach, required: r.required, maxRise: r.maxRise }); links.push(l); return l; };
  const apex = jumpArc(p).apex;
  const safeGap = (rise) => maxGap(p, rise, { safety }) ;
  const dd = () => clamp(difficulty * (0.55 + 0.9 * rng.next()), 0, 1);
  // start
  let cur = onPath(add({ x: startLength / 2 - 2, y: 0, hx: startLength / 2, hy: 1, start: true }));
  const start = { x: 0, y: 0, z: 0 };
  const coinArc = (a, b, gap, rise) => { if (!collectibles) return; const x0 = right(a), y0 = a.y; items.push({ x: x0 + gap * 0.5, y: y0 + Math.max(rise, 0) + Math.min(apex * 0.75, 1.6) + 0.4, z: 0 }); };
  const next = (pl, gap, rise, kind, extra) => { const l = link(cur, pl, gap, rise, kind, extra); coinArc(cur, pl, gap, rise); cur = onPath(pl); return l; };
  const platform = (gap, rise, len, extra = {}) => { const x0 = right(cur) + gap; return add({ x: x0 + len / 2, y: cur.y + rise, hx: len / 2, ...extra }); };

  // sections where the player has to wait (movers) must start from solid ground
  const ensureStatic = () => { if (cur.kind !== 'static') { const g = rng.range(1.2, 2); next(platform(g, 0, 3), g, 0); } };
  const builders = {
    gap() { const d = dd(); const rise = rng.range(-1, Math.min(1.2, apex * 0.5)); const g = lerp(1.2, safeGap(rise), 0.3 + 0.65 * d); next(platform(g, rise, rng.range(2.6, 5) * (1.15 - d * 0.35)), g, rise); },
    stairs() { const n = 3; for (let i = 0; i < n; i++) { const rise = rng.range(0.6, Math.min(1.5, apex * 0.6)); const g = rng.range(0.6, Math.min(2, safeGap(rise) * 0.7)); next(platform(g, rise, rng.range(1.6, 2.4)), g, rise); } },
    drop() { const rise = -rng.range(1.5, 3.5); const g = lerp(1, safeGap(rise) * 0.8, dd()); next(platform(g, rise, rng.range(3, 5)), g, rise); },
    spikes() { const d = dd(); const rise = rng.range(-0.5, 0.6); const g = lerp(2, safeGap(rise), 0.35 + 0.55 * d); const x0 = right(cur); const floorY = Math.min(cur.y, cur.y + rise) - 3;
      const B = platform(g, rise, rng.range(3, 4.5)); add({ x: x0 + g / 2, y: floorY, hx: g / 2 + 0.6, hy: 0.4, kind: 'floor', noCap: true, noLedge: true });
      hazards.push({ kind: 'spikes', min: [x0 - 0.1, floorY - 0.1, -hz], max: [x0 + g + 0.1, floorY + 0.7, hz] }); next(B, g, rise); },
    lava() { const d = dd(); const rise = rng.range(-0.4, 0.8); const g = lerp(2, safeGap(rise), 0.35 + 0.55 * d); const x0 = right(cur); const ly = Math.min(cur.y, cur.y + rise) - 2.6;
      const B = platform(g, rise, rng.range(3, 4.5)); hazards.push({ kind: 'lava', min: [x0 - 0.6, ly - 6, -hz - 1], max: [x0 + g + 0.6, ly, hz + 1] }); next(B, g, rise); },
    crumble() { const n = rng.int(2, 3); for (let i = 0; i < n; i++) { const rise = rng.range(-0.4, 0.6); const g = rng.range(1.2, Math.min(3, safeGap(rise) * 0.75)); next(platform(g, rise, 2, { kind: 'crumble', hy: 0.3 }), g, rise); } },
    moving() { // linear shuttle across a wide chasm
      ensureStatic();
      const G = rng.range(7, 10.5), hxm = 1.3, g1 = 1.1, g2 = 1.1, rise = rng.range(0, 0.6);
      const x0 = right(cur), nearX = x0 + g1 + hxm, farX = x0 + G - g2 - hxm, y = cur.y + rise;
      const M = add({ x: nearX, y, hx: hxm, hy: 0.3, hz: 1.3, kind: 'moving', motion: { type: 'linear', from: [nearX, y, 0], to: [farX, y, 0], period: 2 * (farX - nearX) / 2.6 + 1.2, phase: rng.next() } });
      const B = add({ x: x0 + G + 2, y: y + rng.range(-0.3, 0.5), hx: 2, hy: 0.5 });
      next(M, g1, rise, 'jump', { board: 'near', mover: M.id }); next(B, g2, B.y - y, 'jump', { board: 'far', mover: M.id });
    },
    circular() { // platform circling in the horizontal plane; board at its nearest point
      ensureStatic();
      const G = rng.range(7, 9.5), hxm = 1.2, g1 = 1.1, x0 = right(cur), R = G / 2 - g1 - hxm, cx = x0 + G / 2, y = cur.y + rng.range(0, 0.5);
      const M = add({ x: cx - R, y, hx: hxm, hy: 0.3, hz: 1.2, kind: 'moving', motion: { type: 'circular', center: [cx, y, 0], radius: R, period: rng.range(5, 6.5), plane: 'xz', startAngle: Math.PI, phase: 0 } });
      const B = add({ x: x0 + G + 2, y: y + rng.range(-0.3, 0.4), hx: 2, hy: 0.5 });
      next(M, g1, y - cur.y, 'jump', { board: 'near', mover: M.id }); next(B, g1, B.y - y, 'jump', { board: 'far', mover: M.id });
    },
    path() { // lift that travels a polyline up and across
      ensureStatic();
      const G = rng.range(7, 9), hxm = 1.2, g1 = 1.1, x0 = right(cur), y = cur.y + 0.2, lift = rng.range(1.5, 3);
      const nearX = x0 + g1 + hxm, farX = x0 + G - g1 - hxm;
      const M = add({ x: nearX, y, hx: hxm, hy: 0.3, hz: 1.2, kind: 'moving', motion: { type: 'path', points: [[nearX, y, 0], [(nearX + farX) / 2, y + lift, 0], [farX, y + lift, 0]], speed: 2.4, loop: false, phase: 0 } });
      const B = add({ x: x0 + G + 2, y: y + lift + rng.range(-0.2, 0.4), hx: 2, hy: 0.5 });
      next(M, g1, 0.2, 'jump', { board: 'near', mover: M.id }); next(B, g1, B.y - (y + lift), 'jump', { board: 'far', mover: M.id });
    },
    spring() { // spring pad launches to a ledge far above normal jump height
      const g1 = rng.range(1, 2), padRise = rng.range(-0.3, 0.3); const pad = platform(g1, padRise, 1.8, { kind: 'spring', hy: 0.35 });
      const rise = rng.range(apex + 0.8, apex + 2.6), power = Math.sqrt(2 * p.gravity * (rise + 1.6)); pad.power = +power.toFixed(2);
      next(pad, g1, padRise);
      const g2 = rng.range(0.8, 1.6); next(add({ x: right(pad) + g2 + 2.2, y: pad.y + rise, hx: 2.2, hy: 0.6 }), g2, rise, 'spring', { launch: pad.power });
    },
    ledge() { // tall block slightly above jump height: reachable by grabbing the ledge
      const g = rng.range(0.7, 1.4), rise = rng.range(apex + 0.25, apex + 0.9), len = rng.range(3, 4.5); const x0 = right(cur) + g;
      const B = add({ x: x0 + len / 2, y: cur.y + rise, hx: len / 2, hy: (rise + 3) / 2 });
      next(B, g, rise, 'ledge');
    },
  };
  let pendingCp = false;
  for (let i = 0; i < pieces; i++) {
    const kind = sequence ? sequence[i % sequence.length] : rng.pick(kinds);
    const before = { links: links.length, plats: plats.length, hazards: hazards.length, items: items.length, path: path.length, cur };
    let tries = 0;
    for (;;) {
      builders[kind]();
      const bad = links.slice(before.links).some((l) => !l.ok);
      if (!bad || ++tries > 6) break;
      // roll back and retry with an easier roll
      links.length = before.links; plats.length = before.plats; hazards.length = before.hazards; items.length = before.items; path.length = before.path; cur = before.cur;
      difficulty *= 0.7;
    }
    sections.push(kind);
    if (checkpointEvery && (i + 1) % checkpointEvery === 0 && i < pieces - 1) pendingCp = true;
    // checkpoints go on the first solid platform at/after the section boundary
    if (pendingCp && cur.kind === 'static') { checkpoints.push({ x: cur.x - cur.hx + 0.9, y: cur.y, z: 0 }); pendingCp = false; }
  }
  // goal platform
  const gGap = rng.range(1.2, 2.2); next(platform(gGap, 0, 6, { goal: true, hy: 1 }), gGap, 0);
  const goal = { x: cur.x + 1, y: cur.y, z: 0, r: 1.4 };
  const lowest = Math.min(...plats.map((q) => q.y - q.hy * 2));
  const desc = { seed, params: p, start, goal, platforms: plats, hazards, checkpoints, collectibles: items, links, path, sections, killY: lowest - 6, length: right(cur) };
  desc.report = validateLevel(desc, p);
  return desc;
}

// ---------------------------------------------------------------------------------------
const _bp = new THREE.Vector3();
// Bot: plays a generated level through the same inputs a player would use. update() returns
// { moveX (-1..1 along +X), moveZ, jump (pressed edge), jumpHeld, dash }.
export class PlatformerBot {
  constructor(level, ctrl, { params } = {}) {
    this.level = level; this.ctrl = ctrl; this.p = platformerParams(params || level.desc?.params || {});
    this.path = level.desc.path; this.linkBy = new Map(level.desc.links.map((l) => [l.from + '>' + l.to, l]));
    this.index = 0; this.holdJump = 0; this.wait = 0; this.out = { moveX: 0, moveZ: 0, jump: false, jumpHeld: false, dash: false };
  }
  _box(id) { const e = this.level.byId.get(id); const c = e.collider; return { e, x0: c.x - c.hx, x1: c.x + c.hx, y: c.maxY, x: c.x, z: c.z }; }
  update(dt) {
    const c = this.ctrl, o = this.out, p = this.p;
    o.jump = false; o.dash = false;
    const on = this.level.platformOf(c);
    if (on) { const k = this.path.indexOf(on.id); if (k >= 0 && k !== this.index) { this.index = k; this.committed = null; } }
    if (this.level.stats.reachedGoal) { o.moveX = 0; o.jumpHeld = false; return o; }
    const fromId = this.path[this.index], toId = this.path[Math.min(this.index + 1, this.path.length - 1)];
    const A = this._box(fromId), B = this._box(toId), L = this.linkBy.get(fromId + '>' + toId) || { kind: 'jump', gap: B.x0 - A.x1, rise: 0 };
    const x = c.position.x, vx = c.velocity.x;
    this.holdJump = Math.max(0, this.holdJump - dt); o.jumpHeld = this.holdJump > 0;
    o.moveZ = 0;
    if (c.pf?.ledge) { o.moveX = 1; return o; } // push into the wall -> climb
    if (on && on.id === fromId && fromId !== toId) {
      o.moveZ = clamp((A.z - c.position.z) * 3, -1, 1); // stay centred on (moving) platforms
      if (this.committed !== fromId + '>' + toId) this.committed = null;
      if (this.committed) { /* already running for the jump */ } else if (L.board === 'near') { // wait until the mover will be close when we arrive (predict its pose)
        const pred = motionPose(B.e.motion, this.level.time - B.e.t0 + 0.55, _bp);
        const ready = pred.x - B.e.hx - A.x1 <= L.gap + 0.3 && Math.abs(pred.z - c.position.z) < 0.45 && Math.abs(pred.y - (B.y - B.e.hy * 0) ) < 9;
        if (!ready) { o.moveX = clamp((A.x1 - 1.4 - x) * 2, -1, 1); return o; }
      } else if (L.board === 'far') { // ride, then leave when the mover reaches the far end
        const pred = motionPose(A.e.motion, this.level.time - A.e.t0 + 0.2, _bp);
        const ready = B.x0 - (pred.x + A.e.hx) <= L.gap + 0.3 && Math.abs(pred.z - B.z) < 0.4 && Math.abs(c.position.z - B.z) < 0.5;
        if (!ready) { o.moveX = clamp((A.x - x) * 2 - vx * 0.2, -1, 1); return o; }
      }
      this.committed = fromId + '>' + toId;
      if (on.kind === 'spring') { o.moveX = 1; return o; }
      o.moveX = 1;
      const edge = A.x1 - 0.12;
      if (x >= edge - Math.max(0, vx) * dt * 1.5 && c.grounded) { o.jump = true; this.holdJump = p.timeToApex + 0.15; o.jumpHeld = true; }
      return o;
    }
    // airborne (or standing somewhere off-path): steer to a landing point on the target
    o.moveZ = c.grounded ? 0 : clamp((B.z - c.position.z) * 2.5, -1, 1);
    const target = c.grounded ? Infinity : Math.min(B.x1 - 0.5, B.x0 + Math.min(1.4, (B.x1 - B.x0) / 2));
    o.moveX = target === Infinity ? 1 : clamp((target - x) * 1.6 - vx * 0.12, -1, 1);
    if (!c.grounded && c.velocity.y < 0 && x < B.x0 - 0.2) o.moveX = 1; // never brake while short of the target edge
    return o;
  }
}
