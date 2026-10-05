import { CHUNK_SIZE, PAD_SIZE, WORLD_HEIGHT } from './constants';

/** Floor-divide that is correct for negative numbers. */
export function floorDiv(a: number, b: number): number {
  return Math.floor(a / b);
}

/** Positive modulo (result always in [0, b)). */
export function mod(a: number, b: number): number {
  const r = a % b;
  return r < 0 ? r + b : r === 0 ? 0 : r;
}

/** World block coordinate -> chunk coordinate. */
export function toChunk(w: number): number {
  return Math.floor(Math.floor(w) / CHUNK_SIZE);
}

/** World block coordinate -> local coordinate within its chunk (0..15). */
export function toLocal(w: number): number {
  return mod(Math.floor(w), CHUNK_SIZE);
}

export function chunkKey(cx: number, cz: number): string {
  return cx + ',' + cz;
}

export function parseChunkKey(key: string): [number, number] {
  const i = key.indexOf(',');
  return [parseInt(key.slice(0, i), 10), parseInt(key.slice(i + 1), 10)];
}

/** Index into a chunk block array. Layout: y-major columns for fast column scans. */
export function blockIndex(lx: number, y: number, lz: number): number {
  return (lx * CHUNK_SIZE + lz) * WORLD_HEIGHT + y;
}

/** Index into a padded (18x18xH) array; px/pz in -1..16. */
export function padIndex(px: number, y: number, pz: number): number {
  return ((px + 1) * PAD_SIZE + (pz + 1)) * WORLD_HEIGHT + y;
}

export function inHeight(y: number): boolean {
  return y >= 0 && y < WORLD_HEIGHT;
}
