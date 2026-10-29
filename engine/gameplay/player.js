// Reusable third-person player: camera-relative movement, sprint/stamina, jump, dodge
// roll with i-frames, melee combo + heavy attack, block/parry window, lock-on, special
// ability hook, interaction scanning, footstep/hit feedback. Works for action games
// (combat on) and exploration/adventure games (combat off).
import * as THREE from '../vendor/three/three.module.js';
import { Actor } from './actors.js';
import { Stamina, ComboSystem, meleeSweep } from './systems.js';
import { ThirdPersonCamera } from '../camera/cameras.js';
import { UI } from '../ui/ui.js';

export class Player extends Actor {
  constructor(app, { combat = true, look = {}, weapon = combat ? 'sword' : null, hp = 150, position, facing = 0, damage = 1, camera = {} } = {}) {
    super(app, { look, weapon, hp, position, facing, name: 'Player', tags: ['player'], speed: { walkSpeed: 2, runSpeed: 5.2, sprintSpeed: 8.2, jumpSpeed: 8.4 } });
    this.combat = combat;
    this.stamina = new Stamina(100, 30);
    this.combo = new ComboSystem(['attack1', 'attack2', 'attack3'], { damage: [14, 16, 30] });
    this.damageMult = damage;
    this.cam = new ThirdPersonCamera(app.camera, app.physics, { distance: 4.6, ...camera });
    this.cam.yaw = facing + Math.PI;
    app.cameraRigs = [...(app.cameraRigs || []), this.cam];
    this.blocking = false; this.dodging = 0; this.lockTarget = null; this.parryWindow = 0;
    this.abilityCooldown = 0; this.abilityMax = 8;
    this.interactables = []; // [{ position, radius, label, key, action(), enabled() }]
    this.focus = null;
    this.targets = () => [];
    this.currentAttack = null;
    // Hooks for add-on controllers (shooter kit, cover, vehicles…): all optional / neutral by default.
    this.aimFacing = null;   // yaw to face (strafe) instead of facing the movement direction
    this.speedScale = 1;     // movement speed multiplier (aim-down-sights, heavy weapons)
    this.lookScale = 1;      // camera look sensitivity multiplier (ADS)
    this.upperPose = null;   // looping upper-body clip when not blocking (e.g. 'aimRifle')
    this.moveFilter = null;  // (dir, speed, dt) => { dir, speed } (cover sliding, rails)
    this.crouching = false;
    this.stats = { kills: 0, damageDealt: 0, damageTaken: 0, dodges: 0, parries: 0 };
    this.anim.on('hit', (clip) => this._onStrike(clip));
    this.on('damage', ({ amount }) => { this.stats.damageTaken += amount; app.ui.flash(Math.min(1, amount / 40)); app.shake(0.35); app.audio.play('hurt', { pos: this.position }); });
    this.on('footstep', () => app.audio.play('footstepGrass', { volume: 0.5 }));
  }
  // Player-friendly hit reactions: brief i-frames, only heavy hits interrupt attacks.
  onDamage(amount, info) {
    this.emit('damage', { amount, info });
    if (this.health.dead) return;
    this.health.invulnerable = Math.max(this.health.invulnerable, 0.45);
    if (info.direction) this.ctrl.knockback(info.direction, Math.min(info.knockback ?? 3, 4), 1);
    const attacking = this.anim.isPlaying() && this.anim.current.name.startsWith('attack');
    if (!info.noStagger && (amount >= 18 || !attacking)) { this.stagger = amount >= 18 ? 0.4 : 0.2; this.anim.play('hit'); this.combo.index = -1; }
  }
  _onStrike(clip) {
    const heavy = clip === 'heavy', range = heavy ? 2.8 : 2.3, arc = heavy ? Math.PI : Math.PI * 0.75;
    const hits = meleeSweep(this.position, this.facing, this.targets(), { range, arc });
    this.app.audio.play('swing', { pos: this.position });
    let any = false;
    for (const h of hits) {
      const base = heavy ? 34 : this.combo.currentDamage();
      const crit = Math.random() < 0.12, dmg = base * this.damageMult * (crit ? 1.8 : 1);
      const dealt = h.target.health.damage(dmg, { direction: h.direction, knockback: heavy ? 7 : clip === 'attack3' ? 5 : 2.5, up: heavy ? 4 : 1.5, source: this, stagger: heavy ? 0.7 : 0.4 });
      this.stats.damageDealt += dealt; any = true;
      const p = h.target.position.clone().setY(h.target.position.y + 1.2);
      this.app.vfx.emit('sparks', p, { direction: h.direction }); this.app.vfx.emit('hit', p);
      this.app.audio.play(heavy ? 'heavyHit' : 'hit', { pos: p });
      const s = UI.project(p, this.app.camera); if (s.visible) this.app.ui.damageNumber(s.x, s.y, dealt, crit);
      this.app.events.emit('player:hit', { target: h.target, damage: dealt, crit });
      if (h.target.health.dead) { this.stats.kills++; this.app.events.emit('enemy:killed', { enemy: h.target }); }
    }
    if (any) { this.app.hitStop(heavy ? 0.11 : 0.06); this.app.shake(heavy ? 0.45 : 0.22); }
  }
  // Called each simulation step
  control(dt) {
    const app = this.app, input = app.input;
    if (!this.alive) { this.update(dt); this.cam.update(dt, this.position); return; }
    const look = input.look(); this.cam.look(look.x * this.lookScale, look.y * this.lookScale);
    this.stamina.update(dt); this.abilityCooldown = Math.max(0, this.abilityCooldown - dt);
    this.combo.update(dt); this.parryWindow = Math.max(0, this.parryWindow - dt);
    const mv = input.moveVector();
    let dir = this.cam.moveDir(mv.x, mv.y);
    const moving = dir.lengthSq() > 0.01;
    if (moving) dir.normalize();
    const wantSprint = input.held('sprint') && moving && !this.blocking && this.aimFacing == null && !this.crouching;
    const sprinting = wantSprint && this.stamina.drain(18, dt);
    let speed = moving ? (sprinting ? this.ctrl.sprintSpeed : this.ctrl.runSpeed * Math.min(1, Math.hypot(mv.x, mv.y) * 1.2)) : 0;
    const busy = this.anim.isPlaying() && this.anim.current.name !== 'hit';
    // lock-on
    if (this.combat && input.pressed('lockOn')) {
      if (this.lockTarget) this.lockTarget = null;
      else { let best = null, bd = 18; for (const t of this.targets()) if (t.alive) { const d = t.position.distanceTo(this.position); if (d < bd) { bd = d; best = t; } } this.lockTarget = best; }
    }
    if (this.lockTarget && (!this.lockTarget.alive || this.lockTarget.position.distanceTo(this.position) > 25)) this.lockTarget = null;
    this.cam.lockTarget = this.lockTarget ? this.lockTarget.position : null;
    // dodge
    if (this.dodging > 0) {
      this.dodging -= dt; this.health.invulnerable = Math.max(this.health.invulnerable, 0.05);
      dir = this.dodgeDir; speed = 9.5 * Math.max(0.3, this.dodging / 0.55);
    } else if (this.combat && input.pressed('dodge') && this.ctrl.grounded && this.stamina.use(22)) {
      this.dodging = 0.55; this.dodgeDir = moving ? dir.clone() : this.ctrl.forward().multiplyScalar(-1);
      this.ctrl.facing = Math.atan2(this.dodgeDir.x, this.dodgeDir.z);
      this.anim.play('dodge'); app.audio.play('dodge'); this.stats.dodges++; this.combo.index = -1;
      app.vfx.emit('dust', this.position.clone(), {});
    }
    // block
    const wantBlock = this.combat && input.held('block') && this.dodging <= 0 && this.stamina.value > 5;
    if (wantBlock && !this.blocking) this.parryWindow = 0.18;
    this.blocking = wantBlock;
    this.anim.setUpperOverride(this.blocking ? 'block' : this.upperPose);
    if (this.blocking) speed = Math.min(speed, 2);
    // attacks
    if (this.combat && this.dodging <= 0 && !this.blocking) {
      let clip = null;
      if (input.pressed('attack')) clip = this.combo.request(busy, this.anim.progress());
      else clip = this.combo.consumeBuffer(busy, this.anim.progress());
      if (input.pressed('heavy') && (!busy || this.anim.progress() > 0.6) && this.stamina.use(25)) clip = 'heavy';
      if (clip) {
        // soft-lock: snap to the best nearby enemy, preferring the input/camera direction
        let tgt = this.lockTarget;
        if (!tgt) {
          const pref = moving ? dir : this.cam.groundForward(); let bestScore = Infinity;
          for (const t of this.targets()) { if (!t.alive) continue; const to = t.position.clone().sub(this.position).setY(0); const d = to.length(); if (d > 4.5) continue; const sc = d - to.normalize().dot(pref) * 1.5; if (sc < bestScore) { bestScore = sc; tgt = t; } }
        }
        if (tgt) this.ctrl.facing = Math.atan2(tgt.position.x - this.position.x, tgt.position.z - this.position.z);
        else if (moving) this.ctrl.facing = Math.atan2(dir.x, dir.z);
        this.anim.play(clip, { upperOnly: false, speed: clip === 'heavy' ? 1 : 1.15 });
        this.currentAttack = clip;
        this.ctrl.velocity.addScaledVector(this.ctrl.forward(), clip === 'heavy' ? 3 : 2.2);
      }
      if (input.pressed('ability') && this.abilityCooldown <= 0) this.useAbility();
    }
    const attacking = this.anim.isPlaying() && ['attack1', 'attack2', 'attack3', 'heavy', 'cast'].includes(this.anim.current?.name);
    if (attacking) speed = Math.min(speed, 0.6);
    // lock-on strafing: face target
    let face = !(this.lockTarget && !sprinting && this.dodging <= 0);
    if (!face) this.faceTowards(this.lockTarget.position, dt, 12);
    else if (this.aimFacing != null && this.dodging <= 0) { face = false; let d = this.aimFacing - this.ctrl.facing; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; this.ctrl.facing += d * (1 - Math.exp(-22 * dt)); }
    if (this.speedScale !== 1 && this.dodging <= 0) speed *= this.speedScale;
    if (this.moveFilter) { const f = this.moveFilter(moving || this.dodging > 0 ? dir : new THREE.Vector3(), speed, dt); dir = f.dir; speed = f.speed; }
    const jump = input.pressed('jump') && !attacking && this.dodging <= 0 && !this.blocking && !this.moveFilter;
    if (jump && this.ctrl.grounded) app.audio.play('jump', { volume: 0.6 });
    const wasAir = !this.ctrl.grounded;
    this.update(dt, moving || this.dodging > 0 || this.moveFilter ? dir : new THREE.Vector3(), speed, { jump, faceMovement: face && !attacking });
    if (wasAir && this.ctrl.grounded && (this.ctrl.landSpeed || 0) > 6) { app.audio.play('land'); app.vfx.emit('dust', this.position.clone()); if (this.ctrl.landSpeed > 12) this.anim.play('land'); }
    // interaction
    this.focus = null; let best = 99;
    for (const it of this.interactables) {
      if (it.enabled && !it.enabled()) continue;
      const d = it.position.distanceTo(this.position);
      if (d < (it.radius || 2.2) && d < best) { best = d; this.focus = it; }
    }
    app.ui.prompt(this.focus && !app.ui.dialogueOpen ? this.focus.label : null, input.describe('interact'));
    if (this.focus && input.pressed('interact') && !app.ui.dialogueOpen) this.focus.action(this);
    this.cam.update(dt, this.position, { facing: this.facing, speed: this.ctrl.horizontalSpeed(), sprinting });
    app.audio.setListener(this.position.x, this.position.y, this.position.z, this.cam.yaw + Math.PI);
    app.atmosphere.setFocus(this.position);
  }
  // Incoming damage passes through block/parry logic.
  receive(amount, info = {}) {
    if (!this.alive) return 0;
    if (this.dodging > 0) return 0;
    if (this.blocking && info.direction) {
      const toAttacker = info.direction.clone().multiplyScalar(-1);
      const facing = this.ctrl.forward();
      if (facing.dot(toAttacker) > 0.2) {
        if (this.parryWindow > 0) { this.stats.parries++; this.app.audio.play('clang'); this.app.vfx.emit('sparks', this.position.clone().setY(this.position.y + 1.3), { count: 30 }); this.app.hitStop(0.12); info.source?.health.damage(10, { direction: info.direction.clone().multiplyScalar(-1), stagger: 1.2, knockback: 3 }); this.app.events.emit('player:parry'); return 0; }
        this.stamina.use(Math.min(this.stamina.value, amount * 0.8)); this.app.audio.play('block');
        this.app.vfx.emit('sparks', this.position.clone().setY(this.position.y + 1.3), { count: 8 });
        return this.health.damage(amount * 0.15, { ...info, noStagger: true, knockback: 1.5 });
      }
    }
    return this.health.damage(amount, info);
  }
  useAbility() {
    this.abilityCooldown = this.abilityMax;
    this.anim.play('cast');
    const app = this.app;
    setTimeout(() => {}, 0);
    const p = this.position.clone().setY(this.position.y + 0.3);
    app.vfx.emit('magic', p, { count: 60, scale: 2.2 }); app.vfx.emit('dust', p, { count: 30, scale: 2 });
    app.audio.play('explosion', { pitch: 1.4, volume: 0.7 }); app.audio.play('magic');
    app.shake(0.6);
    for (const t of this.targets()) {
      if (!t.alive) continue; const d = t.position.distanceTo(this.position);
      if (d < 6.5) { const dir = t.position.clone().sub(this.position).setY(0).normalize(); const dealt = t.health.damage(28 * this.damageMult, { direction: dir, knockback: 11, up: 6, stagger: 1.4, source: this }); this.stats.damageDealt += dealt; if (t.health.dead) { this.stats.kills++; app.events.emit('enemy:killed', { enemy: t }); } }
    }
    app.events.emit('player:ability');
  }
}
