import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../../engine/vendor/three/three.module.js';
import { solveTwoBone, solveCCD, CharacterIK, rigOf, bonePos, flatGround } from '../../engine/animation/ik.js';
import { Ragdoll } from '../../engine/animation/ragdoll.js';
import { createHumanoid } from '../../engine/character/humanoid.js';
import { CLIP_LIBRARY } from '../../engine/animation/clips.js';
import * as H from '../../engine/humans.js';

const data = await H.loadHumanData();
const human = () => { const h = H.buildHuman(data, H.characterFromSpec('civilian', 5)); h.userData.retargeter = new H.Retargeter(h.userData.bones); h.updateMatrixWorld(true); return h; };

// synthetic 3-bone arm: root at origin, 0.3 m + 0.25 m segments along -Y, slightly bent forward
function arm() {
  const g = new THREE.Group(), a = new THREE.Bone(), b = new THREE.Bone(), c = new THREE.Bone();
  b.position.set(0, -0.3, 0); c.position.set(0, -0.25, 0); a.add(b); b.add(c); g.add(a);
  b.rotation.x = 0.2; g.updateMatrixWorld(true);
  return { g, a, b, c };
}

test('two-bone IK reaches a reachable target within 1 mm (synthetic + realistic leg + stylized arm)', () => {
  const { a, b, c } = arm();
  for (const t of [new THREE.Vector3(0.1, -0.4, 0.15), new THREE.Vector3(-0.2, -0.2, 0.1), new THREE.Vector3(0, -0.5, 0.05)]) {
    const r = solveTwoBone(a, b, c, t, { pole: new THREE.Vector3(0, -0.3, 1) });
    assert.ok(bonePos(c).distanceTo(t) < 1e-3, `residual ${bonePos(c).distanceTo(t)}`); assert.ok(r.reached);
  }
  const h = human(), B = h.userData.bones;
  const ankle = bonePos(B['foot.L']), target = ankle.clone().add(new THREE.Vector3(0.03, 0.18, 0.08));
  solveTwoBone(B['upperleg01.L'], B['lowerleg01.L'], B['foot.L'], target, { pole: bonePos(B['lowerleg01.L']).add(new THREE.Vector3(0, 0, 1)) });
  assert.ok(bonePos(B['foot.L']).distanceTo(target) < 1e-3);
  assert.ok(bonePos(B['lowerleg01.L']).z > bonePos(B['upperleg01.L']).z, 'knee bends forward towards the pole');
  const s = createHumanoid({ seed: 3 }); s.updateMatrixWorld(true); const SB = s.userData.bones;
  const ht = bonePos(SB.upperArm_R).add(new THREE.Vector3(0.05, -0.25, 0.3));
  solveTwoBone(SB.upperArm_R, SB.lowerArm_R, SB.hand_R, ht);
  assert.ok(bonePos(SB.hand_R).distanceTo(ht) < 1e-3);
});

test('two-bone IK straightens towards an unreachable target and respects the pole side', () => {
  const { a, b, c } = arm();
  const far = new THREE.Vector3(0.5, -1.2, 0.4);
  solveTwoBone(a, b, c, far);
  const A = bonePos(a), Bp = bonePos(b), C = bonePos(c);
  assert.ok(Math.abs(C.distanceTo(A) - 0.55) < 1e-3, 'chain fully extended');
  const dir = far.clone().sub(A).normalize();
  assert.ok(C.clone().sub(A).normalize().dot(dir) > 0.9999, 'end points at the target');
  assert.ok(Bp.clone().sub(A).normalize().dot(dir) > 0.999, 'mid joint on the line');
  for (const side of [1, -1]) {
    const k = arm(); const t = new THREE.Vector3(0, -0.4, 0);
    solveTwoBone(k.a, k.b, k.c, t, { pole: new THREE.Vector3(side, -0.2, 0) });
    assert.ok(Math.sign(bonePos(k.b).x) === side && Math.abs(bonePos(k.b).x) > 0.1, `mid joint bends to the pole side ${side}`);
    assert.ok(Math.abs(bonePos(k.b).z) < 1e-6, 'bend stays in the pole plane');
  }
});

test('CCD fallback reaches a target with a 4-joint chain', () => {
  const g = new THREE.Group(); let parent = g; const bones = [];
  for (let i = 0; i < 5; i++) { const b = new THREE.Bone(); b.position.set(0, i ? 0.2 : 0, 0); parent.add(b); bones.push(b); parent = b; }
  g.updateMatrixWorld(true);
  const t = new THREE.Vector3(0.35, 0.45, 0.2);
  const r = solveCCD(bones.slice(0, 4), bones[4], t, { iterations: 40 });
  assert.ok(r.distance < 2e-3, `ccd residual ${r.distance}`);
});

test('look-at turns the head towards the target and clamps at the yaw limit', () => {
  for (const make of [human, () => { const s = createHumanoid({ seed: 2 }); s.updateMatrixWorld(true); return s; }]) {
    const h = make(); const ik = new CharacterIK(h, { footIK: false, lookLimits: { yaw: 60, up: 30, down: 40 } });
    const head = rigOf(h).bones.head;
    const fwdOf = () => ik._lookFwd.get(head).clone().applyQuaternion(head.getWorldQuaternion(new THREE.Quaternion()));
    ik.setLookTarget(new THREE.Vector3(1.0, 1.6, 2.0)); // ~27° left: inside the limits
    for (let i = 0; i < 120; i++) ik.update(1 / 60);
    const eye = head.localToWorld(ik._eyeLocal.clone()), want = new THREE.Vector3(1.0, 1.6, 2.0).sub(eye).normalize();
    assert.ok(fwdOf().angleTo(want) < 2 * Math.PI / 180, `aims at target (${(fwdOf().angleTo(want) * 180 / Math.PI).toFixed(2)}°)`);
    ik.setLookTarget(new THREE.Vector3(3, 1.6, 0.6)); // ~80° to the side: clamp at 60°
    for (let i = 0; i < 200; i++) ik.update(1 / 60);
    const f = fwdOf(); const yaw = Math.atan2(f.x, f.z) * 180 / Math.PI;
    assert.ok(Math.abs(yaw - 60) < 1.5, `clamped yaw ${yaw.toFixed(2)}`);
    ik.setLookTarget(new THREE.Vector3(0, 1.6, -3)); // behind: lets go smoothly
    for (let i = 0; i < 300; i++) ik.update(1 / 60);
    assert.ok(ik._look.w < 0.01, 'releases targets behind the character');
  }
});

test('foot IK plants both feet on a slope and on a step (realistic + stylized)', () => {
  const slope = (x, z) => ({ y: 0.25 * x, normal: new THREE.Vector3(-0.25, 1, 0).normalize() });
  for (const make of [human, () => { const s = createHumanoid({ seed: 4 }); s.updateMatrixWorld(true); return s; }]) {
    for (const ground of [slope, (x) => ({ y: x > 0 ? 0.15 : 0, normal: new THREE.Vector3(0, 1, 0) })]) {
      const h = make(); const ik = new CharacterIK(h, { ground, lookAt: false });
      h.position.y = ground(0, 0).y; h.updateMatrixWorld(true);
      ik.update(0);
      for (const s of ['L', 'R']) {
        const f = ik.feet[s]; const ankle = bonePos(f.foot); const g = ground(ankle.x, ankle.z).y;
        assert.ok(Math.abs(ankle.y - (g + f.ankleH)) < 0.012, `${s} ankle ${(ankle.y - g).toFixed(3)} above ground, rest ${f.ankleH.toFixed(3)}`);
      }
      assert.ok(ik.debug.hipsOffset <= 0, 'hips only drop');
    }
  }
});

test('foot IK does not accumulate across frames on a walking human', () => {
  const h = human(); const rt = h.userData.retargeter;
  const mixer = new THREE.AnimationMixer(h); mixer.clipAction(rt.clipFromPoseFn('idle', CLIP_LIBRARY.idle)).play();
  const ik = new CharacterIK(h, { ground: (x) => ({ y: 0.2 * x, normal: new THREE.Vector3(-0.2, 1, 0).normalize() }) });
  ik.setLookTarget(new THREE.Vector3(0.5, 1.6, 2));
  const snaps = [];
  for (let i = 0; i < 240; i++) { mixer.update(1 / 60); ik.update(1 / 60); if (i % 192 === 0) snaps.push(h.userData.bones.head.quaternion.clone()); }
  mixer.setTime(0); ik.update(1 / 60); // same anim time again: same result
  const all = Object.values(h.userData.bones).every((b) => b.quaternion.toArray().every(Number.isFinite));
  assert.ok(all, 'finite');
  assert.ok(snaps[0].angleTo(snaps[1]) < 0.05, 'look-at stable over time');
});

test('ragdoll keeps bone lengths within 2% over 300 steps and settles on the ground', () => {
  for (const make of [human, () => { const s = createHumanoid({ seed: 6 }); s.updateMatrixWorld(true); return s; }]) {
    const h = make(); h.position.y = 0.4; h.rotation.y = 0.7; h.updateMatrixWorld(true);
    const rd = new Ragdoll(h, { ground: flatGround(0) });
    rd.activate({ velocity: new THREE.Vector3(1.5, 0, 0.5), impulse: new THREE.Vector3(0, 30, -60), point: bonePos(h.userData.bones[rigOf(h).bones.chest.name]) });
    let worst = 0;
    for (let i = 0; i < 300; i++) { rd.step(); worst = Math.max(worst, rd.boneLengthError()); }
    for (let i = 0; i < 600; i++) rd.update(1 / 60);
    assert.ok(worst < 0.02, `bone length error ${(worst * 100).toFixed(2)}%`);
    for (const p of rd.particles) assert.ok(p.pos.y - p.r > -0.01, `${p.name} above ground (${p.pos.y.toFixed(3)})`);
    const top = Math.max(...rd.particles.map((p) => p.pos.y));
    assert.ok(top < 0.5, `lies on the ground (highest particle ${top.toFixed(2)} m)`);
    assert.ok(rd.settled, 'comes to rest');
    // bones follow the particles
    h.updateMatrixWorld(true);
    const hips = rigOf(h).bones.hips; assert.ok(bonePos(hips).distanceTo(rd.byName.pelvis.pos) < 1e-3);
    const B = rigOf(h).bones; const knee = bonePos(B.lowerLeg_L);
    assert.ok(knee.distanceTo(rd.byName.knL.pos) < 0.02, `skeleton knee follows the ragdoll (${knee.distanceTo(rd.byName.knL.pos).toFixed(3)})`);
    for (const b of Object.values(h.userData.bones)) assert.ok(b.quaternion.toArray().every(Number.isFinite));
  }
});

test('ShoulderedWeapon: butt in the shoulder pocket, both hands on the gun, all modes, any facing', async () => {
  const { ShoulderedWeapon } = await import('../../engine/gameplay/weapon-pose.js');
  const { weaponModel } = await import('../../engine/gameplay/weapon-models.js');
  for (const [kind, mode, yaw] of [['rifle', 'aim', 0], ['rifle', 'ready', 1.1], ['smg', 'aim', -2.4], ['shotgun', 'hip', 0.5]]) {
    const h = human(); h.rotation.y = yaw; const B = h.userData.bones;
    const ik = new CharacterIK(h, { lookAt: false, footIK: false }), gun = weaponModel(kind), sw = new ShoulderedWeapon(h, gun, ik, { mode });
    for (let i = 0; i < 40; i++) ik.update(1 / 60); // hand weights ease in
    h.updateMatrixWorld(true);
    const muzzle = gun.localToWorld(new THREE.Vector3(...gun.userData.sockets.muzzle)), fwd = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    assert.ok(muzzle.clone().sub(bonePos(B['upperarm01.R'])).dot(fwd) > 0.25, `${kind}/${mode}: muzzle in front of the body`);
    const butt = gun.localToWorld(sw.buttLocal.clone());
    assert.ok(butt.distanceTo(bonePos(B['upperarm01.R'])) < 0.2 + (mode === 'hip' ? 0.15 : 0), `${kind}/${mode}: butt at the shoulder (${butt.distanceTo(bonePos(B['upperarm01.R'])).toFixed(3)})`);
    for (const s of ['L', 'R']) assert.ok(bonePos(B['wrist.' + s]).distanceTo(sw._t[s]) < 0.01, `${kind}/${mode}: hand ${s} on its grip (${bonePos(B['wrist.' + s]).distanceTo(sw._t[s]).toFixed(3)} m)`);
    sw.dispose();
  }
});
