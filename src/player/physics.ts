/** Axis-separated swept AABB vs voxel grid collision. Pure & unit-tested. */

export type SolidFn = (x: number, y: number, z: number) => boolean;

export interface Body {
  x: number; // center x
  y: number; // feet y
  z: number; // center z
  hw: number; // half width
  h: number; // height
}

const EPS = 1e-4;
/** Max distance per sub-step; < 0.5 so a body can't skip over a full block. */
const MAX_STEP = 0.4;

/** Does a body at its current position overlap any solid block? */
export function collides(b: Body, solid: SolidFn): boolean {
  const x0 = Math.floor(b.x - b.hw + EPS);
  const x1 = Math.floor(b.x + b.hw - EPS);
  const y0 = Math.floor(b.y + EPS);
  const y1 = Math.floor(b.y + b.h - EPS);
  const z0 = Math.floor(b.z - b.hw + EPS);
  const z1 = Math.floor(b.z + b.hw - EPS);
  for (let x = x0; x <= x1; x++)
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++) if (solid(x, y, z)) return true;
  return false;
}

/** Move along one axis, stopping flush against blocks. Returns true if blocked. */
function moveAxis(b: Body, axis: 0 | 1 | 2, d: number, solid: SolidFn): boolean {
  if (d === 0) return false;
  if (axis === 0) b.x += d;
  else if (axis === 1) b.y += d;
  else b.z += d;

  const x0 = Math.floor(b.x - b.hw + EPS);
  const x1 = Math.floor(b.x + b.hw - EPS);
  const y0 = Math.floor(b.y + EPS);
  const y1 = Math.floor(b.y + b.h - EPS);
  const z0 = Math.floor(b.z - b.hw + EPS);
  const z1 = Math.floor(b.z + b.hw - EPS);

  let hit = false;
  let bound = d > 0 ? Infinity : -Infinity;
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        if (!solid(x, y, z)) continue;
        hit = true;
        const c = axis === 0 ? x : axis === 1 ? y : z;
        bound = d > 0 ? Math.min(bound, c) : Math.max(bound, c);
      }
    }
  }
  if (!hit) return false;
  if (axis === 0) b.x = d > 0 ? bound - b.hw - EPS : bound + 1 + b.hw + EPS;
  else if (axis === 1) b.y = d > 0 ? bound - b.h - EPS : bound + 1;
  else b.z = d > 0 ? bound - b.hw - EPS : bound + 1 + b.hw + EPS;
  return true;
}

export interface MoveResult {
  hitX: boolean;
  hitY: boolean;
  hitZ: boolean;
  onGround: boolean;
  hitCeiling: boolean;
}

/**
 * Move a body by (dx, dy, dz) with collision. Splits into sub-steps to avoid tunneling.
 * Y is resolved first so walking on ground never snags on block seams.
 */
export function moveBody(b: Body, dx: number, dy: number, dz: number, solid: SolidFn): MoveResult {
  const res: MoveResult = { hitX: false, hitY: false, hitZ: false, onGround: false, hitCeiling: false };
  const dist = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz));
  const steps = Math.max(1, Math.ceil(dist / MAX_STEP));
  const sx = dx / steps;
  let sy = dy / steps;
  const sz = dz / steps;
  let ax = sx;
  let az = sz;
  for (let i = 0; i < steps; i++) {
    if (sy !== 0 && moveAxis(b, 1, sy, solid)) {
      res.hitY = true;
      if (sy < 0) res.onGround = true;
      else res.hitCeiling = true;
      sy = 0;
    }
    // Resolve the larger horizontal component first: smoother sliding along walls at diagonals.
    if (Math.abs(ax) >= Math.abs(az)) {
      if (ax !== 0 && moveAxis(b, 0, ax, solid)) { res.hitX = true; ax = 0; }
      if (az !== 0 && moveAxis(b, 2, az, solid)) { res.hitZ = true; az = 0; }
    } else {
      if (az !== 0 && moveAxis(b, 2, az, solid)) { res.hitZ = true; az = 0; }
      if (ax !== 0 && moveAxis(b, 0, ax, solid)) { res.hitX = true; ax = 0; }
    }
  }
  return res;
}

/** Is there solid ground directly beneath the body (within `dist`)? */
export function groundBelow(b: Body, solid: SolidFn, dist = 0.05): boolean {
  const probe: Body = { ...b, y: b.y - dist };
  return collides(probe, solid);
}

/** Does a block cell intersect the body? Used to prevent placing blocks inside the player. */
export function blockIntersectsBody(bx: number, by: number, bz: number, b: Body): boolean {
  return (
    bx < b.x + b.hw - EPS && bx + 1 > b.x - b.hw + EPS &&
    by < b.y + b.h - EPS && by + 1 > b.y + EPS &&
    bz < b.z + b.hw - EPS && bz + 1 > b.z - b.hw + EPS
  );
}

/**
 * If a body ended up inside blocks (e.g. spawn or load into an edited world), push it up
 * to the first free spot. Returns true if moved.
 */
export function unstick(b: Body, solid: SolidFn, maxUp = 64): boolean {
  if (!collides(b, solid)) return false;
  const startY = b.y;
  for (let i = 1; i <= maxUp; i++) {
    b.y = Math.floor(startY) + i;
    if (!collides(b, solid)) return true;
  }
  b.y = startY;
  return false;
}
