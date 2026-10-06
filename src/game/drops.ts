import * as THREE from 'three';
import { moveBody, type Body, type SolidFn } from '../player/physics';
import { RENDER } from '../world/blocks';
import { BLOCK_TILES, tileRect } from '../world/tiles';
import { iconFor } from '../ui/icons';

export interface DropEntity {
  id: number;
  count: number;
  dur?: number;
  body: Body;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  /** Seconds before it can be picked up (longer for items the player threw). */
  delay: number;
  mesh: THREE.Mesh;
}

const MAX_DROPS = 160;
const DESPAWN = 300;
const PICKUP_R = 2.0;

/** Dropped item stacks lying in the world. */
export class DropManager {
  readonly group = new THREE.Group();
  drops: DropEntity[] = [];
  private geos = new Map<number, THREE.BufferGeometry>();
  private mats = new Map<number, THREE.MeshBasicMaterial>();
  private blockMat: THREE.MeshBasicMaterial;
  private brightness = 1;

  constructor(atlas: THREE.Texture) {
    this.blockMat = new THREE.MeshBasicMaterial({ map: atlas, vertexColors: true, alphaTest: 0.5 });
  }

  private geometryFor(id: number): { geo: THREE.BufferGeometry; mat: THREE.MeshBasicMaterial } {
    let geo = this.geos.get(id);
    const cube = id < 256 && RENDER[id] !== 3 && RENDER[id] !== 0 && RENDER[id] !== 6;
    if (!geo) {
      if (cube) {
        geo = new THREE.BoxGeometry(0.26, 0.26, 0.26);
        const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
        const slots = [2, 2, 0, 1, 2, 2];
        const shade = [0.8, 0.8, 1, 0.5, 0.65, 0.65];
        const colors = new Float32Array(24 * 3);
        for (let f = 0; f < 6; f++) {
          const [u0, v0, u1, v1] = tileRect(BLOCK_TILES[id * 3 + slots[f]]);
          const o = f * 4;
          uv.setXY(o, u0, v1); uv.setXY(o + 1, u1, v1); uv.setXY(o + 2, u0, v0); uv.setXY(o + 3, u1, v0);
          for (let k = 0; k < 4; k++) colors.set([shade[f], shade[f], shade[f]], (o + k) * 3);
        }
        geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      } else {
        geo = new THREE.PlaneGeometry(0.4, 0.4);
      }
      this.geos.set(id, geo);
    }
    if (cube) return { geo, mat: this.blockMat };
    let mat = this.mats.get(id);
    if (!mat) {
      const img = new Image();
      const tex = new THREE.Texture(img);
      img.onload = () => (tex.needsUpdate = true);
      img.src = iconFor(id);
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestFilter;
      tex.generateMipmaps = false;
      tex.colorSpace = THREE.SRGBColorSpace;
      mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide });
      this.mats.set(id, mat);
    }
    return { geo, mat };
  }

  spawn(id: number, count: number, x: number, y: number, z: number, opts: { vx?: number; vy?: number; vz?: number; delay?: number; dur?: number } = {}): void {
    if (count <= 0) return;
    // Merge into an identical nearby stack to keep entity counts low.
    for (const d of this.drops) {
      if (d.id === id && d.dur === undefined && opts.dur === undefined && Math.hypot(d.body.x - x, d.body.y - y, d.body.z - z) < 1 && d.count + count <= 64) {
        d.count += count;
        return;
      }
    }
    if (this.drops.length >= MAX_DROPS) this.remove(this.drops[0]);
    const { geo, mat } = this.geometryFor(id);
    const mesh = new THREE.Mesh(geo, mat);
    this.group.add(mesh);
    this.drops.push({
      id, count, dur: opts.dur,
      body: { x, y, z, hw: 0.12, h: 0.24 },
      vx: opts.vx ?? (Math.random() - 0.5) * 2,
      vy: opts.vy ?? 3 + Math.random() * 1.5,
      vz: opts.vz ?? (Math.random() - 0.5) * 2,
      age: 0,
      delay: opts.delay ?? 0.35,
      mesh,
    });
  }

  private remove(d: DropEntity): void {
    this.group.remove(d.mesh);
    this.drops = this.drops.filter((x) => x !== d);
  }

  /**
   * Physics + pickup. `tryGive` returns how many items did NOT fit.
   * Returns true if something was picked up this frame.
   */
  update(dt: number, solid: SolidFn, player: { x: number; y: number; z: number } | null, tryGive: (id: number, n: number, dur?: number) => number, brightness: number): boolean {
    let picked = false;
    if (Math.abs(brightness - this.brightness) > 0.01) {
      this.brightness = brightness;
      const c = 0.35 + brightness * 0.65;
      this.blockMat.color.setRGB(c, c, c);
      for (const m of this.mats.values()) m.color.setRGB(c, c, c);
    }
    for (const d of [...this.drops]) {
      d.age += dt;
      if (d.age > DESPAWN) {
        this.remove(d);
        continue;
      }
      let magnet = false;
      if (player && d.age > d.delay) {
        // Distance to the nearest point of the player's body (feet to head), not a single point.
        const dx = player.x - d.body.x;
        const dy = Math.min(player.y + 1.6, Math.max(player.y + 0.2, d.body.y)) - d.body.y;
        const dz = player.z - d.body.z;
        const dist = Math.hypot(dx, dy, dz);
        if (dist < 0.75) {
          const left = tryGive(d.id, d.count, d.dur);
          if (left < d.count) picked = true;
          if (left <= 0) {
            this.remove(d);
            continue;
          }
          d.count = left;
        } else if (dist < PICKUP_R) {
          magnet = true;
          const k = 9 / Math.max(0.3, dist);
          d.vx = dx * k * 0.6;
          d.vy = dy * k * 0.6;
          d.vz = dz * k * 0.6;
        }
      }
      if (!magnet) {
        d.vy -= 18 * dt;
        const f = Math.pow(0.08, dt);
        d.vx *= f;
        d.vz *= f;
      }
      const res = moveBody(d.body, d.vx * dt, d.vy * dt, d.vz * dt, magnet ? () => false : solid);
      if (res.hitY) {
        d.vy = 0;
        d.vx *= 0.5;
        d.vz *= 0.5;
      }
      const bob = Math.sin(d.age * 2.6) * 0.05 + 0.18;
      d.mesh.position.set(d.body.x, d.body.y + bob, d.body.z);
      d.mesh.rotation.y = d.age * 1.6;
    }
    return picked;
  }

  clear(): void {
    for (const d of [...this.drops]) this.remove(d);
  }

  dispose(): void {
    this.clear();
    for (const g of this.geos.values()) g.dispose();
    for (const m of this.mats.values()) {
      m.map?.dispose();
      m.dispose();
    }
    this.blockMat.dispose();
  }
}
