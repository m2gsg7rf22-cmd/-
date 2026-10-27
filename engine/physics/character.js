// Kinematic character controller: acceleration-based movement, coyote time, jump
// buffering, step-up onto ledges, slope limits with sliding, wall collision via the
// PhysicsWorld, swimming at water level, knockback, and optional wall-run/glide hooks.
import * as THREE from '../vendor/three/three.module.js';
import { damp } from '../core/rng.js';

export class CharacterController {
  constructor(world, { position = new THREE.Vector3(), radius = 0.35, height = 1.8, walkSpeed = 2.0, runSpeed = 5.0, sprintSpeed = 7.8, accel = 14, airControl = 0.35, jumpSpeed = 8.2, maxSlope = 0.55, stepHeight = 0.45, gravityScale = 1 } = {}) {
    this.world = world;
    this.position = position.clone();
    this.velocity = new THREE.Vector3();
    Object.assign(this, { radius, height, walkSpeed, runSpeed, sprintSpeed, accel, airControl, jumpSpeed, maxSlope, stepHeight, gravityScale });
    this.grounded = false; this.coyote = 0; this.jumpBuffer = 0; this.swimming = false;
    this.groundNormal = new THREE.Vector3(0, 1, 0);
    this.facing = 0; // yaw radians (0 = +Z)
    this.external = new THREE.Vector3(); // knockback / platform velocity
    this.jumps = 0; this.maxJumps = 1;
    this.hits = [];
    this.enabled = true;
    this.lastGroundY = position.y;
    this.fallDistance = 0;
    this.id = 'char' + Math.random().toString(36).slice(2, 7);
  }
  // desired: THREE.Vector3 world-space horizontal direction (length 0..1); speed: m/s target.
  move(dt, desired, speed, { jump = false, faceMovement = true, turnRate = 12 } = {}) {
    if (!this.enabled) return;
    const w = this.world;
    if (jump) this.jumpBuffer = 0.15; else this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    const target = new THREE.Vector3(desired.x * speed, 0, desired.z * speed);
    const control = this.grounded ? 1 : this.swimming ? 0.6 : this.airControl;
    const k = 1 - Math.exp(-this.accel * control * dt);
    this.velocity.x += (target.x - this.velocity.x) * k;
    this.velocity.z += (target.z - this.velocity.z) * k;
    if (faceMovement && desired.lengthSq() > 0.01) {
      const yaw = Math.atan2(desired.x, desired.z);
      let d = yaw - this.facing; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
      this.facing += d * (1 - Math.exp(-turnRate * dt));
    }
    // jumping (coyote + buffer)
    if (this.jumpBuffer > 0 && (this.coyote > 0 || this.swimming || this.jumps < this.maxJumps)) {
      this.velocity.y = this.swimming ? this.jumpSpeed * 0.6 : this.jumpSpeed;
      this.jumpBuffer = 0; this.coyote = 0; this.grounded = false; this.jumps++;
      this.justJumped = true;
    } else this.justJumped = false;
    // gravity
    const g = w.gravity * this.gravityScale;
    if (this.swimming) { this.velocity.y += (g * 0.08) * dt; this.velocity.y *= 1 - 2.5 * dt; }
    else if (!this.grounded) this.velocity.y += g * dt;
    // slope sliding
    if (this.grounded && this.groundNormal.y < 1 - this.maxSlope) {
      const slide = new THREE.Vector3(this.groundNormal.x, 0, this.groundNormal.z).normalize().multiplyScalar(9 * dt);
      this.velocity.add(slide);
    }
    this.external.multiplyScalar(Math.exp(-5 * dt));
    const vx = this.velocity.x + this.external.x, vz = this.velocity.z + this.external.z;
    // integrate with substeps to avoid tunnelling
    const dist = Math.hypot(vx, vz) * dt;
    const steps = Math.max(1, Math.ceil(dist / (this.radius * 0.5)));
    const sdt = dt / steps;
    this.hits.length = 0;
    const wasGrounded = this.grounded;
    for (let i = 0; i < steps; i++) {
      const prevY = this.position.y;
      const nx = this.position.x + vx * sdt, nz = this.position.z + vz * sdt;
      // block climbing steep terrain
      let px = nx, pz = nz;
      if (w.hf && this.grounded) {
        const hNew = w.terrainHeight(nx, nz), hOld = w.terrainHeight(this.position.x, this.position.z);
        const rise = (hNew - hOld) / Math.max(1e-4, Math.hypot(nx - this.position.x, nz - this.position.z));
        if (rise > 1.4) { px = this.position.x; pz = this.position.z; }
      }
      this.position.y += (this.velocity.y + this.external.y) * sdt;
      // walls: resolve the part of the body above step height
      const r = w.resolveCylinder(px, pz, this.radius, this.position.y + this.stepHeight, this.position.y + this.height);
      this.position.x = r.x; this.position.z = r.z;
      for (const h of r.hits) {
        this.hits.push(h);
        const vn = this.velocity.x * h.nx + this.velocity.z * h.nz;
        if (vn < 0) { this.velocity.x -= vn * h.nx; this.velocity.z -= vn * h.nz; }
      }
      // ground
      const gq = w.groundHeight(this.position.x, this.position.z, Math.max(prevY, this.position.y), this.stepHeight, this.radius * 0.6);
      const ground = gq.y;
      const snap = wasGrounded && this.velocity.y <= 0 ? 0.35 : 0.02;
      if (this.position.y <= ground + snap && this.velocity.y <= 0.01) {
        if (!this.grounded) { this.landSpeed = -this.velocity.y; this.fallDistance = this.lastGroundY - ground; }
        this.position.y = ground; this.velocity.y = 0; this.grounded = true; this.jumps = 0; this.coyote = 0.12;
        this.lastGroundY = ground; this.surface = gq.surface;
      } else {
        if (this.grounded) this.lastGroundY = this.position.y;
        this.grounded = false;
      }
      // ceilings: stop upward motion if a static is overhead
      if (this.velocity.y > 0) {
        for (const s of w.nearby(this.position.x, this.position.z, this.radius)) {
          if (s.minY > this.position.y + this.height - 0.2 && s.minY < this.position.y + this.height + 0.1 && w._insideXZ(s, this.position.x, this.position.z, 0)) { this.velocity.y = 0; break; }
        }
      }
    }
    if (!this.grounded) this.coyote = Math.max(0, this.coyote - dt);
    this.groundNormal = this.grounded && w.hf && !this.surface ? w.hf.normalAt(this.position.x, this.position.z, this.groundNormal) : this.groundNormal.set(0, 1, 0);
    // water
    const wl = w.waterLevel;
    this.swimming = this.position.y < wl - this.height * 0.55;
    if (this.swimming && this.position.y < wl - this.height * 0.7) this.position.y = Math.max(this.position.y, wl - this.height * 0.7);
    // world bounds
    if (w.hf) { const lim = w.hf.half - 2; this.position.x = Math.max(-lim, Math.min(lim, this.position.x)); this.position.z = Math.max(-lim, Math.min(lim, this.position.z)); }
  }
  knockback(dir, strength = 6, up = 3) { this.external.set(dir.x * strength, up, dir.z * strength); this.velocity.y = Math.max(this.velocity.y, up); this.grounded = false; }
  horizontalSpeed() { return Math.hypot(this.velocity.x, this.velocity.z); }
  teleport(p) { this.position.copy(p); this.velocity.set(0, 0, 0); this.lastGroundY = p.y; }
  forward(out = new THREE.Vector3()) { return out.set(Math.sin(this.facing), 0, Math.cos(this.facing)); }
}

// Smooth visual follower: applies controller state to a character Object3D.
export function syncVisual(obj, ctrl, dt, lean = 0) {
  obj.position.copy(ctrl.position);
  let yaw = obj.rotation.y, d = ctrl.facing - yaw; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
  obj.rotation.y = yaw + d * (1 - Math.exp(-20 * dt));
  obj.rotation.z = damp(obj.rotation.z, lean, 8, dt);
}
