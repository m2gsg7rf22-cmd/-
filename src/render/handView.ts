import * as THREE from 'three';
import { RENDER } from '../world/blocks';
import { BLOCK_TILES, tileRect } from '../world/tiles';
import { iconFor } from '../ui/icons';

/**
 * First-person held item, drawn in a separate overlay pass (own camera, depth cleared)
 * so it never clips into the world.
 */
export class HandView {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(60, 1, 0.01, 10);
  private holder = new THREE.Group();
  private current = -2;
  private mesh: THREE.Mesh | null = null;
  private swing = 0;
  private equip = 0;
  private tex = new Map<number, THREE.Texture>();
  private blockMat: THREE.MeshBasicMaterial;
  visible = true;

  constructor(atlas: THREE.Texture) {
    this.blockMat = new THREE.MeshBasicMaterial({ map: atlas, vertexColors: true, alphaTest: 0.5 });
    this.scene.add(this.holder);
  }

  /** Begin a swing (mining hit or placement). */
  doSwing(): void {
    if (this.swing <= 0) this.swing = 1;
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
      new THREE.PlaneGeometry(0.46, 0.46),
      new THREE.MeshBasicMaterial({ map: t, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide }),
    );
    m.rotation.set(0, -0.6, 0.35);
    return m;
  }

  private setItem(id: number): void {
    if (id === this.current) return;
    this.current = id;
    if (this.mesh) {
      this.holder.remove(this.mesh);
      this.mesh.geometry.dispose();
      if (this.mesh.material !== this.blockMat) (this.mesh.material as THREE.Material).dispose();
      this.mesh = null;
    }
    this.equip = 1;
    if (id < 0) return;
    const isCube = id < 256 && RENDER[id] !== 3 && RENDER[id] !== 0 && RENDER[id] !== 6;
    this.mesh = isCube ? this.buildBlock(id) : this.buildFlat(id);
    this.holder.add(this.mesh);
  }

  update(dt: number, itemId: number, bob: number, moving: number, brightness: number, aspect: number): void {
    this.setItem(itemId);
    if (this.camera.aspect !== aspect) {
      this.camera.aspect = aspect;
      this.camera.updateProjectionMatrix();
    }
    this.swing = Math.max(0, this.swing - dt * 3.2);
    this.equip = Math.max(0, this.equip - dt * 5);
    const s = Math.sin((1 - this.swing) * Math.PI) * (this.swing > 0 ? 1 : 0);
    const bx = Math.cos(bob) * 0.012 * moving;
    const by = Math.abs(Math.sin(bob)) * 0.018 * moving;
    // Keep the item toward the bottom-right; adapt slightly for narrow (portrait) screens.
    const side = aspect < 1 ? 0.28 : 0.5;
    this.holder.position.set(side + bx - s * 0.12, -0.4 + by - this.equip * 0.35 - s * 0.05, -0.95 - s * 0.12);
    this.holder.rotation.set(-s * 0.9, s * 0.3, 0);
    // Short landscape phones: shrink so the item doesn't crowd the hotbar/touch buttons.
    this.holder.scale.setScalar(aspect > 1.9 ? 0.7 : 1);
    const c = 0.35 + brightness * 0.65;
    this.blockMat.color.setRGB(c, c, c);
    if (this.mesh && this.mesh.material !== this.blockMat) (this.mesh.material as THREE.MeshBasicMaterial).color.setRGB(c, c, c);
  }

  render(r: THREE.WebGLRenderer): void {
    if (!this.visible || !this.mesh) return;
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
  }
}
