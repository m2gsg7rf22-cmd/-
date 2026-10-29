import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../../engine/vendor/three/three.module.js';
import { PhysicsWorld } from '../../engine/physics/world.js';
import { Heightfield } from '../../engine/world/terrain.js';
import { RNG } from '../../engine/core/rng.js';
import { buildNavMesh, NavMesh, NavAgent, NavCrowd, navMeshPlanner } from '../../engine/ai/navmesh.js';
import { ScheduleAgent } from '../../engine/ai/schedules.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const B = (s) => ({ minX: -s, minZ: -s, maxX: s, maxZ: s });
const wall = (w, x, z, hx, hz, h = 3, y0 = 0) => w.addStatic({ type: 'box', x, y: y0 + h / 2, z, hx, hy: h / 2, hz });
// every segment of a path must be walkable and stay out of every collider footprint (+radius margin)
function assertClear(nm, world, path, margin = 0.3) {
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], n = Math.ceil(a.distanceTo(b) / 0.1);
    for (let k = 0; k <= n; k++) {
      const p = a.clone().lerp(b, k / n);
      for (const s of world.statics.values()) {
        if (s.maxY < p.y + 0.5 || s.minY > p.y + 1.7) continue; // only things at body height
        assert.ok(!world._insideXZ(s, p.x, p.z, margin), `path point ${p.toArray().map((v) => v.toFixed(2))} inside collider ${s.id}`);
      }
    }
    assert.ok(!nm.raycast(a, b).hit || a.distanceTo(b) < 0.05, `segment ${i} not walkable`);
  }
}

test('navmesh: routes around a wall, never through it; raycast and isWalkable agree', () => {
  const w = new PhysicsWorld();
  wall(w, 0, -1, 0.15, 7); // wall x=0, z -8..6, open at the north end
  const nm = buildNavMesh({ physics: w, bounds: B(10) });
  const path = nm.findPath(V(-5, 0, 0), V(5, 0, 0));
  assert.ok(path, 'path exists');
  assert.ok(path.some((p) => p.z > 6), 'detours around the wall end');
  assert.ok(NavMesh.pathLength(path) > 14 && NavMesh.pathLength(path) < 19, 'near-shortest detour: ' + NavMesh.pathLength(path).toFixed(2));
  assertClear(nm, w, path);
  assert.equal(nm.raycast(V(-5, 0, 0), V(5, 0, 0)).hit, true, 'straight line blocked by the wall');
  assert.ok(Math.abs(nm.raycast(V(-5, 0, 0), V(5, 0, 0)).point.x) < 1.1, 'hit point at the eroded wall border (0.15 face + radius rounded up to cells)');
  assert.equal(nm.raycast(V(-5, 0, 0), V(-5, 0, 5)).hit, false, 'open line is clear');
  assert.equal(nm.isWalkable(V(0, 0, 0)), false); assert.equal(nm.isWalkable(V(0.3, 0, 0)), false, 'agent radius eroded next to the wall');
  assert.equal(nm.isWalkable(V(-3, 0, 0)), true);
  const cp = nm.closestPoint(V(0, 0, 0)); assert.ok(cp && Math.abs(cp.x) >= 0.35 && Math.abs(cp.x) < 1, 'closestPoint snaps off the wall');
  // fully closed wall: no path
  const w2 = new PhysicsWorld(); wall(w2, 0, 0, 0.15, 12);
  const nm2 = buildNavMesh({ physics: w2, bounds: B(10) });
  assert.equal(nm2.findPath(V(-5, 0, 0), V(5, 0, 0)), null, 'wall spanning the bounds -> no path');
});

test('navmesh: stairs within maxClimb connect, too-tall steps and islands do not', () => {
  const w = new PhysicsWorld();
  // stairs (0.2 m risers) up to a 2 m platform at x 10..16
  for (let k = 1; k <= 10; k++) w.addStatic({ type: 'box', x: 2 + k * 0.4 - 0.2, y: k * 0.1, z: 0, hx: 0.2, hy: k * 0.1, hz: 1.5 });
  w.addStatic({ type: 'box', x: 9, y: 1, z: 0, hx: 3, hy: 1, hz: 3 }); // top at 2.0, x 6..12
  // tall steps (0.8 m) to a second platform
  for (let k = 1; k <= 3; k++) w.addStatic({ type: 'box', x: -2 - k * 0.6 + 0.3, y: k * 0.4, z: 8, hx: 0.3, hy: k * 0.4, hz: 1.5 });
  w.addStatic({ type: 'box', x: -6.8, y: 1.2, z: 8, hx: 3, hy: 1.2, hz: 3 }); // x -9.8..-3.8, touches the last step
  // island: 2 m block, no access
  w.addStatic({ type: 'box', x: 8, y: 1, z: -10, hx: 3, hy: 1, hz: 3 });
  const nm = buildNavMesh({ physics: w, bounds: B(16) });
  const up = nm.findPath(V(-2, 0, 0), V(10, 2, 0));
  assert.ok(up, 'stairs with 0.2 m risers are climbable');
  assert.ok(Math.abs(up[up.length - 1].y - 2) < 0.05, 'path ends on the platform top (y=2): ' + up[up.length - 1].y);
  assert.equal(nm.findPath(V(2, 0, 8), V(-9, 2.4, 8)), null, '0.8 m steps exceed maxClimb -> unreachable');
  assert.equal(nm.findPath(V(0, 0, -4), V(8, 2, -10)), null, 'unreachable island -> null');
  const isl = nm.findNearest(V(8, 2, -10)); assert.ok(isl && Math.abs(isl.point.y - 2) < 0.01, 'island top is walkable (own region)');
  assert.notEqual(isl.region, nm.findNearest(V(0, 0, -4)).region);
  // same island becomes reachable with a larger maxClimb
  const nm2 = buildNavMesh({ physics: w, bounds: B(16), maxClimb: 0.85 });
  assert.ok(nm2.findPath(V(2, 0, 8), V(-9, 2.4, 8)), 'maxClimb 0.85 accepts the 0.8 m steps');
  // ramp shapes and sloped terrain respect maxSlope
  const nm3 = buildNavMesh({ bounds: B(12), colliders: [
    { type: 'ramp', x: 0, z: 0, hx: 1.5, hz: 4, y0: 0, y1: 2 }, // 14 deg
    { type: 'box', x: 0, z: 6, hx: 2, hz: 2, y: 1, hy: 1 },
    { type: 'ramp', x: 6, z: 0, hx: 1.5, hz: 0.6, y0: 0, y1: 2 }, // 59 deg
    { type: 'box', x: 6, z: 2.6, hx: 2, hz: 2, y: 1, hy: 1 },
  ] });
  const r = nm3.findPath(V(0, 0, -7), V(0, 2, 6));
  assert.ok(r && Math.abs(r[r.length - 1].y - 2) < 0.05, 'gentle ramp walkable to the top');
  assert.equal(nm3.findPath(V(6, 0, -5), V(6, 2, 3.5)), null, 'ramp steeper than maxSlope is not');
});

test('navmesh: multi-level bridge — walk under it and over it, levels stay separate', () => {
  const w = new PhysicsWorld();
  // deck at y 3 (2.7..3.0) along x -8..8, z -1.5..1.5; stairs up at the west end (0.2 m risers along -x)
  w.addStatic({ type: 'box', x: 0, y: 2.85, z: 0, hx: 8, hy: 0.15, hz: 1.5 });
  for (let k = 1; k <= 15; k++) w.addStatic({ type: 'box', x: -8 - (16 - k) * 0.35 + 0.175, y: k * 0.1, z: 0, hx: 0.175, hy: k * 0.1, hz: 1.5 });
  // walls along the street so the ground route has to pass under the bridge
  wall(w, -3, 6, 0.2, 4); wall(w, -3, -6, 0.2, 4);
  const nm = buildNavMesh({ physics: w, bounds: B(16) });
  const under = nm.findPath(V(-6, 0, 6), V(4, 0, -6));
  assert.ok(under, 'ground path exists');
  assert.ok(under.every((p) => p.y < 0.5), 'ground path stays on the ground (under the deck)');
  const deckPt = nm.findNearest(V(2, 3, 0));
  assert.ok(deckPt && Math.abs(deckPt.point.y - 3) < 0.01, 'deck is a walkable level');
  const groundPt = nm.findNearest(V(2, 0, 0));
  assert.ok(groundPt && groundPt.point.y < 0.1 && groundPt.poly !== deckPt.poly, 'ground under the deck is a separate polygon');
  const over = nm.findPath(V(-14, 0, 0), V(6, 3, 0));
  assert.ok(over && Math.abs(over[over.length - 1].y - 3) < 0.05, 'climbs the stairs onto the deck');
  assert.ok(over.every((p) => p.x < -13.9 || p.y > 0.05 || p.x < -8), 'reaches the deck via the stairs');
  assert.equal(nm.isWalkable(V(2, 3, 0)), true); assert.equal(nm.isWalkable(V(2, 1.5, 0)), false, 'mid-air between levels is not walkable');
  assert.ok(Math.abs(nm.heightAt(2, 0, 2.9) - 3) < 0.01 && Math.abs(nm.heightAt(2, 0, 0.2)) < 0.01, 'heightAt picks the level nearest to nearY');
});

test('navmesh: dynamic obstacles invalidate tiles and reroute; removal restores', () => {
  const w = new PhysicsWorld();
  // two corridors between x=-10 and x=10: short one at z=0, long one at z=8
  wall(w, 0, 4, 10, 1.5); wall(w, 0, -3, 10, 1.5); wall(w, 0, 12, 10, 1.5);
  // corridor at z=0 between walls ending 1.5 and -1.5: 3 m wide; corridor at z=8 between 5.5 and 10.5
  // bounds hug the corridors (z -1.5..10.5): the only routes are the two corridors joined at x = ±10..16
  const nm = buildNavMesh({ physics: w, bounds: { minX: -16, maxX: 16, minZ: -1.5, maxZ: 10.5 } });
  const a = V(-13, 0, 0.5), b = V(13, 0, 0.5);
  const p0 = nm.findPath(a, b), L0 = NavMesh.pathLength(p0);
  assert.ok(p0.every((p) => p.z < 2), 'short corridor first');
  const v0 = nm.version;
  const car = nm.addObstacle({ x: 0, z: 0, hx: 2.2, hz: 1.5, yaw: 0, y: 0.75, hy: 0.75 }); // parked car fills the corridor
  const p1 = nm.findPath(a, b);
  assert.ok(nm.version > v0, 'version bumped (agents re-plan)');
  assert.ok(p1 && p1.some((p) => p.z > 6), 'reroutes through the far corridor');
  assert.ok(NavMesh.pathLength(p1) > L0 + 5);
  for (let i = 1; i < p1.length; i++) for (let k = 0; k <= 50; k++) { const q = p1[i - 1].clone().lerp(p1[i], k / 50); assert.ok(!(Math.abs(q.x) < 2.4 && Math.abs(q.z) < 1.7), 'rerouted path keeps off the car'); }
  assert.equal(nm.isWalkable(V(0, 0, 0)), false, 'obstacle area blocked');
  assert.equal(nm.raycast(V(-5, 0, 0), V(5, 0, 0)).hit, true);
    nm.removeObstacle(car);
  const p2 = nm.findPath(a, b);
  assert.deepEqual(p2.map((v) => v.toArray()), p0.map((v) => v.toArray()), 'removal restores the original path');
  // door: block both corridors -> no path; a Box3 obstacle works too
  const d1 = nm.addObstacle(new THREE.Box3(V(-0.5, 0, -1.6), V(0.5, 2.5, 2.6)));
  const d2 = nm.addObstacle({ x: 0, z: 8, hx: 0.3, hz: 3 });
  assert.equal(nm.findPath(a, b), null, 'both doors closed -> null');
  nm.removeObstacle(d2); assert.ok(nm.findPath(a, b), 'one door opened -> path again');
  nm.removeObstacle(d1);
});

test('navmesh: deterministic build, queries and serialization round trip', () => {
  const make = () => {
    const w = new PhysicsWorld(), rng = new RNG(5);
    for (let k = 0; k < 25; k++) wall(w, rng.range(-12, 12), rng.range(-12, 12), rng.range(0.3, 2), rng.range(0.3, 2), 2.5);
    return buildNavMesh({ physics: w, bounds: B(15) });
  };
  const a = make(), b = make();
  assert.equal(JSON.stringify({ ...a.toJSON(), stats: 0 }), JSON.stringify({ ...b.toJSON(), stats: 0 }), 'identical builds');
  const qa = [], qb = [], ra = new RNG(9), rb = new RNG(9);
  for (let k = 0; k < 20; k++) { qa.push(a.findPath(a.randomPoint(ra), a.randomPoint(ra))?.map((v) => v.toArray())); qb.push(b.findPath(b.randomPoint(rb), b.randomPoint(rb))?.map((v) => v.toArray())); }
  assert.deepEqual(qa, qb, 'identical paths for identical seeds');
  a.addObstacle({ x: 0, z: 0, hx: 1, hz: 1 });
  const json = JSON.stringify(a.toJSON());
  const c = NavMesh.fromJSON(JSON.parse(json));
  assert.equal(c.info().polys, a.info().polys, 'same polygon count after load');
  const rc = new RNG(3), ra2 = new RNG(3);
  for (let k = 0; k < 10; k++) {
    const s = a.randomPoint(ra2), e = a.randomPoint(ra2); c.randomPoint(rc); c.randomPoint(rc);
    assert.deepEqual(c.findPath(s, e)?.map((v) => v.toArray()), a.findPath(s, e)?.map((v) => v.toArray()), 'same path after fromJSON (obstacles kept)');
  }
  const dbg = a.debugMesh({ portals: true });
  assert.ok(dbg.children.length === 3 && dbg.userData.triangles > 1000, 'debug mesh with surface, outlines, portals');
});

test('navmesh: terrain heightfield (slopes) + seeds prune unreachable regions', () => {
  const hf = new Heightfield({ size: 60, resolution: 60, seed: 3, height: 14, type: 'hills' });
  const w = new PhysicsWorld({ heightfield: hf });
  const nm = buildNavMesh({ physics: w, cellSize: 0.5, maxSlope: 35 });
  const info = nm.info();
  assert.ok(info.walkableSpans > 0 && info.polys > 0);
  const r = new RNG(1); let found = 0;
  for (let k = 0; k < 10; k++) {
    const s = nm.randomPoint(r, { region: 0 }), e = nm.randomPoint(r, { region: 0 });
    const p = nm.findPath(s, e); if (!p) continue; found++;
    for (const q of p) assert.ok(Math.abs(q.y - hf.heightAt(q.x, q.z)) < 0.6, 'path corners hug the terrain');
  }
  assert.ok(found >= 8, 'paths inside one region are found: ' + found);
  const seeded = buildNavMesh({ physics: w, cellSize: 0.5, maxSlope: 35, seeds: [nm.randomPoint(new RNG(2), { region: 0 })] });
  assert.equal(seeded.info().regions, 1, 'seeds keep only the reachable region');
});

test('navmesh: NavAgent/NavCrowd — head-on agents avoid each other, arrive, never leave the mesh', () => {
  const w = new PhysicsWorld();
  wall(w, 0, 3.5, 10, 0.3); wall(w, 0, -3.5, 10, 0.3); // corridor 6.4 m wide
  wall(w, 0, 0, 0.5, 0.5); // pillar in the middle
  const nm = buildNavMesh({ physics: w, bounds: B(12) });
  const crowd = new NavCrowd(nm);
  const pairs = [[-8, -1.2, 8, -1.2], [8, -1.2, -8, -1.2], [-8, 1.2, 8, 1.2], [8, 1.2, -8, 1.2], [-8, 0, 8, 0], [8, 0, -8, 0]];
  const agents = pairs.map(([x, z, tx, tz]) => { const a = crowd.add(new NavAgent(nm, { position: V(x, 0, z), maxSpeed: 1.5 })); assert.ok(a.setDestination(V(tx, 0, tz))); return a; });
  let minD = Infinity, offMesh = 0;
  for (let f = 0; f < 60 * 25 && !agents.every((a) => a.arrived); f++) {
    crowd.update(1 / 60);
    for (let i = 0; i < agents.length; i++) {
      if (!nm.isWalkable(agents[i].position)) offMesh++;
      for (let j = i + 1; j < agents.length; j++) minD = Math.min(minD, agents[i].position.distanceTo(agents[j].position));
    }
  }
  assert.equal(offMesh, 0, 'agents stay on the walkable mesh (no wall clipping)');
  assert.ok(agents.every((a) => a.arrived), 'all agents arrive: ' + agents.map((a) => a.state).join(','));
  assert.ok(minD > 0.5, 'avoidance keeps bodies apart (min centre distance ' + minD.toFixed(2) + ' m, radii 0.35)');
  // re-plan around a newly added obstacle
  const solo = new NavAgent(nm, { position: V(-8, 0, 0) }); solo.setDestination(V(8, 0, 0));
  for (let f = 0; f < 60; f++) solo.update(1 / 60);
  nm.addObstacle({ x: -2, z: -1, hx: 1, hz: 1.5 });
  for (let f = 0; f < 60 * 20 && !solo.arrived; f++) { solo.update(1 / 60); assert.equal(nm.isWalkable(solo.position), true); }
  assert.ok(solo.arrived && solo.stats.repaths >= 2, 'agent re-planned after the obstacle and arrived');
});

test('navmesh: navMeshPlanner drives a ScheduleAgent around buildings', () => {
  const w = new PhysicsWorld();
  wall(w, 0, 0, 3, 3, 6); // a building between home and work
  const nm = buildNavMesh({ physics: w, bounds: B(10) });
  const agent = new ScheduleAgent({ schedule: [[6, 18, 'work', 'work'], [18, 6, 'work', 'work']], places: { work: { id: 'w', x: 6, z: 0, radius: 0 } }, position: V(-6, 0, 0), planner: navMeshPlanner(nm), jitter: 0,
    activities: { work: { inside: 0, radius: 0, pause: [100, 100] } } });
  let inside = 0;
  for (let f = 0; f < 60 * 20; f++) { agent.update(1 / 60, 10); if (w._insideXZ([...w.statics.values()][0], agent.position.x, agent.position.z, 0)) inside++; } // ScheduleAgent cuts corners by its 0.9 m waypoint reach: centre-only check
  assert.equal(inside, 0, 'never walks through the building');
  assert.ok(Math.hypot(agent.position.x - 6, agent.position.z) < 1.5, 'reached work');
  assert.ok((([p]) => p.x === -6)(navMeshPlanner(nm)(V(-6, 0, 0), V(60, 0, 60))), 'target off the mesh -> stay fallback');
});

test('navmesh: performance on a 100x100 m city-like layout (reported)', () => {
  const w = new PhysicsWorld(), rng = new RNG(42);
  // 6x6 blocks of 12 m with 5 m streets, buildings, sidewalk curbs (0.15 m), props, a few bridges
  for (let bi = 0; bi < 6; bi++) for (let bj = 0; bj < 6; bj++) {
    const cx = -50 + 8.5 + bi * 17, cz = -50 + 8.5 + bj * 17;
    w.addStatic({ type: 'box', x: cx, y: 0.075, z: cz, hx: 6.5, hy: 0.075, hz: 6.5 }); // sidewalk slab
    const n = rng.int(1, 3);
    for (let k = 0; k < n; k++) w.addStatic({ type: 'box', x: cx + rng.range(-2, 2), y: 6, z: cz + rng.range(-2, 2), hx: rng.range(2, 4), hy: 6, hz: rng.range(2, 4), yaw: rng.range(-0.3, 0.3) });
    for (let k = 0; k < 4; k++) w.addStatic({ type: 'cylinder', x: cx + rng.range(-6, 6), y: 0.15, z: cz + rng.pick([-6, 6]), r: 0.15, h: 3 }); // lamp posts
  }
  const t0 = performance.now();
  const nm = buildNavMesh({ physics: w, bounds: B(50) });
  const buildMs = performance.now() - t0;
  const info = nm.info();
  const r = new RNG(7), pts = []; for (let k = 0; k < 200; k++) pts.push(nm.randomPoint(r, { region: 0 }));
  const t1 = performance.now(); let ok = 0, len = 0;
  for (let k = 0; k < 100; k++) { const p = nm.findPath(pts[k * 2], pts[k * 2 + 1]); if (p) { ok++; len += NavMesh.pathLength(p); } }
  const qMs = (performance.now() - t1) / 100;
  const t2 = performance.now(); const json = JSON.stringify(nm.toJSON()); const loaded = NavMesh.fromJSON(json); const loadMs = performance.now() - t2;
  console.log(`  [navmesh perf] 100x100 m city, cellSize 0.3: build ${buildMs.toFixed(0)} ms (${JSON.stringify(info.timings)}), spans ${info.spans}, walkable ${info.walkableSpans}, polys ${info.polys}, regions ${info.regions}; ` +
    `findPath avg ${qMs.toFixed(2)} ms over 100 random queries (${ok} found, mean length ${(len / Math.max(1, ok)).toFixed(1)} m); JSON ${(json.length / 1024).toFixed(0)} KB, fromJSON ${loadMs.toFixed(0)} ms`);
  assert.ok(ok >= 95, 'random queries in the main region succeed');
  assert.equal(loaded.info().polys, info.polys);
  assert.ok(buildMs < 8000 && qMs < 20, 'within the documented budget');
});
