// Lantern Isle — story-driven adventure demo built with GameForge.
// Wake on a storm-swept island, meet the villagers, recover three sun-crystals and
// relight the lighthouse. Dialogue, quests, inventory, day/night, save/load, cinematics.
import * as GF from '../../engine/index.js';
import { CHARACTERS, DIALOGUE, QUESTS } from './story.js';
const { THREE } = GF;

const app = new GF.GameApp({ id: 'lantern-isle', title: 'Lantern Isle', container: document.getElementById('game'), timeOfDay: 9.5, dayLength: 720,
  theme: { accent: '#7ad8ff', accent2: '#ffd36a' }, atmosphere: { turbidity: 2.2, rayleigh: 1.4, fogDensity: 0.0016 }, touchButtons: [['interact', 'E'], ['jump', '⤒']] });
const loader = app.ui.loading('The tide rolls in…');

// ---------- Island ----------
const WATER = 0;
const VILLAGE = { x: 0, z: 10, r: 24 };
const hf = new GF.Heightfield({ size: 420, resolution: 210, seed: 1337, height: 30, type: 'hills', island: true, waterLevel: WATER,
  flatten: [{ x: VILLAGE.x, z: VILLAGE.z, radius: VILLAGE.r, falloff: 18, height: 5 }] });
// Find a point at `angle` from the centre whose height is within [lo, hi] (robust placement on any seed)
function landAt(angle, lo, hi, from = 40) {
  let best = null;
  for (let r = from; r < 200; r += 2) { const x = Math.sin(angle) * r, z = Math.cos(angle) * r, h = hf.heightAt(x, z); if (h >= lo && h <= hi && hf.slopeAt(x, z) < 0.25) best = { x, z, h }; if (h < WATER - 1) break; }
  return best || { x: Math.sin(angle) * from, z: Math.cos(angle) * from, h: hf.heightAt(Math.sin(angle) * from, Math.cos(angle) * from) };
}
const LIGHTHOUSE = landAt(Math.PI, 6, 40, 70); // north (-z)
hf.flattenArea({ x: LIGHTHOUSE.x, z: LIGHTHOUSE.z, radius: 9, falloff: 10, height: LIGHTHOUSE.h });
const RUINS = landAt(-2.3, 3, 40, 60);
hf.flattenArea({ x: RUINS.x, z: RUINS.z, radius: 12, falloff: 10, height: RUINS.h });
hf.carveRoad({ points: [[VILLAGE.x, VILLAGE.z - 10], [LIGHTHOUSE.x * 0.4, LIGHTHOUSE.z * 0.45], [LIGHTHOUSE.x * 0.8, LIGHTHOUSE.z * 0.85], [LIGHTHOUSE.x, LIGHTHOUSE.z + 8]], width: 5, falloff: 4 });
const BEACH = landAt(0.15, 0.8, 2.2, 60); // south shore start
app.physics.hf = hf; app.physics.waterLevel = WATER;
const terrain = GF.terrainMesh(hf, { snowLine: 999, palette: { grass: 0x4f7a2c, grass2: 0x7d9a3a, sand: 0xc9b282 } });
app.scene.add(terrain);
const water = GF.createWater({ level: WATER, heightfield: hf, color: 0x1f7a8c, deep: 0x0b3048 });
app.scene.add(water);
loader.set(0.2, 'Building the village…');

// ---------- Village ----------
const rng = new GF.RNG(77);
const village = new THREE.Group();
const vy = hf.heightAt(VILLAGE.x, VILLAGE.z);
const houseSpots = [[-16, -6, 0.4], [-14, 20, 2.3], [15, -4, -0.6], [17, 18, -2.4], [-2, 30, 3.14], [2, -14, 0]];
houseSpots.forEach(([x, z, ry], i) => { const h = GF.house({ seed: 10 + i, style: i === 5 ? 'stone' : 'cottage', width: rng.range(6, 8), depth: rng.range(5, 6.5) }); h.position.set(VILLAGE.x + x, vy, VILLAGE.z + z); h.rotation.y = ry; village.add(h); });
const well = GF.PROPS.well(); well.position.set(VILLAGE.x, vy, VILLAGE.z + 3); village.add(well);
for (const [x, z, ry, aw] of [[-6, 10, 0.6, 0xb83a2e], [7, 12, -0.5, 0x2a6a9a]]) { const s = GF.PROPS.stall({ awning: aw, seed: x }); s.position.set(VILLAGE.x + x, vy, VILLAGE.z + z); s.rotation.y = ry; village.add(s); }
const lamps = [];
for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; const l = GF.PROPS.lampPost({ height: 4.2, lightColor: 0xffc070 }); l.position.set(VILLAGE.x + Math.cos(a) * 11, vy, VILLAGE.z + 3 + Math.sin(a) * 11); l.rotation.y = -a; village.add(l); lamps.push(l); }
for (let i = 0; i < 10; i++) { const k = rng.pick(['crate', 'barrel', 'barrel', 'bench']); const o = GF.PROPS[k]({}); o.position.set(VILLAGE.x + rng.range(-18, 18), vy, VILLAGE.z + rng.range(-12, 26)); o.rotation.y = rng.range(0, 6); if (Math.hypot(o.position.x, o.position.z - VILLAGE.z - 3) > 5) village.add(o); }
for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 + 0.2; const f = GF.PROPS.fence({ length: 5 }); f.position.set(VILLAGE.x + Math.cos(a) * 26, vy, VILLAGE.z + 3 + Math.sin(a) * 26); f.rotation.y = -a + Math.PI / 2; if (i !== 2 && i !== 6) village.add(f); }
// lighthouse
function buildLighthouse() {
  const mb = new GF.Geo.MeshBuilder(), H = 18;
  const white = GF.pbr('plaster', { color: 0xf0ece4 }), red = GF.pbr('paintedMetal', { color: 0xb02a22, rust: 0.1 }), stone = GF.pbr('cobble', { cells: 8 }), dark = GF.solid(0x2a2c30, { metalness: 0.7, roughness: 0.4 });
  mb.add(GF.Geo.boxUV(new THREE.CylinderGeometry(4.2, 4.6, 1.2, 24), 0.5), stone, GF.Geo.mat4([0, 0.6, 0]));
  for (let i = 0; i < 6; i++) { const y0 = 1.2 + i * (H / 6), r0 = 3 - i * 0.28, r1 = 3 - (i + 1) * 0.28; mb.add(new THREE.CylinderGeometry(r1, r0, H / 6, 24, 1, true), i % 2 ? red : white, GF.Geo.mat4([0, y0 + H / 12, 0])); }
  mb.add(new THREE.CylinderGeometry(2.7, 1.4, 0.4, 24), dark, GF.Geo.mat4([0, H + 1.4, 0]));
  mb.add(new THREE.TorusGeometry(2.5, 0.05, 6, 32), dark, GF.Geo.mat4([0, H + 2.4, 0], [Math.PI / 2, 0, 0]));
  mb.add(new THREE.CylinderGeometry(1.25, 1.25, 2.4, 16, 1, true), GF.glass({ opacity: 0.35 }), GF.Geo.mat4([0, H + 2.8, 0]));
  mb.add(new THREE.ConeGeometry(1.7, 1.6, 16), red, GF.Geo.mat4([0, H + 4.8, 0]));
  mb.add(new THREE.BoxGeometry(1.3, 2.2, 0.3), GF.pbr('planks', { planks: 3, color: 0x3a2a1a }), GF.Geo.mat4([0, 2.3, 2.9]));
  const g = mb.build({ name: 'lighthouse' });
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xffe2a0, emissiveIntensity: 0.05 });
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.7, 16, 10), lampMat); lamp.position.y = H + 2.8; g.add(lamp);
  const beamMat = new THREE.MeshBasicMaterial({ color: 0xfff0c0, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const beam = new THREE.Mesh(new THREE.ConeGeometry(4, 60, 24, 1, true), beamMat); beam.rotation.z = Math.PI / 2; beam.position.set(30, 0, 0);
  const beamPivot = new THREE.Group(); beamPivot.position.y = H + 2.8; beamPivot.add(beam); g.add(beamPivot);
  const light = new THREE.PointLight(0xffe2a0, 0, 80, 1.6); light.position.y = H + 2.8; g.add(light);
  g.userData = { lampMat, beamMat, beamPivot, light, collider: { type: 'cylinder', radius: 3.4, height: H + 5 } };
  return g;
}
const lighthouse = buildLighthouse();
lighthouse.position.set(LIGHTHOUSE.x, LIGHTHOUSE.h, LIGHTHOUSE.z); app.scene.add(lighthouse);
app.physics.addFromObject(lighthouse);
// ruins
const ruins = new THREE.Group();
for (let i = 0; i < 7; i++) { const a = (i / 7) * Math.PI * 2; const p = GF.PROPS.pillar({ height: 5, broken: i % 2 === 0, seed: 40 + i }); p.position.set(RUINS.x + Math.cos(a) * 9, RUINS.h - 0.1, RUINS.z + Math.sin(a) * 9); ruins.add(p); }
for (let i = 0; i < 3; i++) { const w = GF.PROPS.stoneWall({ length: 7, ruined: true, seed: 90 + i }); const a = i * 2.1; w.position.set(RUINS.x + Math.cos(a) * 12, RUINS.h - 0.2, RUINS.z + Math.sin(a) * 12); w.rotation.y = -a + Math.PI / 2; ruins.add(w); }
const ruinChest = GF.PROPS.chest({ color: 0x4a3a2a }); ruinChest.position.set(RUINS.x, RUINS.h, RUINS.z); ruins.add(ruinChest);
app.scene.add(village, ruins);
for (const grp of [village, ruins]) { grp.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } }); for (const c of grp.children) if (c.userData.collider) app.physics.addFromObject(c); }
loader.set(0.45, 'Planting palms…');
const veg = GF.populate(hf, { seed: 1337, trees: 220, rocks: 110, bushes: 200, grass: app.gfx.tier.name === 'low' ? 3000 : 12000, species: ['oak', 'pine', 'palm'],
  exclude: [{ x: VILLAGE.x, z: VILLAGE.z + 3, r: VILLAGE.r + 6 }, { x: LIGHTHOUSE.x, z: LIGHTHOUSE.z, r: 12 }, { x: RUINS.x, z: RUINS.z, r: 15 }, { x: BEACH.x, z: BEACH.z, r: 8 }], palette: { grass: 0x7aa040 } });
app.scene.add(veg.group);
for (const c of veg.colliders) app.physics.addStatic({ type: 'cylinder', x: c.x, y: hf.heightAt(c.x, c.z) - 0.5, z: c.z, r: c.r, h: c.h }, { kind: c.kind });

// ---------- Narrative systems ----------
const flags = new GF.Flags();
const quests = new GF.QuestSystem(flags, app.events).define(QUESTS);
const inventory = new GF.Inventory({ lantern: { name: 'Storm Lantern' }, crystal: { name: 'Sun-crystal' }, old_key: { name: "Bram's Key" }, shell: { name: 'Pearl Shell' } });
const dialogue = new GF.DialogueSystem({ flags, quests, inventory, events: app.events });
for (const [id, src] of Object.entries(DIALOGUE)) dialogue.define(id, src);
const progression = new GF.Progression();
inventory.onChange = (id, n) => { if (id === 'crystal') flags.set('crystals', n); };
app.events.on('quest:start', ({ quest }) => { app.ui.toast(quest.title, { big: true, sub: 'New quest' }); app.audio.play('questStart'); autosave(); });
app.events.on('quest:complete', ({ quest, rewards }) => { app.ui.toast(quest.title, { big: true, sub: 'Quest complete' }); app.audio.play('questComplete'); if (rewards.xp) progression.addXP(rewards.xp); autosave(); });
app.events.on('objective:complete', ({ objective }) => app.ui.toast('✓ ' + objective.text, { ms: 2000 }));
flags.onChange = () => quests.onFlag();

// ---------- Characters ----------
const player = new GF.Player(app, { combat: false, hp: 100, position: new THREE.Vector3(BEACH.x, BEACH.h + 0.5, BEACH.z), facing: Math.PI,
  look: { seed: 8, outfit: 'casual', coat: true, top: 0x6a4a3a, bottom: 0x3a4a5a, hairStyle: 'short', hair: 0x2a1a10, skin: 0xe0b48f, accent: 0xd0a030 }, camera: { distance: 5.2 } });
const npcs = {};
for (const [id, c] of Object.entries(CHARACTERS)) {
  const x = VILLAGE.x + c.pos[0], z = VILLAGE.z + c.pos[1];
  const n = new GF.NPC(app, { look: c.look, position: new THREE.Vector3(x, hf.heightAt(x, z) + 0.3, z), facing: rng.range(0, 6), name: c.name, dialogue: id, wanderRadius: id === 'mira' ? 0 : 3, seed: x * 7 });
  npcs[id] = n;
  player.interactables.push({ id: 'npc:' + id, get position() { return n.position; }, radius: 2.6, label: 'Talk to ' + c.name, action: () => talk(id) });
}
app.__npcs = npcs;

// crystals & collectibles
const crystalSpots = { east: landAt(Math.PI / 2 + 0.3, 6, 40, 50), south: landAt(0.9, 0.6, 2.5, 50), ruins: { x: RUINS.x + 3, z: RUINS.z - 3, h: RUINS.h } };
const collectibles = [];
function addCollectible(id, type, x, z, opts = {}) {
  const obj = GF.PROPS.pickup({ type, color: opts.color });
  if (type === 'gem') obj.scale.setScalar(1.6);
  const y = hf.heightAt(x, z) + (opts.lift ?? 1);
  obj.position.set(x, y, z); app.scene.add(obj);
  let light = null; if (opts.light) { light = new THREE.PointLight(opts.color ?? 0xffd36a, 6, 10, 2); light.position.copy(obj.position); app.scene.add(light); }
  const c = { id, type, obj, light, base: y, taken: false };
  collectibles.push(c);
  player.interactables.push({ id, position: obj.position, radius: opts.radius ?? 2, label: opts.label || 'Pick up', enabled: () => !c.taken, action: () => collect(c) });
  return c;
}
for (const [k, p] of Object.entries(crystalSpots)) addCollectible('crystal:' + k, 'gem', p.x, p.z, { color: 0xffc23a, light: true, label: 'Take the sun-crystal', radius: 2.8 });
for (let i = 0; i < 12; i++) { const p = landAt(i * 0.52 + 0.2, 0.3, 1.8, 40); addCollectible('shell:' + i, 'coin', p.x, p.z, { color: 0xf0e0ff, lift: 0.5, label: 'Pick up shell', radius: 1.6 }); }
function collect(c) {
  if (c.taken) return; c.taken = true; app.scene.remove(c.obj); if (c.light) app.scene.remove(c.light);
  if (c.type === 'gem') { inventory.add('crystal'); quests.report('collect', 'crystal'); app.audio.play('powerup'); app.vfx.emit('magic', c.obj.position, { count: 50, color: 0xffd36a }); }
  else { inventory.add('shell'); app.audio.play('coin'); app.vfx.emit('sparks', c.obj.position, { count: 10 }); }
  player.anim.play('interact'); autosave();
}
// chest & lighthouse interactions
let chestOpen = false;
player.interactables.push({ id: 'chest', position: ruinChest.position, radius: 3, label: 'Open the ancient chest', enabled: () => !chestOpen, action: () => {
  if (!inventory.has('old_key')) { app.ui.toast('It is locked tight. Someone in the village may have a key.'); app.audio.play('uiBack'); return; }
  chestOpen = true; flags.set('chest_open'); app.audio.play('chest'); player.anim.play('interact');
  const lid = ruinChest.getObjectByName('lid'); lidTween = { lid, t: 0 };
  inventory.add('shell', 5); inventory.money += 50; quests.report('custom', 'ruin_chest');
  app.ui.toast('Found 5 pearl shells and 50 old coins', { sub: 'Chest' });
} });
let lidTween = null;
player.interactables.push({ id: 'lighthouse', position: new THREE.Vector3(LIGHTHOUSE.x, LIGHTHOUSE.h, LIGHTHOUSE.z + 3.6), radius: 3.2, label: 'Place the sun-crystals', enabled: () => quests.status('light') === 'active' && inventory.count('crystal') >= 3, action: () => relight() });

// ---------- HUD ----------
const objectives = app.ui.objectives('tr');
const clockC = app.ui.counter('clock', { icon: '☀', label: '', corner: 'tl', value: '09:30' });
const crystalC = app.ui.counter('crystals', { icon: '✦', label: 'Crystals', corner: 'tl', value: '0/3' });
const shellC = app.ui.counter('shells', { icon: '◌', label: 'Shells', corner: 'tl', value: '0' });
const warmth = app.ui.bar('warmth', { label: 'Lantern warmth', color: 'linear-gradient(90deg,#ffb347,#ffe27a)', corner: 'bl' }); warmth.show(false);
const minimap = app.ui.minimap({ range: 90 });
const CONTROLS = [['Move', 'WASD'], ['Camera', 'Mouse (click to lock)'], ['Sprint', 'Shift'], ['Jump', 'Space'], ['Talk / interact', 'E'], ['Dialogue choices', '1-4 or click'], ['Journal', 'J'], ['Pause', 'Esc / P']];
app.input.bind('journal', ['KeyJ']); app.input.bind('attack', ['Mouse0']);

// ---------- Dialogue flow ----------
let talkingTo = null;
function showLine() {
  const cur = dialogue.current();
  if (!cur) { endTalk(); return; }
  app.ui.showDialogue(cur, (choice) => advance(choice));
  app.audio.speak(cur.text, { pitch: talkingTo === 'mira' ? 1.25 : talkingTo === 'bram' ? 0.75 : talkingTo === 'ilse' ? 1.35 : 0.95 });
}
function advance(choice = null) {
  const cur = dialogue.current(); if (!cur) return endTalk();
  if (cur.choices.length && choice === null) return;
  dialogue.advance(choice); app.audio.play('uiClick'); showLine();
}
let lastTalkEnd = -1;
function talk(id) {
  if (app.loop.time - lastTalkEnd < 0.4) return;
  talkingTo = id; const n = npcs[id]; n.talking = true; n.anim.setUpperOverride('talk');
  player.faceTowards(n.position, 1, 100);
  app.setState('dialogue'); dialogue.start(id); showLine();
  flags.set('talked:' + id); quests.report('talk', id);
}
function endTalk() {
  app.ui.hideDialogue(); if (talkingTo) { npcs[talkingTo].talking = false; npcs[talkingTo].anim.setUpperOverride(null); }
  talkingTo = null; lastTalkEnd = app.loop.time; if (app.state === 'dialogue') app.setState('playing'); updateMarkers();
}
function updateMarkers() {
  npcs.mira.setMarker(!flags.get('met_mira') ? '!' : quests.status('light') === 'active' ? '?' : null);
  for (const id of ['tobin', 'ilse', 'bram']) npcs[id].setMarker(flags.get('met_mira') && !flags.get('talked:' + id) ? '!' : null);
}
app.add(() => {
  const input = app.input;
  if (app.ui.dialogueOpen && (input.pressed('interact') || input.pressed('confirm'))) { if (!app.ui.skipTyping()) advance(null); }
  for (let k = 0; k < 4; k++) if (input.pressed('choice' + (k + 1))) { const cur = dialogue.current(); if (cur && cur.choices[k]) advance(cur.choices[k].index); }
  for (const n of Object.values(npcs)) n.update(1 / 60, player);
  player.update(1 / 60); player.cam.update(1 / 60, player.position);
}, { states: ['dialogue'] });

// ---------- Cinematics ----------
const cine = new GF.CinematicCamera(app.camera);
function playIntro() {
  app.setState('cutscene'); app.ui.letterbox(true);
  const p = player.position;
  cine.play([
    { t: 0, pos: [p.x + 60, 22, p.z + 80], look: [p.x, 2, p.z], fov: 50 },
    { t: 4, pos: [p.x + 20, 8, p.z + 25], look: [p.x, 1.5, p.z], fov: 50 },
    { t: 7, pos: [p.x + 2, p.y + 2.5, p.z + 6], look: [p.x, p.y + 1.2, p.z], fov: 55 },
  ], () => { app.ui.letterbox(false); app.setState('playing'); app.ui.toast('Lantern Isle', { big: true, sub: 'Chapter One' }); });
  app.after(0.5, () => app.ui.subtitle('The storm passed in the night. The tide left you on a strange shore…', 3500));
  app.after(4.2, () => app.ui.subtitle('Somewhere above the village, a lighthouse stands dark.', 3000));
}
let ending = false;
function relight() {
  inventory.remove('crystal', 3); quests.report('reach', 'lighthouse'); ending = true;
  app.setState('cutscene'); app.ui.letterbox(true); app.audio.play('magic'); app.audio.playMusic('heroic', { intensity: 0.8 });
  const L = lighthouse.position;
  cine.play([
    { t: 0, pos: [L.x + 14, L.y + 6, L.z + 18], look: [L.x, L.y + 10, L.z], fov: 55 },
    { t: 4, pos: [L.x - 18, L.y + 24, L.z + 10], look: [L.x, L.y + 18, L.z], fov: 50 },
    { t: 8, pos: [L.x + 6, L.y + 40, L.z + 50], look: [L.x, L.y + 14, L.z], fov: 50 },
  ], () => { app.ui.letterbox(false); app.setState('playing'); app.ui.endScreen({ victory: true, title: 'The Light Returns', text: 'Lantern Isle shines again. Thank you for playing.', stats: { 'Shells found': inventory.count('shell'), 'Quests completed': quests.completed().length, Level: progression.level, 'Time played': Math.round(app.loop.time / 60) + ' min' }, onRetry: () => { app.ui.closeMenu(); app.setState('playing'); }, onQuit: showTitle }); document.querySelector('#gf-retry') && (document.querySelector('#gf-retry').textContent = 'Keep exploring'); });
  app.after(1.5, () => { const u = lighthouse.userData; u.lit = true; app.vfx.emit('magic', L.clone().setY(L.y + 20), { count: 120, scale: 3 }); app.ui.subtitle('The crystals catch fire — and the old light wakes.', 3500); });
  app.after(5, () => app.ui.subtitle('Far out at sea, a ship turns toward home.', 3500));
  app.atmosphere.setTime(19.8);
}

// ---------- Save / load ----------
app.save.register('world', {
  save: () => ({ pos: player.position.toArray(), facing: player.facing, time: app.atmosphere.timeOfDay, taken: collectibles.filter((c) => c.taken).map((c) => c.id), chestOpen, lit: !!lighthouse.userData.lit, xp: progression.toJSON() }),
  load: (d) => { player.ctrl.teleport(new THREE.Vector3(...d.pos)); player.ctrl.facing = d.facing; app.atmosphere.setTime(d.time); for (const c of collectibles) if (d.taken.includes(c.id) && !c.taken) { c.taken = true; app.scene.remove(c.obj); if (c.light) app.scene.remove(c.light); } chestOpen = d.chestOpen; lighthouse.userData.lit = d.lit; progression.load(d.xp); },
});
app.save.register('flags', { save: () => flags.toJSON(), load: (d) => flags.load(d) });
app.save.register('quests', { save: () => quests.toJSON(), load: (d) => quests.load(d) });
app.save.register('inventory', { save: () => inventory.toJSON(), load: (d) => inventory.load(d) });
function autosave() { if (app.state !== 'menu') app.save.save('auto'); }

// ---------- Flow ----------
function newGame() {
  app.save.delete('auto');
  location.search.includes('test=1') ? startPlaying(true) : startPlaying(false);
}
function startPlaying(skipIntro) {
  app.setState('playing'); app.audio.playMusic('exploration', { intensity: 0.45 }); app.audio.ambience?.('waves');
  updateMarkers();
  if (!skipIntro) playIntro();
}
function continueGame() { app.save.load('auto'); startPlaying(true); app.ui.toast('Welcome back', { sub: 'Game loaded' }); }
function showTitle() {
  app.setState('menu');
  app.ui.mainMenu({ subtitle: 'A GameForge story adventure. Explore the island, help its people and relight the great lantern.', onStart: newGame, onContinue: app.save.has('auto') ? continueGame : null, controls: CONTROLS, credits: 'Characters, island, village, dialogue system, quests and music generated by the GameForge AAA toolkit.' });
}
addEventListener('click', () => { if (app.state === 'playing' && !document.pointerLockElement && !('ontouchstart' in window)) app.input.requestPointerLock(app.renderer.domElement); });

app.add((dt) => {
  if (app.input.pressed('pause')) { app.setState('paused'); document.exitPointerLock?.(); app.ui.pauseMenu({ onResume: () => app.setState('playing'), onSave: () => app.save.save('auto'), onQuit: showTitle, controls: CONTROLS }); return; }
  if (app.input.pressed('journal')) { showJournal(); return; }
  player.control(dt);
  for (const n of Object.values(npcs)) n.update(dt, player);
  GF.separateActors([player, ...Object.values(npcs)]);
  if (player.ctrl.swimming && !player.wasSwimming) { app.audio.play('splash'); app.vfx.emit('splash', player.position.clone().setY(WATER)); }
  player.wasSwimming = player.ctrl.swimming;
  // lantern warmth: proximity to nearest remaining crystal
  const remaining = collectibles.filter((c) => c.type === 'gem' && !c.taken);
  if (inventory.has('lantern') && remaining.length) { const d = Math.min(...remaining.map((c) => c.obj.position.distanceTo(player.position))); warmth.show(true); warmth.set(Math.max(0.03, 1 - d / 120)); } else warmth.show(false);
}, { order: 0 });
app.add((dt) => {
  // shared world animation (all non-menu states)
  for (const c of collectibles) if (!c.taken) { c.obj.rotation.y += dt * 1.5; c.obj.position.y = c.base + Math.sin(app.loop.time * 2 + c.base) * 0.12; }
  if (lidTween) { lidTween.t = Math.min(1, lidTween.t + dt * 1.5); lidTween.lid.rotation.x = -lidTween.t * 1.9; }
  const lit = lighthouse.userData.lit, u = lighthouse.userData;
  u.lampMat.emissiveIntensity += ((lit ? 8 : 0.05) - u.lampMat.emissiveIntensity) * Math.min(1, dt * 1.5);
  u.beamMat.opacity += ((lit ? 0.18 : 0) - u.beamMat.opacity) * Math.min(1, dt); u.light.intensity = lit ? 60 : 0; u.beamPivot.rotation.y += dt * 0.6;
  for (const l of lamps) l.children.forEach((m) => { if (m.material?.emissive) m.material.emissiveIntensity = app.atmosphere.isNight ? 6 : 0.4; });
  water.userData.setSun(app.atmosphere.lightDir || app.atmosphere.sunDir, app.atmosphere.sun.color, app.scene.fog.color);
  if (app.state === 'cutscene') cine.update(dt);
  // HUD
  const h = app.atmosphere.timeOfDay; clockC.set(`${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`);
  crystalC.set(`${inventory.count('crystal') + (quests.status('light') === 'complete' ? 3 : 0)}/3`); shellC.set(inventory.count('shell'));
  const q = quests.tracked ? quests.defs[quests.tracked] : null;
  objectives.set(q ? q.title : flags.get('met_mira') ? null : 'Find someone on the island', q ? quests.objectiveText(q.id) : [{ text: 'Head north to the village', done: false }], q ? 'Quest' : 'Goal');
  const markers = [...Object.values(npcs).map((n) => ({ x: n.position.x, z: n.position.z, color: n.marker ? '#ffd36a' : '#9ad0ff', size: 5 })), { x: LIGHTHOUSE.x, z: LIGHTHOUSE.z, color: '#ff6a5a', size: 7, shape: 'diamond', clamp: true }];
  if (inventory.has('lantern')) for (const c of collectibles) if (c.type === 'gem' && !c.taken && ((c.id === 'crystal:east' && flags.get('hint_east')) || (c.id === 'crystal:south' && flags.get('hint_south')) || (c.id === 'crystal:ruins' && (flags.get('heard_ghost') || flags.get('bram_key'))))) markers.push({ x: c.obj.position.x, z: c.obj.position.z, color: '#ffc23a', size: 7, shape: 'diamond', clamp: true });
  if (app.state !== 'menu') minimap.draw({ center: player.position, yaw: player.cam.yaw, background: (ctx, toMap, k) => { ctx.fillStyle = 'rgba(90,140,80,.35)'; ctx.beginPath(); const [x, y] = toMap(0, 0); ctx.arc(x, y, 150 * k, 0, Math.PI * 2); ctx.fill(); }, markers });
}, { states: ['playing', 'dialogue', 'cutscene', 'gameover'] });
app.add((dt) => { const t = app.loop.time * 0.03; app.camera.position.set(Math.sin(t) * 190, 55, Math.cos(t) * 190); app.camera.lookAt(0, 5, 0); }, { states: ['menu'] });

function showJournal() {
  app.setState('paused');
  const qs = Object.keys(quests.state).map((id) => quests.defs[id]).filter(Boolean);
  const html = `<h2>Journal</h2><div class="scroll">${qs.map((q) => `<div><b>${q.title}</b> <small style="color:var(--gf-dim)">— ${quests.status(q.id)}</small><p>${q.description}</p>${quests.objectiveText(q.id).map((o) => `<div class="row"><span>${o.done ? '✓' : '•'} ${o.text}</span></div>`).join('')}</div>`).join('') || '<p>No entries yet.</p>'}
    <h2 style="margin-top:12px">Inventory</h2>${inventory.list().map((i) => `<div class="row"><span>${i.name}</span><b>×${i.n}</b></div>`).join('') || '<p>Empty.</p>'}<div class="row"><span>Old coins</span><b>${inventory.money}</b></div></div>`;
  app.ui._menu(html, [['Close', () => { app.ui.closeMenu(); app.setState('playing'); }, { id: 'gf-close' }]]);
}

app.debugState = () => ({ player: { x: +player.position.x.toFixed(2), y: +player.position.y.toFixed(2), z: +player.position.z.toFixed(2), grounded: player.ctrl.grounded, swimming: player.ctrl.swimming, anim: player.anim.current?.name || null },
  dialogue: dialogue.current() ? { speaker: dialogue.current().speaker, node: dialogue.current().node, choices: dialogue.current().choices.length } : null,
  quests: Object.fromEntries(Object.keys(quests.defs).map((id) => [id, quests.status(id)])), inventory: { ...inventory.items }, money: inventory.money,
  flags: { met_mira: !!flags.get('met_mira'), hint_east: !!flags.get('hint_east'), bram_key: !!flags.get('bram_key'), ending: !!flags.get('ending') },
  focus: player.focus?.id || null, lit: !!lighthouse.userData.lit, time: +app.atmosphere.timeOfDay.toFixed(2), hasSave: app.save.has('auto'), level: progression.level });
window.__GF.player = player;
window.__GF.startGame = () => { app.ui.closeMenu(); newGame(); };
window.__GF.cheat = {
  goTo: (id) => {
    const target = id.startsWith('npc:') ? npcs[id.slice(4)].position : id === 'lighthouse' ? new THREE.Vector3(LIGHTHOUSE.x, LIGHTHOUSE.h, LIGHTHOUSE.z + 5) : id === 'chest' ? ruinChest.position.clone().add(new THREE.Vector3(0, 0, 1.6)) : collectibles.find((c) => c.id === id).obj.position;
    const p = target.clone().add(new THREE.Vector3(0.7, 0, 0.7)); p.y = hf.heightAt(p.x, p.z) + 0.2; player.ctrl.teleport(p);
  },
  save: () => app.save.save('auto'), load: () => app.save.load('auto'), setTime: (h) => app.atmosphere.setTime(h),
  skipCutscene: () => { if (cine.playing) { cine.t = cine.duration; } },
};
loader.set(1); setTimeout(() => loader.done(), 300);
updateMarkers(); showTitle();
app.audio.playMusic('calm', { intensity: 0.3 });
app.start();
