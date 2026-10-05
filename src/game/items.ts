import { B, I, TIER_NAMES, TOOL_BASE, TOOL_KINDS, type ToolKind, toolId } from '../core/ids';
import { BLOCKS, isBlockId } from '../world/blocks';

export interface ToolInfo {
  kind: ToolKind;
  tier: number;
  speed: number;
  durability: number;
  damage: number;
}

export interface ItemDef {
  id: number;
  name: string;
  maxStack: number;
  /** Hunger restored when eaten. */
  food?: number;
  tool?: ToolInfo;
  /** Placeable block id. */
  block?: number;
  /** Pixel-art color hint for procedural item icons. */
  color?: string;
}

const items = new Map<number, ItemDef>();

for (const b of BLOCKS) {
  if (!b || b.id === B.AIR || b.id === B.WATER) continue;
  items.set(b.id, { id: b.id, name: b.name, maxStack: 64, block: b.id });
}

const simple: [number, string, string, number?][] = [
  [I.STICK, 'Stick', '#9b7448'],
  [I.EMBER, 'Ember', '#3a2a28'],
  [I.COPPER_INGOT, 'Copper Ingot', '#d9824a'],
  [I.IRON_INGOT, 'Iron Ingot', '#d8d4cf'],
  [I.LUMEN_SHARD, 'Lumen Shard', '#7ef0ff'],
  [I.RAW_COPPER, 'Raw Copper', '#b8703f'],
  [I.RAW_IRON, 'Raw Iron', '#c9a48c'],
  [I.BERRIES, 'Berries', '#c82846', 2],
  [I.APPLE, 'Orchard Apple', '#d8452f', 4],
  [I.RAW_MEAT, 'Raw Boar Meat', '#d76f74', 2],
  [I.ROAST_MEAT, 'Roast Meat', '#9a5a32', 8],
  [I.BREAD_LOAF, 'Seed Loaf', '#c8964e', 5],
];
for (const [id, name, color, food] of simple) items.set(id, { id, name, maxStack: 64, color, food });

export const TIER_SPEED = [2, 3.5, 5, 7, 10];
export const TIER_DURABILITY = [60, 130, 220, 400, 1000];
export const TIER_COLORS = ['#a07a4a', '#8a8a92', '#d9824a', '#d8d4cf', '#7ef0ff'];
const KIND_NAMES: Record<ToolKind, string> = { pickaxe: 'Pickaxe', axe: 'Hatchet', shovel: 'Spade', blade: 'Blade' };
const KIND_DAMAGE: Record<ToolKind, number> = { pickaxe: 2, axe: 3, shovel: 1.5, blade: 4 };

for (let tier = 0; tier < TIER_NAMES.length; tier++) {
  for (const kind of TOOL_KINDS) {
    const id = toolId(kind, tier);
    items.set(id, {
      id,
      name: `${TIER_NAMES[tier]} ${KIND_NAMES[kind]}`,
      maxStack: 1,
      color: TIER_COLORS[tier],
      tool: {
        kind,
        tier,
        speed: TIER_SPEED[tier],
        durability: TIER_DURABILITY[tier],
        damage: KIND_DAMAGE[kind] + tier * (kind === 'blade' ? 1.5 : 0.75),
      },
    });
  }
}

export function itemDef(id: number): ItemDef | undefined {
  return items.get(id);
}

export function itemName(id: number): string {
  return items.get(id)?.name ?? `Unknown #${id}`;
}

export function maxStack(id: number): number {
  return items.get(id)?.maxStack ?? 64;
}

export function isTool(id: number): boolean {
  return id >= TOOL_BASE && id < TOOL_BASE + TIER_NAMES.length * 4;
}

export function isPlaceable(id: number): boolean {
  return isBlockId(id) && id !== B.WATER;
}

export function allItemIds(): number[] {
  return [...items.keys()].sort((a, b) => a - b);
}
