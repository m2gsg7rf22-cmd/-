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
} as const;

export type ToolKind = 'pickaxe' | 'axe' | 'shovel' | 'blade';
export const TOOL_KINDS: ToolKind[] = ['pickaxe', 'axe', 'shovel', 'blade'];
export const TIER_NAMES = ['Timber', 'Flint', 'Copper', 'Iron', 'Lumen'] as const;
export const TOOL_BASE = 300;

/** Tool item id for a kind/tier combination. */
export function toolId(kind: ToolKind, tier: number): number {
  return TOOL_BASE + tier * 4 + TOOL_KINDS.indexOf(kind);
}
