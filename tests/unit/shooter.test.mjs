import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../../engine/vendor/three/three.module.js';
import { PhysicsWorld } from '../../engine/physics/world.js';
import { Health } from '../../engine/gameplay/systems.js';
import { WEAPONS, defineWeapon, weaponDef, damageAtDistance, zoneMultiplier, spreadAngle, coneDirection, timeToKill, WeaponState, actorHitboxes, rayHitbox, hitscan } from '../../engine/gameplay/shooter.js';
import { CoverSystem } from '../../engine/gameplay/cover.js';
import { aiAimError } from '../../engine/gameplay/shooter-ai.js';
import { weaponModel, WEAPON_MODEL_KINDS } from '../../engine/gameplay/weapon-models.js';
import { RNG } from '../../engine/core/rng.js';
import { MaterialLibrary } from '../../engine/render/materials.js';
MaterialLibrary.textureSize = 32;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const step = (w, seconds, dt = 1 / 60) => { const shots = []; for (let t = 0; t < seconds - 1e-9; t += dt) shots.push(...w.update(dt)); return shots; };

test('shooter: weapon catalogue covers rifle, pistol, shotgun, smg, sniper, launcher with fire modes', () => {
  for (const id of ['rifle', 'pistol', 'shotgun', 'smg', 'sniper', 'launcher', 'carbine']) assert.ok(WEAPONS[id], id);
  assert.equal(WEAPONS.rifle.mode, 'auto'); assert.equal(WEAPONS.pistol.mode, 'semi'); assert.equal(WEAPONS.carbine.mode, 'burst');
  assert.equal(WEAPONS.launcher.hitscan, false); assert.ok(WEAPONS.launcher.projectile.splash.radius > 0);
  assert.ok(WEAPONS.shotgun.pellets > 1);
  const custom = weaponDef({ base: 'rifle', damage: 50, spread: { hip: 9 } });
  assert.equal(custom.damage, 50); assert.equal(custom.spread.hip, 9); assert.equal(custom.spread.ads, WEAPONS.rifle.spread.ads); assert.equal(custom.magazine, 30);
  assert.equal(weaponDef(custom), custom);
});

test('shooter: damage falloff is flat, linear, then floored; zero past range; zone multipliers', () => {
  const r = WEAPONS.rifle, f = r.falloff;
  assert.equal(damageAtDistance('rifle', 5), r.damage);
  assert.equal(damageAtDistance('rifle', f.start), r.damage);
  const mid = (f.start + f.end) / 2;
  assert.ok(Math.abs(damageAtDistance('rifle', mid) - r.damage * (1 + f.min) / 2) < 1e-9);
  assert.ok(Math.abs(damageAtDistance('rifle', f.end + 10) - r.damage * f.min) < 1e-9);
  assert.equal(damageAtDistance('rifle', r.range + 1), 0);
  for (let d = 0; d < r.range; d += 3) assert.ok(damageAtDistance('rifle', d + 3) <= damageAtDistance('rifle', d) + 1e-9, 'monotonic');
  assert.equal(damageAtDistance('launcher', 150), WEAPONS.launcher.damage); // no falloff
  assert.equal(zoneMultiplier('rifle', 'head'), r.headMult); assert.equal(zoneMultiplier('rifle', 'limb'), r.limbMult); assert.equal(zoneMultiplier('rifle', 'body'), 1);
  const ttk = timeToKill('rifle', 100); assert.equal(ttk.shots, Math.ceil(100 / r.damage)); assert.ok(Math.abs(ttk.seconds - (ttk.shots - 1) * 60 / r.rpm) < 1e-9);
  assert.ok(timeToKill('rifle', 100, { zone: 'head' }).shots < ttk.shots);
  assert.equal(timeToKill('sniper', 200, { zone: 'head' }).shots, 1);
});

test('shooter: spread grows with movement, air and bloom, shrinks with ADS / crouch; cone sampling stays inside', () => {
  const hip = spreadAngle('rifle'), ads = spreadAngle('rifle', { ads: true });
  assert.ok(ads < hip);
  assert.ok(spreadAngle('rifle', { moving: 1 }) > hip);
  assert.ok(spreadAngle('rifle', { airborne: true }) > hip);
  assert.ok(spreadAngle('rifle', { bloom: 2 }) > hip);
  assert.ok(spreadAngle('rifle', { crouched: true }) < hip);
  const dir = V(0.3, 0.1, 1).normalize(), rng = new RNG(4), half = 3 * Math.PI / 180;
  let maxAng = 0, sum = V();
  for (let i = 0; i < 2000; i++) { const d = coneDirection(dir, half, rng); assert.ok(Math.abs(d.length() - 1) < 1e-9); maxAng = Math.max(maxAng, d.angleTo(dir)); sum.add(d); }
  assert.ok(maxAng <= half + 1e-6 && maxAng > half * 0.8, `cone ${maxAng}`);
  assert.ok(sum.normalize().angleTo(dir) < half * 0.1, 'unbiased');
  assert.equal(coneDirection(dir, 0, rng).angleTo(dir), 0);
});

test('shooter: weapon state machine — auto rate, semi edges, burst, empty, reload, shell reload, equip', () => {
  const r = new WeaponState('rifle');
  assert.equal(r.mag, 30); assert.equal(r.state, 'ready');
  r.setTrigger(true);
  const s1 = step(r, 1.0);
  assert.ok(Math.abs(s1.length - Math.round(WEAPONS.rifle.rpm / 60)) <= 1, `auto shots ${s1.length}`);
  assert.equal(r.mag, 30 - s1.length);
  step(r, 3); assert.equal(r.mag, 0); assert.equal(r.shots, 30);
  // empty: pressing again clicks and auto-reloads
  let empty = 0, reloaded = 0; r.on('empty', () => empty++); r.on('reload', () => reloaded++);
  r.setTrigger(false); r.setTrigger(true); r.update(1 / 60);
  assert.equal(empty, 1); assert.ok(r.reloading); assert.equal(r.state, 'reloading');
  r.setTrigger(false);
  step(r, WEAPONS.rifle.reloadEmptyTime - 0.1); assert.ok(r.reloading, 'still reloading');
  step(r, 0.2); assert.equal(reloaded, 1); assert.equal(r.mag, 30); assert.equal(r.reserve, 120 - 30);
  assert.equal(r.reload(), false, 'full mag cannot reload');
  // tactical reload keeps the remainder
  r.setTrigger(true); step(r, 0.5); r.setTrigger(false); const left = r.mag; r.reload(); step(r, WEAPONS.rifle.reloadTime + 0.05);
  assert.equal(r.mag, 30); assert.equal(r.reserve, 90 - (30 - left));
  // semi: one shot per press, held trigger does not repeat
  const p = new WeaponState('pistol'); p.setTrigger(true); assert.equal(step(p, 1).length, 1); p.setTrigger(false); p.setTrigger(true); assert.equal(step(p, 0.3).length, 1);
  // burst: N shots per press
  const b = new WeaponState('carbine'); b.setTrigger(true); assert.equal(step(b, 0.6).length, WEAPONS.carbine.burst); b.setTrigger(false);
  // shell-by-shell reload, interruptible by firing
  const sg = new WeaponState('shotgun', { mag: 2, reserve: 10 }); sg.reload(); step(sg, WEAPONS.shotgun.reloadPerShell * 2 + 0.02); assert.equal(sg.mag, 4);
  sg.setTrigger(true); const sh = step(sg, 0.1); assert.equal(sh.length, 1); assert.ok(!sg.reloading); assert.equal(sg.mag, 3);
  // no reserve -> no reload
  const dry = new WeaponState('rifle', { mag: 0, reserve: 0 }); assert.equal(dry.reload(), false);
  // equip delay blocks firing; bloom & recoil reported per shot
  const e = new WeaponState('rifle'); e.equip(); e.setTrigger(true); assert.equal(step(e, WEAPONS.rifle.equipTime - 0.05).length, 0); const after = step(e, 0.3);
  assert.ok(after.length > 0 && after[0].recoil.pitch > 0); assert.ok(e.bloom > 0);
});

test('shooter: hitscan hits colliders, stops at cover, and resolves head/body hitboxes on actors', () => {
  const w = new PhysicsWorld();
  w.addStatic({ type: 'box', x: 0, y: 1, z: 10, hx: 2, hy: 1, hz: 0.25 }); // 2 m wall at z=10
  const o = V(0, 1.5, 0), fwd = V(0, 0, 1);
  const h = hitscan(w, o, fwd, 100, []);
  assert.equal(h.kind, 'static'); assert.ok(Math.abs(h.distance - 9.75) < 1e-6); assert.ok(h.normal.z < -0.9);
  const actor = { position: V(0, 0, 20), alive: true, radius: 0.4, ctrl: { height: 1.8 }, health: new Health(100) };
  assert.equal(hitscan(w, o, fwd, 100, [actor]).kind, 'static', 'wall protects the actor');
  const o2 = V(5, 1.2, 0), d2 = V(-5, 0, 20).normalize(); // clear line to body
  const hb = hitscan(w, o2, d2, 100, [actor]); assert.equal(hb.kind, 'actor'); assert.equal(hb.zone, 'body');
  const head = actorHitboxes(actor).find((x) => x.zone === 'head');
  const dHead = head.center.clone().sub(o2).normalize();
  assert.equal(hitscan(w, o2, dHead, 100, [actor]).zone, 'head');
  const dLegs = V(0, 0.4, 20).sub(o2).normalize(); assert.equal(hitscan(w, o2, dLegs, 100, [actor]).zone, 'limb');
  assert.equal(hitscan(w, o2, d2, 100, [actor], { ignore: actor }), null);
  actor.crouching = true; assert.ok(actorHitboxes(actor)[0].center.y < head.center.y - 0.5, 'crouching lowers the head');
  assert.equal(rayHitbox(V(0, 0, 0), V(1, 0, 0), { type: 'box', min: V(2, -1, -1), max: V(3, 1, 1) }), 2);
  assert.ok(hitscan(w, V(0, 5, 0), V(0, -1, 0), 100, []).kind === 'terrain', 'ground plane');
});

test('cover: detects faces, low/high classification, edges, peek points and protected AI spots', () => {
  const w = new PhysicsWorld();
  const low = w.addStatic({ type: 'box', x: 0, y: 0.6, z: 0, hx: 2, hy: 0.6, hz: 0.3 });    // 1.2 m wall, 4 m long (x)
  const high = w.addStatic({ type: 'box', x: 10, y: 1.25, z: 0, hx: 0.5, hy: 1.25, hz: 1.5 }); // 2.5 m pillar
  const cs = new CoverSystem(w);
  const f = cs.find(V(1.2, 0, -1));
  assert.ok(f && f.shape === low); assert.equal(f.low, true); assert.ok(f.normal.z < -0.99, 'normal faces the agent');
  assert.ok(Math.abs(f.snap.z - (-0.3 - cs.agentRadius - 0.06)) < 1e-6 && Math.abs(f.snap.x - 1.2) < 1e-6, 'snap point hugs the face');
  assert.ok(Math.abs(f.distLeft + f.distRight - 4) < 1e-6);
  assert.equal(cs.find(V(0, 0, -5)), null, 'nothing in reach');
  const g = cs.find(V(8.9, 0, 1.0)); assert.equal(g.shape, high); assert.equal(g.low, false); assert.ok(g.normal.x < -0.99);
  const e = cs.nearEdge(g, 1.0); assert.ok(e, 'near the edge'); const pk = cs.peekPosition(g, 1.0);
  assert.ok(pk.z > 1.5, 'peek steps out past the edge');
  assert.equal(cs.peekPosition(cs.find(V(8.9, 0, 0)), 0.5), null, 'no edge in the middle of high cover');
  // rotated box: still finds a face
  const w2 = new PhysicsWorld(); w2.addStatic({ type: 'box', x: 0, y: 0.6, z: 0, hx: 1.5, hy: 0.6, hz: 0.3, yaw: Math.PI / 4 });
  const r = new CoverSystem(w2).find(V(1, 0, 1)); assert.ok(r && r.distance < 1.3);
  // AI cover points against a threat at z = -15: only the far (+z) side of the low wall protects
  const threat = V(0, 0, -15);
  const pts = cs.points(V(0, 0, 3), threat, { radius: 8 });
  assert.ok(pts.length > 0);
  for (const p of pts) { assert.ok(cs.isProtected(p.position, threat, { height: p.low ? 0.85 : 1.3 })); assert.ok(p.normal.z > 0.5 || p.shape === high); }
  assert.ok(!cs.isProtected(V(0, 0, -3), threat), 'threat side is exposed');
  assert.ok(cs.claim(pts[0].position, 'a')); assert.ok(!cs.claim(pts[0].position, 'b')); cs.release('a'); assert.ok(cs.claim(pts[0].position, 'b'));
});

test('shooter AI accuracy degrades with distance and movement and warms up over a burst', () => {
  const base = aiAimError({ distance: 10 });
  assert.ok(aiAimError({ distance: 40 }) > base); assert.ok(aiAimError({ distance: 10, moving: 1 }) > base);
  assert.ok(aiAimError({ distance: 10, targetSpeed: 6 }) > base); assert.ok(aiAimError({ distance: 10, warmup: 0 }) > base);
  assert.ok(aiAimError({ distance: 10, skill: 0.5 }) < base);
});

test('shooter: firearm meshes follow the grip-origin / muzzle +Z / socket convention', () => {
  for (const k of WEAPON_MODEL_KINDS) {
    const m = weaponModel(k); const mz = m.getObjectByName('socket_muzzle'); assert.ok(mz, k);
    assert.ok(mz.position.z > 0.1, `${k} muzzle forward`); assert.ok(m.getObjectByName('socket_grip').position.length() < 1e-9);
    const b = new THREE.Box3().setFromObject(m); assert.ok(b.max.z > b.max.x * 2, `${k} is long along +Z`); assert.ok(b.min.y < 0 && b.max.y > 0, `${k} grip near origin`);
    assert.ok(Array.isArray(m.userData.sockets.muzzle));
  }
});
