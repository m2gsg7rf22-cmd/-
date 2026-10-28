// Procedural humanoid animation library. Each clip is a pose function of normalized time
// p in [0,1) returning per-bone Euler rotations (degrees, relative to rest) and optional
// hips offset. Clips are sampled into three.js AnimationClips (quaternion + position tracks).
import * as THREE from '../vendor/three/three.module.js';
import { BONES } from '../character/humanoid.js';

const S = (x) => Math.sin(x * Math.PI * 2), C = (x) => Math.cos(x * Math.PI * 2);
const ease = (t) => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); }; // clamped smoothstep
const seg = (p, a, b) => Math.min(1, Math.max(0, (p - a) / (b - a))); // 0..1 over [a,b]
const bell = (p, a, m, b) => (p < m ? ease(seg(p, a, m)) : 1 - ease(seg(p, m, b)));

// Arms rest slightly abducted by the mesh; these keep the relaxed hang natural.
const relaxed = (o = {}) => ({ upperArm_L: [0, 0, -4], upperArm_R: [0, 0, 4], lowerArm_L: [-8, 0, 0], lowerArm_R: [-8, 0, 0], ...o });

function locomotion(p, { stride = 25, knee = 40, arm = 18, elbow = 12, bob = 0.03, lean = 4, twist = 6, kick = 0 }) {
  const s = S(p), s2 = S(p + 0.5);
  const kneeL = Math.max(0, -S(p - 0.12)) * knee + 6, kneeR = Math.max(0, -S(p + 0.38)) * knee + 6;
  return {
    hipsY: -bob * Math.abs(C(p * 2 * 0.5 + 0.25)) + bob * 0.5,
    hips: [0, twist * s, 0], spine: [lean * 0.5, -twist * 0.6 * s, 0], chest: [lean * 0.5, -twist * 0.8 * s, 0], neck: [-lean * 0.5, twist * 0.5 * s, 0], head: [-lean * 0.3, twist * 0.4 * s, 0],
    upperLeg_L: [-stride * s - kick, 0, 0], lowerLeg_L: [kneeL, 0, 0], foot_L: [Math.max(0, s) * 15 - 5, 0, 0],
    upperLeg_R: [-stride * s2 - kick, 0, 0], lowerLeg_R: [kneeR, 0, 0], foot_R: [Math.max(0, s2) * 15 - 5, 0, 0],
    upperArm_L: [arm * s, 0, -6], lowerArm_L: [-elbow - Math.max(0, -s) * elbow, 0, 0],
    upperArm_R: [arm * s2, 0, 6], lowerArm_R: [-elbow - Math.max(0, -s2) * elbow, 0, 0],
  };
}

export const CLIP_LIBRARY = {
  idle: { duration: 3.2, loop: true, pose: (p) => relaxed({ hipsY: -0.004 * (1 - C(p)), chest: [1.5 * S(p), 0, 0], spine: [1, 0, 0.6 * S(p * 0.5)], head: [-1 + S(p) * 1.5, 3 * S(p * 0.5), 0], upperArm_L: [0, 0, 3 - S(p)], upperArm_R: [0, 0, -3 + S(p)], upperLeg_L: [0, 0, -2.5], upperLeg_R: [-2, 0, 1.5], lowerLeg_R: [4, 0, 0] }) },
  combatIdle: { duration: 1.8, loop: true, pose: (p) => ({ hipsY: -0.05 - 0.008 * S(p), hips: [0, 25, 0], spine: [8, -10, 0], chest: [4 + S(p), -10, 0], head: [-6, -10, 0], upperLeg_L: [-22, 10, 0], lowerLeg_L: [30, 0, 0], upperLeg_R: [12, -10, 0], lowerLeg_R: [28, 0, 0], foot_L: [-8, 0, 0], upperArm_L: [-40, 0, -20], lowerArm_L: [-80, 0, 0], upperArm_R: [-30, 0, 20 + S(p) * 2], lowerArm_R: [-70, 0, 0], hand_R: [20, 0, 0] }) },
  walk: { duration: 1.05, loop: true, pose: (p) => locomotion(p, {}) },
  run: { duration: 0.68, loop: true, pose: (p) => locomotion(p, { stride: 42, knee: 95, arm: 45, elbow: 70, bob: 0.06, lean: 12, twist: 9 }) },
  sprint: { duration: 0.56, loop: true, pose: (p) => locomotion(p, { stride: 55, knee: 115, arm: 60, elbow: 85, bob: 0.07, lean: 20, twist: 10 }) },
  strafe: { duration: 0.8, loop: true, pose: (p) => ({ ...locomotion(p, { stride: 14, knee: 40, arm: 8, elbow: 30 }), upperLeg_L: [0, 0, 14 * S(p)], upperLeg_R: [0, 0, 14 * S(p)] }) },
  jump: { duration: 0.55, loop: false, pose: (p) => { const c = bell(p, 0, 0.25, 0.55); const e = seg(p, 0.25, 0.6); return { hipsY: -0.18 * c, spine: [20 * c - 5 * e, 0, 0], upperLeg_L: [-50 * c - 30 * e, 0, 0], lowerLeg_L: [90 * c + 50 * e, 0, 0], upperLeg_R: [-50 * c + 10 * e, 0, 0], lowerLeg_R: [90 * c + 20 * e, 0, 0], upperArm_L: [-50 * e + 30 * c, 0, -20 * e], upperArm_R: [-50 * e + 30 * c, 0, 20 * e], lowerArm_L: [-30, 0, 0], lowerArm_R: [-30, 0, 0] }; } },
  fall: { duration: 0.9, loop: true, pose: (p) => ({ spine: [-5, 0, 0], upperLeg_L: [-35, 0, 4], lowerLeg_L: [60, 0, 0], upperLeg_R: [-10, 0, -4], lowerLeg_R: [35, 0, 0], upperArm_L: [-30 + 8 * S(p), 0, -55], upperArm_R: [-30 - 8 * S(p), 0, 55], lowerArm_L: [-35, 0, 0], lowerArm_R: [-35, 0, 0] }) },
  land: { duration: 0.35, loop: false, pose: (p) => { const c = 1 - ease(p); return relaxed({ hipsY: -0.22 * c, spine: [25 * c, 0, 0], upperLeg_L: [-60 * c, 0, 0], lowerLeg_L: [100 * c, 0, 0], foot_L: [-30 * c, 0, 0], upperLeg_R: [-60 * c, 0, 0], lowerLeg_R: [100 * c, 0, 0], foot_R: [-30 * c, 0, 0], upperArm_L: [-30 * c, 0, -25 * c], upperArm_R: [-30 * c, 0, 25 * c] }); } },
  // Melee combo (right hand weapon). Events: 'hit' at strike frame.
  attack1: { duration: 0.55, loop: false, events: { hit: 0.42 }, pose: (p) => { const w = bell(p, 0, 0.3, 0.6), st = bell(p, 0.3, 0.45, 1); return { hips: [0, -25 * w + 30 * st, 0], spine: [6, -20 * w + 25 * st, 0], chest: [4, -15 * w + 25 * st, 0], upperArm_R: [-60 * w - 70 * st, 0, 60 * w + 10 * st], lowerArm_R: [-90 * w - 10 * st, 0, 0], hand_R: [0, 0, -30 * st], upperArm_L: [-30, 0, -20], lowerArm_L: [-70, 0, 0], upperLeg_L: [-20 * st, 0, 0], lowerLeg_L: [20, 0, 0], upperLeg_R: [10 * st, 0, 0], lowerLeg_R: [15, 0, 0] }; } },
  attack2: { duration: 0.55, loop: false, events: { hit: 0.4 }, pose: (p) => { const w = bell(p, 0, 0.28, 0.55), st = bell(p, 0.28, 0.42, 1); return { hips: [0, 30 * w - 35 * st, 0], spine: [8, 25 * w - 30 * st, 0], chest: [4, 20 * w - 25 * st, 0], upperArm_R: [-80 * w - 40 * st, 0, -20 * w + 70 * st], lowerArm_R: [-30 * w - 20 * st, 0, 0], hand_R: [0, 0, 40 * st], upperArm_L: [-30, 0, -25], lowerArm_L: [-70, 0, 0], upperLeg_R: [-25 * st, 0, 0], lowerLeg_R: [25, 0, 0], upperLeg_L: [10, 0, 0] }; } },
  attack3: { duration: 0.8, loop: false, events: { hit: 0.55 }, pose: (p) => { const w = bell(p, 0, 0.4, 0.62), st = bell(p, 0.4, 0.55, 1); return { hipsY: -0.12 * st, hips: [0, 0, 0], spine: [-15 * w + 35 * st, 0, 0], chest: [-10 * w + 20 * st, 0, 0], upperArm_R: [-170 * w - 40 * st, 0, 15], lowerArm_R: [-40 * w, 0, 0], upperArm_L: [-170 * w - 40 * st, 0, -15], lowerArm_L: [-40 * w, 0, 0], upperLeg_L: [-40 * st, 0, 0], lowerLeg_L: [50 * st, 0, 0], upperLeg_R: [20 * st, 0, 0], lowerLeg_R: [40 * st, 0, 0] }; } },
  heavy: { duration: 1.0, loop: false, events: { hit: 0.62 }, pose: (p) => { const w = bell(p, 0, 0.5, 0.68), st = bell(p, 0.5, 0.62, 1); return { hipsY: -0.15 * st, hips: [0, -40 * w + 50 * st, 0], spine: [-10 * w + 30 * st, -30 * w + 40 * st, 0], upperArm_R: [-150 * w - 30 * st, 0, 40 * w], lowerArm_R: [-60 * w, 0, 0], upperArm_L: [-140 * w - 30 * st, 0, -10], lowerArm_L: [-60 * w, 0, 0], upperLeg_L: [-45 * st, 0, 0], lowerLeg_L: [50 * st, 0, 0], upperLeg_R: [25 * st, 0, 0], lowerLeg_R: [30 * st, 0, 0] }; } },
  punch: { duration: 0.4, loop: false, events: { hit: 0.3 }, pose: (p) => { const st = bell(p, 0.1, 0.3, 1); return { hips: [0, 25 * st, 0], spine: [5, 20 * st, 0], upperArm_R: [-85 * st - 20, 0, 10], lowerArm_R: [-90 + 85 * st, 0, 0], upperArm_L: [-40, 0, -15], lowerArm_L: [-100, 0, 0], upperLeg_L: [-15, 0, 0], lowerLeg_L: [20, 0, 0] }; } },
  kick: { duration: 0.6, loop: false, events: { hit: 0.35 }, pose: (p) => { const st = bell(p, 0.05, 0.35, 1); return { hips: [0, 0, 0], spine: [-20 * st, 0, 0], upperLeg_R: [-90 * st, 0, 0], lowerLeg_R: [60 - 55 * st, 0, 0], upperLeg_L: [10 * st, 0, 0], lowerLeg_L: [15 * st, 0, 0], upperArm_L: [-30, 0, -30], upperArm_R: [20, 0, 30] }; } },
  block: { duration: 0.3, loop: true, pose: () => ({ hipsY: -0.06, spine: [10, 0, 0], upperArm_R: [-75, 0, -20], lowerArm_R: [-100, 0, 0], hand_R: [0, 0, 60], upperArm_L: [-80, 0, 25], lowerArm_L: [-95, 0, 0], upperLeg_L: [-20, 0, 0], lowerLeg_L: [30, 0, 0], upperLeg_R: [10, 0, 0], lowerLeg_R: [25, 0, 0] }) },
  dodge: { duration: 0.6, loop: false, pose: (p) => { const r = ease(seg(p, 0.05, 0.85)), c = bell(p, 0, 0.3, 0.9); return { hipsY: -0.55 * c, hips: [360 * r, 0, 0], spine: [40 * c, 0, 0], chest: [30 * c, 0, 0], head: [30 * c, 0, 0], upperLeg_L: [-110 * c, 0, 0], lowerLeg_L: [130 * c, 0, 0], upperLeg_R: [-110 * c, 0, 0], lowerLeg_R: [130 * c, 0, 0], upperArm_L: [-60 * c, 0, -10], upperArm_R: [-60 * c, 0, 10], lowerArm_L: [-90 * c, 0, 0], lowerArm_R: [-90 * c, 0, 0] }; } },
  hit: { duration: 0.4, loop: false, pose: (p) => { const c = bell(p, 0, 0.15, 1); return relaxed({ spine: [-18 * c, 8 * c, 0], chest: [-12 * c, 0, 0], head: [-20 * c, 10 * c, 0], upperArm_L: [-30 * c, 0, -30 * c], upperArm_R: [-20 * c, 0, 35 * c], lowerArm_L: [-40 * c, 0, 0], upperLeg_L: [10 * c, 0, 0], lowerLeg_R: [20 * c, 0, 0] }); } },
  death: { duration: 1.2, loop: false, clamp: true, pose: (p) => { const f = ease(seg(p, 0.1, 0.75)), k = bell(p, 0, 0.25, 0.6); return { hipsY: -0.32 * k - 0.86 * f, hipsZ: -0.5 * f, hips: [-88 * f, 0, 6 * f], spine: [10 * k - 5 * f, 0, 0], head: [-15 * f + 10 * k, 20 * f, 0], upperLeg_L: [-30 * k - 10 * f, 0, 8 * f], lowerLeg_L: [70 * k + 10 * f, 0, 0], upperLeg_R: [-20 * k + 5 * f, 0, -6 * f], lowerLeg_R: [50 * k + 20 * f, 0, 0], upperArm_L: [-40 * k - 60 * f, 0, -40 * f], upperArm_R: [-30 * k - 50 * f, 0, 50 * f], lowerArm_L: [-30 * f, 0, 0], lowerArm_R: [-20 * f, 0, 0] }; } },
  talk: { duration: 2.4, loop: true, pose: (p) => relaxed({ head: [4 * S(p * 2), 6 * S(p), 2 * S(p * 1.5)], chest: [1, 3 * S(p), 0], upperArm_R: [-25 - 15 * Math.max(0, S(p)), 0, 15], lowerArm_R: [-60 - 20 * S(p * 2), 0, 0], hand_R: [0, 20 * S(p * 2), 0], upperArm_L: [-10 - 10 * Math.max(0, S(p + 0.5)), 0, -10], lowerArm_L: [-40, 0, 0] }) },
  wave: { duration: 1.4, loop: true, pose: (p) => relaxed({ upperArm_R: [-20, 0, 150], lowerArm_R: [-20, 0, 25 * S(p * 2)], head: [-4, -8, 0] }) },
  cheer: { duration: 1.0, loop: true, pose: (p) => ({ hipsY: 0.05 * Math.abs(S(p)), upperArm_L: [-10, 0, -150 - 10 * S(p)], upperArm_R: [-10, 0, 150 + 10 * S(p)], lowerArm_L: [-20, 0, 0], lowerArm_R: [-20, 0, 0], head: [-15, 0, 0] }) },
  sit: { duration: 2, loop: true, pose: (p) => ({ hipsY: -0.48, upperLeg_L: [-90, 0, 4], lowerLeg_L: [90, 0, 0], upperLeg_R: [-90, 0, -4], lowerLeg_R: [90, 0, 0], spine: [-4 + S(p), 0, 0], upperArm_L: [-30, 0, -5], lowerArm_L: [-40, 0, 0], upperArm_R: [-30, 0, 5], lowerArm_R: [-40, 0, 0] }) },
  drive: { duration: 2, loop: true, pose: () => ({ hipsY: -0.42, upperLeg_L: [-80, 0, 6], lowerLeg_L: [70, 0, 0], upperLeg_R: [-80, 0, -6], lowerLeg_R: [70, 0, 0], spine: [-10, 0, 0], upperArm_L: [-60, 0, 12], lowerArm_L: [-40, 0, 0], upperArm_R: [-60, 0, -12], lowerArm_R: [-40, 0, 0] }) },
  cast: { duration: 0.8, loop: false, events: { hit: 0.45 }, pose: (p) => { const w = bell(p, 0, 0.3, 0.5), st = bell(p, 0.3, 0.45, 1); return { spine: [-8 * w + 10 * st, 0, 0], upperArm_R: [-30 * w - 80 * st, 0, 20 - 10 * st], lowerArm_R: [-80 * w - 5 * st, 0, 0], upperArm_L: [-30 * w - 80 * st, 0, -20 + 10 * st], lowerArm_L: [-80 * w - 5 * st, 0, 0], upperLeg_L: [-20 * st, 0, 0], lowerLeg_L: [15 * st, 0, 0] }; } },
  interact: { duration: 0.9, loop: false, events: { hit: 0.5 }, pose: (p) => { const c = bell(p, 0, 0.45, 1); return relaxed({ hipsY: -0.25 * c, spine: [35 * c, 0, 0], upperLeg_L: [-50 * c, 0, 0], lowerLeg_L: [70 * c, 0, 0], upperLeg_R: [-20 * c, 0, 0], lowerLeg_R: [60 * c, 0, 0], upperArm_R: [-60 * c, 0, 5], lowerArm_R: [-20 * c, 0, 0], upperArm_L: [-50 * c, 0, -5] }); } },
  swing: { duration: 1.2, loop: true, pose: (p) => ({ hipsY: 0, upperArm_R: [-170, 0, 10], lowerArm_R: [-5, 0, 0], upperArm_L: [-20 + 15 * S(p), 0, -20], spine: [-5, 0, 0], upperLeg_L: [-40 * S(p), 0, 0], upperLeg_R: [30 * S(p), 0, 0], lowerLeg_L: [30, 0, 0], lowerLeg_R: [40, 0, 0] }) },
  fly: { duration: 1.5, loop: true, pose: (p) => ({ hips: [-70, 0, 0], head: [-50, 0, 0], neck: [-15, 0, 0], upperArm_R: [-160, 0, 8], upperArm_L: [-10, 0, -15], lowerArm_L: [-10, 0, 0], upperLeg_L: [5 + 4 * S(p), 0, 3], upperLeg_R: [-5 - 4 * S(p), 0, -3], lowerLeg_R: [25, 0, 0], lowerLeg_L: [10, 0, 0] }) },
};

const _e = new THREE.Euler(), _q = new THREE.Quaternion();
// Sample a pose function into an AnimationClip. boneFilter: optional Set of bone names to include.
export function buildClip(name, def, { fps = 30, boneFilter = null, height = 1.8, suffix = '' } = {}) {
  const frames = Math.max(2, Math.round(def.duration * fps) + 1);
  const times = new Float32Array(frames);
  const qs = {}, hipsPos = new Float32Array(frames * 3);
  const s = height / 1.8;
  for (const b of BONES) qs[b] = new Float32Array(frames * 4);
  for (let f = 0; f < frames; f++) {
    const t = (f / (frames - 1)) * def.duration; times[f] = t;
    const pose = def.pose(def.loop ? (f / (frames - 1)) % 1 : f / (frames - 1));
    for (const b of BONES) {
      const r = pose[b] || [0, 0, 0];
      _e.set(THREE.MathUtils.degToRad(r[0]), THREE.MathUtils.degToRad(r[1]), THREE.MathUtils.degToRad(r[2]), 'YXZ');
      _q.setFromEuler(_e);
      // keep quaternion continuity
      if (f > 0) { const o = (f - 1) * 4; if (qs[b][o] * _q.x + qs[b][o + 1] * _q.y + qs[b][o + 2] * _q.z + qs[b][o + 3] * _q.w < 0) _q.set(-_q.x, -_q.y, -_q.z, -_q.w); }
      qs[b].set([_q.x, _q.y, _q.z, _q.w], f * 4);
    }
    hipsPos.set([(pose.hipsX || 0) * s, 0.98 * s + (pose.hipsY || 0) * s, (pose.hipsZ || 0) * s], f * 3);
  }
  const tracks = [];
  for (const b of BONES) {
    if (b === 'root') continue;
    if (boneFilter && !boneFilter.has(b)) continue;
    tracks.push(new THREE.QuaternionKeyframeTrack(`${b}.quaternion`, times, qs[b]));
  }
  if (!boneFilter || boneFilter.has('hips')) tracks.push(new THREE.VectorKeyframeTrack('hips.position', times, hipsPos));
  const clip = new THREE.AnimationClip(name + suffix, def.duration, tracks);
  clip.userData = { loop: def.loop, events: def.events || {}, clamp: def.clamp };
  return clip;
}

export function buildClipSet(names = Object.keys(CLIP_LIBRARY), opts = {}) {
  const out = {};
  for (const n of names) out[n] = buildClip(n, CLIP_LIBRARY[n], opts);
  return out;
}

// Register custom clips at runtime (agents author new moves as pose functions).
export function defineClip(name, def) { CLIP_LIBRARY[name] = def; return def; }

// Authoring helpers for custom clips (*.anim.js scripts, see references/animation.md).
export const CLIP_HELPERS = { S, C, ease, seg, bell, relaxed, locomotion };
