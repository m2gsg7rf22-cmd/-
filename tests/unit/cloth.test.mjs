import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../../engine/vendor/three/three.module.js';
import { Cloth } from '../../engine/physics/cloth.js';
import * as H from '../../engine/humans.js';

const run = (c, s) => { for (let i = 0; i < s * 60; i++) c.update(1 / 60); return c; };

test('cloth: a flag hangs along its pole without wind and streams out with wind; low stretch; deterministic', () => {
  const calm = run(new Cloth({ width: 1.6, height: 1, segX: 20, segY: 12, pin: 'left' }), 3);
  const k = calm.index(calm.segX, calm.segY);
  assert.ok(calm.pos[k * 3] < -0.3, `free corner swung down to the pole (x=${calm.pos[k * 3].toFixed(2)})`);
  const windy = run(new Cloth({ width: 1.6, height: 1, segX: 20, segY: 12, pin: 'left', wind: new THREE.Vector3(7, 0, 1) }), 3);
  assert.ok(windy.pos[k * 3] > 0.4, `wind extends the flag (x=${windy.pos[k * 3].toFixed(2)})`);
  assert.ok(windy.maxStretch() < 0.12, `stretch ${windy.maxStretch()}`);
  const again = run(new Cloth({ width: 1.6, height: 1, segX: 20, segY: 12, pin: 'left', wind: new THREE.Vector3(7, 0, 1) }), 3);
  assert.deepEqual([...again.pos.slice(0, 30)], [...windy.pos.slice(0, 30)]);
});

test('cloth: colliders keep particles out (sphere, plane); pins follow a moving object', () => {
  const ball = new THREE.Object3D(); ball.position.set(0, -0.6, 0.05); ball.updateMatrixWorld();
  const c = new Cloth({ width: 1, height: 1.2, segX: 12, segY: 14, pin: 'top' }); c.addSphere(ball, 0.3); c.addPlane(new THREE.Vector3(0, 1, 0), -1.0);
  run(c, 2);
  let inside = 0, below = 0; for (let k = 0; k < c.count; k++) { const p = new THREE.Vector3().fromArray(c.pos, k * 3); if (p.distanceTo(ball.position) < 0.3 - 1e-3) inside++; if (p.y < -1.0 - 1e-3) below++; }
  assert.equal(inside, 0); assert.equal(below, 0);
  const pole = new THREE.Object3D(); const f = new Cloth({ width: 1, height: 0.6, segX: 8, segY: 6, pin: 'left' }); f.pinTo(pole);
  pole.position.set(2, 0, 0); pole.updateMatrixWorld(); f.update(1 / 60);
  assert.ok(Math.abs(f.pos[0] - 1.5) < 1e-4, 'pinned particle moved with the pole');
});

test('Cloth.cape: drapes behind a realistic human without entering the torso', async () => {
  const data = await H.loadHumanData();
  const h = H.buildHuman(data, H.characterFromSpec('knight', 3)); h.updateMatrixWorld(true);
  const cape = run(Cloth.cape(h), 2);
  const B = h.userData.bones, spine = new THREE.Vector3().setFromMatrixPosition(B.spine03.matrixWorld);
  let front = 0; for (let k = 0; k < cape.count; k++) if (cape.pos[k * 3 + 2] > spine.z + 0.05) front++;
  assert.ok(front < cape.count * 0.05, `${front} particles in front of the spine`);
  assert.ok(cape.maxStretch() < 0.35, `stretch ${cape.maxStretch()}`);
});
