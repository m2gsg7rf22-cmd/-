import * as THREE from 'three';
import { B, I, isLiquidId, isMagmaId, isWaterId } from '../core/ids';
import { collides, moveBody, type Body } from '../player/physics';
import { SOLID } from '../world/blocks';
import type { Dim } from '../world/dimension';
import { UNLOADED, type World } from '../world/world';
import { animateDragon, buildDragon, nextPhase, type DragonArena, type DragonBrain } from './dragon';

export type MobKind =
  | 'grazer' | 'boar' | 'crawler' | 'featherback' | 'bonewalker'
  | 'hopper' | 'wraith' | 'emberhog'
  | 'voidwalker' | 'shardling' | 'dragon';

type State = 'idle' | 'wander' | 'notice' | 'chase' | 'attack' | 'flee';
/** 'always' attacks on sight, 'neutral' only after being hit, false never. */
type Temper = 'always' | 'neutral' | false;
type Shot = 'bone' | 'ember' | 'void';

interface MobSpec {
  name: string;
  hw: number;
  h: number;
  health: number;
  speed: number;
  temper: Temper;
  damage: number;
  /** id, min, max, chance (default 1) */
  drops: [number, number, number, number?][];
  /** Flies (no gravity, hovers toward its target height). */
  fly?: boolean;
  /** Moves only by hopping. */
  hop?: boolean;
  /** Fires projectiles from range instead of meleeing. */
  shoot?: Shot;
  /** Teleports away when hurt. */
  blink?: boolean;
  /** Fades out in daylight (overworld night creatures). */
  nocturnal?: boolean;
  /** Unharmed by magma. */
  fireproof?: boolean;
  /** Grunt pitch for the generic voice. */
  voice: number;
  /** Boss: its own AI, never despawns, shown on the boss bar. */
  boss?: boolean;
}

export const MOB_SPECS: Record<MobKind, MobSpec> = {
  grazer: { name: 'Grazer', hw: 0.42, h: 1.25, health: 8, speed: 1.6, temper: false, damage: 0, drops: [[I.RAW_MEAT, 1, 2]], voice: 1.2 },
  boar: { name: 'Voxel Boar', hw: 0.4, h: 0.95, health: 10, speed: 2.0, temper: false, damage: 0, drops: [[I.RAW_MEAT, 1, 3]], voice: 0.8 },
  featherback: { name: 'Featherback', hw: 0.25, h: 0.7, health: 4, speed: 1.8, temper: false, damage: 0, drops: [[I.RAW_MEAT, 1, 1], [I.FEATHER, 1, 2]], voice: 2.2 },
  crawler: { name: 'Shadow Crawler', hw: 0.45, h: 0.8, health: 14, speed: 3.6, temper: 'always', damage: 3, drops: [[I.EMBER, 0, 2]], nocturnal: true, voice: 0.6 },
  bonewalker: { name: 'Bonewalker', hw: 0.3, h: 1.85, health: 16, speed: 2.4, temper: 'always', damage: 2, drops: [[I.BONE, 1, 3], [I.STICK, 0, 1]], shoot: 'bone', nocturnal: true, voice: 1.6 },
  hopper: { name: 'Magma Hopper', hw: 0.45, h: 0.9, health: 12, speed: 3.2, temper: 'always', damage: 3, drops: [[I.MAGMA_GEL, 1, 2]], hop: true, fireproof: true, voice: 0.5 },
  wraith: { name: 'Cinder Wraith', hw: 0.45, h: 1.4, health: 14, speed: 2.6, temper: 'always', damage: 3, drops: [[I.VOID_PEARL, 1, 1, 0.4], [I.EMBER, 1, 2]], fly: true, shoot: 'ember', fireproof: true, voice: 0.4 },
  emberhog: { name: 'Ember Hog', hw: 0.45, h: 1.0, health: 16, speed: 2.4, temper: 'neutral', damage: 4, drops: [[I.ROAST_MEAT, 1, 2], [I.MAGMA_GEL, 0, 1]], fireproof: true, voice: 0.7 },
  voidwalker: { name: 'Voidwalker', hw: 0.3, h: 2.7, health: 24, speed: 3.0, temper: 'neutral', damage: 5, drops: [[I.VOID_PEARL, 1, 2]], blink: true, voice: 0.35 },
  dragon: { name: 'Void Dragon', hw: 2.0, h: 2.3, health: 200, speed: 11, temper: 'always', damage: 7, drops: [[I.VOID_PEARL, 6, 10], [I.LUMEN_SHARD, 3, 6]], fly: true, shoot: 'void', boss: true, voice: 0.22 },
  shardling: { name: 'Shardling', hw: 0.35, h: 0.8, health: 10, speed: 2.8, temper: 'always', damage: 2, drops: [[I.LUMEN_SHARD, 0, 1], [I.VOID_PEARL, 0, 1, 0.25]], fly: true, shoot: 'void', voice: 2.6 },
};

export const MOB_KINDS = Object.keys(MOB_SPECS) as MobKind[];

export interface Mob {
  id: number;
  kind: MobKind;
  body: Body;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  health: number;
  state: State;
  timer: number;
  target: { x: number; z: number } | null;
  onGround: boolean;
  hurtTime: number;
  attackCd: number;
  walk: number;
  /** Has been provoked (neutral creatures). */
  angry: boolean;
  /** Preferred hover height (fliers). */
  hoverY: number;
  group: THREE.Group;
  legs: THREE.Object3D[];
  arms: THREE.Object3D[];
  wings: THREE.Object3D[];
  body3d: THREE.Object3D | null;
  mats: THREE.MeshLambertMaterial[];
  fade: number;
  /** Boss AI state (Void Dragon). */
  brain?: DragonBrain;
}

interface Projectile {
  kind: Shot;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number;
  damage: number;
  /** Who fired it (for death messages). */
  source: MobKind;
  mesh: THREE.Mesh;
}

export interface MobCallbacks {
  hurtPlayer(amount: number, fromX: number, fromZ: number, cause: string): void;
  playerPos(): { x: number; y: number; z: number };
  onKilled(mob: Mob, drops: [number, number][]): void;
  sound(kind: 'grunt' | 'hiss' | 'shoot' | 'blink', mob: Mob): void;
}

function box(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, geos: THREE.BufferGeometry[]): THREE.Mesh {
  const g = new THREE.BoxGeometry(w, h, d);
  geos.push(g);
  const m = new THREE.Mesh(g, mat);
  m.position.set(x, y, z);
  return m;
}

interface Model {
  group: THREE.Group;
  legs: THREE.Object3D[];
  arms: THREE.Object3D[];
  wings: THREE.Object3D[];
  body3d: THREE.Object3D | null;
  mats: THREE.MeshLambertMaterial[];
}

/** Build a blocky creature model. Models face -Z. */
function buildModel(kind: MobKind, geos: THREE.BufferGeometry[]): Model & { brainParts?: { tail: THREE.Object3D[]; jaw: THREE.Object3D } } {
  const group = new THREE.Group();
  const legs: THREE.Object3D[] = [];
  const arms: THREE.Object3D[] = [];
  const wings: THREE.Object3D[] = [];
  const mats: THREE.MeshLambertMaterial[] = [];
  let body3d: THREE.Object3D | null = null;
  const mat = (c: number, emissive = 0) => {
    const m = new THREE.MeshLambertMaterial({ color: c, emissive });
    m.userData.baseEmissive = emissive;
    mats.push(m);
    return m;
  };
  /** A limb hanging from a pivot at (x, y, z), length h. */
  const limb = (list: THREE.Object3D[], x: number, y: number, z: number, h: number, w: number, m: THREE.Material, parent: THREE.Object3D = group) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, z);
    pivot.add(box(w, h, w, m, 0, -h / 2, 0, geos));
    parent.add(pivot);
    list.push(pivot);
    return pivot;
  };
  const leg = (x: number, z: number, h: number, w: number, m: THREE.Material) => limb(legs, x, h, z, h, w, m);

  switch (kind) {
    case 'grazer': {
      const wool = mat(0xe8e2d0), moss = mat(0x6f9a4f), skin = mat(0x8a6b55), dark = mat(0x2a2220);
      group.add(box(0.8, 0.55, 1.15, wool, 0, 0.82, 0, geos));
      group.add(box(0.6, 0.12, 0.9, moss, 0, 1.15, 0.05, geos));
      group.add(box(0.42, 0.42, 0.42, skin, 0, 1.0, -0.72, geos));
      group.add(box(0.08, 0.08, 0.02, dark, -0.12, 1.06, -0.94, geos));
      group.add(box(0.08, 0.08, 0.02, dark, 0.12, 1.06, -0.94, geos));
      group.add(box(0.1, 0.18, 0.1, wool, -0.2, 1.28, -0.66, geos));
      group.add(box(0.1, 0.18, 0.1, wool, 0.2, 1.28, -0.66, geos));
      for (const [x, z] of [[-0.25, -0.38], [0.25, -0.38], [-0.25, 0.38], [0.25, 0.38]]) leg(x, z, 0.55, 0.18, skin);
      break;
    }
    case 'boar': {
      const hide = mat(0x8a5c3c), bristle = mat(0x5e3c26), snout = mat(0xc98d74), tusk = mat(0xf2ecd8);
      group.add(box(0.72, 0.5, 1.0, hide, 0, 0.6, 0, geos));
      group.add(box(0.2, 0.12, 0.85, bristle, 0, 0.9, 0.02, geos));
      group.add(box(0.5, 0.42, 0.42, hide, 0, 0.62, -0.66, geos));
      group.add(box(0.28, 0.2, 0.14, snout, 0, 0.56, -0.93, geos));
      group.add(box(0.05, 0.14, 0.05, tusk, -0.17, 0.55, -0.9, geos));
      group.add(box(0.05, 0.14, 0.05, tusk, 0.17, 0.55, -0.9, geos));
      for (const [x, z] of [[-0.22, -0.32], [0.22, -0.32], [-0.22, 0.32], [0.22, 0.32]]) leg(x, z, 0.38, 0.16, bristle);
      break;
    }
    case 'featherback': {
      const plume = mat(0xf4efe2), tan = mat(0xc9a46a), beak = mat(0xf0a020), comb = mat(0xd03030), eye = mat(0x111111);
      group.add(box(0.42, 0.36, 0.56, plume, 0, 0.5, 0, geos));
      group.add(box(0.3, 0.32, 0.28, plume, 0, 0.78, -0.3, geos));
      group.add(box(0.12, 0.08, 0.14, beak, 0, 0.74, -0.5, geos));
      group.add(box(0.06, 0.12, 0.16, comb, 0, 0.98, -0.3, geos));
      group.add(box(0.05, 0.05, 0.02, eye, -0.12, 0.82, -0.44, geos));
      group.add(box(0.05, 0.05, 0.02, eye, 0.12, 0.82, -0.44, geos));
      group.add(box(0.3, 0.26, 0.1, tan, 0, 0.62, 0.3, geos));
      for (const s of [-1, 1]) {
        const w = new THREE.Group();
        w.position.set(s * 0.22, 0.62, 0);
        w.add(box(0.06, 0.24, 0.42, tan, s * 0.03, -0.08, 0.02, geos));
        group.add(w);
        wings.push(w);
      }
      leg(-0.1, 0.02, 0.32, 0.05, beak);
      leg(0.1, 0.02, 0.32, 0.05, beak);
      break;
    }
    case 'crawler': {
      const shell = mat(0x2a2038), plate = mat(0x40305a), eye = mat(0xd84aff, 0xc030ff);
      group.add(box(0.9, 0.36, 1.0, shell, 0, 0.5, 0, geos));
      group.add(box(0.7, 0.14, 0.8, plate, 0, 0.74, 0.05, geos));
      group.add(box(0.6, 0.3, 0.32, shell, 0, 0.48, -0.62, geos));
      group.add(box(0.12, 0.08, 0.04, eye, -0.16, 0.54, -0.79, geos));
      group.add(box(0.12, 0.08, 0.04, eye, 0.16, 0.54, -0.79, geos));
      for (let i = 0; i < 3; i++) {
        leg(-0.5, -0.3 + i * 0.3, 0.42, 0.1, plate);
        leg(0.5, -0.3 + i * 0.3, 0.42, 0.1, plate);
      }
      break;
    }
    case 'bonewalker': {
      const bone = mat(0xd8d2c0), dark = mat(0x3a3530), eye = mat(0x9fe8ff, 0x50b0d0);
      group.add(box(0.38, 0.5, 0.2, bone, 0, 1.2, 0, geos)); // rib cage
      for (let i = 0; i < 3; i++) group.add(box(0.42, 0.04, 0.24, dark, 0, 1.06 + i * 0.14, 0, geos));
      group.add(box(0.12, 0.3, 0.12, bone, 0, 0.88, 0, geos)); // spine
      const head = new THREE.Group();
      head.position.set(0, 1.45, 0);
      head.add(box(0.4, 0.4, 0.4, bone, 0, 0.2, 0, geos));
      head.add(box(0.1, 0.08, 0.02, eye, -0.1, 0.24, -0.21, geos));
      head.add(box(0.1, 0.08, 0.02, eye, 0.1, 0.24, -0.21, geos));
      head.add(box(0.22, 0.05, 0.02, dark, 0, 0.07, -0.21, geos));
      group.add(head);
      body3d = head;
      limb(arms, -0.27, 1.42, 0, 0.62, 0.09, bone);
      limb(arms, 0.27, 1.42, 0, 0.62, 0.09, bone);
      limb(legs, -0.11, 0.75, 0, 0.75, 0.1, bone);
      limb(legs, 0.11, 0.75, 0, 0.75, 0.1, bone);
      break;
    }
    case 'hopper': {
      const crust = mat(0x3a1a12), crack = mat(0xff7a1a, 0xc04008), core = mat(0xffc040, 0xff8a10), eye = mat(0xfff0a0, 0xffd060);
      const b = new THREE.Group();
      b.add(box(0.9, 0.82, 0.9, crust, 0, 0.41, 0, geos));
      b.add(box(0.94, 0.08, 0.94, crack, 0, 0.3, 0, geos));
      b.add(box(0.94, 0.06, 0.94, crack, 0, 0.6, 0, geos));
      b.add(box(0.5, 0.4, 0.5, core, 0, 0.42, 0, geos));
      b.add(box(0.16, 0.1, 0.02, eye, -0.2, 0.56, -0.46, geos));
      b.add(box(0.16, 0.1, 0.02, eye, 0.2, 0.56, -0.46, geos));
      group.add(b);
      body3d = b;
      break;
    }
    case 'wraith': {
      const smoke = mat(0x3c3a40), ash = mat(0x5a5258), eye = mat(0xffa030, 0xff7010), ember = mat(0xff6020, 0xc03000);
      const b = new THREE.Group();
      b.add(box(0.7, 0.6, 0.6, smoke, 0, 1.0, 0, geos));
      b.add(box(0.56, 0.36, 0.5, ash, 0, 0.62, 0.02, geos));
      b.add(box(0.12, 0.08, 0.02, eye, -0.14, 1.06, -0.31, geos));
      b.add(box(0.12, 0.08, 0.02, eye, 0.14, 1.06, -0.31, geos));
      b.add(box(0.2, 0.06, 0.02, ember, 0, 0.88, -0.31, geos));
      group.add(b);
      body3d = b;
      // Trailing wisps animate like legs.
      for (const [x, z] of [[-0.18, -0.1], [0.18, -0.1], [0, 0.16], [-0.12, 0.2], [0.12, 0.2]]) limb(legs, x, 0.46, z, 0.42, 0.1, smoke, b);
      for (const s of [-1, 1]) limb(arms, s * 0.42, 1.18, 0, 0.5, 0.12, ash, b);
      break;
    }
    case 'emberhog': {
      const hide = mat(0x6e2a1e), mane = mat(0xff8030, 0xa03008), snout = mat(0xc06048), tusk = mat(0xfff0d0);
      group.add(box(0.8, 0.56, 1.1, hide, 0, 0.66, 0, geos));
      group.add(box(0.26, 0.16, 0.95, mane, 0, 1.0, 0.02, geos));
      group.add(box(0.56, 0.46, 0.46, hide, 0, 0.68, -0.72, geos));
      group.add(box(0.3, 0.22, 0.14, snout, 0, 0.6, -1.0, geos));
      group.add(box(0.06, 0.2, 0.06, tusk, -0.2, 0.62, -0.98, geos));
      group.add(box(0.06, 0.2, 0.06, tusk, 0.2, 0.62, -0.98, geos));
      group.add(box(0.08, 0.06, 0.02, mane, -0.15, 0.8, -0.96, geos));
      group.add(box(0.08, 0.06, 0.02, mane, 0.15, 0.8, -0.96, geos));
      for (const [x, z] of [[-0.25, -0.36], [0.25, -0.36], [-0.25, 0.36], [0.25, 0.36]]) leg(x, z, 0.4, 0.18, hide);
      break;
    }
    case 'voidwalker': {
      const skin = mat(0x16121c), sheen = mat(0x2a2236), eye = mat(0xd070ff, 0xb040ff);
      group.add(box(0.46, 0.8, 0.28, skin, 0, 1.75, 0, geos));
      group.add(box(0.5, 0.06, 0.3, sheen, 0, 2.1, 0, geos));
      const head = new THREE.Group();
      head.position.set(0, 2.15, 0);
      head.add(box(0.44, 0.44, 0.44, skin, 0, 0.22, 0, geos));
      head.add(box(0.14, 0.05, 0.02, eye, -0.11, 0.24, -0.23, geos));
      head.add(box(0.14, 0.05, 0.02, eye, 0.11, 0.24, -0.23, geos));
      group.add(head);
      body3d = head;
      limb(arms, -0.3, 2.1, 0, 1.25, 0.1, skin);
      limb(arms, 0.3, 2.1, 0, 1.25, 0.1, skin);
      limb(legs, -0.12, 1.36, 0, 1.36, 0.12, skin);
      limb(legs, 0.12, 1.36, 0, 1.36, 0.12, skin);
      break;
    }
    case 'dragon': {
      const d = buildDragon(geos, mat);
      return { group: d.group, legs: [], arms: [], wings: d.wings, body3d: d.head, mats, brainParts: { tail: d.tail, jaw: d.jaw } };
    }
    case 'shardling': {
      const shard = mat(0xb070f0, 0x6020a0), core = mat(0xffe0ff, 0xe0a0ff), dark = mat(0x301040);
      const b = new THREE.Group();
      b.add(box(0.4, 0.4, 0.4, shard, 0, 0.45, 0, geos));
      const top = box(0.28, 0.28, 0.28, shard, 0, 0.72, 0, geos);
      top.rotation.set(0.6, 0.6, 0);
      b.add(top);
      const bot = box(0.24, 0.24, 0.24, shard, 0, 0.2, 0, geos);
      bot.rotation.set(0.6, 0.6, 0);
      b.add(bot);
      b.add(box(0.16, 0.16, 0.16, core, 0, 0.45, -0.18, geos));
      b.add(box(0.06, 0.06, 0.02, dark, -0.06, 0.48, -0.27, geos));
      group.add(b);
      body3d = b;
      // Orbiting chips.
      for (let i = 0; i < 3; i++) {
        const w = new THREE.Group();
        w.position.set(0, 0.45, 0);
        w.rotation.y = (i / 3) * Math.PI * 2;
        w.add(box(0.1, 0.1, 0.1, shard, 0.45, 0, 0, geos));
        b.add(w);
        wings.push(w);
      }
      break;
    }
  }
  return { group, legs, arms, wings, body3d, mats };
}

/** Melee damage of a creature. */
const meleeDamage = (m: Mob): number => MOB_SPECS[m.kind].damage;

const SHOT_COLORS: Record<Shot, [number, number]> = {
  bone: [0xe8e2d0, 0x403830],
  ember: [0xffa040, 0xff6010],
  void: [0xe090ff, 0xa040ff],
};

export class MobManager {
  readonly group = new THREE.Group();
  mobs: Mob[] = [];
  private shots: Projectile[] = [];
  private shotGeo = new THREE.BoxGeometry(0.22, 0.22, 0.22);
  private shotMats = new Map<Shot, THREE.MeshLambertMaterial>();
  private nextId = 1;
  private spawnTimer = 0;
  private geos = new Map<number, THREE.BufferGeometry[]>();
  maxPassive = 8;
  maxHostile = 6;
  enabled = true;
  private hemi: THREE.HemisphereLight;
  private sun: THREE.DirectionalLight;
  private time = 0;
  /** Set in Voidreach while the dragon lives. */
  arena: DragonArena | null = null;

  constructor(private world: World, private cb: MobCallbacks, readonly dim: Dim = 'overworld') {
    this.hemi = new THREE.HemisphereLight(0xdfe8ff, 0x4a4030, 0.9);
    this.sun = new THREE.DirectionalLight(0xffffff, 1.2);
    this.sun.position.set(0.4, 1, 0.3);
    this.group.add(this.hemi, this.sun);
    if (dim === 'emberdeep') {
      this.hemi.color.setHex(0xffb090);
      this.hemi.groundColor.setHex(0xff5020);
    } else if (dim === 'voidreach') {
      this.hemi.color.setHex(0xd8c8ff);
      this.hemi.groundColor.setHex(0x402060);
    }
  }

  setLight(brightness: number, sunDir: THREE.Vector3): void {
    this.hemi.intensity = 0.6 + brightness * 1.8;
    this.sun.intensity = 0.3 + brightness * 2.2;
    this.sun.position.copy(sunDir);
  }

  spawn(kind: MobKind, x: number, y: number, z: number): Mob {
    const s = MOB_SPECS[kind] ?? MOB_SPECS.grazer;
    if (!MOB_SPECS[kind]) kind = 'grazer';
    const geos: THREE.BufferGeometry[] = [];
    const model = buildModel(kind, geos);
    const mob: Mob = {
      id: this.nextId++, kind, body: { x, y, z, hw: s.hw, h: s.h }, vx: 0, vy: 0, vz: 0, yaw: Math.random() * Math.PI * 2,
      health: s.health, state: 'idle', timer: 1 + Math.random() * 3, target: null, onGround: false, hurtTime: 0,
      attackCd: 0, walk: Math.random() * 6, angry: false, hoverY: y, fade: 1, ...model,
    };
    if (model.brainParts) {
      const beam = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: 0xe0a0ff }));
      beam.visible = false;
      beam.frustumCulled = false;
      this.group.add(beam);
      mob.brain = { phase: 'circle', t: 6, angle: Math.random() * Math.PI * 2, shots: 0, shotCd: 0, scan: 0, crystals: [], beam, ...model.brainParts };
      model.group.rotation.order = 'YXZ';
    }
    this.geos.set(mob.id, geos);
    this.group.add(model.group);
    this.mobs.push(mob);
    return mob;
  }

  private remove(m: Mob): void {
    this.group.remove(m.group);
    if (m.brain) {
      this.group.remove(m.brain.beam);
      m.brain.beam.geometry.dispose();
      (m.brain.beam.material as THREE.Material).dispose();
    }
    for (const g of this.geos.get(m.id) ?? []) g.dispose();
    for (const mt of m.mats) mt.dispose();
    this.geos.delete(m.id);
    this.mobs = this.mobs.filter((x) => x !== m);
  }

  clear(): void {
    for (const m of [...this.mobs]) this.remove(m);
    for (const p of this.shots) this.group.remove(p.mesh);
    this.shots = [];
  }

  dispose(): void {
    this.clear();
    this.shotGeo.dispose();
    for (const m of this.shotMats.values()) m.dispose();
  }

  /** Ray vs mob AABBs. */
  raycast(o: THREE.Vector3, d: THREE.Vector3, maxDist: number): { mob: Mob; dist: number } | null {
    let best: { mob: Mob; dist: number } | null = null;
    for (const m of this.mobs) {
      const b = m.body;
      const min = [b.x - b.hw, b.y, b.z - b.hw];
      const max = [b.x + b.hw, b.y + b.h, b.z + b.hw];
      const oo = [o.x, o.y, o.z];
      const dd = [d.x, d.y, d.z];
      let t0 = 0;
      let t1 = maxDist;
      let ok = true;
      for (let a = 0; a < 3; a++) {
        if (Math.abs(dd[a]) < 1e-9) {
          if (oo[a] < min[a] || oo[a] > max[a]) { ok = false; break; }
          continue;
        }
        let ta = (min[a] - oo[a]) / dd[a];
        let tb = (max[a] - oo[a]) / dd[a];
        if (ta > tb) [ta, tb] = [tb, ta];
        t0 = Math.max(t0, ta);
        t1 = Math.min(t1, tb);
        if (t0 > t1) { ok = false; break; }
      }
      if (ok && (!best || t0 < best.dist)) best = { mob: m, dist: t0 };
    }
    return best;
  }

  damage(m: Mob, amount: number, fromX: number, fromZ: number): void {
    if (m.health <= 0) return;
    const s = MOB_SPECS[m.kind];
    m.health -= amount;
    m.hurtTime = 0.3;
    if (m.brain) {
      // Bosses don't get knocked around; a hit on the ground makes the dragon take off soon.
      this.cb.sound('hiss', m);
      if (m.brain.phase === 'perch') m.brain.t = Math.min(m.brain.t, 1.2);
      if (m.health <= 0) {
        this.cb.onKilled(m, this.rollDrops(s));
        this.remove(m);
      }
      return;
    }
    const dx = m.body.x - fromX;
    const dz = m.body.z - fromZ;
    const l = Math.hypot(dx, dz) || 1;
    const kb = m.kind === 'voidwalker' ? 3 : 6;
    m.vx = (dx / l) * kb;
    m.vz = (dz / l) * kb;
    m.vy = s.fly ? 2 : 4.5;
    this.cb.sound(s.temper ? 'hiss' : 'grunt', m);
    if (m.health <= 0) {
      this.cb.onKilled(m, this.rollDrops(s));
      this.remove(m);
      return;
    }
    if (s.blink && Math.random() < 0.7) this.blink(m);
    if (!s.temper) {
      m.state = 'flee';
      m.timer = 4;
    } else {
      m.angry = true;
      m.state = 'chase';
    }
  }

  private rollDrops(s: MobSpec): [number, number][] {
    const drops: [number, number][] = [];
    for (const [id, lo, hi, chance] of s.drops) {
      if (chance !== undefined && Math.random() > chance) continue;
      const n = lo + Math.floor(Math.random() * (hi - lo + 1));
      if (n > 0) drops.push([id, n]);
    }
    return drops;
  }

  /** The living boss, if any. */
  get boss(): Mob | null {
    return this.mobs.find((m) => m.brain) ?? null;
  }

  /** Teleport a creature to a random standing spot nearby (Voidwalker). */
  private blink(m: Mob): void {
    for (let k = 0; k < 10; k++) {
      const x = m.body.x + (Math.random() - 0.5) * 16;
      const z = m.body.z + (Math.random() - 0.5) * 16;
      const y = this.floorNear(x, z, m.body.y, 8);
      if (y === null) continue;
      const body: Body = { ...m.body, x, y, z };
      if (collides(body, this.world.collisionAt)) continue;
      this.cb.sound('blink', m);
      m.body.x = x; m.body.y = y; m.body.z = z;
      m.vx = m.vy = m.vz = 0;
      return;
    }
  }

  /** Feet y of a standing spot in column (x,z) near y0 (solid floor, 2 free cells, no liquid), or null. */
  private floorNear(x: number, z: number, y0: number, range: number): number | null {
    const fy = Math.floor(y0);
    for (let d = 0; d <= range * 2; d++) {
      const y = fy + (d % 2 === 0 ? d / 2 : -(d + 1) / 2);
      const below = this.world.getBlock(x, y - 1, z);
      if (below === UNLOADED || !SOLID[below]) continue;
      const a = this.world.getBlock(x, y, z);
      const b = this.world.getBlock(x, y + 1, z);
      if (a === UNLOADED || b === UNLOADED || SOLID[a] || SOLID[b] || isLiquidId(a) || isLiquidId(b)) continue;
      return y;
    }
    return null;
  }

  private count(pred: (s: MobSpec) => boolean): number {
    return this.mobs.filter((m) => !m.brain && pred(MOB_SPECS[m.kind])).length;
  }

  private trySpawn(day: number, p: { x: number; y: number; z: number }, mobileScale: number): void {
    const hostile = this.count((s) => s.temper === 'always');
    const calm = this.count((s) => s.temper !== 'always');
    const maxH = Math.ceil(this.maxHostile * mobileScale);
    const maxP = Math.ceil(this.maxPassive * mobileScale);
    const a = Math.random() * Math.PI * 2;
    const r = 18 + Math.random() * 26;
    const x = Math.floor(p.x + Math.cos(a) * r) + 0.5;
    const z = Math.floor(p.z + Math.sin(a) * r) + 0.5;

    let kind: MobKind | null = null;
    let y: number | null = null;
    if (this.dim === 'overworld') {
      const night = day < 0.3;
      const wantHostile = night && hostile < maxH;
      const wantPassive = calm < maxP;
      if (!wantHostile && !wantPassive) return;
      const sy = this.world.surfaceY(x, z);
      if (sy < 0) return;
      const ground = this.world.getBlock(x, sy, z);
      if (isWaterId(ground) || ground === UNLOADED) return;
      y = sy + 1;
      if (wantHostile && (!wantPassive || Math.random() < 0.6)) kind = Math.random() < 0.55 ? 'crawler' : 'bonewalker';
      else {
        if (ground !== B.GRASS && ground !== B.SNOW_GRASS) return;
        const roll = Math.random();
        kind = roll < 0.4 ? 'grazer' : roll < 0.75 ? 'boar' : 'featherback';
      }
    } else if (this.dim === 'emberdeep') {
      const roll = Math.random();
      if (roll < 0.62) {
        if (hostile >= maxH) return;
        kind = Math.random() < 0.55 ? 'hopper' : 'wraith';
      } else {
        if (calm >= Math.ceil(maxP * 0.6)) return;
        kind = 'emberhog';
      }
      y = this.floorNear(x, z, p.y, 14);
      if (y !== null && kind === 'wraith') y += 2 + Math.floor(Math.random() * 3);
    } else {
      const roll = Math.random();
      if (roll < 0.45) {
        if (hostile >= Math.ceil(maxH * 0.7)) return;
        kind = 'shardling';
      } else {
        if (calm >= Math.ceil(maxP * 0.7)) return;
        kind = 'voidwalker';
      }
      y = this.floorNear(x, z, p.y, 16);
      if (y !== null && kind === 'shardling') y += 2 + Math.floor(Math.random() * 3);
    }
    if (!kind || y === null) return;
    const s = MOB_SPECS[kind];
    const body: Body = { x, y, z, hw: s.hw, h: s.h };
    if (collides(body, this.world.collisionAt)) return;
    // Passive overworld animals spawn in small herds.
    const herd = !s.temper && this.dim === 'overworld' ? 1 + Math.floor(Math.random() * 2) : 1;
    for (let i = 0; i < herd; i++) {
      const b2 = i === 0 ? body : { ...body, x: x + (Math.random() - 0.5) * 3, z: z + (Math.random() - 0.5) * 3 };
      if (i > 0 && collides(b2, this.world.collisionAt)) continue;
      this.spawn(kind, b2.x, b2.y, b2.z);
    }
  }

  /** Would stepping to (x,z) drop the mob down a cliff (> 3 blocks), into water or magma? */
  private unsafe(x: number, y: number, z: number, fireproof: boolean): boolean {
    for (let d = 0; d <= 3; d++) {
      const id = this.world.getBlock(x, y - 1 - d, z);
      if (id === UNLOADED) return true;
      if (isMagmaId(id)) return !fireproof || d < 1;
      if (isWaterId(id)) return d < 2;
      if (SOLID[id]) return false;
    }
    return true;
  }

  private fire(m: Mob, kind: Shot, tx: number, ty: number, tz: number, damage = MOB_SPECS[m.kind].damage, size = 1): void {
    let mat = this.shotMats.get(kind);
    if (!mat) {
      const [c, e] = SHOT_COLORS[kind];
      mat = new THREE.MeshLambertMaterial({ color: c, emissive: e });
      this.shotMats.set(kind, mat);
    }
    const mesh = new THREE.Mesh(this.shotGeo, mat);
    mesh.scale.setScalar(size);
    let sx = m.body.x, sy = m.body.y + m.body.h * 0.75, sz = m.body.z;
    if (m.brain) {
      // Breathed from the dragon's mouth.
      const head = new THREE.Vector3();
      m.body3d!.getWorldPosition(head);
      sx = head.x; sy = head.y; sz = head.z;
    }
    const dx = tx - sx, dy = ty - sy, dz = tz - sz;
    const l = Math.hypot(dx, dy, dz) || 1;
    const speed = kind === 'bone' ? 13 : 9;
    const p: Projectile = { kind, x: sx, y: sy, z: sz, vx: (dx / l) * speed, vy: (dy / l) * speed + (kind === 'bone' ? 1.5 : 0), vz: (dz / l) * speed, life: 4, damage, source: m.kind, mesh };
    mesh.position.set(sx, sy, sz);
    this.group.add(mesh);
    this.shots.push(p);
    this.cb.sound('shoot', m);
  }

  private updateShots(dt: number, p: { x: number; y: number; z: number }, playerDead: boolean): void {
    const keep: Projectile[] = [];
    for (const s of this.shots) {
      s.life -= dt;
      if (s.kind === 'bone') s.vy -= 9 * dt;
      s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
      s.mesh.position.set(s.x, s.y, s.z);
      s.mesh.rotation.x += dt * 9;
      s.mesh.rotation.y += dt * 7;
      const r = 0.45 * s.mesh.scale.x;
      const hitPlayer = !playerDead && Math.abs(s.x - p.x) < r && Math.abs(s.z - p.z) < r && s.y > p.y - r + 0.45 && s.y < p.y + 1.85 + r - 0.45;
      if (hitPlayer) this.cb.hurtPlayer(s.damage, s.x - s.vx, s.z - s.vz, s.source);
      const id = this.world.getBlock(s.x, s.y, s.z);
      if (hitPlayer || s.life <= 0 || id === UNLOADED || SOLID[id]) {
        this.group.remove(s.mesh);
        continue;
      }
      keep.push(s);
    }
    this.shots = keep;
  }

  update(dt: number, day: number, playerDead: boolean, mobileScale: number): void {
    if (!this.enabled) return;
    this.time += dt;
    const p = this.cb.playerPos();
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 1.5;
      // Cavern and island floors are sparse, so the other dimensions try a few spots per tick.
      const tries = this.dim === 'overworld' ? 1 : 4;
      const before = this.mobs.length;
      for (let i = 0; i < tries && this.mobs.length === before; i++) this.trySpawn(day, p, mobileScale);
    }
    this.updateShots(dt, p, playerDead);
    for (const m of [...this.mobs]) {
      const s = MOB_SPECS[m.kind];
      if (m.brain) {
        this.updateDragon(m, m.brain, dt, p, playerDead);
        continue;
      }
      const dx = p.x - m.body.x;
      const dz = p.z - m.body.z;
      const dy = p.y - m.body.y;
      const dist = Math.hypot(dx, dz);
      // Despawn far mobs; night creatures fade out in daylight.
      if (dist > 90) { this.remove(m); continue; }
      if (s.nocturnal && this.dim === 'overworld' && day > 0.55) {
        m.fade -= dt * 0.5;
        if (m.fade <= 0) { this.remove(m); continue; }
      }
      // Chunk under the mob unloaded → freeze it.
      if (this.world.getBlock(m.body.x, m.body.y, m.body.z) === UNLOADED) continue;

      m.timer -= dt;
      m.hurtTime = Math.max(0, m.hurtTime - dt);
      m.attackCd = Math.max(0, m.attackCd - dt);
      const aggressive = s.temper === 'always' || (s.temper === 'neutral' && m.angry);
      const sees = aggressive && !playerDead && dist < 18 && Math.abs(dy) < 12;
      let wantX = 0;
      let wantZ = 0;
      let speed = s.speed;

      switch (m.state) {
        case 'idle':
          if (m.timer <= 0) {
            m.state = 'wander';
            m.timer = 3 + Math.random() * 4;
            const a = Math.random() * Math.PI * 2;
            const r = 3 + Math.random() * 6;
            m.target = { x: m.body.x + Math.cos(a) * r, z: m.body.z + Math.sin(a) * r };
            if (s.fly) m.hoverY = m.body.y + (Math.random() - 0.5) * 3;
          }
          if (sees) { m.state = 'notice'; m.timer = 0.6; }
          break;
        case 'wander':
          if (m.target) {
            wantX = m.target.x - m.body.x;
            wantZ = m.target.z - m.body.z;
            if (Math.hypot(wantX, wantZ) < 0.5) m.target = null;
          }
          if (m.timer <= 0 || !m.target) { m.state = 'idle'; m.timer = 2 + Math.random() * 4; }
          if (sees) { m.state = 'notice'; m.timer = 0.6; }
          speed *= 0.5;
          break;
        case 'notice':
          m.yaw = Math.atan2(-dx, -dz);
          if (m.timer <= 0) {
            m.state = 'chase';
            this.cb.sound('hiss', m);
          }
          break;
        case 'chase': {
          if (playerDead || dist > 26 || !aggressive) { m.state = 'idle'; m.timer = 2; m.angry = false; break; }
          if (s.fly) m.hoverY = p.y + (s.shoot ? 2.5 : 0.6);
          // Shooters keep their distance and fire; others close in.
          if (s.shoot && dist < 15) {
            if (dist < 6) { wantX = -dx; wantZ = -dz; speed *= 0.6; }
            else if (dist > 10) { wantX = dx; wantZ = dz; }
            m.yaw = Math.atan2(-dx, -dz);
            if (m.attackCd <= 0 && dist > 2.5) {
              m.attackCd = s.shoot === 'bone' ? 1.6 : 2.2;
              this.fire(m, s.shoot, p.x, p.y + 1.2, p.z);
            }
          } else {
            wantX = dx;
            wantZ = dz;
          }
          if (dist < 1.4 + s.hw && Math.abs(dy) < 1.8) m.state = 'attack';
          break;
        }
        case 'attack':
          if (dist > 1.9 + s.hw) { m.state = 'chase'; break; }
          m.yaw = Math.atan2(-dx, -dz);
          if (m.attackCd <= 0) {
            m.attackCd = 1.1;
            this.cb.hurtPlayer(s.damage, m.body.x, m.body.z, m.kind);
            m.walk += 1.5;
          }
          break;
        case 'flee':
          wantX = -dx;
          wantZ = -dz;
          speed *= 1.9;
          if (m.timer <= 0) { m.state = 'idle'; m.timer = 2; }
          break;
      }

      this.move(m, s, wantX, wantZ, speed, dt);
      this.animate(m, s, dt);
    }
  }

  /**
   * Void Dragon: circles the island, then swoops at the player, breathes void bolts from a hover,
   * or perches on the plaza (its vulnerable moment). Intact crystals on the spires heal it.
   */
  private updateDragon(m: Mob, b: DragonBrain, dt: number, p: { x: number; y: number; z: number }, playerDead: boolean): void {
    const a = this.arena ?? { x: 0, y: 60, z: 0, crystals: [] };
    b.t -= dt;
    m.hurtTime = Math.max(0, m.hurtTime - dt);
    m.attackCd = Math.max(0, m.attackCd - dt);
    const dx = p.x - m.body.x, dy = p.y + 1 - m.body.y, dz = p.z - m.body.z;
    const dist = Math.hypot(dx, dy, dz);
    let tx = m.body.x, ty = m.body.y, tz = m.body.z;
    let speed = 11;
    let facePlayer = false;
    let perched = false;
    switch (b.phase) {
      case 'circle':
        b.angle += dt * 0.3;
        tx = a.x + Math.cos(b.angle) * 40;
        tz = a.z + Math.sin(b.angle) * 40;
        ty = a.y + 22 + Math.sin(b.angle * 2) * 5;
        if (b.t <= 0) {
          if (playerDead || dist > 140) b.t = 3;
          else {
            b.phase = nextPhase(Math.random());
            b.t = b.phase === 'swoop' ? 6 : b.phase === 'breath' ? 6 : 14;
            b.shots = 3;
            b.shotCd = 1.2;
            this.cb.sound('hiss', m);
          }
        }
        break;
      case 'swoop':
        tx = p.x; ty = p.y + 1.2; tz = p.z;
        speed = 17;
        if (dist < 3.6 && m.attackCd <= 0 && !playerDead) {
          m.attackCd = 2;
          this.cb.hurtPlayer(meleeDamage(m), m.body.x, m.body.z, 'dragon');
          b.phase = 'circle';
          b.t = 7;
        }
        if (b.t <= 0) { b.phase = 'circle'; b.t = 6; }
        break;
      case 'breath': {
        const away = Math.hypot(m.body.x - p.x, m.body.z - p.z) || 1;
        tx = p.x + ((m.body.x - p.x) / away) * 18;
        tz = p.z + ((m.body.z - p.z) / away) * 18;
        ty = p.y + 10;
        speed = 9;
        facePlayer = true;
        b.shotCd -= dt;
        if (b.shotCd <= 0 && b.shots > 0 && !playerDead) {
          b.shotCd = 0.75;
          b.shots--;
          this.fire(m, 'void', p.x, p.y + 1, p.z, 4, 2.2);
        }
        if (b.shots <= 0 && b.shotCd <= 0) { b.phase = 'circle'; b.t = 6; }
        break;
      }
      case 'perch': {
        tx = a.x + 0.5; tz = a.z - 2.5; ty = a.y + 1;
        speed = 9;
        if (Math.hypot(tx - m.body.x, ty - m.body.y, tz - m.body.z) < 1.2) {
          perched = true;
          facePlayer = true;
          m.body.x = tx; m.body.y = ty; m.body.z = tz;
          m.vx = m.vy = m.vz = 0;
          if (dist < 5 && m.attackCd <= 0 && !playerDead) {
            m.attackCd = 1.6;
            this.cb.hurtPlayer(5, m.body.x, m.body.z, 'dragon');
          }
        }
        if (b.t <= 0) { b.phase = 'circle'; b.t = 7; }
        break;
      }
    }
    if (!perched) {
      const ex = tx - m.body.x, ey = ty - m.body.y, ez = tz - m.body.z;
      const el = Math.hypot(ex, ey, ez);
      const k = Math.min(1, 1.8 * dt);
      const wx = el > 0.3 ? (ex / el) * speed : 0, wy = el > 0.3 ? (ey / el) * speed : 0, wz = el > 0.3 ? (ez / el) * speed : 0;
      m.vx += (wx - m.vx) * k; m.vy += (wy - m.vy) * k; m.vz += (wz - m.vz) * k;
      // Flies freely: it's far too big to path through spires and towers.
      m.body.x += m.vx * dt; m.body.y += m.vy * dt; m.body.z += m.vz * dt;
      m.body.y = Math.max(m.body.y, 4);
    }
    if (facePlayer) m.yaw = Math.atan2(-dx, -dz);
    else if (Math.hypot(m.vx, m.vz) > 0.5) m.yaw = Math.atan2(-m.vx, -m.vz);

    // Crystals heal it, shown as a beam from the nearest intact one.
    b.scan -= dt;
    if (b.scan <= 0) {
      b.scan = 1;
      b.crystals = a.crystals.filter((c) => this.world.getBlock(c.x, c.y, c.z) === B.VOID_CRYSTAL);
    }
    let near: { x: number; y: number; z: number } | null = null;
    let nd = Infinity;
    for (const c of b.crystals) {
      const d = Math.hypot(c.x - m.body.x, c.y - m.body.y, c.z - m.body.z);
      if (d < nd) { nd = d; near = c; }
    }
    const maxHp = MOB_SPECS.dragon.health;
    b.beam.visible = !!near && nd < 64 && m.health < maxHp;
    if (b.beam.visible && near) {
      m.health = Math.min(maxHp, m.health + 2 * dt);
      const pos = b.beam.geometry.getAttribute('position') as THREE.BufferAttribute;
      pos.setXYZ(0, near.x + 0.5, near.y + 0.5, near.z + 0.5);
      pos.setXYZ(1, m.body.x, m.body.y + 1.3, m.body.z);
      pos.needsUpdate = true;
    }

    animateDragon(this.time, b, m.wings, perched, b.phase === 'breath' || b.phase === 'swoop');
    m.group.position.set(m.body.x, m.body.y, m.body.z);
    m.group.rotation.set(perched ? 0 : Math.max(-0.5, Math.min(0.5, m.vy * 0.04)), m.yaw, 0);
    this.tint(m);
  }

  private move(m: Mob, s: MobSpec, wantX: number, wantZ: number, speed: number, dt: number): void {
    const wl = Math.hypot(wantX, wantZ);
    let tx = 0;
    let tz = 0;
    if (wl > 0.01) {
      tx = (wantX / wl) * speed;
      tz = (wantZ / wl) * speed;
      // Walkers don't step off cliffs / into liquids while wandering.
      if (!s.fly && m.state !== 'chase' && this.unsafe(m.body.x + (tx / speed) * 0.8, m.body.y, m.body.z + (tz / speed) * 0.8, !!s.fireproof)) {
        tx = tz = 0;
        m.target = null;
      } else m.yaw = Math.atan2(-tx, -tz);
    }
    if (s.hop) {
      // Only steer while airborne; on the ground, wait, then leap.
      if (m.onGround) {
        m.vx *= Math.pow(0.001, dt);
        m.vz *= Math.pow(0.001, dt);
        if (wl > 0.01 && m.timer <= 0.2 && m.hurtTime <= 0) {
          m.vy = m.state === 'chase' ? 8.5 : 6.5;
          m.vx = tx * 1.25;
          m.vz = tz * 1.25;
          m.timer = m.state === 'chase' ? 0.9 : 1.6;
          m.walk = 0;
        }
      }
    } else {
      const k = Math.min(1, (m.onGround || s.fly ? 10 : 2) * dt);
      if (m.hurtTime <= 0.15) {
        m.vx += (tx - m.vx) * k;
        m.vz += (tz - m.vz) * k;
      }
    }
    const feet = this.world.getBlock(m.body.x, m.body.y + 0.3, m.body.z);
    const inLiquid = isLiquidId(feet);
    if (s.fly) {
      const bob = Math.sin(this.time * 2 + m.id) * 0.4;
      const ty = (m.hoverY - m.body.y + bob) * 2;
      m.vy += (Math.max(-3, Math.min(3, ty)) - m.vy) * Math.min(1, 4 * dt);
    } else {
      m.vy -= (inLiquid ? 6 : 28) * dt;
      if (inLiquid) m.vy = Math.max(m.vy, -2) + 10 * dt;
    }
    // Magma burns creatures that aren't fireproof.
    if (isMagmaId(feet) && !s.fireproof && m.hurtTime <= 0) {
      m.health -= 2;
      m.hurtTime = 0.5;
      if (m.health <= 0) {
        this.cb.onKilled(m, []);
        this.remove(m);
        return;
      }
    }
    const res = moveBody(m.body, m.vx * dt, m.vy * dt, m.vz * dt, this.world.collisionAt);
    if (res.hitY) m.vy = 0;
    m.onGround = res.onGround;
    if ((res.hitX || res.hitZ) && wl > 0.01) {
      if (s.fly) m.hoverY += 1.5;
      else if (m.onGround && !s.hop) {
        const up: Body = { ...m.body, y: m.body.y + 1.05 };
        if (!collides(up, this.world.collisionAt)) m.vy = 7.6;
        else if (m.state === 'wander') m.target = null;
      }
    }
  }

  private animate(m: Mob, s: MobSpec, dt: number): void {
    const hs = Math.hypot(m.vx, m.vz);
    if (!s.hop) m.walk += hs * dt * 4;
    const swing = Math.sin(m.walk) * Math.min(0.7, hs * 0.3);
    m.legs.forEach((l, i) => (l.rotation.x = s.fly ? Math.sin(this.time * 3 + i) * 0.35 : i % 2 === 0 ? swing : -swing));
    const attacking = m.state === 'attack' || (m.state === 'chase' && s.shoot);
    m.arms.forEach((a, i) => {
      a.rotation.x = attacking ? -1.3 + Math.sin(this.time * 9) * 0.25 : (i % 2 === 0 ? -swing : swing) * 0.8;
    });
    if (m.kind === 'featherback') m.wings.forEach((w, i) => (w.rotation.z = (i === 0 ? 1 : -1) * (m.onGround ? 0.05 : 0.7 + Math.sin(this.time * 30) * 0.5)));
    if (m.kind === 'shardling') m.wings.forEach((w, i) => (w.rotation.y = this.time * 2.5 + (i / 3) * Math.PI * 2));
    if (m.body3d) {
      if (s.hop) {
        // Squash on landing, stretch in the air.
        const k = m.onGround ? 1 - Math.max(0, 0.18 - (1.6 - m.timer) * 0.6) : 1 + Math.min(0.18, Math.abs(m.vy) * 0.03);
        m.body3d.scale.set(2 - k, k, 2 - k);
      } else if (s.fly) {
        m.body3d.rotation.z = Math.sin(this.time * 1.7 + m.id) * 0.08;
      }
    }
    m.group.position.set(m.body.x, m.body.y, m.body.z);
    m.group.rotation.y = m.yaw;
    this.tint(m);
  }

  /** Red flash while hurt, and fading (night creatures at dawn). */
  private tint(m: Mob): void {
    const flash = m.hurtTime > 0;
    for (const mt of m.mats) {
      if (flash) mt.emissive.setRGB(0.6, 0.05, 0.05);
      else mt.emissive.setHex(mt.userData.baseEmissive as number);
      if (m.fade < 1 && !mt.transparent) {
        mt.transparent = true;
        mt.needsUpdate = true;
      }
      mt.opacity = m.fade;
    }
  }
}
