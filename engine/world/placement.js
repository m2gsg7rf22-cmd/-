// Placement helpers for scene composition on a Heightfield: put objects on the ground (optionally
// aligned to the slope), carve level foundations, drape visible paths, scatter any prop with
// instancing, and audit floating/buried objects. Used by scene scripts (K.place …) and gameplay.
import * as THREE from '../vendor/three/three.module.js';
import { RNG } from '../core/rng.js';
import { scatterPoints, instanceProp } from './vegetation.js';
import { pbr } from '../render/materials.js';

/**
 * place(obj, hf, x, z, { yaw, align = 0, sink = 0.05, offsetY = 0 }) — sets position on the terrain.
 * align 0..1 tilts the object toward the ground normal (rocks, boats on sand: 0.6–1; buildings: 0).
 * The object's lowest point is assumed at its local y=0 (use K.ground on assets).
 */
export function place(obj, hf, x, z, { yaw = obj.rotation.y, align = 0, sink = 0.05, offsetY = 0 } = {}) {
  obj.position.set(x, hf.heightAt(x, z) - sink + offsetY, z);
  const qYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  if (align > 0) { const n = hf.normalAt(x, z).clone(), up = new THREE.Vector3(0, 1, 0).lerp(n, align).normalize(); obj.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up).multiply(qYaw); }
  else obj.quaternion.copy(qYaw);
  obj.userData.placed = true;
  return obj;
}

/**
 * foundation(hf, x, z, w, d, { pad = 2, falloff = 4, yaw = 0 }) — flattens a level pad for a
 * building (sampled at the pad's highest corner so nothing gets buried) and returns its height.
 * Call BEFORE terrainMesh(hf) so the mesh includes the pad. yaw is ignored by the rect pad (axis aligned).
 */
export function foundation(hf, x, z, w, d, { pad = 2, falloff = 4, height } = {}) {
  let h = height;
  if (h === undefined) { h = -Infinity; for (const [dx, dz] of [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2], [0, 0]]) h = Math.max(h, hf.heightAt(x + dx, z + dz)); }
  hf.flattenArea({ x, z, rect: [w + pad * 2, d + pad * 2], height: h, falloff });
  return h;
}

/**
 * pathStrip(hf, points, { width = 2.5, material, lift = 0.04, step = 1 }) — a visible path/road
 * ribbon draped on the terrain along [[x,z],…] (smooth Catmull-Rom). Pair with
 * Heightfield({ roads }) or hf.carveRoad() to also shape the ground.
 */
export function pathStrip(hf, points, { width = 2.5, material, lift = 0.04, step = 1, color = 0x8a7458, kind = 'dirt' } = {}) {
  const curve = new THREE.CatmullRomCurve3(points.map(([x, z]) => new THREE.Vector3(x, 0, z)));
  const n = Math.max(2, Math.ceil(curve.getLength() / step)), P = [], UV = [], I = [];
  let v = 0, prev = null;
  for (let i = 0; i <= n; i++) {
    const p = curve.getPoint(i / n), t = curve.getTangent(i / n), side = new THREE.Vector3(-t.z, 0, t.x).normalize();
    if (prev) v += p.distanceTo(prev); prev = p;
    for (const s of [-1, 1]) { const q = p.clone().addScaledVector(side, s * width / 2); q.y = hf.heightAt(q.x, q.z) + lift; P.push(q.x, q.y, q.z); UV.push(s < 0 ? 0 : 1, v / width); }
    if (i) { const a = (i - 1) * 2; I.push(a, a + 1, a + 3, a, a + 3, a + 2); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2)); g.setIndex(I);
  g.computeVertexNormals(); // winding gives +Y normals for paths drawn in any direction (fixed by flipping below)
  const nY = g.attributes.normal.getY(0); if (nY < 0) { for (let i = 0; i < I.length; i += 3) { const t2 = I[i + 1]; I[i + 1] = I[i + 2]; I[i + 2] = t2; } g.setIndex(I); g.computeVertexNormals(); }
  const mat = material || pbr(kind, { color, repeat: 1 }); mat.polygonOffset = true; mat.polygonOffsetFactor = -2;
  const m = new THREE.Mesh(g, mat); m.receiveShadow = true; m.name = 'path'; m.userData.kind = 'path';
  return m;
}

/**
 * scatter(hf, prop, rules, { seed, sink, align }) — instanced copies of ANY prop over the terrain.
 * rules = scatterPoints rules: { count, minHeight, maxHeight, maxSlope, exclude: [{x,z,r} | {x,z,rect:[w,d],pad}],
 * density: (x,z) => 0..1 (gradients: dense at edges, open in the centre), scale: [a,b], spacing, margin }.
 * Returns { group, points }.
 */
export function scatter(hf, prop, rules, { seed = 1, sink = 0.05, align = 0 } = {}) {
  const pts = scatterPoints(hf, rules, new RNG(seed));
  const mats = pts.map((p) => {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.ry);
    if (align > 0) { const n = hf.normalAt(p.x, p.z).clone(); q.premultiply(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 1, 0).lerp(n, align).normalize())); }
    return new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y - sink, p.z), q, new THREE.Vector3(p.s, p.s, p.s));
  });
  return { group: instanceProp(prop, mats), points: pts };
}

/**
 * groundAudit(root, hf, { floating = 0.25, buried = 0.6 }) — for every direct child tagged with
 * userData.kind (excluding terrain/water/path/vegetation instances), compare its lowest point with the
 * terrain under its centre: floating = lowest point > `floating` m above ground, buried = < 40 % of its
 * height above ground. Returns { floating: [names], buried: [names], checked }.
 */
export function groundAudit(root, hf, { floating = 0.25, buried = 0.6 } = {}) {
  const res = { floating: [], buried: [], checked: 0 }; const box = new THREE.Box3(), c = new THREE.Vector3();
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    const k = o.userData?.kind; if (!k || ['terrain', 'water', 'path', 'vegetation', 'tree'].includes(k) || o.userData.floating) return;
    if (o.parent && o.parent !== root && o.parent.userData?.kind) return; // only top-level tagged assets
    box.setFromObject(o); if (box.isEmpty()) return; box.getCenter(c);
    if (!hf.inBounds(c.x, c.z)) return;
    const g = hf.heightAt(c.x, c.z), gap = box.min.y - g; res.checked++;
    if (gap > floating && g > hf.waterLevel) res.floating.push(`${o.name || k}@(${c.x.toFixed(0)},${c.z.toFixed(0)}) +${gap.toFixed(2)}m`);
    const hgt = Math.max(1e-3, box.max.y - box.min.y), visible = (box.max.y - g) / hgt; // fraction above the ground under its centre
    if (visible < 0.4) res.buried.push(`${o.name || k}@(${c.x.toFixed(0)},${c.z.toFixed(0)}) ${(visible * 100).toFixed(0)}% visible`);
  });
  return res;
}
