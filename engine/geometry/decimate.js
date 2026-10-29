// Mesh simplification for LODs: quadric-error (Garland–Heckbert) half-edge collapse on an indexed
// BufferGeometry. Collapsing u→v keeps v's existing vertex, so EVERY attribute survives untouched —
// uv, normal, color, skinIndex/skinWeight and morph targets — which makes it safe for skinned humans
// and garments. UV seams and open borders are locked (vertices whose position is shared by several
// render vertices, or that lie on a boundary edge), so textures do not tear and hems do not shrink.
//
//   decimate(geometry, { ratio: 0.35 })            // keep ~35 % of the triangles (new geometry, groups kept)
//   decimate(geometry, { targetTris: 8000, maxError: Infinity, lockBorders: true })
//   → geometry.userData.decimate = { from, to, locked, error }
import * as THREE from '../vendor/three/three.module.js';

class Heap { // binary min-heap of [cost, a, b, stamp]
  constructor() { this.a = []; }
  push(x) { const a = this.a; a.push(x); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
  pop() { const a = this.a, top = a[0], last = a.pop(); if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } } return top; }
  get size() { return this.a.length; }
}

export function decimate(geometry, { ratio = 0.5, targetTris = null, maxError = Infinity, lockBorders = true, maxNormalTurn = 60 } = {}) {
  const P = geometry.attributes.position, n = P.count;
  const srcIndex = geometry.index ? geometry.index.array : Uint32Array.from({ length: n }, (_, i) => i);
  // triangles + their material group
  const groups = geometry.groups.length ? geometry.groups : [{ start: 0, count: srcIndex.length, materialIndex: 0 }];
  const T = [], G = [];
  for (const g of groups) for (let k = g.start; k + 2 < g.start + g.count; k += 3) { T.push(srcIndex[k], srcIndex[k + 1], srcIndex[k + 2]); G.push(g.materialIndex ?? 0); }
  const nt = G.length, target = Math.max(4, Math.floor(targetTris ?? nt * ratio));
  const pos = new Float64Array(n * 3); for (let i = 0; i < n; i++) { pos[i * 3] = P.getX(i); pos[i * 3 + 1] = P.getY(i); pos[i * 3 + 2] = P.getZ(i); }
  // seams: render vertices sharing a position
  const key = (i) => `${Math.round(pos[i * 3] * 1e5)},${Math.round(pos[i * 3 + 1] * 1e5)},${Math.round(pos[i * 3 + 2] * 1e5)}`;
  const byPos = new Map(), locked = new Uint8Array(n);
  for (let i = 0; i < n; i++) { const k = key(i); const e = byPos.get(k); if (e === undefined) byPos.set(k, i); else { locked[i] = 1; locked[e] = 1; } }
  // adjacency + borders
  const vt = Array.from({ length: n }, () => []); const alive = new Uint8Array(nt).fill(1);
  const edgeCount = new Map(), ek = (a, b) => (a < b ? a * n + b : b * n + a);
  for (let t = 0; t < nt; t++) {
    const a = T[t * 3], b = T[t * 3 + 1], c = T[t * 3 + 2];
    if (a === b || b === c || a === c) { alive[t] = 0; continue; }
    vt[a].push(t); vt[b].push(t); vt[c].push(t);
    for (const [x, y] of [[a, b], [b, c], [c, a]]) edgeCount.set(ek(x, y), (edgeCount.get(ek(x, y)) || 0) + 1);
  }
  if (lockBorders) for (const [k, c] of edgeCount) if (c === 1) { locked[Math.floor(k / n)] = 1; locked[k % n] = 1; }
  // quadrics (10 floats per vertex, area weighted)
  const Q = new Float64Array(n * 10);
  const faceNormal = (t, out) => triNormal(T[t * 3], T[t * 3 + 1], T[t * 3 + 2], out);
  function triNormal(ia, ib, ic, out) {
    const a = ia * 3, b = ib * 3, c = ic * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2], vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    out[0] = uy * vz - uz * vy; out[1] = uz * vx - ux * vz; out[2] = ux * vy - uy * vx; return out;
  }
  const fn = [0, 0, 0];
  for (let t = 0; t < nt; t++) {
    if (!alive[t]) continue; faceNormal(t, fn); const len = Math.hypot(fn[0], fn[1], fn[2]); if (len < 1e-12) continue;
    const A = fn[0] / len, B = fn[1] / len, C = fn[2] / len, a0 = T[t * 3] * 3, D = -(A * pos[a0] + B * pos[a0 + 1] + C * pos[a0 + 2]), w = len * 0.5;
    const q = [A * A, A * B, A * C, A * D, B * B, B * C, B * D, C * C, C * D, D * D];
    for (let k = 0; k < 3; k++) { const v = T[t * 3 + k]; for (let j = 0; j < 10; j++) Q[v * 10 + j] += q[j] * w; }
  }
  const cost = (u, v) => { // error of moving u onto v with Qu + Qv
    const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2], q = (j) => Q[u * 10 + j] + Q[v * 10 + j];
    return q(0) * x * x + 2 * q(1) * x * y + 2 * q(2) * x * z + 2 * q(3) * x + q(4) * y * y + 2 * q(5) * y * z + 2 * q(6) * y + q(7) * z * z + 2 * q(8) * z + q(9);
  };
  const stamp = new Uint32Array(n), heap = new Heap();
  const pushVertex = (u) => {
    if (locked[u]) return; stamp[u]++;
    const seen = new Set();
    for (const t of vt[u]) if (alive[t]) for (let k = 0; k < 3; k++) { const v = T[t * 3 + k]; if (v !== u && !seen.has(v)) { seen.add(v); heap.push([Math.max(0, cost(u, v)), u, v, stamp[u]]); } }
  };
  for (let u = 0; u < n; u++) if (vt[u].length) pushVertex(u);
  let tris = nt - alive.reduce((s, a) => s + (a ? 0 : 1), 0), lastErr = 0; const cosMax = Math.cos(maxNormalTurn * Math.PI / 180);
  const n0 = [0, 0, 0], n1 = [0, 0, 0];
  while (tris > target && heap.size) {
    const [c, u, v, st] = heap.pop();
    if (st !== stamp[u] || locked[u] || !vt[u].length) continue;
    if (c > maxError) break;
    // v must still be a neighbour of u
    let shared = 0; for (const t of vt[u]) if (alive[t] && (T[t * 3] === v || T[t * 3 + 1] === v || T[t * 3 + 2] === v)) shared++;
    if (!shared) continue;
    // reject collapses that flip or sharply turn a surviving triangle
    let ok = true;
    for (const t of vt[u]) {
      if (!alive[t]) continue; const i0 = T[t * 3], i1 = T[t * 3 + 1], i2 = T[t * 3 + 2]; if (i0 === v || i1 === v || i2 === v) continue;
      triNormal(i0, i1, i2, n0); triNormal(i0 === u ? v : i0, i1 === u ? v : i1, i2 === u ? v : i2, n1);
      const l0 = Math.hypot(...n0), l1 = Math.hypot(...n1);
      if (l1 < 1e-14 || (n0[0] * n1[0] + n0[1] * n1[1] + n0[2] * n1[2]) / (l0 * l1 + 1e-30) < cosMax) { ok = false; break; }
    }
    if (!ok) continue;
    // collapse
    for (const t of vt[u]) {
      if (!alive[t]) continue;
      const has = T[t * 3] === v || T[t * 3 + 1] === v || T[t * 3 + 2] === v;
      if (has) { alive[t] = 0; tris--; continue; }
      for (let k = 0; k < 3; k++) if (T[t * 3 + k] === u) T[t * 3 + k] = v;
      vt[v].push(t);
    }
    vt[u] = []; for (let j = 0; j < 10; j++) Q[v * 10 + j] += Q[u * 10 + j];
    vt[v] = vt[v].filter((t, i, a) => alive[t] && a.indexOf(t) === i);
    lastErr = c;
    const nb = new Set(); for (const t of vt[v]) for (let k = 0; k < 3; k++) nb.add(T[t * 3 + k]);
    for (const w of nb) pushVertex(w);
  }
  // rebuild index, grouped by material
  const out = geometry.clone(); const byGroup = new Map();
  for (let t = 0; t < nt; t++) if (alive[t]) { let arr = byGroup.get(G[t]); if (!arr) byGroup.set(G[t], arr = []); arr.push(T[t * 3], T[t * 3 + 1], T[t * 3 + 2]); }
  const total = [...byGroup.values()].reduce((s, a) => s + a.length, 0), idx = new (n > 65535 ? Uint32Array : Uint16Array)(total); let o = 0;
  out.clearGroups();
  for (const g of groups.map((x) => x.materialIndex ?? 0).filter((m, i, a) => a.indexOf(m) === i)) { const arr = byGroup.get(g); if (!arr) continue; idx.set(arr, o); out.addGroup(o, arr.length, g); o += arr.length; }
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.userData = { ...geometry.userData, decimate: { from: nt, to: total / 3, locked: locked.reduce((s, x) => s + x, 0), error: lastErr } };
  return out;
}

/** Replace a mesh's geometry (SkinnedMesh/Mesh, including children) by a decimated copy. Returns tri counts. */
export function decimateObject(root, opts = {}) {
  let from = 0, to = 0;
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry?.index || o.userData.noDecimate) return;
    const g = decimate(o.geometry, opts); from += g.userData.decimate.from; to += g.userData.decimate.to;
    o.geometry = g; // the original stays referenced by any clone that shares it
  });
  return { from, to };
}
