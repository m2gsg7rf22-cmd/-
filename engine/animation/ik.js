// Procedural IK applied after the AnimationMixer each frame: analytic two-bone IK with a pole
// vector, CCD for longer chains, foot planting on uneven ground (per-foot ground probe, hips
// drop, foot aligned to the ground normal, weights from foot contact), look-at for
// spine/neck/head with limits and smoothing, and hand IK (reach targets, two-handed grips).
// Works on the realistic 163-bone MakeHuman rig (engine/humans.js) and on the stylized
// humanoid (engine/character/humanoid.js); `rigOf(model)` maps both onto canonical joints.
import * as THREE from '../vendor/three/three.module.js';

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const _m1 = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0);
const DEG = Math.PI / 180;

// ---------------------------------------------------------------- rig description
// Canonical joint -> bone name, for both GameForge rigs. `look` lists the look-at chain with
// the share of the rotation each bone takes (shares sum to 1).
const RIGS = {
  human: {
    detect: (b) => !!b['upperleg01.L'],
    hips: 'root', spine: 'spine05', chest: 'spine01', neck: 'neck01', head: 'head',
    upperArm_L: 'upperarm01.L', lowerArm_L: 'lowerarm01.L', hand_L: 'wrist.L',
    upperArm_R: 'upperarm01.R', lowerArm_R: 'lowerarm01.R', hand_R: 'wrist.R',
    upperLeg_L: 'upperleg01.L', lowerLeg_L: 'lowerleg01.L', foot_L: 'foot.L', toe_L: 'toe1-1.L',
    upperLeg_R: 'upperleg01.R', lowerLeg_R: 'lowerleg01.R', foot_R: 'foot.R', toe_R: 'toe1-1.R',
    look: [['spine02', 0.08], ['spine01', 0.12], ['neck01', 0.15], ['neck02', 0.15], ['head', 0.5]],
  },
  stylized: {
    detect: (b) => !!b.upperLeg_L && !!b.hips,
    hips: 'hips', spine: 'spine', chest: 'chest', neck: 'neck', head: 'head',
    upperArm_L: 'upperArm_L', lowerArm_L: 'lowerArm_L', hand_L: 'hand_L',
    upperArm_R: 'upperArm_R', lowerArm_R: 'lowerArm_R', hand_R: 'hand_R',
    upperLeg_L: 'upperLeg_L', lowerLeg_L: 'lowerLeg_L', foot_L: 'foot_L', toe_L: null,
    upperLeg_R: 'upperLeg_R', lowerLeg_R: 'lowerLeg_R', foot_R: 'foot_R', toe_R: null,
    look: [['spine', 0.08], ['chest', 0.14], ['neck', 0.28], ['head', 0.5]],
  },
};

/**
 * Describe a character's rig: { kind, bones: { canonical: THREE.Bone }, look: [[bone, share]],
 * height, scale }. Throws if the model is neither GameForge rig (pass `map` for other rigs:
 * { hips, chest, neck, head, upperArm_L, …, toe_R, look }).
 */
export function rigOf(model, map = null) {
  const B = model.userData.bones || {};
  let kind = 'custom', def = map;
  if (!def) for (const [k, r] of Object.entries(RIGS)) if (r.detect(B)) { kind = k; def = r; break; }
  if (!def) throw new Error('rigOf: unknown rig (pass a canonical bone map)');
  const bones = {};
  for (const [c, n] of Object.entries(def)) if (typeof n === 'string' && B[n]) bones[c] = B[n];
  const look = (def.look || []).filter(([n]) => B[n]).map(([n, w]) => [B[n], w]);
  const tot = look.reduce((s, l) => s + l[1], 0) || 1; for (const l of look) l[1] /= tot;
  return { kind, bones, look, height: model.userData.height || 1.8 };
}

// ---------------------------------------------------------------- bone helpers
/** World position of a bone (matrixWorld must be current). */
export function bonePos(bone, out = new THREE.Vector3()) { return out.setFromMatrixPosition(bone.matrixWorld); }
function worldQuat(obj, out) { obj.matrixWorld.decompose(_v4, out, _v3); return out; }
/** Rotate a bone by a world-space rotation q (about its own pivot) and refresh its subtree. */
export function rotateBoneWorld(bone, q) {
  const pq = bone.parent ? worldQuat(bone.parent, _q3) : _q3.identity();
  // local' = P^-1 * q * P * local
  _q2.copy(pq).invert().multiply(q).multiply(pq);
  bone.quaternion.premultiply(_q2).normalize();
  bone.updateMatrixWorld(true);
}
/** Set a bone's world rotation exactly (parent matrixWorld must be current). */
export function setBoneWorldQuat(bone, q) {
  const pq = bone.parent ? worldQuat(bone.parent, _q3) : _q3.identity();
  bone.quaternion.copy(pq.invert().multiply(q)).normalize();
  bone.updateMatrixWorld(true);
}
function perpendicular(v, out) { return Math.abs(v.x) < 0.9 ? out.set(1, 0, 0).cross(v).normalize() : out.set(0, 1, 0).cross(v).normalize(); }

// ---------------------------------------------------------------- two-bone IK
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _t = new THREE.Vector3(), _dir = new THREE.Vector3(), _pole = new THREE.Vector3(), _bd = new THREE.Vector3();
const _save1 = new THREE.Quaternion(), _save2 = new THREE.Quaternion();
/**
 * Analytic two-bone IK. root → mid → end are bones (mid a descendant of root, end of mid; twist
 * bones in between are carried along). Moves `end`'s pivot to `target` (world Vector3).
 * opts.pole: world point the middle joint (knee/elbow) bends towards; default: keep the
 * current bend plane. opts.weight 0..1 blends with the input pose. Unreachable targets
 * straighten the chain towards the target. Returns { reached, distance } (distance = residual).
 */
export function solveTwoBone(root, mid, end, target, { pole = null, weight = 1, maxReach = 0.9999 } = {}) {
  if (weight <= 0) return { reached: false, distance: Infinity };
  root.updateWorldMatrix(true, true);
  bonePos(root, _a); bonePos(mid, _b); bonePos(end, _c); _t.copy(target);
  const lab = _b.distanceTo(_a), lcb = _c.distanceTo(_b);
  _dir.subVectors(_t, _a); let dist = _dir.length();
  if (dist < 1e-6 || lab < 1e-6 || lcb < 1e-6) return { reached: false, distance: _c.distanceTo(_t) };
  _dir.divideScalar(dist);
  dist = THREE.MathUtils.clamp(dist, Math.abs(lab - lcb) + 1e-4, (lab + lcb) * maxReach);
  // bend-plane direction (perpendicular to the root→target line)
  if (pole) _pole.subVectors(pole, _a); else _pole.subVectors(_b, _a);
  _pole.addScaledVector(_dir, -_pole.dot(_dir));
  if (_pole.lengthSq() < 1e-10) { _pole.subVectors(_b, _a).addScaledVector(_dir, -_dir.dot(_v1.subVectors(_b, _a))); if (_pole.lengthSq() < 1e-10) perpendicular(_dir, _pole); }
  _pole.normalize();
  const cosA = THREE.MathUtils.clamp((lab * lab + dist * dist - lcb * lcb) / (2 * lab * dist), -1, 1), sinA = Math.sqrt(1 - cosA * cosA);
  _bd.copy(_a).addScaledVector(_dir, lab * cosA).addScaledVector(_pole, lab * sinA); // desired mid joint
  _save1.copy(root.quaternion); _save2.copy(mid.quaternion);
  _q1.setFromUnitVectors(_v1.subVectors(_b, _a).normalize(), _v2.subVectors(_bd, _a).normalize());
  rotateBoneWorld(root, _q1);
  bonePos(mid, _b); bonePos(end, _c);
  _t.copy(_a).addScaledVector(_dir, dist);
  _q1.setFromUnitVectors(_v1.subVectors(_c, _b).normalize(), _v2.subVectors(_t, _b).normalize());
  rotateBoneWorld(mid, _q1);
  if (weight < 1) {
    root.quaternion.copy(_save1.slerp(root.quaternion, weight)); mid.quaternion.copy(_save2.slerp(mid.quaternion, weight));
    root.updateMatrixWorld(true);
  }
  bonePos(end, _c);
  return { reached: _c.distanceTo(target) < 1e-3, distance: _c.distanceTo(target) };
}

/**
 * Cyclic coordinate descent for chains of any length. joints: bones from the chain root to the
 * last rotating joint; effector: the end bone (or an Object3D child) to bring to target.
 * opts: { iterations, tolerance, maxAngle (rad per joint per iteration), weights: [] }.
 */
export function solveCCD(joints, effector, target, { iterations = 12, tolerance = 1e-3, maxAngle = 0.6, weights = null } = {}) {
  joints[0].updateWorldMatrix(true, true);
  const e = new THREE.Vector3(), j = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3(), q = new THREE.Quaternion();
  let d = Infinity;
  for (let it = 0; it < iterations; it++) {
    for (let i = joints.length - 1; i >= 0; i--) {
      effector.getWorldPosition(e); bonePos(joints[i], j);
      a.subVectors(e, j); b.subVectors(target, j); if (a.lengthSq() < 1e-12 || b.lengthSq() < 1e-12) continue;
      a.normalize(); b.normalize();
      let ang = Math.acos(THREE.MathUtils.clamp(a.dot(b), -1, 1)); if (ang < 1e-5) continue;
      ang = Math.min(ang, maxAngle) * (weights ? weights[i] ?? 1 : 1);
      const axis = a.cross(b); if (axis.lengthSq() < 1e-12) continue;
      q.setFromAxisAngle(axis.normalize(), ang); rotateBoneWorld(joints[i], q);
    }
    d = effector.getWorldPosition(e).distanceTo(target); if (d < tolerance) break;
  }
  return { reached: d < tolerance, distance: d };
}

// ---------------------------------------------------------------- ground probes
/** Ground probe for a PhysicsWorld (heightfield + walkable static tops). (x, z, fromY) -> { y, normal } */
export function groundFromPhysics(world) {
  return (x, z, fromY = Infinity) => {
    const g = world.groundHeight(x, z, fromY, 0, 0);
    const normal = !g.surface && world.hf ? world.hf.normalAt(x, z, new THREE.Vector3()) : new THREE.Vector3(0, 1, 0);
    return { y: g.y, normal };
  };
}
/** Ground probe for a Heightfield (or any { heightAt, normalAt }). */
export function groundFromHeightfield(hf) { return (x, z) => ({ y: hf.heightAt(x, z), normal: hf.normalAt ? hf.normalAt(x, z, new THREE.Vector3()) : new THREE.Vector3(0, 1, 0) }); }
/** Flat ground at height y. */
export function flatGround(y = 0) { const n = new THREE.Vector3(0, 1, 0); return () => ({ y, normal: n }); }

const smooth01 = (x, a, b) => { const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const damp = (cur, to, rate, dt) => (dt <= 0 ? to : cur + (to - cur) * (1 - Math.exp(-rate * dt)));

// ---------------------------------------------------------------- the character IK controller
/**
 * Per-character procedural layer. Call `update(dt)` after the mixer has posed the skeleton and
 * after the model has been placed for the frame. Bones the mixer does not animate are restored
 * automatically, so corrections never accumulate.
 *
 * new CharacterIK(model, {
 *   ground: (x, z, fromY) => ({ y, normal }),   // groundFromPhysics(app.physics) | groundFromHeightfield(hf) | flatGround()
 *   footIK: true, maxStepUp: 0.5, maxStepDown: 0.55, footAlign: 1, maxFootTilt: 35,
 *   lookAt: true, lookLimits: { yaw: 70, up: 35, down: 40 }, lookRate: 6,
 *   handIK: true,
 * })
 * .setLookTarget(Vector3 | Object3D | { position } | null, { offsetY })
 * .setHandTarget('L'|'R', Vector3 | Object3D | null, { weight, pole, rotation })
 * .grip(weaponObject, { hand: 'L', point })   // two-handed grip: hand goes to a point on the weapon
 * .weight / .feetWeight / .lookWeight (0..1)  ·  .enabled
 */
export class CharacterIK {
  constructor(model, opts = {}) {
    this.model = model;
    this.rig = rigOf(model, opts.map || null);
    this.opts = { footIK: true, maxStepUp: 0.5, maxStepDown: 0.55, footAlign: 1, maxFootTilt: 35, lookAt: true, lookLimits: { yaw: 70, up: 35, down: 40 }, lookRate: 6, footRate: 18, hipsRate: 12, handIK: true, ...opts };
    this.ground = opts.ground || flatGround(0);
    this.enabled = true; this.weight = 1; this.feetWeight = 1; this._feetW = 1;
    this.lookTarget = null; this.lookOffsetY = 0; this._look = { yaw: 0, pitch: 0, w: 0 };
    this.hands = { L: null, R: null };
    this._first = true; this._hipsOff = 0; this._footOff = { L: 0, R: 0 };
    this._written = new Map();
    this.debug = { feet: {}, hipsOffset: 0, look: null };
    this._captureRest();
  }
  _captureRest() {
    const m = this.model, B = this.rig.bones; m.updateMatrixWorld(true);
    const base = new THREE.Vector3().setFromMatrixPosition(m.matrixWorld), mq = worldQuat(m, new THREE.Quaternion());
    this.feet = {};
    for (const s of ['L', 'R']) {
      const foot = B['foot_' + s]; if (!foot || !B['upperLeg_' + s] || !B['lowerLeg_' + s]) continue;
      const ankle = bonePos(foot, new THREE.Vector3());
      let toeW;
      if (B['toe_' + s]) toeW = bonePos(B['toe_' + s], new THREE.Vector3());
      else { const sc = this.rig.height / 1.8; toeW = ankle.clone().add(new THREE.Vector3(0, -0.07 * sc, 0.14 * sc).applyQuaternion(mq)); }
      const toeLocal = foot.worldToLocal(toeW.clone());
      this.feet[s] = { foot, upper: B['upperLeg_' + s], lower: B['lowerLeg_' + s], toeLocal, ankleH: ankle.y - base.y, toeH: toeW.y - base.y };
    }
    const head = B.head;
    if (head) {
      // forward axis of each look bone in its own local frame (character faces +Z at rest)
      this._lookFwd = new Map();
      const fwdW = new THREE.Vector3(0, 0, 1).applyQuaternion(mq);
      for (const [b] of this.rig.look) this._lookFwd.set(b, fwdW.clone().applyQuaternion(worldQuat(b, new THREE.Quaternion()).invert()));
      this._eyeLocal = head.worldToLocal(bonePos(head, new THREE.Vector3()).add(new THREE.Vector3(0, 0.08, 0.06).multiplyScalar(this.rig.height / 1.75).applyQuaternion(mq)));
    }

  }
  setLookTarget(target, { offsetY = 0 } = {}) { this.lookTarget = target; this.lookOffsetY = offsetY; return this; }
  setHandTarget(side, target, { weight = 1, pole = null, rotation = null } = {}) { this.hands[side] = target ? { target, weight, pole, rotation, w: this.hands[side]?.w ?? 0 } : null; return this; }
  /** Two-handed grip: the `hand` goes to `point` (weapon-local; default weapon.userData.gripL or a child named 'grip_L'). */
  grip(weapon, { hand = 'L', point = null, weight = 1 } = {}) {
    if (!weapon) return this.setHandTarget(hand, null);
    let p = weapon.getObjectByName?.('grip_' + hand);
    if (!p) { p = new THREE.Object3D(); p.name = 'grip_' + hand; p.position.copy(point || weapon.userData.gripL || new THREE.Vector3(0, -0.12, 0)); weapon.add(p); }
    return this.setHandTarget(hand, p, { weight });
  }
  // --- bookkeeping so the IK never accumulates on bones the mixer leaves alone
  _restore() {
    for (const [o, r] of this._written) {
      if (r.q && o.quaternion.equals(r.q)) o.quaternion.copy(r.base);
      if (r.p && o.position.equals(r.p)) o.position.copy(r.pbase);
    }
    this._written.clear();
  }
  _touch(o, pos = false) {
    let r = this._written.get(o); if (!r) { r = { base: o.quaternion.clone(), q: null }; this._written.set(o, r); }
    if (pos && !r.pbase) r.pbase = o.position.clone();
  }
  _commit() { for (const [o, r] of this._written) { r.q = o.quaternion.clone(); if (r.pbase) r.p = o.position.clone(); } }

  update(dt = 1 / 60) {
    this._restore();
    if (!this.enabled || this.weight <= 0 || !this.model.visible) { this._first = true; return; }
    const snap = this._first || dt > 0.25; const ddt = snap ? 0 : dt; this._first = false;
    this.model.updateMatrixWorld(true);
    if (this.opts.footIK) this._feet(ddt);
    if (this.opts.lookAt && this._lookFwd) this._lookAt(ddt);
    this.onBeforeHands?.(ddt); // e.g. ShoulderedWeapon poses the gun from the (now final) torso
    if (this.opts.handIK) for (const s of ['L', 'R']) this._hand(s, ddt);
    this._commit();
  }

  // ---------------- foot planting
  _feet(dt) {
    const m = this.model, F = this.feet; if (!F.L && !F.R) return;
    this._feetW = damp(this._feetW, this.feetWeight * this.weight, 8, dt);
    const W = this._feetW; if (W < 1e-3 && Math.abs(this._hipsOff) < 1e-4) { this._hipsOff = 0; return; }
    const baseY = _v1.setFromMatrixPosition(m.matrixWorld).y;
    const mq = worldQuat(m, new THREE.Quaternion()), fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(mq);
    const info = {};
    for (const s of ['L', 'R']) {
      const f = F[s]; if (!f) continue;
      const ankle = bonePos(f.foot, new THREE.Vector3()), toe = f.foot.localToWorld(f.toeLocal.clone());
      // contact: how far the animated foot is lifted above its rest height on the animation floor
      const lift = Math.min(ankle.y - baseY - f.ankleH, toe.y - baseY - f.toeH);
      const contact = 1 - smooth01(lift, 0.02, 0.14);
      const probeY = baseY + this.opts.maxStepUp + 0.3;
      const gA = this.ground(ankle.x, ankle.z, probeY), gT = this.ground(toe.x, toe.z, probeY);
      const n = gA.normal.clone();
      // heel on the ground under the ankle; raise further if the toe would cut into a step edge
      let off = gA.y - baseY;
      const pred = gA.y - (n.x * (toe.x - ankle.x) + n.z * (toe.z - ankle.z)) / Math.max(0.3, n.y);
      if (gT.y > pred + 0.02) { off += gT.y - pred; n.copy(gT.normal); }
      off = THREE.MathUtils.clamp(off, -this.opts.maxStepDown, this.opts.maxStepUp);
      this._footOff[s] = dt <= 0 ? off : damp(this._footOff[s], off, this.opts.footRate, dt);
      info[s] = { f, ankle, contact, n, off: this._footOff[s] };
    }
    // hips drop so the lowest foot can reach (never raise the body)
    const need = Math.min(0, info.L?.off ?? 0, info.R?.off ?? 0) * W;
    this._hipsOff = dt <= 0 ? need : damp(this._hipsOff, need, this.opts.hipsRate, dt);
    // flat ground under both feet: nothing to correct (cheap early-out)
    if (Math.abs(this._hipsOff) < 1e-4 && Object.values(info).every((it) => Math.abs(it.off) < 0.002 && it.n.y > 0.9995)) { this.debug.hipsOffset = this._hipsOff; return; }
    const hips = this.rig.bones.hips;
    if (Math.abs(this._hipsOff) > 1e-5) {
      this._touch(hips, true);
      const p = bonePos(hips, new THREE.Vector3()); p.y += this._hipsOff;
      hips.parent.updateWorldMatrix(true, false); hips.position.copy(hips.parent.worldToLocal(p)); hips.updateMatrixWorld(true);
    }
    this.debug.hipsOffset = this._hipsOff;
    const maxTilt = this.opts.maxFootTilt * DEG;
    for (const s of ['L', 'R']) {
      const it = info[s]; if (!it) continue; const f = it.f;
      const target = it.ankle.clone(); target.y += it.off * W; // animated ankle (before hips drop) + ground offset
      const footQ = worldQuat(f.foot, new THREE.Quaternion());
      this._touch(f.upper); this._touch(f.lower); this._touch(f.foot);
      const knee = bonePos(f.lower, new THREE.Vector3());
      solveTwoBone(f.upper, f.lower, f.foot, target, { pole: knee.addScaledVector(fwd, 0.5) });
      // foot keeps its animated orientation, then tilts onto the ground plane while in contact
      const n = it.n; let ang = Math.acos(THREE.MathUtils.clamp(n.y, -1, 1));
      const align = new THREE.Quaternion();
      if (ang > 1e-4) { if (ang > maxTilt) n.lerp(UP, 1 - maxTilt / ang).normalize(); align.setFromUnitVectors(UP, n); align.slerp(_q1.identity(), 1 - it.contact * this.opts.footAlign * W); }
      setBoneWorldQuat(f.foot, align.multiply(footQ));
      this.debug.feet[s] = { contact: +it.contact.toFixed(3), offset: +it.off.toFixed(4), target, error: bonePos(f.foot, new THREE.Vector3()).distanceTo(target) };
    }
  }

  // ---------------- look-at
  _lookAt(dt) {
    const m = this.model, L = this._look, lim = this.opts.lookLimits, head = this.rig.bones.head;
    const mq = worldQuat(m, new THREE.Quaternion()), mqi = mq.clone().invert();
    const eye = head.localToWorld(this._eyeLocal.clone());
    // current animated head direction in the model frame
    const cur = this._lookFwd.get(head).clone().applyQuaternion(worldQuat(head, _q1)).applyQuaternion(mqi);
    const yaw0 = Math.atan2(cur.x, cur.z), pitch0 = Math.asin(THREE.MathUtils.clamp(-cur.y, -1, 1));
    let wantW = 0, yawT = L.yaw, pitchT = L.pitch;
    const tp = resolveTarget(this.lookTarget, _v2);
    if (tp) {
      tp.y += this.lookOffsetY;
      const d = tp.sub(eye).applyQuaternion(mqi); const len = d.length();
      if (len > 1e-3) {
        d.divideScalar(len);
        const yawRaw = Math.atan2(d.x, d.z), pitchRaw = Math.asin(THREE.MathUtils.clamp(-d.y, -1, 1));
        const maxYaw = lim.yaw * DEG;
        wantW = 1 - smooth01(Math.abs(yawRaw), maxYaw + 25 * DEG, maxYaw + 55 * DEG); // targets far behind: let go
        yawT = THREE.MathUtils.clamp(yawRaw, -maxYaw, maxYaw); pitchT = THREE.MathUtils.clamp(pitchRaw, -lim.up * DEG, lim.down * DEG);
      }
    }
    const r = this.opts.lookRate;
    if (L.w < 1e-3 && wantW > 0) { L.yaw = yaw0; L.pitch = pitch0; } // start from the animated pose
    L.yaw = damp(L.yaw, yawT, r, dt); L.pitch = damp(L.pitch, pitchT, r, dt); L.w = damp(L.w, wantW * this.weight, r * 0.7, dt);
    this.debug.look = { yaw: L.yaw / DEG, pitch: L.pitch / DEG, weight: L.w };
    if (L.w < 1e-3) return;
    const qCur = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch0, yaw0, 0, 'YXZ'));
    const qDes = new THREE.Quaternion().setFromEuler(new THREE.Euler(L.pitch, L.yaw, 0, 'YXZ'));
    const delta = qDes.multiply(qCur.invert()); delta.slerp(_q2.identity(), 1 - L.w);
    const world = mq.clone().multiply(delta).multiply(mqi); // model-frame delta -> world
    // All shares rotate about the same axis, so they commute: each bone's new local rotation can
    // be computed from the pre-IK matrices, and the subtree is refreshed once at the end.
    const pre = this.rig.look.map(([b]) => (b.parent ? worldQuat(b.parent, new THREE.Quaternion()) : new THREE.Quaternion()));
    this.rig.look.forEach(([b, share], i) => {
      this._touch(b);
      const P = pre[i], r = new THREE.Quaternion().slerp(world, share);
      b.quaternion.premultiply(P.clone().invert().multiply(r).multiply(P)).normalize();
    });
    this.rig.look[0]?.[0].updateMatrixWorld(true);
  }

  // ---------------- hands
  _hand(s, dt) {
    const h = this.hands[s]; const B = this.rig.bones;
    if (!h) return; const up = B['upperArm_' + s], lo = B['lowerArm_' + s], hand = B['hand_' + s]; if (!up || !lo || !hand) return;
    h.w = damp(h.w ?? 0, h.weight * this.weight, 10, dt); if (h.w < 1e-3) return;
    h.target.updateWorldMatrix?.(true, false);
    const tp = resolveTarget(h.target, new THREE.Vector3()); if (!tp) return;
    const mq = worldQuat(this.model, new THREE.Quaternion());
    let pole = h.pole;
    if (!pole) { // elbow down/back/out by default
      const side = s === 'L' ? 1 : -1, sc = this.rig.height / 1.8;
      pole = bonePos(lo, new THREE.Vector3()).add(new THREE.Vector3(0.25 * side * sc, -0.35 * sc, -0.25 * sc).applyQuaternion(mq));
    }
    const handQ = worldQuat(hand, new THREE.Quaternion());
    this._touch(up); this._touch(lo); this._touch(hand);
    solveTwoBone(up, lo, hand, tp, { pole, weight: h.w });
    const rot = h.rotation || null;
    setBoneWorldQuat(hand, rot ? handQ.slerp(rot, h.w) : handQ);
  }
}
function resolveTarget(t, out) {
  if (!t) return null;
  if (t.isVector3) return out.copy(t);
  if (t.isObject3D) { t.updateWorldMatrix(true, false); return out.setFromMatrixPosition(t.matrixWorld); }
  if (t.position && t.position.isVector3) { out.copy(t.position); if (t.model?.userData?.height) out.y += t.model.userData.height * (t.model.scale?.y || 1) * 0.93; return out; }
  if (typeof t === 'function') return resolveTarget(t(), out);
  return null;
}
