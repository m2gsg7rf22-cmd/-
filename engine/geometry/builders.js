// Procedural geometry toolkit: lofts between cross-sections, rings, lathes, tubes,
// rounded boxes, noise displacement, UV projection, and a MeshBuilder that merges
// parts per material to keep draw calls low. Works in Node (no DOM needed).
import * as THREE from '../vendor/three/three.module.js';
import { mergeGeometries, mergeVertices } from '../vendor/three/addons/utils/BufferGeometryUtils.js';
import { Noise } from '../core/rng.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();

export function mat4(pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1]) {
  _e.set(rot[0], rot[1], rot[2]);
  _q.setFromEuler(_e);
  const sc = typeof scale === 'number' ? [scale, scale, scale] : scale;
  return new THREE.Matrix4().compose(_p.set(pos[0], pos[1], pos[2]), _q, _s.set(sc[0], sc[1], sc[2]));
}

// --- cross-section rings (2D, closed, counter-clockwise) ---
export function ellipseRing(n, rx, ry, cx = 0, cy = 0) {
  const out = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; out.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]); }
  return out;
}
// Superellipse: exponent 2 = ellipse, higher = boxier with rounded corners.
export function superRing(n, rx, ry, exp = 4, cx = 0, cy = 0) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    out.push([cx + Math.sign(c) * Math.pow(Math.abs(c), 2 / exp) * rx, cy + Math.sign(s) * Math.pow(Math.abs(s), 2 / exp) * ry]);
  }
  return out;
}
// Ring with independent top/bottom half-heights and width taper at top (e.g. car greenhouse, torso).
export function profileRing(n, { width = 1, top = 0.5, bottom = 0.5, topWidth = width, exp = 3.5, cy = 0 } = {}) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    const up = s >= 0;
    const w = up ? topWidth : width;
    out.push([Math.sign(c) * Math.pow(Math.abs(c), 2 / exp) * w / 2, cy + Math.sign(s) * Math.pow(Math.abs(s), 2 / exp) * (up ? top : bottom)]);
  }
  return out;
}

// Loft along Z (or custom axis frames). sections: [{ z, ring: [[x,y]...], x?: offsetX, y?: offsetY, scale? }]
// All rings must share the point count. caps: close start/end with fans.
export function loft(sections, { caps = true, uvScale = 1, axis = 'z' } = {}) {
  const n = sections[0].ring.length;
  for (const s of sections) if (s.ring.length !== n) throw new Error('loft: ring sizes differ');
  const pos = [], uv = [], idx = [];
  // accumulate V along length using arc length
  let vAcc = 0; const vs = [0];
  for (let i = 1; i < sections.length; i++) { vAcc += Math.abs(sections[i].z - sections[i - 1].z); vs.push(vAcc); }
  const put = (x, y, z) => { if (axis === 'z') pos.push(x, y, z); else if (axis === 'y') pos.push(x, z, -y); else pos.push(z, y, -x); };
  for (let si = 0; si < sections.length; si++) {
    const s = sections[si], sc = s.scale ?? 1, ox = s.x ?? 0, oy = s.y ?? 0;
    // perimeter length for U
    let per = 0; const us = [0];
    for (let i = 1; i <= n; i++) { const a = s.ring[i - 1], b = s.ring[i % n]; per += Math.hypot(b[0] - a[0], b[1] - a[1]) * sc; us.push(per); }
    for (let i = 0; i <= n; i++) {
      const p = s.ring[i % n];
      put(ox + p[0] * sc, oy + p[1] * sc, s.z);
      uv.push(us[i] * uvScale, vs[si] * uvScale);
    }
  }
  const row = n + 1;
  for (let si = 0; si < sections.length - 1; si++) for (let i = 0; i < n; i++) {
    const a = si * row + i, b = a + 1, c = a + row, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  if (caps) {
    for (const [si, flip] of [[0, true], [sections.length - 1, false]]) {
      const s = sections[si], sc = s.scale ?? 1, ox = s.x ?? 0, oy = s.y ?? 0;
      let cx = 0, cy = 0; for (const p of s.ring) { cx += p[0]; cy += p[1]; } cx /= n; cy /= n;
      const base = pos.length / 3;
      put(ox + cx * sc, oy + cy * sc, s.z); uv.push(0.5, 0.5);
      for (let i = 0; i < n; i++) { const p = s.ring[i]; put(ox + p[0] * sc, oy + p[1] * sc, s.z); uv.push(p[0] * uvScale, p[1] * uvScale); }
      for (let i = 0; i < n; i++) {
        const a = base + 1 + i, b = base + 1 + ((i + 1) % n);
        if (flip) idx.push(base, b, a); else idx.push(base, a, b);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Smooth-ish loft: interpolate sections with Catmull-Rom on each ring vertex.
export function smoothLoft(sections, steps = 4, opts = {}) {
  if (sections.length < 3) return loft(sections, opts);
  const out = [];
  const get = (i) => sections[Math.max(0, Math.min(sections.length - 1, i))];
  const cr = (p0, p1, p2, p3, t) => 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
  for (let i = 0; i < sections.length - 1; i++) {
    for (let k = 0; k < steps; k++) {
      const t = k / steps, s0 = get(i - 1), s1 = get(i), s2 = get(i + 1), s3 = get(i + 2);
      const ring = s1.ring.map((p, j) => [cr(s0.ring[j][0], p[0], s2.ring[j][0], s3.ring[j][0], t), cr(s0.ring[j][1], p[1], s2.ring[j][1], s3.ring[j][1], t)]);
      out.push({ z: cr(s0.z, s1.z, s2.z, s3.z, t), x: cr(s0.x ?? 0, s1.x ?? 0, s2.x ?? 0, s3.x ?? 0, t), y: cr(s0.y ?? 0, s1.y ?? 0, s2.y ?? 0, s3.y ?? 0, t), ring });
    }
  }
  out.push(sections[sections.length - 1]);
  return loft(out, opts);
}

// Lathe from [[radius, y], ...] profile.
export function lathe(profile, segments = 24, phiStart = 0, phiLength = Math.PI * 2) {
  return new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(Math.max(0, r), y)), segments, phiStart, phiLength);
}

// Tube along points with per-point radius function r(t).
export function tube(points, radius = 0.1, radial = 8, segments = 24, closed = false) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => (p.isVector3 ? p : new THREE.Vector3(...p))), closed);
  const geo = new THREE.TubeGeometry(curve, segments, typeof radius === 'number' ? radius : 1, radial, closed);
  if (typeof radius === 'function') {
    const pos = geo.attributes.position, frames = curve.computeFrenetFrames(segments, closed);
    const v = new THREE.Vector3();
    for (let i = 0; i <= segments; i++) {
      const c = curve.getPointAt(i / segments), r = radius(i / segments);
      for (let j = 0; j <= radial; j++) {
        const k = i * (radial + 1) + j;
        v.fromBufferAttribute(pos, k).sub(c).multiplyScalar(r).add(c);
        pos.setXYZ(k, v.x, v.y, v.z);
      }
    }
    void frames;
    geo.computeVertexNormals();
  }
  return geo;
}

export function roundedBox(w = 1, h = 1, d = 1, r = 0.1, seg = 3) {
  // Box with rounded edges built by pushing subdivided box vertices onto an inner box + radius.
  const g = new THREE.BoxGeometry(w, h, d, seg * 2, seg * 2, seg * 2);
  const pos = g.attributes.position, v = new THREE.Vector3(), inner = new THREE.Vector3(w / 2 - r, h / 2 - r, d / 2 - r);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const c = new THREE.Vector3(Math.max(-inner.x, Math.min(inner.x, v.x)), Math.max(-inner.y, Math.min(inner.y, v.y)), Math.max(-inner.z, Math.min(inner.z, v.z)));
    const dir = v.clone().sub(c);
    if (dir.lengthSq() > 1e-9) v.copy(c).add(dir.normalize().multiplyScalar(r));
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

// Displace along normals with 3D fbm noise (rocks, terrain props, organic forms).
export function displace(geo, { amount = 0.2, frequency = 1.5, seed = 1, octaves = 4 } = {}) {
  geo.deleteAttribute('uv'); geo.deleteAttribute('normal');
  const g = mergeVertices(geo, 1e-4);
  g.computeVertexNormals();
  const noise = new Noise(seed), pos = g.attributes.position, nor = g.attributes.normal;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const d = noise.fbm3(x * frequency, y * frequency, z * frequency, octaves) * amount;
    pos.setXYZ(i, x + nor.getX(i) * d, y + nor.getY(i) * d, z + nor.getZ(i) * d);
  }
  g.computeVertexNormals();
  return g;
}

// World-scale box-projected UVs (so tiling textures keep a constant texel density).
export function boxUV(geo, scale = 1) {
  const pos = geo.attributes.position; let nor = geo.attributes.normal;
  if (!nor) { geo.computeVertexNormals(); nor = geo.attributes.normal; }
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const nx = Math.abs(nor.getX(i)), ny = Math.abs(nor.getY(i)), nz = Math.abs(nor.getZ(i));
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    let u, v;
    if (ny >= nx && ny >= nz) { u = x; v = z; } else if (nx >= nz) { u = z; v = y; } else { u = x; v = y; }
    uv[i * 2] = u * scale; uv[i * 2 + 1] = v * scale;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

export function vertexColor(geo, color) {
  const c = new THREE.Color(color), n = geo.attributes.position.count, arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

// Normalise attributes so heterogeneous geometries can be merged.
export function normalizeAttributes(geo, { color = false } = {}) {
  let g = geo.index ? geo : geo;
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color', 'skinIndex', 'skinWeight'].includes(k)) g.deleteAttribute(k);
  if (color && !g.attributes.color) vertexColor(g, 0xffffff);
  if (!color && g.attributes.color) g.deleteAttribute('color');
  if (!g.index) { const n = g.attributes.position.count; const ix = new (n > 65535 ? Uint32Array : Uint16Array)(n); for (let i = 0; i < n; i++) ix[i] = i; g.setIndex(new THREE.BufferAttribute(ix, 1)); }
  g.morphAttributes = {};
  return g;
}

export function merge(geos, opts = {}) {
  const useColor = opts.color ?? geos.some((g) => g.attributes.color);
  const list = geos.map((g) => normalizeAttributes(g, { color: useColor }));
  const hasSkin = list.some((g) => g.attributes.skinIndex);
  if (hasSkin) for (const g of list) if (!g.attributes.skinIndex) throw new Error('merge: mixing skinned and unskinned geometry');
  const out = mergeGeometries(list, false);
  if (!out) throw new Error('merge failed: incompatible attributes');
  return out;
}

// Collects parts keyed by material and outputs one mesh per material.
export class MeshBuilder {
  constructor() { this.parts = new Map(); this.materials = new Map(); }
  add(geo, material, matrix) {
    const g = geo.clone();
    if (matrix) g.applyMatrix4(matrix);
    const key = material.uuid;
    this.materials.set(key, material);
    if (!this.parts.has(key)) this.parts.set(key, []);
    this.parts.get(key).push(g);
    return this;
  }
  addAt(geo, material, pos, rot, scale) { return this.add(geo, material, mat4(pos, rot, scale)); }
  build({ castShadow = true, receiveShadow = true, name = 'built' } = {}) {
    const group = new THREE.Group(); group.name = name;
    for (const [key, list] of this.parts) {
      const mesh = new THREE.Mesh(merge(list), this.materials.get(key));
      mesh.castShadow = castShadow; mesh.receiveShadow = receiveShadow;
      group.add(mesh);
    }
    return group;
  }
  // Single merged geometry (ignores materials) e.g. for collision or instancing.
  geometry() { return merge([...this.parts.values()].flat()); }
}

// Validation used by asset QA: finite positions, valid indices, degenerate triangle ratio.
export function validateGeometry(geo) {
  const issues = [];
  const pos = geo.attributes.position;
  if (!pos || pos.count === 0) return { ok: false, issues: ['no positions'], triangles: 0 };
  for (let i = 0; i < pos.array.length; i++) if (!Number.isFinite(pos.array[i])) { issues.push('non-finite position'); break; }
  const nor = geo.attributes.normal;
  if (nor) for (let i = 0; i < nor.array.length; i++) if (!Number.isFinite(nor.array[i])) { issues.push('non-finite normal'); break; }
  const index = geo.index ? geo.index.array : null;
  const triCount = index ? index.length / 3 : pos.count / 3;
  let degenerate = 0;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let t = 0; t < triCount; t++) {
    const i0 = index ? index[t * 3] : t * 3, i1 = index ? index[t * 3 + 1] : t * 3 + 1, i2 = index ? index[t * 3 + 2] : t * 3 + 2;
    if (i0 >= pos.count || i1 >= pos.count || i2 >= pos.count) { issues.push('index out of range'); break; }
    a.fromBufferAttribute(pos, i0); b.fromBufferAttribute(pos, i1); c.fromBufferAttribute(pos, i2);
    if (b.sub(a).cross(c.sub(a)).lengthSq() < 1e-14) degenerate++;
  }
  geo.computeBoundingBox();
  const size = new THREE.Vector3(); geo.boundingBox.getSize(size);
  const degenerateRatio = degenerate / Math.max(1, triCount);
  if (degenerateRatio > 0.3) issues.push(`high degenerate ratio ${degenerateRatio.toFixed(2)}`);
  return { ok: issues.length === 0, issues, triangles: triCount, degenerateRatio, size: size.toArray() };
}

export function validateObject(obj) {
  let triangles = 0, meshes = 0; const issues = [];
  obj.traverse((o) => {
    if (o.isMesh) { meshes++; const r = validateGeometry(o.geometry); triangles += r.triangles * (o.isInstancedMesh ? o.count : 1); if (!r.ok) issues.push(`${o.name || o.type}: ${r.issues.join(', ')}`); if (!o.material) issues.push('mesh without material'); }
  });
  const box = new THREE.Box3().setFromObject(obj), size = new THREE.Vector3(); box.getSize(size);
  return { ok: issues.length === 0 && meshes > 0, meshes, triangles, issues, size: size.toArray() };
}

// Flatten a static hierarchy into one mesh per material (huge draw-call savings for
// generated cities/villages). Skips skinned/instanced meshes, lights and sprites (kept as-is).
export function mergeByMaterial(root, { name = 'merged', castShadow = true, receiveShadow = true } = {}) {
  root.updateMatrixWorld(true);
  const mb = new MeshBuilder(), keep = [];
  root.traverse((o) => {
    if (o.isSkinnedMesh || o.isInstancedMesh || o.isLight || o.isPoints || o.isSprite) { if (o !== root) keep.push(o); return; }
    if (o.isMesh && !Array.isArray(o.material)) mb.add(o.geometry, o.material, o.matrixWorld);
  });
  const g = mb.build({ name, castShadow, receiveShadow });
  for (const k of keep) { const m = k.matrixWorld.clone(); k.parent?.remove(k); k.matrix.copy(m); k.matrix.decompose(k.position, k.quaternion, k.scale); g.add(k); }
  return g;
}
