import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../../engine/vendor/three/three.module.js';
import { BossController } from '../../engine/gameplay/boss.js';
import { Health } from '../../engine/gameplay/systems.js';

const mkEnemy = () => { const e = { position: new THREE.Vector3(), facing: 0, health: new Health(1000), stats: { moveSpeed: 3 }, anim: { play() {} }, plays: [],
  faceTowards(p, dt, rate) { const t = Math.atan2(p.x - this.position.x, p.z - this.position.z), d = Math.atan2(Math.sin(t - this.facing), Math.cos(t - this.facing)); this.facing += d * Math.min(1, dt * rate); },
  update(dt) { if (this.move) this.position.addScaledVector(this.move, dt); } }; return e; };
const mkTarget = (x, z) => ({ position: new THREE.Vector3(x, 0, z), alive: true, hp: 100, receive(a) { this.hp -= a; return a; } });
const app = () => ({ scene: new THREE.Scene(), shake() {}, hitStop() {} });
const ATT = { sweep: { shape: 'cone', radius: 3.5, arc: 120, damage: 20, windup: 0.6, active: 0.2, recovery: 0.6, range: [0, 3.2] }, slam: { shape: 'circle', radius: 4, damage: 30, windup: 0.9, active: 0.2, recovery: 1, range: [0, 6] } };
const run = (b, e, t, sec, each) => { for (let i = 0; i < sec * 60; i++) { b.update(1 / 60, t); e.update(1 / 60); each?.(i); } };

test('boss: telegraphed attack hits a target that stays, misses one that dodges out after the commit point', () => {
  const e = mkEnemy(), t = mkTarget(0, 2), a = app(), b = new BossController(a, e, { attacks: { sweep: ATT.sweep } });
  let sawDecal = false; run(b, e, t, 1.2, () => { if (a.scene.getObjectByName('boss-telegraph')) sawDecal = true; });
  assert.ok(sawDecal, 'ground telegraph shown during the windup'); assert.equal(t.hp, 80, 'standing in the cone takes the hit');
  const e2 = mkEnemy(), t2 = mkTarget(0, 2), b2 = new BossController(app(), e2, { attacks: { sweep: ATT.sweep } });
  run(b2, e2, t2, 1.2, (i) => { if (b2.state === 'windup' && b2.t > 0.5) t2.position.set(0, 0, -3); });
  assert.equal(t2.hp, 100, 'dodging behind the boss during the late windup avoids the hit');
});

test('boss: telegraph decal covers exactly the hit area (cone, line, circle)', () => {
  for (const shape of ['cone', 'line', 'circle']) {
    const e = mkEnemy(); e.facing = 0.7; const a = app(), b = new BossController(a, e, { attacks: { x: { shape, radius: 4, arc: 90, length: 5, width: 1.4, range: [0, 99] } } });
    b._begin(b.attacks.x, mkTarget(Math.sin(0.7) * 2, Math.cos(0.7) * 2)); b._updateTelegraph(1);
    const d = a.scene.getObjectByName('boss-telegraph'); d.updateMatrixWorld(true);
    const P = d.geometry.attributes.position, v = new THREE.Vector3(), c = new THREE.Vector3(); let inside = 0;
    // shrink each vertex slightly toward the centroid of the decal (edge vertices lie exactly on the border)
    const box = new THREE.Box3().setFromObject(d); box.getCenter(c);
    for (let i = 0; i < P.count; i++) { v.fromBufferAttribute(P, i).applyMatrix4(d.matrixWorld).lerp(c, 0.03); if (b.inArea(b.attacks.x, v)) inside++; }
    assert.ok(inside / P.count > 0.95, `${shape}: ${inside}/${P.count} decal vertices inside the hit area`);
  }
});

test('boss: phases by health with an invulnerable transition, poise break opens a stagger window', () => {
  const e = mkEnemy(), t = mkTarget(0, 5), events = [];
  const b = new BossController(app(), e, { attacks: ATT, phases: [{ until: 0.6, attacks: ['sweep'] }, { attacks: ['sweep', 'slam'], speed: 1.3 }], poise: 100 });
  b.on('phase', (x) => events.push('phase' + x.phase)).on('poiseBreak', () => events.push('break'));
  e.health.damage(450, {}); assert.equal(b.phase, 1); assert.equal(b.state, 'transition'); assert.ok(events.includes('phase1'));
  assert.equal(e.health.damage(100, {}), 0, 'invulnerable during the phase transition');
  run(b, e, t, 2); assert.notEqual(b.state, 'transition');
  for (let i = 0; i < 6; i++) e.health.damage(20, { heavy: true });
  assert.ok(events.includes('break')); assert.equal(b.state, 'staggered');
});
