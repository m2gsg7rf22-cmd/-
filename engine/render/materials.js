// Material library: turns procedural texture sets into cached three.js PBR materials,
// plus stylized helpers (vertex-color PBR, emissive, glass, car paint, toon outline,
// wind-animated foliage and grass, triplanar terrain blending).
import * as THREE from '../vendor/three/three.module.js';
import { generateTexture } from './textures.js';

const texCache = new Map();
const matCache = new Map();
// uWet / uSnowCover (0..1) are driven by render/weather.js; terrain reads them (wet darkening + sheen, snow cover).
export const SHARED_UNIFORMS = { uTime: { value: 0 }, uWind: { value: new THREE.Vector2(0.6, 0.3) }, uWet: { value: 0 }, uSnowCover: { value: 0 } };

export function setTextureSize(size) { MaterialLibrary.textureSize = size; }

function dataTex(data, size, srgb) {
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = MaterialLibrary.anisotropy;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

export function textureSet(kind, opts = {}) {
  const size = opts.size ?? MaterialLibrary.textureSize;
  const key = kind + ':' + JSON.stringify({ ...opts, size });
  if (texCache.has(key)) return texCache.get(key);
  const g = generateTexture(kind, { ...opts, size });
  const set = {
    map: dataTex(g.albedo, size, true),
    normalMap: dataTex(g.normal, size, false),
    orm: dataTex(g.orm, size, false),
    emissiveMap: g.emissive ? dataTex(g.emissive, size, true) : null,
    raw: g,
  };
  texCache.set(key, set);
  return set;
}

// opts: { repeat: [x, y] | number, color tint, normalScale, roughness/metalness multipliers, emissive, ... }
export function pbr(kind, opts = {}) {
  const { repeat = 1, normalScale = 1, tint, envMapIntensity = 1, emissiveIntensity = 1.5, physical = false, side, transparent, opacity, ...texOpts } = opts;
  const key = kind + JSON.stringify(opts);
  if (matCache.has(key)) return matCache.get(key);
  const set = textureSet(kind, texOpts);
  const rep = Array.isArray(repeat) ? repeat : [repeat, repeat];
  const clone = (t) => { if (!t) return null; if (rep[0] === 1 && rep[1] === 1) return t; const c = t.clone(); c.repeat.set(rep[0], rep[1]); c.needsUpdate = true; return c; };
  const params = {
    map: clone(set.map), normalMap: clone(set.normalMap), roughnessMap: null, metalnessMap: null, aoMap: null,
    roughness: 1, metalness: 1, normalScale: new THREE.Vector2(normalScale, normalScale), envMapIntensity,
  };
  const orm = clone(set.orm);
  params.roughnessMap = orm; params.metalnessMap = orm;
  if (set.emissiveMap) { params.emissiveMap = clone(set.emissiveMap); params.emissive = new THREE.Color(0xffffff); params.emissiveIntensity = emissiveIntensity; }
  if (tint !== undefined) params.color = new THREE.Color(tint);
  if (side) params.side = side;
  if (transparent) { params.transparent = true; params.opacity = opacity ?? 1; }
  const m = physical ? new THREE.MeshPhysicalMaterial(params) : new THREE.MeshStandardMaterial(params);
  m.name = `gf:${kind}`;
  matCache.set(key, m);
  return m;
}

export function solid(color, { roughness = 0.6, metalness = 0, emissive = 0x000000, emissiveIntensity = 1, flat = false, vertexColors = false, transparent = false, opacity = 1, side } = {}) {
  const key = 's' + [color, roughness, metalness, emissive, emissiveIntensity, flat, vertexColors, transparent, opacity, side].join('|');
  if (matCache.has(key)) return matCache.get(key);
  const m = new THREE.MeshStandardMaterial({ color, roughness, metalness, emissive, emissiveIntensity, flatShading: flat, vertexColors, transparent, opacity, side: side ?? THREE.FrontSide });
  matCache.set(key, m);
  return m;
}

export function emissive(color, intensity = 3) {
  return solid(0x000000, { emissive: color, emissiveIntensity: intensity, roughness: 0.4 });
}

export function glass({ color = 0x9fb8cc, opacity = 0.35, roughness = 0.05 } = {}) {
  return new THREE.MeshPhysicalMaterial({ color, roughness, metalness: 0, transmission: 0, transparent: true, opacity, envMapIntensity: 1.5, clearcoat: 1 });
}

export function carPaint(color = 0xb01c1c, { metallic = 0.6, flakes = true } = {}) {
  const key = 'paint' + color + metallic + flakes;
  if (matCache.has(key)) return matCache.get(key);
  const m = new THREE.MeshPhysicalMaterial({ color, metalness: metallic, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 1.3 });
  if (flakes) { const t = textureSet('metal', { color: 0xffffff, size: 128 }); m.roughnessMap = t.orm; }
  matCache.set(key, m);
  return m;
}

// Inverted-hull outline for stylized readability (characters, pickups).
export function addOutline(mesh, { thickness = 0.02, color = 0x0b0b10 } = {}) {
  const mat = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\n transformed += normalize(objectNormal) * ${thickness.toFixed(4)};`);
  };
  const o = mesh.isSkinnedMesh ? new THREE.SkinnedMesh(mesh.geometry, mat) : new THREE.Mesh(mesh.geometry, mat);
  if (mesh.isSkinnedMesh) o.bind(mesh.skeleton, mesh.bindMatrix);
  o.name = 'outline'; o.castShadow = false; o.frustumCulled = mesh.frustumCulled;
  mesh.add(o);
  return o;
}

// Vertex-shader wind sway for foliage. Strength scales with vertex height (object space y).
export function applyWind(material, { strength = 0.15, frequency = 1.6, heightScale = 0.25, instanced = true } = {}) {
  material.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = SHARED_UNIFORMS.uTime; sh.uniforms.uWind = SHARED_UNIFORMS.uWind;
    sh.vertexShader = 'uniform float uTime; uniform vec2 uWind;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      vec3 wp = (modelMatrix * ${instanced ? 'instanceMatrix *' : ''} vec4(position, 1.0)).xyz;
      float sway = sin(uTime * ${frequency.toFixed(2)} + wp.x * 0.35 + wp.z * 0.27) + 0.4 * sin(uTime * ${(frequency * 2.3).toFixed(2)} + wp.x * 1.3);
      float k = max(0.0, position.y) * ${heightScale.toFixed(3)};
      transformed.x += uWind.x * sway * k * ${strength.toFixed(3)} * 4.0;
      transformed.z += uWind.y * sway * k * ${strength.toFixed(3)} * 4.0;`);
  };
  material.customProgramCacheKey = () => 'wind' + strength + frequency + heightScale + instanced;
  return material;
}

export const MaterialLibrary = {
  textureSize: 256,
  anisotropy: 4,
  pbr, solid, emissive, glass, carPaint, textureSet, addOutline, applyWind,
  // Named presets agents can reference from a game spec ("material": "brick").
  presets: {
    grass: () => pbr('grass', { repeat: 1 }), dirt: () => pbr('dirt'), sand: () => pbr('sand'), rock: () => pbr('rock'),
    snow: () => pbr('snow'), asphalt: () => pbr('asphalt'), road: () => pbr('asphalt', { lanes: true }),
    concrete: () => pbr('concrete', { panels: 2 }), plaster: () => pbr('plaster'), brick: () => pbr('brick', { repeat: 1 }),
    cobble: () => pbr('cobble'), wood: () => pbr('planks'), roof: () => pbr('roof'), metal: () => pbr('metal'),
    paintedMetal: () => pbr('paintedMetal', { panels: 2 }), fabric: () => pbr('fabric'), leather: () => pbr('leather'),
    bark: () => pbr('bark'), leaves: () => pbr('leaves'), tiles: () => pbr('tiles'), facade: () => pbr('facade'),
  },
  get(name, opts) {
    if (this.presets[name] && !opts) return this.presets[name]();
    return pbr(name, opts || {});
  },
  clearCache() { texCache.clear(); matCache.clear(); },
};

// Emissive surfaces that should glow at night (windows, lamps, signage). The Atmosphere
// or game calls updateNightLights(daylight) each frame.
const nightMats = new Set();
export function registerNightEmissive(material, dayIntensity = 0.0, nightIntensity = 1.6) {
  material.userData.night = { day: dayIntensity, night: nightIntensity };
  nightMats.add(material);
  return material;
}
export function updateNightLights(daylight) {
  for (const m of nightMats) { const n = m.userData.night; m.emissiveIntensity = n.night + (n.day - n.night) * daylight; }
}
