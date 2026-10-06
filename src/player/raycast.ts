/** Voxel DDA raycast (Amanatides & Woo). */

export interface RayHit {
  x: number;
  y: number;
  z: number;
  /** Face normal of the hit face (the side the ray entered from). */
  nx: number;
  ny: number;
  nz: number;
  dist: number;
}

export function raycastVoxels(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  maxDist: number,
  hitTest: (x: number, y: number, z: number) => boolean,
): RayHit | null {
  const len = Math.hypot(dx, dy, dz);
  if (len === 0) return null;
  dx /= len; dy /= len; dz /= len;
  let x = Math.floor(ox);
  let y = Math.floor(oy);
  let z = Math.floor(oz);
  const stepX = dx > 0 ? 1 : -1;
  const stepY = dy > 0 ? 1 : -1;
  const stepZ = dz > 0 ? 1 : -1;
  const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
  const tDeltaZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;
  let tMaxX = dx !== 0 ? (dx > 0 ? x + 1 - ox : ox - x) * tDeltaX : Infinity;
  let tMaxY = dy !== 0 ? (dy > 0 ? y + 1 - oy : oy - y) * tDeltaY : Infinity;
  let tMaxZ = dz !== 0 ? (dz > 0 ? z + 1 - oz : oz - z) * tDeltaZ : Infinity;
  let nx = 0, ny = 0, nz = 0;
  let t = 0;
  while (t <= maxDist) {
    if (hitTest(x, y, z)) return { x, y, z, nx, ny, nz, dist: t };
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      x += stepX; t = tMaxX; tMaxX += tDeltaX; nx = -stepX; ny = 0; nz = 0;
    } else if (tMaxY < tMaxZ) {
      y += stepY; t = tMaxY; tMaxY += tDeltaY; nx = 0; ny = -stepY; nz = 0;
    } else {
      z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; nx = 0; ny = 0; nz = -stepZ;
    }
  }
  return null;
}

/**
 * Voxel raycast that tests the actual boxes of each cell (slabs, stairs, doors, plants),
 * so the ray passes through the empty part of shaped blocks. `boxesAt` returns cell-local boxes or null.
 */
export function raycastShapes(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  maxDist: number,
  boxesAt: (x: number, y: number, z: number) => readonly (readonly number[])[] | null,
): RayHit | null {
  const len = Math.hypot(dx, dy, dz);
  if (len === 0) return null;
  dx /= len; dy /= len; dz /= len;
  const o = [ox, oy, oz];
  const d = [dx, dy, dz];
  let best: RayHit | null = null;
  raycastVoxels(ox, oy, oz, dx, dy, dz, maxDist + 1.8, (x, y, z) => {
    const boxes = boxesAt(x, y, z);
    if (!boxes) return false;
    const base = [x, y, z];
    for (const b of boxes) {
      let t0 = -Infinity;
      let t1 = Infinity;
      let axis = -1;
      let ok = true;
      for (let a = 0; a < 3; a++) {
        const lo = base[a] + b[a];
        const hi = base[a] + b[a + 3];
        if (Math.abs(d[a]) < 1e-12) {
          if (o[a] < lo || o[a] > hi) { ok = false; break; }
          continue;
        }
        let ta = (lo - o[a]) / d[a];
        let tb = (hi - o[a]) / d[a];
        if (ta > tb) [ta, tb] = [tb, ta];
        if (ta > t0) { t0 = ta; axis = a; }
        t1 = Math.min(t1, tb);
        if (t0 > t1) { ok = false; break; }
      }
      if (!ok || t1 < 0 || t0 > maxDist) continue;
      const t = Math.max(0, t0);
      if (best && t >= best.dist) continue;
      const n = [0, 0, 0];
      if (axis >= 0) n[axis] = d[axis] > 0 ? -1 : 1;
      best = { x, y, z, nx: n[0], ny: n[1], nz: n[2], dist: t };
    }
    // Stop at the first cell whose boxes were hit; boxes never extend outside their cell.
    return best !== null && best.x === x && best.y === y && best.z === z;
  });
  return best;
}
