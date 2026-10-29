import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../../engine/vendor/three/three.module.js';
import { PhysicsWorld } from '../../engine/physics/world.js';
import { CharacterController } from '../../engine/physics/character.js';
import { platformerProfile, platformerParams, canReach, jumpReach, jumpArc, maxGap, generatePlatformerLevel, validateLevel, PlatformerLevel, PlatformerBot } from '../../engine/gameplay/platformer.js';

const DT = 1 / 60;
const RIGHT = new THREE.Vector3(1, 0, 0), NONE = new THREE.Vector3();
function voidWorld() { const w = new PhysicsWorld(); w.groundFn = () => -1000; return w; }
// a box whose TOP is at y=top spanning x0..x1
const box = (w, x0, x1, top = 0, extra = {}) => w.addStatic({ type: 'box', x: (x0 + x1) / 2, y: top - 0.5, z: 0, hx: (x1 - x0) / 2, hy: 0.5, hz: 2, yaw: 0 }, extra);
function settle(c, n = 10) { for (let i = 0; i < n; i++) c.move(DT, NONE, 0); }

test('platformer profile: optional, defaults of the stock controller are unchanged', () => {
  const w = voidWorld(); box(w, -5, 5);
  const plain = new CharacterController(w, { position: new THREE.Vector3(0, 0.02, 0) });
  assert.equal(plain.profile, null); assert.equal(plain.coyoteTime, 0.12); assert.equal(plain.jumpBufferTime, 0.15); assert.equal(plain.pf, undefined);
  settle(plain); assert.ok(plain.grounded);
  const p = platformerParams();
  assert.ok(Math.abs(p.jumpVelocity - 2 * p.jumpHeight / p.timeToApex) < 1e-9 && Math.abs(p.gravity - 2 * p.jumpHeight / p.timeToApex ** 2) < 1e-9);
});

test('coyote time: jump still allowed shortly after running off a ledge, not after it expires', () => {
  const p = platformerParams();
  const run = (lateFrames) => {
    const w = voidWorld(); box(w, -6, 0);
    const c = new CharacterController(w, { position: new THREE.Vector3(-1.5, 0.02, 0), profile: platformerProfile() }); settle(c);
    let f = 0; while (c.grounded && f++ < 120) c.move(DT, RIGHT, 0);
    for (let i = 0; i < lateFrames; i++) c.move(DT, RIGHT, 0);
    const vyBefore = c.velocity.y; c.move(DT, RIGHT, 0, { jump: true, jumpHeld: true });
    return { jumped: c.pf.events.jumped === true, vy: c.velocity.y, vyBefore };
  };
  const within = Math.floor(p.coyoteTime / DT) - 2, after = Math.ceil(p.coyoteTime / DT) + 3;
  const a = run(within); assert.ok(a.jumped && a.vy > 10, `coyote jump after ${within} frames: ${JSON.stringify(a)}`);
  const b = run(after); assert.ok(!b.jumped && b.vy < 0, `no jump after ${after} frames: ${JSON.stringify(b)}`);
});

test('jump buffering: a press just before landing jumps on touchdown; an early press is dropped', () => {
  const p = platformerParams();
  const landingFrame = () => { const w = voidWorld(); box(w, -5, 5); const c = new CharacterController(w, { position: new THREE.Vector3(0, 3, 0), profile: platformerProfile() }); let f = 0; while (!c.grounded) { c.move(DT, NONE, 0); f++; } return f; };
  const F = landingFrame();
  const run = (earlyFrames) => {
    const w = voidWorld(); box(w, -5, 5); const c = new CharacterController(w, { position: new THREE.Vector3(0, 3, 0), profile: platformerProfile() });
    for (let f = 0; f < F + 3; f++) c.move(DT, NONE, 0, { jump: f === F - earlyFrames, jumpHeld: true });
    return { jumps: c.pf.jumpCount, vy: c.velocity.y, grounded: c.grounded };
  };
  const ok = run(Math.floor(p.jumpBuffer / DT) - 2); assert.equal(ok.jumps, 1, 'buffered jump fired'); assert.ok(ok.vy > 5);
  const late = run(Math.ceil(p.jumpBuffer / DT) + 6); assert.equal(late.jumps, 0, 'too-early press is not remembered'); assert.ok(late.grounded);
});

test('variable jump height: holding reaches jumpHeight, a tap is much lower', () => {
  const p = platformerParams();
  const apex = (holdFrames) => { const w = voidWorld(); box(w, -5, 5); const c = new CharacterController(w, { position: new THREE.Vector3(0, 0.02, 0), profile: platformerProfile() }); settle(c); let top = 0;
    for (let f = 0; f < 90; f++) { c.move(DT, NONE, 0, { jump: f === 0, jumpHeld: f < holdFrames }); top = Math.max(top, c.position.y); } return top; };
  const full = apex(999), tap = apex(4);
  assert.ok(Math.abs(full - p.jumpHeight) < 0.2, `full jump apex ${full}`);
  assert.ok(tap < full * 0.55, `tap apex ${tap} vs ${full}`);
  assert.ok(Math.abs(jumpArc(p).apex - p.jumpHeight) < 1e-9);
});

test('dash, wall jump and ledge grab work through the profile', () => {
  const w = voidWorld(); box(w, -20, 20);
  const c = new CharacterController(w, { position: new THREE.Vector3(0, 0.02, 0), profile: platformerProfile() }); settle(c);
  const x0 = c.position.x; c.move(DT, RIGHT, 0, { dash: true }); for (let i = 0; i < 9; i++) c.move(DT, RIGHT, 0);
  const p = platformerParams(); assert.ok(c.position.x - x0 > p.dashSpeed * p.dashTime * 0.8, `dash distance ${c.position.x - x0}`); assert.equal(c.pf.dashes, 1);
  // wall: tall box at x=3; jump into it, slide, then wall-jump away (-x)
  const w2 = voidWorld(); box(w2, -10, 10); w2.addStatic({ type: 'box', x: 3.5, y: 5, z: 0, hx: 0.5, hy: 5, hz: 3, yaw: 0 });
  const c2 = new CharacterController(w2, { position: new THREE.Vector3(1, 0.02, 0), profile: platformerProfile() }); settle(c2);
  c2.move(DT, RIGHT, 0, { jump: true }); let slid = false;
  for (let i = 0; i < 40; i++) { c2.move(DT, RIGHT, 0); slid ||= c2.pf.sliding; }
  assert.ok(slid, 'wall slide engaged'); assert.ok(c2.velocity.y >= -p.wallSlideSpeed - 1e-6);
  c2.move(DT, RIGHT, 0, { jump: true }); assert.equal(c2.pf.wallJumps, 1); assert.ok(c2.velocity.x < -3 && c2.velocity.y > 5);
  // ledge: block top at 3.4 (above the 2.4 m jump) is grabbed and climbed
  const w3 = voidWorld(); box(w3, -10, 2); w3.addStatic({ type: 'box', x: 4, y: 1.7, z: 0, hx: 2, hy: 1.7, hz: 2, yaw: 0 });
  const c3 = new CharacterController(w3, { position: new THREE.Vector3(0.5, 0.02, 0), profile: platformerProfile() }); settle(c3);
  c3.move(DT, RIGHT, 0, { jump: true }); let climbed = false;
  for (let i = 0; i < 120 && !climbed; i++) { c3.move(DT, RIGHT, 0); climbed = !!c3.pf.events.climbed; }
  assert.ok(c3.pf.ledgeGrabs >= 1, 'ledge grabbed'); assert.ok(climbed && c3.grounded && Math.abs(c3.position.y - 3.4) < 0.05, `climbed onto ledge, y=${c3.position.y}`);
  settle(c3); assert.ok(c3.grounded && Math.abs(c3.position.y - 3.4) < 0.05, 'stands on the ledge top after the climb');
});

test('reachability checker accepts reachable gaps and rejects impossible ones', () => {
  const p = platformerParams();
  assert.ok(canReach(p, { gap: 3, rise: 0 }).ok);
  assert.ok(canReach(p, { gap: 2, rise: 1.5 }).ok);
  const far = canReach(p, { gap: 20, rise: 0 }); assert.equal(far.ok, false); assert.equal(far.reason, 'too-far');
  const high = canReach(p, { gap: 1, rise: 5 }); assert.equal(high.ok, false); assert.equal(high.reason, 'too-high');
  assert.ok(canReach(p, { gap: 1, rise: p.jumpHeight + 0.6, kind: 'ledge' }).ok, 'ledge grab extends reach');
  assert.equal(canReach(p, { gap: 1, rise: p.jumpHeight + 0.6 }).ok, false);
  assert.ok(canReach(p, { gap: 1.2, rise: 5, kind: 'spring', launch: Math.sqrt(2 * p.gravity * 6.6) }).ok);
  assert.ok(jumpReach(p, -2) > jumpReach(p, 0) && jumpReach(p, 0) > jumpReach(p, 1.5), 'drops reach further than climbs');
  // the math matches the simulation: a max-safe gap is crossable, a 30% longer-than-ideal gap is not
  const attempt = (gap) => {
    const w = voidWorld(); box(w, -12, 0); box(w, gap, gap + 6);
    const c = new CharacterController(w, { position: new THREE.Vector3(-8, 0.02, 0), profile: platformerProfile() }); settle(c);
    let jumped = false;
    for (let f = 0; f < 300; f++) { const j = !jumped && c.grounded && c.position.x >= -0.12; if (j) jumped = true; c.move(DT, RIGHT, 0, { jump: j, jumpHeld: true }); if (c.position.y < -3) return false; if (jumped && c.grounded && c.position.x > gap) return true; }
    return false;
  };
  assert.ok(attempt(maxGap(p, 0)), 'max safe gap is jumpable');
  assert.equal(attempt(jumpReach(p, 0) * 1.3), false, 'over-long gap fails');
});

test('generated levels are reachable and a bot clears them through the controller', () => {
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const desc = generatePlatformerLevel({ seed, pieces: 10, difficulty: 0.7 });
    assert.ok(desc.report.ok, `seed ${seed}: ${JSON.stringify(desc.report.failures)}`);
    assert.ok(validateLevel(desc).ok); assert.ok(desc.links.length === desc.path.length - 1);
  }
  const bad = generatePlatformerLevel({ seed: 1, pieces: 3 }); bad.links[0].gap = 25;
  assert.equal(validateLevel(bad).ok, false, 'validator flags an impossible link');
  for (const seed of [1, 2, 3]) {
    const profile = platformerProfile(); const desc = generatePlatformerLevel({ seed, pieces: 8, difficulty: 0.6, profile });
    const w = voidWorld(); const level = new PlatformerLevel(w, { killY: desc.killY }).build(desc);
    const c = new CharacterController(w, { position: new THREE.Vector3(0, 0.05, 0), profile }); const bot = new PlatformerBot(level, c); const d = new THREE.Vector3();
    for (let f = 0; f < 60 * 90 && !level.stats.reachedGoal; f++) { const o = bot.update(DT); level.update(DT, [c]); d.set(o.moveX, 0, o.moveZ); if (d.lengthSq() > 1) d.normalize(); c.move(DT, d, 0, o); }
    assert.ok(level.stats.reachedGoal, `seed ${seed} goal reached (deaths ${level.stats.deaths})`);
  }
});

test('moving platforms carry the player (linear and vertical path)', () => {
  const w = voidWorld(); const level = new PlatformerLevel(w);
  const m = level.addMoving({ id: 'm', x: 0, y: 0, hx: 1.5, hy: 0.3, hz: 1.5, motion: { type: 'linear', from: [0, 0, 0], to: [8, 0, 0], period: 6 } });
  const c = new CharacterController(w, { position: new THREE.Vector3(0, 0.05, 0), profile: platformerProfile() });
  for (let i = 0; i < 10; i++) { level.update(DT, [c]); c.move(DT, NONE, 0); }
  assert.ok(c.grounded && level.platformOf(c) === m);
  const off0 = c.position.x - m.pos.x;
  for (let i = 0; i < 90; i++) { level.update(DT, [c]); c.move(DT, NONE, 0); }
  assert.ok(m.pos.x > 2, 'platform moved'); assert.ok(Math.abs(c.position.x - m.pos.x - off0) < 0.05, `player rides along (offset drift ${c.position.x - m.pos.x - off0})`);
  assert.ok(c.grounded && Math.abs(c.position.y - m.pos.y) < 0.05);
  const lift = level.addMoving({ id: 'lift', x: 20, y: 0, hx: 1.5, hy: 0.3, hz: 1.5, motion: { type: 'path', points: [[20, 0, 0], [20, 6, 0]], speed: 2, loop: false } });
  const c2 = new CharacterController(w, { position: new THREE.Vector3(20, 0.05, 0), profile: platformerProfile() });
  for (let i = 0; i < 120; i++) { level.update(DT, [c2]); c2.move(DT, NONE, 0); }
  assert.ok(lift.pos.y > 3 && Math.abs(c2.position.y - lift.pos.y) < 0.06 && c2.grounded, `lift carries player up (${c2.position.y} vs ${lift.pos.y})`);
});

test('hazards respawn at the checkpoint; crumbling platforms fall; springs launch; collectibles count', () => {
  const w = voidWorld(); const level = new PlatformerLevel(w);
  level.addPlatform({ x: 0, y: 0, hx: 10 }); level.setSpawn([-8, 0, 0]);
  level.addCheckpoint({ x: -2, y: 0 }); level.addHazard({ kind: 'spikes', min: [3, 0, -2], max: [4, 0.6, 2] });
  level.addCollectible({ x: 1, y: 1 }); const cr = level.addCrumble({ x: 14, y: 0, hx: 1, hy: 0.3 }); const sp = level.addSpring({ x: 20, y: 0, hx: 1, hy: 0.3, power: 15 });
  const c = new CharacterController(w, { position: new THREE.Vector3(-3, 0.05, 0), profile: platformerProfile() });
  for (let i = 0; i < 120 && level.stats.deaths === 0; i++) { level.update(DT, [c]); c.move(DT, RIGHT, 0); }
  assert.equal(level.stats.deaths, 1); assert.equal(level.stats.lastDeath, 'spikes'); assert.equal(level.activeCheckpoint, 0); assert.equal(level.stats.collected, 1);
  assert.ok(Math.abs(c.position.x + 2) < 0.3, `respawned at checkpoint x=${c.position.x}`);
  c.teleport(new THREE.Vector3(14, 0.05, 0)); for (let i = 0; i < 60; i++) { level.update(DT, [c]); c.move(DT, NONE, 0); }
  assert.ok(cr.state === 'fallen' || level.stats.deaths > 1, 'crumble platform gave way');
  c.teleport(new THREE.Vector3(20, 0.4, 0)); let maxY = 0; for (let i = 0; i < 40; i++) { level.update(DT, [c]); c.move(DT, NONE, 0); maxY = Math.max(maxY, c.position.y); }
  assert.ok(level.stats.springs >= 1 && maxY > 2.5, `spring launch (max y ${maxY})`); void sp;
});
