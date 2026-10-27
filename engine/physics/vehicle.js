// Raycast vehicle model: rigid chassis (yaw/pitch/roll), four suspension springs sampled
// against ground, slip-based tyre grip, engine torque curve with automatic gears, brakes,
// handbrake drifting, speed-sensitive steering, nitro boost, airborne control, and chassis
// collision against static colliders (multi-circle footprint) with damage impulses.
import * as THREE from '../vendor/three/three.module.js';
import { clamp } from '../core/rng.js';

const UP = new THREE.Vector3(0, 1, 0);

export class Vehicle {
  constructor(world, rig, { position = new THREE.Vector3(), yaw = 0, mass = 1200, enginePower = 26, maxSpeed = 62, brake = 32, grip = 9, driftGrip = 2.6, steerMax = 0.6, suspension = 0.32, springK = 55, damperC = 7, boost = 1.6, gears = [0, 14, 24, 34, 46, 62] } = {}) {
    this.world = world; this.rig = rig;
    this.position = position.clone(); this.yaw = yaw; this.pitch = 0; this.roll = 0;
    this.velocity = new THREE.Vector3(); this.yawRate = 0; this.vy = 0;
    Object.assign(this, { mass, enginePower, maxSpeed, brakeForce: brake, grip, driftGrip, steerMax, suspension, springK, damperC, boostMult: boost, gears });
    const d = rig.userData.dims; this.length = d.length; this.width = d.width;
    this.wheels = rig.userData.wheels.map((w) => ({ ...w, compression: 0, contact: false, spin: 0 }));
    this.steer = 0; this.throttle = 0; this.brakeInput = 0; this.handbrake = false; this.boosting = false;
    this.boostFuel = 1; this.gear = 1; this.rpm = 0.2; this.grounded = true; this.airTime = 0; this.drifting = 0;
    this.damage = 0; this.collisions = []; this.onCollision = null;
    this.circles = [-0.36, 0, 0.36].map((f) => f * this.length);
    this.radius = this.width * 0.5;
    this.forward = new THREE.Vector3(); this.right = new THREE.Vector3();
    this.distance = 0; this.topSpeed = 0;
  }
  get speed() { return this.velocity.dot(this.forward); }
  get kmh() { return Math.abs(this.speed) * 3.6; }
  setInput({ throttle = 0, brake = 0, steer = 0, handbrake = false, boost = false }) {
    this.throttle = clamp(throttle, 0, 1); this.brakeInput = clamp(brake, 0, 1);
    this.steerTarget = clamp(steer, -1, 1); this.handbrake = handbrake; this.boostReq = boost;
  }
  update(dt) {
    const w = this.world;
    this.forward.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); this.right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const fwdSpeed = this.velocity.dot(this.forward), latSpeed = this.velocity.dot(this.right);
    const absV = Math.abs(fwdSpeed);
    // steering: slower and smaller at speed
    const steerLimit = this.steerMax * (1 - clamp(absV / this.maxSpeed, 0, 1) * 0.65);
    this.steer += ((this.steerTarget ?? 0) * steerLimit - this.steer) * (1 - Math.exp(-8 * dt));
    // suspension: sample ground under each wheel
    let contacts = 0, avgGround = 0, normal = new THREE.Vector3();
    const cosY = Math.cos(this.yaw), sinY = Math.sin(this.yaw);
    for (const wh of this.wheels) {
      const wx = this.position.x + wh.x * cosY + wh.z * sinY, wz = this.position.z - wh.x * sinY + wh.z * cosY;
      const g = w.groundHeight(wx, wz, this.position.y + 1.0, 0.6).y;
      wh.groundY = g;
      const gap = this.position.y - g;
      wh.contact = gap < this.suspension + 0.25;
      wh.compression = clamp(this.suspension - gap + 0.0, -0.1, this.suspension);
      if (wh.contact) { contacts++; avgGround += g; }
      wh.wx = wx; wh.wz = wz;
    }
    // chassis orientation from wheel ground heights
    const fl = this.wheels[0], fr = this.wheels[1], rl = this.wheels[2], rr = this.wheels[3];
    const targetPitch = Math.atan2(((rl.groundY + rr.groundY) - (fl.groundY + fr.groundY)) / 2, Math.abs(fl.z - rl.z));
    const targetRoll = Math.atan2(((fl.groundY + rl.groundY) - (fr.groundY + rr.groundY)) / 2, Math.abs(fl.x - fr.x));
    this.grounded = contacts >= 2;
    if (this.grounded) {
      avgGround /= contacts;
      // spring towards ride height
      const ride = avgGround + this.suspension * 0.55;
      const x = ride - this.position.y;
      this.vy += (x * this.springK - this.vy * this.damperC) * dt;
      if (this.position.y < avgGround) { this.position.y = avgGround; this.vy = Math.max(0, this.vy); }
      this.pitch += (targetPitch - this.pitch) * (1 - Math.exp(-10 * dt));
      this.roll += (targetRoll - latSpeed * 0.012 - this.roll) * (1 - Math.exp(-8 * dt));
      this.airTime = 0;
    } else {
      this.vy += w.gravity * dt; this.airTime += dt;
      this.pitch += (0 - this.pitch) * 0.5 * dt; this.roll *= 1 - 0.5 * dt;
    }
    void normal;
    // drive forces (only with ground contact)
    const boosting = this.boostReq && this.boostFuel > 0 && this.throttle > 0.1;
    this.boosting = boosting;
    this.boostFuel = clamp(this.boostFuel + (boosting ? -0.35 : 0.08) * dt, 0, 1);
    if (this.grounded) {
      let accel = 0;
      const top = this.maxSpeed * (boosting ? 1.25 : 1);
      if (this.throttle > 0) {
        const curve = 1 - Math.pow(clamp(fwdSpeed / top, 0, 1), 2);
        accel += this.throttle * this.enginePower * curve * (boosting ? this.boostMult : 1);
      }
      if (this.brakeInput > 0) accel += fwdSpeed > 0.5 ? -this.brakeInput * this.brakeForce : -this.brakeInput * this.enginePower * 0.45 * (fwdSpeed > -top * 0.3 ? 1 : 0);
      accel -= fwdSpeed * 0.06 + Math.sign(fwdSpeed) * fwdSpeed * fwdSpeed * 0.0012; // rolling + drag
      if (this.handbrake) accel -= Math.sign(fwdSpeed) * Math.min(Math.abs(fwdSpeed) / dt, 9);
      const newFwd = fwdSpeed + accel * dt;
      // lateral grip (lower with handbrake -> drift)
      const gripNow = this.handbrake ? this.driftGrip : this.grip * (this.brakeInput > 0.5 && absV > 20 ? 0.75 : 1);
      const newLat = latSpeed * Math.exp(-gripNow * dt);
      this.drifting = Math.abs(latSpeed) > 3 ? Math.min(1, Math.abs(latSpeed) / 10) : 0;
      // yaw from steering (bicycle model)
      const wheelbase = Math.abs(fl.z - rl.z);
      const targetYawRate = (newFwd / wheelbase) * Math.tan(this.steer) * (this.handbrake ? 1.35 : 1);
      this.yawRate += (targetYawRate - this.yawRate) * (1 - Math.exp(-(this.handbrake ? 4 : 9) * dt));
      this.velocity.copy(this.forward).multiplyScalar(newFwd).addScaledVector(this.right, newLat);
    } else {
      this.yawRate *= 1 - 0.8 * dt;
      this.velocity.multiplyScalar(1 - 0.02 * dt);
    }
    this.yaw += this.yawRate * dt;
    // integrate
    const prev = this.position.clone();
    this.position.x += this.velocity.x * dt; this.position.z += this.velocity.z * dt; this.position.y += this.vy * dt;
    // ground floor safety
    const gc = w.groundHeight(this.position.x, this.position.z, this.position.y + 1, 0.6).y;
    if (this.position.y < gc) { this.position.y = gc; if (this.vy < 0) this.vy = 0; }
    // collisions: circles along chassis
    this.collisions.length = 0;
    const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    for (const off of this.circles) {
      const cx = this.position.x + fwd.x * off, cz = this.position.z + fwd.z * off;
      const r = w.resolveCylinder(cx, cz, this.radius, this.position.y + 0.3, this.position.y + 1.4, null);
      if (r.hits.length) {
        const dx = r.x - cx, dz = r.z - cz;
        this.position.x += dx; this.position.z += dz;
        for (const h of r.hits) {
          if (h.shape.userData.dynamicProxy) continue;
          const vn = this.velocity.x * h.nx + this.velocity.z * h.nz;
          if (vn < 0) {
            const impact = -vn;
            this.velocity.x -= 1.35 * vn * h.nx; this.velocity.z -= 1.35 * vn * h.nz;
            this.velocity.multiplyScalar(0.85);
            this.yawRate += (off === 0 ? 0 : Math.sign(off)) * (h.nx * fwd.z - h.nz * fwd.x) * impact * 0.05;
            this.collisions.push({ impact, normal: [h.nx, h.nz], shape: h.shape });
            if (impact > 4) this.damage = Math.min(1, this.damage + impact * 0.004);
            this.onCollision?.(impact, h);
          }
        }
      }
    }
    // dynamic props: knock them away
    for (const b of w.bodies) {
      const d = b.position.clone().sub(this.position); d.y = 0;
      const local = d.dot(fwd), lat = d.dot(new THREE.Vector3(fwd.z, 0, -fwd.x));
      if (Math.abs(local) < this.length / 2 + b.radius && Math.abs(lat) < this.width / 2 + b.radius && b.position.y < this.position.y + 2) {
        const imp = this.velocity.clone().multiplyScalar(b.mass * 1.4); imp.y = Math.max(2, this.velocity.length() * 0.35) * b.mass;
        w.applyImpulse(b, imp, b.position.clone().add(new THREE.Vector3(0, 0.3, 0)));
        b.position.addScaledVector(d.normalize(), 0.2);
        this.velocity.multiplyScalar(0.985);
        b.userData.onHit?.(this);
      }
    }
    if (w.hf) { const lim = w.hf.half - 3; this.position.x = clamp(this.position.x, -lim, lim); this.position.z = clamp(this.position.z, -lim, lim); }
    this.distance += prev.distanceTo(this.position);
    this.topSpeed = Math.max(this.topSpeed, this.kmh);
    // gears/rpm for audio
    const sp = Math.abs(this.speed);
    let g = 1; while (g < this.gears.length - 1 && sp > this.gears[g]) g++;
    this.gear = g;
    const lo = this.gears[g - 1], hi = this.gears[g];
    this.rpm = clamp(0.25 + 0.75 * (sp - lo) / Math.max(1, hi - lo), 0.2, 1) * (this.throttle > 0 || sp > 1 ? 1 : 0.6);
    this.syncVisual(dt);
  }
  syncVisual(dt) {
    const rig = this.rig;
    rig.position.copy(this.position);
    rig.rotation.set(0, 0, 0); rig.rotation.order = 'YXZ';
    rig.rotation.y = this.yaw; rig.rotation.x = this.pitch; rig.rotation.z = this.roll;
    const body = rig.userData.body;
    if (body) { body.position.y = 0; body.rotation.x = -clamp(this.throttle - this.brakeInput, -1, 1) * 0.015; }
    for (const wh of this.wheels) {
      wh.spin += (this.speed / wh.radius) * dt;
      wh.spin %= Math.PI * 2;
      wh.pivot.rotation.set(0, wh.steer ? this.steer : 0, 0);
      wh.spin3 = wh.spin;
      wh.pivot.children[0].rotation.x = wh.spin;
      wh.pivot.position.y = wh.rest + clamp(wh.compression, -0.1, 0.25) * 0.5;
    }
    const tail = rig.userData.tailMat; if (tail) tail.emissiveIntensity = this.brakeInput > 0.1 ? 5 : 1.2;
  }
  resetOnRoad(p, yaw) { this.position.copy(p); this.yaw = yaw; this.velocity.set(0, 0, 0); this.yawRate = 0; this.vy = 0; }
  // Inputs from an Input instance.
  drive(input) {
    this.setInput({ throttle: input.value('accelerate'), brake: input.value('brake'), steer: input.value('steerLeft') - input.value('steerRight'), handbrake: input.held('handbrake'), boost: input.held('boost') });
  }
}
