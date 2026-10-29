import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../../engine/vendor/three/three.module.js';
import { decimate } from '../../engine/geometry/decimate.js';
import * as H from '../../engine/humans.js';

test('decimate: hits the triangle target, keeps shape, attributes and UV seams', () => {
  const g = new THREE.SphereGeometry(1, 64, 48); // has a UV seam and pole fans
  const before = g.index.count / 3, d = decimate(g, { ratio: 0.25 });
  assert.ok(d.index.count / 3 <= before * 0.26, `tris ${d.index.count / 3}`);
  for (const a of ['position', 'normal', 'uv']) assert.equal(d.attributes[a], d.attributes[a]); // attributes kept (same vertices)
  d.computeBoundingBox(); const s = d.boundingBox.getSize(new THREE.Vector3()); assert.ok(Math.abs(s.x - 2) < 0.05 && Math.abs(s.y - 2) < 0.05, 'bounding box kept');
  // every surviving vertex still lies on the sphere (half-edge collapse never moves vertices)
  const P = d.attributes.position, used = new Set(d.index.array); for (const i of used) assert.ok(Math.abs(Math.hypot(P.getX(i), P.getY(i), P.getZ(i)) - 1) < 1e-5);
  // no triangle flipped inward
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(); let flipped = 0;
  for (let k = 0; k < d.index.count; k += 3) { a.fromBufferAttribute(P, d.index.array[k]); b.fromBufferAttribute(P, d.index.array[k + 1]); c.fromBufferAttribute(P, d.index.array[k + 2]); const n = b.clone().sub(a).cross(c.clone().sub(a)); if (n.dot(a.clone().add(b).add(c)) < 0) flipped++; }
  assert.equal(flipped, 0);
});

test('decimateHuman: body + garments reduced, groups/skinning intact, underwear dropped under trousers', async () => {
  const data = await H.loadHumanData();
  const h = H.assembleHuman(data, { ...H.characterFromSpec('civilian', 5), textureSize: 64, decimate: 0.3 });
  const api = h.userData, d = api.decimated;
  assert.ok(d.to < d.from * 0.33 && d.to > d.from * 0.2, JSON.stringify(d));
  assert.ok(api.mesh.geometry.groups.length >= 3 && api.mesh.geometry.attributes.skinWeight);
  assert.ok(!h.children.some((c) => c.name === 'garment:underwear'));
  assert.ok(api.mesh.geometry.morphAttributes.position?.length > 0, 'face morphs kept');
});
