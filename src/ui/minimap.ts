import { isWaterId } from '../core/ids';
import { BLOCK_TILES, ATLAS_COLS, CELL_PX, TILE_PAD, TILE_PX } from '../world/tiles';
import { BLOCKS } from '../world/blocks';

interface ColumnSource {
  columnTop(x: number, z: number): { id: number; y: number } | null;
}

/** Top-down minimap (north up) + horizontal compass, drawn from per-column top-block data. */
export class Minimap {
  readonly el: HTMLElement;
  private map: HTMLCanvasElement;
  private compass: HTMLCanvasElement;
  private colors = new Uint8Array(256 * 3);
  private img: ImageData;
  private timer = 0;
  private lastHeading = NaN;
  static readonly R = 48;

  constructor(parent: HTMLElement, atlas: HTMLCanvasElement) {
    this.el = document.createElement('div');
    this.el.className = 'nav';
    this.el.innerHTML = `<canvas class="compass" width="240" height="24" aria-hidden="true"></canvas><div class="minimap-wrap"><canvas class="minimap" width="${Minimap.R * 2}" height="${Minimap.R * 2}" aria-label="Minimap"></canvas><i class="me"></i></div>`;
    parent.appendChild(this.el);
    this.map = this.el.querySelector('.minimap')!;
    this.compass = this.el.querySelector('.compass')!;
    this.img = new ImageData(Minimap.R * 2, Minimap.R * 2);
    // Average top-tile color per block.
    const ctx = atlas.getContext('2d', { willReadFrequently: true })!;
    for (const b of BLOCKS) {
      if (!b) continue;
      const t = BLOCK_TILES[b.id * 3];
      const ox = (t % ATLAS_COLS) * CELL_PX + TILE_PAD;
      const oy = Math.floor(t / ATLAS_COLS) * CELL_PX + TILE_PAD;
      const d = ctx.getImageData(ox, oy, TILE_PX, TILE_PX).data;
      let r = 0, g = 0, bl = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 100) { r += d[i]; g += d[i + 1]; bl += d[i + 2]; n++; }
      if (n) this.colors.set([r / n, g / n, bl / n], b.id * 3);
    }
  }

  set visible(v: boolean) {
    this.el.hidden = !v;
  }

  update(dt: number, src: ColumnSource, px: number, py: number, pz: number, yaw: number): void {
    if (this.el.hidden) return;
    const heading = ((-yaw * 180) / Math.PI % 360 + 360) % 360;
    (this.el.querySelector('.me') as HTMLElement).style.transform = `translate(-50%, -50%) rotate(${heading}deg)`;
    if (!(Math.abs(heading - this.lastHeading) <= 0.5)) {
      this.lastHeading = heading;
      this.drawCompass(heading);
    }
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.5;
    const R = Minimap.R;
    const data = this.img.data;
    const cx = Math.floor(px);
    const cz = Math.floor(pz);
    for (let dz = -R; dz < R; dz++) {
      for (let dx = -R; dx < R; dx++) {
        const o = ((dz + R) * R * 2 + (dx + R)) * 4;
        const top = src.columnTop(cx + dx, cz + dz);
        if (!top || !top.id) {
          data[o] = 20; data[o + 1] = 22; data[o + 2] = 28; data[o + 3] = 255;
          continue;
        }
        let r: number, g: number, b: number;
        if (isWaterId(top.id)) { r = 46; g = 96; b = 176; }
        else { r = this.colors[top.id * 3]; g = this.colors[top.id * 3 + 1]; b = this.colors[top.id * 3 + 2]; }
        const k = Math.max(0.55, Math.min(1.35, 1 + (top.y - py) * 0.018));
        data[o] = r * k; data[o + 1] = g * k; data[o + 2] = b * k; data[o + 3] = 255;
      }
    }
    this.map.getContext('2d')!.putImageData(this.img, 0, 0);
  }

  private drawCompass(heading: number): void {
    const c = this.compass;
    const ctx = c.getContext('2d')!;
    const W = c.width;
    const H = c.height;
    ctx.clearRect(0, 0, W, H);
    const span = 150; // degrees visible
    const ppd = W / span;
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const labels: Record<number, string> = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    for (let d = Math.floor((heading - span / 2) / 15) * 15; d <= heading + span / 2; d += 15) {
      const x = W / 2 + (d - heading) * ppd;
      const a = ((d % 360) + 360) % 360;
      const lab = labels[a];
      if (lab) {
        ctx.fillStyle = a === 0 ? '#ff8a3d' : '#ffffff';
        ctx.fillText(lab, x, H / 2);
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.fillRect(x - 0.5, H / 2 - 3, 1, 6);
      }
    }
    ctx.fillStyle = '#ff8a3d';
    ctx.fillRect(W / 2 - 1, 0, 2, 4);
  }
}
