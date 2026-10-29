// GameForge realistic human system (separate entry so games that don't use humans don't
// ship the 6 MB dataset). import * as Humans from './engine/humans.js'
import * as THREE from './vendor/three/three.module.js';
import { loadHumanData } from './character/human-data.js';
import { buildHuman, defaultHumanParams, EXPRESSIONS, VISEMES, listModifiers, SKIN_TONES } from './character/human.js';
import { applySkin, computeSkinMasks } from './character/skin.js';
import { addHair, addBeard, HAIR_STYLES } from './character/hair.js';
import { dress, OUTFITS, GARMENTS } from './character/clothing.js';
import { clone as cloneSkinned } from './vendor/three/addons/utils/SkeletonUtils.js';
import { decimate } from './geometry/decimate.js';
import { Retargeter, clipFromBVH, clipFromBVHCanonical, parseBVH, fingerCurl, BVH_NAME_MAPS } from './animation/retarget.js';
export { decimate } from './geometry/decimate.js';
export { loadHumanData, buildHuman, defaultHumanParams, EXPRESSIONS, VISEMES, listModifiers, SKIN_TONES, applySkin, addHair, addBeard, HAIR_STYLES, dress, OUTFITS, GARMENTS, Retargeter, clipFromBVH, clipFromBVHCanonical, parseBVH, fingerCurl, BVH_NAME_MAPS };
export { ARCHETYPES, createCharacter, characterFromSpec, lookToHumanSpec } from './character/archetypes.js';

/** One call: data + body + skin + hair + clothes + retargeter. */
export async function createRealisticHuman(spec = {}) {
  const data = await loadHumanData();
  return assembleHuman(data, spec);
}
/**
 * spec.lod = 'crowd' is the performance path for many background people: 256 px skin bake,
 * hidden underwear skipped, all garments merged into one vertex-coloured skinned mesh (one draw
 * call instead of ~7), teeth/tongue groups and facial morph targets dropped. Override with
 * spec.textureSize / spec.mergeGarments / spec.keepFace. Instance a crowd template with
 * cloneHuman() (shares geometry, materials and baked animation clips).
 */
export function assembleHuman(data, spec = {}) {
  const crowd = spec.lod === 'crowd';
  const h = buildHuman(data, spec);
  const api = h.userData;
  api.lod = crowd ? 'crowd' : 'full';
  api.skinMasks = computeSkinMasks(api.mesh.geometry, api.bones, api.params);
  applySkin(h, { size: spec.textureSize ?? (crowd ? 256 : 1024), seed: spec.seed ?? 1 });
  if (spec.outfit !== null) {
    let items = Array.isArray(spec.outfit) ? spec.outfit : OUTFITS[spec.outfit ?? 'casual'] || OUTFITS.casual;
    if (crowd && items.some((it) => ['jeans', 'pants', 'shorts'].includes(it.type))) items = items.filter((it) => it.type !== 'underwear');
    dress(h, items);
  }
  if (spec.hair !== null) addHair(h, { soft: !crowd, ...(typeof spec.hair === 'string' ? { style: spec.hair, color: spec.hairColor } : { color: spec.hairColor, ...(spec.hair || {}) }) });
  if (spec.beard) addBeard(h, typeof spec.beard === 'string' ? { style: spec.beard, color: spec.hairColor } : spec.beard);
  if (spec.mergeGarments ?? crowd) mergeGarments(h);
  if (crowd && !spec.keepFace) {
    const g = api.mesh.geometry, body = g.groups[0];
    g.clearGroups(); g.addGroup(body.start, body.count, 0); // skin only: mouth interior is never seen in a crowd
    g.morphAttributes = {}; api.mesh.morphTargetInfluences = undefined; api.mesh.morphTargetDictionary = undefined; api.mesh.updateMorphTargets?.();
    api.face = null;
  }
  if (spec.decimate) decimateHuman(h, spec.decimate);
  api.retargeter = new Retargeter(api.bones);
  return h;
}

/**
 * LOD: simplify the body and garment meshes of a human to `ratio` of their triangles (quadric
 * half-edge collapse: UV seams, borders, skin weights and face morphs stay intact). Hair cards and
 * eyes are left alone. Typical: 0.5 at 15–30 m, 0.25 beyond 30 m (pair with lod:'crowd').
 * Returns { from, to } triangle counts.
 */
export function decimateHuman(human, ratio = 0.4) {
  const api = human.userData; let from = 0, to = 0;
  let garments = [...(api.garments || []).filter((m) => m.parent === human), ...human.children.filter((c) => c.isSkinnedMesh && c.name === 'garments:merged')];
  // underwear is fully covered once there are trousers: drop it instead of fighting poke-through
  if (garments.some((g) => /garment:(jeans|pants|shorts|dress|robe)/.test(g.name))) for (const g of garments.filter((g) => g.name === 'garment:underwear')) { human.remove(g); g.geometry.dispose(); }
  garments = garments.filter((g) => g.parent === human);
  // decimated surfaces sink by roughly the chord sagitta; push each layer out a little more than the one below
  const inflate = Math.min(0.006, 0.0015 * (1 / Math.max(0.05, ratio) - 1));
  for (const m of new Set([api.mesh, ...garments])) {
    if (!m?.isMesh || !m.geometry.index) continue;
    const g = decimate(m.geometry, { ratio }); from += g.userData.decimate.from; to += g.userData.decimate.to;
    if (m !== api.mesh && inflate > 0) {
      const P = g.attributes.position, N = g.attributes.normal, d = inflate * (1 + (m.userData.layer ?? 1) * 0.5);
      const arr = P.array.slice(); for (let i = 0; i < P.count; i++) { arr[i * 3] += N.getX(i) * d; arr[i * 3 + 1] += N.getY(i) * d; arr[i * 3 + 2] += N.getZ(i) * d; }
      g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    }
    m.geometry.dispose(); m.geometry = g;
  }
  api.decimated = { ratio, from, to };
  return api.decimated;
}

/** Merge every garment SkinnedMesh of a human into one vertex-coloured mesh (1 draw call). */
export function mergeGarments(human, { layerOffset = 0.0012, roughness = 0.85 } = {}) {
  const api = human.userData, list = (api.garments || []).filter((m) => m.isSkinnedMesh && m.parent === human);
  if (list.length < 2) return null;
  const pos = [], nor = [], col = [], si = [], sw = [], idx = []; let base = 0;
  const c = new THREE.Color();
  for (const m of list) {
    const g = m.geometry, P = g.attributes.position, N = g.attributes.normal, SI = g.attributes.skinIndex, SW = g.attributes.skinWeight, n = P.count;
    const colors = m.userData.colors || [Array.isArray(m.material) ? m.material[0].color.getHex() : m.material.color.getHex()];
    const vcol = new Array(n).fill(0);
    const I = g.index ? g.index.array : Array.from({ length: n }, (_, i) => i);
    for (const gr of g.groups.length ? g.groups : [{ start: 0, count: I.length, materialIndex: 0 }]) for (let k = gr.start; k < gr.start + gr.count; k++) vcol[I[k]] = gr.materialIndex;
    const off = (m.userData.layer ?? m.renderOrder ?? 0) * layerOffset; // replaces per-layer polygonOffset
    for (let i = 0; i < n; i++) {
      pos.push(P.getX(i) + N.getX(i) * off, P.getY(i) + N.getY(i) * off, P.getZ(i) + N.getZ(i) * off); nor.push(N.getX(i), N.getY(i), N.getZ(i));
      c.set(colors[vcol[i]] ?? colors[0]); col.push(c.r, c.g, c.b);
      for (let k = 0; k < 4; k++) { si.push(SI.getComponent(i, k)); sw.push(SW.getComponent(i, k)); }
    }
    for (let k = 0; k < I.length; k++) idx.push(I[k] + base);
    base += n;
    human.remove(m); g.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4)); geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  geo.setIndex(idx); geo.computeBoundingSphere();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness, metalness: 0 }); mat.name = 'gf:garments-merged';
  const mesh = new THREE.SkinnedMesh(geo, mat); mesh.name = 'garments:merged'; mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
  human.add(mesh); mesh.bind(api.skeleton, api.mesh.bindMatrix);
  api.garments = [mesh];
  return mesh;
}

/**
 * Cheap instance of an assembled human: shares geometry, materials (skin bake) and the
 * template's retargeter (clips baked once by bone name play on every clone). Only the skeleton
 * is duplicated. Keep the template itself un-animated (it is the bind-pose source).
 */
export function cloneHuman(template) {
  const saved = new Map();
  template.traverse((o) => { saved.set(o, o.userData); o.userData = {}; }); // Object3D.copy JSON-clones userData
  let c; try { c = cloneSkinned(template); } finally { for (const [o, u] of saved) o.userData = u; }
  const map = new Map(); const walk = (a, b) => { map.set(a, b); for (let i = 0; i < a.children.length; i++) walk(a.children[i], b.children[i]); }; walk(template, c);
  for (const [a, b] of map) if (a !== template) b.userData = a.isBone ? a.userData : { ...a.userData };
  const api = template.userData, bones = {};
  for (const [n, b] of Object.entries(api.bones)) bones[n] = map.get(b);
  const sockets = {}; for (const [n, s] of Object.entries(api.sockets || {})) sockets[n] = map.get(s);
  const mesh = map.get(api.mesh);
  c.userData = { ...api, mesh, skeleton: mesh.skeleton, bones, sockets, garments: (api.garments || []).map((g) => map.get(g)).filter(Boolean), face: null, template, isClone: true };
  return c;
}
export { THREE };
