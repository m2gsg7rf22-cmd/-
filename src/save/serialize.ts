import { CHUNK_VOLUME } from '../core/constants';
import type { ItemStack } from '../game/inventory';

export type GameMode = 'survival' | 'creative';

export interface PlayerSave {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  health: number;
  hunger: number;
  saturation: number;
  inventory: (ItemStack | null)[];
  selected: number;
  flying: boolean;
  spawn: { x: number; y: number; z: number };
}

export interface WorldMeta {
  id: string;
  name: string;
  seed: string;
  seedNum: number;
  mode: GameMode;
  created: number;
  lastPlayed: number;
  time: number;
  day: number;
  player: PlayerSave | null;
  version: number;
}

export const SAVE_VERSION = 1;

/** Run-length encode chunk data as [count, value] byte pairs (count 1..255). */
export function encodeRLE(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i < data.length) {
    const v = data[i];
    let n = 1;
    while (i + n < data.length && data[i + n] === v && n < 255) n++;
    out.push(n, v);
    i += n;
  }
  return Uint8Array.from(out);
}

export function decodeRLE(rle: Uint8Array, length = CHUNK_VOLUME): Uint8Array {
  if (rle.length % 2 !== 0) throw new Error('corrupt RLE: odd length');
  const out = new Uint8Array(length);
  let o = 0;
  for (let i = 0; i < rle.length; i += 2) {
    const n = rle[i];
    const v = rle[i + 1];
    if (n === 0 || o + n > length) throw new Error('corrupt RLE: bad run');
    out.fill(v, o, o + n);
    o += n;
  }
  if (o !== length) throw new Error(`corrupt RLE: decoded ${o} of ${length}`);
  return out;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Validate a world meta record loaded from storage. Returns null if unusable. */
export function validateMeta(raw: unknown): WorldMeta | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<WorldMeta>;
  if (typeof r.id !== 'string' || typeof r.name !== 'string' || !finite(r.seedNum)) return null;
  const mode: GameMode = r.mode === 'creative' ? 'creative' : 'survival';
  let player: PlayerSave | null = null;
  const p = r.player as Partial<PlayerSave> | null | undefined;
  if (p && finite(p.x) && finite(p.y) && finite(p.z)) {
    player = {
      x: p.x, y: p.y, z: p.z,
      yaw: finite(p.yaw) ? p.yaw : 0,
      pitch: finite(p.pitch) ? Math.max(-1.55, Math.min(1.55, p.pitch)) : 0,
      health: finite(p.health) ? Math.max(0, Math.min(20, p.health)) : 20,
      hunger: finite(p.hunger) ? Math.max(0, Math.min(20, p.hunger)) : 20,
      saturation: finite(p.saturation) ? p.saturation : 5,
      inventory: Array.isArray(p.inventory) ? p.inventory : [],
      selected: finite(p.selected) ? Math.max(0, Math.min(8, Math.floor(p.selected))) : 0,
      flying: p.flying === true,
      spawn: p.spawn && finite(p.spawn.x) && finite(p.spawn.y) && finite(p.spawn.z) ? p.spawn : { x: p.x, y: p.y, z: p.z },
    };
  }
  return {
    id: r.id,
    name: r.name.slice(0, 40) || 'World',
    seed: typeof r.seed === 'string' ? r.seed : String(r.seedNum),
    seedNum: r.seedNum >>> 0,
    mode,
    created: finite(r.created) ? r.created : Date.now(),
    lastPlayed: finite(r.lastPlayed) ? r.lastPlayed : Date.now(),
    time: finite(r.time) ? ((r.time % 1) + 1) % 1 : 0.1,
    day: finite(r.day) ? r.day : 0,
    player,
    version: finite(r.version) ? r.version : SAVE_VERSION,
  };
}

export function newWorldId(): string {
  return 'w' + Date.now().toString(36) + Math.floor(Math.random() * 1e9).toString(36);
}
