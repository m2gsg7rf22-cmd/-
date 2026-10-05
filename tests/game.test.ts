import { describe, expect, it } from 'vitest';
import { B, I, toolId } from '../src/core/ids';
import { Inventory } from '../src/game/inventory';
import { craft, RECIPES, type Station } from '../src/game/crafting';
import { applyPreset, defaultSettings, sanitizeSettings } from '../src/game/settings';
import { decodeRLE, encodeRLE, validateMeta } from '../src/save/serialize';
import { CHUNK_VOLUME } from '../src/core/constants';
import { TerrainGenerator } from '../src/world/generator';

const recipe = (id: string) => RECIPES.find((r) => r.id === id)!;
const stations = (...s: Station[]) => new Set<Station>(s);

describe('inventory', () => {
  it('stacks up to max and spills into new slots', () => {
    const inv = new Inventory();
    expect(inv.add(B.DIRT, 70)).toBe(0);
    expect(inv.slots[0]).toEqual({ id: B.DIRT, count: 64 });
    expect(inv.slots[1]).toEqual({ id: B.DIRT, count: 6 });
    inv.add(B.DIRT, 10);
    expect(inv.slots[1]!.count).toBe(16);
    expect(inv.count(B.DIRT)).toBe(80);
  });
  it('tools do not stack and get durability', () => {
    const inv = new Inventory();
    inv.add(toolId('pickaxe', 0), 2);
    expect(inv.slots[0]!.count).toBe(1);
    expect(inv.slots[1]!.count).toBe(1);
    expect(inv.slots[0]!.dur).toBeGreaterThan(0);
  });
  it('reports overflow when full', () => {
    const inv = new Inventory(2);
    expect(inv.add(B.STONE, 200)).toBe(200 - 128);
  });
  it('moves, swaps and merges slots', () => {
    const inv = new Inventory();
    inv.slots[0] = { id: B.DIRT, count: 10 };
    inv.slots[1] = { id: B.SAND, count: 5 };
    inv.move(0, 1);
    expect(inv.slots[0]).toEqual({ id: B.SAND, count: 5 });
    expect(inv.slots[1]).toEqual({ id: B.DIRT, count: 10 });
    inv.slots[2] = { id: B.DIRT, count: 60 };
    inv.move(1, 2); // merge 4 into 60 -> 64, 6 left
    expect(inv.slots[2]!.count).toBe(64);
    expect(inv.slots[1]!.count).toBe(6);
    inv.move(1, 20); // move to empty
    expect(inv.slots[1]).toBeNull();
    expect(inv.slots[20]!.count).toBe(6);
  });
  it('splits stacks', () => {
    const inv = new Inventory();
    inv.slots[0] = { id: B.DIRT, count: 9 };
    expect(inv.split(0, 5)).toBe(true);
    expect(inv.slots[0]!.count + inv.slots[5]!.count).toBe(9);
    expect(inv.split(0, 5)).toBe(false);
  });
  it('removes across stacks and refuses when insufficient', () => {
    const inv = new Inventory();
    inv.add(B.PLANKS, 70);
    expect(inv.remove(B.PLANKS, 100)).toBe(false);
    expect(inv.count(B.PLANKS)).toBe(70);
    expect(inv.remove(B.PLANKS, 68)).toBe(true);
    expect(inv.count(B.PLANKS)).toBe(2);
  });
  it('tool wear breaks the tool', () => {
    const inv = new Inventory();
    inv.add(toolId('axe', 0), 1);
    const d = inv.slots[0]!.dur!;
    for (let i = 0; i < d - 1; i++) expect(inv.wear(0)).toBe(false);
    expect(inv.wear(0)).toBe(true);
    expect(inv.slots[0]).toBeNull();
  });
  it('serializes and ignores corrupt entries', () => {
    const inv = new Inventory();
    inv.add(B.STONE, 3);
    inv.add(toolId('blade', 2), 1);
    const back = Inventory.fromJSON(JSON.parse(JSON.stringify(inv.toJSON())));
    expect(back.toJSON()).toEqual(inv.toJSON());
    const bad = Inventory.fromJSON([{ id: 99999, count: 3 }, { id: B.DIRT, count: -2 }, 'x', { id: B.DIRT, count: 5 }]);
    expect(bad.slots[0]).toBeNull();
    expect(bad.slots[1]).toBeNull();
    expect(bad.slots[3]).toEqual({ id: B.DIRT, count: 5 });
  });
});

describe('crafting', () => {
  it('log -> planks -> sticks consumes inputs and produces outputs', () => {
    const inv = new Inventory();
    inv.add(B.ASH_LOG, 1);
    expect(craft(inv, recipe('planks_ash'), stations())).toBe(true);
    expect(inv.count(B.ASH_LOG)).toBe(0);
    expect(inv.count(B.PLANKS)).toBe(4);
    expect(craft(inv, recipe('sticks'), stations())).toBe(true);
    expect(inv.count(B.PLANKS)).toBe(2);
    expect(inv.count(I.STICK)).toBe(4);
  });
  it('fails without ingredients (no side effects)', () => {
    const inv = new Inventory();
    inv.add(B.PLANKS, 1);
    expect(craft(inv, recipe('bench'), stations())).toBe(false);
    expect(inv.count(B.PLANKS)).toBe(1);
  });
  it('requires the right station', () => {
    const inv = new Inventory();
    inv.add(B.PLANKS, 3);
    inv.add(I.STICK, 2);
    expect(craft(inv, recipe('pickaxe_0'), stations())).toBe(false);
    expect(craft(inv, recipe('pickaxe_0'), stations('bench'))).toBe(true);
    expect(inv.count(toolId('pickaxe', 0))).toBe(1);
    inv.add(I.RAW_COPPER, 1);
    inv.add(I.EMBER, 1);
    expect(craft(inv, recipe('copper_ingot'), stations('bench'))).toBe(false);
    expect(craft(inv, recipe('copper_ingot'), stations('kiln'))).toBe(true);
    expect(inv.count(I.COPPER_INGOT)).toBe(1);
  });
  it('rolls back when output does not fit', () => {
    const inv = new Inventory(1);
    inv.slots[0] = { id: B.ASH_LOG, count: 2 };
    // 1 log consumed, but 4 planks need a slot that isn't there (slot still has 1 log)
    expect(craft(inv, recipe('planks_ash'), stations())).toBe(false);
    expect(inv.slots[0]).toEqual({ id: B.ASH_LOG, count: 2 });
  });
  it('every recipe references known items', () => {
    for (const r of RECIPES) {
      expect(r.out.count).toBeGreaterThan(0);
      for (const [, n] of r.ingredients) expect(n).toBeGreaterThan(0);
    }
  });
});

describe('save serialization', () => {
  it('RLE round-trips a generated chunk and compresses it', () => {
    const data = new TerrainGenerator(3).generate(2, -5);
    const rle = encodeRLE(data);
    expect(rle.length).toBeLessThan(data.length / 4);
    expect(Buffer.from(decodeRLE(rle)).equals(Buffer.from(data))).toBe(true);
  });
  it('RLE handles runs longer than 255 and rejects corruption', () => {
    const data = new Uint8Array(CHUNK_VOLUME);
    data[1000] = 7;
    expect(decodeRLE(encodeRLE(data))[1000]).toBe(7);
    expect(() => decodeRLE(new Uint8Array([5]))).toThrow();
    expect(() => decodeRLE(new Uint8Array([5, 1]))).toThrow();
  });
  it('validates world meta and clamps bad values', () => {
    expect(validateMeta(null)).toBeNull();
    expect(validateMeta({ id: 'x' })).toBeNull();
    const m = validateMeta({
      id: 'w1', name: 'Test', seedNum: 5, mode: 'creative', time: 1.25,
      player: { x: 1, y: 70, z: 2, health: 99, pitch: 9, inventory: [] },
    })!;
    expect(m.mode).toBe('creative');
    expect(m.time).toBeCloseTo(0.25);
    expect(m.player!.health).toBe(20);
    expect(m.player!.pitch).toBeLessThanOrEqual(1.55);
    expect(JSON.parse(JSON.stringify(m))).toEqual(m);
  });
});

describe('settings', () => {
  it('sanitizes corrupt values to defaults', () => {
    const s = sanitizeSettings({ renderDistance: 'far', fov: 999, quality: 'insane', invertY: 'yes', mouseSens: 2 });
    const d = defaultSettings();
    expect(s.renderDistance).toBe(d.renderDistance);
    expect(s.fov).toBe(110);
    expect(s.quality).toBe(d.quality);
    expect(s.invertY).toBe(false);
    expect(s.mouseSens).toBe(2);
    expect(sanitizeSettings('garbage')).toEqual(d);
  });
  it('presets change render distance', () => {
    const s = applyPreset(defaultSettings(), 'low');
    expect(s.renderDistance).toBe(4);
    expect(applyPreset(s, 'ultra').renderDistance).toBeGreaterThan(8);
  });
});
