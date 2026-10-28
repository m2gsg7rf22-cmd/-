// GameForge Modeling Kit — everything an agent needs to author any 3D asset in code.
// A model script is a module:   export default function build(K, params) { ...; return object3D; }
// Run it with:   node tools/gameforge.mjs model path/to/thing.model.js   (renders + metrics + GLB)
// See skills/gameforge/references/modeling.md for the method (blockout → forms → detail → review).
import * as THREE from '../vendor/three/three.module.js';
import * as builders from '../geometry/builders.js';
import * as sdf from './sdf.js';
import * as branching from './branching.js';
import * as cardsMod from './cards.js';
import { pbr, solid, emissive, glass, carPaint, textureSet, applyWind, MaterialLibrary } from '../render/materials.js';
import { generateTexture, TEXTURE_KINDS } from '../render/textures.js';
import { RNG, Noise } from '../core/rng.js';
import { Heightfield, terrainMesh, terrainMaterial } from '../world/terrain.js';
import { populate, instanceProp, scatterPoints, grassField } from '../world/vegetation.js';
import { createWater } from '../world/water.js';
import { generateCity } from '../world/city.js';
import { PROPS } from '../geometry/props.js';
import { BUILDINGS } from '../geometry/buildings.js';
import { car, VEHICLE_TYPES } from '../geometry/vehicles.js';
import { generateTree, TREE_SPECIES } from '../geometry/trees.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

/** Mesh with sensible defaults (shadows on). */
function mesh(geo, mat, { name, cast = true, receive = true } = {}) { const m = new THREE.Mesh(geo, mat); if (name) m.name = name; m.castShadow = cast; m.receiveShadow = receive; return m; }

/** Mirror a geometry across X and merge with the original (bilateral symmetry). */
function mirrorMerge(geo) {
  const m = geo.clone(); m.scale(-1, 1, 1);
  const idx = m.index.array; for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; } // fix winding
  return builders.merge([geo, m]);
}

/** Tag an asset: kind, physics collider proxy, metadata. */
function finish(obj, { kind = 'prop', collider, name } = {}) {
  obj.name = name || kind; obj.userData.kind = kind;
  if (collider === 'auto' || collider === undefined) { const b = new THREE.Box3().setFromObject(obj), s = b.getSize(V()), c = b.getCenter(V()); obj.userData.collider = { type: 'box', size: s.toArray(), offset: c.toArray() }; }
  else if (collider) obj.userData.collider = collider;
  return obj;
}

/** Ground an object so its lowest point sits at y=0 and it is centred in XZ. */
function ground(obj) { obj.updateMatrixWorld(true); const b = new THREE.Box3().setFromObject(obj); const c = b.getCenter(V()); obj.position.x -= c.x; obj.position.z -= c.z; obj.position.y -= b.min.y; return obj; }

export const K = {
  THREE, V, mesh, mirrorMerge, finish, ground,
  // primitives & builders: loft, smoothLoft, lathe, tube, roundedBox, displace, boxUV, merge,
  // MeshBuilder, mat4, ellipseRing, superRing, profileRing, mergeByMaterial, validateGeometry, validateObject
  ...builders,
  sdf, branching, ...sdf, ...branching,
  paint: cardsMod.paint, cardTexture: cardsMod.cardTexture, cards: cardsMod.cards, cardStrip: cardsMod.cardStrip, cardMaterial: cardsMod.cardMaterial,
  // materials: pbr(kind, {color, repeat, normalScale, roughness}) with TEXTURE_KINDS, solid, emissive, glass, carPaint
  pbr, solid, emissive, glass, carPaint, textureSet, applyWind, MaterialLibrary, generateTexture, TEXTURE_KINDS,
  RNG, Noise,
  // scene composition (scene scripts reviewed with `gameforge scene`)
  world: { Heightfield, terrainMesh, terrainMaterial, populate, instanceProp, scatterPoints, grassField, createWater, generateCity },
  PROPS, BUILDINGS, car, VEHICLE_TYPES, generateTree, TREE_SPECIES,
};
export default K;
