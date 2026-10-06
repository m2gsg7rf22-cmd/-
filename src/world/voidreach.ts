import { CHUNK_SIZE, CHUNK_VOLUME, WORLD_HEIGHT } from '../core/constants';
import { blockIndex } from '../core/coords';
import { B } from '../core/ids';
import { Simplex, hash2, mulberry32 } from '../core/noise';
import type { ChunkGenerator } from './dimension';

const MAIN_R = 64;
const CELL = 72;
const PILLARS = 8;
const PILLAR_RING = 36;

interface Island {
  x: number;
  z: number;
  r: number;
  top: number;
  depth: number;
  seed: number;
}

/**
 * Voidreach: islands floating over an endless void. A large central island with a ring of
 * duskstone spires crowned by void crystals and a plaza holding the return gate, and outer
 * islands overgrown with branching voidbloom stalks.
 */
export class VoidreachGenerator implements ChunkGenerator {
  readonly seed: number;
  private edge: Simplex;
  private under: Simplex;

  constructor(seed: number) {
    this.seed = (seed ^ 0x0e1d_aa7) >>> 0;
    const r = mulberry32(this.seed);
    this.edge = new Simplex(Math.floor(r() * 4294967296));
    this.under = new Simplex(Math.floor(r() * 4294967296));
  }

  describe(x: number, z: number): string {
    return Math.hypot(x, z) < MAIN_R + 10 ? 'Voidreach  Central Island' : 'Voidreach  Outer Isles';
  }

  /** Main island: top and bottom y at a column, or null outside it. */
  private mainColumn(x: number, z: number): [number, number] | null {
    const a = Math.atan2(z, x);
    const R = MAIN_R + this.edge.noise2(Math.cos(a) * 2, Math.sin(a) * 2) * 9;
    const r = Math.hypot(x, z);
    if (r >= R) return null;
    const k = r / R;
    const top = Math.round(60 + this.edge.noise2(x / 40, z / 40) * 1.6 - k * k * 4);
    const depth = Math.pow(1 - k * k, 0.7) * 36 + 3 + this.under.noise2(x / 9, z / 9) * 3;
    return [top, Math.round(top - depth)];
  }

  /** Surface top of the main island (deterministic, used for the arrival spot and the gate). */
  mainTop(x: number, z: number): number {
    return this.mainColumn(x, z)?.[0] ?? 60;
  }

  private island(i: number, j: number): Island | null {
    const cx = i * CELL + CELL / 2;
    const cz = j * CELL + CELL / 2;
    if (Math.hypot(cx, cz) < MAIN_R + CELL * 0.75) return null;
    if (hash2(this.seed, i, j, 1) > 0.62) return null;
    return {
      x: i * CELL + 14 + hash2(this.seed, i, j, 2) * (CELL - 28),
      z: j * CELL + 14 + hash2(this.seed, i, j, 3) * (CELL - 28),
      r: 9 + hash2(this.seed, i, j, 4) * 16,
      top: Math.round(46 + hash2(this.seed, i, j, 5) * 30),
      depth: 8 + hash2(this.seed, i, j, 6) * 14,
      seed: Math.floor(hash2(this.seed, i, j, 7) * 4294967296),
    };
  }

  private islandColumn(is: Island, x: number, z: number): [number, number] | null {
    const r = Math.hypot(x - is.x, z - is.z);
    const R = is.r + this.edge.noise2(x / 14, z / 14) * 3;
    if (r >= R) return null;
    const k = r / R;
    const top = Math.round(is.top - k * k * 2);
    const depth = Math.pow(1 - k * k, 0.8) * is.depth + 2 + this.under.noise2(x / 7, z / 7) * 2;
    return [top, Math.round(top - depth)];
  }

  private pillar(p: number): { x: number; z: number; r: number; h: number } {
    const a = (p / PILLARS) * Math.PI * 2 + 0.3;
    return {
      x: Math.round(Math.cos(a) * PILLAR_RING),
      z: Math.round(Math.sin(a) * PILLAR_RING),
      r: 2 + Math.floor(hash2(this.seed, p, 0, 40) * 2),
      h: 16 + Math.floor(hash2(this.seed, p, 0, 41) * 18),
    };
  }

  /** Return-gate cell on the central plaza. */
  gateCell(): { x: number; y: number; z: number } {
    return { x: 4, y: this.mainTop(4, 0) + 1, z: 0 };
  }

  findSpawn(): { x: number; y: number; z: number } {
    return { x: 0.5, y: this.mainTop(0, 0) + 1, z: 0.5 };
  }

  generate(cx: number, cz: number): Uint8Array {
    const data = new Uint8Array(CHUNK_VOLUME);
    const bx = cx * CHUNK_SIZE;
    const bz = cz * CHUNK_SIZE;
    const isles: Island[] = [];
    const ci0 = Math.floor((bx - 30) / CELL), ci1 = Math.floor((bx + CHUNK_SIZE + 30) / CELL);
    const cj0 = Math.floor((bz - 30) / CELL), cj1 = Math.floor((bz + CHUNK_SIZE + 30) / CELL);
    for (let i = ci0; i <= ci1; i++) for (let j = cj0; j <= cj1; j++) {
      const is = this.island(i, j);
      if (is) isles.push(is);
    }
    const fillCol = (lx: number, lz: number, top: number, bottom: number) => {
      const base = blockIndex(lx, 0, lz);
      for (let y = Math.max(1, bottom); y <= Math.min(WORLD_HEIGHT - 2, top); y++) data[base + y] = B.VOIDSTONE;
    };
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      for (let lz = 0; lz < CHUNK_SIZE; lz++) {
        const wx = bx + lx, wz = bz + lz;
        const main = this.mainColumn(wx, wz);
        if (main) {
          fillCol(lx, lz, main[0], main[1]);
          // Arrival plaza of voidstone bricks around the origin.
          if (Math.max(Math.abs(wx), Math.abs(wz)) <= 5) data[blockIndex(lx, main[0], lz)] = B.VOID_BRICKS;
        }
        for (const is of isles) {
          const c = this.islandColumn(is, wx, wz);
          if (c) fillCol(lx, lz, c[0], c[1]);
        }
      }
    }
    // Spires with crystals on the central island.
    for (let p = 0; p < PILLARS; p++) {
      const pl = this.pillar(p);
      if (pl.x + pl.r < bx || pl.x - pl.r >= bx + CHUNK_SIZE || pl.z + pl.r < bz || pl.z - pl.r >= bz + CHUNK_SIZE) continue;
      const ground = this.mainTop(pl.x, pl.z);
      const top = Math.min(WORLD_HEIGHT - 3, ground + pl.h);
      for (let dx = -pl.r; dx <= pl.r; dx++) for (let dz = -pl.r; dz <= pl.r; dz++) {
        if (dx * dx + dz * dz > pl.r * pl.r + 1) continue;
        const lx = pl.x + dx - bx, lz = pl.z + dz - bz;
        if (lx < 0 || lz < 0 || lx >= CHUNK_SIZE || lz >= CHUNK_SIZE) continue;
        for (let y = ground - 2; y <= top; y++) data[blockIndex(lx, y, lz)] = B.DUSKSTONE;
      }
      const lx = pl.x - bx, lz = pl.z - bz;
      if (lx >= 0 && lz >= 0 && lx < CHUNK_SIZE && lz < CHUNK_SIZE) data[blockIndex(lx, top + 1, lz)] = B.VOID_CRYSTAL;
    }
    // The return gate.
    const g = this.gateCell();
    if (g.x >= bx && g.x < bx + CHUNK_SIZE && g.z >= bz && g.z < bz + CHUNK_SIZE) data[blockIndex(g.x - bx, g.y, g.z - bz)] = B.VOID_GATE;
    // Voidbloom stalks on the outer islands.
    for (const is of isles) this.stalks(data, is, bx, bz);
    return data;
  }

  private stalks(data: Uint8Array, is: Island, bx: number, bz: number): void {
    const rand = mulberry32(is.seed);
    const n = 2 + Math.floor(rand() * Math.min(6, is.r / 3));
    const put = (x: number, y: number, z: number, id: number) => {
      const lx = x - bx, lz = z - bz;
      if (lx < 0 || lz < 0 || lx >= CHUNK_SIZE || lz >= CHUNK_SIZE || y < 1 || y >= WORLD_HEIGHT - 1) return;
      const i = blockIndex(lx, y, lz);
      if (data[i] === B.AIR) data[i] = id;
    };
    for (let s = 0; s < n; s++) {
      const a = rand() * Math.PI * 2;
      const d = rand() * is.r * 0.6;
      const x = Math.round(is.x + Math.cos(a) * d);
      const z = Math.round(is.z + Math.sin(a) * d);
      const col = this.islandColumn(is, x, z);
      if (!col) continue;
      let y = col[0] + 1;
      const h = 3 + Math.floor(rand() * 5);
      for (let k = 0; k < h; k++) put(x, y + k, z, B.VOID_STALK);
      y += h;
      put(x, y, z, B.VOID_BLOOM);
      // One or two side branches that turn upward.
      const branches = 1 + Math.floor(rand() * 2);
      for (let b = 0; b < branches; b++) {
        const dir = Math.floor(rand() * 4);
        const ox = [1, -1, 0, 0][dir], oz = [0, 0, 1, -1][dir];
        const by = y - 1 - Math.floor(rand() * Math.max(1, h - 2));
        put(x + ox, by, z + oz, B.VOID_STALK);
        const up = 1 + Math.floor(rand() * 3);
        for (let k = 1; k <= up; k++) put(x + ox, by + k, z + oz, B.VOID_STALK);
        put(x + ox, by + up + 1, z + oz, B.VOID_BLOOM);
      }
    }
  }
}
