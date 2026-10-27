import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../../engine/vendor/three/three.module.js';
import { Heightfield } from '../../engine/world/terrain.js';
import { PhysicsWorld } from '../../engine/physics/world.js';
import { CharacterController } from '../../engine/physics/character.js';
import { Vehicle } from '../../engine/physics/vehicle.js';
import { car } from '../../engine/geometry/vehicles.js';
import { NavGrid, bt, BehaviorTree, RUNNING, StateMachine, Perception } from '../../engine/ai/behavior.js';
import { Flags, QuestSystem, DialogueSystem, parseDialogue, Mission } from '../../engine/gameplay/narrative.js';
import { Health, Inventory, Progression, ComboSystem, meleeSweep } from '../../engine/gameplay/systems.js';
import { MaterialLibrary } from '../../engine/render/materials.js';
import { generateCity } from '../../engine/world/city.js';
MaterialLibrary.textureSize = 32;

test('heightfield: flatten areas and bilinear queries match grid', () => {
  const hf = new Heightfield({ size: 200, resolution: 100, seed: 3, height: 30, flatten: [{ x: 0, z: 0, radius: 10, height: 7, falloff: 5 }] });
  assert.ok(Math.abs(hf.heightAt(0, 0) - 7) < 0.01); assert.ok(Math.abs(hf.heightAt(4, -3) - 7) < 0.05);
  const v = hf.data[50 * 101 + 60]; assert.ok(Math.abs(hf.heightAt(-100 + 60 * 2, -100 + 50 * 2) - v) < 1e-4);
  assert.ok(hf.normalAt(0, 0).y > 0.99);
  const hit = hf.raycast(new THREE.Vector3(0, 50, 0), new THREE.Vector3(0, -1, 0)); assert.ok(Math.abs(hit.point.y - 7) < 0.3);
});
test('physics: raycast vs rotated box, cylinder; overlap; push-out', () => {
  const w = new PhysicsWorld();
  w.addStatic({ type: 'box', x: 10, y: 1, z: 0, hx: 1, hy: 1, hz: 3, yaw: Math.PI / 4 });
  w.addStatic({ type: 'cylinder', x: -10, y: 0, z: 0, r: 1, h: 4 });
  const h1 = w.raycast(new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0), 30, { terrain: false });
  assert.ok(h1 && h1.distance > 7 && h1.distance < 10);
  const h2 = w.raycast(new THREE.Vector3(0, 1, 0), new THREE.Vector3(-1, 0, 0), 30, { terrain: false });
  assert.ok(Math.abs(h2.distance - 9) < 1e-6);
  const r = w.resolveCylinder(-9.5, 0, 0.4, 0, 1.8); assert.ok(Math.hypot(r.x + 10, r.z) >= 1.4 - 1e-6);
  assert.equal(w.overlapSphere(new THREE.Vector3(-10, 1, 0), 0.5).length, 1);
});
test('character controller: falls, lands on terrain, walks, blocked by wall, jumps', () => {
  const hf = new Heightfield({ size: 100, resolution: 50, type: 'flat', seed: 1 });
  const w = new PhysicsWorld({ heightfield: hf });
  w.addStatic({ type: 'box', x: 0, y: 2, z: 10, hx: 5, hy: 2, hz: 0.5 });
  const c = new CharacterController(w, { position: new THREE.Vector3(0, 5, 0) });
  for (let i = 0; i < 120; i++) c.move(1 / 60, new THREE.Vector3(), 0);
  assert.ok(c.grounded); assert.ok(Math.abs(c.position.y - hf.heightAt(0, 0)) < 0.05);
  for (let i = 0; i < 240; i++) c.move(1 / 60, new THREE.Vector3(0, 0, 1), 5);
  assert.ok(c.position.z < 10 - 0.5 - 0.3, 'wall blocks movement: z=' + c.position.z);
  c.move(1 / 60, new THREE.Vector3(), 0, { jump: true }); for (let i = 0; i < 5; i++) c.move(1 / 60, new THREE.Vector3(), 0);
  assert.ok(!c.grounded && c.position.y > hf.heightAt(c.position.x, c.position.z) + 0.2);
});
test('vehicle: accelerates, steers, brakes, collides without tunnelling', () => {
  const w = new PhysicsWorld();
  w.addStatic({ type: 'box', x: 0, y: 2, z: 120, hx: 20, hy: 2, hz: 1 });
  const v = new Vehicle(w, car({ type: 'sedan' }), { position: new THREE.Vector3(0, 0.3, 0), yaw: 0 });
  v.setInput({ throttle: 1 }); for (let i = 0; i < 180; i++) v.update(1 / 60);
  assert.ok(v.kmh > 60, 'speed ' + v.kmh);
  for (let i = 0; i < 300; i++) v.update(1 / 60);
  assert.ok(v.position.z < 119, 'stopped by wall at z=' + v.position.z); assert.ok(v.damage > 0);
  const v2 = new Vehicle(w, car({}), { position: new THREE.Vector3(50, 0.3, 0) });
  v2.setInput({ throttle: 1, steer: 1 }); for (let i = 0; i < 120; i++) v2.update(1 / 60);
  assert.ok(v2.yaw > 0.3, 'steer left increases yaw');
  v2.setInput({ brake: 1 }); for (let i = 0; i < 32; i++) v2.update(1 / 60); assert.ok(v2.kmh < 3, 'brakes to a stop: ' + v2.kmh);
});
test('navgrid A* routes around obstacles; returns null when blocked', () => {
  const g = new NavGrid({ minX: -20, minZ: -20, size: 40, cell: 1, blocked: (x, z) => Math.abs(x) < 1 && z > -15 });
  const p = g.findPath(new THREE.Vector3(-10, 0, 10), new THREE.Vector3(10, 0, 10));
  assert.ok(p && p.length >= 3); for (let i = 1; i < p.length; i++) assert.ok(g.lineWalkable(p[i - 1], p[i]));
  const g2 = new NavGrid({ minX: -10, minZ: -10, size: 20, cell: 1, blocked: (x) => Math.abs(x) < 1 });
  assert.equal(g2.findPath(new THREE.Vector3(-5, 0, 0), new THREE.Vector3(5, 0, 0)), null);
});
test('behavior tree priorities, running state and FSM', () => {
  const bb = { hp: 10, log: [] };
  const tree = new BehaviorTree(bt.sel(bt.seq(bt.cond((c) => c.hp < 5), bt.act((c) => { c.log.push('flee'); return RUNNING; })), bt.act((c) => { c.log.push('fight'); return RUNNING; })), bb);
  tree.tick(0.1); bb.hp = 2; tree.tick(0.1);
  assert.deepEqual(bb.log, ['fight', 'flee']);
  const owner = { e: 0 }; const fsm = new StateMachine(owner, { idle: { update: (o, dt, t) => (t > 0.2 ? 'run' : null) }, run: { enter: (o) => o.e++ } }, 'idle');
  for (let i = 0; i < 20; i++) fsm.update(0.02); assert.equal(fsm.state, 'run'); assert.equal(owner.e, 1);
  const per = new Perception({ sightRange: 10, fov: Math.PI / 2 });
  assert.equal(per.sense(0, new THREE.Vector3(), 0, new THREE.Vector3(0, 0, 5)).visible, true);
  assert.equal(per.sense(0, new THREE.Vector3(), 0, new THREE.Vector3(0, 0, -5)).visible, false);
});
test('quests, dialogue scripts, flags and missions', () => {
  const f = new Flags(), q = new QuestSystem(f), inv = new Inventory();
  const d = new DialogueSystem({ flags: f, quests: q, inventory: inv });
  q.define({ id: 'a', title: 'A', objectives: [{ id: 'x', type: 'collect', target: 'gem', count: 2, text: 'gems' }, { id: 'y', type: 'talk', target: 'bob', text: 'bob', after: ['x'] }], next: 'b' }, { id: 'b', title: 'B', objectives: [{ id: 'z', type: 'flag', target: 'done', text: 'z' }] });
  d.define('bob', '# s\n@if: quest:a\n@else: intro\n-> busy\n# intro\nBob: Hi {coins}\n> Quest? -> give {do: start a; give key 2}\n> Bye -> end\n# give\nBob: Go.\n-> end\n# busy\nBob: Busy.\n-> end');
  f.set('coins', 3);
  assert.equal(d.start('bob').text, 'Hi 3');
  d.advance(0); assert.equal(q.status('a'), 'active'); assert.equal(inv.count('key'), 2); assert.equal(d.advance(), null);
  assert.equal(d.start('bob').text, 'Busy.');
  q.report('talk', 'bob'); assert.equal(q.state.a.done.y, undefined, 'sequential objective hidden until gems');
  q.report('collect', 'gem', 2); q.report('talk', 'bob');
  assert.equal(q.status('a'), 'complete'); assert.equal(q.status('b'), 'active');
  f.set('done'); q.onFlag(); assert.equal(q.status('b'), 'complete');
  assert.ok(f.test('quest:a:complete') && f.test('coins>=3') && !f.test('!coins'));
  assert.throws(() => parseDialogue('Speaker: no node'));
  const m = new Mission('m', [{ done: (c) => c.n > 1 }, { done: () => true }]); const ctx = { n: 0 };
  m.start(ctx); m.update(0.1, ctx); assert.equal(m.i, 0); ctx.n = 2; m.update(0.1, ctx); m.update(0.1, ctx); assert.equal(m.status, 'complete');
});
test('combat systems: health/i-frames, combo chain, melee arc, progression', () => {
  let died = 0; const h = new Health(100, { armor: 0.5, onDeath: () => died++ });
  assert.equal(h.damage(40), 20); h.invulnerable = 1; assert.equal(h.damage(40), 0); h.update(1.1); h.damage(1000); assert.equal(died, 1);
  const c = new ComboSystem(); assert.equal(c.request(false, 1), 'attack1'); assert.equal(c.request(false, 1), 'attack2'); assert.equal(c.request(true, 0.2), null); assert.equal(c.consumeBuffer(false, 1), 'attack3');
  const t = [{ alive: true, position: new THREE.Vector3(0, 0, 1.5) }, { alive: true, position: new THREE.Vector3(0, 0, -1.5) }];
  assert.equal(meleeSweep(new THREE.Vector3(), 0, t).length, 1);
  const p = new Progression(); assert.equal(p.addXP(1000), 3); assert.equal(p.level, 4);
});
test('city generator: roads graph, colliders, buildings', () => {
  const c = generateCity({ seed: 2, blocks: 3, props: false });
  assert.equal(c.graph.nodes.length, 16);
  assert.ok(c.graph.nodes.every((n) => n.edges.length >= 2));
  assert.ok(c.buildings.length > 10); assert.ok(c.colliders.length > c.buildings.length);
  assert.ok(c.isRoad(c.roadCenters[1], 5)); assert.ok(!c.isRoad(c.roadCenters[0] + c.pitch / 2, c.roadCenters[0] + c.pitch / 2));
});
