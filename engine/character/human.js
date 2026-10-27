// Parametric human generator (GameForge "realistic" character style).
// Data: MakeHuman hm08 base mesh, morph targets, 163-bone rig and weights (CC0).
// Algorithms here are GameForge's own: macro-blend weights, joint-driven rig fitting,
// seam-welded normals, expression morphs, proxy fitting for eyes, garment/hair hooks.
import * as THREE from '../vendor/three/three.module.js';
import { loadHumanData } from './human-data.js';

const DM = 0.1; // MakeHuman units are decimetres
export const EXPRESSION_UNITS = ['eye-left-closure', 'eye-right-closure', 'eye-left-slit', 'eye-right-slit', 'eye-left-opened-up', 'eye-right-opened-up',
  'eyebrows-left-up', 'eyebrows-right-up', 'eyebrows-left-down', 'eyebrows-right-down', 'eyebrows-left-inner-up', 'eyebrows-right-inner-up',
  'mouth-open', 'mouth-corner-puller', 'mouth-depression', 'mouth-elevation', 'mouth-compression', 'mouth-parling', 'mouth-pursing', 'mouth-retraction', 'mouth-eversion', 'mouth-depression-retraction',
  'nose-wrinkle', 'cheek-left-raise', 'cheek-right-raise', 'cheek-balloon'];

// Facial expression presets: unit -> weight
export const EXPRESSIONS = {
  neutral: {},
  smile: { 'mouth-corner-puller': 0.8, 'cheek-left-raise': 0.4, 'cheek-right-raise': 0.4, 'eye-left-slit': 0.2, 'eye-right-slit': 0.2 },
  grin: { 'mouth-corner-puller': 1, 'mouth-parling': 0.5, 'cheek-left-raise': 0.7, 'cheek-right-raise': 0.7, 'eye-left-slit': 0.35, 'eye-right-slit': 0.35 },
  sad: { 'mouth-depression': 0.7, 'eyebrows-left-inner-up': 0.8, 'eyebrows-right-inner-up': 0.8, 'eye-left-slit': 0.2, 'eye-right-slit': 0.2 },
  angry: { 'eyebrows-left-down': 1, 'eyebrows-right-down': 1, 'mouth-compression': 0.6, 'nose-wrinkle': 0.5, 'eye-left-slit': 0.3, 'eye-right-slit': 0.3 },
  surprised: { 'eyebrows-left-up': 1, 'eyebrows-right-up': 1, 'eye-left-opened-up': 0.8, 'eye-right-opened-up': 0.8, 'mouth-open': 0.5 },
  fear: { 'eyebrows-left-inner-up': 1, 'eyebrows-right-inner-up': 1, 'eye-left-opened-up': 0.7, 'eye-right-opened-up': 0.7, 'mouth-retraction': 0.6, 'mouth-open': 0.2 },
  disgust: { 'nose-wrinkle': 0.9, 'mouth-elevation': 0.6, 'eyebrows-left-down': 0.5, 'eyebrows-right-down': 0.5 },
  determined: { 'eyebrows-left-down': 0.5, 'eyebrows-right-down': 0.5, 'mouth-compression': 0.5, 'eye-left-slit': 0.15, 'eye-right-slit': 0.15 },
  pain: { 'eye-left-closure': 0.7, 'eye-right-closure': 0.7, 'mouth-retraction': 0.8, 'eyebrows-left-inner-up': 0.6, 'eyebrows-right-inner-up': 0.6, 'nose-wrinkle': 0.5 },
  blink: { 'eye-left-closure': 1, 'eye-right-closure': 1 },
};
// Visemes for procedural lip-sync
export const VISEMES = { A: { 'mouth-open': 0.7 }, E: { 'mouth-open': 0.3, 'mouth-corner-puller': 0.4 }, I: { 'mouth-open': 0.2, 'mouth-retraction': 0.5 }, O: { 'mouth-open': 0.5, 'mouth-pursing': 0.6 }, U: { 'mouth-pursing': 0.9, 'mouth-open': 0.1 }, M: { 'mouth-compression': 0.6 }, F: { 'mouth-eversion': 0.4, 'mouth-open': 0.1 }, rest: {} };

export const ETHNICITIES = ['african', 'asian', 'caucasian'];

export function defaultHumanParams(seed = 1) {
  let s = seed >>> 0 || 1; const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const eth = [r(), r(), r()]; const t = eth[0] + eth[1] + eth[2];
  return { seed, sex: r() < 0.5 ? 0.05 + r() * 0.2 : 0.75 + r() * 0.25, age: 22 + r() * 40, muscle: 0.35 + r() * 0.35, weight: 0.3 + r() * 0.4, height: 0.3 + r() * 0.5, proportions: 0.6 + r() * 0.4,
    ethnicity: { african: eth[0] / t, asian: eth[1] / t, caucasian: eth[2] / t }, face: {}, body: {} };
}

// --- macro modelling weights ------------------------------------------------
function tri(v) { return v < 0.5 ? { min: 1 - v * 2, average: v * 2, max: 0 } : { min: 0, average: 2 - v * 2, max: v * 2 - 1 }; }
export function macroWeights(p) {
  const g = { female: 1 - p.sex, male: p.sex };
  const at = Math.min(1, Math.max(0, (p.age - 25) / 65));
  const a = { young: 1 - at, old: at };
  const m = tri(p.muscle), w = tri(p.weight);
  const out = new Map();
  const add = (name, v) => { if (v > 1e-4) out.set(name, (out.get(name) || 0) + v); };
  for (const [gn, gv] of Object.entries(g)) for (const [an, av] of Object.entries(a)) for (const [mn, mv] of Object.entries(m)) for (const [wn, wv] of Object.entries(w)) {
    const k = gv * av * mv * wv; if (k < 1e-4) continue;
    add(`macrodetails/universal-${gn}-${an}-${mn}muscle-${wn}weight`, k);
  }
  // height & proportions: separable approximation using the average-build variants
  for (const [gn, gv] of Object.entries(g)) for (const [an, av] of Object.entries(a)) {
    const k = gv * av; if (k < 1e-4) continue;
    const h = p.height; if (h > 0.5) add(`macrodetails/height/${gn}-${an}-averagemuscle-averageweight-maxheight`, k * (h - 0.5) * 2); else add(`macrodetails/height/${gn}-${an}-averagemuscle-averageweight-minheight`, k * (0.5 - h) * 2);
    const pr = p.proportions; if (pr > 0.5) add(`macrodetails/proportions/${gn}-${an}-averagemuscle-averageweight-idealproportions`, k * (pr - 0.5) * 2); else add(`macrodetails/proportions/${gn}-${an}-averagemuscle-averageweight-uncommonproportions`, k * (0.5 - pr) * 2);
  }
  for (const e of ETHNICITIES) { const ev = p.ethnicity?.[e] ?? 1 / 3; for (const [gn, gv] of Object.entries(g)) for (const [an, av] of Object.entries(a)) add(`macrodetails/${e}-${gn}-${an}`, ev * gv * av); }
  return out;
}

// Detail modifiers: { 'nose/nose-scale-horiz': 0.4 } -> incr/decr (or in/out, up/down …) target pair
const PAIRS = [['incr', 'decr'], ['up', 'down'], ['in', 'out'], ['forward', 'backward'], ['convex', 'concave'], ['compress', 'uncompress'], ['moreflared', 'lessflared'], ['pointed', 'unpointed'], ['open', 'close'], ['bulge', 'nobulge']];
export function detailWeights(modifiers, targets) {
  const out = new Map();
  for (const [k, v] of Object.entries(modifiers || {})) {
    if (!v) continue;
    if (targets.has(k)) { out.set(k, v); continue; }
    let found = false;
    for (const [pos, neg] of PAIRS) { const a = `${k}-${pos}`, b = `${k}-${neg}`; if (targets.has(a) || targets.has(b)) { if (v > 0 && targets.has(a)) out.set(a, v); if (v < 0 && targets.has(b)) out.set(b, -v); found = true; break; } }
    if (!found && typeof console !== 'undefined') console.warn('human: unknown modifier', k);
  }
  return out;
}
export function listModifiers(data) {
  const names = new Set();
  for (const n of data.targets.keys()) { if (n.startsWith('macrodetails') || n.startsWith('expression')) continue; let m = n; for (const [a, b] of PAIRS) { if (m.endsWith('-' + a)) { m = m.slice(0, -a.length - 1); break; } if (m.endsWith('-' + b)) { m = m.slice(0, -b.length - 1); break; } } names.add(m); }
  return [...names].sort();
}

function applyTargets(data, weights, out) {
  for (const [name, w] of weights) {
    const t = data.targets.get(name); if (!t) continue;
    const s = t.scale * w, idx = t.idx, d = t.delta;
    for (let i = 0; i < t.count; i++) { const k = idx[i] * 3; out[k] += d[i * 3] * s; out[k + 1] += d[i * 3 + 1] * s; out[k + 2] += d[i * 3 + 2] * s; }
  }
}

// Seam-welded smooth normals on base topology, then copied to render vertices.
function computeNormals(data, pos, groupNames) {
  const n = new Float32Array(pos.length), r2b = data.renderToBase;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (const g of groupNames) {
    const tris = data.groups[g]; if (!tris) continue;
    for (let i = 0; i < tris.length; i += 3) {
      const i0 = r2b[tris[i]] * 3, i1 = r2b[tris[i + 1]] * 3, i2 = r2b[tris[i + 2]] * 3;
      a.set(pos[i1] - pos[i0], pos[i1 + 1] - pos[i0 + 1], pos[i1 + 2] - pos[i0 + 2]);
      b.set(pos[i2] - pos[i0], pos[i2 + 1] - pos[i0 + 1], pos[i2 + 2] - pos[i0 + 2]);
      c.crossVectors(a, b); // area-weighted
      for (const k of [i0, i1, i2]) { n[k] += c.x; n[k + 1] += c.y; n[k + 2] += c.z; }
    }
  }
  for (let i = 0; i < n.length; i += 3) { const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1; n[i] /= l; n[i + 1] /= l; n[i + 2] /= l; }
  return n;
}

function jointPos(data, pos, joint) {
  const vs = data.meta.joints[joint]; const p = new THREE.Vector3();
  if (!vs) return p;
  for (const v of vs) p.add(new THREE.Vector3(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]));
  return p.multiplyScalar(DM / vs.length);
}

// Build THREE bones from joint positions; bone +Y points head->tail, roll from the plane.
function buildSkeleton(data, pos) {
  const bones = [], byName = {}, world = [];
  for (const b of data.meta.bones) {
    const head = jointPos(data, pos, b.head), tail = jointPos(data, pos, b.tail);
    let y = tail.clone().sub(head); if (y.lengthSq() < 1e-10) y.set(0, 1, 0); y.normalize();
    let zref = new THREE.Vector3(0, 0, 1);
    const pl = data.meta.planes[b.plane];
    if (pl) { const p1 = jointPos(data, pos, pl[0]), p2 = jointPos(data, pos, pl[1]), p3 = jointPos(data, pos, pl[2]); const nrm = p2.clone().sub(p1).cross(p3.clone().sub(p2)); if (nrm.lengthSq() > 1e-12) zref = nrm.normalize(); }
    let x = new THREE.Vector3().crossVectors(y, zref); if (x.lengthSq() < 1e-8) x = new THREE.Vector3().crossVectors(y, new THREE.Vector3(1, 0, 0)); x.normalize();
    const z = new THREE.Vector3().crossVectors(x, y).normalize();
    const m = new THREE.Matrix4().makeBasis(x, y, z).setPosition(head);
    const bone = new THREE.Bone(); bone.name = b.name;
    world.push(m); bones.push(bone); byName[b.name] = bone;
    bone.userData.tail = tail; bone.userData.head = head;
  }
  data.meta.bones.forEach((b, i) => {
    const local = b.parent ? new THREE.Matrix4().copy(world[data.boneIndex[b.parent]]).invert().multiply(world[i]) : world[i].clone();
    local.decompose(bones[i].position, bones[i].quaternion, bones[i].scale);
    if (b.parent) byName[b.parent].add(bones[i]);
  });
  return { bones, byName, root: byName.root };
}

/**
 * createHuman(params) -> Promise<THREE.Group>
 * params: defaultHumanParams() fields + { face: {modifier: -1..1}, body: {...}, skin, eyes: {color}, hair, outfit, expressions: true }
 * Returned group.userData: { kind:'human', params, mesh, skeleton, bones, sockets, height, setExpression(name|weights, w), face }
 */
export async function createHuman(params = {}) {
  const data = await loadHumanData();
  return buildHuman(data, params);
}

export function buildHuman(data, params = {}) {
  const p = { ...defaultHumanParams(params.seed ?? 1), ...params };
  // 1. morph the base mesh
  const pos = new Float32Array(data.basePositions);
  // heightCm: solve the height-target weight from three measurements (exact for the linear blend)
  if (p.heightCm) {
    const measure = (h) => { const q = new Float32Array(data.basePositions); applyTargets(data, macroWeights({ ...p, height: h }), q); let lo = Infinity, hi = -Infinity; const b = data.groups.body; for (let i = 0; i < b.length; i += 7) { const y = q[data.renderToBase[b[i]] * 3 + 1]; lo = Math.min(lo, y); hi = Math.max(hi, y); } return (hi - lo) * DM * 100; };
    const h0 = measure(0.5), want = p.heightCm;
    p.height = want >= h0 ? 0.5 + 0.5 * Math.min(1, (want - h0) / Math.max(1e-3, measure(1) - h0)) : 0.5 - 0.5 * Math.min(1, (h0 - want) / Math.max(1e-3, h0 - measure(0)));
  }
  applyTargets(data, macroWeights(p), pos);
  applyTargets(data, detailWeights({ ...p.face, ...p.body }, data.targets), pos);
  // feet on the ground: lowest body vertex -> y=0
  let minY = Infinity; const body = data.groups.body, r2b = data.renderToBase;
  for (let i = 0; i < body.length; i++) minY = Math.min(minY, pos[r2b[body[i]] * 3 + 1]);
  for (let i = 1; i < pos.length; i += 3) pos[i] -= minY;
  // exact stature: the solve above is approximate (sampled, before detail targets) -> rescale by ≤ a few %
  if (p.heightCm) {
    let top = -Infinity; for (let i = 0; i < body.length; i++) top = Math.max(top, pos[r2b[body[i]] * 3 + 1]);
    const k = p.heightCm / (top * DM * 100);
    if (Math.abs(k - 1) < 0.08) for (let i = 0; i < pos.length; i++) pos[i] *= k;
  }
  // 2. skeleton from joints
  const sk = buildSkeleton(data, pos);
  // 3. render geometry
  const nR = data.meta.renderVerts;
  const rp = new Float32Array(nR * 3), rn = new Float32Array(nR * 3), si = new Uint16Array(nR * 4), sw = new Float32Array(nR * 4);
  const norms = computeNormals(data, pos, ['body', 'helper-upper-teeth', 'helper-lower-teeth', 'helper-tongue']);
  for (let i = 0; i < nR; i++) {
    const b = r2b[i];
    rp[i * 3] = pos[b * 3] * DM; rp[i * 3 + 1] = pos[b * 3 + 1] * DM; rp[i * 3 + 2] = pos[b * 3 + 2] * DM;
    rn[i * 3] = norms[b * 3]; rn[i * 3 + 1] = norms[b * 3 + 1]; rn[i * 3 + 2] = norms[b * 3 + 2];
    for (let k = 0; k < 4; k++) { si[i * 4 + k] = data.skinIndex[b * 4 + k]; sw[i * 4 + k] = data.skinWeight[b * 4 + k] / 255; }
    const t = sw[i * 4] + sw[i * 4 + 1] + sw[i * 4 + 2] + sw[i * 4 + 3]; if (t > 0) for (let k = 0; k < 4; k++) sw[i * 4 + k] /= t; else { si[i * 4] = data.boneIndex.spine05; sw[i * 4] = 1; }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(rp, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(rn, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(data.uvs), 2));
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  // index with material groups: 0 skin, 1 teeth, 2 tongue (hair/lash helpers excluded)
  const order = [['body', 0], ['helper-upper-teeth', 1], ['helper-lower-teeth', 1], ['helper-tongue', 2]];
  const total = order.reduce((s, [g]) => s + (data.groups[g]?.length || 0), 0);
  const index = new Uint32Array(total); let o = 0;
  for (const [g, mi] of order) { const t = data.groups[g]; if (!t) continue; index.set(t, o); geo.addGroup(o, t.length, mi); o += t.length; }
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  // 4. expression morph targets (render space, relative)
  const units = [];
  if (p.expressions !== false) {
    const morphs = [];
    for (const u of EXPRESSION_UNITS) {
      const t = data.targets.get('expression/units/caucasian/' + u); if (!t) continue;
      const basePos = new Float32Array(pos.length); // delta in base space
      applyTargets(data, new Map([[t.name, 1]]), basePos);
      const d = new Float32Array(nR * 3);
      for (let i = 0; i < nR; i++) { const b = r2b[i] * 3; d[i * 3] = basePos[b] * DM; d[i * 3 + 1] = basePos[b + 1] * DM; d[i * 3 + 2] = basePos[b + 2] * DM; }
      morphs.push(new THREE.BufferAttribute(d, 3)); units.push(u);
    }
    if (morphs.length) { geo.morphAttributes.position = morphs; geo.morphTargetsRelative = true; }
  }
  geo.computeBoundingSphere();
  const mats = (p.materials || defaultHumanMaterials)(p, data, geo);
  const mesh = new THREE.SkinnedMesh(geo, mats);
  mesh.name = 'human'; mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
  if (units.length) { mesh.morphTargetDictionary = Object.fromEntries(units.map((u, i) => [u, i])); mesh.morphTargetInfluences = new Array(units.length).fill(0); }
  const skeleton = new THREE.Skeleton(sk.bones);
  const root = new THREE.Group(); root.name = 'human';
  root.add(sk.root, mesh); root.updateMatrixWorld(true);
  mesh.bind(skeleton);
  // 5. eyes (proxy fitted to the morphed head, rigid to eye bones)
  if (data.eyes) root.add(buildEyes(data, pos, sk, p, skeleton));
  // 6. sockets
  const sockets = {};
  const hand = (side) => {
    // grip socket: centred in the palm, weapon +Y aligned with the thumb direction (out of the fist)
    const w = sk.byName['wrist.' + side], m3 = sk.byName['finger3-1.' + side], th = sk.byName['finger1-2.' + side], m5 = sk.byName['finger5-1.' + side];
    const o = new THREE.Object3D(); o.name = 'socket_hand_' + side; w.add(o);
    const wp = w.getWorldPosition(new THREE.Vector3()), mp = m3.getWorldPosition(new THREE.Vector3()), tp = th.getWorldPosition(new THREE.Vector3()), lp = m5.getWorldPosition(new THREE.Vector3());
    const grip = wp.clone().lerp(mp, 0.75); const fingers = mp.clone().sub(wp).normalize();
    const across = tp.clone().sub(lp).normalize(); // little finger -> thumb
    const up = across.clone().sub(fingers.clone().multiplyScalar(across.dot(fingers))).normalize();
    const zAxis = new THREE.Vector3().crossVectors(fingers, up).normalize();
    const worldRot = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(fingers.clone().cross(up).cross(up).negate().normalize(), up, zAxis));
    o.position.copy(w.worldToLocal(grip.clone()));
    o.quaternion.copy(w.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(worldRot));
    return o;
  };
  sockets.hand_R = hand('R'); sockets.hand_L = hand('L');
  for (const [n, bn, off] of [['head', 'head', [0, 0.12, 0]], ['back', 'spine03', [0, 0, -0.15]], ['hip_L', 'pelvis.L', [0, 0, 0]], ['hip_R', 'pelvis.R', [0, 0, 0]]]) { const s = new THREE.Object3D(); s.name = 'socket_' + n; s.position.set(...off); sk.byName[bn].add(s); sockets[n] = s; }
  let top = -Infinity; for (let i = 0; i < body.length; i++) top = Math.max(top, pos[r2b[body[i]] * 3 + 1]);
  const height = top * DM; // stature: floor (feet at y=0) to vertex top of the body mesh (helpers excluded)
  const api = {
    kind: 'human', params: p, mesh, skeleton, bones: sk.byName, sockets, height, data, positions: pos,
    collider: { type: 'capsule', radius: 0.3, height },
    expression: {},
    // Set facial expression: name from EXPRESSIONS / VISEMES or { unit: weight }; blends additively with blink/visemes layers.
    setExpression(e, w = 1) {
      if (typeof e === 'string') { const n = EXPRESSION_ALIASES[e] || e; if (!EXPRESSIONS[n] && !VISEMES[n]) console.warn('unknown expression', e); e = EXPRESSIONS[n] || VISEMES[n] || {}; }
      api.expression = e; api.expressionWeight = w;
    },
  };
  root.userData = api;
  root.userData.face = new FaceRig(api);
  return root;
}

// Eyes: build from the high-poly proxy with barycentric fitting (MHCLO semantics).
function buildEyes(data, pos, sk, p, skeleton) {
  const E = data.eyes, n = E.verts, out = new Float32Array(n * 3);
  const P = (i, a) => pos[i * 3 + a];
  const sc = {}; for (const ax of ['x', 'y', 'z']) { const s = E.scales[ax]; const a = { x: 0, y: 1, z: 2 }[ax]; sc[ax] = s ? Math.abs(P(s[0], a) - P(s[1], a)) / s[2] : 1; }
  for (let i = 0; i < n; i++) {
    const r = E.refs.subarray(i * 9, i * 9 + 9);
    for (let a = 0; a < 3; a++) out[i * 3 + a] = (r[3] * P(r[0], a) + r[4] * P(r[1], a) + r[5] * P(r[2], a) + r[6 + a] * sc['xyz'[a]]) * DM;
  }
  const nR = E.renderVerts, rp = new Float32Array(nR * 3), si = new Uint16Array(nR * 4), sw = new Float32Array(nR * 4);
  const li = data.boneIndex['eye.L'], ri = data.boneIndex['eye.R'];
  for (let i = 0; i < nR; i++) { const v = E.renderToProxy[i]; rp.set(out.subarray(v * 3, v * 3 + 3), i * 3); si[i * 4] = out[v * 3] > 0 ? li : ri; sw[i * 4] = 1; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(rp, 3)); g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(E.uvs), 2));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4)); g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  g.setIndex(new THREE.BufferAttribute(new Uint32Array(E.tris), 1)); g.computeVertexNormals();
  // iris / pupil / sclera from the angle to each eye's forward axis (independent of the proxy UV layout)
  const col = new Float32Array(nR * 3), irisC = new THREE.Color(p.eyes?.color ?? 0x5a3a20), sclera = new THREE.Color(0xdcd3c8), pupil = new THREE.Color(0x060606), limbal = irisC.clone().multiplyScalar(0.35);
  const centers = { L: new THREE.Vector3(), R: new THREE.Vector3() }, cnt = { L: 0, R: 0 };
  for (let i = 0; i < nR; i++) { const s = rp[i * 3] > 0 ? 'L' : 'R'; centers[s].add(new THREE.Vector3(rp[i * 3], rp[i * 3 + 1], rp[i * 3 + 2])); cnt[s]++; }
  for (const s of ['L', 'R']) centers[s].multiplyScalar(1 / Math.max(1, cnt[s]));
  const vv = new THREE.Vector3(), seedN = (p.seed || 1) * 0.37;
  for (let i = 0; i < nR; i++) {
    const s = rp[i * 3] > 0 ? 'L' : 'R'; vv.set(rp[i * 3], rp[i * 3 + 1], rp[i * 3 + 2]).sub(centers[s]).normalize();
    const ang = Math.acos(Math.min(1, vv.z)) * 180 / Math.PI, az = Math.atan2(vv.y, vv.x);
    let c;
    // anatomical sizes on a 24 mm globe: iris Ø≈11.7 mm -> 29° half-angle, pupil Ø≈3.5 mm -> 8.5°
    if (ang < 8.5) c = pupil;
    else if (ang < 28) { const fib = 0.75 + 0.25 * Math.sin(az * 40 + seedN) * Math.sin(az * 13); c = irisC.clone().multiplyScalar(fib * (ang < 13 ? 0.7 : 1)); if (ang > 24.5) c.lerp(limbal, (ang - 24.5) / 3.5); }
    else c = sclera.clone().lerp(new THREE.Color(0xd8b8b0), Math.max(0, (ang - 60) / 60) * 0.4);
    col.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = new THREE.SkinnedMesh(g, eyeMaterial(p.eyes || {})); m.name = 'eyes'; m.frustumCulled = false;
  m.bind(skeleton);
  m.userData.isEye = true;
  return m;
}

// ---------------- materials ----------------
const SKIN_TONES = { porcelain: 0xf3d9c8, fair: 0xe9c3a6, light: 0xddb08c, medium: 0xc48a63, olive: 0xb07f55, tan: 0x9a6640, brown: 0x7a4b2e, dark: 0x4f2f1d, deep: 0x3a2216 };
export { SKIN_TONES };
export function skinToneFor(p) {
  if (p.skin?.color !== undefined) return new THREE.Color(p.skin.color);
  if (typeof p.skin === 'string' && SKIN_TONES[p.skin]) return new THREE.Color(SKIN_TONES[p.skin]);
  const e = p.ethnicity || { african: 1 / 3, asian: 1 / 3, caucasian: 1 / 3 };
  const c = new THREE.Color(0, 0, 0);
  c.add(new THREE.Color(SKIN_TONES.brown).multiplyScalar(e.african || 0)).add(new THREE.Color(SKIN_TONES.light).multiplyScalar(e.asian || 0)).add(new THREE.Color(SKIN_TONES.fair).multiplyScalar(e.caucasian || 0));
  return c;
}
let skinFactory = null;
export function setSkinMaterialFactory(f) { skinFactory = f; }
function defaultHumanMaterials(p, data, geo) {
  const skin = skinFactory ? skinFactory(p, data, geo) : new THREE.MeshStandardMaterial({ color: skinToneFor(p), roughness: 0.55 });
  const teeth = new THREE.MeshStandardMaterial({ color: 0xece4d4, roughness: 0.25 });
  const tongue = new THREE.MeshStandardMaterial({ color: 0xa34a4a, roughness: 0.4 });
  return [skin, teeth, tongue];
}
function eyeMaterial() {
  return new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.03 });
}

// ---------------- facial animation ----------------
// Layered facial animation: expression (target) + automatic blinking + visemes (talking).
export const EXPRESSION_ALIASES = { happy: 'smile', joy: 'smile', laugh: 'grin', mad: 'angry', rage: 'angry', shock: 'surprised', scared: 'fear', afraid: 'fear', disgusted: 'disgust', focused: 'determined', hurt: 'pain', sorrow: 'sad' };
export class FaceRig {
  constructor(api) { this.api = api; this.t = 0; this.nextBlink = 2 + Math.random() * 3; this.blink = 0; this.talk = 0; this.visemeT = 0; this.viseme = {}; this.cur = {}; this.look = null; }
  speak(seconds = 2) { this.talk = seconds; }
  update(dt) {
    const mesh = this.api.mesh; const dict = mesh.morphTargetDictionary; if (!dict) return;
    this.t += dt; this.nextBlink -= dt;
    if (this.nextBlink <= 0) { this.blink = 0.15; this.nextBlink = 2 + Math.random() * 4; }
    this.blink = Math.max(0, this.blink - dt);
    const blinkW = this.blink > 0 ? Math.sin((1 - this.blink / 0.15) * Math.PI) : 0;
    if (this.talk > 0) { this.talk -= dt; this.visemeT -= dt; if (this.visemeT <= 0) { this.visemeT = 0.08 + Math.random() * 0.08; const keys = Object.keys(VISEMES); this.viseme = VISEMES[keys[Math.floor(Math.random() * (keys.length - 1))]]; } } else this.viseme = {};
    const target = {};
    const add = (o, w) => { for (const [k, v] of Object.entries(o)) target[k] = (target[k] || 0) + v * w; };
    add(this.api.expression || {}, this.api.expressionWeight ?? 1);
    add(this.viseme, 1);
    target['eye-left-closure'] = Math.max(target['eye-left-closure'] || 0, blinkW); target['eye-right-closure'] = Math.max(target['eye-right-closure'] || 0, blinkW);
    for (const [k, i] of Object.entries(dict)) { const want = Math.min(1, target[k] || 0); const c = mesh.morphTargetInfluences[i]; mesh.morphTargetInfluences[i] = c + (want - c) * Math.min(1, dt * (k.startsWith('eye') ? 40 : 14)); }
  }
}
