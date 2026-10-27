// Skin system for parametric humans:
//  * per-vertex anatomical masks (lips, cheeks, nose, ears, brows, eyelids, stubble, nails)
//    derived from the rig joints + geometry, so they work for any body/face shape;
//  * UV-space bake (CPU rasterizer) of albedo + roughness with pores, freckles, moles,
//    vein tint and age blotching;
//  * MeshPhysicalMaterial patched with wrap lighting + red-shifted terminator (cheap SSS
//    approximation) and sheen for peach fuzz.
import * as THREE from '../vendor/three/three.module.js';
import { rasterizeUV } from '../render/rasterize.js';
import { Noise } from '../core/rng.js';
import { textureSet } from '../render/materials.js';
import { skinToneFor } from './human.js';

const gauss = (d2, s) => Math.exp(-d2 / (2 * s * s));
function bonePos(api, name) { const b = api.bones?.[name]; return b ? b.userData.head.clone() : null; }

// masks per render vertex: [lip, cheek, nose, ear, brow, lid, stubble, nail]
export function computeSkinMasks(geo, bones, params) {
  const P = geo.attributes.position, N = geo.attributes.normal, n = P.count;
  const masks = new Float32Array(n * 8);
  const head = bones.head.userData.head, eyeL = bones['eye.L'].userData.head, eyeR = bones['eye.R'].userData.head;
  const eyeMid = eyeL.clone().add(eyeR).multiplyScalar(0.5);
  const ipd = eyeL.distanceTo(eyeR); // inter-pupillary distance ~ 6.3 cm; all face measures scale with it
  const jaw = bones.jaw.userData.head;
  // mouth centre: average of the oris bones (lip muscles)
  const oris = Object.keys(bones).filter((k) => k.startsWith('oris')).map((k) => bones[k].userData.head);
  const mouth = oris.reduce((a, b) => a.add(b), new THREE.Vector3()).multiplyScalar(1 / Math.max(1, oris.length));
  // nose tip = most forward vertex between eyes and mouth near the midline
  let nose = eyeMid.clone(), best = -Infinity;
  const v = new THREE.Vector3(), nv = new THREE.Vector3();
  for (let i = 0; i < n; i++) { v.fromBufferAttribute(P, i); if (Math.abs(v.x - eyeMid.x) < ipd * 0.15 && v.y < eyeMid.y && v.y > mouth.y && v.z > best) { best = v.z; nose = v.clone(); } }
  const cheekL = eyeL.clone().add(new THREE.Vector3(ipd * 0.25, -ipd * 0.55, 0)), cheekR = eyeR.clone().add(new THREE.Vector3(-ipd * 0.25, -ipd * 0.55, 0));
  const browY = eyeMid.y + ipd * 0.33;
  const male = params.sex ?? 0.5;
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(P, i); nv.fromBufferAttribute(N, i);
    const k = i * 8, front = nv.z;
    const inHead = v.y > jaw.y - ipd * 0.6;
    // lips: ellipse around the mouth on the front of the face
    const lx = (v.x - mouth.x) / (ipd * 0.42), ly = (v.y - mouth.y) / (ipd * 0.17);
    masks[k] = inHead && v.z > mouth.z - ipd * 0.35 ? Math.max(0, 1 - Math.pow(lx * lx + ly * ly, 2)) : 0;
    masks[k + 1] = inHead && front > 0 ? Math.max(gauss(v.distanceToSquared(cheekL), ipd * 0.35), gauss(v.distanceToSquared(cheekR), ipd * 0.35)) : 0;
    masks[k + 2] = inHead ? gauss(v.distanceToSquared(nose), ipd * 0.22) : 0;
    masks[k + 3] = inHead && Math.abs(v.x - head.x) > ipd * 1.05 && v.y > mouth.y && v.y < browY + ipd * 0.2 ? 1 : 0;
    const bx = Math.min(Math.abs(v.x - eyeL.x), Math.abs(v.x - eyeR.x)) / (ipd * 0.42), by = (v.y - browY) / (ipd * 0.1 + Math.abs(v.x - eyeMid.x) * 0.06);
    masks[k + 4] = inHead && front > 0.2 && Math.abs(v.x - eyeMid.x) > ipd * 0.12 ? Math.max(0, 1 - (bx * bx * bx * bx + by * by)) : 0;
    masks[k + 5] = inHead && front > 0 ? Math.max(gauss(v.distanceToSquared(eyeL), ipd * 0.18), gauss(v.distanceToSquared(eyeR), ipd * 0.18)) : 0;
    // stubble: below the nose, around mouth/jaw, front and sides of the lower face
    const below = v.y < nose.y - ipd * 0.15 && v.y > jaw.y - ipd * 0.9;
    masks[k + 6] = inHead && below && v.z > head.z - ipd * 0.2 ? male * (1 - masks[k] * 1.2) : 0;
    masks[k + 7] = 0;
  }
  // nails: finger tips (last phalanx) dorsal side
  const si = geo.attributes.skinIndex, sw = geo.attributes.skinWeight;
  const tipBones = new Set(); Object.keys(bones).forEach((nm, idx) => { if (/^finger\d-3|^toe\d-[23]/.test(nm)) tipBones.add(nm); });
  const boneNames = Object.keys(bones);
  return { masks, nose, mouth, eyeMid, ipd, tipBones, boneNames, si, sw };
}

export function bakeSkinTextures(human, { size = 1024, seed = 1 } = {}) {
  const api = human.userData, geo = api.mesh.geometry, p = api.params;
  const m = computeSkinMasks(geo, api.bones, p);
  const P = geo.attributes.position, n = P.count;
  const attrs = new Float32Array(n * 11);
  for (let i = 0; i < n; i++) { attrs.set(m.masks.subarray(i * 8, i * 8 + 8), i * 11); attrs[i * 11 + 8] = P.getX(i); attrs[i * 11 + 9] = P.getY(i); attrs[i * 11 + 10] = P.getZ(i); }
  const noise = new Noise(seed);
  // Shade in sRGB (the space the tone presets are authored in): the albedo texture is tagged
  // SRGBColorSpace, so writing linear values here would decode twice (dark, oversaturated skin).
  const srgb = (c) => new THREE.Color(c).convertLinearToSRGB();
  const base = skinToneFor(p).convertLinearToSRGB(), dark = base.r < 0.7;
  const lipCol = base.clone().lerp(srgb(dark ? 0x5a2a28 : 0xb4505a), dark ? 0.35 : 0.45);
  const blush = srgb(dark ? 0x6a2a20 : 0xd06a64);
  const hair = srgb(p.hair?.color ?? p.hairColor ?? 0x2a1a10).multiplyScalar(0.7); // brows are usually darker than scalp hair
  const age = Math.min(1, Math.max(0, ((p.age ?? 30) - 30) / 50));
  const freckles = p.skin?.freckles ?? 0, makeup = p.skin?.makeup ?? 0;
  const albedo = new Uint8Array(size * size * 4), rough = new Uint8Array(size * size * 4);
  const shade = (a, u, v, out, o) => {
    const [lip, cheek, nose, ear, brow, lid, stub] = a; const x = a[8], y = a[9], z = a[10];
    let r = base.r, g = base.g, b = base.b;
    // large-scale variation (blood flow / melanin)
    const lf = noise.noise3(x * 6, y * 6, z * 6) * 0.04 + noise.noise3(x * 25, y * 25, z * 25) * 0.025;
    r += lf; g += lf * 0.8; b += lf * 0.7;
    const red = Math.min(1, cheek * 0.22 + nose * 0.18 + ear * 0.2) * (dark ? 0.4 : 1);
    r += (blush.r - r) * red * 0.5; g += (blush.g - g) * red * 0.5; b += (blush.b - b) * red * 0.5;
    const lp = Math.min(1, lip * 1.4);
    r += (lipCol.r - r) * lp; g += (lipCol.g - g) * lp; b += (lipCol.b - b) * lp;
    if (makeup && lp > 0.1) { r = r * (1 - makeup * lp * 0.5) + 0.62 * makeup * lp * 0.5; g *= 1 - makeup * lp * 0.4; b *= 1 - makeup * lp * 0.3; }
    // eyelid darkening
    r *= 1 - lid * 0.12; g *= 1 - lid * 0.14; b *= 1 - lid * 0.1;
    // eyebrows (hair strokes)
    if (brow > 0.05) { const strokes = 0.5 + 0.5 * Math.sin((x * 900 + noise.noise3(x * 200, y * 200, z * 50) * 4)); const d = Math.min(1, brow * 1.2) * (0.35 + 0.4 * strokes) * (p.browDensity ?? 0.8); r += (hair.r - r) * d; g += (hair.g - g) * d; b += (hair.b - b) * d; }
    // stubble / beard shadow
    if (stub > 0.01) { const s = stub * (p.beardShadow ?? 0.55) * (0.6 + 0.4 * noise.noise3(x * 500, y * 500, z * 500)); r -= s * 0.18; g -= s * 0.15; b -= s * 0.1; }
    // freckles & moles
    const fr = noise.noise3(x * 140, y * 140, z * 140);
    if (freckles && fr > 0.6 && (cheek + nose) > 0.1) { const k = freckles * 0.12; r *= 1 - k; g *= 1 - k * 1.4; b *= 1 - k * 1.6; }
    if (noise.noise3(x * 61 + 3, y * 61, z * 61) > 0.94) { r *= 0.86; g *= 0.8; b *= 0.78; } // rare moles
    // age blotching
    if (age > 0) { const ab = Math.max(0, noise.noise3(x * 30 + 7, y * 30, z * 30) - 0.3) * age * 0.25; r -= ab * 0.4; g -= ab * 0.5; b -= ab * 0.55; }
    // pores (fine)
    const pore = noise.noise3(x * 2200, y * 2200, z * 2200) * 0.025;
    r += pore; g += pore; b += pore;
    out[o] = Math.max(0, Math.min(255, r * 255)); out[o + 1] = Math.max(0, Math.min(255, g * 255)); out[o + 2] = Math.max(0, Math.min(255, b * 255)); out[o + 3] = 255;
    // roughness (G), T-zone oilier, lips glossier
    const rr = 0.52 - nose * 0.12 - lip * 0.18 + brow * 0.2 + age * 0.08 + pore * 2;
    rough[o] = 255; rough[o + 1] = Math.max(0, Math.min(255, rr * 255)); rough[o + 2] = 0; rough[o + 3] = 255;
  };
  // rasterize body triangles only (first material group)
  const bodyGroup = geo.groups[0];
  const index = geo.index.array.subarray(bodyGroup.start, bodyGroup.start + bodyGroup.count);
  rasterizeUV({ size, uvs: geo.attributes.uv.array, index, attrs, attrSize: 11, shade: (a, u, v, out, o) => { shade(a, u, v, albedo, o); }, out: albedo, dilate: 3 });
  // second pass for roughness channel uses same shading (already written into `rough`) – dilate it
  rasterizeUV({ size, uvs: geo.attributes.uv.array, index, attrs, attrSize: 11, shade: () => {}, out: rough, dilate: 3 });
  return { albedo, rough, size, masks: m };
}

const SKIN_PATCH_DIFFUSE = 'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );\n}';
export function createSkinMaterial(human, { size = 1024, seed = 1, wrap = 0.45, sssColor = new THREE.Color(0.9, 0.25, 0.15) } = {}) {
  const t = bakeSkinTextures(human, { size, seed });
  const tex = (data, srgb) => { const x = new THREE.DataTexture(data, t.size, t.size, THREE.RGBAFormat); x.flipY = false; x.generateMipmaps = true; x.minFilter = THREE.LinearMipmapLinearFilter; x.magFilter = THREE.LinearFilter; x.anisotropy = 4; if (srgb) x.colorSpace = THREE.SRGBColorSpace; x.needsUpdate = true; return x; };
  // DataTexture rows start at the bottom; the rasterizer wrote top-down, so flip V via uv transform
  const map = tex(t.albedo, true), roughnessMap = tex(t.rough, false);
  for (const m of [map, roughnessMap]) { m.repeat.set(1, -1); m.offset.set(0, 1); m.wrapT = THREE.RepeatWrapping; }
  const pores = textureSet('skin', { color: 0xffffff, color2: 0xf6f0f0, size: 256 });
  const normalMap = pores.normalMap.clone(); normalMap.repeat.set(18, 18); normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping; normalMap.needsUpdate = true;
  const mat = new THREE.MeshPhysicalMaterial({ map, roughnessMap, roughness: 1, metalness: 0, normalMap, normalScale: new THREE.Vector2(0.35, 0.35), sheen: 0.25, sheenRoughness: 0.8, sheenColor: new THREE.Color(1, 0.85, 0.8), specularIntensity: 0.6 });
  mat.name = 'gf:skin';
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uWrap = { value: wrap }; sh.uniforms.uSSS = { value: sssColor };
    let chunk = THREE.ShaderChunk.lights_physical_pars_fragment;
    if (!chunk.includes(SKIN_PATCH_DIFFUSE)) { console.warn('skin shader patch point not found; using standard shading'); return; }
    chunk = chunk.replace(SKIN_PATCH_DIFFUSE, `{
      float rawNL = dot( geometryNormal, directLight.direction );
      float wrapNL = saturate( ( rawNL + uWrap ) / ( 1.0 + uWrap ) );
      float scatter = saturate( wrapNL - saturate( rawNL ) );
      vec3 wrapIrr = ( wrapNL * directLight.color ) + uSSS * scatter * directLight.color * 0.6;
      reflectedLight.directDiffuse += wrapIrr * BRDF_Lambert( material.diffuseColor );
    }
}`);
    sh.fragmentShader = 'uniform float uWrap; uniform vec3 uSSS;\n' + sh.fragmentShader.replace('#include <lights_physical_pars_fragment>', chunk);
  };
  mat.customProgramCacheKey = () => 'gf-skin';
  return mat;
}

// Replace the placeholder skin of a built human with the baked skin material.
export function applySkin(human, opts = {}) {
  const mesh = human.userData.mesh; const mats = mesh.material.slice();
  mats[0] = createSkinMaterial(human, opts); mesh.material = mats; return mats[0];
}
