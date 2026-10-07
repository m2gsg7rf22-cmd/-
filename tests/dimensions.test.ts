import { describe, expect, it } from 'vitest';
import { CHUNK_SIZE, WORLD_HEIGHT } from '../src/core/constants';
import { blockIndex } from '../src/core/coords';
import { B, isRiftId } from '../src/core/ids';
import { buildRift, checkRiftAround, findRift, igniteRift, type PortalWorld } from '../src/game/portals';
import { MOB_KINDS, MOB_SPECS } from '../src/game/mobs';
import { nextPhase } from '../src/game/dragon';
import { RECIPES } from '../src/game/crafting';
import { swingCurve } from '../src/render/handView';
import { validateMeta } from '../src/save/serialize';
import { dimWorldId, EMBER_MAGMA_LEVEL, EMBER_ROOF } from '../src/world/dimension';
import { EmberdeepGenerator } from '../src/world/emberdeep';
import { createGenerator } from '../src/world/generators';
import { VoidreachGenerator } from '../src/world/voidreach';
import { BLOCKS, SELECTION, SOLID } from '../src/world/blocks';
import { TILE_FLAGS, tileBase, tileIndex, tileRect } from '../src/world/tiles';

/** Sparse in-memory world for portal logic. */
class MapWorld implements PortalWorld {
  cells = new Map<string, number>();
  getBlock(x: number, y: number, z: number): number {
    return this.cells.get(`${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`) ?? B.AIR;
  }
  setBlock(x: number, y: number, z: number, id: number): boolean {
    this.cells.set(`${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`, id);
    checkRiftAround(this, x, y, z); // like the game's block-change hook
    return true;
  }
}

function frame(w: MapWorld, x: number, y: number, z: number, wIn = 2, hIn = 3, skip?: [number, number]): void {
  for (let dx = -1; dx <= wIn; dx++) for (let dy = -1; dy <= hIn; dy++) {
    const edge = dx === -1 || dx === wIn || dy === -1 || dy === hIn;
    if (!edge) continue;
    if (skip && skip[0] === dx && skip[1] === dy) continue;
    w.setBlock(x + dx, y + dy, z, B.DUSKSTONE);
  }
}

const count = (w: MapWorld, id: number) => [...w.cells.values()].filter((v) => v === id).length;

describe('rift portals', () => {
  it('lights a closed 2x3 Duskstone frame (corners optional)', () => {
    const w = new MapWorld();
    frame(w, 0, 10, 0);
    w.cells.delete('-1,9,0'); // corners aren't needed
    expect(igniteRift(w, 0, 10, 0)).toBe(true);
    expect(count(w, B.RIFT_X)).toBe(6);
  });

  it('works in the other orientation and for larger frames', () => {
    const w = new MapWorld();
    for (let dz = -1; dz <= 4; dz++) for (let dy = -1; dy <= 5; dy++) {
      if (dz === -1 || dz === 4 || dy === -1 || dy === 5) w.setBlock(3, 20 + dy, dz, B.DUSKSTONE);
    }
    expect(igniteRift(w, 3, 21, 1)).toBe(true);
    expect(count(w, B.RIFT_Z)).toBe(4 * 5);
  });

  it('refuses open, too small or oversized frames', () => {
    const open = new MapWorld();
    frame(open, 0, 10, 0, 2, 3, [2, 1]);
    expect(igniteRift(open, 0, 10, 0)).toBe(false);
    const small = new MapWorld();
    frame(small, 0, 10, 0, 1, 2);
    expect(igniteRift(small, 0, 10, 0)).toBe(false);
    const big = new MapWorld();
    frame(big, 0, 10, 0, 22, 3);
    expect(igniteRift(big, 0, 10, 0)).toBe(false);
    expect([...open.cells.values(), ...small.cells.values(), ...big.cells.values()].some(isRiftId)).toBe(false);
  });

  it('collapses entirely when a frame block is removed', () => {
    const w = new MapWorld();
    frame(w, 0, 10, 0);
    igniteRift(w, 0, 10, 0);
    w.setBlock(2, 11, 0, B.AIR);
    expect(count(w, B.RIFT_X)).toBe(0);
  });

  it('builds an arrival rift on a platform and finds it again', () => {
    const w = new MapWorld();
    const cell = buildRift(w, 5.4, 40, -3.2);
    expect(isRiftId(w.getBlock(cell.x, cell.y, cell.z))).toBe(true);
    expect(SOLID[w.getBlock(cell.x, cell.y - 1, cell.z + 1)]).toBe(1); // landing in front
    const found = findRift(w, 9, 44, 2, 8)!;
    expect([found.y, found.z]).toEqual([cell.y, cell.z]);
    expect([cell.x, cell.x + 1]).toContain(found.x); // nearest bottom cell of the 2-wide rift
  });
});

describe('Emberdeep generator', () => {
  const g = new EmberdeepGenerator(4242);
  it('is deterministic and differs from the overworld', () => {
    const a = g.generate(3, -2);
    const b = new EmberdeepGenerator(4242).generate(3, -2);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    const ow = createGenerator('overworld', 4242).generate(3, -2);
    expect(Buffer.from(a).equals(Buffer.from(ow))).toBe(false);
  });

  it('is sealed by coreite and has a magma sea, caverns and its own materials', () => {
    let magma = 0, air = 0, cinder = 0;
    for (const [cx, cz] of [[0, 0], [1, 0], [0, 1], [-2, 3]]) {
      const d = g.generate(cx, cz);
      for (let x = 0; x < CHUNK_SIZE; x++) for (let z = 0; z < CHUNK_SIZE; z++) {
        expect(d[blockIndex(x, 0, z)]).toBe(B.COREITE);
        expect(d[blockIndex(x, WORLD_HEIGHT - 1, z)]).toBe(B.COREITE);
        for (let y = EMBER_ROOF; y < WORLD_HEIGHT; y++) expect(SOLID[d[blockIndex(x, y, z)]]).toBe(1);
        for (let y = 1; y < EMBER_ROOF; y++) {
          const id = d[blockIndex(x, y, z)];
          if (id === B.MAGMA || id === B.MAGMA_DEEP) {
            magma++;
            expect(y).toBeLessThanOrEqual(EMBER_MAGMA_LEVEL);
          } else if (id === B.AIR) air++;
          else if (id === B.CINDERROCK) cinder++;
        }
      }
    }
    expect(magma).toBeGreaterThan(0);
    expect(air).toBeGreaterThan(2000);
    expect(cinder).toBeGreaterThan(5000);
  });

  it('finds a floor with headroom above the magma sea', () => {
    const s = g.findSpawn();
    expect(s.y).toBeGreaterThan(EMBER_MAGMA_LEVEL + 1);
    expect(g.rockAt(Math.floor(s.x), s.y - 1, Math.floor(s.z))).toBe(true);
    expect(g.rockAt(Math.floor(s.x), s.y, Math.floor(s.z))).toBe(false);
  });

  it('lines up across chunk borders (no seams in the caverns)', () => {
    const a = g.generate(0, 0);
    const b = g.generate(1, 0);
    let same = 0, total = 0;
    for (let z = 0; z < CHUNK_SIZE; z++) for (let y = 4; y < EMBER_ROOF; y++) {
      const ra = SOLID[a[blockIndex(CHUNK_SIZE - 1, y, z)]];
      const rb = SOLID[b[blockIndex(0, y, z)]];
      total++;
      if (ra === rb) same++;
    }
    expect(same / total).toBeGreaterThan(0.85);
  });
});

describe('Voidreach generator', () => {
  const g = new VoidreachGenerator(4242);
  it('has a central island with the plaza, the return gate and void below', () => {
    const s = g.findSpawn();
    const gate = g.gateCell();
    const d = g.generate(0, 0);
    expect(d[blockIndex(gate.x, gate.y, gate.z)]).toBe(B.VOID_GATE);
    expect(d[blockIndex(0, s.y - 1, 0)]).toBe(B.VOID_BRICKS);
    expect(d[blockIndex(0, s.y, 0)]).toBe(B.AIR);
    expect(d[blockIndex(0, 1, 0)]).toBe(B.AIR); // void under the island
  });

  it('is mostly void far out, with outer islands', () => {
    let solid = 0, total = 0;
    for (let cx = 12; cx < 20; cx++) {
      const d = g.generate(cx, 6);
      for (let i = 0; i < d.length; i += 7) { total++; if (d[i]) solid++; }
    }
    expect(solid / total).toBeLessThan(0.2);
  });

  it('places spires and crystals deterministically', () => {
    let crystals = 0;
    for (let cx = -4; cx <= 3; cx++) for (let cz = -4; cz <= 3; cz++) {
      const d = g.generate(cx, cz);
      for (const v of d) if (v === B.VOID_CRYSTAL) crystals++;
    }
    expect(crystals).toBe(8);
  });
});

describe('dimension saves', () => {
  it('stores each dimension under its own chunk id', () => {
    expect(dimWorldId('w1', 'overworld')).toBe('w1');
    expect(dimWorldId('w1', 'emberdeep')).toBe('w1#emberdeep');
  });

  it('validates dimension fields and defaults old saves to the overworld', () => {
    const base = { id: 'a', name: 'A', seedNum: 5, seed: '5' };
    expect(validateMeta(base)!.dim).toBe('overworld');
    const m = validateMeta({ ...base, dim: 'voidreach', dimPos: { overworld: { x: 1, y: 2, z: 3 }, emberdeep: { x: 'bad' } }, emberLink: { x: 1, y: 40, z: 2 }, arrival: 'rift', mobsDim: 'emberdeep', mobs: [{ kind: 'hopper', x: 1, y: 2, z: 3, health: 5 }, { kind: '<script>', x: 1, y: 2, z: 3, health: 5 }] })!;
    expect(m.dim).toBe('voidreach');
    expect(m.dimPos).toEqual({ overworld: { x: 1, y: 2, z: 3 } });
    expect(m.emberLink).toEqual({ x: 1, y: 40, z: 2 });
    expect(m.arrival).toBe('rift');
    expect(m.mobs!.map((x) => x.kind)).toEqual(['hopper']);
    expect(validateMeta({ ...base, dim: 'moon', arrival: 'teleport' })!.dim).toBe('overworld');
  });
});

describe('content', () => {
  it('every creature has sane stats, and every dimension has creatures', () => {
    expect(MOB_KINDS.length).toBe(11);
    expect(MOB_SPECS.dragon.boss).toBe(true);
    for (const k of MOB_KINDS) {
      const s = MOB_SPECS[k];
      expect(s.health).toBeGreaterThan(0);
      expect(s.hw).toBeGreaterThan(0.1);
      if (s.temper) expect(s.damage).toBeGreaterThan(0);
    }
  });

  it('the dimension items can be crafted (striker, void gate)', () => {
    expect(RECIPES.find((r) => r.id === 'ember_striker')).toBeTruthy();
    expect(RECIPES.find((r) => r.id === 'void_gate')!.ingredients.map((i) => i[0])).toContain(B.DUSKSTONE);
  });

  it('rifts are not targetable or solid; magma is not solid', () => {
    expect(SELECTION[B.RIFT_X]).toBeNull();
    expect(SOLID[B.RIFT_Z]).toBe(0);
    expect(SOLID[B.MAGMA]).toBe(0);
    expect(BLOCKS[B.MAGMA].light).toBeGreaterThan(0);
    expect(BLOCKS[B.MAGMA_DEEP].light ?? 0).toBe(0);
  });

  it('tile shader flags are packed above the real uv and decode back', () => {
    const stone = tileIndex('stone');
    const magma = tileIndex('magma');
    expect(TILE_FLAGS[stone] & 1).toBe(1);
    expect(TILE_FLAGS[magma] & 2).toBe(2);
    for (const t of [stone, magma, tileIndex('planks')]) {
      const [u] = tileBase(t);
      const flags = Math.floor(u / 2);
      expect(flags).toBe(TILE_FLAGS[t]);
      expect(u - flags * 2).toBeCloseTo(tileRect(t)[0], 6);
    }
  });

  it('the chop curve winds up, strikes past zero and settles back', () => {
    expect(swingCurve(0)).toBe(0);
    expect(swingCurve(0.15)).toBeLessThan(0);
    expect(swingCurve(0.45)).toBeGreaterThan(1);
    expect(Math.abs(swingCurve(0.999))).toBeLessThan(0.01);
  });
});

describe('Void Dragon and new structures', () => {
  it('picks swoops, breath attacks and perches', () => {
    expect(nextPhase(0.1)).toBe('swoop');
    expect(nextPhase(0.5)).toBe('breath');
    expect(nextPhase(0.9)).toBe('perch');
  });

  it('crystal cells sit exactly on the generated spire tops', () => {
    const g = new VoidreachGenerator(99);
    for (const c of g.crystalCells()) {
      const cx = Math.floor(c.x / CHUNK_SIZE), cz = Math.floor(c.z / CHUNK_SIZE);
      const d = g.generate(cx, cz);
      expect(d[blockIndex(c.x - cx * CHUNK_SIZE, c.y, c.z - cz * CHUNK_SIZE)]).toBe(B.VOID_CRYSTAL);
    }
  });

  it('Voidreach has purpur towers with void rods somewhere in the outer isles', () => {
    const g = new VoidreachGenerator(4242);
    let purpur = 0, rods = 0;
    for (let cx = -24; cx <= 24; cx += 1) for (let cz = -4; cz <= 4; cz += 1) {
      const d = g.generate(cx, cz);
      for (const v of d) { if (v === B.PURPUR || v === B.PURPUR_PILLAR) purpur++; else if (v === B.END_ROD) rods++; }
    }
    expect(purpur).toBeGreaterThan(50);
    expect(rods % 4).toBe(0);
    expect(rods).toBeGreaterThan(0);
  });

  it('Emberdeep has crimson forests and brick bridges', () => {
    const g = new EmberdeepGenerator(4242);
    let crimson = 0, bricks = 0;
    for (let cx = -12; cx <= 12; cx += 2) for (let cz = -12; cz <= 12; cz += 2) {
      const d = g.generate(cx, cz);
      for (const v of d) { if (v === B.CRIMSON_TURF) crimson++; else if (v === B.CINDER_BRICKS) bricks++; }
    }
    expect(crimson).toBeGreaterThan(0);
    expect(bricks).toBeGreaterThan(0);
  });
});
