import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../../engine/vendor/three/three.module.js';
import { StealthSystem, lightProbe } from '../../engine/gameplay/stealth.js';

// minimal physics: static boxes, raycast returns the first hit
const physicsOf = (boxes) => ({ raycast(o, d, max) { const r = new THREE.Ray(o, d), p = new THREE.Vector3(); let best = null; for (const b of boxes) if (r.intersectBox(b, p)) { const dist = p.distanceTo(o); if (dist <= max && (!best || dist < best.distance)) best = { distance: dist, point: p.clone() }; } return best; } });
const actor = (x, z, facing = 0) => ({ position: new THREE.Vector3(x, 0, z), facing, userData: {} });
const run = (s, sec) => { for (let i = 0; i < sec * 60; i++) s.update(1 / 60); };

test('stealth: lit player in view raises suspicion to alert; darkness and hiding slow or prevent it; walls block sight', () => {
  const mk = (light, opts = {}) => { const s = new StealthSystem({ lightLevel: () => light, physics: opts.physics || null }); const g = s.addGuard(actor(0, 0, 0)); const p = actor(0, 8); s.setPlayer(p, () => ({ crouched: !!opts.crouch, speed: 0 })); if (opts.hide) s.addHidingSpot({ center: p.position.clone(), radius: 1 }); return { s, g }; };
  const lit = mk(1); run(lit.s, 3); assert.equal(lit.g.state, 'alert');
  const dark = mk(0.05); run(dark.s, 3); assert.notEqual(dark.g.state, 'alert'); assert.ok(dark.g.suspicion < lit.g.suspicion);
  const hidden = mk(1, { crouch: true, hide: true }); run(hidden.s, 5); assert.equal(hidden.g.state, 'patrol', `hidden player stays unseen (susp ${hidden.g.suspicion.toFixed(2)})`);
  const wall = mk(1, { physics: physicsOf([new THREE.Box3(new THREE.Vector3(-3, 0, 3), new THREE.Vector3(3, 4, 3.5))]) }); run(wall.s, 3); assert.equal(wall.g.state, 'patrol');
});

test('stealth: noise → investigate → search → back to patrol; takedown from behind; body discovered; radio spreads the alarm', () => {
  const s = new StealthSystem({ lightLevel: () => 1, radio: 1 });
  const g1 = s.addGuard(actor(0, 0, 0), { route: [[0, 0, 0], [0, 0, -6]] });
  const p = actor(0, -30); s.setPlayer(p, () => ({ crouched: true, speed: 0 }));
  s.noise(new THREE.Vector3(4, 0, 2), 10, 'bottle'); s.update(1 / 60);
  assert.equal(g1.state, 'investigate');
  run(s, 30); assert.equal(g1.state, 'patrol', 'gives up and returns to patrol');
  // takedown: guard faces +z, player 1 m behind
  const s2 = new StealthSystem({ lightLevel: () => 1, radio: 1 });
  const a = s2.addGuard(actor(0, 0, 0), { route: [[0, 0, 0]] }), b = s2.addGuard(actor(-6, 0, 0, Math.PI / 2), { route: [[-6, 0, 0]] }), c = s2.addGuard(actor(40, 0, 40, Math.PI), { route: [[40, 0, 40]] });
  b.route[0].look = Math.PI / 2; c.route[0].look = Math.PI;
  const pl = actor(0, -1); s2.setPlayer(pl, () => ({ crouched: true, speed: 0 }));
  assert.ok(s2.canTakedown(a)); assert.ok(s2.takedown(a)); assert.equal(a.state, 'down');
  pl.position.set(0, 0, -40); // player leaves
  run(s2, 0.5); assert.equal(b.state, 'alert', 'guard B sees the body');
  run(s2, 1.5); assert.equal(c.state, 'alert', 'radio alarm reaches guard C');
});

test('lightProbe: point light brightens nearby points, walls shadow them', () => {
  const scene = new THREE.Scene(), l = new THREE.PointLight(0xffffff, 6, 12); l.position.set(0, 3, 0); scene.add(l); scene.updateMatrixWorld();
  const open = lightProbe(scene, { sunIntensity: 0 }), shadowed = lightProbe(scene, { sunIntensity: 0, physics: physicsOf([new THREE.Box3(new THREE.Vector3(1, 0, -2), new THREE.Vector3(1.5, 5, 2))]) });
  const near = open(new THREE.Vector3(0, 1, 0)), far = open(new THREE.Vector3(9, 1, 0));
  assert.ok(near > far + 0.2, `near ${near} far ${far}`);
  assert.ok(shadowed(new THREE.Vector3(3, 1, 0)) < open(new THREE.Vector3(3, 1, 0)), 'occluded');
});

test('stealth + navmesh: an investigating guard routes around a wall instead of walking into it', async () => {
  const { PhysicsWorld } = await import('../../engine/physics/world.js');
  const { buildNavMesh } = await import('../../engine/ai/navmesh.js');
  const w = new PhysicsWorld(); w.addStatic({ type: 'box', x: 0, y: 1.5, z: -1, hx: 0.15, hy: 1.5, hz: 7 });
  const nm = buildNavMesh({ physics: w, bounds: { minX: -10, minZ: -10, maxX: 10, maxZ: 10 } });
  const s = new StealthSystem({ lightLevel: () => 0.05, physics: w });
  const g = s.addGuard(actor(-5, 0, Math.PI / 2), { route: [[-5, 0, 0]], navmesh: nm });
  s.setPlayer(actor(9, 9), () => ({ crouched: true }));
  s.noise(new THREE.Vector3(5, 0, 0), 30, 'bottle');
  let minAbsX = Infinity, reached = false;
  for (let i = 0; i < 60 * 30 && !reached; i++) { s.update(1 / 60); if (Math.abs(g.actor.position.z) < 6) minAbsX = Math.min(minAbsX, Math.abs(g.actor.position.x)); reached = g.state === 'search'; }
  assert.ok(reached, 'guard arrived at the noise and started searching');
  assert.ok(minAbsX > 0.3, `never crossed the wall (closest |x| beside it ${minAbsX.toFixed(2)})`);
});
