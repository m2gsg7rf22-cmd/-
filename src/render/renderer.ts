import * as THREE from 'three';
import { buildAtlasCanvas } from './atlas';
import { createAtlasTexture, createWorldMaterials } from './materials';

/**
 * Owns the WebGL renderer, camera and shared GPU resources for the app's lifetime,
 * and keeps the canvas correctly sized across resize/orientation/fullscreen changes.
 */
export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly atlasCanvas: HTMLCanvasElement;
  readonly atlas: THREE.Texture;
  readonly materials: { opaque: THREE.ShaderMaterial; transparent: THREE.ShaderMaterial };
  private resolutionScale = 1;
  private pixelCap = 2;
  private lastW = 0;
  private lastH = 0;
  private lastDpr = 0;
  onResize?: (w: number, h: number) => void;
  contextLost = false;

  constructor(readonly canvas: HTMLCanvasElement) {
    let r: THREE.WebGLRenderer;
    try {
      r = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    } catch (e) {
      throw new Error(`WebGL is not available on this device/browser (${e instanceof Error ? e.message : e})`);
    }
    this.renderer = r;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.setClearColor(0x88aadd);
    this.camera = new THREE.PerspectiveCamera(75, 1, 0.08, 1200);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);
    this.atlasCanvas = buildAtlasCanvas();
    this.atlas = createAtlasTexture(this.atlasCanvas);
    this.materials = createWorldMaterials(this.atlas);

    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.contextLost = true;
      console.error('[BlockForge] WebGL context lost');
    });
    canvas.addEventListener('webglcontextrestored', () => {
      this.contextLost = false;
      console.warn('[BlockForge] WebGL context restored');
    });

    const onResize = () => this.resize();
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', () => {
      // Some mobile browsers report the old size during the event; re-check after layout.
      onResize();
      setTimeout(onResize, 150);
      setTimeout(onResize, 500);
    });
    document.addEventListener('fullscreenchange', () => setTimeout(onResize, 50));
    window.visualViewport?.addEventListener('resize', onResize);
    this.resize();
  }

  setQuality(resolutionScale: number, mobile: boolean): void {
    this.resolutionScale = resolutionScale;
    this.pixelCap = mobile ? 1.5 : 2;
    this.lastW = 0; // force update
    this.resize();
  }

  /** Sync drawing buffer + camera with the canvas' CSS size. Cheap when nothing changed. */
  resize(): void {
    const w = Math.max(1, Math.round(this.canvas.clientWidth || window.innerWidth));
    const h = Math.max(1, Math.round(this.canvas.clientHeight || window.innerHeight));
    const dpr = Math.min(window.devicePixelRatio || 1, this.pixelCap) * this.resolutionScale;
    if (w === this.lastW && h === this.lastH && dpr === this.lastDpr) return;
    this.lastW = w;
    this.lastH = h;
    this.lastDpr = dpr;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.onResize?.(w, h);
  }

  get size(): { w: number; h: number } {
    return { w: this.lastW, h: this.lastH };
  }

  render(): void {
    if (this.contextLost) return;
    this.resize();
    this.renderer.render(this.scene, this.camera);
  }

  info(): { calls: number; triangles: number; geometries: number; textures: number } {
    const i = this.renderer.info;
    return { calls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures };
  }
}
