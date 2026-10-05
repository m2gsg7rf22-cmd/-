import * as THREE from 'three';
import { mulberry32 } from '../core/noise';

const skyVert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww; // always at far plane
}
`;

const skyFrag = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uSunDir;
uniform float uNight;
uniform vec3 uSunsetColor;
uniform float uSunset;
varying vec3 vDir;

float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

// Square sun/moon in a basis aligned to the body direction.
float squareBody(vec3 dir, vec3 bodyDir, float size) {
  float d = dot(dir, bodyDir);
  if (d <= 0.0) return 0.0;
  vec3 up = abs(bodyDir.y) > 0.99 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
  vec3 u = normalize(cross(up, bodyDir));
  vec3 v = cross(bodyDir, u);
  vec2 p = vec2(dot(dir, u), dot(dir, v)) / d;
  return step(max(abs(p.x), abs(p.y)), size);
}

void main() {
  vec3 dir = normalize(vDir);
  float h = clamp(dir.y, -1.0, 1.0);
  float t = pow(clamp(h, 0.0, 1.0), 0.55);
  vec3 col = mix(uHorizon, uTop, t);
  // Below horizon: slightly darker horizon color (sea of fog).
  if (h < 0.0) col = mix(uHorizon, uHorizon * 0.75, clamp(-h * 3.0, 0.0, 1.0));

  // Sunset glow toward the sun.
  float sd = max(dot(dir, uSunDir), 0.0);
  float glowBand = (1.0 - abs(h)) ;
  col = mix(col, uSunsetColor, uSunset * pow(sd, 6.0) * glowBand * 0.85);
  col += vec3(1.0, 0.9, 0.7) * pow(sd, 64.0) * 0.35 * (1.0 - uNight);

  // Stars.
  if (uNight > 0.01 && h > 0.0) {
    vec3 cell = floor(dir * 220.0);
    float s = hash(cell);
    float star = step(0.9965, s) * (0.5 + 0.5 * hash(cell + 3.1));
    col += vec3(star) * uNight * smoothstep(0.0, 0.25, h);
  }

  // Sun and moon.
  float sun = squareBody(dir, uSunDir, 0.07);
  col = mix(col, vec3(1.0, 0.96, 0.82), sun);
  float sunHalo = squareBody(dir, uSunDir, 0.11) * (1.0 - sun);
  col = mix(col, vec3(1.0, 0.85, 0.6), sunHalo * 0.25);
  float moon = squareBody(dir, -uSunDir, 0.05);
  float crater = squareBody(normalize(dir + vec3(0.012, 0.01, 0.0)), -uSunDir, 0.018);
  col = mix(col, vec3(0.86, 0.88, 0.95) - crater * 0.15, moon);

  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

const cloudVert = /* glsl */ `
varying vec2 vUv;
varying float vDist;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vDist = length(mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;
const cloudFrag = /* glsl */ `
uniform sampler2D map;
uniform vec2 uOffset;
uniform vec3 uColor;
uniform float uFar;
varying vec2 vUv;
varying float vDist;
void main() {
  float a = texture2D(map, vUv + uOffset).a;
  if (a < 0.5) discard;
  float fade = 1.0 - smoothstep(uFar * 0.5, uFar, vDist);
  gl_FragColor = vec4(uColor, 0.82 * fade);
  #include <colorspace_fragment>
}
`;

function cloudTexture(): THREE.Texture {
  const N = 128;
  const c = document.createElement('canvas');
  c.width = N;
  c.height = N;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(N, N);
  const r = mulberry32(4242);
  // Seed blobs and grow them into blocky clusters.
  const grid = new Uint8Array(N * N);
  for (let k = 0; k < 70; k++) {
    const cx = Math.floor(r() * N);
    const cy = Math.floor(r() * N);
    const w = 3 + Math.floor(r() * 10);
    const h = 2 + Math.floor(r() * 6);
    for (let y = -h; y <= h; y++) for (let x = -w; x <= w; x++) {
      if ((x * x) / (w * w) + (y * y) / (h * h) > 1 + r() * 0.3) continue;
      grid[((cy + y + N) % N) * N + ((cx + x + N) % N)] = 1;
    }
  }
  for (let i = 0; i < N * N; i++) {
    img.data[i * 4] = 255;
    img.data[i * 4 + 1] = 255;
    img.data[i * 4 + 2] = 255;
    img.data[i * 4 + 3] = grid[i] ? 255 : 0;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  return tex;
}

function lerpColor(out: THREE.Color, a: THREE.Color, b: THREE.Color, t: number): THREE.Color {
  return out.copy(a).lerp(b, t);
}

const DAY_TOP = new THREE.Color(0.32, 0.56, 0.9);
const DAY_HORIZON = new THREE.Color(0.72, 0.84, 0.96);
const NIGHT_TOP = new THREE.Color(0.012, 0.018, 0.05);
const NIGHT_HORIZON = new THREE.Color(0.04, 0.06, 0.12);
const SUNSET = new THREE.Color(0.98, 0.52, 0.28);
const WARM_LIGHT = new THREE.Color(1.0, 0.8, 0.62);
const DAY_LIGHT = new THREE.Color(1.0, 0.98, 0.94);
const MOON_LIGHT = new THREE.Color(0.55, 0.62, 0.9);
const CLOUD_DAY = new THREE.Color(1, 1, 1);
const CLOUD_NIGHT = new THREE.Color(0.12, 0.13, 0.18);
const CLOUD_SIZE = 1536;
const CLOUD_Y = 150;

export interface SkyState {
  /** 0..1 how "day" it is. */
  day: number;
  /** Fog/horizon color. */
  horizon: THREE.Color;
  /** Light color for blocks. */
  light: THREE.Color;
  /** Daylight brightness multiplier. */
  brightness: number;
  sunDir: THREE.Vector3;
}

export class Sky {
  readonly group = new THREE.Group();
  private dome: THREE.Mesh;
  private skyMat: THREE.ShaderMaterial;
  private clouds: THREE.Mesh;
  private cloudMat: THREE.ShaderMaterial;
  readonly state: SkyState = {
    day: 1,
    horizon: new THREE.Color(),
    light: new THREE.Color(),
    brightness: 1,
    sunDir: new THREE.Vector3(),
  };
  private tmp = new THREE.Color();

  constructor() {
    this.skyMat = new THREE.ShaderMaterial({
      uniforms: {
        uTop: { value: new THREE.Color() },
        uHorizon: { value: new THREE.Color() },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uNight: { value: 0 },
        uSunsetColor: { value: SUNSET.clone() },
        uSunset: { value: 0 },
      },
      vertexShader: skyVert,
      fragmentShader: skyFrag,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), this.skyMat);
    this.dome.renderOrder = -10;
    this.dome.frustumCulled = false;
    this.group.add(this.dome);

    this.cloudMat = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: cloudTexture() },
        uOffset: { value: new THREE.Vector2() },
        uColor: { value: new THREE.Color(1, 1, 1) },
        uFar: { value: 600 },
      },
      vertexShader: cloudVert,
      fragmentShader: cloudFrag,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const cg = new THREE.PlaneGeometry(CLOUD_SIZE, CLOUD_SIZE);
    cg.rotateX(-Math.PI / 2);
    this.clouds = new THREE.Mesh(cg, this.cloudMat);
    this.clouds.renderOrder = 2;
    this.clouds.frustumCulled = false;
    this.group.add(this.clouds);
  }

  set cloudsVisible(v: boolean) {
    this.clouds.visible = v;
  }

  /**
   * Update for time of day t in [0,1): 0 = sunrise, 0.25 = noon, 0.5 = sunset, 0.75 = midnight.
   */
  update(t: number, camPos: THREE.Vector3, elapsed: number, viewDist: number): void {
    const a = t * Math.PI * 2;
    const sunDir = this.state.sunDir.set(Math.cos(a), Math.sin(a), 0.25).normalize();
    const sunY = sunDir.y;
    const day = THREE.MathUtils.smoothstep(sunY, -0.18, 0.22);
    const sunset = Math.max(0, 1 - Math.abs(sunY) / 0.35);
    this.state.day = day;

    const u = this.skyMat.uniforms;
    lerpColor(u.uTop.value, NIGHT_TOP, DAY_TOP, day);
    lerpColor(u.uHorizon.value, NIGHT_HORIZON, DAY_HORIZON, day);
    (u.uHorizon.value as THREE.Color).lerp(SUNSET, sunset * 0.45 * Math.max(day, 0.3));
    u.uSunDir.value.copy(sunDir);
    u.uNight.value = 1 - day;
    u.uSunset.value = sunset;

    this.state.horizon.copy(u.uHorizon.value);
    lerpColor(this.state.light, MOON_LIGHT, DAY_LIGHT, day);
    this.state.light.lerp(WARM_LIGHT, sunset * 0.6 * day);
    this.state.brightness = THREE.MathUtils.lerp(0.16, 1.0, day);

    this.dome.position.copy(camPos);

    // Clouds: world-locked drift, plane recentered on camera.
    const cu = this.cloudMat.uniforms;
    const drift = elapsed * 1.2;
    this.clouds.position.set(camPos.x, CLOUD_Y, camPos.z);
    cu.uOffset.value.set((camPos.x + drift) / CLOUD_SIZE, -camPos.z / CLOUD_SIZE);
    lerpColor(cu.uColor.value, CLOUD_NIGHT, CLOUD_DAY, day);
    (cu.uColor.value as THREE.Color).lerp(this.tmp.set(1, 0.75, 0.6), sunset * 0.4 * day);
    cu.uFar.value = Math.max(300, viewDist * 2.2);
  }

  dispose(): void {
    this.dome.geometry.dispose();
    this.skyMat.dispose();
    this.clouds.geometry.dispose();
    (this.cloudMat.uniforms.map.value as THREE.Texture).dispose();
    this.cloudMat.dispose();
  }
}
