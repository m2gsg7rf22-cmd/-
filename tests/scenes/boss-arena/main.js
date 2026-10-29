// Boss Arena — focused integration scene for the boss kit (NOT a game).
// Player (melee: combo, dodge i-frames, parry, lock-on) vs an Enemy driven by BossController:
// 3 phases, cone/line/circle telegraphs, leap slam, poise break, enrage. Driven by playtest.json.
import * as GF from '../../../engine/index.js';
const { THREE } = GF;

const app = new GF.GameApp({ id: 'boss-arena', title: 'Boss Arena', container: document.getElementById('game'), timeOfDay: 17.5, theme: { accent: '#ff7a3a' } });
const floor = new THREE.Mesh(new THREE.CircleGeometry(22, 64).rotateX(-Math.PI / 2), GF.pbr('cobble', { cells: 30, color: 0x7a7266 })); floor.receiveShadow = true; app.scene.add(floor);
const pillarMat = GF.pbr('concrete', { color: 0x8a8478 });
for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2, x = Math.cos(a) * 20, z = Math.sin(a) * 20; const p = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.9, 7, 16), pillarMat); p.position.set(x, 3.5, z); p.castShadow = p.receiveShadow = true; app.scene.add(p); app.physics.addStatic({ type: 'cylinder', x, y: 3.5, z, r: 0.85, h: 7 }, { kind: 'pillar' }); }

const player = new GF.Player(app, { combat: true, hp: 300, position: new THREE.Vector3(0, 0.1, 9), facing: Math.PI, look: { seed: 6, outfit: 'armor', armor: true } });
const enemy = new GF.Enemy(app, { type: 'brute', hp: 900, scale: 1.45, position: new THREE.Vector3(0, 0.1, -4), facing: 0 });
player.targets = () => [enemy].filter((e) => e.alive);
const boss = new GF.BossController(app, enemy, {
  name: 'The Warden', poise: 140, enrage: 240, seed: 3,
  attacks: {
    sweep: { clip: 'heavy', windup: 0.75, active: 0.25, recovery: 0.9, shape: 'cone', radius: 4.2, arc: 140, damage: 26, range: [0, 3.8] },
    lunge: { clip: 'attack3', windup: 0.55, active: 0.35, recovery: 0.8, shape: 'line', length: 7, width: 1.8, damage: 20, move: 'lunge', range: [3, 8] },
    slam: { clip: 'heavy', windup: 1.1, active: 0.35, recovery: 1.4, shape: 'circle', radius: 4.5, damage: 34, move: 'leap', range: [5, 15], cooldown: 4 },
    nova: { clip: 'cast', windup: 1.4, active: 0.2, recovery: 1.2, shape: 'ring', inner: 2.5, radius: 9, damage: 30, range: [0, 9], cooldown: 6 },
  },
  phases: [{ until: 0.6, attacks: ['sweep', 'lunge'] }, { until: 0.3, attacks: ['sweep', 'lunge', 'slam'], speed: 1.15 }, { attacks: ['sweep', 'slam', 'nova', 'lunge'], speed: 1.3, combo: 2 }],
});
const log = { phases: [], attacks: {}, hits: 0, breaks: 0, dead: false };
boss.on('phase', (e) => log.phases.push(e.phase)).on('attack', (e) => { log.attacks[e.attack] = (log.attacks[e.attack] || 0) + 1; }).on('hit', (e) => { if (e.damage > 0) log.hits++; }).on('poiseBreak', () => log.breaks++).on('death', () => { log.dead = true; });
let frozen = false;
app.add((dt) => {
  if (app.state !== 'playing') return;
  player.control(dt);
  if (!frozen) boss.update(dt, player.alive ? player : null);
  enemy.update(dt);
  GF.separateActors([player, enemy]);
  app.ui.boss(enemy.alive ? boss.name : null, enemy.health.ratio);
});
window.__GF.cheat = {
  hurtBoss: (amount, heavy = false, poise) => enemy.health.damage(amount, { heavy, source: player, poiseDamage: poise }),
  freeze: (on) => { frozen = on; },
  teleport: (x, z, facing = Math.PI) => { player.ctrl.teleport(new THREE.Vector3(x, 0.1, z)); player.ctrl.facing = facing; },
  heal: () => { player.health.value = player.health.max; },
  bossTo: (x, z) => enemy.ctrl.teleport(new THREE.Vector3(x, 0.1, z)),
};
app.debugState = () => ({ boss: boss.debug(), log, player: { hp: Math.round(player.health.value), dodges: player.stats.dodges, x: +player.position.x.toFixed(1), z: +player.position.z.toFixed(1) }, bossHp: Math.round(enemy.health.value) });
app.start();
app.setState('playing');
app.ui.toast('Boss Arena', { sub: 'boss kit test scene' });
