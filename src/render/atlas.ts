import { hash2, mulberry32 } from '../core/noise';
import { ATLAS_COLS, ATLAS_H, ATLAS_W, CELL_PX, TILE_NAMES, TILE_PAD, TILE_PX } from '../world/tiles';

type RGB = number[];

/** RGBA pixel buffer for one 16x16 tile. */
class Tile {
  px = new Uint8ClampedArray(TILE_PX * TILE_PX * 4);
  constructor(public rand: () => number, public seed: number) {}

  set(x: number, y: number, c: RGB, a = 255): void {
    if (x < 0 || y < 0 || x >= TILE_PX || y >= TILE_PX) return;
    const i = (y * TILE_PX + x) * 4;
    this.px[i] = c[0];
    this.px[i + 1] = c[1];
    this.px[i + 2] = c[2];
    this.px[i + 3] = a;
  }

  /** Set with wrap-around (for tileable patterns that cross the edge). */
  wset(x: number, y: number, c: RGB, a = 255): void {
    this.set(((x % 16) + 16) % 16, ((y % 16) + 16) % 16, c, a);
  }

  get(x: number, y: number): RGB {
    const i = (y * TILE_PX + x) * 4;
    return [this.px[i], this.px[i + 1], this.px[i + 2], this.px[i + 3]];
  }

  alpha(x: number, y: number): number {
    return this.px[(y * TILE_PX + x) * 4 + 3];
  }

  /** Multiply the color of a pixel (keeps alpha). */
  tint(x: number, y: number, k: number): void {
    if (x < 0 || y < 0 || x >= TILE_PX || y >= TILE_PX) return;
    const i = (y * TILE_PX + x) * 4;
    this.px[i] *= k;
    this.px[i + 1] *= k;
    this.px[i + 2] *= k;
  }

  fill(fn: (x: number, y: number) => RGB | null): void {
    for (let y = 0; y < TILE_PX; y++) for (let x = 0; x < TILE_PX; x++) {
      const c = fn(x, y);
      if (c) this.set(x, y, c, c.length > 3 ? c[3] : 255);
      else this.set(x, y, [0, 0, 0], 0);
    }
  }

  /** Fill with a base color and per-pixel random brightness variation. */
  noise(c: RGB, v: number, a = 255): void {
    for (let y = 0; y < TILE_PX; y++) for (let x = 0; x < TILE_PX; x++) this.set(x, y, jitter(c, v, this.rand), a);
  }

  specks(c: RGB, chance: number, v = 10): void {
    for (let y = 0; y < TILE_PX; y++) for (let x = 0; x < TILE_PX; x++) if (this.rand() < chance) this.set(x, y, jitter(c, v, this.rand));
  }

  clear(): void {
    this.px.fill(0);
  }

  /** Tileable fractal noise 0..1 for this tile (coherent, so it forms blotches rather than static). */
  fbm(x: number, y: number, salt = 0): number {
    return fbm(x, y, this.seed + salt * 101);
  }
}

function jitter(c: RGB, v: number, rand: () => number): RGB {
  const d = (rand() - 0.5) * 2 * v;
  return [c[0] + d, c[1] + d, c[2] + d];
}

function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function scale(c: RGB, k: number): RGB {
  return [c[0] * k, c[1] * k, c[2] * k];
}

/** Tileable value noise with `cells` lattice cells across the 16px tile. */
function vnoise(x: number, y: number, cells: number, seed: number): number {
  const s = TILE_PX / cells;
  const gx = (x + 0.5) / s - 0.5;
  const gy = (y + 0.5) / s - 0.5;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const fx = gx - x0;
  const fy = gy - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const g = (i: number, j: number) => hash2(seed, ((i % cells) + cells) % cells, ((j % cells) + cells) % cells, cells);
  const a = g(x0, y0) + (g(x0 + 1, y0) - g(x0, y0)) * sx;
  const b = g(x0, y0 + 1) + (g(x0 + 1, y0 + 1) - g(x0, y0 + 1)) * sx;
  return a + (b - a) * sy;
}

function fbm(x: number, y: number, seed: number): number {
  return vnoise(x, y, 2, seed) * 0.35 + vnoise(x, y, 4, seed + 7) * 0.35 + vnoise(x, y, 8, seed + 13) * 0.2 + vnoise(x, y, 16, seed + 29) * 0.1;
}

/** Pick a palette step from t in 0..1 (posterized pixel-art shading). */
function ramp(t: number, pal: RGB[]): RGB {
  const i = Math.max(0, Math.min(pal.length - 1, Math.floor(t * pal.length)));
  return pal[i];
}

/** Ordered 4x4 dither offsets in -0.5..0.5 to soften palette banding. */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => v / 16 - 0.47);
const dither = (x: number, y: number, k: number) => BAYER[(y & 3) * 4 + (x & 3)] * k;

/** Natural material: coherent noise mapped through a palette, lightly dithered. */
function natural(t: Tile, pal: RGB[], contrast = 1.25, salt = 0, d = 0.12): void {
  t.fill((x, y) => {
    const n = (t.fbm(x, y, salt) - 0.5) * contrast + 0.5 + dither(x, y, d);
    return ramp(n, pal);
  });
}

/** Light top-left / dark bottom-right rim for crafted blocks, so they read as chunky cubes. */
function bevel(t: Tile, hi = 1.12, lo = 0.78): void {
  for (let i = 0; i < 16; i++) {
    t.tint(i, 0, hi);
    t.tint(0, i, hi);
    t.tint(i, 15, lo);
    t.tint(15, i, lo);
  }
}

/** Gem or pebble with a highlight and a shadow, the main readability trick for ores. */
function gem(t: Tile, cx: number, cy: number, pal: RGB[], size: number): void {
  for (let dy = -size; dy <= size; dy++) for (let dx = -size; dx <= size; dx++) {
    const d = Math.abs(dx) + Math.abs(dy) * 1.1;
    if (d > size + 0.3) continue;
    const c = dx + dy < -size * 0.4 ? pal[2] : dx + dy > size * 0.5 ? pal[0] : pal[1];
    t.set(cx + dx, cy + dy, c);
  }
  t.set(cx - Math.ceil(size / 2), cy - Math.ceil(size / 2), pal[3] ?? pal[2]);
}

// Palettes — BlockForge's own warm, slightly desaturated look (dark → light).
const PAL = {
  dirt: [[82, 56, 38], [100, 68, 46], [118, 82, 56], [134, 96, 66], [150, 110, 76]],
  grass: [[62, 108, 48], [76, 128, 56], [92, 146, 64], [108, 162, 72], [130, 180, 84]],
  stone: [[92, 92, 98], [108, 108, 114], [122, 122, 128], [136, 136, 142], [152, 152, 158]],
  sand: [[196, 174, 120], [208, 188, 134], [220, 202, 148], [230, 214, 162], [240, 226, 180]],
  snow: [[200, 212, 228], [216, 226, 238], [230, 238, 246], [240, 246, 252]],
  gravel: [[78, 72, 70], [100, 94, 90], [122, 116, 110], [146, 140, 134], [166, 160, 154]],
  leaves: [[38, 82, 40], [52, 104, 48], [68, 128, 58], [88, 150, 70], [116, 172, 86]],
  pine: [[26, 64, 52], [34, 80, 62], [44, 96, 72], [58, 114, 84], [78, 132, 96]],
  planks: [[132, 94, 56], [150, 110, 66], [168, 126, 78], [186, 142, 90], [200, 158, 102]],
  cinder: [[78, 28, 28], [98, 36, 34], [116, 44, 40], [134, 56, 48], [150, 70, 58]],
  ash: [[66, 54, 50], [80, 66, 60], [94, 80, 72], [110, 94, 84], [126, 108, 96]],
  basalt: [[44, 44, 50], [56, 56, 62], [68, 68, 74], [82, 82, 88], [96, 96, 102]],
  dusk: [[20, 14, 32], [30, 20, 46], [40, 28, 60], [54, 38, 78], [70, 52, 100]],
  voidstone: [[196, 194, 150], [210, 208, 164], [222, 220, 176], [232, 230, 190], [242, 240, 204]],
  magma: [[150, 40, 10], [200, 70, 16], [236, 112, 26], [252, 160, 48], [255, 214, 110]],
};

function stoneBase(t: Tile, pal: RGB[] = PAL.stone): void {
  natural(t, pal, 1.4, 0, 0.18);
  // Fine cracks: short dark strokes that wander.
  for (let k = 0; k < 4; k++) {
    let x = Math.floor(t.rand() * 16);
    let y = Math.floor(t.rand() * 16);
    const len = 2 + Math.floor(t.rand() * 4);
    for (let i = 0; i < len; i++) {
      t.wset(x, y, scale(pal[0], 0.92));
      x += t.rand() < 0.7 ? 1 : 0;
      y += t.rand() < 0.45 ? 1 : t.rand() < 0.2 ? -1 : 0;
    }
  }
}

function drawOre(t: Tile, gemPal: RGB[], clusters: number, base: RGB[] = PAL.stone): void {
  stoneBase(t, base);
  const spots: [number, number][] = [];
  for (let k = 0; k < clusters * 3 && spots.length < clusters; k++) {
    const cx = 2 + Math.floor(t.rand() * 12);
    const cy = 2 + Math.floor(t.rand() * 12);
    if (spots.some(([a, b]) => Math.abs(a - cx) + Math.abs(b - cy) < 5)) continue;
    spots.push([cx, cy]);
  }
  for (const [cx, cy] of spots) {
    // Dark socket under the gem so it pops out of the stone.
    for (let dy = -1; dy <= 2; dy++) for (let dx = -1; dx <= 2; dx++) if (Math.abs(dx - 0.5) + Math.abs(dy - 0.5) < 2.2) t.tint(cx + dx, cy + dy, 0.72);
    gem(t, cx, cy, gemPal, 1 + (t.rand() < 0.4 ? 1 : 0));
  }
}

function plantBlades(t: Tile, base: RGB, count: number, maxH: number): void {
  t.clear();
  for (let k = 0; k < count; k++) {
    let x = 1 + Math.floor(t.rand() * 14);
    const h = 5 + Math.floor(t.rand() * maxH);
    for (let i = 0; i < h; i++) {
      const lit = i / h;
      t.set(x, 15 - i, jitter(mix(scale(base, 0.75), mix(base, [200, 230, 130], 0.4), lit), 6, t.rand));
      if (i > h / 2 && t.rand() < 0.3) x += t.rand() < 0.5 ? -1 : 1;
    }
  }
}

function logSide(t: Tile, bark: RGB, dark: RGB): void {
  // Vertical grooves that wander a little, with knots.
  const groove = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0].map(() => t.rand());
  t.fill((x, y) => {
    const n = vnoise(x * 3, y, 4, t.seed + 3);
    const g = groove[x] < 0.28 || (groove[(x + 1) % 16] < 0.12 && n > 0.6);
    const base = g ? dark : mix(bark, dark, (1 - n) * 0.35);
    return scale(base, 0.94 + dither(x, y, 0.12) + (x % 5 === 0 ? -0.05 : 0));
  });
  for (let k = 0; k < 2; k++) {
    const x = 2 + Math.floor(t.rand() * 12);
    const y = 2 + Math.floor(t.rand() * 11);
    t.set(x, y, scale(dark, 0.8)); t.set(x + 1, y, scale(dark, 0.8)); t.set(x, y + 1, scale(dark, 0.7)); t.set(x + 1, y + 1, dark);
  }
}

function logTop(t: Tile, bark: RGB, wood: RGB): void {
  const wob = t.seed % 7;
  t.fill((x, y) => {
    const dx = x - 7.5;
    const dy = y - 7.5;
    const r = Math.sqrt(dx * dx + dy * dy) + vnoise(x, y, 4, t.seed + wob) * 0.9;
    if (Math.max(Math.abs(dx), Math.abs(dy)) > 6.6) return scale(bark, 0.92 + dither(x, y, 0.15));
    const ring = Math.floor(r * 0.9) % 2 === 0;
    return scale(ring ? wood : mix(wood, bark, 0.4), 0.96 + dither(x, y, 0.08) + (r < 1.2 ? -0.08 : 0));
  });
}

function leaves(t: Tile, pal: RGB[], holes: number): void {
  // Clumps of leaves with a bright upper-left edge and dark interior gaps.
  t.fill((x, y) => {
    const n = t.fbm(x, y, 5);
    if (hash2(t.seed, x, y, 3) < holes * (1.2 - n)) return null;
    return ramp(n * 1.1 + dither(x, y, 0.25), pal);
  });
  for (let k = 0; k < 14; k++) {
    const x = Math.floor(t.rand() * 15);
    const y = Math.floor(t.rand() * 15);
    if (t.alpha(x, y) === 0) continue;
    t.set(x, y, pal[pal.length - 1]);
    if (t.alpha(x + 1, y + 1) > 0) t.set(x + 1, y + 1, pal[0]);
  }
}

function bricks(t: Tile, base: RGB, mortar: RGB, bw = 8, bh = 4): void {
  for (let y = 0; y < 16; y++) {
    const row = Math.floor(y / bh);
    const off = row % 2 === 0 ? 0 : bw / 2;
    const ry = y % bh;
    for (let x = 0; x < 16; x++) {
      const rx = (x + off) % bw;
      const isMortar = ry === bh - 1 || rx === bw - 1;
      if (isMortar) {
        t.set(x, y, jitter(mortar, 3, t.rand));
        continue;
      }
      const brick = Math.floor((x + off) / bw) + row * 3;
      const tone = 0.9 + hash2(t.seed, brick, row, 9) * 0.16;
      // Each brick is lit on its top/left edge and shaded on the bottom/right one.
      const edge = ry === 0 || rx === 0 ? 1.12 : ry === bh - 2 || rx === bw - 2 ? 0.86 : 1;
      t.set(x, y, scale(base, tone * edge + dither(x, y, 0.06)));
    }
  }
}

function planks(t: Tile): void {
  const pal = PAL.planks;
  for (let y = 0; y < 16; y++) {
    const board = Math.floor(y / 4);
    const ry = y % 4;
    for (let x = 0; x < 16; x++) {
      const endSeam = (x + board * 5) % 16 === 0;
      if (ry === 3 || endSeam) { t.set(x, y, scale(pal[0], 0.85)); continue; }
      const grain = vnoise(x, y * 4 + board * 3, 4, t.seed + board) * 0.8 + (ry === 0 ? 0.25 : 0);
      t.set(x, y, ramp(0.25 + grain * 0.75 + dither(x, y, 0.15), pal));
    }
    if (ry === 1) {
      // Nails at board ends.
      const nx = ((16 - board * 5) % 16 + 16) % 16;
      t.set((nx + 1) % 16, y, [78, 66, 58]);
      t.set((nx + 14) % 16, y, [78, 66, 58]);
    }
  }
}

/** Radiating crack pattern; each stage extends the previous one (deterministic). */
function crack(t: Tile, stage: number): void {
  t.clear();
  const r = mulberry32(777);
  const arms = 7;
  const total = (stage + 1) / 10;
  const dark: RGB = [16, 12, 10];
  for (let a = 0; a < arms; a++) {
    let x = 7.5 + (r() - 0.5) * 2;
    let y = 7.5 + (r() - 0.5) * 2;
    const ang = (a / arms) * Math.PI * 2 + r() * 0.6;
    const len = (5 + r() * 5) * total * 1.15;
    let dir = ang;
    for (let i = 0; i < len; i++) {
      t.set(Math.round(x), Math.round(y), dark, 225);
      // Paler chipped edge next to each crack pixel.
      const ex = Math.round(x + Math.cos(dir + 1.57));
      const ey = Math.round(y + Math.sin(dir + 1.57));
      if (ex >= 0 && ey >= 0 && ex < 16 && ey < 16 && t.alpha(ex, ey) === 0) t.set(ex, ey, [255, 255, 255], 46);
      dir += (r() - 0.5) * 0.9;
      x += Math.cos(dir);
      y += Math.sin(dir);
      // Side branches at later stages.
      if (stage > 3 && r() < 0.12) {
        let bx = x, by = y;
        const bd = dir + (r() < 0.5 ? 1 : -1) * 1.1;
        for (let j = 0; j < 2 + stage / 3; j++) {
          bx += Math.cos(bd); by += Math.sin(bd);
          t.set(Math.round(bx), Math.round(by), dark, 200);
        }
      }
    }
  }
  if (stage >= 6) {
    // Crumbling: darken small chunks near the center.
    for (let k = 0; k < (stage - 5) * 5; k++) {
      const x = 4 + Math.floor(r() * 8);
      const y = 4 + Math.floor(r() * 8);
      t.set(x, y, [10, 8, 6], 150);
    }
  }
}

function grassTopInto(t: Tile, pal: RGB[]): void {
  natural(t, pal, 1.3, 2, 0.2);
  // Short blade marks with a light tip.
  for (let k = 0; k < 22; k++) {
    const x = Math.floor(t.rand() * 16);
    const y = Math.floor(t.rand() * 16);
    t.wset(x, y, pal[pal.length - 1]);
    t.wset(x, y + 1, pal[1]);
  }
}

function overhang(t: Tile, top: RGB[], depthMin: number, edge: RGB): void {
  for (let x = 0; x < 16; x++) {
    const d = depthMin + Math.floor(vnoise(x, 0, 8, t.seed + 21) * 3) + (hash2(t.seed, x, 0, 4) < 0.18 ? 2 : 0);
    for (let y = 0; y < d; y++) t.set(x, y, y === d - 1 ? edge : ramp(0.35 + vnoise(x, y, 8, t.seed) * 0.6 - y * 0.06 + dither(x, y, 0.2), top));
    t.tint(x, d, 0.82); // shadow under the overhang
  }
}

const painters: Record<string, (t: Tile) => void> = {
  none: (t) => t.clear(),
  dirt: (t) => {
    natural(t, PAL.dirt, 1.35, 0, 0.2);
    for (let k = 0; k < 5; k++) gem(t, 1 + Math.floor(t.rand() * 14), 1 + Math.floor(t.rand() * 14), [[86, 66, 54], [118, 96, 80], [144, 124, 104], [160, 140, 120]], 0);
  },
  grass_top: (t) => grassTopInto(t, PAL.grass),
  grass_side: (t) => {
    painters.dirt(t);
    overhang(t, PAL.grass, 3, scale(PAL.grass[0], 0.9));
  },
  stone: (t) => stoneBase(t),
  rubble: (t) => {
    // Cobbles: rounded stones with lit tops separated by dark mortar.
    t.fill((x, y) => scale(PAL.stone[0], 0.7 + dither(x, y, 0.1)));
    for (let k = 0; k < 11; k++) {
      const cx = Math.floor(t.rand() * 16);
      const cy = Math.floor(t.rand() * 16);
      const rx = 2 + t.rand() * 2.2;
      const ry = 1.6 + t.rand() * 1.6;
      const tone = 0.85 + t.rand() * 0.3;
      for (let y = -4; y <= 4; y++) for (let x = -4; x <= 4; x++) {
        const d = (x * x) / (rx * rx) + (y * y) / (ry * ry);
        if (d > 1) continue;
        const lit = y < -ry * 0.3 ? 1.15 : y > ry * 0.4 ? 0.82 : 1;
        t.wset(cx + x, cy + y, scale(PAL.stone[2], tone * lit + dither(x, y, 0.08)));
      }
    }
  },
  sand: (t) => {
    t.fill((x, y) => {
      const ripple = Math.sin((y + vnoise(x, y, 4, t.seed) * 3) * 1.4) * 0.12;
      return ramp(t.fbm(x, y) * 0.8 + 0.1 + ripple + dither(x, y, 0.22), PAL.sand);
    });
  },
  sandstone: (t) => {
    t.fill((x, y) => {
      const band = y < 3 ? 0.85 : y % 5 === 0 ? 0.15 : 0.55;
      return ramp(band + (vnoise(x, y, 8, t.seed) - 0.5) * 0.3 + dither(x, y, 0.15), [[188, 164, 112], [200, 178, 124], [212, 190, 136], [224, 204, 150]]);
    });
    bevel(t, 1.06, 0.88);
  },
  sandstone_top: (t) => { natural(t, [[198, 176, 124], [210, 190, 136], [218, 198, 144], [228, 210, 158]], 1.2); bevel(t, 1.06, 0.9); },
  gravel: (t) => {
    t.fill((x, y) => scale(PAL.gravel[1], 0.85 + dither(x, y, 0.15)));
    for (let k = 0; k < 20; k++) gem(t, Math.floor(t.rand() * 16), Math.floor(t.rand() * 16), PAL.gravel.slice(t.rand() < 0.5 ? 0 : 1), t.rand() < 0.3 ? 1 : 0);
  },
  snow: (t) => { natural(t, PAL.snow, 1.1, 0, 0.18); t.specks([255, 255, 255], 0.04, 0); },
  snow_side: (t) => {
    painters.dirt(t);
    overhang(t, PAL.snow, 4, PAL.snow[0]);
  },
  ice: (t) => {
    t.fill((x, y) => [...mix([150, 196, 236], [196, 226, 250], vnoise(x, y, 4, t.seed)), 190]);
    for (let k = 0; k < 3; k++) {
      const x0 = Math.floor(t.rand() * 16);
      for (let i = 0; i < 7; i++) t.wset(x0 + i, k * 5 + i, [236, 248, 255], 225);
    }
  },
  water: (t) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const w = vnoise(x, y, 4, t.seed) * 0.6 + Math.sin((x + y * 0.5) * 0.8) * 0.2 + 0.2;
      t.set(x, y, mix([34, 86, 164], [76, 146, 214], w), 175);
    }
  },
  ash_log: (t) => logSide(t, [140, 122, 102], [96, 82, 66]),
  ash_log_top: (t) => logTop(t, [128, 110, 92], [210, 180, 130]),
  ash_leaves: (t) => leaves(t, PAL.leaves, 0.2),
  pine_log: (t) => logSide(t, [96, 68, 48], [64, 44, 30]),
  pine_log_top: (t) => logTop(t, [86, 60, 42], [184, 142, 94]),
  pine_leaves: (t) => leaves(t, PAL.pine, 0.24),
  planks: (t) => planks(t),
  ember_ore: (t) => drawOre(t, [[30, 22, 22], [60, 40, 36], [150, 56, 30], [236, 120, 50]], 5),
  copper_ore: (t) => drawOre(t, [[150, 76, 40], [206, 116, 62], [236, 160, 100], [96, 190, 150]], 4),
  iron_ore: (t) => drawOre(t, [[170, 130, 106], [212, 172, 146], [236, 208, 186], [255, 240, 226]], 4),
  lumen_ore: (t) => drawOre(t, [[70, 150, 200], [120, 230, 255], [210, 250, 255], [255, 255, 255]], 4),
  coreite: (t) => {
    natural(t, [[18, 16, 24], [30, 26, 38], [44, 38, 56], [60, 46, 80]], 1.6, 0, 0.2);
    t.specks([100, 60, 140], 0.05, 6);
  },
  cactus_side: (t) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const edge = x === 0 || x === 15;
      if (edge) { t.set(x, y, [0, 0, 0], 0); continue; }
      const rib = x % 4 === 2;
      const shade = x < 4 ? 1.08 : x > 11 ? 0.84 : 1;
      t.set(x, y, scale(rib ? [74, 146, 72] : [52, 114, 56], shade + dither(x, y, 0.08)));
    }
    for (let k = 0; k < 8; k++) t.set(1 + Math.floor(t.rand() * 14), Math.floor(t.rand() * 16), [236, 232, 196]);
  },
  cactus_top: (t) => {
    t.fill((x, y) => {
      if (x === 0 || y === 0 || x === 15 || y === 15) return null;
      const r = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
      return scale([62, 128, 62], r > 5.5 ? 0.85 : r < 2 ? 1.15 : 1);
    });
    t.set(7, 7, [210, 220, 150]); t.set(8, 8, [210, 220, 150]);
  },
  tall_grass: (t) => plantBlades(t, [86, 150, 62], 10, 7),
  fern: (t) => {
    plantBlades(t, [96, 140, 120], 6, 6);
    for (let k = 0; k < 10; k++) t.set(Math.floor(t.rand() * 16), 6 + Math.floor(t.rand() * 10), [220, 236, 240]);
  },
  flower_red: (t) => {
    plantBlades(t, [70, 130, 56], 3, 3);
    const cx = 7, cy = 5;
    for (const [dx, dy] of [[0, -1], [-1, 0], [1, 0], [0, 1], [-1, -1], [1, 1], [1, -1], [-1, 1]]) t.set(cx + dx, cy + dy, dx + dy < 0 ? [236, 84, 70] : [190, 44, 44]);
    t.set(cx, cy, [250, 210, 90]);
    for (let y = cy + 2; y < 16; y++) t.set(cx, y, [64, 120, 50]);
    t.set(cx + 1, 11, [84, 150, 62]); t.set(cx + 2, 10, [84, 150, 62]);
  },
  flower_gold: (t) => {
    plantBlades(t, [70, 130, 56], 3, 3);
    const cx = 8, cy = 6;
    for (const [dx, dy] of [[0, -1], [-1, 0], [1, 0], [0, 1]]) t.set(cx + dx, cy + dy, dy < 0 || dx < 0 ? [255, 214, 80] : [230, 170, 40]);
    t.set(cx, cy, [160, 90, 30]);
    for (let y = cy + 2; y < 16; y++) t.set(cx, y, [64, 120, 50]);
  },
  berry_bush: (t) => {
    t.clear();
    for (let y = 4; y < 16; y++) for (let x = 1; x < 15; x++) {
      const dx = x - 7.5, dy = (y - 10) * 1.2;
      if (dx * dx + dy * dy < 40 && hash2(t.seed, x, y, 1) > 0.15) t.set(x, y, ramp(vnoise(x, y, 4, t.seed) + (y < 8 ? 0.25 : 0), PAL.leaves));
    }
    for (let k = 0; k < 7; k++) {
      const x = 3 + Math.floor(t.rand() * 10), y = 6 + Math.floor(t.rand() * 8);
      t.set(x, y, [226, 60, 90]); t.set(x + 1, y, [160, 30, 54]); t.set(x, y + 1, [140, 24, 46]);
    }
  },
  dry_shrub: (t) => {
    t.clear();
    for (let k = 0; k < 6; k++) {
      let x = 8;
      for (let y = 15; y > 5 + Math.floor(t.rand() * 4); y--) {
        t.set(x, y, y < 9 ? [160, 124, 82] : [130, 96, 60]);
        if (t.rand() < 0.4) x += t.rand() < 0.5 ? -1 : 1;
      }
    }
  },
  bench_top: (t) => {
    planks(t);
    for (let i = 0; i < 16; i++) { t.set(i, 0, [90, 62, 40]); t.set(i, 15, [90, 62, 40]); t.set(0, i, [90, 62, 40]); t.set(15, i, [90, 62, 40]); }
    for (let y = 4; y < 12; y++) for (let x = 4; x < 12; x++) t.set(x, y, scale([112, 112, 120], (x === 4 || y === 4 ? 1.15 : x === 11 || y === 11 ? 0.8 : 1) + dither(x, y, 0.06)));
    for (let i = 5; i < 11; i++) { t.set(i, 7, [70, 70, 76]); t.set(7, i, [70, 70, 76]); }
  },
  bench_side: (t) => {
    planks(t);
    // Anvil silhouette — the bench's identity mark.
    for (let x = 3; x < 13; x++) t.set(x, 4, [96, 98, 108]);
    for (let x = 4; x < 12; x++) t.set(x, 5, [80, 82, 90]);
    for (let x = 6; x < 10; x++) for (let y = 6; y < 9; y++) t.set(x, y, [72, 74, 82]);
    for (let x = 5; x < 11; x++) t.set(x, 9, [60, 62, 70]);
    for (let y = 10; y < 16; y++) { t.set(2, y, [90, 62, 40]); t.set(13, y, [90, 62, 40]); }
    bevel(t);
  },
  kiln_top: (t) => { bricks(t, [150, 92, 72], [92, 84, 80], 8, 4); for (let y = 6; y < 10; y++) for (let x = 6; x < 10; x++) t.set(x, y, [36, 30, 30]); },
  kiln_front: (t) => {
    bricks(t, [150, 92, 72], [92, 84, 80], 8, 4);
    for (let y = 7; y < 14; y++) for (let x = 4; x < 12; x++) {
      const glow = y > 10 ? mix([255, 120, 30], [255, 220, 120], vnoise(x, y, 8, t.seed)) : [34, 26, 24];
      t.set(x, y, glow);
    }
    for (let x = 3; x < 13; x++) t.set(x, 6, [70, 64, 62]);
  },
  glass: (t) => {
    t.clear();
    for (let i = 0; i < 16; i++) {
      t.set(i, 0, [214, 238, 246], 235); t.set(i, 15, [170, 200, 214], 235);
      t.set(0, i, [214, 238, 246], 235); t.set(15, i, [170, 200, 214], 235);
    }
    for (let y = 1; y < 15; y++) for (let x = 1; x < 15; x++) t.set(x, y, [200, 230, 245], 36);
    for (let i = 0; i < 4; i++) { t.set(3 + i, 3 + i, [255, 255, 255], 200); t.set(4 + i, 3 + i, [255, 255, 255], 150); t.set(10 + i / 2, 9 + i, [255, 255, 255], 110); }
  },
  slate_bricks: (t) => bricks(t, [96, 104, 120], [50, 54, 64], 8, 4),
  // Torch: drawn on a full tile; the shaped mesh shows the middle 2px column via box uvs.
  torch: (t) => {
    t.clear();
    for (let y = 6; y < 16; y++) for (let x = 7; x < 9; x++) t.set(x, y, x === 7 ? [140, 102, 62] : [110, 80, 48]);
    for (let y = 2; y < 6; y++) for (let x = 7; x < 9; x++) t.set(x, y, y < 4 ? [255, 236, 150] : [255, 150, 50]);
    // Fill the rest so face uvs sampling outside the column still show wood/flame colors.
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (x < 7 || x > 8) t.set(x, y, y < 6 ? [255, 190, 80] : [128, 92, 56]);
  },
  torch_top: (t) => { t.noise([255, 200, 90], 20); t.set(7, 7, [255, 250, 200]); t.set(8, 8, [255, 250, 200]); },
  door_lower: (t) => {
    planks(t);
    for (let i = 0; i < 16; i++) { t.set(i, 15, [90, 62, 40]); t.set(0, i, [90, 62, 40]); t.set(15, i, [90, 62, 40]); }
    for (let y = 3; y < 13; y++) { t.set(4, y, [110, 76, 46]); t.set(11, y, [110, 76, 46]); }
    t.set(12, 1, [60, 60, 66]); t.set(12, 2, [200, 200, 210]); t.set(13, 2, [60, 60, 66]);
  },
  door_upper: (t) => {
    planks(t);
    for (let i = 0; i < 16; i++) { t.set(i, 0, [90, 62, 40]); t.set(0, i, [90, 62, 40]); t.set(15, i, [90, 62, 40]); }
    // Window panes.
    for (let y = 3; y < 10; y++) for (let x = 3; x < 13; x++) {
      const frame = x === 7 || x === 8 || y === 6;
      t.set(x, y, frame ? [110, 76, 46] : [0, 0, 0], frame ? 255 : 0);
    }
  },
  lumen_lamp: (t) => {
    t.fill((x, y) => mix([120, 220, 250], [230, 255, 255], vnoise(x, y, 4, t.seed)));
    for (let i = 0; i < 16; i++) { t.set(i, 0, [60, 70, 90]); t.set(i, 15, [50, 58, 76]); t.set(0, i, [60, 70, 90]); t.set(15, i, [50, 58, 76]); }
    for (let i = 3; i < 13; i++) { t.set(i, i, [240, 255, 255]); t.set(15 - i, i, [210, 170, 255]); }
  },

  // ---- Emberdeep ----
  cinderrock: (t) => {
    natural(t, PAL.cinder, 1.5, 0, 0.22);
    for (let k = 0; k < 6; k++) t.set(Math.floor(t.rand() * 16), Math.floor(t.rand() * 16), [174, 86, 64]);
    for (let k = 0; k < 5; k++) t.set(Math.floor(t.rand() * 16), Math.floor(t.rand() * 16), [56, 18, 20]);
  },
  ashen_sand: (t) => {
    natural(t, PAL.ash, 1.4, 0, 0.22);
    // Faint hollow-eyed swirls give it an eerie texture.
    for (let k = 0; k < 3; k++) {
      const x = 2 + Math.floor(t.rand() * 11);
      const y = 2 + Math.floor(t.rand() * 11);
      t.set(x, y, [48, 38, 36]); t.set(x + 2, y, [48, 38, 36]); t.set(x + 1, y + 2, [52, 42, 40]);
    }
  },
  glowcap: (t) => {
    natural(t, [[150, 96, 40], [200, 140, 56], [236, 188, 86], [252, 222, 130], [255, 244, 190]], 1.6, 0, 0.25);
    for (let k = 0; k < 6; k++) gem(t, 2 + Math.floor(t.rand() * 12), 2 + Math.floor(t.rand() * 12), [[230, 160, 60], [255, 220, 120], [255, 250, 210], [255, 255, 255]], 1);
  },
  magma: (t) => {
    t.fill((x, y) => {
      const n = t.fbm(x, y, 3);
      const vein = Math.abs(vnoise(x, y, 4, t.seed + 50) - 0.5) < 0.07;
      return ramp(vein ? 0.95 : n * 0.9 + dither(x, y, 0.15), PAL.magma);
    });
  },
  basalt_top: (t) => {
    t.fill((x, y) => {
      const r = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
      const ring = r > 6.5 ? 0.75 : r > 4.5 ? 0.95 : 1.05;
      return scale(ramp(vnoise(x, y, 4, t.seed) + dither(x, y, 0.2), PAL.basalt), ring);
    });
  },
  basalt_side: (t) => {
    t.fill((x, y) => {
      const col = Math.floor((x + 1) / 4);
      const n = vnoise(col * 4, y * 2, 4, t.seed);
      const groove = (x + 1) % 4 === 0;
      return scale(ramp(n + dither(x, y, 0.2), PAL.basalt), groove ? 0.7 : x % 4 === 0 ? 1.12 : 1);
    });
  },
  duskstone: (t) => {
    natural(t, PAL.dusk, 1.6, 0, 0.2);
    // Faint violet glints.
    for (let k = 0; k < 7; k++) t.set(Math.floor(t.rand() * 16), Math.floor(t.rand() * 16), [120, 90, 170]);
  },
  rift: (t) => {
    t.fill((x, y) => {
      const sw = vnoise(x, y, 4, t.seed) * 0.6 + vnoise(x, y, 8, t.seed + 5) * 0.4;
      const band = Math.sin((x * 0.6 + y * 0.9) + sw * 6) * 0.5 + 0.5;
      return mix([70, 20, 140], [210, 120, 255], band * 0.8 + sw * 0.2);
    });
    t.specks([255, 220, 255], 0.03, 0);
  },
  quartz_ore: (t) => drawOre(t, [[180, 168, 160], [226, 218, 208], [250, 246, 240], [255, 255, 255]], 5, PAL.cinder),
  ember_stalk: (t) => logSide(t, [120, 40, 52], [78, 22, 34]),
  ember_stalk_top: (t) => logTop(t, [104, 34, 46], [196, 90, 70]),
  ember_cap: (t) => {
    natural(t, [[120, 24, 26], [150, 34, 32], [180, 50, 40], [206, 72, 50], [230, 110, 70]], 1.4, 0, 0.22);
    for (let k = 0; k < 9; k++) t.set(Math.floor(t.rand() * 16), Math.floor(t.rand() * 16), [255, 186, 90]);
  },
  ember_sprout: (t) => {
    plantBlades(t, [170, 50, 46], 6, 6);
    for (let k = 0; k < 4; k++) t.set(3 + Math.floor(t.rand() * 10), 4 + Math.floor(t.rand() * 5), [255, 170, 70]);
  },
  cinder_bricks: (t) => bricks(t, [120, 42, 40], [44, 18, 18], 8, 4),

  // ---- Voidreach ----
  voidstone: (t) => {
    natural(t, PAL.voidstone, 1.3, 0, 0.2);
    for (let k = 0; k < 6; k++) gem(t, Math.floor(t.rand() * 16), Math.floor(t.rand() * 16), [[170, 166, 120], [190, 188, 140], [214, 212, 166], [236, 234, 190]], 0);
  },
  void_bricks: (t) => bricks(t, [222, 218, 172], [150, 144, 110], 8, 4),
  void_stalk: (t) => {
    t.fill((x, y) => {
      if (x < 3 || x > 12) return null;
      const lit = x < 6 ? 1.15 : x > 9 ? 0.8 : 1;
      return scale(mix([120, 80, 140], [170, 120, 180], vnoise(x, y, 4, t.seed)), lit + dither(x, y, 0.08));
    });
  },
  void_stalk_top: (t) => {
    t.fill((x, y) => (x < 3 || x > 12 || y < 3 || y > 12 ? null : mix([140, 96, 160], [196, 150, 210], vnoise(x, y, 4, t.seed))));
  },
  void_bloom: (t) => {
    t.fill((x, y) => {
      const d = Math.abs(x - 7.5) + Math.abs(y - 7.5);
      if (d > 8.5) return null;
      return d < 3 ? [250, 220, 255] : mix([170, 90, 210], [220, 160, 250], vnoise(x, y, 4, t.seed));
    });
  },
  void_gate_side: (t) => {
    t.fill((x, y) => {
      const edge = x < 2 || x > 13 || y < 2 || y > 13;
      if (edge) return scale(PAL.dusk[3], x < 2 || y < 2 ? 1.2 : 0.8);
      return mix([20, 10, 40], [80, 40, 140], vnoise(x, y, 4, t.seed));
    });
    for (let k = 0; k < 10; k++) t.set(2 + Math.floor(t.rand() * 12), 2 + Math.floor(t.rand() * 12), [230, 210, 255]);
    t.set(7, 7, [140, 255, 220]); t.set(8, 8, [140, 255, 220]); t.set(7, 8, [60, 200, 160]); t.set(8, 7, [60, 200, 160]);
  },
  void_gate_top: (t) => {
    t.fill((x, y) => {
      const r = Math.hypot(x - 7.5, y - 7.5);
      if (r > 7) return PAL.dusk[2];
      return mix([10, 6, 24], [120, 60, 200], Math.max(0, 1 - r / 7) * vnoise(x, y, 8, t.seed));
    });
    t.specks([255, 255, 255], 0.05, 0);
  },
  void_crystal: (t) => {
    t.fill((x, y) => {
      const d = Math.abs(x - 7.5) + Math.abs(y - 7.5) * 0.7;
      const facet = (x + y) % 6 < 3 ? 1.1 : 0.9;
      return [...scale(mix([200, 120, 255], [255, 230, 255], Math.max(0, 1 - d / 9)), facet), 215];
    });
  },
  bone_top: (t) => {
    t.fill((x, y) => {
      const r = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
      return r > 6.5 ? [206, 200, 180] : r < 2.5 ? [150, 140, 120] : mix([226, 220, 200], [240, 236, 220], vnoise(x, y, 4, t.seed));
    });
  },
  bone_side: (t) => {
    t.fill((x, y) => {
      const groove = x % 5 === 0;
      return scale(mix([222, 216, 194], [240, 236, 220], vnoise(x, y * 2, 4, t.seed)), groove ? 0.82 : 1);
    });
    bevel(t, 1.05, 0.85);
  },
};

for (let i = 0; i < 10; i++) painters['break_' + i] = (t) => crack(t, i);

/** Paint the whole atlas onto a canvas (with extruded borders to prevent sampling bleed). */
export function buildAtlasCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_W;
  canvas.height = ATLAS_H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const img = ctx.createImageData(ATLAS_W, ATLAS_H);
  TILE_NAMES.forEach((name, index) => {
    const seed = 1000 + index * 7919;
    const t = new Tile(mulberry32(seed), seed);
    const p = painters[name];
    if (!p) throw new Error(`No painter for tile ${name}`);
    p(t);
    const ox = (index % ATLAS_COLS) * CELL_PX;
    const oy = Math.floor(index / ATLAS_COLS) * CELL_PX;
    for (let y = -TILE_PAD; y < TILE_PX + TILE_PAD; y++) {
      for (let x = -TILE_PAD; x < TILE_PX + TILE_PAD; x++) {
        const sx = Math.min(TILE_PX - 1, Math.max(0, x));
        const sy = Math.min(TILE_PX - 1, Math.max(0, y));
        const s = (sy * TILE_PX + sx) * 4;
        const d = ((oy + y + TILE_PAD) * ATLAS_W + (ox + x + TILE_PAD)) * 4;
        img.data[d] = t.px[s];
        img.data[d + 1] = t.px[s + 1];
        img.data[d + 2] = t.px[s + 2];
        img.data[d + 3] = t.px[s + 3];
      }
    }
  });
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** Extract a single tile as a standalone 16x16 canvas (for icons). */
export function tileCanvas(atlas: HTMLCanvasElement, index: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = TILE_PX;
  c.height = TILE_PX;
  const ox = (index % ATLAS_COLS) * CELL_PX + TILE_PAD;
  const oy = Math.floor(index / ATLAS_COLS) * CELL_PX + TILE_PAD;
  c.getContext('2d')!.drawImage(atlas, ox, oy, TILE_PX, TILE_PX, 0, 0, TILE_PX, TILE_PX);
  return c;
}
