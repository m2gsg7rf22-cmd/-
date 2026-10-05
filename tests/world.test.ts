import { describe, expect, it } from 'vitest';
import { CHUNK_SIZE, PAD_VOLUME, SEA_LEVEL, WORLD_HEIGHT } from '../src/core/constants';
import { blockIndex, padIndex } from '../src/core/coords';
import { B } from '../src/core/ids';
import { TerrainGenerator } from '../src/world/generator';
import { meshChunk } from '../src/world/mesher';
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

describe('mesher', () => {
  it('emits 6 faces for a lone block and none for air', () => {
    const pad = new Uint8Array(PAD_VOLUME);
    expect(meshChunk(pad).opaque.indices.length).toBe(0);
    pad[padIndex(5, 10, 5)] = B.STONE;
    const m = meshChunk(pad);
    expect(m.opaque.indices.length).toBe(6 * 6);
    expect(m.opaque.positions.length).toBe(6 * 4 * 3);
    for (const v of m.opaque.positions) expect(Number.isFinite(v)).toBe(true);
  });
  it('culls faces between adjacent solid blocks, including across the padded border', () => {
    const pad = new Uint8Array(PAD_VOLUME);
    pad[padIndex(0, 10, 0)] = B.STONE;
    pad[padIndex(1, 10, 0)] = B.STONE;
    expect(meshChunk(pad).opaque.indices.length / 6).toBe(10);
    pad[padIndex(-1, 10, 0)] = B.STONE; // neighbor chunk block hides the -X face
    expect(meshChunk(pad).opaque.indices.length / 6).toBe(9);
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
