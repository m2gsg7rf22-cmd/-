import { describe, expect, it } from 'vitest';
import { B } from '../src/core/ids';
import { Player } from '../src/player/player';
import { SOLID } from '../src/world/blocks';
import type { World } from '../src/world/world';
import type { InputManager } from '../src/input/input';

/** Flat world: solid below y=0, optional water column region. */
function fakeWorld(opts: { waterBelow?: number } = {}): World {
  const getBlock = (_x: number, y: number, _z?: number) => {
    const fy = Math.floor(y);
    if (fy < 0) return B.STONE;
    if (opts.waterBelow !== undefined && fy < opts.waterBelow) return B.WATER;
    return B.AIR;
  };
  const isSolid = (x: number, y: number, z: number) => SOLID[getBlock(x, y, z)] === 1;
  return { getBlock, isSolid, collisionAt: isSolid } as unknown as World;
}

function fakeInput(o: Partial<{ x: number; y: number; jump: boolean; sprint: boolean }> = {}): InputManager {
  return { moveVector: () => ({ x: o.x ?? 0, y: o.y ?? 0 }), jump: !!o.jump, sprint: !!o.sprint, descend: false } as unknown as InputManager;
}

function makePlayer() {
  const ev = { damage: [] as [number, string][], deaths: [] as string[], lands: [] as number[] };
  const p = new Player({
    step() {}, jump() {}, splash() {},
    land: (f) => ev.lands.push(f),
    damage: (a, c) => ev.damage.push([a, c]),
    death: (c) => ev.deaths.push(c),
  });
  return { p, ev };
}

function run(p: Player, w: World, inp: InputManager, seconds: number, dt = 1 / 60) {
  for (let t = 0; t < seconds; t += dt) p.update(dt, inp, w);
}

describe('player survival rules', () => {
  it('no fall damage from a short drop (3 blocks)', () => {
    const { p, ev } = makePlayer();
    p.setPosition(0.5, 3, 0.5);
    run(p, fakeWorld(), fakeInput(), 2);
    expect(p.onGround).toBe(true);
    expect(ev.damage.length).toBe(0);
  });
  it('fall damage scales with height', () => {
    const { p, ev } = makePlayer();
    p.setPosition(0.5, 12, 0.5);
    run(p, fakeWorld(), fakeInput(), 3);
    expect(ev.damage.length).toBe(1);
    expect(ev.damage[0]).toEqual([9, 'fall']);
    expect(p.health).toBeGreaterThanOrEqual(11); // may regen 1 while the test runs on
    expect(p.health).toBeLessThanOrEqual(12);
  });
  it('falling into deep water prevents damage', () => {
    const { p, ev } = makePlayer();
    p.setPosition(0.5, 30, 0.5);
    run(p, fakeWorld({ waterBelow: 6 }), fakeInput(), 4);
    expect(ev.damage.filter(([, c]) => c === 'fall').length).toBe(0);
  });
  it('lethal fall kills and respawn restores full state', () => {
    const { p, ev } = makePlayer();
    p.spawn = { x: 0.5, y: 0, z: 0.5 };
    p.setPosition(0.5, 60, 0.5);
    run(p, fakeWorld(), fakeInput(), 5);
    expect(p.dead).toBe(true);
    expect(ev.deaths).toEqual(['fall']);
    p.respawn();
    expect(p.dead).toBe(false);
    expect(p.health).toBe(20);
    expect(p.body.y).toBe(0);
  });
  it('creative mode takes no damage and never gets hungry', () => {
    const { p, ev } = makePlayer();
    p.creative = true;
    p.setPosition(0.5, 60, 0.5);
    run(p, fakeWorld(), fakeInput({ y: 1, sprint: true }), 5);
    expect(ev.damage.length).toBe(0);
    expect(p.hunger).toBe(20);
  });
  it('sprinting drains hunger faster than walking', () => {
    const walk = makePlayer().p;
    const sprint = makePlayer().p;
    for (const p of [walk, sprint]) { p.setPosition(0.5, 0, 0.5); p.saturation = 0; }
    run(walk, fakeWorld(), fakeInput({ y: 1 }), 60);
    run(sprint, fakeWorld(), fakeInput({ y: 1, sprint: true }), 60);
    expect(sprint.hunger).toBeLessThan(walk.hunger);
    expect(walk.hunger).toBeLessThan(20);
  });
  it('regenerates health when well fed, starves when empty', () => {
    const { p } = makePlayer();
    p.setPosition(0.5, 0, 0.5);
    p.health = 10;
    run(p, fakeWorld(), fakeInput(), 10);
    expect(p.health).toBeGreaterThan(10);
    const s = makePlayer();
    s.p.setPosition(0.5, 0, 0.5);
    s.p.hunger = 0;
    s.p.saturation = 0;
    run(s.p, fakeWorld(), fakeInput(), 9);
    expect(s.p.health).toBeLessThan(20);
    expect(s.ev.damage.some(([, c]) => c === 'starve')).toBe(true);
  });
  it('eating restores hunger and refuses when full', () => {
    const { p } = makePlayer();
    expect(p.eat(4)).toBe(false);
    p.hunger = 10;
    expect(p.eat(4)).toBe(true);
    expect(p.hunger).toBe(14);
  });
  it('drowns after running out of air', () => {
    const { p, ev } = makePlayer();
    p.setPosition(0.5, 2, 0.5);
    run(p, fakeWorld({ waterBelow: 20 }), fakeInput(), 14);
    expect(p.air).toBe(0);
    expect(ev.damage.some(([, c]) => c === 'drown')).toBe(true);
  });
  it('jump reaches ~1.25 blocks and lands', () => {
    const { p } = makePlayer();
    p.setPosition(0.5, 0, 0.5);
    run(p, fakeWorld(), fakeInput(), 0.2);
    let maxY = 0;
    const jumpIn = fakeInput({ jump: true });
    for (let i = 0; i < 6; i++) { p.update(1 / 60, jumpIn, fakeWorld()); maxY = Math.max(maxY, p.body.y); }
    for (let i = 0; i < 120; i++) { p.update(1 / 60, fakeInput(), fakeWorld()); maxY = Math.max(maxY, p.body.y); }
    expect(maxY).toBeGreaterThan(1.1);
    expect(maxY).toBeLessThan(1.6);
    expect(p.onGround).toBe(true);
  });
  it('pitch is clamped and yaw stays bounded', () => {
    const { p } = makePlayer();
    p.look(0, -100);
    expect(p.pitch).toBeLessThan(Math.PI / 2);
    for (let i = 0; i < 1000; i++) p.look(1, 0);
    expect(Math.abs(p.yaw)).toBeLessThan(Math.PI * 4 + 1);
  });
});

describe('shaped blocks', () => {
  it('steps up a slab without jumping, and cannot step a full block', () => {
    const slabAt = (x: number) => x >= 2;
    const getBlock = (x: number, y: number, _z?: number) => (Math.floor(y) < 0 ? B.STONE : Math.floor(y) === 0 && slabAt(Math.floor(x)) ? B.SLAB_PLANKS : B.AIR);
    const collisionAt = (x: number, y: number, z: number) => {
      const id = getBlock(x, y, z);
      if (id === B.STONE) return true;
      if (id === B.SLAB_PLANKS) return [[0, 0, 0, 1, 0.5, 1]];
      return null;
    };
    const w = { getBlock, isSolid: (x: number, y: number, z: number) => !!collisionAt(x, y, z), collisionAt } as unknown as World;
    const { p } = makePlayer();
    p.autoJump = false;
    p.setPosition(0.5, 0, 0.5);
    p.yaw = -Math.PI / 2; // face +x
    run(p, w, fakeInput({ y: 1 }), 1.5);
    expect(p.body.x).toBeGreaterThan(3);
    expect(p.body.y).toBeCloseTo(0.5, 2);
    // Full block wall: no step.
    const wallW = fakeWorld();
    const g2 = (x: number, y: number) => (Math.floor(y) < 0 || (Math.floor(x) >= 2 && Math.floor(y) === 0) ? B.STONE : B.AIR);
    const w2 = { ...wallW, getBlock: g2, collisionAt: (x: number, y: number) => g2(x, y) === B.STONE, isSolid: (x: number, y: number) => g2(x, y) === B.STONE } as unknown as World;
    const q = makePlayer().p;
    q.autoJump = false;
    q.setPosition(0.5, 0, 0.5);
    q.yaw = -Math.PI / 2;
    run(q, w2, fakeInput({ y: 1 }), 1.5);
    expect(q.body.x).toBeLessThan(2);
    expect(q.body.y).toBeCloseTo(0, 2);
  });
});
