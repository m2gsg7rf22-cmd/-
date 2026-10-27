// Instanced scattering of trees, rocks, bushes and grass over a heightfield using
// jittered-grid sampling with height/slope/exclusion rules. One draw call per mesh part.
import * as THREE from '../vendor/three/three.module.js';
import { RNG } from '../core/rng.js';
import { tree, rock, bush } from '../geometry/props.js';
import { applyWind, solid } from '../render/materials.js';

// Convert a prop Group (merged meshes) into InstancedMeshes sharing transforms.
export function instanceProp(prop, matrices, { castShadow = true, receiveShadow = true, wind = false } = {}) {
  const group = new THREE.Group(); group.name = 'instances:' + prop.name;
  prop.updateMatrixWorld(true);
  prop.traverse((m) => {
    if (!m.isMesh) return;
    const geo = m.geometry.clone().applyMatrix4(m.matrixWorld);
    const mat = wind ? applyWind(m.material.clone(), { instanced: true, strength: 0.08 }) : m.material;
    const im = new THREE.InstancedMesh(geo, mat, matrices.length);
    matrices.forEach((mx, i) => im.setMatrixAt(i, mx));
    im.instanceMatrix.needsUpdate = true; im.castShadow = castShadow; im.receiveShadow = receiveShadow;
    im.computeBoundingSphere();
    group.add(im);
  });
  return group;
}

// rules: { count, minHeight, maxHeight, maxSlope, exclude: [{x,z,r}], scale: [a,b], spacing }
export function scatterPoints(hf, rules, rng) {
  const out = [];
  const spacing = rules.spacing ?? Math.sqrt((hf.size * hf.size) / Math.max(1, rules.count));
  const cells = Math.floor(hf.size / spacing);
  const margin = rules.margin ?? 8;
  for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) {
    if (out.length >= rules.count) break;
    const x = -hf.half + (i + rng.next()) * spacing, z = -hf.half + (j + rng.next()) * spacing;
    if (!hf.inBounds(x, z, margin)) continue;
    if (rules.density && rng.next() > rules.density(x, z)) continue;
    const y = hf.heightAt(x, z);
    if (y < (rules.minHeight ?? hf.waterLevel + 1.2) || y > (rules.maxHeight ?? Infinity)) continue;
    if (hf.slopeAt(x, z) > (rules.maxSlope ?? 0.35)) continue;
    if (rules.exclude && rules.exclude.some((e) => (e.rect ? Math.abs(x - e.x) < e.rect[0] / 2 + (e.pad ?? 2) && Math.abs(z - e.z) < e.rect[1] / 2 + (e.pad ?? 2) : Math.hypot(x - e.x, z - e.z) < e.r))) continue;
    out.push({ x, y, z, s: rng.range(...(rules.scale ?? [0.8, 1.2])), ry: rng.range(0, Math.PI * 2) });
  }
  return out;
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _up = new THREE.Vector3(0, 1, 0);
function toMatrices(points, sink = 0.1) { return points.map((p) => { _q.setFromAxisAngle(_up, p.ry); return new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y - sink, p.z), _q.clone(), new THREE.Vector3(p.s, p.s, p.s)); }); }

// High-level biome population. Returns { group, colliders: [{x,z,r,h}] }.
export function populate(hf, { seed = 1, trees = 300, rocks = 120, bushes = 200, grass = 6000, species = ['oak', 'pine'], exclude = [], treeMaxHeight, palette = {}, grassRadius } = {}) {
  const rng = new RNG(seed), group = new THREE.Group(); group.name = 'vegetation';
  const colliders = [];
  const variants = Math.min(4, species.length * 2);
  const treePts = scatterPoints(hf, { count: trees, maxSlope: 0.3, exclude, scale: [0.8, 1.35], maxHeight: treeMaxHeight, density: (x, z) => 0.35 + 0.65 * (hf.heightAt(x * 0.7 + 40, z * 0.7) > hf.heightAt(x, z) ? 1 : 0.5) }, rng.fork('trees'));
  for (let v = 0; v < variants; v++) {
    const pts = treePts.filter((_, i) => i % variants === v);
    if (!pts.length) continue;
    const sp = species[v % species.length];
    const proto = tree({ species: sp, seed: seed * 7 + v, leafColor: palette.leaves ? palette.leaves[v % palette.leaves.length] : undefined });
    group.add(instanceProp(proto, toMatrices(pts, 0.2), { wind: false }));
    for (const p of pts) colliders.push({ x: p.x, z: p.z, r: 0.45 * p.s, h: 6 * p.s, kind: 'tree' });
  }
  const rockPts = scatterPoints(hf, { count: rocks, maxSlope: 0.6, minHeight: hf.waterLevel - 2, exclude, scale: [0.5, 2.2] }, rng.fork('rocks'));
  for (let v = 0; v < 3; v++) {
    const pts = rockPts.filter((_, i) => i % 3 === v); if (!pts.length) continue;
    group.add(instanceProp(rock({ seed: seed + v * 31, size: 1 }), toMatrices(pts, 0.3)));
    for (const p of pts) if (p.s > 0.9) colliders.push({ x: p.x, z: p.z, r: 0.9 * p.s, h: 1.4 * p.s, kind: 'rock' });
  }
  const bushPts = scatterPoints(hf, { count: bushes, maxSlope: 0.35, exclude, scale: [0.6, 1.3] }, rng.fork('bush'));
  if (bushPts.length) group.add(instanceProp(bush({ seed, color: palette.bush ?? 0x46702a }), toMatrices(bushPts, 0.15), { castShadow: false }));
  if (grass > 0) group.add(grassField(hf, { count: grass, seed, exclude, color: palette.grass ?? 0x5d8a32, radius: grassRadius }));
  return { group, colliders, treePts, rockPts };
}

// Grass tufts: crossed alpha-free blades, wind-animated, single instanced draw.
export function grassField(hf, { count = 6000, seed = 1, exclude = [], color = 0x5d8a32, radius } = {}) {
  const rng = new RNG(seed + 5);
  const blades = [], N = 7;
  const pos = [], col = [], idx = [];
  const base = new THREE.Color(color);
  for (let b = 0; b < N; b++) {
    const a = rng.range(0, Math.PI), ox = rng.range(-0.2, 0.2), oz = rng.range(-0.2, 0.2), h = rng.range(0.35, 0.7), w = 0.05;
    const dx = Math.cos(a) * w, dz = Math.sin(a) * w, lean = rng.range(-0.15, 0.15);
    const k = pos.length / 3;
    pos.push(ox - dx, 0, oz - dz, ox + dx, 0, oz + dz, ox + lean * Math.cos(a + 1.5), h, oz + lean * Math.sin(a + 1.5));
    const c0 = base.clone().multiplyScalar(0.45), c1 = base.clone().multiplyScalar(rng.range(1.0, 1.35));
    col.push(c0.r, c0.g, c0.b, c0.r, c0.g, c0.b, c1.r, c1.g, c1.b);
    idx.push(k, k + 1, k + 2);
    blades.push(b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx);
  g.computeVertexNormals();
  // make normals point up for soft, uniform lighting
  const nor = g.attributes.normal; for (let i = 0; i < nor.count; i++) nor.setXYZ(i, 0, 1, 0);
  const mat = applyWind(solid(0xffffff, { roughness: 0.9, vertexColors: true, side: THREE.DoubleSide }).clone(), { instanced: true, strength: 0.25, heightScale: 1.5 });
  const pts = scatterPoints(hf, { count, maxSlope: 0.3, exclude, scale: [0.7, 1.4], spacing: radius ? (radius * 2) / Math.sqrt(count) : undefined, margin: 2 }, rng);
  const im = new THREE.InstancedMesh(g, mat, pts.length);
  pts.forEach((p, i) => { _q.setFromAxisAngle(_up, p.ry); im.setMatrixAt(i, _m.compose(new THREE.Vector3(p.x, p.y - 0.02, p.z), _q, new THREE.Vector3(p.s, p.s, p.s))); });
  im.instanceMatrix.needsUpdate = true; im.receiveShadow = true; im.castShadow = false; im.name = 'grass';
  im.computeBoundingSphere();
  return im;
}
