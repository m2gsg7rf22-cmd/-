// Renderer setup: physically based pipeline (ACES tone mapping, sRGB output, soft
// shadows), automatic quality tiers and a post stack (bloom, grading, AA).
import * as THREE from '../vendor/three/three.module.js';
import { EffectComposer } from '../vendor/three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from '../vendor/three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '../vendor/three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from '../vendor/three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from '../vendor/three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from '../vendor/three/addons/shaders/FXAAShader.js';

export const QUALITY = {
  low: { pixelRatio: 0.75, shadows: true, shadowSize: 1024, post: false, bloom: false, aa: false, maxAniso: 1, drawDistance: 0.6, density: 0.4 },
  medium: { pixelRatio: 1, shadows: true, shadowSize: 2048, post: true, bloom: true, aa: true, maxAniso: 4, drawDistance: 0.8, density: 0.7 },
  high: { pixelRatio: 1.5, shadows: true, shadowSize: 4096, post: true, bloom: true, aa: true, maxAniso: 8, drawDistance: 1, density: 1 },
};

// Display-space color grade: contrast, saturation, lift/gain tint, vignette, grain.
export const GradeShader = {
  name: 'GradeShader',
  uniforms: {
    tDiffuse: { value: null }, time: { value: 0 },
    contrast: { value: 1.1 }, saturation: { value: 1.05 }, exposure: { value: 1.0 },
    lift: { value: new THREE.Vector3(0.0, 0.0, 0.01) }, gain: { value: new THREE.Vector3(1.0, 0.99, 0.97) },
    vignette: { value: 0.28 }, grain: { value: 0.025 }, flash: { value: 0 }, flashColor: { value: new THREE.Color(1, 0.2, 0.15) },
    letterbox: { value: 0 }, desaturate: { value: 0 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float time, contrast, saturation, exposure, vignette, grain, flash, letterbox, desaturate;
    uniform vec3 lift, gain, flashColor; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb * exposure;
      col = (col - 0.5) * contrast + 0.5;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, saturation * (1.0 - desaturate));
      col = col * gain + lift * (1.0 - col);
      vec2 d = vUv - 0.5;
      col *= 1.0 - vignette * smoothstep(0.25, 0.85, length(d) * 1.4);
      col += (hash(vUv * 1000.0 + time) - 0.5) * grain;
      col = mix(col, flashColor, flash * smoothstep(0.15, 0.75, length(d) * 1.6));
      if (abs(d.y) > 0.5 - letterbox) col = vec3(0.0);
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), c.a);
    }`,
};

export function detectQuality(renderer) {
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '';
    const software = /swiftshader|llvmpipe|software|basic render/i.test(name);
    const mobile = typeof navigator !== 'undefined' && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
    return { tier: software ? 'low' : mobile ? 'medium' : 'high', gpu: name, software };
  } catch { return { tier: 'medium', gpu: 'unknown', software: false }; }
}

export function createRenderer({ canvas, container, quality = 'auto', clearColor = 0x87a6c8 } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(clearColor);
  const detected = detectQuality(renderer);
  const tierName = quality === 'auto' ? (globalThis.location?.search.match(/quality=(\w+)/)?.[1] || detected.tier) : quality;
  const tier = { ...(QUALITY[tierName] || QUALITY.medium), name: tierName };
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2) * tier.pixelRatio);
  renderer.shadowMap.enabled = tier.shadows;
  (container || document.body).appendChild(renderer.domElement);

  const state = { renderer, tier, detected, composer: null, bloom: null, grade: null, fxaa: null, scene: null, camera: null };
  state.setup = (scene, camera) => {
    state.scene = scene; state.camera = camera;
    if (!tier.post) { state.resize(); return; }
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    if (tier.bloom) {
      state.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.35, 0.6, 0.85);
      composer.addPass(state.bloom);
    }
    composer.addPass(new OutputPass());
    state.grade = new ShaderPass(GradeShader);
    composer.addPass(state.grade);
    if (tier.aa) { state.fxaa = new ShaderPass(FXAAShader); composer.addPass(state.fxaa); }
    state.composer = composer;
    state.resize();
  };
  state.resize = () => {
    const el = renderer.domElement.parentElement || document.body;
    const w = el.clientWidth || globalThis.innerWidth, h = el.clientHeight || globalThis.innerHeight;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = '100%'; renderer.domElement.style.height = '100%';
    if (state.camera) { state.camera.aspect = w / h; state.camera.updateProjectionMatrix(); }
    if (state.composer) {
      state.composer.setSize(w, h);
      const pr = renderer.getPixelRatio();
      if (state.fxaa) state.fxaa.material.uniforms.resolution.value.set(1 / (w * pr), 1 / (h * pr));
    }
  };
  state.render = (time = 0) => {
    if (state.grade) state.grade.uniforms.time.value = time % 100;
    if (state.composer) state.composer.render();
    else renderer.render(state.scene, state.camera);
  };
  state.stats = () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, tier: tier.name, gpu: detected.gpu });
  if (typeof window !== 'undefined') window.addEventListener('resize', () => state.resize());
  return state;
}
