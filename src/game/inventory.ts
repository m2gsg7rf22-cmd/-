import { isTool, itemDef, maxStack } from './items';

export interface ItemStack {
  id: number;
  count: number;
  /** Remaining durability for tools. */
  dur?: number;
}

export const HOTBAR_SIZE = 9;
export const INVENTORY_SIZE = 36; // 9 hotbar + 27 backpack

export function makeStack(id: number, count = 1): ItemStack {
  const s: ItemStack = { id, count };
  if (isTool(id)) s.dur = itemDef(id)!.tool!.durability;
  return s;
}

function canMerge(a: ItemStack, b: ItemStack): boolean {
  return a.id === b.id && a.dur === undefined && b.dur === undefined;
}

/** Slot-based inventory. Pure logic, no DOM. */
export class Inventory {
  slots: (ItemStack | null)[];

  constructor(size = INVENTORY_SIZE) {
    this.slots = new Array(size).fill(null);
  }

  /** Add items; returns the count that didn't fit. Fills existing stacks first, hotbar first. */
  add(id: number, count = 1, dur?: number): number {
    let left = count;
    const max = maxStack(id);
    if (max > 1 && dur === undefined) {
      for (let i = 0; i < this.slots.length && left > 0; i++) {
        const s = this.slots[i];
        if (s && s.id === id && s.dur === undefined && s.count < max) {
          const n = Math.min(max - s.count, left);
          s.count += n;
          left -= n;
        }
      }
    }
    for (let i = 0; i < this.slots.length && left > 0; i++) {
      if (!this.slots[i]) {
        const n = Math.min(max, left);
        const st = makeStack(id, n);
        if (dur !== undefined) st.dur = dur;
        this.slots[i] = st;
        left -= n;
      }
    }
    return left;
  }

  count(id: number): number {
    let n = 0;
    for (const s of this.slots) if (s && s.id === id) n += s.count;
    return n;
  }

  /** Remove `count` of id from anywhere. Returns false (and changes nothing) if not enough. */
  remove(id: number, count: number): boolean {
    if (this.count(id) < count) return false;
    let left = count;
    // Take from backpack first to keep the hotbar intact.
    for (let pass = 0; pass < 2; pass++) {
      for (let i = this.slots.length - 1; i >= 0 && left > 0; i--) {
        const isHot = i < HOTBAR_SIZE;
        if ((pass === 0 && isHot) || (pass === 1 && !isHot)) continue;
        const s = this.slots[i];
        if (!s || s.id !== id) continue;
        const n = Math.min(s.count, left);
        s.count -= n;
        left -= n;
        if (s.count <= 0) this.slots[i] = null;
      }
    }
    return true;
  }

  /** Remove one item from a specific slot. */
  takeOne(slot: number): ItemStack | null {
    const s = this.slots[slot];
    if (!s) return null;
    s.count--;
    if (s.count <= 0) this.slots[slot] = null;
    return { ...s, count: 1 };
  }

  /** Move/merge/swap from slot a to slot b (the classic click-to-move behavior). */
  move(a: number, b: number): void {
    if (a === b) return;
    const sa = this.slots[a];
    const sb = this.slots[b];
    if (!sa) return;
    if (sb && canMerge(sa, sb)) {
      const max = maxStack(sa.id);
      const n = Math.min(max - sb.count, sa.count);
      sb.count += n;
      sa.count -= n;
      if (sa.count <= 0) this.slots[a] = null;
      return;
    }
    this.slots[a] = sb;
    this.slots[b] = sa;
  }

  /** Split half of slot a into empty slot b. Returns false if not possible. */
  split(a: number, b: number): boolean {
    const sa = this.slots[a];
    if (!sa || sa.count < 2 || this.slots[b]) return false;
    const half = Math.floor(sa.count / 2);
    sa.count -= half;
    this.slots[b] = { id: sa.id, count: half };
    return true;
  }

  firstEmpty(): number {
    return this.slots.findIndex((s) => !s);
  }

  /** Damage the tool in a slot; returns true if it broke. */
  wear(slot: number, amount = 1): boolean {
    const s = this.slots[slot];
    if (!s || s.dur === undefined) return false;
    s.dur -= amount;
    if (s.dur <= 0) {
      this.slots[slot] = null;
      return true;
    }
    return false;
  }

  clear(): void {
    this.slots.fill(null);
  }

  toJSON(): (ItemStack | null)[] {
    return this.slots.map((s) => (s ? { ...s } : null));
  }

  static fromJSON(data: unknown, size = INVENTORY_SIZE): Inventory {
    const inv = new Inventory(size);
    if (!Array.isArray(data)) return inv;
    for (let i = 0; i < Math.min(size, data.length); i++) {
      const s = data[i] as Partial<ItemStack> | null;
      if (s && typeof s.id === 'number' && typeof s.count === 'number' && s.count > 0 && itemDef(s.id)) {
        const st: ItemStack = { id: s.id, count: Math.min(Math.floor(s.count), maxStack(s.id)) };
        if (typeof s.dur === 'number') st.dur = s.dur;
        inv.slots[i] = st;
      }
    }
    return inv;
  }
}
