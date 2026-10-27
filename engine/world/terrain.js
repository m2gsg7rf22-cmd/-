// Heightfield terrain: seeded fbm/ridged noise, island and valley masks, flatten zones
// (towns, arenas, roads), O(1) bilinear height + normal queries for physics, and a
// splat-blended PBR material (grass/dirt/rock/sand/snow by height & slope).
import * as THREE from '../vendor/three/three.module.js';
import { Noise, clamp, lerp, smoothstep } from '../core/rng.js';
import { textureSet, SHARED_UNIFORMS } from '../render/materials.js';

export class Heightfield {
  constructor({ size = 512, resolution = 256, seed = 1, height = 40, type = 'hills', waterLevel = 0, flatten = [], roads = [], island = false, base = 0, generator } = {}) {
    this.size = size; this.res = resolution; this.seed = seed; this.maxHeight = height; this.waterLevel = waterLevel;
    this.half = size / 2; this.cell = size / resolution;
    this.data = new Float32Array((resolution + 1) * (resolution + 1));
    const n = new Noise(seed);
    for (let j = 0; j <= resolution; j++) for (let i = 0; i <= resolution; i++) {
      const x = -this.half + i * this.cell, z = -this.half + j * this.cell;
      let h;
      if (generator) h = generator(x, z, n);
      else {
        const fx = x / size, fz = z / size;
        const warp = n.fbm2(fx * 2 + 11, fz * 2 + 7, 3) * 0.15;
        const hills = n.fbm2(fx * 3 + warp, fz * 3 - warp, 6) * 0.5 + 0.5;
        const ridges = n.ridged2(fx * 2.2 + 50, fz * 2.2, 5);
        if (type === 'flat') h = base + n.fbm2(fx * 6, fz * 6, 3) * 0.6;
        else if (type === 'mountains') h = base + (Math.pow(hills, 1.6) * 0.45 + ridges * 0.75) * height;
        else if (type === 'dunes') h = base + (Math.abs(n.noise2(fx * 5 + warp * 3, fz * 2)) * 0.6 + hills * 0.4) * height;
        else h = base + Math.pow(hills, 1.4) * height + ridges * height * 0.15;
        if (island) {
          const d = Math.hypot(x, z) / this.half + n.fbm2(fx * 4, fz * 4, 3) * 0.15;
          const m = 1 - smoothstep(0.45, 0.92, d);
          h = h * m + (waterLevel - 6) * (1 - m) + m * 3;
        }
      }
      this.data[j * (resolution + 1) + i] = h;
    }
    for (const f of flatten) this.flattenArea(f);
    for (const r of roads) this.carveRoad(r);
  }
  idx(i, j) { return clamp(j, 0, this.res) * (this.res + 1) + clamp(i, 0, this.res); }
  // Flatten a circle/rect to target height with smooth falloff. {x, z, radius, height?, falloff, rect: [w, d]}
  flattenArea({ x, z, radius = 20, height, falloff = 10, rect }) {
    const target = height ?? this.heightAt(x, z);
    const R = (rect ? Math.max(rect[0], rect[1]) / 2 : radius) + falloff;
    const i0 = Math.floor((x - R + this.half) / this.cell), i1 = Math.ceil((x + R + this.half) / this.cell);
    const j0 = Math.floor((z - R + this.half) / this.cell), j1 = Math.ceil((z + R + this.half) / this.cell);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      if (i < 0 || j < 0 || i > this.res || j > this.res) continue;
      const px = -this.half + i * this.cell, pz = -this.half + j * this.cell;
      const d = rect ? Math.max(Math.abs(px - x) - rect[0] / 2, Math.abs(pz - z) - rect[1] / 2, 0) : Math.max(0, Math.hypot(px - x, pz - z) - radius);
      const t = 1 - smoothstep(0, falloff, d);
      const k = this.idx(i, j); this.data[k] = lerp(this.data[k], target, t);
    }
    return target;
  }
  // Road along polyline points [[x,z],...]: smooth the profile and flatten across width.
  carveRoad({ points, width = 8, falloff = 6 }) {
    const hs = points.map(([x, z]) => this.heightAt(x, z));
    for (let k = 0; k < 3; k++) for (let i = 1; i < hs.length - 1; i++) hs[i] = (hs[i - 1] + hs[i] * 2 + hs[i + 1]) / 4;
    for (let p = 0; p < points.length - 1; p++) {
      const [ax, az] = points[p], [bx, bz] = points[p + 1];
      const len = Math.hypot(bx - ax, bz - az), steps = Math.ceil(len / (this.cell * 0.5));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps; this.flattenArea({ x: lerp(ax, bx, t), z: lerp(az, bz, t), radius: width / 2, height: lerp(hs[p], hs[p + 1], t), falloff });
      }
    }
  }
  heightAt(x, z) {
    const fx = clamp((x + this.half) / this.cell, 0, this.res - 1e-6), fz = clamp((z + this.half) / this.cell, 0, this.res - 1e-6);
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
    const r = this.res + 1, d = this.data;
    const a = d[j * r + i], b = d[j * r + i + 1], c = d[(j + 1) * r + i], e = d[(j + 1) * r + i + 1];
    // match the mesh triangulation (diagonal from (i,j+1) to (i+1,j))
    if (tx + tz <= 1) return a + (b - a) * tx + (c - a) * tz;
    return e + (c - e) * (1 - tx) + (b - e) * (1 - tz);
  }
  normalAt(x, z, out = new THREE.Vector3()) {
    const e = this.cell;
    return out.set(this.heightAt(x - e, z) - this.heightAt(x + e, z), 2 * e, this.heightAt(x, z - e) - this.heightAt(x, z + e)).normalize();
  }
  slopeAt(x, z) { return 1 - this.normalAt(x, z).y; }
  inBounds(x, z, margin = 0) { return Math.abs(x) < this.half - margin && Math.abs(z) < this.half - margin; }
  // Raycast against the heightfield by marching (used by cameras/weapons).
  raycast(origin, dir, maxDist = 500, step = 0.5) {
    let prev = origin.y - this.heightAt(origin.x, origin.z);
    for (let t = step; t <= maxDist; t += step) {
      const x = origin.x + dir.x * t, y = origin.y + dir.y * t, z = origin.z + dir.z * t;
      const d = y - this.heightAt(x, z);
      if (d <= 0) { const tt = t - step * (d / (d - prev)); return { distance: tt, point: new THREE.Vector3(origin.x + dir.x * tt, origin.y + dir.y * tt, origin.z + dir.z * tt) }; }
      prev = d;
    }
    return null;
  }
}

// Splat material: blends tiling texture sets by height/slope in world space.
export function terrainMaterial({ waterLevel = 0, snowLine = 60, sandBand = 2.5, scale = 0.12, palette = {} } = {}) {
  const g = textureSet('grass', { color: palette.grass ?? 0x4f7a2c, color2: palette.grass2 ?? 0x7d9a3a, size: 256 });
  const r = textureSet('rock', { color: palette.rock ?? 0x6e6a64, size: 256 });
  const d = textureSet('dirt', { color: palette.dirt ?? 0x6b5038, size: 256 });
  const s = textureSet('sand', { color: palette.sand ?? 0xd8c49a, size: 256 });
  const m = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { tGrass: { value: g.map }, tRock: { value: r.map }, tDirt: { value: d.map }, tSand: { value: s.map },
      nGrass: { value: g.normalMap }, nRock: { value: r.normalMap }, uWater: { value: waterLevel }, uSnow: { value: snowLine }, uSand: { value: sandBand }, uScale: { value: scale }, uTime: SHARED_UNIFORMS.uTime });
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPos; varying vec3 vWNormal;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz; vWNormal = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      uniform sampler2D tGrass, tRock, tDirt, tSand, nGrass, nRock; uniform float uWater, uSnow, uSand, uScale, uTime;
      varying vec3 vWPos; varying vec3 vWNormal;
      vec3 triRock(vec3 p, vec3 n){ vec3 w = pow(abs(n), vec3(4.0)); w /= (w.x+w.y+w.z);
        return texture2D(tRock, p.zy*uScale*0.6).rgb*w.x + texture2D(tRock, p.xz*uScale*0.6).rgb*w.y + texture2D(tRock, p.xy*uScale*0.6).rgb*w.z; }
      float hash2(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
      float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(hash2(i),hash2(i+vec2(1,0)),f.x), mix(hash2(i+vec2(0,1)),hash2(i+vec2(1,1)),f.x), f.y); }`)
      .replace('#include <map_fragment>', `
        vec2 uv = vWPos.xz * uScale;
        float slope = 1.0 - clamp(vWNormal.y, 0.0, 1.0);
        float macro = vnoise(vWPos.xz * 0.02) * 0.6 + vnoise(vWPos.xz * 0.07) * 0.4;
        vec3 grass = texture2D(tGrass, uv).rgb * mix(0.8, 1.15, macro);
        vec3 grassFar = texture2D(tGrass, uv * 0.13).rgb;
        grass = mix(grass, grassFar * mix(0.85, 1.1, macro), 0.35);
        vec3 dirt = texture2D(tDirt, uv * 1.3).rgb;
        vec3 sand = texture2D(tSand, uv * 0.9).rgb;
        vec3 rock = triRock(vWPos, vWNormal);
        vec3 col = mix(grass, dirt, smoothstep(0.55, 0.85, macro) * 0.55);
        col = mix(col, rock, smoothstep(0.28, 0.45, slope + (macro - 0.5) * 0.1));
        col = mix(col, sand, 1.0 - smoothstep(uWater + uSand * 0.4, uWater + uSand, vWPos.y + (macro - 0.5) * 1.5));
        col = mix(col, vec3(0.93, 0.95, 1.0), smoothstep(uSnow, uSnow + 8.0, vWPos.y + macro * 6.0) * (1.0 - smoothstep(0.35, 0.6, slope)));
        diffuseColor.rgb *= col;`)
      .replace('#include <roughnessmap_fragment>', `float roughnessFactor = mix(0.95, 0.75, smoothstep(0.28, 0.45, slope));`);
  };
  m.customProgramCacheKey = () => 'gf-terrain';
  return m;
}

export function terrainMesh(hf, opts = {}) {
  const geo = new THREE.PlaneGeometry(hf.size, hf.size, hf.res, hf.res);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  // PlaneGeometry rotated: vertex order rows along -z..+z after rotation; map via coordinates
  for (let k = 0; k < pos.count; k++) pos.setY(k, hf.heightAt(pos.getX(k), pos.getZ(k)));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, opts.material ?? terrainMaterial({ waterLevel: hf.waterLevel, snowLine: opts.snowLine ?? hf.maxHeight * 0.85, palette: opts.palette }));
  mesh.receiveShadow = true; mesh.castShadow = false; mesh.name = 'terrain';
  mesh.userData.heightfield = hf;
  return mesh;
}
