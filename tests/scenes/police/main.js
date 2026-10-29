// Police — focused integration scene for WantedSystem + policeForce (NOT a game).
// Level 1: unarmed officers chase; standing still next to one = arrest. Level 2+: armed officers
// (RangedEnemy) shoot from cover. Driven by playtest.json.
import * as GF from '../../../engine/index.js';
const { THREE } = GF;
const app = new GF.GameApp({ id: 'police', title: 'Police', container: document.getElementById('game'), timeOfDay: 15, theme: { accent: '#5aa0ff' } });
const ground = new THREE.Mesh(new THREE.PlaneGeometry(160, 160).rotateX(-Math.PI / 2), GF.pbr('asphalt', { repeat: 20 })); ground.receiveShadow = true; app.scene.add(ground);
const mat = GF.solid(0x8a8780, { roughness: 0.9 });
for (const [x, z, w, d] of [[-10, 8, 6, 1], [10, 6, 1, 6], [0, -12, 8, 1], [-14, -6, 1, 5], [14, -8, 4, 1]]) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, 1.3, d), mat); m.position.set(x, 0.65, z); m.castShadow = m.receiveShadow = true; app.scene.add(m); app.physics.addStatic({ type: 'box', x, y: 0.65, z, hx: w / 2, hy: 0.65, hz: d / 2 }, { kind: 'cover' }); }
const player = new GF.Player(app, { combat: false, hp: 5000, position: new THREE.Vector3(0, 0.1, 0), facing: 0, look: { seed: 7, outfit: 'street' } });
app.__enemies = [];
const cover = new GF.CoverSystem(app.physics);
const police = GF.policeForce(app, { player, cover, armedFrom: 2 });
const wanted = new GF.WantedSystem({ ...police.callbacks, events: app.events, spawnRadius: [14, 20], unitsPerLevel: [0, 2, 3, 4, 5, 6] });
const log = { arrests: 0, levels: [] };
app.events.on('police:arrest', () => { log.arrests++; app.ui.toast('Busted', { big: true }); });
app.events.on('wanted:level', (e) => log.levels.push(e.level));
let frozen = false;
app.add((dt) => {
  if (app.state !== 'playing') return;
  player.control(dt);
  if (!frozen) { wanted.update(dt, player); police.update(dt, wanted); }
  GF.separateActors([player, ...wanted.units.filter((u) => u.alive)]);
  app.ui.stars?.(wanted.level);
});
window.__GF.cheat = {
  crime: (kind) => wanted.commit(kind, { position: player.position.clone() }),
  setLevel: (n) => wanted.setLevel(n, { position: player.position.clone() }),
  walk: (on) => app.input.setVirtual('moveY', on ? 1 : 0),
};
app.debugState = () => ({ level: wanted.level, units: wanted.units.filter((u) => u.alive).map((u) => ({ armed: !!u.armed, d: +u.position.distanceTo(player.position).toFixed(1) })), police: { ...police.state }, arrestProgress: +police.arrestProgress.toFixed(2), log, playerHp: Math.round(player.health.value), shots: wanted.units.reduce((s, u) => s + (u.shotsFired || 0), 0) });
app.start(); app.setState('playing');
