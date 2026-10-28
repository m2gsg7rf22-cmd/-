// Spec-driven game composer: turns a declarative game spec (JSON) into a complete,
// playable baseline game — world, player, enemies, NPCs, dialogue, quests, collectibles,
// vehicles, HUD, menus, audio, save/load and test hooks. Agents start from this baseline
// and then replace or extend systems with custom code for the specific design.
import * as THREE from '../vendor/three/three.module.js';
import { GameApp } from '../core/app.js';
import { RNG } from '../core/rng.js';
import { Heightfield, terrainMesh } from '../world/terrain.js';
import { populate } from '../world/vegetation.js';
import { createWater } from '../world/water.js';
import { generateCity, TrafficSystem } from '../world/city.js';
import { PROPS } from '../geometry/props.js';
import { house, tower } from '../geometry/buildings.js';
import { car } from '../geometry/vehicles.js';
import { Player } from '../gameplay/player.js';
import { Enemy, NPC, AttackTokens, separateActors, ENEMY_TYPES } from '../gameplay/actors.js';
import { Flags, QuestSystem, DialogueSystem } from '../gameplay/narrative.js';
import { Inventory, Progression } from '../gameplay/systems.js';
import { applyStoryToSpec } from '../gameplay/story.js';
import { Vehicle } from '../physics/vehicle.js';
import { ChaseCamera } from '../camera/cameras.js';
import { LightPool } from '../render/lightpool.js';

export const BIOMES = {
  temperate: { grass: 0x4f7a2c, grass2: 0x7d9a3a, rock: 0x6e6a64, sand: 0xd8c49a, dirt: 0x6b5038, leaves: [0x4c7a2c, 0x5a8a30, 0x3f6e2a], species: ['oak', 'pine'], time: 14, fog: 0.0015, water: 0x1e5a6e },
  autumn: { grass: 0x6a6a2c, grass2: 0x9a8a3a, rock: 0x6a625a, sand: 0xc8b48a, dirt: 0x6a5038, leaves: [0xa05a2a, 0xc0802a, 0x8a4a22, 0x6a6a2a], species: ['oak', 'dead', 'pine'], time: 17.2, fog: 0.002, water: 0x2a5a5a },
  desert: { grass: 0xc8a870, grass2: 0xd8b880, rock: 0x9a6a4a, sand: 0xe0c08a, dirt: 0xb08a5a, leaves: [0x6a7a3a], species: ['palm', 'dead'], time: 13, fog: 0.0012, water: 0x2a8a9a, trees: 0.15, grassAmt: 0 },
  snow: { grass: 0xdfe6ee, grass2: 0xc8d2dc, rock: 0x5a5e66, sand: 0xbfc8d0, dirt: 0x8a8a90, leaves: [0x2a4a3a, 0x3a5a4a], species: ['pine'], time: 11, fog: 0.004, water: 0x2a4a6a, grassAmt: 0, snowLine: 0 },
  tropical: { grass: 0x4a8a2a, grass2: 0x8ab83a, rock: 0x6a6a5a, sand: 0xe8d8a8, dirt: 0x7a5a3a, leaves: [0x3a8a2a, 0x5aa03a], species: ['palm', 'oak'], time: 10, fog: 0.0012, water: 0x1a9aa8 },
  volcanic: { grass: 0x3a3a32, grass2: 0x4a4038, rock: 0x2a2624, sand: 0x3a3430, dirt: 0x2a2220, leaves: [0x3a3a2a], species: ['dead'], time: 18.4, fog: 0.004, water: 0x6a2a1a, grassAmt: 0, trees: 0.3 },
};

const DIRS = { north: Math.PI, south: 0, east: Math.PI / 2, west: -Math.PI / 2, northeast: Math.PI * 0.75, northwest: -Math.PI * 0.75, southeast: Math.PI * 0.25, southwest: -Math.PI * 0.25 };

export function normalizeSpec(spec) {
  const s = JSON.parse(JSON.stringify(spec));
  // spec.story: a story script (skills/gameforge/references/narrative.md) or its compiled form
  // (compileStory). Merged into quests / npcs / landmarks / items / startQuests / goal; explicit spec entries win.
  if (s.story && (s.story.missions || s.story.acts || s.story.format)) applyStoryToSpec(s);
  s.id ||= (s.title || 'game').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  s.title ||= 'Untitled GameForge Game';
  s.seed ??= 1;
  s.world = { type: 'hills', biome: 'temperate', size: 360, height: 30, ...s.world };
  s.player = { mode: 'onfoot', combat: true, hp: 150, ...s.player };
  s.enemies ||= []; s.npcs ||= []; s.quests ||= []; s.collectibles ||= []; s.landmarks ||= [];
  s.goal = { type: s.enemies.length ? 'defeat' : s.collectibles.length ? 'collect' : 'explore', ...s.goal };
  return s;
}

export function composeGame(rawSpec, { container = document.getElementById('game') || document.body, modules = [], humans = null } = {}) {
  const spec = normalizeSpec(rawSpec);
  const biome = { ...BIOMES[spec.world.biome] || BIOMES.temperate, ...(spec.world.palette || {}) };
  const app = new GameApp({ id: spec.id, title: spec.title, container, timeOfDay: spec.world.timeOfDay ?? biome.time, dayLength: spec.world.dayLength ?? 0,
    theme: spec.theme || {}, atmosphere: { fogDensity: biome.fog, ...(spec.atmosphere || {}) } });
  if (humans && spec.characters !== 'stylized') app.useHumans(humans.H, humans.data);
  const rng = new RNG(spec.seed);
  const game = { app, spec, rng, enemies: [], npcs: {}, collectibles: [], vehicle: null, state: {} };
  const loader = app.ui.loading('Generating world…');

  // ---------- World ----------
  const W = spec.world, isCity = W.type === 'city';
  let hf = null, ground = 0, city = null;
  const anchors = { center: new THREE.Vector3() };
  if (isCity) {
    city = generateCity({ seed: spec.seed, blocks: W.blocks ?? 5, style: W.style ?? 'modern', maxFloors: W.maxFloors ?? 24 });
    app.scene.add(city.group); for (const c of city.colliders) app.physics.addStatic(c, c.userData);
    for (const p of city.dynamicProps) { app.scene.add(p); const r = 0.3; app.physics.addBody({ object: p, position: p.position.clone().setY(p.position.y + r), radius: r, mass: 8, userData: { centerOffset: r } }); }
    game.city = city;
    app.lightPools.push(new LightPool(app.scene, city.lampAnchors, { count: app.gfx.tier.name === 'low' ? 4 : 8 }));
    if (W.traffic !== false) { game.traffic = new TrafficSystem(app.scene, city, { count: W.traffic ?? 10, seed: spec.seed + 3 }); }
    const c = city.roadCenters; anchors.center.set(c[Math.floor(c.length / 2)] + city.roadWidth / 4, 0.2, c[Math.floor(c.length / 2)] + 20);
  } else {
    const flatten = [{ x: 0, z: 0, radius: W.type === 'arena' ? 30 : 20, falloff: 18, height: W.type === 'flat' ? 0 : 5 }];
    hf = new Heightfield({ size: W.size, resolution: Math.min(256, Math.round(W.size / 2)), seed: spec.seed, height: W.type === 'flat' ? 1 : W.height, type: W.type === 'arena' ? 'hills' : W.type === 'island' ? 'hills' : W.type, island: W.type === 'island' || !!W.water, waterLevel: 0, flatten });
    for (const lm of spec.landmarks) { const a = landmarkPos(lm); hf.flattenArea({ x: a.x, z: a.z, radius: lm.radius ?? 10, falloff: 10 }); }
    app.physics.hf = hf; app.physics.waterLevel = W.type === 'island' || W.water ? 0 : -999;
    app.scene.add(terrainMesh(hf, { palette: biome, snowLine: biome.snowLine ?? W.height * 0.85 }));
    if (W.type === 'island' || W.water) app.scene.add(game.water = createWater({ level: 0, heightfield: hf, color: biome.water }));
    ground = hf.heightAt(0, 0);
    anchors.center.set(0, ground, 0);
  }
  function landmarkPos(lm) {
    if (lm.x !== undefined) return new THREE.Vector3(lm.x, 0, lm.z);
    const a = DIRS[lm.at] ?? rng.range(0, Math.PI * 2), r = lm.distance ?? W.size * 0.28;
    return new THREE.Vector3(Math.sin(a) * r, 0, Math.cos(a) * r);
  }
  const groundAt = (x, z) => (hf ? hf.heightAt(x, z) : 0.2);
  game.groundAt = groundAt; game.hf = hf;
  loader.set(0.3, 'Placing landmarks…');
  // landmarks: village / ruins / camp / tower / arena
  const structures = new THREE.Group();
  const exclude = [{ x: 0, z: 0, r: 26 }];
  for (const lm of spec.landmarks) {
    const p = landmarkPos(lm); p.y = groundAt(p.x, p.z); anchors[lm.id || lm.kind] = p.clone();
    exclude.push({ x: p.x, z: p.z, r: (lm.radius ?? 10) + 6 });
    if (lm.kind === 'village') { for (let i = 0; i < (lm.houses ?? 5); i++) { const a = (i / (lm.houses ?? 5)) * Math.PI * 2; const h = house({ seed: spec.seed + i, style: i % 3 === 0 ? 'stone' : 'cottage' }); h.position.set(p.x + Math.cos(a) * 13, p.y, p.z + Math.sin(a) * 13); h.rotation.y = -a - Math.PI / 2; structures.add(h); } const w = PROPS.well(); w.position.copy(p); structures.add(w); }
    else if (lm.kind === 'ruins') { for (let i = 0; i < 7; i++) { const a = (i / 7) * Math.PI * 2; const pl = PROPS.pillar({ broken: i % 2 === 0, seed: i }); pl.position.set(p.x + Math.cos(a) * 8, p.y - 0.1, p.z + Math.sin(a) * 8); structures.add(pl); } }
    else if (lm.kind === 'camp') { for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2; const o = PROPS[i % 2 ? 'crate' : 'barrel']({}); o.position.set(p.x + Math.cos(a) * 4, p.y, p.z + Math.sin(a) * 4); structures.add(o); } const t = PROPS.torch({}); t.position.copy(p); structures.add(t); }
    else if (lm.kind === 'tower') { const t = tower({ floors: lm.floors ?? 10, width: 10, depth: 10, seed: spec.seed }); t.position.copy(p); structures.add(t); }
    else if (lm.kind === 'arena') { for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; const pl = PROPS.pillar({ height: 6, broken: rng.chance(0.4), seed: i }); pl.position.set(p.x + Math.cos(a) * 18, p.y, p.z + Math.sin(a) * 18); structures.add(pl); } }
  }
  structures.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  app.scene.add(structures); for (const c of structures.children) if (c.userData.collider) app.physics.addFromObject(c);
  if (hf) {
    const dens = biome.trees ?? 1;
    const veg = populate(hf, { seed: spec.seed, trees: Math.round((W.trees ?? 220) * dens), rocks: W.rocks ?? 100, bushes: Math.round(160 * dens), grass: biome.grassAmt === 0 ? 0 : app.gfx.tier.name === 'low' ? 2500 : (W.grass ?? 8000), species: W.species || biome.species, exclude, palette: { leaves: biome.leaves, grass: biome.grass2 } });
    app.scene.add(veg.group); for (const c of veg.colliders) app.physics.addStatic({ type: 'cylinder', x: c.x, y: hf.heightAt(c.x, c.z) - 0.5, z: c.z, r: c.r, h: c.h }, { kind: c.kind });
  }
  loader.set(0.55, 'Spawning characters…');

  // ---------- Systems ----------
  const flags = new Flags(), quests = new QuestSystem(flags, app.events), inventory = new Inventory(spec.items || {}), progression = new Progression();
  const dialogue = new DialogueSystem({ flags, quests, inventory, events: app.events });
  quests.define(spec.quests);
  Object.assign(game, { flags, quests, inventory, progression, dialogue });
  app.events.on('quest:start', ({ quest }) => { app.ui.toast(quest.title, { big: true, sub: 'New quest' }); app.audio.play('questStart'); });
  app.events.on('quest:complete', ({ quest, rewards }) => { app.ui.toast(quest.title, { big: true, sub: 'Quest complete' }); app.audio.play('questComplete'); if (rewards?.xp) progression.addXP(rewards.xp); checkWin(); });
  flags.onChange = () => { quests.onFlag(); game.storyAutoStart?.(); };
  if (spec.story?.initialFlags) for (const [k, v] of Object.entries(spec.story.initialFlags)) flags.set(k, v);
  // story missions with start: 'auto' begin as soon as their requirements are met
  const autoStart = () => { for (const id of spec.story?.autoStart || []) if (quests.available(id)) quests.start(id); };
  app.events.on('quest:complete', () => autoStart());
  game.storyAutoStart = autoStart;

  // ---------- Player ----------
  const spawn = spec.player.spawn ? new THREE.Vector3(spec.player.spawn[0], 0, spec.player.spawn[1]) : anchors.center.clone().add(new THREE.Vector3(0, 0, isCity ? 0 : 14));
  spawn.y = groundAt(spawn.x, spawn.z) + 0.5;
  const player = new Player(app, { combat: spec.player.combat && spec.player.mode !== 'vehicle', hp: spec.player.hp, position: spawn, facing: Math.PI, look: spec.player.look || {} });
  game.player = player;
  player.targets = () => game.enemies.filter((e) => e.alive);
  if (spec.player.mode === 'vehicle') {
    const rig = car({ type: spec.player.vehicle?.type || 'sports', color: spec.player.vehicle?.color ?? 0x16c8ff, seed: spec.seed });
    app.scene.add(rig);
    game.vehicle = new Vehicle(app.physics, rig, { position: spawn.clone(), yaw: spec.player.vehicle?.yaw ?? 0, ...(spec.player.vehicle?.tuning || {}) });
    game.chase = new ChaseCamera(app.camera, app.physics); app.cameraRigs = [game.chase];
    player.model.visible = false; player.ctrl.enabled = false;
    app.events.on('audio:unlocked', () => { game.engineSnd = app.audio.engine({}); });
  }

  // ---------- Enemies ----------
  const tokens = new AttackTokens(spec.attackTokens ?? 2);
  app.__enemies = game.enemies;
  game.spawnEnemy = (type, pos, extra = {}) => {
    const e = new Enemy(app, { type: ENEMY_TYPES[type] ? type : 'grunt', position: pos, tokens, seed: rng.int(1, 1e6), ...extra });
    e.anim.on('hit', () => { if (!e.alive || e.stagger > 0) return; for (const h of e.strike([player])) player.receive(e.stats.damage, { direction: h.direction, knockback: 3.5, source: e }); });
    e.on('death', () => { app.audio.play('death', { pos: e.position }); progression.addXP(e.health.max / 2); game.state.kills = (game.state.kills || 0) + 1; quests.report('kill', e.type); app.after(4, () => e.remove()); checkWin(); });
    game.enemies.push(e); return e;
  };
  for (const g of spec.enemies) {
    const at = g.at ? anchors[g.at] || landmarkPos({ at: g.at }) : anchors.center;
    for (let i = 0; i < (g.count ?? 1); i++) {
      const a = rng.range(0, Math.PI * 2), r = rng.range(6, g.spread ?? 16);
      const x = at.x + Math.cos(a) * r, z = at.z + Math.sin(a) * r;
      const e = game.spawnEnemy(g.type || 'grunt', new THREE.Vector3(x, groundAt(x, z) + 0.5, z), g.boss ? { hp: g.hp ?? 600, scale: 1.5 } : g.hp ? { hp: g.hp } : {});
      if (g.boss) { e.isBoss = true; e.name = g.name || 'Boss'; game.boss = e; }
    }
  }
  // ---------- NPCs ----------
  for (const n of spec.npcs) {
    const at = n.at ? anchors[n.at] || landmarkPos({ at: n.at }) : anchors.center;
    const x = at.x + (n.offset?.[0] ?? rng.range(-6, 6)), z = at.z + (n.offset?.[1] ?? rng.range(-6, 6));
    const npc = new NPC(app, { look: n.look || { seed: rng.int(1, 999) }, position: new THREE.Vector3(x, groundAt(x, z) + 0.3, z), name: n.name, dialogue: n.id, wanderRadius: n.wander ?? 2, seed: rng.int(1, 999) });
    game.npcs[n.id] = npc;
    if (n.dialogue) dialogue.define(n.id, n.dialogue);
    player.interactables.push({ id: 'npc:' + n.id, get position() { return npc.position; }, radius: 2.6, label: 'Talk to ' + n.name, action: () => game.talk(n.id) });
  }
  // ---------- Collectibles ----------
  for (const c of spec.collectibles) {
    const at = c.at ? anchors[c.at] || landmarkPos({ at: c.at }) : anchors.center;
    for (let i = 0; i < (c.count ?? 5); i++) {
      let x, z, tries = 0;
      do { const a = rng.range(0, Math.PI * 2), r = rng.range(c.minRadius ?? 10, c.radius ?? (isCity ? 120 : W.size * 0.32)); x = at.x + Math.cos(a) * r; z = at.z + Math.sin(a) * r; tries++; }
      while (tries < 30 && ((hf && (hf.heightAt(x, z) < 0.5 || !hf.inBounds(x, z, 10))) || (city && !city.isRoad(x, z))));
      const obj = PROPS.pickup({ type: c.kind || 'gem', color: c.color }); obj.scale.setScalar(c.scale ?? 1.4);
      const base = groundAt(x, z) + 1; obj.position.set(x, base, z); app.scene.add(obj);
      const item = { id: `${c.item || c.kind}:${i}`, item: c.item || c.kind || 'gem', obj, base, taken: false };
      game.collectibles.push(item);
      player.interactables.push({ id: item.id, position: obj.position, radius: 2.6, label: c.label || 'Pick up', enabled: () => !item.taken, action: () => game.collect(item) });
    }
  }
  game.collect = (item) => {
    if (item.taken) return; item.taken = true; app.scene.remove(item.obj);
    inventory.add(item.item); quests.report('collect', item.item); app.audio.play('pickup'); app.vfx.emit('magic', item.obj.position, { count: 30 });
    checkWin();
  };
  // ---------- Dialogue flow ----------
  let talking = null, lastEnd = -1;
  const show = () => { const cur = dialogue.current(); if (!cur) return endTalk(); app.ui.showDialogue(cur, (c) => advance(c)); app.audio.speak(cur.text); };
  const advance = (choice = null) => { const cur = dialogue.current(); if (!cur) return endTalk(); if (cur.choices.length && choice === null) return; dialogue.advance(choice); show(); };
  const endTalk = () => { app.ui.hideDialogue(); if (talking) { game.npcs[talking].talking = false; game.npcs[talking].anim.setUpperOverride(null); } talking = null; lastEnd = app.loop.time; if (app.state === 'dialogue') app.setState('playing'); };
  game.talk = (id) => {
    if (app.loop.time - lastEnd < 0.4 || !dialogue.dialogues[id]) return;
    talking = id; game.npcs[id].talking = true; game.npcs[id].anim.setUpperOverride('talk');
    app.setState('dialogue'); flags.set('talked:' + id); quests.report('talk', id); dialogue.start(id); show();
  };
  app.add(() => {
    if (app.ui.dialogueOpen && (app.input.pressed('interact') || app.input.pressed('confirm'))) { if (!app.ui.skipTyping()) advance(null); }
    for (let k = 0; k < 4; k++) if (app.input.pressed('choice' + (k + 1))) { const cur = dialogue.current(); if (cur?.choices[k]) advance(cur.choices[k].index); }
    for (const n of Object.values(game.npcs)) n.update(1 / 60, player);
    player.update(1 / 60); player.cam.update(1 / 60, player.position);
  }, { states: ['dialogue'] });

  // ---------- Goal / win-lose ----------
  const G = spec.goal;
  function goalProgress() {
    if (G.type === 'defeat') return { done: game.enemies.length > 0 && game.enemies.every((e) => !e.alive), text: `Defeat all enemies (${game.enemies.filter((e) => !e.alive).length}/${game.enemies.length})` };
    if (G.type === 'collect') { const t = G.count ?? game.collectibles.length; const n = game.collectibles.filter((c) => c.taken).length; return { done: n >= t, text: `${G.label || 'Collect items'} (${n}/${t})` }; }
    if (G.type === 'quests') { const ids = G.quests || spec.quests.map((q) => q.id); return { done: ids.every((id) => quests.status(id) === 'complete'), text: G.label || 'Complete the story' }; }
    if (G.type === 'reach') { const p = anchors[G.at] || landmarkPos({ at: G.at }); const d = Math.hypot((game.vehicle?.position || player.position).x - p.x, (game.vehicle?.position || player.position).z - p.z); return { done: d < (G.radius ?? 8), text: `${G.label || 'Reach the destination'} (${Math.round(d)} m)` }; }
    if (G.type === 'survive') { const t = G.seconds ?? 120; return { done: (game.state.time || 0) >= t, text: `Survive (${Math.max(0, Math.ceil(t - (game.state.time || 0)))} s)` }; }
    return { done: false, text: G.label || 'Explore' };
  }
  function checkWin() {
    if (app.state !== 'playing' && app.state !== 'dialogue') return;
    if (goalProgress().done) {
      app.setState('gameover'); app.audio.play('questComplete'); app.audio.playMusic('heroic', { intensity: 0.5 });
      app.after(1.2, () => app.ui.endScreen({ victory: true, title: G.winTitle || 'Victory', text: G.winText || 'Objective complete.', stats: { Time: Math.round(game.state.time || 0) + ' s', Kills: game.state.kills || 0, Level: progression.level }, onRetry: () => location.reload(), onQuit: showTitle }));
    }
  }
  game.checkWin = checkWin;

  // ---------- HUD ----------
  const hp = spec.player.mode !== 'vehicle' ? app.ui.bar('hp', { label: 'Health', color: 'linear-gradient(90deg,#ff4d5e,#ff8a5e)' }) : null;
  const st = spec.player.combat && spec.player.mode !== 'vehicle' ? app.ui.bar('stamina', { label: 'Stamina' }) : null;
  const obj = app.ui.objectives('tr');
  const speedo = game.vehicle ? app.ui.speedometer('br') : null;
  const mini = app.ui.minimap({ corner: game.vehicle ? 'bl' : 'br', range: isCity ? 120 : 70 });
  const CONTROLS = game.vehicle ? [['Drive', 'W/S'], ['Steer', 'A/D'], ['Handbrake', 'Space'], ['Boost', 'Shift'], ['Pause', 'Esc']]
    : [['Move', 'WASD'], ['Camera', 'Mouse'], ['Sprint', 'Shift'], ['Jump', 'Space'], ['Interact', 'E'], ...(spec.player.combat ? [['Attack', 'LMB/J'], ['Heavy', 'RMB/K'], ['Block', 'Q'], ['Dodge', 'Alt/L'], ['Lock-on', 'Tab'], ['Ability', 'F']] : []), ['Pause', 'Esc']];

  // ---------- Main update ----------
  app.add((dt) => {
    if (app.input.pressed('pause')) { app.setState('paused'); app.ui.pauseMenu({ onResume: () => app.setState('playing'), onQuit: showTitle, onSave: () => app.save.save('auto'), controls: CONTROLS }); return; }
    game.state.time = (game.state.time || 0) + dt;
    if (game.vehicle) {
      const v = game.vehicle; v.drive(app.input); v.update(dt); game.chase.update(dt, v); player.ctrl.position.copy(v.position);
      game.engineSnd?.set(v.rpm, v.throttle); speedo.set(v.kmh, v.gear, v.boostFuel); app.atmosphere.setFocus(v.position);
      game.traffic?.collide(v, (imp) => imp > 3 && app.audio.play('crash', { volume: 0.6 }));
    } else player.control(dt);
    game.traffic?.update(dt, game.vehicle ? [game.vehicle] : []);
    for (const e of game.enemies) { e.think(dt, player); e.update(dt); }
    for (const n of Object.values(game.npcs)) n.update(dt, player);
    separateActors([player, ...game.enemies, ...Object.values(game.npcs)]);
    for (const c of game.collectibles) if (!c.taken) { c.obj.rotation.y += dt * 1.5; c.obj.position.y = c.base + Math.sin(app.loop.time * 2 + c.base) * 0.12; }
    if (!player.alive && app.state === 'playing') { app.setState('gameover'); app.after(1.2, () => app.ui.endScreen({ title: 'Defeated', text: 'Try again?', onRetry: () => location.reload(), onQuit: showTitle })); }
    if (G.type === 'survive' || G.type === 'reach') checkWin();
    if (app.loop.frame % 10 === 0) for (const q of quests.activeQuests()) for (const o of quests.currentObjectives(q.id)) {
      if (o.type !== 'reach' || quests.state[q.id].done[o.id]) continue;
      const pos = game.vehicle ? game.vehicle.position : player.position;
      for (const t of [].concat(o.target)) { const a = anchors[t]; if (a && Math.hypot(pos.x - a.x, pos.z - a.z) < (o.radius ?? 12)) quests.report('reach', t); }
    }
    hp?.set(player.health.ratio); st?.set(player.stamina.ratio);
    const gp = goalProgress(); const q = quests.tracked ? quests.defs[quests.tracked] : null;
    obj.set(q ? q.title : spec.title, q ? quests.objectiveText(q.id) : [{ text: gp.text, done: gp.done }], q ? 'Quest' : 'Objective');
    if (game.boss) app.ui.boss(game.boss.alive && game.boss.position.distanceTo(player.position) < 45 ? game.boss.name : null, game.boss.health.ratio);
    const center = game.vehicle ? game.vehicle.position : player.position;
    mini.draw({ center, yaw: game.vehicle ? game.vehicle.yaw + Math.PI : player.cam.yaw, markers: [...game.enemies.filter((e) => e.alive).map((e) => ({ x: e.position.x, z: e.position.z, color: '#ff5d5d', clamp: true })), ...Object.values(game.npcs).map((n) => ({ x: n.position.x, z: n.position.z, color: '#9ad0ff' })), ...game.collectibles.filter((c) => !c.taken).map((c) => ({ x: c.obj.position.x, z: c.obj.position.z, color: '#ffd36a', shape: 'diamond', size: 6 }))] });
    game.onUpdate?.(dt);
  }, { order: 0 });
  app.add(() => { const t = app.loop.time * 0.05, r = isCity ? 160 : W.size * 0.4; app.camera.position.set(Math.sin(t) * r, isCity ? 70 : 40, Math.cos(t) * r); app.camera.lookAt(anchors.center); }, { states: ['menu'] });

  // ---------- Save ----------
  app.save.register('core', { save: () => ({ pos: player.position.toArray(), taken: game.collectibles.filter((c) => c.taken).map((c) => c.id) }), load: (d) => { player.ctrl.teleport(new THREE.Vector3(...d.pos)); for (const c of game.collectibles) if (d.taken.includes(c.id) && !c.taken) { c.taken = true; app.scene.remove(c.obj); } } });
  app.save.register('flags', { save: () => flags.toJSON(), load: (d) => flags.load(d) });
  app.save.register('quests', { save: () => quests.toJSON(), load: (d) => quests.load(d) });
  app.save.register('inventory', { save: () => inventory.toJSON(), load: (d) => inventory.load(d) });

  // ---------- Flow ----------
  function start() { app.setState('playing'); app.audio.playMusic(spec.music || (spec.enemies.length ? 'combat' : 'exploration'), { intensity: 0.5 }); for (const id of spec.startQuests || []) quests.start(id); autoStart(); }
  function showTitle() { app.setState('menu'); app.ui.mainMenu({ subtitle: spec.pitch || spec.description || '', onStart: start, onContinue: app.save.has('auto') ? () => { app.save.load('auto'); start(); } : null, controls: CONTROLS, credits: 'Generated with GameForge AAA.' }); }
  addEventListener('click', () => { if (app.state === 'playing' && !document.pointerLockElement && !game.vehicle && !('ontouchstart' in window)) app.input.requestPointerLock(app.renderer.domElement); });
  app.debugState = () => ({ player: { x: +player.position.x.toFixed(2), y: +player.position.y.toFixed(2), z: +player.position.z.toFixed(2), hp: Math.round(player.health.value), alive: player.alive, grounded: player.ctrl.grounded },
    vehicle: game.vehicle ? { kmh: Math.round(game.vehicle.kmh), x: +game.vehicle.position.x.toFixed(2), z: +game.vehicle.position.z.toFixed(2) } : null,
    enemiesAlive: game.enemies.filter((e) => e.alive).length, enemies: game.enemies.length, npcs: Object.keys(game.npcs).length, collected: game.collectibles.filter((c) => c.taken).length, collectibles: game.collectibles.length,
    quests: Object.fromEntries(Object.keys(quests.defs).map((id) => [id, quests.status(id)])), goal: goalProgress(), focus: player.focus?.id || null, dialogue: dialogue.current()?.node || null, kills: game.state.kills || 0 });
  window.__GF.game = game;
  window.__GF.startGame = () => { app.ui.closeMenu(); start(); };
  window.__GF.cheat = {
    god: () => { player.health.max = player.health.value = 1e9; },
    killAll: () => { for (const e of game.enemies) if (e.alive) e.health.damage(1e9, {}); },
    collectAll: () => { for (const c of game.collectibles) game.collect(c); },
    goTo: (id) => { const t = id.startsWith('npc:') ? game.npcs[id.slice(4)].position : (game.collectibles.find((c) => c.id === id)?.obj.position || anchors[id]); const p = t.clone().add(new THREE.Vector3(0.7, 0, 0.7)); p.y = groundAt(p.x, p.z) + 0.3; player.ctrl.teleport(p); if (game.vehicle) game.vehicle.resetOnRoad(p, 0); },
  };
  // project modules (src/*.js) extend or replace the baseline: each exports install(game)
  game.showTitle = showTitle; game.start = start;
  for (const m of modules) m?.install?.(game);
  loader.set(1); setTimeout(() => loader.done(), 200);
  showTitle();
  app.start();
  return game;
}
