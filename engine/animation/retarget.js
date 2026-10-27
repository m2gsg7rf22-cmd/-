// Animation retargeting via world-axis deltas.
// A pose is expressed as one rotation per canonical joint, in axes aligned with the world at
// rest (this is exactly what BVH channels and GameForge pose functions are). For any target
// skeleton we know each bone's rest world rotation RW; the local rotation that reproduces a
// delta D is  local = RW_parent^-1 * D * RW  (proof: world_i = D_chain * RW_i). Rest-pose
// differences (A-pose vs T-pose, splayed legs) are removed with per-bone canonicalization
// rotations computed from bone directions. Works for the parametric human rig, the legacy
// procedural humanoid, BVH files and any glTF skeleton given a bone-name mapping.
import * as THREE from '../vendor/three/three.module.js';
import { CLIP_LIBRARY } from './clips.js';

// canonical (GameForge clip) joint -> [ [targetBone, share], ... ]
export const MH_MAP = {
  hips: [['root', 1]], spine: [['spine05', 0.5], ['spine04', 0.5]], chest: [['spine03', 0.4], ['spine02', 0.3], ['spine01', 0.3]],
  neck: [['neck01', 0.5], ['neck02', 0.5]], head: [['neck03', 0.3], ['head', 0.7]],
  shoulder_L: [['clavicle.L', 1]], upperArm_L: [['upperarm01.L', 1]], lowerArm_L: [['lowerarm01.L', 1]], hand_L: [['wrist.L', 1]],
  shoulder_R: [['clavicle.R', 1]], upperArm_R: [['upperarm01.R', 1]], lowerArm_R: [['lowerarm01.R', 1]], hand_R: [['wrist.R', 1]],
  upperLeg_L: [['upperleg01.L', 1]], lowerLeg_L: [['lowerleg01.L', 1]], foot_L: [['foot.L', 1]],
  upperLeg_R: [['upperleg01.R', 1]], lowerLeg_R: [['lowerleg01.R', 1]], foot_R: [['foot.R', 1]],
};
// Canonical rest directions (world) of the GameForge clip skeleton (arms hanging slightly out, legs straight).
export const CANON_DIRS = {
  upperArm_L: [0.17, -0.985, 0], lowerArm_L: [0.12, -0.993, 0.03], hand_L: [0.12, -0.993, 0.03],
  upperArm_R: [-0.17, -0.985, 0], lowerArm_R: [-0.12, -0.993, 0.03], hand_R: [-0.12, -0.993, 0.03],
  upperLeg_L: [0.01, -1, 0.0], lowerLeg_L: [0, -1, -0.02], upperLeg_R: [-0.01, -1, 0.0], lowerLeg_R: [0, -1, -0.02],
  foot_L: [0, -0.45, 0.89], foot_R: [0, -0.45, 0.89],
};

export class Retargeter {
  /** bones: { name: THREE.Bone } in bind pose; map: canonical -> [[bone, share]] */
  constructor(bones, map = MH_MAP, { canonDirs = CANON_DIRS, hipsBone = 'root' } = {}) {
    this.bones = bones; this.map = map; this.hipsBone = hipsBone;
    this.restWorld = {}; this.restLocal = {}; this.parent = {};
    const root = Object.values(bones).find((b) => !b.parent || !bones[b.parent.name]);
    root?.updateWorldMatrix(true, true);
    for (const [n, b] of Object.entries(bones)) {
      this.restWorld[n] = b.getWorldQuaternion(new THREE.Quaternion());
      this.restLocal[n] = b.quaternion.clone();
      this.parent[n] = b.parent && bones[b.parent.name] ? b.parent.name : null;
    }
    this.restHipsPos = bones[hipsBone].position.clone();
    this.hipsHeight = bones[hipsBone].getWorldPosition(new THREE.Vector3()).y;
    // canonicalization: rotate target rest directions onto canonical directions, in chain order
    this.corr = {};
    const order = ['upperArm_L', 'lowerArm_L', 'hand_L', 'upperArm_R', 'lowerArm_R', 'hand_R', 'upperLeg_L', 'lowerLeg_L', 'foot_L', 'upperLeg_R', 'lowerLeg_R', 'foot_R'];
    const parentCanon = { lowerArm_L: 'upperArm_L', hand_L: 'lowerArm_L', lowerArm_R: 'upperArm_R', hand_R: 'lowerArm_R', lowerLeg_L: 'upperLeg_L', foot_L: 'lowerLeg_L', lowerLeg_R: 'upperLeg_R', foot_R: 'lowerLeg_R' };
    const accum = {};
    for (const c of order) {
      const tb = map[c]?.[0]?.[0]; if (!tb || !bones[tb] || !canonDirs[c]) continue;
      const dir = this.boneDir(tb); if (!dir) continue;
      const parentQ = parentCanon[c] ? accum[parentCanon[c]] || new THREE.Quaternion() : new THREE.Quaternion();
      const cur = dir.clone().applyQuaternion(parentQ);
      const q = new THREE.Quaternion().setFromUnitVectors(cur.normalize(), new THREE.Vector3(...canonDirs[c]).normalize());
      this.corr[c] = q; accum[c] = q.clone().multiply(parentQ);
    }
  }
  // finger poses per hand: number = curl amount (0 open .. 1.2 fist)
  setHands(L = 0.35, R = 0.35) { this.hands = { L, R }; this._hd = null; }
  handDeltas() { if (!this._hd) { const h = this.hands || { L: 0.35, R: 0.35 }; this._hd = { ...fingerCurl(this, 'L', h.L, h.L * 0.6), ...fingerCurl(this, 'R', h.R, h.R * 0.6) }; } return this._hd; }
  boneDir(name) {
    const b = this.bones[name]; const child = b.children.find((c) => this.bones[c.name]);
    const head = b.getWorldPosition(new THREE.Vector3());
    let tail = b.userData.tail ? b.userData.tail.clone() : child ? child.getWorldPosition(new THREE.Vector3()) : null;
    if (!tail) return null; const d = tail.sub(head); return d.lengthSq() > 1e-10 ? d.normalize() : null;
  }
  // canonical deltas { joint: THREE.Quaternion (world-aligned) } -> { bone: local quaternion }
  solve(deltas, out = {}) {
    const D = {};
    if (deltas.__bones) for (const [b, q] of Object.entries(deltas.__bones)) D[b] = q;
    for (const [c, targets] of Object.entries(this.map)) {
      let q = deltas[c] || null;
      const corr = this.corr[c];
      if (corr) q = q ? q.clone().multiply(corr) : corr.clone();
      if (!q) continue;
      for (const [b, share] of targets) D[b] = share === 1 ? q : new THREE.Quaternion().slerp(q, share);
    }
    for (const n of Object.keys(this.bones)) {
      const d = D[n]; if (!d) { out[n] = this.restLocal[n]; continue; }
      const p = this.parent[n]; const rwp = p ? this.restWorld[p] : new THREE.Quaternion();
      out[n] = rwp.clone().invert().multiply(d).multiply(this.restWorld[n]);
    }
    return out;
  }
  // Bake a GameForge pose-function clip for this skeleton.
  clipFromPoseFn(name, def, { fps = 30, boneFilter = null, suffix = '', extra = null } = {}) {
    const frames = Math.max(2, Math.round(def.duration * fps) + 1), times = new Float32Array(frames);
    const tracks = {}; const hips = new Float32Array(frames * 3);
    const e = new THREE.Euler(), deltas = {}, scale = this.hipsHeight / 0.98;
    const prev = {};
    for (let f = 0; f < frames; f++) {
      const u = def.loop ? (f / (frames - 1)) % 1 : f / (frames - 1); times[f] = (f / (frames - 1)) * def.duration;
      const pose = def.pose(u);
      for (const c of Object.keys(this.map)) { const r = pose[c]; deltas[c] = r ? new THREE.Quaternion().setFromEuler(e.set(r[0] * Math.PI / 180, r[1] * Math.PI / 180, r[2] * Math.PI / 180, 'YXZ')) : null; }
      if (extra) Object.assign(deltas, extra(u, pose));
      deltas.__bones = this.handDeltas();
      const local = this.solve(deltas);
      for (const [b, q] of Object.entries(local)) {
        if (boneFilter && !boneFilter.has(b)) continue;
        const arr = tracks[b] ||= new Float32Array(frames * 4);
        const p = prev[b]; if (p && p.dot(q) < 0) q.set(-q.x, -q.y, -q.z, -q.w);
        prev[b] = q.clone(); arr.set([q.x, q.y, q.z, q.w], f * 4);
      }
      const rp = this.restHipsPos;
      hips.set([rp.x + (pose.hipsX || 0) * scale, rp.y + (pose.hipsY || 0) * scale, rp.z + (pose.hipsZ || 0) * scale], f * 3);
    }
    const kt = Object.entries(tracks).filter(([b, arr]) => !isConstantRest(arr, this.restLocal[b])).map(([b, arr]) => new THREE.QuaternionKeyframeTrack(`${b}.quaternion`, times, arr));
    if (!boneFilter || boneFilter.has(this.hipsBone)) kt.push(new THREE.VectorKeyframeTrack(`${this.hipsBone}.position`, times, hips));
    const clip = new THREE.AnimationClip(name + suffix, def.duration, kt);
    clip.userData = { loop: def.loop, events: def.events || {}, clamp: def.clamp };
    return clip;
  }
}
function isConstantRest(arr, rest) { for (let i = 0; i < arr.length; i += 4) if (Math.abs(arr[i] - rest.x) + Math.abs(arr[i + 1] - rest.y) + Math.abs(arr[i + 2] - rest.z) + Math.abs(arr[i + 3] - rest.w) > 1e-5) return false; return true; }

// ---------------- BVH ----------------
export function parseBVH(text) {
  const tok = text.split(/\s+/).filter(Boolean); let i = 0;
  const joints = []; const stack = [];
  const next = () => tok[i++];
  if (next() !== 'HIERARCHY') throw new Error('BVH: missing HIERARCHY');
  while (i < tok.length) {
    const t = next();
    if (t === 'ROOT' || t === 'JOINT') { const j = { name: next(), parent: stack.length ? stack[stack.length - 1] : null, offset: null, channels: [], children: [] }; if (j.parent) j.parent.children.push(j); joints.push(j); stack.push(j); }
    else if (t === 'End') { next(); const e = { name: null, end: true, parent: stack[stack.length - 1], offset: null, channels: [], children: [] }; stack.push(e); }
    else if (t === 'OFFSET') { stack[stack.length - 1].offset = [+next(), +next(), +next()]; }
    else if (t === 'CHANNELS') { const n = +next(); const ch = []; for (let k = 0; k < n; k++) ch.push(next()); stack[stack.length - 1].channels = ch; }
    else if (t === '}') { const j = stack.pop(); if (j.end) j.parent.endOffset = j.offset; }
    else if (t === 'MOTION') break;
  }
  next(); const frames = +next(); next(); next(); const frameTime = +next();
  const nCh = joints.reduce((s, j) => s + j.channels.length, 0);
  const data = new Float32Array(frames * nCh); for (let k = 0; k < data.length; k++) data[k] = +tok[i++];
  return { joints, frames, frameTime, data, nCh };
}

// Retarget a BVH (whose rest pose is given by its OFFSETs) onto a Retargeter's skeleton.
// nameMap: bvhJointName -> targetBone (defaults to identical names).
export function clipFromBVH(rt, bvh, { name = 'bvh', nameMap = null, scale = null, loop = true, fps = null } = {}) {
  const b = typeof bvh === 'string' ? parseBVH(bvh) : bvh;
  // BVH rest directions (world) from offsets
  const dirOf = (j) => { const c = j.children[0]; const o = c ? c.offset : j.endOffset; if (!o) return null; const v = new THREE.Vector3(...o); return v.lengthSq() > 1e-10 ? v.normalize() : null; };
  const map = (n) => (nameMap ? nameMap[n] : n);
  // correction: rotate target rest dir onto bvh rest dir so bvh deltas apply cleanly
  const corr = {};
  const accum = new Map();
  for (const j of b.joints) {
    const tb = map(j.name); if (!tb || !rt.bones[tb]) continue;
    const bd = dirOf(j), td = rt.boneDir(tb); if (!bd || !td) continue;
    let pq = new THREE.Quaternion(); for (let p = j.parent; p; p = p.parent) if (accum.has(p)) { pq = accum.get(p); break; }
    const q = new THREE.Quaternion().setFromUnitVectors(td.clone().applyQuaternion(pq).normalize(), bd);
    corr[j.name] = q; accum.set(j, q.clone().multiply(pq));
  }
  const step = fps ? 1 / fps : b.frameTime, total = (b.frames - 1) * b.frameTime;
  const nOut = Math.max(2, Math.floor(total / step) + 1);
  const times = new Float32Array(nOut), tracks = {}, hips = new Float32Array(nOut * 3);
  const rootJ = b.joints[0];
  const hipsScale = scale ?? (rt.hipsHeight / Math.max(1e-6, Math.abs(rootJ.offset?.[1] || 0) || rt.hipsHeight));
  const e = new THREE.Euler();
  for (let f = 0; f < nOut; f++) {
    const src = Math.min(b.frames - 1, Math.round((f * step) / b.frameTime)); times[f] = f * step;
    let c = src * b.nCh; const D = {};
    const D_world = new Map();
    let rootPos = null;
    for (const j of b.joints) {
      let rx = 0, ry = 0, rz = 0, px = 0, py = 0, pz = 0; const order = [];
      for (const ch of j.channels) { const v = b.data[c++]; if (ch === 'Xposition') px = v; else if (ch === 'Yposition') py = v; else if (ch === 'Zposition') pz = v; else { order.push(ch[0]); if (ch === 'Xrotation') rx = v; else if (ch === 'Yrotation') ry = v; else rz = v; } }
      if (j === rootJ && j.channels.length > 3) rootPos = [px, py, pz];
      const deg = Math.PI / 180;
      // BVH: rotations apply in the listed order (intrinsic) -> three Euler order string
      e.set(rx * deg, ry * deg, rz * deg, order.join('') || 'XYZ');
      let q = new THREE.Quaternion().setFromEuler(e);
      if (corr[j.name]) q = q.clone().multiply(corr[j.name]);
      D[map(j.name)] = q;
      void D_world;
    }
    const local = {};
    for (const n of Object.keys(rt.bones)) {
      const d = D[n]; if (!d) continue;
      const p = rt.parent[n]; const rwp = p ? rt.restWorld[p] : new THREE.Quaternion();
      local[n] = rwp.clone().invert().multiply(d).multiply(rt.restWorld[n]);
    }
    for (const [bn, q] of Object.entries(local)) { const arr = tracks[bn] ||= new Float32Array(nOut * 4); if (f > 0) { const o = (f - 1) * 4; if (arr[o] * q.x + arr[o + 1] * q.y + arr[o + 2] * q.z + arr[o + 3] * q.w < 0) q.set(-q.x, -q.y, -q.z, -q.w); } arr.set([q.x, q.y, q.z, q.w], f * 4); }
    if (rootPos) { const s = hipsScale; const r0 = rt.restHipsPos; hips.set([r0.x + (rootPos[0] - (rootJ.offset?.[0] || 0)) * s * 0, r0.y + (rootPos[1] - (rootJ.offset?.[1] || 0)) * s, r0.z + (rootPos[2] - (rootJ.offset?.[2] || 0)) * s * 0], f * 3); }
  }
  const kt = Object.entries(tracks).map(([bn, arr]) => new THREE.QuaternionKeyframeTrack(`${bn}.quaternion`, times, arr));
  kt.push(new THREE.VectorKeyframeTrack(`${rt.hipsBone}.position`, times, hips));
  const clip = new THREE.AnimationClip(name, total, kt); clip.userData = { loop, events: {} };
  return clip;
}

// Finger poses as canonical extra deltas (curl around each finger's lateral axis).
export function fingerCurl(rt, side, amount = 0.3, thumb = 0.3) {
  const out = {};
  for (let f = 1; f <= 5; f++) for (let s = 1; s <= 3; s++) {
    const n = `finger${f}-${s}.${side}`; const b = rt.bones[n]; if (!b) continue;
    const dir = rt.boneDir(n); if (!dir) continue;
    const palm = rt.boneDir(`metacarpal2.${side}`) || dir; const side2 = rt.boneDir(`metacarpal4.${side}`) || dir;
    const across = side2.clone().sub(palm); const axis = dir.clone().cross(across.lengthSq() > 1e-8 ? across : new THREE.Vector3(1, 0, 0)).normalize();
    const ang = (f === 1 ? thumb : amount) * (s === 1 ? 0.9 : 1.2) * (side === 'L' ? 1 : -1);
    out[n] = new THREE.Quaternion().setFromAxisAngle(axis, ang);
  }
  return out;
}

export function poseLibraryFor(rt) {
  const out = {}; for (const [n, d] of Object.entries(CLIP_LIBRARY)) out[n] = rt.clipFromPoseFn(n, d); return out;
}
