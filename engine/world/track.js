// Race track generator: seeded closed-loop circuit (radial control polygon -> centripetal
// Catmull-Rom spline, arc-length resampled) with elevation, banking from curvature, variable
// width, curbs on tight corners, barriers, a start grid on the longest straight and
// auto-placed checkpoints. Fast nearest-point projection (spatial grid) gives lateral
// offset / track distance for physics (world.groundFn), AI and race timing.
//
//   const track = generateTrack({ seed: 3 });
//   app.scene.add(trackMesh(track));  addTrackPhysics(app.physics, track);
import * as THREE from '../vendor/three/three.module.js';
import { RNG, clamp, lerp, smoothstep } from '../core/rng.js';
import { pbr, solid } from '../render/materials.js';
import { boxUV } from '../geometry/builders.js';

function catmull(p0, p1, p2, p3, t) { // centripetal Catmull-Rom (alpha 0.5) on [x, z]
  const d = (a, b) => Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1]), 0.5) || 1e-4;
  const t0 = 0, t1 = t0 + d(p0, p1), t2 = t1 + d(p1, p2), t3 = t2 + d(p2, p3);
  const u = lerp(t1, t2, t);
  const L = (a, b, ta, tb) => [(tb - u) / (tb - ta) * a[0] + (u - ta) / (tb - ta) * b[0], (tb - u) / (tb - ta) * a[1] + (u - ta) / (tb - ta) * b[1]];
  const A1 = L(p0, p1, t0, t1), A2 = L(p1, p2, t1, t2), A3 = L(p2, p3, t2, t3);
  const B1 = L(A1, A2, t0, t2), B2 = L(A2, A3, t1, t3);
  return L(B1, B2, t1, t2);
}
function segIntersect(a, b, c, d) {
  const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = o(c, d, a), d2 = o(c, d, b), d3 = o(a, b, c), d4 = o(a, b, d);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}

export class Track {
  constructor(samples, opts) {
    this.samples = samples; this.opts = opts; this.length = samples.length * opts.spacing;
    this.runoff = opts.runoff; this.barrierHeight = opts.barrierHeight;
    this.baseY = Math.min(...samples.map((s) => s.y)) - 0.6;
    this.cell = 14; this.grid = new Map();
    samples.forEach((s, i) => { const k = this._key(Math.floor(s.x / this.cell), Math.floor(s.z / this.cell)); if (!this.grid.has(k)) this.grid.set(k, []); this.grid.get(k).push(i); });
    this.checkpoints = []; this.grid2 = []; this.curbs = [];
  }
  _key(i, j) { return i * 92821 + j; }
  get count() { return this.samples.length; }
  wrap(i) { const n = this.samples.length; return ((i % n) + n) % n; }
  wrapS(s) { return ((s % this.length) + this.length) % this.length; }
  // Interpolated frame at track distance s.
  sampleAt(s) {
    s = this.wrapS(s); const f = s / this.opts.spacing, i = Math.floor(f), t = f - i;
    const a = this.samples[this.wrap(i)], b = this.samples[this.wrap(i + 1)];
    const tx = lerp(a.tx, b.tx, t), tz = lerp(a.tz, b.tz, t), l = Math.hypot(tx, tz) || 1;
    return { s, index: this.wrap(i), x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t), tx: tx / l, tz: tz / l, rx: tz / l, rz: -tx / l, bank: lerp(a.bank, b.bank, t), halfWidth: lerp(a.halfWidth, b.halfWidth, t), curvature: lerp(a.curvature, b.curvature, t) };
  }
  // Point at track distance s and lateral offset (metres, + = right of travel direction).
  pointAt(s, lateral = 0, out = new THREE.Vector3()) { const f = this.sampleAt(s); return out.set(f.x + f.rx * lateral, f.y - lateral * Math.tan(f.bank), f.z + f.rz * lateral); }
  // Nearest centreline point: { index, s, lateral, distance, frame }. hint = previous index (fast path).
  project(x, z, hint = -1) {
    const n = this.samples.length; let best = -1, bd = Infinity;
    const test = (i) => { const p = this.samples[i], d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < bd) { bd = d; best = i; } };
    if (hint >= 0) { for (let k = -10; k <= 10; k++) test(this.wrap(hint + k)); if (Math.sqrt(bd) > this.opts.spacing * 6) best = -1, bd = Infinity; }
    if (best < 0) {
      const ci = Math.floor(x / this.cell), cj = Math.floor(z / this.cell);
      for (let ring = 1; ring <= 4 && best < 0; ring++) for (let i = ci - ring; i <= ci + ring; i++) for (let j = cj - ring; j <= cj + ring; j++) for (const k of this.grid.get(this._key(i, j)) || []) test(k);
      if (best < 0) for (let i = 0; i < n; i++) test(i);
    }
    // refine on the neighbouring segments
    const a = this.samples[best]; let s = best * this.opts.spacing;
    let lat = (x - a.x) * a.rx + (z - a.z) * a.rz;
    const along = (x - a.x) * a.tx + (z - a.z) * a.tz;
    s = this.wrapS(s + clamp(along, -this.opts.spacing, this.opts.spacing));
    const f = this.sampleAt(s); lat = (x - f.x) * f.rx + (z - f.z) * f.rz;
    return { index: best, s, lateral: lat, distance: Math.abs(lat), frame: f };
  }
  // Surface height (road incl. banking, runoff, then blends down to the surrounding ground).
  heightAt(x, z, hint = -1) {
    const p = this.project(x, z, hint), f = p.frame, hw = f.halfWidth + this.runoff;
    const lat = clamp(p.lateral, -hw, hw), edge = f.y - lat * Math.tan(f.bank);
    const out = Math.abs(p.lateral) - hw;
    return out <= 0 ? edge : lerp(edge, this.baseY, smoothstep(0, 28, out));
  }
  onTrack(x, z, margin = 0) { const p = this.project(x, z); return Math.abs(p.lateral) <= p.frame.halfWidth + margin; }
  // Respawn pose on the centreline at distance s: { position, yaw }.
  pose(s, lateral = 0) { const f = this.sampleAt(s); return { position: this.pointAt(s, lateral).setY(f.y - lateral * Math.tan(f.bank) + 0.4), yaw: Math.atan2(f.tx, f.tz) }; }
  isClosed() { const a = this.samples[0], b = this.samples[this.samples.length - 1]; return Math.hypot(a.x - b.x, a.z - b.z) < this.opts.spacing * 1.5; }
  // Centreline segment intersection test (non-adjacent segments).
  selfIntersects() {
    const pts = this.samples.map((s) => [s.x, s.z]), n = pts.length;
    for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (segIntersect(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) return true;
    }
    return false;
  }
  // Smallest distance between centreline points that are far apart along the track.
  minClearance() {
    let m = Infinity; const n = this.samples.length, skip = Math.ceil(60 / this.opts.spacing);
    for (let i = 0; i < n; i++) {
      const a = this.samples[i], ci = Math.floor(a.x / this.cell), cj = Math.floor(a.z / this.cell);
      for (let di = -3; di <= 3; di++) for (let dj = -3; dj <= 3; dj++) for (const k of this.grid.get(this._key(ci + di, cj + dj)) || []) {
        const sep = Math.min(Math.abs(k - i), n - Math.abs(k - i)); if (sep < skip) continue;
        const b = this.samples[k]; m = Math.min(m, Math.hypot(a.x - b.x, a.z - b.z));
      }
    }
    return m;
  }
  bounds() { let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (const s of this.samples) { x0 = Math.min(x0, s.x); x1 = Math.max(x1, s.x); z0 = Math.min(z0, s.z); z1 = Math.max(z1, s.z); } return { x0, x1, z0, z1 }; }
}

export function generateTrack({ seed = 1, controlPoints = 12, radius = 140, irregularity = 0.4, width = 13, elevation = 5, bankMax = 0.1, spacing = 2, checkpoints = 8, gridSlots = 8, runoff = 3, barrierHeight = 1.1, minRadius = 22, maxGrade = 0.06 } = {}) {
  const base = new RNG(seed);
  for (let attempt = 0; attempt < 30; attempt++) {
    const rng = base.fork ? base.fork(attempt + 1) : new RNG(seed * 31 + attempt);
    const irr = irregularity * Math.pow(0.85, attempt);
    // radial control polygon: monotonic angles -> star-shaped, never self-crossing
    const n = controlPoints, cps = [];
    const lob = rng.int(2, 4), lobPh = rng.range(0, Math.PI * 2);
    for (let i = 0; i < n; i++) {
      const a = (i + rng.range(-0.3, 0.3)) / n * Math.PI * 2;
      const r = radius * (1 + irr * (rng.range(-1, 1) * 0.6 + 0.5 * Math.sin(a * lob + lobPh)));
      cps.push([Math.cos(a) * r, Math.sin(a) * r * 0.8]);
    }
    for (let k = 0; k < attempt % 3; k++) { const c = cps.map((p) => [...p]); for (let i = 0; i < n; i++) { const a = c[(i + n - 1) % n], b = c[(i + 1) % n]; cps[i] = [(a[0] + 2 * c[i][0] + b[0]) / 4, (a[1] + 2 * c[i][1] + b[1]) / 4]; } }
    // dense spline -> arc-length resample
    const dense = [];
    for (let i = 0; i < n; i++) for (let k = 0; k < 40; k++) dense.push(catmull(cps[(i + n - 1) % n], cps[i], cps[(i + 1) % n], cps[(i + 2) % n], k / 40));
    const cum = [0]; for (let i = 1; i <= dense.length; i++) { const a = dense[i - 1], b = dense[i % dense.length]; cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
    const total = cum[cum.length - 1], N = Math.round(total / spacing), sp = total / N;
    const pts = []; let j = 0;
    for (let i = 0; i < N; i++) { const s = i * sp; while (cum[j + 1] < s) j++; const t = (s - cum[j]) / (cum[j + 1] - cum[j]); const a = dense[j], b = dense[(j + 1) % dense.length]; pts.push([lerp(a[0], b[0], t), lerp(a[1], b[1], t)]); }
    // ensure clockwise/anticlockwise consistency: drive anticlockwise seen from above (+Y)
    const samples = pts.map(([x, z]) => ({ x, z, y: 0 }));
    const tang = (i) => { const a = pts[(i + N - 1) % N], b = pts[(i + 1) % N], l = Math.hypot(b[0] - a[0], b[1] - a[1]); return [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; };
    for (let i = 0; i < N; i++) { const [tx, tz] = tang(i); Object.assign(samples[i], { tx, tz, rx: tz, rz: -tx }); }
    // signed curvature (positive = turning right)
    for (let i = 0; i < N; i++) { const a = samples[(i + N - 1) % N], b = samples[(i + 1) % N], s = samples[i]; s.curvature = ((b.tx - a.tx) * s.rx + (b.tz - a.tz) * s.rz) / (2 * sp); }
    for (let pass = 0; pass < 3; pass++) { const c = samples.map((s) => s.curvature); for (let i = 0; i < N; i++) samples[i].curvature = (c[(i + N - 1) % N] + 2 * c[i] + c[(i + 1) % N]) / 4; }
    const tightest = 1 / Math.max(...samples.map((s) => Math.abs(s.curvature)));
    // rotate so s = 0 lies in the middle of the longest straight (start/finish + grid)
    let bestLen = 0, bestMid = 0, run = 0;
    for (let i = 0; i < N * 2; i++) { const s = samples[i % N]; if (Math.abs(s.curvature) < 1 / 160) { run++; if (run > bestLen && run <= N) { bestLen = run; bestMid = i - Math.floor(run * 0.35); } } else run = 0; }
    const rot = ((bestMid % N) + N) % N; const R = samples.slice(rot).concat(samples.slice(0, rot));
    // elevation: periodic low-frequency profile, grade-limited
    const ph = [rng.range(0, 6.28), rng.range(0, 6.28), rng.range(0, 6.28)], amp = [1, 0.5, 0.25];
    const ys = R.map((_, i) => { const u = i / N * Math.PI * 2; return amp[0] * Math.sin(u + ph[0]) + amp[1] * Math.sin(2 * u + ph[1]) + amp[2] * Math.sin(3 * u + ph[2]); });
    let g = 0; for (let i = 0; i < N; i++) g = Math.max(g, Math.abs(ys[(i + 1) % N] - ys[i]) / sp);
    const scale = Math.min(elevation / 1.75, maxGrade / Math.max(g, 1e-6));
    R.forEach((s, i) => { s.y = ys[i] * scale + elevation; s.s = i * sp; });
    // banking & width from curvature (smoothed)
    R.forEach((s) => { s.bank = clamp(s.curvature * 14, -bankMax, bankMax); s.halfWidth = width / 2 + 1.5 * clamp(Math.abs(s.curvature) * 40, 0, 1); });
    for (let pass = 0; pass < 6; pass++) { const b = R.map((s) => s.bank), w = R.map((s) => s.halfWidth); for (let i = 0; i < N; i++) { R[i].bank = (b[(i + N - 1) % N] + 2 * b[i] + b[(i + 1) % N]) / 4; R[i].halfWidth = (w[(i + N - 1) % N] + 2 * w[i] + w[(i + 1) % N]) / 4; } }
    const track = new Track(R, { seed, spacing: sp, width, runoff, barrierHeight, attempt });
    if (tightest < minRadius) continue;
    if (track.selfIntersects()) continue;
    if (track.minClearance() < width + runoff * 2 + 14) continue;
    // checkpoints (cp0 = start/finish line) and start grid behind the line
    for (let k = 0; k < checkpoints; k++) { const f = track.sampleAt(k * track.length / checkpoints); track.checkpoints.push({ index: k, s: f.s, x: f.x, y: f.y, z: f.z, tx: f.tx, tz: f.tz, rx: f.rx, rz: f.rz, halfWidth: f.halfWidth }); }
    for (let i = 0; i < gridSlots; i++) {
      const row = Math.floor(i / 2), col = i % 2, s = -7 - row * 8 - col * 4, f = track.sampleAt(s), lat = (col ? 1 : -1) * f.halfWidth * 0.42;
      track.grid2.push({ slot: i, s: track.wrapS(s), lateral: lat, ...track.pose(s, lat) });
    }
    // curbs on tight corners: inside and outside edges
    let start = -1;
    for (let i = 0; i <= N; i++) {
      const tight = i < N && Math.abs(R[i].curvature) > 1 / 75;
      if (tight && start < 0) start = i;
      if (!tight && start >= 0) { if (i - start > 3) track.curbs.push({ from: Math.max(0, start - 3), to: Math.min(N - 1, i + 3), side: Math.sign(R[Math.floor((start + i) / 2)].curvature) }); start = -1; }
    }
    track.startGrid = track.grid2;
    return track;
  }
  throw new Error('generateTrack: could not build a valid circuit for seed ' + seed);
}

// Physics: ground follows the track surface; barriers become static box colliders.
export function addTrackPhysics(world, track, { barriers = true } = {}) {
  world.groundFn = (x, z) => track.heightAt(x, z);
  const out = [];
  if (!barriers) return out;
  const N = track.count, step = 3;
  for (const side of [-1, 1]) for (let i = 0; i < N; i += step) {
    const a = track.samples[i], b = track.samples[track.wrap(i + step)];
    const off = (q) => q.halfWidth + track.runoff + 0.35;
    const ax = a.x + a.rx * side * off(a), az = a.z + a.rz * side * off(a), bx = b.x + b.rx * side * off(b), bz = b.z + b.rz * side * off(b);
    const len = Math.hypot(bx - ax, bz - az), y = (track.heightAt(ax, az, i) + track.heightAt(bx, bz, i)) / 2;
    out.push(world.addStatic({ type: 'box', x: (ax + bx) / 2, y: y + track.barrierHeight / 2 - 0.3, z: (az + bz) / 2, hx: 0.35, hy: track.barrierHeight / 2 + 0.3, hz: len / 2 + 0.25, yaw: Math.atan2(bx - ax, bz - az) }, { noGround: true, barrier: true }));
  }
  return out;
}

// Visual mesh: banked road ribbon (asphalt), edge lines, start/finish checker, curbs,
// runoff, barriers, start gantry, checkpoint posts and a ground skirt.
export function trackMesh(track, { ground = true, groundMargin = 70, groundRes = 3.5, lowDetail = false } = {}) {
  const g = new THREE.Group(); g.name = 'race-track';
  const N = track.count, S = track.samples, ro = track.runoff;
  // Ribbon between two lateral offsets. UVs are world-scaled (tile = 1/uvScale metres);
  // with `colors(s, i)` every segment is its own quad so colour panels stay crisp.
  const ribbon = (latA, latB, { yOff = 0, uvScale = 0.25, colors = null, uv = true } = {}) => {
    const pos = [], uvs = [], col = [], idx = [], sp = track.opts.spacing;
    const edge = (i) => { const s = S[i % N], la = typeof latA === 'function' ? latA(s, i % N) : latA, lb = typeof latB === 'function' ? latB(s, i % N) : latB;
      return [la, lb].map((l) => [s.x + s.rx * l, s.y - l * Math.tan(s.bank) + yOff, s.z + s.rz * l, l]); };
    if (colors) {
      for (let i = 0; i < N; i++) {
        const a = edge(i), b = edge(i + 1), c = colors(S[i], i), k = pos.length / 3;
        for (const v of [a[0], a[1], b[0], b[1]]) { pos.push(v[0], v[1], v[2]); col.push(...c); }
        idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
      }
    } else {
      for (let i = 0; i <= N; i++) {
        const e = edge(i); for (const v of e) pos.push(v[0], v[1], v[2]);
        if (uv) uvs.push(e[0][3] * uvScale, i * sp * uvScale, e[1][3] * uvScale, i * sp * uvScale);
        if (i < N) { const k = i * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    if (uv && !colors) geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    if (colors) geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx); geo.computeVertexNormals();
    // ensure normals point up (winding depends on travel direction)
    if (geo.attributes.normal.getY(0) < 0) { for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; } geo.setIndex(idx); geo.computeVertexNormals(); }
    return geo;
  };
  const road = new THREE.Mesh(ribbon((s) => -s.halfWidth, (s) => s.halfWidth, { yOff: 0.02, uvScale: 0.22 }), pbr('asphalt', { color: 0x34363a, repeat: [1, 1] }));
  road.receiveShadow = true; road.name = 'road'; g.add(road);
  const paint = solid(0xf2f2f2, { roughness: 0.6, emissive: 0x222222 });
  for (const side of [-1, 1]) {
    const line = new THREE.Mesh(ribbon((s) => side * (s.halfWidth - 0.55), (s) => side * (s.halfWidth - 0.3), { yOff: 0.035, uv: false }), paint); line.receiveShadow = true; g.add(line);
  }
  // runoff (gravel-coloured concrete) with curbs on tight corners
  const curbAt = new Int8Array(N); for (const c of track.curbs) for (let i = c.from; i <= c.to; i++) curbAt[i] = 1;
  const red = [0.78, 0.08, 0.08], white = [0.92, 0.92, 0.92], run = [0.42, 0.41, 0.39];
  const kerbColor = (s, i) => (curbAt[i] ? (Math.floor(i / 2) % 2 ? red : white) : run);
  const vc = solid(0xffffff, { roughness: 0.85, vertexColors: true });
  for (const side of [-1, 1]) {
    const kerb = new THREE.Mesh(ribbon((s) => side * s.halfWidth, (s) => side * (s.halfWidth + 1.1), { yOff: 0.05, uv: false, colors: kerbColor }), vc); kerb.receiveShadow = true; g.add(kerb);
    const rof = new THREE.Mesh(ribbon((s) => side * (s.halfWidth + 1.1), (s) => side * (s.halfWidth + ro + 0.2), { yOff: 0.0, uvScale: 0.3 }), pbr('sand', { color: 0x9c8f78 })); rof.receiveShadow = true; g.add(rof);
  }
  // barriers: vertical walls with alternating red/white panels
  const bar = [];
  for (const side of [-1, 1]) {
    const pos = [], col = [], idx = [], top = [];
    for (let i = 0; i <= N; i++) { const s = S[i % N], l = side * (s.halfWidth + ro + 0.35), x = s.x + s.rx * l, z = s.z + s.rz * l; top.push([x, track.heightAt(x, z, i % N), z]); }
    for (let i = 0; i < N; i++) { // one quad per segment, panels of 3 segments alternate red/white
      const a = top[i], b = top[i + 1], c = Math.floor(i / 3) % 2 ? [0.85, 0.12, 0.1] : [0.93, 0.93, 0.93], k = pos.length / 3;
      pos.push(a[0], a[1] - 0.3, a[2], a[0], a[1] + track.barrierHeight, a[2], b[0], b[1] - 0.3, b[2], b[0], b[1] + track.barrierHeight, b[2]);
      for (let q = 0; q < 4; q++) col.push(...c);
      idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); geo.setIndex(idx); geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, solid(0xffffff, { roughness: 0.5, vertexColors: true, side: THREE.DoubleSide })); m.castShadow = !lowDetail; m.receiveShadow = true; g.add(m); bar.push(m);
  }
  // start/finish checker across the road at s = 0
  {
    const f = track.sampleAt(0), cols = 14, rows = 2, cw = f.halfWidth * 2 / cols, rh = 0.9;
    const geo = new THREE.PlaneGeometry(1, 1); geo.rotateX(-Math.PI / 2);
    const inst = new THREE.InstancedMesh(geo, solid(0xffffff, { roughness: 0.7 }), cols * rows), m = new THREE.Matrix4(), q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(f.tx, f.tz)), c = new THREE.Color();
    let k = 0;
    for (let r = 0; r < rows; r++) for (let i = 0; i < cols; i++) {
      const lat = -f.halfWidth + (i + 0.5) * cw, p = track.pointAt((r - 0.5) * rh, lat); p.y += 0.04;
      m.compose(p, q, new THREE.Vector3(cw, 1, rh)); inst.setMatrixAt(k, m); inst.setColorAt(k++, c.set((i + r) % 2 ? 0x111111 : 0xf4f4f4));
    }
    g.add(inst);
    // gantry
    const post = new THREE.CylinderGeometry(0.25, 0.25, 7, 10), pm = solid(0x2b2f36, { metalness: 0.7, roughness: 0.35 });
    for (const side of [-1, 1]) { const p = track.pointAt(0, side * (f.halfWidth + ro + 1.2)); const mm = new THREE.Mesh(post, pm); mm.position.set(p.x, p.y + 3.5, p.z); mm.castShadow = true; g.add(mm); }
    const beamLen = (f.halfWidth + ro + 1.2) * 2, beam = new THREE.Mesh(new THREE.BoxGeometry(beamLen, 1.3, 0.5), solid(0x1a73e8, { emissive: 0x0b3b80, emissiveIntensity: 0.6, roughness: 0.4 }));
    beam.position.set(f.x, f.y + 7, f.z); beam.rotation.y = Math.atan2(f.tx, f.tz); /* local X = track right */ beam.castShadow = true; g.add(beam);
  }
  // checkpoint posts (small blue/white pylons on both edges)
  const pyl = new THREE.ConeGeometry(0.35, 1.4, 10), pmat = solid(0x24a0ff, { emissive: 0x0b4a80, emissiveIntensity: 0.8 });
  for (const cp of track.checkpoints.slice(1)) for (const side of [-1, 1]) { const p = track.pointAt(cp.s, side * (cp.halfWidth + 1.6)); const m = new THREE.Mesh(pyl, pmat); m.position.set(p.x, p.y + 0.7, p.z); g.add(m); }
  // ground skirt following the surrounding surface, slightly below the road
  if (ground) {
    const b = track.bounds(), x0 = b.x0 - groundMargin, x1 = b.x1 + groundMargin, z0 = b.z0 - groundMargin, z1 = b.z1 + groundMargin;
    const nx = Math.ceil((x1 - x0) / groundRes), nz = Math.ceil((z1 - z0) / groundRes);
    const geo = new THREE.PlaneGeometry(x1 - x0, z1 - z0, nx, nz); geo.rotateX(-Math.PI / 2); geo.translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setY(i, track.heightAt(pos.getX(i), pos.getZ(i)) - 0.18);
    geo.computeVertexNormals(); boxUV(geo, 0.12);
    const gm = new THREE.Mesh(geo, pbr('grass', { color: 0x5b8f3a })); gm.receiveShadow = true; gm.name = 'ground'; g.add(gm);
  }
  g.userData.track = track;
  return g;
}
