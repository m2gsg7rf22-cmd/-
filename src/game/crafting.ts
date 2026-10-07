import { B, I, toolId, type ToolKind } from '../core/ids';
import type { Inventory } from './inventory';

export type Station = 'hand' | 'bench' | 'kiln';

export interface Recipe {
  id: string;
  out: { id: number; count: number };
  ingredients: [number, number][];
  station: Station;
}

export const STATION_LABEL: Record<Station, string> = { hand: 'Hand', bench: 'Forge Bench', kiln: 'Kiln' };

const R: Recipe[] = [];
function r(id: string, out: [number, number], ingredients: [number, number][], station: Station = 'hand'): void {
  R.push({ id, out: { id: out[0], count: out[1] }, ingredients, station });
}

r('planks_ash', [B.PLANKS, 4], [[B.ASH_LOG, 1]]);
r('planks_pine', [B.PLANKS, 4], [[B.PINE_LOG, 1]]);
r('sticks', [I.STICK, 4], [[B.PLANKS, 2]]);
r('bench', [B.FORGE_BENCH, 1], [[B.PLANKS, 4]]);
r('sandstone', [B.SANDSTONE, 1], [[B.SAND, 4]]);
r('snowblock', [B.SNOW_BLOCK, 1], [[B.SNOW_GRASS, 1]]);

r('torch', [B.TORCH, 4], [[I.STICK, 1], [I.EMBER, 1]]);
r('kiln', [B.KILN, 1], [[B.RUBBLE, 8]], 'bench');
r('slab_planks', [B.SLAB_PLANKS, 6], [[B.PLANKS, 3]], 'bench');
r('stairs_planks', [B.STAIRS_PLANKS, 4], [[B.PLANKS, 6]], 'bench');
r('slab_brick', [B.SLAB_BRICK, 6], [[B.SLATE_BRICKS, 3]], 'bench');
r('stairs_brick', [B.STAIRS_BRICK, 4], [[B.SLATE_BRICKS, 6]], 'bench');
r('door', [I.DOOR_ITEM, 1], [[B.PLANKS, 6]], 'bench');
r('lumen_lamp', [B.LUMEN_LAMP, 1], [[B.GLASS, 1], [I.LUMEN_SHARD, 1]], 'bench');
r('slate_bricks', [B.SLATE_BRICKS, 4], [[B.RUBBLE, 4]], 'bench');
// Travel between dimensions.
r('ember_striker', [I.EMBER_STRIKER, 1], [[I.IRON_INGOT, 1], [I.EMBER, 1]]);
r('rift_kit', [I.RIFT_KIT, 1], [[B.DUSKSTONE, 10], [I.EMBER, 2]], 'bench');
r('flint_and_steel', [I.EMBER_STRIKER, 1], [[I.IRON_INGOT, 1], [I.FLINT, 1]]);
r('void_eye', [I.VOID_EYE, 1], [[I.VOID_PEARL, 1], [I.GLOW_DUST, 1]]);
r('void_gate', [B.VOID_GATE, 1], [[I.VOID_PEARL, 4], [B.DUSKSTONE, 4], [I.LUMEN_SHARD, 1]], 'bench');
// Emberdeep and Voidreach materials.
r('glowcap', [B.GLOWCAP, 1], [[I.GLOW_DUST, 4]]);
r('glow_torch', [B.TORCH, 4], [[I.STICK, 1], [I.GLOW_DUST, 1]]);
r('void_bricks', [B.VOID_BRICKS, 4], [[B.VOIDSTONE, 4]], 'bench');
r('bone_block', [B.BONE_BLOCK, 1], [[I.BONE, 4]]);
r('purpur', [B.PURPUR, 4], [[B.VOID_BLOOM, 2]], 'bench');
r('purpur_pillar', [B.PURPUR_PILLAR, 2], [[B.PURPUR, 2]], 'bench');
r('void_rod', [B.END_ROD, 4], [[I.CINDER_QUARTZ, 1], [B.VOID_BLOOM, 1]], 'bench');
r('lumen_lamp_quartz', [B.LUMEN_LAMP, 2], [[B.GLASS, 2], [I.CINDER_QUARTZ, 1], [I.GLOW_DUST, 2]], 'bench');
r('planks_ember', [B.PLANKS, 4], [[B.EMBER_STALK, 1]]);

const materials: [number, number][] = [
  [0, B.PLANKS],
  [1, B.RUBBLE],
  [2, I.COPPER_INGOT],
  [3, I.IRON_INGOT],
  [4, I.LUMEN_SHARD],
];
const toolCost: Record<ToolKind, [number, number]> = {
  pickaxe: [3, 2],
  axe: [3, 2],
  shovel: [1, 2],
  blade: [2, 1],
};
for (const [tier, mat] of materials) {
  for (const kind of Object.keys(toolCost) as ToolKind[]) {
    const [m, s] = toolCost[kind];
    r(`${kind}_${tier}`, [toolId(kind, tier), 1], [[mat, m], [I.STICK, s]], 'bench');
  }
}

r('copper_ingot', [I.COPPER_INGOT, 1], [[I.RAW_COPPER, 1], [I.EMBER, 1]], 'kiln');
r('iron_ingot', [I.IRON_INGOT, 1], [[I.RAW_IRON, 1], [I.EMBER, 1]], 'kiln');
r('glass', [B.GLASS, 4], [[B.SAND, 4], [I.EMBER, 1]], 'kiln');
r('roast_meat', [I.ROAST_MEAT, 2], [[I.RAW_MEAT, 2], [I.EMBER, 1]], 'kiln');
r('seed_loaf', [I.BREAD_LOAF, 1], [[I.BERRIES, 4], [I.EMBER, 1]], 'kiln');
r('stone', [B.STONE, 4], [[B.RUBBLE, 4], [I.EMBER, 1]], 'kiln');
r('cinder_bricks', [B.CINDER_BRICKS, 4], [[B.CINDERROCK, 4], [I.EMBER, 1]], 'kiln');
r('ember_from_gel', [I.EMBER, 3], [[I.MAGMA_GEL, 1]], 'kiln');
r('glass_ash', [B.GLASS, 3], [[B.ASHEN_SAND, 4], [I.MAGMA_GEL, 1]], 'kiln');

export const RECIPES: readonly Recipe[] = R;

export function hasIngredients(inv: Inventory, recipe: Recipe): boolean {
  return recipe.ingredients.every(([id, n]) => inv.count(id) >= n);
}

/** Can this recipe be crafted with the given stations available? */
export function canCraft(inv: Inventory, recipe: Recipe, stations: Set<Station>): boolean {
  if (recipe.station !== 'hand' && !stations.has(recipe.station)) return false;
  return hasIngredients(inv, recipe);
}

/**
 * Craft a recipe: consumes ingredients and adds output.
 * Fails without side effects if ingredients/station are missing or the output wouldn't fit.
 */
export function craft(inv: Inventory, recipe: Recipe, stations: Set<Station>): boolean {
  if (!canCraft(inv, recipe, stations)) return false;
  // Check output space on a simulated copy.
  const snapshot = inv.toJSON();
  for (const [id, n] of recipe.ingredients) inv.remove(id, n);
  const left = inv.add(recipe.out.id, recipe.out.count);
  if (left > 0) {
    // Roll back.
    inv.slots = snapshot.map((s) => (s ? { ...s } : null));
    return false;
  }
  return true;
}

