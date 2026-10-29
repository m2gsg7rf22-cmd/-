// Navigation mesh + pathfinding + steering (Recast/Detour-style, pure JS, deterministic).
//
//   buildNavMesh({ physics | heightfield, colliders, bounds, cellSize, cellHeight, agentRadius,
//                  agentHeight, maxClimb, maxSlope, tileSize, minRegionArea, seeds, waterLevel })
//     1. voxelize: every grid column (cellSize) gets solid spans from the ground (heightfield /
//        physics.groundFn / flat 0) and from static colliders (box, cylinder, sphere, plus 'ramp'
//        wedges), rasterized conservatively so thin walls are never missed;
//     2. walkable spans = solid tops with a slope <= maxSlope and agentHeight of free space above
//        (several per column: ground under a bridge + the bridge deck = multi-level);
//     3. links between neighbouring spans when the step is <= maxClimb and the gap fits the agent;
//     4. erosion: distance field from the border (walls, ledges, drops) removes everything closer
//        than agentRadius, so paths keep the agent's body off walls;
//     5. regions: connected components (tiny ones pruned, optional `seeds` keep only reachable ones);
//     6. polygons: per tile (tileSize cells), greedy merge of fully-linked cells into convex
//        rectangles; portals = shared edge segments between polygons (any height step <= maxClimb).
//   NavMesh: findPath (A* over polygons + funnel string pulling), closestPoint, raycast,
//   moveAlongSurface (slides along borders), randomPoint, isWalkable, heightAt, dynamic obstacles
//   (tile re-polygonization), toJSON/fromJSON, debugMesh.
//   NavAgent / NavCrowd: corridor following with arrival, sampled reciprocal velocity obstacles,
//   wall-aware candidate scoring, movement constrained to the mesh, separation.
//   navMeshPlanner(navmesh) plugs into ScheduleAgent (ai/schedules.js) like navGridPlanner.
import * as THREE from '../vendor/three/three.module.js';

const DX = [1, 0, -1, 0], DZ = [0, 1, 0, -1];
const now = () => (globalThis.performance?.now ? globalThis.performance.now() : Date.now());
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export const NAVMESH_DEFAULTS = { cellSize: 0.3, cellHeight: 0.2, agentRadius: 0.35, agentHeight: 1.8, maxClimb: 0.45, maxSlope: 45, tileSize: 32, minRegionArea: 1.5, waterLevel: null };

// ---------------------------------------------------------------- shapes
// Accepts PhysicsWorld static shapes ({type:'box', x,y,z,hx,hy,hz,yaw} | cylinder {x,z,y(base),r,h}
// | sphere {x,y,z,r}), 'ramp' {x,z,hx,hz,yaw,y0 (at local -z), y1 (at local +z), base}, THREE.Box3 /
// {min,max}. Returns a compact record or null.
function prepShape(s) {
  if (!s) return null;
  const walk = s.walkable !== false && s.userData?.navWalkable !== false;
  if (s.isBox3 || (s.min && s.max && s.type === undefined)) {
    return { kind: 0, x: (s.min.x + s.max.x) / 2, z: (s.min.z + s.max.z) / 2, hx: (s.max.x - s.min.x) / 2, hz: (s.max.z - s.min.z) / 2, c: 1, s: 0, minY: s.min.y, maxY: s.max.y, walk };
  }
  const type = s.type || 'box';
  if (type === 'box') {
    const yaw = s.yaw || 0;
    const minY = s.minY ?? (s.y !== undefined && s.hy !== undefined ? s.y - s.hy : -Infinity);
    const maxY = s.maxY ?? (s.y !== undefined && s.hy !== undefined ? s.y + s.hy : Infinity);
    return { kind: 0, x: s.x, z: s.z, hx: s.hx, hz: s.hz, c: Math.cos(yaw), s: Math.sin(yaw), minY, maxY, walk };
  }
  if (type === 'cylinder' || type === 'capsule') {
    const minY = s.minY ?? s.y ?? -Infinity, maxY = s.maxY ?? (s.y !== undefined && s.h !== undefined ? s.y + s.h : Infinity);
    return { kind: 1, x: s.x, z: s.z, r: s.r ?? s.radius, minY, maxY, walk };
  }
  if (type === 'sphere') return { kind: 2, x: s.x, y: s.y, z: s.z, r: s.r, minY: s.y - s.r, maxY: s.y + s.r, walk };
  if (type === 'ramp') {
    const yaw = s.yaw || 0, y0 = s.y0, y1 = s.y1;
    return { kind: 3, x: s.x, z: s.z, hx: s.hx, hz: s.hz, c: Math.cos(yaw), s: Math.sin(yaw), y0, y1, minY: s.base ?? Math.min(y0, y1) - 0.2, maxY: Math.max(y0, y1), walk, slope: Math.atan(Math.abs(y1 - y0) / (2 * s.hz)) };
  }
  return null;
}
function shapeExtent(p) {
  if (p.kind === 0 || p.kind === 3) { const ac = Math.abs(p.c), as = Math.abs(p.s); return [p.hx * ac + p.hz * as, p.hx * as + p.hz * ac]; }
  return [p.r, p.r];
}
// Does the shape's footprint overlap the square cell (centre cx,cz, half size h)? Then return
// [minY, maxY, walkableTop] of its solid there, else null. `pad` inflates the footprint.
function shapeAt(p, cx, cz, h, cosMax, pad = 0) {
  const dx = cx - p.x, dz = cz - p.z;
  if (p.kind === 0 || p.kind === 3) {
    const ac = Math.abs(p.c), as = Math.abs(p.s), hx = p.hx + pad, hz = p.hz + pad;
    if (Math.abs(dx) > h + hx * ac + hz * as || Math.abs(dz) > h + hx * as + hz * ac) return null;
    const lx = dx * p.c - dz * p.s, lz = dx * p.s + dz * p.c, e = h * (ac + as);
    if (Math.abs(lx) > hx + e || Math.abs(lz) > hz + e) return null;
    if (p.kind === 0) return [p.minY, p.maxY, p.walk];
    const t = (clamp(lz, -p.hz, p.hz) + p.hz) / (2 * p.hz);
    return [p.minY, p.y0 + (p.y1 - p.y0) * t, p.walk && Math.cos(p.slope) >= cosMax - 1e-9];
  }
  const ex = Math.max(Math.abs(dx) - h, 0), ez = Math.max(Math.abs(dz) - h, 0), r = p.r + pad, d2 = ex * ex + ez * ez;
  if (d2 > r * r) return null;
  if (p.kind === 1) return [p.minY, p.maxY, p.walk];
  const ch = Math.sqrt(Math.max(0, p.r * p.r - d2)), dc = Math.hypot(dx, dz);
  const ny = dc < p.r ? Math.sqrt(p.r * p.r - dc * dc) / p.r : 0;
  return [p.y - ch, p.y + ch, p.walk && ny >= cosMax];
}

// ---------------------------------------------------------------- base64 for typed arrays
function b64enc(typed) {
  const u8 = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength); let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
function b64dec(str, Type) { const s = atob(str), u8 = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i); return new Type(u8.buffer); }

class MinHeap {
  constructor() { this.k = []; this.p = []; }
  get size() { return this.k.length; }
  clear() { this.k.length = 0; this.p.length = 0; }
  push(key, pri) { const k = this.k, p = this.p; k.push(key); p.push(pri); let i = k.length - 1; while (i > 0) { const pa = (i - 1) >> 1; if (p[pa] <= p[i]) break; [k[pa], k[i]] = [k[i], k[pa]]; [p[pa], p[i]] = [p[i], p[pa]]; i = pa; } }
  pop() {
    const k = this.k, p = this.p, top = k[0], lk = k.pop(), lp = p.pop();
    if (k.length) { k[0] = lk; p[0] = lp; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < k.length && p[l] < p[m]) m = l; if (r < k.length && p[r] < p[m]) m = r; if (m === i) break; [k[m], k[i]] = [k[i], k[m]]; [p[m], p[i]] = [p[i], p[m]]; i = m; } }
    return top;
  }
}

// ---------------------------------------------------------------- build
/**
 * Build a NavMesh. Sources: `physics` (PhysicsWorld: heightfield or groundFn or flat y=0 ground,
 * plus every static collider except triggers / userData.noNav / userData.noCollide), `heightfield`,
 * `ground` ((x,z)=>y, or false for no ground), `colliders` (extra shapes, e.g. ramps). `bounds`
 * {minX,minZ,maxX,maxZ} | Box3 (default: heightfield extent or the colliders' extent + 2 m).
 */
export function buildNavMesh(opts = {}) {
  const t0 = now();
  const P = { ...NAVMESH_DEFAULTS };
  for (const k of Object.keys(NAVMESH_DEFAULTS)) if (opts[k] !== undefined) P[k] = opts[k];
  const cs = P.cellSize, cosMax = Math.cos(P.maxSlope * Math.PI / 180);
  const physics = opts.physics || null;
  const hf = opts.heightfield ?? physics?.hf ?? null;
  // ground: heightfield > physics.groundFn > flat y = 0 (PhysicsWorld's default); ground: false = none
  let ground = opts.ground;
  if (ground === undefined || ground === true) ground = hf ? (x, z) => hf.heightAt(x, z) : physics?.groundFn ? physics.groundFn : () => 0;
  if (ground === false) ground = null;
  // shapes
  const shapes = [];
  if (physics && opts.useStatics !== false) for (const s of physics.statics.values()) { const u = s.userData || {}; if (u.trigger || u.noNav || u.noCollide) continue; const p = prepShape(s); if (p) shapes.push(p); }
  for (const s of opts.colliders || []) { const p = prepShape(s); if (p) shapes.push(p); }
  // bounds
  let B = opts.bounds;
  if (B && (B.isBox3 || B.min)) B = { minX: B.min.x, minZ: B.min.z, maxX: B.max.x, maxZ: B.max.z };
  if (!B) {
    if (hf) B = { minX: -hf.size / 2, minZ: -hf.size / 2, maxX: hf.size / 2, maxZ: hf.size / 2 };
    else {
      B = { minX: Infinity, minZ: Infinity, maxX: -Infinity, maxZ: -Infinity };
      for (const p of shapes) { const [ex, ez] = shapeExtent(p); B.minX = Math.min(B.minX, p.x - ex); B.maxX = Math.max(B.maxX, p.x + ex); B.minZ = Math.min(B.minZ, p.z - ez); B.maxZ = Math.max(B.maxZ, p.z + ez); }
      if (!isFinite(B.minX)) throw new Error('buildNavMesh: no bounds (pass bounds, a heightfield or colliders)');
      B.minX -= 2; B.minZ -= 2; B.maxX += 2; B.maxZ += 2;
    }
  }
  const nx = Math.max(1, Math.ceil((B.maxX - B.minX) / cs)), nz = Math.max(1, Math.ceil((B.maxZ - B.minZ) / cs)), nCols = nx * nz;
  const minX = B.minX, minZ = B.minZ, h = cs / 2;

  // 1. rasterize colliders into per-column solid lists [min, max, walk, ...]
  const colSolids = new Array(nCols);
  for (const p of shapes) {
    const [ex, ez] = shapeExtent(p);
    const i0 = clamp(Math.floor((p.x - ex - minX) / cs), 0, nx - 1), i1 = clamp(Math.floor((p.x + ex - minX) / cs), 0, nx - 1);
    const j0 = clamp(Math.floor((p.z - ez - minZ) / cs), 0, nz - 1), j1 = clamp(Math.floor((p.z + ez - minZ) / cs), 0, nz - 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const r = shapeAt(p, minX + (i + 0.5) * cs, minZ + (j + 0.5) * cs, h, cosMax);
      if (!r) continue;
      const c = j * nx + i; (colSolids[c] || (colSolids[c] = [])).push(r[0], r[1], r[2] ? 1 : 0);
    }
  }
  // ground heights at cell corners (for the slope) and centres
  let gCorner = null;
  if (ground) { gCorner = new Float32Array((nx + 1) * (nz + 1)); for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) gCorner[j * (nx + 1) + i] = ground(minX + i * cs, minZ + j * cs); }
  const tVox = now();

  // 2. merge solids per column, emit walkable spans (floor, ceiling)
  const colStart = new Int32Array(nCols + 1);
  let Y = new Float32Array(Math.max(16, nCols)), C = new Float32Array(Y.length), nS = 0;
  const tmp = [], order = [];
  for (let c = 0; c < nCols; c++) {
    colStart[c] = nS;
    tmp.length = 0;
    if (ground) {
      const i = c % nx, j = (c / nx) | 0, w = nx + 1;
      const a = gCorner[j * w + i], b = gCorner[j * w + i + 1], d = gCorner[(j + 1) * w + i], e = gCorner[(j + 1) * w + i + 1];
      const gy = ground(minX + (i + 0.5) * cs, minZ + (j + 0.5) * cs);
      const gx = ((b + e) - (a + d)) / (2 * cs), gz = ((d + e) - (a + b)) / (2 * cs);
      let walk = 1 / Math.sqrt(1 + gx * gx + gz * gz) >= cosMax ? 1 : 0;
      if (P.waterLevel !== null && P.waterLevel !== undefined && gy < P.waterLevel + 0.2) walk = 0;
      tmp.push(-Infinity, gy, walk);
    }
    const sol = colSolids[c]; if (sol) for (let k = 0; k < sol.length; k++) tmp.push(sol[k]);
    const n = tmp.length / 3; if (!n) continue;
    order.length = n; for (let k = 0; k < n; k++) order[k] = k;
    if (n > 1) order.sort((u, v) => tmp[u * 3] - tmp[v * 3] || tmp[u * 3 + 1] - tmp[v * 3 + 1] || u - v);
    let lo = tmp[order[0] * 3], hi = tmp[order[0] * 3 + 1], wk = tmp[order[0] * 3 + 2];
    const flush = (nextMin) => {
      if (wk && nextMin - hi >= P.agentHeight) {
        if (nS >= Y.length) { const Y2 = new Float32Array(Y.length * 2); Y2.set(Y); Y = Y2; const C2 = new Float32Array(Y.length); C2.set(C); C = C2; }
        Y[nS] = hi; C[nS] = nextMin; nS++;
      }
    };
    for (let k = 1; k < n; k++) {
      const o = order[k] * 3, a = tmp[o], b = tmp[o + 1], w = tmp[o + 2];
      if (a <= hi + P.cellHeight * 0.5) { if (b > hi + 1e-6) { hi = b; wk = w; } else if (Math.abs(b - hi) <= 1e-6) wk = wk || w; }
      else { flush(a); lo = a; hi = b; wk = w; }
    }
    flush(Infinity);
  }
  colStart[nCols] = nS;
  const mesh = new NavMesh();
  mesh._init({ params: P, minX, minZ, nx, nz, colStart, spanY: Y.slice(0, nS), spanCeil: C.slice(0, nS) });
  const tSpans = now();
  mesh._buildLinks();
  mesh._erode();
  const tErode = now();
  mesh._buildRegions(opts.seeds || null);
  const tReg = now();
  mesh._buildAllPolys();
  const t1 = now();
  mesh.stats.buildMs = +(t1 - t0).toFixed(1);
  mesh.stats.timings = { rasterize: +(tVox - t0).toFixed(1), spans: +(tSpans - tVox).toFixed(1), linksErode: +(tErode - tSpans).toFixed(1), regions: +(tReg - tErode).toFixed(1), polygons: +(t1 - tReg).toFixed(1) };
  mesh.stats.colliders = shapes.length;
  return mesh;
}

// ---------------------------------------------------------------- NavMesh
export class NavMesh {
  _init({ params, minX, minZ, nx, nz, colStart, spanY, spanCeil }) {
    this.params = { ...params }; this.cs = params.cellSize;
    Object.assign(this, { minX, minZ, nx, nz, colStart, spanY, spanCeil });
    const n = spanY.length; this.spanCount = n;
    this.spanCol = new Int32Array(n);
    for (let c = 0; c < nx * nz; c++) for (let s = colStart[c]; s < colStart[c + 1]; s++) this.spanCol[s] = c;
    this.link = new Int32Array(n * 4).fill(-1);
    this.kept = new Uint8Array(n);
    this.region = new Int32Array(n).fill(-1);
    this.blocked = new Uint8Array(n);
    this.spanPoly = new Int32Array(n).fill(-1);
    this.polys = []; this.freeIds = [];
    const T = params.tileSize; this.tilesX = Math.ceil(nx / T); this.tilesZ = Math.ceil(nz / T);
    this.tileW = Math.ceil(nx / this.tilesX); this.tileH = Math.ceil(nz / this.tilesZ); // balanced: no 1-cell remainder tiles
    this.tilePolys = Array.from({ length: this.tilesX * this.tilesZ }, () => []);
    this.obstacles = new Map(); this._obstacleId = 1; this._dirty = new Set();
    this.version = 0; this.regionCount = 0; this.regionArea = [];
    this.stats = { spans: n, columns: nx * nz, grid: [nx, nz] };
    this._q = null; this._cum = null;
    return this;
  }
  get bounds() { return { minX: this.minX, minZ: this.minZ, maxX: this.minX + this.nx * this.cs, maxZ: this.minZ + this.nz * this.cs }; }

  // ---- build stages
  _buildLinks() {
    const { nx, nz, colStart, spanY: Y, spanCeil: C, link } = this, { maxClimb, agentHeight } = this.params;
    for (let c = 0; c < nx * nz; c++) {
      const i = c % nx, j = (c / nx) | 0;
      for (let s = colStart[c]; s < colStart[c + 1]; s++) for (let d = 0; d < 4; d++) {
        const ni = i + DX[d], nj = j + DZ[d]; if (ni < 0 || nj < 0 || ni >= nx || nj >= nz) continue;
        const nc = nj * nx + ni; let best = -1, bd = Infinity;
        for (let t = colStart[nc]; t < colStart[nc + 1]; t++) {
          const dy = Math.abs(Y[t] - Y[s]); if (dy > maxClimb) continue;
          if (Math.min(C[s], C[t]) - Math.max(Y[s], Y[t]) < agentHeight) continue;
          if (dy < bd) { bd = dy; best = t; }
        }
        link[s * 4 + d] = best;
      }
    }
    // keep only mutual links (symmetric portals)
    for (let s = 0; s < this.spanCount; s++) for (let d = 0; d < 4; d++) { const t = link[s * 4 + d]; if (t >= 0 && link[t * 4 + ((d + 2) & 3)] !== s) link[s * 4 + d] = -1; }
  }
  // Distance field from the border in half-cell units (ortho 2, diagonal 2 = square corners, which
  // keeps rectangles clean and is conservative at convex corners); spans closer than agentRadius go.
  _erode() {
    const n = this.spanCount, link = this.link, cs = this.cs, kept = this.kept;
    const T = (2 * this.params.agentRadius) / cs; // remove if dist < T
    const maxD = Math.ceil(T) + 1, dist = new Uint16Array(n).fill(0xffff);
    const buckets = Array.from({ length: maxD + 4 }, () => []);
    for (let s = 0; s < n; s++) { let border = false; for (let d = 0; d < 4; d++) if (link[s * 4 + d] < 0) { border = true; break; } if (border) { dist[s] = 0; buckets[0].push(s); } }
    for (let b = 0; b < buckets.length && b <= maxD; b++) {
      const q = buckets[b];
      for (let k = 0; k < q.length; k++) {
        const u = q[k]; if (dist[u] !== b) continue;
        for (let d = 0; d < 4; d++) {
          const v = link[u * 4 + d]; if (v < 0) continue;
          if (b + 2 < dist[v]) { dist[v] = b + 2; if (b + 2 < buckets.length) buckets[b + 2].push(v); }
          const w = link[v * 4 + ((d + 1) & 3)];
          if (w >= 0 && b + 2 < dist[w]) { dist[w] = b + 2; if (b + 2 < buckets.length) buckets[b + 2].push(w); }
        }
      }
    }
    let k = 0; for (let s = 0; s < n; s++) { kept[s] = dist[s] >= T ? 1 : 0; k += kept[s]; }
    this.stats.walkableSpans = k;
  }
  _buildRegions(seeds = null) {
    const n = this.spanCount, link = this.link, kept = this.kept, region = this.region.fill(-1);
    const areas = [], stack = [], cell2 = this.cs * this.cs; let r = 0;
    for (let s = 0; s < n; s++) {
      if (!kept[s] || region[s] >= 0) continue;
      let count = 0; stack.push(s); region[s] = r;
      while (stack.length) { const u = stack.pop(); count++; for (let d = 0; d < 4; d++) { const v = link[u * 4 + d]; if (v >= 0 && kept[v] && region[v] < 0) { region[v] = r; stack.push(v); } } }
      areas.push(count * cell2); r++;
    }
    const keep = areas.map((a) => a >= this.params.minRegionArea);
    if (seeds && seeds.length) {
      keep.fill(false);
      for (const p of seeds) { const nr = this._nearestSpan(p.x, p.y, p.z, 6, true); if (nr) keep[region[nr.span]] = true; }
    }
    const remap = new Int32Array(r).fill(-1); let nr = 0; const newAreas = [];
    for (let k = 0; k < r; k++) if (keep[k]) { remap[k] = nr++; newAreas.push(areas[k]); }
    let pruned = 0;
    for (let s = 0; s < n; s++) { if (region[s] < 0) continue; const m = remap[region[s]]; region[s] = m; if (m < 0) { kept[s] = 0; pruned++; } }
    this.regionCount = nr; this.regionArea = newAreas; this.stats.regions = nr; this.stats.prunedSpans = pruned; this.stats.walkableSpans -= pruned;
    this.stats.walkableArea = +newAreas.reduce((a, b) => a + b, 0).toFixed(1);
  }
  _usable(s) { return this.kept[s] === 1 && this.blocked[s] === 0; }
  _buildAllPolys() {
    for (let t = 0; t < this.tilePolys.length; t++) this._buildTile(t);
    for (const p of this.polys) if (p) this._portals(p);
    this._updatePolyStats();
  }
  _updatePolyStats() { let n = 0; for (const p of this.polys) if (p) n++; this.stats.polys = n; this.stats.tiles = this.tilePolys.length; }
  _buildTile(t) {
    const tx = t % this.tilesX, tz = (t / this.tilesX) | 0;
    const ia = tx * this.tileW, ib = Math.min(this.nx, ia + this.tileW) - 1, ja = tz * this.tileH, jb = Math.min(this.nz, ja + this.tileH) - 1;
    const { nx, colStart, link, spanPoly, spanY } = this;
    for (let j = ja; j <= jb; j++) for (let i = ia; i <= ib; i++) {
      const c = j * nx + i;
      for (let s = colStart[c]; s < colStart[c + 1]; s++) {
        if (!this._usable(s) || spanPoly[s] >= 0) continue;
        // grow a rectangle x-first and z-first, keep the larger one (fewer slivers at rounded corners)
        const A = this._grow(s, 0, ib - i, jb - j), Bz = this._grow(s, 1, jb - j, ib - i);
        const useZ = Bz.lines.length * Bz.lines[0].length > A.lines.length * A.lines[0].length;
        const w = useZ ? Bz.lines.length : A.lines[0].length, hgt = useZ ? Bz.lines[0].length : A.lines.length;
        const rows = [];
        for (let r = 0; r < hgt; r++) rows.push(useZ ? Bz.lines.map((col) => col[r]) : A.lines[r]);
        const i1 = i + w - 1, j1 = j + hgt - 1;
        const id = this.freeIds.length ? this.freeIds.pop() : this.polys.length;
        const cells = new Int32Array(w * hgt);
        let k = 0, sy = 0, minY = Infinity, maxY = -Infinity;
        for (const rw of rows) for (const v of rw) { cells[k++] = v; spanPoly[v] = id; const y = spanY[v]; sy += y; if (y < minY) minY = y; if (y > maxY) maxY = y; }
        const cs = this.cs;
        this.polys[id] = { id, tile: t, i0: i, j0: j, i1, j1, w, h: hgt, cells, region: this.region[s], cx: this.minX + (i + i1 + 1) * cs / 2, cz: this.minZ + (j + j1 + 1) * cs / 2, cy: sy / cells.length, minY, maxY, links: [] };
        this.tilePolys[t].push(id);
      }
    }
  }
  // Lines of fully linked, free spans: along direction a (0 = +x, 1 = +z) up to maxA extra cells,
  // then stacked along the other axis while each new line is complete and consistent.
  _grow(s, a, maxA, maxB) {
    const { link, spanPoly } = this, b = 1 - a, free = (v) => v >= 0 && this._usable(v) && spanPoly[v] < 0;
    const first = [s]; let cur = s;
    while (first.length <= maxA) { const v = link[cur * 4 + a]; if (!free(v)) break; first.push(v); cur = v; }
    const lines = [first];
    while (lines.length <= maxB) {
      const last = lines[lines.length - 1], cand = [];
      for (let k = 0; k < last.length; k++) {
        const v = link[last[k] * 4 + b];
        if (!free(v) || (k > 0 && link[cand[k - 1] * 4 + a] !== v)) break;
        cand.push(v);
      }
      if (cand.length !== last.length) break;
      lines.push(cand);
    }
    return { lines };
  }
  // Shared edge segments with neighbouring polygons. Edge: { to, d (outward dir), ax,ay,az, bx,by,bz }.
  _portals(p) {
    p.links = [];
    const { link, spanPoly, spanY: Y, cs, minX, minZ } = this;
    for (let d = 0; d < 4; d++) {
      const alongX = d === 1 || d === 3, len = alongX ? p.w : p.h;
      let segStart = -1, segQ = -1, ya = 0, prevS = -1, prevN = -1;
      const fixed = d === 0 ? minX + (p.i1 + 1) * cs : d === 2 ? minX + p.i0 * cs : d === 1 ? minZ + (p.j1 + 1) * cs : minZ + p.j0 * cs;
      const base = alongX ? minX + p.i0 * cs : minZ + p.j0 * cs;
      const close = (end) => {
        if (segQ < 0) return;
        const yb = (Y[prevS] + Y[prevN]) / 2, a0 = base + segStart * cs, a1 = base + end * cs;
        p.links.push(alongX ? { to: segQ, d, ax: a0, ay: ya, az: fixed, bx: a1, by: yb, bz: fixed } : { to: segQ, d, ax: fixed, ay: ya, az: a0, bx: fixed, by: yb, bz: a1 });
      };
      for (let k = 0; k < len; k++) {
        const s = d === 0 ? p.cells[k * p.w + p.w - 1] : d === 2 ? p.cells[k * p.w] : d === 1 ? p.cells[(p.h - 1) * p.w + k] : p.cells[k];
        const n = link[s * 4 + d], q = n >= 0 ? spanPoly[n] : -1;
        if (q !== segQ) { close(k); segQ = q; segStart = k; if (q >= 0) ya = (Y[s] + Y[n]) / 2; }
        prevS = s; prevN = n;
      }
      close(len);
    }
  }

  // ---- queries
  _colOf(x, z) { const i = Math.floor((x - this.minX) / this.cs), j = Math.floor((z - this.minZ) / this.cs); return [i, j]; }
  // Nearest usable span to (x, y, z). y undefined/NaN = prefer the lowest surface. Returns { span, x, y, z, d }.
  _nearestSpan(x, y, z, maxDist = 3, ignorePolys = false) {
    const { cs, nx, nz, colStart, spanY: Y, minX, minZ } = this, hasY = typeof y === 'number' && !Number.isNaN(y);
    const [ci, cj] = this._colOf(x, z), R = Math.ceil(maxDist / cs) + 1;
    let best = null, bestScore = Infinity;
    for (let r = 0; r <= R; r++) {
      const ringMin = Math.max(0, (r - 1) * cs);
      if (best && ringMin * ringMin > bestScore) break;
      for (let j = cj - r; j <= cj + r; j++) {
        if (j < 0 || j >= nz) continue;
        const step = (j === cj - r || j === cj + r) ? 1 : 2 * r || 1;
        for (let i = ci - r; i <= ci + r; i += step) {
          if (i < 0 || i >= nx) continue;
          const c = j * nx + i;
          for (let s = colStart[c]; s < colStart[c + 1]; s++) {
            if (!(ignorePolys ? this.kept[s] && !this.blocked[s] : this.spanPoly[s] >= 0)) continue;
            const x0 = minX + i * cs, z0 = minZ + j * cs;
            const px = clamp(x, x0 + 1e-4, x0 + cs - 1e-4), pz = clamp(z, z0 + 1e-4, z0 + cs - 1e-4);
            const dh2 = (px - x) ** 2 + (pz - z) ** 2;
            if (dh2 > maxDist * maxDist) continue;
            const dy = hasY ? Y[s] - y : 0;
            const score = hasY ? dh2 + dy * dy : dh2 + Y[s] * 1e-6;
            if (score < bestScore - 1e-12) { bestScore = score; best = { span: s, x: px, z: pz }; }
          }
        }
      }
    }
    if (!best) return null;
    best.y = this.surfaceY(best.span, best.x, best.z); best.poly = this.spanPoly[best.span]; best.d = Math.sqrt(bestScore);
    return best;
  }
  // Smooth surface height inside span s at (x, z): bilinear over linked neighbours (stairs/slopes glide).
  surfaceY(s, x, z) {
    const { cs, minX, minZ, nx, link, spanY: Y } = this, c = this.spanCol[s], i = c % nx, j = (c / nx) | 0;
    const fx = clamp((x - (minX + (i + 0.5) * cs)) / cs, -0.5, 0.5), fz = clamp((z - (minZ + (j + 0.5) * cs)) / cs, -0.5, 0.5);
    const sx = fx >= 0 ? 0 : 2, sz = fz >= 0 ? 1 : 3, y0 = Y[s];
    const nX = link[s * 4 + sx], nZ = link[s * 4 + sz];
    const yX = nX >= 0 ? Y[nX] : y0, yZ = nZ >= 0 ? Y[nZ] : y0;
    let nD = nX >= 0 ? link[nX * 4 + sz] : -1; if (nD < 0 && nZ >= 0) nD = link[nZ * 4 + sx];
    const yD = nD >= 0 ? Y[nD] : yX + yZ - y0, ax = Math.abs(fx), az = Math.abs(fz);
    return (y0 + (yX - y0) * ax) * (1 - az) + (yZ + (yD - yZ) * ax) * az;
  }
  _flush() {
    if (!this._dirty.size) return;
    const tiles = [...this._dirty].sort((a, b) => a - b); this._dirty.clear();
    const touched = new Set();
    for (const t of tiles) {
      for (const id of this.tilePolys[t]) { const p = this.polys[id]; for (const s of p.cells) this.spanPoly[s] = -1; this.polys[id] = null; this.freeIds.push(id); }
      this.tilePolys[t] = [];
    }
    this.freeIds.sort((a, b) => b - a); // pop() hands out the smallest id first (deterministic)
    for (const t of tiles) this._buildTile(t);
    for (const t of tiles) { const tx = t % this.tilesX, tz = (t / this.tilesX) | 0; touched.add(t); for (let d = 0; d < 4; d++) { const ax = tx + DX[d], az = tz + DZ[d]; if (ax >= 0 && az >= 0 && ax < this.tilesX && az < this.tilesZ) touched.add(az * this.tilesX + ax); } }
    for (const t of [...touched].sort((a, b) => a - b)) for (const id of this.tilePolys[t]) this._portals(this.polys[id]);
    this.version++; this._cum = null; this._updatePolyStats();
  }
  /** Closest point on the mesh (Vector3) or null if nothing within maxDist (m, horizontal). */
  closestPoint(p, { maxDist = 3 } = {}) { this._flush(); const r = this._nearestSpan(p.x, p.y, p.z, maxDist); return r ? new THREE.Vector3(r.x, r.y, r.z) : null; }
  /** Like closestPoint but returns { point, poly, region, span, distance }. */
  findNearest(p, { maxDist = 3 } = {}) { this._flush(); const r = this._nearestSpan(p.x, p.y, p.z, maxDist); return r ? { point: new THREE.Vector3(r.x, r.y, r.z), poly: r.poly, region: this.region[r.span], span: r.span, distance: r.d } : null; }
  /** Height of the walkable surface at (x, z) nearest to `nearY` (any level if omitted), or null. */
  heightAt(x, z, nearY) { this._flush(); const r = this._nearestSpan(x, nearY, z, this.cs * 0.75); return r ? r.y : null; }
  /** Is p on the walkable mesh (inside a usable cell, within `tolerance` vertically)? */
  isWalkable(p, { tolerance = this.params.agentHeight * 0.5 } = {}) {
    this._flush();
    const [i, j] = this._colOf(p.x, p.z); if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) return false;
    const c = j * this.nx + i, hasY = typeof p.y === 'number' && !Number.isNaN(p.y);
    for (let s = this.colStart[c]; s < this.colStart[c + 1]; s++) if (this.spanPoly[s] >= 0 && (!hasY || Math.abs(this.spanY[s] - p.y) <= tolerance)) return true;
    return false;
  }
  // Walk the grid from span s at (x,z) toward (tx,tz) crossing cell edges through links.
  // slide=true projects the remaining motion along blocking edges (moveAlongSurface).
  _walk(s, x, z, tx, tz, slide) {
    const { cs, minX, minZ, nx, link } = this; let blocked = false, hitT = 1;
    const ox = x, oz = z, L2 = (tx - ox) ** 2 + (tz - oz) ** 2;
    for (let iter = 0; iter < 4096; iter++) {
      const c = this.spanCol[s], i = c % nx, j = (c / nx) | 0;
      const x0 = minX + i * cs, x1 = x0 + cs, z0 = minZ + j * cs, z1 = z0 + cs;
      const dx = tx - x, dz = tz - z;
      const E = 1e-6;
      if (tx >= x0 - E && tx <= x1 + E && tz >= z0 - E && tz <= z1 + E) { x = tx; z = tz; break; }
      const tX = dx > 1e-12 ? (x1 - x) / dx : dx < -1e-12 ? (x0 - x) / dx : Infinity;
      const tZ = dz > 1e-12 ? (z1 - z) / dz : dz < -1e-12 ? (z0 - z) / dz : Infinity;
      let d, t; if (tX <= tZ) { d = dx > 0 ? 0 : 2; t = tX; } else { d = dz > 0 ? 1 : 3; t = tZ; }
      // exactly through a cell corner: take whichever of the two edges is open
      if (Math.abs(tX - tZ) < 1e-9 && isFinite(tX)) { const d2 = d === 0 || d === 2 ? (dz > 0 ? 1 : 3) : (dx > 0 ? 0 : 2), n1 = link[s * 4 + d]; if (!(n1 >= 0 && this.spanPoly[n1] >= 0)) d = d2; }
      t = Math.max(0, t);
      const bx = x + dx * t, bz = z + dz * t, n = link[s * 4 + d];
      if (n >= 0 && this.spanPoly[n] >= 0) { s = n; x = bx; z = bz; continue; }
      // blocked edge
      if (!blocked) { blocked = true; hitT = L2 > 0 ? Math.sqrt(((bx - ox) ** 2 + (bz - oz) ** 2) / L2) : 0; }
      const eps = 1e-4;
      if (d === 0) x = x1 - eps; else if (d === 2) x = x0 + eps; else x = bx;
      if (d === 1) z = z1 - eps; else if (d === 3) z = z0 + eps; else z = bz;
      if (!slide) break;
      if (d === 0 || d === 2) tx = x; else tz = z; // drop the blocked component and keep sliding
    }
    return { span: s, x, z, blocked, t: hitT };
  }
  /**
   * Straight-line walkability test along the surface from a to b.
   * Returns { hit, t (0..1 fraction where blocked, 1 if clear), point, distance }.
   */
  raycast(a, b) {
    this._flush();
    const st = this._nearestSpan(a.x, a.y, a.z, this.cs * 2);
    if (!st) return { hit: true, t: 0, point: new THREE.Vector3(a.x, a.y, a.z), distance: 0 };
    const r = this._walk(st.span, st.x, st.z, b.x, b.z, false);
    const L = Math.hypot(b.x - a.x, b.z - a.z);
    return { hit: r.blocked, t: r.blocked ? r.t : 1, point: new THREE.Vector3(r.x, this.surfaceY(r.span, r.x, r.z), r.z), distance: (r.blocked ? r.t : 1) * L };
  }
  /** True when an agent can walk the straight line a -> b. */
  lineWalkable(a, b) { return !this.raycast(a, b).hit; }
  /**
   * Constrained move (Detour moveAlongSurface): from `start` toward `end`, sliding along borders.
   * `span` = cached span of start (NavAgent keeps it). Returns { position: Vector3, span, blocked }.
   */
  moveAlongSurface(start, end, span = -1, out = new THREE.Vector3()) {
    this._flush();
    let s = span, x = start.x, z = start.z;
    if (s < 0 || this.spanPoly[s] < 0 || !this._inCol(s, x, z)) { const st = this._nearestSpan(start.x, start.y, start.z, 4); if (!st) return { position: out.set(start.x, start.y, start.z), span: -1, blocked: true }; s = st.span; x = st.x; z = st.z; }
    const r = this._walk(s, x, z, end.x, end.z, true);
    return { position: out.set(r.x, this.surfaceY(r.span, r.x, r.z), r.z), span: r.span, blocked: r.blocked };
  }
  _inCol(s, x, z) { const c = this.spanCol[s], [i, j] = this._colOf(x, z); return i >= 0 && j >= 0 && i < this.nx && j < this.nz && j * this.nx + i === c; }
  /** Random point on the mesh, uniform by area. rng: RNG (.next) or () => [0,1). { region } restricts it. */
  randomPoint(rng = Math.random, { region = null } = {}) {
    this._flush();
    const next = typeof rng === 'function' ? rng : () => rng.next();
    if (!this._cum) { const ids = [], cum = []; let a = 0; for (const p of this.polys) if (p) { a += p.cells.length; ids.push(p.id); cum.push(a); } this._cum = { ids, cum, total: a }; }
    let ids = this._cum.ids, cum = this._cum.cum, total = this._cum.total;
    if (region !== null) { ids = []; cum = []; let a = 0; for (const p of this.polys) if (p && p.region === region) { a += p.cells.length; ids.push(p.id); cum.push(a); } total = a; }
    if (!total) return null;
    const r = next() * total; let lo = 0, hi = cum.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] > r) hi = m; else lo = m + 1; }
    const p = this.polys[ids[lo]], s = p.cells[Math.min(p.cells.length - 1, Math.floor(next() * p.cells.length))];
    const c = this.spanCol[s], i = c % this.nx, j = (c / this.nx) | 0;
    const x = this.minX + (i + next()) * this.cs, z = this.minZ + (j + next()) * this.cs;
    return new THREE.Vector3(x, this.surfaceY(s, x, z), z);
  }
  regionOf(p) { const n = this.findNearest(p); return n ? n.region : -1; }

  // ---- pathfinding
  _corridor(S, E, maxNodes) {
    const sp = S.poly, ep = E.poly;
    if (sp === ep) return { polys: [sp], edges: [] };
    if (this.region[S.span] !== this.region[E.span]) return null;
    const N = this.polys.length;
    if (!this._q || this._q.n < N) { this._q = { n: N, g: new Float64Array(N), px: new Float64Array(N), py: new Float64Array(N), pz: new Float64Array(N), par: new Int32Array(N), edge: new Array(N), seen: new Uint32Array(N), closed: new Uint32Array(N), stamp: 0, heap: new MinHeap() }; }
    const q = this._q; q.stamp++; const st = q.stamp, heap = q.heap; heap.clear();
    const ex = E.x, ey = E.y, ez = E.z;
    q.seen[sp] = st; q.g[sp] = 0; q.px[sp] = S.x; q.py[sp] = S.y; q.pz[sp] = S.z; q.par[sp] = -1; q.edge[sp] = null;
    heap.push(sp, Math.hypot(ex - S.x, ez - S.z));
    let found = false, expanded = 0;
    while (heap.size) {
      const cur = heap.pop();
      if (q.closed[cur] === st) continue; q.closed[cur] = st;
      if (cur === ep) { found = true; break; }
      if (++expanded > maxNodes) break;
      const P = this.polys[cur];
      for (const e of P.links) {
        const nb = e.to; if (!this.polys[nb] || q.closed[nb] === st) continue;
        const mx = (e.ax + e.bx) / 2, my = (e.ay + e.by) / 2, mz = (e.az + e.bz) / 2;
        let ng = q.g[cur] + Math.hypot(mx - q.px[cur], my - q.py[cur], mz - q.pz[cur]);
        let hh = Math.hypot(ex - mx, ey - my, ez - mz);
        if (nb === ep) { ng += hh; hh = 0; }
        if (q.seen[nb] !== st || ng < q.g[nb]) { q.seen[nb] = st; q.g[nb] = ng; q.px[nb] = mx; q.py[nb] = my; q.pz[nb] = mz; q.par[nb] = cur; q.edge[nb] = e; heap.push(nb, ng + hh * 0.999); }
      }
    }
    this.stats.lastExpanded = expanded;
    if (!found) return null;
    const polys = [], edges = []; let c = ep;
    while (c !== -1) { polys.push(c); if (q.edge[c]) edges.push(q.edge[c]); c = q.par[c]; }
    polys.reverse(); edges.reverse();
    return { polys, edges };
  }
  /**
   * Shortest path start -> end as Vector3 corners (start and end included, snapped to the mesh),
   * or null when either end is off the mesh (beyond maxSnap) or unreachable.
   */
  findPath(start, end, { maxSnap = 3, maxNodes = 200000 } = {}) {
    this._flush();
    const S = this._nearestSpan(start.x, start.y, start.z, maxSnap), E = this._nearestSpan(end.x, end.y, end.z, maxSnap);
    if (!S || !E) return null;
    const cor = this._corridor(S, E, maxNodes); if (!cor) return null;
    return this._stringPull(S, E, cor.edges);
  }
  _stringPull(S, E, edges) {
    const portals = [{ l: S, r: S }];
    for (const e of edges) {
      const mx = (e.ax + e.bx) / 2, mz = (e.az + e.bz) / 2, nX = DX[e.d], nZ = DZ[e.d];
      const A = { x: e.ax, y: e.ay, z: e.az }, Bp = { x: e.bx, y: e.by, z: e.bz };
      const crossA = nX * (A.z - mz) - nZ * (A.x - mx);
      portals.push(crossA < 0 ? { l: Bp, r: A } : { l: A, r: Bp });
    }
    portals.push({ l: E, r: E });
    const tri = (a, b, c) => (c.x - a.x) * (b.z - a.z) - (b.x - a.x) * (c.z - a.z);
    const eq = (a, b) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2 < 1e-10;
    const pts = [S];
    let apex = S, left = portals[0].l, right = portals[0].r, ai = 0, li = 0, ri = 0;
    for (let i = 1; i < portals.length; i++) {
      const l = portals[i].l, r = portals[i].r;
      if (tri(apex, right, r) <= 0) {
        if (eq(apex, right) || tri(apex, left, r) > 0) { right = r; ri = i; }
        else { pts.push(left); apex = left; ai = li; left = apex; right = apex; li = ai; ri = ai; i = ai; continue; }
      }
      if (tri(apex, left, l) >= 0) {
        if (eq(apex, left) || tri(apex, right, l) < 0) { left = l; li = i; }
        else { pts.push(right); apex = right; ai = ri; left = apex; right = apex; li = ai; ri = ai; i = ai; continue; }
      }
    }
    pts.push(E);
    const out = [];
    for (const p of pts) { const v = new THREE.Vector3(p.x, p.y, p.z); if (!out.length || out[out.length - 1].distanceToSquared(v) > 1e-8) out.push(v); }
    if (out.length === 1) out.push(out[0].clone());
    return out;
  }
  /** Path length (m) of a findPath result. */
  static pathLength(path) { let L = 0; for (let i = 1; i < (path?.length || 0); i++) L += path[i].distanceTo(path[i - 1]); return L; }

  // ---- dynamic obstacles (parked cars, closed doors, barricades)
  /**
   * Block the mesh under a shape: Box3 | {min,max} | {x, z, hx, hz, yaw, y?, hy?} | {type:'cylinder', x, z, r, y?, h?}.
   * The footprint is inflated by agentRadius; without a y range it blocks every level.
   * Polygons of the touched tiles are rebuilt lazily before the next query. Returns an id.
   */
  addObstacle(shape) {
    const p = prepShape(shape); if (!p) throw new Error('addObstacle: unsupported shape');
    const id = this._obstacleId++, spans = this._obstacleSpans(p);
    for (const s of spans) this.blocked[s]++;
    this.obstacles.set(id, { shape: { ...shape }, p, spans });
    this._markDirty(spans);
    return id;
  }
  removeObstacle(id) {
    const o = this.obstacles.get(id); if (!o) return false;
    for (const s of o.spans) this.blocked[s]--;
    this.obstacles.delete(id); this._markDirty(o.spans); return true;
  }
  /** Move an obstacle (e.g. a door swinging, a car parking): remove + add, keeps the id. */
  updateObstacle(id, shape) {
    const o = this.obstacles.get(id); if (!o) return false;
    for (const s of o.spans) this.blocked[s]--;
    this._markDirty(o.spans);
    const p = prepShape(shape), spans = this._obstacleSpans(p);
    for (const s of spans) this.blocked[s]++;
    this.obstacles.set(id, { shape: { ...shape }, p, spans }); this._markDirty(spans); return true;
  }
  _obstacleSpans(p) {
    const { cs, nx, nz, minX, minZ, colStart, spanY: Y } = this, r = this.params.agentRadius, H = this.params.agentHeight;
    const [ex, ez] = shapeExtent(p), out = [];
    const i0 = clamp(Math.floor((p.x - ex - r - minX) / cs), 0, nx - 1), i1 = clamp(Math.floor((p.x + ex + r - minX) / cs), 0, nx - 1);
    const j0 = clamp(Math.floor((p.z - ez - r - minZ) / cs), 0, nz - 1), j1 = clamp(Math.floor((p.z + ez + r - minZ) / cs), 0, nz - 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      // centre test against the inflated footprint (cell half-size 0 -> no double inflation)
      if (!shapeAt(p, minX + (i + 0.5) * cs, minZ + (j + 0.5) * cs, cs * 0.25, -2, r)) continue;
      const c = j * nx + i;
      for (let s = colStart[c]; s < colStart[c + 1]; s++) if (p.maxY > Y[s] + 0.05 && p.minY < Y[s] + H) out.push(s);
    }
    return out;
  }
  _markDirty(spans) { for (const s of spans) { const c = this.spanCol[s], i = c % this.nx, j = (c / this.nx) | 0; this._dirty.add(((j / this.tileH) | 0) * this.tilesX + ((i / this.tileW) | 0)); } }
  /** Apply pending obstacle changes now (queries do it automatically). */
  update() { this._flush(); return this; }

  // ---- info / serialization / debug
  info() { this._flush(); return { ...this.stats, obstacles: this.obstacles.size, version: this.version, cellSize: this.cs, params: { ...this.params } }; }
  toJSON() {
    return {
      format: 'gf-navmesh', version: 1, params: this.params, minX: this.minX, minZ: this.minZ, nx: this.nx, nz: this.nz,
      colStart: b64enc(this.colStart), spanY: b64enc(this.spanY), spanCeil: b64enc(this.spanCeil), kept: b64enc(this.kept),
      obstacles: [...this.obstacles.values()].map((o) => o.shape), stats: { buildMs: this.stats.buildMs },
    };
  }
  static fromJSON(json) {
    const d = typeof json === 'string' ? JSON.parse(json) : json;
    if (d.format !== 'gf-navmesh') throw new Error('NavMesh.fromJSON: not a gf-navmesh');
    const t0 = now(), m = new NavMesh();
    m._init({ params: d.params, minX: d.minX, minZ: d.minZ, nx: d.nx, nz: d.nz, colStart: b64dec(d.colStart, Int32Array), spanY: b64dec(d.spanY, Float32Array), spanCeil: b64dec(d.spanCeil, Float32Array) });
    m._buildLinks();
    m.kept.set(b64dec(d.kept, Uint8Array));
    let k = 0; for (let s = 0; s < m.spanCount; s++) k += m.kept[s]; m.stats.walkableSpans = k;
    m._buildRegions(null);
    m._buildAllPolys();
    for (const o of d.obstacles || []) m.addObstacle(o);
    m._flush();
    m.stats.buildMs = d.stats?.buildMs; m.stats.loadMs = +(now() - t0).toFixed(1);
    return m;
  }
  /**
   * Visualization: Group with the walkable surface (one colour per polygon, blocked = red),
   * polygon outlines and optional portals. Rebuild it after obstacle changes.
   */
  debugMesh({ offset = 0.06, opacity = 0.5, outlines = true, portals = false, blocked = true } = {}) {
    this._flush();
    const { cs, minX, minZ, nx } = this, g = new THREE.Group(); g.name = 'navmesh-debug';
    const pos = [], col = [], color = new THREE.Color();
    const quad = (s, r, gg, b) => {
      const c = this.spanCol[s], i = c % nx, j = (c / nx) | 0, x0 = minX + i * cs, z0 = minZ + j * cs, x1 = x0 + cs, z1 = z0 + cs;
      const y00 = this.surfaceY(s, x0, z0) + offset, y10 = this.surfaceY(s, x1, z0) + offset, y01 = this.surfaceY(s, x0, z1) + offset, y11 = this.surfaceY(s, x1, z1) + offset;
      pos.push(x0, y00, z0, x0, y01, z1, x1, y11, z1, x0, y00, z0, x1, y11, z1, x1, y10, z0);
      for (let k = 0; k < 6; k++) col.push(r, gg, b);
    };
    for (const p of this.polys) {
      if (!p) continue;
      color.setHSL((p.id * 0.618034) % 1, 0.55, 0.55);
      for (const s of p.cells) quad(s, color.r, color.g, color.b);
    }
    if (blocked) for (let s = 0; s < this.spanCount; s++) if (this.kept[s] && this.blocked[s]) quad(s, 0.95, 0.15, 0.1);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const surf = new THREE.Mesh(geo, mat); surf.name = 'navmesh-surface'; surf.renderOrder = 2; g.add(surf);
    if (outlines) {
      const lp = [];
      for (const p of this.polys) {
        if (!p) continue;
        const edge = (s, ax, az, bx, bz) => lp.push(ax, this.surfaceY(s, ax, az) + offset * 1.5, az, bx, this.surfaceY(s, bx, bz) + offset * 1.5, bz);
        for (let k = 0; k < p.w; k++) {
          const s0 = p.cells[k], s1 = p.cells[(p.h - 1) * p.w + k], x0 = minX + (p.i0 + k) * cs;
          edge(s0, x0, minZ + p.j0 * cs, x0 + cs, minZ + p.j0 * cs); edge(s1, x0, minZ + (p.j1 + 1) * cs, x0 + cs, minZ + (p.j1 + 1) * cs);
        }
        for (let k = 0; k < p.h; k++) {
          const s0 = p.cells[k * p.w], s1 = p.cells[k * p.w + p.w - 1], z0 = minZ + (p.j0 + k) * cs;
          edge(s0, minX + p.i0 * cs, z0, minX + p.i0 * cs, z0 + cs); edge(s1, minX + (p.i1 + 1) * cs, z0, minX + (p.i1 + 1) * cs, z0 + cs);
        }
      }
      const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
      const lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x0b2a3a, transparent: true, opacity: 0.55, depthWrite: false })); lines.name = 'navmesh-outlines'; lines.renderOrder = 3; g.add(lines);
    }
    if (portals) {
      const pp = [];
      for (const p of this.polys) if (p) for (const e of p.links) if (e.to > p.id) pp.push(e.ax, e.ay + offset * 2, e.az, e.bx, e.by + offset * 2, e.bz);
      const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.Float32BufferAttribute(pp, 3));
      const pl = new THREE.LineSegments(pg, new THREE.LineBasicMaterial({ color: 0xffffff, depthWrite: false })); pl.name = 'navmesh-portals'; pl.renderOrder = 4; g.add(pl);
    }
    g.userData.triangles = pos.length / 9;
    return g;
  }
}

// ---------------------------------------------------------------- planner adapter
/**
 * ScheduleAgent planner over a NavMesh (like navGridPlanner). Returns waypoints after the start.
 * fallback when no path: 'stay' (default: [from], the agent re-plans next activity) | 'straight'.
 */
export function navMeshPlanner(navmesh, { fallback = 'stay', maxSnap = 4 } = {}) {
  return (from, to) => {
    const p = navmesh.findPath(from, to, { maxSnap });
    if (p) return p.slice(1);
    return fallback === 'straight' ? [new THREE.Vector3(to.x, to.y ?? 0, to.z)] : [new THREE.Vector3(from.x, from.y ?? 0, from.z)];
  };
}

// ---------------------------------------------------------------- steering
let AGENT_ID = 1;
const _a = new THREE.Vector3(), _b = new THREE.Vector3();
/**
 * NavAgent: follows a navmesh path with arrival, sampled reciprocal velocity-obstacle avoidance
 * (neighbours passed to update or managed by NavCrowd) and movement constrained to the mesh.
 *   new NavAgent(navmesh, { position, radius, maxSpeed, maxAccel, arriveDistance, slowDistance,
 *                           integrate, avoidance, repathInterval, horizon })
 *   agent.setDestination(p) -> bool; agent.update(dt, neighbours?) ; agent.velocity / .state
 * integrate: false = only compute .velocity (feed it to an Actor / CharacterController) and keep
 * agent.position in sync yourself (agent.position.copy(actor.position)).
 */
export class NavAgent {
  constructor(navmesh, { id, position = new THREE.Vector3(), radius, height, maxSpeed = 1.6, maxAccel = 8, arriveDistance = 0.3, slowDistance = 1.4, integrate = true, avoidance = true,
    repathInterval = 4, horizon = 2.2, cornerReach } = {}) {
    this.navmesh = navmesh; this.id = id ?? 'nav' + AGENT_ID++;
    this.radius = radius ?? navmesh.params.agentRadius; this.height = height ?? navmesh.params.agentHeight;
    Object.assign(this, { maxSpeed, maxAccel, arriveDistance, slowDistance, integrate, avoidance, repathInterval, horizon });
    this.cornerReach = cornerReach ?? Math.max(0.2, this.radius * 0.7);
    this.position = new THREE.Vector3().copy(position); this.span = -1;
    const n = navmesh._nearestSpan(position.x, position.y, position.z, 4);
    if (n) { this.position.set(n.x, n.y, n.z); this.span = n.span; }
    this.velocity = new THREE.Vector3(); this.desired = new THREE.Vector3(); this.heading = 0;
    this.target = null; this.path = null; this.pathIndex = 0; this.state = 'idle'; this._ver = -1; this._repathT = 0; this._checkT = 0; this._stuckT = 0;
    this.stats = { repaths: 0, stuck: 0, blockedMoves: 0 };
  }
  /** Plan to p. Returns false (state 'nopath') when unreachable. */
  setDestination(p) { this.target = new THREE.Vector3(p.x, p.y ?? this.position.y, p.z); return this._plan(); }
  stop() { this.target = null; this.path = null; this.state = 'idle'; this.velocity.set(0, 0, 0); this.desired.set(0, 0, 0); }
  get arrived() { return this.state === 'arrived'; }
  get corner() { return this.path ? this.path[this.pathIndex] : null; }
  _plan() {
    if (!this.target) return false;
    const path = this.navmesh.findPath(this.position, this.target);
    this._ver = this.navmesh.version; this._repathT = 0; this.stats.repaths++;
    if (!path) { this.path = null; this.state = 'nopath'; return false; }
    this.path = path; this.pathIndex = Math.min(1, path.length - 1); this.state = 'moving'; return true;
  }
  /** Preferred velocity along the path (sets this.desired). */
  _preferred(dt) {
    const nm = this.navmesh; this.desired.set(0, 0, 0);
    if (this.state !== 'moving') return this.desired;
    this._repathT += dt; this._checkT += dt;
    if (nm.version !== this._ver || this._repathT > this.repathInterval) { if (!this._plan()) return this.desired; }
    const path = this.path, last = path.length - 1;
    while (this.pathIndex < last && Math.hypot(path[this.pathIndex].x - this.position.x, path[this.pathIndex].z - this.position.z) < this.cornerReach) this.pathIndex++;
    // pushed off the line of sight to the corner (avoidance / separation)? re-plan.
    if (this._checkT > 0.5) { this._checkT = 0; if (nm.raycast(this.position, path[this.pathIndex]).hit) { if (!this._plan()) return this.desired; } }
    const c = this.path[this.pathIndex], dx = c.x - this.position.x, dz = c.z - this.position.z, d = Math.hypot(dx, dz);
    if (this.pathIndex === this.path.length - 1 && d < this.arriveDistance) { this.state = 'arrived'; this.path = null; return this.desired; }
    let speed = this.maxSpeed;
    if (this.pathIndex === this.path.length - 1) speed *= Math.min(1, d / this.slowDistance);
    if (d > 1e-6) this.desired.set(dx / d * speed, 0, dz / d * speed);
    return this.desired;
  }
  // Sampled velocity obstacles (Detour-like): score candidates by deviation from the preferred
  // velocity, reciprocal time-to-collision with neighbours and a short wall probe.
  _avoid(pref, neighbors) {
    if (!this.avoidance || !neighbors.length) return pref;
    const vmax = this.maxSpeed, cands = [[pref.x, pref.z]], base = pref.lengthSq() > 1e-6 ? Math.atan2(pref.x, pref.z) : this.heading;
    for (const f of [1, 0.55]) for (let k = 0; k < 12; k++) { const a = base + (k / 12) * Math.PI * 2; cands.push([Math.sin(a) * vmax * f, Math.cos(a) * vmax * f]); }
    cands.push([0, 0]);
    let best = cands[0], bestPen = Infinity;
    const H = this.horizon, px = this.position.x, pz = this.position.z, prefLen = pref.length();
    for (const [vx, vz] of cands) {
      let pen = 2 * Math.hypot(vx - pref.x, vz - pref.z) / vmax + 0.4 * Math.hypot(vx - this.velocity.x, vz - this.velocity.z) / vmax;
      // keep-right convention breaks the symmetric head-on deadlock (both agents choosing to stop)
      if (prefLen > 1e-6) { const side = (pref.x * vz - pref.z * vx) / (prefLen * vmax); if (side > 0) pen += 0.35 * side; }
      if (pen >= bestPen) continue;
      let tmin = H;
      for (const n of neighbors) {
        const rx = n.position.x - px, rz = n.position.z - pz, R = this.radius + n.radius + 0.05;
        // reciprocal (RVO): another avoiding agent takes half of the effort, so test 2*v - v_current;
        // a non-avoiding neighbour (player, scripted actor: avoidance === false) is treated as is
        const rec = n.avoidance !== false;
        const wx = (rec ? 2 * vx - this.velocity.x : vx) - n.velocity.x, wz = (rec ? 2 * vz - this.velocity.z : vz) - n.velocity.z;
        const dist2 = rx * rx + rz * rz;
        if (dist2 < R * R) { if (wx * rx + wz * rz > 0) { tmin = 0; break; } continue; }
        const a = wx * wx + wz * wz; if (a < 1e-9) continue;
        const b = rx * wx + rz * wz; if (b <= 0) continue;
        const disc = b * b - a * (dist2 - R * R); if (disc < 0) continue;
        const t = (b - Math.sqrt(disc)) / a; if (t >= 0 && t < tmin) tmin = t;
      }
      pen += 2 * (1 / (0.1 + tmin) - 1 / (0.1 + H));
      if (pen >= bestPen) continue;
      if (vx * vx + vz * vz > 1e-6) {
        _a.set(px, this.position.y, pz); _b.set(px + vx * 0.6, this.position.y, pz + vz * 0.6);
        const ray = this.navmesh.raycast(_a, _b); if (ray.hit) pen += 3 * (1 - ray.t); // the sooner the wall, the worse
      }
      if (pen < bestPen) { bestPen = pen; best = [vx, vz]; }
    }
    return _a.set(best[0], 0, best[1]).clone();
  }
  _steer(dt, neighbors = []) {
    const pref = this._preferred(dt);
    const v = this._avoid(pref, neighbors);
    const dvx = v.x - this.velocity.x, dvz = v.z - this.velocity.z, dl = Math.hypot(dvx, dvz), maxDv = this.maxAccel * dt;
    const k = dl > maxDv ? maxDv / dl : 1;
    this.velocity.x += dvx * k; this.velocity.z += dvz * k; this.velocity.y = 0;
    if (this.state !== 'moving' && pref.lengthSq() === 0 && this.velocity.lengthSq() < 1e-4) this.velocity.set(0, 0, 0);
    return this.velocity;
  }
  _integrate(dt) {
    if (!this.integrate) return;
    const v = this.velocity, prevX = this.position.x, prevZ = this.position.z;
    if (v.lengthSq() > 1e-8) {
      _b.set(prevX + v.x * dt, this.position.y, prevZ + v.z * dt);
      const r = this.navmesh.moveAlongSurface(this.position, _b, this.span, this.position);
      this.span = r.span; if (r.blocked) this.stats.blockedMoves++;
      if (dt > 0) { v.x = (this.position.x - prevX) / dt; v.z = (this.position.z - prevZ) / dt; }
      this.heading = Math.atan2(v.x, v.z);
    }
    // stuck: wants to move but barely progresses -> re-plan
    if (this.state === 'moving') {
      const moved = Math.hypot(this.position.x - prevX, this.position.z - prevZ);
      if (moved < this.maxSpeed * dt * 0.1) { this._stuckT += dt; if (this._stuckT > 1.5) { this._stuckT = 0; this.stats.stuck++; this._plan(); } } else this._stuckT = 0;
    }
  }
  /** One step: steer (with optional neighbours [{position, velocity, radius}]) then move. */
  update(dt, neighbors = []) { this._steer(dt, neighbors); this._integrate(dt); return this.velocity; }
  /** Teleport onto the mesh. */
  teleport(p) { const n = this.navmesh._nearestSpan(p.x, p.y, p.z, 6); if (n) { this.position.set(n.x, n.y, n.z); this.span = n.span; } else this.position.copy(p); this.velocity.set(0, 0, 0); if (this.target) this._plan(); }
}

/**
 * NavCrowd: updates many NavAgents with neighbour queries (spatial hash), reciprocal avoidance and
 * an overlap separation pass that stays on the mesh.
 */
export class NavCrowd {
  constructor(navmesh, { neighborRadius = 3, maxNeighbors = 6, separation = true } = {}) { this.navmesh = navmesh; this.agents = []; Object.assign(this, { neighborRadius, maxNeighbors, separation }); this.stats = { overlaps: 0 }; }
  add(agent) { if (!(agent instanceof NavAgent)) agent = new NavAgent(this.navmesh, agent); this.agents.push(agent); return agent; }
  remove(agent) { const i = this.agents.indexOf(agent); if (i >= 0) this.agents.splice(i, 1); }
  neighbors(agent, grid = this._grid()) {
    const R = this.neighborRadius, out = [], cx = Math.floor(agent.position.x / R), cz = Math.floor(agent.position.z / R);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) for (const o of grid.get((cx + dx) * 73856093 ^ (cz + dz) * 19349663) || []) {
      if (o === agent || Math.abs(o.position.y - agent.position.y) > agent.height * 0.8) continue;
      const d = Math.hypot(o.position.x - agent.position.x, o.position.z - agent.position.z); if (d < R) out.push([d, o]);
    }
    out.sort((a, b) => a[0] - b[0]);
    return out.slice(0, this.maxNeighbors).map((x) => x[1]);
  }
  _grid() { const R = this.neighborRadius, g = new Map(); for (const a of this.agents) { const k = Math.floor(a.position.x / R) * 73856093 ^ Math.floor(a.position.z / R) * 19349663; if (!g.has(k)) g.set(k, []); g.get(k).push(a); } return g; }
  update(dt) {
    const grid = this._grid();
    const nbs = this.agents.map((a) => this.neighbors(a, grid));
    this.agents.forEach((a, i) => a._steer(dt, nbs[i]));
    for (const a of this.agents) a._integrate(dt);
    if (this.separation) {
      let overlaps = 0; const index = new Map(this.agents.map((a, i) => [a, i]));
      for (let i = 0; i < this.agents.length; i++) for (const b of nbs[i]) {
        const a = this.agents[i], j = index.get(b);
        if (!a.integrate || (j !== undefined && j < i && nbs[j].includes(a))) continue; // each pair once
        const dx = b.position.x - a.position.x, dz = b.position.z - a.position.z, d = Math.hypot(dx, dz), min = a.radius + b.radius;
        if (d >= min || d < 1e-6) continue;
        overlaps++;
        const push = (min - d) / 2, nx = dx / d, nz = dz / d;
        _b.set(a.position.x - nx * push, a.position.y, a.position.z - nz * push); a.span = this.navmesh.moveAlongSurface(a.position, _b, a.span, a.position).span;
        if (b.integrate) { _b.set(b.position.x + nx * push, b.position.y, b.position.z + nz * push); b.span = this.navmesh.moveAlongSurface(b.position, _b, b.span, b.position).span; }
      }
      this.stats.overlaps = overlaps;
    }
  }
  info() { const byState = {}; for (const a of this.agents) byState[a.state] = (byState[a.state] || 0) + 1; return { agents: this.agents.length, byState, overlaps: this.stats.overlaps }; }
}
