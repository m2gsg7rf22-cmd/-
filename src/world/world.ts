import * as THREE from 'three';
import { CHUNK_SIZE, PAD_SIZE, PAD_VOLUME, WORLD_HEIGHT } from '../core/constants';
import { blockIndex, chunkKey, toChunk, toLocal } from '../core/coords';
import { B, isWaterId } from '../core/ids';
import { decodeRLE, encodeRLE } from '../save/serialize';
import type { SaveStore } from '../save/db';
import { COLLISION, EMIT, OPAQUE, SOLID } from './blocks';
import { dimWorldId, type ChunkGenerator, type Dim } from './dimension';
import { createGenerator } from './generators';
import { meshChunk, SECTION_H, SECTIONS, type ChunkMeshes, type MeshData } from './mesher';
import { WorkerPool } from './workerPool';

/** Returned by getBlock for chunks that aren't loaded yet. */
export const UNLOADED = 255;

interface ChunkEntry {
  cx: number;
  cz: number;
  key: string;
  data: Uint8Array | null;
  loading: boolean;
  version: number;
  meshedVersion: number;
  meshing: boolean;
  /** Per vertical section meshes. */
  opaque: (THREE.Mesh | null)[];
  trans: (THREE.Mesh | null)[];
  tris: number;
  /** Light emitters in this chunk: packed [lx, y, lz, level]*. */
  emitters: number[];
  /** Per column: y of the topmost opaque block (for culling), and topmost visible block + its y (minimap). */
  opaqueTop: Uint8Array;
  topId: Uint8Array;
  topY: Uint8Array;
  /** Lowest opaque surface in the chunk: sections fully below it are buried. */
  minSurface: number;
}

export interface WorldStats {
  loaded: number;
  meshed: number;
  triangles: number;
  pending: number;
  workers: number;
  fallback: boolean;
}

export class World {
  readonly group = new THREE.Group();
  readonly gen: ChunkGenerator;
  /** Chunk storage id (world id + dimension). */
  private worldId: string;
  private pool: WorkerPool;
  private chunks = new Map<string, ChunkEntry>();
  private savedKeys = new Set<string>();
  private dirtySave = new Set<string>();
  /** RLE snapshots of modified chunks that were unloaded before being flushed. */
  private pendingSave = new Map<string, Uint8Array>();
  private lastEntry: ChunkEntry | null = null;
  private disposed = false;
  renderDistance: number;
  ao: boolean;
  onChunkError?: (msg: string) => void;
  /** Called after any block change (fluids, item support checks…). */
  onBlockChanged?: (x: number, y: number, z: number, oldId: number, newId: number) => void;
  /** Cull fully buried mesh sections (camera above ground). */
  cullBuried = true;

  constructor(
    seed: number,
    readonly dim: Dim,
    worldId: string,
    private store: SaveStore,
    private materials: { opaque: THREE.Material; transparent: THREE.Material },
    renderDistance: number,
    ao: boolean,
  ) {
    this.worldId = dimWorldId(worldId, dim);
    this.gen = createGenerator(dim, seed);
    const hc = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
    this.pool = new WorkerPool(seed, dim, Math.max(1, Math.min(4, hc - 1)));
    this.renderDistance = renderDistance;
    this.ao = ao;
    this.group.name = 'world';
  }

  async init(): Promise<void> {
    try {
      const keys = await this.store.listChunkKeys(this.worldId);
      for (const k of keys) this.savedKeys.add(k);
    } catch (e) {
      console.error('[BlockForge] failed to list saved chunks', e);
    }
  }

  // ---------- block access ----------

  private entryAt(cx: number, cz: number): ChunkEntry | undefined {
    const le = this.lastEntry;
    if (le && le.cx === cx && le.cz === cz) return le;
    const e = this.chunks.get(chunkKey(cx, cz));
    if (e) this.lastEntry = e;
    return e;
  }

  getBlock(x: number, y: number, z: number): number {
    if (y < 0) return B.COREITE;
    if (y >= WORLD_HEIGHT) return B.AIR;
    const fx = Math.floor(x);
    const fz = Math.floor(z);
    const e = this.entryAt(toChunk(fx), toChunk(fz));
    if (!e || !e.data) return UNLOADED;
    return e.data[blockIndex(toLocal(fx), Math.floor(y), toLocal(fz))];
  }

  /** Solid for physics; unloaded chunks count as solid so nothing falls out of the world. */
  isSolid = (x: number, y: number, z: number): boolean => {
    const id = this.getBlock(x, y, z);
    return id === UNLOADED || SOLID[id] === 1;
  };

  /** Collision shape of a cell for physics: true = full/unloaded, boxes for shaped blocks, null = passable. */
  collisionAt = (x: number, y: number, z: number): true | readonly number[][] | null => {
    const id = this.getBlock(x, y, z);
    if (id === UNLOADED) return true;
    return COLLISION[id];
  };

  /** Top visible block of a column (for the minimap); null if not loaded. */
  columnTop(x: number, z: number): { id: number; y: number } | null {
    const fx = Math.floor(x);
    const fz = Math.floor(z);
    const e = this.entryAt(toChunk(fx), toChunk(fz));
    if (!e || !e.data) return null;
    const i = toLocal(fx) * CHUNK_SIZE + toLocal(fz);
    return { id: e.topId[i], y: e.topY[i] };
  }

  private scanColumn(e: ChunkEntry, lx: number, lz: number): void {
    const d = e.data!;
    const base = blockIndex(lx, 0, lz);
    const ci = lx * CHUNK_SIZE + lz;
    let ot = 0;
    let tid = 0;
    let ty = 0;
    for (let y = WORLD_HEIGHT - 1; y >= 0; y--) {
      const id = d[base + y];
      if (id === 0) continue;
      if (!tid) { tid = id; ty = y; }
      if (OPAQUE[id]) { ot = y; break; }
    }
    e.opaqueTop[ci] = ot;
    e.topId[ci] = tid;
    e.topY[ci] = ty;
  }

  private analyze(e: ChunkEntry): void {
    const d = e.data!;
    e.emitters = [];
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      for (let lz = 0; lz < CHUNK_SIZE; lz++) {
        this.scanColumn(e, lx, lz);
        const base = blockIndex(lx, 0, lz);
        for (let y = 0; y < WORLD_HEIGHT; y++) {
          const em = EMIT[d[base + y]];
          if (em) e.emitters.push(lx, y, lz, em);
        }
      }
    }
    this.updateMinSurface(e);
  }

  private updateMinSurface(e: ChunkEntry): void {
    let m = WORLD_HEIGHT;
    for (let i = 0; i < 256; i++) m = Math.min(m, e.opaqueTop[i]);
    e.minSurface = m;
  }

  /** Does any emitter (local coords of its chunk) reach the neighbor chunk at offset (dx,dz)? */
  private emittersReach(em: number[], dx: number, dz: number): boolean {
    for (let k = 0; k < em.length; k += 4) {
      const lx = em[k] - dx * CHUNK_SIZE;
      const lz = em[k + 2] - dz * CHUNK_SIZE;
      // Distance from the emitter (in the neighbor's local space) to the neighbor's bounds.
      const dist = Math.max(0, -lx, lx - (CHUNK_SIZE - 1)) + Math.max(0, -lz, lz - (CHUNK_SIZE - 1));
      if (dist < em[k + 3]) return true;
    }
    return false;
  }

  /** Emitters from the 8 neighbor chunks that can reach into chunk (cx,cz), in its local coords. */
  private externalEmitters(cx: number, cz: number): Int16Array | undefined {
    const out: number[] = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (!dx && !dz) continue;
        const n = this.entryAt(cx + dx, cz + dz);
        if (!n || !n.emitters.length) continue;
        for (let k = 0; k < n.emitters.length; k += 4) {
          const lx = n.emitters[k] + dx * CHUNK_SIZE;
          const lz = n.emitters[k + 2] + dz * CHUNK_SIZE;
          const lvl = n.emitters[k + 3];
          const dist = Math.max(0, -1 - lx, lx - CHUNK_SIZE) + Math.max(0, -1 - lz, lz - CHUNK_SIZE);
          if (dist < lvl) out.push(lx, n.emitters[k + 1], lz, lvl);
        }
      }
    }
    return out.length ? Int16Array.from(out) : undefined;
  }

  isChunkLoaded(cx: number, cz: number): boolean {
    return !!this.entryAt(cx, cz)?.data;
  }

  isChunkMeshed(cx: number, cz: number): boolean {
    const e = this.entryAt(cx, cz);
    return !!e && e.meshedVersion >= 0;
  }

  /** Highest non-air, non-plant block in a loaded column, or -1. */
  surfaceY(x: number, z: number): number {
    for (let y = WORLD_HEIGHT - 1; y >= 0; y--) {
      const id = this.getBlock(x, y, z);
      if (id === UNLOADED) return -1;
      if (SOLID[id] || isWaterId(id)) return y;
    }
    return -1;
  }

  /** Natural ground under canopies/plants (skips leaves, logs, plants); -1 if water or unloaded on top. */
  private groundY(x: number, z: number, ground: Set<number>): number {
    for (let y = WORLD_HEIGHT - 1; y >= 0; y--) {
      const id = this.getBlock(x, y, z);
      if (id === UNLOADED) return -1;
      if (id === B.AIR || id === B.ASH_LEAVES || id === B.PINE_LEAVES || id === B.ASH_LOG || id === B.PINE_LOG || !SOLID[id]) {
        if (isWaterId(id)) return -1;
        continue;
      }
      return ground.has(id) ? y : -1;
    }
    return -1;
  }

  /**
   * Find a safe standing spot near (x,z) using real block data: ground must be natural
   * terrain (not leaves/logs/water) with two free blocks above. Returns feet position or null.
   */
  findSafeSpot(x: number, z: number, radius = 16): { x: number; y: number; z: number } | null {
    const ground = new Set<number>([B.GRASS, B.DIRT, B.SAND, B.SNOW_GRASS, B.GRAVEL, B.STONE, B.SNOW_BLOCK, B.SANDSTONE]);
    const free = (id: number) => id !== UNLOADED && !SOLID[id] && !isWaterId(id);
    const fx = Math.floor(x);
    const fz = Math.floor(z);
    let fallback: { x: number; y: number; z: number } | null = null;
    for (let r = 0; r <= radius; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const cx = fx + dx;
          const cz = fz + dz;
          const y = this.groundY(cx, cz, ground);
          if (y < 0) continue;
          if (!free(this.getBlock(cx, y + 1, cz)) || !free(this.getBlock(cx, y + 2, cz))) continue;
          const spot = { x: cx + 0.5, y: y + 1, z: cz + 0.5 };
          // Prefer open spots: all 4 neighbors walkable at feet and head level.
          let open = 0;
          for (const [ax, az] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            if (free(this.getBlock(cx + ax, y + 1, cz + az)) && free(this.getBlock(cx + ax, y + 2, cz + az))) open++;
          }
          if (open === 4) return spot;
          if (!fallback) fallback = spot;
        }
      }
    }
    return fallback;
  }

  /** Set a block. `immediate` remeshes synchronously (player edits); bulk edits pass false and remesh via workers. */
  setBlock(x: number, y: number, z: number, id: number, immediate = true): boolean {
    if (y < 0 || y >= WORLD_HEIGHT) return false;
    const fx = Math.floor(x);
    const fz = Math.floor(z);
    const cx = toChunk(fx);
    const cz = toChunk(fz);
    const e = this.entryAt(cx, cz);
    if (!e || !e.data) return false;
    const lx = toLocal(fx);
    const lz = toLocal(fz);
    const i = blockIndex(lx, Math.floor(y), lz);
    const old = e.data[i];
    if (old === id) return false;
    e.data[i] = id;
    e.version++;
    this.dirtySave.add(e.key);
    this.scanColumn(e, lx, lz);
    this.updateMinSurface(e);
    const lightChanged = EMIT[old] > 0 || EMIT[id] > 0;
    if (lightChanged) {
      e.emitters = [];
      const d = e.data;
      for (let k = 0; k < d.length; k++) {
        const em = EMIT[d[k]];
        if (em) e.emitters.push(Math.floor(k / (CHUNK_SIZE * WORLD_HEIGHT)), k % WORLD_HEIGHT, Math.floor(k / WORLD_HEIGHT) % CHUNK_SIZE, em);
      }
      // Light reaches up to 15 blocks: every neighbor may need relighting.
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        const n = this.entryAt(cx + dx, cz + dz);
        if (n && n !== e && n.data) n.version++;
      }
    }
    // Rebuild this chunk immediately for instant feedback; neighbors via workers.
    if (immediate) this.meshNow(e);
    const nx = lx === 0 ? -1 : lx === CHUNK_SIZE - 1 ? 1 : 0;
    const nz = lz === 0 ? -1 : lz === CHUNK_SIZE - 1 ? 1 : 0;
    const touch = (dx: number, dz: number) => {
      const n = this.entryAt(cx + dx, cz + dz);
      if (n && n.data) {
        n.version++;
        if (immediate && Math.abs(dx) + Math.abs(dz) === 1) this.meshNow(n);
      }
    };
    if (nx) touch(nx, 0);
    if (nz) touch(0, nz);
    if (nx && nz) touch(nx, nz);
    this.onBlockChanged?.(fx, Math.floor(y), fz, old, id);
    return true;
  }

  // ---------- streaming ----------

  private neighborsLoaded(cx: number, cz: number): boolean {
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++) if (!this.entryAt(cx + dx, cz + dz)?.data) return false;
    return true;
  }

  private buildPad(cx: number, cz: number): Uint8Array {
    const pad = new Uint8Array(PAD_VOLUME);
    for (let px = -1; px <= CHUNK_SIZE; px++) {
      for (let pz = -1; pz <= CHUNK_SIZE; pz++) {
        const wx = cx * CHUNK_SIZE + px;
        const wz = cz * CHUNK_SIZE + pz;
        const e = this.entryAt(toChunk(wx), toChunk(wz));
        if (!e || !e.data) continue;
        const src = blockIndex(toLocal(wx), 0, toLocal(wz));
        pad.set(e.data.subarray(src, src + WORLD_HEIGHT), ((px + 1) * PAD_SIZE + (pz + 1)) * WORLD_HEIGHT);
      }
    }
    return pad;
  }

  private meshNow(e: ChunkEntry): void {
    if (!this.neighborsLoaded(e.cx, e.cz)) return;
    const v = e.version;
    const m = meshChunk(this.buildPad(e.cx, e.cz), this.ao, this.externalEmitters(e.cx, e.cz));
    this.applyMesh(e, m, v);
  }

  private makeMesh(d: MeshData, mat: THREE.Material, e: ChunkEntry): THREE.Mesh | null {
    if (d.indices.length === 0) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(d.positions, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(d.uvs, 2));
    g.setAttribute('tile', new THREE.BufferAttribute(d.tiles, 2));
    g.setAttribute('light', new THREE.BufferAttribute(d.light, 3));
    g.setIndex(new THREE.BufferAttribute(d.indices, 1));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat);
    m.position.set(e.cx * CHUNK_SIZE, 0, e.cz * CHUNK_SIZE);
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    m.updateMatrixWorld();
    return m;
  }

  private disposeMeshes(e: ChunkEntry): void {
    for (const m of [...e.opaque, ...e.trans]) {
      if (!m) continue;
      this.group.remove(m);
      m.geometry.dispose();
    }
    e.opaque = [];
    e.trans = [];
    e.tris = 0;
  }

  private applyMesh(e: ChunkEntry, m: ChunkMeshes, version: number): void {
    if (this.disposed || this.chunks.get(e.key) !== e) return;
    if (version < e.meshedVersion) return; // stale result
    this.disposeMeshes(e);
    let tris = 0;
    for (let s = 0; s < SECTIONS; s++) {
      const o = this.makeMesh(m.opaque[s], this.materials.opaque, e);
      const t = this.makeMesh(m.transparent[s], this.materials.transparent, e);
      if (o) this.group.add(o);
      if (t) {
        t.renderOrder = 1;
        this.group.add(t);
      }
      e.opaque.push(o);
      e.trans.push(t);
      tris += (m.opaque[s].indices.length + m.transparent[s].indices.length) / 3;
    }
    e.tris = tris;
    e.meshedVersion = version;
  }

  private loadChunk(cx: number, cz: number): void {
    const key = chunkKey(cx, cz);
    const e: ChunkEntry = {
      cx, cz, key, data: null, loading: true, version: 0, meshedVersion: -1, meshing: false, opaque: [], trans: [], tris: 0,
      emitters: [], opaqueTop: new Uint8Array(256), topId: new Uint8Array(256), topY: new Uint8Array(256), minSurface: 0,
    };
    this.chunks.set(key, e);
    const done = (data: Uint8Array) => {
      if (this.disposed || this.chunks.get(key) !== e) return;
      e.data = data;
      e.loading = false;
      this.lastEntry = null;
      this.analyze(e);
      // Neighbors meshed before this chunk existed need relighting — but only if one of
      // this chunk's emitters actually reaches into them.
      if (e.emitters.length) {
        for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
          if (!dx && !dz) continue;
          const n = this.entryAt(cx + dx, cz + dz);
          if (n && n.data && n.meshedVersion >= 0 && this.emittersReach(e.emitters, dx, dz)) n.version++;
        }
      }
    };
    const fail = (err: unknown) => {
      if (this.disposed) return;
      console.error(`[BlockForge] chunk ${key} failed to load`, err);
      this.onChunkError?.(String(err));
      // Allow retry on next update.
      if (this.chunks.get(key) === e) this.chunks.delete(key);
      this.lastEntry = null;
    };
    const pendingRle = this.pendingSave.get(key);
    if (pendingRle) {
      try {
        done(decodeRLE(pendingRle));
        return;
      } catch (err) {
        console.error('[BlockForge] corrupted pending chunk, regenerating', key, err);
      }
    }
    if (this.savedKeys.has(key)) {
      this.store
        .getChunk(this.worldId, key)
        .then((rle) => {
          if (rle) {
            try {
              done(decodeRLE(rle));
              return;
            } catch (err) {
              console.error(`[BlockForge] saved chunk ${key} is corrupted; regenerating`, err);
            }
          }
          return this.pool.generate(cx, cz).then(done);
        })
        .catch(fail);
    } else {
      this.pool.generate(cx, cz).then(done, fail);
    }
  }

  /**
   * Stream chunks around the player. Called every frame; does bounded work.
   * dirX/dirZ: horizontal look/move direction used to prioritize chunks ahead.
   */
  update(px: number, pz: number, dirX: number, dirZ: number, camAboveGround = false): void {
    const pcx = toChunk(px);
    const pcz = toChunk(pz);
    const R = this.renderDistance;
    const loadR = R + 1;

    // 1) Queue missing chunks by priority.
    const capacity = this.pool.capacity;
    let inflight = this.pool.inFlight;
    if (inflight < capacity) {
      const wanted: [number, number, number][] = [];
      for (let dx = -loadR; dx <= loadR; dx++) {
        for (let dz = -loadR; dz <= loadR; dz++) {
          const d2 = dx * dx + dz * dz;
          if (d2 > (loadR + 0.5) * (loadR + 0.5)) continue;
          const cx = pcx + dx;
          const cz = pcz + dz;
          if (this.chunks.has(chunkKey(cx, cz))) continue;
          const ahead = (dx * dirX + dz * dirZ) / Math.max(1, Math.sqrt(d2));
          wanted.push([cx, cz, d2 - ahead * Math.min(d2, 6)]);
        }
      }
      wanted.sort((a, b) => a[2] - b[2]);
      for (const [cx, cz] of wanted) {
        if (inflight >= capacity) break;
        this.loadChunk(cx, cz);
        inflight++;
      }
    }

    // 2) Mesh loaded chunks whose neighbors are ready.
    if (this.pool.inFlight < capacity + 2) {
      const toMesh: [ChunkEntry, number][] = [];
      for (const e of this.chunks.values()) {
        if (!e.data || e.meshing || e.meshedVersion === e.version) continue;
        const dx = e.cx - pcx;
        const dz = e.cz - pcz;
        const d2 = dx * dx + dz * dz;
        if (d2 > (R + 0.5) * (R + 0.5)) continue;
        if (!this.neighborsLoaded(e.cx, e.cz)) continue;
        toMesh.push([e, d2]);
      }
      toMesh.sort((a, b) => a[1] - b[1]);
      let budget = Math.max(1, capacity + 2 - this.pool.inFlight);
      for (const [e] of toMesh) {
        if (budget-- <= 0) break;
        const v = e.version;
        e.meshing = true;
        this.pool
          .mesh(this.buildPad(e.cx, e.cz), this.ao, this.externalEmitters(e.cx, e.cz))
          .then((m) => {
            e.meshing = false;
            this.applyMesh(e, m, v);
          })
          .catch((err) => {
            e.meshing = false;
            if (!this.disposed) console.error(`[BlockForge] mesh ${e.key} failed`, err);
          });
      }
    }

    // 3) Unload far chunks (with hysteresis so we don't thrash at the border).
    const unloadR = R + 3;
    for (const e of this.chunks.values()) {
      const dx = e.cx - pcx;
      const dz = e.cz - pcz;
      if (dx * dx + dz * dz <= unloadR * unloadR) {
        // Hide meshes outside render distance (e.g. after lowering the setting), and sections
        // buried under the chunk's lowest surface when the camera is above ground and not adjacent.
        const vis = dx * dx + dz * dz <= (R + 0.5) * (R + 0.5);
        const cull = this.cullBuried && camAboveGround && Math.max(Math.abs(dx), Math.abs(dz)) > 1;
        for (let sct = 0; sct < e.opaque.length; sct++) {
          const buried = cull && (sct + 1) * SECTION_H < e.minSurface - 2;
          const o = e.opaque[sct];
          const t = e.trans[sct];
          if (o) o.visible = vis && !buried;
          if (t) t.visible = vis && !buried;
        }
        continue;
      }
      if (e.loading) continue;
      if (this.dirtySave.has(e.key) && e.data) this.pendingSave.set(e.key, encodeRLE(e.data));
      this.disposeMeshes(e);
      this.chunks.delete(e.key);
      if (this.lastEntry === e) this.lastEntry = null;
    }
  }

  /** Mark every chunk for remeshing (e.g. AO setting changed). */
  remeshAll(): void {
    for (const e of this.chunks.values()) if (e.data) e.version++;
  }

  /** Persist modified chunks. */
  async flush(): Promise<void> {
    const batch: { key: string; rle: Uint8Array }[] = [];
    for (const key of this.dirtySave) {
      const e = this.chunks.get(key);
      const rle = e?.data ? encodeRLE(e.data) : this.pendingSave.get(key);
      if (rle) batch.push({ key, rle });
    }
    if (batch.length === 0) return;
    await this.store.putChunks(this.worldId, batch);
    for (const b of batch) {
      this.dirtySave.delete(b.key);
      this.pendingSave.delete(b.key);
      this.savedKeys.add(b.key);
    }
  }

  get hasUnsaved(): boolean {
    return this.dirtySave.size > 0;
  }

  stats(): WorldStats {
    let meshed = 0;
    let tris = 0;
    for (const e of this.chunks.values()) {
      if (e.meshedVersion >= 0) meshed++;
      tris += e.tris;
    }
    return {
      loaded: this.chunks.size,
      meshed,
      triangles: tris,
      pending: this.pool.inFlight,
      workers: this.pool.size,
      fallback: this.pool.fallback,
    };
  }

  dispose(): void {
    this.disposed = true;
    for (const e of this.chunks.values()) this.disposeMeshes(e);
    this.chunks.clear();
    this.lastEntry = null;
    this.pool.dispose();
  }
}
