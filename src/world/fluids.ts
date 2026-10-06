import { B, isWaterId, waterLevel } from '../core/ids';
import { blockDef, SOLID } from './blocks';

/** Minimal world interface the fluid simulation needs (keeps it unit-testable). */
export interface FluidWorld {
  getBlock(x: number, y: number, z: number): number;
  setBlock(x: number, y: number, z: number, id: number, immediate?: boolean): boolean;
}

const UNLOADED = 255;
const flowId = (level: number) => (level >= 8 ? B.WATER : B.WATER_FLOW + level - 1);
const SIDES: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/**
 * Cellular water flow. Sources (level 8) are static; flowing water (levels 1–7) spreads down
 * first, then sideways losing one level per block, and dries up when unsupported.
 * Two adjacent sources over solid ground create a new source (infinite water pools).
 */
export class FluidSim {
  private queue = new Map<string, [number, number, number]>();
  private timer = 0;
  /** Seconds between flow steps and max cells per step. */
  tickTime = 0.2;
  budget = 160;

  constructor(private world: FluidWorld) {}

  /** Wake the cell and its neighbors (call after any block change). */
  touch(x: number, y: number, z: number): void {
    this.add(x, y, z);
    this.add(x, y + 1, z);
    this.add(x, y - 1, z);
    for (const [dx, dz] of SIDES) this.add(x + dx, y, z + dz);
  }

  private add(x: number, y: number, z: number): void {
    if (y < 0 || y > 127) return;
    this.queue.set(`${x},${y},${z}`, [x, y, z]);
  }

  get pending(): number {
    return this.queue.size;
  }

  private passable(id: number): boolean {
    return id !== UNLOADED && !isWaterId(id) && !SOLID[id] && (id === B.AIR || !!blockDef(id).replaceable);
  }

  /** Expected level of a non-source water cell from its surroundings (0 = should dry). */
  private expected(x: number, y: number, z: number): number {
    const w = this.world;
    if (isWaterId(w.getBlock(x, y + 1, z))) return 7; // falling water stays full
    let best = 0;
    let sources = 0;
    for (const [dx, dz] of SIDES) {
      const n = w.getBlock(x + dx, y, z + dz);
      const l = waterLevel(n);
      if (l === 8) sources++;
      if (l > 0) {
        // Water only spreads sideways from cells resting on something (not mid-fall).
        const under = w.getBlock(x + dx, y - 1, z + dz);
        const resting = SOLID[under] === 1 || waterLevel(under) === 8 || under === UNLOADED;
        if (resting || l === 8) best = Math.max(best, l - 1);
      }
    }
    const below = w.getBlock(x, y - 1, z);
    if (sources >= 2 && (SOLID[below] === 1 || waterLevel(below) === 8)) return 8;
    return best;
  }

  step(): number {
    let n = 0;
    const w = this.world;
    const batch = [...this.queue.values()].slice(0, this.budget);
    for (const [x, y, z] of batch) {
      this.queue.delete(`${x},${y},${z}`);
      const id = w.getBlock(x, y, z);
      if (id === UNLOADED) continue;
      let level = waterLevel(id);
      if (level > 0 && level < 8) {
        const e = this.expected(x, y, z);
        if (e !== level) {
          w.setBlock(x, y, z, e <= 0 ? B.AIR : flowId(e), false);
          n++;
          level = e;
        }
      }
      if (level <= 0) continue;
      // Spread: down first, otherwise sideways.
      const below = w.getBlock(x, y - 1, z);
      if (this.passable(below)) {
        w.setBlock(x, y - 1, z, flowId(7), false);
        n++;
        continue;
      }
      const restingOnSolid = SOLID[below] === 1 || waterLevel(below) === 8;
      if (!restingOnSolid) continue;
      const next = level - 1;
      if (next <= 0) continue;
      for (const [dx, dz] of SIDES) {
        const nId = w.getBlock(x + dx, y, z + dz);
        if (this.passable(nId)) {
          w.setBlock(x + dx, y, z + dz, flowId(next), false);
          n++;
        } else {
          const nl = waterLevel(nId);
          if (nl > 0 && nl < next) {
            w.setBlock(x + dx, y, z + dz, flowId(next), false);
            n++;
          }
        }
      }
    }
    return n;
  }

  update(dt: number): void {
    if (this.queue.size === 0) return;
    this.timer += dt;
    if (this.timer < this.tickTime) return;
    this.timer = 0;
    this.step();
  }
}
