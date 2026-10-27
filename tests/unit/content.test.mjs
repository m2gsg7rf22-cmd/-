import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../../engine/vendor/three/three.module.js';
import { generateTexture, TEXTURE_KINDS, seamError, textureStats } from '../../engine/render/textures.js';
import { MaterialLibrary } from '../../engine/render/materials.js';
import { loft, ellipseRing, lathe, roundedBox, displace, validateGeometry, validateObject, MeshBuilder, mergeByMaterial } from '../../engine/geometry/builders.js';
import { PROPS } from '../../engine/geometry/props.js';
import { BUILDINGS } from '../../engine/geometry/buildings.js';
import { car, VEHICLE_TYPES } from '../../engine/geometry/vehicles.js';
import { createHumanoid, BONES } from '../../engine/character/humanoid.js';
import { CLIP_LIBRARY, buildClip } from '../../engine/animation/clips.js';
import { exportGLB, parseGLBHeader, exportOBJ } from '../../engine/geometry/export.js';
MaterialLibrary.textureSize = 32;

test('every texture recipe produces varied, seamless PBR maps', () => {
  for (const k of TEXTURE_KINDS) {
    const t = generateTexture(k, { size: 64 });
    assert.equal(t.albedo.length, 64 * 64 * 4);
    const st = textureStats(t.albedo); assert.ok(st.std > 1, `${k} has variation`);
    const seam = seamError(t.albedo, 64); assert.ok(seam < 6, `${k} seam ratio ${seam.toFixed(2)} tiles`);
    for (let i = 2; i < t.normal.length; i += 4) assert.ok(t.normal[i] >= 127, `${k} normal z positive`);
  }
});
test('procedural primitives are valid geometry', () => {
  const g = loft([{ z: 0, ring: ellipseRing(12, 1, 1) }, { z: 1, ring: ellipseRing(12, 0.5, 0.8) }, { z: 2, ring: ellipseRing(12, 0.8, 0.3) }]);
  for (const geo of [g, lathe([[0.2, 0], [1, 0.5], [0.4, 1]]), roundedBox(1, 2, 3, 0.2), displace(new THREE.IcosahedronGeometry(1, 2), { amount: 0.2 })]) {
    const r = validateGeometry(geo); assert.ok(r.ok, r.issues.join(','));
  }
});
test('all props, buildings and vehicles validate', () => {
  for (const [k, f] of Object.entries(PROPS)) { const r = validateObject(f({})); assert.ok(r.ok, `${k}: ${r.issues}`); assert.ok(r.triangles > 10); }
  for (const s of ['oak', 'pine', 'palm', 'dead']) assert.ok(validateObject(PROPS.tree({ species: s })).ok);
  for (const [k, f] of Object.entries(BUILDINGS)) { const b = f({ seed: 3 }); const r = validateObject(b); assert.ok(r.ok, k); assert.ok(b.userData.collider.size.every((v) => v > 0)); }
  for (const t of Object.keys(VEHICLE_TYPES)) { const c = car({ type: t }); assert.ok(validateObject(c).ok, t); assert.equal(c.userData.wheels.length, 4); }
});
test('humanoid: skeleton, normalized skin weights, all outfits', () => {
  for (const o of [{}, { outfit: 'armor', armor: true, helmet: true, cape: true }, { outfit: 'robe', hairStyle: 'long' }, { outfit: 'suit' }, { hairStyle: 'bald', beard: true }]) {
    const h = createHumanoid({ seed: 5, ...o });
    const g = h.userData.mesh.geometry, sw = g.attributes.skinWeight, si = g.attributes.skinIndex;
    for (let i = 0; i < sw.count; i++) { const s = sw.getX(i) + sw.getY(i) + sw.getZ(i) + sw.getW(i); assert.ok(Math.abs(s - 1) < 1e-3); assert.ok(si.getX(i) < BONES.length); }
    assert.equal(h.userData.skeleton.bones.length, BONES.length);
    const size = validateObject(h).size; assert.ok(size[1] > 1.5 && size[1] < 2.3, 'human height');
  }
});
test('animation clips sample to valid tracks', () => {
  for (const [name, def] of Object.entries(CLIP_LIBRARY)) {
    const c = buildClip(name, def);
    assert.ok(c.tracks.length >= BONES.length - 1, name);
    for (const t of c.tracks) if (t.name.endsWith('.quaternion')) for (let i = 0; i < t.values.length; i += 4) { const l = Math.hypot(t.values[i], t.values[i + 1], t.values[i + 2], t.values[i + 3]); assert.ok(Math.abs(l - 1) < 1e-4); }
    if (def.events) for (const v of Object.values(def.events)) assert.ok(v > 0 && v < 1);
  }
});
test('GLB/OBJ export produce valid containers', () => {
  const glb = exportGLB(PROPS.barrel({}));
  const h = parseGLBHeader(glb); assert.equal(h.version, 2); assert.equal(h.length, glb.length);
  assert.ok(h.json.meshes.length >= 2); assert.ok(h.json.accessors.every((a) => a.count > 0));
  const obj = exportOBJ(PROPS.crate({})); assert.match(obj, /^# GameForge/); assert.ok(obj.split('\nf ').length > 10);
});
test('mergeByMaterial reduces draw calls', () => {
  const g = new THREE.Group(); for (let i = 0; i < 10; i++) { const c = PROPS.crate({}); c.position.x = i * 2; g.add(c); }
  let before = 0; g.traverse((o) => { if (o.isMesh) before++; });
  const m = mergeByMaterial(g); let after = 0; m.traverse((o) => { if (o.isMesh) after++; });
  assert.ok(after < before / 4, `${before} -> ${after}`);
  void MeshBuilder;
});
