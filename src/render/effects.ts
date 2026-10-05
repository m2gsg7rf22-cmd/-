import * as THREE from 'three';
import { BLOCK_TILES, CELL_PX, ATLAS_COLS, TILE_PAD, TILE_PX, tileIndex, tileRect } from '../world/tiles';

/** Selection outline + crack overlay for the targeted block. */
export class BlockHighlight {
  readonly group = new THREE.Group();
  private outline: THREE.LineSegments;
  private crack: THREE.Mesh;
  private crackUv: THREE.BufferAttribute;
  private stage = -1;

  constructor(atlas: THREE.Texture) {
    const eg = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004));
    this.outline = new THREE.LineSegments(eg, new THREE.LineBasicMaterial({ color: 0x101014, transparent: true, opacity: 0.55 }));
    this.outline.renderOrder = 3;
    const bg = new THREE.BoxGeometry(1.006, 1.006, 1.006);
    this.crackUv = bg.getAttribute('uv') as THREE.BufferAttribute;
    this.crack = new THREE.Mesh(
      bg,
      new THREE.MeshBasicMaterial({ map: atlas, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    );
    this.crack.renderOrder = 3;
    this.crack.visible = false;
    this.group.add(this.outline, this.crack);
    this.group.visible = false;
  }

  show(x: number, y: number, z: number): void {
    this.group.visible = true;
    this.group.position.set(x + 0.5, y + 0.5, z + 0.5);
  }

  dispose(): void {
    this.outline.geometry.dispose();
    (this.outline.material as THREE.Material).dispose();
    this.crack.geometry.dispose();
    (this.crack.material as THREE.Material).dispose();
  }

  hide(): void {
    this.group.visible = false;
    this.setProgress(0);
  }

  /** progress 0..1 → crack stage. */
  setProgress(p: number): void {
    const stage = p <= 0 ? -1 : Math.min(9, Math.floor(p * 10));
    if (stage === this.stage) return;
    this.stage = stage;
    this.crack.visible = stage >= 0;
    if (stage < 0) return;
    const [u0, v0, u1, v1] = tileRect(tileIndex('break_' + stage));
    const arr = this.crackUv.array as Float32Array;
    // BoxGeometry uv layout per face: (0,1),(1,1),(0,0),(1,0)
    for (let f = 0; f < 6; f++) {
      const o = f * 8;
      arr[o] = u0; arr[o + 1] = v1;
      arr[o + 2] = u1; arr[o + 3] = v1;
      arr[o + 4] = u0; arr[o + 5] = v0;
      arr[o + 6] = u1; arr[o + 7] = v0;
    }
    this.crackUv.needsUpdate = true;
  }
}

interface Particle {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number; max: number; size: number;
}

/** Pooled instanced cube particles (block debris, splashes, damage puffs). */
export class Particles {
  readonly mesh: THREE.InstancedMesh;
  private parts: Particle[] = [];
  private colors: THREE.Color[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private p = new THREE.Vector3();
  private tileColors = new Map<number, THREE.Color[]>();
  limit: number;

  readonly capacity: number;

  constructor(capacity: number, private atlasCanvas: HTMLCanvasElement) {
    this.capacity = capacity;
    this.limit = capacity;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.mesh = new THREE.InstancedMesh(geo, mat, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    for (let i = 0; i < capacity; i++) this.mesh.setColorAt(i, new THREE.Color(1, 1, 1));
  }

  /** Sample a few representative colors from a tile in the atlas. */
  private colorsForTile(tile: number): THREE.Color[] {
    let c = this.tileColors.get(tile);
    if (c) return c;
    const ctx = this.atlasCanvas.getContext('2d')!;
    const ox = (tile % ATLAS_COLS) * CELL_PX + TILE_PAD;
    const oy = Math.floor(tile / ATLAS_COLS) * CELL_PX + TILE_PAD;
    const d = ctx.getImageData(ox, oy, TILE_PX, TILE_PX).data;
    c = [];
    for (let k = 0; k < 24 && c.length < 6; k++) {
      const i = ((k * 37) % (TILE_PX * TILE_PX)) * 4;
      if (d[i + 3] < 128) continue;
      c.push(new THREE.Color().setRGB(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255, THREE.SRGBColorSpace));
    }
    if (c.length === 0) c.push(new THREE.Color(0.6, 0.6, 0.6));
    this.tileColors.set(tile, c);
    return c;
  }

  private spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, color: THREE.Color): void {
    if (this.parts.length >= this.limit) {
      this.parts.shift();
      this.colors.shift();
    }
    this.parts.push({ x, y, z, vx, vy, vz, life, max: life, size });
    this.colors.push(color);
  }

  blockBreak(x: number, y: number, z: number, blockId: number, amount = 14): void {
    if (this.limit === 0) return;
    const cols = this.colorsForTile(BLOCK_TILES[blockId * 3 + 2]);
    const n = Math.min(amount, Math.ceil(this.limit / 8));
    for (let i = 0; i < n; i++) {
      this.spawn(
        x + 0.2 + Math.random() * 0.6, y + 0.2 + Math.random() * 0.6, z + 0.2 + Math.random() * 0.6,
        (Math.random() - 0.5) * 3, Math.random() * 3 + 1, (Math.random() - 0.5) * 3,
        0.5 + Math.random() * 0.5, 0.08 + Math.random() * 0.07, cols[i % cols.length],
      );
    }
  }

  /** Small debris puff while mining. */
  chip(x: number, y: number, z: number, blockId: number): void {
    if (this.limit === 0) return;
    const cols = this.colorsForTile(BLOCK_TILES[blockId * 3 + 2]);
    this.spawn(x, y, z, (Math.random() - 0.5) * 2, Math.random() * 2, (Math.random() - 0.5) * 2, 0.35, 0.06, cols[0]);
  }

  burst(x: number, y: number, z: number, color: THREE.Color, n: number, speed = 2, up = 2): void {
    if (this.limit === 0) return;
    n = Math.min(n, Math.ceil(this.limit / 6));
    for (let i = 0; i < n; i++) {
      this.spawn(x, y, z, (Math.random() - 0.5) * speed, Math.random() * up, (Math.random() - 0.5) * speed, 0.4 + Math.random() * 0.4, 0.06 + Math.random() * 0.06, color);
    }
  }

  update(dt: number, isSolid: (x: number, y: number, z: number) => boolean): void {
    let w = 0;
    for (let i = 0; i < this.parts.length; i++) {
      const p = this.parts[i];
      p.life -= dt;
      if (p.life <= 0) continue;
      p.vy -= 18 * dt;
      const nx = p.x + p.vx * dt;
      const ny = p.y + p.vy * dt;
      const nz = p.z + p.vz * dt;
      if (isSolid(nx, ny, nz)) {
        p.vx *= 0.3; p.vz *= 0.3; p.vy = 0;
      } else {
        p.x = nx; p.y = ny; p.z = nz;
      }
      this.parts[w] = p;
      this.colors[w] = this.colors[i];
      w++;
    }
    this.parts.length = w;
    this.colors.length = w;
    for (let i = 0; i < w; i++) {
      const p = this.parts[i];
      const k = Math.min(1, p.life / (p.max * 0.4));
      this.s.setScalar(p.size * k);
      this.p.set(p.x, p.y, p.z);
      this.m.compose(this.p, this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
      this.mesh.setColorAt(i, this.colors[i]);
    }
    this.mesh.count = w;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  clear(): void {
    this.parts.length = 0;
    this.colors.length = 0;
    this.mesh.count = 0;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.dispose();
  }
}

/** Renders a held-item / block icon set from the atlas (for UI). */
export function atlasTileRectPx(tile: number): [number, number] {
  return [(tile % ATLAS_COLS) * CELL_PX + TILE_PAD, Math.floor(tile / ATLAS_COLS) * CELL_PX + TILE_PAD];
}
