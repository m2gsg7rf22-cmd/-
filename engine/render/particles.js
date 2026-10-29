// CPU-simulated, GPU-rendered particle system (one Points draw per system) with soft
// round sprites, additive or alpha blending, colour/size over life, gravity and drag.
// Presets: sparks, dust, smoke, fire, magic, splash, debris, confetti, trail.
import * as THREE from '../vendor/three/three.module.js';

const PRESETS = {
  sparks: { count: 18, speed: [4, 10], life: [0.25, 0.55], size: [0.08, 0.16], gravity: -14, drag: 1.5, colors: [0xfff2b0, 0xff8a2a], additive: true, spread: 1 },
  hit: { count: 14, speed: [2, 6], life: [0.15, 0.35], size: [0.15, 0.3], gravity: 0, drag: 4, colors: [0xffffff, 0x9adfff], additive: true, spread: 1 },
  dust: { count: 10, speed: [0.6, 2], life: [0.5, 1.1], size: [0.4, 0.9], gravity: 0.6, drag: 2, colors: [0xb8a888, 0x8a7a60], additive: false, spread: 1, up: 0.3, opacity: 0.45 },
  smoke: { count: 6, speed: [0.5, 1.5], life: [1.2, 2.2], size: [0.8, 1.8], gravity: 1.2, drag: 1, colors: [0x6a6a6a, 0x2a2a2a], additive: false, spread: 0.4, up: 1, opacity: 0.5, grow: 2.2 },
  fire: { count: 8, speed: [0.5, 1.6], life: [0.4, 0.8], size: [0.3, 0.6], gravity: 3, drag: 1, colors: [0xffd060, 0xff3a0a], additive: true, spread: 0.3, up: 1 },
  magic: { count: 24, speed: [1, 4], life: [0.4, 1.0], size: [0.1, 0.22], gravity: 1, drag: 2, colors: [0x9adfff, 0xb06aff], additive: true, spread: 1 },
  splash: { count: 20, speed: [2, 6], life: [0.4, 0.8], size: [0.12, 0.25], gravity: -12, drag: 0.5, colors: [0xe8f6ff, 0x9ad0f0], additive: false, spread: 0.5, up: 1.4, opacity: 0.8 },
  debris: { count: 12, speed: [3, 8], life: [0.6, 1.2], size: [0.1, 0.22], gravity: -18, drag: 0.3, colors: [0x5a5048, 0x8a8070], additive: false, spread: 1, up: 0.8 },
  confetti: { count: 60, speed: [3, 9], life: [1.2, 2.4], size: [0.1, 0.18], gravity: -6, drag: 1.2, colors: [0xff4a6a, 0x4ad0ff, 0xffd04a, 0x6aff8a], additive: false, spread: 0.6, up: 1.6 },
  trail: { count: 1, speed: [0, 0.2], life: [0.3, 0.5], size: [0.25, 0.35], gravity: 0, drag: 0, colors: [0x9adfff, 0x4a6aff], additive: true, spread: 1 },
  tireSmoke: { count: 2, speed: [0.3, 1], life: [0.8, 1.6], size: [0.6, 1.2], gravity: 0.8, drag: 1.2, colors: [0xd0d0d0, 0x9a9a9a], additive: false, spread: 0.6, up: 0.4, opacity: 0.35, grow: 2.5 },
  muzzle: { count: 7, speed: [0.6, 3.5], life: [0.03, 0.07], size: [0.1, 0.26], gravity: 0, drag: 10, colors: [0xfff3c8, 0xff9a3a], additive: true, spread: 0.3 },
  impact: { count: 5, speed: [0.8, 2.5], life: [0.25, 0.6], size: [0.08, 0.2], gravity: -3, drag: 3, colors: [0xb0a490, 0x7a7060], additive: false, spread: 0.5, opacity: 0.6, grow: 1.5 },
  blood: { count: 8, speed: [1, 3.5], life: [0.2, 0.45], size: [0.05, 0.12], gravity: -9, drag: 1.5, colors: [0x8a0a0a, 0x4a0505], additive: false, spread: 0.6, opacity: 0.9 },
  heal: { count: 16, speed: [0.5, 1.5], life: [0.6, 1.2], size: [0.12, 0.2], gravity: 2, drag: 1, colors: [0x6aff9a, 0xd0ffd0], additive: true, spread: 0.6, up: 1 },
};

export class ParticleSystem {
  constructor(scene, { max = 2000, additive = true, opacity = 1 } = {}) {
    this.max = max; this.n = 0;
    this.pos = new Float32Array(max * 3); this.vel = new Float32Array(max * 3); this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max); this.life = new Float32Array(max); this.age = new Float32Array(max); this.alpha = new Float32Array(max);
    this.meta = new Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, vertexColors: true,
      uniforms: { uScale: { value: 600 }, uOpacity: { value: opacity } },
      vertexShader: `attribute float size; attribute float alpha; varying vec3 vC; varying float vA; uniform float uScale;
        void main(){ vC = color; vA = alpha; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * uScale / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying vec3 vC; varying float vA; uniform float uOpacity;
        void main(){ vec2 d = gl_PointCoord - 0.5; float r = length(d); if (r > 0.5) discard; float a = smoothstep(0.5, 0.1, r) * vA * uOpacity; gl_FragColor = vec4(vC, a); }`,
    });
    this.points = new THREE.Points(g, this.material); this.points.frustumCulled = false; this.points.renderOrder = 5;
    scene.add(this.points);
  }
  spawn(p, v, color, size, life, meta) {
    let i;
    if (this.n < this.max) i = this.n++; else { i = Math.floor(Math.random() * this.max); }
    this.pos.set([p.x, p.y, p.z], i * 3); this.vel.set([v.x, v.y, v.z], i * 3); this.col.set([color.r, color.g, color.b], i * 3);
    this.size[i] = size; this.life[i] = life; this.age[i] = 0; this.alpha[i] = 1; this.meta[i] = meta;
  }
  update(dt) {
    let i = 0;
    while (i < this.n) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) { this._kill(i); continue; }
      const m = this.meta[i], t = this.age[i] / this.life[i];
      const k = i * 3, drag = Math.exp(-m.drag * dt);
      this.vel[k] *= drag; this.vel[k + 1] = this.vel[k + 1] * drag + m.gravity * dt; this.vel[k + 2] *= drag;
      this.pos[k] += this.vel[k] * dt; this.pos[k + 1] += this.vel[k + 1] * dt; this.pos[k + 2] += this.vel[k + 2] * dt;
      if (m.ground !== undefined && this.pos[k + 1] < m.ground) { this.pos[k + 1] = m.ground; this.vel[k + 1] *= -0.3; }
      this.alpha[i] = (1 - t) * (m.opacity ?? 1) * Math.min(1, t * 8 + 0.2);
      this.size[i] = m.size0 * (1 + (m.grow || 0) * t);
      const c0 = m.c0, c1 = m.c1; this.col[k] = c0.r + (c1.r - c0.r) * t; this.col[k + 1] = c0.g + (c1.g - c0.g) * t; this.col[k + 2] = c0.b + (c1.b - c0.b) * t;
      i++;
    }
    const g = this.points.geometry; g.setDrawRange(0, this.n);
    for (const a of ['position', 'color', 'size', 'alpha']) g.attributes[a].needsUpdate = true;
  }
  _kill(i) {
    const last = --this.n; if (i === last) return;
    this.pos.copyWithin(i * 3, last * 3, last * 3 + 3); this.vel.copyWithin(i * 3, last * 3, last * 3 + 3); this.col.copyWithin(i * 3, last * 3, last * 3 + 3);
    this.size[i] = this.size[last]; this.life[i] = this.life[last]; this.age[i] = this.age[last]; this.alpha[i] = this.alpha[last]; this.meta[i] = this.meta[last];
  }
}

// Manages one additive and one alpha system; emit(preset, position, opts)
export class VFX {
  constructor(scene) { this.add = new ParticleSystem(scene, { additive: true }); this.alpha = new ParticleSystem(scene, { additive: false }); this.emitted = 0; }
  emit(name, position, { count, direction = null, color, scale = 1, ground } = {}) {
    const p = PRESETS[name]; if (!p) throw new Error('unknown vfx ' + name);
    const sys = p.additive ? this.add : this.alpha;
    const n = Math.round((count ?? p.count) * (scale > 1 ? Math.sqrt(scale) : 1));
    const c0 = new THREE.Color(color ?? p.colors[0]), c1 = new THREE.Color(p.colors[1] ?? p.colors[0]);
    for (let i = 0; i < n; i++) {
      const sp = (p.speed[0] + Math.random() * (p.speed[1] - p.speed[0])) * scale;
      let v = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize();
      if (p.up) v.y = Math.abs(v.y) * p.up + p.up * 0.5;
      if (direction) v.lerp(direction, 1 - p.spread * 0.5).normalize();
      v.multiplyScalar(sp);
      const life = p.life[0] + Math.random() * (p.life[1] - p.life[0]);
      const size = (p.size[0] + Math.random() * (p.size[1] - p.size[0])) * scale;
      const cc = p.colors.length > 2 ? new THREE.Color(p.colors[i % p.colors.length]) : c0;
      sys.spawn(position, v, cc, size, life, { drag: p.drag, gravity: p.gravity, c0: cc, c1: p.colors.length > 2 ? cc : c1, size0: size, grow: p.grow, opacity: p.opacity, ground });
    }
    this.emitted += n;
  }
  update(dt) { this.add.update(dt); this.alpha.update(dt); }
}
export const VFX_PRESETS = Object.keys(PRESETS);
