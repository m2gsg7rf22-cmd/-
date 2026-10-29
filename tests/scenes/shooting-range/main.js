// Shooting Range — focused integration scene for the shooter kit (NOT a game).
// Exercises: WeaponSystem (hitscan, ammo, reload, switching, ADS), ShootingTarget hitboxes,
// ShooterController (third/first-person cameras, crosshair + ammo HUD, snap-to-cover),
// CoverSystem and two RangedEnemy AIs using cover / peek-shoot. Driven by playtest.json.
import * as GF from '../../../engine/index.js';
const { THREE } = GF;

const app = new GF.GameApp({ id: 'shooting-range', title: 'Shooting Range', container: document.getElementById('game'), timeOfDay: 14, theme: { accent: '#ffb347' } });

// ---------- range geometry (static colliders double as cover)
const concrete = GF.solid(0x8a8780, { roughness: 0.9 }), dark = GF.solid(0x4a4e55, { roughness: 0.8 }), lane = GF.solid(0x5d6b4a, { roughness: 1 });
const ground = new THREE.Mesh(new THREE.PlaneGeometry(140, 140).rotateX(-Math.PI / 2), lane); ground.receiveShadow = true; app.scene.add(ground);
const blocks = [];
function block(x, z, w, h, d, { yaw = 0, mat = concrete, kind = 'wall' } = {}) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, h / 2, z); m.rotation.y = yaw; m.castShadow = m.receiveShadow = true; app.scene.add(m);
  const s = app.physics.addStatic({ type: 'box', x, y: h / 2, z, hx: w / 2, hy: h / 2, hz: d / 2, yaw }, { kind }); blocks.push(s); return s;
}
block(-6, 3, 3, 1.2, 0.5);                    // player low cover (snap test)
block(6, 3, 1, 2.6, 1.4, { mat: dark });      // player high cover (peek test)
block(0, -4, 30, 3, 0.6, { mat: dark });      // back wall
for (const x of [-15, 15]) block(x, 14, 0.6, 3, 36, { mat: dark }); // side walls
// enemy positions: low walls + a pillar
block(-5, 26, 3.4, 1.2, 0.5); block(5, 27, 3.4, 1.2, 0.5); block(0, 30, 1.2, 2.6, 1.2, { mat: dark });
block(-9, 20, 2.5, 1.2, 0.5); block(9, 20, 2.5, 1.2, 0.5);

// ---------- practice targets
const targets = [-4, 0, 4].map((x, i) => new GF.ShootingTarget(app, { position: new THREE.Vector3(x, 0, 15), facing: Math.PI, hp: 100, resetTime: i === 2 ? 0 : 4, name: 'T' + i }));
let targetHits = 0, targetKills = 0;
for (const t of targets) { t.on('hit', () => targetHits++); t.on('death', () => targetKills++); }

// ---------- player + shooter controller
const player = new GF.Player(app, { combat: false, hp: 2000, position: new THREE.Vector3(0, 0.1, 0), facing: 0, look: { seed: 3, outfit: 'casual', top: 0x2e3a4a, bottom: 0x23262e, hairStyle: 'short' } });
const enemies = [];
player.targets = () => [...targets.filter((t) => t.alive), ...enemies.filter((e) => e.alive)];
const shooter = new GF.ShooterController(app, player, { weapons: ['rifle', 'pistol', 'shotgun'], aimAssist: { strength: 0 } });

// ---------- ranged AI
const cover = new GF.CoverSystem(app.physics);
let active = false;
for (const [i, [x, z, type]] of [[-4, 33, 'rifleman'], [5, 34, 'gunner']].entries()) {
  const e = new GF.RangedEnemy(app, { type, position: new THREE.Vector3(x, 0.1, z), facing: Math.PI, cover, seed: 11 + i, targets: () => [player] });
  e.on('death', () => app.after(4, () => e.remove()));
  enemies.push(e);
}
app.__enemies = enemies;
let hitsOnPlayer = 0;
for (const e of enemies) e.weapons.on('hit', (ev) => { if (ev.target === player) hitsOnPlayer++; });

// ---------- loop
app.add((dt) => {
  shooter.control(dt);
  for (const e of enemies) { e.think(dt, active ? player : null); e.update(dt); }
  for (const t of targets) t.update(dt);
  GF.separateActors([player, ...enemies]);
});

// ---------- test hooks
const DEG = Math.PI / 180;
const aimAtPoint = (p, iters = 4) => {
  for (let k = 0; k < iters; k++) {
    const cam = app.camera.position, d = p.clone().sub(cam).normalize(), r = shooter.rig;
    r.yaw = Math.atan2(-d.x, -d.z); r.pitch = shooter.view === 'first' ? -Math.asin(d.y) : Math.min(r.maxPitch, Math.max(r.minPitch, -Math.asin(d.y)));
    window.__GF.step(6);
  }
};
window.__GF.cheat = {
  aimAt: (i, zone = 'body') => { const t = targets[i]; const hb = t.hitboxes().find((h) => h.zone === zone); aimAtPoint(zone === 'head' ? hb.center.clone() : hb.min.clone().add(hb.max).multiplyScalar(0.5)); },
  aimAtEnemy: (i) => { const e = enemies[i]; aimAtPoint(e.position.clone().setY(e.position.y + 1.2)); },
  teleport: (x, z, facing = 0) => { player.ctrl.teleport(new THREE.Vector3(x, 0.1, z)); player.ctrl.facing = facing; shooter.rig.yaw = facing + Math.PI; },
  activate: () => { active = true; },
  killEnemy: (i) => enemies[i].health.damage(1e6, {}),
};
app.debugState = () => ({
  ...shooter.debug(),
  player: { x: +player.position.x.toFixed(2), z: +player.position.z.toFixed(2), hp: Math.round(player.health.value), damageTaken: Math.round(player.stats.damageTaken) },
  targetHp: targets.map((t) => Math.round(t.health.value)), targetHits, targetKills,
  enemies: enemies.map((e) => e.debug()), enemyShots: enemies.reduce((s, e) => s + e.shotsFired, 0), hitsOnPlayer,
  enemyStates: [...new Set(enemies.flatMap((e) => e.debug().visited))],
  hud: { ammo: app.ui.widgets.ammo?.value || null, reticleHits: app.ui.widgets.reticle?.hits || 0 },
});
app.start();
app.setState('playing');
app.ui.toast('Shooting Range', { sub: 'shooter kit test scene' });
