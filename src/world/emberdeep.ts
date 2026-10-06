import { CHUNK_SIZE, CHUNK_VOLUME, WORLD_HEIGHT } from '../core/constants';
import { blockIndex } from '../core/coords';
import { B } from '../core/ids';
import { Simplex, hash2, hash3, mulberry32 } from '../core/noise';
import { EMBER_MAGMA_LEVEL, EMBER_ROOF, type ChunkGenerator } from './dimension';

const STEP = 4;
const LAT_Y = WORLD_HEIGHT / STEP + 1;

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/**
 * Emberdeep: a sealed, burning underworld. Huge caverns carved from 3D noise between a
 * coreite floor and roof, a molten magma sea, basalt fields, glowcap clusters hanging from
 * the ceiling, quartz veins, duskstone along the magma shore and emberwood fungi.
 */
export class EmberdeepGenerator implements ChunkGenerator {
  readonly seed: number;
  private big: Simplex;
  private small: Simplex;
  private region: Simplex;
  private sand: Simplex;

  constructor(seed: number) {
    this.seed = (seed ^ 0x5eed_e3b) >>> 0;
    const r = mulberry32(this.seed);
    const s = () => Math.floor(r() * 4294967296);
    this.big = new Simplex(s());
    this.small = new Simplex(s());
    this.region = new Simplex(s());
    this.sand = new Simplex(s());
  }

  /** Solid density at any point (> 0 = rock). */
  density(x: number, y: number, z: number): number {
    const n = this.big.noise3(x / 58, y / 34, z / 58) * 0.68 + this.small.noise3(x / 21, y / 16, z / 21) * 0.32;
    const floor = smoothstep(26, 4, y) * 1.6;
    const roof = smoothstep(92, EMBER_ROOF, y) * 1.7;
    const open = y > EMBER_MAGMA_LEVEL + 2 && y < 92 ? 0.22 : 0;
    return n + floor + roof - open - 0.06;
  }

  private lattice(bx: number, bz: number): Float32Array {
    const n = CHUNK_SIZE / STEP + 1;
    const lat = new Float32Array(n * n * LAT_Y);
    for (let i = 0; i < n; i++) for (let k = 0; k < n; k++) for (let j = 0; j < LAT_Y; j++) {
      lat[(i * n + k) * LAT_Y + j] = this.density(bx + i * STEP, j * STEP, bz + k * STEP);
    }
    return lat;
  }

  describe(x: number, z: number): string {
    return `Emberdeep  ${this.region.noise2(x / 140, z / 140) > 0.42 ? 'Basalt Fields' : 'Cinder Caverns'}`;
  }

  /** Solid test straight from the noise (no ores/decoration) — used to find arrival spots before data exists. */
  rockAt(x: number, y: number, z: number): boolean {
    if (y <= 0 || y >= EMBER_ROOF) return true;
    return this.density(x, y, z) > 0;
  }

  findSpawn(): { x: number; y: number; z: number } {
    return this.findFloor(0, 0) ?? { x: 0.5, y: 64, z: 0.5 };
  }

  /** A floor spot with 3 free blocks above, above the magma sea, near (x,z). */
  findFloor(x0: number, z0: number): { x: number; y: number; z: number } | null {
    for (let r = 0; r < 64; r += 2) {
      for (let a = 0; a < 8; a++) {
        const x = Math.floor(x0 + Math.cos((a / 8) * Math.PI * 2) * r);
        const z = Math.floor(z0 + Math.sin((a / 8) * Math.PI * 2) * r);
        for (let y = EMBER_MAGMA_LEVEL + 2; y < 96; y++) {
          if (this.rockAt(x, y, z) && !this.rockAt(x, y + 1, z) && !this.rockAt(x, y + 2, z) && !this.rockAt(x, y + 3, z)) {
            return { x: x + 0.5, y: y + 1, z: z + 0.5 };
          }
        }
        if (r === 0) break;
      }
    }
    return null;
  }

  generate(cx: number, cz: number): Uint8Array {
    const data = new Uint8Array(CHUNK_VOLUME);
    const bx = cx * CHUNK_SIZE;
    const bz = cz * CHUNK_SIZE;
    const lat = this.lattice(bx, bz);
    const n = CHUNK_SIZE / STEP + 1;
    const L = (i: number, j: number, k: number) => lat[(i * n + k) * LAT_Y + j];
    const seed = this.seed;

    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      for (let lz = 0; lz < CHUNK_SIZE; lz++) {
        const wx = bx + lx;
        const wz = bz + lz;
        const i0 = Math.floor(lx / STEP), k0 = Math.floor(lz / STEP);
        const fx = (lx % STEP) / STEP, fz = (lz % STEP) / STEP;
        const basalt = this.region.noise2(wx / 140, wz / 140) > 0.42;
        const sandy = this.sand.noise2(wx / 60, wz / 60) > 0.25;
        const base = blockIndex(lx, 0, lz);
        for (let y = 0; y < WORLD_HEIGHT; y++) {
          let id: number;
          if (y === 0 || y === WORLD_HEIGHT - 1) id = B.COREITE;
          else if (y <= 3 && hash3(seed, wx, y, wz, 11) < 0.55 - y * 0.15) id = B.COREITE;
          else if (y >= WORLD_HEIGHT - 4 && hash3(seed, wx, y, wz, 12) < 0.3 + (y - (WORLD_HEIGHT - 4)) * 0.25) id = B.COREITE;
          else if (y >= EMBER_ROOF) id = B.CINDERROCK;
          else {
            const j0 = Math.floor(y / STEP);
            const fy = (y % STEP) / STEP;
            const c00 = L(i0, j0, k0) + (L(i0 + 1, j0, k0) - L(i0, j0, k0)) * fx;
            const c10 = L(i0, j0 + 1, k0) + (L(i0 + 1, j0 + 1, k0) - L(i0, j0 + 1, k0)) * fx;
            const c01 = L(i0, j0, k0 + 1) + (L(i0 + 1, j0, k0 + 1) - L(i0, j0, k0 + 1)) * fx;
            const c11 = L(i0, j0 + 1, k0 + 1) + (L(i0 + 1, j0 + 1, k0 + 1) - L(i0, j0 + 1, k0 + 1)) * fx;
            const d = (c00 + (c10 - c00) * fy) + ((c01 + (c11 - c01) * fy) - (c00 + (c10 - c00) * fy)) * fz;
            if (d > 0) id = basalt && y > 18 ? B.BASALT : B.CINDERROCK;
            else id = y <= EMBER_MAGMA_LEVEL ? B.MAGMA_DEEP : B.AIR;
          }
          data[base + y] = id;
        }
        // Magma surface layer glows; shores of the sea turn to duskstone; sandy floors.
        for (let y = 1; y < EMBER_ROOF; y++) {
          const id = data[base + y];
          if (id === B.MAGMA_DEEP && data[base + y + 1] !== B.MAGMA_DEEP) data[base + y] = B.MAGMA;
          else if ((id === B.CINDERROCK || id === B.BASALT) && data[base + y + 1] === B.AIR) {
            if (y >= EMBER_MAGMA_LEVEL - 1 && y <= EMBER_MAGMA_LEVEL + 2 && hash3(seed, wx, y, wz, 5) < 0.22) data[base + y] = B.DUSKSTONE;
            else if (sandy && !basalt && y < 70) {
              data[base + y] = B.ASHEN_SAND;
              if (data[base + y - 1] === B.CINDERROCK) data[base + y - 1] = B.ASHEN_SAND;
            }
          }
        }
      }
    }
    this.decorate(data, bx, bz, cx, cz);
    return data;
  }

  private decorate(data: Uint8Array, bx: number, bz: number, cx: number, cz: number): void {
    const seed = this.seed;
    const rand = mulberry32((hash2(seed, cx, cz, 77) * 4294967296) >>> 0);
    const at = (x: number, y: number, z: number) => data[blockIndex(x, y, z)];
    const put = (x: number, y: number, z: number, id: number) => {
      if (x < 0 || z < 0 || x >= CHUNK_SIZE || z >= CHUNK_SIZE || y < 1 || y >= EMBER_ROOF) return;
      data[blockIndex(x, y, z)] = id;
    };
    // Quartz veins inside cinderrock.
    for (let v = 0; v < 12; v++) {
      let x = Math.floor(rand() * CHUNK_SIZE), y = 8 + Math.floor(rand() * 100), z = Math.floor(rand() * CHUNK_SIZE);
      for (let s = 0; s < 6; s++) {
        if (x >= 0 && z >= 0 && x < CHUNK_SIZE && z < CHUNK_SIZE && at(x, y, z) === B.CINDERROCK) put(x, y, z, B.QUARTZ_ORE);
        const d = Math.floor(rand() * 6);
        if (d === 0) x++; else if (d === 1) x--; else if (d === 2) y++; else if (d === 3) y--; else if (d === 4) z++; else z--;
      }
    }
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      for (let lz = 0; lz < CHUNK_SIZE; lz++) {
        const wx = bx + lx, wz = bz + lz;
        for (let y = EMBER_MAGMA_LEVEL + 1; y < EMBER_ROOF - 1; y++) {
          const id = at(lx, y, lz);
          // Glowcap clusters hang from ceilings.
          if (id === B.AIR && y > 48) {
            const above = at(lx, y + 1, lz);
            if ((above === B.CINDERROCK || above === B.BASALT) && hash3(seed, wx, y, wz, 31) < 0.035) {
              const len = 1 + Math.floor(hash3(seed, wx, y, wz, 32) * 3);
              for (let k = 0; k < len && at(lx, y - k, lz) === B.AIR; k++) put(lx, y - k, lz, B.GLOWCAP);
              continue;
            }
          }
          // Sprouts on floors.
          if (id === B.AIR) {
            const below = at(lx, y - 1, lz);
            if ((below === B.CINDERROCK || below === B.ASHEN_SAND) && hash3(seed, wx, y, wz, 33) < 0.05) put(lx, y, lz, B.EMBER_SPROUT);
          }
        }
      }
    }
    // Emberwood fungi: kept inside the chunk so neighbors never need to agree.
    for (let tries = 0; tries < 3; tries++) {
      if (rand() > 0.55) continue;
      const lx = 2 + Math.floor(rand() * 12);
      const lz = 2 + Math.floor(rand() * 12);
      for (let y = EMBER_MAGMA_LEVEL + 2; y < 90; y++) {
        const g = at(lx, y - 1, lz);
        if ((g !== B.CINDERROCK && g !== B.ASHEN_SAND) || at(lx, y, lz) !== B.AIR && at(lx, y, lz) !== B.EMBER_SPROUT) continue;
        const h = 4 + Math.floor(rand() * 4);
        let clear = true;
        for (let k = 0; k < h + 2; k++) if (at(lx, y + k, lz) !== B.AIR && at(lx, y + k, lz) !== B.EMBER_SPROUT) clear = false;
        if (!clear) continue;
        for (let k = 0; k < h; k++) put(lx, y + k, lz, B.EMBER_STALK);
        const top = y + h;
        for (let dy = -1; dy <= 1; dy++) {
          const r = dy === 1 ? 1 : 2;
          for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
            if (Math.abs(dx) === r && Math.abs(dz) === r && dy !== 0) continue;
            if (dy === -1 && Math.abs(dx) < 2 && Math.abs(dz) < 2) continue; // hollow under the cap
            if (at(lx + dx, top + dy, lz + dz) === B.AIR) put(lx + dx, top + dy, lz + dz, B.EMBER_CAP);
          }
        }
        break;
      }
    }
  }
}
