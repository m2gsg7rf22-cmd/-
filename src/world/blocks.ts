import { B, I, type ToolKind } from '../core/ids';

export type RenderKind = 'none' | 'solid' | 'cutout' | 'cross' | 'water' | 'glass';
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

export const BLOCKS: readonly BlockDef[] = defs;
export const BLOCK_COUNT = defs.length;

/** Fast lookup tables used by hot loops (mesher, physics). */
export const SOLID = new Uint8Array(256);
export const OPAQUE = new Uint8Array(256);
/** 0 none, 1 solid, 2 cutout, 3 cross, 4 water, 5 glass */
export const RENDER = new Uint8Array(256);
const RENDER_CODES: Record<RenderKind, number> = { none: 0, solid: 1, cutout: 2, cross: 3, water: 4, glass: 5 };
for (const d of defs) {
  if (!d) continue;
  SOLID[d.id] = d.solid ? 1 : 0;
  OPAQUE[d.id] = d.opaque ? 1 : 0;
  RENDER[d.id] = RENDER_CODES[d.render];
}

export function isBlockId(id: number): boolean {
  return id > 0 && id < 256 && defs[id] !== undefined;
}

export function blockDef(id: number): BlockDef {
  return defs[id] ?? defs[0];
}
