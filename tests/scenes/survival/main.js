// Survival + weather integration scene (engine test, not a game): heightfield valley with
// resource nodes (trees, rocks, bushes), slot inventory + equipment, crafting queue, needs
// driven by weather and time of day, grid/snap building with a ghost preview, campfire heat and
// shelter, a seeded weather system (cloud dome, fog, GPU rain/snow, lightning + thunder, wet
// surfaces) and a full save/load round trip. Driven by playtest.json through window.__GF.cheat.
// Controls when played by hand: WASD move, E / left click harvest, B cycle build piece, R rotate,
// F place, C craft axe, 1-4 weather, K save, L load.
import * as GF from '../../../engine/index.js';

const THREE = GF.THREE;
const app = new GF.GameApp({ id: 'survival-scene', title: 'Survival Systems', container: document.getElementById('game'), timeOfDay: 10.5 });
const tier = app.gfx.tier.name;

// ---------- terrain + decor ----------
const hf = new GF.Heightfield({ size: 220, resolution: 128, seed: 21, height: 14, type: 'hills', flatten: [{ x: 0, z: 0, radius: 16, falloff: 14 }] });
app.physics.hf = hf; app.physics.waterLevel = -999;
const terrain = GF.terrainMesh(hf); terrain.receiveShadow = true; app.scene.add(terrain);
const decor = GF.populate(hf, { seed: 4, trees: 70, rocks: 24, bushes: 50, grass: tier === 'low' ? 3000 : 9000, species: ['pine', 'oak'], exclude: [{ x: 0, z: 0, r: 34 }], grassRadius: 60 });
app.scene.add(decor.group);
for (const c of decor.colliders) app.physics.addStatic({ type: 'cylinder', x: c.x, y: hf.heightAt(c.x, c.z) - 0.2, z: c.z, r: c.r, h: c.h });

// ---------- survival systems ----------
const registry = new GF.ItemRegistry();
const inventory = new GF.SlotInventory(registry, { slots: 24, maxWeight: 80, events: app.events });
const equipment = new GF.Equipment(inventory);
const nodes = new GF.ResourceNodes({ scene: app.scene, physics: app.physics, seed: 8, events: app.events });
// a guaranteed starter set near spawn + seeded scatter in a ring around the camp
nodes.add('tree', { x: 7, y: hf.heightAt(7, 5), z: 5 }, { scale: 1.05 });
nodes.add('rock', { x: -6, y: hf.heightAt(-6, 6), z: 6 }, { scale: 1.1 });
nodes.add('bush', { x: 4, y: hf.heightAt(4, -7), z: -7 });
const ring = (lo, hi) => (x, z) => { const d = Math.hypot(x, z); return d > lo && d < hi ? 1 : 0; };
nodes.scatter(hf, 'tree', { count: 18, density: ring(12, 34), spacing: 7 });
nodes.scatter(hf, 'rock', { count: 8, density: ring(10, 30), spacing: 9, maxSlope: 0.4 });
nodes.scatter(hf, 'bush', { count: 10, density: ring(8, 30), spacing: 8 });

const materials = { wood: GF.pbr('planks', { repeat: [1, 1], color: 0x9a7048 }), darkWood: GF.solid(0x5a3e26, { roughness: 0.9 }), stone: GF.pbr('rock', { color: 0x8c8880 }), thatch: GF.solid(0xb09658, { roughness: 1 }) };
const build = new GF.BuildPlacement({ scene: app.scene, physics: app.physics, ground: hf, grid: 3, events: app.events, materials,
  blockers: () => nodes.nodes.filter((n) => n.alive && n.type !== 'bush').map((n) => ({ x: n.position.x, z: n.position.z, r: nodes.types[n.type].radius * n.scale, kind: n.type })) });
const crafting = new GF.CraftingSystem(inventory, { equipment, stations: () => build.stationsNear(player.position, 3.5), events: app.events });

// ---------- player ----------
const player = new GF.Player(app, { combat: false, position: new THREE.Vector3(0, hf.heightAt(0, -3) + 0.2, -3), look: { style: 'stylized', outfit: 'casual', top: 0x6a7a3a, bottom: 0x3a3226, hairStyle: 'short', seed: 4 } });
const needs = new GF.Needs({ health: player.health, stamina: player.stamina, events: app.events, hoursPerSecond: 24 / 600 });
let axeMesh = null;
const syncTool = () => {
  const t = equipment.slots.tool;
  if (t && !axeMesh) { axeMesh = GF.PROPS.axe(); GF.attach(player.model, 'hand_R', axeMesh); }
  if (axeMesh) axeMesh.visible = !!t;
};
app.events.on('inventory:equip', syncTool); app.events.on('inventory:break', syncTool);

// ---------- weather ----------
const weather = GF.attachWeather(app, { seed: 11, ground: hf, transition: 8, climate: { mean: 9, amplitude: 6 } });
const wetCount = weather.registerScene(app.scene, { filter: (m) => m !== terrain && !player.model.getObjectById(m.id) });
for (const k of ['wood', 'darkWood', 'stone']) weather.registerWet(materials[k], { snow: 0.1 }); // vertical surfaces barely hold snow
weather.registerWet(materials.thatch, { snow: 0.75 });

// ---------- HUD ----------
const needsUI = GF.needsHUD(app.ui, needs);
const hotbar = GF.inventoryHUD(app.ui, inventory, { equipment });
const weatherUI = app.ui.counter('weather', { icon: '☁', label: '', corner: 'tr', value: 'clear' });

// ---------- interaction ----------
const PIECES = ['foundation', 'wall', 'doorway', 'roof', 'campfire', 'storage'];
let buildMode = null, buildRot = 0, lastWork = 99;
const stats = { hits: 0, harvests: [], crafted: [] };
app.events.on('craft:complete', (e) => stats.crafted.push(e.id));
const front = (d = 3.2) => { const f = player.facing; return { x: player.position.x + Math.sin(f) * d, z: player.position.z + Math.cos(f) * d }; };
const swing = (node) => {
  if (!node) return null; const r = nodes.harvest(node, { inventory, equipment }); stats.hits++; lastWork = 0;
  if (r.ok) { player.anim.play('attack1', { upperOnly: true }); const p = node.position.clone(); p.y += 1; app.vfx.emit(node.type === 'rock' ? 'debris' : 'dust', p, { count: 6, scale: 0.6 }); app.audio.play(node.type === 'rock' ? 'clang' : 'hit', { pos: p }); }
  else app.ui.toast(r.reason);
  return r;
};
app.input.bind('build', ['KeyB']); app.input.bind('rotate', ['KeyR']); app.input.bind('place', ['KeyF']); app.input.bind('craft', ['KeyC']);
app.input.bind('save', ['KeyK']); app.input.bind('load', ['KeyL']);

app.add((dt) => {
  player.speedScale = needs.speedScale;
  player.control(dt);
  lastWork += dt;
  const pos = player.position, input = app.input;
  if (input.pressed('interact') || input.pressed('attack')) swing(nodes.inFront(pos, player.facing));
  if (input.pressed('build')) buildMode = buildMode === null ? PIECES[0] : PIECES[(PIECES.indexOf(buildMode) + 1) % (PIECES.length + 1)] ?? null;
  if (input.pressed('rotate')) buildRot += Math.PI / 2;
  if (buildMode) { const r = build.preview(buildMode, front(), buildRot); if (input.pressed('place')) { const p = build.place(buildMode, front(), buildRot, { inventory }); if (!p.id) app.ui.toast(p.reason); } } else build.hidePreview();
  if (input.pressed('craft')) { const r = crafting.craft('stoneAxe'); if (!r.ok) app.ui.toast(r.reason); }
  for (const [i, s] of ['clear', 'cloudy', 'rain', 'storm'].entries()) if (input.pressed('choice' + (i + 1))) weather.set(s);
  if (input.pressed('save')) cheat.saveGame(); if (input.pressed('load')) cheat.loadGame();
  nodes.update(dt); crafting.update(dt); build.update(dt, { rain: weather.rainIntensity, vfx: app.vfx });
  const v = player.ctrl.velocity, spd = Math.hypot(v.x, v.z);
  needs.update(dt, { activity: lastWork < 1.2 ? 'work' : spd > 6 ? 'sprint' : spd > 0.6 ? 'walk' : 'idle', ambient: weather.temperature, wind: weather.windSpeed, rain: weather.rainIntensity + weather.snowIntensity * 0.3,
    shelter: build.shelterAt(pos), heat: build.heatAt(pos), insulation: equipment.insulation() });
  needsUI.update(); hotbar.update();
  weatherUI.set(`${weather.state} ${weather.temperature.toFixed(0)}°C`);
  app.atmosphere.setFocus(pos);
}, { order: 10 });

app.debugState = () => ({
  player: { x: +player.position.x.toFixed(2), y: +player.position.y.toFixed(2), z: +player.position.z.toFixed(2), hp: +player.health.value.toFixed(2) },
  inv: Object.fromEntries(Object.keys(registry.defs).map((id) => [id, inventory.count(id)]).filter(([, n]) => n)), weight: inventory.weight,
  tool: equipment.tool(), needs: needs.debug(), nodes: nodes.debug(), build: build.debug(),
  ghost: build.ghost ? { visible: build.ghost.visible, valid: build.last?.valid, reason: build.last?.reason } : null,
  crafting: { queue: crafting.queue.length, crafted: crafting.crafted }, weather: weather.debug(),
  shelter: build.shelterAt(player.position), heat: +build.heatAt(player.position).toFixed(2), stations: [...build.stationsNear(player.position, 3.5)], wetMaterials: wetCount,
});

// ---------- test hooks ----------
const cheat = {
  goTo: (x, z, face) => { player.ctrl.teleport(new THREE.Vector3(x, hf.heightAt(x, z) + 0.3, z)); if (face !== undefined) cheat.face(face); },
  face: (yaw) => { player.ctrl.facing = yaw; player.model.rotation.y = yaw; player.cam.yaw = yaw + Math.PI; },
  faceTo: (x, z) => cheat.face(Math.atan2(x - player.position.x, z - player.position.z)),
  view: (yawOffset = 0, pitch = 0.3, dist = 5) => { player.cam.yaw = player.facing + Math.PI + yawOffset; player.cam.pitch = pitch; player.cam.distance = dist; },
  // Walk up to the nearest live node of a type and swing until it is depleted. Returns hits + yields.
  harvest: (type, maxHits = 60) => {
    const n = nodes.nearest(player.position, { type }); if (!n) return null;
    const a = Math.atan2(player.position.x - n.position.x, player.position.z - n.position.z), d = nodes.types[type].radius * n.scale + 1.1;
    cheat.goTo(n.position.x + Math.sin(a) * d, n.position.z + Math.cos(a) * d); cheat.faceTo(n.position.x, n.position.z);
    const target = nodes.inFront(player.position, player.facing, { type }); if (target !== n) return { error: 'not in front' };
    let hits = 0; const got = {};
    while (n.alive && hits < maxHits) { const r = swing(n); hits++; if (!r.ok) return { error: r.reason, hits }; for (const y of r.yields) got[y.id] = (got[y.id] || 0) + y.n; }
    stats.harvests.push({ type, hits, got }); return { hits, got, depleted: !n.alive, tool: equipment.tool().kind };
  },
  // Raycast harvest: aim from the eye along the facing direction.
  rayHarvest: () => { const e = player.position.clone(); e.y += 1.4; const f = player.facing; const hit = nodes.raycast(e, new THREE.Vector3(Math.sin(f), -0.15, Math.cos(f)).normalize(), 3.5); return hit ? { type: hit.node.type, distance: +hit.distance.toFixed(2), ...swing(hit.node) } : null; },
  gather: (type, count) => { const out = []; for (let i = 0; i < count; i++) out.push(cheat.harvest(type)); return out; },
  craftStatus: (id) => crafting.canCraft(id),
  craft: (id, count = 1) => crafting.craft(id, { count }),
  equip: (id) => { const ok = equipment.equipItem(id); syncTool(); return ok; },
  previewFront: (type, d = 3.6) => { buildMode = type; const r = build.preview(type, front(d), buildRot); return r; },
  previewAt: (type, x, z) => { buildMode = null; return build.preview(type, { x, z }, 0); },
  stopBuild: () => { buildMode = null; build.hidePreview(); },
  place: (type, x, z, rot = 0) => { const p = build.place(type, { x, z }, rot, { inventory }); return p.id ? { id: p.id, type: p.type, x: p.x, z: p.z } : p; },
  // Foundation in front of the player + 2 walls + doorway + roof, campfire beside the door.
  buildShelter: () => {
    const c = front(4.5), f = build.place('foundation', c, 0, { inventory }); if (!f.id) return { step: 'foundation', ...f };
    const g = build.grid / 2, out = { foundation: f.id };
    for (const [type, dx, dz] of [['wall', 0, g], ['wall', -g, 0], ['wall', g, 0], ['doorway', 0, -g]]) { const p = build.place(type, { x: f.x + dx, z: f.z + dz }, 0, { inventory }); out[type + (dx || dz)] = p.id ? p.id : p.reason; }
    const r = build.place('roof', { x: f.x, z: f.z }, 0, { inventory }); out.roof = r.id || r.reason;
    const fire = build.place('campfire', { x: f.x, z: f.z - g - 1.4 }, 0, { inventory }); out.campfire = fire.id || fire.reason;
    out.center = { x: f.x, z: f.z }; return out;
  },
  setWeather: (s, transition = 6) => weather.set(s, { transition }),
  strike: (distance = 260) => weather.strike({ distance, angle: player.cam.yaw + Math.PI }),
  saveGame: () => { const s = app.save.save('slot1'); app.ui.toast('Saved'); return Object.keys(s.data); },
  loadGame: () => { const ok = app.save.load('slot1'); syncTool(); return ok; },
  // Corrupt live state so the load can prove it restores everything.
  scramble: () => { for (const id of Object.keys(registry.defs)) inventory.remove(id, inventory.count(id)); equipment.slots.tool = null; for (const p of [...build.placed]) build.remove(p); weather.set('clear', { transition: 0 }); needs.hunger = 100; needs.thirst = 100; nodes.update(5000); syncTool(); },
  stats: () => stats,
};
// player position in the save too
app.save.register('player', { save: () => ({ x: player.position.x, z: player.position.z, facing: player.facing, hp: player.health.value }), load: (d) => { cheat.goTo(d.x, d.z, d.facing); player.health.value = d.hp; } });
GF.attachSurvivalSave(app.save, { inventory, equipment, crafting, needs, nodes, building: build, weather });
window.__GF.cheat = cheat; Object.assign(window.__GF, { weather, build, nodes, inventory, needs, crafting });
cheat.face(0.5); cheat.view(0.35, 0.28, 5.2);
app.setState('playing');
app.start();
