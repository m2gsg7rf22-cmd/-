import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../../engine/vendor/three/three.module.js';
import { building, streetBlock, FACADE_STYLES } from '../../engine/world/facade.js';

const tris = (o) => { let n = 0; o.traverse((m) => { if (m.isMesh) n += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3; }); return n; };

test('facade grammar: every style builds a grounded, sized, deterministic building with doors and a sane budget', () => {
  for (const style of Object.keys(FACADE_STYLES)) for (const ground of ['shop', 'lobby', 'residential', 'blank']) {
    const b = building({ width: 12, depth: 10, floors: 5, style, ground, seed: 7 });
    const box = new THREE.Box3().setFromObject(b), size = box.getSize(new THREE.Vector3());
    assert.ok(Math.abs(box.min.y) < 0.01, `${style}/${ground} grounded`);
    assert.ok(size.x >= 12 && size.x < 14.2 && size.z >= 10 && size.z < 13, `${style}/${ground} footprint ${size.x.toFixed(2)}×${size.z.toFixed(2)}`);
    assert.ok(Math.abs(size.y - b.userData.height) < 1.5);
    if (ground !== 'blank') assert.ok(b.userData.doors.length >= 1 && b.userData.doors[0].z > 5, `${style}/${ground} door on the front`);
    const t = tris(b); assert.ok(t > 1500 && t < 40000, `${style}/${ground} tris ${t}`);
    assert.ok(b.children.length <= 12, `${style}/${ground} draw calls ${b.children.length}`);
  }
  assert.equal(tris(building({ seed: 3 })), tris(building({ seed: 3 })));
  const blk = streetBlock({ length: 50, seed: 2 }), bb = new THREE.Box3().setFromObject(blk);
  assert.ok(blk.children.length >= 3 && bb.max.x - bb.min.x <= 51.5, 'block fills its length');
});
