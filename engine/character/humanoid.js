// Procedural skinned humanoid: skeleton + single SkinnedMesh (multi-material groups),
// smooth joint weights, parametric proportions, faces, hair styles, outfits and armor.
// Rest pose: standing, arms hanging slightly out (A-ish). Faces +Z, left = +X.
import * as THREE from '../vendor/three/three.module.js';
import { mergeGeometries } from '../vendor/three/addons/utils/BufferGeometryUtils.js';
import { RNG } from '../core/rng.js';
import { textureSet } from '../render/materials.js';

export const BONES = ['root', 'hips', 'spine', 'chest', 'neck', 'head',
  'shoulder_L', 'upperArm_L', 'lowerArm_L', 'hand_L', 'shoulder_R', 'upperArm_R', 'lowerArm_R', 'hand_R',
  'upperLeg_L', 'lowerLeg_L', 'foot_L', 'upperLeg_R', 'lowerLeg_R', 'foot_R'];
export const UPPER_BODY = new Set(['spine', 'chest', 'neck', 'head', 'shoulder_L', 'upperArm_L', 'lowerArm_L', 'hand_L', 'shoulder_R', 'upperArm_R', 'lowerArm_R', 'hand_R']);

const SKIN_TONES = [0xf1d0b5, 0xe0b48f, 0xc68c64, 0xa86d47, 0x7a4a2e, 0x55331f];
const HAIR_COLORS = [0x1a1210, 0x3a2416, 0x6a4022, 0xb08850, 0xd8c090, 0x8a2a1a, 0x9a9aa0, 0x2a2a6a];

export function defaultParams(seed = 1) {
  const r = new RNG(seed);
  return {
    seed, height: r.range(1.7, 1.88), build: r.range(0.35, 0.65), shoulders: r.range(0.9, 1.1), hips: r.range(0.9, 1.1), headScale: 1.08,
    skin: r.pick(SKIN_TONES), hair: r.pick(HAIR_COLORS), hairStyle: r.pick(['short', 'long', 'ponytail', 'buzz', 'mohawk', 'bun']),
    outfit: 'casual', top: r.pick([0x3a5a8a, 0x8a3a3a, 0x3a7a4a, 0xd0c0a0, 0x2a2a2e, 0x6a4a8a]), bottom: r.pick([0x2a3a5a, 0x3a3a3a, 0x5a4a3a, 0x2a2a2a]),
    shoes: r.pick([0x1a1a1a, 0x5a3a20, 0xe0e0e0]), accent: r.pick([0xd0a030, 0xc0c0c8, 0xe04020, 0x20a0e0]), eyes: r.pick([0x3a2a1a, 0x2a5a8a, 0x3a6a3a]),
    beard: r.chance(0.2), armor: false, cape: false, helmet: false, belt: true,
  };
}

// Joint positions in metres for the given proportions.
function joints(p) {
  const s = p.height / 1.8, sh = p.shoulders, hp = p.hips;
  const J = {
    root: [0, 0, 0], hips: [0, 0.98, 0], spine: [0, 1.1, 0], chest: [0, 1.27, 0], neck: [0, 1.5, 0], head: [0, 1.6, 0],
    shoulder_L: [0.06, 1.44, 0], upperArm_L: [0.19 * sh, 1.43, 0], lowerArm_L: [0.24 * sh, 1.15, -0.01], hand_L: [0.27 * sh, 0.9, 0.01],
    upperLeg_L: [0.095 * hp, 0.95, 0], lowerLeg_L: [0.1 * hp, 0.52, 0.01], foot_L: [0.1 * hp, 0.09, -0.01],
  };
  for (const k of Object.keys(J)) if (k.endsWith('_L')) { const v = J[k]; J[k.replace('_L', '_R')] = [-v[0], v[1], v[2]]; }
  for (const k of Object.keys(J)) J[k] = J[k].map((x) => x * s);
  return J;
}
const PARENT = { hips: 'root', spine: 'hips', chest: 'spine', neck: 'chest', head: 'neck', shoulder_L: 'chest', upperArm_L: 'shoulder_L', lowerArm_L: 'upperArm_L', hand_L: 'lowerArm_L', shoulder_R: 'chest', upperArm_R: 'shoulder_R', lowerArm_R: 'upperArm_R', hand_R: 'lowerArm_R', upperLeg_L: 'hips', lowerLeg_L: 'upperLeg_L', foot_L: 'lowerLeg_L', upperLeg_R: 'hips', lowerLeg_R: 'upperLeg_R', foot_R: 'lowerLeg_R' };

const MAT = { skin: 0, cloth: 1, hair: 2, metal: 3, eye: 4 };

// Part accumulator: geometry with per-vertex colors and skin weights.
class Parts {
  constructor(boneIndex) { this.bi = boneIndex; this.lists = [[], [], [], [], []]; }
  // weightsFn(vertexPos) -> [[bone, w], ...]
  add(geo, mat, color, weightsFn) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    const n = g.attributes.position.count, col = new Float32Array(n * 3), si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    const c = new THREE.Color(color), v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(g.attributes.position, i);
      const cc = typeof color === 'function' ? new THREE.Color(color(v)) : c;
      col[i * 3] = cc.r; col[i * 3 + 1] = cc.g; col[i * 3 + 2] = cc.b;
      const ws = (typeof weightsFn === 'string' ? [[weightsFn, 1]] : weightsFn(v)).filter((w) => w[1] > 0.001).sort((a, b) => b[1] - a[1]).slice(0, 4);
      const tot = ws.reduce((s, w) => s + w[1], 0) || 1;
      ws.forEach(([b, w], k) => { si[i * 4 + k] = this.bi[b]; sw[i * 4 + k] = w / tot; });
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    this.lists[mat].push(g);
  }
}

// Tube along a chain of joints with radius profile; returns geometry + chain parameter fn.
function chainTube(points, radii, radial = 10, perSeg = 6, flatten = 1) {
  const pts = [], rad = [];
  for (let i = 0; i < points.length - 1; i++) for (let k = 0; k < perSeg; k++) {
    const t = k / perSeg; pts.push(new THREE.Vector3().lerpVectors(points[i], points[i + 1], t));
    rad.push(THREE.MathUtils.lerp(radii[i], radii[i + 1], t));
  }
  pts.push(points[points.length - 1].clone()); rad.push(radii[radii.length - 1]);
  const pos = [], idx = [];
  const up = new THREE.Vector3(0, 0, 1);
  for (let i = 0; i < pts.length; i++) {
    const dir = (i < pts.length - 1 ? pts[i + 1].clone().sub(pts[i]) : pts[i].clone().sub(pts[i - 1])).normalize();
    const side = new THREE.Vector3().crossVectors(dir, up).normalize();
    if (side.lengthSq() < 0.1) side.set(1, 0, 0);
    const fwd = new THREE.Vector3().crossVectors(side, dir).normalize();
    for (let j = 0; j < radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const o = side.clone().multiplyScalar(Math.cos(a) * rad[i]).add(fwd.clone().multiplyScalar(Math.sin(a) * rad[i] * flatten));
      pos.push(pts[i].x + o.x, pts[i].y + o.y, pts[i].z + o.z);
    }
  }
  for (let i = 0; i < pts.length - 1; i++) for (let j = 0; j < radial; j++) {
    const a = i * radial + j, b = i * radial + ((j + 1) % radial), c = a + radial, d = b + radial;
    idx.push(a, b, c, b, d, c);
  }
  // caps
  const capStart = pos.length / 3; pos.push(pts[0].x, pts[0].y, pts[0].z);
  const capEnd = capStart + 1; const L = pts[pts.length - 1]; pos.push(L.x, L.y, L.z);
  for (let j = 0; j < radial; j++) {
    idx.push(capStart, (j + 1) % radial, j);
    const o = (pts.length - 1) * radial; idx.push(capEnd, o + j, o + ((j + 1) % radial));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}

// Smooth two-bone blend weights along a segment a->b->c: near joint b blend over `blend` metres.
function limbWeights(a, b, boneA, boneB, blend = 0.06, boneC = null, c = null) {
  const ab = new THREE.Vector3().subVectors(b, a), lenAB = ab.length(); ab.normalize();
  const bc = c ? new THREE.Vector3().subVectors(c, b) : null; const lenBC = bc ? bc.length() : 0; if (bc) bc.normalize();
  return (v) => {
    const d = new THREE.Vector3().subVectors(v, a).dot(ab) - lenAB; // signed distance past joint b
    const t = THREE.MathUtils.clamp((d + blend) / (2 * blend), 0, 1);
    const out = [[boneA, 1 - t], [boneB, t]];
    if (boneC && c) {
      const d2 = new THREE.Vector3().subVectors(v, b).dot(bc) - lenBC;
      const t2 = THREE.MathUtils.clamp((d2 + blend * 0.6) / (blend * 1.2), 0, 1);
      if (t2 > 0) { out[1][1] *= 1 - t2; out.push([boneC, t * t2]); }
    }
    return out;
  };
}

export function createHumanoid(params = {}) {
  const p = { ...defaultParams(params.seed ?? 1), ...params };
  const J = joints(p);
  const s = p.height / 1.8, b = p.build;
  const bones = {}, boneList = [];
  for (const name of BONES) {
    const bone = new THREE.Bone(); bone.name = name;
    bones[name] = bone; boneList.push(bone);
  }
  for (const name of BONES) {
    if (name === 'root') { bones.root.position.set(0, 0, 0); continue; }
    const par = PARENT[name], pw = J[par], w = J[name];
    bones[name].position.set(w[0] - pw[0], w[1] - pw[1], w[2] - pw[2]);
    bones[par].add(bones[name]);
  }
  const bi = {}; BONES.forEach((n, i) => (bi[n] = i));
  const parts = new Parts(bi);
  const V = (a) => new THREE.Vector3(...a);
  const clothTop = p.top, clothBottom = p.bottom;

  // --- Torso: lofted ellipses from crotch to neck base, weighted hips/spine/chest
  const torsoKeys = [
    // [y (unscaled), halfWidth, halfDepth, color key]
    [0.86, 0.15 * p.hips, 0.11, 'bottom'], [0.95, 0.165 * p.hips, 0.12, 'bottom'], [1.02, 0.155 * p.hips, 0.115, 'belt'],
    [1.1, 0.14 + b * 0.03, 0.105 + b * 0.03, 'top'], [1.22, 0.15 + b * 0.02, 0.11 + b * 0.02, 'top'],
    [1.33, 0.17 * p.shoulders + b * 0.015, 0.12 + b * 0.02, 'top'], [1.42, 0.17 * p.shoulders, 0.1, 'top'], [1.49, 0.075, 0.06, 'skin'],
  ];
  const ringN = 16, torsoPos = [], torsoIdx = [];
  const rows = [];
  for (let k = 0; k < torsoKeys.length - 1; k++) for (let st = 0; st < 3; st++) {
    const t = st / 3, A = torsoKeys[k], B = torsoKeys[k + 1];
    rows.push([THREE.MathUtils.lerp(A[0], B[0], t), THREE.MathUtils.lerp(A[1], B[1], t), THREE.MathUtils.lerp(A[2], B[2], t)]);
  }
  rows.push(torsoKeys[torsoKeys.length - 1]);
  for (const [y, hw, hd] of rows) for (let j = 0; j < ringN; j++) {
    const a = (j / ringN) * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a);
    const sx = Math.sign(c) * Math.pow(Math.abs(c), 0.8), sz = Math.sign(sn) * Math.pow(Math.abs(sn), 0.9);
    const chestBulge = sn > 0 && y > 1.15 && y < 1.4 ? 1 + 0.12 * Math.sin(((y - 1.15) / 0.25) * Math.PI) * sn : 1;
    const glute = sn < 0 && y < 1.0 ? 1 + 0.15 * (-sn) * Math.sin(((y - 0.86) / 0.14) * Math.PI) : 1;
    torsoPos.push(sx * hw * s, y * s, sz * hd * s * chestBulge * glute);
  }
  for (let i = 0; i < rows.length - 1; i++) for (let j = 0; j < ringN; j++) {
    const a0 = i * ringN + j, a1 = i * ringN + ((j + 1) % ringN), c0 = a0 + ringN, c1 = a1 + ringN;
    torsoIdx.push(a0, c0, a1, a1, c0, c1);
  }
  const bottomCap = torsoPos.length / 3; torsoPos.push(0, rows[0][0] * s, 0);
  for (let j = 0; j < ringN; j++) torsoIdx.push(bottomCap, j, (j + 1) % ringN);
  const torso = new THREE.BufferGeometry(); torso.setAttribute('position', new THREE.Float32BufferAttribute(torsoPos, 3)); torso.setIndex(torsoIdx); torso.computeVertexNormals();
  const torsoColor = (v) => {
    const y = v.y / s;
    if (y > 1.465) return p.skin;
    if (p.outfit === 'robe') return y < 1.05 && y > 1.0 ? p.accent : clothTop;
    if (p.outfit === 'suit') return Math.abs(v.x) < 0.02 * s && v.z > 0 && y > 1.05 ? p.accent : (y < 1.05 ? clothBottom : clothTop);
    if (p.belt && y > 1.0 && y < 1.045) return 0x2a1a10;
    return y < 1.02 ? clothBottom : clothTop;
  };
  const hipsLegBlend = (v) => {
    const y = v.y / s;
    if (y < 0.93) { const side = v.x >= 0 ? 'upperLeg_L' : 'upperLeg_R'; const t = THREE.MathUtils.clamp((0.93 - y) / 0.08, 0, 0.6) * Math.min(1, Math.abs(v.x) / (0.08 * s)); return [['hips', 1 - t], [side, t]]; }
    if (y < 1.05) return [['hips', 1 - (y - 0.93) / 0.12 * 0.5], ['spine', (y - 0.93) / 0.12 * 0.5]];
    if (y < 1.2) return [['spine', 1 - (y - 1.05) / 0.15 * 0.6], ['chest', (y - 1.05) / 0.15 * 0.6], ['hips', 0.0]];
    if (y > 1.46) return [['neck', 1]];
    const sh = Math.abs(v.x) > 0.13 * s && y > 1.36 ? (v.x > 0 ? 'shoulder_L' : 'shoulder_R') : null;
    return sh ? [['chest', 0.6], [sh, 0.4]] : [['chest', 1]];
  };
  parts.add(torso, p.outfit === 'skin' ? MAT.skin : MAT.cloth, torsoColor, hipsLegBlend);

  // --- Neck & head
  parts.add(chainTube([V(J.neck).add(new THREE.Vector3(0, -0.04 * s, 0)), V(J.head).add(new THREE.Vector3(0, 0.04 * s, 0))], [0.05 * s, 0.048 * s], 10, 3), MAT.skin, p.skin, (v) => [['neck', 1 - THREE.MathUtils.clamp((v.y - J.head[1]) / (0.04 * s), 0, 1)], ['head', THREE.MathUtils.clamp((v.y - J.head[1]) / (0.04 * s), 0, 1)]]);
  const hs = 0.115 * s * p.headScale, headC = V(J.head).add(new THREE.Vector3(0, hs * 0.95, 0.01 * s));
  const head = new THREE.SphereGeometry(hs, 20, 16);
  { // sculpt: narrower jaw, flatter back/sides, chin, brow
    const pos = head.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i); const ny = v.y / hs, nz = v.z / hs;
      let sx = 0.86, sy = 1.12, sz = 0.98;
      if (ny < -0.1) { const jaw = THREE.MathUtils.smoothstep(-ny, 0.1, 1); sx *= 1 - 0.32 * jaw; sz *= 1 - 0.1 * jaw * (nz < 0 ? 1.4 : 0); }
      if (nz > 0.6 && ny < -0.5) sz *= 1.06; // chin
      if (nz > 0.5 && ny > 0.15 && ny < 0.4) sz *= 1.04; // brow
      pos.setXYZ(i, v.x * sx, v.y * sy, v.z * sz);
    }
    head.computeVertexNormals();
  }
  head.translate(headC.x, headC.y, headC.z);
  parts.add(head, MAT.skin, p.skin, 'head');
  // nose & ears
  const nose = new THREE.ConeGeometry(0.018 * s, 0.05 * s, 6); nose.rotateX(Math.PI * 0.42); nose.translate(headC.x, headC.y - hs * 0.08, headC.z + hs * 0.98);
  parts.add(nose, MAT.skin, p.skin, 'head');
  for (const sd of [-1, 1]) {
    const ear = new THREE.SphereGeometry(0.028 * s, 6, 6); ear.scale(0.45, 1, 0.8); ear.translate(headC.x + sd * hs * 0.86, headC.y - hs * 0.05, headC.z - hs * 0.05);
    parts.add(ear, MAT.skin, p.skin, 'head');
    const eye = new THREE.SphereGeometry(0.019 * s * p.headScale, 10, 8); eye.translate(headC.x + sd * hs * 0.36, headC.y + hs * 0.08, headC.z + hs * 0.82);
    parts.add(eye, MAT.eye, 0xb8b4ac, 'head');
    const iris = new THREE.SphereGeometry(0.0135 * s * p.headScale, 8, 6); iris.scale(1, 1, 0.5); iris.translate(headC.x + sd * hs * 0.37, headC.y + hs * 0.08, headC.z + hs * 0.82 + 0.014 * s);
    parts.add(iris, MAT.eye, p.eyes, 'head');
    const brow = new THREE.BoxGeometry(0.05 * s, 0.009 * s, 0.012 * s); brow.rotateZ(-sd * 0.12); brow.translate(headC.x + sd * hs * 0.36, headC.y + hs * 0.28, headC.z + hs * 0.88);
    parts.add(brow, MAT.hair, p.hair, 'head');
  }
  const mouth = new THREE.BoxGeometry(0.045 * s, 0.007 * s, 0.01 * s); mouth.translate(headC.x, headC.y - hs * 0.42, headC.z + hs * 0.86);
  parts.add(mouth, MAT.skin, new THREE.Color(p.skin).multiplyScalar(0.65).getHex(), 'head');
  // hair
  const hairCap = (scale = 1.07, thetaLen = Math.PI * 0.55) => { const g = new THREE.SphereGeometry(hs * scale, 20, 12, 0, Math.PI * 2, 0, thetaLen); g.scale(0.9, 1.14, 1.02); g.rotateX(-0.25); g.translate(headC.x, headC.y + hs * 0.02, headC.z - hs * 0.04); return g; };
  if (p.hairStyle !== 'bald') {
    if (p.hairStyle === 'buzz') parts.add(hairCap(1.02, Math.PI * 0.5), MAT.hair, p.hair, 'head');
    else if (p.hairStyle === 'mohawk') { const m = new THREE.BoxGeometry(0.04 * s, 0.09 * s, hs * 2); m.translate(headC.x, headC.y + hs * 1.08, headC.z - hs * 0.1); parts.add(m, MAT.hair, p.hair, 'head'); parts.add(hairCap(1.01, Math.PI * 0.45), MAT.hair, new THREE.Color(p.hair).multiplyScalar(0.6).getHex(), 'head'); }
    else {
      parts.add(hairCap(), MAT.hair, p.hair, 'head');
      if (p.hairStyle === 'long') { const back = new THREE.SphereGeometry(hs * 1.0, 14, 10); back.scale(0.95, 1.5, 0.55); back.translate(headC.x, headC.y - hs * 0.55, headC.z - hs * 0.55); parts.add(back, MAT.hair, p.hair, (v) => v.y < J.neck[1] + 0.02 ? [['chest', 0.5], ['head', 0.5]] : [['head', 1]]); }
      if (p.hairStyle === 'ponytail') { const tail = chainTube([V([headC.x, headC.y + hs * 0.3, headC.z - hs * 1.0]), V([headC.x, headC.y - hs * 0.4, headC.z - hs * 1.25]), V([headC.x, headC.y - hs * 1.3, headC.z - hs * 1.15])], [0.035 * s, 0.03 * s, 0.012 * s], 8, 3); parts.add(tail, MAT.hair, p.hair, 'head'); }
      if (p.hairStyle === 'bun') { const bun = new THREE.SphereGeometry(hs * 0.38, 10, 8); bun.translate(headC.x, headC.y + hs * 0.8, headC.z - hs * 0.7); parts.add(bun, MAT.hair, p.hair, 'head'); }
      if (p.hairStyle === 'short') { const fringe = new THREE.SphereGeometry(hs * 1.06, 14, 6, -Math.PI * 0.35, Math.PI * 0.7, Math.PI * 0.18, Math.PI * 0.2); fringe.translate(headC.x, headC.y + hs * 0.05, headC.z); parts.add(fringe, MAT.hair, p.hair, 'head'); }
    }
  }
  if (p.beard) { const beard = new THREE.SphereGeometry(hs * 0.9, 14, 8, Math.PI * 0.1, Math.PI * 0.8, Math.PI * 0.55, Math.PI * 0.4); beard.scale(0.85, 1, 1.05); beard.translate(headC.x, headC.y - hs * 0.05, headC.z + hs * 0.05); parts.add(beard, MAT.hair, p.hair, 'head'); }

  // --- Arms & hands
  for (const sd of ['L', 'R']) {
    const sh = V(J['upperArm_' + sd]), el = V(J['lowerArm_' + sd]), wr = V(J['hand_' + sd]);
    const shoulderTop = sh.clone().add(new THREE.Vector3(0, 0.03 * s, 0));
    const arm = chainTube([shoulderTop, el, wr], [(0.066 + b * 0.014) * s, (0.05 + b * 0.01) * s, 0.037 * s], 10, 7, 0.9);
    const sleeve = p.outfit === 'casual' ? 0.45 : p.outfit === 'skin' ? -1 : 1.05; // fraction of arm covered by sleeve
    const armLen = shoulderTop.distanceTo(el) + el.distanceTo(wr);
    const armColor = (v) => (shoulderTop.distanceTo(v) / armLen < sleeve ? (p.outfit === 'armor' ? 0x3a3a40 : clothTop) : p.skin);
    const w = limbWeights(shoulderTop, el, 'upperArm_' + sd, 'lowerArm_' + sd, 0.05 * s, 'hand_' + sd, wr);
    const withShoulder = (v) => { const out = w(v); if (v.y > sh.y - 0.02 * s) { const t = THREE.MathUtils.clamp((v.y - sh.y + 0.02 * s) / (0.05 * s), 0, 0.5); out[0][1] *= 1 - t; out.push(['shoulder_' + sd, t]); } return out; };
    parts.add(arm, MAT.cloth, armColor, withShoulder);
    // deltoid
    const delt = new THREE.SphereGeometry((0.068 + b * 0.012) * s, 10, 8); delt.scale(1, 1.05, 1.05); delt.translate(sh.x * 0.97, sh.y - 0.01 * s, sh.z);
    parts.add(delt, MAT.cloth, p.outfit === 'skin' ? p.skin : clothTop, () => [['upperArm_' + sd, 0.6], ['shoulder_' + sd, 0.4]]);
    // hand: palm + fingers block + thumb
    const dir = new THREE.Vector3().subVectors(wr, el).normalize();
    const palm = new THREE.BoxGeometry(0.03 * s, 0.085 * s, 0.075 * s, 1, 2, 1);
    palm.translate(0, -0.045 * s, 0.005 * s);
    const thumb = new THREE.CapsuleGeometry(0.012 * s, 0.03 * s, 2, 6); thumb.rotateX(-0.6); thumb.translate(0, -0.035 * s, 0.045 * s);
    const handGeo = mergeGeometries([palm.toNonIndexed(), thumb.toNonIndexed()].map((g) => { for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k); return g; }));
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
    handGeo.applyQuaternion(q); handGeo.translate(wr.x, wr.y, wr.z);
    parts.add(handGeo, MAT.skin, p.outfit === 'armor' ? 0x2a2a2e : p.skin, 'hand_' + sd);
    if (p.armor) {
      const pad = new THREE.SphereGeometry(0.09 * s, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55); pad.scale(1.1, 0.8, 1.1); pad.rotateZ(sd === 'L' ? -0.5 : 0.5); pad.translate(sh.x * 1.02, sh.y + 0.02 * s, sh.z);
      parts.add(pad, MAT.metal, p.accent, () => [['shoulder_' + sd, 0.5], ['upperArm_' + sd, 0.5]]);
      const bracer = chainTube([el.clone().lerp(wr, 0.25), el.clone().lerp(wr, 0.85)], [0.046 * s, 0.04 * s], 10, 2); parts.add(bracer, MAT.metal, 0x8a8a92, 'lowerArm_' + sd);
    }
  }

  // --- Legs & feet
  for (const sd of ['L', 'R']) {
    const hip = V(J['upperLeg_' + sd]), kn = V(J['lowerLeg_' + sd]), an = V(J['foot_' + sd]);
    const top = hip.clone().add(new THREE.Vector3(0, 0.02 * s, 0));
    const leg = chainTube([top, kn, an.clone().add(new THREE.Vector3(0, 0.02 * s, 0))], [(0.092 + b * 0.022) * s, (0.066 + b * 0.01) * s, 0.048 * s], 10, 8, 0.95);
    const w = limbWeights(top, kn, 'upperLeg_' + sd, 'lowerLeg_' + sd, 0.06 * s, 'foot_' + sd, an);
    const legColor = p.outfit === 'skin' ? p.skin : p.outfit === 'casual' && p.shorts ? (v) => (v.y > kn.y + 0.06 * s ? clothBottom : p.skin) : clothBottom;
    parts.add(leg, MAT.cloth, legColor, (v) => { const out = w(v); if (v.y > hip.y - 0.04 * s) { const t = THREE.MathUtils.clamp((v.y - hip.y + 0.04 * s) / (0.08 * s), 0, 0.45); out[0][1] *= 1 - t; out.push(['hips', t]); } return out; });
    // shoe
    const shoe = new THREE.CapsuleGeometry(0.048 * s, 0.13 * s, 4, 10); shoe.rotateX(Math.PI / 2); shoe.scale(1, 0.75, 1);
    { const pos = shoe.attributes.position; for (let i = 0; i < pos.count; i++) if (pos.getY(i) < -0.01 * s) pos.setY(i, -0.01 * s - (pos.getY(i) + 0.01 * s) * 0.2); shoe.computeVertexNormals(); }
    shoe.translate(an.x, 0.045 * s, an.z + 0.055 * s);
    parts.add(shoe, MAT.cloth, p.shoes, 'foot_' + sd);
    if (p.armor) { const greave = chainTube([kn.clone().lerp(an, 0.1), kn.clone().lerp(an, 0.8)], [0.062 * s, 0.052 * s], 10, 2, 1.05); parts.add(greave, MAT.metal, 0x8a8a92, 'lowerLeg_' + sd); }
  }

  // --- Outfit extras
  if (p.outfit === 'robe' || p.coat) {
    // flared skirt/coat from waist to knees; weighted to hips + legs by side
    const sk = []; const keys = [[1.02, 0.17, 0.13], [0.86, 0.2, 0.16], [0.62, 0.25, 0.2], [p.outfit === 'robe' ? 0.2 : 0.5, 0.29, 0.24]];
    const geo = new THREE.BufferGeometry(), N = 18, idx = [];
    for (const [y, hw, hd] of keys) for (let j = 0; j < N; j++) { const a = (j / N) * Math.PI * 2; sk.push(Math.cos(a) * hw * p.hips * s, y * s, Math.sin(a) * hd * s); }
    for (let i = 0; i < keys.length - 1; i++) for (let j = 0; j < N; j++) { const a0 = i * N + j, a1 = i * N + ((j + 1) % N); idx.push(a0, a0 + N, a1, a1, a0 + N, a1 + N); }
    geo.setAttribute('position', new THREE.Float32BufferAttribute(sk, 3)); geo.setIndex(idx); geo.computeVertexNormals();
    parts.add(geo, MAT.cloth, (v) => (v.y / s < 0.3 && p.outfit === 'robe' ? p.accent : clothTop), (v) => {
      const y = v.y / s, t = THREE.MathUtils.clamp((0.95 - y) / 0.5, 0, 1) * 0.7, side = v.x >= 0 ? 'upperLeg_L' : 'upperLeg_R';
      return [['hips', 1 - t * Math.min(1, Math.abs(v.x) / (0.1 * s))], [side, t * Math.min(1, Math.abs(v.x) / (0.1 * s))]];
    });
  }
  if (p.armor) {
    const plate = new THREE.SphereGeometry(0.2 * s, 16, 10, 0, Math.PI * 2, Math.PI * 0.2, Math.PI * 0.55); plate.scale(0.95 * p.shoulders, 1.0, 0.72); plate.translate(0, 1.27 * s, 0.0);
    parts.add(plate, MAT.metal, (v) => (Math.abs(v.x) < 0.015 * s ? p.accent : 0x9a9aa4), (v) => (v.y > 1.2 * s ? [['chest', 1]] : [['spine', 0.6], ['chest', 0.4]]));
    const belt = chainTube([new THREE.Vector3(0, 1.0 * s, 0), new THREE.Vector3(0, 1.06 * s, 0)], [0.168 * p.hips * s, 0.162 * s], 16, 1); belt.scale(1, 1, 0.78);
    parts.add(belt, MAT.metal, 0x5a3a20, 'hips');
  }
  if (p.helmet) { const h = hairCap(1.16, Math.PI * 0.6); parts.add(h, MAT.metal, 0x8a8a92, 'head'); const crest = new THREE.BoxGeometry(0.02 * s, 0.07 * s, hs * 1.6); crest.translate(headC.x, headC.y + hs * 1.2, headC.z - hs * 0.15); parts.add(crest, MAT.cloth, p.accent, 'head'); }
  if (p.cape) {
    const W = 0.36 * s * p.shoulders, top = 1.44 * s, bot = 0.35 * s, cols = 8, rowsN = 10, pos = [], idx = [];
    for (let r = 0; r <= rowsN; r++) for (let c = 0; c <= cols; c++) { const u = c / cols - 0.5, t = r / rowsN; pos.push(u * W * (1 + t * 0.5), top - (top - bot) * t, -0.13 * s - t * 0.12 * s - Math.cos(u * Math.PI) * 0.03 * s); }
    for (let r = 0; r < rowsN; r++) for (let c = 0; c < cols; c++) { const a = r * (cols + 1) + c, bq = a + 1, cq = a + cols + 1, d = cq + 1; idx.push(a, bq, cq, bq, d, cq, a, cq, bq, bq, cq, d); }
    const cape = new THREE.BufferGeometry(); cape.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); cape.setIndex(idx); cape.computeVertexNormals();
    parts.add(cape, MAT.cloth, p.capeColor ?? p.accent, (v) => { const t = THREE.MathUtils.clamp((top - v.y) / (top - bot), 0, 1); return [['chest', 1 - t * 0.7], ['hips', t * 0.7]]; });
  }

  // --- assemble
  const geos = [], groups = [];
  let start = 0;
  const merged = [];
  for (let m = 0; m < 5; m++) {
    if (!parts.lists[m].length) continue;
    const g = mergeGeometries(parts.lists[m]);
    merged.push([m, g]);
  }
  for (const [m, g] of merged) { geos.push(g); groups.push({ start, count: g.attributes.position.count, materialIndex: m }); start += g.attributes.position.count; }
  const geometry = mergeGeometries(geos);
  geometry.clearGroups(); for (const gr of groups) geometry.addGroup(gr.start, gr.count, gr.materialIndex);
  geometry.computeBoundingSphere();
  const fab = textureSet('fabric', { color: 0xffffff, weave: 128, size: 128 });
  const skinTex = textureSet('skin', { color: 0xffffff, color2: 0xf4f0f0, size: 128 });
  const materials = [
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, normalMap: skinTex.normalMap, normalScale: new THREE.Vector2(0.25, 0.25) }),
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, normalMap: fab.normalMap, normalScale: new THREE.Vector2(0.5, 0.5) }),
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.05 }),
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.85 }),
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.15 }),
  ];
  // auto UVs for detail maps: cylindrical around the body
  { const pos = geometry.attributes.position, uv = geometry.attributes.uv; for (let i = 0; i < pos.count; i++) uv.setXY(i, Math.atan2(pos.getX(i), pos.getZ(i)) * 2, pos.getY(i) * 6); }
  const mesh = new THREE.SkinnedMesh(geometry, materials);
  mesh.name = 'humanoid'; mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
  const skeleton = new THREE.Skeleton(boneList);
  const root = new THREE.Group(); root.name = 'character';
  root.add(bones.root); root.add(mesh);
  root.updateMatrixWorld(true);
  mesh.bind(skeleton);
  // attachment sockets
  const sockets = {};
  for (const [name, bone, off, rot] of [['hand_R', 'hand_R', [0, -0.07 * s, 0.02 * s], [Math.PI / 2, 0, 0]], ['hand_L', 'hand_L', [0, -0.07 * s, 0.02 * s], [Math.PI / 2, 0, 0]], ['back', 'chest', [0, 0.05 * s, -0.16 * s], [0, 0, 0.6]], ['head', 'head', [0, 0.2 * s, 0], [0, 0, 0]]]) {
    const o = new THREE.Object3D(); o.name = 'socket_' + name; o.position.set(...off); o.rotation.set(...rot); bones[bone].add(o); sockets[name] = o;
  }
  root.userData = { kind: 'humanoid', params: p, bones, skeleton, mesh, sockets, height: p.height, collider: { type: 'capsule', radius: 0.32 * s, height: p.height } };
  return root;
}

// Attach a prop (e.g. sword) to a socket.
export function attach(character, socket, object) {
  const s = character.userData.sockets[socket]; if (!s) throw new Error('no socket ' + socket);
  s.add(object); return object;
}
