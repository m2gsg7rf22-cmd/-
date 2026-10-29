// Survival / crafting kit: data-driven items, slot inventory (stacking, weight, split/merge,
// durability), equipment, recipe crafting with queue + "why can't I craft this" diagnostics,
// needs (hunger, thirst, body temperature/exposure, fatigue) driven by activity, weather and time
// of day, harvestable resource nodes (trees/rocks/bushes with hit points, yields, tool tiers,
// respawn) scattered over a Heightfield, and grid/snap building placement with a ghost preview,
// validity checks (slope, overlap, support) and simple structural rules.
//
// Every class is logic-first: it runs in Node (unit tests) without a scene, and only builds meshes
// when a THREE scene is passed. All state round-trips through toJSON()/load(); attachSurvivalSave()
// registers everything with core/save.js. See skills/gameforge/references/survival.md.
import * as THREE from '../vendor/three/three.module.js';
import { RNG } from '../core/rng.js';
import { EventBus } from '../core/events.js';
import { scatterPoints } from '../world/vegetation.js';
import { tree as treeProp, rock as rockProp, bush as bushProp } from '../geometry/props.js';
import { solid, emissive } from '../render/materials.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const r2 = (v) => Math.round(v * 100) / 100;

// ---------------------------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------------------------
// def: { name, stack (max per slot), weight (kg per unit), tags [], durability (max uses; implies
//        stack 1), use { hunger, thirst, health, stamina, warmth, fatigue } | fn(ctx),
//        equip: 'tool'|'head'|'body'|'back'|'hand', tool { kind, tier, damage }, insulation (°C),
//        fuel (seconds of campfire burn), place: buildable piece id }
export const DEFAULT_ITEMS = {
  wood: { name: 'Wood', stack: 30, weight: 0.8, tags: ['material', 'fuel'], fuel: 40 },
  stone: { name: 'Stone', stack: 30, weight: 1.2, tags: ['material'] },
  flint: { name: 'Flint', stack: 20, weight: 0.3, tags: ['material'] },
  fiber: { name: 'Plant fiber', stack: 50, weight: 0.05, tags: ['material'] },
  berries: { name: 'Berries', stack: 20, weight: 0.05, tags: ['food'], use: { hunger: 8, thirst: 3 } },
  rawMeat: { name: 'Raw meat', stack: 10, weight: 0.4, tags: ['food', 'raw'], use: { hunger: 10, health: -4 } },
  cookedMeat: { name: 'Cooked meat', stack: 10, weight: 0.35, tags: ['food'], use: { hunger: 35, health: 4 } },
  water: { name: 'Water flask', stack: 5, weight: 0.5, tags: ['drink'], use: { thirst: 35 } },
  bandage: { name: 'Bandage', stack: 10, weight: 0.05, tags: ['medical'], use: { health: 20 } },
  rope: { name: 'Rope', stack: 10, weight: 0.2, tags: ['material'] },
  stoneAxe: { name: 'Stone axe', weight: 1.5, durability: 60, equip: 'tool', tags: ['tool'], tool: { kind: 'axe', tier: 1, damage: 20 } },
  stonePickaxe: { name: 'Stone pickaxe', weight: 1.8, durability: 60, equip: 'tool', tags: ['tool'], tool: { kind: 'pickaxe', tier: 1, damage: 20 } },
  torch: { name: 'Torch', weight: 0.4, durability: 120, equip: 'hand', tags: ['light'], warmth: 2 },
  furCoat: { name: 'Fur coat', weight: 2.5, durability: 400, equip: 'body', insulation: 8, tags: ['clothing'] },
  hat: { name: 'Woven hat', weight: 0.2, durability: 200, equip: 'head', insulation: 1.5, tags: ['clothing'] },
  campfireKit: { name: 'Campfire', stack: 5, weight: 3, place: 'campfire', tags: ['buildable'] },
};

export class ItemRegistry {
  constructor(defs = DEFAULT_ITEMS) { this.defs = {}; for (const [id, d] of Object.entries(defs)) this.define(id, d); }
  define(id, def) {
    const d = { id, name: id, weight: 0, tags: [], ...def };
    d.stack = d.durability ? 1 : Math.max(1, d.stack ?? 1);
    this.defs[id] = d; return d;
  }
  get(id) { const d = this.defs[id]; if (!d) throw new Error('unknown item ' + id); return d; }
  has(id) { return !!this.defs[id]; }
  list(tag) { return Object.values(this.defs).filter((d) => !tag || d.tags.includes(tag)); }
}

// ---------------------------------------------------------------------------------------------
// Inventory: fixed slots of { id, n, dur? }; stacking, weight limit, split/merge/move, durability.
// Emits 'change' { id, count }, 'break' { id, slot }, 'full' { id, leftover }.
// ---------------------------------------------------------------------------------------------
export class Inventory {
  constructor(registry = new ItemRegistry(), { slots = 24, maxWeight = Infinity, events } = {}) {
    this.registry = registry; this.slots = new Array(slots).fill(null); this.maxWeight = maxWeight;
    this.events = events || new EventBus(); this.bus = events ? null : this.events;
  }
  on(t, fn) { return this.events.on(t, fn); }
  _emit(t, p) { this.events.emit('inventory:' + t, p); if (this.bus) this.events.emit(t, p); }
  get weight() { let w = 0; for (const s of this.slots) if (s) w += this.registry.get(s.id).weight * s.n; return r2(w); }
  count(id) { let n = 0; for (const s of this.slots) if (s && s.id === id) n += s.n; return n; }
  has(id, n = 1) { return this.count(id) >= n; }
  hasAll(map) { return Object.entries(map).every(([id, n]) => this.has(id, n)); }
  freeSlots() { return this.slots.filter((s) => !s).length; }
  // How many units of id fit (stack room + empty slots + weight)?
  capacityFor(id) {
    const d = this.registry.get(id); let room = 0;
    for (const s of this.slots) room += !s ? d.stack : s.id === id && !d.durability ? d.stack - s.n : 0;
    if (d.weight > 0 && this.maxWeight < Infinity) room = Math.min(room, Math.floor((this.maxWeight - this.weight + 1e-6) / d.weight));
    return Math.max(0, room);
  }
  // Adds up to n units; returns the leftover that did not fit (0 = all added).
  add(id, n = 1, { dur } = {}) {
    const d = this.registry.get(id);
    let left = Math.min(n, this.capacityFor(id)); const over = n - left;
    if (!d.durability) for (const s of this.slots) { if (!left) break; if (s && s.id === id && s.n < d.stack) { const k = Math.min(left, d.stack - s.n); s.n += k; left -= k; } }
    for (let i = 0; i < this.slots.length && left > 0; i++) if (!this.slots[i]) {
      const k = Math.min(left, d.stack); this.slots[i] = d.durability ? { id, n: 1, dur: dur ?? d.durability } : { id, n: k }; left -= d.durability ? 1 : k;
    }
    this._emit('change', { id, count: this.count(id) });
    if (over > 0) this._emit('full', { id, leftover: over });
    return over + left;
  }
  // All-or-nothing removal (removes from the last slots first so hotbar stacks stay put).
  remove(id, n = 1) {
    if (!this.has(id, n)) return false;
    for (let i = this.slots.length - 1; i >= 0 && n > 0; i--) { const s = this.slots[i]; if (s && s.id === id) { const k = Math.min(n, s.n); s.n -= k; n -= k; if (!s.n) this.slots[i] = null; } }
    this._emit('change', { id, count: this.count(id) }); return true;
  }
  removeAll(map) { if (!this.hasAll(map)) return false; for (const [id, n] of Object.entries(map)) this.remove(id, n); return true; }
  // Split n units off slot i into the first empty slot; returns the new slot index or -1.
  split(i, n) {
    const s = this.slots[i]; if (!s || n <= 0 || n >= s.n) return -1;
    const j = this.slots.indexOf(null); if (j < 0) return -1;
    s.n -= n; this.slots[j] = { id: s.id, n }; this._emit('change', { id: s.id, count: this.count(s.id) }); return j;
  }
  // Move slot a onto b: merges equal stacks (respecting stack size), otherwise swaps.
  move(a, b) {
    if (a === b) return true; const A = this.slots[a], B = this.slots[b]; if (!A) return false;
    const d = this.registry.get(A.id);
    if (B && B.id === A.id && !d.durability) { const k = Math.min(A.n, d.stack - B.n); B.n += k; A.n -= k; if (!A.n) this.slots[a] = null; }
    else { this.slots[a] = B; this.slots[b] = A; }
    this._emit('change', { id: A.id, count: this.count(A.id) }); return true;
  }
  merge(a, b) { return this.move(a, b); }
  // Compact: merge every partial stack of the same item.
  sort() {
    const items = []; for (const s of this.slots) if (s) items.push({ ...s });
    this.slots.fill(null); items.sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
    for (const s of items) { if (s.dur !== undefined) { const i = this.slots.indexOf(null); this.slots[i] = s; } else this._addRaw(s.id, s.n); }
  }
  _addRaw(id, n) { const d = this.registry.get(id); for (const s of this.slots) if (s && s.id === id && s.n < d.stack && n) { const k = Math.min(n, d.stack - s.n); s.n += k; n -= k; } while (n > 0) { const i = this.slots.indexOf(null); if (i < 0) return; const k = Math.min(n, d.stack); this.slots[i] = { id, n: k }; n -= k; } }
  // Durability: wear the stack in slot i; breaks (removed) at 0. Returns remaining durability.
  wear(i, amount = 1) {
    const s = this.slots[i]; if (!s || s.dur === undefined) return null;
    s.dur = Math.max(0, s.dur - amount);
    if (s.dur <= 0) { this.slots[i] = null; this._emit('break', { id: s.id, slot: i }); this._emit('change', { id: s.id, count: this.count(s.id) }); }
    return s.dur;
  }
  // Best tool of a kind (highest tier, then most durability) -> slot index or -1.
  findTool(kind, minTier = 0) {
    let best = -1, bt = -1, bd = -1;
    this.slots.forEach((s, i) => { const t = s && this.registry.get(s.id).tool; if (t && t.kind === kind && t.tier >= minTier && (t.tier > bt || (t.tier === bt && (s.dur ?? 0) > bd))) { best = i; bt = t.tier; bd = s.dur ?? 0; } });
    return best;
  }
  // Use (consume) one unit of slot i: applies def.use to ctx { needs, health, stamina }. Returns the effect or null.
  use(i, ctx = {}) {
    const s = this.slots[i]; if (!s) return null; const d = this.registry.get(s.id);
    if (!d.use) return null;
    const effect = typeof d.use === 'function' ? d.use(ctx) || {} : d.use;
    applyEffect(effect, ctx);
    if (d.consumable !== false) { s.n--; if (!s.n) this.slots[i] = null; this._emit('change', { id: s.id, count: this.count(s.id) }); }
    this._emit('use', { id: s.id, effect }); return effect;
  }
  useItem(id, ctx) { const i = this.slots.findIndex((s) => s && s.id === id); return i < 0 ? null : this.use(i, ctx); }
  list() { return this.slots.map((s, i) => s && { slot: i, ...s, name: this.registry.get(s.id).name }).filter(Boolean); }
  toJSON() { return { slots: this.slots.map((s) => s && { ...s }), maxWeight: this.maxWeight === Infinity ? null : this.maxWeight }; }
  load(d) { this.slots = new Array(Math.max(this.slots.length, d.slots.length)).fill(null); d.slots.forEach((s, i) => (this.slots[i] = s && { ...s })); if (d.maxWeight != null) this.maxWeight = d.maxWeight; this._emit('change', { id: null, count: 0 }); }
}

// Applies { hunger, thirst, health, stamina, warmth, fatigue } deltas to a context.
export function applyEffect(e, { needs, health, stamina } = {}) {
  if (!e) return;
  if (needs) needs.apply(e);
  if (health && e.health) { if (e.health > 0) health.heal(e.health); else health.damage(-e.health, { source: 'item', noStagger: true }); }
  if (stamina && e.stamina) stamina.value = clamp(stamina.value + e.stamina, 0, stamina.max);
}

// ---------------------------------------------------------------------------------------------
// Equipment: named slots holding one stack moved out of the inventory.
// ---------------------------------------------------------------------------------------------
export class Equipment {
  constructor(inventory, { slots = ['tool', 'hand', 'head', 'body', 'back'] } = {}) {
    this.inventory = inventory; this.registry = inventory.registry; this.slots = Object.fromEntries(slots.map((s) => [s, null]));
  }
  // Equip the stack in inventory slot i (swapping out whatever is in the target slot).
  equip(i) {
    const s = this.inventory.slots[i]; if (!s) return false; const d = this.registry.get(s.id);
    if (!d.equip || !(d.equip in this.slots)) return false;
    const prev = this.slots[d.equip]; this.slots[d.equip] = s; this.inventory.slots[i] = prev;
    this.inventory._emit('change', { id: s.id, count: this.inventory.count(s.id) }); this.inventory._emit('equip', { slot: d.equip, id: s.id });
    return true;
  }
  equipItem(id) { const i = this.inventory.slots.findIndex((s) => s && s.id === id); return i >= 0 && this.equip(i); }
  unequip(slot) {
    const s = this.slots[slot]; if (!s) return false; const j = this.inventory.slots.indexOf(null); if (j < 0) return false;
    this.inventory.slots[j] = s; this.slots[slot] = null; this.inventory._emit('equip', { slot, id: null }); return true;
  }
  get(slot) { const s = this.slots[slot]; return s ? { ...s, def: this.registry.get(s.id) } : null; }
  // Equipped tool { kind, tier, damage } (or bare hands).
  tool() { const s = this.slots.tool; const t = s && this.registry.get(s.id).tool; return t ? { ...t, id: s.id } : { kind: 'hand', tier: 0, damage: 6, id: null }; }
  wearTool(amount = 1) {
    const s = this.slots.tool; if (!s || s.dur === undefined) return null;
    s.dur = Math.max(0, s.dur - amount); if (s.dur <= 0) { this.slots.tool = null; this.inventory._emit('break', { id: s.id, slot: 'tool' }); }
    return s.dur;
  }
  insulation() { let t = 0; for (const s of Object.values(this.slots)) if (s) { const d = this.registry.get(s.id); t += (d.insulation || 0) + (d.warmth || 0); } return t; }
  weight() { let w = 0; for (const s of Object.values(this.slots)) if (s) w += this.registry.get(s.id).weight; return w; }
  toJSON() { return { slots: Object.fromEntries(Object.entries(this.slots).map(([k, s]) => [k, s && { ...s }])) }; }
  load(d) { for (const k of Object.keys(this.slots)) this.slots[k] = d.slots[k] ? { ...d.slots[k] } : null; }
}

// ---------------------------------------------------------------------------------------------
// Crafting
// ---------------------------------------------------------------------------------------------
// recipe: { id, name, inputs { item: n }, tools [{ kind, tier }] (held in inventory or equipped,
//           not consumed; each use wears 1 durability), station 'campfire'|'workbench'|null,
//           time (s), outputs { item: n }, category }
export const DEFAULT_RECIPES = [
  { id: 'rope', inputs: { fiber: 6 }, time: 2, outputs: { rope: 1 }, category: 'materials' },
  { id: 'stoneAxe', inputs: { wood: 3, stone: 2, rope: 1 }, time: 4, outputs: { stoneAxe: 1 }, category: 'tools' },
  { id: 'stonePickaxe', inputs: { wood: 3, stone: 3, rope: 1 }, time: 4, outputs: { stonePickaxe: 1 }, category: 'tools' },
  { id: 'campfireKit', inputs: { wood: 5, stone: 4 }, time: 3, outputs: { campfireKit: 1 }, category: 'building' },
  { id: 'torch', inputs: { wood: 1, fiber: 3 }, time: 1.5, outputs: { torch: 1 }, category: 'tools' },
  { id: 'bandage', inputs: { fiber: 4 }, time: 2, outputs: { bandage: 1 }, category: 'medical' },
  { id: 'cookedMeat', inputs: { rawMeat: 1 }, station: 'campfire', time: 6, outputs: { cookedMeat: 1 }, category: 'food' },
  { id: 'boiledWater', inputs: { water: 1 }, station: 'campfire', time: 4, outputs: { water: 1 }, category: 'food' },
  { id: 'hat', inputs: { fiber: 12 }, tools: [{ kind: 'axe', tier: 1 }], time: 5, outputs: { hat: 1 }, category: 'clothing' },
];

export class CraftingSystem {
  constructor(inventory, { recipes = DEFAULT_RECIPES, equipment = null, stations = () => new Set(), events } = {}) {
    this.inventory = inventory; this.registry = inventory.registry; this.equipment = equipment; this.stations = stations;
    this.recipes = {}; for (const r of recipes) this.define(r);
    this.queue = []; this.events = events || inventory.events; this.crafted = 0;
  }
  define(r) {
    const rec = { name: r.id, inputs: {}, tools: [], station: null, time: 1, outputs: {}, category: 'misc', ...r };
    for (const id of [...Object.keys(rec.inputs), ...Object.keys(rec.outputs)]) this.registry.get(id); // validate ids
    this.recipes[rec.id] = rec; return rec;
  }
  _hasTool(t) {
    if (this.inventory.findTool(t.kind, t.tier ?? 0) >= 0) return true;
    const eq = this.equipment?.tool(); return !!eq && eq.kind === t.kind && eq.tier >= (t.tier ?? 0);
  }
  // { ok, missing: [{ type: 'item'|'tool'|'station'|'space'|'unknown', id, need, have }], reason }
  canCraft(id, { count = 1, stations } = {}) {
    const r = this.recipes[id]; if (!r) return { ok: false, missing: [{ type: 'unknown', id }], reason: `unknown recipe "${id}"` };
    const missing = [];
    for (const [it, n] of Object.entries(r.inputs)) { const have = this.inventory.count(it) - this._reserved(it); if (have < n * count) missing.push({ type: 'item', id: it, need: n * count, have: Math.max(0, have) }); }
    for (const t of r.tools) if (!this._hasTool(t)) missing.push({ type: 'tool', id: t.kind, tier: t.tier ?? 0 });
    if (r.station) { const st = stations || this.stations(); if (!st.has(r.station)) missing.push({ type: 'station', id: r.station }); }
    const reason = missing.map((m) => m.type === 'item' ? `need ${m.need - m.have} more ${this.registry.get(m.id).name}` : m.type === 'tool' ? `need a ${m.id} (tier ${m.tier}+)` : m.type === 'station' ? `must be near a ${m.id}` : m.id).join('; ');
    return { ok: missing.length === 0, missing, reason: reason || 'ok' };
  }
  _reserved() { return 0; } // inputs are consumed when a job is queued, so nothing is reserved
  // Queue a craft: consumes inputs now (refunded on cancel), outputs arrive after recipe.time.
  craft(id, { count = 1, stations, instant = false } = {}) {
    const chk = this.canCraft(id, { count, stations }); if (!chk.ok) { this.events.emit('craft:fail', { id, ...chk }); return chk; }
    const r = this.recipes[id];
    for (const [it, n] of Object.entries(r.inputs)) this.inventory.remove(it, n * count);
    for (const t of r.tools) { const i = this.inventory.findTool(t.kind, t.tier ?? 0); if (i >= 0) this.inventory.wear(i, 1); else this.equipment?.wearTool(1); }
    for (let k = 0; k < count; k++) this.queue.push({ id, remaining: r.time, total: r.time });
    this.events.emit('craft:start', { id, count });
    if (instant) this.update(r.time * count + 1e-6);
    return { ok: true, missing: [], reason: 'queued', queued: this.queue.length };
  }
  cancel(index = this.queue.length - 1) {
    const job = this.queue[index]; if (!job) return false; this.queue.splice(index, 1);
    for (const [it, n] of Object.entries(this.recipes[job.id].inputs)) this.inventory.add(it, n);
    this.events.emit('craft:cancel', { id: job.id }); return true;
  }
  // Jobs run one at a time (head of the queue). Outputs that do not fit emit 'craft:overflow'.
  update(dt) {
    while (dt > 0 && this.queue.length) {
      const job = this.queue[0], k = Math.min(dt, job.remaining); job.remaining -= k; dt -= k;
      if (job.remaining > 1e-9) break;
      this.queue.shift(); this.crafted++;
      const out = this.recipes[job.id].outputs, overflow = {};
      for (const [it, n] of Object.entries(out)) { const left = this.inventory.add(it, n); if (left) overflow[it] = left; }
      this.events.emit('craft:complete', { id: job.id, outputs: out });
      if (Object.keys(overflow).length) this.events.emit('craft:overflow', { id: job.id, items: overflow });
    }
  }
  get progress() { const j = this.queue[0]; return j ? 1 - j.remaining / j.total : 0; }
  available(opts) { return Object.values(this.recipes).map((r) => ({ id: r.id, name: r.name, category: r.category, ...this.canCraft(r.id, opts) })); }
  toJSON() { return { queue: this.queue.map((j) => ({ ...j })), crafted: this.crafted }; }
  load(d) { this.queue = (d.queue || []).map((j) => ({ ...j })); this.crafted = d.crafted || 0; }
}

// ---------------------------------------------------------------------------------------------
// Needs: hunger/thirst (100 = sated), fatigue (0 = rested), body temperature (°C) + wetness.
// Rates are per in-game hour; hoursPerSecond converts simulation seconds to game hours.
// ---------------------------------------------------------------------------------------------
export const ACTIVITY = {
  //            hunger thirst fatigue (multipliers of the base rates)
  idle: [1, 1, 1], walk: [1.3, 1.4, 1.3], sprint: [2.4, 3, 3], work: [2, 2.2, 2.2], swim: [2.5, 1.5, 3], sleep: [0.5, 0.6, -3],
};
export const NEEDS_DEFAULTS = {
  hoursPerSecond: 24 / 1200,      // a 20-minute day
  hungerRate: 4, thirstRate: 6, fatigueRate: 5,  // per game hour at idle
  starveDamage: 6, dehydrateDamage: 10, coldDamage: 8, heatDamage: 6, // health per game hour
  wellFedRegen: 2,
  comfort: 21,                    // feels-like °C at which body temperature rests at 37
  tempResponse: 0.8,              // 1/hours: how fast body temperature approaches its target
};

export class Needs {
  constructor({ health = null, stamina = null, events, ...opts } = {}) {
    this.o = { ...NEEDS_DEFAULTS, ...opts };
    this.health = health; this.stamina = stamina; this.events = events || new EventBus();
    this.hunger = 100; this.thirst = 100; this.fatigue = 0; this.bodyTemp = 37; this.wetness = 0;
    this.feelsLike = 20; this.activity = 'idle'; this.statuses = new Set(); this.hours = 0;
  }
  on(t, fn) { return this.events.on(t, fn); }
  // ctx: { activity, ambient °C, wind m/s, rain 0..1, shelter bool, heat 0..1 (fire), insulation °C, sleeping, swimming }
  update(dt, ctx = {}) {
    const o = this.o, h = dt * o.hoursPerSecond; this.hours += h;
    const act = ctx.sleeping ? 'sleep' : ctx.swimming ? 'swim' : ctx.activity || 'idle'; this.activity = act;
    const m = ACTIVITY[act] || ACTIVITY.idle;
    const shelter = ctx.shelter ? 1 : 0, rain = (ctx.rain ?? 0) * (1 - shelter);
    // wetness: rain/swimming soak you, warmth (fire, sun) dries you
    const dry = 0.6 + (ctx.heat ?? 0) * 3 + Math.max(0, (ctx.ambient ?? 15) - 15) * 0.05;
    this.wetness = clamp(this.wetness + (rain * 2.5 + (ctx.swimming ? 6 : 0)) * h - dry * h * (rain > 0.05 ? 0 : 1), 0, 1);
    // feels-like temperature: ambient - wind chill - wet chill + insulation + fire + shelter
    const wind = (ctx.wind ?? 0) * (1 - shelter * 0.8);
    this.feelsLike = (ctx.ambient ?? 15) - Math.sqrt(Math.max(0, wind)) * 1.6 - this.wetness * 7 + (ctx.insulation ?? 0) + (ctx.heat ?? 0) * 18 + shelter * 3 + (act === 'sprint' || act === 'work' ? 3 : 0);
    const target = 37 + clamp((this.feelsLike - o.comfort) * 0.12, -7, 4);
    this.bodyTemp += (target - this.bodyTemp) * (1 - Math.exp(-o.tempResponse * h));
    const hotThirst = Math.max(0, this.bodyTemp - 37.4) * 1.5;
    this.hunger = clamp(this.hunger - o.hungerRate * m[0] * h * (this.bodyTemp < 36 ? 1.3 : 1), 0, 100);
    this.thirst = clamp(this.thirst - o.thirstRate * (m[1] + hotThirst) * h, 0, 100);
    this.fatigue = clamp(this.fatigue + o.fatigueRate * m[2] * h, 0, 100);
    // effects on health / stamina
    let dmg = 0;
    if (this.hunger <= 0) dmg += o.starveDamage * h;
    if (this.thirst <= 0) dmg += o.dehydrateDamage * h;
    if (this.bodyTemp < 35) dmg += o.coldDamage * (35 - this.bodyTemp) * h;
    if (this.bodyTemp > 39) dmg += o.heatDamage * (this.bodyTemp - 39) * h;
    this.damageRate = dt > 0 ? dmg / dt : 0;
    if (this.health) {
      if (dmg > 0) { this.health.value = Math.max(0, this.health.value - dmg); if (this.health.value <= 0 && !this.health.dead) { this.health.dead = true; this.health.onDeath?.({ source: 'needs' }); this.events.emit('needs:death', { cause: this.worst() }); } }
      else if (this.hunger > 80 && this.thirst > 80 && this.fatigue < 60) this.health.heal(o.wellFedRegen * h);
    }
    if (this.stamina) { this.stamina.max = this.staminaMax(100); this.stamina.value = Math.min(this.stamina.value, this.stamina.max); }
    this._statuses();
  }
  // Fatigue, hunger and cold shrink maximum stamina; speed scales gently.
  staminaMax(base = 100) { return base * clamp(1 - Math.max(0, this.fatigue - 60) / 80 - (this.hunger < 15 ? 0.2 : 0) - (this.bodyTemp < 35.5 ? 0.15 : 0), 0.3, 1); }
  get speedScale() { return clamp(1 - Math.max(0, this.fatigue - 75) / 100 - (this.bodyTemp < 34.5 ? 0.15 : 0), 0.6, 1); }
  apply(e) {
    if (e.hunger) this.hunger = clamp(this.hunger + e.hunger, 0, 100);
    if (e.thirst) this.thirst = clamp(this.thirst + e.thirst, 0, 100);
    if (e.fatigue) this.fatigue = clamp(this.fatigue + e.fatigue, 0, 100);
    if (e.warmth) this.bodyTemp = clamp(this.bodyTemp + e.warmth, 30, 42);
    this._statuses();
  }
  status() {
    const s = [];
    if (this.hunger <= 0) s.push('starving'); else if (this.hunger < 25) s.push('hungry');
    if (this.thirst <= 0) s.push('dehydrated'); else if (this.thirst < 25) s.push('thirsty');
    if (this.bodyTemp < 34) s.push('freezing'); else if (this.bodyTemp < 35.6) s.push('cold');
    if (this.bodyTemp > 39) s.push('overheating'); else if (this.bodyTemp > 38.2) s.push('hot');
    if (this.fatigue > 90) s.push('exhausted'); else if (this.fatigue > 70) s.push('tired');
    if (this.wetness > 0.4) s.push('wet');
    return s;
  }
  worst() { return this.status()[0] || null; }
  _statuses() {
    const now = new Set(this.status());
    for (const s of now) if (!this.statuses.has(s)) this.events.emit('needs:status', { status: s, on: true });
    for (const s of this.statuses) if (!now.has(s)) this.events.emit('needs:status', { status: s, on: false });
    this.statuses = now;
  }
  debug() { return { hunger: r2(this.hunger), thirst: r2(this.thirst), fatigue: r2(this.fatigue), bodyTemp: r2(this.bodyTemp), feelsLike: r2(this.feelsLike), wetness: r2(this.wetness), activity: this.activity, status: this.status() }; }
  toJSON() { return { hunger: this.hunger, thirst: this.thirst, fatigue: this.fatigue, bodyTemp: this.bodyTemp, wetness: this.wetness, hours: this.hours }; }
  load(d) { Object.assign(this, { hunger: d.hunger, thirst: d.thirst, fatigue: d.fatigue, bodyTemp: d.bodyTemp, wetness: d.wetness ?? 0, hours: d.hours ?? 0 }); this._statuses(); }
}

// HUD hook: bars for hunger/thirst/warmth/energy on an engine UI. Returns { update() }.
export function needsHUD(ui, needs, { corner = 'bl' } = {}) {
  const bars = {
    hunger: ui.bar('hunger', { label: 'Food', color: '#d9a441', corner }),
    thirst: ui.bar('thirst', { label: 'Water', color: '#4aa8e8', corner }),
    warmth: ui.bar('warmth', { label: 'Warmth', color: '#e8644a', corner }),
    energy: ui.bar('energy', { label: 'Energy', color: '#9be86a', corner }),
  };
  return {
    bars,
    update() {
      bars.hunger.set(needs.hunger / 100); bars.thirst.set(needs.thirst / 100);
      bars.warmth.set(clamp((needs.bodyTemp - 33) / 5, 0, 1), needs.bodyTemp.toFixed(1) + '°');
      bars.energy.set(1 - needs.fatigue / 100);
    },
  };
}

// Hotbar HUD: first n inventory slots as a row of tiles (name + count/durability) bottom centre.
export function inventoryHUD(ui, inventory, { slots = 8, equipment = null } = {}) {
  const d = document.createElement('div'); d.className = 'gf-hotbar';
  d.style.cssText = 'position:absolute;left:50%;bottom:14px;transform:translateX(-50%);display:flex;gap:4px;pointer-events:none;font:600 11px/1.15 system-ui,sans-serif;color:#eef';
  ui.root.appendChild(d);
  const tiles = Array.from({ length: slots }, () => { const t = document.createElement('div'); t.style.cssText = 'width:62px;height:44px;border-radius:6px;background:rgba(10,14,22,.62);border:1px solid rgba(255,255,255,.18);padding:3px 4px;box-sizing:border-box;overflow:hidden'; d.appendChild(t); return t; });
  let last = '';
  const w = {
    el: d,
    update() {
      const tool = equipment?.slots.tool;
      const key = JSON.stringify(inventory.slots.slice(0, slots)) + (tool ? tool.id + tool.dur : '');
      if (key === last) return; last = key;
      tiles.forEach((t, i) => {
        const s = inventory.slots[i]; if (!s) { t.innerHTML = ''; return; }
        const def = inventory.registry.get(s.id);
        t.innerHTML = `<div style="opacity:.92">${def.name}</div><div style="color:#ffd27a;font-size:12px">${s.dur !== undefined ? Math.round((100 * s.dur) / def.durability) + '%' : '×' + s.n}</div>`;
      });
      if (tool) tiles[0].parentElement.title = tool.id;
    },
  };
  inventory.on?.('inventory:change', () => w.update()); w.update();
  return w;
}

// ---------------------------------------------------------------------------------------------
// Resource nodes
// ---------------------------------------------------------------------------------------------
// type: { hp, tool (kind or null = any), minTier, yields [{ id, n: [min,max] }] (total per node,
//         paid out proportionally to damage), bonus [{ id, n, chance }] on depletion, respawn (s),
//         radius, height, handFactor (damage multiplier with the wrong tool/bare hands; 0 = impossible),
//         build: (node) => Object3D }
export const RESOURCE_TYPES = {
  tree: { hp: 100, tool: 'axe', minTier: 0, yields: [{ id: 'wood', n: [5, 7] }], bonus: [{ id: 'fiber', n: 2, chance: 0.5 }], respawn: 600, radius: 0.45, height: 6, handFactor: 0.5 },
  rock: { hp: 90, tool: 'pickaxe', minTier: 0, yields: [{ id: 'stone', n: [4, 6] }], bonus: [{ id: 'flint', n: 1, chance: 0.6 }], respawn: 900, radius: 0.9, height: 1.2, handFactor: 0.5 },
  bush: { hp: 12, tool: null, minTier: 0, yields: [{ id: 'fiber', n: [3, 5] }, { id: 'berries', n: [2, 4] }], respawn: 300, radius: 0.6, height: 1, handFactor: 1 },
  ore: { hp: 200, tool: 'pickaxe', minTier: 1, yields: [{ id: 'stone', n: [3, 4] }], respawn: 1500, radius: 0.8, height: 1, handFactor: 0 },
};

export class ResourceNodes {
  constructor({ scene = null, physics = null, types = RESOURCE_TYPES, seed = 1, events } = {}) {
    this.scene = scene; this.physics = physics; this.types = { ...types }; this.rng = new RNG(seed);
    this.nodes = []; this.nextId = 1; this.events = events || new EventBus(); this.time = 0;
    this.group = scene ? new THREE.Group() : null; if (this.group) { this.group.name = 'resource-nodes'; scene.add(this.group); }
    this._protos = {};
  }
  on(t, fn) { return this.events.on(t, fn); }
  add(type, pos, { scale = 1, ry = 0 } = {}) {
    const T = this.types[type]; if (!T) throw new Error('unknown resource type ' + type);
    const node = { id: this.nextId++, type, position: new THREE.Vector3(pos.x, pos.y ?? 0, pos.z), scale, ry, hp: T.hp * scale, max: T.hp * scale, alive: true, respawnAt: 0, paid: {}, totals: {}, shake: 0 };
    this._rollTotals(node); this.nodes.push(node); this._visual(node); this._collider(node, true); return node;
  }
  _rollTotals(node) { const T = this.types[node.type]; node.paid = {}; node.totals = {}; for (const y of T.yields) node.totals[y.id] = Math.max(1, Math.round(this.rng.int(y.n[0], y.n[1]) * Math.max(0.6, node.scale))); }
  // Scatter count nodes of a type over a Heightfield with scatterPoints rules (maxSlope, exclude, ...).
  scatter(hf, type, rules = {}, rng = this.rng) {
    const pts = scatterPoints(hf, { maxSlope: 0.3, scale: [0.85, 1.2], ...rules }, rng instanceof RNG ? rng : new RNG(rng));
    return pts.map((p) => this.add(type, { x: p.x, y: p.y, z: p.z }, { scale: p.s, ry: p.ry }));
  }
  // Damage a node with a tool { kind, tier, damage }. Returns { ok, damage, yields, depleted, reason }.
  hit(node, tool = { kind: 'hand', tier: 0, damage: 6 }, { inventory = null } = {}) {
    if (!node || !node.alive) return { ok: false, reason: 'depleted', damage: 0, yields: [] };
    const T = this.types[node.type];
    const right = !T.tool || tool.kind === T.tool;
    if (right && (tool.tier ?? 0) < T.minTier) return { ok: false, reason: `needs a tier ${T.minTier} ${T.tool}`, damage: 0, yields: [] };
    const factor = right ? 1 + 0.25 * Math.max(0, (tool.tier ?? 0) - T.minTier) : T.handFactor;
    if (factor <= 0) return { ok: false, reason: `needs a ${T.tool}`, damage: 0, yields: [] };
    const dmg = (tool.damage ?? 6) * factor; node.hp = Math.max(0, node.hp - dmg); node.shake = 0.35;
    const frac = 1 - node.hp / node.max, yields = [];
    for (const [id, total] of Object.entries(node.totals)) { const due = Math.floor(total * frac + 1e-9) - (node.paid[id] || 0); if (due > 0) { node.paid[id] = (node.paid[id] || 0) + due; yields.push({ id, n: due }); } }
    let depleted = false;
    if (node.hp <= 0) {
      depleted = true; node.alive = false; node.respawnAt = this.time + T.respawn;
      for (const b of T.bonus || []) if (this.rng.chance(b.chance ?? 1)) yields.push({ id: b.id, n: b.n });
      this._collider(node, false); if (node.mesh) node.mesh.visible = false; if (node.stump) node.stump.visible = true;
      this.events.emit('resource:depleted', { node });
    }
    const leftovers = [];
    if (inventory) for (const y of yields) { const l = inventory.add(y.id, y.n); if (l) leftovers.push({ id: y.id, n: l }); }
    this.events.emit('resource:hit', { node, damage: dmg, yields });
    return { ok: true, damage: dmg, yields, depleted, leftovers, right };
  }
  // Harvest with whatever the player holds: equipped tool, else best matching tool in the inventory.
  harvest(node, { inventory, equipment } = {}) {
    const T = node && this.types[node.type]; if (!T) return { ok: false, reason: 'nothing to harvest', yields: [] };
    let tool = equipment ? equipment.tool() : { kind: 'hand', tier: 0, damage: 6 }, slot = -1;
    if (T.tool && tool.kind !== T.tool && inventory) { slot = inventory.findTool(T.tool, T.minTier); if (slot >= 0) tool = { ...inventory.registry.get(inventory.slots[slot].id).tool }; }
    const r = this.hit(node, tool, { inventory });
    if (r.ok && r.right && tool.kind !== 'hand') { if (slot >= 0) inventory.wear(slot, 1); else equipment?.wearTool(1); }
    return r;
  }
  // Ray vs node cylinders. Returns { node, distance, point } or null.
  raycast(origin, dir, maxDist = 4) {
    let best = null;
    for (const n of this.nodes) {
      if (!n.alive) continue; const T = this.types[n.type], r = T.radius * n.scale + 0.15, h = T.height * n.scale;
      const ox = origin.x - n.position.x, oz = origin.z - n.position.z, a = dir.x * dir.x + dir.z * dir.z;
      let t;
      if (a < 1e-8) { if (ox * ox + oz * oz > r * r) continue; t = 0; }
      else { const b = 2 * (ox * dir.x + oz * dir.z), c = ox * ox + oz * oz - r * r, disc = b * b - 4 * a * c; if (disc < 0) continue; t = (-b - Math.sqrt(disc)) / (2 * a); if (t < 0) t = c < 0 ? 0 : (-b + Math.sqrt(disc)) / (2 * a); }
      if (t < 0 || t > maxDist) continue; const y = origin.y + dir.y * t;
      if (y < n.position.y - 0.3 || y > n.position.y + h) continue;
      if (!best || t < best.distance) best = { node: n, distance: t, point: origin.clone().addScaledVector(dir, t) };
    }
    return best;
  }
  // Nearest live node in front of an actor (interaction-style targeting).
  inFront(pos, facing, { range = 2.2, arc = Math.PI * 0.7, type } = {}) {
    let best = null, bd = Infinity;
    for (const n of this.nodes) {
      if (!n.alive || (type && n.type !== type)) continue;
      const dx = n.position.x - pos.x, dz = n.position.z - pos.z, d = Math.hypot(dx, dz) - this.types[n.type].radius * n.scale;
      if (d > range) continue; let ang = Math.atan2(dx, dz) - facing; ang = Math.atan2(Math.sin(ang), Math.cos(ang));
      if (Math.abs(ang) > arc / 2 && d > 0.6) continue; if (d < bd) { bd = d; best = n; }
    }
    return best;
  }
  nearest(pos, { type, maxDist = Infinity, alive = true } = {}) { let best = null, bd = maxDist; for (const n of this.nodes) { if ((alive && !n.alive) || (type && n.type !== type)) continue; const d = Math.hypot(n.position.x - pos.x, n.position.z - pos.z); if (d < bd) { bd = d; best = n; } } return best; }
  update(dt) {
    this.time += dt;
    for (const n of this.nodes) {
      if (!n.alive && this.time >= n.respawnAt) this._respawn(n);
      if (n.mesh && n.shake > 0) { n.shake = Math.max(0, n.shake - dt); const k = n.shake / 0.35; n.mesh.rotation.z = Math.sin(n.shake * 60) * 0.05 * k; n.mesh.rotation.x = Math.cos(n.shake * 47) * 0.03 * k; }
    }
  }
  _respawn(n) { n.alive = true; n.hp = n.max; this._rollTotals(n); this._collider(n, true); if (n.mesh) { n.mesh.visible = true; n.mesh.rotation.set(0, n.ry, 0); } if (n.stump) n.stump.visible = false; this.events.emit('resource:respawn', { node: n }); }
  _collider(n, on) {
    if (!this.physics) return; const T = this.types[n.type];
    if (on && !n.collider && n.type !== 'bush') n.collider = this.physics.addStatic({ type: 'cylinder', x: n.position.x, y: n.position.y - 0.2, z: n.position.z, r: T.radius * n.scale, h: T.height * n.scale }, { resourceNode: n.id });
    if (!on && n.collider) { this.physics.removeStatic(n.collider); n.collider = null; }
  }
  _visual(n) {
    if (!this.group) return; const T = this.types[n.type];
    let mesh;
    if (T.build) mesh = T.build(n);
    else {
      const key = n.type + ':' + (n.id % 3);
      if (!this._protos[key]) this._protos[key] = n.type === 'tree' ? treeProp({ species: n.id % 2 ? 'pine' : 'oak', seed: 3 + (n.id % 3) }) : n.type === 'bush' ? bushProp({ seed: n.id % 3 + 1 }) : rockProp({ seed: 11 + (n.id % 3), size: 1, color: n.type === 'ore' ? 0x7a5a48 : undefined });
      mesh = this._protos[key].clone();
    }
    mesh.position.copy(n.position); mesh.position.y -= n.type === 'rock' ? 0.25 : 0.1; mesh.scale.setScalar(n.scale); mesh.rotation.y = n.ry; mesh.userData.resourceNode = n.id;
    this.group.add(mesh); n.mesh = mesh;
    if (n.type === 'tree') {
      const s = new THREE.Mesh(new THREE.CylinderGeometry(0.22 * n.scale, 0.3 * n.scale, 0.45, 9), solid(0x6b4a2e, { roughness: 0.9 }));
      s.position.copy(n.position).setY(n.position.y + 0.12); s.visible = false; s.castShadow = true; this.group.add(s); n.stump = s;
    }
  }
  debug() { const by = {}; for (const n of this.nodes) { by[n.type] = by[n.type] || { alive: 0, total: 0 }; by[n.type].total++; if (n.alive) by[n.type].alive++; } return by; }
  toJSON() { return { time: this.time, rng: this.rng.state, nodes: this.nodes.map((n) => ({ id: n.id, hp: n.hp, alive: n.alive, respawnIn: n.alive ? 0 : n.respawnAt - this.time, paid: n.paid, totals: n.totals })) }; }
  load(d) {
    this.time = d.time ?? 0; if (d.rng) this.rng.state = d.rng;
    const byId = new Map(d.nodes.map((x) => [x.id, x]));
    for (const n of this.nodes) {
      const s = byId.get(n.id); if (!s) continue;
      Object.assign(n, { hp: s.hp, paid: { ...s.paid }, totals: { ...s.totals } });
      if (s.alive && !n.alive) { n.alive = true; this._collider(n, true); if (n.mesh) n.mesh.visible = true; if (n.stump) n.stump.visible = false; }
      if (!s.alive) { n.alive = false; n.respawnAt = this.time + s.respawnIn; this._collider(n, false); if (n.mesh) n.mesh.visible = false; if (n.stump) n.stump.visible = true; }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Building placement
// ---------------------------------------------------------------------------------------------
// piece: { size [w,h,d], snap 'grid'|'edge'|'top'|'free', cost { item: n }, maxSlope (height
//          difference across the footprint, m), station (crafting station id), heat (0..1),
//          requires (structural rule), shelter (counts toward shelter), item (inventory kit that
//          is consumed instead of cost) }
export const BUILD_PIECES = {
  foundation: { size: [3, 0.4, 3], snap: 'grid', cost: { wood: 6, stone: 2 }, maxStep: 0.9, label: 'Foundation' },
  wall: { size: [3, 2.6, 0.2], snap: 'edge', cost: { wood: 4 }, requires: 'foundation', label: 'Wall' },
  doorway: { size: [3, 2.6, 0.2], snap: 'edge', cost: { wood: 3 }, requires: 'foundation', door: true, label: 'Doorway' },
  roof: { size: [3.3, 0.2, 3.3], snap: 'top', cost: { wood: 5, fiber: 6 }, requires: 'walls2', label: 'Roof' },
  campfire: { size: [1.1, 0.5, 1.1], snap: 'free', cost: { wood: 5, stone: 4 }, item: 'campfireKit', maxStep: 0.35, station: 'campfire', heat: 1, heatRadius: 5, fuel: 240, label: 'Campfire' },
  storage: { size: [1.2, 0.8, 0.7], snap: 'free', cost: { wood: 8 }, maxStep: 0.3, station: 'storage', slots: 16, label: 'Storage box' },
  workbench: { size: [1.6, 0.9, 0.8], snap: 'free', cost: { wood: 10, stone: 2 }, maxStep: 0.3, station: 'workbench', label: 'Workbench' },
};

const EDGES = [[0, -1, 0], [1, 0, Math.PI / 2], [0, 1, Math.PI], [-1, 0, -Math.PI / 2]]; // dx, dz, wall yaw

export class BuildPlacement {
  // ground: Heightfield (heightAt) or (x, z) => y. blockers: () => [{ x, z, r }] (resource nodes, props).
  constructor({ scene = null, physics = null, ground = null, pieces = BUILD_PIECES, grid = 3, blockers = null, events, materials = {} } = {}) {
    this.scene = scene; this.physics = physics; this.grid = grid; this.blockers = blockers;
    this.ground = typeof ground === 'function' ? ground : ground?.heightAt ? (x, z) => ground.heightAt(x, z) : () => 0;
    this.pieces = { ...pieces }; this.placed = []; this.nextId = 1; this.events = events || new EventBus();
    this.group = scene ? new THREE.Group() : null; if (this.group) { this.group.name = 'buildings'; scene.add(this.group); }
    this.materials = materials; this.ghost = null; this.ghostType = null; this.last = null; this.time = 0;
    this.ghostOk = new THREE.MeshStandardMaterial({ color: 0x5dff8a, emissive: 0x2aff6a, emissiveIntensity: 0.55, transparent: true, opacity: 0.42, depthWrite: false, roughness: 0.6 });
    this.ghostBad = new THREE.MeshStandardMaterial({ color: 0xff5a4a, emissive: 0xff2a1a, emissiveIntensity: 0.55, transparent: true, opacity: 0.42, depthWrite: false, roughness: 0.6 });
  }
  on(t, fn) { return this.events.on(t, fn); }
  _foot(type, x, z, rot) { const P = this.pieces[type]; const c = Math.abs(Math.cos(rot)), s = Math.abs(Math.sin(rot)); return { hx: (P.size[0] * c + P.size[2] * s) / 2, hz: (P.size[0] * s + P.size[2] * c) / 2, x, z }; }
  _foundationAt(x, z) { return this.placed.find((p) => p.type === 'foundation' && Math.abs(p.x - x) < this.grid / 2 && Math.abs(p.z - z) < this.grid / 2) || null; }
  _nearestFoundation(x, z, maxD = this.grid * 0.9) { let best = null, bd = maxD; for (const p of this.placed) if (p.type === 'foundation') { const d = Math.hypot(p.x - x, p.z - z); if (d < bd) { bd = d; best = p; } } return best; }
  wallsOn(f) { return this.placed.filter((p) => p.support === f.id && (p.type === 'wall' || p.type === 'doorway')); }
  // Resolve a requested point into a snapped, validated placement. Returns
  // { type, x, y, z, rot, valid, reason, support, edge }.
  resolve(type, point, rot = 0) {
    const P = this.pieces[type]; if (!P) return { type, valid: false, reason: 'unknown piece' };
    const g = this.grid; let x = point.x, z = point.z, y, support = null, edge = null, reason = null;
    if (P.snap === 'grid') {
      x = Math.round(x / g) * g + 0; z = Math.round(z / g) * g + 0; rot = 0;
      const hs = [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0]].map(([a, b]) => this.ground(x + a * P.size[0] / 2, z + b * P.size[2] / 2));
      const lo = Math.min(...hs), hi = Math.max(...hs);
      if (hi - lo > (P.maxStep ?? 0.9)) reason = `ground too steep (${(hi - lo).toFixed(2)} m step)`;
      y = hi + 0.02; // sits on the highest corner; the low side gets a plinth
      if (!reason && this._foundationAt(x, z)) reason = 'already built here';
    } else if (P.snap === 'edge') {
      const f = this._nearestFoundation(x, z, g); if (!f) return this._out(type, x, this.ground(x, z), z, rot, 'needs a foundation');
      let bi = 0, bd = Infinity; EDGES.forEach(([dx, dz], i) => { const d = Math.hypot(f.x + dx * g / 2 - x, f.z + dz * g / 2 - z); if (d < bd) { bd = d; bi = i; } });
      const [dx, dz, yaw] = EDGES[bi]; x = f.x + dx * (g / 2 - P.size[2] / 2); z = f.z + dz * (g / 2 - P.size[2] / 2); rot = yaw; y = f.y + f.h; support = f.id; edge = bi;
      if (this.placed.some((p) => p.support === f.id && p.edge === bi)) reason = 'edge already has a wall';
    } else if (P.snap === 'top') {
      const f = this._nearestFoundation(x, z, g); if (!f) return this._out(type, x, this.ground(x, z), z, rot, 'needs a foundation');
      x = f.x; z = f.z; rot = 0; support = f.id;
      const walls = this.wallsOn(f); y = f.y + f.h + (walls[0] ? this.pieces[walls[0].type].size[1] : this.pieces.wall.size[1]);
      if (walls.length < 2) reason = 'roof needs at least 2 walls';
      else if (this.placed.some((p) => p.type === type && p.support === f.id)) reason = 'already has a roof';
    } else {
      const snap = P.snapStep ?? 0.25; x = Math.round(x / snap) * snap; z = Math.round(z / snap) * snap;
      const f = this._foundationAt(x, z);
      if (f) { y = f.y + f.h; support = f.id; }
      else {
        const hw = P.size[0] / 2, hd = P.size[2] / 2, hs = [[-hw, -hd], [hw, -hd], [-hw, hd], [hw, hd], [0, 0]].map(([a, b]) => this.ground(x + a, z + b));
        const lo = Math.min(...hs), hi = Math.max(...hs); y = (lo + hi) / 2;
        if (hi - lo > (P.maxStep ?? 0.35)) reason = `ground too steep (${(hi - lo).toFixed(2)} m step)`;
      }
    }
    reason = this._overlap(type, x, y, z, rot, support) || reason; // overlap/blocker is the most specific reason
    return this._out(type, x, y, z, rot, reason, support, edge);
  }
  _out(type, x, y, z, rot, reason, support = null, edge = null) { return { type, x, y, z, rot, valid: !reason, reason: reason || 'ok', support, edge }; }
  _overlap(type, x, y, z, rot, support) {
    const P = this.pieces[type], a = this._foot(type, x, z, rot), top = y + P.size[1];
    for (const p of this.placed) {
      if (p.id === support) continue; // stacking on the support is checked by the vertical test below
      if (P.snap === 'edge' && this.pieces[p.type].snap === 'edge' && p.support === support) continue; // wall corners on one foundation meet
      const b = this._foot(p.type, p.x, p.z, p.rot), pt = p.y + this.pieces[p.type].size[1];
      const shrink = 0.04;
      if (Math.abs(a.x - b.x) < a.hx + b.hx - shrink && Math.abs(a.z - b.z) < a.hz + b.hz - shrink && y < pt - shrink && top > p.y + shrink) return `overlaps ${p.type}`;
    }
    if (this.blockers) for (const o of this.blockers()) {
      const dx = Math.max(0, Math.abs(o.x - x) - a.hx), dz = Math.max(0, Math.abs(o.z - z) - a.hz);
      if (Math.hypot(dx, dz) < (o.r ?? 0.5)) return `blocked by ${o.kind || 'obstacle'}`;
    }
    return null;
  }
  // Ghost preview: places/colours a translucent copy of the piece. Returns the resolved placement.
  preview(type, point, rot = 0) {
    const r = this.resolve(type, point, rot); this.last = r;
    if (!this.group) return r;
    if (this.ghostType !== type) { this.hidePreview(); this.ghost = this.buildMesh(type, { ghost: true }); this.ghost.name = 'build-ghost'; this.ghostType = type; this.group.add(this.ghost); }
    this.ghost.visible = true; this.ghost.position.set(r.x, r.y, r.z); this.ghost.rotation.set(0, r.rot, 0);
    const m = r.valid ? this.ghostOk : this.ghostBad; this.ghost.traverse((o) => { if (o.isMesh) o.material = m; });
    return r;
  }
  hidePreview() { if (this.ghost) { this.group.remove(this.ghost); this.ghost = null; this.ghostType = null; } }
  // Place a piece, paying its cost from inventory (or its kit item). Returns the piece or { ok: false, reason }.
  place(type, point, rot = 0, { inventory = null, free = false } = {}) {
    const r = this.resolve(type, point, rot); if (!r.valid) { this.events.emit('build:fail', r); return { ok: false, reason: r.reason }; }
    const P = this.pieces[type];
    if (!free && inventory) {
      if (P.item && inventory.has(P.item)) inventory.remove(P.item, 1);
      else if (!inventory.removeAll(P.cost || {})) { const miss = Object.entries(P.cost || {}).filter(([id, n]) => !inventory.has(id, n)).map(([id, n]) => `${n - inventory.count(id)} ${id}`); const reason = 'missing ' + miss.join(', '); this.events.emit('build:fail', { ...r, reason }); return { ok: false, reason }; }
    }
    return this._create({ type, x: r.x, y: r.y, z: r.z, rot: r.rot, support: r.support, edge: r.edge });
  }
  _create(s) {
    const P = this.pieces[s.type];
    const p = { id: s.id ?? this.nextId++, type: s.type, x: s.x, y: s.y, z: s.z, rot: s.rot, support: s.support ?? null, edge: s.edge ?? null, h: P.size[1], ok: true };
    if (P.fuel) { p.fuel = s.fuel ?? P.fuel; p.lit = s.lit ?? true; }
    if (P.slots) p.storage = s.storage ?? { slots: new Array(P.slots).fill(null) };
    this.nextId = Math.max(this.nextId, p.id + 1);
    this.placed.push(p);
    if (this.group) { p.mesh = this.buildMesh(p.type); p.mesh.position.set(p.x, p.y, p.z); p.mesh.rotation.y = p.rot; p.mesh.userData.buildPiece = p.id; this.group.add(p.mesh); this._fireVisual(p); }
    if (this.physics && !P.noCollider && p.type !== 'campfire') {
      const c = Math.abs(Math.cos(p.rot)), sn = Math.abs(Math.sin(p.rot));
      const hx = (P.size[0] * c + P.size[2] * sn) / 2, hz = (P.size[0] * sn + P.size[2] * c) / 2;
      if (P.door) { // two jambs leave a walk-through gap
        const along = new THREE.Vector3(Math.cos(p.rot), 0, -Math.sin(p.rot)), jw = P.size[0] * 0.3;
        p.colliders = [-1, 1].map((k) => this.physics.addStatic({ type: 'box', x: p.x + along.x * k * (P.size[0] / 2 - jw / 2), y: p.y + P.size[1] / 2, z: p.z + along.z * k * (P.size[0] / 2 - jw / 2), hx: jw / 2, hy: P.size[1] / 2, hz: P.size[2] / 2, yaw: p.rot }, { buildPiece: p.id }));
      } else p.colliders = [this.physics.addStatic({ type: 'box', x: p.x, y: p.y + P.size[1] / 2, z: p.z, hx, hy: P.size[1] / 2, hz, yaw: 0 }, { buildPiece: p.id })];
    }
    this.events.emit('build:place', { piece: p }); return p;
  }
  // Remove a piece; everything it supports goes with it. Refunds a share of the cost.
  remove(p, { inventory = null, refund = 0.5 } = {}) {
    if (!p || !this.placed.includes(p)) return [];
    const gone = [p, ...this.placed.filter((q) => q.support === p.id).flatMap((q) => this.remove(q, { inventory, refund }))];
    this.placed = this.placed.filter((q) => q !== p);
    if (p.mesh) this.group.remove(p.mesh); if (p.fire) this.group.remove(p.fire);
    for (const c of p.colliders || []) this.physics?.removeStatic(c);
    if (inventory && refund > 0) for (const [id, n] of Object.entries(this.pieces[p.type].cost || {})) { const k = Math.floor(n * refund); if (k) inventory.add(id, k); }
    this.events.emit('build:remove', { piece: p }); return gone;
  }
  // Crafting stations within radius of pos (lit campfires only).
  stationsNear(pos, radius = 3) { const s = new Set(); for (const p of this.placed) { const st = this.pieces[p.type].station; if (st && (p.lit !== false) && Math.hypot(p.x - pos.x, p.z - pos.z) <= radius) s.add(st); } return s; }
  // Heat 0..1 from lit campfires (linear falloff to heatRadius).
  heatAt(pos) { let h = 0; for (const p of this.placed) { const P = this.pieces[p.type]; if (!P.heat || !p.lit) continue; const d = Math.hypot(p.x - pos.x, p.z - pos.z); h = Math.max(h, P.heat * clamp(1 - d / (P.heatRadius ?? 5), 0, 1)); } return h; }
  // Sheltered = standing on a foundation that has a roof and at least 2 walls.
  shelterAt(pos) {
    const f = this._foundationAt(pos.x, pos.z); if (!f || pos.y > f.y + f.h + 3 || pos.y < f.y - 1) return false;
    return this.wallsOn(f).length >= 2 && this.placed.some((p) => p.type === 'roof' && p.support === f.id);
  }
  addFuel(p, seconds) { if (p.fuel === undefined) return false; p.fuel += seconds; p.lit = true; this._fireVisual(p); return true; }
  // Burn fuel; rain (0..1, unsheltered) burns it 3x faster and can put a fire out.
  update(dt, { rain = 0, vfx = null } = {}) {
    this.time += dt;
    for (const p of this.placed) {
      if (p.fuel === undefined || !p.lit) continue;
      const sheltered = this.shelterAt({ x: p.x, y: p.y + 0.5, z: p.z });
      p.fuel -= dt * (1 + (sheltered ? 0 : rain * 2));
      if (p.fuel <= 0) { p.fuel = 0; p.lit = false; this._fireVisual(p); this.events.emit('build:fireOut', { piece: p }); continue; }
      if (p.fire) { const f = 1 + Math.sin(this.time * 17 + p.id) * 0.08 + Math.sin(this.time * 31) * 0.05; p.fire.scale.set(f, f * (1 + Math.sin(this.time * 23) * 0.1), f); if (p.light) p.light.intensity = 6 * f; }
      if (vfx && Math.floor(this.time * 10) !== Math.floor((this.time - dt) * 10)) { vfx.emit('fire', new THREE.Vector3(p.x, p.y + 0.35, p.z), { count: 2, scale: 0.7 }); if (Math.floor(this.time * 3) !== Math.floor((this.time - dt) * 3)) vfx.emit('smoke', new THREE.Vector3(p.x, p.y + 0.9, p.z), { count: 1, scale: 0.6 }); }
    }
  }
  _fireVisual(p) {
    if (!this.group || p.type !== 'campfire') return;
    if (p.lit && !p.fire) {
      const g = new THREE.Group(); const flame = emissive(0xff8a2a, 3.2);
      for (let i = 0; i < 3; i++) { const c = new THREE.Mesh(new THREE.ConeGeometry(0.16 - i * 0.03, 0.5 - i * 0.08, 7), flame); c.position.set(Math.sin(i * 2.1) * 0.06, 0.32, Math.cos(i * 2.1) * 0.06); g.add(c); }
      g.position.set(p.x, p.y, p.z); this.group.add(g); p.fire = g;
      p.light = new THREE.PointLight(0xff9a4a, 6, 9, 1.6); p.light.position.set(0, 0.7, 0); g.add(p.light);
    } else if (!p.lit && p.fire) { this.group.remove(p.fire); p.fire = null; p.light = null; }
  }
  // Default procedural meshes (override per piece with pieces[type].build(ghost) or materials {...}).
  buildMesh(type, { ghost = false } = {}) {
    const P = this.pieces[type]; if (P.build) return P.build({ ghost });
    const M = this.materials, wood = M.wood || solid(0x8a6238, { roughness: 0.85 }), dark = M.darkWood || solid(0x5e4128, { roughness: 0.9 }), stone = M.stone || solid(0x8a8780, { roughness: 0.95 }), thatch = M.thatch || solid(0xb59a5a, { roughness: 1 });
    const g = new THREE.Group(), [w, h, d] = P.size;
    const box = (sx, sy, sz, x, y, z, m, ry = 0) => { const b = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), m); b.position.set(x, y, z); b.rotation.y = ry; b.castShadow = !ghost; b.receiveShadow = !ghost; g.add(b); return b; };
    if (type === 'foundation') { box(w, h, d, 0, h / 2, 0, stone); box(w * 0.96, 0.08, d * 0.96, 0, h + 0.04, 0, wood); if (!ghost) box(w * 0.98, 1.2, d * 0.98, 0, -0.6, 0, stone); }
    else if (type === 'wall' || type === 'doorway') {
      const n = 6; for (let i = 0; i < n; i++) { const x = -w / 2 + (i + 0.5) * (w / n); if (P.door && Math.abs(x) < w * 0.2) continue; box(w / n - 0.02, h, d, x, h / 2, 0, i % 2 ? wood : dark); }
      if (P.door) box(w * 0.42, 0.35, d, 0, h - 0.175, 0, dark);
      box(w, 0.12, d + 0.06, 0, h - 0.06, 0, dark); box(w, 0.12, d + 0.06, 0, 0.06, 0, dark);
    } else if (type === 'roof') {
      const half = w / 2 + 0.15, pitch = 0.5, len = Math.hypot(half, pitch * half * 0.8);
      for (const s of [-1, 1]) { const b = box(len, 0.12, d + 0.3, s * half / 2, pitch * half * 0.4 + 0.06, 0, thatch); b.rotation.z = -s * Math.atan2(pitch * half * 0.8, half); }
      box(0.16, 0.16, d + 0.35, 0, pitch * half * 0.8 + 0.06, 0, dark);
      const tri = new THREE.Shape([new THREE.Vector2(-w / 2, 0), new THREE.Vector2(w / 2, 0), new THREE.Vector2(0, pitch * half * 0.8)]);
      for (const s of [-1, 1]) { const gm = new THREE.Mesh(new THREE.ExtrudeGeometry(tri, { depth: 0.1, bevelEnabled: false }), wood); gm.position.set(0, 0, s * (d / 2 - 0.12) - 0.05); gm.castShadow = !ghost; g.add(gm); }
      for (const s of [-1, 1]) box(w, 0.12, 0.12, 0, 0.06, s * (d / 2 - 0.1), dark);
    } else if (type === 'campfire') {
      for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2, s = new THREE.Mesh(new THREE.DodecahedronGeometry(0.13, 0), stone); s.position.set(Math.cos(a) * 0.45, 0.08, Math.sin(a) * 0.45); s.scale.set(1, 0.7, 1); s.castShadow = !ghost; g.add(s); }
      for (let i = 0; i < 4; i++) { const l = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.7, 6), dark); l.rotation.z = Math.PI / 2 - 0.5; l.rotation.y = (i / 4) * Math.PI * 2; l.position.y = 0.18; g.add(l); }
    } else if (type === 'storage') { box(w, h * 0.8, d, 0, h * 0.4, 0, wood); box(w + 0.04, h * 0.2, d + 0.04, 0, h * 0.9, 0, dark); box(0.12, 0.12, 0.04, 0, h * 0.75, d / 2 + 0.02, stone); }
    else if (type === 'workbench') { box(w, 0.1, d, 0, h - 0.05, 0, wood); for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(0.1, h - 0.1, 0.1, a * (w / 2 - 0.08), (h - 0.1) / 2, b * (d / 2 - 0.08), dark); }
    else box(w, h, d, 0, h / 2, 0, wood);
    g.userData.piece = type; return g;
  }
  debug() { const by = {}; for (const p of this.placed) by[p.type] = (by[p.type] || 0) + 1; return by; }
  toJSON() { return { nextId: this.nextId, pieces: this.placed.map((p) => ({ id: p.id, type: p.type, x: p.x, y: p.y, z: p.z, rot: p.rot, support: p.support, edge: p.edge, fuel: p.fuel, lit: p.lit, storage: p.storage })) }; }
  load(d) {
    for (const p of [...this.placed]) { if (p.mesh) this.group.remove(p.mesh); if (p.fire) this.group.remove(p.fire); for (const c of p.colliders || []) this.physics?.removeStatic(c); }
    this.placed = []; this.nextId = d.nextId || 1;
    for (const s of d.pieces) this._create(s);
  }
}

// ---------------------------------------------------------------------------------------------
// Save integration: one call registers every survival system (and weather) with core/save.js.
// ---------------------------------------------------------------------------------------------
export function attachSurvivalSave(save, systems, { prefix = 'survival' } = {}) {
  const keys = [];
  for (const [name, sys] of Object.entries(systems)) {
    if (!sys || typeof sys.toJSON !== 'function' || typeof sys.load !== 'function') continue;
    const key = `${prefix}.${name}`; keys.push(key);
    save.register(key, { save: () => JSON.parse(JSON.stringify(sys.toJSON())), load: (d) => sys.load(d) });
  }
  return keys;
}
