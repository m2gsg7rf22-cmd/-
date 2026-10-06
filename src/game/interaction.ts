import * as THREE from 'three';
import { REACH, WORLD_HEIGHT } from '../core/constants';
import { B, I, isDoorId, isWaterId } from '../core/ids';
import { gamepad } from '../input/gamepad';
import { raycastShapes, type RayHit } from '../player/raycast';
import { blockDef, COLLISION, doorId, doorParts, RENDER, SELECTION, SOLID } from '../world/blocks';
import { UNLOADED } from '../world/world';
import type { Game } from './game';
import { isPlaceable, itemDef } from './items';
import type { Mob } from './mobs';
import { igniteRift } from './portals';

const CREATIVE_BREAK_DELAY = 0.18;
const PLACE_REPEAT = 0.24;
const ATTACK_COOLDOWN = 0.45;

/** Horizontal facing (0 N -z, 1 E +x, 2 S +z, 3 W -x) of a look direction. */
export function facingOf(fx: number, fz: number): number {
  if (Math.abs(fx) > Math.abs(fz)) return fx > 0 ? 1 : 3;
  return fz > 0 ? 2 : 0;
}

const SLAB_FULL: Record<number, number> = { [B.SLAB_PLANKS]: B.PLANKS, [B.SLAB_BRICK]: B.SLATE_BRICKS };

/** Break time in seconds, and whether the block will drop items. */
export function breakInfo(blockId: number, toolId: number | null): { time: number; drops: boolean } {
  const def = blockDef(blockId);
  if (!Number.isFinite(def.hardness)) return { time: Infinity, drops: false };
  const tool = toolId !== null ? itemDef(toolId)?.tool : undefined;
  const correct = !!tool && !!def.tool && tool.kind === def.tool;
  const canHarvest = def.minTier < 0 || (correct && tool!.tier >= def.minTier);
  const speed = correct ? tool!.speed : 1;
  const base = def.hardness * (canHarvest ? 1.5 : 5);
  return { time: Math.max(0.05, base / speed), drops: canHarvest };
}

export class Interaction {
  target: RayHit | null = null;
  targetMob: Mob | null = null;
  private mineKey = '';
  private progress = 0;
  private breakCooldown = 0;
  private placeTimer = 0;
  private attackCd = 0;
  private dir = new THREE.Vector3();
  private origin = new THREE.Vector3();
  private placeQueued = false;
  private primaryQueued = false;

  constructor(private g: Game) {}

  queuePrimary(): void {
    this.primaryQueued = true;
  }

  queueSecondary(): void {
    this.placeQueued = true;
  }

  reset(): void {
    this.progress = 0;
    this.mineKey = '';
    this.placeQueued = false;
    this.primaryQueued = false;
    this.g.highlight.setProgress(0);
  }

  update(dt: number): void {
    const g = this.g;
    const p = g.player;
    this.breakCooldown = Math.max(0, this.breakCooldown - dt);
    this.placeTimer = Math.max(0, this.placeTimer - dt);
    this.attackCd = Math.max(0, this.attackCd - dt);

    g.camera.getWorldDirection(this.dir);
    this.origin.set(p.body.x, p.eyeY, p.body.z);
    const hit = raycastShapes(this.origin.x, this.origin.y, this.origin.z, this.dir.x, this.dir.y, this.dir.z, REACH, (x, y, z) => {
      const id = g.world.getBlock(x, y, z);
      return id === UNLOADED ? null : SELECTION[id];
    });
    const mobHit = g.mobs.raycast(this.origin, this.dir, REACH);
    this.targetMob = mobHit && (!hit || mobHit.dist < hit.dist) ? mobHit.mob : null;
    this.target = this.targetMob ? null : hit;

    if (this.target) {
      const boxes = SELECTION[g.world.getBlock(this.target.x, this.target.y, this.target.z)];
      g.highlight.show(this.target.x, this.target.y, this.target.z, boxes ?? undefined);
    } else g.highlight.hide();

    const primary = g.input.primary || this.primaryQueued;
    const primaryPressed = this.primaryQueued;
    this.primaryQueued = false;

    // ---- attack ----
    if (this.targetMob) {
      this.progress = 0;
      this.mineKey = '';
      if (primaryPressed && this.attackCd <= 0) {
        this.attackCd = ATTACK_COOLDOWN;
        const held = g.heldStack();
        const tool = held ? itemDef(held.id)?.tool : undefined;
        const dmg = tool ? tool.damage : 1;
        g.mobs.damage(this.targetMob, dmg, p.body.x, p.body.z);
        g.hand.doSwing();
        if (tool) g.wearHeld(1);
        p.exhaustion += 0.1;
        g.particles.burst(this.targetMob.body.x, this.targetMob.body.y + this.targetMob.body.h * 0.6, this.targetMob.body.z, new THREE.Color(0.8, 0.15, 0.1), 6);
      }
    } else if (primary && this.target) {
      this.mine(dt, this.target);
    } else {
      if (this.progress > 0) g.highlight.setProgress(0);
      this.progress = 0;
      this.mineKey = '';
    }

    // ---- use / place ----
    const secondary = g.input.secondary || this.placeQueued;
    if (secondary && (this.placeQueued || this.placeTimer <= 0)) {
      this.placeQueued = false;
      if (this.use()) this.placeTimer = PLACE_REPEAT;
      else this.placeTimer = 0.1;
    }
  }

  private mine(dt: number, t: RayHit): void {
    const g = this.g;
    const id = g.world.getBlock(t.x, t.y, t.z);
    const key = `${t.x},${t.y},${t.z},${id}`;
    if (key !== this.mineKey) {
      this.mineKey = key;
      this.progress = 0;
    }
    const def = blockDef(id);
    g.hand.doSwing();
    if (g.creative) {
      if (this.breakCooldown <= 0) {
        this.breakBlock(t.x, t.y, t.z, id, false);
        this.breakCooldown = CREATIVE_BREAK_DELAY;
      }
      return;
    }
    const held = g.heldStack();
    const info = breakInfo(id, held && itemDef(held.id)?.tool ? held.id : null);
    if (!Number.isFinite(info.time)) return;
    this.progress += dt / info.time;
    g.highlight.setProgress(this.progress);
    // Each strike of the swing lands on the block: chips fly off the struck face and the crack shudders.
    if (g.hand.consumeImpact()) {
      const fx = t.x + 0.5 + t.nx * 0.52, fy = t.y + 0.5 + t.ny * 0.52, fz = t.z + 0.5 + t.nz * 0.52;
      for (let i = 0; i < 4; i++) g.particles.chip(fx, fy, fz, id, t.nx, t.ny, t.nz);
      g.sounds.hit(def.surface);
      g.highlight.pulse();
    }
    if (this.progress >= 1) {
      this.breakBlock(t.x, t.y, t.z, id, info.drops);
      if (held && itemDef(held.id)?.tool) g.wearHeld(1);
      g.player.exhaustion += 0.005;
      this.progress = 0;
      this.mineKey = '';
      g.highlight.setProgress(0);
    }
  }

  /** Blocks that need a solid block underneath (plants, cacti, torches, doors). */
  private needsSupport(id: number): boolean {
    return RENDER[id] === 3 || id === B.CACTUS || id === B.TORCH || (isDoorId(id) && !doorParts(id).upper);
  }

  private breakBlock(x: number, y: number, z: number, id: number, drops: boolean): void {
    const g = this.g;
    if (!g.world.setBlock(x, y, z, B.AIR)) return;
    const def = blockDef(id);
    g.particles.blockBreak(x, y, z, id, 22);
    g.particles.dust(x + 0.5, y + 0.5, z + 0.5);
    g.sounds.breakBlock(def.surface);
    gamepad.rumble(0.15, 0.3, 70);
    if (drops && !g.creative) g.dropBlockItems(id, x, y, z);
    // Doors are two blocks: remove the other half too.
    if (isDoorId(id)) {
      const upper = doorParts(id).upper;
      const oy = upper ? y - 1 : y + 1;
      const other = g.world.getBlock(x, oy, z);
      if (isDoorId(other)) {
        g.world.setBlock(x, oy, z, B.AIR);
        // The lower half carries the door item.
        if (upper && drops && !g.creative) g.dropBlockItems(other, x, oy, z);
      }
    }
    // Plants, cacti, torches and doors above lose their support.
    const above = g.world.getBlock(x, y + 1, z);
    if (above !== UNLOADED && this.needsSupport(above)) this.breakBlock(x, y + 1, z, above, true);
  }

  /** Use held item, toggle doors, open stations, or place a block. Returns true if something happened. */
  private use(): boolean {
    const g = this.g;
    const held = g.heldStack();
    const t = this.target;
    if (t) {
      const id = g.world.getBlock(t.x, t.y, t.z);
      if (id === B.FORGE_BENCH || id === B.KILN) {
        g.openInventory();
        return true;
      }
      if (isDoorId(id)) {
        this.toggleDoor(t.x, t.y, t.z, id);
        return true;
      }
      if (id === B.VOID_GATE) {
        g.hand.doSwing();
        g.useVoidGate();
        return true;
      }
    }
    if (held && held.id === I.EMBER_STRIKER && t) return this.strike(t);
    if (held) {
      const def = itemDef(held.id);
      if (def?.food) {
        if (g.player.eat(def.food)) {
          if (!g.creative) g.consumeHeld(1);
          g.sounds.eat();
          g.hand.doSwing();
          return true;
        }
        return false;
      }
      if (t && isPlaceable(held.id)) return this.place(held.id, t);
    }
    return false;
  }

  /** Ember Striker: sparks, and lights a rift inside a complete Duskstone frame. */
  private strike(t: RayHit): boolean {
    const g = this.g;
    const x = t.x + t.nx, y = t.y + t.ny, z = t.z + t.nz;
    g.hand.doSwing();
    g.particles.burst(x + 0.5 - t.nx * 0.4, y + 0.5 - t.ny * 0.4, z + 0.5 - t.nz * 0.4, new THREE.Color(1, 0.62, 0.2), 8, 2, 2);
    g.sounds.hit('stone');
    if (g.dim === 'voidreach') {
      if (g.world.getBlock(t.x, t.y, t.z) === B.DUSKSTONE) g.toast('Rifts will not open in the void.');
      return true;
    }
    if (igniteRift(g.world, x, y, z)) {
      g.sounds.blink();
      g.toast('A rift tears open. Step inside to cross.');
      gamepad.rumble(0.5, 0.6, 220);
    }
    return true;
  }

  private toggleDoor(x: number, y: number, z: number, id: number): void {
    const g = this.g;
    const { upper, open, facing } = doorParts(id);
    const ly = upper ? y - 1 : y;
    g.world.setBlock(x, ly, z, doorId(false, !open, facing));
    if (isDoorId(g.world.getBlock(x, ly + 1, z))) g.world.setBlock(x, ly + 1, z, doorId(true, !open, facing));
    g.sounds.place('wood');
    g.hand.doSwing();
  }

  /** Can a new block occupy (x,y,z) without overlapping the player or mobs? */
  private cellFree(x: number, y: number, z: number, blockId: number): boolean {
    const g = this.g;
    if (y < 1 || y >= WORLD_HEIGHT) return false;
    const existing = g.world.getBlock(x, y, z);
    if (existing === UNLOADED) return false;
    if (existing !== B.AIR && !blockDef(existing).replaceable) return false;
    const boxes = COLLISION[blockId];
    if (boxes) {
      for (const bx of boxes) {
        const hits = (body: { x: number; y: number; z: number; hw: number; h: number }) =>
          x + bx[0] < body.x + body.hw && x + bx[3] > body.x - body.hw &&
          y + bx[1] < body.y + body.h && y + bx[4] > body.y &&
          z + bx[2] < body.z + body.hw && z + bx[5] > body.z - body.hw;
        if (hits(g.player.body) || g.mobs.mobs.some((m) => hits(m.body))) return false;
      }
    }
    return true;
  }

  private place(itemId: number, t: RayHit): boolean {
    const g = this.g;
    const targetId = g.world.getBlock(t.x, t.y, t.z);
    const [fx, fz] = g.player.forward();
    const facing = facingOf(fx, fz);

    // Slab on top of the same slab merges into a full block.
    if (SLAB_FULL[itemId] !== undefined && targetId === itemId && t.ny === 1) {
      if (!this.cellFreeIgnoringTarget(t.x, t.y, t.z, SLAB_FULL[itemId])) return false;
      g.world.setBlock(t.x, t.y, t.z, SLAB_FULL[itemId]);
      return this.placed(blockDef(SLAB_FULL[itemId]).surface);
    }

    // Placing into a replaceable block (tall grass, flowing water) replaces it directly.
    let x = t.x + t.nx;
    let y = t.y + t.ny;
    let z = t.z + t.nz;
    if (blockDef(targetId).replaceable && !isWaterId(targetId)) {
      x = t.x;
      y = t.y;
      z = t.z;
    }

    if (itemId === I.DOOR_ITEM) {
      if (!SOLID[g.world.getBlock(x, y - 1, z)]) return false;
      const lower = doorId(false, false, facing);
      const upper = doorId(true, false, facing);
      if (!this.cellFree(x, y, z, lower) || !this.cellFree(x, y + 1, z, upper)) return false;
      g.world.setBlock(x, y, z, lower);
      g.world.setBlock(x, y + 1, z, upper);
      return this.placed('wood');
    }

    let blockId = itemId;
    if (blockId === B.STAIRS_PLANKS || blockId === B.STAIRS_BRICK) blockId += facing;
    if (!this.cellFree(x, y, z, blockId)) return false;
    const def = blockDef(blockId);
    if (def.render === 'cross') {
      const below = g.world.getBlock(x, y - 1, z);
      if (below !== B.GRASS && below !== B.DIRT && below !== B.SNOW_GRASS && below !== B.SAND && below !== B.CINDERROCK && below !== B.ASHEN_SAND) return false;
    }
    if (blockId === B.TORCH && !SOLID[g.world.getBlock(x, y - 1, z)]) return false;
    if (!g.world.setBlock(x, y, z, blockId)) return false;
    return this.placed(def.surface);
  }

  private cellFreeIgnoringTarget(x: number, y: number, z: number, blockId: number): boolean {
    const g = this.g;
    const prev = g.world.getBlock(x, y, z);
    // Treat the slab cell as empty for the overlap test.
    const boxes = COLLISION[blockId];
    if (!boxes) return true;
    const b = g.player.body;
    const overlap = x < b.x + b.hw && x + 1 > b.x - b.hw && y < b.y + b.h && y + 1 > b.y && z < b.z + b.hw && z + 1 > b.z - b.hw;
    return prev !== UNLOADED && !overlap;
  }

  private placed(surface: Parameters<Game['sounds']['place']>[0]): boolean {
    const g = this.g;
    if (!g.creative) g.consumeHeld(1);
    g.sounds.place(surface);
    g.hand.doSwing();
    return true;
  }
}
