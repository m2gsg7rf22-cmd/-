import { CHUNK_SIZE, PAD_SIZE, PAD_VOLUME, WORLD_HEIGHT } from '../core/constants';
import { padIndex } from '../core/coords';
import { B, isWaterId, waterLevel } from '../core/ids';
import { BLOCKS, EMIT, OPAQUE, RENDER } from './blocks';
import { BLOCK_TILES, tileBase } from './tiles';

/**
 * Geometry buffers for one mesh.
 * - positions: xyz (chunk-local)
 * - uvs: texture coordinates in *block units* (repeat via fract() in the shader, enabling greedy quads)
 * - tiles: atlas uv of the tile's bottom-left corner
 * - light: [ao * faceShade, skylight 0..1, blocklight 0..1]
 */
export interface MeshData {
  positions: Float32Array;
  uvs: Float32Array;
  tiles: Float32Array;
  light: Float32Array;
  indices: Uint32Array;
}

/** Vertical mesh sections (for culling buried geometry). */
export const SECTION_H = 32;
export const SECTIONS = WORLD_HEIGHT / SECTION_H;

export interface ChunkMeshes {
  opaque: MeshData[];
  transparent: MeshData[];
}

class Builder {
  pos = new Float32Array(2048 * 3);
  uv = new Float32Array(2048 * 2);
  tile = new Float32Array(2048 * 2);
  li = new Float32Array(2048 * 3);
  idx = new Uint32Array(2048 * 1.5);
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
      const l = new Float32Array(n * 3); l.set(this.li); this.li = l;
    }
    if (this.ic + inds > this.idx.length) {
      const n = Math.max(this.idx.length * 2, this.ic + inds);
      const i = new Uint32Array(n); i.set(this.idx); this.idx = i;
    }
  }

  /** Add a quad. c: 4 xyz corners (CCW from outside), u: 4 local uv pairs, l: 4 (shade, sky, block). */
  quad(c: number[], u: number[], tu: number, tv: number, l: number[], flip: boolean): void {
    this.ensure(4, 6);
    const v = this.vc;
    this.pos.set(c, v * 3);
    this.uv.set(u, v * 2);
    const t = this.tile;
    const o = v * 2;
    t[o] = tu; t[o + 1] = tv; t[o + 2] = tu; t[o + 3] = tv; t[o + 4] = tu; t[o + 5] = tv; t[o + 6] = tu; t[o + 7] = tv;
    this.li.set(l, v * 3);
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
      light: this.li.slice(0, this.vc * 3),
      indices: this.idx.slice(0, this.ic),
    };
  }
}

const opaqueB = Array.from({ length: SECTIONS }, () => new Builder());
const transB = Array.from({ length: SECTIONS }, () => new Builder());
const skyBuf = new Uint8Array(PAD_VOLUME);
const blkBuf = new Uint8Array(PAD_VOLUME);
const QSIZE = 1 << 17;
const queue = new Int32Array(QSIZE);
const sectionOf = (y: number) => Math.min(SECTIONS - 1, Math.max(0, Math.floor(y / SECTION_H)));

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

/** Build skylight per padded cell: 15 = open sky, attenuated by leaves/water/shapes, 0 under opaque. */
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
          else if (isWaterId(id)) light = Math.max(4, light - 1);
          else if (RENDER[id] === 2) light = Math.max(0, light - 3);
          else if (RENDER[id] === 6) light = Math.max(0, light - 1);
        }
        skyBuf[base + y] = light;
      }
    }
  }
  return maxY;
}

/**
 * Flood-fill block light inside the padded volume. Emitters inside the pad seed directly; emitters
 * from neighboring chunks (chunk-local coords, possibly outside the pad) seed the nearest pad cell
 * with their attenuated level, so torches near a border light across it.
 */
function buildBlockLight(pad: Uint8Array, external?: Int16Array): void {
  blkBuf.fill(0);
  let head = 0;
  let tail = 0;
  const push = (i: number) => {
    queue[tail] = i;
    tail = (tail + 1) & (QSIZE - 1);
  };
  for (let i = 0; i < PAD_VOLUME; i++) {
    const e = EMIT[pad[i]];
    if (e > blkBuf[i]) {
      blkBuf[i] = e;
      push(i);
    }
  }
  if (external) {
    for (let k = 0; k + 3 < external.length; k += 4) {
      const ex = external[k], ey = external[k + 1], ez = external[k + 2], lvl = external[k + 3];
      const px = Math.max(-1, Math.min(CHUNK_SIZE, ex));
      const pz = Math.max(-1, Math.min(CHUNK_SIZE, ez));
      if (ey < 0 || ey >= WORLD_HEIGHT) continue;
      const l = lvl - Math.abs(ex - px) - Math.abs(ez - pz);
      if (l <= 0) continue;
      const i = padIndex(px, ey, pz);
      if (OPAQUE[pad[i]] && !EMIT[pad[i]]) continue;
      if (l > blkBuf[i]) {
        blkBuf[i] = l;
        push(i);
      }
    }
  }
  const H = WORLD_HEIGHT;
  const ROW = PAD_SIZE * H;
  while (head !== tail) {
    const i = queue[head];
    head = (head + 1) & (QSIZE - 1);
    const l = blkBuf[i];
    if (l <= 1) continue;
    const n = l - 1;
    const y = i % H;
    const pz = Math.floor(i / H) % PAD_SIZE;
    const px = Math.floor(i / ROW);
    const tryN = (j: number) => {
      if (blkBuf[j] < n && !OPAQUE[pad[j]]) {
        blkBuf[j] = n;
        push(j);
      }
    };
    if (y > 0) tryN(i - 1);
    if (y < H - 1) tryN(i + 1);
    if (pz > 0) tryN(i - H);
    if (pz < PAD_SIZE - 1) tryN(i + H);
    if (px > 0) tryN(i - ROW);
    if (px < PAD_SIZE - 1) tryN(i + ROW);
  }
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

function blkAt(x: number, y: number, z: number): number {
  if (y >= WORLD_HEIGHT || y < 0) return 0;
  return blkBuf[padIndex(x, y, z)];
}

/** Rendered top height of a water cell (0 if not water). */
function waterHeight(pad: Uint8Array, x: number, y: number, z: number): number {
  if (y < 0 || y >= WORLD_HEIGHT) return 0;
  const id = pad[padIndex(x, y, z)];
  if (!isWaterId(id)) return 0;
  if (y + 1 < WORLD_HEIGHT && isWaterId(pad[padIndex(x, y + 1, z)])) return 1;
  const l = waterLevel(id);
  return l === 8 ? WATER_TOP : Math.max(0.12, (l / 8) * WATER_TOP);
}

// ---- greedy mask storage for solid opaque faces ----
const VOL = CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT;
const maskTile = new Uint16Array(6 * VOL);
const maskAo = new Uint16Array(6 * VOL);
const maskSky = new Uint32Array(6 * VOL);
const maskBlk = new Uint32Array(6 * VOL);
const vIdx = (x: number, y: number, z: number) => (x * CHUNK_SIZE + z) * WORLD_HEIGHT + y;
const q6 = (v: number) => Math.round(Math.min(1, v) * 63);

/** AO (0..3), averaged sky (0..1) and block light (0..1) for the 4 corners of a full-cube face. */
function cornerLight(pad: Uint8Array, f: Face, x: number, y: number, z: number, ao: boolean, outAo: number[], outSky: number[], outBlk: number[]): void {
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
    let blk = blkAt(nx, ny, nz);
    let n = 1;
    if (!o1) { sky += skyAt(nx + s1x, ny + s1y, nz + s1z); blk += blkAt(nx + s1x, ny + s1y, nz + s1z); n++; }
    if (!o2) { sky += skyAt(nx + s2x, ny + s2y, nz + s2z); blk += blkAt(nx + s2x, ny + s2y, nz + s2z); n++; }
    if (!oc && !(o1 && o2)) {
      sky += skyAt(nx + s1x + s2x, ny + s1y + s2y, nz + s1z + s2z);
      blk += blkAt(nx + s1x + s2x, ny + s1y + s2y, nz + s1z + s2z);
      n++;
    }
    outSky[c] = sky / n / 15;
    outBlk[c] = blk / n / 15;
  }
}

/**
 * Mesh a chunk from its padded block array (18x18xH, 1-block neighbor border).
 * Solid opaque faces are greedy-merged (same tile + identical corner lighting);
 * cutout/cross/water/glass/shape blocks use per-face quads. Output is split into vertical sections.
 * `emitters`: light sources from neighbor chunks as [x,y,z,level]* in this chunk's local coords.
 */
export function meshChunk(pad: Uint8Array, aoEnabled = true, emitters?: Int16Array): ChunkMeshes {
  for (const b of opaqueB) b.reset();
  for (const b of transB) b.reset();
  const maxY = Math.min(WORLD_HEIGHT - 1, buildSky(pad) + 1);
  buildBlockLight(pad, emitters);
  maskTile.fill(0);

  const corner = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const uvs = [0, 0, 0, 0, 0, 0, 0, 0];
  const lights = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const aoTmp = [0, 0, 0, 0];
  const skyTmp = [0, 0, 0, 0];
  const blkTmp = [0, 0, 0, 0];

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
        if (kind === 6) {
          emitShape(id, x, y, z);
          continue;
        }
        if (kind === 4) {
          emitWater(x, y, z);
          continue;
        }
        const glows = EMIT[id] > 0;

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
          if (kind === 5 && isWaterId(nId)) continue;

          const tile = BLOCK_TILES[id * 3 + fc.tile];
          cornerLight(pad, fc, x, y, z, aoEnabled, aoTmp, skyTmp, blkTmp);
          if (glows) blkTmp[0] = blkTmp[1] = blkTmp[2] = blkTmp[3] = 1;

          if (kind === 1) {
            // Defer to the greedy pass.
            const vi = f * VOL + vIdx(x, y, z);
            maskTile[vi] = tile + 1;
            const flip = aoTmp[0] + aoTmp[2] < aoTmp[1] + aoTmp[3] ? 1 : 0;
            maskAo[vi] = aoTmp[0] | (aoTmp[1] << 2) | (aoTmp[2] << 4) | (aoTmp[3] << 6) | (flip << 8);
            maskSky[vi] = q6(skyTmp[0]) | (q6(skyTmp[1]) << 6) | (q6(skyTmp[2]) << 12) | (q6(skyTmp[3]) << 18);
            maskBlk[vi] = q6(blkTmp[0]) | (q6(blkTmp[1]) << 6) | (q6(blkTmp[2]) << 12) | (q6(blkTmp[3]) << 18);
            continue;
          }

          const [u0, v0] = tileBase(tile);
          for (let c = 0; c < 4; c++) {
            const off = fc.corners[c];
            corner[c * 3] = x + off[0];
            corner[c * 3 + 1] = y + off[1];
            corner[c * 3 + 2] = z + off[2];
            lights[c * 3] = AO_CURVE[aoTmp[c]] * fc.shade;
            lights[c * 3 + 1] = skyTmp[c];
            lights[c * 3 + 2] = blkTmp[c];
          }
          for (let k = 0; k < 8; k++) uvs[k] = LOCAL_UV[k] >= 1 ? 0.9999 : LOCAL_UV[k];
          const builder = kind === 5 ? transB[sectionOf(y)] : opaqueB[sectionOf(y)];
          builder.quad(corner, uvs, u0, v0, lights, aoTmp[0] + aoTmp[2] < aoTmp[1] + aoTmp[3]);
        }
      }
    }
  }

  greedy(maxY);
  return { opaque: opaqueB.map((b) => b.finish()), transparent: transB.map((b) => b.finish()) };

  function emitCross(id: number, x: number, y: number, z: number): void {
    const tile = BLOCK_TILES[id * 3 + 2];
    const [u0, v0] = tileBase(tile);
    const s = skyAt(x, y, z) / 15;
    const bl = blkAt(x, y, z) / 15;
    const l = [0.9, s, bl, 0.9, s, bl, 0.9, s, bl, 0.9, s, bl];
    const uv = [0, 0, 0.9999, 0, 0.9999, 0.9999, 0, 0.9999];
    const a = 0.15;
    const b = 0.85;
    const planes = [
      [x + a, y, z + a, x + b, y, z + b, x + b, y + 1, z + b, x + a, y + 1, z + a],
      [x + b, y, z + b, x + a, y, z + a, x + a, y + 1, z + a, x + b, y + 1, z + b],
      [x + a, y, z + b, x + b, y, z + a, x + b, y + 1, z + a, x + a, y + 1, z + b],
      [x + b, y, z + a, x + a, y, z + b, x + a, y + 1, z + b, x + b, y + 1, z + a],
    ];
    const bld = opaqueB[sectionOf(y)];
    for (const p of planes) bld.quad(p, uv, u0, v0, l, false);
  }

  /** Arbitrary box shapes (slabs, stairs, doors, torches). Faces on the cell boundary cull against opaque neighbors. */
  function emitShape(id: number, x: number, y: number, z: number): void {
    const boxes = BLOCKS[id].boxes ?? [[0, 0, 0, 1, 1, 1]];
    const glows = EMIT[id] > 0;
    const bld = opaqueB[sectionOf(y)];
    for (const bx of boxes) {
      for (let f = 0; f < 6; f++) {
        const fc = FACES[f];
        const axis = fc.n[0] !== 0 ? 0 : fc.n[1] !== 0 ? 1 : 2;
        const positive = fc.n[axis] > 0;
        const plane = positive ? bx[axis + 3] : bx[axis];
        const onBoundary = positive ? plane >= 1 : plane <= 0;
        let sx = x, sy = y, sz = z;
        if (onBoundary) {
          sx += fc.n[0]; sy += fc.n[1]; sz += fc.n[2];
          if (sy < 0 || (sy < WORLD_HEIGHT && OPAQUE[pad[padIndex(sx, sy, sz)]])) continue;
        }
        const s = skyAt(sx, sy, sz) / 15;
        const bl = glows ? 1 : blkAt(sx, sy, sz) / 15;
        const tile = BLOCK_TILES[id * 3 + fc.tile];
        const [u0, v0] = tileBase(tile);
        const c0 = fc.corners[0];
        const c1 = fc.corners[1];
        for (let c = 0; c < 4; c++) {
          const off = fc.corners[c];
          const lc = [0, 0, 0];
          for (let a = 0; a < 3; a++) lc[a] = off[a] ? bx[a + 3] : bx[a];
          corner[c * 3] = x + lc[0];
          corner[c * 3 + 1] = y + lc[1];
          corner[c * 3 + 2] = z + lc[2];
          const u = c0[fc.uAxis] ? 1 - lc[fc.uAxis] : lc[fc.uAxis];
          const v = c1[fc.vAxis] ? 1 - lc[fc.vAxis] : lc[fc.vAxis];
          uvs[c * 2] = Math.min(0.9999, Math.max(0, u));
          uvs[c * 2 + 1] = Math.min(0.9999, Math.max(0, v));
          lights[c * 3] = fc.shade;
          lights[c * 3 + 1] = s;
          lights[c * 3 + 2] = bl;
        }
        bld.quad(corner, uvs, u0, v0, lights, false);
      }
    }
  }

  /** Water: per-level surface height; side faces fill the gap down to a lower neighbor surface. */
  function emitWater(x: number, y: number, z: number): void {
    const h = waterHeight(pad, x, y, z);
    const tile = BLOCK_TILES[B.WATER * 3];
    const [u0, v0] = tileBase(tile);
    const bld = transB[sectionOf(y)];
    for (let f = 0; f < 6; f++) {
      const fc = FACES[f];
      const nx = x + fc.n[0];
      const ny = y + fc.n[1];
      const nz = z + fc.n[2];
      const nId = ny < 0 ? B.COREITE : ny >= WORLD_HEIGHT ? 0 : pad[padIndex(nx, ny, nz)];
      if (OPAQUE[nId] || RENDER[nId] === 5) continue;
      let bottom = 0;
      let top = h;
      if (fc.n[1] === 1) {
        if (isWaterId(nId)) continue;
      } else if (fc.n[1] === -1) {
        if (isWaterId(nId)) continue;
      } else if (isWaterId(nId)) {
        bottom = waterHeight(pad, nx, ny, nz);
        if (bottom >= top - 0.001) continue;
      }
      if (fc.n[1] === 0) top = h;
      const s = skyAt(nx, ny, nz) / 15;
      const bl = blkAt(nx, ny, nz) / 15;
      for (let c = 0; c < 4; c++) {
        const off = fc.corners[c];
        let cy = off[1] ? y + top : y + bottom;
        if (fc.n[1] === 1) cy = y + h;
        if (fc.n[1] === -1) cy = y;
        corner[c * 3] = x + off[0];
        corner[c * 3 + 1] = cy;
        corner[c * 3 + 2] = z + off[2];
        lights[c * 3] = fc.shade;
        lights[c * 3 + 1] = s;
        lights[c * 3 + 2] = bl;
      }
      for (let k = 0; k < 8; k++) uvs[k] = LOCAL_UV[k] >= 1 ? 0.9999 : LOCAL_UV[k];
      if (fc.n[1] === 0) {
        uvs[1] = uvs[3] = bottom;
        uvs[5] = uvs[7] = Math.min(0.9999, top);
      }
      bld.quad(corner, uvs, u0, v0, lights, false);
    }
  }

  /** Merge deferred solid faces into maximal rectangles per slice and emit them. */
  function greedy(maxYIncl: number): void {
    const H = maxYIncl + 1;
    for (let f = 0; f < 6; f++) {
      const fc = FACES[f];
      const nAxis = fc.n[0] !== 0 ? 0 : fc.n[1] !== 0 ? 1 : 2;
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
      const same = (i: number, j: number) =>
        maskTile[j] === maskTile[i] && maskAo[j] === maskAo[i] && maskSky[j] === maskSky[i] && maskBlk[j] === maskBlk[i];
      for (let s = 0; s < dims[nAxis]; s++) {
        used.fill(0);
        for (let v = 0; v < dV; v++) {
          // Quads never span vertical sections.
          const vLimit = va === 1 ? Math.min(dV, (Math.floor(v / SECTION_H) + 1) * SECTION_H) : dV;
          for (let u = 0; u < dU; u++) {
            if (used[v * dU + u]) continue;
            const i0 = cellIndex(s, u, v);
            if (maskTile[i0] === 0) continue;
            let w = 1;
            while (u + w < dU && !used[v * dU + u + w] && same(i0, cellIndex(s, u + w, v))) w++;
            let h = 1;
            outer: while (v + h < vLimit) {
              for (let k = 0; k < w; k++) {
                if (used[(v + h) * dU + u + k] || !same(i0, cellIndex(s, u + k, v + h))) break outer;
              }
              h++;
            }
            for (let dv = 0; dv < h; dv++) for (let du = 0; du < w; du++) used[(v + dv) * dU + u + du] = 1;
            emitMerged(fc, s, u, v, w, h, i0);
          }
        }
      }
    }
  }

  function emitMerged(fc: Face, s: number, u: number, v: number, w: number, h: number, i0: number): void {
    const nAxis = fc.n[0] !== 0 ? 0 : fc.n[1] !== 0 ? 1 : 2;
    const tile = maskTile[i0] - 1;
    const ao = maskAo[i0];
    const sk = maskSky[i0];
    const bk = maskBlk[i0];
    const size = [1, 1, 1];
    size[fc.uAxis] = w;
    size[fc.vAxis] = h;
    const origin = [0, 0, 0];
    origin[nAxis] = s;
    origin[fc.uAxis] = u;
    origin[fc.vAxis] = v;
    // Each quad is pushed out in-plane by a hair so neighbours overlap: greedy meshes contain
    // T-junctions, which otherwise leave sub-pixel cracks where the sky shows through.
    for (let c = 0; c < 4; c++) {
      const off = fc.corners[c];
      for (let a = 0; a < 3; a++) {
        if (a === nAxis) corner[c * 3 + a] = origin[a] + off[a];
        else corner[c * 3 + a] = origin[a] + off[a] * size[a] + (off[a] ? SEAM_EPS : -SEAM_EPS);
      }
      lights[c * 3] = AO_CURVE[(ao >> (c * 2)) & 3] * fc.shade;
      lights[c * 3 + 1] = ((sk >> (c * 6)) & 63) / 63;
      lights[c * 3 + 2] = ((bk >> (c * 6)) & 63) / 63;
    }
    const W = size[fc.uAxis] - 0.0001;
    const Hh = size[fc.vAxis] - 0.0001;
    uvs[0] = 0; uvs[1] = 0; uvs[2] = W; uvs[3] = 0; uvs[4] = W; uvs[5] = Hh; uvs[6] = 0; uvs[7] = Hh;
    const [u0, v0] = tileBase(tile);
    const y0 = nAxis === 1 ? s : origin[1];
    opaqueB[sectionOf(y0)].quad(corner, uvs, u0, v0, lights, ((ao >> 8) & 1) === 1);
  }
}

/** Merge per-section meshes (tests / tools). */
export function mergeSections(list: MeshData[]): MeshData {
  let v = 0, i = 0;
  for (const m of list) { v += m.positions.length / 3; i += m.indices.length; }
  const out: MeshData = {
    positions: new Float32Array(v * 3), uvs: new Float32Array(v * 2), tiles: new Float32Array(v * 2),
    light: new Float32Array(v * 3), indices: new Uint32Array(i),
  };
  let vo = 0, io = 0;
  for (const m of list) {
    out.positions.set(m.positions, vo * 3);
    out.uvs.set(m.uvs, vo * 2);
    out.tiles.set(m.tiles, vo * 2);
    out.light.set(m.light, vo * 3);
    for (let k = 0; k < m.indices.length; k++) out.indices[io + k] = m.indices[k] + vo;
    vo += m.positions.length / 3;
    io += m.indices.length;
  }
  return out;
}
