// Alpha cards + procedural texture painting: foliage, needles, fronds, grass, hair clumps, feathers,
// fur, decals, chains, fences — anything too fine for real geometry. paint() rasterises shapes
// into an RGBA DataTexture in pure JS (no canvas, works in Node); cards() builds oriented quads
// with crown-bent normals so foliage shades like a volume, not like flat planes.
import * as THREE from '../vendor/three/three.module.js';
import { RNG } from '../core/rng.js';

/**
 * paint(size, draw, { srgb }) -> DataTexture. draw(p) receives a painter:
 *   p.fill(r,g,b,a) · p.px(x,y,r,g,b,a) · p.line(x0,y0,x1,y1,width,[r,g,b]) · p.ellipse(cx,cy,rx,ry,angle,[r,g,b])
 *   p.leaf(cx,cy,length,width,angle,shade) (pointed blade with midrib + veins) · p.rng · p.size
 * Coordinates are pixels, origin top-left. UV convention: u=0 left, v=0 = TOP row of the image.
 * cards() maps v=1 to the card base (`pos`) and v=0 to its tip, so paint stems at the bottom, tips at the top.
 * For hanging foliage (dir pointing down) the base is at the branch: that is still v=1 — no flip needed.
 * Textures default to ClampToEdge; for tiling along strips use cardMaterial(map, { repeat: true }).
 */
export function paint(size, draw, { srgb = true, seed = 1 } = {}) {
  const S = size, d = new Uint8Array(S * S * 4), rng = new RNG(seed);
  const px = (x, y, r, g, b, a = 255) => { x = Math.round(x); y = Math.round(y); if (x < 0 || y < 0 || x >= S || y >= S) return; const o = (y * S + x) * 4; d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = a; };
  const p = {
    size: S, rng, px,
    fill(r, g, b, a = 255) { for (let i = 0; i < S * S; i++) { d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b; d[i * 4 + 3] = a; } },
    line(x0, y0, x1, y1, w = 1, [r, g, b] = [255, 255, 255]) { const n = Math.max(1, Math.hypot(x1 - x0, y1 - y0)); for (let i = 0; i <= n; i++) { const t = i / n; for (let k = -w / 2; k <= w / 2; k += 0.5) for (let m = -w / 2; m <= w / 2; m += 0.5) px(x0 + (x1 - x0) * t + k, y0 + (y1 - y0) * t + m, r, g, b); } },
    ellipse(cx, cy, rx, ry, angle = 0, [r, g, b] = [255, 255, 255]) { const c = Math.cos(angle), s = Math.sin(angle), R = Math.ceil(Math.max(rx, ry)); for (let y = -R; y <= R; y++) for (let x = -R; x <= R; x++) { const u = (x * c + y * s) / rx, v = (-x * s + y * c) / ry; if (u * u + v * v <= 1) px(cx + x, cy + y, r, g, b); } },
    leaf(cx, cy, length, width, angle, shade = 1) {
      const c = Math.cos(angle), s = Math.sin(angle), R = Math.ceil(length);
      for (let y = -R; y <= R; y++) for (let x = -R; x <= R; x++) {
        const u = (x * c + y * s) / length, v = (-x * s + y * c) / (width / 2); if (u < 0 || u > 1) continue;
        const w = Math.sin(Math.PI * Math.pow(u, 0.8)); if (Math.abs(v) > w) continue;
        const k = shade * (Math.abs(v) < 0.08 ? 0.82 : 1) * (Math.abs(Math.sin((u * 7 + Math.abs(v) * 2) * Math.PI)) < 0.12 ? 0.92 : 1) * (0.85 + 0.15 * (1 - Math.abs(v)));
        px(cx + x, cy + y, 255 * k, 255 * k, 255 * k);
      }
    },
  };
  draw(p);
  const tex = new THREE.DataTexture(d, S, S, THREE.RGBAFormat); if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter; tex.flipY = false; tex.needsUpdate = true;
  return tex;
}

/** Ready-made card textures (examples of paint()): 'leafSpray' | 'smallLeaves' | 'needles' | 'frond' | 'grass'. */
export function cardTexture(kind = 'leafSpray', seed = 1) {
  return paint(256, (p) => {
    const S = p.size, r = p.rng, twig = (x0, y0, x1, y1, w) => p.line(x0, y0, x1, y1, w, [110, 90, 70]);
    if (kind === 'leafSpray' || kind === 'smallLeaves') {
      const n = kind === 'smallLeaves' ? 26 : 16, L = kind === 'smallLeaves' ? 30 : 46; twig(S / 2, S - 4, S / 2, 40, 3);
      for (let i = 0; i < n; i++) { const t = r.range(0.1, 0.95), y = S - 4 - t * (S - 50), side = i % 2 ? 1 : -1; p.leaf(S / 2, y, L * r.range(0.75, 1.1), L * 0.84, -Math.PI / 2 + side * r.range(0.4, 1.1), r.range(0.7, 1)); }
      p.leaf(S / 2, 44, L, L * 0.84, -Math.PI / 2, 0.95);
    } else if (kind === 'needles') {
      twig(S / 2, S - 2, S / 2, 4, 3);
      for (let y = S - 6; y > 6; y -= 2) for (const side of [-1, 1]) { const t = 1 - y / S, len = (60 + 50 * Math.sin(Math.PI * Math.min(1, t * 1.15))) * r.range(0.8, 1.1), a = r.range(0.55, 0.85), k = r.range(0.55, 0.95) * 255; p.line(S / 2, y, S / 2 + side * Math.sin(a) * len, y - Math.cos(a) * len, 1.5, [k, k, k]); }
    } else if (kind === 'frond') {
      twig(4, S / 2, S - 4, S / 2, 3);
      for (let i = 0; i < 70; i++) { const t = i / 70, x = 8 + t * (S - 16), len = 100 * Math.sin(Math.PI * Math.min(1, t * 1.1 + 0.05)) + 10; for (const side of [-1, 1]) p.leaf(x, S / 2, len, 10, side * (Math.PI / 2 - 0.5), 0.8 + 0.2 * r.next()); }
    } else if (kind === 'grass') {
      for (let i = 0; i < 60; i++) { const x = r.range(10, S - 10), h = r.range(S * 0.4, S * 0.98), bend = r.range(-30, 30), k = r.range(0.6, 1) * 255; for (let s = 0; s < h; s++) { const t = s / h, w = 3 * (1 - t) + 0.6; p.line(x + bend * t * t - w, S - s, x + bend * t * t + w, S - s, 1, [k, k, k]); } }
    }
  }, { seed });
}

/**
 * cards(list, { centre, normalBlend }) -> BufferGeometry with vertex colours.
 * list items: { pos: Vector3 (base of card), dir: Vector3 (base→tip), side: Vector3 (width axis),
 *               w, h, color: THREE.Color|hex, uv: [u0,v0,u1,v1] }
 * normalBlend 0 = flat card normals, 1 = fully spherical around `centre` (soft volumetric shading).
 */
export function cards(list, { centre = null, normalBlend = 0.65 } = {}) {
  const P = [], N = [], UV = [], C = [], I = [];
  for (const c of list) {
    const base = P.length / 3, half = c.side.clone().normalize().multiplyScalar(c.w / 2), tip = c.pos.clone().addScaledVector(c.dir.clone().normalize(), c.h);
    const q = [c.pos.clone().sub(half), c.pos.clone().add(half), tip.clone().add(half), tip.clone().sub(half)];
    const [u0, v0, u1, v1] = c.uv || [0, 0, 1, 1], uvs = [[u0, v1], [u1, v1], [u1, v0], [u0, v0]];
    const flat = new THREE.Vector3().crossVectors(c.side, c.dir).normalize(), col = new THREE.Color(c.color ?? 0xffffff);
    for (let k = 0; k < 4; k++) {
      let n = flat.clone();
      if (centre && normalBlend > 0) { const out = q[k].clone().sub(centre).normalize(); if (n.dot(out) < 0) n.negate(); n.lerp(out, normalBlend).normalize(); }
      P.push(q[k].x, q[k].y, q[k].z); N.push(n.x, n.y, n.z); UV.push(uvs[k][0], uvs[k][1]); C.push(col.r, col.g, col.b);
    }
    I.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3)); g.setIndex(I); g.computeBoundingSphere();
  return g;
}

/**
 * cardStrip(points, { width, tile, side, color, twist }) -> BufferGeometry: a continuous ribbon of
 * cards following a polyline (vines, willow strands, hair locks, kelp, banners, moss, tails).
 * v runs from 0 at points[0] and accumulates `distance / tile`, so set map.wrapT = RepeatWrapping
 * (cardMaterial(..., { repeat: true }) does it). `side` = fixed width axis or null (auto, faces up/out).
 */
export function cardStrip(points, { width = 0.3, tile = 1, side = null, color = 0xffffff, twist = 0, taper = [1, 1] } = {}) {
  const P = [], N = [], UV = [], C = [], I = [], col = new THREE.Color(color); let v = 0;
  for (let k = 0; k < points.length; k++) {
    const p = points[k], T = points[Math.min(k + 1, points.length - 1)].clone().sub(points[Math.max(k - 1, 0)]).normalize();
    let sd = side ? side.clone() : new THREE.Vector3().crossVectors(T, Math.abs(T.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)).normalize();
    if (twist) sd.applyAxisAngle(T, twist * (k / (points.length - 1)));
    const t = k / (points.length - 1), w = width * (taper[0] + (taper[1] - taper[0]) * t) / 2;
    if (k) v += p.distanceTo(points[k - 1]) / tile;
    const n = new THREE.Vector3().crossVectors(sd, T).normalize();
    for (const s of [-1, 1]) { const q = p.clone().addScaledVector(sd, s * w); P.push(q.x, q.y, q.z); N.push(n.x, n.y, n.z); UV.push(s < 0 ? 0 : 1, v); C.push(col.r, col.g, col.b); }
    if (k) { const a = (k - 1) * 2; I.push(a, a + 1, a + 3, a, a + 3, a + 2); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3)); g.setIndex(I); g.computeBoundingSphere(); g.userData.open = true;
  return g;
}

/** Double-sided alpha-tested material for cards (wind-ready: userData.wind = true). */
export function cardMaterial(map, { alphaTest = 0.45, roughness = 0.75, wind = true, color = 0xffffff, repeat = false } = {}) {
  if (repeat) { map.wrapS = map.wrapT = THREE.RepeatWrapping; map.needsUpdate = true; }
  const m = new THREE.MeshStandardMaterial({ map, color, vertexColors: true, alphaTest, side: THREE.DoubleSide, roughness, metalness: 0 });
  m.name = 'gf:cards'; m.userData.wind = wind; return m;
}
