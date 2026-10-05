import { CHUNK_SIZE, CHUNK_VOLUME, SEA_LEVEL, WORLD_HEIGHT } from '../core/constants';
import { blockIndex } from '../core/coords';
import { B } from '../core/ids';
import { Simplex, hash2, hash3, mulberry32 } from '../core/noise';

export const enum Biome {
  Ocean = 0,
  Beach = 1,
  Plains = 2,
  Forest = 3,
  DenseForest = 4,
  Desert = 5,
  Mountains = 6,
  Snow = 7,
  Taiga = 8,
  River = 9,
}

export const BIOME_NAMES = ['Ocean', 'Beach', 'Plains', 'Forest', 'Dense Forest', 'Desert', 'Mountains', 'Snowfields', 'Taiga', 'River'];

export interface ColumnInfo {
  height: number;
  biome: Biome;
  temp: number;
}

const TREE_CELL = 4;
const CAVE_STEP = 4;

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Piecewise-linear spline mapping continentalness to base height. */
const CONT_X = [-1, -0.45, -0.22, -0.08, 0.02, 0.3, 1];
const CONT_Y = [18, 30, 40, 47, 51, 57, 66];
function continentHeight(c: number): number {
  if (c <= CONT_X[0]) return CONT_Y[0];
  for (let i = 1; i < CONT_X.length; i++) {
    if (c <= CONT_X[i]) {
      const t = (c - CONT_X[i - 1]) / (CONT_X[i] - CONT_X[i - 1]);
      return lerp(CONT_Y[i - 1], CONT_Y[i], t);
    }
  }
  return CONT_Y[CONT_Y.length - 1];
}

/**
 * Deterministic terrain generator. Every function is pure given the seed, so
 * chunks can be generated independently (in workers) and still line up.
 */
export class TerrainGenerator {
  readonly seed: number;
  private cont: Simplex;
  private hills: Simplex;
  private ridge: Simplex;
  private mountainMask: Simplex;
  private temp: Simplex;
  private humid: Simplex;
  private river: Simplex;
  private detail: Simplex;
  private caveA: Simplex;
  private caveB: Simplex;
  private caveC: Simplex;
  private ravine: Simplex;

  constructor(seed: number) {
    this.seed = seed >>> 0;
    const r = mulberry32(this.seed);
    const s = () => Math.floor(r() * 4294967296);
    this.cont = new Simplex(s());
    this.hills = new Simplex(s());
    this.ridge = new Simplex(s());
    this.mountainMask = new Simplex(s());
    this.temp = new Simplex(s());
    this.humid = new Simplex(s());
    this.river = new Simplex(s());
    this.detail = new Simplex(s());
    this.caveA = new Simplex(s());
    this.caveB = new Simplex(s());
    this.caveC = new Simplex(s());
    this.ravine = new Simplex(s());
  }

  /** Terrain height (top solid block y) and biome for a world column. */
  column(x: number, z: number): ColumnInfo {
    const c = this.cont.fbm2(x / 700, z / 700, 4) * 1.25 + 0.12;
    let h = continentHeight(c);
    const landness = smoothstep(-0.12, 0.1, c);

    const mm = smoothstep(0.18, 0.55, this.mountainMask.fbm2(x / 520 + 31.7, z / 520 - 12.1, 3) * 1.1 + landness * 0.15);
    const rr = 1 - Math.abs(this.ridge.fbm2(x / 260, z / 260, 4));
    const mountain = mm * landness * (Math.pow(rr, 1.6) * 54 + this.detail.fbm2(x / 60, z / 60, 2) * 6);

    const hillAmp = lerp(3, 11, smoothstep(-0.3, 0.6, this.hills.noise2(x / 900 + 7, z / 900 - 3)));
    const hills = this.hills.fbm2(x / 150, z / 150, 4) * hillAmp * landness;
    const fine = this.detail.fbm2(x / 32, z / 32, 2) * 1.6;

    h = h + hills + mountain + fine;

    const t = this.temp.fbm2(x / 900 - 50, z / 900 + 90, 3) * 1.3;
    const hu = this.humid.fbm2(x / 800 + 120, z / 800 - 70, 3) * 1.3;

    // Rivers: thin bands carved toward sea level on land, fading out in mountains.
    const rv = Math.abs(this.river.fbm2(x / 480, z / 480, 3));
    let isRiver = false;
    const riverW = 0.035;
    if (rv < riverW && landness > 0.3) {
      const k = smoothstep(0, 1, 1 - rv / riverW) * (1 - mm * 0.85);
      const target = SEA_LEVEL - 3;
      if (h > target) {
        h = lerp(h, target, k);
        if (h < SEA_LEVEL) isRiver = true;
      }
    }

    const height = Math.max(4, Math.min(WORLD_HEIGHT - 12, Math.floor(h)));
    const tempAdj = t - Math.max(0, height - 70) * 0.018;

    let biome: Biome;
    if (height < SEA_LEVEL - 1) biome = isRiver ? Biome.River : Biome.Ocean;
    else if (height <= SEA_LEVEL + 1 && mm < 0.3) biome = isRiver ? Biome.River : Biome.Beach;
    else if (mm > 0.35 && height > 76) biome = Biome.Mountains;
    else if (tempAdj < -0.32) biome = hu > -0.05 ? Biome.Taiga : Biome.Snow;
    else if (tempAdj > 0.32 && hu < 0.05) biome = Biome.Desert;
    else if (hu > 0.38) biome = Biome.DenseForest;
    else if (hu > 0.02) biome = Biome.Forest;
    else biome = Biome.Plains;
    return { height, biome, temp: tempAdj };
  }

  /** Raw cave density at lattice point (world coords multiple of CAVE_STEP). */
  private caveLattice(x: number, y: number, z: number): number {
    // Spaghetti tunnels: two thin noise isosurfaces intersecting.
    const a = this.caveA.noise3(x / 48, y / 30, z / 48);
    const b = this.caveB.noise3(x / 48, y / 30, z / 48);
    const tunnel = 1 - Math.max(Math.abs(a), Math.abs(b)) * 7.5;
    // Cheese caverns deeper down.
    const deep = smoothstep(42, 18, y);
    const ch = this.caveC.noise3(x / 70, y / 36, z / 70) * 2.2 - 1.45 + deep * 0.35;
    return Math.max(tunnel, ch * deep);
  }

  /** Trilinearly interpolated cave density at any block (consistent across chunks). */
  caveDensity(x: number, y: number, z: number, cache?: Map<number, number>): number {
    const x0 = Math.floor(x / CAVE_STEP) * CAVE_STEP;
    const y0 = Math.floor(y / CAVE_STEP) * CAVE_STEP;
    const z0 = Math.floor(z / CAVE_STEP) * CAVE_STEP;
    const fx = (x - x0) / CAVE_STEP;
    const fy = (y - y0) / CAVE_STEP;
    const fz = (z - z0) / CAVE_STEP;
    const L = (dx: number, dy: number, dz: number): number => {
      const lx = x0 + dx * CAVE_STEP;
      const ly = y0 + dy * CAVE_STEP;
      const lz = z0 + dz * CAVE_STEP;
      if (!cache) return this.caveLattice(lx, ly, lz);
      // Key packs lattice coords; chunk-local cache, so range is small.
      const key = ((lx >> 2) & 0x3ff) * 1048576 + ((ly >> 2) & 0x3ff) * 1024 + ((lz >> 2) & 0x3ff);
      let v = cache.get(key);
      if (v === undefined) {
        v = this.caveLattice(lx, ly, lz);
        cache.set(key, v);
      }
      return v;
    };
    const c00 = lerp(L(0, 0, 0), L(1, 0, 0), fx);
    const c10 = lerp(L(0, 1, 0), L(1, 1, 0), fx);
    const c01 = lerp(L(0, 0, 1), L(1, 0, 1), fx);
    const c11 = lerp(L(0, 1, 1), L(1, 1, 1), fx);
    return lerp(lerp(c00, c10, fy), lerp(c01, c11, fy), fz);
  }

  /** Is the block at (x,y,z) carved out by caves or ravines? `top` is column height. */
  isCarved(x: number, y: number, z: number, top: number, cache?: Map<number, number>): boolean {
    if (y < 4 || y > top) return false;
    // Keep a solid cap under water so oceans/rivers don't drain into caves.
    if (top < SEA_LEVEL + 2 && y > top - 5) return false;
    if (this.caveDensity(x, y, z, cache) > 0) return true;
    // Ravines: long narrow cracks.
    const rn = Math.abs(this.ravine.noise2(x / 240, z / 240));
    if (rn < 0.012 && top >= SEA_LEVEL + 2) {
      const mask = this.ravine.noise2(x / 600 + 77, z / 600 - 33);
      if (mask > 0.45) {
        const depth = 14 + (1 - rn / 0.012) * 26;
        if (y > top - depth && y > 12) return true;
      }
    }
    return false;
  }

  /** Generate block data for a chunk. */
  generate(cx: number, cz: number): Uint8Array {
    const data = new Uint8Array(CHUNK_VOLUME);
    const bx = cx * CHUNK_SIZE;
    const bz = cz * CHUNK_SIZE;
    const cache = new Map<number, number>();
    const cols: ColumnInfo[] = new Array(CHUNK_SIZE * CHUNK_SIZE);
    const seed = this.seed;

    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      for (let lz = 0; lz < CHUNK_SIZE; lz++) {
        const wx = bx + lx;
        const wz = bz + lz;
        const col = this.column(wx, wz);
        cols[lx * CHUNK_SIZE + lz] = col;
        const { height, biome } = col;
        const base = blockIndex(lx, 0, lz);

        let top: number = B.GRASS;
        let filler: number = B.DIRT;
        let fillerDepth = 3 + Math.floor(hash2(seed, wx, wz, 7) * 2);
        let deepFiller: number = B.STONE;
        let deepDepth = 0;
        switch (biome) {
          case Biome.Desert:
            top = B.SAND; filler = B.SAND; deepFiller = B.SANDSTONE; deepDepth = 4; break;
          case Biome.Beach:
            top = col.temp < -0.32 ? B.GRAVEL : B.SAND; filler = B.SAND; deepFiller = B.SANDSTONE; deepDepth = 2; break;
          case Biome.Ocean:
          case Biome.River:
            top = height < SEA_LEVEL - 12 ? B.GRAVEL : hash2(seed, wx, wz, 3) < 0.2 ? B.DIRT : B.SAND;
            filler = B.SAND; fillerDepth = 2; break;
          case Biome.Mountains:
            if (height > 96) { top = B.SNOW_BLOCK; filler = B.STONE; }
            else if (height > 84) { top = B.STONE; filler = B.STONE; }
            else { top = B.GRASS; }
            break;
          case Biome.Snow:
          case Biome.Taiga:
            top = B.SNOW_GRASS; break;
          default:
            break;
        }

        for (let y = 0; y <= height; y++) {
          let id: number;
          if (y === 0) id = B.COREITE;
          else if (y <= 2 && hash3(seed, wx, y, wz, 11) < 0.5 - y * 0.15) id = B.COREITE;
          else if (y === height) id = top;
          else if (y > height - fillerDepth) id = filler;
          else if (y > height - fillerDepth - deepDepth) id = deepFiller;
          else id = B.STONE;
          data[base + y] = id;
        }
        // Carve caves (after layering so surfaces can open into caves on land).
        for (let y = 4; y <= height; y++) {
          if (this.isCarved(wx, y, wz, height, cache)) data[base + y] = B.AIR;
        }
        // Water fill.
        if (height < SEA_LEVEL) {
          for (let y = height + 1; y <= SEA_LEVEL; y++) {
            if (data[base + y] === B.AIR) data[base + y] = B.WATER;
          }
          if (col.temp < -0.45 && biome === Biome.Ocean) data[base + SEA_LEVEL] = B.ICE;
        }
        // Grass under a block becomes dirt (e.g. cave ceiling fixups aren't needed; only surface).
      }
    }

    this.placeOres(data, cx, cz);
    this.placePlants(data, cols, bx, bz);
    this.placeTrees(data, cx, cz);
    return data;
  }

  private placeOres(data: Uint8Array, cx: number, cz: number): void {
    const rand = mulberry32((hash2(this.seed, cx, cz, 99) * 4294967296) >>> 0);
    const veins: [number, number, number, number, number][] = [
      // id, veins per chunk, size, minY, maxY
      [B.EMBER_ORE, 16, 8, 5, 100],
      [B.COPPER_ORE, 9, 6, 5, 64],
      [B.IRON_ORE, 7, 5, 5, 46],
      [B.LUMEN_ORE, 2, 4, 3, 20],
    ];
    for (const [id, count, size, minY, maxY] of veins) {
      for (let v = 0; v < count; v++) {
        let x = Math.floor(rand() * CHUNK_SIZE);
        let y = minY + Math.floor(rand() * (maxY - minY));
        let z = Math.floor(rand() * CHUNK_SIZE);
        for (let s = 0; s < size; s++) {
          if (x >= 0 && x < CHUNK_SIZE && z >= 0 && z < CHUNK_SIZE && y > 0 && y < WORLD_HEIGHT) {
            const i = blockIndex(x, y, z);
            if (data[i] === B.STONE) data[i] = id;
          }
          const d = Math.floor(rand() * 6);
          if (d === 0) x++; else if (d === 1) x--; else if (d === 2) y++; else if (d === 3) y--; else if (d === 4) z++; else z--;
        }
      }
    }
  }

  private placePlants(data: Uint8Array, cols: ColumnInfo[], bx: number, bz: number): void {
    const seed = this.seed;
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      for (let lz = 0; lz < CHUNK_SIZE; lz++) {
        const col = cols[lx * CHUNK_SIZE + lz];
        const y = col.height + 1;
        if (y >= WORLD_HEIGHT) continue;
        const base = blockIndex(lx, 0, lz);
        const ground = data[base + y - 1];
        if (data[base + y] !== B.AIR) continue;
        const r = hash2(seed, bx + lx, bz + lz, 21);
        let plant = 0;
        if (ground === B.GRASS) {
          switch (col.biome) {
            case Biome.Plains:
              plant = r < 0.03 ? B.FLOWER_GOLD : r < 0.05 ? B.FLOWER_RED : r < 0.3 ? B.TALL_GRASS : 0; break;
            case Biome.Forest:
              plant = r < 0.012 ? B.BERRY_BUSH : r < 0.025 ? B.FLOWER_RED : r < 0.18 ? B.TALL_GRASS : 0; break;
            case Biome.DenseForest:
              plant = r < 0.02 ? B.BERRY_BUSH : r < 0.12 ? B.TALL_GRASS : 0; break;
            default:
              plant = r < 0.1 ? B.TALL_GRASS : 0;
          }
        } else if (ground === B.SAND && col.biome === Biome.Desert) {
          plant = r < 0.012 ? B.DRY_SHRUB : 0;
          if (r > 0.992) {
            // Cactus column (1-3 tall), only if fully surrounded by air at its height.
            const hgt = 1 + Math.floor(hash2(seed, bx + lx, bz + lz, 22) * 3);
            for (let k = 0; k < hgt && y + k < WORLD_HEIGHT; k++) data[base + y + k] = B.CACTUS;
            continue;
          }
        } else if (ground === B.SNOW_GRASS) {
          plant = r < (col.biome === Biome.Taiga ? 0.09 : 0.04) ? B.FERN : 0;
        }
        if (plant) data[base + y] = plant;
      }
    }
  }

  /** Decide whether a tree grows at the candidate in a tree cell. Pure → identical across chunks. */
  treeAt(cellX: number, cellZ: number): { x: number; z: number; y: number; kind: number; size: number } | null {
    const seed = this.seed;
    const x = cellX * TREE_CELL + Math.floor(hash2(seed, cellX, cellZ, 31) * TREE_CELL);
    const z = cellZ * TREE_CELL + Math.floor(hash2(seed, cellX, cellZ, 32) * TREE_CELL);
    const col = this.column(x, z);
    let density = 0;
    let kind = 0; // 0 ash, 1 pine, 2 shrub
    switch (col.biome) {
      case Biome.DenseForest: density = 0.8; kind = 0; break;
      case Biome.Forest: density = 0.42; kind = 0; break;
      case Biome.Taiga: density = 0.5; kind = 1; break;
      case Biome.Snow: density = 0.07; kind = 1; break;
      case Biome.Plains: density = 0.035; kind = 0; break;
      case Biome.Mountains: density = col.height < 86 ? 0.12 : 0; kind = 1; break;
      default: density = 0;
    }
    const roll = hash2(seed, cellX, cellZ, 33);
    if (roll >= density) return null;
    if (col.height <= SEA_LEVEL || col.height > WORLD_HEIGHT - 16) return null;
    // Reject steep spots (cliffs) — neighbors must be within 1 block.
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (Math.abs(this.column(x + dx, z + dz).height - col.height) > 1) return null;
    }
    // Reject if the ground under the trunk is carved (cave opening / ravine).
    if (this.isCarved(x, col.height, z, col.height) || this.isCarved(x, col.height - 1, z, col.height)) return null;
    if (col.biome === Biome.Mountains && col.height > 84) return null;
    const size = hash2(seed, cellX, cellZ, 34);
    if (kind === 0 && col.biome === Biome.Plains && size < 0.3) kind = 2;
    if (kind === 0 && col.biome === Biome.DenseForest && size > 0.85) kind = 2;
    return { x, z, y: col.height + 1, kind, size };
  }

  private placeTrees(data: Uint8Array, cx: number, cz: number): void {
    const bx = cx * CHUNK_SIZE;
    const bz = cz * CHUNK_SIZE;
    const R = 3;
    const c0x = Math.floor((bx - R) / TREE_CELL);
    const c1x = Math.floor((bx + CHUNK_SIZE + R) / TREE_CELL);
    const c0z = Math.floor((bz - R) / TREE_CELL);
    const c1z = Math.floor((bz + CHUNK_SIZE + R) / TREE_CELL);
    const set = (wx: number, y: number, wz: number, id: number, leaf: boolean) => {
      const lx = wx - bx;
      const lz = wz - bz;
      if (lx < 0 || lz < 0 || lx >= CHUNK_SIZE || lz >= CHUNK_SIZE || y < 1 || y >= WORLD_HEIGHT) return;
      const i = blockIndex(lx, y, lz);
      const cur = data[i];
      if (leaf) {
        if (cur === B.AIR || cur === B.TALL_GRASS || cur === B.FERN) data[i] = id;
      } else if (cur === B.AIR || cur === B.TALL_GRASS || cur === B.FERN || cur === B.ASH_LEAVES || cur === B.PINE_LEAVES ||
        cur === B.FLOWER_RED || cur === B.FLOWER_GOLD || cur === B.BERRY_BUSH) {
        data[i] = id;
      }
    };
    for (let gx = c0x; gx <= c1x; gx++) {
      for (let gz = c0z; gz <= c1z; gz++) {
        const t = this.treeAt(gx, gz);
        if (!t) continue;
        const { x, y, z } = t;
        const h = (k: number) => hash3(this.seed, x, k, z, 41);
        if (t.kind === 0) {
          const trunk = 4 + Math.floor(t.size * 3);
          for (let k = 0; k < trunk; k++) set(x, y + k, z, B.ASH_LOG, false);
          const topY = y + trunk;
          for (let dy = -2; dy <= 1; dy++) {
            const r = dy >= 0 ? 1 : 2;
            for (let dx = -r; dx <= r; dx++) {
              for (let dz = -r; dz <= r; dz++) {
                const corner = Math.abs(dx) === r && Math.abs(dz) === r;
                if (corner && (dy === 1 || h(dx * 7 + dz * 13 + dy * 31) < 0.6)) continue;
                set(x + dx, topY + dy, z + dz, B.ASH_LEAVES, true);
              }
            }
          }
          set(x, topY + 1, z, B.ASH_LEAVES, true);
        } else if (t.kind === 1) {
          const trunk = 6 + Math.floor(t.size * 4);
          for (let k = 0; k < trunk; k++) set(x, y + k, z, B.PINE_LOG, false);
          const top = y + trunk;
          set(x, top, z, B.PINE_LEAVES, true);
          set(x, top + 1, z, B.PINE_LEAVES, true);
          for (let yy = top - 1; yy >= y + 2; yy--) {
            const r = (top - 1 - yy) % 3 === 0 ? 1 : 2;
            for (let dx = -r; dx <= r; dx++) {
              for (let dz = -r; dz <= r; dz++) {
                if (Math.abs(dx) + Math.abs(dz) > r + 1) continue;
                set(x + dx, yy, z + dz, B.PINE_LEAVES, true);
              }
            }
          }
        } else {
          set(x, y, z, B.ASH_LOG, false);
          for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
              set(x + dx, y, z + dz, B.ASH_LEAVES, true);
              if (Math.abs(dx) + Math.abs(dz) <= 1) set(x + dx, y + 1, z + dz, B.ASH_LEAVES, true);
            }
          }
        }
      }
    }
  }

  /** Find a safe spawn column near the origin: dry land, preferably grassland, no carved ground. */
  findSpawn(): { x: number; z: number; y: number } {
    const good = (b: Biome) => b === Biome.Plains || b === Biome.Forest;
    const ok = (b: Biome) => b !== Biome.Mountains && b !== Biome.Ocean && b !== Biome.River && b !== Biome.Beach;
    for (const accept of [good, ok]) {
      for (let r = 0; r < 900; r += 6) {
        const steps = Math.max(1, Math.floor((2 * Math.PI * r) / 8));
        for (let s = 0; s < steps; s++) {
          const a = (s / steps) * Math.PI * 2;
          const x = Math.round(Math.cos(a) * r);
          const z = Math.round(Math.sin(a) * r);
          const c = this.column(x, z);
          if (c.height <= SEA_LEVEL + 1 || !accept(c.biome)) continue;
          if (this.isCarved(x, c.height, z, c.height)) continue;
          return { x: x + 0.5, z: z + 0.5, y: c.height + 1 };
        }
      }
    }
    const c = this.column(0, 0);
    return { x: 0.5, z: 0.5, y: Math.max(c.height, SEA_LEVEL) + 2 };
  }
}
