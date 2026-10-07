import { B, I, type ToolKind } from '../core/ids';

const P = 1 / 16;

export type RenderKind = 'none' | 'solid' | 'cutout' | 'cross' | 'water' | 'glass' | 'shape';
export type Surface = 'grass' | 'stone' | 'wood' | 'sand' | 'snow' | 'gravel' | 'glass' | 'plant' | 'water';

export interface BlockDef {
  id: number;
  name: string;
  render: RenderKind;
  /** Does it stop movement? */
  solid: boolean;
  /** Does it fully hide neighbor faces? */
  opaque: boolean;
  /** Base break time in seconds with bare hands. Infinity = unbreakable. */
  hardness: number;
  tool?: ToolKind;
  /** Minimum tool tier (0..4) needed to get a drop; -1 = any/no tool. */
  minTier: number;
  /** Tiles: [top, bottom, side] tile names. */
  tiles: [string, string, string];
  drop?: { id: number; count: number; chance?: number }[];
  surface: Surface;
  /** Can be replaced by placing a block into it (plants, water). */
  replaceable?: boolean;
  /** Block light emitted (0..15). */
  light?: number;
  /** For 'shape' blocks: boxes [x0,y0,z0,x1,y1,z1] in 0..1 cell space (rendered and collided). */
  boxes?: number[][];
  /** Hidden from the creative library (orientation/state variants, flowing water). */
  variant?: boolean;
}

const defs: BlockDef[] = [];

function def(d: Partial<BlockDef> & Pick<BlockDef, 'id' | 'name' | 'tiles'>): void {
  const full: BlockDef = {
    render: 'solid',
    solid: true,
    opaque: true,
    hardness: 1,
    minTier: -1,
    surface: 'stone',
    ...d,
  };
  if (full.drop === undefined && full.id !== B.AIR) full.drop = [{ id: full.id, count: 1 }];
  defs[full.id] = full;
}

const t3 = (a: string): [string, string, string] => [a, a, a];

def({ id: B.AIR, name: 'Air', render: 'none', solid: false, opaque: false, hardness: 0, tiles: t3('none'), drop: [] });
def({ id: B.GRASS, name: 'Meadow Turf', hardness: 0.6, tool: 'shovel', tiles: ['grass_top', 'dirt', 'grass_side'], drop: [{ id: B.DIRT, count: 1 }], surface: 'grass' });
def({ id: B.DIRT, name: 'Loam', hardness: 0.5, tool: 'shovel', tiles: t3('dirt'), surface: 'grass' });
def({ id: B.STONE, name: 'Stone', hardness: 2.2, tool: 'pickaxe', minTier: 0, tiles: t3('stone'), drop: [{ id: B.RUBBLE, count: 1 }] });
def({ id: B.RUBBLE, name: 'Rubble', hardness: 2.4, tool: 'pickaxe', minTier: 0, tiles: t3('rubble') });
def({ id: B.SAND, name: 'Sand', hardness: 0.5, tool: 'shovel', tiles: t3('sand'), surface: 'sand' });
def({ id: B.SANDSTONE, name: 'Sandstone', hardness: 1.6, tool: 'pickaxe', minTier: 0, tiles: ['sandstone_top', 'sandstone_top', 'sandstone'] });
def({ id: B.GRAVEL, name: 'Gravel', hardness: 0.6, tool: 'shovel', tiles: t3('gravel'), surface: 'gravel' });
def({ id: B.SNOW_GRASS, name: 'Frost Turf', hardness: 0.6, tool: 'shovel', tiles: ['snow', 'dirt', 'snow_side'], drop: [{ id: B.DIRT, count: 1 }], surface: 'snow' });
def({ id: B.ICE, name: 'Ice', render: 'glass', opaque: false, hardness: 0.5, tool: 'pickaxe', tiles: t3('ice'), surface: 'glass', drop: [] });
def({ id: B.WATER, name: 'Water', render: 'water', solid: false, opaque: false, hardness: Infinity, tiles: t3('water'), drop: [], surface: 'water', replaceable: true });
def({ id: B.ASH_LOG, name: 'Ashwood Log', hardness: 2, tool: 'axe', tiles: ['ash_log_top', 'ash_log_top', 'ash_log'], surface: 'wood' });
def({ id: B.ASH_LEAVES, name: 'Ashwood Leaves', render: 'cutout', opaque: false, hardness: 0.25, tiles: t3('ash_leaves'), surface: 'plant', drop: [{ id: I.APPLE, count: 1, chance: 0.06 }, { id: I.STICK, count: 1, chance: 0.08 }] });
def({ id: B.PINE_LOG, name: 'Pine Log', hardness: 2, tool: 'axe', tiles: ['pine_log_top', 'pine_log_top', 'pine_log'], surface: 'wood' });
def({ id: B.PINE_LEAVES, name: 'Pine Needles', render: 'cutout', opaque: false, hardness: 0.25, tiles: t3('pine_leaves'), surface: 'plant', drop: [{ id: I.STICK, count: 1, chance: 0.1 }] });
def({ id: B.PLANKS, name: 'Planks', hardness: 1.5, tool: 'axe', tiles: t3('planks'), surface: 'wood' });
def({ id: B.EMBER_ORE, name: 'Ember Ore', hardness: 3, tool: 'pickaxe', minTier: 0, tiles: t3('ember_ore'), drop: [{ id: I.EMBER, count: 1 }] });
def({ id: B.COPPER_ORE, name: 'Copper Ore', hardness: 3, tool: 'pickaxe', minTier: 1, tiles: t3('copper_ore'), drop: [{ id: I.RAW_COPPER, count: 1 }] });
def({ id: B.IRON_ORE, name: 'Iron Ore', hardness: 3.5, tool: 'pickaxe', minTier: 2, tiles: t3('iron_ore'), drop: [{ id: I.RAW_IRON, count: 1 }] });
def({ id: B.LUMEN_ORE, name: 'Lumen Crystal Ore', hardness: 4.5, tool: 'pickaxe', minTier: 3, tiles: t3('lumen_ore'), drop: [{ id: I.LUMEN_SHARD, count: 1 }] });
def({ id: B.COREITE, name: 'Coreite', hardness: Infinity, tiles: t3('coreite'), drop: [] });
def({ id: B.CACTUS, name: 'Cactus', render: 'cutout', opaque: false, hardness: 0.5, tiles: ['cactus_top', 'cactus_top', 'cactus_side'], surface: 'plant' });
def({ id: B.TALL_GRASS, name: 'Tall Grass', render: 'cross', solid: false, opaque: false, hardness: 0.05, tiles: t3('tall_grass'), surface: 'plant', replaceable: true, drop: [{ id: I.BERRIES, count: 1, chance: 0.04 }] });
def({ id: B.FLOWER_RED, name: 'Emberbloom', render: 'cross', solid: false, opaque: false, hardness: 0.05, tiles: t3('flower_red'), surface: 'plant', replaceable: true });
def({ id: B.FLOWER_GOLD, name: 'Sunpetal', render: 'cross', solid: false, opaque: false, hardness: 0.05, tiles: t3('flower_gold'), surface: 'plant', replaceable: true });
def({ id: B.BERRY_BUSH, name: 'Berry Bush', render: 'cross', solid: false, opaque: false, hardness: 0.15, tiles: t3('berry_bush'), surface: 'plant', drop: [{ id: I.BERRIES, count: 2 }] });
def({ id: B.DRY_SHRUB, name: 'Dry Shrub', render: 'cross', solid: false, opaque: false, hardness: 0.05, tiles: t3('dry_shrub'), surface: 'plant', replaceable: true, drop: [{ id: I.STICK, count: 1, chance: 0.5 }] });
def({ id: B.FORGE_BENCH, name: 'Forge Bench', hardness: 1.8, tool: 'axe', tiles: ['bench_top', 'planks', 'bench_side'], surface: 'wood' });
def({ id: B.KILN, name: 'Kiln', hardness: 2.5, tool: 'pickaxe', minTier: 0, tiles: ['kiln_top', 'kiln_top', 'kiln_front'] });
def({ id: B.GLASS, name: 'Glass', render: 'glass', opaque: false, hardness: 0.4, tiles: t3('glass'), surface: 'glass', drop: [] });
def({ id: B.SLATE_BRICKS, name: 'Slate Bricks', hardness: 2.4, tool: 'pickaxe', minTier: 0, tiles: t3('slate_bricks') });
def({ id: B.SNOW_BLOCK, name: 'Snow Block', hardness: 0.4, tool: 'shovel', tiles: t3('snow'), surface: 'snow' });
def({ id: B.FERN, name: 'Frost Fern', render: 'cross', solid: false, opaque: false, hardness: 0.05, tiles: t3('fern'), surface: 'plant', replaceable: true, drop: [] });

def({ id: B.TORCH, name: 'Torch', render: 'shape', solid: false, opaque: false, hardness: 0.05, tiles: ['torch_top', 'torch_top', 'torch'], surface: 'wood', light: 14,
  boxes: [[7 * P, 0, 7 * P, 9 * P, 10 * P, 9 * P]] });
def({ id: B.LUMEN_LAMP, name: 'Lumen Lamp', hardness: 0.6, tiles: t3('lumen_lamp'), surface: 'glass', light: 15 });
def({ id: B.SLAB_PLANKS, name: 'Plank Slab', render: 'shape', opaque: false, hardness: 1.2, tool: 'axe', tiles: t3('planks'), surface: 'wood', boxes: [[0, 0, 0, 1, 0.5, 1]] });
def({ id: B.SLAB_BRICK, name: 'Brick Slab', render: 'shape', opaque: false, hardness: 2, tool: 'pickaxe', minTier: 0, tiles: t3('slate_bricks'), boxes: [[0, 0, 0, 1, 0.5, 1]] });

/** Upper half box of stairs that ascend toward facing f (0 N -z, 1 E +x, 2 S +z, 3 W -x). */
export function stairsUpper(f: number): number[] {
  return [[0, 0.5, 0, 1, 1, 0.5], [0.5, 0.5, 0, 1, 1, 1], [0, 0.5, 0.5, 1, 1, 1], [0, 0.5, 0, 0.5, 1, 1]][f & 3];
}
for (let f = 0; f < 4; f++) {
  const boxes = [[0, 0, 0, 1, 0.5, 1], stairsUpper(f)];
  def({ id: B.STAIRS_PLANKS + f, name: 'Plank Stairs', render: 'shape', opaque: false, hardness: 1.5, tool: 'axe', tiles: t3('planks'), surface: 'wood', boxes, variant: f > 0, drop: [{ id: B.STAIRS_PLANKS, count: 1 }] });
  def({ id: B.STAIRS_BRICK + f, name: 'Brick Stairs', render: 'shape', opaque: false, hardness: 2.2, tool: 'pickaxe', minTier: 0, tiles: t3('slate_bricks'), boxes, variant: f > 0, drop: [{ id: B.STAIRS_BRICK, count: 1 }] });
}

/** Door panel box for panel side s (0 -z, 1 +x, 2 +z, 3 -x). */
function doorPanel(s: number): number[] {
  const t = 3 * P;
  return [[0, 0, 0, 1, 1, t], [1 - t, 0, 0, 1, 1, 1], [0, 0, 1 - t, 1, 1, 1], [0, 0, 0, t, 1, 1]][s & 3];
}
/** Door id from parts. */
export function doorId(upper: boolean, open: boolean, facing: number): number {
  return B.DOOR + (upper ? 8 : 0) + (open ? 4 : 0) + (facing & 3);
}
export function doorParts(id: number): { upper: boolean; open: boolean; facing: number } {
  const k = id - B.DOOR;
  return { upper: k >= 8, open: (k & 4) !== 0, facing: k & 3 };
}
for (let k = 0; k < 16; k++) {
  const upper = k >= 8;
  const open = (k & 4) !== 0;
  const facing = k & 3;
  // An open door swings its panel to the adjacent side.
  const side = open ? (facing + 3) % 4 : facing;
  def({
    id: B.DOOR + k, name: 'Ashwood Door', render: 'shape', opaque: false, hardness: 1.5, tool: 'axe',
    tiles: upper ? ['planks', 'planks', 'door_upper'] : ['planks', 'planks', 'door_lower'], surface: 'wood',
    boxes: [doorPanel(side)], variant: true, drop: upper ? [] : [{ id: I.DOOR_ITEM, count: 1 }],
  });
}
for (let l = 1; l <= 7; l++) {
  def({ id: B.WATER_FLOW + l - 1, name: 'Flowing Water', render: 'water', solid: false, opaque: false, hardness: Infinity, tiles: t3('water'), drop: [], surface: 'water', replaceable: true, variant: true });
}

// ---- Emberdeep ----
def({ id: B.CINDERROCK, name: 'Cinderrock', hardness: 0.9, tool: 'pickaxe', minTier: 0, tiles: t3('cinderrock') });
def({ id: B.ASHEN_SAND, name: 'Ashen Sand', hardness: 0.6, tool: 'shovel', tiles: t3('ashen_sand'), surface: 'sand' });
def({ id: B.GLOWCAP, name: 'Glowcap Cluster', hardness: 0.4, tiles: t3('glowcap'), surface: 'glass', light: 15, drop: [{ id: I.GLOW_DUST, count: 3 }] });
def({ id: B.MAGMA, name: 'Molten Magma', solid: false, hardness: Infinity, tiles: t3('magma'), drop: [], surface: 'water', light: 13, replaceable: true });
def({ id: B.MAGMA_DEEP, name: 'Molten Magma', solid: false, hardness: Infinity, tiles: t3('magma'), drop: [], surface: 'water', variant: true, replaceable: true });
def({ id: B.BASALT, name: 'Scorched Basalt', hardness: 1.4, tool: 'pickaxe', minTier: 0, tiles: ['basalt_top', 'basalt_top', 'basalt_side'] });
def({ id: B.DUSKSTONE, name: 'Duskstone', hardness: 9, tool: 'pickaxe', minTier: 3, tiles: t3('duskstone') });
def({ id: B.RIFT_X, name: 'Rift', render: 'shape', solid: false, opaque: false, hardness: Infinity, tiles: t3('rift'), surface: 'glass', light: 11, drop: [], variant: true,
  boxes: [[0, 0, 6 * P, 1, 1, 10 * P]] });
def({ id: B.RIFT_Z, name: 'Rift', render: 'shape', solid: false, opaque: false, hardness: Infinity, tiles: t3('rift'), surface: 'glass', light: 11, drop: [], variant: true,
  boxes: [[6 * P, 0, 0, 10 * P, 1, 1]] });
def({ id: B.QUARTZ_ORE, name: 'Cinder Quartz Ore', hardness: 1.6, tool: 'pickaxe', minTier: 0, tiles: t3('quartz_ore'), drop: [{ id: I.CINDER_QUARTZ, count: 1 }] });
def({ id: B.EMBER_STALK, name: 'Emberwood Stalk', hardness: 1.8, tool: 'axe', tiles: ['ember_stalk_top', 'ember_stalk_top', 'ember_stalk'], surface: 'wood' });
def({ id: B.EMBER_CAP, name: 'Ember Cap', hardness: 0.8, tool: 'axe', tiles: t3('ember_cap'), surface: 'plant', light: 6 });
def({ id: B.EMBER_SPROUT, name: 'Ember Sprout', render: 'cross', solid: false, opaque: false, hardness: 0.05, tiles: t3('ember_sprout'), surface: 'plant', replaceable: true, light: 4 });
def({ id: B.CINDER_BRICKS, name: 'Cinder Bricks', hardness: 2, tool: 'pickaxe', minTier: 0, tiles: t3('cinder_bricks') });
// ---- Voidreach ----
def({ id: B.VOIDSTONE, name: 'Voidstone', hardness: 2.6, tool: 'pickaxe', minTier: 0, tiles: t3('voidstone') });
def({ id: B.VOID_BRICKS, name: 'Voidstone Bricks', hardness: 2.6, tool: 'pickaxe', minTier: 0, tiles: t3('void_bricks') });
def({ id: B.VOID_STALK, name: 'Voidbloom Stalk', render: 'cutout', opaque: false, hardness: 0.5, tool: 'axe', tiles: ['void_stalk_top', 'void_stalk_top', 'void_stalk'], surface: 'wood' });
def({ id: B.VOID_BLOOM, name: 'Voidbloom', render: 'cutout', opaque: false, hardness: 0.4, tiles: t3('void_bloom'), surface: 'plant', light: 9 });
def({ id: B.VOID_GATE, name: 'Void Gate', hardness: 5, tool: 'pickaxe', minTier: 0, tiles: ['void_gate_top', 'void_gate_top', 'void_gate_side'], surface: 'glass', light: 10 });
def({ id: B.VOID_CRYSTAL, name: 'Void Crystal', render: 'glass', opaque: false, hardness: 0.6, tiles: t3('void_crystal'), surface: 'glass', light: 15, drop: [{ id: I.VOID_PEARL, count: 1 }] });
def({ id: B.PURPUR, name: 'Purpur Block', hardness: 1.8, tool: 'pickaxe', minTier: 0, tiles: t3('purpur') });
def({ id: B.PURPUR_PILLAR, name: 'Purpur Pillar', hardness: 1.8, tool: 'pickaxe', minTier: 0, tiles: ['purpur_pillar_top', 'purpur_pillar_top', 'purpur_pillar'] });
def({ id: B.END_ROD, name: 'Void Rod', render: 'shape', solid: false, opaque: false, hardness: 0.05, tiles: ['end_rod', 'end_rod', 'end_rod'], surface: 'glass', light: 14,
  boxes: [[7 * P, 0, 7 * P, 9 * P, 1, 9 * P], [5 * P, 0, 5 * P, 11 * P, 2 * P, 11 * P]] });
def({ id: B.VOID_EGG, name: 'Void Dragon Egg', render: 'shape', opaque: false, hardness: 3, tiles: t3('void_egg'), light: 3,
  boxes: [[3 * P, 0, 3 * P, 13 * P, 9 * P, 13 * P], [4 * P, 9 * P, 4 * P, 12 * P, 13 * P, 12 * P], [6 * P, 13 * P, 6 * P, 10 * P, 15 * P, 10 * P]] });
def({ id: B.CRIMSON_TURF, name: 'Crimson Turf', hardness: 0.9, tool: 'pickaxe', minTier: 0, tiles: ['crimson_top', 'cinderrock', 'crimson_side'], drop: [{ id: B.CINDERROCK, count: 1 }] });
def({ id: B.EMBER_WART, name: 'Ember Wart Block', hardness: 0.9, tool: 'axe', tiles: t3('ember_wart'), surface: 'plant' });
def({ id: B.BONE_BLOCK, name: 'Bone Block', hardness: 2, tool: 'pickaxe', minTier: 0, tiles: ['bone_top', 'bone_top', 'bone_side'] });

export const BLOCKS: readonly BlockDef[] = defs;
export const BLOCK_COUNT = defs.length;

/** Fast lookup tables used by hot loops (mesher, physics). */
export const SOLID = new Uint8Array(256);
export const OPAQUE = new Uint8Array(256);
/** 0 none, 1 solid, 2 cutout, 3 cross, 4 water, 5 glass, 6 shape */
export const RENDER = new Uint8Array(256);
/** Block light emission 0..15. */
export const EMIT = new Uint8Array(256);
const RENDER_CODES: Record<RenderKind, number> = { none: 0, solid: 1, cutout: 2, cross: 3, water: 4, glass: 5, shape: 6 };
export const FULL_BOX: readonly number[][] = [[0, 0, 0, 1, 1, 1]];
const SELECT_PLANT: readonly number[][] = [[0.15, 0, 0.15, 0.85, 0.8, 0.85]];
/** Collision boxes per id (null = passable). */
export const COLLISION: (readonly number[][] | null)[] = new Array(256).fill(null);
/** Selection/targeting boxes per id (null = not targetable). */
export const SELECTION: (readonly number[][] | null)[] = new Array(256).fill(null);
for (const d of defs) {
  if (!d) continue;
  SOLID[d.id] = d.solid ? 1 : 0;
  OPAQUE[d.id] = d.opaque ? 1 : 0;
  RENDER[d.id] = RENDER_CODES[d.render];
  EMIT[d.id] = d.light ?? 0;
  COLLISION[d.id] = d.solid ? (d.boxes ?? FULL_BOX) : null;
  SELECTION[d.id] = d.render === 'none' || d.render === 'water' ? null : d.render === 'cross' ? SELECT_PLANT : (d.boxes ?? FULL_BOX);
}
EMIT[B.LUMEN_ORE] = 6;
// Rift panels can't be targeted (you aim through them at the frame); they collapse when the frame breaks.
SELECTION[B.RIFT_X] = SELECTION[B.RIFT_Z] = null;

export function isBlockId(id: number): boolean {
  return id > 0 && id < 256 && defs[id] !== undefined;
}

export function blockDef(id: number): BlockDef {
  return defs[id] ?? defs[0];
}
