// Stylized-physical water: animated normal waves, fresnel sky reflection, depth-tinted
// colour, sun specular and shoreline foam (from terrain height texture).
import * as THREE from '../vendor/three/three.module.js';
import { SHARED_UNIFORMS } from '../render/materials.js';

export function createWater({ size = 2000, level = 0, color = 0x1e5a6e, deep = 0x0b2a3a, heightfield = null, sunDir = new THREE.Vector3(0.3, 0.8, 0.2) } = {}) {
  let heightTex = null, hfSize = 1;
  if (heightfield) {
    const r = heightfield.res + 1, data = new Float32Array(r * r * 4);
    for (let i = 0; i < r * r; i++) data[i * 4] = heightfield.data[i];
    heightTex = new THREE.DataTexture(data, r, r, THREE.RGBAFormat, THREE.FloatType);
    heightTex.magFilter = THREE.NearestFilter; heightTex.minFilter = THREE.NearestFilter; heightTex.needsUpdate = true;
    hfSize = heightfield.size;
  }
  const mat = new THREE.ShaderMaterial({
    transparent: true, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: SHARED_UNIFORMS.uTime, uColor: { value: new THREE.Color(color) }, uDeep: { value: new THREE.Color(deep) },
      uSun: { value: sunDir.clone().normalize() }, uSunColor: { value: new THREE.Color(1, 0.95, 0.85) }, uSky: { value: new THREE.Color(0x9ec4e0) },
      uHeight: { value: heightTex }, uHasHeight: { value: heightTex ? 1 : 0 }, uHfSize: { value: hfSize }, uLevel: { value: level },
    }]),
    vertexShader: `
      #include <fog_pars_vertex>
      uniform float uTime; varying vec3 vW;
      void main(){
        vec3 p = position;
        vec4 w = modelMatrix * vec4(p, 1.0);
        w.y += sin(w.x * 0.08 + uTime * 0.9) * 0.08 + cos(w.z * 0.11 + uTime * 0.7) * 0.06;
        vW = w.xyz;
        vec4 mvPosition = viewMatrix * w;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      #include <common>
      #include <fog_pars_fragment>
      uniform float uTime, uHasHeight, uHfSize, uLevel; uniform vec3 uColor, uDeep, uSun, uSunColor, uSky; uniform sampler2D uHeight; varying vec3 vW;
      vec2 wave(vec2 p, vec2 d, float f, float s, float t){ float x = dot(p, d) * f + t * s; return d * cos(x) * f; }
      void main(){
        vec2 p = vW.xz; float t = uTime;
        vec2 g = wave(p, normalize(vec2(1.0, 0.3)), 0.35, 1.3, t) * 0.25 + wave(p, normalize(vec2(-0.4, 1.0)), 0.6, 1.7, t) * 0.15
               + wave(p, normalize(vec2(0.7, -0.8)), 1.3, 2.3, t) * 0.07 + wave(p, normalize(vec2(-0.9, -0.2)), 2.7, 3.1, t) * 0.03;
        vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
        vec3 v = normalize(cameraPosition - vW);
        float fres = 0.04 + 0.96 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
        float depth = 6.0;
        if (uHasHeight > 0.5) { vec2 uv = (vW.xz / uHfSize) + 0.5; float th = texture2D(uHeight, uv).r; depth = uLevel - th; }
        vec3 base = mix(uColor, uDeep, smoothstep(0.5, 8.0, depth));
        vec3 col = mix(base, uSky, fres * 0.8);
        vec3 h = normalize(uSun + v);
        col += uSunColor * pow(max(dot(n, h), 0.0), 220.0) * 2.5;
        float foam = (1.0 - smoothstep(0.0, 0.9, depth)) * (0.6 + 0.4 * sin(t * 2.0 + p.x * 1.7 + p.y * 1.3));
        col = mix(col, vec3(0.92, 0.96, 1.0), clamp(foam, 0.0, 1.0) * 0.8);
        float alpha = mix(0.55, 0.92, smoothstep(0.0, 3.0, depth));
        gl_FragColor = vec4(col, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  const geo = new THREE.PlaneGeometry(size, size, 96, 96); geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, mat); mesh.position.y = level; mesh.name = 'water'; mesh.renderOrder = 2;
  mesh.userData.setSun = (dir, color, sky) => { mat.uniforms.uSun.value.copy(dir); if (color) mat.uniforms.uSunColor.value.copy(color); if (sky) mat.uniforms.uSky.value.copy(sky); };
  return mesh;
}
