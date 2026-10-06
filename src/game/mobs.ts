import * as THREE from 'three';
import { B, I, isWaterId } from '../core/ids';
import { collides, moveBody, type Body } from '../player/physics';
import { SOLID } from '../world/blocks';
import { UNLOADED, type World } from '../world/world';

export type MobKind = 'grazer' | 'boar' | 'crawler';
type State = 'idle' | 'wander' | 'notice' | 'chase' | 'attack' | 'flee';

interface MobSpec {
  hw: number;
  h: number;
  health: number;
  speed: number;
  hostile: boolean;
  drops: [number, number, number][]; // id, min, max
}

const SPECS: Record<MobKind, MobSpec> = {
  grazer: { hw: 0.42, h: 1.25, health: 8, speed: 1.6, hostile: false, drops: [[I.RAW_MEAT, 1, 2]] },
  boar: { hw: 0.4, h: 0.95, health: 10, speed: 2.0, hostile: false, drops: [[I.RAW_MEAT, 1, 3]] },
  crawler: { hw: 0.45, h: 0.8, health: 14, speed: 3.6, hostile: true, drops: [[I.EMBER, 0, 2]] },
};

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
  group: THREE.Group;
  legs: THREE.Object3D[];
  mats: THREE.MeshLambertMaterial[];
  fade: number;
}

export interface MobCallbacks {
  hurtPlayer(amount: number, fromX: number, fromZ: number): void;
  playerPos(): { x: number; y: number; z: number };
  onKilled(mob: Mob, drops: [number, number][]): void;
  sound(kind: 'grunt' | 'hiss', mob: Mob): void;
}

function box(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, geos: THREE.BufferGeometry[]): THREE.Mesh {
  const g = new THREE.BoxGeometry(w, h, d);
  geos.push(g);
  const m = new THREE.Mesh(g, mat);
  m.position.set(x, y, z);
  return m;
}

/** Build a blocky creature model. Models face -Z. */
function buildModel(kind: MobKind, geos: THREE.BufferGeometry[]): { group: THREE.Group; legs: THREE.Object3D[]; mats: THREE.MeshLambertMaterial[] } {
  const group = new THREE.Group();
  const legs: THREE.Object3D[] = [];
  const mats: THREE.MeshLambertMaterial[] = [];
  const mat = (c: number, emissive = 0) => {
    const m = new THREE.MeshLambertMaterial({ color: c, emissive });
    m.userData.baseEmissive = emissive;
    mats.push(m);
    return m;
  };
  const leg = (x: number, z: number, h: number, w: number, m: THREE.Material) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, h, z);
    pivot.add(box(w, h, w, m, 0, -h / 2, 0, geos));
    group.add(pivot);
    legs.push(pivot);
  };
  if (kind === 'grazer') {
    const wool = mat(0xe8e2d0);
    const moss = mat(0x6f9a4f);
    const skin = mat(0x8a6b55);
    const dark = mat(0x2a2220);
    group.add(box(0.8, 0.55, 1.15, wool, 0, 0.82, 0, geos));
    group.add(box(0.6, 0.12, 0.9, moss, 0, 1.15, 0.05, geos));
    group.add(box(0.42, 0.42, 0.42, skin, 0, 1.0, -0.72, geos));
    group.add(box(0.08, 0.08, 0.02, dark, -0.12, 1.06, -0.94, geos));
    group.add(box(0.08, 0.08, 0.02, dark, 0.12, 1.06, -0.94, geos));
    group.add(box(0.1, 0.18, 0.1, wool, -0.2, 1.28, -0.66, geos));
    group.add(box(0.1, 0.18, 0.1, wool, 0.2, 1.28, -0.66, geos));
    for (const [x, z] of [[-0.25, -0.38], [0.25, -0.38], [-0.25, 0.38], [0.25, 0.38]]) leg(x, z, 0.55, 0.18, skin);
  } else if (kind === 'boar') {
    const hide = mat(0x8a5c3c);
    const bristle = mat(0x5e3c26);
    const snout = mat(0xc98d74);
    const tusk = mat(0xf2ecd8);
    group.add(box(0.72, 0.5, 1.0, hide, 0, 0.6, 0, geos));
    group.add(box(0.2, 0.12, 0.85, bristle, 0, 0.9, 0.02, geos));
    group.add(box(0.5, 0.42, 0.42, hide, 0, 0.62, -0.66, geos));
    group.add(box(0.28, 0.2, 0.14, snout, 0, 0.56, -0.93, geos));
    group.add(box(0.05, 0.14, 0.05, tusk, -0.17, 0.55, -0.9, geos));
    group.add(box(0.05, 0.14, 0.05, tusk, 0.17, 0.55, -0.9, geos));
    for (const [x, z] of [[-0.22, -0.32], [0.22, -0.32], [-0.22, 0.32], [0.22, 0.32]]) leg(x, z, 0.38, 0.16, bristle);
  } else {
    const shell = mat(0x2a2038);
    const plate = mat(0x40305a);
    const eye = mat(0xd84aff, 0xc030ff);
    group.add(box(0.9, 0.36, 1.0, shell, 0, 0.5, 0, geos));
    group.add(box(0.7, 0.14, 0.8, plate, 0, 0.74, 0.05, geos));
    group.add(box(0.6, 0.3, 0.32, shell, 0, 0.48, -0.62, geos));
    group.add(box(0.12, 0.08, 0.04, eye, -0.16, 0.54, -0.79, geos));
    group.add(box(0.12, 0.08, 0.04, eye, 0.16, 0.54, -0.79, geos));
    for (let i = 0; i < 3; i++) {
      leg(-0.5, -0.3 + i * 0.3, 0.42, 0.1, plate);
      leg(0.5, -0.3 + i * 0.3, 0.42, 0.1, plate);
    }
  }
  return { group, legs, mats };
}

export class MobManager {
  readonly group = new THREE.Group();
  mobs: Mob[] = [];
  private nextId = 1;
  private spawnTimer = 0;
  private geos = new Map<number, THREE.BufferGeometry[]>();
  maxPassive = 8;
  maxHostile = 6;
  enabled = true;
  private hemi: THREE.HemisphereLight;
  private sun: THREE.DirectionalLight;

  constructor(private world: World, private cb: MobCallbacks) {
    this.hemi = new THREE.HemisphereLight(0xdfe8ff, 0x4a4030, 0.9);
    this.sun = new THREE.DirectionalLight(0xffffff, 1.2);
    this.sun.position.set(0.4, 1, 0.3);
    this.group.add(this.hemi, this.sun);
  }

  setLight(brightness: number, sunDir: THREE.Vector3): void {
    this.hemi.intensity = 0.6 + brightness * 1.8;
    this.sun.intensity = 0.3 + brightness * 2.2;
    this.sun.position.copy(sunDir);
  }

  spawn(kind: MobKind, x: number, y: number, z: number): Mob {
    const s = SPECS[kind];
    const geos: THREE.BufferGeometry[] = [];
    const { group, legs, mats } = buildModel(kind, geos);
    const mob: Mob = {
      id: this.nextId++, kind, body: { x, y, z, hw: s.hw, h: s.h }, vx: 0, vy: 0, vz: 0, yaw: Math.random() * Math.PI * 2,
      health: s.health, state: 'idle', timer: 1 + Math.random() * 3, target: null, onGround: false, hurtTime: 0,
      attackCd: 0, walk: 0, group, legs, mats, fade: 1,
    };
    this.geos.set(mob.id, geos);
    this.group.add(group);
    this.mobs.push(mob);
    return mob;
  }

  private remove(m: Mob): void {
    this.group.remove(m.group);
    for (const g of this.geos.get(m.id) ?? []) g.dispose();
    for (const mt of m.mats) mt.dispose();
    this.geos.delete(m.id);
    this.mobs = this.mobs.filter((x) => x !== m);
  }

  clear(): void {
    for (const m of [...this.mobs]) this.remove(m);
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
    m.health -= amount;
    m.hurtTime = 0.3;
    const dx = m.body.x - fromX;
    const dz = m.body.z - fromZ;
    const l = Math.hypot(dx, dz) || 1;
    m.vx = (dx / l) * 6;
    m.vz = (dz / l) * 6;
    m.vy = 4.5;
    this.cb.sound(SPECS[m.kind].hostile ? 'hiss' : 'grunt', m);
    if (m.health <= 0) {
      const drops: [number, number][] = [];
      for (const [id, lo, hi] of SPECS[m.kind].drops) {
        const n = lo + Math.floor(Math.random() * (hi - lo + 1));
        if (n > 0) drops.push([id, n]);
      }
      this.cb.onKilled(m, drops);
      this.remove(m);
      return;
    }
    if (!SPECS[m.kind].hostile) {
      m.state = 'flee';
      m.timer = 4;
    } else {
      m.state = 'chase';
    }
  }

  private trySpawn(day: number, px: number, pz: number, mobileScale: number): void {
    const passive = this.mobs.filter((m) => !SPECS[m.kind].hostile).length;
    const hostile = this.mobs.length - passive;
    const night = day < 0.3;
    const wantHostile = night && hostile < Math.ceil(this.maxHostile * mobileScale);
    const wantPassive = passive < Math.ceil(this.maxPassive * mobileScale);
    if (!wantHostile && !wantPassive) return;
    const a = Math.random() * Math.PI * 2;
    const r = 22 + Math.random() * 26;
    const x = Math.floor(px + Math.cos(a) * r) + 0.5;
    const z = Math.floor(pz + Math.sin(a) * r) + 0.5;
    const sy = this.world.surfaceY(x, z);
    if (sy < 0) return;
    const ground = this.world.getBlock(x, sy, z);
    if (isWaterId(ground) || ground === UNLOADED) return;
    const kindHostile = wantHostile && (!wantPassive || Math.random() < 0.6);
    let kind: MobKind;
    if (kindHostile) kind = 'crawler';
    else {
      if (ground !== B.GRASS && ground !== B.SNOW_GRASS) return;
      kind = Math.random() < 0.55 ? 'grazer' : 'boar';
    }
    const s = SPECS[kind];
    const body: Body = { x, y: sy + 1, z, hw: s.hw, h: s.h };
    if (collides(body, this.world.collisionAt)) return;
    // Spawn passive mobs in small herds.
    const n = kindHostile ? 1 : 1 + Math.floor(Math.random() * 2);
    for (let i = 0; i < n; i++) {
      const ox = i === 0 ? 0 : (Math.random() - 0.5) * 3;
      const oz = i === 0 ? 0 : (Math.random() - 0.5) * 3;
      const b2 = { ...body, x: x + ox, z: z + oz };
      if (i > 0 && collides(b2, this.world.collisionAt)) continue;
      this.spawn(kind, b2.x, b2.y, b2.z);
    }
  }

  /** Would stepping to (x,z) drop the mob down a cliff (> 3 blocks) or into water? */
  private unsafe(x: number, y: number, z: number): boolean {
    for (let d = 0; d <= 3; d++) {
      const id = this.world.getBlock(x, y - 1 - d, z);
      if (id === UNLOADED) return true;
      if (isWaterId(id)) return d < 2;
      if (SOLID[id]) return false;
    }
    return true;
  }

  update(dt: number, day: number, playerDead: boolean, mobileScale: number): void {
    if (!this.enabled) return;
    const p = this.cb.playerPos();
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 1.5;
      this.trySpawn(day, p.x, p.z, mobileScale);
    }
    for (const m of [...this.mobs]) {
      const s = SPECS[m.kind];
      const dx = p.x - m.body.x;
      const dz = p.z - m.body.z;
      const dist = Math.hypot(dx, dz);
      // Despawn far mobs; hostile ones fade out in daylight.
      if (dist > 90) { this.remove(m); continue; }
      if (s.hostile && day > 0.55) {
        m.fade -= dt * 0.5;
        if (m.fade <= 0) { this.remove(m); continue; }
      }
      // Chunk under the mob unloaded → freeze it.
      if (this.world.getBlock(m.body.x, m.body.y, m.body.z) === UNLOADED) continue;

      m.timer -= dt;
      m.hurtTime = Math.max(0, m.hurtTime - dt);
      m.attackCd = Math.max(0, m.attackCd - dt);
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
          }
          if (s.hostile && !playerDead && dist < 16) { m.state = 'notice'; m.timer = 0.6; }
          break;
        case 'wander':
          if (m.target) {
            wantX = m.target.x - m.body.x;
            wantZ = m.target.z - m.body.z;
            if (Math.hypot(wantX, wantZ) < 0.5) m.target = null;
          }
          if (m.timer <= 0 || !m.target) { m.state = 'idle'; m.timer = 2 + Math.random() * 4; }
          if (s.hostile && !playerDead && dist < 16) { m.state = 'notice'; m.timer = 0.6; }
          speed *= 0.5;
          break;
        case 'notice':
          m.yaw = Math.atan2(-dx, -dz);
          if (m.timer <= 0) {
            m.state = 'chase';
            this.cb.sound('hiss', m);
          }
          break;
        case 'chase':
          if (playerDead || dist > 24) { m.state = 'idle'; m.timer = 2; break; }
          wantX = dx;
          wantZ = dz;
          if (dist < 1.4 && Math.abs(p.y - m.body.y) < 1.8) m.state = 'attack';
          break;
        case 'attack':
          if (dist > 1.8) { m.state = 'chase'; break; }
          m.yaw = Math.atan2(-dx, -dz);
          if (m.attackCd <= 0) {
            m.attackCd = 1.1;
            this.cb.hurtPlayer(3, m.body.x, m.body.z);
          }
          break;
        case 'flee':
          wantX = -dx;
          wantZ = -dz;
          speed *= 1.9;
          if (m.timer <= 0) { m.state = 'idle'; m.timer = 2; }
          break;
      }

      const wl = Math.hypot(wantX, wantZ);
      let tx = 0;
      let tz = 0;
      if (wl > 0.01) {
        tx = (wantX / wl) * speed;
        tz = (wantZ / wl) * speed;
        // Don't walk off cliffs / into deep water when wandering.
        if (m.state !== 'chase' && this.unsafe(m.body.x + (tx / speed) * 0.8, m.body.y, m.body.z + (tz / speed) * 0.8)) {
          tx = tz = 0;
          m.target = null;
        } else m.yaw = Math.atan2(-tx, -tz);
      }
      const k = Math.min(1, (m.onGround ? 10 : 2) * dt);
      if (m.hurtTime <= 0.15) {
        m.vx += (tx - m.vx) * k;
        m.vz += (tz - m.vz) * k;
      }
      const inWater = isWaterId(this.world.getBlock(m.body.x, m.body.y + 0.3, m.body.z));
      m.vy -= (inWater ? 6 : 28) * dt;
      if (inWater) m.vy = Math.max(m.vy, -2) + 10 * dt;
      const res = moveBody(m.body, m.vx * dt, m.vy * dt, m.vz * dt, this.world.collisionAt);
      if (res.hitY) m.vy = 0;
      m.onGround = res.onGround;
      if ((res.hitX || res.hitZ) && m.onGround && wl > 0.01) {
        const up: Body = { ...m.body, y: m.body.y + 1.05 };
        if (!collides(up, this.world.collisionAt)) m.vy = 7.6;
        else if (m.state === 'wander') m.target = null;
      }

      // Animate.
      const hs = Math.hypot(m.vx, m.vz);
      m.walk += hs * dt * 4;
      const swing = Math.sin(m.walk) * Math.min(0.7, hs * 0.3);
      m.legs.forEach((l, i) => (l.rotation.x = i % 2 === 0 ? swing : -swing));
      m.group.position.set(m.body.x, m.body.y, m.body.z);
      m.group.rotation.y = m.yaw;
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
}
