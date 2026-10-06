import { describe, expect, it } from 'vitest';
import { blockIntersectsBody, collides, moveBody, unstick, type Body, type SolidFn } from '../src/player/physics';
import { raycastVoxels } from '../src/player/raycast';

const floor: SolidFn = (_x, y) => y < 0;
const body = (x = 0.5, y = 0, z = 0.5): Body => ({ x, y, z, hw: 0.3, h: 1.8 });

describe('collision', () => {
  it('lands on the floor and reports ground', () => {
    const b = body(0.5, 3, 0.5);
    const r = moveBody(b, 0, -5, 0, floor);
    expect(r.onGround).toBe(true);
    expect(b.y).toBe(0);
  });
  it('does not tunnel through a floor at high velocity', () => {
    const b = body(0.5, 50, 0.5);
    moveBody(b, 0, -200, 0, floor);
    expect(b.y).toBe(0);
  });
  it('stops at walls and slides along them diagonally', () => {
    const wall: SolidFn = (x, y) => y < 0 || x >= 3;
    const b = body(0.5, 0, 0.5);
    const r = moveBody(b, 5, 0, 2, wall);
    expect(r.hitX).toBe(true);
    expect(b.x).toBeLessThanOrEqual(3 - 0.3);
    expect(b.x).toBeGreaterThan(2.6);
    expect(b.z).toBeCloseTo(2.5);
    expect(collides(b, wall)).toBe(false);
  });
  it('handles negative coordinates and walls on the negative side', () => {
    const wall: SolidFn = (x, y) => y < 0 || x <= -5;
    const b = body(-2.5, 0, -2.5);
    moveBody(b, -10, 0, 0, wall);
    expect(b.x).toBeCloseTo(-4 + 0.3, 3);
    expect(collides(b, wall)).toBe(false);
  });
  it('bumps head on ceilings', () => {
    const ceil: SolidFn = (_x, y) => y < 0 || y >= 2;
    const b = body();
    const r = moveBody(b, 0, 1, 0, ceil);
    expect(r.hitCeiling).toBe(true);
    expect(b.y + b.h).toBeLessThanOrEqual(2);
  });
  it('fits through a 1-wide gap and a 2-high corridor', () => {
    const corridor: SolidFn = (_x, y, z) => y < 0 || y >= 2 || z !== 0;
    const b = body(0.5, 0, 0.5);
    moveBody(b, 10, 0, 0, corridor);
    expect(b.x).toBeCloseTo(10.5);
  });
  it('corner case: inside corner stops on both axes', () => {
    const corner: SolidFn = (x, y, z) => y < 0 || x >= 2 || z >= 2;
    const b = body();
    moveBody(b, 4, 0, 4, corner);
    expect(b.x).toBeCloseTo(2 - 0.3, 2);
    expect(b.z).toBeCloseTo(2 - 0.3, 2);
  });
  it('placement validation detects overlap with the body', () => {
    const b = body(0.5, 0, 0.5);
    expect(blockIntersectsBody(0, 0, 0, b)).toBe(true);
    expect(blockIntersectsBody(0, 1, 0, b)).toBe(true);
    expect(blockIntersectsBody(0, 2, 0, b)).toBe(false);
    expect(blockIntersectsBody(1, 0, 0, b)).toBe(false);
    expect(blockIntersectsBody(0, -1, 0, b)).toBe(false);
    const edge = body(0.95, 0, 0.5); // overlaps x=1 column
    expect(blockIntersectsBody(1, 0, 0, edge)).toBe(true);
  });
  it('unstick moves a buried body to free space', () => {
    const ground: SolidFn = (_x, y) => y < 10;
    const b = body(0.5, 3, 0.5);
    expect(unstick(b, ground)).toBe(true);
    expect(b.y).toBe(10);
  });
});

describe('raycast', () => {
  it('hits the first solid block with the correct face', () => {
    const solid = (x: number, y: number, z: number) => x === 3 && y === 0 && z === 0;
    const h = raycastVoxels(0.5, 0.5, 0.5, 1, 0, 0, 10, solid)!;
    expect([h.x, h.y, h.z]).toEqual([3, 0, 0]);
    expect([h.nx, h.ny, h.nz]).toEqual([-1, 0, 0]);
  });
  it('works for negative directions/coords and respects max distance', () => {
    const solid = (x: number, y: number) => x === -4 && y === -1;
    const h = raycastVoxels(-0.5, -0.5, 0.5, -1, 0, 0, 10, solid)!;
    expect(h.x).toBe(-4);
    expect(h.nx).toBe(1);
    expect(raycastVoxels(-0.5, -0.5, 0.5, -1, 0, 0, 2, solid)).toBeNull();
  });
  it('detects top face when looking down', () => {
    const solid = (_x: number, y: number) => y < 0;
    const h = raycastVoxels(0.5, 1.6, 0.5, 0.2, -1, 0.1, 5, solid)!;
    expect(h.y).toBe(-1);
    expect(h.ny).toBe(1);
  });
});

import { raycastShapes } from '../src/player/raycast';
describe('raycastShapes', () => {
  it('passes over the empty half of a slab and hits the box top face', () => {
    const slab = [[0, 0, 0, 1, 0.5, 1]];
    const at = (x: number, y: number, z: number) => (x === 2 && y === 0 && z === 0 ? slab : null);
    // Ray skimming at y=0.75 misses the slab entirely.
    expect(raycastShapes(0.5, 0.75, 0.5, 1, 0, 0, 6, at)).toBeNull();
    // Ray going down onto the slab hits its top face (normal +y) at y=0.5.
    const h = raycastShapes(2.5, 2, 0.5, 0, -1, 0, 6, at)!;
    expect([h.x, h.y, h.z, h.ny]).toEqual([2, 0, 0, 1]);
    expect(h.dist).toBeCloseTo(1.5, 5);
  });
  it('matches the DDA result for full cubes', () => {
    const at = (x: number, y: number, z: number) => (x === 3 && y === 0 && z === 0 ? [[0, 0, 0, 1, 1, 1]] : null);
    const h = raycastShapes(0.5, 0.5, 0.5, 1, 0.01, 0, 10, at)!;
    expect([h.x, h.nx]).toEqual([3, -1]);
  });
});
