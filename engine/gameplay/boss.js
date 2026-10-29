// Boss encounters: data-driven movesets with readable telegraphs, phases by health, poise/stagger
// (riposte windows), enrage, arena bounds. Wraps any Enemy (or Actor with health + anim): the
// controller replaces its behaviour tree, the game keeps calling enemy.update(dt).
//
//   const boss = new BossController(app, enemy, {
//     name: 'The Warden',
//     attacks: {
//       sweep: { clip: 'heavy', windup: 0.7, active: 0.25, recovery: 0.9, shape: 'cone', radius: 3.6, arc: 140, damage: 24 },
//       slam:  { clip: 'heavy', windup: 1.1, active: 0.2, recovery: 1.4, shape: 'circle', radius: 4.5, damage: 35, move: 'leap', range: [5, 14] },
//       lunge: { clip: 'attack2', windup: 0.45, active: 0.3, recovery: 0.7, shape: 'line', length: 6, width: 1.6, damage: 18, move: 'lunge' },
//     },
//     phases: [{ until: 0.6, attacks: ['sweep', 'lunge'] }, { until: 0.25, attacks: ['sweep', 'slam', 'lunge'], speed: 1.15 }, { attacks: ['slam', 'lunge'], speed: 1.3, combo: 2 }],
//     poise: 120, arena: { center, radius: 18 }, enrage: 180,
//   });
//   per frame: boss.update(dt, player); enemy.update(dt)      events: 'phase', 'attack', 'hit', 'poiseBreak', 'enrage', 'death'
import * as THREE from '../vendor/three/three.module.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const DEG = Math.PI / 180;
const ATTACK_DEFAULTS = { clip: 'heavy', windup: 0.6, active: 0.25, recovery: 0.8, shape: 'cone', radius: 3, arc: 120, width: 1.5, length: 5, inner: 0, damage: 20, range: [0, 3.5], cooldown: 1.2, weight: 1, move: null, telegraph: true, hitStop: 0.08, knockback: 3, poiseDamage: 0 };

export class BossController {
  constructor(app, enemy, { name = 'Boss', attacks = {}, phases = [{ attacks: Object.keys(attacks) }], poise = 100, poiseRegen = 12, staggerTime = 2.2, arena = null, enrage = Infinity, transition = 1.6, seed = 1 } = {}) {
    Object.assign(this, { app, enemy, name, phases, poiseMax: poise, poise, poiseRegen, staggerTime, arena, enrageAt: enrage, transitionTime: transition });
    this.attacks = Object.fromEntries(Object.entries(attacks).map(([k, a]) => [k, { ...ATTACK_DEFAULTS, ...a, name: k }]));
    this.phase = 0; this.state = 'idle'; this.t = 0; this.current = null; this.cool = {}; this.time = 0; this.enraged = false; this.comboLeft = 0;
    this.listeners = {}; this.stats = { attacks: 0, hitsLanded: 0, poiseBreaks: 0, phases: [0] };
    let s = seed >>> 0; this.rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    enemy.isBoss = true; enemy.name = name;
    // bosses ignore flinching from ordinary hits; damage feeds poise instead
    const h = enemy.health, orig = h.onDamage;
    h.onDamage = (a, info = {}) => {
      const before = this.phase; this._checkPhase();
      if (this.phase === before) { this.poise -= info.poiseDamage ?? a * (info.heavy ? 1.6 : 1); if (this.poise <= 0 && this.state !== 'staggered' && this.state !== 'transition') this._stagger(); }
      orig?.(a, { ...info, noStagger: this.state !== 'staggered' });
    };
    const od = h.onDeath; h.onDeath = (info) => { od?.(info); this.state = 'dead'; this._clearTelegraph(); this.emit('death', { boss: this }); };
    this.decal = null;
  }
  on(e, f) { (this.listeners[e] ||= []).push(f); return this; }
  emit(e, d) { for (const f of this.listeners[e] || []) f(d); this.app.events?.emit?.('boss:' + e, d); }
  get phaseDef() { return this.phases[Math.min(this.phase, this.phases.length - 1)]; }
  get speedMult() { return (this.phaseDef.speed ?? 1) * (this.enraged ? 1.25 : 1); }

  _checkPhase() {
    const ph = this.phaseDef; if (this.enemy.health.dead || ph.until === undefined || this.phase >= this.phases.length - 1) return;
    if (this.enemy.health.ratio <= ph.until) {
      this.phase++; this.stats.phases.push(this.phase); this._clearTelegraph(); this.current = null;
      this.state = 'transition'; this.t = 0; this.enemy.health.invulnerable = this.transitionTime; this.poise = this.poiseMax;
      this.enemy.anim?.play(this.phaseDef.transitionClip || 'cast');
      this.app.shake?.(0.5); this.app.vfx?.emit?.('magic', this.enemy.position.clone().setY(this.enemy.position.y + 1), { count: 80, scale: 2.5 });
      this.phaseDef.onEnter?.(this); this.emit('phase', { boss: this, phase: this.phase });
    }
  }
  _stagger() {
    this.state = 'staggered'; this.t = 0; this.current = null; this._clearTelegraph(); this.stats.poiseBreaks++;
    this.enemy.anim?.play('hit'); this.enemy.stagger = this.staggerTime; this.app.hitStop?.(0.12);
    this.emit('poiseBreak', { boss: this, window: this.staggerTime });
  }
  _choose(target) {
    const d = target.position.distanceTo(this.enemy.position), list = (this.phaseDef.attacks || []).map((n) => this.attacks[n]).filter(Boolean);
    const ok = list.filter((a) => (this.cool[a.name] ?? 0) <= this.time && d >= a.range[0] && d <= a.range[1]);
    if (!ok.length) return null;
    let sum = ok.reduce((s, a) => s + a.weight, 0), r = this.rand() * sum;
    for (const a of ok) { r -= a.weight; if (r <= 0) return a; }
    return ok[ok.length - 1];
  }
  update(dt, target) {
    const E = this.enemy; this.time += dt; this.t += dt;
    if (this.state === 'dead' || E.health.dead) { E.move = V(); return; }
    if (!this.enraged && this.time >= this.enrageAt) { this.enraged = true; this.emit('enrage', { boss: this }); }
    this.poise = Math.min(this.poiseMax, this.poise + this.poiseRegen * dt * (this.state === 'recovery' ? 0.3 : 1));
    E.move = V(); E.target = target;
    const face = (rate = 8) => { if (target) E.faceTowards(target.position, dt, rate); };
    switch (this.state) {
      case 'transition': if (this.t >= this.transitionTime) { this.state = 'idle'; this.t = 0; E.health.invulnerable = 0; } return;
      case 'staggered': if (this.t >= this.staggerTime) { this.state = 'idle'; this.t = 0; this.poise = this.poiseMax; } return;
      case 'idle': case 'approach': {
        if (!target || !target.alive) { E.state = 'patrol'; return; }
        const a = this._choose(target);
        if (a) { this._begin(a, target); return; }
        // approach to the best range of the phase's attacks, circling when close
        const d = target.position.distanceTo(E.position), want = Math.min(...(this.phaseDef.attacks || []).map((n) => this.attacks[n]?.range[1] ?? 3)) * 0.8;
        face(6);
        const to = target.position.clone().sub(E.position).setY(0);
        if (d > want) { E.state = 'chase'; E.move = to.normalize().multiplyScalar(E.stats.moveSpeed * this.speedMult); }
        else { E.state = 'circle'; E.move = new THREE.Vector3(-to.z, 0, to.x).normalize().multiplyScalar(E.stats.moveSpeed * 0.35); }
        this.state = 'approach';
        break;
      }
      case 'windup': {
        const a = this.current, k = Math.min(1, this.t / (a.windup / this.speedMult));
        if (k < 0.75) face(a.move === 'leap' ? 20 : 5);              // tracks early, commits late (dodgeable)
        if (a.move === 'leap' && target) this._leapTarget = target.position.clone();
        this._updateTelegraph(k);
        if (k >= 1) { this.state = 'active'; this.t = 0; this._hitDone = false; if (a.move) this._startMove(a); }
        break;
      }
      case 'active': {
        const a = this.current;
        if (this._moveFn) this._moveFn(dt);
        if (!this._hitDone && this.t >= (a.active / this.speedMult) * 0.5) { this._hitDone = true; this._applyHit(a, target); }
        if (this.t >= a.active / this.speedMult) { this.state = 'recovery'; this.t = 0; this._clearTelegraph(); this._moveFn = null; }
        break;
      }
      case 'recovery': { // punish window
        const a = this.current;
        if (this.t >= a.recovery / this.speedMult) {
          if (this.comboLeft > 0 && target) { this.comboLeft--; const n = this._choose(target); if (n) { this._begin(n, target, true); return; } }
          this.state = 'idle'; this.t = 0; this.current = null;
        }
        break;
      }
    }
  }
  _begin(a, target, chained = false) {
    this.current = a; this.state = 'windup'; this.t = 0; this.cool[a.name] = this.time + a.cooldown; this.stats.attacks++;
    if (!chained) this.comboLeft = (this.phaseDef.combo ?? 1) - 1;
    this.enemy.anim?.play(a.clip, { speed: (this.enemy.stats.attackSpeed || 1) * this.speedMult });
    this.enemy.faceTowards(target.position, 1, 100);
    if (a.telegraph) this._makeTelegraph(a);
    this.emit('attack', { boss: this, attack: a.name });
  }
  _startMove(a) {
    const E = this.enemy, f = E.ctrl ? E.ctrl.forward() : V(Math.sin(E.facing), 0, Math.cos(E.facing));
    if (a.move === 'lunge') { const dist = a.length * 0.8, dur = a.active / this.speedMult; this._moveFn = () => { E.move = f.clone().multiplyScalar(dist / dur * 1.0); }; }
    if (a.move === 'leap' && this._leapTarget) { const from = E.position.clone(), to = this._leapTarget.clone(), dur = a.active / this.speedMult; let k = 0;
      this._moveFn = (dt) => { k = Math.min(1, k + dt / dur); const p = from.clone().lerp(to, k); E.ctrl?.teleport ? E.ctrl.teleport(p.setY(Math.max(p.y, from.y) + Math.sin(k * Math.PI) * 2.5)) : E.position.copy(p); }; }
  }
  /** Is a world point inside attack `a`'s area (from the boss's current pose)? */
  inArea(a, p) {
    const E = this.enemy, o = a.move === 'leap' && this._leapTarget ? this._leapTarget : E.position, d = p.clone().sub(o).setY(0), dist = d.length();
    const f = a.move === 'leap' ? 0 : E.facing ?? 0, ang = Math.abs(Math.atan2(Math.sin(Math.atan2(d.x, d.z) - f), Math.cos(Math.atan2(d.x, d.z) - f)));
    switch (a.shape) {
      case 'circle': return dist <= a.radius;
      case 'ring': return dist <= a.radius && dist >= a.inner;
      case 'cone': return dist <= a.radius && ang <= (a.arc * DEG) / 2;
      case 'line': { const fw = V(Math.sin(f), 0, Math.cos(f)), along = d.dot(fw), side = Math.abs(d.x * fw.z - d.z * fw.x); return along >= -0.5 && along <= a.length && side <= a.width / 2; }
      default: return false;
    }
  }
  _applyHit(a, target) {
    if (!target || !target.alive || !this.inArea(a, target.position)) return;
    const dir = target.position.clone().sub(this.enemy.position).setY(0).normalize();
    const dealt = target.receive ? target.receive(a.damage * (this.enraged ? 1.2 : 1), { source: this.enemy, direction: dir, knockback: a.knockback, heavy: true })
      : target.health?.damage(a.damage, { source: this.enemy, direction: dir, knockback: a.knockback });
    if (dealt > 0) { this.stats.hitsLanded++; this.app.hitStop?.(a.hitStop); this.app.shake?.(0.35); }
    this.emit('hit', { boss: this, attack: a.name, target, damage: dealt });
  }
  // ---------------- telegraphs: ground decal in the attack's exact shape, filling up during the windup
  _makeTelegraph(a) {
    this._clearTelegraph();
    let g;
    if (a.shape === 'circle') g = new THREE.CircleGeometry(a.radius, 40);
    else if (a.shape === 'ring') g = new THREE.RingGeometry(a.inner, a.radius, 48);
    else if (a.shape === 'cone') g = new THREE.CircleGeometry(a.radius, 32, Math.PI / 2 - (a.arc * DEG) / 2, a.arc * DEG);
    else { g = new THREE.PlaneGeometry(a.width, a.length + 0.5); g.translate(0, (a.length + 0.5) / 2 - 0.5, 0); }
    g.rotateX(-Math.PI / 2); if (a.shape === 'cone' || a.shape === 'line') g.rotateY(Math.PI); // geometry +Y → world −Z; flip so it points along +Z (facing 0)
    const mat = new THREE.MeshBasicMaterial({ color: 0xff3a1a, transparent: true, opacity: 0.0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, side: THREE.DoubleSide });
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(g), new THREE.LineBasicMaterial({ color: 0xffb070, transparent: true, opacity: 0.9 }));
    const m = new THREE.Mesh(g, mat); m.add(edge); m.renderOrder = 2; m.name = 'boss-telegraph'; m.userData.attack = a;
    this.app.scene.add(m); this.decal = m; this._updateTelegraph(0);
  }
  _updateTelegraph(k) {
    const m = this.decal; if (!m) return; const a = m.userData.attack, E = this.enemy;
    const o = a.move === 'leap' && this._leapTarget ? this._leapTarget : E.position;
    m.position.set(o.x, (o.y ?? 0) + 0.04, o.z); m.rotation.y = a.move === 'leap' ? 0 : E.facing ?? 0;
    m.material.opacity = 0.12 + 0.43 * k; m.material.color.setHex(k > 0.85 ? 0xff1a0a : 0xff6a2a);
  }
  _clearTelegraph() { if (this.decal) { this.decal.removeFromParent(); this.decal.geometry.dispose(); this.decal.material.dispose(); this.decal = null; } }
  debug() { return { name: this.name, phase: this.phase, state: this.state, attack: this.current?.name || null, hp: +this.enemy.health.ratio.toFixed(3), poise: Math.round(this.poise), enraged: this.enraged, stats: this.stats }; }
}
