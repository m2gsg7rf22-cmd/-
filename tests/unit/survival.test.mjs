import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../../engine/vendor/three/three.module.js';
import { ItemRegistry, Inventory, Equipment, CraftingSystem, Needs, ResourceNodes, BuildPlacement, attachSurvivalSave, DEFAULT_RECIPES } from '../../engine/gameplay/survival.js';
import { Health, Stamina } from '../../engine/gameplay/systems.js';
import { SaveSystem } from '../../engine/core/save.js';
import { Heightfield } from '../../engine/world/terrain.js';
import { PhysicsWorld } from '../../engine/physics/world.js';

const reg = () => new ItemRegistry();

test('inventory: stacking, slot limits, weight limit, split/merge, durability, use, serialize', () => {
  const inv = new Inventory(reg(), { slots: 4 });
  assert.equal(inv.add('wood', 45), 0);
  assert.deepEqual(inv.slots.slice(0, 2).map((s) => s.n), [30, 15], 'wood stacks to 30 per slot');
  assert.equal(inv.add('stone', 100), 100 - 60, 'two free slots take 60 stone, 40 left over');
  assert.equal(inv.count('stone'), 60); assert.equal(inv.freeSlots(), 0);
  assert.equal(inv.remove('wood', 50), false, 'all-or-nothing removal'); assert.ok(inv.remove('wood', 20)); assert.equal(inv.count('wood'), 25);
  // weight limit
  const light = new Inventory(reg(), { slots: 10, maxWeight: 5 });
  assert.equal(light.add('stone', 10), 6, 'only 4 stones (1.2 kg) fit in 5 kg'); assert.ok(light.weight <= 5);
  // split / merge
  const s = new Inventory(reg(), { slots: 5 }); s.add('fiber', 40);
  const j = s.split(0, 15); assert.equal(j, 1); assert.deepEqual([s.slots[0].n, s.slots[1].n], [25, 15]);
  s.move(1, 0); assert.equal(s.slots[0].n, 40); assert.equal(s.slots[1], null);
  // durability items never stack and break at 0
  s.add('stoneAxe', 2); const axes = s.slots.filter((x) => x && x.id === 'stoneAxe'); assert.equal(axes.length, 2); assert.equal(axes[0].dur, 60);
  const i = s.findTool('axe', 1); let broke = 0; s.on('inventory:break', () => broke++);
  for (let k = 0; k < 60; k++) s.wear(i, 1); assert.equal(broke, 1); assert.equal(s.count('stoneAxe'), 1);
  // use applies effects to needs + health
  const needs = new Needs(); needs.hunger = 50; const hp = new Health(100); hp.value = 60;
  s.add('berries', 2); s.add('bandage', 1);
  s.useItem('berries', { needs, health: hp }); assert.equal(needs.hunger, 58); assert.equal(s.count('berries'), 1);
  s.useItem('bandage', { needs, health: hp }); assert.equal(hp.value, 80);
  // serialize
  const copy = new Inventory(reg(), { slots: 5 }); copy.load(JSON.parse(JSON.stringify(s.toJSON())));
  assert.deepEqual(copy.slots, s.slots); assert.equal(copy.weight, s.weight);
});

test('equipment: equip/unequip tools and clothing; insulation; tool wear breaks it', () => {
  const inv = new Inventory(reg(), { slots: 6 }); inv.add('stoneAxe'); inv.add('furCoat'); inv.add('hat');
  const eq = new Equipment(inv);
  assert.equal(eq.tool().kind, 'hand');
  assert.ok(eq.equipItem('stoneAxe')); assert.equal(eq.tool().kind, 'axe'); assert.equal(inv.count('stoneAxe'), 0);
  assert.ok(eq.equipItem('furCoat')); assert.ok(eq.equipItem('hat')); assert.equal(eq.insulation(), 9.5);
  assert.equal(eq.equipItem('wood'), false, 'non-equippable items are refused');
  assert.ok(eq.unequip('head')); assert.equal(inv.count('hat'), 1);
  for (let k = 0; k < 60; k++) eq.wearTool(1); assert.equal(eq.tool().kind, 'hand', 'axe broke');
  const e2 = new Equipment(new Inventory(reg())); e2.load(JSON.parse(JSON.stringify(eq.toJSON()))); assert.equal(e2.insulation(), 8);
});

test('crafting: canCraft explains missing inputs/tools/stations; queue with time; cancel refunds', () => {
  const inv = new Inventory(reg(), { slots: 12 });
  let stations = new Set();
  const craft = new CraftingSystem(inv, { recipes: DEFAULT_RECIPES, stations: () => stations });
  let r = craft.canCraft('stoneAxe');
  assert.equal(r.ok, false); assert.deepEqual(r.missing.map((m) => m.id).sort(), ['rope', 'stone', 'wood']);
  assert.match(r.reason, /need 3 more Wood/);
  inv.add('wood', 3); inv.add('stone', 2); inv.add('fiber', 6);
  r = craft.canCraft('stoneAxe'); assert.equal(r.missing.length, 1); assert.equal(r.missing[0].id, 'rope');
  assert.ok(craft.craft('rope').ok); assert.equal(inv.count('fiber'), 0, 'inputs consumed when queued');
  craft.update(1); assert.equal(inv.count('rope'), 0, 'not done before recipe time'); craft.update(1.01); assert.equal(inv.count('rope'), 1);
  assert.ok(craft.craft('stoneAxe').ok); assert.equal(craft.queue.length, 1);
  assert.ok(craft.cancel()); assert.equal(inv.count('wood'), 3); assert.equal(inv.count('rope'), 1, 'cancel refunds inputs');
  craft.craft('stoneAxe'); craft.update(4.01); assert.equal(inv.count('stoneAxe'), 1);
  // station requirement
  inv.add('rawMeat', 2);
  r = craft.canCraft('cookedMeat'); assert.equal(r.ok, false); assert.equal(r.missing[0].type, 'station'); assert.match(r.reason, /campfire/);
  stations = new Set(['campfire']); assert.ok(craft.craft('cookedMeat', { count: 2 }).ok); craft.update(13); assert.equal(inv.count('cookedMeat'), 2);
  // tool requirement (not consumed, worn)
  inv.add('fiber', 12); const before = inv.slots.find((s) => s?.id === 'stoneAxe').dur;
  assert.ok(craft.craft('hat', { instant: true }).ok); assert.equal(inv.count('hat'), 1); assert.equal(inv.slots.find((s) => s?.id === 'stoneAxe').dur, before - 1);
  // serialize queue
  inv.add('fiber', 6); craft.craft('rope'); const c2 = new CraftingSystem(inv); c2.load(craft.toJSON()); assert.equal(c2.queue.length, 1);
});

test('needs: activity, weather and time drive rates; effects on health and stamina; status events', () => {
  const mk = () => { const health = new Health(100), stamina = new Stamina(100); return { n: new Needs({ health, stamina }), health, stamina }; };
  const idle = mk(), sprint = mk();
  for (let i = 0; i < 600; i++) { idle.n.update(1, { activity: 'idle', ambient: 20 }); sprint.n.update(1, { activity: 'sprint', ambient: 20 }); }
  assert.ok(sprint.n.hunger < idle.n.hunger - 10 && sprint.n.thirst < idle.n.thirst - 10, 'sprinting burns food/water faster');
  assert.ok(sprint.n.fatigue > idle.n.fatigue, 'sprinting tires you');
  // cold, wet, windy night without shelter -> hypothermia damages health; fire + shelter fixes it
  const cold = mk(); const seen = []; cold.n.on('needs:status', (e) => e.on && seen.push(e.status));
  for (let i = 0; i < 1800; i++) cold.n.update(1, { ambient: 2, wind: 12, rain: 1 });
  assert.ok(cold.n.bodyTemp < 35, `hypothermic (${cold.n.bodyTemp.toFixed(2)} °C)`); assert.ok(cold.health.value < 100, 'cold hurts');
  assert.ok(seen.includes('cold') && seen.includes('wet'), 'status events fired: ' + seen);
  const warm = mk(); warm.n.bodyTemp = 34.5; warm.n.wetness = 1;
  for (let i = 0; i < 1800; i++) warm.n.update(1, { ambient: 2, wind: 12, rain: 1, shelter: true, heat: 0.9 });
  assert.ok(warm.n.bodyTemp > 36.5, `campfire + shelter warm you up (${warm.n.bodyTemp.toFixed(2)})`); assert.ok(warm.n.wetness < 0.5, 'and dry you');
  // starvation drains health; fatigue caps stamina
  const st = mk(); st.n.hunger = 0; st.n.thirst = 0; st.n.fatigue = 95;
  st.n.update(60, { ambient: 20 }); assert.ok(st.health.value < 100); assert.ok(st.stamina.max < 100, 'exhaustion lowers max stamina');
  assert.ok(st.n.status().includes('starving') && st.n.status().includes('exhausted'));
  // sleeping restores fatigue
  const sl = mk(); sl.n.fatigue = 80; sl.n.update(300, { sleeping: true, ambient: 20, shelter: true }); assert.ok(sl.n.fatigue < 80);
  const copy = new Needs(); copy.load(JSON.parse(JSON.stringify(cold.n.toJSON()))); assert.equal(copy.bodyTemp, cold.n.bodyTemp);
});

test('resource nodes: tool tiers, proportional yields, depletion + respawn, raycast, scatter on a Heightfield', () => {
  const hf = new Heightfield({ size: 120, resolution: 60, seed: 3, height: 6 });
  const physics = new PhysicsWorld({ heightfield: hf });
  const nodes = new ResourceNodes({ physics, seed: 5 });
  const trees = nodes.scatter(hf, 'tree', { count: 12, minHeight: -99 });
  assert.ok(trees.length >= 8, 'trees scattered'); assert.ok(trees.every((t) => Math.abs(t.position.y - hf.heightAt(t.position.x, t.position.z)) < 1e-6), 'on the ground');
  const again = new ResourceNodes({ seed: 5 }).scatter(hf, 'tree', { count: 12, minHeight: -99 });
  assert.deepEqual(again.map((t) => t.position.x), trees.map((t) => t.position.x), 'deterministic scatter');
  assert.equal(physics.statics.size, trees.length, 'trees get colliders');
  const inv = new Inventory(reg(), { slots: 10 });
  const t = trees[0], total = t.totals.wood;
  // bare hands work but slowly; an axe is faster
  const hand = nodes.hit(t, { kind: 'hand', tier: 0, damage: 6 }, { inventory: inv }); assert.ok(hand.ok && !hand.right);
  let hits = 1; while (t.alive && hits < 100) { nodes.hit(t, { kind: 'axe', tier: 1, damage: 20 }, { inventory: inv }); hits++; }
  assert.ok(!t.alive && hits < 10, `axe fells the tree in ${hits} hits`);
  assert.equal(inv.count('wood'), total, 'all wood paid out exactly once');
  assert.equal(physics.statics.size, trees.length - 1, 'collider removed when felled');
  assert.equal(nodes.hit(t, { kind: 'axe', tier: 1, damage: 20 }).ok, false);
  nodes.update(599); assert.equal(t.alive, false); nodes.update(2); assert.equal(t.alive, true, 'respawns'); assert.equal(physics.statics.size, trees.length);
  // tier gate
  const ore = nodes.add('ore', { x: 0, y: 0, z: 0 });
  assert.match(nodes.hit(ore, { kind: 'pickaxe', tier: 0, damage: 20 }).reason, /tier 1/);
  assert.equal(nodes.hit(ore, { kind: 'hand', tier: 0, damage: 6 }).ok, false);
  // harvest picks the best tool from the inventory and wears it
  inv.add('stoneAxe'); const t2 = trees[1]; const r = nodes.harvest(t2, { inventory: inv }); assert.ok(r.right); assert.equal(inv.slots.find((s) => s?.id === 'stoneAxe').dur, 59);
  // raycast hits the trunk in front
  const o = t2.position.clone().add(new THREE.Vector3(0, 1.5, -3)); const hit = nodes.raycast(o, new THREE.Vector3(0, 0, 1), 5);
  assert.equal(hit?.node, t2); assert.ok(Math.abs(hit.distance - (3 - 0.45 * t2.scale - 0.15)) < 0.05);
  assert.equal(nodes.inFront(t2.position.clone().add(new THREE.Vector3(0, 0, -1.5)), 0), t2);
  // save/load
  const n2 = new ResourceNodes({ seed: 5 }); n2.scatter(hf, 'tree', { count: 12, minHeight: -99 }); n2.add('ore', { x: 0, y: 0, z: 0 });
  nodes.hit(trees[2], { kind: 'axe', tier: 1, damage: 500 }); n2.load(JSON.parse(JSON.stringify(nodes.toJSON())));
  assert.equal(n2.nodes[2].alive, false); assert.equal(n2.nodes[1].hp, t2.hp);
});

test('build placement: grid snap, slope + overlap validity, walls need foundations, roof needs 2 walls, shelter, heat, cascade remove', () => {
  const flat = new BuildPlacement({ ground: () => 0, grid: 3 });
  const f = flat.resolve('foundation', { x: 1.2, z: -1.4 }); assert.ok(f.valid); assert.deepEqual([f.x, f.z], [0, 0], 'snaps to the 3 m grid');
  const steep = new BuildPlacement({ ground: (x) => x * 0.6 });
  const s = steep.resolve('foundation', { x: 0, z: 0 }); assert.equal(s.valid, false); assert.match(s.reason, /steep/);
  assert.match(flat.resolve('wall', { x: 0, z: 1.5 }).reason, /foundation/);
  const inv = new Inventory(reg(), { slots: 12 }); inv.add('wood', 60); inv.add('stone', 20); inv.add('fiber', 10);
  const F = flat.place('foundation', { x: 0, z: 0 }, 0, { inventory: inv }); assert.ok(F.id); assert.equal(inv.count('wood'), 54);
  assert.equal(flat.place('foundation', { x: 0.4, z: 0.2 }).ok, false, 'cannot double-build');
  assert.match(flat.resolve('roof', { x: 0, z: 0 }).reason, /2 walls/);
  const w1 = flat.place('wall', { x: 0, z: 1.4 }, 0, { inventory: inv }); assert.equal(w1.edge, 2); assert.ok(Math.abs(w1.z - 1.4) < 1e-9);
  assert.match(flat.resolve('wall', { x: 0.2, z: 1.3 }).reason, /already/);
  flat.place('wall', { x: -1.4, z: 0 }, 0, { inventory: inv }); flat.place('doorway', { x: 0, z: -1.4 }, 0, { inventory: inv });
  const roof = flat.place('roof', { x: 0.3, z: 0.1 }, 0, { inventory: inv }); assert.ok(roof.id); assert.ok(Math.abs(roof.y - (F.y + 0.4 + 2.6)) < 1e-9);
  assert.ok(flat.shelterAt({ x: 0, y: 0.5, z: 0 })); assert.equal(flat.shelterAt({ x: 6, y: 0, z: 0 }), false);
  // free placement: overlap + blockers
  const fire = flat.place('campfire', { x: 4.6, z: 0 }, 0, { inventory: inv }); assert.ok(fire.id, 'campfire placed'); assert.equal(fire.lit, true);
  assert.match(flat.resolve('storage', { x: 4.6, z: 0.3 }).reason, /overlaps campfire/);
  const blocked = new BuildPlacement({ ground: () => 0, blockers: () => [{ x: 10, z: 10, r: 0.6, kind: 'tree' }] });
  assert.match(blocked.resolve('campfire', { x: 10.3, z: 10 }).reason, /tree/);
  assert.ok(flat.stationsNear({ x: 4, z: 0 }).has('campfire')); assert.ok(flat.heatAt({ x: 5.6, z: 0 }) > 0.7); assert.equal(flat.heatAt({ x: 20, z: 0 }), 0);
  // fuel burns faster in rain and the fire goes out
  const dry = flat.placed.find((p) => p.type === 'campfire').fuel; flat.update(10, { rain: 1 }); assert.ok(Math.abs(fire.fuel - (dry - 30)) < 1e-6);
  flat.update(1000, { rain: 1 }); assert.equal(fire.lit, false); assert.equal(flat.stationsNear({ x: 4, z: 0 }).has('campfire'), false);
  // missing materials
  const poor = new Inventory(reg()); assert.match(flat.place('foundation', { x: 9, z: 9 }, 0, { inventory: poor }).reason, /missing/);
  // save / load rebuilds; removing the foundation removes what it supports
  const b2 = new BuildPlacement({ ground: () => 0 }); b2.load(JSON.parse(JSON.stringify(flat.toJSON())));
  assert.deepEqual(b2.debug(), flat.debug()); assert.ok(b2.shelterAt({ x: 0, y: 0.5, z: 0 }));
  const gone = flat.remove(F, { inventory: inv }); assert.equal(gone.length, 5, 'foundation + 2 walls + doorway + roof');
});

test('save integration: every survival system round-trips through SaveSystem', () => {
  const registry = reg(), inv = new Inventory(registry), eq = new Equipment(inv), craft = new CraftingSystem(inv, { equipment: eq }), needs = new Needs();
  const build = new BuildPlacement({ ground: () => 0 }), nodes = new ResourceNodes({ seed: 2 }); nodes.add('rock', { x: 3, y: 0, z: 3 });
  inv.add('wood', 12); inv.add('stoneAxe'); eq.equipItem('stoneAxe'); inv.add('fiber', 6); craft.craft('rope'); needs.hunger = 42; build.place('foundation', { x: 0, z: 0 }, 0, { free: true }); nodes.hit(nodes.nodes[0], { kind: 'pickaxe', tier: 1, damage: 30 });
  const save = new SaveSystem('survival-test', { storage: null });
  const keys = attachSurvivalSave(save, { inventory: inv, equipment: eq, crafting: craft, needs, building: build, nodes });
  assert.equal(keys.length, 6); save.save('slot1');
  inv.remove('wood', 12); eq.unequip('tool'); craft.queue = []; needs.hunger = 99; build.load({ pieces: [] }); nodes.nodes[0].hp = 999;
  assert.ok(save.load('slot1'));
  assert.equal(inv.count('wood'), 12); assert.equal(eq.tool().kind, 'axe'); assert.equal(craft.queue.length, 1); assert.equal(needs.hunger, 42); assert.equal(build.placed.length, 1); assert.equal(nodes.nodes[0].hp, 90 - 30 * 1.25, 'pickaxe tier 1 on a tier-0 rock hits 25 % harder');
});
