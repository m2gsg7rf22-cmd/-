// Lightweight position-based (Verlet) ragdoll, built automatically from a GameForge skeleton
// (realistic MakeHuman rig or stylized humanoid). 18 particles at the major joints, capsules
// between them for ground contact, distance constraints for bones and a stiff torso, angle
// limits as distance ranges, hinge-side constraints for knees and elbows, and ground /
// heightfield / static-wall collision. Bones are driven from the particles after activation,
// and `deactivate({ blend })` blends back to the animated pose.
import * as THREE from '../vendor/three/three.module.js';
import { rigOf, bonePos, flatGround, groundFromPhysics } from './ik.js';

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _u = new THREE.Vector3();
const DEG = Math.PI / 180;

// particle: [name, canonical bone (position source), radius (m @1.8), mass]
const PARTICLES = [
  ['pelvis', 'hips', 0.12, 6], ['chest', 'chest', 0.13, 6], ['neck', 'neck', 0.06, 1.5], ['head', null, 0.1, 3],
  ['shL', 'upperArm_L', 0.06, 2], ['elL', 'lowerArm_L', 0.05, 1.3], ['wrL', 'hand_L', 0.045, 0.7],
  ['shR', 'upperArm_R', 0.06, 2], ['elR', 'lowerArm_R', 0.05, 1.3], ['wrR', 'hand_R', 0.045, 0.7],
  ['hipL', 'upperLeg_L', 0.085, 3], ['knL', 'lowerLeg_L', 0.065, 2.5], ['anL', 'foot_L', 0.05, 1.2], ['toL', 'toe_L', 0.035, 0.4],
  ['hipR', 'upperLeg_R', 0.085, 3], ['knR', 'lowerLeg_R', 0.065, 2.5], ['anR', 'foot_R', 0.05, 1.2], ['toR', 'toe_R', 0.035, 0.4],
];
const BONE_LINKS = [['shL', 'elL'], ['elL', 'wrL'], ['shR', 'elR'], ['elR', 'wrR'], ['hipL', 'knL'], ['knL', 'anL'], ['anL', 'toL'], ['hipR', 'knR'], ['knR', 'anR'], ['anR', 'toR'], ['neck', 'head'], ['pelvis', 'chest']];
const RIGID = [['pelvis', 'hipL'], ['pelvis', 'hipR'], ['hipL', 'hipR'], ['chest', 'neck'], ['chest', 'shL'], ['chest', 'shR'], ['shL', 'shR'], ['neck', 'shL'], ['neck', 'shR']];
const SOFT = [['hipL', 'chest', 0.06], ['hipR', 'chest', 0.06], ['hipL', 'shL', 0.07], ['hipR', 'shR', 0.07], ['hipL', 'shR', 0.07], ['hipR', 'shL', 0.07]]; // spine bend/twist
// angle limits (interior angle at the middle particle, degrees)
const ANGLES = [['shL', 'elL', 'wrL', 25, 180], ['shR', 'elR', 'wrR', 25, 180], ['hipL', 'knL', 'anL', 35, 180], ['hipR', 'knR', 'anR', 35, 180],
  ['knL', 'anL', 'toL', 65, 150], ['knR', 'anR', 'toR', 65, 150], ['chest', 'neck', 'head', 125, 180], ['chest', 'hipL', 'knL', 50, 180], ['chest', 'hipR', 'knR', 50, 180],
  ['neck', 'shL', 'elL', 20, 180], ['neck', 'shR', 'elR', 20, 180],
  ['hipR', 'hipL', 'knL', 68, 140], ['hipL', 'hipR', 'knR', 68, 140]]; // hip abduction ≤ ~50°, adduction ≤ ~20°
// hinge joints: [upper, mid, lower, lateral pair, sign, enforce]. Knees must keep cross(t,s)·lateral
// on `sign`'s side (enforced); elbows only use the hinge axis to orient the arm bones (the
// shoulder's twist makes a torso-frame elbow rule wrong in many poses).
const HINGES = [['hipL', 'knL', 'anL', ['hipL', 'hipR'], 1, true], ['hipR', 'knR', 'anR', ['hipL', 'hipR'], 1, true], ['shL', 'elL', 'wrL', ['shL', 'shR'], -1, false], ['shR', 'elR', 'wrR', ['shL', 'shR'], -1, false]];
// bones driven from particles: [canonical bone, from, to, side rule]
const DRIVE = [['hips', 'pelvis', 'chest', 'pelvis'], ['spine', 'pelvis', 'chest', 'shoulders'], ['chest', 'chest', 'neck', 'shoulders'], ['neck', 'neck', 'head', 'shoulders'],
  ['upperArm_L', 'shL', 'elL', 'hinge:2'], ['lowerArm_L', 'elL', 'wrL', 'hinge:2'], ['upperArm_R', 'shR', 'elR', 'hinge:3'], ['lowerArm_R', 'elR', 'wrR', 'hinge:3'],
  ['upperLeg_L', 'hipL', 'knL', 'hinge:0'], ['lowerLeg_L', 'knL', 'anL', 'hinge:0'], ['foot_L', 'anL', 'toL', 'hinge:0'],
  ['upperLeg_R', 'hipR', 'knR', 'hinge:1'], ['lowerLeg_R', 'knR', 'anR', 'hinge:1'], ['foot_R', 'anR', 'toR', 'hinge:1']];

/**
 * new Ragdoll(model, { physics, ground, gravity, iterations, friction, damping })
 *   .activate({ velocity, impulse, point })  — start from the current pose (inherits velocity,
 *        adds an impulse in kg·m/s at a world point, e.g. the hit direction × force)
 *   .update(dt)            — simulate and drive the bones (call after the mixer / instead of it)
 *   .deactivate({ blend }) — blend back to the animation over `blend` seconds
 *   .active · .settled · .particles · .center(out)
 */
export class Ragdoll {
  constructor(model, { physics = null, ground = null, gravity = -13, iterations = 20, friction = 0.7, damping = 0.995, contactDamping = 0.08, substep = 1 / 120, map = null } = {}) {
    this.model = model; this.rig = rigOf(model, map); this.physics = physics;
    this.ground = ground || (physics ? groundFromPhysics(physics) : flatGround(0));
    Object.assign(this, { gravity, iterations, friction, damping, contactDamping, substep });
    this.active = false; this.settled = false; this.blend = null; this._acc = 0; this._still = 0;
    this.particles = []; this.byName = {}; this.constraints = [];
  }
  _build() {
    const B = this.rig.bones, m = this.model; m.updateMatrixWorld(true);
    const sc = this.rig.height / 1.8 * m.getWorldScale(_v).y;
    this.particles = []; this.byName = {};
    for (const [name, bone, r, mass] of PARTICLES) {
      let p;
      if (name === 'head') { // head centre: above the head pivot
        p = bonePos(B.head, new THREE.Vector3()).add(new THREE.Vector3(0, 0.1 * sc, 0.02 * sc).applyQuaternion(B.head.getWorldQuaternion(new THREE.Quaternion())));
      } else if (B[bone]) p = bonePos(B[bone], new THREE.Vector3());
      else if (bone?.startsWith('toe')) { const f = B['foot_' + bone.slice(-1)]; const ws = f.getWorldScale(new THREE.Vector3()).y || 1; p = f.localToWorld(new THREE.Vector3(0, -0.06 * sc / ws, 0.14 * sc / ws)); } // stylized rig: foot axes = model axes at rest
      else continue;
      const pt = { name, pos: p, prev: p.clone(), r: r * sc, invMass: 1 / mass, i: this.particles.length };
      this.particles.push(pt); this.byName[name] = pt;
    }
    const P = this.byName, C = this.constraints = [];
    const dist = (a, b, slack = 0, k = 1) => { if (!P[a] || !P[b]) return; const d = P[a].pos.distanceTo(P[b].pos); C.push({ a: P[a], b: P[b], min: d * (1 - slack), max: d * (1 + slack), k, rest: d }); };
    for (const [a, b] of BONE_LINKS) dist(a, b);
    for (const [a, b] of RIGID) dist(a, b);
    for (const [a, b, s] of SOFT) dist(a, b, s, 0.5);
    for (const [a, j, b, lo, hi] of ANGLES) {
      if (!P[a] || !P[j] || !P[b]) continue;
      const la = P[a].pos.distanceTo(P[j].pos), lb = P[b].pos.distanceTo(P[j].pos);
      const d = (deg) => Math.sqrt(la * la + lb * lb - 2 * la * lb * Math.cos(deg * DEG));
      C.push({ a: P[a], b: P[b], min: d(lo), max: d(hi) + 1e-4, k: 0.6, range: true });
    }
    this.hinges = HINGES.filter(([a, j, b]) => P[a] && P[j] && P[b]).map(([a, j, b, lat, sign, enforce]) => ({ a: P[a], j: P[j], b: P[b], l0: P[lat[0]], l1: P[lat[1]], sign, enforce, prev: null }));
    this.boneLinks = BONE_LINKS.filter(([a, b]) => P[a] && P[b]).map(([a, b]) => ({ a: P[a], b: P[b], rest: P[a].pos.distanceTo(P[b].pos) }));
    this.capsules = BONE_LINKS.concat([['pelvis', 'chest'], ['chest', 'neck']]).filter(([a, b]) => P[a] && P[b]).map(([a, b]) => [P[a], P[b]]);
  }
  /** Start simulating from the current (animated) pose. */
  activate({ velocity = null, impulse = null, point = null } = {}) {
    this._build();
    const B = this.rig.bones;
    const v0 = velocity ? velocity.clone() : new THREE.Vector3();
    const M = this.particles.reduce((s, p) => s + 1 / p.invMass, 0);
    for (const p of this.particles) {
      const v = v0.clone();
      if (impulse) {
        const at = point || this.byName.chest.pos;
        const w = Math.exp(-p.pos.distanceToSquared(at) / (2 * 0.35 * 0.35));
        v.addScaledVector(impulse, 0.6 / M + 0.4 * w * p.invMass / 3);
      }
      p.prev.copy(p.pos).addScaledVector(v, -this.substep);
    }
    // driven-bone setup: activation world rotation + activation frame
    this.drive = []; for (const hg of this.hinges) hg.axis = null; this._hingeAxes();
    for (const [canon, from, to, side] of DRIVE) {
      const bone = B[canon]; if (!bone || !this.byName[from] || !this.byName[to]) continue;
      const q0 = bone.getWorldQuaternion(new THREE.Quaternion());
      const f0 = this._frame(from, to, side, new THREE.Matrix4(), canon === 'hips' ? null : bonePos(bone, new THREE.Vector3()));
      this.drive.push({ bone, from, to, side, rel: new THREE.Quaternion().setFromRotationMatrix(f0).invert().multiply(q0), isRoot: canon === 'hips' });
    }
    this.driven = new Set(this.drive.map((d) => d.bone));
    this.model.traverse((o) => { if (o.isSkinnedMesh) o.frustumCulled = false; });
    this.active = true; this.settled = false; this.blend = null; this._acc = 0; this._still = 0; this._snap = null; this._win = 0;
    return this;
  }
  deactivate({ blend = 0.4 } = {}) {
    if (!this.active) return;
    this.active = false;
    this.blend = blend > 0 ? { t: 0, dur: blend, from: new Map(this.drive.map((d) => [d.bone, { q: d.bone.quaternion.clone(), p: d.bone.position.clone() }])) } : null;
  }
  center(out = new THREE.Vector3()) { return out.copy(this.byName.pelvis?.pos || out); }

  update(dt = 1 / 60) {
    if (this.blend) return this._blendBack(dt);
    if (!this.active) return;
    if (!this.settled) {
      this._acc += Math.min(dt, 0.1);
      while (this._acc >= this.substep) { this._acc -= this.substep; this._step(this.substep); }
      this.settled = this._still > 0.6;
    }
    this._driveBones();
  }
  /** One fixed simulation step (exposed for tests). */
  step(h = this.substep) { this._step(h); }

  _step(h) {
    const g = this.gravity * h * h; let maxMove = 0;
    for (const p of this.particles) {
      _v.subVectors(p.pos, p.prev).multiplyScalar(this.damping);
      p.prev.copy(p.pos); p.pos.add(_v); p.pos.y += g;
    }
    for (const hg of this.hinges) this._hinge(hg);
    for (let it = 0; it < this.iterations; it++) {
      for (const c of this.constraints) this._solve(c);
      this._collide();
      for (const c of this.constraints) if (!c.range && c.k === 1) this._solve(c); // bones stay rigid after contact pushes
    }
    // friction on contacts
    for (const p of this.particles) {
      if (p.contact) { // kinetic friction, and static friction below ~0.25 m/s (no creeping on slopes)
        _v.subVectors(p.pos, p.prev); const n = p.contact; const vn = _v.dot(n); _w.copy(_v).addScaledVector(n, -vn);
        p.prev.addScaledVector(_w, _w.length() < 0.25 * h ? 1 : this.friction);
        p.prev.lerp(p.pos, this.contactDamping); // lying bodies lose energy fast (no slow creeping)
      }
      maxMove = Math.max(maxMove, p.pos.distanceTo(p.prev));
    }
    this._still = maxMove < 0.0006 ? this._still + h : 0;
    // sleep test on net motion: residual constraint jitter has no net displacement
    this._win = (this._win || 0) + h;
    if (this._win >= 0.5) {
      const snap = this.particles.map((p) => p.pos.clone());
      if (this._snap && this.particles.every((p, i) => p.pos.distanceTo(this._snap[i]) < 0.025)) this._still = Math.max(this._still, 0.61);
      this._snap = snap; this._win = 0;
    }
  }
  _solve(c) {
    _v.subVectors(c.b.pos, c.a.pos); const d = _v.length(); if (d < 1e-9) return;
    let target = d < c.min ? c.min : d > c.max ? c.max : d; if (target === d) return;
    const wsum = c.a.invMass + c.b.invMass; const corr = (d - target) / d / wsum * c.k;
    c.a.pos.addScaledVector(_v, corr * c.a.invMass); c.b.pos.addScaledVector(_v, -corr * c.b.invMass);
  }
  _hinge({ a, j, b, l0, l1, sign, enforce }) {
    if (!enforce || j.contact) return; // on the ground the contact decides (avoids constraint fights)
    _v.subVectors(j.pos, a.pos); _w.subVectors(b.pos, j.pos); _u.crossVectors(_v, _w);
    const lat = _w.subVectors(l0.pos, l1.pos).normalize();
    // only clear violations (sin of the wrong-way bend > 0.1): near-straight sign noise would jitter
    if (_u.dot(lat) * sign >= -0.1 * Math.sqrt(_v.lengthSq() * _w.subVectors(b.pos, j.pos).lengthSq())) return;
    // bent the wrong way: pull the middle joint back onto the a-b line (straightens the limb)
    const ab = _v.subVectors(b.pos, a.pos); const t = THREE.MathUtils.clamp(_u.subVectors(j.pos, a.pos).dot(ab) / Math.max(1e-9, ab.lengthSq()), 0, 1);
    const onLine = a.pos.clone().addScaledVector(ab, t); j.pos.lerp(onLine, 0.08); // gradual: no pop when a bent-back knee leaves the ground
  }
  _collide() {
    const ph = this.physics;
    for (const p of this.particles) {
      p.contact = null;
      const g = this.ground(p.pos.x, p.pos.z, p.pos.y + p.r + 0.3);
      const n = g.normal; const pen = p.r - (p.pos.y - g.y) * n.y;
      if (pen > 0) { p.pos.addScaledVector(n, pen); p.contact = n; }
      if (ph) { const r = ph.resolveCylinder(p.pos.x, p.pos.z, p.r, p.pos.y - p.r, p.pos.y + p.r); p.pos.x = r.x; p.pos.z = r.z; }
    }
    // capsule mid-points (limbs and torso lying across bumps)
    for (const [a, b] of this.capsules) {
      _v.addVectors(a.pos, b.pos).multiplyScalar(0.5); const r = (a.r + b.r) * 0.5;
      const g = this.ground(_v.x, _v.z, _v.y + r + 0.3); const pen = r - (_v.y - g.y) * g.normal.y;
      if (pen > 0) { a.pos.addScaledVector(g.normal, pen); b.pos.addScaledVector(g.normal, pen); a.contact ||= g.normal; b.contact ||= g.normal; }
    }
  }
  // Hinge axis per knee/elbow: the bend normal when bent, the torso lateral when straight, kept
  // continuous over time so the limb never twists 180° when the bend plane swings around.
  _hingeAxes() {
    for (const hg of this.hinges) {
      const lat = new THREE.Vector3().subVectors(hg.l0.pos, hg.l1.pos).normalize().multiplyScalar(hg.sign);
      const t = new THREE.Vector3().subVectors(hg.j.pos, hg.a.pos), u = new THREE.Vector3().subVectors(hg.b.pos, hg.j.pos);
      const c = new THREE.Vector3().crossVectors(t, u); const sinA = c.length() / Math.max(1e-9, t.length() * u.length());
      const w = THREE.MathUtils.smoothstep(sinA, 0.08, 0.3), ref = hg.axis || lat;
      if (c.lengthSq() > 1e-12) c.normalize(); if (c.dot(ref) < 0) c.negate();
      const straight = hg.axis ? hg.axis.clone().lerp(lat, 0.05) : lat; // drift slowly to the lateral while straight
      hg.axis = straight.multiplyScalar(1 - w).addScaledVector(c, w).normalize();
    }
  }
  // orthonormal frame: X = segment direction, Y = side vector (orthogonalised), Z = X × Y
  // origin: where the bone actually is (aiming from it keeps the skinned chain on the particles)
  _frame(from, to, side, out, origin = null) {
    const P = this.byName; const x = new THREE.Vector3();
    if (side === 'pelvis') x.addVectors(P.hipL.pos, P.hipR.pos).multiplyScalar(0.5).sub(P.pelvis.pos).normalize(); // rigid pelvis triangle only
    else x.subVectors(P[to].pos, origin || P[from].pos).normalize();
    const s = new THREE.Vector3();
    if (side === 'pelvis') s.subVectors(P.hipL.pos, P.hipR.pos);
    else if (side === 'shoulders') s.subVectors(P.shL.pos, P.shR.pos);
    else s.copy(this.hinges[+side.split(':')[1]].axis); // hinge:i — knee/elbow axis (see _hingeAxes)
    s.addScaledVector(x, -s.dot(x));
    if (s.lengthSq() < 1e-8) s.set(0, 1, 0).addScaledVector(x, -x.y);
    s.normalize(); const z = new THREE.Vector3().crossVectors(x, s);
    return out.makeBasis(x, s, z);
  }
  _driveBones() {
    const W = new Map(), m4 = new THREE.Matrix4(), memo = new Map(), pmemo = new Map();
    const sc = this.model.getWorldScale(new THREE.Vector3()).y;
    const worldOf = (o) => {
      if (W.has(o)) return W.get(o); if (memo.has(o)) return memo.get(o);
      const q = o.parent && o.parent.isBone ? worldOf(o.parent).clone().multiply(o.quaternion) : o.getWorldQuaternion(new THREE.Quaternion());
      memo.set(o, q); return q;
    };
    const root = this.drive[0]?.bone;
    const posOf = (o) => {
      if (o === root) return this.byName.pelvis.pos; if (pmemo.has(o)) return pmemo.get(o);
      const p = o.parent && o.parent.isBone ? o.position.clone().multiplyScalar(sc).applyQuaternion(worldOf(o.parent)).add(posOf(o.parent)) : o.getWorldPosition(new THREE.Vector3());
      pmemo.set(o, p); return p;
    };
    this._hingeAxes();
    for (const d of this.drive) { // parents before children (DRIVE order)
      W.set(d.bone, new THREE.Quaternion().setFromRotationMatrix(this._frame(d.from, d.to, d.side, m4, d.isRoot ? null : posOf(d.bone))).multiply(d.rel));
    }
    for (const d of this.drive) {
      const pq = d.bone.parent.isBone ? worldOf(d.bone.parent) : d.bone.parent.getWorldQuaternion(new THREE.Quaternion());
      d.bone.quaternion.copy(pq.clone().invert().multiply(W.get(d.bone))).normalize();
      if (d.isRoot) { d.bone.parent.updateWorldMatrix(true, false); d.bone.position.copy(d.bone.parent.worldToLocal(this.byName.pelvis.pos.clone())); }
    }
    this.model.updateMatrixWorld(true);
  }
  _blendBack(dt) {
    const b = this.blend; b.t += dt; const k = THREE.MathUtils.smoothstep(b.t / b.dur, 0, 1);
    for (const [bone, s] of b.from) { bone.quaternion.copy(s.q.clone().slerp(bone.quaternion, k)); bone.position.lerpVectors(s.p, bone.position, k); }
    if (b.t >= b.dur) this.blend = null;
  }
  /** Max relative deviation of bone-link lengths from rest (for tests/diagnostics). */
  boneLengthError() { let e = 0; for (const l of this.boneLinks) e = Math.max(e, Math.abs(l.a.pos.distanceTo(l.b.pos) - l.rest) / l.rest); return e; }
}
