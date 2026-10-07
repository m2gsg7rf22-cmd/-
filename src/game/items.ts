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
  if (!b || b.id === B.AIR || b.id === B.WATER || b.variant) continue;
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
  [I.RAW_MEAT, 'Raw Meat', '#d76f74', 2],
  [I.ROAST_MEAT, 'Roast Meat', '#9a5a32', 8],
  [I.BREAD_LOAF, 'Seed Loaf', '#c8964e', 5],
  [I.DOOR_ITEM, 'Ashwood Door', '#b8894f'],
  [I.GLOW_DUST, 'Glow Dust', '#ffd36a'],
  [I.CINDER_QUARTZ, 'Cinder Quartz', '#efe7dc'],
  [I.VOID_PEARL, 'Void Pearl', '#7a3fd0'],
  [I.MAGMA_GEL, 'Magma Gel', '#ff8a2a'],
  [I.BONE, 'Bone', '#e2dcc8'],
  [I.FEATHER, 'Feather', '#f4f0e6'],
  [I.FLINT, 'Flint', '#4a4a50'],
  [I.VOID_EYE, 'Void Eye', '#3fb58f'],
];
for (const [id, name, color, food] of simple) items.set(id, { id, name, maxStack: 64, color, food });
items.set(I.EMBER_STRIKER, { id: I.EMBER_STRIKER, name: 'Flint and Steel', maxStack: 1, color: '#c8c4be' });
items.set(I.RIFT_KIT, { id: I.RIFT_KIT, name: 'Rift Portal Kit', maxStack: 16, color: '#9a5cff' });

/** Items for travelling between worlds: listed first in the Block Library and given to new creative worlds. */
export const TRAVEL_ITEMS: readonly number[] = [B.DUSKSTONE, I.EMBER_STRIKER, I.RIFT_KIT, I.VOID_EYE, B.VOID_FRAME, B.VOID_GATE];

/** One-line description of what an item is for (shown with its name). */
export function itemHint(id: number): string {
  switch (id) {
    case I.RIFT_KIT: return 'Place on the ground: builds a lit portal to Emberdeep';
    case B.VOID_GATE: return 'Shortcut: place and use to travel to Voidreach (and back home)';
    case I.EMBER_STRIKER: return 'Use inside an Obsidian frame to open a portal to Emberdeep';
    case B.DUSKSTONE: return 'Portal frame block (needs an Iron Pickaxe to mine)';
    case I.FLINT: return 'Sometimes drops from Gravel; makes Flint and Steel';
    case I.VOID_EYE: return 'Use in the air to find a Void Sanctum; put one in each Void Portal Frame';
    case B.VOID_FRAME: return '12 frames around a 3x3 hole, each with a Void Eye, open the way to Voidreach';
    case B.VOID_EGG: return 'Trophy of the Void Dragon';
    default: return '';
  }
}

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
  return (isBlockId(id) && id !== B.WATER && !BLOCKS[id].variant) || id === I.DOOR_ITEM;
}

export function allItemIds(): number[] {
  return [...items.keys()].sort((a, b) => a - b);
}
