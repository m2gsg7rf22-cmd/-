import * as THREE from 'three';
import { ATLAS_H, ATLAS_W, TILE_PX } from '../world/tiles';

/** Shared uniforms for all world materials, updated once per frame. */
export const worldUniforms = {
  map: { value: null as THREE.Texture | null },
  uDaylight: { value: 1 },
  uLightColor: { value: new THREE.Color(1, 1, 1) },
  uAmbient: { value: 0.09 },
  /** Tint of the ambient term (warm red in Emberdeep, violet in Voidreach). */
  uAmbientColor: { value: new THREE.Color(1, 1, 1) },
  uFogColor: { value: new THREE.Color(0.7, 0.8, 0.95) },
  /** Sky zenith color: fog blends toward the sky gradient in the view direction. */
  uSkyTop: { value: new THREE.Color(0.32, 0.56, 0.9) },
  uFogNear: { value: 60 },
  uFogFar: { value: 120 },
  uTime: { value: 0 },
  uTileSize: { value: new THREE.Vector2(TILE_PX / ATLAS_W, TILE_PX / ATLAS_H) },
};

const vertex = /* glsl */ `
attribute vec3 light;
attribute vec2 tile;
varying vec2 vUv;
varying vec2 vTile;
varying float vShade;
varying float vSky;
varying float vBlk;
varying float vFogDepth;
varying vec3 vWorld;
void main() {
  vUv = uv;
  vTile = tile;
  vShade = light.x;
  vSky = light.y;
  vBlk = light.z;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vec4 mv = viewMatrix * world;
  vFogDepth = length(mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;

const fragmentCommon = /* glsl */ `
uniform sampler2D map;
uniform float uDaylight;
uniform vec3 uLightColor;
uniform float uAmbient;
uniform vec3 uAmbientColor;
uniform vec3 uFogColor;
uniform vec3 uSkyTop;
uniform float uFogNear;
uniform float uFogFar;
uniform float uTime;
uniform vec2 uTileSize;
varying vec2 vUv;
varying vec2 vTile;
varying float vShade;
varying float vSky;
varying float vBlk;
varying float vFogDepth;
varying vec3 vWorld;

float cellHash(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.x + p.y) * p.z);
}

// Per-fragment decoded tile info (see TILE_FLAGS in world/tiles.ts).
vec2 gTileBase;
float gFlags;
float gVary;

// Local uvs are in block units; wrap inside the tile so greedy-merged quads repeat the texture.
vec2 atlasUv() {
  gFlags = floor(vTile.x * 0.5);
  gTileBase = vec2(vTile.x - gFlags * 2.0, vTile.y);
  vec2 f = fract(vUv);
  gVary = 1.0;
  float natural = mod(gFlags, 2.0);
  if (natural > 0.5) {
    // The block this face belongs to: step back from the face along its normal.
    vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
    vec3 cell = floor(vWorld - n * 0.5 + 0.001);
    float h = cellHash(cell);
    float r = floor(h * 4.0);
    if (r == 1.0) f = vec2(f.y, 1.0 - f.x);
    else if (r == 2.0) f = vec2(1.0 - f.x, 1.0 - f.y);
    else if (r == 3.0) f = vec2(1.0 - f.y, f.x);
    f = min(f, vec2(0.9999));
    gVary = 0.93 + 0.12 * cellHash(cell + 17.0);
  }
  if (gFlags >= 2.0) {
    // Animated surfaces: slow flowing drift that stays inside the tile.
    f = fract(f + vec2(sin(uTime * 0.35 + vWorld.z * 0.7) * 0.06 + uTime * 0.045, uTime * 0.07));
  }
  return gTileBase + f * uTileSize;
}

vec3 lightFor(float shade, float sky, float blk) {
  float s = sky * sky;
  float b = pow(blk, 3.0) * 1.15;
  vec3 l = uAmbient * uAmbientColor + s * uDaylight * uLightColor + b * vec3(1.15, 0.92, 0.66);
  return shade * min(l, vec3(1.35));
}

vec3 applyFog(vec3 col) {
  float f = smoothstep(uFogNear, uFogFar, vFogDepth);
  // Match the sky dome gradient behind the fragment so distant terrain dissolves into the sky.
  vec3 dir = normalize(vWorld - cameraPosition);
  vec3 sky = mix(uFogColor, uSkyTop, pow(clamp(dir.y, 0.0, 1.0), 0.55));
  return mix(col, sky, f);
}
`;

const opaqueFrag = /* glsl */ `
${fragmentCommon}
void main() {
  vec4 t = texture2D(map, atlasUv());
  if (t.a < 0.5) discard;
  vec3 col = t.rgb * gVary * lightFor(vShade, vSky, vBlk);
  if (gFlags >= 2.0) col *= 0.92 + 0.12 * sin(uTime * 2.1 + vWorld.x * 0.9 + vWorld.y * 1.3);
  gl_FragColor = vec4(applyFog(col), 1.0);
  #include <colorspace_fragment>
}
`;

const transFrag = /* glsl */ `
${fragmentCommon}
uniform float uWaterMode;
void main() {
  vec4 t = texture2D(map, atlasUv());
  if (t.a < 0.02) discard;
  vec3 col = t.rgb;
  float a = t.a;
  // Water: subtle animated shimmer + view-dependent opacity for a depth impression.
  if (t.b > t.r * 1.6 && a < 0.8) {
    float w = sin(vWorld.x * 1.7 + uTime * 1.6) * sin(vWorld.z * 1.3 + uTime * 1.25);
    float w2 = sin((vWorld.x + vWorld.z) * 0.6 - uTime * 0.9);
    col *= 0.92 + 0.08 * w + 0.05 * w2;
    vec3 v = normalize(cameraPosition - vWorld);
    a = mix(0.92, a, clamp(abs(v.y) * 1.2, 0.0, 1.0));
  }
  col *= lightFor(vShade, vSky, vBlk);
  gl_FragColor = vec4(applyFog(col), a);
  #include <colorspace_fragment>
}
`;

export function createWorldMaterials(atlas: THREE.Texture): { opaque: THREE.ShaderMaterial; transparent: THREE.ShaderMaterial } {
  worldUniforms.map.value = atlas;
  const opaque = new THREE.ShaderMaterial({
    uniforms: worldUniforms,
    vertexShader: vertex,
    fragmentShader: opaqueFrag,
  });
  const transparent = new THREE.ShaderMaterial({
    uniforms: { ...worldUniforms, uWaterMode: { value: 1 } },
    vertexShader: vertex,
    fragmentShader: transFrag,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  return { opaque, transparent };
}

export function createAtlasTexture(canvas: HTMLCanvasElement): THREE.Texture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}
