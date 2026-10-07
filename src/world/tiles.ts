import { BLOCKS } from './blocks';

/** All atlas tiles, in atlas order. The atlas painter (render/atlas.ts) draws each by name. */
export const TILE_NAMES = [
  'none', 'grass_top', 'grass_side', 'dirt', 'stone', 'rubble', 'sand', 'sandstone', 'sandstone_top', 'gravel',
  'snow', 'snow_side', 'ice', 'water', 'ash_log', 'ash_log_top', 'ash_leaves', 'pine_log', 'pine_log_top',
  'pine_leaves', 'planks', 'ember_ore', 'copper_ore', 'iron_ore', 'lumen_ore', 'coreite', 'cactus_side', 'cactus_top',
  'tall_grass', 'flower_red', 'flower_gold', 'berry_bush', 'dry_shrub', 'bench_top', 'bench_side', 'kiln_top',
  'kiln_front', 'glass', 'slate_bricks', 'fern', 'torch', 'torch_top', 'door_lower', 'door_upper', 'lumen_lamp',
  'break_0', 'break_1', 'break_2', 'break_3', 'break_4', 'break_5', 'break_6', 'break_7', 'break_8', 'break_9',
  'cinderrock', 'ashen_sand', 'glowcap', 'magma', 'basalt_top', 'basalt_side', 'duskstone', 'rift', 'quartz_ore',
  'ember_stalk', 'ember_stalk_top', 'ember_cap', 'ember_sprout', 'cinder_bricks', 'voidstone', 'void_bricks',
  'void_stalk', 'void_stalk_top', 'void_bloom', 'void_gate_top', 'void_gate_side', 'void_crystal', 'bone_top', 'bone_side',
  'ember_wart', 'crimson_top', 'crimson_side', 'purpur', 'purpur_pillar', 'purpur_pillar_top', 'end_rod', 'void_egg',
  'vframe_top', 'vframe_eye_top', 'vframe_side',
] as const;

export type TileName = (typeof TILE_NAMES)[number];

export const TILE_PX = 16;
export const ATLAS_COLS = 8;
export const ATLAS_ROWS = Math.ceil(TILE_NAMES.length / ATLAS_COLS);
/** Each tile is drawn with a 2px extruded border to prevent bleeding. */
export const TILE_PAD = 2;
export const CELL_PX = TILE_PX + TILE_PAD * 2;
export const ATLAS_W = ATLAS_COLS * CELL_PX;
export const ATLAS_H = ATLAS_ROWS * CELL_PX;

export function tileIndex(name: string): number {
  const i = (TILE_NAMES as readonly string[]).indexOf(name);
  if (i < 0) throw new Error(`Unknown tile '${name}'`);
  return i;
}

/** Tile indices per block: [top, bottom, side] packed as BLOCK_TILES[id*3 + face]. */
export const BLOCK_TILES = new Uint16Array(256 * 3);
for (const d of BLOCKS) {
  if (!d) continue;
  for (let f = 0; f < 3; f++) BLOCK_TILES[d.id * 3 + f] = tileIndex(d.tiles[f]);
}

/**
 * Shader flags packed into the tile attribute's u (u + flags * 2; real u is always < 1):
 * 1 = natural block: random per-block rotation + slight brightness variation (breaks visible tiling);
 * 2 = animated (magma, rifts, void gates): uv drift + glow pulse.
 */
export const TILE_FLAGS = new Uint8Array(TILE_NAMES.length);
for (const n of ['grass_top', 'dirt', 'stone', 'sand', 'gravel', 'snow', 'sandstone_top', 'cinderrock', 'ashen_sand', 'voidstone', 'rubble', 'coreite', 'duskstone', 'crimson_top', 'ember_wart']) {
  TILE_FLAGS[tileIndex(n)] |= 1;
}
for (const n of ['magma', 'rift', 'void_gate_top', 'void_gate_side']) TILE_FLAGS[tileIndex(n)] |= 2;

/** Bottom-left atlas uv of a tile with its shader flags packed into u (see TILE_FLAGS). */
export function tileBase(index: number): [number, number] {
  const [u0, v0] = tileRect(index);
  return [u0 + TILE_FLAGS[index] * 2, v0];
}

/** UV rect of a tile in [0,1] atlas space (v up, three.js convention), inset to the unpadded area. */
export function tileRect(index: number): [number, number, number, number] {
  const col = index % ATLAS_COLS;
  const row = Math.floor(index / ATLAS_COLS);
  const u0 = (col * CELL_PX + TILE_PAD) / ATLAS_W;
  const u1 = (col * CELL_PX + TILE_PAD + TILE_PX) / ATLAS_W;
  const vTop = 1 - (row * CELL_PX + TILE_PAD) / ATLAS_H;
  const vBot = 1 - (row * CELL_PX + TILE_PAD + TILE_PX) / ATLAS_H;
  return [u0, vBot, u1, vTop];
}
