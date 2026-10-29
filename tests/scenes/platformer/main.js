// Platformer kit integration scene (not a game): a generated course played with the
// platformer controller profile. Exercises every piece type, checkpoints/respawn, pickups,
// the goal and the input bot. Driven by playtest.json through window.__GF.
import * as GF from '../../../engine/index.js';
const { THREE } = GF;

const app = new GF.GameApp({ id: 'scene-platformer', title: 'Platformer kit', container: document.getElementById('game'), timeOfDay: 10.5, fov: 50,
  atmosphere: { turbidity: 2.2, fogDensity: 0.0007, shadowRange: 40, exposure: 1.05 } });

// ---- level from the generator (fixed sequence so every piece type appears)
const profile = GF.platformerProfile();
const desc = GF.generatePlatformerLevel({ seed: 11, difficulty: 0.55, profile, pieces: 11, checkpointEvery: 3,
  sequence: ['gap', 'stairs', 'spikes', 'moving', 'spring', 'crumble', 'lava', 'circular', 'ledge', 'path', 'gap'] });
if (!desc.report.ok) throw new Error('generated level not reachable: ' + JSON.stringify(desc.report.failures));
const level = new GF.PlatformerLevel(app.physics, { scene: app.scene, killY: desc.killY }).build(desc);

// backdrop: valley of mountains far below the floating course (visual only, physics has no terrain)
const hf = new GF.Heightfield({ size: 900, resolution: 160, seed: 4, height: 70, type: 'mountains', base: -60, waterLevel: -48, flatten: [{ x: desc.length / 2, z: -40, radius: 200, height: -55, falloff: 120 }] });
app.scene.add(GF.terrainMesh(hf));
const water = GF.createWater({ level: -48, size: 1600 }); app.scene.add(water.mesh || water);

// ---- player: stylized humanoid on a profiled CharacterController
const ctrl = new GF.CharacterController(app.physics, { position: new THREE.Vector3(desc.start.x, desc.start.y + 0.05, desc.start.z), profile });
const hero = GF.createHumanoid({ height: 1.75, outfit: 'casual', top: 0x2f7de1, bottom: 0x2b2f3a, hair: 0x3a2618, accent: 0xffc23d });
hero.traverse((o) => { if (o.isMesh) o.castShadow = true; }); app.scene.add(hero);
const anim = new GF.HumanoidAnimator(hero);

// ---- HUD
const gems = app.ui.counter('gems', { icon: '◆', label: 'Gems', corner: 'tr', value: `0/${level.stats.total}` });
const deaths = app.ui.counter('deaths', { icon: '✖', label: 'Falls', corner: 'tr', value: '0' });
level.onCollect = () => { gems.set(`${level.stats.collected}/${level.stats.total}`); app.audio.play('coin'); };
level.onDeath = (c, cause) => { deaths.set(level.stats.deaths); app.audio.play('hurt'); app.shake(0.4); app.vfx.emit(cause === 'lava' ? 'fire' : 'sparks', c.position.clone(), { count: 20 }); };
level.onCheckpoint = (cp) => { app.ui.toast('Checkpoint', { ms: 1500 }); app.audio.play('checkpoint'); app.vfx.emit('confetti', cp.position.clone().setY(cp.position.y + 2), { count: 24 }); };
level.onSpring = () => app.audio.play('jump', { pitch: 0.7 });
level.onGoal = () => { app.ui.toast('Course complete!', { big: true, sub: `${level.stats.collected}/${level.stats.total} gems · ${level.stats.deaths} falls` }); app.audio.play('questComplete'); };

// ---- bot (autopilot) feeds the same virtual inputs a player would press
const bot = new GF.PlatformerBot(level, ctrl);
let autopilot = false;
app.add((dt) => {
  if (!autopilot) return;
  const o = bot.update(dt), inp = app.input;
  inp.setVirtual('moveRight', Math.max(0, o.moveX)); inp.setVirtual('moveLeft', Math.max(0, -o.moveX));
  inp.setVirtual('moveBack', Math.max(0, o.moveZ)); inp.setVirtual('moveForward', Math.max(0, -o.moveZ));
  inp.setVirtual('jump', o.jumpHeld || o.jump ? 1 : 0); if (o.jump) inp.tap('jump');
}, { order: -5 });

// ---- player step: level first (movers carry), then the controller
let prevJump = false;
const dir = new THREE.Vector3();
app.add((dt) => {
  const inp = app.input, held = inp.held('jump');
  const jump = inp.pressed('jump') || (held && !prevJump); prevJump = held;
  const dash = inp.pressed('dodge') || inp.pressed('sprint');
  level.update(dt, [ctrl]);
  const mx = inp.value('moveRight') - inp.value('moveLeft'), mz = inp.value('moveBack') - inp.value('moveForward');
  dir.set(mx, 0, mz); if (dir.lengthSq() > 1) dir.normalize();
  ctrl.move(dt, dir, 0, { jump, jumpHeld: held, dash });
  const ev = ctrl.pf.events;
  if (ev.jumped || ev.wallJumped) { app.audio.play('jump'); anim.play('jump'); }
  if (ev.landed) { app.audio.play('land', { volume: 0.5 }); app.vfx.emit('dust', ctrl.position.clone(), { count: 6 }); }
  if (ev.dashed) { app.audio.play('whoosh'); app.vfx.emit('trail', ctrl.position.clone().setY(ctrl.position.y + 1), { count: 10 }); }
  GF.syncVisual(hero, ctrl, dt);
  anim.setLocomotion(ctrl.grounded ? ctrl.horizontalSpeed() : 0, ctrl.grounded || !!ctrl.pf.ledge);
  anim.update(dt);
}, { order: 0 });

// ---- side-on follow camera (2.5D framing with a little perspective)
const camPos = new THREE.Vector3(), look = new THREE.Vector3();
app.add((dt) => {
  const p = ctrl.position, k = 1 - Math.exp(-5 * dt);
  camPos.lerp(new THREE.Vector3(p.x + 2.5, p.y + 4.2, p.z + 14.5), camPos.lengthSq() ? k : 1);
  look.lerp(new THREE.Vector3(p.x + 3, p.y + 1.2, p.z), look.lengthSq() ? k : 1);
  app.camera.position.copy(camPos); app.camera.lookAt(look);
  app.atmosphere.setFocus?.(p);
}, { order: 50, states: 'all' });

app.debugState = () => {
  const on = level.platformOf(ctrl);
  return { player: { x: +ctrl.position.x.toFixed(3), y: +ctrl.position.y.toFixed(3), z: +ctrl.position.z.toFixed(3), grounded: ctrl.grounded, state: ctrl.pf.state, platform: on?.id ?? null, platformKind: on?.kind ?? null, jumps: ctrl.pf.jumpCount, ledgeGrabs: ctrl.pf.ledgeGrabs },
    level: level.debugState(), autopilot, sections: desc.sections, reachable: desc.report.ok, links: desc.links.length };
};

// scene-specific hooks for the playtest
const first = desc.links[0], firstFrom = level.byId.get(first.from);
window.__GF.scene = {
  firstGap: { from: first.from, to: first.to, edgeX: firstFrom.collider.x + firstFrom.hx, gap: first.gap, rise: first.rise },
  autopilot: (on = true) => { autopilot = on; if (!on) app.input.clearVirtual(); },
  teleport: (x, y, z = 0) => ctrl.teleport(new THREE.Vector3(x, y, z)),
  // drop the player into the first hazard of the given kind
  dropInto: (kind) => { const h = level.hazards.find((q) => q.kind === kind); ctrl.teleport(new THREE.Vector3((h.min.x + h.max.x) / 2, h.max.y + 2, 0)); return true; },
};
window.__GF.startGame = () => {};
app.setState('playing');
app.start();
