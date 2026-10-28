// Signed-distance-field modelling: compose organic shapes (rocks, creatures, blobs, sculpted
// props) from primitives with smooth booleans and noise displacement, then mesh them with
// Naive Surface Nets (smooth, watertight, one vertex per cell). Works in Node and the browser.
//
//   const f = smoothUnion(sphere([0,1,0], 0.8), capsule([0,0,0],[0,1.5,0], 0.3), 0.25);
//   const geo = meshSDF(f, { bounds: [[-1,-0.5,-1],[1,2.2,1]], resolution: 64 });
import * as THREE from '../vendor/three/three.module.js';
import { Noise } from '../core/rng.js';

const len = (x, y, z) => Math.sqrt(x * x + y * y + z * z);
// ---- primitives: each returns f(x,y,z) -> signed distance (negative inside)
export const sphere = ([cx, cy, cz] = [0, 0, 0], r = 1) => (x, y, z) => len(x - cx, y - cy, z - cz) - r;
export const ellipsoid = ([cx, cy, cz] = [0, 0, 0], [rx, ry, rz] = [1, 1, 1]) => (x, y, z) => {
  const px = (x - cx) / rx, py = (y - cy) / ry, pz = (z - cz) / rz, k0 = len(px, py, pz), k1 = len(px / rx, py / ry, pz / rz);
  return k1 < 1e-9 ? -Math.min(rx, ry, rz) : (k0 * (k0 - 1)) / k1;
};
export const box = ([cx, cy, cz] = [0, 0, 0], [hx, hy, hz] = [0.5, 0.5, 0.5], round = 0) => (x, y, z) => {
  const qx = Math.abs(x - cx) - hx + round, qy = Math.abs(y - cy) - hy + round, qz = Math.abs(z - cz) - hz + round;
  return len(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - round;
};
export const capsule = (a = [0, 0, 0], b = [0, 1, 0], r = 0.2, r2 = r) => (x, y, z) => {
  const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2], pax = x - a[0], pay = y - a[1], paz = z - a[2];
  const h = Math.min(1, Math.max(0, (pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz)));
  return len(pax - bax * h, pay - bay * h, paz - baz * h) - (r + (r2 - r) * h); // tapered when r2 != r
};
export const torus = ([cx, cy, cz] = [0, 0, 0], R = 1, r = 0.25) => (x, y, z) => { const q = len(x - cx, 0, z - cz) - R; return len(q, y - cy, 0) - r; };
export const cylinder = ([cx, cy, cz] = [0, 0, 0], r = 0.5, h = 1, round = 0) => (x, y, z) => {
  const dx = len(x - cx, 0, z - cz) - r + round, dy = Math.abs(y - cy) - h / 2 + round;
  return Math.min(Math.max(dx, dy), 0) + len(Math.max(dx, 0), Math.max(dy, 0), 0) - round;
};
export const plane = (n = [0, 1, 0], d = 0) => (x, y, z) => x * n[0] + y * n[1] + z * n[2] - d;

// ---- operators
export const union = (...fs) => (x, y, z) => { let d = Infinity; for (const f of fs) d = Math.min(d, f(x, y, z)); return d; };
export const intersect = (...fs) => (x, y, z) => { let d = -Infinity; for (const f of fs) d = Math.max(d, f(x, y, z)); return d; };
export const subtract = (a, b) => (x, y, z) => Math.max(a(x, y, z), -b(x, y, z));
/** polynomial smooth min: blends shapes like clay (k = blend radius in metres) */
export const smoothUnion = (a, b, k = 0.2) => (x, y, z) => { const d1 = a(x, y, z), d2 = b(x, y, z), h = Math.max(k - Math.abs(d1 - d2), 0) / k; return Math.min(d1, d2) - h * h * k * 0.25; };
export const smoothSubtract = (a, b, k = 0.1) => (x, y, z) => { const d1 = a(x, y, z), d2 = -b(x, y, z), h = Math.max(k - Math.abs(d1 - d2), 0) / k; return Math.max(d1, d2) + h * h * k * 0.25; };
export const smoothUnionAll = (fs, k = 0.2) => fs.reduce((acc, f) => (acc ? smoothUnion(acc, f, k) : f), null);
export const translate = (f, [tx, ty, tz]) => (x, y, z) => f(x - tx, y - ty, z - tz);
export const scale = (f, s) => (x, y, z) => f(x / s, y / s, z / s) * s;
export const rotateY = (f, a) => { const c = Math.cos(a), s = Math.sin(a); return (x, y, z) => f(c * x + s * z, y, -s * x + c * z); };
export const mirrorX = (f) => (x, y, z) => f(Math.abs(x), y, z); // bilateral symmetry (creatures, faces, furniture)
export const round = (f, r) => (x, y, z) => f(x, y, z) - r;
export const shell = (f, t) => (x, y, z) => Math.abs(f(x, y, z)) - t;
/** fractal noise displacement (rocks, bark, terrain chunks, organic wear) */
export const noiseDisplace = (f, { amount = 0.1, frequency = 2, octaves = 4, seed = 1, ridged = false } = {}) => {
  const n = new Noise(seed);
  return (x, y, z) => {
    let a = 0, amp = 1, fr = frequency, norm = 0;
    for (let o = 0; o < octaves; o++) { let v = n.noise3(x * fr, y * fr, z * fr); if (ridged) v = 1 - 2 * Math.abs(v); a += v * amp; norm += amp; amp *= 0.5; fr *= 2.03; }
    return f(x, y, z) + (a / norm) * amount;
  };
};
/** flatten/cut by plane with smooth bevel (rock bases, stumps) */
export const cut = (f, n = [0, 1, 0], d = 0, k = 0.05) => smoothSubtract(f, (x, y, z) => x * n[0] + y * n[1] + z * n[2] - d, k); // removes the side behind the normal

/**
 * meshSDF(f, { bounds: [[minx,miny,minz],[maxx,maxy,maxz]], resolution, smooth })
 * Naive Surface Nets. resolution = cells along the longest axis (32 preview … 128 hero).
 * Returns an indexed BufferGeometry with normals from the SDF gradient and box-projected UVs.
 */
export function meshSDF(f, { bounds = [[-1, -1, -1], [1, 1, 1]], resolution = 64, smooth = 1, uvScale = 1 } = {}) {
  const [mn, mx] = bounds, size = [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]], cell = Math.max(...size) / resolution;
  const nx = Math.ceil(size[0] / cell) + 1, ny = Math.ceil(size[1] / cell) + 1, nz = Math.ceil(size[2] / cell) + 1;
  const val = new Float32Array(nx * ny * nz), I = (i, j, k) => i + nx * (j + ny * k);
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) val[I(i, j, k)] = f(mn[0] + i * cell, mn[1] + j * cell, mn[2] + k * cell);
  const vid = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1), C = (i, j, k) => i + (nx - 1) * (j + (ny - 1) * k);
  const pos = [];
  const corners = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    let mask = 0; const v = [];
    for (let c = 0; c < 8; c++) { const d = val[I(i + corners[c][0], j + corners[c][1], k + corners[c][2])]; v.push(d); if (d < 0) mask |= 1 << c; }
    if (mask === 0 || mask === 255) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const [a, b] of edges) { if ((v[a] < 0) === (v[b] < 0)) continue; const t = v[a] / (v[a] - v[b]); sx += corners[a][0] + (corners[b][0] - corners[a][0]) * t; sy += corners[a][1] + (corners[b][1] - corners[a][1]) * t; sz += corners[a][2] + (corners[b][2] - corners[a][2]) * t; n++; }
    vid[C(i, j, k)] = pos.length / 3; pos.push(mn[0] + (i + sx / n) * cell, mn[1] + (j + sy / n) * cell, mn[2] + (k + sz / n) * cell);
  }
  const idx = [];
  const quad = (a, b, c, d, flip) => { if (a < 0 || b < 0 || c < 0 || d < 0) return; flip ? idx.push(a, c, b, a, d, c) : idx.push(a, b, c, a, c, d); };
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const inside = val[I(i, j, k)] < 0;
    if (inside !== (val[I(i + 1, j, k)] < 0) && i < nx - 1) quad(vid[C(i, j - 1, k - 1)], vid[C(i, j, k - 1)], vid[C(i, j, k)], vid[C(i, j - 1, k)], !inside);
    if (inside !== (val[I(i, j + 1, k)] < 0) && j < ny - 1) quad(vid[C(i - 1, j, k - 1)], vid[C(i - 1, j, k)], vid[C(i, j, k)], vid[C(i, j, k - 1)], !inside);
    if (inside !== (val[I(i, j, k + 1)] < 0) && k < nz - 1) quad(vid[C(i - 1, j - 1, k)], vid[C(i, j - 1, k)], vid[C(i, j, k)], vid[C(i - 1, j, k)], !inside);
  }
  // optional Laplacian smoothing (keeps shape, removes grid stair-steps)
  if (smooth > 0) {
    const nb = Array.from({ length: pos.length / 3 }, () => new Set());
    for (let t = 0; t < idx.length; t += 3) for (let e = 0; e < 3; e++) { nb[idx[t + e]].add(idx[t + (e + 1) % 3]); nb[idx[t + (e + 1) % 3]].add(idx[t + e]); }
    for (let it = 0; it < smooth; it++) { const nxt = pos.slice(); for (let v = 0; v < nb.length; v++) { if (!nb[v].size) continue; let ax = 0, ay = 0, az = 0; for (const u of nb[v]) { ax += pos[u * 3]; ay += pos[u * 3 + 1]; az += pos[u * 3 + 2]; } const s = nb[v].size; nxt[v * 3] = pos[v * 3] * 0.5 + ax / s * 0.5; nxt[v * 3 + 1] = pos[v * 3 + 1] * 0.5 + ay / s * 0.5; nxt[v * 3 + 2] = pos[v * 3 + 2] * 0.5 + az / s * 0.5; } for (let q = 0; q < nxt.length; q++) pos[q] = nxt[q]; }
  }
  // normals from the SDF gradient; triplanar-style UVs
  const nrm = new Float32Array(pos.length), uv = new Float32Array((pos.length / 3) * 2), e = cell * 0.5;
  for (let v = 0; v < pos.length / 3; v++) {
    const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
    let gx = f(x + e, y, z) - f(x - e, y, z), gy = f(x, y + e, z) - f(x, y - e, z), gz = f(x, y, z + e) - f(x, y, z - e); const l = len(gx, gy, gz) || 1; gx /= l; gy /= l; gz /= l;
    nrm[v * 3] = gx; nrm[v * 3 + 1] = gy; nrm[v * 3 + 2] = gz;
    const ax = Math.abs(gx), ay = Math.abs(gy), az = Math.abs(gz);
    if (ay >= ax && ay >= az) { uv[v * 2] = x * uvScale; uv[v * 2 + 1] = z * uvScale; } else if (ax >= az) { uv[v * 2] = z * uvScale; uv[v * 2 + 1] = y * uvScale; } else { uv[v * 2] = x * uvScale; uv[v * 2 + 1] = y * uvScale; }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}
