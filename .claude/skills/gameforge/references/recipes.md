# Recipes (copy into the owning src/*.js module)

All snippets assume `import * as GF from '../engine/index.js'` (adjust path) and run inside
`export function install(game) { … }`. `const { app, player } = game; const { THREE } = GF;`
Recipes marked ✔ run verbatim in `examples/recipes-lab` (regenerate with `python3 tools/lib/recipes-lab.py`, 15/15 playtest checks) or in the demo games.

## ✔ Custom enemy archetype + wave spawner (ai.js)
```js
GF.ENEMY_TYPES.knight = { hp: 120, weapon: 'sword', look: { outfit: 'armor', armor: true, helmet: true, top: 0x3a3a46, accent: 0xb02a2a },
  stats: { damage: 16, moveSpeed: 3.4, range: 2.2, attackCooldown: 1.4, attacks: ['attack1', 'attack2', 'heavy'] } };
let wave = 0;
game.onUpdate = (dt) => {
  if (game.enemies.every((e) => !e.alive)) {
    wave++;
    for (let i = 0; i < 2 + wave; i++) { const a = i * 2.1; game.spawnEnemy('knight', new THREE.Vector3(Math.cos(a) * 15, game.groundAt(Math.cos(a) * 15, Math.sin(a) * 15) + 0.5, Math.sin(a) * 15)); }
    app.ui.toast(`Wave ${wave}`, { big: true });
  }
};
```

## ✔ Boss with phases and a telegraphed area attack (ai.js)
```js
const boss = game.spawnEnemy('brute', new THREE.Vector3(0, game.groundAt(0, 0) + 1, -20), { hp: 900, scale: 1.6 });
boss.isBoss = true; boss.name = 'The Colossus'; game.boss = boss;
let phase = 1;
boss.on('damage', () => { if (phase === 1 && boss.health.ratio < 0.5) { phase = 2; boss.stats.moveSpeed *= 1.3; boss.stats.attackCooldown *= 0.7; app.ui.toast('The Colossus is enraged!', { big: true }); app.audio.play('alarm'); } });
const ring = new THREE.Mesh(new THREE.RingGeometry(0.1, 6, 48), new THREE.MeshBasicMaterial({ color: 0xff3a1a, transparent: true, opacity: 0.4, side: THREE.DoubleSide }));
ring.rotation.x = -Math.PI / 2; ring.visible = false; app.scene.add(ring);
let slamT = 6;
app.add((dt) => {
  if (!boss.alive || phase < 2) return;
  slamT -= dt;
  if (slamT < 1.2 && !ring.visible) { ring.visible = true; ring.position.copy(boss.position).setY(boss.position.y + 0.05); boss.anim.play('heavy'); }
  if (slamT <= 0) { ring.visible = false; slamT = 6; app.vfx.emit('debris', boss.position, { count: 40 }); app.shake(0.8); app.audio.play('explosion');
    if (player.position.distanceTo(boss.position) < 6) player.receive(35, { direction: player.position.clone().sub(boss.position).setY(0).normalize(), knockback: 9, source: boss }); }
});
```

## ✔ New move as a pose function (animation.js)
```js
GF.defineClip('spinSlash', { duration: 0.7, loop: false, events: { hit: 0.45 }, pose: (p) => ({
  hips: [0, 360 * Math.min(1, p * 1.6), 0], upperArm_R: [-60, 0, 80], lowerArm_R: [-20, 0, 0], upperLeg_L: [-20, 0, 0], lowerLeg_L: [30, 0, 0] }) });
// The animator builds clips at construction; rebuild for actors created earlier:
player.anim = new GF.HumanoidAnimator(player.model); player.anim.on('hit', (c) => player._onStrike(c));
app.add(() => { if (app.input.pressed('heavy') && app.input.held('sprint')) player.anim.play('spinSlash'); }, { order: -1 });
```

## ✔ Cutscene (story.js)
```js
const cine = new GF.CinematicCamera(app.camera);
function playCutscene() {
  if (location.search.includes('test=1')) return;          // keep automated tests deterministic
  app.setState('cutscene'); app.ui.letterbox(true);
  const p = player.position;
  cine.play([{ t: 0, pos: [p.x + 30, p.y + 15, p.z + 30], look: [p.x, p.y, p.z], fov: 50 },
             { t: 5, pos: [p.x + 3, p.y + 2, p.z + 6], look: [p.x, p.y + 1.2, p.z], fov: 55 }],
    () => { app.ui.letterbox(false); app.setState('playing'); });
  app.after(0.5, () => app.ui.subtitle('Something stirs beneath the city…', 3500));
}
app.add((dt) => cine.update(dt), { states: ['cutscene'] });
```

## ✔ Quest + dialogue at runtime (story.js)
```js
game.quests.define({ id: 'lost_cat', title: 'Whiskers', description: 'Find Ada\'s cat.', objectives: [{ id: 'find', type: 'custom', target: 'cat', text: 'Find the cat' }], rewards: { xp: 50 } });
game.dialogue.define('ada', `# start\n@if: quest:lost_cat\n@else: ask\n-> wait\n# ask\nAda: Have you seen Whiskers?\n> I'll look. -> yes\n> No. -> end\n# yes\nAda: Thank you!\n@do: start lost_cat\n-> end\n# wait\nAda: Any luck?\n-> end`);
// when the player finds the cat:
game.quests.report('custom', 'cat');
```

## ✔ Checkpoint race (gameplay.js, city or terrain)
See `examples/neon-circuit/main.js`: gates from a list of points, `Math.hypot(car - gate) < 8`
advances `nextGate`, timer in simulation time, best time via `app.save`.

## ✔ Traversal: swing / glide / air dash (gameplay.js)
```js
const trav = new GF.Traversal(player, { skyAnchors: false, maxRope: 45 });
app.add((dt) => trav.update(dt), { order: -1 });   // before player.control (order 0)
// R / middle mouse: swing (needs geometry ≥6 m above), hold Space while falling: glide, Alt in air: dash
```

## ✔ Projectile weapon (gameplay.js)
```js
const shots = new GF.ProjectileSystem(app.scene, app.physics);
app.add((dt) => {
  if (app.input.pressed('ability')) {
    const dir = player.cam.groundForward().setY(0.05).normalize();
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 6), GF.emissive(0x6ad0ff, 4));
    shots.spawn({ position: player.position.clone().setY(player.position.y + 1.4), velocity: dir.multiplyScalar(35), mesh, owner: player,
      onHit: (t, p) => { app.vfx.emit('hit', p); if (t) t.health.damage(20, { direction: dir.clone().normalize() }); } });
    app.audio.play('shoot');
  }
  shots.update(dt, game.enemies);
});
```

## ✔ Hero landmark from lofts (assets.js)
```js
const mb = new GF.Geo.MeshBuilder();
const rings = [0, 4, 9, 14].map((y, i) => ({ z: y, ring: GF.Geo.superRing(16, 4 - i * 0.6, 4 - i * 0.6, 3) }));
mb.add(GF.Geo.boxUV(GF.Geo.loft(rings, { axis: 'y' }), 0.4), GF.pbr('rock', { color: 0x8a8278 }));
mb.add(new THREE.SphereGeometry(1.2, 16, 12), GF.emissive(0x7ad8ff, 5), GF.Geo.mat4([0, 15.5, 0]));
const spire = mb.build({ name: 'spire' }); spire.position.set(40, game.groundAt(40, 40), 40); app.scene.add(spire);
app.physics.addStatic({ type: 'cylinder', x: 40, y: spire.position.y, z: 40, r: 4, h: 15 });
```

## ✔ Weather: rain (graphics.js)
```js
const rain = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(Array.from({ length: 6000 }, () => (Math.random() - 0.5) * 60), 3)),
  new THREE.PointsMaterial({ color: 0xaabbcc, size: 0.06, transparent: true, opacity: 0.6 }));
app.scene.add(rain); app.audio.ambience('rain');
app.add((dt) => { rain.position.copy(app.camera.position); const a = rain.geometry.attributes.position; for (let i = 1; i < a.array.length; i += 3) { a.array[i] -= 25 * dt; if (a.array[i] < -30) a.array[i] += 60; } a.needsUpdate = true; }, { states: 'all' });
```
