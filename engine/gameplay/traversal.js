// Traversal kit for a Player: rope/web swinging (pendulum physics with anchor search on
// real geometry), gliding, double jump and air dash. Designed for superhero / open-world
// movement; every ability can be toggled. Call traversal.update(dt) before player.control(dt).
import * as THREE from '../vendor/three/three.module.js';

export class Traversal {
  constructor(player, { swing = true, glide = true, doubleJump = true, airDash = true, maxRope = 45, minAnchorHeight = 6, skyAnchors = false, ropeColor = 0xeeeeee } = {}) {
    this.player = player; this.app = player.app;
    Object.assign(this, { canSwing: swing, canGlide: glide, canDoubleJump: doubleJump, canAirDash: airDash, maxRope, minAnchorHeight, skyAnchors });
    this.swinging = false; this.gliding = false; this.anchor = new THREE.Vector3(); this.ropeLen = 0; this.dashReady = true;
    if (doubleJump) player.ctrl.maxJumps = 2;
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    this.rope = new THREE.Line(g, new THREE.LineBasicMaterial({ color: ropeColor })); this.rope.visible = false; this.rope.frustumCulled = false;
    this.app.scene.add(this.rope);
    this.stats = { swings: 0, glideTime: 0, dashes: 0, maxHeight: 0 };
  }
  // Find an anchor up-and-ahead by raycasting against the physics world.
  findAnchor() {
    const p = this.player, origin = p.position.clone().setY(p.position.y + 1.6);
    const fwd = p.cam.groundForward().normalize(), right = p.cam.groundRight();
    let best = null;
    for (const side of [0, 1, -1, 2, -2]) for (const pitch of [0.9, 0.7, 1.1, 0.5]) {
      const dir = fwd.clone().multiplyScalar(Math.cos(pitch)).addScaledVector(right, side * 0.35).setY(Math.sin(pitch)).normalize();
      const hit = this.app.physics.raycast(origin, dir, this.maxRope, { bodies: false, terrain: false });
      if (hit && hit.point.y > p.position.y + this.minAnchorHeight && hit.distance > 6) { if (!best || Math.abs(side) < Math.abs(best.side)) best = { point: hit.point, side, distance: hit.distance }; }
      if (best && best.side === 0) break;
    }
    if (!best && this.skyAnchors) { const pt = origin.clone().addScaledVector(fwd, 18).setY(origin.y + 22); return pt; }
    return best?.point || null;
  }
  update(dt) {
    const p = this.player, input = this.app.input, c = p.ctrl;
    if (!p.alive) { this.release(); return; }
    // double jump flourish handled by controller (maxJumps); add VFX on the 2nd jump
    if (c.justJumped && c.jumps === 2) { this.app.vfx.emit('dust', p.position.clone(), { count: 8 }); this.app.audio.play('whoosh', { pitch: 1.4, volume: 0.5 }); }
    if (c.grounded) { this.dashReady = true; if (this.swinging) this.release(); this.gliding = false; }
    // start swing
    if (this.canSwing && !this.swinging && input.pressed('swing')) {
      const a = this.findAnchor();
      if (a) { this.swinging = true; this.anchor.copy(a); this.ropeLen = Math.max(6, p.position.clone().setY(p.position.y + 1.6).distanceTo(a) * 0.92); this.stats.swings++; this.app.audio.play('thwip'); c.grounded = false; if (c.velocity.y < 2) c.velocity.y = Math.max(c.velocity.y, 3); }
      else this.app.audio.play('uiBack', { volume: 0.3 });
    }
    if (this.swinging && !input.held('swing')) { this.release(true); }
    // air dash
    if (this.canAirDash && !c.grounded && !this.swinging && this.dashReady && input.pressed('dodge')) {
      const f = p.cam.groundForward(); c.velocity.x = f.x * 22; c.velocity.z = f.z * 22; c.velocity.y = Math.max(c.velocity.y, 2); this.dashReady = false; this.stats.dashes++;
      this.app.vfx.emit('trail', p.position.clone().setY(p.position.y + 1), { count: 12 }); this.app.audio.play('whoosh');
    }
    // glide: hold glide while falling
    this.gliding = this.canGlide && !c.grounded && !this.swinging && c.velocity.y < -2 && input.held('glide');
    if (this.gliding) {
      this.stats.glideTime += dt;
      c.velocity.y = Math.max(c.velocity.y, -3.2);
      c.gravityScale = 0.05; // controller adds gravity after this; keep the sink rate near -3.2 m/s
      const f = p.cam.moveDir(input.moveVector().x, Math.max(0.6, input.moveVector().y)); const sp = Math.hypot(c.velocity.x, c.velocity.z);
      const target = f.normalize().multiplyScalar(Math.max(sp, 14)); c.velocity.x += (target.x - c.velocity.x) * dt * 2; c.velocity.z += (target.z - c.velocity.z) * dt * 2;
    }
    if (!this.gliding) c.gravityScale = 1;
    if (this.swinging) this._swingStep(dt);
    p.forcedOverride = this.swinging ? 'swing' : this.gliding ? 'fly' : null;
    this.stats.maxHeight = Math.max(this.stats.maxHeight, p.position.y);
    // rope visual
    this.rope.visible = this.swinging;
    if (this.swinging) {
      const hand = new THREE.Vector3(); (p.model.userData.sockets.hand_R).getWorldPosition(hand);
      const a = this.rope.geometry.attributes.position; a.setXYZ(0, hand.x, hand.y, hand.z); a.setXYZ(1, this.anchor.x, this.anchor.y, this.anchor.z); a.needsUpdate = true;
    }
  }
  _swingStep(dt) {
    const p = this.player, c = p.ctrl, w = this.app.physics, input = this.app.input;
    c.enabled = false;
    const g = w.gravity;
    c.velocity.y += g * dt;
    // pumping: input accelerates along the camera direction
    const mv = input.moveVector(); const push = p.cam.moveDir(mv.x, mv.y);
    c.velocity.addScaledVector(push, 9 * dt);
    const hip = c.position.clone().setY(c.position.y + 1.6);
    hip.addScaledVector(c.velocity, dt);
    // rope constraint
    const toA = hip.clone().sub(this.anchor), d = toA.length();
    if (d > this.ropeLen) {
      const n = toA.divideScalar(d); hip.copy(this.anchor).addScaledVector(n, this.ropeLen);
      const vr = c.velocity.dot(n); if (vr > 0) c.velocity.addScaledVector(n, -vr);
    }
    // reel in slowly for more arc
    this.ropeLen = Math.max(5, this.ropeLen - dt * 1.5);
    c.velocity.multiplyScalar(1 - 0.05 * dt);
    let np = hip.setY(hip.y - 1.6);
    const r = w.resolveCylinder(np.x, np.z, c.radius, np.y + 0.3, np.y + c.height);
    np.x = r.x; np.z = r.z; for (const h of r.hits) { const vn = c.velocity.x * h.nx + c.velocity.z * h.nz; if (vn < 0) { c.velocity.x -= vn * h.nx; c.velocity.z -= vn * h.nz; } }
    const gy = w.groundHeight(np.x, np.z, np.y + 1, 0.3).y;
    c.position.copy(np);
    if (np.y <= gy + 0.05) { c.position.y = gy; c.landSpeed = -c.velocity.y; c.fallDistance = 0; this.release(); c.grounded = true; c.velocity.y = 0; return; }
    const sp = Math.hypot(c.velocity.x, c.velocity.z); if (sp > 0.5) c.facing = Math.atan2(c.velocity.x, c.velocity.z);
  }
  release(boost = false) {
    if (!this.swinging) return;
    this.swinging = false; this.player.ctrl.enabled = true; this.rope.visible = false;
    if (boost) { this.player.ctrl.velocity.y += 6; this.app.audio.play('whoosh', { volume: 0.6 }); }
  }
}
