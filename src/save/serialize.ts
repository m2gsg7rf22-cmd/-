import { CHUNK_VOLUME } from '../core/constants';
import type { ItemStack } from '../game/inventory';
import { DIMS, isDim, type Dim } from '../world/dimension';

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

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** How the player arrives after a dimension change (resolved once the destination has loaded). */
export type Arrival = 'rift' | 'gate' | 'return' | 'spawn';

export interface MobSave {
  kind: string;
  x: number;
  y: number;
  z: number;
  health: number;
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
  mobs?: MobSave[];
  version: number;
  /** Dimension the player is in (absent in old saves = overworld). */
  dim?: Dim;
  /** Last position in each dimension (where the player left it). */
  dimPos?: Partial<Record<Dim, Vec3>>;
  /** Emberdeep-side rift portal linked to the overworld. */
  emberLink?: Vec3;
  /** Pending arrival after travelling (cleared once placed). */
  arrival?: Arrival;
  /** Dimension the saved creatures belong to. */
  mobsDim?: Dim;
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
    mobs: Array.isArray(r.mobs)
      ? r.mobs
          .filter((m): m is MobSave => !!m && typeof m.kind === 'string' && /^[a-z]{2,16}$/.test(m.kind) && finite(m.x) && finite(m.y) && finite(m.z) && finite(m.health) && m.health > 0)
          .slice(0, 40)
      : [],
    version: finite(r.version) ? r.version : SAVE_VERSION,
    dim: isDim(r.dim) ? r.dim : 'overworld',
    dimPos: validDimPos(r.dimPos),
    emberLink: validVec(r.emberLink) ?? undefined,
    arrival: r.arrival === 'rift' || r.arrival === 'gate' || r.arrival === 'return' || r.arrival === 'spawn' ? r.arrival : undefined,
    mobsDim: isDim(r.mobsDim) ? r.mobsDim : 'overworld',
  };
}

function validVec(v: unknown): Vec3 | null {
  const o = v as Partial<Vec3> | null | undefined;
  return o && finite(o.x) && finite(o.y) && finite(o.z) ? { x: o.x, y: o.y, z: o.z } : null;
}

function validDimPos(v: unknown): Partial<Record<Dim, Vec3>> {
  const out: Partial<Record<Dim, Vec3>> = {};
  if (!v || typeof v !== 'object') return out;
  for (const d of DIMS) {
    const p = validVec((v as Record<string, unknown>)[d]);
    if (p) out[d] = p;
  }
  return out;
}

export function newWorldId(): string {
  return 'w' + Date.now().toString(36) + Math.floor(Math.random() * 1e9).toString(36);
}
