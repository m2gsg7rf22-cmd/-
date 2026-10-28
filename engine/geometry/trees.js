// Procedural trees v2: recursive branching skeletons (curved, tapered tubes following
// da Vinci's area rule) with alpha-tested leaf/needle/frond cards whose textures are rasterised
// procedurally (no image files). Species: oak, birch, maple, pine, spruce, palm, dead, bush.
// Returns a Group { bark mesh, leaves mesh } (instancing-friendly: see world/vegetation.js).
// detail: 'high' (hero/near) | 'low' (forests). Units: metres, +Y up, base at the origin.
import * as THREE from '../vendor/three/three.module.js';
import { RNG } from '../core/rng.js';
import { pbr } from '../render/materials.js';

// species parameters
const SPECIES = {
  oak: { height: 9, trunkR: 0.32, trunkFrac: 0.38, levels: 3, children: [6, 5, 4], angle: [55, 48, 42], lenRatio: [0.62, 0.55, 0.5], curve: 0.25, gravity: 0.08, up: 0.1, leaf: 'broad', leafSize: 0.85, leafDensity: 9, bark: 0x4a3a2c, leafColor: [0x46702a, 0x557d2c, 0x3d6626] },
  maple: { height: 10, trunkR: 0.3, trunkFrac: 0.42, levels: 3, children: [5, 5, 4], angle: [42, 40, 38], lenRatio: [0.58, 0.55, 0.5], curve: 0.18, gravity: 0.02, up: 0.22, leaf: 'broad', leafSize: 0.95, leafDensity: 10, bark: 0x5a4a3c, leafColor: [0x5a8a2e, 0x6a8a2a, 0x4e7c2a] },
  birch: { height: 11, trunkR: 0.17, trunkFrac: 0.4, levels: 3, children: [9, 5, 4], angle: [35, 40, 40], lenRatio: [0.5, 0.55, 0.55], curve: 0.15, gravity: 0.18, up: 0.05, leaf: 'small', leafSize: 0.75, leafDensity: 12, bark: 0xd8d4c8, barkKind: 'birch', leafColor: [0x7a9a34, 0x88a83a, 0x6e9030] },
  pine: { height: 13, trunkR: 0.26, conifer: true, whorls: 14, perWhorl: 6, branchLen: 0.42, droop: 0.25, leaf: 'needles', leafSize: 0.9, bark: 0x4a3426, leafColor: [0x3e6434, 0x46703a, 0x375c30] },
  spruce: { height: 15, trunkR: 0.28, conifer: true, whorls: 20, perWhorl: 7, branchLen: 0.36, droop: 0.45, leaf: 'needles', leafSize: 0.75, bark: 0x3e2e24, leafColor: [0x2e5232, 0x355a38, 0x2a4c2e] },
  palm: { height: 9, trunkR: 0.2, palm: true, fronds: 14, leaf: 'frond', bark: 0x7a6650, leafColor: [0x4f8a34, 0x5a9438, 0x46802e] },
  dead: { height: 8, trunkR: 0.28, trunkFrac: 0.4, levels: 3, children: [5, 4, 3], angle: [50, 45, 40], lenRatio: [0.6, 0.55, 0.5], curve: 0.35, gravity: 0.05, up: 0.1, leaf: null, bark: 0x5a5048 },
  bush: { height: 1.6, trunkR: 0.05, trunkFrac: 0.05, levels: 2, children: [9, 4], angle: [60, 45], lenRatio: [0.9, 0.55], curve: 0.3, gravity: 0.05, up: 0.2, leaf: 'broad', leafSize: 0.55, leafDensity: 7, bark: 0x4a3a2c, leafColor: [0x46702a, 0x3d6626] },
};
export const TREE_SPECIES = Object.keys(SPECIES);

// ---------- leaf card textures (RGBA, rasterised in JS) ----------
const texCache = new Map();
function leafTexture(kind) {
  if (texCache.has(kind)) return texCache.get(kind);
  const S = 256, d = new Uint8Array(S * S * 4), rng = new RNG(kind.length * 977);
  const put = (x, y, r, g, b) => { if (x < 0 || y < 0 || x >= S || y >= S) return; const o = (y * S + x) * 4; d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = 255; };
  const leaf = (cx, cy, len, wid, ang, shade) => { // ellipse-ish leaf with a midrib
    const ca = Math.cos(ang), sa = Math.sin(ang), R = Math.ceil(len);
    for (let y = -R; y <= R; y++) for (let x = -R; x <= R; x++) {
      const u = (x * ca + y * sa) / len, v = (-x * sa + y * ca) / wid; // u along leaf 0..1
      if (u < 0 || u > 1) continue; const w = Math.sin(Math.PI * Math.pow(u, 0.8)); if (Math.abs(v) > w) continue;
      const rib = Math.abs(v) < 0.08 ? 0.82 : 1, vein = Math.abs(Math.sin((u * 7 + Math.abs(v) * 2) * Math.PI)) < 0.12 ? 0.92 : 1;
      const k = shade * rib * vein * (0.85 + 0.15 * (1 - Math.abs(v)));
      put(Math.round(cx + x), Math.round(cy + y), 255 * k, 255 * k, 255 * k);
    }
  };
  const twig = (x0, y0, x1, y1, w) => { const n = Math.hypot(x1 - x0, y1 - y0); for (let i = 0; i <= n; i++) { const t = i / n; for (let k = -w; k <= w; k++) put(Math.round(x0 + (x1 - x0) * t + k), Math.round(y0 + (y1 - y0) * t), 110, 90, 70); } };
  if (kind === 'broad' || kind === 'small') {
    const n = kind === 'small' ? 26 : 16, L = kind === 'small' ? 30 : 46;
    twig(S / 2, S - 4, S / 2, 40, 2);
    for (let i = 0; i < n; i++) { const t = rng.range(0.1, 0.95), y = S - 4 - t * (S - 50), side = i % 2 ? 1 : -1, ang = -Math.PI / 2 + side * rng.range(0.4, 1.1); leaf(S / 2, y, L * rng.range(0.75, 1.1), L * 0.42, ang, rng.range(0.7, 1)); }
    leaf(S / 2, 44, L, L * 0.42, -Math.PI / 2, 0.95);
  } else if (kind === 'needles') { // spray: twig along v with dense needles angled forward on both sides
    twig(S / 2, S - 2, S / 2, 4, 3);
    for (let y = S - 6; y > 6; y -= 2) for (const side of [-1, 1]) {
      const t = 1 - y / S, len = (60 + 50 * Math.sin(Math.PI * Math.min(1, t * 1.15))) * rng.range(0.8, 1.1), a = rng.range(0.55, 0.85), k = rng.range(0.55, 0.95);
      for (let st = 0; st < len; st++) { const x = S / 2 + side * Math.sin(a) * st, yy = y - Math.cos(a) * st; put(Math.round(x), Math.round(yy), 255 * k, 255 * k, 255 * k); put(Math.round(x), Math.round(yy) + 1, 230 * k, 230 * k, 230 * k); }
    }
  } else if (kind === 'frond') {
    twig(4, S / 2, S - 4, S / 2, 2);
    for (let i = 0; i < 70; i++) { const t = i / 70, x = 8 + t * (S - 16), len = 100 * Math.sin(Math.PI * Math.min(1, t * 1.1 + 0.05)) + 10; for (const side of [-1, 1]) leaf(x, S / 2, len, 5, side * (Math.PI / 2 - 0.5), 0.8 + 0.2 * rng.range(0, 1)); }
  }
  const tex = new THREE.DataTexture(d, S, S, THREE.RGBAFormat); tex.colorSpace = THREE.SRGBColorSpace; tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter; tex.flipY = false; tex.needsUpdate = true;
  texCache.set(kind, tex); return tex;
}

// ---------- geometry accumulators ----------
class Acc { constructor() { this.p = []; this.n = []; this.uv = []; this.c = []; this.i = []; } get v() { return this.p.length / 3; } }

function addTube(acc, pts, radii, radial, vScale) {
  // pts: Vector3[], radii: number[]; parallel-transport frames
  const base = acc.v; let normal = new THREE.Vector3(), prevT = null; const T = new THREE.Vector3(), B = new THREE.Vector3();
  for (let k = 0; k < pts.length; k++) {
    T.copy(pts[Math.min(k + 1, pts.length - 1)]).sub(pts[Math.max(k - 1, 0)]).normalize();
    if (!prevT) { normal.set(1, 0, 0); if (Math.abs(T.x) > 0.9) normal.set(0, 0, 1); normal.sub(T.clone().multiplyScalar(normal.dot(T))).normalize(); }
    else { const q = new THREE.Quaternion().setFromUnitVectors(prevT, T); normal.applyQuaternion(q); }
    prevT = T.clone(); B.crossVectors(T, normal);
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2, nx = Math.cos(a) * normal.x + Math.sin(a) * B.x, ny = Math.cos(a) * normal.y + Math.sin(a) * B.y, nz = Math.cos(a) * normal.z + Math.sin(a) * B.z;
      acc.p.push(pts[k].x + nx * radii[k], pts[k].y + ny * radii[k], pts[k].z + nz * radii[k]); acc.n.push(nx, ny, nz); acc.uv.push(j / radial, k * vScale); acc.c.push(1, 1, 1);
    }
  }
  const W = radial + 1;
  for (let k = 0; k < pts.length - 1; k++) for (let j = 0; j < radial; j++) { const a = base + k * W + j; acc.i.push(a, a + W, a + 1, a + 1, a + W, a + W + 1); }
}

function addCard(acc, pos, dir, side, w, h, tint, centre, normalBlend = 0.65) {
  // card from pos along dir (length h) with width w across `side`; normals bent away from the crown centre
  const base = acc.v, half = side.clone().multiplyScalar(w / 2), tip = pos.clone().addScaledVector(dir, h);
  const corners = [pos.clone().sub(half), pos.clone().add(half), tip.clone().add(half), tip.clone().sub(half)], uvs = [[0, 1], [1, 1], [1, 0], [0, 0]];
  const flat = new THREE.Vector3().crossVectors(side, dir).normalize();
  for (let k = 0; k < 4; k++) {
    const c = corners[k], out = c.clone().sub(centre).normalize(), nrm = flat.clone().multiplyScalar(Math.sign(flat.dot(out)) || 1).lerp(out, normalBlend).normalize();
    acc.p.push(c.x, c.y, c.z); acc.n.push(nrm.x, nrm.y, nrm.z); acc.uv.push(uvs[k][0], uvs[k][1]); acc.c.push(tint.r, tint.g, tint.b);
  }
  acc.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

function toGeometry(acc) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(acc.p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(acc.n, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(acc.uv, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(acc.c, 3)); g.setIndex(acc.i);
  g.computeBoundingSphere(); return g;
}

/**
 * generateTree({ species, seed, height, detail, leafColor, barkColor, season })
 * season: 'summer' | 'autumn' | 'winter' (winter drops broadleaf leaves).
 */
export function generateTree({ species = 'oak', seed = 1, height, detail = 'high', leafColor, barkColor, season = 'summer' } = {}) {
  const sp = SPECIES[species] || SPECIES.oak, rng = new RNG(seed * 131 + species.length);
  const H = (height ?? sp.height) * rng.range(0.85, 1.15), hi = detail !== 'low';
  const bark = new Acc(), leaves = new Acc();
  const radialFor = (r) => (hi ? (r > 0.12 ? 9 : r > 0.04 ? 6 : 4) : (r > 0.1 ? 6 : 3));
  const palette = (leafColor !== undefined ? [leafColor] : season === 'autumn' ? [0xb8642a, 0xd08a30, 0x9a3a1e, 0xc8a038] : sp.leafColor || [0x46702a]).map((c) => new THREE.Color(c));
  const tint = () => palette[rng.int(0, palette.length - 1)].clone().multiplyScalar(rng.range(0.82, 1.12));
  const leafKind = season === 'winter' && sp.leaf && sp.leaf !== 'needles' ? null : sp.leaf;
  const crown = new THREE.Vector3(0, H * 0.68, 0);
  const cards = []; // deferred leaf cards {pos, dir}

  const branchPath = (start, dir, len, segs, curve, gravity, up) => {
    const pts = [start.clone()], d = dir.clone(); let p = start.clone();
    for (let s = 1; s <= segs; s++) {
      d.x += rng.range(-curve, curve) / segs * 2; d.z += rng.range(-curve, curve) / segs * 2; d.y += (up - gravity) / segs * 2; d.normalize();
      p = p.clone().addScaledVector(d, len / segs); pts.push(p);
    }
    return pts;
  };
  const randomPerp = (d) => { const a = new THREE.Vector3(rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1)).cross(d); return a.lengthSq() < 1e-4 ? new THREE.Vector3(1, 0, 0) : a.normalize(); };

  if (sp.conifer) {
    // straight tapering trunk + whorls of drooping branches, needle cards along each branch
    const trunkPts = [], trunkR = [], segs = hi ? 14 : 7;
    for (let s = 0; s <= segs; s++) { const t = s / segs; trunkPts.push(new THREE.Vector3(rng.range(-0.03, 0.03) * t, t * H, rng.range(-0.03, 0.03) * t)); trunkR.push(sp.trunkR * Math.pow(1 - t, 0.9) + 0.01 + (s === 0 ? sp.trunkR * 0.35 : 0)); }
    addTube(bark, trunkPts, trunkR, radialFor(sp.trunkR), 0.6);
    const whorls = hi ? sp.whorls : Math.ceil(sp.whorls * 0.6);
    for (let w = 0; w < whorls; w++) {
      const t = 0.26 + 0.72 * (w / whorls), y = t * H, crownR = Math.min(y * 0.9, H * sp.branchLen * Math.pow(1 - t, 0.85) + 0.25); // keep the lowest whorl off the ground
      const n = sp.perWhorl - (hi ? 0 : 2), off = rng.range(0, Math.PI * 2);
      for (let b = 0; b < n; b++) {
        const a = off + (b / n) * Math.PI * 2 + rng.range(-0.2, 0.2), dir = new THREE.Vector3(Math.cos(a), -sp.droop * rng.range(0.6, 1.2) + 0.15, Math.sin(a)).normalize();
        const pts = branchPath(new THREE.Vector3(0, y, 0), dir, crownR, hi ? 4 : 2, 0.1, sp.droop * 0.4, 0.05);
        const r0 = Math.max(0.012, sp.trunkR * 0.28 * (1 - t) + 0.015); addTube(bark, pts, pts.map((_, k) => r0 * (1 - k / pts.length * 0.8)), hi ? 4 : 3, 1);
        if (leafKind) { // one spray card along the whole branch (horizontal) + a tilted crossed card
          const p = pts[0].clone().addScaledVector(dir, 0.15), q = pts[pts.length - 1], bd = q.clone().sub(p).normalize(), L = q.distanceTo(p) * 1.12;
          const flatSide = new THREE.Vector3().crossVectors(bd, new THREE.Vector3(0, 1, 0)).normalize(), tilted = flatSide.clone().applyAxisAngle(bd, rng.range(0.9, 1.3));
          const w = Math.min(1.8, L * 0.7 + 0.3) * sp.leafSize;
          cards.push({ pos: p, dir: bd, side: flatSide, w, h: L }); if (hi) cards.push({ pos: p, dir: bd, side: tilted, w: w * 0.8, h: L });
        }
      }
    }
    if (leafKind) cards.push({ pos: new THREE.Vector3(0, H * 0.94, 0), dir: new THREE.Vector3(0, 1, 0), side: new THREE.Vector3(1, 0, 0), w: 0.7, h: H * 0.1 }, { pos: new THREE.Vector3(0, H * 0.94, 0), dir: new THREE.Vector3(0, 1, 0), side: new THREE.Vector3(0, 0, 1), w: 0.7, h: H * 0.1 });
    crown.set(0, H * 0.5, 0);
  } else if (sp.palm) {
    const segs = hi ? 18 : 9, lean = new THREE.Vector3(rng.range(-1, 1), 0, rng.range(-1, 1)).normalize().multiplyScalar(rng.range(0.6, 1.4));
    const pts = [], rr = [];
    for (let s = 0; s <= segs; s++) { const t = s / segs; pts.push(new THREE.Vector3(lean.x * t * t, t * H, lean.z * t * t)); rr.push(sp.trunkR * (1.25 - 0.4 * t) * (1 + (s % 2 ? 0.06 : 0))); }
    addTube(bark, pts, rr, radialFor(sp.trunkR), 1.5);
    const top = pts[pts.length - 1];
    const n = hi ? sp.fronds : 9;
    for (let f = 0; f < n; f++) {
      const a = (f / n) * Math.PI * 2 + rng.range(-0.15, 0.15), out = new THREE.Vector3(Math.cos(a), 0, Math.sin(a)), L = rng.range(2.6, 3.4), segF = hi ? 6 : 3;
      let p = top.clone(); const elev = rng.range(0.25, 0.75);
      for (let s = 0; s < segF; s++) {
        const t0 = s / segF, t1 = (s + 1) / segF, f0 = out.clone().multiplyScalar(Math.cos(elev - t0 * 1.6)).setY(Math.sin(elev - t0 * 1.6)), f1 = out.clone().multiplyScalar(Math.cos(elev - t1 * 1.6)).setY(Math.sin(elev - t1 * 1.6));
        const q = p.clone().addScaledVector(f0.normalize(), L / segF); void f1;
        if (leafKind) cards.push({ pos: p.clone(), dir: q.clone().sub(p).normalize(), side: new THREE.Vector3(-out.z, 0, out.x), w: 1.1 * Math.sin(Math.PI * (t0 + 0.08)) + 0.25, h: L / segF * 1.02, frond: [t0, t1] });
        p = q;
      }
    }
    crown.copy(top);
  } else {
    // broadleaf: recursive branching
    const trunkH = H * sp.trunkFrac;
    const grow = (start, dir, len, r0, level) => {
      const segs = hi ? Math.max(3, 8 - level * 2) : Math.max(2, 4 - level);
      const pts = branchPath(start, dir, len, segs, sp.curve * (level + 1) * 0.5, sp.gravity * level, sp.up);
      const rEnd = level === 0 ? r0 * 0.55 : r0 * 0.25;
      const radii = pts.map((_, k) => THREE.MathUtils.lerp(r0, rEnd, k / (pts.length - 1)) + (level === 0 && k === 0 ? r0 * 0.4 : 0));
      addTube(bark, pts, radii, radialFor(r0), level === 0 ? 0.6 : 1);
      const nChild = level < sp.levels ? Math.round((sp.children[level] ?? 3) * (hi ? 1 : 0.6)) : 0;
      for (let c = 0; c < nChild; c++) {
        const t = level === 0 ? THREE.MathUtils.lerp(sp.trunkFrac * 0.7, 0.98, c / Math.max(1, nChild - 1)) / (level === 0 ? 1 : 1) : rng.range(0.25, 0.95);
        const tt = level === 0 ? THREE.MathUtils.clamp((t * H - 0) / len, 0.35, 1) : t;
        const idx = Math.min(pts.length - 2, Math.floor(tt * (pts.length - 1))), at = pts[idx].clone().lerp(pts[idx + 1], tt * (pts.length - 1) - idx);
        const pd = pts[idx + 1].clone().sub(pts[idx]).normalize();
        const ang = THREE.MathUtils.degToRad(sp.angle[level] * rng.range(0.8, 1.2)), rot = (c * 2.39996) + rng.range(-0.3, 0.3); // golden-angle phyllotaxis
        const perp = randomPerp(pd).applyAxisAngle(pd, rot);
        const cd = pd.clone().applyAxisAngle(perp, ang).normalize();
        const childR = Math.max(0.008, THREE.MathUtils.lerp(r0, rEnd, tt) * 0.62);
        grow(at, cd, len * sp.lenRatio[level] * rng.range(0.8, 1.15) * (level === 0 ? (1.15 - tt * 0.5) : 1), childR, level + 1);
      }
      if (leafKind && level >= sp.levels - 1) {
        const n = Math.round(sp.leafDensity * (hi ? 1 : 0.55) * (level === sp.levels ? 1 : 0.5));
        for (let k = 0; k < n; k++) {
          const t = rng.range(0.3, 1), idx = Math.min(pts.length - 2, Math.floor(t * (pts.length - 1))), at = pts[idx].clone().lerp(pts[idx + 1], 0.5);
          const pd = pts[idx + 1].clone().sub(pts[idx]).normalize(), out = randomPerp(pd), d = pd.clone().lerp(out, 0.7).add(new THREE.Vector3(0, 0.25, 0)).normalize();
          cards.push({ pos: at, dir: d, side: new THREE.Vector3().crossVectors(d, randomPerp(d)).normalize(), w: sp.leafSize * rng.range(0.8, 1.2), h: sp.leafSize * rng.range(0.9, 1.3) });
        }
      }
    };
    grow(new THREE.Vector3(0, 0, 0), new THREE.Vector3(rng.range(-0.05, 0.05), 1, rng.range(-0.05, 0.05)).normalize(), species === 'bush' ? H * 0.2 : trunkH + H * 0.2, sp.trunkR, 0);
    crown.set(0, species === 'bush' ? H * 0.5 : H * 0.7, 0);
  }

  for (const c of cards) addCard(leaves, c.pos, c.dir, c.side, c.w, c.h, tint(), crown, sp.conifer ? 0.5 : 0.7);
  if (sp.palm) { // frond UVs: map each card to its slice of the frond texture (texture runs along u)
    const uv = leaves.uv; let ci = 0; for (const c of cards) { const [t0, t1] = c.frond; const o = ci * 8; uv[o] = t0; uv[o + 1] = 0; uv[o + 2] = t0; uv[o + 3] = 1; uv[o + 4] = t1; uv[o + 5] = 1; uv[o + 6] = t1; uv[o + 7] = 0; ci++; }
  }

  const barkMat = pbr('bark', { repeat: [2, 1], color: barkColor ?? sp.bark });
  if (sp.barkKind === 'birch') barkMat.color = new THREE.Color(barkColor ?? 0xdcd8cc);
  const group = new THREE.Group(); group.name = 'tree';
  const barkMesh = new THREE.Mesh(toGeometry(bark), barkMat); barkMesh.name = 'bark'; barkMesh.castShadow = true; barkMesh.receiveShadow = true;
  group.add(barkMesh);
  if (cards.length) {
    const leafMat = new THREE.MeshStandardMaterial({ map: leafTexture(leafKind), vertexColors: true, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.75, metalness: 0 });
    leafMat.name = 'gf:leaves'; leafMat.userData.wind = true;
    const lm = new THREE.Mesh(toGeometry(leaves), leafMat); lm.name = 'leaves'; lm.castShadow = true; lm.receiveShadow = true; group.add(lm);
  }
  group.userData.kind = 'tree'; group.userData.species = species;
  group.userData.collider = { type: 'cylinder', radius: Math.max(0.15, sp.trunkR * 1.3), height: H };
  group.userData.height = H;
  return group;
}
