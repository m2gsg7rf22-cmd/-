// Navmesh integration scene (engine test, not a game): buildings, a walled courtyard with a door,
// a bridge with stairs over a street (multi-level), a ramp to a platform, pillars and crates.
// 14 NavAgents (mannequins) roam between points of interest with reciprocal avoidance; a debug
// overlay shows the navmesh polygons and every agent's path. Dynamic obstacles: a parked car
// under the bridge (reroute) and a closing door (courtyard unreachable). Driven by playtest.json.
import * as GF from '../../../engine/index.js';
const { THREE } = GF;

const app = new GF.GameApp({ id: 'scene-navmesh', title: 'Navmesh', container: document.getElementById('game'), timeOfDay: 10, fov: 50,
  atmosphere: { fogDensity: 0.004, shadowRange: 50 } });
const P = app.physics, S = app.scene;

// ---------- level (visual + physics statics) ----------
const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80).rotateX(-Math.PI / 2), GF.pbr('concrete', { repeat: 20 }));
ground.receiveShadow = true; S.add(ground);
const street = new THREE.Mesh(new THREE.PlaneGeometry(80, 6).rotateX(-Math.PI / 2), GF.pbr('asphalt', { repeat: [20, 2] }));
street.position.set(0, 0.01, 6); street.receiveShadow = true; S.add(street);
const box = (x, y0, z, sx, sy, sz, mat, { yaw = 0, collide = true } = {}) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat); m.position.set(x, y0 + sy / 2, z); m.rotation.y = yaw; m.castShadow = m.receiveShadow = true; S.add(m);
  if (collide) P.addStatic({ type: 'box', x, y: y0 + sy / 2, z, hx: sx / 2, hy: sy / 2, hz: sz / 2, yaw });
  return m;
};
const M = { building: GF.pbr('plaster', { color: 0xc9b9a0 }), building2: GF.pbr('brick'), wall: GF.pbr('brick', { color: 0xb07a5a }), deck: GF.pbr('planks'), stone: GF.pbr('concrete', { color: 0x9a9a96 }),
  crate: GF.pbr('planks', { color: 0x9a7040 }), rail: GF.solid(0x3a3f46, { metalness: 0.6, roughness: 0.4 }), door: GF.solid(0x6a3a1a), ramp: GF.pbr('concrete', { color: 0x8c8a80 }) };
// buildings
box(-20, 0, -18, 10, 8, 8, M.building); box(20, 0, -16, 8, 10, 10, M.building2); box(-20, 0, 18, 9, 6, 9, M.building2); box(20, 0, 17, 8, 12, 8, M.building);
// courtyard (centre 0,-14), doorway 2.4 m wide in the north wall at x -1.2..1.2
const WT = 0.3, WH = 2.5;
box(-3.6, 0, -10, 4.8, WH, WT, M.wall); box(3.6, 0, -10, 4.8, WH, WT, M.wall); box(0, 0, -18, 12, WH, WT, M.wall);
box(-6, 0, -14, WT, WH, 8, M.wall); box(6, 0, -14, WT, WH, 8, M.wall);
// bridge over the street: deck top y = 3 (x -6..6, z 4.5..7.5), 15 steps of 0.2 m at each end, railings
box(0, 2.7, 6, 12, 0.3, 3, M.deck);
for (let k = 1; k <= 15; k++) { const run = (16 - k) * 0.35; box(-6 - run + 0.175, 0, 6, 0.35, k * 0.2, 3, M.stone); box(6 + run - 0.175, 0, 6, 0.35, k * 0.2, 3, M.stone); }
box(0, 3, 4.55, 12, 1, 0.1, M.rail); box(0, 3, 7.45, 12, 1, 0.1, M.rail);
// ramp (navmesh-only wedge, physics has no sloped collider) to a 1.5 m platform
const ramp = { type: 'ramp', x: 16, z: 0, hx: 1.5, hz: 3, yaw: Math.PI / 2, y0: 0, y1: 1.5, base: -0.1 };
{
  const g = new THREE.BufferGeometry(), x0 = 13, x1 = 19, z0 = -1.5, z1 = 1.5, h = 1.5;
  const v = [x0, 0, z0, x1, h, z0, x1, h, z1, x0, 0, z0, x1, h, z1, x0, 0, z1, x1, 0, z0, x1, h, z0, x0, 0, z0, x0, 0, z1, x1, h, z1, x1, 0, z1, x1, 0, z0, x1, 0, z1, x1, h, z1, x1, 0, z0, x1, h, z1, x1, h, z0];
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); g.computeVertexNormals();
  const uv = []; for (let i = 0; i < v.length / 3; i++) uv.push(v[i * 3] * 0.5, v[i * 3 + 2] * 0.5); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  const m = new THREE.Mesh(g, M.ramp); m.castShadow = m.receiveShadow = true; m.material.side = THREE.DoubleSide; S.add(m);
}
box(22, 0, 0, 6, 1.5, 6, M.stone);
// plaza props: pillars + crates
for (const [x, z] of [[-10, -3], [-6, -5], [9, -5], [11, -1]]) { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.45, 3.2, 16), M.stone); c.position.set(x, 1.6, z); c.castShadow = true; S.add(c); P.addStatic({ type: 'cylinder', x, y: 0, z, r: 0.45, h: 3.2 }); }
box(-12, 0, 10, 1.2, 1.2, 1.2, M.crate, { yaw: 0.3 }); box(-10.6, 0, 10.8, 1, 1, 1, M.crate); box(10, 0, 10, 1.4, 1.1, 1.4, M.crate, { yaw: -0.4 });

// ---------- navmesh ----------
const seed = new THREE.Vector3(0, 0, 0);
const t0 = performance.now();
const nav = app.buildNavMesh({ bounds: { minX: -30, minZ: -30, maxX: 30, maxZ: 30 }, colliders: [ramp], seeds: [seed] });
const navBuildMs = performance.now() - t0;
const navInfo0 = nav.info();

// ---------- overlay ----------
let overlay = null, overlayOn = true;
function rebuildOverlay() { if (overlay) { S.remove(overlay); overlay.traverse((o) => o.geometry?.dispose()); } overlay = nav.debugMesh({ opacity: 0.45 }); overlay.visible = overlayOn; S.add(overlay); }
rebuildOverlay();

// ---------- agents ----------
const POI = [new THREE.Vector3(0, 3, 6), new THREE.Vector3(0, 0, -14), new THREE.Vector3(22, 1.5, 0), new THREE.Vector3(-14, 0, 0), new THREE.Vector3(12, 0, -8), new THREE.Vector3(2, 0, 6),
  new THREE.Vector3(-12, 0, 13), new THREE.Vector3(10, 0, 13), new THREE.Vector3(-3, 3, 6), new THREE.Vector3(-2, 0, -16), new THREE.Vector3(16, 0, -5), new THREE.Vector3(-22, 0, 4)];
const crowd = new GF.NavCrowd(nav);
const rng = new GF.RNG(17), COLORS = [0xd04020, 0x2060c0, 0x30a050, 0xe0b020, 0x8040a0, 0x20a0a0, 0xe07030, 0x606060, 0xc03070, 0x4080e0, 0x90b030, 0x703020, 0xf0f0f0, 0x204030];
const agents = [];
for (let i = 0; i < 14; i++) {
  const start = POI[(i * 5) % POI.length].clone().add(new THREE.Vector3(rng.range(-1.5, 1.5), 0, rng.range(-1.5, 1.5)));
  const a = crowd.add(new GF.NavAgent(nav, { position: start, maxSpeed: rng.range(1.3, 1.9) }));
  const model = GF.createHumanoid({ height: rng.range(1.62, 1.88), outfit: 'casual', top: COLORS[i], bottom: 0x2a2a30, hairStyle: rng.pick(['short', 'long', 'ponytail', 'buzz']) });
  model.traverse((o) => { if (o.isMesh) o.castShadow = true; }); S.add(model);
  const anim = new GF.HumanoidAnimator(model);
  const line = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: COLORS[i], depthTest: false, transparent: true, opacity: 0.9 })); line.renderOrder = 6; line.frustumCulled = false; S.add(line);
  agents.push({ a, model, anim, line, rng: rng.fork(i + 1), wait: 0, poi: i % POI.length, arrivals: 0 });
}
const stats = { arrivals: 0, offMesh: 0, wallClips: 0, carClips: 0, minPair: Infinity, deck: 0, platform: 0, courtyard: 0, underBridge: 0, nopath: 0, frames: 0, maxStuck: 0 };
const visited = { deck: new Set(), platform: new Set(), courtyard: new Set() };
function nextGoal(ag) {
  ag.poi = (ag.poi + 1 + ag.rng.int(0, 3)) % POI.length;
  const g = POI[ag.poi].clone().add(new THREE.Vector3(ag.rng.range(-1, 1), 0, ag.rng.range(-0.8, 0.8)));
  if (!ag.a.setDestination(g)) { stats.nopath++; ag.wait = 0.5; }
}
for (const ag of agents) nextGoal(ag);

// dynamic obstacles
let car = null, carId = 0, doorId = 0, doorMesh = null;
const carBox = { x: -2.5, z: 6, hx: 2.4, hz: 1.0, y: 0.7, hy: 0.7 };
const scene = {
  parkCar() {
    if (carId) return;
    car = GF.car({ type: 'sedan', color: 0x2a5a9a }); car.position.set(carBox.x, 0, carBox.z); car.rotation.y = Math.PI / 2; S.add(car);
    carId = nav.addObstacle(carBox); rebuildOverlay();
  },
  removeCar() { if (!carId) return; nav.removeObstacle(carId); carId = 0; S.remove(car); car = null; rebuildOverlay(); },
  closeDoor() { if (doorId) return; doorMesh = box(0, 0, -10, 2.4, 2.2, 0.12, M.door, { collide: false }); doorId = nav.addObstacle({ x: 0, z: -10, hx: 1.25, hz: 0.1, y: 1.1, hy: 1.1 }); rebuildOverlay(); },
  openDoor() { if (!doorId) return; nav.removeObstacle(doorId); doorId = 0; S.remove(doorMesh); doorMesh = null; rebuildOverlay(); },
  path(a, b) { const p = nav.findPath(new THREE.Vector3(...a), new THREE.Vector3(...b)); return p ? { n: p.length, length: +GF.NavMesh.pathLength(p).toFixed(2), points: p.map((v) => v.toArray().map((x) => +x.toFixed(2))) } : null; },
  pathAvoids(a, b, bx) { const p = nav.findPath(new THREE.Vector3(...a), new THREE.Vector3(...b)); if (!p) return null; for (let i = 1; i < p.length; i++) for (let k = 0; k <= 40; k++) { const q = p[i - 1].clone().lerp(p[i], k / 40); if (q.y < 1 && Math.abs(q.x - bx.x) < bx.hx && Math.abs(q.z - bx.z) < bx.hz) return false; } return true; },
  overlay(on = true) { overlayOn = on; if (overlay) overlay.visible = on; for (const ag of agents) ag.line.visible = on; },
  view(name) { camMode = name; },
  run(seconds) { window.__GF.step(Math.round(seconds * 60)); return window.__GF.state(); },
  carBox,
};
window.__GF.scene = scene;

// ---------- simulation ----------
const statics = [...P.statics.values()];
app.add((dt) => {
  crowd.update(dt);
  stats.frames++;
  for (let i = 0; i < agents.length; i++) {
    const ag = agents[i], a = ag.a, p = a.position;
    if (a.arrived || a.state === 'nopath' || a.state === 'idle') {
      if (a.arrived && !ag.counted) { ag.counted = true; ag.arrivals++; stats.arrivals++; ag.wait = ag.rng.range(0.5, 1.5); }
      ag.wait -= dt; if (ag.wait <= 0) { ag.counted = false; nextGoal(ag); }
    }
    if (!nav.isWalkable(p)) stats.offMesh++;
    // body (centre + 85 % of the radius) never inside a collider at body height, nor inside the parked car
    for (const s of statics) { if (s.maxY < p.y + 0.5 || s.minY > p.y + 1.6) continue; /* lower than a step = climbable */ if (P._insideXZ(s, p.x, p.z, a.radius * 0.85)) { stats.wallClips++; break; } }
    if (carId && p.y < 1 && Math.abs(p.x - carBox.x) < carBox.hx + a.radius * 0.85 && Math.abs(p.z - carBox.z) < carBox.hz + a.radius * 0.85) stats.carClips++;
    if (p.y > 2.8 && Math.abs(p.x) < 6) visited.deck.add(i);
    if (p.y > 1.4 && p.x > 19) visited.platform.add(i);
    if (p.z < -10.3 && Math.abs(p.x) < 5.8) visited.courtyard.add(i);
    if (p.y < 0.5 && Math.abs(p.x) < 5 && Math.abs(p.z - 6) < 1.3) stats.underBridge++;
    for (let j = i + 1; j < agents.length; j++) { const q = agents[j].a.position; if (Math.abs(q.y - p.y) < 1) stats.minPair = Math.min(stats.minPair, Math.hypot(q.x - p.x, q.z - p.z)); }
    stats.maxStuck = Math.max(stats.maxStuck, a.stats.stuck);
    // visuals
    ag.model.position.copy(p); ag.model.rotation.y = a.heading;
    ag.anim.setLocomotion(Math.hypot(a.velocity.x, a.velocity.z), true); ag.anim.update(dt);
  }
  if (stats.frames % 6 === 1) for (const ag of agents) {
    const path = ag.a.path, pts = path ? [ag.a.position.clone(), ...path.slice(ag.a.pathIndex)].map((v) => v.clone().setY(v.y + 0.12)) : [];
    ag.line.geometry.dispose(); ag.line.geometry = new THREE.BufferGeometry().setFromPoints(pts.length > 1 ? pts : [new THREE.Vector3(), new THREE.Vector3()]);
  }
}, { order: 0 });

// ---------- camera ----------
let camMode = 'overview';
const VIEWS = { overview: [[4, 46, 40], [0, 0, -1]], bridge: [[-15, 8, 17], [-1, 1.6, 5]], door: [[7, 10, -3], [0, 0, -13]], ramp: [[8, 7, 9], [19, 1, 0]] };
app.add(() => {
  const [p, l] = VIEWS[camMode] || VIEWS.overview;
  app.camera.position.set(...p); app.camera.lookAt(...l); app.atmosphere.setFocus?.(new THREE.Vector3(...l));
}, { order: 50, states: 'all' });

app.debugState = () => ({
  nav: { polys: nav.info().polys, regions: navInfo0.regions, walkableArea: navInfo0.walkableArea, buildMs: +navBuildMs.toFixed(1), timings: navInfo0.timings, spans: navInfo0.spans, obstacles: nav.obstacles.size, version: nav.version, overlayTriangles: overlay?.userData.triangles },
  agents: { count: agents.length, arrivals: stats.arrivals, offMesh: stats.offMesh, wallClips: stats.wallClips, carClips: stats.carClips, minPair: +stats.minPair.toFixed(3), nopath: stats.nopath, underBridge: stats.underBridge, maxStuck: stats.maxStuck,
    deckVisitors: visited.deck.size, platformVisitors: visited.platform.size, courtyardVisitors: visited.courtyard.size, states: crowd.info().byState, frames: stats.frames },
  car: !!carId, door: !!doorId, view: camMode,
});
window.__GF.startGame = () => {};
app.setState('playing');
app.start();
