// Body-conforming garment generation for parametric humans.
// Garments are cut from the (morphed) body surface by anatomical region rules derived from
// the rig (skin weights + joint positions), offset along welded normals, given hem
// thickness, textured with PBR fabric/leather/metal, and skinned with the body's weights —
// so any garment fits any body shape and deforms with every animation. Body triangles
// fully hidden under opaque garments are culled (no poke-through, fewer pixels).
import * as THREE from '../vendor/three/three.module.js';
import { pbr, solid } from '../render/materials.js';

// region from dominant bone name
function regionOf(name) {
  if (/^(finger|metacarpal|wrist)/.test(name)) return 'hand';
  if (/^(toe|foot)/.test(name)) return 'foot';
  if (/^lowerleg/.test(name)) return 'shin';
  if (/^upperleg/.test(name)) return 'thigh';
  if (/^(pelvis|root)/.test(name) || name === 'spine05') return 'hips';
  if (/^lowerarm/.test(name)) return 'forearm';
  if (/^(upperarm|shoulder01)/.test(name)) return 'upperarm';
  if (/^(spine0[1-4]|clavicle|breast)/.test(name)) return 'torso';
  if (/^neck/.test(name)) return 'neck';
  return 'head';
}

// Per-render-vertex anatomical coordinates used by garment rules.
export function bodyFrame(human) {
  const api = human.userData; if (api._frame) return api._frame;
  const g = api.mesh.geometry, P = g.attributes.position, si = g.attributes.skinIndex, sw = g.attributes.skinWeight, n = P.count;
  const names = api.data.meta.bones.map((b) => b.name);
  const J = (b, k = 'head') => api.bones[b].userData[k].clone();
  const jt = { shoulderL: J('upperarm01.L'), shoulderR: J('upperarm01.R'), elbowL: J('lowerarm01.L'), elbowR: J('lowerarm01.R'), wristL: J('wrist.L'), wristR: J('wrist.R'),
    hipL: J('upperleg01.L'), hipR: J('upperleg01.R'), kneeL: J('lowerleg01.L'), kneeR: J('lowerleg01.R'), ankleL: J('foot.L'), ankleR: J('foot.R'), neck: J('neck01'), head: J('head'), chest: J('spine03'), waist: J('spine04'), pelvis: J('spine05') };
  const region = new Array(n), armT = new Float32Array(n), legT = new Float32Array(n), side = new Int8Array(n);
  const v = new THREE.Vector3();
  const along = (p, a, b) => { const ab = b.clone().sub(a); return THREE.MathUtils.clamp(p.clone().sub(a).dot(ab) / ab.lengthSq(), -0.5, 1.5); };
  for (let i = 0; i < n; i++) {
    let best = 0, bi = 0; for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w > best) { best = w; bi = si.getComponent(i, k); } }
    region[i] = regionOf(names[bi]);
    v.fromBufferAttribute(P, i); const s = v.x >= 0 ? 'L' : 'R'; side[i] = v.x >= 0 ? 1 : -1;
    // arm parameter: 0 shoulder .. 0.5 elbow .. 1 wrist
    const sh = jt['shoulder' + s], el = jt['elbow' + s], wr = jt['wrist' + s];
    const t1 = along(v, sh, el), t2 = along(v, el, wr);
    armT[i] = t1 < 1 ? Math.max(0, t1) * 0.5 : 0.5 + Math.min(1.2, Math.max(0, t2)) * 0.5;
    const hp = jt['hip' + s], kn = jt['knee' + s], an = jt['ankle' + s];
    const u1 = along(v, hp, kn), u2 = along(v, kn, an);
    legT[i] = u1 < 1 ? Math.max(0, u1) * 0.5 : 0.5 + Math.min(1.2, Math.max(0, u2)) * 0.5;
  }
  api._frame = { region, armT, legT, side, jt, n };
  return api._frame;
}

// Garment presets. cover(i, f, v) decides whether a body vertex is covered.
export const GARMENTS = {
  tshirt: { offset: 0.006, sleeve: 0.28, hem: 'hips-high', layer: 2, material: 'cotton' },
  longsleeve: { offset: 0.006, sleeve: 0.97, hem: 'hips-high', layer: 2, material: 'cotton' },
  tanktop: { offset: 0.005, sleeve: 0, hem: 'hips-high', layer: 2, material: 'cotton' },
  shirt: { offset: 0.007, sleeve: 0.97, hem: 'hips', layer: 2, material: 'cotton', collar: true },
  hoodie: { offset: 0.012, sleeve: 0.99, hem: 'hips', layer: 3, material: 'fleece', collar: true },
  jacket: { offset: 0.016, sleeve: 0.98, hem: 'hips', layer: 4, material: 'leather', collar: true },
  coat: { offset: 0.018, sleeve: 0.98, hem: 'hips', layer: 4, material: 'wool', collar: true, skirt: 0.75 },
  vest: { offset: 0.011, sleeve: 0, hem: 'hips', layer: 3, material: 'wool' },
  pants: { offset: 0.007, leg: 0.97, layer: 2, material: 'cotton' },
  jeans: { offset: 0.007, leg: 0.97, layer: 2, material: 'denim' },
  shorts: { offset: 0.007, leg: 0.3, layer: 2, material: 'cotton' },
  skirt: { offset: 0.01, layer: 2, material: 'cotton', skirt: 0.45, waistOnly: true, leg: 0.02 },
  dress: { offset: 0.006, sleeve: 0.15, hem: 'hips', layer: 2, material: 'silk', skirt: 0.6 },
  robe: { offset: 0.012, sleeve: 0.9, hem: 'hips', layer: 3, material: 'wool', skirt: 1.0, collar: true },
  bodysuit: { offset: 0.004, sleeve: 1.02, leg: 1.02, hem: 'none', layer: 1, material: 'spandex', neck: true },
  underwear: { offset: 0.004, layer: 1, material: 'cotton', brief: true },
  boots: { offset: 0.01, foot: true, leg: [0.62, 1.2], layer: 3, material: 'leather', sole: 0.02 },
  shoes: { offset: 0.008, foot: true, leg: [0.93, 1.2], layer: 3, material: 'leather', sole: 0.015 },
  sneakers: { offset: 0.009, foot: true, leg: [0.92, 1.2], layer: 3, material: 'canvas', sole: 0.022 },
  gloves: { offset: 0.004, hand: true, sleeveFrom: 0.9, layer: 3, material: 'leather' },
  cuirass: { offset: 0.03, sleeve: 0, hem: 'waist', layer: 5, material: 'steel', armor: true },
  pauldrons: { offset: 0.035, shoulderPads: true, layer: 6, material: 'steel', armor: true },
  greaves: { offset: 0.02, leg: [0.55, 0.95], layer: 5, material: 'steel', armor: true },
  vambraces: { offset: 0.018, sleeveRange: [0.58, 0.95], layer: 5, material: 'steel', armor: true },
  helmet: { offset: 0.025, helmet: true, layer: 6, material: 'steel', armor: true },
  belt: { offset: 0.012, band: 'waist', layer: 5, material: 'leather' },
};

const MATERIALS = {
  cotton: (c) => pbr('fabric', { color: c, weave: 256, repeat: [14, 14], normalScale: 0.35 }),
  fleece: (c) => pbr('fabric', { color: c, weave: 128, repeat: [10, 10], normalScale: 0.5 }),
  denim: (c) => pbr('fabric', { color: c ?? 0x2e4a72, weave: 256, repeat: [16, 16], normalScale: 0.6 }),
  wool: (c) => pbr('fabric', { color: c, weave: 128, repeat: [10, 10], normalScale: 0.6 }),
  silk: (c) => { const m = pbr('fabric', { color: c, weave: 256, repeat: [18, 18], normalScale: 0.15 }).clone(); return m; },
  spandex: (c) => { const m = new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.38, sheen: 0.8, sheenRoughness: 0.3, sheenColor: new THREE.Color(c).offsetHSL(0, 0, 0.25), clearcoat: 0.15 }); return m; },
  leather: (c) => pbr('leather', { color: c ?? 0x3a2418, repeat: [5, 5] }),
  canvas: (c) => pbr('fabric', { color: c ?? 0xeeeeee, weave: 200, repeat: [14, 14], normalScale: 0.5 }),
  steel: (c) => { const m = pbr('metal', { color: c ?? 0xb8bcc2, roughness: 0.28, repeat: [3, 3] }).clone(); m.metalness = 1; return m; },
};

function covered(spec, f, i, hemY) {
  const r = f.region[i], at = f.armT[i], lt = f.legT[i];
  if (spec.helmet) return r === 'head' && f.headY !== undefined && f.pos[i * 3 + 1] > f.browY - 0.01 && !(f.pos[i * 3 + 2] > f.faceZ && f.pos[i * 3 + 1] < f.browY + 0.035);
  if (spec.hand) return r === 'hand' || ((r === 'forearm') && at > (spec.sleeveFrom ?? 0.9));
  if (spec.foot) return r === 'foot' || ((r === 'shin' || r === 'thigh') && lt >= spec.leg[0]);
  if (spec.shoulderPads) return (r === 'upperarm' && at < 0.22) || (r === 'torso' && Math.abs(f.pos[i * 3]) > f.shoulderX * 0.55 && f.pos[i * 3 + 1] > f.chestY);
  if (spec.band === 'waist') { const y = f.pos[i * 3 + 1]; return (r === 'hips' || r === 'torso') && y > f.waistBandY - 0.03 && y < f.waistBandY + 0.03; }
  if (spec.brief) return (r === 'hips' || (r === 'thigh' && lt < 0.08)) && f.pos[i * 3 + 1] < f.waistBandY + 0.02;
  if (spec.sleeveRange) return r === 'forearm' && at >= spec.sleeveRange[0] && at <= spec.sleeveRange[1];
  if (Array.isArray(spec.leg) && !spec.foot) return (r === 'shin' || r === 'thigh') && lt >= spec.leg[0] && lt <= spec.leg[1];
  let c = false;
  const y = f.pos[i * 3 + 1];
  if (spec.hem !== undefined || spec.sleeve !== undefined) {
    // torso garments: clean horizontal hem plane over torso/hips/thighs, sleeves by arm parameter
    const trunk = r === 'torso' || r === 'hips' || r === 'thigh' || r === 'neck';
    if (trunk && (spec.hem === 'none' ? r !== 'thigh' || lt < 0.02 : y > hemY)) c = true;
    if (r === 'neck' && !spec.neck) c = y < f.neckBaseY - Math.max(0, f.pos[i * 3 + 2] - f.jt.neck.z) * 0.6;
    if ((r === 'upperarm' || r === 'forearm') && at <= (spec.sleeve ?? 0)) c = true;
    if (r === 'upperarm' && (spec.sleeve ?? 0) > 0 && at < 0.12) c = true;
  }
  if (spec.leg !== undefined || spec.waistOnly) {
    if ((r === 'hips' || r === 'torso') && y < f.waistBandY) c = true;
    if ((r === 'thigh' || r === 'shin') && lt <= (spec.leg ?? 0.08)) c = true;
    if (spec.leg >= 1 && r === 'foot' && y > f.ankleY) c = true;
  }
  return c;
}

/**
 * dress(human, [{ type: 'jeans', color: 0x2e4a72 }, { type: 'jacket', color: 0x2a2a2a }, ...])
 * Adds garments as skinned meshes; returns the list. Body faces under opaque layers are culled.
 */
// Skirts/robes/coat tails from the MakeHuman skirt helper shell (waist -> knee tube), extended
// downward to the requested length and flared. Weighted by blending the nearest body skin weights.
function skirtMesh(api, f, spec) {
  const g = api.mesh.geometry, P = g.attributes.position, tris = api.data.groups['helper-skirt']; if (!tris) return null;
  const used = [...new Set(tris)], remap = new Map();
  let topY = -Infinity, botY = Infinity; for (const i of used) { const y = P.getY(i); topY = Math.max(topY, y); botY = Math.min(botY, y); }
  const knee = f.jt.kneeL.y, ankle = f.jt.ankleL.y;
  const targetBottom = spec.skirt <= 0.5 ? THREE.MathUtils.lerp(f.jt.pelvis.y - 0.1, knee, spec.skirt * 2) : THREE.MathUtils.lerp(knee, ankle + 0.06, (spec.skirt - 0.5) * 2);
  const topTarget = spec.skirtTop ?? f.waistBandY;
  const pos = [], uv = [], si = [], sw = [];
  // body vertex lookup for weights (nearest by bucketing)
  const body = g.index.array.subarray(g.groups[0].start, g.groups[0].start + g.groups[0].count);
  const cand = [...new Set(body)].filter((i) => { const y = P.getY(i); return y < topY + 0.1 && y > knee - 0.1; });
  const SI = g.attributes.skinIndex, SW = g.attributes.skinWeight;
  for (const i of used) {
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
    const t = (topY - y) / Math.max(1e-4, topY - botY); // 0 waist .. 1 helper bottom
    const ny = THREE.MathUtils.lerp(topTarget, targetBottom, t);
    const flare = 1 + t * t * (spec.flare ?? 0.35) + spec.offset * 2;
    const cx = 0, cz = f.jt.pelvis.z;
    const px = cx + (x - cx) * flare, pz = cz + (z - cz) * flare;
    remap.set(i, pos.length / 3); pos.push(px, ny, pz); uv.push(Math.atan2(x, z - cz) / Math.PI * 4, t * 6);
    // weights: hips at the top, blend to the leg on the same side further down
    const side = x >= 0 ? 'L' : 'R', bi = api.data.boneIndex;
    const legW = Math.min(0.7, t * 0.8);
    si.push(bi.root, bi['upperleg01.' + side], bi['upperleg02.' + side], bi.spine05); sw.push(1 - legW - 0.05, legW * 0.7, legW * 0.3, 0.05);
  }
  void cand; void SI; void SW;
  const idx = Array.from(tris, (i) => remap.get(i));
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(idx); geo.computeVertexNormals();
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4)); geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  const mat = (MATERIALS[spec.material] || MATERIALS.cotton)(spec.color ?? 0x556677); const m2 = mat.clone(); m2.side = THREE.DoubleSide;
  const mesh = new THREE.SkinnedMesh(geo, m2); mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false; mesh.bind(api.skeleton, api.mesh.bindMatrix);
  mesh.name = 'garment:skirt'; return mesh;
}

export function dress(human, items = []) {
  const api = human.userData, g = api.mesh.geometry, f = bodyFrame(human);
  const P = g.attributes.position, N = g.attributes.normal;
  f.pos = P.array;
  const jt = f.jt;
  f.waistBandY = jt.pelvis.y + 0.085; f.neckBaseY = jt.neck.y + 0.01; f.chestY = jt.chest.y; f.ankleY = jt.ankleL.y + 0.04;
  f.shoulderX = Math.abs(jt.shoulderL.x); f.browY = api.bones['eye.L'].userData.head.y + 0.03; f.headY = jt.head.y; f.faceZ = jt.head.z + 0.03;
  const hemYs = { 'hips-high': jt.pelvis.y + 0.05, hips: jt.pelvis.y + 0.005, waist: jt.waist.y - 0.02 };
  const bodyIdx = g.index.array.subarray(g.groups[0].start, g.groups[0].start + g.groups[0].count);
  const coveredByOpaque = new Uint8Array(P.count);
  const out = [];
  for (const it of items) {
    const spec = { ...GARMENTS[it.type], ...it }; if (!GARMENTS[it.type]) { console.warn('unknown garment', it.type); continue; }
    const hemY = hemYs[spec.hem] ?? jt.pelvis.y - 0.05;
    const cov = new Uint8Array(P.count); for (let i = 0; i < P.count; i++) cov[i] = covered(spec, f, i, hemY) ? 1 : 0;
    // triangles fully covered
    const tris = [];
    for (let t = 0; t < bodyIdx.length; t += 3) { const a = bodyIdx[t], b = bodyIdx[t + 1], c = bodyIdx[t + 2]; if (cov[a] && cov[b] && cov[c]) tris.push(a, b, c); }
    if (!tris.length) continue;
    const mesh = buildGarment(api, tris, spec, f);
    mesh.name = 'garment:' + it.type;
    human.add(mesh); out.push(mesh);
    if (spec.skirt) { const sk = skirtMesh(api, f, spec); if (sk) { human.add(sk); out.push(sk); } }
    if (spec.opaque !== false) {
      // erode the culling mask 2 rings away from the garment boundary (hems move when draped)
      let mask = new Uint8Array(P.count); for (let t = 0; t < tris.length; t++) mask[tris[t]] = 1;
      const posKey = (i) => `${Math.round(P.getX(i) * 2e4)},${Math.round(P.getY(i) * 2e4)},${Math.round(P.getZ(i) * 2e4)}`;
      for (let e = 0; e < 3; e++) {
        const bad = new Set();
        for (let t = 0; t < bodyIdx.length; t += 3) { const a = bodyIdx[t], b = bodyIdx[t + 1], c = bodyIdx[t + 2]; if (!(mask[a] && mask[b] && mask[c])) { for (const v of [a, b, c]) if (mask[v]) bad.add(posKey(v)); } }
        const next = mask.slice(); for (let i = 0; i < P.count; i++) if (mask[i] && bad.has(posKey(i))) next[i] = 0; mask = next;
      }
      for (let i = 0; i < P.count; i++) if (mask[i]) coveredByOpaque[i] = 1;
    }
  }
  // cull hidden body triangles (keep a 1-ring margin: only cull triangles whose verts are all covered)
  if (out.length) {
    const keep = [];
    for (let t = 0; t < bodyIdx.length; t += 3) { const a = bodyIdx[t], b = bodyIdx[t + 1], c = bodyIdx[t + 2]; if (!(coveredByOpaque[a] && coveredByOpaque[b] && coveredByOpaque[c])) keep.push(a, b, c); }
    const rest = g.index.array.subarray(g.groups[0].start + g.groups[0].count);
    const idx = new Uint32Array(keep.length + rest.length); idx.set(keep, 0); idx.set(rest, keep.length);
    const groups = g.groups.map((gr) => ({ ...gr })); const shift = g.groups[0].count - keep.length;
    g.setIndex(new THREE.BufferAttribute(idx, 1)); g.clearGroups(); g.addGroup(0, keep.length, 0);
    for (const gr of groups.slice(1)) g.addGroup(gr.start - shift, gr.count, gr.materialIndex);
  }
  api.garments = [...(api.garments || []), ...out];
  return out;
}

function buildGarment(api, tris, spec, f) {
  const g = api.mesh.geometry, P = g.attributes.position, N = g.attributes.normal, UV = g.attributes.uv, SI = g.attributes.skinIndex, SW = g.attributes.skinWeight;
  // welded vertex normals for offsetting (average normals of coincident positions -> no cracks at UV seams)
  const key = (i) => `${Math.round(P.getX(i) * 2e4)},${Math.round(P.getY(i) * 2e4)},${Math.round(P.getZ(i) * 2e4)}`;
  const acc = new Map();
  const used = [...new Set(tris)];
  for (const i of used) { const k = key(i); const a = acc.get(k) || [0, 0, 0]; a[0] += N.getX(i); a[1] += N.getY(i); a[2] += N.getZ(i); acc.set(k, a); }
  // --- drape: weld coincident vertices, Laplacian-smooth the cut surface so cloth bridges
  // concavities (navel, nipples, ribs), keep it outside the body, smooth the hem lines.
  const wid = new Map(), wpos = [], wnor = [], wBody = [];
  const welded = new Map();
  for (const i of used) {
    const k = key(i); let w = wid.get(k);
    if (w === undefined) { w = wpos.length; wid.set(k, w); const a = acc.get(k); const l = Math.hypot(...a) || 1; wnor.push(new THREE.Vector3(a[0] / l, a[1] / l, a[2] / l)); wBody.push(new THREE.Vector3(P.getX(i), P.getY(i), P.getZ(i))); wpos.push(wBody[w].clone()); }
    welded.set(i, w);
  }
  const nbr = wpos.map(() => new Set()), edgeUse = new Map();
  for (let t = 0; t < tris.length; t += 3) { const ws = [welded.get(tris[t]), welded.get(tris[t + 1]), welded.get(tris[t + 2])]; for (let e = 0; e < 3; e++) { const a = ws[e], b = ws[(e + 1) % 3]; nbr[a].add(b); nbr[b].add(a); const k = a < b ? a + '_' + b : b + '_' + a; edgeUse.set(k, (edgeUse.get(k) || 0) + 1); } }
  const bnbr = wpos.map(() => []); for (const [k, c] of edgeUse) if (c === 1) { const [a, b] = k.split('_').map(Number); bnbr[a].push(b); bnbr[b].push(a); }
  const isBoundary = bnbr.map((l) => l.length > 0);
  const iters = spec.drape ?? (spec.armor ? 14 : spec.material === 'spandex' ? 1 : spec.offset > 0.012 ? 10 : 6);
  const tmp = wpos.map((v) => v.clone());
  for (let it = 0; it < iters; it++) {
    for (let w = 0; w < wpos.length; w++) {
      const list = isBoundary[w] ? bnbr[w] : [...nbr[w]]; if (!list.length) continue;
      const avg = new THREE.Vector3(); for (const n of list) avg.add(wpos[n]); avg.multiplyScalar(1 / list.length);
      tmp[w].copy(wpos[w]).lerp(avg, isBoundary[w] ? 0.5 : 0.6);
    }
    for (let w = 0; w < wpos.length; w++) { // project back outside the body surface
      const d = tmp[w].clone().sub(wBody[w]).dot(wnor[w]);
      if (d < 0) tmp[w].addScaledVector(wnor[w], -d);
      wpos[w].copy(tmp[w]);
    }
  }
  const remap = new Map(); const pos = [], nor = [], uv = [], si = [], sw = [];
  for (const i of used) {
    const w = welded.get(i), nrm = wnor[w];
    const off = spec.offset;
    let px = wpos[w].x + nrm.x * off, py = wpos[w].y + nrm.y * off, pz = wpos[w].z + nrm.z * off;
    const nx = nrm.x, ny = nrm.y, nz = nrm.z;
    // skirts/coats: flare legs outward below the waist and merge the inner thighs
    if (spec.skirt && false) {
      const below = Math.max(0, f.waistBandY - P.getY(i));
      const r = f.region[i];
      if (r === 'thigh' || r === 'shin' || r === 'hips') { const flare = below * 0.35; px = px + Math.sign(px || 1) * flare * 0.6; pz = pz + (pz > f.jt.pelvis.z ? flare * 0.25 : -flare * 0.25); if (Math.abs(px) < 0.04 + flare * 0.5) px = Math.sign(px || 1) * (0.04 + flare * 0.5); }
    }
    remap.set(i, pos.length / 3);
    pos.push(px, py, pz); nor.push(nx, ny, nz); uv.push(UV.getX(i), UV.getY(i));
    for (let k = 0; k < 4; k++) { si.push(SI.getComponent(i, k)); sw.push(SW.getComponent(i, k)); }
  }
  const idx = tris.map((i) => remap.get(i));
  // hem thickness: duplicate boundary edges inward
  const edgeCount = new Map();
  for (let t = 0; t < idx.length; t += 3) for (const [a, b] of [[idx[t], idx[t + 1]], [idx[t + 1], idx[t + 2]], [idx[t + 2], idx[t]]]) { const k = a < b ? a + ',' + b : b + ',' + a; edgeCount.set(k, (edgeCount.get(k) || 0) + 1); }
  const thick = Math.max(0.002, spec.offset * 0.6);
  const inner = new Map();
  const innerOf = (v) => { if (inner.has(v)) return inner.get(v); const j = pos.length / 3; pos.push(pos[v * 3] - nor[v * 3] * thick, pos[v * 3 + 1] - nor[v * 3 + 1] * thick, pos[v * 3 + 2] - nor[v * 3 + 2] * thick); nor.push(nor[v * 3], nor[v * 3 + 1], nor[v * 3 + 2]); uv.push(uv[v * 2], uv[v * 2 + 1]); for (let k = 0; k < 4; k++) { si.push(si[v * 4 + k]); sw.push(sw[v * 4 + k]); } inner.set(v, j); return j; };
  const nTriIdx = idx.length;
  for (let t = 0; t < nTriIdx; t += 3) for (const [a, b] of [[idx[t], idx[t + 1]], [idx[t + 1], idx[t + 2]], [idx[t + 2], idx[t]]]) {
    const k = a < b ? a + ',' + b : b + ',' + a; if (edgeCount.get(k) !== 1) continue;
    const ai = innerOf(a), bi = innerOf(b); idx.push(b, a, ai, b, ai, bi);
  }
  // soles for footwear: push the lowest vertices down
  if (spec.sole) for (let i = 0; i < pos.length / 3; i++) if (pos[i * 3 + 1] < 0.03) pos[i * 3 + 1] -= spec.sole * (1 - pos[i * 3 + 1] / 0.03) * 0.5;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4)); geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  geo.setIndex(idx); geo.computeVertexNormals();
  const mat = (MATERIALS[spec.material] || MATERIALS.cotton)(spec.color ?? 0x556677);
  const m = mat.clone ? mat.clone() : mat; m.side = THREE.FrontSide;
  if (spec.armor) { m.envMapIntensity = 1.4; }
  const mesh = new THREE.SkinnedMesh(geo, m); mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
  mesh.bind(api.skeleton, api.mesh.bindMatrix);
  mesh.renderOrder = spec.layer;
  // polygon offset per layer avoids z-fighting between stacked garments
  m.polygonOffset = true; m.polygonOffsetFactor = -spec.layer; m.polygonOffsetUnits = -spec.layer;
  return mesh;
}

// Outfit presets (combine with any body): reusable across games.
export const OUTFITS = {
  casual: [{ type: 'underwear' }, { type: 'jeans', color: 0x2e4a72 }, { type: 'tshirt', color: 0x7a8a96 }, { type: 'sneakers', color: 0xe8e8e8 }],
  business: [{ type: 'underwear' }, { type: 'pants', color: 0x23262e }, { type: 'shirt', color: 0xe8ecf0 }, { type: 'jacket', color: 0x2a2e38, material: 'wool' }, { type: 'shoes', color: 0x161616 }],
  street: [{ type: 'underwear' }, { type: 'pants', color: 0x3a3a3a }, { type: 'hoodie', color: 0x5a2a3a }, { type: 'sneakers', color: 0x222222 }],
  biker: [{ type: 'underwear' }, { type: 'jeans', color: 0x1e2a3e }, { type: 'tshirt', color: 0x1a1a1a }, { type: 'jacket', color: 0x1c1410 }, { type: 'boots', color: 0x1a120c }, { type: 'gloves', color: 0x1a120c }],
  soldier: [{ type: 'underwear' }, { type: 'pants', color: 0x4a5236, material: 'cotton' }, { type: 'longsleeve', color: 0x55603e }, { type: 'vest', color: 0x3c4430, material: 'canvas' }, { type: 'boots', color: 0x2a2418 }, { type: 'gloves', color: 0x2a2a22 }, { type: 'belt', color: 0x2a2418 }],
  knight: [{ type: 'underwear' }, { type: 'pants', color: 0x3a2a22, material: 'wool' }, { type: 'longsleeve', color: 0x5a1a1a, material: 'wool' }, { type: 'cuirass' }, { type: 'pauldrons' }, { type: 'vambraces' }, { type: 'greaves' }, { type: 'boots', color: 0x2a1a10 }, { type: 'gloves', color: 0x2a1a10 }, { type: 'belt', color: 0x3a2418 }],
  superhero: [{ type: 'bodysuit', color: 0x1a3a8a }, { type: 'boots', color: 0xb01a2a, material: 'spandex' }, { type: 'gloves', color: 0xb01a2a, material: 'spandex' }, { type: 'belt', color: 0xd0a030, material: 'leather' }],
  villager: [{ type: 'underwear' }, { type: 'pants', color: 0x5a4632, material: 'wool' }, { type: 'shirt', color: 0xd8ccb0, material: 'wool' }, { type: 'vest', color: 0x4a3a2a, material: 'leather' }, { type: 'boots', color: 0x3a2818 }],
  wizard: [{ type: 'underwear' }, { type: 'pants', color: 0x2a2236 }, { type: 'robe', color: 0x2a2a5a }, { type: 'boots', color: 0x2a1a10 }, { type: 'belt', color: 0x8a6a2a }],
  athlete: [{ type: 'underwear' }, { type: 'shorts', color: 0x1a1a1a }, { type: 'tanktop', color: 0xd03a2a }, { type: 'sneakers', color: 0xf0f0f0 }],
  dress: [{ type: 'underwear' }, { type: 'dress', color: 0x8a1a3a }, { type: 'shoes', color: 0x1a1a1a }],
};
export { solid };
