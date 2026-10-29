// Open-world integration scene (engine test, not a game): generated city whose buildings are
// streamed per chunk, 36 schedule-driven pedestrians with LOD (realistic near / mannequin mid /
// hidden far), a wanted system with pursuers and HUD stars. Driven by playtest.json through
// window.__GF.cheat. URL flags: ?humans=0 (mannequins only), ?count=N, ?bench=1 (crowd bench).
import * as GF from '../../../engine/index.js';
import * as H from '../../../engine/humans.js';

const THREE = GF.THREE;
const q = new URLSearchParams(location.search);
const useHumans = q.get('humans') !== '0';
const COUNT = +(q.get('count') || 36);

const app = new GF.GameApp({ id: 'open-world-scene', title: 'Open World Systems', container: document.getElementById('game'), timeOfDay: 9 });

// ---------- world + streaming ----------
const city = GF.generateCity({ seed: 7, blocks: 6, mergeBuildings: false });
app.scene.add(city.group);
for (const c of city.colliders) app.physics.addStatic(c);
const buildingsRoot = new THREE.Group(); buildingsRoot.name = 'streamed-buildings'; app.scene.add(buildingsRoot);
const streaming = GF.streamObjects(buildingsRoot, city.buildings, { cellSize: 70, loadRadius: 120, unloadRadius: 170, maxLoadsPerUpdate: 2, lookAhead: 0.5 });

// ---------- humans (optional dataset) ----------
if (useHumans) app.useHumans(H, await H.loadHumanData(), { textureSize: 256 });

// ---------- player ----------
const spawn = new THREE.Vector3(city.spawn.x, 0.2, city.spawn.z);
const player = new GF.Player(app, { combat: false, position: spawn, look: { style: 'stylized', outfit: 'casual', top: 0xd04020, bottom: 0x202020, hairStyle: 'short' } });
streaming.warm(player.position);

// ---------- crowd ----------
const crowd = new GF.Crowd(app, city, { count: COUNT, seed: 21, maxNear: 6, nearRange: 14, midRange: 60, variants: 3 });
await crowd.prepare();

// ---------- wanted system ----------
const police = [];
const spawnPoint = (center, rng) => { const a = rng.range(0, Math.PI * 2), r = rng.range(28, 40); const p = crowd.network.project({ x: center.x + Math.sin(a) * r, z: center.z + Math.cos(a) * r }); return new THREE.Vector3(p.x, 0.3, p.z); };
const wanted = new GF.WantedSystem({
  events: app.events, spawnPoint,
  canSee: GF.lineOfSight(app.physics, { range: 40 }),
  spawn: (pos) => {
    const u = new GF.Actor(app, { position: pos, name: 'Officer', tags: ['police'], look: { style: 'stylized', outfit: 'casual', top: 0x1a2a5a, bottom: 0x141a2a, accent: 0xd0d0e0, hairStyle: 'buzz', seed: police.length + 3 } });
    police.push(u); return u;
  },
  despawn: (u) => { u.remove(); police.splice(police.indexOf(u), 1); },
});
const hud = GF.wantedHUD(app.ui, wanted);
let frozen = false;

app.add((dt) => {
  player.control(dt);
  streaming.update(player.position, dt);
  if (!frozen) crowd.update(dt, app.camera.position.clone().lerp(player.position, 0.5));
  wanted.update(dt, player);
  for (const u of police) { const v = GF.WantedSystem.steer(u); const sp = Math.min(v.length(), 5.5); u.update(dt, sp > 0.05 ? v.normalize() : new THREE.Vector3(), sp, { faceMovement: true }); }
  hud.update();
  app.atmosphere.setFocus?.(player.position);
});

app.debugState = () => ({
  hour: +app.atmosphere.timeOfDay.toFixed(2),
  player: { x: +player.position.x.toFixed(1), z: +player.position.z.toFixed(1) },
  chunks: { loaded: streaming.loadedKeys.length, loads: streaming.stats.loads, unloads: streaming.stats.unloads, pending: streaming.pending.length, buildingsVisible: buildingsRoot.children.length, buildingsTotal: city.buildings.length },
  crowd: crowd.info(),
  wanted: wanted.debug(),
  police: police.length,
  stars: hud.widget.value,
});

// ---------- test hooks ----------
const cheat = {
  goTo: (x, z) => { player.ctrl.teleport(new THREE.Vector3(x, 0.3, z)); },
  goBlock: (i, j) => { const c = crowd.network.centerOf, r = crowd.network.ringRadius; cheat.goTo(c(i) + r, c(j)); },
  setHour: (h) => app.atmosphere.setTime(h),
  goNearPedestrian: () => { const p = crowd.peds.find((x) => x.agent.visible && !x.agent.interruption); if (!p) return false; const a = p.agent.position; const q2 = crowd.network.project({ x: a.x + 3, z: a.z + 3 }); cheat.goTo(q2.x, q2.z); return true; },
  crime: (type = 'assault') => { const w = crowd.witnesses(player.position, 30).length; wanted.commit(type, { position: player.position, witnessed: true }); crowd.alarm(player.position); return w; },
  // rough check that pedestrians are where their schedule says
  scheduleConsistency: () => {
    let ok = 0, n = 0;
    for (const p of crowd.peds) { const a = p.agent; if (!a.place || a.interruption || a.state === 'travel') continue; n++; const d = Math.hypot(a.position.x - a.place.x, a.position.z - a.place.z); if (a.state === 'inside' ? d < 1 : d < (GF.ACTIVITIES[a.activity]?.radius ?? 3) + 4 || GF.ACTIVITIES[a.activity]?.roam) ok++; }
    return n ? ok / n : 0;
  },
  activities: () => crowd.info().byActivity,
  // Crowd budget: lay out all pedestrians in front of the camera and measure one plain render.
  bench: (mode = 'lod') => {
    frozen = true;
    const cam = app.camera, base = new THREE.Vector3(0, 0.2, 0);
    cheat.goTo(base.x, base.z - 300); // park the player far away so only the crowd is near the origin
    cam.position.set(0, 1.7, -4); cam.lookAt(0, 1.2, 20); cam.updateMatrixWorld();
    const spacing = mode === 'lod' ? 2.6 : 1.4;
    crowd.peds.forEach((p, i) => { const col = i % 10, row = Math.floor(i / 10); p.agent.position.set((col - 4.5) * spacing, 0.2, 2 + row * (mode === 'lod' ? 16 : 1.6)); p.agent.visible = true; p.agent.state = 'perform'; p.agent.velocity.set(0, 0, 0); p.agent.heading = Math.PI; });
    Object.assign(crowd, mode === 'realistic' ? { maxNear: 1000, nearRange: 1e4, midRange: 1e4 } : mode === 'mannequin' ? { maxNear: 0, midRange: 1e4 } : { maxNear: 6, nearRange: 14, midRange: 60 });
    const sim = crowd.schedules.update; crowd.schedules.update = () => {}; crowd.update(0, cam.position); crowd.schedules.update = sim;
    const r = app.renderer, hideCity = [city.group, buildingsRoot, player.model, ...police.map((u) => u.model)];
    const measure = () => { r.info.autoReset = false; r.info.reset(); r.render(app.scene, cam); const o = { calls: r.info.render.calls, triangles: r.info.render.triangles }; r.info.autoReset = true; return o; };
    for (const o of hideCity) o.visible = false;
    crowd.group.visible = false; const empty = measure();
    crowd.group.visible = true; const full = measure();
    for (const o of hideCity) o.visible = true;
    const info = crowd.info();
    return { mode, pedestrians: crowd.peds.length, near: info.near, mid: info.mid, hidden: info.hidden, calls: full.calls - empty.calls, triangles: full.triangles - empty.triangles, shadowsIncluded: r.shadowMap.enabled };
  },
};
window.__GF.cheat = cheat; window.__GF.crowd = crowd; window.__GF.wanted = wanted; window.__GF.streaming = streaming;
app.setState('playing');
app.start();
