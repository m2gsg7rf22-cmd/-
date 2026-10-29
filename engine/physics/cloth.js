// Position-based (Verlet) cloth for flags, capes, banners, curtains, tarps and loose garments.
// A rectangular particle grid with structural / shear / bend constraints, pinned particles that
// follow any Object3D (a bone, a pole, a door), wind with gusts + per-triangle aerodynamic drag,
// sphere / capsule / plane colliders (capsules from a character's bones keep a cape off the
// body) and a fixed-substep solver, so it is deterministic and frame-rate independent.
//
//   const flag = new Cloth({ width: 1.6, height: 1.0, segX: 24, segY: 16, material, pin: 'left' });
//   flag.pinTo(pole, ...)  · flag.wind.set(4, 0, 1) · scene.add(flag.mesh) · per frame: flag.update(dt)
//   const cape = Cloth.cape(human, { length: 1.1 })   // pinned across the shoulders, body capsules
import * as THREE from '../vendor/three/three.module.js';

const _v = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _n = new THREE.Vector3();

export class Cloth {
  /**
   * opts: width, height (m), segX, segY, mass (kg total), stiffness 0..1 (stretch), bend 0..1, damping,
   * iterations, substep (s), gravity, wind (Vector3, m/s), gust (0..1), drag, lift, thickness (collision margin),
   * pin: 'top' | 'left' | 'corners' | [indices] | null, material, doubleSided, frame: Matrix4 (initial placement; grid lies in its XY plane, +Y up)
   */
  constructor({ width = 1, height = 1, segX = 20, segY = 20, mass = 0.4, stiffness = 1, bend = 0.25, damping = 0.6, iterations = 2, substep = 1 / 240,
    gravity = new THREE.Vector3(0, -9.81, 0), wind = new THREE.Vector3(), gust = 0.35, drag = 0.9, skin = 0.25, thickness = 0.02, pin = 'top', material = null, frame = null, seed = 1 } = {}) {
    Object.assign(this, { width, height, segX, segY, stiffness, bend, damping, iterations, substep, gravity: gravity.clone(), wind: wind.clone(), gust, drag, skin, thickness });
    const nx = segX + 1, ny = segY + 1, n = nx * ny; this.nx = nx; this.ny = ny; this.count = n;
    this.pos = new Float32Array(n * 3); this.prev = new Float32Array(n * 3); this.invMass = new Float32Array(n).fill(n / mass);
    const m = frame || new THREE.Matrix4();
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      // tiny seeded out-of-plane noise breaks the perfectly flat (unstable) equilibrium so the sheet can fold
      const k = j * nx + i, jit = (Math.sin((k + 1) * 12.9898 + seed * 78.233) * 43758.5453 % 1) * 0.002 * Math.min(width, height);
      _v.set((i / segX - 0.5) * width, -(j / segY) * height, jit).applyMatrix4(m);
      this.pos.set([_v.x, _v.y, _v.z], k * 3);
    }
    this.prev.set(this.pos); this._rest = this.pos.slice(); this.tetherSlack = 0.03;
    // constraints: [a, b, restLength, compliance-weight]
    const C = []; const add = (a, b, w) => C.push(a, b, Math.hypot(this.pos[a * 3] - this.pos[b * 3], this.pos[a * 3 + 1] - this.pos[b * 3 + 1], this.pos[a * 3 + 2] - this.pos[b * 3 + 2]), w);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      if (i < segX) add(k, k + 1, 1); if (j < segY) add(k, k + nx, 1);
      if (i < segX && j < segY) { add(k, k + nx + 1, 0.7); add(k + 1, k + nx, 0.7); }
      if (i < segX - 1) add(k, k + 2, -1); if (j < segY - 1) add(k, k + 2 * nx, -1); // bend (weight -1 → uses this.bend)
    }
    this.cons = Float32Array.from(C);
    this.pins = new Map(); // particle → { target: Object3D|null, local: Vector3, world: Vector3 }
    this.colliders = [];   // { type:'sphere', center|object, radius } | { type:'capsule', a, b (Object3D or Vector3), radius } | { type:'plane', normal, d }
    // geometry
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    const uv = new Float32Array(n * 2); for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { uv[(j * nx + i) * 2] = i / segX; uv[(j * nx + i) * 2 + 1] = 1 - j / segY; }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); const idx = [];
    for (let j = 0; j < segY; j++) for (let i = 0; i < segX; i++) { const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1; idx.push(a, c, b, b, c, d); }
    g.setIndex(idx); g.computeVertexNormals(); g.userData.open = true; this.geometry = g;
    this.mesh = new THREE.Mesh(g, material || new THREE.MeshStandardMaterial({ color: 0xa83a2e, roughness: 0.85, side: THREE.DoubleSide }));
    this.mesh.castShadow = true; this.mesh.receiveShadow = true; this.mesh.frustumCulled = false; this.mesh.name = 'cloth';
    this.time = 0; this._acc = 0; this._seed = seed; this.sleeping = false;
    const pinList = pin === 'top' ? [...Array(nx).keys()] : pin === 'left' ? Array.from({ length: ny }, (_, j) => j * nx) : pin === 'corners' ? [0, segX] : Array.isArray(pin) ? pin : [];
    for (const k of pinList) this.pin(k);
  }
  index(i, j) { return j * this.nx + i; }
  /** Pin particle k to its current world position, or to `target` (Object3D) keeping the current offset in its local frame. */
  pin(k, target = null) {
    const w = new THREE.Vector3().fromArray(this.pos, k * 3); let local = null;
    if (target) { target.updateWorldMatrix(true, false); local = target.worldToLocal(w.clone()); }
    this.pins.set(k, { target, local, world: w }); this.invMass[k] = 0; this._tethers = null; return this;
  }
  /** Re-attach every current pin to `target` (e.g. a flag pole or a bone) keeping offsets. */
  pinTo(target) { for (const k of [...this.pins.keys()]) this.pin(k, target); return this; }
  unpin(k) { this.pins.delete(k); this.invMass[k] = this.count / 0.4; this._tethers = null; return this; }
  // long-range attachments: every free particle may not drift further from its nearest pin than in the
  // rest pose (+ `tetherSlack`) — removes the rubbery stretch of iterative solvers at almost no cost
  _buildTethers() {
    const R = this._rest, pins = [...this.pins.keys()], T = new Float32Array(this.count * 2).fill(-1);
    if (pins.length) for (let k = 0; k < this.count; k++) {
      if (this.pins.has(k)) continue; let best = -1, bd = Infinity;
      for (const p of pins) { const d = Math.hypot(R[k * 3] - R[p * 3], R[k * 3 + 1] - R[p * 3 + 1], R[k * 3 + 2] - R[p * 3 + 2]); if (d < bd) { bd = d; best = p; } }
      T[k * 2] = best; T[k * 2 + 1] = bd;
    }
    this._tethers = T;
  }
  addSphere(center, radius) { this.colliders.push({ type: 'sphere', center, radius }); return this; }
  addCapsule(a, b, radius) { this.colliders.push({ type: 'capsule', a, b, radius }); return this; }
  addPlane(normal = new THREE.Vector3(0, 1, 0), d = 0) { this.colliders.push({ type: 'plane', normal: normal.clone().normalize(), d }); return this; }

  update(dt) {
    this._acc = Math.min(this._acc + Math.max(0, dt), this.substep * 16);
    this._forces(); // wind/drag once per frame, applied in every substep
    while (this._acc >= this.substep) { this._step(this.substep); this._acc -= this.substep; }
    this.geometry.attributes.position.needsUpdate = true; this.geometry.computeVertexNormals(); this.geometry.computeBoundingSphere();
  }
  _forces() {
    const P = this.pos, Q = this.prev, n = this.count;
    // forces: gravity + wind drag/lift per triangle (relative air velocity along the normal)
    const F = this._F || (this._F = new Float32Array(n * 3)); F.fill(0);
    const t = this.time + this._acc, g = 1 + this.gust * (Math.sin(t * 1.7 + this._seed) * 0.6 + Math.sin(t * 4.3 + this._seed * 2) * 0.4);
    const wx = this.wind.x * g, wy = this.wind.y * g, wz = this.wind.z * g, I = this.geometry.index.array;
    if (wx || wy || wz || this.drag) for (let k = 0; k < I.length; k += 3) {
      const a = I[k], b = I[k + 1], c = I[k + 2];
      _a.set(P[b * 3] - P[a * 3], P[b * 3 + 1] - P[a * 3 + 1], P[b * 3 + 2] - P[a * 3 + 2]); _b.set(P[c * 3] - P[a * 3], P[c * 3 + 1] - P[a * 3 + 1], P[c * 3 + 2] - P[a * 3 + 2]);
      _n.crossVectors(_a, _b); const area2 = _n.length(); if (area2 < 1e-10) continue; _n.multiplyScalar(1 / area2);
      // triangle velocity
      const vx = (P[a * 3] - Q[a * 3] + P[b * 3] - Q[b * 3] + P[c * 3] - Q[c * 3]) / (3 * this.substep), vy = (P[a * 3 + 1] - Q[a * 3 + 1] + P[b * 3 + 1] - Q[b * 3 + 1] + P[c * 3 + 1] - Q[c * 3 + 1]) / (3 * this.substep), vz = (P[a * 3 + 2] - Q[a * 3 + 2] + P[b * 3 + 2] - Q[b * 3 + 2] + P[c * 3 + 2] - Q[c * 3 + 2]) / (3 * this.substep);
      const rx = wx - vx, ry = wy - vy, rz = wz - vz, vn = rx * _n.x + ry * _n.y + rz * _n.z;
      const f = 0.5 * 1.2 * area2 * 0.5 * vn * Math.abs(vn) * this.drag / 3; // ½ρ|v|² · A · Cd, split over 3 vertices
      const tx = rx - _n.x * vn, ty = ry - _n.y * vn, tz = rz - _n.z * vn, ts = 0.5 * 1.2 * area2 * 0.5 * Math.hypot(tx, ty, tz) * this.skin / 3; // skin friction along the sheet
      const fx = _n.x * f + tx * ts, fy = _n.y * f + ty * ts, fz = _n.z * f + tz * ts;
      F[a * 3] += fx; F[a * 3 + 1] += fy; F[a * 3 + 2] += fz; F[b * 3] += fx; F[b * 3 + 1] += fy; F[b * 3 + 2] += fz; F[c * 3] += fx; F[c * 3 + 1] += fy; F[c * 3 + 2] += fz;
    }
  }
  _point(p, out) { return p.isObject3D ? p.getWorldPosition(out) : out.copy(p); }
  _step(h) {
    const P = this.pos, Q = this.prev, W = this.invMass, n = this.count, F = this._F; this.time += h;
    // pins follow their targets
    for (const [k, p] of this.pins) { if (p.target) { p.target.updateWorldMatrix(true, false); _v.copy(p.local).applyMatrix4(p.target.matrixWorld); } else _v.copy(p.world); P[k * 3] = _v.x; P[k * 3 + 1] = _v.y; P[k * 3 + 2] = _v.z; Q[k * 3] = _v.x; Q[k * 3 + 1] = _v.y; Q[k * 3 + 2] = _v.z; }
    // integrate
    const damp = Math.exp(-this.damping * h), gx = this.gravity.x * h * h, gy = this.gravity.y * h * h, gz = this.gravity.z * h * h;
    for (let k = 0; k < n; k++) {
      const w = W[k]; if (!w) continue; const o = k * 3;
      const fw = w * h * h, x0 = P[o], x1 = P[o + 1], x2 = P[o + 2];
      P[o] = x0 + (x0 - Q[o]) * damp + gx + F[o] * fw; P[o + 1] = x1 + (x1 - Q[o + 1]) * damp + gy + F[o + 1] * fw; P[o + 2] = x2 + (x2 - Q[o + 2]) * damp + gz + F[o + 2] * fw;
      Q[o] = x0; Q[o + 1] = x1; Q[o + 2] = x2;
    }
    // constraints
    const C = this.cons, bendW = this.bend, stiff = this.stiffness;
    for (let it = 0; it < this.iterations; it++) {
      for (let q = 0; q < C.length; q += 4) {
        const a = C[q], b = C[q + 1], rest = C[q + 2], wt = C[q + 3] < 0 ? bendW : C[q + 3] * stiff;
        const wa = W[a], wb = W[b], ws = wa + wb; if (!ws) continue;
        const dx = P[b * 3] - P[a * 3], dy = P[b * 3 + 1] - P[a * 3 + 1], dz = P[b * 3 + 2] - P[a * 3 + 2], d = Math.sqrt(dx * dx + dy * dy + dz * dz); if (d < 1e-9) continue;
        if (C[q + 3] < 0 && d < rest) continue; // bend springs only resist folding apart → allows draping
        const s = ((d - rest) / (d * ws)) * wt;
        P[a * 3] += dx * s * wa; P[a * 3 + 1] += dy * s * wa; P[a * 3 + 2] += dz * s * wa;
        P[b * 3] -= dx * s * wb; P[b * 3 + 1] -= dy * s * wb; P[b * 3 + 2] -= dz * s * wb;
      }
      this._collide();
    }
    if (!this._tethers) this._buildTethers();
    const TT = this._tethers, sl = 1 + this.tetherSlack;
    for (let k = 0; k < n; k++) {
      const p = TT[k * 2]; if (p < 0) continue; const max = TT[k * 2 + 1] * sl, o = k * 3, po = p * 3;
      const dx = P[o] - P[po], dy = P[o + 1] - P[po + 1], dz = P[o + 2] - P[po + 2], d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > max) { const s2 = max / d; P[o] = P[po] + dx * s2; P[o + 1] = P[po + 1] + dy * s2; P[o + 2] = P[po + 2] + dz * s2; }
    }
  }
  _collide() {
    const P = this.pos, W = this.invMass, th = this.thickness;
    for (const c of this.colliders) {
      if (c.type === 'plane') { for (let k = 0; k < this.count; k++) { if (!W[k]) continue; const o = k * 3, d = P[o] * c.normal.x + P[o + 1] * c.normal.y + P[o + 2] * c.normal.z - c.d - th; if (d < 0) { P[o] -= c.normal.x * d; P[o + 1] -= c.normal.y * d; P[o + 2] -= c.normal.z * d; for (let q = 0; q < 3; q++) this.prev[o + q] = P[o + q] - (P[o + q] - this.prev[o + q]) * 0.5; } } continue; } // friction on the plane
      const A = this._point(c.type === 'sphere' ? c.center : c.a, c._A || (c._A = new THREE.Vector3())), B = c.type === 'capsule' ? this._point(c.b, c._B || (c._B = new THREE.Vector3())) : A;
      const abx = B.x - A.x, aby = B.y - A.y, abz = B.z - A.z, ab2 = abx * abx + aby * aby + abz * abz, r = c.radius + th;
      for (let k = 0; k < this.count; k++) {
        if (!W[k]) continue; const o = k * 3; let t = 0;
        if (ab2 > 0) t = Math.max(0, Math.min(1, ((P[o] - A.x) * abx + (P[o + 1] - A.y) * aby + (P[o + 2] - A.z) * abz) / ab2));
        const cx = A.x + abx * t, cy = A.y + aby * t, cz = A.z + abz * t, dx = P[o] - cx, dy = P[o + 1] - cy, dz = P[o + 2] - cz, d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < r * r && d2 > 1e-12) { const d = Math.sqrt(d2), s = (r - d) / d; P[o] += dx * s; P[o + 1] += dy * s; P[o + 2] += dz * s; }
      }
    }
  }
  /** Max constraint stretch (rest-relative), for tests/debug. */
  maxStretch() { let m = 0; const C = this.cons, P = this.pos; for (let q = 0; q < C.length; q += 4) { if (C[q + 3] < 0) continue; const a = C[q], b = C[q + 1]; const d = Math.hypot(P[b * 3] - P[a * 3], P[b * 3 + 1] - P[a * 3 + 1], P[b * 3 + 2] - P[a * 3 + 2]); m = Math.max(m, d / C[q + 2] - 1); } return m; }

  /**
   * A cape on a rigged character: pinned along the back of the shoulders to the chest bone, with
   * capsule colliders on spine, upper legs and upper arms so it drapes over the body.
   * Works with realistic humans (MakeHuman bones) and the stylized rig.
   */
  static cape(model, { length = 1.05, width = null, gather = 0.55, segX = 18, segY = 18, material = null, ...opts } = {}) {
    const B = model.userData.bones || {}, get = (...names) => names.map((n) => B[n]).find(Boolean);
    const chest = get('spine01', 'chest'), hips = get('pelvis.L') ? B.root : get('hips', 'root'), neck = get('neck01', 'neck');
    const shL = get('upperarm01.L', 'upperArm_L'), shR = get('upperarm01.R', 'upperArm_R'), legL = get('upperleg01.L', 'upperLeg_L'), legR = get('upperleg01.R', 'upperLeg_R'), knL = get('lowerleg01.L', 'lowerLeg_L'), knR = get('lowerleg01.R', 'lowerLeg_R');
    model.updateMatrixWorld(true);
    const pL = shL.getWorldPosition(new THREE.Vector3()), pR = shR.getWorldPosition(new THREE.Vector3()), q = model.getWorldQuaternion(new THREE.Quaternion());
    const back = new THREE.Vector3(0, 0, -1).applyQuaternion(q), w = width ?? pL.distanceTo(pR) * 2.1;
    const top = pL.clone().add(pR).multiplyScalar(0.5).addScaledVector(back, 0.17).add(new THREE.Vector3(0, 0.04, 0));
    // grid plane: x across the shoulders, hanging down, facing backwards
    const xAxis = pL.clone().sub(pR).normalize(), yAxis = new THREE.Vector3(0, 1, 0), zAxis = new THREE.Vector3().crossVectors(xAxis, yAxis);
    const frame = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis).setPosition(top);
    const cloth = new Cloth({ width: w, height: length, segX, segY, frame, pin: 'top', material: material || new THREE.MeshStandardMaterial({ color: 0x7a1a22, roughness: 0.8, side: THREE.DoubleSide }), mass: 0.9, bend: 0.15, thickness: 0.03, ...opts });
    // gather the top edge to the shoulder line and curve it around the back: the extra rest length becomes folds
    const half = pL.distanceTo(pR) * 0.5 * 1.15;
    for (let i = 0; i <= segX; i++) {
      const k = cloth.index(i, 0), u = (i / segX - 0.5) * 2, p = top.clone().addScaledVector(xAxis, u * half).addScaledVector(back, -0.1 * u * u);
      cloth.pos[k * 3] = p.x; cloth.pos[k * 3 + 1] = p.y; cloth.pos[k * 3 + 2] = p.z; cloth.prev.set(cloth.pos.subarray(k * 3, k * 3 + 3), k * 3);
      cloth.pin(k);
    }
    for (let j = 1; j <= segY; j++) for (let i = 0; i <= segX; i++) { // pull the rest of the sheet in so it starts gathered too
      const k = cloth.index(i, j), f = gather + (1 - gather) * (j / segY);
      const d = new THREE.Vector3().fromArray(cloth.pos, k * 3).sub(top), along = d.dot(xAxis);
      const p = new THREE.Vector3().fromArray(cloth.pos, k * 3).addScaledVector(xAxis, along * (f - 1));
      cloth.pos[k * 3] = p.x; cloth.pos[k * 3 + 1] = p.y; cloth.pos[k * 3 + 2] = p.z; cloth.prev.set(cloth.pos.subarray(k * 3, k * 3 + 3), k * 3);
    }
    cloth.pinTo(chest);
    const sc = (model.userData.height || 1.8) / 1.8;
    if (chest && hips) cloth.addCapsule(neck || chest, hips, 0.13 * sc);
    if (legL && knL) cloth.addCapsule(legL, knL, 0.09 * sc); if (legR && knR) cloth.addCapsule(legR, knR, 0.09 * sc);
    if (shL && shR) { cloth.addCapsule(shL, shR, 0.07 * sc); cloth.addSphere(shL, 0.12 * sc); cloth.addSphere(shR, 0.12 * sc); } // shoulders / pauldrons
    cloth.addPlane(new THREE.Vector3(0, 1, 0), model.getWorldPosition(new THREE.Vector3()).y);
    return cloth;
  }
}
