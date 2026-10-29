// Camera rigs: third-person orbit with collision avoidance, shoulder offset, lock-on
// framing and FOV kicks; vehicle chase camera with speed-based distance/FOV; trauma-based
// screen shake; and a cinematic rail camera for cutscenes.
import * as THREE from '../vendor/three/three.module.js';
import { clamp, damp, Noise } from '../core/rng.js';

const noise = new Noise(42);

export class CameraShake {
  constructor() { this.trauma = 0; this.t = 0; this.scale = 1; this.offset = new THREE.Vector3(); this.rot = new THREE.Euler(); }
  add(amount) { this.trauma = Math.min(1, this.trauma + amount); }
  update(dt) {
    this.t += dt; this.trauma = Math.max(0, this.trauma - dt * 1.4);
    const s = this.trauma * this.trauma * this.scale;
    this.offset.set(noise.noise2(this.t * 25, 1) * 0.25 * s, noise.noise2(this.t * 25, 2) * 0.25 * s, 0);
    this.rot.set(noise.noise2(this.t * 20, 3) * 0.04 * s, noise.noise2(this.t * 20, 4) * 0.04 * s, noise.noise2(this.t * 20, 5) * 0.06 * s);
  }
  apply(camera) { camera.position.add(this.offset.clone().applyQuaternion(camera.quaternion)); camera.rotation.x += this.rot.x; camera.rotation.y += this.rot.y; camera.rotation.z += this.rot.z; }
}

export class ThirdPersonCamera {
  constructor(camera, world, { distance = 4.8, height = 1.6, shoulder = 0.55, minPitch = -0.6, maxPitch = 1.0, fov = 60, collide = true,
    aimDistance = 2.3, aimShoulder = 1.45, aimHeight = null, aimFov = null, aimSpeed = 12 } = {}) {
    this.camera = camera; this.world = world;
    Object.assign(this, { distance, height, shoulder, minPitch, maxPitch, baseFov: fov, collide });
    // Over-the-shoulder aim mode (shooters): set .aiming = true; .shoulderSide = ±1 swaps shoulders.
    Object.assign(this, { aimDistance, aimShoulder, aimHeight: aimHeight ?? height - 0.05, aimFov: aimFov ?? fov * 0.75, aimSpeed });
    this.aiming = false; this.aimBlend = 0; this.aimFovOverride = null; this.shoulderSide = 1; this._side = 1;
    this.yaw = Math.PI; this.pitch = 0.25; this.currentDist = distance; this.fovKick = 0;
    this.target = new THREE.Vector3(); this.lockTarget = null; this.shake = new CameraShake();
    this.autoCenter = 0; // seconds of no input before auto-follow
    this.zoom = 1;
    this._pos = new THREE.Vector3();
  }
  // yaw convention: camera sits behind the player when yaw === player.facing + PI
  look(dx, dy) { this.yaw -= dx; this.pitch = clamp(this.pitch + dy, this.minPitch, this.maxPitch); if (Math.abs(dx) + Math.abs(dy) > 0) this.autoCenter = 0; }
  // Forward vector on the ground plane for camera-relative movement.
  groundForward(out = new THREE.Vector3()) { return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); }
  groundRight(out = new THREE.Vector3()) { return out.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw)); }
  // Convert input (x right, y forward) into world direction.
  moveDir(mx, my, out = new THREE.Vector3()) {
    const f = this.groundForward(), r = this.groundRight();
    return out.set(0, 0, 0).addScaledVector(f, my).addScaledVector(r, mx);
  }
  // Ray through the screen centre (for hitscan aiming).
  aimRay(out = { origin: new THREE.Vector3(), dir: new THREE.Vector3() }) { out.origin.copy(this.camera.position); this.camera.getWorldDirection(out.dir); return out; }
  update(dt, focus, { facing = null, speed = 0, sprinting = false } = {}) {
    this.aimBlend = damp(this.aimBlend, this.aiming ? 1 : 0, this.aimSpeed, dt); if (this.aimBlend < 1e-4) this.aimBlend = 0;
    this._side = damp(this._side, this.shoulderSide, 8, dt); if (Math.abs(this._side - this.shoulderSide) < 1e-4) this._side = this.shoulderSide;
    const ab = this.aimBlend, aimMode = ab > 0 || this._side !== 1;
    const h = this.height + (this.aimHeight - this.height) * ab;
    this.target.lerp(new THREE.Vector3(focus.x, focus.y + h, focus.z), 1 - Math.exp(-14 * dt));
    this.autoCenter += dt;
    if (this.lockTarget) {
      const to = this.lockTarget.clone().sub(focus); const want = Math.atan2(-to.x, -to.z);
      let d = want - this.yaw; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
      this.yaw += d * (1 - Math.exp(-6 * dt)); this.pitch = damp(this.pitch, 0.2, 4, dt);
    } else if (facing !== null && speed > 3 && this.autoCenter > 1.5 && !this.aiming) {
      const want = facing + Math.PI; let d = want - this.yaw; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
      this.yaw += d * (1 - Math.exp(-1.2 * dt));
    }
    const dir = new THREE.Vector3(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    let pivot;
    if (!aimMode) pivot = this.target.clone().addScaledVector(right, this.shoulder * 0.5);
    else {
      let off = (this.shoulder + (this.aimShoulder - this.shoulder) * ab) * 0.5 * this._side;
      if (this.collide && this.world && Math.abs(off) > 0.01) { const sd = right.clone().multiplyScalar(Math.sign(off)); const hh = this.world.raycast(this.target, sd, Math.abs(off) + 0.25, { bodies: false }); if (hh) off = Math.sign(off) * Math.max(0, hh.distance - 0.25); }
      pivot = this.target.clone().addScaledVector(right, off);
    }
    let want = aimMode ? (this.distance * this.zoom * (sprinting ? 1.12 : 1)) * (1 - ab) + this.aimDistance * ab : this.distance * this.zoom * (sprinting ? 1.12 : 1);
    if (this.collide && this.world) {
      const hit = this.world.raycast(pivot, dir, want + 0.3, { bodies: false });
      if (hit) want = Math.max(0.6, hit.distance - 0.3);
      // keep above terrain
    }
    this.currentDist = want < this.currentDist ? want : damp(this.currentDist, want, 3, dt);
    this._pos.copy(pivot).addScaledVector(dir, this.currentDist);
    if (this.world && this.world.hf) { const g = this.world.terrainHeight(this._pos.x, this._pos.z) + 0.4; if (this._pos.y < g) this._pos.y = g; }
    this.camera.position.copy(this._pos);
    const lookAt = this.lockTarget ? pivot.clone().lerp(this.lockTarget.clone().setY(this.lockTarget.y + 1), 0.35) : pivot;
    this.camera.lookAt(lookAt);
    this.fovKick = damp(this.fovKick, sprinting ? 8 : 0, 4, dt);
    this.camera.fov = ab > 0 ? this.baseFov + ((this.aimFovOverride ?? this.aimFov) - this.baseFov) * ab + this.fovKick * (1 - ab) : this.baseFov + this.fovKick;
    this.camera.updateProjectionMatrix();
    this.shake.update(dt); this.shake.apply(this.camera);
  }
}

// First-person camera with the same API as ThirdPersonCamera (yaw/pitch conventions, look,
// moveDir, groundForward/Right, update(dt, focus, opts), shake, aiming), so a Player can swap
// rigs at runtime (player.cam = fp). Eye height follows crouching smoothly; optional head bob.
export class FirstPersonCamera {
  constructor(camera, { height = 1.62, crouchHeight = 1.0, fov = 72, minPitch = -1.45, maxPitch = 1.45, bob = 0.03, aimFov = 50, aimSpeed = 14 } = {}) {
    this.camera = camera; Object.assign(this, { height, crouchHeight, baseFov: fov, minPitch, maxPitch, bob, aimFov, aimSpeed });
    this.yaw = Math.PI; this.pitch = 0; this.shake = new CameraShake(); this.lockTarget = null; this.aiming = false; this.aimBlend = 0;
    this.eye = new THREE.Vector3(); this._h = height; this._bobT = 0; this.crouching = false; this.zoom = 1; this.init = false; this.fovKick = 0;
  }
  look(dx, dy) { this.yaw -= dx; this.pitch = clamp(this.pitch + dy, this.minPitch, this.maxPitch); }
  groundForward(out = new THREE.Vector3()) { return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); }
  groundRight(out = new THREE.Vector3()) { return out.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw)); }
  moveDir(mx, my, out = new THREE.Vector3()) { return out.set(0, 0, 0).addScaledVector(this.groundForward(), my).addScaledVector(this.groundRight(), mx); }
  forward(out = new THREE.Vector3()) { const c = Math.cos(this.pitch); return out.set(-Math.sin(this.yaw) * c, -Math.sin(this.pitch), -Math.cos(this.yaw) * c); }
  aimRay(out = { origin: new THREE.Vector3(), dir: new THREE.Vector3() }) { out.origin.copy(this.camera.position); this.camera.getWorldDirection(out.dir); return out; }
  update(dt, focus, { speed = 0, sprinting = false, crouching = this.crouching } = {}) {
    this.aimBlend = damp(this.aimBlend, this.aiming ? 1 : 0, this.aimSpeed, dt);
    this._h = damp(this._h, crouching ? this.crouchHeight : this.height, 10, dt);
    this._bobT += dt * Math.min(speed, 9) * 1.9;
    const b = this.bob * Math.min(1, speed / 5) * (1 - this.aimBlend * 0.85);
    this.eye.set(focus.x, focus.y + this._h + Math.abs(Math.sin(this._bobT)) * b, focus.z);
    this.camera.position.copy(this.eye);
    this.camera.lookAt(this.eye.clone().add(this.forward()));
    this.fovKick = damp(this.fovKick, sprinting ? 6 : 0, 4, dt);
    this.camera.fov = this.baseFov + (this.aimFov - this.baseFov) * this.aimBlend + this.fovKick;
    this.camera.updateProjectionMatrix();
    this.shake.update(dt); this.shake.apply(this.camera);
  }
}

export class ChaseCamera {
  constructor(camera, world, { distance = 6.5, height = 2.4, lookAhead = 4, fov = 62 } = {}) {
    this.camera = camera; this.world = world; Object.assign(this, { distance, height, lookAhead, baseFov: fov });
    this.pos = new THREE.Vector3(); this.yaw = 0; this.shake = new CameraShake(); this.lookBack = false; this.orbit = 0; this.init = false;
  }
  update(dt, vehicle) {
    const speed = Math.abs(vehicle.speed);
    const moveYaw = speed > 2 ? Math.atan2(vehicle.velocity.x, vehicle.velocity.z) : vehicle.yaw;
    const target = vehicle.speed < -2 ? vehicle.yaw : moveYaw;
    let d = target - this.yaw; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
    this.yaw += d * (1 - Math.exp(-4 * dt));
    const yaw = this.yaw + (this.lookBack ? Math.PI : 0) + this.orbit;
    const dist = this.distance + speed * 0.05;
    const want = new THREE.Vector3(vehicle.position.x - Math.sin(yaw) * dist, vehicle.position.y + this.height + speed * 0.012, vehicle.position.z - Math.cos(yaw) * dist);
    if (this.world) { const g = this.world.groundHeight(want.x, want.z).y + 0.8; if (want.y < g) want.y = g; }
    if (!this.init) { this.pos.copy(want); this.init = true; }
    this.pos.lerp(want, 1 - Math.exp(-8 * dt));
    this.camera.position.copy(this.pos);
    const look = vehicle.position.clone().add(new THREE.Vector3(Math.sin(yaw) * this.lookAhead, 1.0, Math.cos(yaw) * this.lookAhead));
    this.camera.lookAt(look);
    this.camera.fov = damp(this.camera.fov, this.baseFov + Math.min(22, speed * 0.32) + (vehicle.boosting ? 8 : 0), 3, dt);
    this.camera.updateProjectionMatrix();
    this.shake.update(dt); this.shake.apply(this.camera);
  }
}

// Cinematic rail: keys [{ t, pos:[x,y,z], look:[x,y,z], fov }]; catmull-rom interpolation.
export class CinematicCamera {
  constructor(camera) { this.camera = camera; this.keys = null; this.t = 0; this.playing = false; this.onEnd = null; }
  play(keys, onEnd) { this.keys = keys; this.t = 0; this.playing = true; this.onEnd = onEnd; this.duration = keys[keys.length - 1].t; }
  stop() { this.playing = false; }
  update(dt) {
    if (!this.playing) return false;
    this.t += dt;
    const k = this.keys, t = Math.min(this.t, this.duration);
    let i = 0; while (i < k.length - 2 && k[i + 1].t < t) i++;
    const a = k[Math.max(0, i - 1)], b = k[i], c = k[i + 1], d = k[Math.min(k.length - 1, i + 2)];
    const u = (t - b.t) / Math.max(1e-4, c.t - b.t), s = u * u * (3 - 2 * u);
    const cr = (p0, p1, p2, p3) => p1.map((_, j) => 0.5 * ((2 * p1[j]) + (-p0[j] + p2[j]) * s + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * s * s + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * s * s * s));
    this.camera.position.set(...cr(a.pos, b.pos, c.pos, d.pos));
    this.camera.lookAt(new THREE.Vector3(...cr(a.look, b.look, c.look, d.look)));
    if (b.fov && c.fov) { this.camera.fov = b.fov + (c.fov - b.fov) * s; this.camera.updateProjectionMatrix(); }
    if (this.t >= this.duration) { this.playing = false; this.onEnd?.(); }
    return true;
  }
}
