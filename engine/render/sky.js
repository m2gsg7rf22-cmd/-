// Atmosphere + lighting rig: physically based sky (Preetham via three's Sky), sun with
// camera-following shadow frustum, hemisphere fill, image-based lighting from the sky,
// night stars/moon, fog matched to the horizon, and a day/night cycle.
import * as THREE from '../vendor/three/three.module.js';
import { Sky } from '../vendor/three/addons/objects/Sky.js';
import { RNG } from '../core/rng.js';

export class Atmosphere {
  constructor(scene, renderer, opts = {}) {
    this.scene = scene;
    this.renderer = renderer;
    this.opts = { timeOfDay: 15, dayLength: 0, turbidity: 2.5, rayleigh: 1.2, shadowRange: 60, shadowSize: 2048, fogDensity: 0.0012, sunIntensity: 2.8, stars: true, ...opts };
    this.timeOfDay = this.opts.timeOfDay; // hours 0..24
    this.sky = new Sky();
    this.sky.scale.setScalar(4500);
    const u = this.sky.material.uniforms;
    u.turbidity.value = this.opts.turbidity; u.rayleigh.value = this.opts.rayleigh;
    u.mieCoefficient.value = 0.004; u.mieDirectionalG.value = 0.82;
    scene.add(this.sky);

    this.sun = new THREE.DirectionalLight(0xffffff, this.opts.sunIntensity);
    this.sun.castShadow = true;
    const s = this.sun.shadow;
    s.mapSize.set(this.opts.shadowSize, this.opts.shadowSize);
    const r = this.opts.shadowRange;
    Object.assign(s.camera, { left: -r, right: r, top: r, bottom: -r, near: 1, far: 400 });
    s.bias = -0.0004; s.normalBias = 0.04; s.radius = 2;
    scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xbcd7ff, 0x5a4a38, 0.6);
    scene.add(this.hemi);
    scene.fog = new THREE.FogExp2(0xb8c8d8, this.opts.fogDensity);

    if (this.opts.stars) this._makeStars();
    this.pmrem = renderer ? new THREE.PMREMGenerator(renderer) : null;
    // IBL source: a controlled gradient dome (zenith/horizon/ground + soft sun glow) instead
    // of the raw sky shader, whose HDR sun disk floods every rough surface with white.
    this.envScene = new THREE.Scene();
    this.envDome = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      uniforms: { uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uGround: { value: new THREE.Color() }, uSunDir: { value: new THREE.Vector3() }, uSunCol: { value: new THREE.Color() } },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform vec3 uZenith, uHorizon, uGround, uSunDir, uSunCol; varying vec3 vDir;
        void main(){ float h = vDir.y; vec3 c = h > 0.0 ? mix(uHorizon, uZenith, pow(h, 0.6)) : mix(uHorizon, uGround, pow(-h, 0.4));
          float s = max(dot(normalize(vDir), uSunDir), 0.0); c += uSunCol * (pow(s, 8.0) * 0.6 + pow(s, 64.0) * 1.5);
          gl_FragColor = vec4(c, 1.0); }` }));
    this.envScene.add(this.envDome);
    this.envRT = null;
    this._lastEnvTime = -99;
    this.sunDir = new THREE.Vector3();
    this.follow = new THREE.Vector3();
    this.update(0, true);
  }
  _makeStars() {
    const rng = new RNG(99), n = 1500, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const th = rng.range(0, Math.PI * 2), ph = Math.acos(rng.range(0.05, 1));
      pos.set([Math.sin(ph) * Math.cos(th) * 3000, Math.cos(ph) * 3000, Math.sin(ph) * Math.sin(th) * 3000], i * 3);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    this.scene.add(this.stars);
  }
  setTime(h) { this.timeOfDay = ((h % 24) + 24) % 24; this.update(0, true); }
  get isNight() { return this.daylight < 0.15; }
  update(dt, force = false) {
    if (this.opts.dayLength > 0) this.timeOfDay = (this.timeOfDay + (dt * 24) / this.opts.dayLength) % 24;
    const t = this.timeOfDay;
    const ang = ((t - 6) / 12) * Math.PI; // 6h sunrise, 18h sunset
    const elev = Math.sin(ang) * 72; // degrees
    const azim = 180 + (t - 12) * 15 + (this.opts.sunAzimuth ?? 0);
    const phi = THREE.MathUtils.degToRad(90 - Math.max(elev, -10));
    const theta = THREE.MathUtils.degToRad(azim);
    this.sunDir.setFromSphericalCoords(1, phi, theta);
    this.sky.material.uniforms.sunPosition.value.copy(this.sunDir);
    this.daylight = THREE.MathUtils.smoothstep(elev, -6, 12);
    const warm = 1 - THREE.MathUtils.smoothstep(elev, 4, 30);
    const sunColor = new THREE.Color().setRGB(1, 0.95 - warm * 0.35, 0.88 - warm * 0.55);
    const moon = 1 - this.daylight;
    if (elev > -4) {
      this.sun.color.copy(sunColor);
      this.sun.intensity = this.opts.sunIntensity * THREE.MathUtils.smoothstep(elev, -4, 8);
      this.lightDir = this.sunDir.clone();
    } else {
      this.sun.color.setRGB(0.55, 0.65, 1.0);
      this.sun.intensity = 0.55;
      this.lightDir = this.sunDir.clone().multiplyScalar(-1).setY(Math.abs(this.sunDir.y) + 0.4).normalize();
    }
    this.hemi.intensity = 0.3 + this.daylight * 0.1;
    this.hemi.color.setRGB(0.55 + 0.2 * this.daylight, 0.62 + 0.22 * this.daylight, 0.85 + 0.15 * this.daylight).multiplyScalar(1);
    this.hemi.groundColor.setRGB(0.18 + 0.2 * this.daylight, 0.16 + 0.15 * this.daylight, 0.14 + 0.1 * this.daylight);
    const fogDay = new THREE.Color(0.72, 0.8, 0.88).lerp(new THREE.Color(0.95, 0.68, 0.5), warm * 0.7);
    const fogNight = new THREE.Color(0.04, 0.06, 0.11);
    this.scene.fog.color.copy(fogNight.lerp(fogDay, this.daylight));
    if (this.stars) { this.stars.material.opacity = moon * 0.9; this.stars.visible = moon > 0.02; }
    if (this.renderer) this.renderer.toneMappingExposure = (this.opts.exposure ?? 1) * (0.5 + 0.38 * this.daylight + 0.3 * moon);
    if (this.pmrem && (force || Math.abs(t - this._lastEnvTime) > 0.25)) this._updateEnv();
    this._placeShadow();
  }
  _updateEnv() {
    this._lastEnvTime = this.timeOfDay;
    const u = this.envDome.material.uniforms, d = this.daylight, warm = 1 - THREE.MathUtils.smoothstep(this.sunDir.y * 72, 4, 30);
    u.uZenith.value.setRGB(0.18 + 0.12 * d, 0.32 + 0.2 * d, 0.62 + 0.25 * d).multiplyScalar(0.15 + 0.85 * d);
    u.uHorizon.value.setRGB(0.62 + 0.3 * warm, 0.66 + 0.1 * warm, 0.72 - 0.2 * warm).multiplyScalar(0.12 + 0.88 * d);
    u.uGround.value.setRGB(0.22, 0.2, 0.17).multiplyScalar(0.15 + 0.85 * d);
    u.uSunDir.value.copy(this.sunDir); u.uSunCol.value.copy(this.sun.color).multiplyScalar(d);
    if (this.envRT) this.envRT.dispose();
    this.envRT = this.pmrem.fromScene(this.envScene, 0, 0.1, 2000);
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = 0.2 + 0.4 * this.daylight;
  }
  // Keep the shadow frustum centred on the focus point, snapped to shadow texels.
  setFocus(v) { this.follow.copy(v); this._placeShadow(); }
  _placeShadow() {
    const cam = this.sun.shadow.camera;
    const texel = (cam.right - cam.left) / this.sun.shadow.mapSize.x;
    const f = this.follow;
    const fx = Math.round(f.x / texel) * texel, fz = Math.round(f.z / texel) * texel;
    this.sun.target.position.set(fx, f.y, fz);
    this.sun.position.copy(this.lightDir || this.sunDir).multiplyScalar(150).add(this.sun.target.position);
    this.sun.target.updateMatrixWorld();
  }
}
