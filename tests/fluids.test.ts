import { describe, expect, it } from 'vitest';
import { B, isWaterId, waterLevel } from '../src/core/ids';
import { FluidSim, type FluidWorld } from '../src/world/fluids';

/** Tiny sparse world: stone floor at y=0 within |x|,|z| <= 20, air elsewhere. */
function makeWorld() {
  const cells = new Map<string, number>();
  const k = (x: number, y: number, z: number) => `${x},${y},${z}`;
  let sim: FluidSim;
  const w: FluidWorld = {
    getBlock: (x, y, z) => cells.get(k(x, y, z)) ?? (y <= 0 && Math.abs(x) <= 20 && Math.abs(z) <= 20 ? B.STONE : B.AIR),
    setBlock: (x, y, z, id) => {
      cells.set(k(x, y, z), id);
      sim?.touch(x, y, z);
      return true;
    },
  };
  sim = new FluidSim(w);
  return { w, sim, run: (steps = 200) => { for (let i = 0; i < steps && sim.pending; i++) sim.step(); } };
}

describe('water flow', () => {
  it('a source spreads 7 blocks over flat ground with decreasing levels', () => {
    const { w, run } = makeWorld();
    w.setBlock(0, 1, 0, B.WATER);
    run();
    expect(waterLevel(w.getBlock(1, 1, 0))).toBe(7);
    expect(waterLevel(w.getBlock(3, 1, 0))).toBe(5);
    expect(waterLevel(w.getBlock(7, 1, 0))).toBe(1);
    expect(w.getBlock(8, 1, 0)).toBe(B.AIR);
  });
  it('falls down before spreading', () => {
    const { w, run } = makeWorld();
    w.setBlock(0, 6, 0, B.WATER);
    w.setBlock(0, 5, 0, B.AIR);
    run();
    for (let y = 1; y < 6; y++) expect(isWaterId(w.getBlock(0, y, 0))).toBe(true);
    expect(isWaterId(w.getBlock(1, 4, 0))).toBe(false); // not spreading mid-air
    expect(isWaterId(w.getBlock(1, 1, 0))).toBe(true); // spreads on the floor
  });
  it('flowing water dries up when its source is removed', () => {
    const { w, run } = makeWorld();
    w.setBlock(0, 1, 0, B.WATER);
    run();
    w.setBlock(0, 1, 0, B.AIR);
    run(400);
    for (let x = -8; x <= 8; x++) expect(isWaterId(w.getBlock(x, 1, 0))).toBe(false);
  });
  it('two adjacent sources create a new source between them', () => {
    const { w, run } = makeWorld();
    w.setBlock(0, 1, 0, B.WATER);
    w.setBlock(2, 1, 0, B.WATER);
    run();
    expect(w.getBlock(1, 1, 0)).toBe(B.WATER);
  });
  it('flowing into a hole fills it and stays bounded', () => {
    const { w, run } = makeWorld();
    w.setBlock(5, 0, 5, B.AIR);
    w.setBlock(4, 1, 5, B.WATER);
    run();
    expect(isWaterId(w.getBlock(5, 0, 5))).toBe(true);
  });
});
