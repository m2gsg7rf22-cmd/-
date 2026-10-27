// Procedural hair for parametric humans — "envelope" technique:
//  * a lat-long shell fitted to the measured skull (scalp helper bounds + face landmarks),
//    clipped by an anatomical hairline (forehead, temples, above the ears, nape),
//  * a gravity curtain continuing below the hairline for medium/long styles, flared over the
//    shoulders and kept outside the head/neck/shoulder collision volume,
//  * clump displacement for a strand-group silhouette, ragged alpha-tested ends,
//  * flow-aligned strand texture + anisotropic specular (MeshPhysicalMaterial.anisotropy),
//  * dedicated geometry for ponytail, bun, braid, mohawk, afro; fringe options;
//  * facial hair (stubble handled in skin; moustache/goatee/beard/full as shells).
// Skinned to head (cap) blending to neck/spine (curtain) so long hair follows the body.
import * as THREE from '../vendor/three/three.module.js';
import { Noise, RNG } from '../core/rng.js';

export const HAIR_STYLES = ['bald', 'buzz', 'crop', 'short', 'slick', 'bob', 'medium', 'long', 'ponytail', 'bun', 'braid', 'curly', 'afro', 'mohawk'];

const STYLE = {
  buzz: { vol: 0.003, len: 0, flow: 0, ends: 0, fringe: 0, rough: 0.7 },
  crop: { vol: 0.012, len: 0, flow: 0.2, ends: 0.3, fringe: 0.25, clump: 0.6 },
  short: { vol: 0.018, len: 0.03, flow: 0.4, ends: 0.5, fringe: 0.45, clump: 0.8 },
  slick: { vol: 0.012, len: 0.02, flow: 1, ends: 0.2, fringe: 0, gloss: 1, clump: 0.3, back: 1 },
  bob: { vol: 0.022, len: 0.16, flow: 0.6, ends: 0.6, fringe: 0.7, clump: 0.7, flare: 0.25 },
  medium: { vol: 0.024, len: 0.24, flow: 0.6, ends: 0.8, fringe: 0.4, clump: 0.9, flare: 0.3 },
  long: { vol: 0.024, len: 0.46, flow: 0.7, ends: 1, fringe: 0.25, clump: 1, flare: 0.35 },
  ponytail: { vol: 0.01, len: 0, flow: 1, ends: 0.2, fringe: 0, gloss: 0.6, back: 0.8, tail: 0.38 },
  bun: { vol: 0.01, len: 0, flow: 1, ends: 0.2, fringe: 0, gloss: 0.5, back: 0.8, bun: 1 },
  braid: { vol: 0.01, len: 0, flow: 1, ends: 0.2, fringe: 0.1, back: 0.8, braid: 0.42 },
  curly: { vol: 0.045, len: 0.12, flow: 0.2, ends: 0.7, fringe: 0.5, clump: 1.6, curl: 1, flare: 0.4 },
  afro: { vol: 0.08, len: 0.02, flow: 0, ends: 0.3, fringe: 0, clump: 1.2, curl: 1.5 },
  mohawk: { vol: 0.004, len: 0, flow: 0, ends: 0, fringe: 0, mohawk: 0.12 },
};

let flowTex = null;
function strandTexture() {
  if (flowTex) return flowTex;
  const W = 512, H = 512, d = new Uint8Array(W * H * 4), n = new Noise(11), rng = new RNG(4);
  const ends = Array.from({ length: W }, (_, x) => 0.86 + 0.14 * (0.5 + 0.5 * n.noise2(x * 0.09, 0.5)) * (rng.next() * 0.5 + 0.5));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const v = y / H, i = (y * W + x) * 4;
    // strands run along v (texture y); brightness varies per strand column with slight waviness
    const col = x + Math.sin(v * 18 + x * 0.05) * 1.2;
    const s = 0.5 + 0.5 * n.noise2(col * 0.35, v * 2.2) * 0.8 + 0.15 * Math.sin(col * 2.1);
    const fine = 0.85 + 0.15 * n.noise2(col * 1.3, v * 40);
    const lum = Math.max(0, Math.min(1, s * fine));
    d[i] = d[i + 1] = d[i + 2] = Math.round(70 + 185 * lum);
    // alpha: opaque, except ragged ends at the bottom of the texture (v -> 1)
    const a = v < ends[x] ? 1 : Math.max(0, 1 - (v - ends[x]) * 30);
    d[i + 3] = Math.round(a * 255);
  }
  flowTex = new THREE.DataTexture(d, W, H, THREE.RGBAFormat); flowTex.wrapS = THREE.RepeatWrapping; flowTex.wrapT = THREE.ClampToEdgeWrapping;
  flowTex.generateMipmaps = true; flowTex.minFilter = THREE.LinearMipmapLinearFilter; flowTex.magFilter = THREE.LinearFilter; flowTex.anisotropy = 4; flowTex.needsUpdate = true;
  return flowTex;
}
function hairMaterial(color, st, repeatU = 6) {
  const map = strandTexture().clone(); map.repeat.set(repeatU, 1); map.needsUpdate = true;
  const c = new THREE.Color(color);
  const m = new THREE.MeshPhysicalMaterial({ color: c, map, alphaTest: 0.5, side: THREE.DoubleSide, roughness: st.gloss ? 0.32 : st.rough ?? 0.48, metalness: 0,
    sheen: 0.5, sheenRoughness: 0.4, sheenColor: c.clone().offsetHSL(0, -0.05, 0.18), anisotropy: 0.7, anisotropyRotation: Math.PI / 2, specularIntensity: 0.7 });
  m.name = 'gf:hair';
  return m;
}

// Measure the skull and hairline from the rig + scalp helper.
function headFrame(api) {
  const g = api.mesh.geometry, P = g.attributes.position, tris = api.data.groups['helper-hair'];
  const box = new THREE.Box3(); for (let i = 0; i < tris.length; i++) box.expandByPoint(new THREE.Vector3().fromBufferAttribute(P, tris[i]));
  const eyeL = api.bones['eye.L'].userData.head, eyeR = api.bones['eye.R'].userData.head;
  const eyeMid = eyeL.clone().add(eyeR).multiplyScalar(0.5), ipd = eyeL.distanceTo(eyeR);
  // skull ellipsoid: horizontal radii from the scalp box, centre at mid-head height
  const c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
  const r = new THREE.Vector3(size.x / 2, (box.max.y - eyeMid.y) * 0.95, size.z / 2);
  c.y = box.max.y - r.y;
  // project actual head surface: max radius along a direction, from the body mesh near the head
  const headVerts = [];
  const body = g.index.array.subarray(g.groups[0].start, g.groups[0].start + g.groups[0].count);
  const seen = new Set(); for (let i = 0; i < body.length; i++) { const v = body[i]; if (seen.has(v)) continue; seen.add(v); const y = P.getY(v); if (y > eyeMid.y - ipd * 1.6) headVerts.push(new THREE.Vector3().fromBufferAttribute(P, v)); }
  return { c, r, eyeMid, ipd, headVerts, neck: api.bones.neck01.userData.head.clone(), shoulderY: api.bones['clavicle.L'].userData.head.y, shoulderX: Math.abs(api.bones['upperarm01.L'].userData.head.x), chestZ: api.bones.spine02.userData.head.z };
}

// Surface radius of the head along direction d (from centre): max projection of head verts in a cone.
function surfaceRadius(F, dir) {
  let best = 0;
  for (const v of F.headVerts) { const o = v.clone().sub(F.c); const l = o.length(); if (l < 1e-6) continue; const cos = o.dot(dir) / l; if (cos > 0.985) best = Math.max(best, l * cos); }
  return best || F.r.x;
}

/**
 * addHair(human, { style, color, length, volume, fringe, part, seed })
 */
export function addHair(human, opts = {}) {
  const api = human.userData; const style = opts.style ?? 'short'; if (style === 'bald' || !STYLE[style]) return null;
  const st = { ...STYLE[style] }; if (opts.length !== undefined) st.len = opts.length; if (opts.volume !== undefined) st.vol *= opts.volume; if (opts.fringe !== undefined) st.fringe = opts.fringe;
  const color = new THREE.Color(opts.color ?? 0x2a1a10), noise = new Noise(opts.seed ?? 3), part = opts.part ?? 0.35;
  const F = headFrame(api);
  const HEAD = api.data.boneIndex.head, NECK = api.data.boneIndex.neck01, SPINE = api.data.boneIndex.spine02;
  const meshes = [];
  // ---- cap + curtain grid
  const NU = 72, NV = 34;
  const pos = [], uv = [], si = [], sw = [], idx = [];
  const tmp = new THREE.Vector3();
  // hairline polar limit (radians from +Y) by azimuth (0 = front/+Z)
  const fh = F.eyeMid.y + F.ipd * 0.62; // forehead hairline height
  const hairlinePolar = (az) => {
    const front = Math.cos(az) > 0 ? Math.pow(Math.cos(az), 2) : 0; // 1 at front
    const side = Math.abs(Math.sin(az));
    const back = Math.cos(az) < 0 ? Math.pow(Math.cos(az), 2) : 0;
    const frontPolar = Math.acos(THREE.MathUtils.clamp((fh - F.c.y) / F.r.y, -1, 1)) * (1 + st.fringe * 0.35);
    return frontPolar * front + 1.75 * side * (1 - back) * (1 - front) + 2.05 * back;
  };
  const cols = [];
  for (let iu = 0; iu <= NU; iu++) {
    const az = (iu / NU) * Math.PI * 2 - Math.PI; // -pi..pi, 0 = front
    const limit = Math.min(hairlinePolar(az) + (style === 'mohawk' ? 0 : 0.05), Math.PI * 0.72);
    const col = [];
    const clumpPhase = noise.noise2(az * 3, 1.7);
    for (let iv = 0; iv <= NV; iv++) {
      const t = iv / NV; let p; let below = 0;
      const capRows = 0.62; // fraction of rows on the skull
      if (t <= capRows || st.len <= 0.001) {
        const polar = (t / (st.len > 0.001 ? capRows : 1)) * limit;
        const dir = new THREE.Vector3(Math.sin(polar) * Math.sin(az), Math.cos(polar), Math.sin(polar) * Math.cos(az)).normalize();
        const rs = surfaceRadius(F, dir);
        const clump = (st.clump ?? 0.5) * 0.006 * (noise.noise2(az * 9 + (st.curl ? t * 20 : 0), t * 4) + 0.4 * clumpPhase);
        const partDip = Math.exp(-Math.pow((az - part * 0.6) * 6, 2)) * Math.max(0, 1 - polar * 2) * 0.006;
        const lift = st.vol * (0.6 + 0.4 * Math.sin(Math.min(polar, 1.5))) + clump - partDip + (st.curl ? Math.abs(noise.noise2(az * 14, t * 14)) * st.vol * 0.4 * st.curl : 0);
        p = F.c.clone().addScaledVector(dir, rs + lift);
      } else {
        // curtain: continue from the last cap point, falling under gravity, flaring outward, colliding
        const last = col.capEnd || (col.capEnd = col[col.length - 1]); const k = (t - capRows) / (1 - capRows);
        const frontness = Math.cos(az);
        const drop = st.len * (frontness > 0.55 ? Math.max(0, 1 - (frontness - 0.55) * 4) : 1);
        const out = new THREE.Vector3(Math.sin(az), 0, Math.cos(az));
        p = last.p0.clone().add(new THREE.Vector3(0, -drop * k, 0)).addScaledVector(out, (st.flare ?? 0.2) * drop * k * k * 0.5);
        // collision: neck cylinder above the shoulders; below them the hair falls down the back
        const radial = new THREE.Vector2(p.x - F.neck.x, p.z - F.neck.z);
        if (p.y > F.shoulderY && radial.length() < 0.085) { radial.setLength(0.085); p.x = F.neck.x + radial.x; p.z = F.neck.z + radial.y; }
        if (p.y <= F.shoulderY + 0.03 && Math.abs(p.x) < F.shoulderX + 0.06) { const backZ = F.chestZ - 0.13; const blend = THREE.MathUtils.clamp((F.shoulderY + 0.03 - p.y) / 0.06, 0, 1); p.z = Math.min(p.z, THREE.MathUtils.lerp(p.z, backZ, blend)); p.x *= 1 - 0.25 * blend; }
        const wave = (st.curl ? 0.012 : 0.004) * noise.noise2(az * 8, k * 6);
        p.addScaledVector(out, wave + (st.clump ?? 0.5) * 0.005 * noise.noise2(az * 11, 3.3));
        below = THREE.MathUtils.clamp((F.c.y - F.r.y * 0.4 - p.y) / 0.25, 0, 1);
      }
      col.push({ p, p0: p.clone() });
      pos.push(p.x, p.y, p.z); uv.push(iu / NU, t);
      si.push(HEAD, NECK, SPINE, 0); sw.push(1 - below, below * 0.55, below * 0.45, 0);
    }
    cols.push(col);
  }
  const W = NV + 1;
  for (let iu = 0; iu < NU; iu++) for (let iv = 0; iv < NV; iv++) { const a = iu * W + iv, b = a + W; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  // mohawk: keep only a central strip and raise it
  if (st.mohawk) {
    for (let iu = 0; iu <= NU; iu++) { const az = (iu / NU) * Math.PI * 2 - Math.PI; const strip = Math.abs(Math.sin(az)) < 0.16 || Math.abs(Math.abs(az) - Math.PI) < 0.16; for (let iv = 0; iv <= NV; iv++) { const k = (iu * W + iv) * 3; if (strip) { const dir = new THREE.Vector3(pos[k] - F.c.x, pos[k + 1] - F.c.y, pos[k + 2] - F.c.z).normalize(); const h = st.mohawk * Math.max(0, dir.y) * (0.8 + 0.4 * Math.abs(noise.noise2(iv * 0.9, 2))); pos[k] += dir.x * h; pos[k + 1] += dir.y * h; pos[k + 2] += dir.z * h; } } }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals(); g.computeTangents?.();
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4)); g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  const capMat = hairMaterial(color, st, style === 'buzz' ? 24 : 10);
  if (style === 'buzz') { capMat.alphaTest = 0; capMat.map.repeat.set(30, 4); capMat.color.multiplyScalar(0.9); }
  if (style === 'mohawk') { // shaved sides: only render the strip via alpha
    const strip = new Float32Array(pos.length / 3); for (let iu = 0; iu <= NU; iu++) { const az = (iu / NU) * Math.PI * 2 - Math.PI; const on = Math.abs(Math.sin(az)) < 0.16 || Math.abs(Math.abs(az) - Math.PI) < 0.16; for (let iv = 0; iv <= NV; iv++) strip[iu * W + iv] = on ? 1 : 0; }
    const keep = []; for (let t = 0; t < idx.length; t += 3) if (strip[idx[t]] && strip[idx[t + 1]] && strip[idx[t + 2]]) keep.push(idx[t], idx[t + 1], idx[t + 2]); g.setIndex(keep);
    meshes.push(skinned(g, capMat));
    return finish(addBuzz());
  }
  meshes.push(skinned(g, capMat));
  // ---- extras
  const back = F.c.clone().add(new THREE.Vector3(0, -F.r.y * 0.05, -F.r.z * 0.98));
  if (st.tail) meshes.push(tubeHair(back.clone().add(new THREE.Vector3(0, F.r.y * 0.3, -0.01)), [[0, 0, -0.04], [0, -0.06, -0.08], [0, -st.tail * 0.5, -0.07], [0, -st.tail, -0.03]], 0.028, 0.012, color, st, true));
  if (st.bun) meshes.push(bunHair(F.c.clone().add(new THREE.Vector3(0, F.r.y * 0.55, -F.r.z * 0.85)), F.r.x * 0.48, color, st));
  if (st.braid) { const start = back.clone().add(new THREE.Vector3(0, F.r.y * 0.1, -0.01)); meshes.push(braidHair(start, st.braid, color, st)); }
  return finish();

  function addBuzz() { const b = g.clone(); b.setIndex(idx); const m = hairMaterial(color, STYLE.buzz, 30); m.alphaTest = 0; const k = b.attributes.position; for (let i = 0; i < k.count; i++) { const v = new THREE.Vector3().fromBufferAttribute(k, i).sub(F.c); const l = v.length(); v.setLength(surfaceRadius(F, v.clone().normalize()) + 0.002); k.setXYZ(i, F.c.x + v.x, F.c.y + v.y, F.c.z + v.z); void l; } b.computeVertexNormals(); return skinned(b, m); }
  function skinned(geo, mat) { const m = new THREE.SkinnedMesh(geo, mat); m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; m.bind(api.skeleton, api.mesh.bindMatrix); return m; }
  function finish(extra) { if (extra) meshes.push(extra); const grp = new THREE.Group(); grp.name = 'hair'; for (const m of meshes) grp.add(m); human.add(grp); api.hair = grp; return grp; }
  function tubeHair(start, offsets, r0, r1, col, s, endsAlpha) {
    const pts = offsets.map((o) => start.clone().add(new THREE.Vector3(...o)));
    const curve = new THREE.CatmullRomCurve3(pts); const segs = 24, rad = 14;
    const geo = new THREE.TubeGeometry(curve, segs, 1, rad, false);
    const P2 = geo.attributes.position; const center = new THREE.Vector3(), v = new THREE.Vector3();
    for (let i = 0; i <= segs; i++) { const tt = i / segs; curve.getPointAt(tt, center); const rr = THREE.MathUtils.lerp(r0, r1, tt) * (1 + 0.25 * Math.sin(tt * Math.PI)); for (let j = 0; j <= rad; j++) { const k = i * (rad + 1) + j; v.fromBufferAttribute(P2, k).sub(center).setLength(rr * (1 + 0.12 * noise.noise2(j * 0.8, tt * 6))).add(center); P2.setXYZ(k, v.x, v.y, v.z); } }
    const uvA = geo.attributes.uv; for (let i = 0; i < uvA.count; i++) uvA.setXY(i, uvA.getX(i), endsAlpha ? uvA.getY(i) * 0 + uvA.getX(i) : uvA.getY(i));
    // tube uv.x runs along the length -> map to texture v (flow); uv.y around -> texture u
    for (let i = 0; i < uvA.count; i++) { const along = Math.floor(i / (rad + 1)) / segs; uvA.setXY(i, (i % (rad + 1)) / rad, along); }
    geo.computeVertexNormals(); weights(geo, start.y);
    return skinned(geo, hairMaterial(col, s, 4));
  }
  function bunHair(c, r, col, s) { const geo = new THREE.SphereGeometry(r, 24, 16); const P2 = geo.attributes.position; for (let i = 0; i < P2.count; i++) { const v = new THREE.Vector3().fromBufferAttribute(P2, i); const tw = Math.atan2(v.z, v.x) + v.y * 30; v.multiplyScalar(1 + 0.08 * Math.sin(tw * 3)); P2.setXYZ(i, v.x, v.y * 0.75, v.z); } geo.translate(c.x, c.y, c.z); geo.computeVertexNormals(); weights(geo, 99); const m = hairMaterial(col, s, 8); m.alphaTest = 0; return skinned(geo, m); }
  function braidHair(start, len, col, s) {
    const geo = new THREE.BufferGeometry(); const parts = []; const n = 12;
    for (let i = 0; i < n; i++) { const t = i / n; const e = new THREE.SphereGeometry(0.024 * (1 - t * 0.45), 12, 8); e.scale(1, 1.6, 0.85); e.rotateZ((i % 2 ? 1 : -1) * 0.5); e.translate(start.x + (i % 2 ? 0.006 : -0.006), start.y - t * len, start.z - 0.03 - Math.sin(t * Math.PI) * 0.03); parts.push(e.toNonIndexed()); }
    const merged = new THREE.BufferGeometry(); const arrs = { position: [], normal: [], uv: [] };
    for (const p of parts) for (const k of Object.keys(arrs)) arrs[k].push(...p.attributes[k].array);
    for (const k of Object.keys(arrs)) merged.setAttribute(k, new THREE.Float32BufferAttribute(arrs[k], k === 'uv' ? 2 : 3));
    weights(merged, start.y); void geo; const m = hairMaterial(col, s, 3); m.alphaTest = 0; return skinned(merged, m);
  }
  function weights(geo, refY) { const n = geo.attributes.position.count, sI = new Uint16Array(n * 4), sW = new Float32Array(n * 4); for (let i = 0; i < n; i++) { const y = geo.attributes.position.getY(i); const b = THREE.MathUtils.clamp((Math.min(refY, F.c.y) - y) / 0.25, 0, 1); sI[i * 4] = HEAD; sI[i * 4 + 1] = NECK; sI[i * 4 + 2] = SPINE; sW[i * 4] = 1 - b; sW[i * 4 + 1] = b * 0.55; sW[i * 4 + 2] = b * 0.45; } geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(sI, 4)); geo.setAttribute('skinWeight', new THREE.BufferAttribute(sW, 4)); }
}

/** Facial hair shells: 'moustache' | 'goatee' | 'beard' | 'full' ('stubble' is painted by the skin system). */
export function addBeard(human, { style = 'beard', color = 0x2a1a10, length = 0.012, seed = 5 } = {}) {
  const api = human.userData; if (!style || style === 'stubble' || style === 'none') return null;
  const masks = api.skinMasks; if (!masks) return null;
  const g = api.mesh.geometry, P = g.attributes.position, N = g.attributes.normal;
  const noise = new Noise(seed), mouth = masks.mouth, ipd = masks.ipd;
  const body = g.index.array.subarray(g.groups[0].start, g.groups[0].start + g.groups[0].count);
  const keep = (i) => { const st = masks.masks[i * 8 + 6]; if (st < 0.25) return false; const dx = (P.getX(i) - mouth.x) / ipd, dy = (P.getY(i) - mouth.y) / ipd; if (style === 'moustache') return dy > 0.08 && dy < 0.42 && Math.abs(dx) < 0.62; if (style === 'goatee') return Math.abs(dx) < 0.48 && (dy < -0.1 || (dy > 0.08 && dy < 0.4)); return masks.masks[i * 8] < 0.35; };
  const tris = []; for (let t = 0; t < body.length; t += 3) if (keep(body[t]) && keep(body[t + 1]) && keep(body[t + 2])) tris.push(body[t], body[t + 1], body[t + 2]);
  if (!tris.length) return null;
  const map = new Map(), pos = [], uv = [], si = [], sw = [], idx = [];
  const len = length * (style === 'full' ? 2.6 : 1);
  for (const i of tris) {
    if (!map.has(i)) {
      const v = new THREE.Vector3().fromBufferAttribute(P, i), n = new THREE.Vector3().fromBufferAttribute(N, i);
      const dyn = Math.max(0, (mouth.y - v.y) / ipd); // grows longer toward the chin
      const off = len * (0.4 + dyn) * (0.8 + 0.4 * noise.noise3(v.x * 120, v.y * 120, v.z * 120));
      v.addScaledVector(n, off).add(new THREE.Vector3(0, -off * 0.5 * dyn, 0));
      map.set(i, pos.length / 3); pos.push(v.x, v.y, v.z); uv.push(g.attributes.uv.getX(i) * 8, g.attributes.uv.getY(i) * 8);
      si.push(api.data.boneIndex.jaw, api.data.boneIndex.head, 0, 0); sw.push(0.65, 0.35, 0, 0);
    }
    idx.push(map.get(i));
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(idx); geo.computeVertexNormals();
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4)); geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  const mat = hairMaterial(new THREE.Color(color), { rough: 0.6 }, 1); mat.alphaTest = 0; mat.map.repeat.set(1, 1);
  const m = new THREE.SkinnedMesh(geo, mat); m.frustumCulled = false; m.castShadow = true; m.bind(api.skeleton, api.mesh.bindMatrix); m.name = 'beard';
  human.add(m); return m;
}
