#!/usr/bin/env node
// Compiles MakeHuman's CC0 assets (base mesh hm08, morph targets, default rig + weights,
// high-poly eye proxy, expression units, BVH poses) into one gzip-compressed binary that the
// GameForge runtime loads offline: engine/assets/human/human-data.js (base64 module).
// Only DATA is used; no MakeHuman (AGPL) code is copied. Usage:
//   node tools/assets/compile-human.mjs <makehuman/data dir> [--out engine/assets/human]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const SRC = path.resolve(process.argv[2] || 'makehuman/data');
const OUT = path.resolve(process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : 'engine/assets/human');
const KEEP_GROUPS = ['body', 'helper-skirt', 'helper-tights', 'helper-upper-teeth', 'helper-lower-teeth', 'helper-tongue', 'helper-hair', 'helper-l-eyelashes-1', 'helper-l-eyelashes-2', 'helper-r-eyelashes-1', 'helper-r-eyelashes-2'];

// ---------- OBJ ----------
function parseOBJ(file) {
  const v = [], vt = [], faces = []; let group = 'default';
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const p = line.trim().split(/\s+/);
    if (p[0] === 'v') v.push([+p[1], +p[2], +p[3]]);
    else if (p[0] === 'vt') vt.push([+p[1], +p[2]]);
    else if (p[0] === 'g') group = p[1];
    else if (p[0] === 'f') faces.push({ group, idx: p.slice(1).map((s) => { const [a, b] = s.split('/'); return [+a - 1, b ? +b - 1 : -1]; }) });
  }
  return { v, vt, faces };
}
// ---------- targets ----------
function parseTarget(file) {
  const out = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line || line[0] === '#') continue;
    const p = line.trim().split(/\s+/); if (p.length < 4) continue;
    out.push([+p[0], +p[1], +p[2], +p[3]]);
  }
  return out;
}
function listTargets(dir, filter = () => true) {
  const res = [];
  const walk = (d) => { if (!fs.existsSync(d)) return; for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (e.name !== 'images') walk(p); } else if (e.name.endsWith('.target') && filter(p)) res.push(p); } };
  walk(dir); return res;
}
// ---------- mhclo (proxy fitting) ----------
function parseMHCLO(file) {
  const r = { refs: [], scales: {} }; let inVerts = false;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const p = line.trim().split(/\s+/);
    if (!p[0] || p[0].startsWith('#')) continue;
    if (/^[xyz]_scale$/.test(p[0])) r.scales[p[0][0]] = [+p[1], +p[2], +p[3]];
    else if (p[0] === 'obj_file') r.obj = p[1];
    else if (p[0] === 'verts') inVerts = true;
    else if (inVerts && /^\d/.test(p[0])) {
      if (p.length === 1) r.refs.push([+p[0], +p[0], +p[0], 1, 0, 0, 0, 0, 0]);
      else if (p.length >= 9) r.refs.push(p.slice(0, 9).map(Number));
      else inVerts = false;
    } else if (inVerts) inVerts = false;
  }
  return r;
}

// ---------- build ----------
const obj = parseOBJ(path.join(SRC, '3dobjs/base.obj'));
console.log(`base.obj: ${obj.v.length} verts, ${obj.vt.length} uvs, ${obj.faces.length} faces`);
const keptFaces = obj.faces.filter((f) => KEEP_GROUPS.includes(f.group));
// render vertices = unique (v, vt) pairs
const key = new Map(), rv = [], ruv = [];
const groupTris = {};
for (const f of keptFaces) {
  const ids = f.idx.map(([vi, ti]) => { const k = vi * 65536 + (ti + 1); let id = key.get(k); if (id === undefined) { id = rv.length; key.set(k, id); rv.push(vi); ruv.push(ti >= 0 ? obj.vt[ti] : [0, 0]); } return id; });
  const tris = groupTris[f.group] ||= [];
  for (let i = 1; i < ids.length - 1; i++) tris.push(ids[0], ids[i], ids[i + 1]);
}
console.log(`render verts: ${rv.length}; groups: ${Object.entries(groupTris).map(([g, t]) => `${g}:${t.length / 3}`).join(' ')}`);

const meta = { version: 1, source: 'MakeHuman 1.x assets (CC0 1.0), base mesh hm08', units: 'decimeter', baseVerts: obj.v.length, renderVerts: rv.length, groups: [], targets: [], bones: [], joints: {}, planes: {}, eyes: null, poses: [] };
const chunks = []; let offset = 0;
const push = (typed) => { const buf = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength); const pad = (4 - (buf.length % 4)) % 4; chunks.push(buf); if (pad) chunks.push(Buffer.alloc(pad)); const o = offset; offset += buf.length + pad; return o; };

meta.basePositions = push(Float32Array.from(obj.v.flat()));
meta.renderToBase = push(Uint16Array.from(rv));
meta.uvs = push(Float32Array.from(ruv.flat()));
for (const [g, tris] of Object.entries(groupTris)) meta.groups.push({ name: g, offset: push(Uint16Array.from(tris)), count: tris.length });

// skeleton
const skel = JSON.parse(fs.readFileSync(path.join(SRC, 'rigs/default.mhskel'), 'utf8'));
const boneNames = Object.keys(skel.bones);
// order parents first
const ordered = []; const seen = new Set();
const visit = (n) => { if (seen.has(n)) return; const p = skel.bones[n].parent; if (p) visit(p); seen.add(n); ordered.push(n); };
for (const n of boneNames) visit(n);
for (const n of ordered) { const b = skel.bones[n]; meta.bones.push({ name: n, parent: b.parent, head: b.head, tail: b.tail, plane: b.rotation_plane }); }
for (const [j, verts] of Object.entries(skel.joints)) meta.joints[j] = verts;
meta.planes = skel.planes;
// weights -> per base vertex top 4
const W = JSON.parse(fs.readFileSync(path.join(SRC, 'rigs/default_weights.mhw'), 'utf8')).weights;
const per = Array.from({ length: obj.v.length }, () => []);
for (const [bone, list] of Object.entries(W)) { const bi = ordered.indexOf(bone); if (bi < 0) continue; for (const [vi, w] of list) if (vi < per.length) per[vi].push([bi, w]); }
const si = new Uint8Array(obj.v.length * 4), sw = new Uint8Array(obj.v.length * 4);
let unweighted = 0;
per.forEach((l, i) => { l.sort((a, b) => b[1] - a[1]); const top = l.slice(0, 4); const tot = top.reduce((s, x) => s + x[1], 0); if (!tot) unweighted++; top.forEach(([b, w], k) => { si[i * 4 + k] = b; sw[i * 4 + k] = Math.round((w / (tot || 1)) * 255); }); });
meta.skinIndex = push(si); meta.skinWeight = push(sw);
console.log(`skeleton: ${ordered.length} bones; vertices without weights: ${unweighted}`);

// targets
const tdir = path.join(SRC, 'targets');
const want = [
  // adults only; height/proportion variants only for average muscle+weight (the runtime
  // applies them as a separable factor), which keeps the shipped data small
  ...listTargets(path.join(tdir, 'macrodetails'), (p) => !/baby|child/.test(path.basename(p)) && (!/[\\/](height|proportions)[\\/]/.test(p) || /averagemuscle-averageweight/.test(p))),
  ...['nose', 'mouth', 'chin', 'cheek', 'eyes', 'head', 'ears', 'eyebrows', 'forehead', 'neck', 'torso', 'hip', 'stomach', 'bodyshapes', 'armslegs'].flatMap((d) => listTargets(path.join(tdir, d))),
  ...listTargets(path.join(tdir, 'breast'), (p) => /female-young-averagemuscle-averageweight|BreastSize|BreastFirmness/i.test(path.basename(p)) && !/baby|child|old/.test(path.basename(p))),
  ...listTargets(path.join(tdir, 'expression/units/caucasian')),
];
let tbytes = 0;
for (const f of want) {
  let t = parseTarget(f);
  const name = path.relative(tdir, f).replace(/\.target$/, '').split(path.sep).join('/');
  const macro = name.startsWith('macrodetails');
  // drop imperceptible deltas (< 0.05 mm) from detail targets
  if (!macro) t = t.filter(([, x, y, z]) => Math.abs(x) + Math.abs(y) + Math.abs(z) > 0.0005);
  if (!t.length) continue;
  t.sort((a, b) => a[0] - b[0]);
  let max = 0; for (const [, x, y, z] of t) max = Math.max(max, Math.abs(x), Math.abs(y), Math.abs(z));
  // 8-bit deltas when the quantization step stays below 0.25 mm, else 16-bit
  const bits = !macro && max / 127 < 0.0025 ? 8 : 16;
  const scale = (max / (bits === 8 ? 127 : 32767)) || 1e-6;
  const idx = Uint16Array.from(t.map((d) => d[0]));
  for (let i = idx.length - 1; i > 0; i--) idx[i] -= idx[i - 1]; // delta-coded indices (sorted)
  const d = bits === 8 ? new Int8Array(t.length * 3) : new Int16Array(t.length * 3);
  t.forEach(([, x, y, z], i) => { d[i * 3] = Math.round(x / scale); d[i * 3 + 1] = Math.round(y / scale); d[i * 3 + 2] = Math.round(z / scale); });
  meta.targets.push({ name, count: t.length, scale, bits, idx: push(idx), delta: push(d) });
  tbytes += idx.byteLength + d.byteLength;
}
console.log(`targets: ${meta.targets.length} (${(tbytes / 1e6).toFixed(2)} MB raw)`);

// eyes proxy
const mh = parseMHCLO(path.join(SRC, 'eyes/high-poly/high-poly.mhclo'));
const eo = parseOBJ(path.join(SRC, 'eyes/high-poly', mh.obj));
const ek = new Map(), erv = [], euv = [], etris = [];
for (const f of eo.faces) { const ids = f.idx.map(([vi, ti]) => { const k = vi * 65536 + (ti + 1); let id = ek.get(k); if (id === undefined) { id = erv.length; ek.set(k, id); erv.push(vi); euv.push(ti >= 0 ? eo.vt[ti] : [0, 0]); } return id; }); for (let i = 1; i < ids.length - 1; i++) etris.push(ids[0], ids[i], ids[i + 1]); }
meta.eyes = { verts: eo.v.length, renderVerts: erv.length, refs: push(Float32Array.from(mh.refs.flat())), scales: mh.scales, renderToProxy: push(Uint16Array.from(erv)), uvs: push(Float32Array.from(euv.flat())), tris: push(Uint16Array.from(etris)), triCount: etris.length, restPositions: push(Float32Array.from(eo.v.flat())) };
console.log(`eyes: ${eo.v.length} verts, ${etris.length / 3} tris, ${mh.refs.length} refs`);

// BVH poses/animations (raw text, parsed at runtime)
for (const f of [['tpose', 'poses/tpose.bvh'], ['walk', 'animations/walks/walk1.bvh'], ['dance', 'animations/walks/dance1.bvh'], ['zombieWalk', 'animations/zombie/zombieWalk1.bvh'], ['faceUnits', 'poseunits/face-poseunits.bvh']]) {
  const p = path.join(SRC, f[1]); if (!fs.existsSync(p)) continue;
  const txt = Buffer.from(fs.readFileSync(p, 'utf8'));
  meta.poses.push({ name: f[0], offset: push(new Uint8Array(txt)), length: txt.length });
}
const fu = path.join(SRC, 'poseunits/face-poseunits.json'); if (fs.existsSync(fu)) meta.faceUnits = JSON.parse(fs.readFileSync(fu, 'utf8'));

// ---------- write ----------
const metaBuf = Buffer.from(JSON.stringify(meta));
const head = Buffer.alloc(8); head.writeUInt32LE(0x31484647, 0); head.writeUInt32LE(metaBuf.length, 4);
const metaPad = Buffer.alloc((4 - ((8 + metaBuf.length) % 4)) % 4);
const bin = Buffer.concat([head, metaBuf, metaPad, ...chunks]);
const gz = zlib.gzipSync(bin, { level: 9 });
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'human-data.js'), `// GENERATED by tools/assets/compile-human.mjs — MakeHuman 1.x assets, CC0 1.0 (see LICENSE-CC0.md).\n// gzip(${bin.length} bytes) as base64.\nexport const HUMAN_DATA_GZ_B64 = '${gz.toString('base64')}';\n`);
fs.copyFileSync(path.join(SRC, '../../LICENSE.ASSETS.md'), path.join(OUT, 'LICENSE-CC0.md'));
console.log(`wrote ${path.join(OUT, 'human-data.js')}: raw ${(bin.length / 1e6).toFixed(2)} MB, gzip ${(gz.length / 1e6).toFixed(2)} MB, base64 ${(gz.length * 4 / 3 / 1e6).toFixed(2)} MB`);
