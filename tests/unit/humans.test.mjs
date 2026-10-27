import test from 'node:test';
import assert from 'node:assert/strict';
import * as H from '../../engine/humans.js';
import { CLIP_LIBRARY } from '../../engine/animation/clips.js';

const { THREE } = H;
const data = await H.loadHumanData();

test('human dataset decodes with skeleton, targets and poses', () => {
  assert.ok(data.basePositions.length > 30000);
  assert.ok(Object.keys(data.boneIndex).length >= 160, 'MakeHuman default skeleton (163 bones)');
  assert.ok(Object.keys(data.poses).includes('walk'));
});

test('buildHuman hits requested stature exactly and is deterministic', () => {
  for (const heightCm of [152, 168, 191]) {
    const h = H.buildHuman(data, { sex: heightCm > 170 ? 1 : 0, heightCm });
    assert.ok(Math.abs(h.userData.height * 100 - heightCm) < 0.5, `${heightCm} -> ${h.userData.height}`);
  }
  const a = H.buildHuman(data, H.characterFromSpec('soldier', 9)).userData.mesh.geometry.attributes.position.array;
  const b = H.buildHuman(data, H.characterFromSpec('soldier', 9)).userData.mesh.geometry.attributes.position.array;
  assert.deepEqual(a.slice(0, 3000), b.slice(0, 3000));
});

test('macro parameters change the body measurably', () => {
  const meanRadius = (h) => { const p = h.userData.mesh.geometry.attributes.position; let s = 0; for (let i = 0; i < p.count; i++) s += Math.hypot(p.getX(i), p.getZ(i)); return s / p.count; };
  const thin = meanRadius(H.buildHuman(data, { sex: 1, weight: 0, muscle: 0 })), heavy = meanRadius(H.buildHuman(data, { sex: 1, weight: 1, muscle: 0 }));
  assert.ok(heavy > thin * 1.04, `mean radius ${thin} vs ${heavy}`);
});

test('skin weights are normalised and feet rest on the floor', () => {
  const h = H.buildHuman(data, H.characterFromSpec('athlete', 3));
  const sw = h.userData.mesh.geometry.attributes.skinWeight.array;
  for (let i = 0; i < sw.length; i += 4) assert.ok(Math.abs(sw[i] + sw[i + 1] + sw[i + 2] + sw[i + 3] - 1) < 2e-3);
  const p = h.userData.mesh.geometry.attributes.position; let minY = Infinity; for (let i = 0; i < p.count; i++) minY = Math.min(minY, p.getY(i));
  assert.ok(Math.abs(minY) < 0.02);
});

test('assembleHuman dresses, adds hair, shoes and a retargeter', () => {
  const h = H.assembleHuman(data, { ...H.characterFromSpec('civilian', 4), textureSize: 128 });
  const names = []; h.traverse((o) => o.isMesh && names.push(o.name));
  assert.ok(names.some((n) => /garment:(sneakers|shoes|boots):L/.test(n)), 'procedural shoe: ' + names.join(','));
  assert.ok(h.userData.hair, 'hair');
  assert.ok(h.userData.retargeter, 'retargeter');
  assert.ok(h.userData.sockets.hand_R && h.userData.sockets.head);
});

test('retargeted procedural clips and BVH mocap produce finite tracks', () => {
  const h = H.buildHuman(data, H.characterFromSpec('civilian', 5));
  const rt = new H.Retargeter(h.userData.bones);
  const clip = rt.clipFromPoseFn('walk', CLIP_LIBRARY.walk);
  assert.ok(clip.tracks.length > 10);
  for (const t of clip.tracks) for (const v of t.values) assert.ok(Number.isFinite(v));
  const bvh = H.clipFromBVHCanonical(rt, data.poses.walk, { name: 'mocap' });
  assert.ok(bvh.duration > 0.3 && bvh.tracks.length > 10);
  for (const t of bvh.tracks) for (const v of t.values) assert.ok(Number.isFinite(v));
});

test('facial expressions move face vertices', () => {
  assert.ok(Object.keys(H.EXPRESSIONS).length >= 5);
  const h = H.buildHuman(data, H.characterFromSpec('civilian', 6));
  h.userData.setExpression('happy'); h.userData.face.update(0.5); // 'happy' is an alias of 'smile'
  const inf = h.userData.mesh.morphTargetInfluences;
  assert.ok(inf && inf.some((v) => v > 0.05), 'some morph influence active');
});

test('lookToHumanSpec maps legacy stylized looks onto archetypes and colours', () => {
  const s = H.lookToHumanSpec({ outfit: 'armor', top: 0x223344, seed: 2, hairStyle: 'long' });
  assert.ok(Array.isArray(s.outfit) && s.outfit.some((o) => o.type === 'cuirass'));
  assert.equal(s.outfit.find((o) => o.type === 'longsleeve').color, 0x223344);
  assert.equal(s.hair, 'long');
  const t = H.lookToHumanSpec({ archetype: 'wizard', seed: 3 });
  assert.ok(t.outfit.some((o) => o.type === 'robe'));
});
