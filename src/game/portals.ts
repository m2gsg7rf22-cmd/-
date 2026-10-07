import { WORLD_HEIGHT } from '../core/constants';
import { B, isRiftId } from '../core/ids';
import { SOLID } from '../world/blocks';
import { UNLOADED } from '../world/world';

/** Minimal world access the portal logic needs (World implements it; tests use a map). */
export interface PortalWorld {
  getBlock(x: number, y: number, z: number): number;
  setBlock(x: number, y: number, z: number, id: number, immediate?: boolean): boolean;
}

/** Largest interior a rift frame may enclose. */
export const RIFT_MAX = 21;
/** Smallest interior (width x height). */
export const RIFT_MIN_W = 2;
export const RIFT_MIN_H = 3;

type Axis = 'x' | 'z';

/** Set while this module edits rift blocks, so the block-change hook doesn't re-validate half-built sheets. */
let busy = false;
function guarded<T>(fn: () => T): T {
  const was = busy;
  busy = true;
  try {
    return fn();
  } finally {
    busy = was;
  }
}

/** Offsets of the 4 in-plane neighbors for a portal plane. */
function planeDirs(axis: Axis): [number, number, number][] {
  return axis === 'x'
    ? [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0]]
    : [[0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]];
}

/**
 * Flood-fill the open interior of a frame in one vertical plane, starting at (x,y,z).
 * Returns the cells if every boundary is Duskstone and the size is valid, else null.
 */
function frameInterior(w: PortalWorld, x: number, y: number, z: number, axis: Axis, open: (id: number) => boolean): [number, number, number][] | null {
  const dirs = planeDirs(axis);
  const seen = new Set<string>();
  const cells: [number, number, number][] = [];
  const stack: [number, number, number][] = [[x, y, z]];
  let minA = Infinity, maxA = -Infinity, minY = Infinity, maxY = -Infinity;
  while (stack.length) {
    const c = stack.pop()!;
    const key = c.join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    const id = w.getBlock(c[0], c[1], c[2]);
    if (id === B.DUSKSTONE) continue;
    if (!open(id)) return null; // something other than frame borders the interior
    cells.push(c);
    const a = axis === 'x' ? c[0] : c[2];
    minA = Math.min(minA, a); maxA = Math.max(maxA, a);
    minY = Math.min(minY, c[1]); maxY = Math.max(maxY, c[1]);
    if (maxA - minA + 1 > RIFT_MAX || maxY - minY + 1 > RIFT_MAX || cells.length > RIFT_MAX * RIFT_MAX) return null;
    if (c[1] <= 0 || c[1] >= WORLD_HEIGHT - 1) return null;
    for (const d of dirs) stack.push([c[0] + d[0], c[1] + d[1], c[2] + d[2]]);
  }
  if (maxA - minA + 1 < RIFT_MIN_W || maxY - minY + 1 < RIFT_MIN_H) return null;
  return cells;
}

/**
 * Light a rift inside a Duskstone frame that contains the empty cell (x,y,z).
 * Tries both orientations; returns true when a portal was created.
 */
export function igniteRift(w: PortalWorld, x: number, y: number, z: number): boolean {
  return guarded(() => ignite(w, x, y, z));
}

function ignite(w: PortalWorld, x: number, y: number, z: number): boolean {
  const first = w.getBlock(x, y, z);
  if (first !== B.AIR) return false;
  for (const axis of ['x', 'z'] as Axis[]) {
    const cells = frameInterior(w, x, y, z, axis, (id) => id === B.AIR);
    if (!cells) continue;
    const id = axis === 'x' ? B.RIFT_X : B.RIFT_Z;
    for (const [cx, cy, cz] of cells) w.setBlock(cx, cy, cz, id);
    return true;
  }
  return false;
}

/**
 * After a block change next to a rift: if the rift's frame is no longer intact, the rift collapses.
 * Returns the number of rift blocks removed.
 */
export function checkRiftAround(w: PortalWorld, x: number, y: number, z: number): number {
  if (busy) return 0;
  return guarded(() => checkAround(w, x, y, z));
}

function checkAround(w: PortalWorld, x: number, y: number, z: number): number {
  let removed = 0;
  for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1], [0, 0, 0]]) {
    const id = w.getBlock(x + dx, y + dy, z + dz);
    if (!isRiftId(id)) continue;
    const axis: Axis = id === B.RIFT_X ? 'x' : 'z';
    const cells = frameInterior(w, x + dx, y + dy, z + dz, axis, (b) => b === id);
    if (cells) continue;
    // Broken: remove the whole connected rift sheet.
    removed += clearRift(w, x + dx, y + dy, z + dz, id, axis);
  }
  return removed;
}

function clearRift(w: PortalWorld, x: number, y: number, z: number, id: number, axis: Axis): number {
  const dirs = planeDirs(axis);
  const stack: [number, number, number][] = [[x, y, z]];
  let n = 0;
  while (stack.length && n < RIFT_MAX * RIFT_MAX) {
    const [cx, cy, cz] = stack.pop()!;
    if (w.getBlock(cx, cy, cz) !== id) continue;
    w.setBlock(cx, cy, cz, B.AIR);
    n++;
    for (const d of dirs) stack.push([cx + d[0], cy + d[1], cz + d[2]]);
  }
  return n;
}

/** Nearest rift block to (x,y,z) within a box radius; returns its bottom-most cell. */
export function findRift(w: PortalWorld, x: number, y: number, z: number, r: number, ry = 24): { x: number; y: number; z: number } | null {
  const fx = Math.floor(x), fy = Math.floor(y), fz = Math.floor(z);
  let best: { x: number; y: number; z: number } | null = null;
  let bestD = Infinity;
  for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
    const d2 = dx * dx + dz * dz;
    if (d2 >= bestD) continue;
    for (let dy = -ry; dy <= ry; dy++) {
      const yy = fy + dy;
      if (yy < 1 || yy >= WORLD_HEIGHT) continue;
      const id = w.getBlock(fx + dx, yy, fz + dz);
      if (!isRiftId(id) || isRiftId(w.getBlock(fx + dx, yy - 1, fz + dz))) continue;
      const dd = d2 + dy * dy * 0.25;
      if (dd < bestD) {
        bestD = dd;
        best = { x: fx + dx, y: yy, z: fz + dz };
      }
    }
  }
  return best;
}

/**
 * Build a standard 2x3 rift (frame of Duskstone) standing on the floor at (x,y,z) (feet cell),
 * spanning +x. Clears headroom in front/behind and adds a small landing so arrivals never fall
 * into magma or the void. Returns the cell to stand in.
 */
export function buildRift(w: PortalWorld, x: number, y: number, z: number): { x: number; y: number; z: number } {
  return guarded(() => build(w, x, y, z));
}

function build(w: PortalWorld, x: number, y: number, z: number): { x: number; y: number; z: number } {
  const fx = Math.floor(x), fy = Math.max(2, Math.min(WORLD_HEIGHT - 6, Math.floor(y))), fz = Math.floor(z);
  // Landing platform and clear space (3 deep, 4 wide, 4 tall).
  for (let dx = -1; dx <= 2; dx++) for (let dz = -1; dz <= 1; dz++) {
    const below = w.getBlock(fx + dx, fy - 1, fz + dz);
    if (below === UNLOADED) continue;
    if (!SOLID[below]) w.setBlock(fx + dx, fy - 1, fz + dz, B.DUSKSTONE);
    for (let dy = 0; dy < 4; dy++) if (dz !== 0 || dx < 0 || dx > 1) {
      const id = w.getBlock(fx + dx, fy + dy, fz + dz);
      if (id !== UNLOADED && id !== B.AIR && !isRiftId(id)) w.setBlock(fx + dx, fy + dy, fz + dz, B.AIR);
    }
  }
  // Frame: 4 wide x 5 tall around a 2x3 interior at x..x+1, y..y+2.
  for (let dx = -1; dx <= 2; dx++) {
    w.setBlock(fx + dx, fy - 1, fz, B.DUSKSTONE);
    w.setBlock(fx + dx, fy + 3, fz, B.DUSKSTONE);
  }
  for (let dy = 0; dy < 3; dy++) {
    w.setBlock(fx - 1, fy + dy, fz, B.DUSKSTONE);
    w.setBlock(fx + 2, fy + dy, fz, B.DUSKSTONE);
  }
  for (let dx = 0; dx < 2; dx++) for (let dy = 0; dy < 3; dy++) w.setBlock(fx + dx, fy + dy, fz, B.AIR);
  ignite(w, fx, fy, fz);
  return { x: fx, y: fy, z: fz };
}

/** The 12 ring cells (offsets from the ring's center) of a Void Portal frame around its 3x3 hole. */
export const VOID_RING: readonly [number, number][] = (() => {
  const out: [number, number][] = [];
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
    const edge = Math.abs(dx) === 2 || Math.abs(dz) === 2;
    const corner = Math.abs(dx) === 2 && Math.abs(dz) === 2;
    if (edge && !corner) out.push([dx, dz]);
  }
  return out;
})();

/**
 * Put a Void Eye into the frame at (x,y,z). If that completes a ring of 12 eyed frames around a
 * 3x3 hole, the hole fills with Void Portal. Returns 'none' (not a frame / already filled),
 * 'filled' or 'opened'.
 */
export function insertVoidEye(w: PortalWorld, x: number, y: number, z: number): 'none' | 'filled' | 'opened' {
  if (w.getBlock(x, y, z) !== B.VOID_FRAME) return 'none';
  w.setBlock(x, y, z, B.VOID_FRAME_EYE);
  for (let cx = x - 2; cx <= x + 2; cx++) for (let cz = z - 2; cz <= z + 2; cz++) {
    if (!VOID_RING.some(([dx, dz]) => cx + dx === x && cz + dz === z)) continue;
    if (!VOID_RING.every(([dx, dz]) => w.getBlock(cx + dx, y, cz + dz) === B.VOID_FRAME_EYE)) continue;
    let free = true;
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const id = w.getBlock(cx + dx, y, cz + dz);
      if (id !== B.AIR && id !== B.VOID_PORTAL) free = false;
    }
    if (!free) continue;
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) w.setBlock(cx + dx, y, cz + dz, B.VOID_PORTAL);
    return 'opened';
  }
  return 'filled';
}
