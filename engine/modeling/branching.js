// Branching structures for anything that grows or forks: trees, bushes, roots, corals, antlers,
// veins, lightning, cables, horns, tentacles. Two generators produce polylines with radii:
//   lsystem() + turtle()  — grammar-driven, precise control (classic ABOP symbols)
//   spaceColonization()   — attractor-driven, organic crowns/roots filling any volume
// skinBranches() turns polylines into one smooth tapered tube mesh (parallel-transport frames).
import * as THREE from '../vendor/three/three.module.js';
import { RNG } from '../core/rng.js';

/** Rewrite an axiom. rules: { F: 'F[+F]F' } or { F: [['F[+F]', 0.6], ['F[-F]', 0.4]] } (stochastic). */
export function lsystem({ axiom = 'F', rules = {}, iterations = 3, seed = 1, maxLength = 200000 } = {}) {
  const rng = new RNG(seed); let s = axiom;
  for (let i = 0; i < iterations; i++) {
    let out = '';
    for (const ch of s) {
      const r = rules[ch];
      if (r === undefined) out += ch;
      else if (typeof r === 'string') out += r;
      else if (typeof r === 'function') out += r(rng, i);
      else { let x = rng.next(), acc = 0, pick = r[r.length - 1][0]; for (const [str, p] of r) { acc += p; if (x <= acc) { pick = str; break; } } out += pick; }
      if (out.length > maxLength) throw new Error('lsystem: string exceeds maxLength; lower iterations');
    }
    s = out;
  }
  return s;
}

/**
 * 3D turtle. Symbols: F draw forward · f move · + - yaw · & ^ pitch · \ / roll · | turn around
 * [ ] push/pop (new branch) · ! shrink radius & step · L leaf/tip marker · ' (any other) ignored.
 * opts: { step, angle (deg), radius, radiusDecay (on '!' and per branch), stepDecay, tropism [x,y,z],
 *         tropismK (bending toward tropism per step, e.g. gravity -Y or light +Y), jitter (deg), seed }
 * Returns { branches: [{ points: Vector3[], radii: number[], depth }], tips: [{ pos, dir, depth, radius }] }.
 */
export function turtle(str, { step = 1, angle = 25, radius = 0.1, radiusDecay = 0.7, stepDecay = 0.9, tropism = [0, -1, 0], tropismK = 0, jitter = 0, seed = 1, origin = [0, 0, 0] } = {}) {
  const rng = new RNG(seed), deg = Math.PI / 180, trop = new THREE.Vector3(...tropism).normalize();
  let st = { p: new THREE.Vector3(...origin), H: new THREE.Vector3(0, 1, 0), L: new THREE.Vector3(-1, 0, 0), U: new THREE.Vector3(0, 0, 1), r: radius, step, depth: 0 };
  const stack = [], branches = [], tips = [];
  let cur = { points: [st.p.clone()], radii: [st.r], depth: 0 }; branches.push(cur);
  const rot = (axis, a) => { const q = new THREE.Quaternion().setFromAxisAngle(axis, a); st.H.applyQuaternion(q); st.L.applyQuaternion(q); st.U.applyQuaternion(q); };
  const ang = () => (angle + (jitter ? rng.range(-jitter, jitter) : 0)) * deg;
  for (const ch of str) {
    switch (ch) {
      case 'F': case 'f': {
        if (tropismK) { const bend = new THREE.Vector3().crossVectors(st.H, trop); const m = bend.length(); if (m > 1e-6) rot(bend.normalize(), tropismK * m); }
        st.p = st.p.clone().addScaledVector(st.H, st.step);
        if (ch === 'F') { cur.points.push(st.p.clone()); cur.radii.push(st.r); } else { cur = { points: [st.p.clone()], radii: [st.r], depth: st.depth }; branches.push(cur); }
        break;
      }
      case '+': rot(st.U, ang()); break; case '-': rot(st.U, -ang()); break;
      case '&': rot(st.L, ang()); break; case '^': rot(st.L, -ang()); break;
      case '\\': rot(st.H, ang()); break; case '/': rot(st.H, -ang()); break;
      case '|': rot(st.U, Math.PI); break;
      case '!': st.r *= radiusDecay; st.step *= stepDecay; break;
      case '[': stack.push({ st: { ...st, p: st.p.clone(), H: st.H.clone(), L: st.L.clone(), U: st.U.clone() }, cur });
        st.depth++; st.r *= radiusDecay; cur = { points: [st.p.clone()], radii: [st.r], depth: st.depth }; branches.push(cur); break;
      case ']': { tips.push({ pos: st.p.clone(), dir: st.H.clone(), depth: st.depth, radius: st.r }); const s = stack.pop(); st = s.st; cur = s.cur; break; }
      case 'L': tips.push({ pos: st.p.clone(), dir: st.H.clone(), depth: st.depth, radius: st.r, leaf: true }); break;
      default: break;
    }
  }
  tips.push({ pos: st.p.clone(), dir: st.H.clone(), depth: st.depth, radius: st.r });
  return { branches: branches.filter((b) => b.points.length > 1), tips };
}

/**
 * Space colonization (Runions et al. 2007). attractors: Vector3[] (sample them inside any shape:
 * an ellipsoid crown, a root cone, a coral blob). Returns branches like turtle(), radii from the
 * pipe model (r^2 = sum of children r^2), plus tips.
 */
export function spaceColonization({ attractors, root = new THREE.Vector3(), rootDir = new THREE.Vector3(0, 1, 0), trunk = 0, step = 0.15, influence = 1.2, kill = 0.3, maxNodes = 4000, tipRadius = 0.01, exponent = 2.2 } = {}) {
  const nodes = [{ p: root.clone(), parent: -1, kids: 0 }];
  for (let t = step; t <= trunk; t += step) nodes.push({ p: root.clone().addScaledVector(rootDir, t), parent: nodes.length - 1, kids: 0 });
  let live = attractors.map((a) => a.clone());
  for (let iter = 0; iter < 400 && live.length && nodes.length < maxNodes; iter++) {
    const pull = new Map();
    const keep = [];
    for (const a of live) {
      let best = -1, bd = influence;
      for (let i = 0; i < nodes.length; i++) { const d = nodes[i].p.distanceTo(a); if (d < bd) { bd = d; best = i; } }
      if (best >= 0 && bd < kill) continue; // reached: drop attractor
      keep.push(a);
      if (best >= 0) { const v = a.clone().sub(nodes[best].p).normalize(); (pull.get(best) || pull.set(best, new THREE.Vector3()).get(best)).add(v); }
    }
    live = keep;
    if (!pull.size) { // nothing in range yet: extend the newest node upward
      const last = nodes.length - 1; nodes.push({ p: nodes[last].p.clone().addScaledVector(rootDir, step), parent: last, kids: 0 }); continue;
    }
    for (const [i, v] of pull) { nodes.push({ p: nodes[i].p.clone().addScaledVector(v.normalize(), step), parent: i, kids: 0 }); }
  }
  // pipe-model radii from the leaves down
  for (const n of nodes) if (n.parent >= 0) nodes[n.parent].kids++;
  const r = new Float32Array(nodes.length);
  for (let i = nodes.length - 1; i >= 0; i--) { if (!nodes[i].kids) r[i] = Math.max(r[i], tipRadius); const pr = nodes[i].parent; if (pr >= 0) r[pr] = Math.pow(Math.pow(r[pr], exponent) + Math.pow(r[i], exponent), 1 / exponent); }
  // chains: a chain starts at the root or at a child of a fork and follows single children
  const branches = [], tips = [], firstKid = new Map();
  for (let i = 1; i < nodes.length; i++) { const p = nodes[i].parent; if (p >= 0 && !firstKid.has(p)) firstKid.set(p, i); }
  for (let i = 0; i < nodes.length; i++) {
    const p = nodes[i].parent;
    if (!(p < 0 || nodes[p].kids > 1)) continue;
    const pts = p >= 0 ? [nodes[p].p.clone()] : [], rad = p >= 0 ? [r[i]] : [];
    let j = i;
    for (;;) { pts.push(nodes[j].p.clone()); rad.push(r[j]); if (nodes[j].kids !== 1) break; j = firstKid.get(j); }
    if (pts.length > 1) branches.push({ points: pts, radii: rad, depth: 0 });
    if (!nodes[j].kids) tips.push({ pos: nodes[j].p.clone(), dir: nodes[j].p.clone().sub(nodes[nodes[j].parent]?.p ?? root).normalize(), radius: r[j], depth: 1 });
  }
  return { branches, tips, nodes: nodes.length };
}

/** Sample n points inside an implicit volume: inside(x,y,z) -> bool, within bounds [[min],[max]]. */
export function sampleVolume(inside, bounds, n, seed = 1) {
  const rng = new RNG(seed), out = []; let guard = 0;
  while (out.length < n && guard++ < n * 200) { const x = rng.range(bounds[0][0], bounds[1][0]), y = rng.range(bounds[0][1], bounds[1][1]), z = rng.range(bounds[0][2], bounds[1][2]); if (inside(x, y, z)) out.push(new THREE.Vector3(x, y, z)); }
  return out;
}

/**
 * Tube mesh for polylines with per-point radii. { radial (sides), minRadius, smooth (Catmull-Rom
 * subdivisions per segment), radialFor(r) } -> BufferGeometry (uv.v runs along length in metres).
 */
export function skinBranches(branches, { radial = 8, minRadius = 0.004, smooth = 1, radialFor = null, vScale = 1 } = {}) {
  const P = [], N = [], UV = [], IDX = [];
  for (const br of branches) {
    let pts = br.points, rad = br.radii;
    if (smooth > 1 && pts.length > 2) { const c = new THREE.CatmullRomCurve3(pts); const n = (pts.length - 1) * smooth; const np = [], nr = []; for (let k = 0; k <= n; k++) { const t = k / n; np.push(c.getPoint(t)); const f = t * (rad.length - 1), i0 = Math.floor(f), i1 = Math.min(rad.length - 1, i0 + 1); nr.push(rad[i0] + (rad[i1] - rad[i0]) * (f - i0)); } pts = np; rad = nr; }
    const R = radialFor ? radialFor(rad[0]) : radial, base = P.length / 3; let normal = null, prevT = null, vAcc = 0;
    for (let k = 0; k < pts.length; k++) {
      const T = pts[Math.min(k + 1, pts.length - 1)].clone().sub(pts[Math.max(k - 1, 0)]).normalize();
      if (!normal) { normal = Math.abs(T.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0); normal.sub(T.clone().multiplyScalar(normal.dot(T))).normalize(); }
      else normal.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(prevT, T));
      prevT = T; const B = new THREE.Vector3().crossVectors(T, normal), r = Math.max(minRadius, rad[k]);
      if (k) vAcc += pts[k].distanceTo(pts[k - 1]);
      for (let j = 0; j <= R; j++) { const a = (j / R) * Math.PI * 2, nx = Math.cos(a) * normal.x + Math.sin(a) * B.x, ny = Math.cos(a) * normal.y + Math.sin(a) * B.y, nz = Math.cos(a) * normal.z + Math.sin(a) * B.z; P.push(pts[k].x + nx * r, pts[k].y + ny * r, pts[k].z + nz * r); N.push(nx, ny, nz); UV.push(j / R, vAcc * vScale); }
    }
    const W = R + 1; for (let k = 0; k < pts.length - 1; k++) for (let j = 0; j < R; j++) { const a = base + k * W + j; IDX.push(a, a + W, a + 1, a + 1, a + W, a + W + 1); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2)); g.setIndex(IDX); g.computeBoundingSphere();
  g.userData.open = true; // tube ends/junctions are intentionally open (review skips the closed-mesh check)
  return g;
}

/**
 * curve(controlPoints, { samples, radius: r | [r0, r1], tension }) -> { points, radii } for skinBranches,
 * cardStrip or tube. Smooth Catmull-Rom through the control points; radius tapers linearly.
 */
export function curve(control, { samples = 16, radius = 0.05, tension = 0.5 } = {}) {
  const c = new THREE.CatmullRomCurve3(control.map((p) => (p.isVector3 ? p : new THREE.Vector3(...p))), false, 'catmullrom', tension);
  const [r0, r1] = Array.isArray(radius) ? radius : [radius, radius], points = [], radii = [];
  for (let i = 0; i <= samples; i++) { const t = i / samples; points.push(c.getPoint(t)); radii.push(r0 + (r1 - r0) * t); }
  return { points, radii };
}
