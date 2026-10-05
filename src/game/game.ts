import * as THREE from 'three';
import { audio } from '../audio/audio';
import { CHUNK_SIZE, DAY_LENGTH, WORLD_HEIGHT } from '../core/constants';
import { toChunk } from '../core/coords';
import { B } from '../core/ids';
import type { InputManager } from '../input/input';
import type { TouchControls } from '../input/touch';
import { MAX_AIR, Player } from '../player/player';
import { BlockHighlight, Particles } from '../render/effects';
import { worldUniforms } from '../render/materials';
import type { Renderer } from '../render/renderer';
import { Sky } from '../render/sky';
import type { SaveStore } from '../save/db';
import { SAVE_VERSION, type WorldMeta } from '../save/serialize';
import type { Hud } from '../ui/hud';
import { BIOME_NAMES } from '../world/generator';
import { blockDef } from '../world/blocks';
import { World } from '../world/world';
import { AdaptiveQuality, type QualityStep } from './adaptive';
import type { Station } from './crafting';
import { Interaction } from './interaction';
import { HOTBAR_SIZE, Inventory, type ItemStack } from './inventory';
import { itemName } from './items';
import { MobManager } from './mobs';
import type { Settings } from './settings';

export interface GameHost {
  onDeath(cause: string): void;
  onRequestPause(): void;
  onRequestInventory(): void;
  onFatal(err: unknown): void;
}

const DEATH_TEXT: Record<string, string> = {
  fall: 'You hit the ground too hard.',
  void: 'You fell out of the world.',
  starve: 'You starved.',
  drown: 'You ran out of air.',
  crawler: 'A Shadow Crawler got you.',
};

const AUTOSAVE_SEC = 30;
const UNDERWATER_FOG = new THREE.Color(0.05, 0.16, 0.32);

export class Game {
  readonly world: World;
  readonly player: Player;
  inventory: Inventory;
  selected = 0;
  readonly sky = new Sky();
  readonly highlight: BlockHighlight;
  readonly particles: Particles;
  readonly mobs: MobManager;
  readonly interaction: Interaction;
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
    this.world = new World(meta.seedNum, meta.id, store, r.materials, settings.renderDistance, settings.ao);
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
        this.particles.burst(this.player.body.x, this.player.eyeY - 0.4, this.player.body.z, new THREE.Color(0.75, 0.1, 0.1), 5);
      },
      splash: () => {
        audio.splash();
        this.particles.burst(this.player.body.x, this.player.body.y + 0.5, this.player.body.z, new THREE.Color(0.55, 0.75, 1), 12, 3, 4);
      },
      death: (cause) => {
        audio.death();
        this.host.onDeath(DEATH_TEXT[cause] ?? 'You were defeated.');
      },
    });
    this.player.creative = this.creative;
    this.inventory = Inventory.fromJSON(meta.player?.inventory ?? []);
    this.highlight = new BlockHighlight(r.atlas);
    this.particles = new Particles(mobile ? 120 : 400, r.atlasCanvas);
    this.mobs = new MobManager(this.world, {
      hurtPlayer: (amount, fx, fz) => {
        if (this.player.dead || this.creative) return;
        this.player.hurt(amount, 'crawler');
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
        if (!this.creative) for (const [id, n] of drops) this.give(id, n);
      },
      sound: (kind, mob) => {
        const d = Math.hypot(mob.body.x - this.player.body.x, mob.body.z - this.player.body.z);
        if (d > 24) return;
        if (kind === 'hiss') audio.mobHiss();
        else audio.mobGrunt(mob.kind === 'boar' ? 0.8 : 1.2);
      },
    });
    this.interaction = new Interaction(this);
    this.adaptive = new AdaptiveQuality(mobile ? 30 : 55);

    const scene = r.scene;
    scene.add(this.sky.group, this.world.group, this.highlight.group, this.particles.mesh, this.mobs.group);

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
      // Use real block data (trees, caves) for the final spawn height.
      const sy = this.world.surfaceY(x, z);
      if (sy > 0) {
        y = Math.min(WORLD_HEIGHT - 2, sy + 1);
        this.player.setPosition(x, y, z);
      }
      this.player.spawn = { x, y, z };
      this.time = 0.04;
    }
    this.player.ensureFree(this.world);
    progress('Entering world…', 1);
    this.updateCamera(0);
    this.sky.update(this.time, this.camera.position, 0, this.world.renderDistance * CHUNK_SIZE);
    if (fresh) await this.save();
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

  giveDrops(blockId: number): void {
    for (const d of blockDef(blockId).drop ?? []) {
      if (d.chance !== undefined && Math.random() > d.chance) continue;
      this.give(d.id, d.count);
    }
  }

  private dropSelected(): void {
    const s = this.inventory.slots[this.selected];
    if (!s) return;
    this.consumeHeld(1);
    this.hud.toast(`Discarded ${itemName(s.id)}`);
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
    audio.setVolumes(s.master, s.effects, s.ambient);
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
    this.input.pollGamepad();
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
    this.world.update(p.body.x, p.body.z, fx, fz);
    this.updateCamera(dt);

    // Sky & lighting.
    const viewDist = this.world.renderDistance * CHUNK_SIZE;
    this.sky.update(this.time, this.camera.position, this.elapsed, viewDist);
    const st = this.sky.state;
    worldUniforms.uDaylight.value = st.brightness;
    worldUniforms.uLightColor.value.copy(st.light);
    worldUniforms.uTime.value = this.elapsed;
    this.mobs.setLight(st.brightness, st.sunDir);
    const underwater = p.headInWater;
    if (underwater) {
      worldUniforms.uFogColor.value.copy(UNDERWATER_FOG).multiplyScalar(0.4 + st.brightness * 0.6);
      worldUniforms.uFogNear.value = 1;
      worldUniforms.uFogFar.value = 22;
    } else {
      worldUniforms.uFogColor.value.copy(st.horizon);
      worldUniforms.uFogFar.value = Math.max(32, viewDist - 4);
      worldUniforms.uFogNear.value = worldUniforms.uFogFar.value * 0.55;
    }
    if (underwater !== this.wasUnderwater) {
      this.wasUnderwater = underwater;
      document.getElementById('overlay-water')?.classList.toggle('on', underwater);
    }
    const hurt = document.getElementById('overlay-hurt');
    if (hurt) hurt.style.opacity = String(Math.min(1, p.hurtFlash) * 0.9);

    this.particles.update(dt, this.world.isSolid);

    // HUD.
    this.hud.updateHotbar(this.inventory, this.selected);
    if (!this.creative) this.hud.updateStats(p.health, p.hunger, p.air, MAX_AIR, p.headInWater);
    this.hud.setClock(this.time, this.day);
    this.undergroundTimer -= dt;
    if (this.undergroundTimer <= 0) {
      this.undergroundTimer = 1;
      this.underground = p.isUnderground(this.world);
    }
    audio.updateAmbient(this.elapsed, p.body.y, st.day, this.underground);

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

    this.r.render();
  }

  private underground = false;
  private undergroundTimer = 0;

  private debugText(): string {
    const p = this.player;
    const ws = this.world.stats();
    const ri = this.r.info();
    const col = this.world.gen.column(Math.floor(p.body.x), Math.floor(p.body.z));
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    return [
      `BlockForge  ${this.fps.toFixed(0)} fps`,
      `XYZ ${p.body.x.toFixed(1)} ${p.body.y.toFixed(1)} ${p.body.z.toFixed(1)}`,
      `Chunk ${toChunk(p.body.x)}, ${toChunk(p.body.z)}  Biome ${BIOME_NAMES[col.biome]}`,
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
    scene.remove(this.sky.group, this.world.group, this.highlight.group, this.particles.mesh, this.mobs.group);
    this.mobs.clear();
    this.world.dispose();
    this.sky.dispose();
    this.particles.dispose();
    this.highlight.dispose();
    this.hud.onHotbarSelect = undefined;
    document.getElementById('overlay-water')?.classList.remove('on');
    const hurt = document.getElementById('overlay-hurt');
    if (hurt) hurt.style.opacity = '0';
  }
}
