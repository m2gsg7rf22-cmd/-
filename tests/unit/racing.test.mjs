import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../../engine/vendor/three/three.module.js';
import { MaterialLibrary } from '../../engine/render/materials.js';
import { PhysicsWorld } from '../../engine/physics/world.js';
import { Vehicle } from '../../engine/physics/vehicle.js';
import { car } from '../../engine/geometry/vehicles.js';
import { generateTrack, addTrackPhysics, trackMesh } from '../../engine/world/track.js';
import { computeRacingLine, RaceAI, RaceManager, formatTime } from '../../engine/gameplay/racing.js';
MaterialLibrary.textureSize = 16;

const cross = (a, b, c, d) => { const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]); return (o(c, d, a) > 0) !== (o(c, d, b) > 0) && (o(a, b, c) > 0) !== (o(a, b, d) > 0); };

test('track: closed loop, non-self-intersecting, consistent frames, deterministic', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const t = generateTrack({ seed });
    assert.ok(t.isClosed(), `seed ${seed} closed`);
    const n = t.count, P = t.samples.map((s) => [s.x, s.z]);
    for (let i = 0; i < n; i++) { const a = P[i], b = P[(i + 1) % n]; assert.ok(Math.abs(Math.hypot(b[0] - a[0], b[1] - a[1]) - t.opts.spacing) < 0.3, 'uniform arc-length spacing'); }
    let hits = 0; for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) { if (i === 0 && j === n - 1) continue; if (cross(P[i], P[(i + 1) % n], P[j], P[(j + 1) % n])) hits++; }
    assert.equal(hits, 0, `seed ${seed} self-intersections`); assert.equal(t.selfIntersects(), false);
    assert.ok(t.minClearance() > t.opts.width + 2 * t.runoff, 'separate parts of the circuit keep clear of each other');
    assert.ok(t.length > 400 && t.length < 1600);
    const s = t.samples[10]; assert.ok(Math.abs(Math.hypot(s.tx, s.tz) - 1) < 1e-6 && Math.abs(s.tx * s.rx + s.tz * s.rz) < 1e-6);
    // projection round-trip and banked surface height
    const p = t.pointAt(123.4, 2.5), pr = t.project(p.x, p.z);
    assert.ok(Math.abs(pr.s - 123.4) < 0.6 && Math.abs(pr.lateral - 2.5) < 0.2, JSON.stringify(pr));
    assert.ok(Math.abs(t.heightAt(p.x, p.z) - p.y) < 0.08);
  }
  const a = generateTrack({ seed: 7 }), b = generateTrack({ seed: 7 });
  assert.equal(a.length, b.length); assert.equal(a.samples[50].x, b.samples[50].x);
});

test('track: checkpoints in order, start grid behind the line on the road, curbs on corners', () => {
  const t = generateTrack({ seed: 3, checkpoints: 8 });
  assert.equal(t.checkpoints.length, 8); assert.equal(t.checkpoints[0].s, 0);
  for (let k = 1; k < 8; k++) { assert.ok(t.checkpoints[k].s > t.checkpoints[k - 1].s); assert.ok(Math.abs(t.checkpoints[k].s - k * t.length / 8) < 1e-6); }
  assert.equal(t.startGrid.length, 8);
  for (const g of t.startGrid) { assert.ok(g.s > t.length * 0.8, 'slot behind the start line'); assert.ok(t.onTrack(g.position.x, g.position.z, -1), 'slot on the road'); }
  assert.ok(t.curbs.length > 0);
  const banked = t.samples.filter((s) => Math.abs(s.bank) > 0.02); assert.ok(banked.length > 0, 'corners are banked');
  for (const s of banked) assert.ok(Math.sign(s.bank) === Math.sign(s.curvature), 'banking leans into the corner');
});

test('racing line stays within track bounds and has braking points before tight corners', () => {
  for (const seed of [1, 3, 8]) {
    const t = generateTrack({ seed }), line = computeRacingLine(t);
    assert.ok(line.withinBounds(), `seed ${seed} offsets inside the limits`);
    for (const p of line.points) { const pr = t.project(p.x, p.z); assert.ok(Math.abs(pr.lateral) <= pr.frame.halfWidth, 'line point on the road'); }
    assert.ok(line.brakingPoints.length > 0);
    for (const b of line.brakingPoints) assert.ok(b.entrySpeed > b.apexSpeed);
    // the line cuts corners: on average it is straighter than the centreline
    const centre = computeRacingLine(t, { margin: 1e3 }); // same estimator, line pinned to the centre
    assert.ok(centre.offsets.every((o) => o === 0));
    assert.ok(line.lapTime < centre.lapTime, `racing line is faster: ${line.lapTime.toFixed(2)} s vs centreline ${centre.lapTime.toFixed(2)} s`);
    assert.ok(line.lineLength < centre.lineLength);
  }
});

test('race manager: lap timing, splits, ordered checkpoints, positions, wrong way', () => {
  const t = generateTrack({ seed: 2 });
  const mk = () => ({ position: new THREE.Vector3(), velocity: new THREE.Vector3(), yaw: 0, s: 0, resetOnRoad(p, yaw) { this.position.copy(p); this.yaw = yaw; this.velocity.set(0, 0, 0); } });
  const race = new RaceManager(t, { laps: 2, countdown: 1 });
  const fast = race.add(mk(), { name: 'fast', isPlayer: true }), slow = race.add(mk(), { name: 'slow' });
  race.placeOnGrid(); race.start();
  const drive = (e, v, dt) => { const pr = t.project(e.vehicle.position.x, e.vehicle.position.z); const f = t.sampleAt(pr.s + v * dt); e.vehicle.position.set(f.x, f.y, f.z); e.vehicle.velocity.set(f.tx * v, 0, f.tz * v); };
  const dt = 1 / 60; let f = 0;
  while (race.state !== 'finished' && f++ < 60 * 200) { if (race.state === 'racing') { drive(fast, 40, dt); drive(slow, 30, dt); } race.update(dt); }
  assert.equal(fast.finished, true); assert.equal(fast.lapTimes.length, 2);
  assert.ok(Math.abs(fast.lapTimes[1] - t.length / 40) < 0.1, `flying lap ${fast.lapTimes[1]} vs ${t.length / 40}`);
  assert.ok(fast.lapTimes[0] > fast.lapTimes[1], 'lap 1 is timed from GO, so it includes the run from the grid to the line');
  assert.equal(fast.cpCount, 2 * t.checkpoints.length + 1);
  const sp = fast.splits[1].filter((x) => x !== undefined); assert.equal(sp.length, t.checkpoints.length - 1); for (let i = 1; i < sp.length; i++) assert.ok(sp[i] > sp[i - 1]);
  assert.equal(fast.position, 1); assert.equal(slow.position, 2); assert.equal(fast.bestLap, Math.min(...fast.lapTimes));
  assert.match(formatTime(fast.lapTimes[1]), /^\d+:\d\d\.\d{3}$/);
  // wrong-way detection + skipped checkpoints cannot be counted by teleporting back and forth
  const r2 = new RaceManager(t, { laps: 1, countdown: 0.1 }); const e = r2.add(mk(), { isPlayer: true }); r2.placeOnGrid(); r2.start();
  for (let i = 0; i < 30; i++) r2.update(dt);
  for (let i = 0; i < 90; i++) { drive(e, -15, dt); r2.update(dt); }
  assert.ok(e.wrongWay, 'driving backwards flags wrong way'); assert.equal(e.cpCount, 0);
});

test('AI racers complete a lap on a generated track with the raycast vehicle', () => {
  const t = generateTrack({ seed: 4 }), line = computeRacingLine(t), w = new PhysicsWorld(); addTrackPhysics(w, t);
  const race = new RaceManager(t, { laps: 1, countdown: 0.5 }), cars = [];
  for (let i = 0; i < 4; i++) { const v = new Vehicle(w, car({ type: ['sedan', 'sports', 'suv', 'van'][i], detail: 'low', seed: i }), { enginePower: 24, maxSpeed: 56 }); cars.push(v); race.add(v, { name: 'AI' + i, ai: new RaceAI(v, t, line, { skill: 0.9 + 0.03 * i, laneOffset: (i % 2 ? 1 : -1) }) }); }
  race.placeOnGrid(); race.start();
  for (let f = 0; f < 60 * 90 && race.state !== 'finished'; f++) { if (race.state === 'racing') for (const e of race.entrants) e.ai.update(1 / 60, cars); for (const v of cars) v.update(1 / 60); race.update(1 / 60); }
  for (const e of race.entrants) { assert.ok(e.finished, `${e.name} finished a lap`); assert.ok(e.lapTimes[0] > 10 && e.lapTimes[0] < 80); }
  assert.deepEqual(race.entrants.map((e) => e.position).sort(), [1, 2, 3, 4]);
});

test('track mesh: road, curbs, barriers and ground build with sane geometry', () => {
  const t = generateTrack({ seed: 3 }), g = trackMesh(t, { groundRes: 12 });
  const road = g.getObjectByName('road'), ground = g.getObjectByName('ground');
  assert.ok(road && ground);
  const pos = road.geometry.attributes.position; let bad = 0; for (let i = 0; i < pos.count; i++) if (!Number.isFinite(pos.getY(i))) bad++;
  assert.equal(bad, 0); assert.equal(pos.count, (t.count + 1) * 2);
  assert.ok(road.geometry.attributes.normal.getY(0) > 0.9, 'road faces up');
  let meshes = 0; g.traverse((o) => { if (o.isMesh) meshes++; }); assert.ok(meshes > 8);
  const w = new PhysicsWorld(), bars = addTrackPhysics(w, t); assert.ok(bars.length > 100 && bars.every((b) => b.userData.noGround));
  const p = t.pointAt(40, 0); assert.ok(Math.abs(w.groundHeight(p.x, p.z, p.y + 1).y - p.y) < 0.08, 'vehicle ground = track surface');
});
