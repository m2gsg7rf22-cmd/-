import * as THREE from 'three';

/** Shared uniforms for all world materials, updated once per frame. */
export const worldUniforms = {
  map: { value: null as THREE.Texture | null },
  uDaylight: { value: 1 },
  uLightColor: { value: new THREE.Color(1, 1, 1) },
  uAmbient: { value: 0.09 },
  uFogColor: { value: new THREE.Color(0.7, 0.8, 0.95) },
  /** Sky zenith color: fog blends toward the sky gradient in the view direction. */
  uSkyTop: { value: new THREE.Color(0.32, 0.56, 0.9) },
  uFogNear: { value: 60 },
  uFogFar: { value: 120 },
  uTime: { value: 0 },
};

const vertex = /* glsl */ `
attribute vec2 light;
varying vec2 vUv;
varying float vShade;
varying float vSky;
varying float vFogDepth;
varying vec3 vWorld;
void main() {
  vUv = uv;
  vShade = light.x;
  vSky = light.y;
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
uniform vec3 uFogColor;
uniform vec3 uSkyTop;
uniform float uFogNear;
uniform float uFogFar;
uniform float uTime;
varying vec2 vUv;
varying float vShade;
varying float vSky;
varying float vFogDepth;
varying vec3 vWorld;

vec3 lightFor(float shade, float sky) {
  float s = sky * sky;
  return shade * (vec3(uAmbient) + s * uDaylight * uLightColor);
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
  vec4 t = texture2D(map, vUv);
  if (t.a < 0.5) discard;
  vec3 col = t.rgb * lightFor(vShade, vSky);
  gl_FragColor = vec4(applyFog(col), 1.0);
  #include <colorspace_fragment>
}
`;

const transFrag = /* glsl */ `
${fragmentCommon}
uniform float uWaterMode;
void main() {
  vec4 t = texture2D(map, vUv);
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
  col *= lightFor(vShade, vSky);
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
