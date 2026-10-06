import * as THREE from 'three';
import { audio } from '../audio/audio';
import { gamepad } from '../input/gamepad';
import { CHUNK_SIZE, DAY_LENGTH, WORLD_HEIGHT } from '../core/constants';
import { toChunk } from '../core/coords';
import { B, isRiftId } from '../core/ids';
import type { InputManager } from '../input/input';
import type { TouchControls } from '../input/touch';
import { MAX_AIR, Player } from '../player/player';
import { BlockHighlight, Particles } from '../render/effects';
import { HandView } from '../render/handView';
import { worldUniforms } from '../render/materials';
import type { Renderer } from '../render/renderer';
import { Sky } from '../render/sky';
import type { SaveStore } from '../save/db';
import { SAVE_VERSION, type Arrival, type Vec3, type WorldMeta } from '../save/serialize';
import type { Hud } from '../ui/hud';
import { DIM_NAMES, EMBER_MAGMA_LEVEL, EMBER_SCALE, type Dim } from '../world/dimension';
import { buildRift, checkRiftAround, findRift } from './portals';
import { blockDef } from '../world/blocks';
import { World } from '../world/world';
import { AdaptiveQuality, type QualityStep } from './adaptive';
import type { Station } from './crafting';
import { Interaction } from './interaction';
import { HOTBAR_SIZE, Inventory, type ItemStack } from './inventory';
import { itemName } from './items';
import { MOB_SPECS, MobManager, type MobKind } from './mobs';
import { DropManager } from './drops';
import { FluidSim } from '../world/fluids';
import type { Settings } from './settings';

export type TravelVia = 'rift' | 'gate' | 'respawn';

export interface GameHost {
  onDeath(cause: string): void;
  /** Leave this dimension (the app saves, then reloads the world in the target dimension). */
  onTravel(target: Dim, via: TravelVia): void;
  onRequestPause(): void;
  onRequestInventory(): void;
  onFatal(err: unknown): void;
}

const DEATH_TEXT: Record<string, string> = {
  fall: 'You hit the ground too hard.',
  void: 'You fell out of the world.',
  starve: 'You starved.',
  drown: 'You ran out of air.',
  magma: 'You fell into molten magma.',
};

function deathText(cause: string): string {
  if (cause.startsWith('mob:')) {
    const spec = MOB_SPECS[cause.slice(4) as MobKind];
    return spec ? `${spec.name === 'Shadow Crawler' ? 'A Shadow Crawler' : `A ${spec.name}`} got you.` : 'You were defeated.';
  }
  return DEATH_TEXT[cause] ?? 'You were defeated.';
}

/** Ambient light per dimension (level and tint). */
const AMBIENT: Record<Dim, [number, THREE.Color]> = {
  overworld: [0.09, new THREE.Color(1, 1, 1)],
  emberdeep: [0.36, new THREE.Color(1.0, 0.56, 0.42)],
  voidreach: [0.2, new THREE.Color(0.8, 0.72, 1.0)],
};
const MAGMA_FOG = new THREE.Color(0.85, 0.28, 0.04);
/** Seconds standing in a rift before it pulls the player through. */
const RIFT_TIME = 2.2;

const AUTOSAVE_SEC = 30;
const UNDERWATER_FOG = new THREE.Color(0.05, 0.16, 0.32);

export class Game {
  readonly dim: Dim;
  readonly world: World;
  readonly player: Player;
  inventory: Inventory;
  selected = 0;
  readonly sky = new Sky();
  readonly highlight: BlockHighlight;
  readonly particles: Particles;
  readonly mobs: MobManager;
  readonly interaction: Interaction;
  readonly hand: HandView;
  readonly drops: DropManager;
  readonly fluids: FluidSim;
  readonly sounds = audio;
  readonly camera: THREE.PerspectiveCamera;
  creative: boolean;
  paused = true;
  time: number;
  day: number;
  private running = false;
  private raf = 0;
  private last = 0;
  private elapsed = 0;
  private autosaveTimer = AUTOSAVE_SEC;
  private saving: Promise<void> = Promise.resolve();
  private adaptive: AdaptiveQuality;
  /** Runtime caps imposed by adaptive quality (never written to user settings). */
  private caps = { renderDistance: 99, resolution: 1, particles: true, clouds: true, ao: true };
  private fovCurrent = 75;
  private needsUnstick = false;
  private debugOn = false;
  private debugTimer = 0;
  private fps = 60;
  private fpsAcc = 0;
  private fpsFrames = 0;
  private offInput: () => void;
  private wasUnderwater = false;
  private wasInMagma = false;
  /** Set on arrival inside a rift; cleared once the player steps out of it. */
  private portalLock = false;
  private portalTime = 0;
  private travelling = false;
  private lastFlying = false;
  private disposed = false;

  constructor(
    public meta: WorldMeta,
    private r: Renderer,
    readonly input: InputManager,
    private touch: TouchControls | null,
    private hud: Hud,
    private store: SaveStore,
    public settings: Settings,
    private mobile: boolean,
    private host: GameHost,
  ) {
    this.camera = r.camera;
    this.creative = meta.mode === 'creative';
    this.time = meta.time;
    this.day = meta.day;
    this.dim = meta.dim ?? 'overworld';
    this.sky.dim = this.dim;
    this.world = new World(meta.seedNum, this.dim, meta.id, store, r.materials, settings.renderDistance, settings.ao);
    this.world.onChunkError = () => this.hud.toast('A chunk failed to load — retrying', true);
    this.player = new Player({
      step: (s) => audio.step(s),
      jump: () => audio.jump(),
      land: (fall, s) => {
        if (fall > 1.2) audio.land(Math.min(1, fall / 8), s);
        if (fall > 2.5) {
          const id = this.world.getBlock(this.player.body.x, this.player.body.y - 0.5, this.player.body.z);
          if (id > 0 && id < 255) this.particles.blockBreak(this.player.body.x - 0.5, this.player.body.y - 1, this.player.body.z - 0.5, id, 6);
        }
      },
      damage: () => {
        audio.damage();
        gamepad.rumble(0.7, 0.5, 180);
        this.particles.burst(this.player.body.x, this.player.eyeY - 0.4, this.player.body.z, new THREE.Color(0.75, 0.1, 0.1), 5);
      },
      splash: () => {
        audio.splash();
        this.particles.burst(this.player.body.x, this.player.body.y + 0.5, this.player.body.z, new THREE.Color(0.55, 0.75, 1), 12, 3, 4);
      },
      death: (cause) => {
        audio.death();
        gamepad.rumble(1, 1, 450);
        this.host.onDeath(deathText(cause));
      },
    });
    this.player.creative = this.creative;
    this.inventory = Inventory.fromJSON(meta.player?.inventory ?? []);
    this.highlight = new BlockHighlight(r.atlas);
    this.particles = new Particles(mobile ? 120 : 400, r.atlasCanvas);
    this.mobs = new MobManager(this.world, {
      hurtPlayer: (amount, fx, fz, cause) => {
        if (this.player.dead || this.creative) return;
        this.player.hurt(amount, `mob:${cause}`);
        const dx = this.player.body.x - fx;
        const dz = this.player.body.z - fz;
        const l = Math.hypot(dx, dz) || 1;
        this.player.vx += (dx / l) * 7;
        this.player.vz += (dz / l) * 7;
        this.player.vy = Math.max(this.player.vy, 5);
      },
      playerPos: () => ({ x: this.player.body.x, y: this.player.body.y, z: this.player.body.z }),
      onKilled: (mob, drops) => {
        this.particles.burst(mob.body.x, mob.body.y + 0.5, mob.body.z, new THREE.Color(0.9, 0.9, 0.85), 14, 3, 3);
        if (!this.creative) for (const [id, n] of drops) this.drops.spawn(id, n, mob.body.x, mob.body.y + 0.4, mob.body.z);
      },
      sound: (kind, mob) => {
        const d = Math.hypot(mob.body.x - this.player.body.x, mob.body.z - this.player.body.z);
        if (d > 24) return;
        if (kind === 'hiss') audio.mobHiss();
        else if (kind === 'shoot') audio.mobShoot(MOB_SPECS[mob.kind].voice);
        else if (kind === 'blink') audio.blink();
        else audio.mobGrunt(MOB_SPECS[mob.kind].voice);
      },
    }, this.dim);
    this.interaction = new Interaction(this);
    this.hand = new HandView(r.atlas);
    this.drops = new DropManager(r.atlas);
    this.fluids = new FluidSim(this.world);
    this.world.onBlockChanged = (x, y, z) => {
      this.fluids.touch(x, y, z);
      if (checkRiftAround(this.world, x, y, z) > 0) audio.blink();
    };
    this.adaptive = new AdaptiveQuality(mobile ? 30 : 55);

    const scene = r.scene;
    scene.add(this.sky.group, this.world.group, this.highlight.group, this.particles.mesh, this.mobs.group, this.drops.group);

    this.offInput = input.onEvent((e) => {
      if (this.paused || this.player.dead) return;
      if (e === 'primaryDown') this.interaction.queuePrimary();
      else if (e === 'secondaryDown') this.interaction.queueSecondary();
      else if (e === 'toggleFly' && this.creative) {
        this.player.flying = !this.player.flying;
        this.player.vy = 0;
      } else if (e === 'toggleDebug') this.debugOn = !this.debugOn;
      else if (e === 'drop') this.dropSelected();
    });
    hud.onHotbarSelect = (i) => this.select(i);
    hud.setMode(this.creative);
    this.applySettings(settings);
  }

  // ---------------- lifecycle ----------------

  /** Real loading: streams chunks around the spawn and reports actual progress. */
  async load(progress: (stage: string, frac: number) => void): Promise<void> {
    progress('Preparing chunks…', 0.02);
    await this.world.init();
    const p = this.meta.player;
    let x: number;
    let y: number;
    let z: number;
    let fresh = false;
    if (p) {
      ({ x, y, z } = p);
      this.player.yaw = p.yaw;
      this.player.pitch = p.pitch;
      this.player.health = p.health;
      this.player.hunger = p.hunger;
      this.player.saturation = p.saturation;
      this.selected = p.selected;
      this.player.flying = p.flying && this.creative;
      this.player.spawn = { ...p.spawn };
    } else {
      progress('Generating terrain…', 0.05);
      const s = this.world.gen.findSpawn();
      x = s.x;
      y = s.y;
      z = s.z;
      fresh = true;
      if (!this.creative) this.starterKit();
    }
    const arrival = this.meta.arrival;
    if (arrival === 'gate' && this.dim === 'voidreach') ({ x, y, z } = this.world.gen.findSpawn());
    this.player.setPosition(x, y, z);

    // Stream until the spawn neighborhood is generated AND meshed.
    const R = Math.min(2, this.world.renderDistance);
    const cx = toChunk(x);
    const cz = toChunk(z);
    const needed: [number, number][] = [];
    for (let dx = -R; dx <= R; dx++) for (let dz = -R; dz <= R; dz++) if (dx * dx + dz * dz <= R * R + 1) needed.push([cx + dx, cz + dz]);
    const start = performance.now();
    await new Promise<void>((resolve, reject) => {
      const tick = () => {
        if (this.disposed) return reject(new Error('cancelled'));
        try {
          this.world.update(x, z, 0, 0);
        } catch (e) {
          return reject(e);
        }
        const loaded = needed.filter(([a, b]) => this.world.isChunkLoaded(a, b)).length;
        const meshed = needed.filter(([a, b]) => this.world.isChunkMeshed(a, b)).length;
        const frac = (loaded + meshed) / (needed.length * 2);
        progress(loaded < needed.length ? 'Generating terrain…' : 'Preparing chunks…', 0.08 + frac * 0.82);
        if (meshed === needed.length) return resolve();
        if (performance.now() - start > 45000) return reject(new Error('World generation timed out'));
        requestAnimationFrame(tick);
      };
      tick();
    });

    progress('Loading world…', 0.93);
    if (fresh) {
      // Use real block data (trees, caves, water) for the final spawn: solid natural ground with headroom.
      const spot = this.world.findSafeSpot(x, z, 24);
      if (spot) {
        ({ x, y, z } = spot);
      } else {
        const sy = this.world.surfaceY(x, z);
        if (sy > 0) y = Math.min(WORLD_HEIGHT - 2, sy + 1);
      }
      this.player.setPosition(x, y, z);
      this.player.spawn = { x, y, z };
      this.time = 0.04;
    } else if (arrival) {
      ({ x, y, z } = this.resolveArrival(arrival, x, y, z));
      this.player.setPosition(x, y, z);
      this.player.vx = this.player.vy = this.player.vz = 0;
      this.meta = { ...this.meta, arrival: undefined };
    }
    this.player.ensureFree(this.world);
    // Never pull a player through a rift they were already standing in when the world loaded.
    this.portalLock = true;
    // Restore creatures saved near the player (only those of this dimension).
    for (const m of (this.meta.mobsDim ?? 'overworld') === this.dim ? this.meta.mobs ?? [] : []) {
      const mob = this.mobs.spawn(m.kind as MobKind, m.x, m.y, m.z);
      mob.health = m.health;
    }
    progress('Entering world…', 1);
    this.updateCamera(0);
    this.sky.update(this.time, this.camera.position, 0, this.world.renderDistance * CHUNK_SIZE);
    if (fresh || arrival) await this.save();
    if (this.dim !== 'overworld') this.hud.toast(DIM_NAMES[this.dim], false, 3500);
  }

  /** Place the player after a dimension change, once the destination chunks exist. */
  private resolveArrival(kind: Arrival, x: number, y: number, z: number): Vec3 {
    const w = this.world;
    if (kind === 'rift') {
      let cell = findRift(w, x, y, z, 14, 48);
      if (!cell) {
        const spot = this.dim === 'emberdeep' ? this.emberSpot(x, y, z) : w.findSafeSpot(x, z, 16) ?? { x, y: Math.max(2, w.surfaceY(x, z) + 1), z };
        cell = buildRift(w, spot.x, spot.y, spot.z);
      }
      if (this.dim === 'emberdeep') this.meta = { ...this.meta, emberLink: { x: cell.x, y: cell.y, z: cell.z } };
      // Arriving inside a rift must not bounce the player straight back.
      this.portalLock = true;
      return { x: cell.x + 0.5, y: cell.y, z: cell.z + 0.5 };
    }
    if (kind === 'gate') return w.gen.findSpawn();
    if (kind === 'spawn') return { ...this.player.spawn };
    return w.findSafeSpot(x, z, 24) ?? { x, y: Math.max(y, w.surfaceY(x, z) + 1), z };
  }

  /** A standing spot in Emberdeep near (x,y,z): rock floor above the magma sea with headroom. */
  private emberSpot(x: number, y: number, z: number): Vec3 {
    const w = this.world;
    const free = (id: number) => id !== 255 && id !== B.MAGMA && id !== B.MAGMA_DEEP && !blockDef(id).solid;
    const hint = Math.max(EMBER_MAGMA_LEVEL + 2, Math.min(100, Math.floor(y)));
    for (let r = 0; r <= 12; r++) {
      for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const cx = Math.floor(x) + dx, cz = Math.floor(z) + dz;
        for (let d = 0; d < 70; d++) {
          const yy = hint + (d % 2 === 0 ? d / 2 : -(d + 1) / 2);
          if (yy <= EMBER_MAGMA_LEVEL + 1 || yy > 110) continue;
          const below = w.getBlock(cx, yy - 1, cz);
          if (below === 255 || !blockDef(below).solid) continue;
          if (free(w.getBlock(cx, yy, cz)) && free(w.getBlock(cx, yy + 1, cz)) && free(w.getBlock(cx, yy + 2, cz))) return { x: cx, y: yy, z: cz };
        }
      }
    }
    return { x: Math.floor(x), y: hint, z: Math.floor(z) };
  }

  /** World meta for leaving this dimension (saved by the app before reloading at the destination). */
  travelMeta(target: Dim, via: TravelVia): WorldMeta {
    const snap = this.snapshotMeta();
    const b = this.player.body;
    const here: Vec3 = { x: b.x, y: b.y, z: b.z };
    const dimPos = { ...(snap.dimPos ?? {}), [this.dim]: here };
    const spawn = { ...this.player.spawn };
    let dest: Vec3;
    let arrival: Arrival;
    if (via === 'respawn') {
      dest = spawn;
      arrival = 'spawn';
    } else if (via === 'rift') {
      arrival = 'rift';
      if (target === 'emberdeep') {
        const scaled = { x: here.x / EMBER_SCALE, y: 64, z: here.z / EMBER_SCALE };
        const link = snap.emberLink;
        // Reuse the linked portal unless this rift is far from the one that made the link.
        dest = link && Math.hypot(link.x - scaled.x, link.z - scaled.z) < 48 ? link : scaled;
      } else {
        const back = dimPos.overworld;
        dest = back ?? { x: here.x * EMBER_SCALE, y: 70, z: here.z * EMBER_SCALE };
      }
    } else if (target === 'voidreach') {
      dest = { x: 0.5, y: 70, z: 0.5 };
      arrival = 'gate';
    } else {
      dest = dimPos.overworld ?? spawn;
      arrival = 'return';
    }
    const player = snap.player!;
    return {
      ...snap,
      dim: target,
      dimPos,
      arrival,
      mobs: [],
      mobsDim: target,
      emberLink: target === 'emberdeep' && via === 'rift' && dest !== snap.emberLink ? undefined : snap.emberLink,
      player: {
        ...player,
        x: dest.x, y: dest.y, z: dest.z,
        flying: player.flying && this.creative,
        ...(via === 'respawn' ? { health: 20, hunger: 20, saturation: 5 } : {}),
      },
    };
  }

  private starterKit(): void {
    // Nothing given: survival starts with bare hands. (Intentionally empty.)
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const loop = (t: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.1, Math.max(0, (t - this.last) / 1000));
      this.last = t;
      try {
        this.frame(dt);
      } catch (e) {
        this.running = false;
        cancelAnimationFrame(this.raf);
        this.host.onFatal(e);
      }
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  setPaused(p: boolean): void {
    this.paused = p;
    this.input.gameplay = !p && !this.player.dead;
    if (p) {
      this.interaction.reset();
      this.touch?.reset();
    }
    this.adaptive.reset();
  }

  respawn(): void {
    if (this.dim !== 'overworld') {
      // Respawning always happens at the overworld spawn point.
      this.host.onTravel('overworld', 'respawn');
      return;
    }
    this.player.respawn();
    this.needsUnstick = true;
    this.interaction.reset();
  }

  // ---------------- inventory helpers ----------------

  heldStack(): ItemStack | null {
    return this.inventory.slots[this.selected];
  }

  select(i: number): void {
    this.selected = ((i % HOTBAR_SIZE) + HOTBAR_SIZE) % HOTBAR_SIZE;
    this.interaction.reset();
  }

  consumeHeld(n: number): void {
    const s = this.inventory.slots[this.selected];
    if (!s) return;
    s.count -= n;
    if (s.count <= 0) this.inventory.slots[this.selected] = null;
  }

  wearHeld(n: number): void {
    if (this.creative) return;
    const s = this.inventory.slots[this.selected];
    if (!s) return;
    const name = itemName(s.id);
    if (this.inventory.wear(this.selected, n)) {
      audio.toolBreak();
      this.hud.toast(`${name} broke!`, true);
    }
  }

  give(id: number, n: number): void {
    const left = this.inventory.add(id, n);
    audio.pickup();
    if (left > 0) this.hud.toast('Inventory full — item lost', true);
  }

  /** Switch between Survival and Creative for this world (saved with the world). */
  setMode(mode: 'survival' | 'creative'): void {
    this.creative = mode === 'creative';
    this.meta = { ...this.meta, mode };
    this.player.creative = this.creative;
    if (!this.creative) this.player.flying = false;
    this.hud.setMode(this.creative);
    this.hud.reset();
    this.hud.toast(this.creative ? 'Creative mode: unlimited blocks, flight, no damage' : 'Survival mode');
    void this.save().catch(() => undefined);
  }

  /** Spawn a broken block's drops as item entities at the block's center. */
  dropBlockItems(blockId: number, x: number, y: number, z: number): void {
    for (const d of blockDef(blockId).drop ?? []) {
      if (d.chance !== undefined && Math.random() > d.chance) continue;
      this.drops.spawn(d.id, d.count, x + 0.5, y + 0.3, z + 0.5);
    }
  }

  /** Q: throw one of the held item forward. */
  private dropSelected(): void {
    const s = this.inventory.slots[this.selected];
    if (!s) return;
    const dur = s.dur;
    this.consumeHeld(1);
    const [fx, fz] = this.player.forward();
    const p = this.player.body;
    this.drops.spawn(s.id, 1, p.x + fx * 0.4, this.player.eyeY - 0.35, p.z + fz * 0.4, {
      vx: fx * 5, vz: fz * 5, vy: 2.5, delay: 1.2, dur,
    });
    this.hand.doSwing();
    this.hud.showItemName(`Dropped ${itemName(s.id)}`);
  }

  openInventory(): void {
    this.host.onRequestInventory();
  }

  /** Crafting stations within 4 blocks of the player. */
  nearbyStations(): Set<Station> {
    const st = new Set<Station>();
    const b = this.player.body;
    for (let x = -4; x <= 4; x++)
      for (let y = -3; y <= 3; y++)
        for (let z = -4; z <= 4; z++) {
          const id = this.world.getBlock(b.x + x, b.y + 1 + y, b.z + z);
          if (id === B.FORGE_BENCH) st.add('bench');
          else if (id === B.KILN) st.add('kiln');
        }
    return st;
  }

  // ---------------- settings & quality ----------------

  applySettings(s: Settings): void {
    const prevAo = this.world.ao;
    this.settings = s;
    this.world.renderDistance = Math.min(s.renderDistance, this.caps.renderDistance);
    this.world.ao = s.ao && this.caps.ao;
    if (this.world.ao !== prevAo) this.world.remeshAll();
    this.particles.limit = !this.caps.particles || s.particles === 'off' ? 0 : s.particles === 'low' ? Math.min(120, this.particles.capacity) : this.particles.capacity;
    this.sky.cloudsVisible = s.clouds && this.caps.clouds;
    this.r.setQuality(Math.min(s.resolutionScale, this.caps.resolution), this.mobile);
    audio.setVolumes(s.master, s.effects, s.ambient, s.music);
    if (this.hud.minimap) this.hud.minimap.visible = s.showMap && this.dim !== 'emberdeep';
    this.player.autoJump = s.autoJump;
    this.debugOn = s.showDebug;
    this.mobs.maxPassive = this.mobile ? 5 : 8;
    this.mobs.maxHostile = this.mobile ? 3 : 6;
  }

  private applyAdaptive(step: QualityStep): void {
    const s = this.settings;
    switch (step) {
      case 'particles': this.caps.particles = false; break;
      case 'clouds': this.caps.clouds = false; break;
      case 'resolution': this.caps.resolution = Math.max(0.5, Math.min(s.resolutionScale, this.caps.resolution) - 0.15); break;
      case 'renderDistance': this.caps.renderDistance = Math.max(3, Math.min(s.renderDistance, this.caps.renderDistance) - 1); break;
      case 'ao': this.caps.ao = false; break;
    }
    this.applySettings(s);
    console.info(`[BlockForge] adaptive quality: reduced ${step} (fps ${this.adaptive.lastFps.toFixed(1)})`);
    this.hud.toast('Adjusted graphics for smoother play');
  }

  // ---------------- frame ----------------

  private updateCamera(dt: number): void {
    const p = this.player;
    const cam = this.camera;
    let bobY = 0;
    let bobX = 0;
    if (!this.settings.reducedMotion && p.onGround && !p.flying) {
      const speed = Math.hypot(p.vx, p.vz);
      const amp = Math.min(1, speed / 6) * 0.045;
      bobY = Math.abs(Math.sin(p.bob)) * amp;
      bobX = Math.cos(p.bob) * amp * 0.5;
    }
    cam.position.set(p.body.x + bobX * Math.cos(p.yaw), p.eyeY + bobY, p.body.z - bobX * Math.sin(p.yaw));
    cam.rotation.set(p.pitch, p.yaw, 0, 'YXZ');
    const targetFov = this.settings.fov + (p.sprinting && !this.settings.reducedMotion ? 7 : 0) + (p.flying && p.sprinting ? 5 : 0);
    this.fovCurrent += (targetFov - this.fovCurrent) * Math.min(1, dt * 8);
    if (Math.abs(cam.fov - this.fovCurrent) > 0.01) {
      cam.fov = this.fovCurrent;
      cam.updateProjectionMatrix();
    }
  }

  private frame(dt: number): void {
    this.elapsed += dt;
    const p = this.player;
    const s = this.settings;
    const look = this.input.consumeLook(dt, s.mouseSens, s.touchSens, s.invertY);
    const active = !this.paused && !p.dead;

    if (active) {
      p.look(look.dx, look.dy);
      const hb = this.input.consumeHotbar();
      if (hb.pick >= 0) this.select(hb.pick);
      if (hb.wheel !== 0) this.select(this.selected + hb.wheel);
      p.creative = this.creative;
      if (this.needsUnstick && this.world.isChunkLoaded(toChunk(p.body.x), toChunk(p.body.z))) {
        p.ensureFree(this.world);
        this.needsUnstick = false;
      }
      p.update(dt, this.input, this.world);
      this.interaction.update(dt);
      this.time += dt / DAY_LENGTH;
      if (this.time >= 1) {
        this.time -= 1;
        this.day++;
      }
      this.mobs.update(dt, this.sky.state.day, p.dead, this.mobile ? 0.6 : 1);
      this.updateRift(dt);
      this.fluids.update(dt);
      this.autosaveTimer -= dt;
      if (this.autosaveTimer <= 0) {
        this.autosaveTimer = AUTOSAVE_SEC;
        void this.save();
      }
      if (s.adaptive) {
        const step = this.adaptive.feed(dt);
        if (step) this.applyAdaptive(step);
      }
    } else {
      this.input.consumeHotbar();
    }
    if (p.flying !== this.lastFlying) {
      this.lastFlying = p.flying;
      this.hud.setFlying(p.flying);
    }

    const [fx, fz] = p.forward();
    this.world.update(p.body.x, p.body.z, fx, fz, !this.underground && p.eyeY > 30);
    this.updateCamera(dt);

    // Sky & lighting.
    const viewDist = this.world.renderDistance * CHUNK_SIZE;
    this.sky.update(this.time, this.camera.position, this.elapsed, viewDist);
    const st = this.sky.state;
    worldUniforms.uDaylight.value = st.brightness;
    worldUniforms.uLightColor.value.copy(st.light);
    worldUniforms.uTime.value = this.elapsed;
    worldUniforms.uAmbient.value = AMBIENT[this.dim][0];
    worldUniforms.uAmbientColor.value.copy(AMBIENT[this.dim][1]);
    this.mobs.setLight(st.brightness, st.sunDir);
    const underwater = p.headInWater;
    if (p.headInMagma) {
      worldUniforms.uFogColor.value.copy(MAGMA_FOG);
      worldUniforms.uSkyTop.value.copy(MAGMA_FOG);
      worldUniforms.uFogNear.value = 0.3;
      worldUniforms.uFogFar.value = 3.5;
    } else if (underwater) {
      worldUniforms.uFogColor.value.copy(UNDERWATER_FOG).multiplyScalar(0.4 + st.brightness * 0.6);
      worldUniforms.uSkyTop.value.copy(worldUniforms.uFogColor.value);
      worldUniforms.uFogNear.value = 1;
      worldUniforms.uFogFar.value = 22;
    } else {
      worldUniforms.uFogColor.value.copy(st.horizon);
      worldUniforms.uSkyTop.value.copy(st.top);
      worldUniforms.uFogFar.value = Math.max(32, viewDist - 4);
      worldUniforms.uFogNear.value = worldUniforms.uFogFar.value * 0.55;
      if (this.dim === 'emberdeep') {
        // Thick, hot haze.
        worldUniforms.uFogFar.value = Math.max(28, Math.min(72, viewDist * 0.8));
        worldUniforms.uFogNear.value = worldUniforms.uFogFar.value * 0.2;
      }
    }
    if (p.headInMagma !== this.wasInMagma) {
      this.wasInMagma = p.headInMagma;
      document.getElementById('overlay-magma')?.classList.toggle('on', p.headInMagma);
    }
    if (underwater !== this.wasUnderwater) {
      this.wasUnderwater = underwater;
      document.getElementById('overlay-water')?.classList.toggle('on', underwater);
    }
    const hurt = document.getElementById('overlay-hurt');
    if (hurt) hurt.style.opacity = String(Math.min(1, p.hurtFlash) * 0.9);

    this.particles.update(dt, this.world.isSolid);
    this.highlight.tick(dt);
    const picked = this.drops.update(
      active ? dt : 0,
      this.world.collisionAt,
      p.dead ? null : { x: p.body.x, y: p.body.y, z: p.body.z },
      (id, n, dur) => this.inventory.add(id, n, dur),
      st.brightness,
    );
    if (picked) audio.pickup();

    // HUD.
    this.hud.updateHotbar(this.inventory, this.selected);
    if (!this.creative) this.hud.updateStats(p.health, p.hunger, p.air, MAX_AIR, p.headInWater);
    this.hud.setClock(this.time, this.day);
    this.undergroundTimer -= dt;
    if (this.undergroundTimer <= 0) {
      this.undergroundTimer = 1;
      this.underground = p.isUnderground(this.world);
    }
    const enclosed = this.underground || this.dim === 'emberdeep';
    audio.updateAmbient(this.elapsed, p.body.y, st.day, enclosed);
    audio.updateMusic(this.elapsed, st.day, enclosed);
    // Emberdeep has a solid roof, so a top-down map would only show the ceiling.
    if (this.dim !== 'emberdeep') this.hud.minimap?.update(dt, this.world, p.body.x, p.body.y, p.body.z, p.yaw);

    // FPS / debug.
    this.fpsAcc += dt;
    this.fpsFrames++;
    if (this.fpsAcc >= 0.5) {
      this.fps = this.fpsFrames / this.fpsAcc;
      this.fpsAcc = 0;
      this.fpsFrames = 0;
    }
    this.debugTimer -= dt;
    if (this.debugOn && this.debugTimer <= 0) {
      this.debugTimer = 0.25;
      this.hud.setDebug(this.debugText());
    } else if (!this.debugOn) this.hud.setDebug(null);

    const held = this.heldStack();
    const speed = Math.hypot(p.vx, p.vz);
    this.hand.visible = !p.dead;
    this.hand.update(dt, held ? held.id : -1, p.bob, this.settings.reducedMotion || !p.onGround ? 0 : Math.min(1, speed / 5), st.brightness, this.camera.aspect);
    this.r.render();
    this.hand.render(this.r.renderer);
  }

  private underground = false;
  private undergroundTimer = 0;

  /** Standing in a rift long enough pulls the player through to the linked dimension. */
  private updateRift(dt: number): void {
    const p = this.player;
    const b = p.body;
    const inRift = isRiftId(this.world.getBlock(b.x, b.y + 0.2, b.z)) || isRiftId(this.world.getBlock(b.x, b.y + 1.2, b.z));
    if (!inRift) this.portalLock = false;
    if (inRift && !this.portalLock && !this.travelling && !p.dead) {
      this.portalTime += dt;
      if (this.portalTime >= (this.creative ? 0.8 : RIFT_TIME)) {
        this.travelling = true;
        audio.blink();
        this.host.onTravel(this.dim === 'emberdeep' ? 'overworld' : 'emberdeep', 'rift');
      }
    } else this.portalTime = Math.max(0, this.portalTime - dt * 2);
    const fx = document.getElementById('overlay-rift');
    if (fx) fx.style.opacity = String(Math.min(1, this.portalTime / RIFT_TIME) * 0.95);
  }

  toast(msg: string): void {
    this.hud.toast(msg);
  }

  /** Use a Void Gate: to Voidreach, or home to the overworld from there. */
  useVoidGate(): void {
    if (this.travelling) return;
    this.travelling = true;
    audio.blink();
    this.host.onTravel(this.dim === 'voidreach' ? 'overworld' : 'voidreach', 'gate');
  }

  private debugText(): string {
    const p = this.player;
    const ws = this.world.stats();
    const ri = this.r.info();
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    return [
      `BlockForge  ${this.fps.toFixed(0)} fps`,
      `XYZ ${p.body.x.toFixed(1)} ${p.body.y.toFixed(1)} ${p.body.z.toFixed(1)}`,
      `Chunk ${toChunk(p.body.x)}, ${toChunk(p.body.z)}  ${this.world.gen.describe(p.body.x, p.body.z)}`,
      `Chunks ${ws.meshed}/${ws.loaded} loaded  jobs ${ws.pending}  workers ${ws.fallback ? 'main-thread' : ws.workers}`,
      `Draw calls ${ri.calls}  tris ${(ri.triangles / 1000).toFixed(0)}k  geos ${ri.geometries}`,
      `Mobs ${this.mobs.mobs.length}  RD ${this.world.renderDistance}  res ${(this.r.renderer.getPixelRatio()).toFixed(2)}`,
      mem ? `Heap ${(mem.usedJSHeapSize / 1048576).toFixed(0)} MB` : '',
    ].filter(Boolean).join('\n');
  }

  // ---------------- saving ----------------

  snapshotMeta(): WorldMeta {
    const p = this.player;
    return {
      ...this.meta,
      lastPlayed: Date.now(),
      time: this.time,
      day: this.day,
      version: SAVE_VERSION,
      mobsDim: this.dim,
      mobs: this.mobs.mobs
        .filter((m) => Math.hypot(m.body.x - p.body.x, m.body.z - p.body.z) < 64)
        .map((m) => ({ kind: m.kind, x: m.body.x, y: m.body.y, z: m.body.z, health: m.health })),
      player: {
        x: p.body.x, y: p.body.y, z: p.body.z, yaw: p.yaw, pitch: p.pitch,
        health: p.dead ? 20 : p.health, hunger: p.dead ? 20 : p.hunger, saturation: p.saturation,
        inventory: this.inventory.toJSON(), selected: this.selected, flying: p.flying,
        spawn: { ...p.spawn },
        ...(p.dead ? { x: p.spawn.x, y: p.spawn.y, z: p.spawn.z } : {}),
      },
    };
  }

  /** Save meta + modified chunks. Serialized so concurrent saves never interleave. */
  save(): Promise<void> {
    this.saving = this.saving
      .catch(() => undefined)
      .then(async () => {
        const meta = this.snapshotMeta();
        await this.world.flush();
        await this.store.putWorld(meta);
        this.meta = meta;
      })
      .catch((e) => {
        console.error('[BlockForge] save failed', e);
        this.hud.toast('Saving failed — storage may be full or blocked', true);
        throw e;
      });
    return this.saving;
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
    this.offInput();
    const scene = this.r.scene;
    scene.remove(this.sky.group, this.world.group, this.highlight.group, this.particles.mesh, this.mobs.group, this.drops.group);
    this.mobs.dispose();
    this.drops.dispose();
    this.world.dispose();
    this.sky.dispose();
    this.particles.dispose();
    this.highlight.dispose();
    this.hand.dispose();
    this.hud.onHotbarSelect = undefined;
    document.getElementById('overlay-water')?.classList.remove('on');
    document.getElementById('overlay-magma')?.classList.remove('on');
    const rift = document.getElementById('overlay-rift');
    if (rift) rift.style.opacity = '0';
    const hurt = document.getElementById('overlay-hurt');
    if (hurt) hurt.style.opacity = '0';
  }
}
