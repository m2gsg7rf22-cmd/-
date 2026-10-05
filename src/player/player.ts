import { PLAYER_EYE, PLAYER_HEIGHT, PLAYER_WIDTH, WORLD_HEIGHT } from '../core/constants';
import { B } from '../core/ids';
import type { InputManager } from '../input/input';
import { blockDef, SOLID, type Surface } from '../world/blocks';
import { UNLOADED, type World } from '../world/world';
import { collides, moveBody, unstick, type Body } from './physics';

export const MAX_HEALTH = 20;
export const MAX_HUNGER = 20;
export const MAX_AIR = 10;

const GRAVITY = 28;
const JUMP_V = 8.7;
const WALK = 4.4;
const SPRINT = 5.9;
const SWIM = 2.7;
const FLY = 11;
const FLY_SPRINT = 22;
const TERMINAL = 60;

export interface PlayerEvents {
  step(surface: Surface): void;
  jump(): void;
  land(fall: number, surface: Surface): void;
  damage(amount: number, cause: string): void;
  splash(): void;
  death(cause: string): void;
}

export class Player {
  body: Body = { x: 0.5, y: 80, z: 0.5, hw: PLAYER_WIDTH / 2, h: PLAYER_HEIGHT };
  vx = 0;
  vy = 0;
  vz = 0;
  yaw = 0;
  pitch = 0;
  onGround = false;
  inWater = false;
  headInWater = false;
  flying = false;
  creative = false;
  sprinting = false;

  health = MAX_HEALTH;
  hunger = MAX_HUNGER;
  saturation = 5;
  exhaustion = 0;
  air = MAX_AIR;
  dead = false;
  /** Seconds of invulnerability after taking damage. */
  private hurtCooldown = 0;
  hurtFlash = 0;
  private regenTimer = 0;
  private starveTimer = 0;
  private drownTimer = 0;
  private fallStartY = 0;
  private wasOnGround = true;
  private stepAcc = 0;
  private lastJumpPressed = false;
  private flyTapTimer = 0;
  bob = 0;
  autoJump = true;
  spawn = { x: 0.5, y: 80, z: 0.5 };

  constructor(private events: PlayerEvents) {}

  get eyeY(): number {
    return this.body.y + PLAYER_EYE;
  }

  setPosition(x: number, y: number, z: number): void {
    this.body.x = x;
    this.body.y = y;
    this.body.z = z;
    this.vx = this.vy = this.vz = 0;
    this.fallStartY = y;
  }

  /** Forward vector of the camera on the horizontal plane. */
  forward(): [number, number] {
    return [-Math.sin(this.yaw), -Math.cos(this.yaw)];
  }

  look(dx: number, dy: number): void {
    this.yaw -= dx;
    this.pitch -= dy;
    const lim = Math.PI / 2 - 0.01;
    if (this.pitch > lim) this.pitch = lim;
    if (this.pitch < -lim) this.pitch = -lim;
    // Keep yaw bounded to avoid float drift over long sessions.
    if (this.yaw > Math.PI * 4 || this.yaw < -Math.PI * 4) this.yaw %= Math.PI * 2;
  }

  /** Block the player stands on (for footstep sounds). */
  private groundSurface(world: World): Surface {
    const id = world.getBlock(this.body.x, this.body.y - 0.1, this.body.z);
    if (id === UNLOADED) return 'stone';
    return blockDef(id).surface;
  }

  hurt(amount: number, cause: string): void {
    if (this.creative || this.dead || amount <= 0) return;
    if (this.hurtCooldown > 0 && cause !== 'starve' && cause !== 'drown') return;
    this.health = Math.max(0, this.health - amount);
    this.hurtCooldown = 0.5;
    this.hurtFlash = 1;
    this.exhaustion += 0.1;
    this.events.damage(amount, cause);
    if (this.health <= 0) {
      this.dead = true;
      this.vx = this.vz = 0;
      this.events.death(cause);
    }
  }

  eat(food: number): boolean {
    if (this.hunger >= MAX_HUNGER && !this.creative) return false;
    this.hunger = Math.min(MAX_HUNGER, this.hunger + food);
    this.saturation = Math.min(this.hunger, this.saturation + food * 0.6);
    return true;
  }

  respawn(): void {
    this.dead = false;
    this.health = MAX_HEALTH;
    this.hunger = MAX_HUNGER;
    this.saturation = 5;
    this.exhaustion = 0;
    this.air = MAX_AIR;
    this.flying = false;
    this.setPosition(this.spawn.x, this.spawn.y, this.spawn.z);
  }

  update(dt: number, input: InputManager, world: World): void {
    if (this.dead) return;
    this.hurtCooldown = Math.max(0, this.hurtCooldown - dt);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 2.5);
    this.flyTapTimer = Math.max(0, this.flyTapTimer - dt);

    const b = this.body;
    const feet = world.getBlock(b.x, b.y + 0.1, b.z);
    const mid = world.getBlock(b.x, b.y + 0.9, b.z);
    const head = world.getBlock(b.x, this.eyeY, b.z);
    const wasInWater = this.inWater;
    this.inWater = feet === B.WATER || mid === B.WATER;
    this.headInWater = head === B.WATER;
    if (this.inWater && !wasInWater && this.vy < -6) this.events.splash();

    if (!this.creative) this.flying = false;

    const mv = input.moveVector();
    const [fx, fz] = this.forward();
    const rx = -fz;
    const rz = fx;
    let wx = fx * mv.y + rx * mv.x;
    let wz = fz * mv.y + rz * mv.x;
    const wl = Math.hypot(wx, wz);
    if (wl > 1) { wx /= wl; wz /= wl; }

    this.sprinting = input.sprint && mv.y > 0.3 && (this.creative || this.hunger > 6);
    let speed = this.flying ? (this.sprinting ? FLY_SPRINT : FLY) : this.inWater ? SWIM : this.sprinting ? SPRINT : WALK;
    if (this.inWater && this.sprinting) speed *= 1.3;

    const tx = wx * speed;
    const tz = wz * speed;
    const accel = this.flying ? 8 : this.onGround ? 16 : this.inWater ? 6 : 4;
    const k = Math.min(1, accel * dt);
    this.vx += (tx - this.vx) * k;
    this.vz += (tz - this.vz) * k;

    const jumpHeld = input.jump;
    const jumpPressed = jumpHeld && !this.lastJumpPressed;
    this.lastJumpPressed = jumpHeld;

    // Double-tap jump toggles flight in creative.
    if (this.creative && jumpPressed) {
      if (this.flyTapTimer > 0) {
        this.flying = !this.flying;
        this.vy = 0;
        this.flyTapTimer = 0;
      } else this.flyTapTimer = 0.3;
    }

    if (this.flying) {
      const vt = (jumpHeld ? 1 : 0) - (input.descend ? 1 : 0);
      this.vy += (vt * speed * 0.75 - this.vy) * Math.min(1, 10 * dt);
    } else if (this.inWater) {
      this.vy -= GRAVITY * 0.22 * dt;
      if (jumpHeld) this.vy = Math.min(this.vy + 22 * dt, 3.4);
      this.vy *= Math.pow(0.12, dt);
      if (this.vy < -3) this.vy = -3;
    } else {
      this.vy -= GRAVITY * dt;
      if (this.vy < -TERMINAL) this.vy = -TERMINAL;
      if (jumpHeld && this.onGround) {
        this.vy = JUMP_V;
        this.onGround = false;
        this.exhaustion += this.sprinting ? 0.2 : 0.05;
        if (this.sprinting) {
          this.vx += fx * 1.2;
          this.vz += fz * 1.2;
        }
        this.events.jump();
      }
    }

    const ox = b.x;
    const oz = b.z;
    const res = moveBody(b, this.vx * dt, this.vy * dt, this.vz * dt, world.isSolid);
    if (res.hitX) this.vx = 0;
    if (res.hitZ) this.vz = 0;
    if (res.hitY) this.vy = 0;
    this.onGround = res.onGround || (this.vy <= 0 && collides({ ...b, y: b.y - 0.02 }, world.isSolid) && !this.flying);

    // Descending into the ground ends flight.
    if (this.flying && res.onGround) this.flying = false;

    // Climb out of water onto a ledge.
    if (this.inWater && (res.hitX || res.hitZ) && jumpHeld) this.vy = 6;

    // Auto-jump over 1-block steps (mobile friendly).
    if (this.autoJump && this.onGround && !this.flying && (res.hitX || res.hitZ) && wl > 0.2) {
      const ahead = { ...b, x: b.x + wx * 0.35, z: b.z + wz * 0.35 };
      const up = { ...ahead, y: b.y + 1.05 };
      if (collides(ahead, world.isSolid) && !collides(up, world.isSolid) && !collides({ ...b, y: b.y + 1.05 }, world.isSolid)) {
        this.vy = JUMP_V * 0.92;
        this.onGround = false;
      }
    }

    // Fall tracking & landing.
    if (!this.onGround) {
      if (this.wasOnGround || this.inWater || this.flying) this.fallStartY = b.y;
      else this.fallStartY = Math.max(this.fallStartY, b.y);
    } else if (!this.wasOnGround) {
      const fall = this.fallStartY - b.y;
      const surf = this.groundSurface(world);
      this.events.land(fall, surf);
      if (fall > 3.5 && !this.inWater && !this.creative) this.hurt(Math.floor(fall - 3), 'fall');
      this.fallStartY = b.y;
    }
    if (this.inWater || this.flying) this.fallStartY = b.y;
    this.wasOnGround = this.onGround;

    // Footsteps + exhaustion by distance.
    const moved = Math.hypot(b.x - ox, b.z - oz);
    if (this.onGround && moved > 0.001) {
      this.stepAcc += moved;
      this.bob += moved * 2.2;
      const stride = this.sprinting ? 2.4 : 1.9;
      if (this.stepAcc > stride) {
        this.stepAcc = 0;
        this.events.step(this.groundSurface(world));
      }
    }
    if (!this.creative) this.exhaustion += moved * (this.sprinting ? 0.1 : this.inWater ? 0.015 : 0.01);

    // Out-of-world safety.
    if (b.y < -20) {
      if (this.creative) this.setPosition(b.x, WORLD_HEIGHT, b.z);
      else this.hurt(4, 'void');
    }

    this.updateSurvival(dt);
  }

  private updateSurvival(dt: number): void {
    if (this.creative) {
      this.health = MAX_HEALTH;
      this.hunger = MAX_HUNGER;
      this.air = MAX_AIR;
      return;
    }
    // Exhaustion drains saturation, then hunger.
    while (this.exhaustion >= 4) {
      this.exhaustion -= 4;
      if (this.saturation > 0) this.saturation = Math.max(0, this.saturation - 1);
      else this.hunger = Math.max(0, this.hunger - 1);
    }
    // Slow passive hunger drain (~1 point per 80s).
    this.exhaustion += dt * 0.05;

    // Regeneration when well fed.
    if (this.hunger >= 16 && this.health < MAX_HEALTH) {
      this.regenTimer += dt;
      const period = this.saturation > 0 && this.hunger >= 20 ? 1.5 : 4;
      if (this.regenTimer >= period) {
        this.regenTimer = 0;
        this.health = Math.min(MAX_HEALTH, this.health + 1);
        this.exhaustion += 3;
      }
    } else this.regenTimer = 0;

    // Starvation.
    if (this.hunger <= 0) {
      this.starveTimer += dt;
      if (this.starveTimer >= 4) {
        this.starveTimer = 0;
        this.hurt(1, 'starve');
      }
    } else this.starveTimer = 0;

    // Drowning.
    if (this.headInWater) {
      this.air = Math.max(0, this.air - dt);
      if (this.air <= 0) {
        this.drownTimer += dt;
        if (this.drownTimer >= 1) {
          this.drownTimer = 0;
          this.hurt(2, 'drown');
        }
      }
    } else {
      this.air = Math.min(MAX_AIR, this.air + dt * 3);
      this.drownTimer = 0;
    }
  }

  /** Make sure the player isn't embedded in blocks (after load/spawn). */
  ensureFree(world: World): void {
    unstick(this.body, world.isSolid, WORLD_HEIGHT);
  }

  /** True if the player is standing in a column with sky access? (approx, for ambient). */
  isUnderground(world: World): boolean {
    const x = this.body.x;
    const z = this.body.z;
    for (let y = Math.floor(this.eyeY) + 1; y < Math.min(WORLD_HEIGHT, this.eyeY + 24); y++) {
      const id = world.getBlock(x, y, z);
      if (id !== UNLOADED && SOLID[id] && id !== B.ASH_LEAVES && id !== B.PINE_LEAVES) return true;
    }
    return false;
  }
}
