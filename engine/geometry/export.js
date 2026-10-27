// Dependency-free exporters for procedural assets: binary glTF 2.0 (.glb) and Wavefront OBJ.
// Runs in Node and browsers. Exports static meshes with per-mesh base colour/PBR factors.
import * as THREE from '../vendor/three/three.module.js';

function collect(root) {
  const meshes = [];
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const geo = o.geometry.clone();
    if (o.isSkinnedMesh) { /* export bind pose */ }
    if (o.isInstancedMesh) {
      for (let i = 0; i < o.count; i++) { const m = new THREE.Matrix4(); o.getMatrixAt(i, m); const g = geo.clone().applyMatrix4(m).applyMatrix4(o.matrixWorld); meshes.push({ geo: g, mat: mats[0], name: o.name + '_' + i }); }
      return;
    }
    geo.applyMatrix4(o.matrixWorld);
    if (geo.groups.length > 1 && mats.length > 1) {
      for (const gr of geo.groups) {
        const sub = new THREE.BufferGeometry();
        const ni = geo.index ? null : true;
        if (ni) { for (const k of ['position', 'normal', 'uv', 'color']) if (geo.attributes[k]) { const a = geo.attributes[k]; sub.setAttribute(k, new THREE.BufferAttribute(a.array.slice(gr.start * a.itemSize, (gr.start + gr.count) * a.itemSize), a.itemSize)); } }
        else { const idx = geo.index.array.slice(gr.start, gr.start + gr.count); for (const k of ['position', 'normal', 'uv', 'color']) if (geo.attributes[k]) sub.setAttribute(k, geo.attributes[k]); sub.setIndex(Array.from(idx)); }
        meshes.push({ geo: sub, mat: mats[gr.materialIndex] || mats[0], name: o.name });
      }
    } else meshes.push({ geo, mat: mats[0], name: o.name });
  });
  return meshes;
}

export function exportGLB(root) {
  const meshes = collect(root);
  const json = { asset: { version: '2.0', generator: 'GameForge AAA' }, scene: 0, scenes: [{ nodes: [] }], nodes: [], meshes: [], materials: [], accessors: [], bufferViews: [], buffers: [] };
  const chunks = []; let offset = 0;
  const addView = (arr, target) => {
    const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
    const pad = (4 - (bytes.length % 4)) % 4;
    chunks.push(bytes); if (pad) chunks.push(new Uint8Array(pad));
    json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, ...(target ? { target } : {}) });
    offset += bytes.length + pad; return json.bufferViews.length - 1;
  };
  const matIndex = new Map();
  for (const { geo, mat, name } of meshes) {
    const pos = geo.attributes.position; const n = pos.count;
    const P = new Float32Array(n * 3); for (let i = 0; i < n; i++) { P[i * 3] = pos.getX(i); P[i * 3 + 1] = pos.getY(i); P[i * 3 + 2] = pos.getZ(i); }
    let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], P[i * 3 + k]); max[k] = Math.max(max[k], P[i * 3 + k]); }
    const attrs = {};
    json.accessors.push({ bufferView: addView(P, 34962), componentType: 5126, count: n, type: 'VEC3', min, max }); attrs.POSITION = json.accessors.length - 1;
    if (!geo.attributes.normal) geo.computeVertexNormals();
    const nor = geo.attributes.normal, N = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const v = new THREE.Vector3(nor.getX(i), nor.getY(i), nor.getZ(i)).normalize(); N[i * 3] = v.x || 0; N[i * 3 + 1] = Number.isFinite(v.y) ? v.y : 1; N[i * 3 + 2] = v.z || 0; }
    json.accessors.push({ bufferView: addView(N, 34962), componentType: 5126, count: n, type: 'VEC3' }); attrs.NORMAL = json.accessors.length - 1;
    if (geo.attributes.uv) { const u = geo.attributes.uv, U = new Float32Array(n * 2); for (let i = 0; i < n; i++) { U[i * 2] = u.getX(i); U[i * 2 + 1] = 1 - u.getY(i); } json.accessors.push({ bufferView: addView(U, 34962), componentType: 5126, count: n, type: 'VEC2' }); attrs.TEXCOORD_0 = json.accessors.length - 1; }
    if (geo.attributes.color) { const c = geo.attributes.color, C = new Float32Array(n * 3); for (let i = 0; i < n; i++) { C[i * 3] = c.getX(i); C[i * 3 + 1] = c.getY(i); C[i * 3 + 2] = c.getZ(i); } json.accessors.push({ bufferView: addView(C, 34962), componentType: 5126, count: n, type: 'VEC3' }); attrs.COLOR_0 = json.accessors.length - 1; }
    const prim = { attributes: attrs, mode: 4 };
    if (geo.index) { const I = new Uint32Array(geo.index.array); json.accessors.push({ bufferView: addView(I, 34963), componentType: 5125, count: I.length, type: 'SCALAR' }); prim.indices = json.accessors.length - 1; }
    if (!matIndex.has(mat)) {
      const c = mat?.color || new THREE.Color(1, 1, 1), e = mat?.emissive || new THREE.Color(0, 0, 0), ei = mat?.emissiveIntensity ?? 1;
      json.materials.push({ name: mat?.name || 'material', pbrMetallicRoughness: { baseColorFactor: [c.r, c.g, c.b, mat?.opacity ?? 1], metallicFactor: mat?.metalness ?? 0, roughnessFactor: mat?.roughness ?? 1 }, emissiveFactor: [Math.min(1, e.r * ei), Math.min(1, e.g * ei), Math.min(1, e.b * ei)], ...(mat?.transparent ? { alphaMode: 'BLEND' } : {}), doubleSided: mat?.side === THREE.DoubleSide });
      matIndex.set(mat, json.materials.length - 1);
    }
    prim.material = matIndex.get(mat);
    json.meshes.push({ name, primitives: [prim] });
    json.nodes.push({ mesh: json.meshes.length - 1, name });
    json.scenes[0].nodes.push(json.nodes.length - 1);
  }
  json.buffers.push({ byteLength: offset });
  const bin = new Uint8Array(offset); let o = 0; for (const c of chunks) { bin.set(c, o); o += c.length; }
  let jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jpad = (4 - (jsonBytes.length % 4)) % 4; if (jpad) { const t = new Uint8Array(jsonBytes.length + jpad); t.set(jsonBytes); t.fill(0x20, jsonBytes.length); jsonBytes = t; }
  const total = 12 + 8 + jsonBytes.length + 8 + bin.length;
  const out = new Uint8Array(total), dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, jsonBytes.length, true); dv.setUint32(16, 0x4e4f534a, true); out.set(jsonBytes, 20);
  const b = 20 + jsonBytes.length; dv.setUint32(b, bin.length, true); dv.setUint32(b + 4, 0x004e4942, true); out.set(bin, b + 8);
  return out;
}

export function parseGLBHeader(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('not a GLB');
  const jsonLen = dv.getUint32(12, true);
  return { version: dv.getUint32(4, true), length: dv.getUint32(8, true), json: JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLen))) };
}

export function exportOBJ(root) {
  const lines = ['# GameForge AAA OBJ export']; let base = 1;
  for (const { geo, name } of collect(root)) {
    lines.push('o ' + (name || 'mesh'));
    const p = geo.attributes.position, nrm = geo.attributes.normal, uv = geo.attributes.uv;
    for (let i = 0; i < p.count; i++) lines.push(`v ${p.getX(i).toFixed(5)} ${p.getY(i).toFixed(5)} ${p.getZ(i).toFixed(5)}`);
    if (uv) for (let i = 0; i < p.count; i++) lines.push(`vt ${uv.getX(i).toFixed(5)} ${uv.getY(i).toFixed(5)}`);
    if (nrm) for (let i = 0; i < p.count; i++) lines.push(`vn ${nrm.getX(i).toFixed(4)} ${nrm.getY(i).toFixed(4)} ${nrm.getZ(i).toFixed(4)}`);
    const idx = geo.index ? geo.index.array : Array.from({ length: p.count }, (_, i) => i);
    const f = (i) => { const k = i + base; return uv && nrm ? `${k}/${k}/${k}` : nrm ? `${k}//${k}` : `${k}`; };
    for (let t = 0; t < idx.length; t += 3) lines.push(`f ${f(idx[t])} ${f(idx[t + 1])} ${f(idx[t + 2])}`);
    base += p.count;
  }
  return lines.join('\n') + '\n';
}
