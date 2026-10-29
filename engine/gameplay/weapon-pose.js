// Shouldered long guns for any rigged character: the weapon is placed from the body (butt in the
// right shoulder pocket, barrel along the aim line or lowered to a ready position), and both hands
// are solved onto it with two-bone IK (trigger hand on the grip socket, support hand on the
// offHand socket, sliding back along the barrel when the arm cannot reach). Runs inside
// CharacterIK.update after foot IK and look-at, so torso aiming carries the gun.
//
//   const ik = new CharacterIK(model, { ground });
//   const sw = new ShoulderedWeapon(model, weaponModel('rifle'), ik, { mode: 'aim' });
//   sw.setAim(targetVector3 | null); sw.mode = 'ready' | 'aim' | 'hip';
//   per frame: mixer.update(dt); ik.update(dt);   // the weapon is posed by the IK hook
import * as THREE from '../vendor/three/three.module.js';
import { bonePos, rotateBoneWorld } from '../animation/ik.js';

const MODES = {
  // pitch/yaw of the barrel, drop of the butt (m), blade = torso turn, lean = forward spine tilt,
  // cheek = head tilt down onto the stock (all degrees)
  aim: { pitch: 0, yaw: 0, drop: 0, blade: 40, lean: 10, cheek: 18 },
  ready: { pitch: -32, yaw: 12, drop: 0.03, blade: 30, lean: 5, cheek: 4 },   // low ready: muzzle down and slightly in, butt stays shouldered
  hip: { pitch: -8, yaw: 6, drop: 0.16, blade: 36, lean: 6, cheek: 0 },       // butt under the arm, carried at the hip
};
const deg = Math.PI / 180;

export class ShoulderedWeapon {
  /**
   * model: character (realistic human or stylized rig) · weapon: Object3D with userData.sockets
   * { grip, offHand, muzzle } in weapon space (+Z forward, +Y up; see weapon-models.js) · ik: CharacterIK.
   * opts: { mode, side: 'R'|'L' (trigger hand), pocket: [in, fwd, up] metres from the shoulder joint,
   *         butt: [x,y,z] weapon-space butt point (default: rear of the bounding box at bore height),
   *         flipSupport: rotate the support-hand socket 180° about Y (auto when omitted) }
   */
  constructor(model, weapon, ik, opts = {}) {
    this.model = model; this.weapon = weapon; this.ik = ik;
    this.mode = opts.mode || 'aim'; this.aimTarget = null; this.blade = opts.blade; // degrees; default per mode
    this.side = opts.side || 'R'; this.other = this.side === 'R' ? 'L' : 'R';
    this.pocket = opts.pocket || [0.07, 0.07, 0.03];
    const S = weapon.userData.sockets || {};
    this.gripLocal = new THREE.Vector3(...(S.grip || [0, 0, 0]));
    this.offLocal = new THREE.Vector3(...(S.offHand || [0, 0.0, 0.3]));
    const muzzle = new THREE.Vector3(...(S.muzzle || [0, 0.08, 0.6]));
    if (opts.butt) this.buttLocal = new THREE.Vector3(...opts.butt);
    else {
      weapon.updateMatrixWorld(true); const inv = weapon.matrixWorld.clone().invert(), box = new THREE.Box3();
      weapon.traverse((o) => { if (o.isMesh) { o.geometry.computeBoundingBox(); box.union(o.geometry.boundingBox.clone().applyMatrix4(inv.clone().multiply(o.matrixWorld))); } });
      this.buttLocal = new THREE.Vector3(0, muzzle.y - 0.02, box.isEmpty() ? -0.25 : box.min.z + 0.01);
    }
    // weapon -> wrist relation of each hand socket (as if the weapon were held in that hand)
    const sockets = model.userData.sockets || {};
    this.rel = {};
    model.updateMatrixWorld(true);
    for (const s of ['L', 'R']) {
      const sock = sockets['hand_' + s], hand = ik.rig.bones['hand_' + s]; if (!sock || !hand) continue;
      this.rel[s] = hand.matrixWorld.clone().invert().multiply(sock.matrixWorld).invert(); // socket -> wrist
    }
    this.flipSupport = opts.flipSupport ?? this._autoFlip();
    if (weapon.parent !== model) model.add(weapon);
    this._t = { [this.side]: new THREE.Vector3(), [this.other]: new THREE.Vector3() };
    this._q = { [this.side]: new THREE.Quaternion(), [this.other]: new THREE.Quaternion() };
    this.debug = { supportSlide: 0, reach: {} };
    ik.setHandTarget(this.side, this._t[this.side], { rotation: this._q[this.side] });
    ik.setHandTarget(this.other, this._t[this.other], { rotation: this._q[this.other] });
    const prev = this._prevHook = ik.onBeforeHands; ik.onBeforeHands = this._hook = (dt) => { prev?.(dt); this._pose(dt); };
  }
  setAim(target) { this.aimTarget = target; return this; }
  /** Detach from the IK (hands released; weapon stays where it is). */
  dispose() { this.ik.setHandTarget('L', null); this.ik.setHandTarget('R', null); if (this.ik.onBeforeHands === this._hook) this.ik.onBeforeHands = this._prevHook || null; }

  // The support hand grips a forward handle with the thumb up like the trigger hand, but its socket
  // frame is mirrored; pick the orientation whose wrist ends up closer to the support shoulder.
  _autoFlip() {
    const s = this.other; if (!this.rel[s]) return false;
    const fwd = new THREE.Vector3(0, 0, 1), m = new THREE.Matrix4().makeTranslation(this.offLocal);
    const a = new THREE.Vector3().setFromMatrixPosition(m.clone().multiply(this.rel[s]));
    const b = new THREE.Vector3().setFromMatrixPosition(m.clone().multiply(new THREE.Matrix4().makeRotationY(Math.PI)).multiply(this.rel[s]));
    return b.dot(fwd) < a.dot(fwd); // wrist should sit behind the handle (towards the body)
  }

  _pose() {
    const m = this.model, B = this.ik.rig.bones, sh = B['upperArm_' + this.side]; if (!sh) return;
    m.updateMatrixWorld(true);
    const mq = m.getWorldQuaternion(new THREE.Quaternion());
    const right = new THREE.Vector3(this.side === 'R' ? -1 : 1, 0, 0).applyQuaternion(mq); // character faces +Z; its right is -X
    const up = new THREE.Vector3(0, 1, 0), fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(mq);
    const md = MODES[this.mode] || MODES.aim;
    // bladed stance: torso turns toward the trigger side so the support shoulder comes forward;
    // the head counter-turns to keep looking down the barrel
    const blade = (this.side === 'R' ? -1 : 1) * (this.blade ?? md.blade) * deg;
    if (blade) {
      const spineBones = [B.spine, B.chest].filter(Boolean), qa = new THREE.Quaternion().setFromAxisAngle(up, blade / Math.max(1, spineBones.length));
      for (const b of spineBones) { this.ik._touch(b); rotateBoneWorld(b, qa); }
      if (B.head) { this.ik._touch(B.head); rotateBoneWorld(B.head, new THREE.Quaternion().setFromAxisAngle(up, -blade)); }
    }
    const leftAx = new THREE.Vector3(1, 0, 0).applyQuaternion(mq); // rotating about +left tilts the top forward
    if (md.lean && B.spine) { this.ik._touch(B.spine); rotateBoneWorld(B.spine, new THREE.Quaternion().setFromAxisAngle(leftAx, md.lean * deg)); }
    if (md.cheek && B.head) { this.ik._touch(B.head); rotateBoneWorld(B.head, new THREE.Quaternion().setFromAxisAngle(leftAx, md.cheek * deg)); }
    const pocket = bonePos(sh, new THREE.Vector3()).addScaledVector(right, -this.pocket[0]).addScaledVector(fwd, this.pocket[1]).addScaledVector(up, this.pocket[2] - md.drop);
    // aim direction
    let dir = fwd.clone();
    if (this.aimTarget) { const t = this.aimTarget.isVector3 ? this.aimTarget : this.aimTarget.getWorldPosition?.(new THREE.Vector3()); if (t) dir = t.clone().sub(pocket).normalize(); }
    if (md.pitch || md.yaw) {
      const side = new THREE.Vector3().crossVectors(dir, up).normalize();
      dir.applyAxisAngle(side, md.pitch * deg).applyAxisAngle(up, (this.side === 'R' ? 1 : -1) * md.yaw * deg * (fwd.dot(dir) > 0 ? 1 : -1));
    }
    const z = dir.normalize(), x = new THREE.Vector3().crossVectors(up, z).normalize(), y = new THREE.Vector3().crossVectors(z, x);
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
    const pos = pocket.clone().sub(this.buttLocal.clone().applyQuaternion(q));
    const W = new THREE.Matrix4().compose(pos, q, new THREE.Vector3(1, 1, 1));
    this.weapon.matrixAutoUpdate = true;
    this.weapon.matrix.copy(m.matrixWorld.clone().invert().multiply(W)).decompose(this.weapon.position, this.weapon.quaternion, this.weapon.scale);
    this.weapon.updateMatrixWorld(true);
    // hand targets: wrist pose that puts the hand socket on the weapon socket
    const handPose = (s, local, flip, outP, outQ) => {
      let G = W.clone().multiply(new THREE.Matrix4().makeTranslation(local));
      if (flip) G.multiply(new THREE.Matrix4().makeRotationY(Math.PI));
      G.multiply(this.rel[s]); const sc = new THREE.Vector3(); G.decompose(outP, outQ, sc);
    };
    if (this.rel[this.side]) handPose(this.side, this.gripLocal, false, this._t[this.side], this._q[this.side]);
    if (this.rel[this.other]) {
      // slide the support hand back along the barrel until the arm can reach (short arms, long guns)
      const so = B['upperArm_' + this.other], lo = B['lowerArm_' + this.other], ha = B['hand_' + this.other];
      const reach = (bonePos(lo, new THREE.Vector3()).distanceTo(bonePos(so, new THREE.Vector3())) + bonePos(ha, new THREE.Vector3()).distanceTo(bonePos(lo, new THREE.Vector3()))) * 0.985;
      const local = this.offLocal.clone(); let slide = 0;
      for (let i = 0; i < 20; i++) {
        handPose(this.other, local, this.flipSupport, this._t[this.other], this._q[this.other]);
        if (this._t[this.other].distanceTo(bonePos(so, new THREE.Vector3())) <= reach || local.z <= this.gripLocal.z + 0.12) break;
        local.z -= 0.03; slide += 0.03;
      }
      this.debug.supportSlide = slide; this.debug.reach[this.other] = reach;
    }
  }
}
