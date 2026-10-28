import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../../engine/vendor/three/three.module.js';
import { MaterialLibrary } from '../../engine/render/materials.js';
import { ChunkManager, LODGroup, selectLOD, cellDistance, bucketByCell } from '../../engine/world/streaming.js';
import { activityAt, makeSchedule, inSpan, jitterSchedule, ScheduleAgent, ScheduleSystem, PlaceRegistry } from '../../engine/ai/schedules.js';
import { WantedSystem, levelForHeat, assignPursuit, WANTED_LEVELS } from '../../engine/gameplay/wanted.js';
import { generateCity } from '../../engine/world/city.js';
import { sidewalkNetwork, placesFromCity, Crowd } from '../../engine/world/crowd.js';
import { RNG } from '../../engine/core/rng.js';
MaterialLibrary.textureSize = 32;

test('streaming: chunks load nearest-first within budget and unload only past the hysteresis radius', () => {
  const built = [], disposed = [];
  const m = new ChunkManager({ cellSize: 10, loadRadius: 15, unloadRadius: 30, maxLoadsPerUpdate: 3, build: (cx, cz, k) => { built.push(k); return { k }; }, dispose: (c) => disposed.push(c.k) });
  m.update({ x: 5, z: 5 });
  assert.equal(built.length, 3, 'budget caps loads per update');
  assert.equal(built[0], '0,0', 'focus cell first');
  for (let i = 0; i < 20; i++) m.update({ x: 5, z: 5 });
  const all = m.wanted(5, 5).length; assert.equal(m.loadedKeys.length, all, 'everything in range eventually loads');
  assert.ok(m.loadedKeys.every((k) => { const [cx, cz] = k.split(',').map(Number); return cellDistance(cx, cz, 5, 5, 10) <= 15; }));
  // move 20 m: cells now 15..30 away must stay (hysteresis), > 30 unload
  m.update({ x: 25, z: 5 });
  assert.ok(m.isLoaded(-1, 0), 'cell -1,0 is 16 m away: kept by hysteresis');
  assert.ok(disposed.every((k) => { const [cx, cz] = k.split(',').map(Number); return cellDistance(cx, cz, 25, 5, 10) > 30; }), 'only cells beyond unloadRadius are disposed');
  for (let i = 0; i < 10; i++) m.update({ x: 60, z: 5 });
  assert.ok(!m.isLoaded(-1, 0) && disposed.includes('-1,0'), 'far cells unload');
  assert.ok(m.isLoaded(6, 0), 'new focus cell loaded');
  for (let i = 0; i < 20; i++) m.update({ x: 60, z: 5 }); // settle
  // oscillating across a border does not thrash
  for (let i = 0; i < 4; i++) m.update({ x: i % 2 ? 59 : 61, z: 5 }); // the union of both sides loads once
  const before = m.stats.loads + m.stats.unloads;
  for (let i = 0; i < 40; i++) m.update({ x: i % 2 ? 59 : 61, z: 5 });
  assert.equal(m.stats.loads + m.stats.unloads, before, 'no load/unload churn at a border');
  assert.throws(() => new ChunkManager({ loadRadius: 50, unloadRadius: 40 }));
  const b = bucketByCell([{ position: { x: 1, z: 1 } }, { position: { x: -1, z: 1 } }, { position: { x: 2, z: 3 } }], 10);
  assert.equal(b.get('0,0').length, 2); assert.equal(b.get('-1,0').length, 1);
  m.warm({ x: -200, z: 0 }); assert.ok(m.isLoaded(-20, 0), 'warm loads synchronously');
});

test('LOD: selection with hysteresis, cull distance and LODGroup visibility', () => {
  const th = [20, 60];
  assert.equal(selectLOD(10, th), 0); assert.equal(selectLOD(30, th), 1); assert.equal(selectLOD(100, th), 2);
  assert.equal(selectLOD(21, th, 0), 0, 'stays near just past the threshold');
  assert.equal(selectLOD(23, th, 0), 1, 'switches beyond threshold * 1.1');
  assert.equal(selectLOD(19, th, 1), 1, 'does not switch back immediately');
  assert.equal(selectLOD(17, th, 1), 0);
  assert.equal(selectLOD(70, th, 0), 2, 'jumps several levels at once');
  assert.equal(selectLOD(310, th, 2, { cull: 300 }), 2, 'cull also has hysteresis');
  assert.equal(selectLOD(340, th, 2, { cull: 300 }), -1);
  assert.equal(selectLOD(290, th, -1, { cull: 300 }), -1, 'reappears only well inside');
  assert.equal(selectLOD(250, th, -1, { cull: 300 }), 2);
  const near = new THREE.Object3D(), mid = new THREE.Object3D(), far = new THREE.Object3D();
  const lod = new LODGroup([{ object: near, distance: 0 }, { object: mid, distance: 30 }, { object: far, distance: 90 }], { cull: 400 });
  assert.equal(lod.update(new THREE.Vector3(5, 0, 0)), 0); assert.ok(near.visible && !mid.visible && !far.visible);
  assert.equal(lod.update(new THREE.Vector3(50, 0, 0)), 1); assert.ok(mid.visible && !near.visible);
  assert.equal(lod.update(new THREE.Vector3(200, 0, 0)), 2); assert.ok(far.visible);
  assert.equal(lod.update(new THREE.Vector3(500, 0, 0)), -1); assert.ok(!far.visible && !mid.visible && !near.visible);
  assert.equal(lod.switches, 4);
});

test('schedules: activity by hour (midnight wrap), jitter, travel, time-jump teleport, interrupt + resume', () => {
  const s = makeSchedule('worker');
  assert.equal(activityAt(s, 3).activity, 'sleep'); assert.equal(activityAt(s, 23).activity, 'sleep');
  assert.equal(activityAt(s, 10).activity, 'work'); assert.equal(activityAt(s, 12.5).activity, 'eat'); assert.equal(activityAt(s, 18).activity, 'shop'); assert.equal(activityAt(s, 20).activity, 'home');
  assert.ok(inSpan(1, 22, 6) && !inSpan(12, 22, 6));
  const j = jitterSchedule(s, new RNG(4), 0.5);
  for (let h = 0; h < 24; h += 0.25) assert.ok(!activityAt(j, h).fallback, 'jittered schedule has no gaps at ' + h);
  assert.ok(j.some((e, i) => e.from !== s[i].from));
  const reg = new PlaceRegistry([{ id: 'home', kind: 'home', x: 0, z: 0 }, { id: 'office', kind: 'work', x: 40, z: 0 }, { id: 'cafe', kind: 'eat', x: 20, z: 20 }, { id: 'mall', kind: 'shop', x: -20, z: 10 }]);
  const a = new ScheduleAgent({ schedule: 'worker', registry: reg, seed: 3, jitter: 0, position: new THREE.Vector3(0, 0, 0) });
  const sys = new ScheduleSystem(); sys.add(a);
  sys.update(1 / 30, 11.95); // first update teleports into the current activity
  assert.equal(a.activity, 'work'); assert.ok(Math.hypot(a.position.x - 40, a.position.z) < 3.5, 'starts at work');
  // walk in real time from work to the cafe at noon
  let h = 11.95; for (let i = 0; i < 30 * 60; i++) { h += 0.0001; sys.update(1 / 30, h); }
  assert.equal(a.activity, 'eat'); assert.ok(Math.hypot(a.position.x - 20, a.position.z - 20) < 3.5, 'walked to the cafe');
  assert.equal(sys.jumps, 0);
  sys.update(1 / 30, 2); // time skip to the night
  assert.equal(sys.jumps, 1); assert.equal(a.activity, 'sleep'); assert.equal(a.state, 'inside'); assert.equal(a.visible, false);
  assert.equal(a.interrupt({ type: 'flee', from: { x: 0, z: 0 } }), false, 'sleepers indoors ignore danger');
  sys.update(1 / 30, 14); assert.equal(a.activity, 'work');
  if (a.state === 'inside') { a.state = 'perform'; a.visible = true; }
  const n = sys.alarm(a.position.clone().add(new THREE.Vector3(2, 0, 0)), { radius: 10, duration: 2 });
  assert.equal(n, 1); assert.equal(a.state, 'flee');
  const p0 = a.position.clone(); for (let i = 0; i < 30; i++) sys.update(1 / 30, 14);
  assert.ok(a.position.x < p0.x - 2, 'flees away from the danger');
  for (let i = 0; i < 90; i++) sys.update(1 / 30, 14);
  assert.ok(!a.interruption && a.stats.resumes === 1, 'resumes the schedule after the scare');
  assert.ok(['travel', 'perform', 'inside'].includes(a.state));
});

test('wanted: heat -> levels, witnessed vs unseen crimes, cooldown decay after losing sight, unit quota', () => {
  assert.equal(levelForHeat(0), 0); assert.equal(levelForHeat(1), 1); assert.equal(levelForHeat(5.9), 2); assert.equal(levelForHeat(99), 5);
  const units = [], events = [];
  let visible = true;
  const w = new WantedSystem({ spawn: (pos) => { const u = { position: pos.clone() }; units.push(u); return u; }, despawn: (u) => units.splice(units.indexOf(u), 1), canSee: () => visible, cooldown: (l) => 2 + l, events: { emit: (t, d) => events.push([t, d.to]) } });
  const target = { position: new THREE.Vector3(0, 0, 0) };
  w.commit('theft', { position: target.position, witnessed: false });
  assert.equal(w.level, 0, 'unwitnessed theft only adds a little heat');
  w.commit('assault', { position: target.position }); assert.equal(w.level, 1); assert.equal(w.state, 'pursuit');
  w.update(0.1, target); assert.equal(w.units.length, 2, 'level 1 fields 2 units');
  w.commit('shooting', { position: target.position }); assert.equal(w.level, 2);
  w.update(0.1, target); assert.equal(w.units.length, 3);
  w.commit('murder', { position: target.position }); assert.equal(w.level, 3);
  for (let i = 0; i < 100; i++) w.update(0.1, target);
  assert.equal(w.level, 3, 'no decay while seen');
  visible = false; w.update(0.1, target); assert.equal(w.state, 'search');
  for (let i = 0; i < 49; i++) w.update(0.1, target);
  assert.equal(w.level, 3, 'cooldown (5 s at level 3) not yet over');
  for (let i = 0; i < 2; i++) w.update(0.1, target);
  assert.equal(w.level, 2, 'one level lost after the cooldown');
  visible = true; w.update(0.1, target); assert.equal(w.state, 'pursuit', 'spotted again');
  visible = false; for (let i = 0; i < 300; i++) w.update(0.1, target);
  assert.equal(w.level, 0); assert.equal(w.state, 'clear'); assert.equal(w.units.length, 0, 'units despawn when clear');
  assert.ok(events.some((e) => e[0] === 'wanted:clear') && events.filter((e) => e[0] === 'wanted:level').length >= 5);
  assert.equal(w.stats.peakLevel, 3);
});

test('wanted: pursuit target selection (chase nearest, flank others, search when lost)', () => {
  const tgt = new THREE.Vector3(0, 0, 0);
  const units = [[2, 0], [30, 0], [0, 5], [-20, -20], [10, 10]].map(([x, z]) => ({ position: new THREE.Vector3(x, 0, z) }));
  const seen = assignPursuit(units, tgt, tgt, { seen: true, closeIn: 2, flank: 7 });
  assert.equal(seen.length, 5);
  const chase = seen.filter((a) => a.mode === 'chase').map((a) => a.unit);
  assert.deepEqual(chase.sort(), [units[0], units[2]].sort(), 'two nearest chase');
  const flank = seen.filter((a) => a.mode === 'flank');
  assert.equal(flank.length, 3);
  for (const f of flank) assert.ok(Math.abs(f.goal.length() - 7) < 1e-6, 'flank goals ring the target');
  const ang = flank.map((f) => Math.atan2(f.goal.x, f.goal.z)); assert.ok(new Set(ang.map((a) => a.toFixed(2))).size === 3, 'distinct flank angles');
  const last = new THREE.Vector3(50, 0, 0);
  const lost = assignPursuit(units, tgt, last, { seen: false, searchRadius: 12 });
  const conv = lost.filter((a) => a.mode === 'converge'); assert.equal(conv.length, 1); assert.equal(conv[0].unit, units[1], 'nearest to last known converges');
  assert.ok(conv[0].goal.distanceTo(last) < 1e-6);
  for (const s of lost.filter((a) => a.mode === 'search')) assert.ok(Math.abs(s.goal.distanceTo(last) - 12) < 1e-6);
});

test('crowd: sidewalk routing stays on sidewalks, places from lots, pedestrians follow schedules (no human dataset)', () => {
  const city = generateCity({ seed: 5, blocks: 3, props: false });
  const net = sidewalkNetwork(city);
  assert.equal(net.nodes.length, 36);
  const a = net.project({ x: city.roadCenters[0] + 20, z: city.roadCenters[0] + 30 }), b = net.project({ x: city.roadCenters[3] - 20, z: city.roadCenters[3] - 30 });
  const path = net.path(a, b);
  assert.ok(path.length >= 3);
  let len = 0, prev = a; for (const p of path) { len += Math.hypot(p.x - prev.x, p.z - prev.z); prev = p; }
  assert.ok(len < 3 * city.pitch * 2.2, 'path is reasonably short: ' + len.toFixed(0));
  // every waypoint is on a sidewalk ring (never inside a lot)
  for (const p of path) { const q = net.project(p); assert.ok(Math.hypot(q.x - p.x, q.z - p.z) < 0.01); }
  const places = placesFromCity(city, net);
  assert.ok(places.of('home').length > 5 && places.of('work').length > 5 && places.of('eat').length > 0 && places.of('park').length > 0);
  const app = { scene: new THREE.Scene(), atmosphere: { timeOfDay: 9 } };
  const crowd = new Crowd(app, city, { count: 30, seed: 3 });
  assert.equal(crowd.ready, true, 'no humans -> ready immediately (mannequins only)');
  const view = new THREE.Vector3(0, 0, 0);
  for (let i = 0; i < 60; i++) crowd.update(1 / 30, view, 9);
  const i1 = crowd.info();
  assert.equal(i1.agents, 30); assert.equal(i1.near, 0, 'no realistic tier without app.humans');
  assert.ok(i1.mid > 0 && i1.mid + i1.hidden === 30);
  crowd.update(1 / 30, view, 3); // jump to night
  const i2 = crowd.info();
  assert.equal(i2.jumps, 1); assert.ok((i2.byActivity.sleep || 0) >= 24, 'most people sleep at 3 am: ' + JSON.stringify(i2.byActivity));
  assert.ok(i2.visible <= 6);
  crowd.update(1 / 30, view, 12.6);
  assert.ok((crowd.info().byActivity.eat || 0) >= 8, 'lunch time');
  const n = crowd.alarm(crowd.peds.find((p) => p.agent.visible).agent.position, { radius: 30 });
  assert.ok(n >= 1);
});

test('humans crowd LOD: 256 px skin, merged garments, no mouth/morphs, cheap clones sharing geometry', async () => {
  const H = await import('../../engine/humans.js');
  const { CLIP_LIBRARY } = await import('../../engine/animation/clips.js');
  const data = await H.loadHumanData();
  const draws = (o) => { let d = 0; o.traverse((m) => { if (m.isMesh && m.visible) d += Array.isArray(m.material) ? m.geometry.groups.length : 1; }); return d; };
  const full = H.assembleHuman(data, { seed: 4, textureSize: 128 });
  const crowd = H.assembleHuman(data, { seed: 4, lod: 'crowd' });
  assert.ok(draws(crowd) <= 5 && draws(full) >= 10, `draw calls full ${draws(full)} -> crowd ${draws(crowd)}`);
  assert.equal(crowd.userData.mesh.material[0].map.image.width, 256);
  assert.equal(crowd.userData.garments.length, 1); assert.ok(crowd.userData.garments[0].geometry.attributes.color);
  assert.equal(crowd.userData.face, null); assert.equal(Object.keys(crowd.userData.mesh.geometry.morphAttributes).length, 0);
  const c = H.cloneHuman(crowd);
  assert.equal(c.userData.mesh.geometry, crowd.userData.mesh.geometry, 'geometry shared');
  assert.notEqual(c.userData.skeleton, crowd.userData.skeleton, 'own skeleton');
  assert.equal(Object.keys(c.userData.bones).length, Object.keys(crowd.userData.bones).length);
  assert.ok(c.userData.bones.root && c.userData.bones.root !== crowd.userData.bones.root);
  // clips baked on the template drive the clone by bone name
  const clip = crowd.userData.retargeter.clipFromPoseFn('walk', CLIP_LIBRARY.walk);
  const mixer = new THREE.AnimationMixer(c); mixer.clipAction(clip).play(); mixer.update(0.3);
  const q0 = crowd.userData.bones['upperleg01.L'].quaternion, q1 = c.userData.bones['upperleg01.L'].quaternion;
  assert.ok(q0.angleTo(q1) > 0.05, 'clone animates independently of the template');
});
