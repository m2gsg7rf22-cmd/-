// Procedural, seamlessly tiling PBR texture synthesis in pure JavaScript.
// Every generator produces albedo (sRGB), tangent-space normal, and packed ORM
// (R = ambient occlusion, G = roughness, B = metalness, glTF convention) plus an
// optional emissive channel. No canvas or GPU is required, so output is testable in Node.
import { RNG, clamp, lerp, smoothstep } from '../core/rng.js';

const hex = (h) => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const mul3 = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const fract = (x) => x - Math.floor(x);

// Periodic value noise on a lattice of `period` cells; exact tiling at [0,1).
export class TileNoise {
  constructor(seed = 1, size = 256) {
    const rng = new RNG(seed);
    this.size = size;
    this.v = new Float32Array(size * size);
    for (let i = 0; i < this.v.length; i++) this.v[i] = rng.next();
  }
  lattice(ix, iy, p) { const s = this.size; return this.v[((iy % p + p) % p % s) * s + ((ix % p + p) % p % s)]; }
  value(u, v, p) { return this.value2(u, v, p, p); }
  // Anisotropic periodic value noise: px cells across u, py cells across v.
  value2(u, v, px, py) {
    const x = u * px, y = v * py, ix = Math.floor(x), iy = Math.floor(y);
    let fx = x - ix, fy = y - iy;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    const L = (i, j) => this.v[(((j % py) + py) % py % this.size) * this.size + (((i % px) + px) % px % this.size)];
    return lerp(lerp(L(ix, iy), L(ix + 1, iy), fx), lerp(L(ix, iy + 1), L(ix + 1, iy + 1), fx), fy);
  }
  fbm2(u, v, px, py, oct = 4) {
    let s = 0, a = 1, n = 0;
    for (let o = 0; o < oct; o++) { s += a * this.value2(u, v, px, py); n += a; a *= 0.5; px *= 2; py *= 2; }
    return s / n;
  }
  fbm(u, v, p = 4, oct = 5, gain = 0.5) {
    let s = 0, a = 1, n = 0;
    for (let o = 0; o < oct; o++) { s += a * this.value(u, v, p); n += a; a *= gain; p *= 2; }
    return s / n;
  }
  // Periodic Worley/Voronoi: returns [f1, f2, cellId]
  voronoi(u, v, p, jitter = 0.9) {
    const x = u * p, y = v * p, ix = Math.floor(x), iy = Math.floor(y);
    let f1 = 9, f2 = 9, id = 0;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const cx = ix + i, cy = iy + j;
      const wx = ((cx % p) + p) % p, wy = ((cy % p) + p) % p;
      const h = this.lattice(wx * 7 + 3, wy * 13 + 1, 4096);
      const h2 = this.lattice(wx * 5 + 11, wy * 3 + 7, 4096);
      const px = cx + 0.5 + (h - 0.5) * jitter, py = cy + 0.5 + (h2 - 0.5) * jitter;
      const d = Math.hypot(px - x, py - y);
      if (d < f1) { f2 = f1; f1 = d; id = this.lattice(cx, cy, p); } else if (d < f2) f2 = d;
    }
    return [f1, f2, id];
  }
}

// Each recipe: (ctx, u, v) => { c: [r,g,b], h: height 0..1, r: roughness, m: metal, ao, e: [r,g,b] }
const RECIPES = {
  grass(ctx, u, v) {
    const { n, o } = ctx;
    const base = n.fbm(u, v, 4, 5), fine = n.fbm(u, v, 64, 2), clump = n.fbm(u + 0.3, v, 8, 3);
    const blade = n.value2(u, v, 128, 24) * n.value2(u, v, 32, 8);
    let c = mix3(hex(o.color ?? 0x4f7a2c), hex(o.color2 ?? 0x7d9a3a), smoothstep(0.35, 0.7, base));
    c = mix3(c, hex(0x5c5130), smoothstep(0.62, 0.8, clump) * 0.45);
    c = mul3(c, 0.86 + fine * 0.16 + blade * 0.1);
    return { c, h: base * 0.4 + fine * 0.3 + blade * 0.3, r: 0.85 + fine * 0.1, ao: 0.75 + 0.25 * fine };
  },
  dirt(ctx, u, v) {
    const { n, o } = ctx;
    const b = n.fbm(u, v, 4, 6), pebbles = n.voronoi(u, v, 24);
    const peb = smoothstep(0.32, 0.18, pebbles[0]) * (pebbles[2] > 0.6 ? 1 : 0);
    let c = mix3(hex(o.color ?? 0x6b5038), hex(o.color2 ?? 0x8a6c4a), b);
    c = mix3(c, hex(0x9a9286), peb * 0.7);
    return { c, h: b * 0.6 + peb * 0.4, r: 0.92 - peb * 0.2, ao: 0.7 + 0.3 * b };
  },
  sand(ctx, u, v) {
    const { n, o } = ctx;
    const ripple = Math.sin((v + n.fbm(u, v, 4, 3) * 0.15) * Math.PI * 2 * 18) * 0.5 + 0.5;
    const g = n.value(u, v, 256);
    const c = mul3(mix3(hex(o.color ?? 0xd8c49a), hex(o.color2 ?? 0xc2a878), ripple * 0.5), 0.9 + g * 0.15);
    return { c, h: ripple * 0.5 + g * 0.2, r: 0.95, ao: 0.85 + ripple * 0.15 };
  },
  rock(ctx, u, v) {
    const { n, o } = ctx;
    const b = n.fbm(u, v, 3, 6, 0.55), vor = n.voronoi(u, v, 6);
    const crack = smoothstep(0.06, 0.0, vor[1] - vor[0]);
    const strata = Math.sin((v + b * 0.3) * Math.PI * 2 * 7) * 0.5 + 0.5;
    let c = mix3(hex(o.color ?? 0x6e6a64), hex(o.color2 ?? 0x8f8a80), b * 0.7 + strata * 0.3);
    c = mul3(c, 1 - crack * 0.55);
    c = mix3(c, hex(0x56603a), smoothstep(0.72, 0.85, n.fbm(u + 0.5, v, 6, 3)) * (o.moss ?? 0.4));
    return { c, h: b * 0.7 + strata * 0.15 - crack * 0.4 + 0.2, r: 0.82 + 0.1 * b, ao: 1 - crack * 0.6 };
  },
  snow(ctx, u, v) {
    const { n } = ctx;
    const b = n.fbm(u, v, 4, 5), sp = n.value(u, v, 256);
    return { c: mul3([0.93, 0.95, 1.0], 0.92 + b * 0.08), h: b, r: 0.55 + sp * 0.3, ao: 0.9 + b * 0.1 };
  },
  asphalt(ctx, u, v) {
    const { n, o } = ctx;
    const agg = n.value(u, v, 256), agg2 = n.value(u + 0.37, v, 128), b = n.fbm(u, v, 4, 4);
    const vor = n.voronoi(u, v, 3); const crack = smoothstep(0.025, 0.0, vor[1] - vor[0]) * smoothstep(0.55, 0.75, b);
    let c = mul3(hex(o.color ?? 0x2f3032), 0.75 + agg * 0.35 + agg2 * 0.15);
    c = mix3(c, hex(0x1b1b1c), crack * 0.8);
    let e = null;
    if (o.lanes) { // centre dashed line + edge lines along V (tiles along road length)
      const dash = fract(v * 4) < 0.5 ? 1 : 0;
      const centre = smoothstep(0.012, 0.006, Math.abs(u - 0.5)) * dash;
      const edge = smoothstep(0.012, 0.006, Math.abs(u - 0.06)) + smoothstep(0.012, 0.006, Math.abs(u - 0.94));
      const paint = clamp(centre + edge, 0, 1) * (0.75 + agg * 0.25);
      c = mix3(c, centre > 0 ? hex(0xe0b33a) : hex(0xdedede), paint);
      if (paint > 0.1) e = mul3(centre > 0 ? hex(0xe0b33a) : hex(0xdedede), paint * 0.04);
    }
    return { c, h: agg * 0.5 + agg2 * 0.3 - crack * 0.5, r: 0.88 - agg * 0.2, ao: 1 - crack * 0.5, e };
  },
  concrete(ctx, u, v) {
    const { n, o } = ctx;
    const b = n.fbm(u, v, 4, 6), sp = n.value(u, v, 256), stain = smoothstep(0.55, 0.8, n.fbm(u + 0.2, v * 0.5, 3, 4));
    let c = mul3(hex(o.color ?? 0x9b9a96), 0.85 + b * 0.2 + sp * 0.06);
    c = mix3(c, mul3(c, 0.7), stain * 0.6);
    const seam = o.panels ? Math.max(smoothstep(0.006, 0, Math.min(fract(u * o.panels), 1 - fract(u * o.panels))), smoothstep(0.006, 0, Math.min(fract(v * o.panels), 1 - fract(v * o.panels)))) : 0;
    c = mul3(c, 1 - seam * 0.5);
    return { c, h: b * 0.4 + sp * 0.2 - seam * 0.6 + 0.3, r: 0.9 - stain * 0.15, ao: 1 - seam * 0.5 };
  },
  plaster(ctx, u, v) {
    const { n, o } = ctx;
    const b = n.fbm(u, v, 8, 5), dirt = smoothstep(0.55, 0.85, n.fbm(u, v, 3, 3)) * n.fbm(u, v, 6, 3);
    let c = mul3(hex(o.color ?? 0xe6dccb), 0.9 + b * 0.12);
    c = mix3(c, hex(0x8a7a62), dirt * 0.35);
    return { c, h: b, r: 0.9, ao: 0.9 + b * 0.1 };
  },
  brick(ctx, u, v) {
    const { n, o, rng } = ctx;
    const rows = o.rows ?? 16, cols = o.cols ?? 8;
    const ry = v * rows, row = Math.floor(ry);
    const rx = u * cols + (row % 2) * 0.5, col = Math.floor(rx);
    const fx = fract(rx), fy = fract(ry), mortar = o.mortar ?? 0.06;
    const edge = Math.min(fx, 1 - fx, (fy) * cols / rows * 2, (1 - fy) * cols / rows * 2);
    const m = smoothstep(mortar * 0.5, mortar, Math.min(fx, 1 - fx) * 1.0) * smoothstep(mortar, mortar * 2, Math.min(fy, 1 - fy));
    const id = n.lattice(((col % cols) + cols) % cols, row, 4096);
    let c = mix3(hex(o.color ?? 0x9a4a32), hex(o.color2 ?? 0x6e3324), id);
    c = mul3(c, 0.85 + n.fbm(u, v, 32, 3) * 0.3);
    c = mix3(hex(o.mortarColor ?? 0xb3aa98), c, m);
    void edge; void rng;
    return { c, h: m * (0.8 + n.value(u, v, 64) * 0.2), r: lerp(0.95, 0.82, m), ao: lerp(0.55, 1, m) };
  },
  cobble(ctx, u, v) {
    const { n, o } = ctx;
    const [f1, f2, id] = n.voronoi(u, v, o.cells ?? 10, 0.8);
    const stone = smoothstep(0.02, 0.12, f2 - f1);
    let c = mix3(hex(o.color ?? 0x7d7870), hex(o.color2 ?? 0x5d5953), id);
    c = mul3(c, 0.8 + n.fbm(u, v, 16, 3) * 0.35);
    c = mix3(hex(0x3d3a33), c, stone);
    return { c, h: stone * (1 - f1 * 0.6), r: lerp(1, 0.78, stone), ao: lerp(0.4, 1, stone) };
  },
  planks(ctx, u, v) {
    const { n, o } = ctx;
    const count = o.planks ?? 6, px = u * count, idx = Math.floor(px), fx = fract(px);
    const off = n.lattice(idx, 0, 4096);
    const grain = Math.sin((u * count * 3 + n.fbm2(u, fract(v + off), count * 2, 2, 4) * 6) * Math.PI * 2 * 2) * 0.5 + 0.5;
    const knot = smoothstep(0.08, 0.0, Math.hypot(fract(px) - 0.5, (fract(v + off) - 0.5) * 3)) * (off > 0.6 ? 1 : 0);
    const gap = smoothstep(0.0, 0.04, Math.min(fx, 1 - fx));
    const endGap = smoothstep(0.0, 0.01, Math.min(fract(v * 2 + off), 1 - fract(v * 2 + off)));
    let c = mix3(hex(o.color ?? 0x8a5a34), hex(o.color2 ?? 0x6a4122), grain * 0.6 + off * 0.4);
    c = mul3(c, 1 - knot * 0.5);
    c = mul3(c, 0.35 + 0.65 * gap * endGap);
    return { c, h: gap * endGap * (0.8 + grain * 0.2), r: 0.7 + grain * 0.15, ao: 0.5 + 0.5 * gap * endGap };
  },
  roof(ctx, u, v) {
    const { n, o } = ctx;
    const rows = o.rows ?? 10, ry = v * rows, row = Math.floor(ry), fy = fract(ry);
    const rx = u * 8 + (row % 2) * 0.5, fx = fract(rx);
    const id = n.lattice(Math.floor(rx), row, 4096);
    const shape = Math.sqrt(Math.max(0, 1 - Math.pow(fx * 2 - 1, 2))) * (0.3 + 0.7 * fy);
    let c = mix3(hex(o.color ?? 0x8c3b2a), hex(o.color2 ?? 0x5e2a1f), id * 0.6);
    c = mul3(c, 0.55 + 0.45 * shape + n.fbm(u, v, 16, 3) * 0.15);
    return { c, h: shape, r: 0.8, ao: 0.5 + 0.5 * shape };
  },
  metal(ctx, u, v) {
    const { n, o } = ctx;
    const brush = n.value2(u, v, 8, 512) * 0.5 + n.value2(u, v, 12, 256) * 0.5;
    const c = mul3(hex(o.color ?? 0xb8bcc2), 0.85 + brush * 0.2);
    return { c, h: brush * 0.2, r: (o.roughness ?? 0.35) + brush * 0.12, m: 1, ao: 1 };
  },
  paintedMetal(ctx, u, v) {
    const { n, o } = ctx;
    const scratch = smoothstep(0.86, 0.95, n.value2(u, v, 13, 128)) * smoothstep(0.5, 0.8, n.fbm(u, v, 4, 3));
    const rust = smoothstep(0.62, 0.8, n.fbm(u, v, 6, 5)) * (o.rust ?? 0.3);
    let c = mul3(hex(o.color ?? 0x3d6e8a), 0.9 + n.fbm(u, v, 16, 3) * 0.15);
    c = mix3(c, hex(0x8a5a3a), rust); c = mix3(c, hex(0xaab0b6), scratch);
    const seam = o.panels ? smoothstep(0.008, 0, Math.min(fract(u * o.panels), 1 - fract(u * o.panels))) : 0;
    c = mul3(c, 1 - seam * 0.6);
    return { c, h: 0.5 - scratch * 0.2 - seam * 0.5 + rust * 0.2, r: lerp(0.45, 0.85, rust) - scratch * 0.2, m: scratch, ao: 1 - seam * 0.4 };
  },
  fabric(ctx, u, v) {
    const { n, o } = ctx;
    const t = o.weave ?? 96;
    const wx = Math.sin(u * t * Math.PI * 2) * 0.5 + 0.5, wy = Math.sin(v * t * Math.PI * 2) * 0.5 + 0.5;
    const over = (Math.floor(u * t) + Math.floor(v * t)) % 2 ? wx : wy;
    let c = mul3(hex(o.color ?? 0x3a4a6a), 0.75 + over * 0.25 + n.fbm(u, v, 8, 3) * 0.12);
    if (o.stripe) c = mix3(c, hex(o.stripe), fract(u * 6) < 0.15 ? 0.8 : 0);
    return { c, h: over, r: 0.95, ao: 0.8 + over * 0.2 };
  },
  leather(ctx, u, v) {
    const { n, o } = ctx;
    const [f1, f2] = n.voronoi(u, v, 48);
    const crease = smoothstep(0.05, 0.0, f2 - f1);
    const c = mul3(hex(o.color ?? 0x5a3a24), 0.85 + n.fbm(u, v, 8, 4) * 0.25 - crease * 0.2);
    return { c, h: 1 - crease, r: 0.6 + crease * 0.25, ao: 1 - crease * 0.3 };
  },
  skin(ctx, u, v) {
    const { n, o } = ctx;
    const pores = n.value(u, v, 256), blot = n.fbm(u, v, 6, 3);
    const c = mul3(mix3(hex(o.color ?? 0xc89474), hex(o.color2 ?? 0xb47860), blot * 0.5), 0.95 + pores * 0.06);
    return { c, h: 0.5 + pores * 0.1, r: 0.55 + pores * 0.1, ao: 1 };
  },
  bark(ctx, u, v) {
    const { n, o } = ctx;
    const f = n.fbm2(u, v, 8, 2, 5);
    const groove = Math.pow(Math.abs(Math.sin((u * 10 + f * 2.5) * Math.PI)), 0.5);
    const c = mul3(mix3(hex(o.color ?? 0x4a3828), hex(o.color2 ?? 0x6d5640), groove), 0.8 + f * 0.3);
    return { c, h: groove, r: 0.95, ao: 0.5 + 0.5 * groove };
  },
  leaves(ctx, u, v) {
    const { n, o } = ctx;
    const [f1, , id] = n.voronoi(u, v, 14, 1);
    const leaf = smoothstep(0.42, 0.25, f1);
    const c = mul3(mix3(hex(o.color ?? 0x3f6b2a), hex(o.color2 ?? 0x7a9a3a), id), 0.6 + leaf * 0.5);
    return { c, h: leaf, r: 0.7, ao: 0.6 + 0.4 * leaf };
  },
  tiles(ctx, u, v) {
    const { n, o } = ctx;
    const k = o.tiles ?? 4, fx = fract(u * k), fy = fract(v * k);
    const g = smoothstep(0.0, 0.03, Math.min(fx, 1 - fx)) * smoothstep(0.0, 0.03, Math.min(fy, 1 - fy));
    const id = n.lattice(Math.floor(u * k), Math.floor(v * k), 4096);
    let c = mul3(hex(o.color ?? 0xa8a49c), 0.88 + id * 0.12 + n.fbm(u, v, 16, 3) * 0.1);
    c = mix3(hex(0x5e5b55), c, g);
    return { c, h: g * 0.9, r: lerp(1, 0.75, g), ao: lerp(0.5, 1, g) };
  },
  facade(ctx, u, v) { // windows grid; tile = one floor x `cols` windows
    const { n, o } = ctx;
    const cols = o.cols ?? 4, floors = o.floors ?? 4;
    const fx = fract(u * cols), fy = fract(v * floors);
    const cx = Math.floor(u * cols), cy = Math.floor(v * floors);
    const wx = o.windowW ?? 0.62, wy = o.windowH ?? 0.58;
    const inX = Math.abs(fx - 0.5) < wx / 2, inY = Math.abs(fy - 0.55) < wy / 2;
    const frame = Math.abs(fx - 0.5) < wx / 2 + 0.04 && Math.abs(fy - 0.55) < wy / 2 + 0.04;
    const wall = mul3(hex(o.color ?? 0x8c8f94), 0.85 + n.fbm(u, v, 8, 4) * 0.2);
    const lit = n.lattice(cx, cy, 4096) > (o.litRatio ?? 0.55) ? 0 : 1;
    let c = wall, r = 0.85, m = 0, h = 0.6, e = null, ao = 1;
    if (frame && !(inX && inY)) { c = hex(o.frameColor ?? 0x3a3c40); r = 0.4; m = 0.6; h = 0.7; }
    if (inX && inY) {
      const refl = smoothstep(0.2, 0.9, fy) * 0.25;
      const mullion = Math.abs(fx - 0.5) < 0.012;
      c = mullion ? hex(0x2a2c30) : mix3(hex(o.glass ?? 0x1c2a38), hex(0x8aa4bf), refl);
      r = 0.08; m = 0.2; h = 0.2; ao = 0.8;
      if (lit && !mullion) { const warm = n.lattice(cx + 7, cy, 4096); e = mul3(mix3(hex(0xffd59a), hex(0xbfe3ff), warm > 0.7 ? 1 : 0), 0.9 + 0.3 * n.fbm(u, v, 8, 2)); }
    }
    return { c, h, r, m, ao, e };
  },
};

export const TEXTURE_KINDS = Object.keys(RECIPES);

export function generateTexture(kind, opts = {}) {
  const recipe = RECIPES[kind];
  if (!recipe) throw new Error(`Unknown texture kind '${kind}'. Known: ${TEXTURE_KINDS.join(', ')}`);
  const size = opts.size ?? 256, seed = opts.seed ?? 7;
  const ctx = { n: new TileNoise(seed), o: opts, rng: new RNG(seed) };
  const N = size * size;
  const albedo = new Uint8Array(N * 4), orm = new Uint8Array(N * 4), normal = new Uint8Array(N * 4);
  const height = new Float32Array(N);
  let emissive = null;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const s = recipe(ctx, (x + 0.5) / size, (y + 0.5) / size);
      const c = s.c;
      albedo[i * 4] = clamp(c[0], 0, 1) * 255; albedo[i * 4 + 1] = clamp(c[1], 0, 1) * 255; albedo[i * 4 + 2] = clamp(c[2], 0, 1) * 255; albedo[i * 4 + 3] = 255;
      orm[i * 4] = clamp(s.ao ?? 1, 0, 1) * 255; orm[i * 4 + 1] = clamp(s.r ?? 0.8, 0.02, 1) * 255; orm[i * 4 + 2] = clamp(s.m ?? 0, 0, 1) * 255; orm[i * 4 + 3] = 255;
      height[i] = s.h ?? 0.5;
      if (s.e) {
        if (!emissive) emissive = new Uint8Array(N * 4);
        emissive[i * 4] = clamp(s.e[0], 0, 1) * 255; emissive[i * 4 + 1] = clamp(s.e[1], 0, 1) * 255; emissive[i * 4 + 2] = clamp(s.e[2], 0, 1) * 255; emissive[i * 4 + 3] = 255;
      }
    }
  }
  // Normal from height via wrapped Sobel filter (keeps tiling seamless).
  const strength = opts.normalStrength ?? 2.5;
  const H = (x, y) => height[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (H(x + 1, y - 1) + 2 * H(x + 1, y) + H(x + 1, y + 1)) - (H(x - 1, y - 1) + 2 * H(x - 1, y) + H(x - 1, y + 1));
    const dy = (H(x - 1, y + 1) + 2 * H(x, y + 1) + H(x + 1, y + 1)) - (H(x - 1, y - 1) + 2 * H(x, y - 1) + H(x + 1, y - 1));
    let nx = -dx * strength, ny = -dy * strength, nz = 1;
    const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const i = (y * size + x) * 4;
    normal[i] = (nx * 0.5 + 0.5) * 255; normal[i + 1] = (ny * 0.5 + 0.5) * 255; normal[i + 2] = (nz * 0.5 + 0.5) * 255; normal[i + 3] = 255;
  }
  return { kind, size, albedo, normal, orm, emissive, height };
}

// Statistics used by asset validation and tests.
export function textureStats(data) {
  let sum = 0, sq = 0; const n = data.length / 4;
  for (let i = 0; i < data.length; i += 4) { const l = (data[i] + data[i + 1] + data[i + 2]) / 3; sum += l; sq += l * l; }
  const mean = sum / n; return { mean, std: Math.sqrt(Math.max(0, sq / n - mean * mean)) };
}

// Seam ratio: difference across the wrap border divided by the typical difference
// between interior neighbours. ~1 means the seam is invisible; >>1 means a visible seam.
export function seamError(data, size) {
  let border = 0, interior = 0;
  for (let i = 0; i < size; i++) {
    const a = (i * size) * 4, b = (i * size + size - 1) * 4, c = i * 4, d = ((size - 1) * size + i) * 4;
    border += Math.abs(data[a] - data[b]) + Math.abs(data[c] - data[d]);
    const m = (i * size + (size >> 1)) * 4, mr = m + 4, mv = (((size >> 1) + 1) * size + i) * 4, mv0 = ((size >> 1) * size + i) * 4;
    interior += Math.abs(data[m] - data[mr]) + Math.abs(data[mv] - data[mv0]);
  }
  return border / Math.max(1, interior);
}
