import * as THREE from 'three';
import { REACH, WORLD_HEIGHT } from '../core/constants';
import { B } from '../core/ids';
import { blockIntersectsBody } from '../player/physics';
import { raycastVoxels, type RayHit } from '../player/raycast';
import { blockDef, RENDER, SOLID } from '../world/blocks';
import { UNLOADED } from '../world/world';
import type { Game } from './game';
import { isPlaceable, itemDef } from './items';
import type { Mob } from './mobs';

const CREATIVE_BREAK_DELAY = 0.18;
const PLACE_REPEAT = 0.24;
const ATTACK_COOLDOWN = 0.45;

/** Is this block targetable by the crosshair? (not air/water) */
function targetable(id: number): boolean {
  return id !== B.AIR && id !== B.WATER && id !== UNLOADED;
}

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
  private chipTimer = 0;
  private hitSoundTimer = 0;
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
    const hit = raycastVoxels(this.origin.x, this.origin.y, this.origin.z, this.dir.x, this.dir.y, this.dir.z, REACH, (x, y, z) =>
      targetable(g.world.getBlock(x, y, z)),
    );
    const mobHit = g.mobs.raycast(this.origin, this.dir, REACH);
    this.targetMob = mobHit && (!hit || mobHit.dist < hit.dist) ? mobHit.mob : null;
    this.target = this.targetMob ? null : hit;

    if (this.target) g.highlight.show(this.target.x, this.target.y, this.target.z);
    else g.highlight.hide();

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
    this.chipTimer -= dt;
    this.hitSoundTimer -= dt;
    if (this.chipTimer <= 0) {
      this.chipTimer = 0.12;
      g.particles.chip(t.x + 0.5 + t.nx * 0.52, t.y + 0.5 + t.ny * 0.52, t.z + 0.5 + t.nz * 0.52, id);
    }
    if (this.hitSoundTimer <= 0) {
      this.hitSoundTimer = 0.25;
      g.sounds.hit(def.surface);
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

  private breakBlock(x: number, y: number, z: number, id: number, drops: boolean): void {
    const g = this.g;
    if (!g.world.setBlock(x, y, z, B.AIR)) return;
    const def = blockDef(id);
    g.particles.blockBreak(x, y, z, id);
    g.sounds.breakBlock(def.surface);
    if (drops && !g.creative) g.giveDrops(id);
    // Plants and cacti lose their support.
    const above = g.world.getBlock(x, y + 1, z);
    if (above !== UNLOADED && (RENDER[above] === 3 || above === B.CACTUS)) {
      this.breakBlock(x, y + 1, z, above, true);
    }
    // Fill from adjacent water so oceans don't get permanent dry holes at the surface.
    if (!SOLID[id]) return;
    for (const [dx, dy, dz] of [[0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]) {
      if (g.world.getBlock(x + dx, y + dy, z + dz) === B.WATER) {
        g.world.setBlock(x, y, z, B.WATER);
        break;
      }
    }
  }

  /** Use held item or place a block. Returns true if something happened. */
  private use(): boolean {
    const g = this.g;
    const held = g.heldStack();
    const t = this.target;
    // Interact with stations.
    if (t) {
      const id = g.world.getBlock(t.x, t.y, t.z);
      if (id === B.FORGE_BENCH || id === B.KILN) {
        g.openInventory();
        return true;
      }
    }
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

  private place(blockId: number, t: RayHit): boolean {
    const g = this.g;
    const targetId = g.world.getBlock(t.x, t.y, t.z);
    // Placing into a replaceable block (tall grass) replaces it directly.
    let x = t.x + t.nx;
    let y = t.y + t.ny;
    let z = t.z + t.nz;
    if (blockDef(targetId).replaceable && targetId !== B.WATER) {
      x = t.x;
      y = t.y;
      z = t.z;
    }
    if (y < 1 || y >= WORLD_HEIGHT) return false;
    const existing = g.world.getBlock(x, y, z);
    if (existing === UNLOADED) return false;
    if (existing !== B.AIR && !blockDef(existing).replaceable) return false;
    const def = blockDef(blockId);
    if (def.solid && blockIntersectsBody(x, y, z, g.player.body)) return false;
    if (def.solid && g.mobs.mobs.some((m) => blockIntersectsBody(x, y, z, m.body))) return false;
    // Plants need ground.
    if (def.render === 'cross') {
      const below = g.world.getBlock(x, y - 1, z);
      if (below !== B.GRASS && below !== B.DIRT && below !== B.SNOW_GRASS && below !== B.SAND) return false;
    }
    if (!g.world.setBlock(x, y, z, blockId)) return false;
    if (!g.creative) g.consumeHeld(1);
    g.sounds.place(def.surface);
    g.hand.doSwing();
    return true;
  }
}
