// Ashen Vale — third-person action demo built with GameForge.
// Fight through waves of raiders in a ruined hill-fort at dusk and defeat the Warden.
import * as GF from '../../engine/index.js';
const { THREE } = GF;

const SPEC = { id: 'ashen-vale', title: 'Ashen Vale', seed: 7 };
const app = new GF.GameApp({ id: SPEC.id, title: SPEC.title, container: document.getElementById('game'), timeOfDay: 17.6,
  theme: { accent: '#ffb347', accent2: '#ff6a3a' }, atmosphere: { turbidity: 4, rayleigh: 1.8, exposure: 1.05 }, touchButtons: [['attack', '⚔'], ['dodge', '↺'], ['jump', '⤒'], ['ability', '✦']] });
const loader = app.ui.loading('Forging the vale…');

// ---------- World ----------
const ARENA = { x: 0, z: 0, r: 26 };
const hf = new GF.Heightfield({ size: 360, resolution: 180, seed: SPEC.seed, height: 34, type: 'hills', flatten: [{ x: 0, z: 0, radius: ARENA.r + 4, falloff: 22, height: 6 }], roads: [{ points: [[0, 30], [10, 70], [-6, 120], [0, 170]], width: 7 }] });
app.physics.hf = hf; app.physics.waterLevel = -50;
app.scene.add(GF.terrainMesh(hf, { palette: { grass: 0x5a6a2c, grass2: 0x8a8a3a, dirt: 0x6a5038, rock: 0x6a625a } }));
loader.set(0.25, 'Raising ruins…');
const rng = new GF.RNG(SPEC.seed);
const ruins = new THREE.Group();
const ground = hf.heightAt(0, 0);
// ring of pillars + broken walls + braziers
for (let i = 0; i < 14; i++) {
  const a = (i / 14) * Math.PI * 2, r = ARENA.r - 1;
  const broken = rng.chance(0.45);
  const p = GF.PROPS.pillar({ height: 6.5, radius: 0.55, broken, seed: i });
  p.position.set(Math.cos(a) * r, ground - 0.1, Math.sin(a) * r); ruins.add(p);
}
for (let i = 0; i < 6; i++) {
  const a = (i / 6) * Math.PI * 2 + 0.25, r = ARENA.r + 3;
  const w = GF.PROPS.stoneWall({ length: 9, height: 3.2, thickness: 1, ruined: true, seed: i + 3 });
  w.position.set(Math.cos(a) * r, ground - 0.2, Math.sin(a) * r); w.rotation.y = -a + Math.PI / 2; ruins.add(w);
}
const torches = [];
for (let i = 0; i < 6; i++) {
  const a = (i / 6) * Math.PI * 2 + 0.52, r = ARENA.r - 4;
  const t = GF.PROPS.torch({ height: 1.7 }); t.position.set(Math.cos(a) * r, ground, Math.sin(a) * r); ruins.add(t); torches.push(t);
}
// central altar dais
const dais = new GF.Geo.MeshBuilder();
dais.add(GF.Geo.boxUV(new THREE.CylinderGeometry(6, 6.6, 0.5, 32), 0.4), GF.pbr('cobble', { cells: 9, color: 0x8a8278 }), GF.Geo.mat4([0, ground + 0.15, 0]));
dais.add(GF.Geo.boxUV(new THREE.CylinderGeometry(3, 3.2, 0.4, 24), 0.4), GF.pbr('cobble', { cells: 6, color: 0x7a7268 }), GF.Geo.mat4([0, ground + 0.5, 0]));
ruins.add(dais.build({ name: 'dais' }));
for (const k of [[-8, 8, 'crate'], [9, -7, 'barrel'], [10, -6, 'barrel'], [-9, -9, 'crate'], [7, 10, 'chest']]) { const o = GF.PROPS[k[2]]({}); o.position.set(k[0], ground, k[1]); o.rotation.y = rng.range(0, 6); ruins.add(o); }
ruins.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
app.scene.add(ruins);
for (const c of ruins.children) if (c.userData.collider) app.physics.addFromObject(c);
app.physics.addStatic({ type: 'cylinder', x: 0, y: ground, z: 0, r: 6.3, h: 0.4 }, { kind: 'dais' });
app.physics.addStatic({ type: 'cylinder', x: 0, y: ground, z: 0, r: 3.1, h: 0.7 }, { kind: 'dais' });
// fire light from torches (a few real lights, rest emissive)
for (const t of torches.slice(0, 3)) { const l = new THREE.PointLight(0xff8a3a, 18, 16, 2); l.position.copy(t.position).add(new THREE.Vector3(0, 2.1, 0)); app.scene.add(l); t.userData.light = l; }
loader.set(0.5, 'Growing the forest…');
const veg = GF.populate(hf, { seed: SPEC.seed, trees: 260, rocks: 90, bushes: 160, grass: app.gfx.tier.name === 'low' ? 2500 : 9000, species: ['oak', 'pine', 'dead'], exclude: [{ x: 0, z: 0, r: ARENA.r + 6 }], palette: { leaves: [0x7a6a2a, 0x8a4a22, 0x5a6a2a, 0xa05a2a], grass: 0x8a8a3a, bush: 0x6a5a2a } });
app.scene.add(veg.group);
for (const c of veg.colliders) app.physics.addStatic({ type: 'cylinder', x: c.x, y: hf.heightAt(c.x, c.z) - 0.5, z: c.z, r: c.r, h: c.h }, { kind: c.kind });
loader.set(0.75, 'Summoning raiders…');

// ---------- Player ----------
const player = new GF.Player(app, { combat: true, hp: 160, position: new THREE.Vector3(0, ground + 0.6, 18), facing: Math.PI,
  look: { seed: 11, outfit: 'armor', armor: true, cape: true, top: 0x2e3440, bottom: 0x232830, accent: 0xc9a227, capeColor: 0x8a1c1c, hairStyle: 'short', hair: 0x2a1a10, skin: 0xc68c64 } });
const progression = new GF.Progression();
progression.onLevel = (lvl) => { player.damageMult = 1 + (lvl - 1) * 0.15; player.health.max += 20; player.health.heal(60); app.ui.toast(`Level ${lvl}`, { big: true, sub: 'Strength grows' }); app.audio.play('levelUp'); app.vfx.emit('heal', player.position.clone().setY(player.position.y + 1), { count: 40 }); };

// ---------- Enemies & waves ----------
let enemies = []; app.__enemies = enemies;
const sharedTokens = { max: 2, holders: new Set(), take(e) { if (this.holders.has(e)) return true; if (this.holders.size >= this.max) return false; this.holders.add(e); return true; }, give(e) { this.holders.delete(e); } };
const WAVES = [
  { name: 'Scouts', units: [['grunt', 3]] },
  { name: 'Raiding Party', units: [['grunt', 3], ['thug', 2]] },
  { name: 'Blademasters', units: [['duelist', 2], ['grunt', 2], ['thug', 1]] },
  { name: 'Iron Wall', units: [['brute', 2], ['duelist', 2]] },
  { name: 'The Warden', units: [['brute', 1, { boss: true }], ['grunt', 2]] },
];
let wave = -1, waveTimer = 3, score = 0, bossRef = null, kills = 0;
function spawnWave(i) {
  const w = WAVES[i]; let k = 0;
  for (const [type, n, extra] of w.units) for (let j = 0; j < n; j++, k++) {
    const a = rng.range(0, Math.PI * 2), r = ARENA.r - 3;
    const pos = new THREE.Vector3(Math.cos(a) * r, ground + 1, Math.sin(a) * r);
    const boss = extra?.boss;
    const e = new GF.Enemy(app, { type, position: pos, tokens: sharedTokens, seed: i * 100 + k, ...(boss ? { hp: 650, scale: 1.55, look: { top: 0x1a1a1a, accent: 0xff4a1a, cape: true, capeColor: 0x2a0a0a }, stats: { damage: 30, range: 2.9, attackCooldown: 1.8, moveSpeed: 3.4, attacks: ['heavy', 'attack3', 'attack1'] } } : {}) });
    e.perception.aware = 1; e.isBoss = !!boss; if (boss) { bossRef = e; e.name = 'The Warden'; }
    e.anim.on('hit', () => {
      if (!e.alive || e.stagger > 0) return;
      for (const h of e.strike([player])) { const dealt = player.receive(e.stats.damage, { direction: h.direction, knockback: e.isBoss ? 7 : 3.5, source: e }); if (dealt > 0) app.events.emit('player:damaged', dealt); }
      app.audio.play('swing', { pos: e.position, pitch: 0.8 });
    });
    e.on('windup', () => { if (e.isBoss) app.audio.play('whoosh', { pos: e.position, pitch: 0.6 }); });
    e.on('death', () => {
      kills++; score += e.isBoss ? 2000 : e.type === 'brute' ? 400 : 150;
      progression.addXP(e.isBoss ? 300 : e.type === 'brute' ? 80 : 35);
      app.audio.play('death', { pos: e.position, pitch: e.isBoss ? 0.6 : 1 });
      if (rng.chance(0.35)) spawnPickup(e.position.clone(), 'health');
      app.after(4, () => e.remove());
    });
    e.on('footstep', () => {});
    enemies.push(e);
  }
  app.__enemies = enemies;
  app.ui.toast(w.name, { big: true, sub: `Wave ${i + 1} / ${WAVES.length}` });
  app.audio.play('alarm', { volume: 0.4 });
  app.audio.playMusic('combat', { intensity: 0.5 + i * 0.12 });
}
const pickups = [];
function spawnPickup(pos, type) {
  const p = GF.PROPS.pickup({ type }); p.position.copy(pos).setY(hf.heightAt(pos.x, pos.z) + 0.9); app.scene.add(p); pickups.push({ obj: p, type, t: 0 });
}
player.targets = () => enemies.filter((e) => e.alive);

// ---------- HUD ----------
const hpBar = app.ui.bar('hp', { label: 'Health', color: 'linear-gradient(90deg,#ff4d5e,#ff8a5e)', showValue: true });
const stBar = app.ui.bar('stamina', { label: 'Stamina', color: 'linear-gradient(90deg,#5dff9a,#b6ff5d)' });
const abil = app.ui.counter('ability', { icon: '✦', label: 'Shockwave', corner: 'bl', value: 'READY' });
const lvl = app.ui.counter('level', { icon: '★', label: 'Lv', corner: 'bl', value: '1' });
const scoreC = app.ui.counter('score', { icon: '◆', label: 'Score', value: '0' });
const waveC = app.ui.counter('wave', { icon: '⚔', label: 'Wave', value: '-' });
const objectives = app.ui.objectives('tr');
const minimap = app.ui.minimap({ range: 45 });
const lockMarker = new THREE.Mesh(new THREE.RingGeometry(0.35, 0.45, 24), new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.85, depthTest: false, side: THREE.DoubleSide }));
lockMarker.renderOrder = 20; lockMarker.visible = false; app.scene.add(lockMarker);
const CONTROLS = [['Move', 'WASD'], ['Camera', 'Mouse (click to lock)'], ['Attack / combo', 'LMB / J'], ['Heavy attack', 'RMB / K'], ['Block (tap = parry)', 'Q'], ['Dodge roll', 'Alt / L'], ['Sprint', 'Shift'], ['Jump', 'Space'], ['Lock-on', 'Tab'], ['Shockwave', 'F'], ['Pause', 'Esc / P']];

// ---------- Save ----------
app.save.register('meta', { save: () => ({ best: Math.max(best, score) }), load: (d) => { best = d.best || 0; } });
let best = 0; app.save.load('meta');

// ---------- Game flow ----------
function resetGame() {
  for (const e of enemies) e.remove();
  enemies = []; app.__enemies = enemies; sharedTokens.holders.clear();
  for (const p of pickups) app.scene.remove(p.obj); pickups.length = 0;
  player.health.max = 160 + (progression.level - 1) * 20; player.health.revive(1); player.alive = true; player.anim.current = null; player.anim.mixer.stopAllAction(); player.anim = new GF.HumanoidAnimator(player.model); player.anim.on('hit', (c) => player._onStrike(c));
  player.ctrl.teleport(new THREE.Vector3(0, ground + 0.6, 18)); player.ctrl.facing = Math.PI; player.cam.yaw = 0;
  app.loop.timeScale = 1; wave = -1; waveTimer = 2.5; score = 0; kills = 0; bossRef = null; app.ui.boss(null);
  app.setState('playing');
  app.audio.playMusic('tension', { intensity: 0.4 });
}
function gameOver(victory) {
  app.setState('gameover');
  best = Math.max(best, score); app.save.save('meta');
  app.audio.playMusic(victory ? 'heroic' : 'mystery', { intensity: 0.4 });
  if (victory) app.audio.play('questComplete');
  app.after(victory ? 1.6 : 1.2, () => app.ui.endScreen({ victory, title: victory ? 'Victory' : 'You Fell', text: victory ? 'The Warden is slain. Ashen Vale is free.' : 'The raiders hold the vale… for now.',
    stats: { Score: score, Best: best, Kills: kills, 'Wave reached': `${Math.max(1, wave + 1)} / ${WAVES.length}`, Parries: player.stats.parries, Level: progression.level }, onRetry: resetGame, onQuit: showTitle }));
}
function showTitle() {
  app.setState('menu');
  app.ui.mainMenu({ subtitle: 'A GameForge action demo. Hold the ruined hill-fort against five waves of raiders and slay the Warden.', onStart: resetGame, controls: CONTROLS, credits: 'Built entirely from procedural geometry, textures, animation and audio by the GameForge AAA toolkit (three.js renderer, MIT).' });
}
addEventListener('click', () => { if (app.state === 'playing' && !document.pointerLockElement && !('ontouchstart' in window)) app.input.requestPointerLock(app.renderer.domElement); });

app.add((dt) => {
  if (app.input.pressed('pause')) { app.setState('paused'); document.exitPointerLock?.(); app.ui.pauseMenu({ onResume: () => app.setState('playing'), onRestart: resetGame, onQuit: showTitle, controls: CONTROLS }); return; }
  player.control(dt);
  for (const e of enemies) { e.think(dt, player); e.update(dt); }
  GF.separateActors([player, ...enemies]);
  // waves
  const alive = enemies.filter((e) => e.alive).length;
  if (alive === 0 && player.alive) {
    if (wave >= WAVES.length - 1) { if (app.state === 'playing') { app.loop.timeScale = 0.35; app.after(0.5, () => (app.loop.timeScale = 1)); gameOver(true); } }
    else { waveTimer -= dt; if (waveTimer <= 0) { wave++; spawnWave(wave); waveTimer = 4; if (wave > 0) { player.health.heal(40); app.vfx.emit('heal', player.position.clone().setY(player.position.y + 1)); } } }
  }
  if (!player.alive && app.state === 'playing') gameOver(false);
  // pickups
  for (const p of pickups) { p.t += dt; p.obj.rotation.y += dt * 2; p.obj.position.y += Math.sin(p.t * 3) * 0.004; if (!p.taken && p.obj.position.distanceTo(player.position.clone().setY(player.position.y + 0.9)) < 1.3) { p.taken = true; app.scene.remove(p.obj); player.health.heal(45); app.audio.play('pickup'); app.vfx.emit('heal', player.position.clone().setY(player.position.y + 1)); } }
  // torch flicker
  for (const t of torches) if (t.userData.light) t.userData.light.intensity = 16 + Math.sin(app.loop.time * 13 + t.position.x) * 3 + Math.random() * 2;
  if (rng.chance(0.3)) { const t = rng.pick(torches); app.vfx.emit('fire', t.position.clone().add(new THREE.Vector3(0, 2.05, 0)), { count: 1, scale: 0.7 }); }
  // HUD
  hpBar.set(player.health.ratio, `${Math.ceil(player.health.value)}/${player.health.max}`); stBar.set(player.stamina.ratio);
  abil.set(player.abilityCooldown > 0 ? player.abilityCooldown.toFixed(1) + 's' : 'READY'); lvl.set(progression.level);
  scoreC.set(score); waveC.set(wave < 0 ? '-' : `${wave + 1}/${WAVES.length}`);
  objectives.set(wave < 0 ? 'Prepare yourself' : WAVES[wave].name, [{ text: `Defeat the raiders (${enemies.filter((e) => !e.alive).length}/${enemies.length})`, done: alive === 0 }, { text: 'Parry an attack (tap Q as it lands)', done: player.stats.parries > 0, optional: true }]);
  if (bossRef) app.ui.boss(bossRef.alive ? bossRef.name : null, bossRef.health.ratio);
  if (player.lockTarget) { lockMarker.visible = true; lockMarker.position.copy(player.lockTarget.position).setY(player.lockTarget.position.y + player.lockTarget.model.userData.height * player.lockTarget.model.scale.y + 0.4); lockMarker.quaternion.copy(app.camera.quaternion); } else lockMarker.visible = false;
  minimap.draw({ center: player.position, yaw: player.cam.yaw, background: (ctx, toMap, k) => { const [x, y] = toMap(0, 0); ctx.strokeStyle = 'rgba(255,180,80,.5)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, ARENA.r * k, 0, Math.PI * 2); ctx.stroke(); },
    markers: enemies.filter((e) => e.alive).map((e) => ({ x: e.position.x, z: e.position.z, color: e.isBoss ? '#ff3a1a' : '#ff5d5d', size: e.isBoss ? 9 : 5, clamp: true })) });
  if (app.audio.music) app.audio.music.intensity = Math.min(1, 0.4 + enemies.filter((e) => e.alive && e.position.distanceTo(player.position) < 12).length * 0.15);
}, { order: 0 });
// keep the world alive behind menus
app.add((dt) => { for (const e of enemies) e.update(dt); if (app.state === 'menu') { app.camera.position.set(Math.sin(app.loop.time * 0.05) * 30, ground + 9, Math.cos(app.loop.time * 0.05) * 30); app.camera.lookAt(0, ground + 2, 0); } }, { states: ['menu', 'gameover'] });

app.debugState = () => ({ player: { x: +player.position.x.toFixed(2), y: +player.position.y.toFixed(2), z: +player.position.z.toFixed(2), hp: Math.round(player.health.value), stamina: Math.round(player.stamina.value), alive: player.alive, anim: player.anim.current?.name || null, grounded: player.ctrl.grounded, level: progression.level },
  wave: wave + 1, waves: WAVES.length, enemiesAlive: enemies.filter((e) => e.alive).length, enemiesTotal: enemies.length, enemyStates: enemies.map((e) => e.state), kills, score, stats: player.stats, boss: bossRef ? Math.round(bossRef.health.value) : null });
// test helpers
window.__GF.player = player;
window.__GF.startGame = () => { app.ui.closeMenu(); resetGame(); };
window.__GF.cheat = { skipToWave: (n) => { for (const e of enemies) if (e.alive) e.health.damage(1e9, {}); wave = n - 2; waveTimer = 0; }, god: () => { player.health.max = 1e6; player.health.value = 1e6; }, killAll: () => { for (const e of enemies) if (e.alive) e.health.damage(1e6, {}); }, damagePlayer: (n) => player.health.damage(n, {}) };

loader.set(1, 'Ready'); setTimeout(() => loader.done(), 300);
showTitle();
app.audio.playMusic('mystery', { intensity: 0.3 });
app.start();
