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
  return { getBlock, isSolid: (x: number, y: number, z: number) => SOLID[getBlock(x, y, z)] === 1 } as unknown as World;
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
