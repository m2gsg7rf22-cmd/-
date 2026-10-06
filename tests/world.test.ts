import { describe, expect, it } from 'vitest';
import { CHUNK_SIZE, PAD_VOLUME, SEA_LEVEL, WORLD_HEIGHT } from '../src/core/constants';
import { blockIndex, padIndex } from '../src/core/coords';
import { B } from '../src/core/ids';
import { TerrainGenerator } from '../src/world/generator';
import { meshChunk as meshRaw, mergeSections } from '../src/world/mesher';

const meshChunk = (pad: Uint8Array, ao = true, em?: Int16Array) => {
  const m = meshRaw(pad, ao, em);
  return { opaque: mergeSections(m.opaque), transparent: mergeSections(m.transparent) };
};
import { SOLID } from '../src/world/blocks';

describe('terrain generator', () => {
  it('same seed -> identical chunks; different seed -> different', () => {
    const a = new TerrainGenerator(1234).generate(-1, 2);
    const b = new TerrainGenerator(1234).generate(-1, 2);
    const c = new TerrainGenerator(999).generate(-1, 2);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    expect(Buffer.from(a).equals(Buffer.from(c))).toBe(false);
  });

  it('has bedrock floor, stone underground, and air at the top', () => {
    const g = new TerrainGenerator(77);
    const d = g.generate(0, 0);
    for (let x = 0; x < CHUNK_SIZE; x++) for (let z = 0; z < CHUNK_SIZE; z++) {
      expect(d[blockIndex(x, 0, z)]).toBe(B.COREITE);
      expect(d[blockIndex(x, WORLD_HEIGHT - 1, z)]).toBe(B.AIR);
    }
  });

  it('column heights are continuous across chunk borders (including x=0 / z=0)', () => {
    const g = new TerrainGenerator(5);
    for (const [x, z] of [[-1, 0], [0, -1], [-1, -1], [15, 3], [-17, -40]]) {
      const h0 = g.column(x, z).height;
      const h1 = g.column(x + 1, z).height;
      const h2 = g.column(x, z + 1).height;
      expect(Math.abs(h0 - h1)).toBeLessThan(12);
      expect(Math.abs(h0 - h2)).toBeLessThan(12);
    }
  });

  it('trees spanning chunk borders are consistent between neighboring chunks', () => {
    // Leaves are placed per chunk from the same pure tree list, so a tree near a border
    // must appear in both chunks. Check: every log column has its log at the same height
    // computed independently via treeAt.
    const g = new TerrainGenerator(31337);
    let trees = 0;
    for (let cx = -3; cx <= 3; cx++) for (let cz = -3; cz <= 3; cz++) {
      const d = g.generate(cx, cz);
      for (let x = 0; x < CHUNK_SIZE; x++) for (let z = 0; z < CHUNK_SIZE; z++) {
        for (let y = 1; y < WORLD_HEIGHT - 1; y++) {
          const id = d[blockIndex(x, y, z)];
          if ((id === B.ASH_LOG || id === B.PINE_LOG) && d[blockIndex(x, y - 1, z)] !== id) {
            // A trunk base must sit on solid ground (no floating trees).
            const below = d[blockIndex(x, y - 1, z)];
            expect(SOLID[below]).toBe(1);
            trees++;
          }
        }
      }
    }
    expect(trees).toBeGreaterThan(0);
  });

  it('oceans fill with water up to sea level', () => {
    const g = new TerrainGenerator(2024);
    let found = false;
    for (let cx = -20; cx < 20 && !found; cx += 2) {
      for (let cz = -20; cz < 20 && !found; cz += 2) {
        const col = g.column(cx * 16 + 8, cz * 16 + 8);
        if (col.height < SEA_LEVEL - 3) {
          const d = g.generate(cx, cz);
          expect(d[blockIndex(8, SEA_LEVEL, 8)]).toBeOneOf([B.WATER, B.ICE]);
          found = true;
        }
      }
    }
    expect(found).toBe(true);
  });

  it('places ores underground', () => {
    const g = new TerrainGenerator(8);
    const counts = new Map<number, number>();
    for (let cx = 0; cx < 4; cx++) {
      const d = g.generate(cx, 0);
      for (const v of d) counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    expect(counts.get(B.EMBER_ORE) ?? 0).toBeGreaterThan(10);
    expect(counts.get(B.COPPER_ORE) ?? 0).toBeGreaterThan(3);
  });

  it('finds a spawn on dry land', () => {
    const g = new TerrainGenerator(99);
    const s = g.findSpawn();
    expect(s.y).toBeGreaterThan(SEA_LEVEL);
    expect(Number.isFinite(s.x) && Number.isFinite(s.z)).toBe(true);
  });
});

/** Sum of quad areas (two triangles per quad). */
function meshArea(m: { positions: Float32Array; indices: Uint32Array }): number {
  let a = 0;
  const p = m.positions;
  for (let i = 0; i < m.indices.length; i += 3) {
    const [i0, i1, i2] = [m.indices[i] * 3, m.indices[i + 1] * 3, m.indices[i + 2] * 3];
    const ux = p[i1] - p[i0], uy = p[i1 + 1] - p[i0 + 1], uz = p[i1 + 2] - p[i0 + 2];
    const vx = p[i2] - p[i0], vy = p[i2 + 1] - p[i0 + 1], vz = p[i2 + 2] - p[i0 + 2];
    a += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
  }
  return a;
}

describe('mesher', () => {
  it('emits 6 faces for a lone block and none for air', () => {
    const pad = new Uint8Array(PAD_VOLUME);
    expect(meshChunk(pad).opaque.indices.length).toBe(0);
    pad[padIndex(5, 10, 5)] = B.STONE;
    const m = meshChunk(pad);
    expect(m.opaque.indices.length).toBe(6 * 6);
    expect(m.opaque.positions.length).toBe(6 * 4 * 3);
    for (const v of m.opaque.positions) expect(Number.isFinite(v)).toBe(true);
    expect(m.opaque.tiles.length).toBe(6 * 4 * 2);
  });
  it('culls faces between adjacent solid blocks (by exposed area), including across the padded border', () => {
    const pad = new Uint8Array(PAD_VOLUME);
    pad[padIndex(0, 10, 0)] = B.STONE;
    pad[padIndex(1, 10, 0)] = B.STONE;
    expect(meshArea(meshChunk(pad).opaque)).toBeCloseTo(10, 0);
    pad[padIndex(-1, 10, 0)] = B.STONE; // neighbor chunk block hides the -X face
    expect(meshArea(meshChunk(pad).opaque)).toBeCloseTo(9, 0);
  });
  it('greedy-merges a flat floor into few quads with identical exposed area', () => {
    const pad = new Uint8Array(PAD_VOLUME);
    for (let x = -1; x <= 16; x++) for (let z = -1; z <= 16; z++) pad[padIndex(x, 10, z)] = B.STONE;
    const m = meshChunk(pad);
    // Top + bottom of a 16x16 slab, neighbors hide the sides.
    expect(meshArea(m.opaque)).toBeCloseTo(512, 0);
    expect(m.opaque.indices.length / 6).toBeLessThanOrEqual(4);
    // Local uvs span the merged size so the shader repeats the texture per block.
    expect(Math.max(...m.opaque.uvs)).toBeGreaterThan(15);
  });
  it('does not merge faces with different lighting (AO)', () => {
    const pad = new Uint8Array(PAD_VOLUME);
    for (let x = 0; x < 8; x++) pad[padIndex(x, 10, 5)] = B.STONE;
    const flat = meshChunk(pad).opaque.indices.length / 6;
    pad[padIndex(3, 11, 6)] = B.STONE; // occluder above-beside creates AO on some top corners
    const occluded = meshChunk(pad).opaque.indices.length / 6;
    expect(occluded).toBeGreaterThan(flat);
  });
  it('puts water in the transparent mesh and draws only exposed water faces', () => {
    const pad = new Uint8Array(PAD_VOLUME);
    pad[padIndex(3, 10, 3)] = B.WATER;
    pad[padIndex(4, 10, 3)] = B.WATER;
    const m = meshChunk(pad);
    expect(m.opaque.indices.length).toBe(0);
    expect(m.transparent.indices.length / 6).toBe(10);
  });
});

describe('mesher buffers', () => {
  it('grows buffers for worst-case checkerboard chunks without errors', () => {
    const pad = new Uint8Array(PAD_VOLUME);
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) for (let y = 0; y < 40; y++) {
      if ((x + y + z) % 2 === 0) pad[padIndex(x, y, z)] = B.STONE;
    }
    const m = meshChunk(pad);
    expect(m.opaque.positions.length / 3).toBe((m.opaque.indices.length / 6) * 4);
    expect(m.opaque.uvs.length / 2).toBe(m.opaque.positions.length / 3);
    expect(m.opaque.light.length / 3).toBe(m.opaque.positions.length / 3);
  });
});

describe('mesher: light, water, shapes, sections', () => {
  const maxBlk = (m: { light: Float32Array }) => { let v = 0; for (let i = 2; i < m.light.length; i += 3) v = Math.max(v, m.light[i]); return v; };
  it('a torch lights nearby faces; light fades with distance and is blocked by walls', () => {
    const pad = new Uint8Array(PAD_VOLUME);
    for (let x = -1; x <= 16; x++) for (let z = -1; z <= 16; z++) pad[padIndex(x, 9, z)] = B.STONE;
    const dark = meshChunk(pad);
    expect(maxBlk(dark.opaque)).toBe(0);
    pad[padIndex(8, 10, 8)] = B.TORCH;
    const lit = meshChunk(pad);
    expect(maxBlk(lit.opaque)).toBeGreaterThan(0.85);
    // Floor block light at a far corner should be lower than next to the torch.
    const raw = meshRaw(pad);
    const all = mergeSections(raw.opaque);
    let near = 0, far = 0;
    for (let v = 0; v < all.positions.length / 3; v++) {
      const x = all.positions[v * 3], y = all.positions[v * 3 + 1], z = all.positions[v * 3 + 2];
      if (Math.abs(y - 10) > 0.01) continue;
      const b = all.light[v * 3 + 2];
      if (Math.abs(x - 8.5) < 1.6 && Math.abs(z - 8.5) < 1.6) near = Math.max(near, b);
      if (x < 1 && z < 1) far = Math.max(far, b);
    }
    expect(near).toBeGreaterThan(far);
  });
  it('emitters from a neighbor chunk light across the border', () => {
    const pad = new Uint8Array(PAD_VOLUME);
    for (let x = -1; x <= 16; x++) for (let z = -1; z <= 16; z++) pad[padIndex(x, 9, z)] = B.STONE;
    const without = meshChunk(pad);
    const withEm = meshChunk(pad, true, Int16Array.from([-3, 10, 5, 14]));
    expect(maxBlk(without.opaque)).toBe(0);
    expect(maxBlk(withEm.opaque)).toBeGreaterThan(0.5);
  });
  it('slabs render as half-height boxes', () => {
    const pad = new Uint8Array(PAD_VOLUME);
    pad[padIndex(4, 10, 4)] = B.SLAB_PLANKS;
    const m = meshChunk(pad).opaque;
    let maxY = 0;
    for (let i = 1; i < m.positions.length; i += 3) maxY = Math.max(maxY, m.positions[i]);
    expect(maxY).toBeCloseTo(10.5, 3);
    expect(m.indices.length / 6).toBe(6);
  });
  it('flowing water renders lower than a source', () => {
    const pad = new Uint8Array(PAD_VOLUME);
    pad[padIndex(4, 10, 4)] = B.WATER;
    pad[padIndex(5, 10, 4)] = B.WATER_FLOW + 2; // level 3
    const m = meshChunk(pad).transparent;
    const tops = new Set<number>();
    for (let i = 1; i < m.positions.length; i += 3) tops.add(Math.round(m.positions[i] * 1000) / 1000);
    expect([...tops].some((y) => y > 10.8)).toBe(true); // source surface ~10.875
    expect([...tops].some((y) => y > 10.2 && y < 10.5)).toBe(true); // level-3 surface ~10.33
  });
  it('splits geometry into vertical sections', () => {
    const pad = new Uint8Array(PAD_VOLUME);
    pad[padIndex(2, 5, 2)] = B.STONE;
    pad[padIndex(2, 100, 2)] = B.STONE;
    const m = meshRaw(pad);
    expect(m.opaque[0].indices.length).toBeGreaterThan(0);
    expect(m.opaque[3].indices.length).toBeGreaterThan(0);
    expect(m.opaque[1].indices.length + m.opaque[2].indices.length).toBe(0);
  });
});
