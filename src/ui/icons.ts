import { I, TOOL_BASE, TOOL_KINDS } from '../core/ids';
import { itemDef } from '../game/items';
import { tileCanvas } from '../render/atlas';
import { BLOCKS, RENDER } from '../world/blocks';
import { BLOCK_TILES } from '../world/tiles';

const cache = new Map<number, string>();
let atlas: HTMLCanvasElement | null = null;

export function initIcons(atlasCanvas: HTMLCanvasElement): void {
  atlas = atlasCanvas;
  cache.clear();
}

const S = 48; // icon render size (CSS scales it)

/** Isometric cube from top + side tiles. */
function blockIcon(id: number): string {
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  const top = tileCanvas(atlas!, BLOCK_TILES[id * 3]);
  const side = tileCanvas(atlas!, BLOCK_TILES[id * 3 + 2]);
  const r = RENDER[id];
  if (r === 3) {
    ctx.drawImage(side, 4, 4, S - 8, S - 8);
    return c.toDataURL();
  }
  const w = S * 0.42; // half width of cube
  const cx = S / 2;
  const h = w * 0.55;
  const top0 = S * 0.06;
  // Top face: map unit square to rhombus.
  ctx.save();
  ctx.setTransform(w / 16, h / 16, -w / 16, h / 16, cx, top0);
  ctx.drawImage(top, 0, 0);
  ctx.restore();
  const sideH = w;
  // Left face.
  ctx.save();
  ctx.setTransform(w / 16, h / 16, 0, sideH / 16, cx - w, top0 + h);
  ctx.drawImage(side, 0, 0);
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.fillRect(0, 0, 16, 16);
  ctx.restore();
  // Right face.
  ctx.save();
  ctx.setTransform(w / 16, -h / 16, 0, sideH / 16, cx, top0 + 2 * h);
  ctx.drawImage(side, 0, 0);
  ctx.fillStyle = 'rgba(0,0,0,0.38)';
  ctx.fillRect(0, 0, 16, 16);
  ctx.restore();
  return c.toDataURL();
}

type Px = (x: number, y: number, color: string) => void;

function sprite(draw: (px: Px) => void): string {
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = 16;
  const ctx = c.getContext('2d')!;
  draw((x, y, color) => {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, 1, 1);
  });
  const big = document.createElement('canvas');
  big.width = S;
  big.height = S;
  const b = big.getContext('2d')!;
  b.imageSmoothingEnabled = false;
  b.drawImage(c, 0, 0, S, S);
  return big.toDataURL();
}

function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

const HANDLE = '#7a5634';
const HANDLE_D = '#5a3e24';

function handle(px: Px, from = 3): void {
  for (let i = from; i < 13; i++) {
    px(i, 15 - i, HANDLE);
    px(i + 1, 15 - i, HANDLE_D);
  }
}

function toolIcon(id: number): string {
  const idx = id - TOOL_BASE;
  const kind = TOOL_KINDS[idx % 4];
  const col = itemDef(id)!.color!;
  const hi = shade(col, 1.25);
  const lo = shade(col, 0.7);
  return sprite((px) => {
    if (kind === 'blade') {
      for (let i = 0; i < 10; i++) {
        px(5 + i, 10 - i, col);
        px(6 + i, 10 - i, hi);
        px(5 + i, 11 - i, lo);
      }
      for (let i = 0; i < 5; i++) px(2 + i, 9 + i, '#6b6b70');
      px(2, 14, HANDLE); px(3, 13, HANDLE); px(1, 15, HANDLE_D); px(4, 12, HANDLE);
      return;
    }
    handle(px);
    if (kind === 'pickaxe') {
      for (let i = 0; i < 9; i++) {
        const x = 4 + i;
        const y = 2 + Math.round(Math.abs(i - 4) * 0.6);
        px(x, y, col); px(x, y + 1, lo);
      }
      px(4, 5, lo); px(12, 5, lo); px(8, 2, hi); px(7, 2, hi);
    } else if (kind === 'axe') {
      for (let y = 1; y < 8; y++) for (let x = 9; x < 14; x++) {
        if (x - 9 > (y < 4 ? y + 1 : 8 - y)) continue;
        px(x, y, x === 9 ? lo : col);
      }
      px(13, 3, hi); px(13, 4, hi);
    } else {
      for (let y = 1; y < 6; y++) for (let x = 10; x < 15; x++) {
        if (Math.abs(x - 12) + Math.abs(y - 3) > 3) continue;
        px(x, y, col);
      }
      px(11, 2, hi); px(10, 5, lo);
    }
  });
}

function itemIcon(id: number): string {
  const col = itemDef(id)?.color ?? '#999999';
  const hi = shade(col, 1.3);
  const lo = shade(col, 0.65);
  switch (id) {
    case I.STICK:
      return sprite((px) => { for (let i = 3; i < 13; i++) { px(i, 15 - i, col); px(i + 1, 15 - i, lo); } });
    case I.COPPER_INGOT:
    case I.IRON_INGOT:
      return sprite((px) => {
        for (let y = 6; y < 11; y++) for (let x = 2 + (10 - y); x < 14 - (y - 6) / 2; x++) px(x, y, y === 6 ? hi : y === 10 ? lo : col);
      });
    case I.LUMEN_SHARD:
      return sprite((px) => {
        for (let y = 2; y < 14; y++) {
          const w = y < 8 ? y - 2 : 13 - y;
          for (let x = 8 - w / 2; x <= 8 + w / 2; x++) px(Math.round(x), y, x < 8 ? hi : col);
        }
        px(7, 4, '#ffffff');
      });
    case I.EMBER:
    case I.RAW_COPPER:
    case I.RAW_IRON:
      return sprite((px) => {
        for (let y = 4; y < 13; y++) for (let x = 3; x < 13; x++) {
          const d = Math.hypot(x - 8, (y - 8.5) * 1.2);
          if (d < 4.6 + Math.sin(x * 3 + y) * 0.6) px(x, y, d < 2 ? hi : col);
        }
        if (id === I.EMBER) { px(6, 7, '#ff7a2a'); px(9, 9, '#ffb04a'); px(8, 6, '#ff5a1a'); }
        else { px(6, 7, lo); px(10, 10, lo); }
      });
    case I.BERRIES:
      return sprite((px) => {
        for (const [cx, cy] of [[6, 8], [10, 8], [8, 11], [8, 6]]) {
          for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) if (x * x + y * y < 2) px(cx + x, cy + y, col);
          px(cx - 1, cy - 1, hi);
        }
        px(8, 3, '#4c8a3c'); px(9, 4, '#4c8a3c');
      });
    case I.APPLE:
      return sprite((px) => {
        for (let y = 4; y < 14; y++) for (let x = 3; x < 13; x++) if (Math.hypot(x - 8, y - 9) < 4.8) px(x, y, x < 6 && y < 8 ? hi : col);
        px(8, 3, '#5a3e24'); px(8, 2, '#5a3e24'); px(9, 2, '#4c8a3c'); px(10, 2, '#4c8a3c');
      });
    case I.RAW_MEAT:
    case I.ROAST_MEAT:
      return sprite((px) => {
        for (let y = 4; y < 12; y++) for (let x = 2; x < 12; x++) if (Math.hypot((x - 7) * 0.8, y - 8) < 4) px(x, y, y < 6 ? hi : col);
        for (let i = 0; i < 4; i++) px(11 + i, 11 + (i >> 1), '#f0ead8');
        px(14, 12, '#f0ead8'); px(14, 13, '#f0ead8');
      });
    case I.BREAD_LOAF:
      return sprite((px) => {
        for (let y = 5; y < 12; y++) for (let x = 2; x < 14; x++) if (Math.hypot((x - 8) * 0.6, y - 9) < 3.6) px(x, y, y < 7 ? hi : col);
        px(6, 7, lo); px(9, 7, lo); px(12, 8, lo);
      });
    default:
      return sprite((px) => { for (let y = 4; y < 12; y++) for (let x = 4; x < 12; x++) px(x, y, col); });
  }
}

/** Data-URL icon for any item id (cached). */
export function iconFor(id: number): string {
  let u = cache.get(id);
  if (u) return u;
  if (!atlas) return '';
  if (id < 256 && BLOCKS[id]) u = blockIcon(id);
  else if (id >= TOOL_BASE) u = toolIcon(id);
  else u = itemIcon(id);
  cache.set(id, u);
  return u;
}
