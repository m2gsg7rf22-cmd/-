/** Block ids (also used as item ids for block items). Must stay < 256 (stored in Uint8Array). */
export const B = {
  AIR: 0,
  GRASS: 1,
  DIRT: 2,
  STONE: 3,
  RUBBLE: 4,
  SAND: 5,
  SANDSTONE: 6,
  GRAVEL: 7,
  SNOW_GRASS: 8,
  ICE: 9,
  WATER: 10,
  ASH_LOG: 11,
  ASH_LEAVES: 12,
  PINE_LOG: 13,
  PINE_LEAVES: 14,
  PLANKS: 15,
  EMBER_ORE: 16,
  COPPER_ORE: 17,
  IRON_ORE: 18,
  LUMEN_ORE: 19,
  COREITE: 20,
  CACTUS: 21,
  TALL_GRASS: 22,
  FLOWER_RED: 23,
  FLOWER_GOLD: 24,
  BERRY_BUSH: 25,
  DRY_SHRUB: 26,
  FORGE_BENCH: 27,
  KILN: 28,
  GLASS: 29,
  SLATE_BRICKS: 30,
  SNOW_BLOCK: 31,
  FERN: 32,
  TORCH: 33,
  SLAB_PLANKS: 34,
  SLAB_BRICK: 35,
  /** Stairs: base id + facing (0 N(-z), 1 E(+x), 2 S(+z), 3 W(-x)) — the direction they ascend toward. */
  STAIRS_PLANKS: 36,
  STAIRS_BRICK: 40,
  /** Doors: DOOR + half*8 + open*4 + facing (half 0 lower, 1 upper). */
  DOOR: 44,
  LUMEN_LAMP: 60,
  /** Flowing water levels 1..7 are WATER_FLOW + level - 1 (source B.WATER = level 8). */
  WATER_FLOW: 61,
  // ---- Emberdeep (the burning underworld) ----
  CINDERROCK: 68,
  ASHEN_SAND: 69,
  GLOWCAP: 70,
  /** Molten magma: the glowing surface layer emits light, deeper magma (MAGMA_DEEP) doesn't (cheaper lighting). */
  MAGMA: 71,
  BASALT: 72,
  DUSKSTONE: 73,
  /** Rift portal panels: RIFT_X spans the x/y plane (thin along z), RIFT_Z spans z/y (thin along x). */
  RIFT_X: 74,
  RIFT_Z: 75,
  QUARTZ_ORE: 76,
  EMBER_STALK: 77,
  EMBER_CAP: 78,
  EMBER_SPROUT: 79,
  // ---- Voidreach (islands in the void) ----
  VOIDSTONE: 80,
  VOID_BRICKS: 81,
  VOID_STALK: 82,
  VOID_BLOOM: 83,
  VOID_GATE: 84,
  VOID_CRYSTAL: 85,
  CINDER_BRICKS: 86,
  BONE_BLOCK: 87,
  MAGMA_DEEP: 88,
  PURPUR: 89,
  PURPUR_PILLAR: 90,
  END_ROD: 91,
  /** Trophy left behind by the defeated Void Dragon. */
  VOID_EGG: 92,
  CRIMSON_TURF: 93,
  EMBER_WART: 94,
} as const;

export type BlockId = number;

/** Non-block item ids. */
export const I = {
  STICK: 256,
  EMBER: 257,
  COPPER_INGOT: 258,
  IRON_INGOT: 259,
  LUMEN_SHARD: 260,
  RAW_COPPER: 261,
  RAW_IRON: 262,
  BERRIES: 263,
  APPLE: 264,
  RAW_MEAT: 265,
  ROAST_MEAT: 266,
  BREAD_LOAF: 267,
  DOOR_ITEM: 268,
  GLOW_DUST: 269,
  CINDER_QUARTZ: 270,
  VOID_PEARL: 271,
  EMBER_STRIKER: 272,
  MAGMA_GEL: 273,
  BONE: 274,
  FEATHER: 275,
} as const;

export const isWaterId = (id: number): boolean => id === 10 || (id >= 61 && id <= 67);
/** Water level 1..8 (8 = source), 0 if not water. */
export const waterLevel = (id: number): number => (id === 10 ? 8 : id >= 61 && id <= 67 ? id - 60 : 0);
export const isDoorId = (id: number): boolean => id >= 44 && id < 60;
export const isStairsId = (id: number): boolean => id >= 36 && id < 44;
export const isMagmaId = (id: number): boolean => id === 71 || id === 88;
export const isRiftId = (id: number): boolean => id === 74 || id === 75;
/** Liquids the player swims/wades in (water and magma). */
export const isLiquidId = (id: number): boolean => isWaterId(id) || isMagmaId(id);

export type ToolKind = 'pickaxe' | 'axe' | 'shovel' | 'blade';
export const TOOL_KINDS: ToolKind[] = ['pickaxe', 'axe', 'shovel', 'blade'];
export const TIER_NAMES = ['Timber', 'Flint', 'Copper', 'Iron', 'Lumen'] as const;
export const TOOL_BASE = 300;

/** Tool item id for a kind/tier combination. */
export function toolId(kind: ToolKind, tier: number): number {
  return TOOL_BASE + tier * 4 + TOOL_KINDS.indexOf(kind);
}
