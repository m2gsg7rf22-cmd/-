// Light pooling: many light "anchors" (street lamps, torches, windows) but only N real
// PointLights, re-assigned to the anchors nearest the focus point. Gives lit streets at
// night at a fixed GPU cost. Lights fade with daylight.
import * as THREE from '../vendor/three/three.module.js';

export class LightPool {
  constructor(scene, anchors, { count = 6, color = 0xffc98a, intensity = 25, distance = 18, decay = 1.6, nightOnly = true } = {}) {
    this.anchors = anchors.map((a) => (a.isVector3 ? a : new THREE.Vector3(...a)));
    this.lights = Array.from({ length: count }, () => { const l = new THREE.PointLight(color, 0, distance, decay); scene.add(l); return l; });
    Object.assign(this, { intensity, nightOnly, timer: 0, assigned: [] });
  }
  update(dt, focus, daylight = 0) {
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = 0.3;
      const sorted = this.anchors.map((a) => [a, a.distanceToSquared(focus)]).sort((x, y) => x[1] - y[1]).slice(0, this.lights.length);
      this.assigned = sorted.map((s) => s[0]);
      this.lights.forEach((l, i) => { if (this.assigned[i]) l.position.copy(this.assigned[i]); });
    }
    const k = this.nightOnly ? Math.max(0, 1 - daylight * 1.6) : 1;
    for (let i = 0; i < this.lights.length; i++) this.lights[i].intensity = this.assigned[i] ? this.intensity * k : 0;
  }
}
