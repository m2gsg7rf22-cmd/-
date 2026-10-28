// Open-world streaming: a grid ChunkManager that builds/disposes content per cell around a
// focus point (nearest-first, per-frame budget, load/unload hysteresis, velocity look-ahead),
// distance LOD switching (LODGroup: near/mid/far objects or impostor billboards, with
// hysteresis), plus helpers to bucket existing objects into cells.
// The scheduling logic is pure (no rendering) so it is unit-testable in Node.
import * as THREE from '../vendor/three/three.module.js';

export const chunkKey = (cx, cz) => cx + ',' + cz;
export const parseChunkKey = (k) => k.split(',').map(Number);

// Distance from point (x, z) to the nearest point of cell (cx, cz) (0 when inside).
export function cellDistance(cx, cz, x, z, size) {
  const x0 = cx * size, z0 = cz * size;
  const dx = Math.max(x0 - x, 0, x - (x0 + size)), dz = Math.max(z0 - z, 0, z - (z0 + size));
  return Math.hypot(dx, dz);
}

/**
 * ChunkManager
 *   build(cx, cz, key, mgr)   -> content (anything; may be a Promise for async builds)
 *   dispose(content, cx, cz, key, mgr)
 * Cells whose nearest edge is within loadRadius are loaded; loaded cells are only unloaded
 * once beyond unloadRadius (> loadRadius), which prevents thrashing at the border.
 * maxLoadsPerUpdate / maxUnloadsPerUpdate / budgetMs cap the work done per update; queued
 * cells are served nearest-first. `bounds` ({ minX, maxX, minZ, maxZ } in cells) clips the grid.
 */
export class ChunkManager {
  constructor({ cellSize = 64, loadRadius = 128, unloadRadius = null, maxLoadsPerUpdate = 2, maxUnloadsPerUpdate = 4, budgetMs = Infinity, lookAhead = 0, bounds = null, build = () => null, dispose = () => {}, now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) } = {}) {
    this.cellSize = cellSize; this.loadRadius = loadRadius; this.unloadRadius = unloadRadius ?? loadRadius + cellSize * 0.5;
    if (this.unloadRadius < this.loadRadius) throw new Error('unloadRadius must be >= loadRadius');
    Object.assign(this, { maxLoadsPerUpdate, maxUnloadsPerUpdate, budgetMs, lookAhead, bounds, build, dispose, now });
    this.chunks = new Map(); // key -> { cx, cz, content, state: 'loading'|'loaded', loadedAt }
    this.pending = [];
    this.stats = { loads: 0, unloads: 0, updates: 0, lastLoads: 0, lastUnloads: 0, maxPending: 0, buildMs: 0 };
    this.focus = { x: 0, z: 0 };
    this._prev = null;
  }
  cellOf(x, z) { return [Math.floor(x / this.cellSize), Math.floor(z / this.cellSize)]; }
  isLoaded(cx, cz) { return this.chunks.get(chunkKey(cx, cz))?.state === 'loaded'; }
  get loadedKeys() { return [...this.chunks.keys()].filter((k) => this.chunks.get(k).state === 'loaded').sort(); }
  get(cx, cz) { return this.chunks.get(chunkKey(cx, cz))?.content; }
  _inBounds(cx, cz) { const b = this.bounds; return !b || (cx >= b.minX && cx <= b.maxX && cz >= b.minZ && cz <= b.maxZ); }
  // Cells that should be resident for a focus position (sorted nearest-first).
  wanted(x, z, radius = this.loadRadius) {
    const s = this.cellSize, r = Math.ceil(radius / s) + 1, [fx, fz] = this.cellOf(x, z), out = [];
    for (let cz = fz - r; cz <= fz + r; cz++) for (let cx = fx - r; cx <= fx + r; cx++) {
      if (!this._inBounds(cx, cz)) continue;
      const d = cellDistance(cx, cz, x, z, s); if (d <= radius) out.push({ cx, cz, d });
    }
    return out.sort((a, b) => a.d - b.d);
  }
  /** Advance streaming. focus: {x, z}; dt (s) is used for the velocity look-ahead. */
  update(focus, dt = 0) {
    this.stats.updates++;
    let x = focus.x, z = focus.z;
    if (this.lookAhead > 0 && this._prev && dt > 0) { x += ((x - this._prev.x) / dt) * this.lookAhead; z += ((z - this._prev.z) / dt) * this.lookAhead; }
    this._prev = { x: focus.x, z: focus.z }; this.focus = { x, z };
    // unload far cells (hysteresis: only beyond unloadRadius from the real focus and look-ahead point)
    const far = [];
    for (const [k, c] of this.chunks) {
      const d = Math.min(cellDistance(c.cx, c.cz, focus.x, focus.z, this.cellSize), cellDistance(c.cx, c.cz, x, z, this.cellSize));
      if (d > this.unloadRadius) far.push([d, k, c]);
    }
    far.sort((a, b) => b[0] - a[0]);
    let unloads = 0;
    for (const [, k, c] of far) {
      if (unloads >= this.maxUnloadsPerUpdate) break;
      if (c.state === 'loading') { c.cancelled = true; this.chunks.delete(k); continue; }
      this.dispose(c.content, c.cx, c.cz, k, this); this.chunks.delete(k); unloads++; this.stats.unloads++;
    }
    // queue missing cells nearest-first (union of current focus and look-ahead point)
    const want = new Map();
    for (const w of [...this.wanted(focus.x, focus.z), ...(x !== focus.x || z !== focus.z ? this.wanted(x, z) : [])]) { const k = chunkKey(w.cx, w.cz); if (!want.has(k) || want.get(k).d > w.d) want.set(k, { ...w, k }); }
    this.pending = [...want.values()].filter((w) => !this.chunks.has(w.k)).sort((a, b) => a.d - b.d);
    this.stats.maxPending = Math.max(this.stats.maxPending, this.pending.length);
    let loads = 0; const t0 = this.now();
    while (this.pending.length && loads < this.maxLoadsPerUpdate) {
      if (loads > 0 && this.now() - t0 > this.budgetMs) break; // always make progress: at least one per update
      const w = this.pending.shift();
      const rec = { cx: w.cx, cz: w.cz, content: null, state: 'loading', loadedAt: this.stats.updates };
      this.chunks.set(w.k, rec);
      const tb = this.now();
      const r = this.build(w.cx, w.cz, w.k, this);
      if (r && typeof r.then === 'function') {
        r.then((content) => { if (rec.cancelled) { this.dispose(content, w.cx, w.cz, w.k, this); return; } rec.content = content; rec.state = 'loaded'; this.stats.loads++; });
      } else { rec.content = r; rec.state = 'loaded'; this.stats.loads++; }
      this.stats.buildMs += this.now() - tb;
      loads++;
    }
    this.stats.lastLoads = loads; this.stats.lastUnloads = unloads;
    return { loads, unloads, pending: this.pending.length, loaded: this.chunks.size };
  }
  // Load everything wanted around a point immediately (spawn / teleport / loading screen).
  warm(focus) { const m = this.maxLoadsPerUpdate, b = this.budgetMs; this.maxLoadsPerUpdate = Infinity; this.budgetMs = Infinity; this._prev = null; this.update(focus, 0); this.maxLoadsPerUpdate = m; this.budgetMs = b; }
  clear() { for (const [k, c] of this.chunks) if (c.state === 'loaded') this.dispose(c.content, c.cx, c.cz, k, this); this.chunks.clear(); this.pending = []; }
  debug() { return { loaded: this.loadedKeys.length, pending: this.pending.length, loads: this.stats.loads, unloads: this.stats.unloads, keys: this.loadedKeys }; }
}

// Bucket objects (anything with .position or {x, z}) into cells: Map key -> [objects].
export function bucketByCell(objects, cellSize, pos = (o) => o.position || o) {
  const m = new Map();
  for (const o of objects) { const p = pos(o); const k = chunkKey(Math.floor(p.x / cellSize), Math.floor(p.z / cellSize)); if (!m.has(k)) m.set(k, []); m.get(k).push(o); }
  return m;
}

// Convenience: stream existing Object3Ds (e.g. city buildings with mergeBuildings:false) in and
// out of a parent. Returns a ChunkManager whose content is the cell's object list.
export function streamObjects(parent, objects, { cellSize = 64, onLoad, onUnload, ...opts } = {}) {
  const buckets = bucketByCell(objects, cellSize);
  return new ChunkManager({ cellSize, ...opts,
    build: (cx, cz, k) => { const list = buckets.get(k) || []; for (const o of list) parent.add(o); onLoad?.(list, k); return list; },
    dispose: (list, cx, cz, k) => { for (const o of list || []) parent.remove(o); onUnload?.(list, k); },
  });
}

/**
 * Pure LOD selection with hysteresis. thresholds: ascending switch distances, e.g. [20, 60]
 * -> level 0 below 20, 1 below 60, 2 beyond; levels.length = thresholds.length + 1.
 * A level only changes once the distance crosses the threshold by `hysteresis` (fraction).
 * Returns the new level index; `cull` (distance) returns -1 (hidden) beyond it.
 */
export function selectLOD(distance, thresholds, current = -2, { hysteresis = 0.1, cull = Infinity } = {}) {
  const h = 1 + hysteresis;
  if (current === -1) { if (distance < cull / h) current = -2; else return -1; } // re-appear only well inside
  else if (distance > cull * (current === -2 ? 1 : h)) return -1;
  let raw = thresholds.length; for (let i = 0; i < thresholds.length; i++) if (distance < thresholds[i]) { raw = i; break; }
  if (current < 0) return raw;
  if (raw > current) { // moving away: must exceed threshold * h
    let lvl = current; while (lvl < thresholds.length && distance > thresholds[lvl] * h) lvl++; return lvl;
  }
  if (raw < current) { let lvl = current; while (lvl > 0 && distance < thresholds[lvl - 1] / h) lvl--; return lvl; }
  return current;
}

/**
 * LODGroup: one visible representation chosen by distance.
 *   new LODGroup([{ object: near, distance: 0 }, { object: mid, distance: 30 }, { object: impostor, distance: 90 }], { cull: 400 })
 * `distance` of level i = where it starts. Objects are parented to `lod.root` (an Object3D)
 * unless `attach: false`. update(viewPos) returns the active level (-1 = culled).
 */
export class LODGroup {
  constructor(levels = [], { hysteresis = 0.1, cull = Infinity, attach = true, onSwitch = null } = {}) {
    this.levels = levels.slice().sort((a, b) => a.distance - b.distance);
    this.thresholds = this.levels.slice(1).map((l) => l.distance);
    Object.assign(this, { hysteresis, cull, onSwitch });
    this.level = -2; this.switches = 0;
    this.root = new THREE.Group(); this.root.name = 'lod';
    for (const l of this.levels) { if (l.object) { l.object.visible = false; if (attach) this.root.add(l.object); } }
  }
  get position() { return this.root.position; }
  update(viewPos) {
    const wp = this._wp || (this._wp = new THREE.Vector3());
    this.root.getWorldPosition(wp);
    const d = Math.hypot(wp.x - viewPos.x, (wp.y - (viewPos.y ?? wp.y)), wp.z - viewPos.z);
    const lvl = selectLOD(d, this.thresholds, this.level, { hysteresis: this.hysteresis, cull: this.cull });
    if (lvl !== this.level) {
      const prev = this.level; this.level = lvl; this.switches++;
      this.levels.forEach((l, i) => { if (l.object) l.object.visible = i === lvl; });
      this.onSwitch?.(lvl, prev);
    }
    return this.level;
  }
}

/**
 * Billboard impostor: renders `object` once from the side into a texture (needs a renderer) and
 * returns a camera-facing Sprite sized like the object. Good for far trees/buildings/people.
 */
export function createImpostor(renderer, object, { size = 128, background = null, angle = 0 } = {}) {
  const box = new THREE.Box3().setFromObject(object), dim = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  const w = Math.max(dim.x, dim.z), h = dim.y, aspect = w / Math.max(1e-3, h);
  const rt = new THREE.WebGLRenderTarget(Math.max(8, Math.round(size * Math.min(1, aspect))), Math.max(8, Math.round(size / Math.max(1, aspect))));
  const scene = new THREE.Scene(); if (background !== null) scene.background = new THREE.Color(background);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 2.2)); const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(3, 6, 4); scene.add(sun);
  const parent = object.parent; scene.add(object);
  const cam = new THREE.OrthographicCamera(-w / 2, w / 2, h / 2, -h / 2, 0.01, 1000);
  cam.position.set(c.x + Math.sin(angle) * (w + 10), c.y, c.z + Math.cos(angle) * (w + 10)); cam.lookAt(c);
  const prevRT = renderer.getRenderTarget(), prevClear = renderer.getClearColor(new THREE.Color()), prevAlpha = renderer.getClearAlpha();
  renderer.setClearColor(0x000000, 0); renderer.setRenderTarget(rt); renderer.clear(); renderer.render(scene, cam); renderer.setRenderTarget(prevRT); renderer.setClearColor(prevClear, prevAlpha);
  scene.remove(object); if (parent) parent.add(object);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: rt.texture, transparent: true, alphaTest: 0.3 }));
  sprite.scale.set(w, h, 1); sprite.center.set(0.5, 0); sprite.position.y = box.min.y; // pivot at the feet/base
  sprite.userData.impostor = { renderTarget: rt, width: w, height: h };
  return sprite;
}
