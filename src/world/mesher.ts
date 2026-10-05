import { CHUNK_SIZE, PAD_SIZE, PAD_VOLUME, WORLD_HEIGHT } from '../core/constants';
import { padIndex } from '../core/coords';
import { B } from '../core/ids';
import { OPAQUE, RENDER } from './blocks';
import { BLOCK_TILES, tileRect } from './tiles';

/** Geometry buffers for one mesh (positions xyz, uvs, light = [ao*faceShade, skylight]). */
export interface MeshData {
  positions: Float32Array;
  uvs: Float32Array;
  light: Float32Array;
  indices: Uint32Array;
}

export interface ChunkMeshes {
  opaque: MeshData;
  transparent: MeshData;
}

class Builder {
  pos = new Float32Array(1 << 14);
  uv = new Float32Array(1 << 13);
  li = new Float32Array(1 << 13);
  idx = new Uint32Array(1 << 13);
  vc = 0;
  ic = 0;

  reset(): void {
    this.vc = 0;
    this.ic = 0;
  }

  private ensure(verts: number, inds: number): void {
    if ((this.vc + verts) * 3 > this.pos.length) {
      const n = Math.max(this.pos.length * 2, (this.vc + verts) * 3);
      const p = new Float32Array(n); p.set(this.pos); this.pos = p;
      const u = new Float32Array((n / 3) * 2); u.set(this.uv); this.uv = u;
      const l = new Float32Array((n / 3) * 2); l.set(this.li); this.li = l;
    }
    if (this.ic + inds > this.idx.length) {
      const n = Math.max(this.idx.length * 2, this.ic + inds);
      const i = new Uint32Array(n); i.set(this.idx); this.idx = i;
    }
  }

  /** Add a quad. corners: 4 xyz, uvs: 4 uv pairs, lights: 4 (shade, sky). flip: alternate diagonal. */
  quad(c: number[], u: number[], l: number[], flip: boolean): void {
    this.ensure(4, 6);
    const v = this.vc;
    this.pos.set(c, v * 3);
    this.uv.set(u, v * 2);
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
      light: this.li.slice(0, this.vc * 2),
      indices: this.idx.slice(0, this.ic),
    };
  }
}

const opaqueB = new Builder();
const transB = new Builder();
const skyBuf = new Uint8Array(PAD_VOLUME);

/**
 * Face table. For each of 6 faces: normal, 4 corner offsets (counter-clockwise seen from outside),
 * tangent axes u/v used for AO lookup, shade, and tile slot (0 top, 1 bottom, 2 side).
 */
interface Face {
  n: [number, number, number];
  corners: [number, number, number][];
  shade: number;
  tile: number;
}

const FACES: Face[] = [
  // +X
  { n: [1, 0, 0], corners: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], shade: 0.8, tile: 2 },
  // -X
  { n: [-1, 0, 0], corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], shade: 0.8, tile: 2 },
  // +Y
  { n: [0, 1, 0], corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], shade: 1.0, tile: 0 },
  // -Y
  { n: [0, -1, 0], corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], shade: 0.5, tile: 1 },
  // +Z
  { n: [0, 0, 1], corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], shade: 0.65, tile: 2 },
  // -Z
  { n: [0, 0, -1], corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], shade: 0.65, tile: 2 },
];

const AO_CURVE = [0.42, 0.62, 0.8, 1.0];
const WATER_TOP = 0.875;

/** Build skylight per padded cell: 15 = open sky, attenuated by leaves/water, 0 under opaque. */
function buildSky(pad: Uint8Array): void {
  for (let px = 0; px < PAD_SIZE; px++) {
    for (let pz = 0; pz < PAD_SIZE; pz++) {
      const base = (px * PAD_SIZE + pz) * WORLD_HEIGHT;
      let light = 15;
      for (let y = WORLD_HEIGHT - 1; y >= 0; y--) {
        const id = pad[base + y];
        if (id !== 0) {
          if (OPAQUE[id]) light = 0;
          else if (id === B.WATER) light = Math.max(4, light - 1);
          else if (RENDER[id] === 2) light = Math.max(0, light - 3);
        }
        skyBuf[base + y] = light;
      }
    }
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

/**
 * Mesh a chunk from its padded block array (18x18xH, 1-block neighbor border).
 * Visible-face meshing with per-vertex AO and smoothed skylight.
 */
export function meshChunk(pad: Uint8Array, aoEnabled = true): ChunkMeshes {
  opaqueB.reset();
  transB.reset();
  buildSky(pad);

  const corner = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const uvs = [0, 0, 0, 0, 0, 0, 0, 0];
  const lights = [0, 0, 0, 0, 0, 0, 0, 0];

  for (let x = 0; x < CHUNK_SIZE; x++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      const colBase = padIndex(x, 0, z);
      for (let y = 0; y < WORLD_HEIGHT; y++) {
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
          const face = FACES[f];
          const nx = x + face.n[0];
          const ny = y + face.n[1];
          const nz = z + face.n[2];
          let nId: number;
          if (ny < 0) nId = B.COREITE;
          else if (ny >= WORLD_HEIGHT) nId = 0;
          else nId = pad[padIndex(nx, ny, nz)];

          if (OPAQUE[nId]) continue;
          if (kind !== 1 && nId === id) continue; // cull internal faces between same transparent blocks
          if (isWater && RENDER[nId] === 5) continue;
          if (kind === 5 && nId === B.WATER) continue;
          // Water top under a lowered surface: still draw. Water bottom against solid handled above.

          const tile = BLOCK_TILES[id * 3 + face.tile];
          const [u0, v0, u1, v1] = tileRect(tile);

          // Compute corners, AO and sky for 4 vertices.
          let a0 = 0, a1 = 0, a2 = 0, a3 = 0;
          for (let c = 0; c < 4; c++) {
            const off = face.corners[c];
            let cy = y + off[1];
            if (isWater && off[1] === 1 && waterTopOpen) cy = y + WATER_TOP;
            corner[c * 3] = x + off[0];
            corner[c * 3 + 1] = cy;
            corner[c * 3 + 2] = z + off[2];

            // AO: sample the 3 cells adjacent to this vertex in the neighbor layer.
            // Tangent offsets: for each axis that's not the normal, direction toward the corner.
            let s1x = 0, s1y = 0, s1z = 0, s2x = 0, s2y = 0, s2z = 0;
            if (face.n[0] !== 0) {
              s1y = off[1] ? 1 : -1; s2z = off[2] ? 1 : -1;
            } else if (face.n[1] !== 0) {
              s1x = off[0] ? 1 : -1; s2z = off[2] ? 1 : -1;
            } else {
              s1x = off[0] ? 1 : -1; s2y = off[1] ? 1 : -1;
            }
            let ao = 3;
            let sky = skyAt(nx, ny, nz);
            let skyN = 1;
            if (!isWater && kind !== 5) {
              const o1 = opaqueAt(pad, nx + s1x, ny + s1y, nz + s1z);
              const o2 = opaqueAt(pad, nx + s2x, ny + s2y, nz + s2z);
              const oc = opaqueAt(pad, nx + s1x + s2x, ny + s1y + s2y, nz + s1z + s2z);
              if (aoEnabled) ao = o1 && o2 ? 0 : 3 - (o1 + o2 + oc);
              if (!o1) { sky += skyAt(nx + s1x, ny + s1y, nz + s1z); skyN++; }
              if (!o2) { sky += skyAt(nx + s2x, ny + s2y, nz + s2z); skyN++; }
              if (!oc && !(o1 && o2)) { sky += skyAt(nx + s1x + s2x, ny + s1y + s2y, nz + s1z + s2z); skyN++; }
            }
            const shade = AO_CURVE[ao] * face.shade;
            lights[c * 2] = shade;
            lights[c * 2 + 1] = sky / skyN / 15;
            if (c === 0) a0 = ao; else if (c === 1) a1 = ao; else if (c === 2) a2 = ao; else a3 = ao;
          }

          // UVs: corners 0..3 map to (u0,v0) (u1,v0) (u1,v1) (u0,v1) for side faces (v up).
          uvs[0] = u0; uvs[1] = v0; uvs[2] = u1; uvs[3] = v0;
          uvs[4] = u1; uvs[5] = v1; uvs[6] = u0; uvs[7] = v1;
          if (isWater && waterTopOpen && face.n[1] === 0) {
            const dv = (v1 - v0) * (1 - WATER_TOP);
            uvs[5] = v1 - dv; uvs[7] = v1 - dv;
          }
          builder.quad(corner, uvs, lights, a0 + a2 < a1 + a3);
        }
      }
    }
  }

  return { opaque: opaqueB.finish(), transparent: transB.finish() };

  function emitCross(id: number, x: number, y: number, z: number): void {
    const tile = BLOCK_TILES[id * 3 + 2];
    const [u0, v0, u1, v1] = tileRect(tile);
    const s = skyAt(x, y, z) / 15;
    const l = [0.9, s, 0.9, s, 0.9, s, 0.9, s];
    const uv = [u0, v0, u1, v0, u1, v1, u0, v1];
    const a = 0.15;
    const b = 0.85;
    // Two diagonal planes, each emitted in both windings so they're visible from both sides.
    const planes = [
      [x + a, y, z + a, x + b, y, z + b, x + b, y + 1, z + b, x + a, y + 1, z + a],
      [x + b, y, z + b, x + a, y, z + a, x + a, y + 1, z + a, x + b, y + 1, z + b],
      [x + a, y, z + b, x + b, y, z + a, x + b, y + 1, z + a, x + a, y + 1, z + b],
      [x + b, y, z + a, x + a, y, z + b, x + a, y + 1, z + b, x + b, y + 1, z + a],
    ];
    for (const p of planes) opaqueB.quad(p, uv, l, false);
  }
}
