import { mulberry32 } from '../core/noise';
import { ATLAS_COLS, ATLAS_H, ATLAS_W, CELL_PX, TILE_NAMES, TILE_PAD, TILE_PX } from '../world/tiles';

/** RGBA pixel buffer for one 16x16 tile. */
class Tile {
  px = new Uint8ClampedArray(TILE_PX * TILE_PX * 4);
  constructor(public rand: () => number) {}

  set(x: number, y: number, c: number[], a = 255): void {
    if (x < 0 || y < 0 || x >= TILE_PX || y >= TILE_PX) return;
    const i = (y * TILE_PX + x) * 4;
    this.px[i] = c[0];
    this.px[i + 1] = c[1];
    this.px[i + 2] = c[2];
    this.px[i + 3] = a;
  }

  get(x: number, y: number): number[] {
    const i = (y * TILE_PX + x) * 4;
    return [this.px[i], this.px[i + 1], this.px[i + 2], this.px[i + 3]];
  }

  /** Fill with a base color and per-pixel random brightness variation. */
  noise(c: number[], v: number, a = 255): void {
    for (let y = 0; y < TILE_PX; y++) for (let x = 0; x < TILE_PX; x++) this.set(x, y, jitter(c, v, this.rand), a);
  }

  specks(c: number[], chance: number, v = 10): void {
    for (let y = 0; y < TILE_PX; y++) for (let x = 0; x < TILE_PX; x++) if (this.rand() < chance) this.set(x, y, jitter(c, v, this.rand));
  }

  clear(): void {
    this.px.fill(0);
  }
}

function jitter(c: number[], v: number, rand: () => number): number[] {
  const d = (rand() - 0.5) * 2 * v;
  return [c[0] + d, c[1] + d, c[2] + d];
}

function mix(a: number[], b: number[], t: number): number[] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

// Palette — BlockForge's own warm, slightly desaturated look.
const C = {
  dirt: [124, 86, 58],
  dirtDark: [96, 64, 44],
  grass: [104, 158, 72],
  grassDark: [78, 128, 58],
  grassLight: [138, 186, 88],
  stone: [128, 128, 132],
  stoneDark: [100, 100, 106],
  sand: [222, 204, 150],
  sandDark: [204, 184, 128],
  snow: [236, 242, 248],
  snowShade: [210, 222, 236],
  ashBark: [138, 120, 100],
  ashBarkDark: [104, 90, 74],
  ashWood: [208, 178, 128],
  pineBark: [92, 64, 46],
  pineWood: [182, 140, 92],
  leaves: [76, 136, 64],
  pine: [48, 98, 74],
  planks: [184, 140, 88],
  planksDark: [150, 110, 66],
};

function drawOre(t: Tile, colors: number[][], clusters: number): void {
  stoneBase(t);
  for (let k = 0; k < clusters; k++) {
    const cx = 2 + Math.floor(t.rand() * 12);
    const cy = 2 + Math.floor(t.rand() * 12);
    const n = 3 + Math.floor(t.rand() * 3);
    for (let i = 0; i < n; i++) {
      const x = cx + Math.floor(t.rand() * 3) - 1;
      const y = cy + Math.floor(t.rand() * 3) - 1;
      t.set(x, y, jitter(colors[i % colors.length], 12, t.rand));
      if (t.rand() < 0.5) t.set(x + 1, y + 1, mix(colors[0], [40, 40, 40], 0.5));
    }
  }
}

function stoneBase(t: Tile): void {
  t.noise(C.stone, 8);
  for (let k = 0; k < 6; k++) {
    const x = Math.floor(t.rand() * 16);
    const y = Math.floor(t.rand() * 16);
    const len = 2 + Math.floor(t.rand() * 4);
    for (let i = 0; i < len; i++) t.set(x + i, y + (t.rand() < 0.3 ? 1 : 0), jitter(C.stoneDark, 6, t.rand));
  }
  t.specks([150, 150, 154], 0.06);
}

function plantBlades(t: Tile, base: number[], count: number, maxH: number): void {
  t.clear();
  for (let k = 0; k < count; k++) {
    let x = 1 + Math.floor(t.rand() * 14);
    const h = 5 + Math.floor(t.rand() * maxH);
    for (let i = 0; i < h; i++) {
      t.set(x, 15 - i, jitter(mix(base, [190, 220, 120], i / h * 0.4), 10, t.rand));
      if (i > h / 2 && t.rand() < 0.3) x += t.rand() < 0.5 ? -1 : 1;
    }
  }
}

function logSide(t: Tile, bark: number[], dark: number[]): void {
  for (let x = 0; x < 16; x++) {
    const stripe = (x % 4 === 0 || (x * 7) % 5 === 0) ? dark : bark;
    for (let y = 0; y < 16; y++) t.set(x, y, jitter(stripe, 7, t.rand));
  }
  for (let k = 0; k < 5; k++) {
    const x = Math.floor(t.rand() * 16);
    const y = Math.floor(t.rand() * 14);
    t.set(x, y, dark); t.set(x, y + 1, dark);
  }
}

function logTop(t: Tile, bark: number[], wood: number[]): void {
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const dx = x - 7.5;
      const dy = y - 7.5;
      const r = Math.sqrt(dx * dx + dy * dy);
      if (r > 7) t.set(x, y, jitter(bark, 6, t.rand));
      else {
        const ring = Math.floor(r) % 2 === 0;
        t.set(x, y, jitter(ring ? wood : mix(wood, bark, 0.35), 5, t.rand));
      }
    }
  }
}

function leaves(t: Tile, base: number[], holes: number): void {
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      if (t.rand() < holes) t.set(x, y, [0, 0, 0], 0);
      else t.set(x, y, jitter(mix(base, [20, 40, 20], t.rand() * 0.4), 12, t.rand));
    }
  }
  for (let k = 0; k < 10; k++) t.set(Math.floor(t.rand() * 16), Math.floor(t.rand() * 16), mix(base, [200, 230, 150], 0.35));
}

function bricks(t: Tile, base: number[], mortar: number[], bw = 8, bh = 4): void {
  for (let y = 0; y < 16; y++) {
    const row = Math.floor(y / bh);
    const off = row % 2 === 0 ? 0 : bw / 2;
    for (let x = 0; x < 16; x++) {
      const isMortar = y % bh === bh - 1 || (x + off) % bw === bw - 1;
      t.set(x, y, isMortar ? jitter(mortar, 4, t.rand) : jitter(base, 9, t.rand));
    }
  }
}

function planks(t: Tile): void {
  for (let y = 0; y < 16; y++) {
    const board = Math.floor(y / 4);
    const seam = y % 4 === 3;
    for (let x = 0; x < 16; x++) {
      const endSeam = (x + board * 5) % 16 === 0;
      const c = seam || endSeam ? C.planksDark : mix(C.planks, C.planksDark, ((x * 3 + board * 7) % 11) / 30);
      t.set(x, y, jitter(c, 6, t.rand));
    }
  }
}

function crack(t: Tile, stage: number): void {
  t.clear();
  const r = mulberry32(777);
  const lines = 2 + stage * 2;
  for (let k = 0; k < lines; k++) {
    let x = 8 + Math.floor((r() - 0.5) * 6);
    let y = 8 + Math.floor((r() - 0.5) * 6);
    const len = 3 + Math.floor(r() * (2 + stage));
    for (let i = 0; i < len; i++) {
      t.set(x, y, [20, 16, 12], 210);
      const d = Math.floor(r() * 4);
      if (d === 0) x++; else if (d === 1) x--; else if (d === 2) y++; else y--;
    }
  }
}

const painters: Record<string, (t: Tile) => void> = {
  none: (t) => t.clear(),
  dirt: (t) => { t.noise(C.dirt, 10); t.specks(C.dirtDark, 0.15); t.specks([150, 110, 80], 0.05); },
  grass_top: (t) => { t.noise(C.grass, 12); t.specks(C.grassDark, 0.18); t.specks(C.grassLight, 0.1); },
  grass_side: (t) => {
    painters.dirt(t);
    for (let x = 0; x < 16; x++) {
      const d = 3 + Math.floor(t.rand() * 3);
      for (let y = 0; y < d; y++) t.set(x, y, jitter(y === d - 1 ? C.grassDark : C.grass, 10, t.rand));
    }
  },
  stone: (t) => stoneBase(t),
  rubble: (t) => {
    t.noise([88, 88, 92], 4);
    for (let k = 0; k < 9; k++) {
      const cx = Math.floor(t.rand() * 16);
      const cy = Math.floor(t.rand() * 16);
      const rr = 2 + t.rand() * 2.5;
      const shade = 0.75 + t.rand() * 0.35;
      for (let y = -4; y <= 4; y++) for (let x = -4; x <= 4; x++) {
        const d = Math.sqrt(x * x + y * y);
        if (d < rr) t.set((cx + x + 16) % 16, (cy + y + 16) % 16, jitter([140 * shade, 140 * shade, 146 * shade], 6, t.rand));
      }
    }
  },
  sand: (t) => { t.noise(C.sand, 7); t.specks(C.sandDark, 0.2, 5); t.specks([240, 226, 180], 0.06, 4); },
  sandstone: (t) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const band = y < 3 ? 1.04 : y % 5 === 0 ? 0.88 : 0.97;
      t.set(x, y, jitter([214 * band, 192 * band, 138 * band], 4, t.rand));
    }
  },
  sandstone_top: (t) => { t.noise([216, 196, 142], 5); },
  gravel: (t) => {
    t.noise([120, 112, 108], 10);
    for (let k = 0; k < 22; k++) {
      const x = Math.floor(t.rand() * 15);
      const y = Math.floor(t.rand() * 15);
      const c = t.rand() < 0.5 ? [150, 144, 138] : [90, 84, 80];
      t.set(x, y, c); t.set(x + 1, y, c); t.set(x, y + 1, mix(c, [60, 60, 60], 0.3));
    }
  },
  snow: (t) => { t.noise(C.snow, 4); t.specks(C.snowShade, 0.12, 3); },
  snow_side: (t) => {
    painters.dirt(t);
    for (let x = 0; x < 16; x++) {
      const d = 3 + Math.floor(t.rand() * 3);
      for (let y = 0; y < d; y++) t.set(x, y, jitter(y === d - 1 ? C.snowShade : C.snow, 4, t.rand));
    }
  },
  ice: (t) => {
    t.noise([170, 210, 240], 6, 190);
    for (let k = 0; k < 4; k++) {
      const x0 = Math.floor(t.rand() * 16);
      for (let i = 0; i < 6; i++) t.set((x0 + i) % 16, (k * 4 + i) % 16, [230, 245, 255], 220);
    }
  },
  water: (t) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const w = Math.sin((x + y * 0.5) * 0.8) * 0.5 + 0.5;
      t.set(x, y, jitter(mix([38, 92, 168], [70, 140, 210], w * 0.6), 5, t.rand), 175);
    }
  },
  ash_log: (t) => logSide(t, C.ashBark, C.ashBarkDark),
  ash_log_top: (t) => logTop(t, C.ashBark, C.ashWood),
  ash_leaves: (t) => leaves(t, C.leaves, 0.18),
  pine_log: (t) => logSide(t, C.pineBark, [70, 48, 34]),
  pine_log_top: (t) => logTop(t, C.pineBark, C.pineWood),
  pine_leaves: (t) => leaves(t, C.pine, 0.22),
  planks: (t) => planks(t),
  ember_ore: (t) => drawOre(t, [[40, 30, 30], [180, 60, 30], [60, 40, 36]], 5),
  copper_ore: (t) => drawOre(t, [[214, 120, 64], [86, 170, 140], [180, 96, 50]], 4),
  iron_ore: (t) => drawOre(t, [[216, 176, 150], [190, 150, 128], [240, 210, 190]], 4),
  lumen_ore: (t) => drawOre(t, [[120, 240, 255], [190, 130, 255], [240, 255, 255]], 4),
  coreite: (t) => { t.noise([40, 36, 48], 10); t.specks([80, 50, 110], 0.1, 10); t.specks([16, 14, 20], 0.15, 4); },
  cactus_side: (t) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const edge = x === 0 || x === 15;
      if (edge) { t.set(x, y, [0, 0, 0], 0); continue; }
      const rib = x % 4 === 2;
      t.set(x, y, jitter(rib ? [70, 140, 70] : [50, 112, 54], 6, t.rand));
    }
    for (let k = 0; k < 8; k++) t.set(1 + Math.floor(t.rand() * 14), Math.floor(t.rand() * 16), [230, 230, 190]);
  },
  cactus_top: (t) => {
    t.noise([62, 128, 62], 6);
    for (let y = 0; y < 16; y++) { t.set(0, y, [0, 0, 0], 0); t.set(15, y, [0, 0, 0], 0); t.set(y, 0, [0, 0, 0], 0); t.set(y, 15, [0, 0, 0], 0); }
    t.set(7, 7, [210, 220, 150]); t.set(8, 8, [210, 220, 150]);
  },
  tall_grass: (t) => plantBlades(t, [86, 150, 62], 9, 7),
  fern: (t) => {
    plantBlades(t, [96, 140, 120], 6, 6);
    for (let k = 0; k < 10; k++) t.set(Math.floor(t.rand() * 16), 6 + Math.floor(t.rand() * 10), [220, 236, 240]);
  },
  flower_red: (t) => {
    plantBlades(t, [70, 130, 56], 3, 3);
    const cx = 7, cy = 5;
    for (const [dx, dy] of [[0, -1], [-1, 0], [1, 0], [0, 1], [-1, -1], [1, 1], [1, -1], [-1, 1]]) t.set(cx + dx, cy + dy, jitter([214, 60, 52], 10, t.rand));
    t.set(cx, cy, [250, 210, 90]);
    for (let y = cy + 2; y < 16; y++) t.set(cx, y, [64, 120, 50]);
  },
  flower_gold: (t) => {
    plantBlades(t, [70, 130, 56], 3, 3);
    const cx = 8, cy = 6;
    for (const [dx, dy] of [[0, -1], [-1, 0], [1, 0], [0, 1]]) t.set(cx + dx, cy + dy, jitter([246, 196, 54], 8, t.rand));
    t.set(cx, cy, [160, 90, 30]);
    for (let y = cy + 2; y < 16; y++) t.set(cx, y, [64, 120, 50]);
  },
  berry_bush: (t) => {
    t.clear();
    for (let y = 4; y < 16; y++) for (let x = 1; x < 15; x++) {
      const dx = x - 7.5, dy = (y - 10) * 1.2;
      if (dx * dx + dy * dy < 40 && t.rand() > 0.15) t.set(x, y, jitter([60, 112, 52], 14, t.rand));
    }
    for (let k = 0; k < 7; k++) {
      const x = 3 + Math.floor(t.rand() * 10), y = 6 + Math.floor(t.rand() * 8);
      t.set(x, y, [200, 40, 70]); t.set(x + 1, y, [150, 30, 50]);
    }
  },
  dry_shrub: (t) => {
    t.clear();
    for (let k = 0; k < 6; k++) {
      let x = 8;
      for (let y = 15; y > 5 + Math.floor(t.rand() * 4); y--) {
        t.set(x, y, [130, 96, 60]);
        if (t.rand() < 0.4) x += t.rand() < 0.5 ? -1 : 1;
      }
    }
  },
  bench_top: (t) => {
    planks(t);
    for (let i = 0; i < 16; i++) { t.set(i, 0, [90, 62, 40]); t.set(i, 15, [90, 62, 40]); t.set(0, i, [90, 62, 40]); t.set(15, i, [90, 62, 40]); }
    for (let y = 4; y < 12; y++) for (let x = 4; x < 12; x++) t.set(x, y, jitter([110, 110, 118], 6, t.rand));
    for (let i = 4; i < 12; i++) { t.set(i, 7, [70, 70, 76]); t.set(7, i, [70, 70, 76]); }
  },
  bench_side: (t) => {
    planks(t);
    // Anvil silhouette — the bench's identity mark.
    for (let x = 3; x < 13; x++) t.set(x, 4, [70, 72, 80]);
    for (let x = 4; x < 12; x++) t.set(x, 5, [90, 92, 100]);
    for (let x = 6; x < 10; x++) for (let y = 6; y < 9; y++) t.set(x, y, [80, 82, 90]);
    for (let x = 5; x < 11; x++) t.set(x, 9, [70, 72, 80]);
    for (let y = 10; y < 16; y++) { t.set(2, y, [90, 62, 40]); t.set(13, y, [90, 62, 40]); }
  },
  kiln_top: (t) => { bricks(t, [150, 92, 72], [110, 100, 96], 8, 4); for (let y = 6; y < 10; y++) for (let x = 6; x < 10; x++) t.set(x, y, [36, 30, 30]); },
  kiln_front: (t) => {
    bricks(t, [150, 92, 72], [110, 100, 96], 8, 4);
    for (let y = 7; y < 14; y++) for (let x = 4; x < 12; x++) {
      const glow = y > 10 ? [250, 150, 50] : [40, 30, 28];
      t.set(x, y, jitter(glow, 12, t.rand));
    }
  },
  glass: (t) => {
    t.clear();
    for (let i = 0; i < 16; i++) {
      t.set(i, 0, [200, 230, 240], 230); t.set(i, 15, [200, 230, 240], 230);
      t.set(0, i, [200, 230, 240], 230); t.set(15, i, [200, 230, 240], 230);
    }
    for (let y = 1; y < 15; y++) for (let x = 1; x < 15; x++) t.set(x, y, [200, 230, 245], 40);
    for (let i = 0; i < 4; i++) { t.set(3 + i, 3 + i, [255, 255, 255], 200); t.set(4 + i, 3 + i, [255, 255, 255], 160); }
  },
  slate_bricks: (t) => bricks(t, [92, 100, 116], [56, 60, 70], 8, 4),
};

for (let i = 0; i < 10; i++) painters['break_' + i] = (t) => crack(t, i);

/** Paint the whole atlas onto a canvas (with extruded borders to prevent sampling bleed). */
export function buildAtlasCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_W;
  canvas.height = ATLAS_H;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(ATLAS_W, ATLAS_H);
  TILE_NAMES.forEach((name, index) => {
    const t = new Tile(mulberry32(1000 + index * 7919));
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
