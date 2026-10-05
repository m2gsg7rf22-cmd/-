import { CHUNK_SIZE, PAD_SIZE, PAD_VOLUME, WORLD_HEIGHT } from '../core/constants';
import { padIndex } from '../core/coords';
import { B } from '../core/ids';
import { OPAQUE, RENDER } from './blocks';
import { BLOCK_TILES, tileRect } from './tiles';

/**
 * Geometry buffers for one mesh.
 * - positions: xyz (chunk-local)
 * - uvs: texture coordinates in *block units* (repeat via fract() in the shader, enabling greedy quads)
 * - tiles: atlas uv of the tile's bottom-left corner
 * - light: [ao * faceShade, skylight 0..1]
 */
export interface MeshData {
  positions: Float32Array;
  uvs: Float32Array;
  tiles: Float32Array;
  light: Float32Array;
  indices: Uint32Array;
}

export interface ChunkMeshes {
  opaque: MeshData;
  transparent: MeshData;
}

class Builder {
  pos = new Float32Array(4096 * 3);
  uv = new Float32Array(4096 * 2);
  tile = new Float32Array(4096 * 2);
  li = new Float32Array(4096 * 2);
  idx = new Uint32Array(4096 * 1.5);
  vc = 0;
  ic = 0;

  reset(): void {
    this.vc = 0;
    this.ic = 0;
  }

  private ensure(verts: number, inds: number): void {
    const capVerts = this.pos.length / 3;
    if (this.vc + verts > capVerts) {
      const n = Math.max(capVerts * 2, this.vc + verts);
      const p = new Float32Array(n * 3); p.set(this.pos); this.pos = p;
      const u = new Float32Array(n * 2); u.set(this.uv); this.uv = u;
      const t = new Float32Array(n * 2); t.set(this.tile); this.tile = t;
      const l = new Float32Array(n * 2); l.set(this.li); this.li = l;
    }
    if (this.ic + inds > this.idx.length) {
      const n = Math.max(this.idx.length * 2, this.ic + inds);
      const i = new Uint32Array(n); i.set(this.idx); this.idx = i;
    }
  }

  /** Add a quad. c: 4 xyz corners (CCW from outside), u: 4 local uv pairs, l: 4 (shade, sky). */
  quad(c: number[], u: number[], tu: number, tv: number, l: number[], flip: boolean): void {
    this.ensure(4, 6);
    const v = this.vc;
    this.pos.set(c, v * 3);
    this.uv.set(u, v * 2);
    const t = this.tile;
    const o = v * 2;
    t[o] = tu; t[o + 1] = tv; t[o + 2] = tu; t[o + 3] = tv; t[o + 4] = tu; t[o + 5] = tv; t[o + 6] = tu; t[o + 7] = tv;
    this.li.set(l, v * 2);
    const i = this.ic;
    if (flip) {
      this.idx[i] = v + 1; this.idx[i + 1] = v + 2; this.idx[i + 2] = v + 3;
      this.idx[i + 3] = v + 1; this.idx[i + 4] = v + 3; this.idx[i + 5] = v;
    } else {
      this.idx[i] = v; this.idx[i + 1] = v + 1; this.idx[i + 2] = v + 2;
      this.idx[i + 3] = v; this.idx[i + 4] = v + 2; this.idx[i + 5] = v + 3;
    }
    this.vc += 4;
    this.ic += 6;
  }

  finish(): MeshData {
    return {
      positions: this.pos.slice(0, this.vc * 3),
      uvs: this.uv.slice(0, this.vc * 2),
      tiles: this.tile.slice(0, this.vc * 2),
      light: this.li.slice(0, this.vc * 2),
      indices: this.idx.slice(0, this.ic),
    };
  }
}

const opaqueB = new Builder();
const transB = new Builder();
const skyBuf = new Uint8Array(PAD_VOLUME);

/** Face table: normal, 4 corners (CCW from outside), shade, tile slot (0 top, 1 bottom, 2 side). */
interface Face {
  n: [number, number, number];
  corners: [number, number, number][];
  shade: number;
  tile: number;
  /** Axis along corner0→corner1 (texture u) and corner1→corner2 (texture v). */
  uAxis: number;
  vAxis: number;
}

function face(n: [number, number, number], corners: [number, number, number][], shade: number, tile: number): Face {
  const axisOf = (a: number[], b: number[]) => (a[0] !== b[0] ? 0 : a[1] !== b[1] ? 1 : 2);
  return { n, corners, shade, tile, uAxis: axisOf(corners[0], corners[1]), vAxis: axisOf(corners[1], corners[2]) };
}

const FACES: Face[] = [
  face([1, 0, 0], [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], 0.8, 2),
  face([-1, 0, 0], [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], 0.8, 2),
  face([0, 1, 0], [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], 1.0, 0),
  face([0, -1, 0], [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], 0.5, 1),
  face([0, 0, 1], [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], 0.65, 2),
  face([0, 0, -1], [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], 0.65, 2),
];

const AO_CURVE = [0.42, 0.62, 0.8, 1.0];
const WATER_TOP = 0.875;
const SEAM_EPS = 0.002;
const LOCAL_UV = [0, 0, 1, 0, 1, 1, 0, 1];

/** Build skylight per padded cell: 15 = open sky, attenuated by leaves/water, 0 under opaque. */
function buildSky(pad: Uint8Array): number {
  let maxY = 0;
  for (let px = 0; px < PAD_SIZE; px++) {
    for (let pz = 0; pz < PAD_SIZE; pz++) {
      const base = (px * PAD_SIZE + pz) * WORLD_HEIGHT;
      let light = 15;
      for (let y = WORLD_HEIGHT - 1; y >= 0; y--) {
        const id = pad[base + y];
        if (id !== 0) {
          if (y > maxY) maxY = y;
          if (OPAQUE[id]) light = 0;
          else if (id === B.WATER) light = Math.max(4, light - 1);
          else if (RENDER[id] === 2) light = Math.max(0, light - 3);
        }
        skyBuf[base + y] = light;
      }
    }
  }
  return maxY;
}

function opaqueAt(pad: Uint8Array, x: number, y: number, z: number): number {
  if (y < 0) return 1;
  if (y >= WORLD_HEIGHT) return 0;
  return OPAQUE[pad[padIndex(x, y, z)]];
}

function skyAt(x: number, y: number, z: number): number {
  if (y >= WORLD_HEIGHT) return 15;
  if (y < 0) return 0;
  return skyBuf[padIndex(x, y, z)];
}

// ---- greedy mask storage for solid opaque faces ----
const VOL = CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT;
/** Per face direction: tile+1 (0 = no face). */
const maskTile = new Uint16Array(6 * VOL);
/** Per face direction: packed AO (4 x 2 bits) + flip bit. */
const maskAo = new Uint16Array(6 * VOL);
/** Per face direction: 4 sky values quantized to 0..63 (6 bits each). */
const maskSky = new Uint32Array(6 * VOL);
const vIdx = (x: number, y: number, z: number) => (x * CHUNK_SIZE + z) * WORLD_HEIGHT + y;

/**
 * Compute AO (0..3) and averaged sky (0..1) for the 4 corners of a face.
 * Writes into outAo[4], outSky[4].
 */
function cornerLight(pad: Uint8Array, f: Face, x: number, y: number, z: number, ao: boolean, outAo: number[], outSky: number[]): void {
  const nx = x + f.n[0];
  const ny = y + f.n[1];
  const nz = z + f.n[2];
  for (let c = 0; c < 4; c++) {
    const off = f.corners[c];
    let s1x = 0, s1y = 0, s1z = 0, s2x = 0, s2y = 0, s2z = 0;
    if (f.n[0] !== 0) { s1y = off[1] ? 1 : -1; s2z = off[2] ? 1 : -1; }
    else if (f.n[1] !== 0) { s1x = off[0] ? 1 : -1; s2z = off[2] ? 1 : -1; }
    else { s1x = off[0] ? 1 : -1; s2y = off[1] ? 1 : -1; }
    const o1 = opaqueAt(pad, nx + s1x, ny + s1y, nz + s1z);
    const o2 = opaqueAt(pad, nx + s2x, ny + s2y, nz + s2z);
    const oc = opaqueAt(pad, nx + s1x + s2x, ny + s1y + s2y, nz + s1z + s2z);
    outAo[c] = ao ? (o1 && o2 ? 0 : 3 - (o1 + o2 + oc)) : 3;
    let sky = skyAt(nx, ny, nz);
    let n = 1;
    if (!o1) { sky += skyAt(nx + s1x, ny + s1y, nz + s1z); n++; }
    if (!o2) { sky += skyAt(nx + s2x, ny + s2y, nz + s2z); n++; }
    if (!oc && !(o1 && o2)) { sky += skyAt(nx + s1x + s2x, ny + s1y + s2y, nz + s1z + s2z); n++; }
    outSky[c] = sky / n / 15;
  }
}

/**
 * Mesh a chunk from its padded block array (18x18xH, 1-block neighbor border).
 * Solid opaque faces are greedy-merged (same tile + identical corner lighting);
 * cutout/cross/water/glass use per-face quads.
 */
export function meshChunk(pad: Uint8Array, aoEnabled = true): ChunkMeshes {
  opaqueB.reset();
  transB.reset();
  const maxY = Math.min(WORLD_HEIGHT - 1, buildSky(pad));
  maskTile.fill(0);

  const corner = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const uvs = [0, 0, 0, 0, 0, 0, 0, 0];
  const lights = [0, 0, 0, 0, 0, 0, 0, 0];
  const aoTmp = [0, 0, 0, 0];
  const skyTmp = [0, 0, 0, 0];

  for (let x = 0; x < CHUNK_SIZE; x++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      const colBase = padIndex(x, 0, z);
      for (let y = 0; y <= maxY; y++) {
        const id = pad[colBase + y];
        if (id === 0) continue;
        const kind = RENDER[id];
        if (kind === 0) continue;

        if (kind === 3) {
          emitCross(id, x, y, z);
          continue;
        }

        const isWater = kind === 4;
        const builder = kind === 4 || kind === 5 ? transB : opaqueB;
        const waterTopOpen = isWater && (y + 1 >= WORLD_HEIGHT || pad[colBase + y + 1] !== B.WATER);

        for (let f = 0; f < 6; f++) {
          const fc = FACES[f];
          const nx = x + fc.n[0];
          const ny = y + fc.n[1];
          const nz = z + fc.n[2];
          let nId: number;
          if (ny < 0) nId = B.COREITE;
          else if (ny >= WORLD_HEIGHT) nId = 0;
          else nId = pad[padIndex(nx, ny, nz)];

          if (OPAQUE[nId]) continue;
          if (kind !== 1 && nId === id) continue; // cull internal faces between same transparent blocks
          if (isWater && RENDER[nId] === 5) continue;
          if (kind === 5 && nId === B.WATER) continue;

          const tile = BLOCK_TILES[id * 3 + fc.tile];

          if (kind === 1) {
            // Defer to the greedy pass.
            cornerLight(pad, fc, x, y, z, aoEnabled, aoTmp, skyTmp);
            const vi = f * VOL + vIdx(x, y, z);
            maskTile[vi] = tile + 1;
            const flip = aoTmp[0] + aoTmp[2] < aoTmp[1] + aoTmp[3] ? 1 : 0;
            maskAo[vi] = aoTmp[0] | (aoTmp[1] << 2) | (aoTmp[2] << 4) | (aoTmp[3] << 6) | (flip << 8);
            maskSky[vi] =
              Math.round(skyTmp[0] * 63) | (Math.round(skyTmp[1] * 63) << 6) | (Math.round(skyTmp[2] * 63) << 12) | (Math.round(skyTmp[3] * 63) << 18);
            continue;
          }

          const [u0, v0] = tileRect(tile);
          let a0 = 3, a1 = 3, a2 = 3, a3 = 3;
          if (!isWater && kind !== 5) {
            cornerLight(pad, fc, x, y, z, aoEnabled, aoTmp, skyTmp);
            [a0, a1, a2, a3] = aoTmp;
          } else {
            const s = skyAt(nx, ny, nz) / 15;
            skyTmp[0] = skyTmp[1] = skyTmp[2] = skyTmp[3] = s;
            aoTmp[0] = aoTmp[1] = aoTmp[2] = aoTmp[3] = 3;
          }
          for (let c = 0; c < 4; c++) {
            const off = fc.corners[c];
            let cy = y + off[1];
            if (isWater && off[1] === 1 && waterTopOpen) cy = y + WATER_TOP;
            corner[c * 3] = x + off[0];
            corner[c * 3 + 1] = cy;
            corner[c * 3 + 2] = z + off[2];
            lights[c * 2] = AO_CURVE[aoTmp[c]] * fc.shade;
            lights[c * 2 + 1] = skyTmp[c];
          }
          for (let k = 0; k < 8; k++) uvs[k] = LOCAL_UV[k];
          if (isWater && waterTopOpen && fc.n[1] === 0) {
            uvs[5] = WATER_TOP;
            uvs[7] = WATER_TOP;
          }
          // Keep local uvs strictly inside [0,1) at the far edges so fract() never wraps.
          for (let k = 0; k < 8; k++) if (uvs[k] >= 1) uvs[k] = 0.9999;
          builder.quad(corner, uvs, u0, v0, lights, a0 + a2 < a1 + a3);
        }
      }
    }
  }

  greedy(maxY);
  return { opaque: opaqueB.finish(), transparent: transB.finish() };

  function emitCross(id: number, x: number, y: number, z: number): void {
    const tile = BLOCK_TILES[id * 3 + 2];
    const [u0, v0] = tileRect(tile);
    const s = skyAt(x, y, z) / 15;
    const l = [0.9, s, 0.9, s, 0.9, s, 0.9, s];
    const uv = [0, 0, 0.9999, 0, 0.9999, 0.9999, 0, 0.9999];
    const a = 0.15;
    const b = 0.85;
    const planes = [
      [x + a, y, z + a, x + b, y, z + b, x + b, y + 1, z + b, x + a, y + 1, z + a],
      [x + b, y, z + b, x + a, y, z + a, x + a, y + 1, z + a, x + b, y + 1, z + b],
      [x + a, y, z + b, x + b, y, z + a, x + b, y + 1, z + a, x + a, y + 1, z + b],
      [x + b, y, z + a, x + a, y, z + b, x + a, y + 1, z + b, x + b, y + 1, z + a],
    ];
    for (const p of planes) opaqueB.quad(p, uv, u0, v0, l, false);
  }

  /** Merge deferred solid faces into maximal rectangles per slice and emit them. */
  function greedy(maxYIncl: number): void {
    const H = maxYIncl + 1;
    for (let f = 0; f < 6; f++) {
      const fc = FACES[f];
      const nAxis = fc.n[0] !== 0 ? 0 : fc.n[1] !== 0 ? 1 : 2;
      // The two in-plane axes: iterate a (outer) and b (inner) over the slice.
      const ua = fc.uAxis;
      const va = fc.vAxis;
      const dims = [CHUNK_SIZE, H, CHUNK_SIZE];
      const dU = dims[ua];
      const dV = dims[va];
      const used = new Uint8Array(dU * dV);
      const base = f * VOL;
      const p = [0, 0, 0];
      const cellIndex = (s: number, u: number, v: number) => {
        p[nAxis] = s; p[ua] = u; p[va] = v;
        return base + vIdx(p[0], p[1], p[2]);
      };
      for (let s = 0; s < dims[nAxis]; s++) {
        used.fill(0);
        for (let v = 0; v < dV; v++) {
          for (let u = 0; u < dU; u++) {
            if (used[v * dU + u]) continue;
            const i0 = cellIndex(s, u, v);
            const t = maskTile[i0];
            if (t === 0) continue;
            const ao = maskAo[i0];
            const sk = maskSky[i0];
            // Grow along u.
            let w = 1;
            while (u + w < dU && !used[v * dU + u + w]) {
              const j = cellIndex(s, u + w, v);
              if (maskTile[j] !== t || maskAo[j] !== ao || maskSky[j] !== sk) break;
              w++;
            }
            // Grow along v while the whole row matches.
            let h = 1;
            outer: while (v + h < dV) {
              for (let k = 0; k < w; k++) {
                if (used[(v + h) * dU + u + k]) break outer;
                const j = cellIndex(s, u + k, v + h);
                if (maskTile[j] !== t || maskAo[j] !== ao || maskSky[j] !== sk) break outer;
              }
              h++;
            }
            for (let dv = 0; dv < h; dv++) for (let du = 0; du < w; du++) used[(v + dv) * dU + u + du] = 1;
            emitMerged(fc, s, u, v, w, h, t - 1, ao, sk);
          }
        }
      }
    }
  }

  function emitMerged(fc: Face, s: number, u: number, v: number, w: number, h: number, tile: number, ao: number, sk: number): void {
    const nAxis = fc.n[0] !== 0 ? 0 : fc.n[1] !== 0 ? 1 : 2;
    const size = [1, 1, 1];
    size[fc.uAxis] = w;
    size[fc.vAxis] = h;
    const origin = [0, 0, 0];
    origin[nAxis] = s;
    origin[fc.uAxis] = u;
    origin[fc.vAxis] = v;
    // Corner offsets in the face table are 0/1 per axis; stretch the in-plane axes.
    // Each quad is pushed out in-plane by a hair so neighbours overlap: greedy meshes contain
    // T-junctions, which otherwise leave sub-pixel cracks where the sky shows through.
    for (let c = 0; c < 4; c++) {
      const off = fc.corners[c];
      for (let a = 0; a < 3; a++) {
        if (a === nAxis) corner[c * 3 + a] = origin[a] + off[a];
        else corner[c * 3 + a] = origin[a] + off[a] * size[a] + (off[a] ? SEAM_EPS : -SEAM_EPS);
      }
      const aoC = (ao >> (c * 2)) & 3;
      lights[c * 2] = AO_CURVE[aoC] * fc.shade;
      lights[c * 2 + 1] = ((sk >> (c * 6)) & 63) / 63;
    }
    // Local uv: corner0 (0,0) → corner1 (W,0) → corner2 (W,H) → corner3 (0,H).
    const W = size[fc.uAxis] - 0.0001;
    const Hh = size[fc.vAxis] - 0.0001;
    uvs[0] = 0; uvs[1] = 0; uvs[2] = W; uvs[3] = 0; uvs[4] = W; uvs[5] = Hh; uvs[6] = 0; uvs[7] = Hh;
    const [u0, v0] = tileRect(tile);
    opaqueB.quad(corner, uvs, u0, v0, lights, ((ao >> 8) & 1) === 1);
  }
}
