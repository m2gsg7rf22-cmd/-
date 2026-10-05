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

r('kiln', [B.KILN, 1], [[B.RUBBLE, 8]], 'bench');
r('slate_bricks', [B.SLATE_BRICKS, 4], [[B.RUBBLE, 4]], 'bench');

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

