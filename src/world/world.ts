import * as THREE from 'three';
import { CHUNK_SIZE, PAD_SIZE, PAD_VOLUME, WORLD_HEIGHT } from '../core/constants';
import { blockIndex, chunkKey, toChunk, toLocal } from '../core/coords';
import { B } from '../core/ids';
import { decodeRLE, encodeRLE } from '../save/serialize';
import type { SaveStore } from '../save/db';
import { SOLID } from './blocks';
import { TerrainGenerator } from './generator';
import { meshChunk, type MeshData } from './mesher';
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
  opaque: THREE.Mesh | null;
  trans: THREE.Mesh | null;
  tris: number;
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
  readonly gen: TerrainGenerator;
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

  constructor(
    seed: number,
    private worldId: string,
    private store: SaveStore,
    private materials: { opaque: THREE.Material; transparent: THREE.Material },
    renderDistance: number,
    ao: boolean,
  ) {
    this.gen = new TerrainGenerator(seed);
    const hc = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
    this.pool = new WorkerPool(seed, Math.max(1, Math.min(4, hc - 1)));
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
      if (SOLID[id] || id === B.WATER) return y;
    }
    return -1;
  }

  setBlock(x: number, y: number, z: number, id: number): boolean {
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
    if (e.data[i] === id) return false;
    e.data[i] = id;
    e.version++;
    this.dirtySave.add(e.key);
    // Rebuild this chunk immediately for instant feedback; neighbors via workers.
    this.meshNow(e);
    const nx = lx === 0 ? -1 : lx === CHUNK_SIZE - 1 ? 1 : 0;
    const nz = lz === 0 ? -1 : lz === CHUNK_SIZE - 1 ? 1 : 0;
    const touch = (dx: number, dz: number) => {
      const n = this.entryAt(cx + dx, cz + dz);
      if (n && n.data) {
        n.version++;
        if (Math.abs(dx) + Math.abs(dz) === 1) this.meshNow(n);
      }
    };
    if (nx) touch(nx, 0);
    if (nz) touch(0, nz);
    if (nx && nz) touch(nx, nz);
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
    const m = meshChunk(this.buildPad(e.cx, e.cz), this.ao);
    this.applyMesh(e, m.opaque, m.transparent, v);
  }

  private makeMesh(d: MeshData, mat: THREE.Material, e: ChunkEntry): THREE.Mesh | null {
    if (d.indices.length === 0) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(d.positions, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(d.uvs, 2));
    g.setAttribute('light', new THREE.BufferAttribute(d.light, 2));
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
    for (const m of [e.opaque, e.trans]) {
      if (!m) continue;
      this.group.remove(m);
      m.geometry.dispose();
    }
    e.opaque = null;
    e.trans = null;
    e.tris = 0;
  }

  private applyMesh(e: ChunkEntry, opaque: MeshData, trans: MeshData, version: number): void {
    if (this.disposed || this.chunks.get(e.key) !== e) return;
    if (version < e.meshedVersion) return; // stale result
    this.disposeMeshes(e);
    e.opaque = this.makeMesh(opaque, this.materials.opaque, e);
    e.trans = this.makeMesh(trans, this.materials.transparent, e);
    if (e.trans) e.trans.renderOrder = 1;
    if (e.opaque) this.group.add(e.opaque);
    if (e.trans) this.group.add(e.trans);
    e.tris = (opaque.indices.length + trans.indices.length) / 3;
    e.meshedVersion = version;
  }

  private loadChunk(cx: number, cz: number): void {
    const key = chunkKey(cx, cz);
    const e: ChunkEntry = {
      cx, cz, key, data: null, loading: true, version: 0, meshedVersion: -1, meshing: false, opaque: null, trans: null, tris: 0,
    };
    this.chunks.set(key, e);
    const done = (data: Uint8Array) => {
      if (this.disposed || this.chunks.get(key) !== e) return;
      e.data = data;
      e.loading = false;
      this.lastEntry = null;
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
  update(px: number, pz: number, dirX: number, dirZ: number): void {
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
          .mesh(this.buildPad(e.cx, e.cz), this.ao)
          .then((m) => {
            e.meshing = false;
            this.applyMesh(e, m.opaque, m.transparent, v);
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
        // Hide meshes outside render distance (e.g. after lowering the setting).
        const vis = dx * dx + dz * dz <= (R + 0.5) * (R + 0.5);
        if (e.opaque) e.opaque.visible = vis;
        if (e.trans) e.trans.visible = vis;
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
