import { describe, expect, it } from 'vitest';
import { blockIndex, chunkKey, floorDiv, mod, parseChunkKey, toChunk, toLocal } from '../src/core/coords';
import { CHUNK_SIZE, CHUNK_VOLUME, WORLD_HEIGHT } from '../src/core/constants';
import { seedFromString, Simplex, hash2 } from '../src/core/noise';

describe('coordinates', () => {
  it('converts world to chunk coords, including negatives', () => {
    expect(toChunk(0)).toBe(0);
    expect(toChunk(15)).toBe(0);
    expect(toChunk(16)).toBe(1);
    expect(toChunk(-1)).toBe(-1);
    expect(toChunk(-16)).toBe(-1);
    expect(toChunk(-17)).toBe(-2);
    expect(toChunk(-0.5)).toBe(-1);
  });
  it('converts world to local coords, including negatives', () => {
    expect(toLocal(0)).toBe(0);
    expect(toLocal(17)).toBe(1);
    expect(toLocal(-1)).toBe(15);
    expect(toLocal(-16)).toBe(0);
    expect(toLocal(-17)).toBe(15);
    expect(toLocal(-0.2)).toBe(15);
  });
  it('round trips world -> chunk/local -> world for a range crossing 0', () => {
    for (let w = -70; w <= 70; w++) expect(toChunk(w) * CHUNK_SIZE + toLocal(w)).toBe(w);
  });
  it('mod and floorDiv handle negatives', () => {
    expect(mod(-1, 16)).toBe(15);
    expect(floorDiv(-1, 16)).toBe(-1);
  });
  it('chunk keys round trip', () => {
    expect(parseChunkKey(chunkKey(-3, 12))).toEqual([-3, 12]);
  });
  it('block indices are unique and in range', () => {
    const seen = new Set<number>();
    for (let x = 0; x < CHUNK_SIZE; x++) for (let z = 0; z < CHUNK_SIZE; z++) for (const y of [0, 1, WORLD_HEIGHT - 1]) {
      const i = blockIndex(x, y, z);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(CHUNK_VOLUME);
      expect(seen.has(i)).toBe(false);
      seen.add(i);
    }
  });
});

describe('seeded noise', () => {
  it('seed strings hash deterministically', () => {
    expect(seedFromString('forge')).toBe(seedFromString('forge'));
    expect(seedFromString('forge')).not.toBe(seedFromString('forgf'));
    expect(seedFromString('12345')).toBe(12345);
  });
  it('simplex is deterministic per seed and bounded', () => {
    const a = new Simplex(42), b = new Simplex(42), c = new Simplex(43);
    let diff = 0;
    for (let i = 0; i < 200; i++) {
      const x = i * 0.37 - 30, y = i * 0.11 + 4;
      expect(a.noise2(x, y)).toBe(b.noise2(x, y));
      const v = a.noise3(x, y, x * 0.5);
      expect(Math.abs(v)).toBeLessThanOrEqual(1.01);
      if (a.noise2(x, y) !== c.noise2(x, y)) diff++;
    }
    expect(diff).toBeGreaterThan(150);
  });
  it('hash2 is in [0,1) and deterministic', () => {
    for (let i = -50; i < 50; i++) {
      const h = hash2(7, i, -i * 3);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(1);
      expect(hash2(7, i, -i * 3)).toBe(h);
    }
  });
});
