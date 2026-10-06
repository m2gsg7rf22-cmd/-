import * as THREE from 'three';
import { RENDER } from '../world/blocks';
import { BLOCK_TILES, tileRect } from '../world/tiles';
import { iconFor } from '../ui/icons';
import { isTool } from '../game/items';

/** Swing length in seconds (one chop while mining). */
const SWING_TIME = 0.3;

function ease(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

/**
 * Chop curve over a swing (0..1) → strike amount: a short wind-up (negative),
 * a fast strike down to the peak, then an eased recovery.
 */
export function swingCurve(s: number): number {
  if (s <= 0 || s >= 1) return 0;
  if (s < 0.18) return -0.32 * ease(s / 0.18);
  if (s < 0.45) return -0.32 + 1.42 * ease((s - 0.18) / 0.27);
  return 1.1 * (1 - ease((s - 0.45) / 0.55));
}

/** Box geometry with flat per-face shading baked into vertex colors (cheap fake lighting). */
function shadedBox(w: number, h: number, d: number): THREE.BoxGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z.
  const shade = [0.82, 0.62, 1, 0.5, 0.72, 0.9];
  const colors = new Float32Array(24 * 3);
  for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) colors.set([shade[f], shade[f], shade[f]], (f * 4 + k) * 3);
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

/**
 * First-person arm and held item, drawn in a separate overlay pass (own camera, depth cleared)
 * so it never clips into the world.
 */
export class HandView {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(60, 1, 0.01, 10);
  /** Shoulder pivot: the whole arm + item swings around it. */
  private holder = new THREE.Group();
  private grip = new THREE.Group();
  private arm: THREE.Group;
  private armMats: THREE.MeshBasicMaterial[] = [];
  private armGeos: THREE.BufferGeometry[] = [];
  private current = -2;
  private mesh: THREE.Mesh | null = null;
  private swing = 0;
  private equip = 0;
  private impact = false;
  private tex = new Map<number, THREE.Texture>();
  private blockMat: THREE.MeshBasicMaterial;
  visible = true;

  constructor(atlas: THREE.Texture) {
    this.blockMat = new THREE.MeshBasicMaterial({ map: atlas, vertexColors: true, alphaTest: 0.5 });
    // Arm: sleeve + skin, reaching from the bottom-right corner toward the view center.
    this.arm = new THREE.Group();
    const part = (w: number, h: number, d: number, color: number, z: number) => {
      const g = shadedBox(w, h, d);
      const m = new THREE.MeshBasicMaterial({ color, vertexColors: true });
      this.armGeos.push(g);
      this.armMats.push(m);
      m.userData.base = new THREE.Color(color);
      const mesh = new THREE.Mesh(g, m);
      mesh.position.z = z;
      this.arm.add(mesh);
    };
    part(0.145, 0.145, 0.42, 0x3f6f9a, 0.2); // sleeve
    part(0.13, 0.13, 0.3, 0xd9a77e, -0.14); // forearm/hand
    this.arm.rotation.set(0.12, 0.16, 0);
    this.holder.add(this.arm);
    this.grip.position.set(-0.02, 0.1, -0.3);
    this.holder.add(this.grip);
    this.scene.add(this.holder);
  }

  /** Begin a swing (mining hit, attack or placement). */
  doSwing(): void {
    if (this.swing <= 0) {
      this.swing = 1;
      this.impact = false;
    }
  }

  /** True once per swing, at the moment the strike lands (mining feedback syncs to this). */
  consumeImpact(): boolean {
    if (!this.impact) return false;
    this.impact = false;
    return true;
  }

  get swinging(): boolean {
    return this.swing > 0;
  }

  private buildBlock(id: number): THREE.Mesh {
    const g = new THREE.BoxGeometry(0.3, 0.3, 0.3);
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    // BoxGeometry face order: +x, -x, +y, -y, +z, -z.
    const slots = [2, 2, 0, 1, 2, 2];
    const shade = [0.8, 0.8, 1, 0.5, 0.65, 0.65];
    const colors = new Float32Array(24 * 3);
    for (let f = 0; f < 6; f++) {
      const [u0, v0, u1, v1] = tileRect(BLOCK_TILES[id * 3 + slots[f]]);
      const o = f * 4;
      uv.setXY(o, u0, v1); uv.setXY(o + 1, u1, v1); uv.setXY(o + 2, u0, v0); uv.setXY(o + 3, u1, v0);
      for (let k = 0; k < 4; k++) colors.set([shade[f], shade[f], shade[f]], (o + k) * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const m = new THREE.Mesh(g, this.blockMat);
    m.rotation.set(0.25, -0.75, 0);
    m.position.set(-0.04, 0.02, -0.04);
    return m;
  }

  private buildFlat(id: number): THREE.Mesh {
    let t = this.tex.get(id);
    if (!t) {
      const img = new Image();
      img.src = iconFor(id);
      t = new THREE.Texture(img);
      img.onload = () => (t!.needsUpdate = true);
      t.magFilter = THREE.NearestFilter;
      t.minFilter = THREE.NearestFilter;
      t.generateMipmaps = false;
      t.colorSpace = THREE.SRGBColorSpace;
      this.tex.set(id, t);
    }
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(0.5, 0.5),
      new THREE.MeshBasicMaterial({ map: t, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide }),
    );
    if (isTool(id)) {
      // Held by the handle: the head points up and forward, ready to chop.
      m.rotation.set(0, -1.35, 0.1);
      m.position.set(0.0, 0.16, -0.06);
    } else {
      m.rotation.set(0, -0.6, 0.35);
      m.position.set(0, 0.08, 0);
    }
    return m;
  }

  private setItem(id: number): void {
    if (id === this.current) return;
    this.current = id;
    if (this.mesh) {
      this.grip.remove(this.mesh);
      this.mesh.geometry.dispose();
      if (this.mesh.material !== this.blockMat) (this.mesh.material as THREE.Material).dispose();
      this.mesh = null;
    }
    this.equip = 1;
    if (id < 0) return;
    const isCube = id < 256 && RENDER[id] !== 3 && RENDER[id] !== 0 && RENDER[id] !== 6;
    this.mesh = isCube ? this.buildBlock(id) : this.buildFlat(id);
    this.grip.add(this.mesh);
  }

  update(dt: number, itemId: number, bob: number, moving: number, brightness: number, aspect: number): void {
    this.setItem(itemId);
    if (this.camera.aspect !== aspect) {
      this.camera.aspect = aspect;
      this.camera.updateProjectionMatrix();
    }
    const before = 1 - this.swing;
    this.swing = Math.max(0, this.swing - dt / SWING_TIME);
    const s = this.swing > 0 ? 1 - this.swing : 0;
    if (before < 0.45 && (s >= 0.45 || (this.swing === 0 && before > 0))) this.impact = true;
    this.equip = Math.max(0, this.equip - dt * 5);
    const a = swingCurve(s);
    const bx = Math.cos(bob) * 0.012 * moving;
    const by = Math.abs(Math.sin(bob)) * 0.018 * moving;
    // Keep the arm toward the bottom-right; adapt slightly for narrow (portrait) screens.
    const side = aspect < 1 ? 0.3 : 0.48;
    this.holder.position.set(side + bx - a * 0.11, -0.45 + by - this.equip * 0.4 + Math.max(0, -a) * 0.08 - a * 0.05, -0.78 - a * 0.1);
    this.holder.rotation.set(-a * 0.95 + 0.05, 0.08 + a * 0.32, a * 0.3);
    // Short landscape phones: shrink so the arm doesn't crowd the hotbar/touch buttons.
    this.holder.scale.setScalar(aspect > 1.9 ? 0.7 : 1);
    const c = 0.35 + brightness * 0.65;
    this.blockMat.color.setRGB(c, c, c);
    for (const m of this.armMats) m.color.copy(m.userData.base as THREE.Color).multiplyScalar(c);
    if (this.mesh && this.mesh.material !== this.blockMat) (this.mesh.material as THREE.MeshBasicMaterial).color.setRGB(c, c, c);
  }

  render(r: THREE.WebGLRenderer): void {
    if (!this.visible) return;
    const auto = r.autoClear;
    r.autoClear = false;
    r.clearDepth();
    r.render(this.scene, this.camera);
    r.autoClear = auto;
  }

  dispose(): void {
    this.setItem(-1);
    for (const t of this.tex.values()) t.dispose();
    this.blockMat.dispose();
    for (const g of this.armGeos) g.dispose();
    for (const m of this.armMats) m.dispose();
  }
}
