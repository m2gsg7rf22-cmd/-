// Borrowed Shine — GTA-like vertical slice (original IP) built only from the GameForge skill docs.
// composeGame() gives city + traffic + story NPCs/quests/dialogue + HUD/menus; the modules below add
// what the composer does not provide: shooter kit on a realistic human, enter/exit/drive parked cars,
// a scheduled pedestrian crowd, a wanted system with on-foot officers and a police cruiser, and the
// game-code side of the story's custom/reach objectives.
import * as GF from '../../../engine/index.js';
import { composeGame } from '../../../engine/index.js';
import * as Humans from '../../../engine/humans.js';
import K from '../../../engine/modeling/index.js';
import buildGarage from './assets/halfmoon-garage.model.js';
import { SPEC } from './game.spec.js';
import story from './story/borrowed-shine.story.js';

const { THREE } = GF;
SPEC.story = story;
const V = (x, z, y = 0.2) => new THREE.Vector3(x, y, z);

// ---- district layout (roads at x/z = -140, -70, 0, 70, 140; road 14 m, sidewalk 4 m)
const PLACES = {
  spawn: V(7.9, -50), taqueria: V(8.0, -36), coupe: V(4.2, 22), halfmoon: V(113.6, 81.4), halfmoonCurb: V(112, 74.5), hideout: V(-128, 128),
};

// ------------------------------------------------------------------ combat (shooter kit)
const combat = { install(game) {
  const { app, player } = game;
  // composeGame already calls player.control(dt); ShooterController.control() calls it too, so gate the
  // composer's call (see GAP list: composer + shooter kit integration is undocumented).
  const orig = player.control.bind(player); let gate = false;
  player.control = (dt) => (gate ? orig(dt) : undefined);
  const shooter = new GF.ShooterController(app, player, { weapons: ['pistol', 'rifle'], aimAssist: { strength: 0.3 } });
  game.shooter = shooter;
  game.controlOnFoot = (dt) => { gate = true; shooter.control(dt); gate = false; };
} };

// ------------------------------------------------------------------ vehicles: parked cars you can steal
const vehicles = { install(game) {
  const { app, player } = game;
  app.input.bind('enterCar', ['KeyF']);
  const idle = { value: () => 0, held: () => false, pressed: () => false };
  const cars = [];
  function park(type, color, pos, yaw, opts = {}) {
    const rig = GF.car({ type, color, seed: cars.length + 3, ...opts }); app.scene.add(rig);
    rig.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    const v = new GF.Vehicle(app.physics, rig, { enginePower: 28, maxSpeed: 58 });
    v.resetOnRoad(pos.clone(), yaw);
    const entry = { v, rig, name: opts.name || type, stolen: false, owned: !!opts.owned };
    cars.push(entry); return entry;
  }
  game.coupe = park('sports', 0xd9a82b, PLACES.coupe, 0, { name: 'gold coupe' });
  park('sedan', 0x3d5a7a, V(-4.2, -20), Math.PI, { name: 'blue sedan' });
  park('suv', 0x2f3a2c, V(66 - 3.2, 40), 0, { name: 'green suv' });
  park('van', 0xc9c4b8, V(-66 + 2.8, -100), 0, { name: 'white van' });
  game.cars = cars;
  const chase = new GF.ChaseCamera(app.camera, app.physics, { distance: 7.5, height: 2.6 });
  const speedo = app.ui.speedometer('br');
  let footRigs = null, prompting = false;
  game.driving = null;
  game.enterCar = (entry) => {
    if (game.driving || !entry) return false;
    game.driving = entry; footRigs = app.cameraRigs; app.cameraRigs = [chase]; chase.yaw = entry.v.yaw;
    player.model.visible = false;
    app.audio.play('door');
    if (!entry.owned && !entry.stolen) { entry.stolen = true; app.events.emit('car:stolen', entry); }
    app.ui.toast(`You took the ${entry.name}`, { ms: 1400 });
    return true;
  };
  game.exitCar = () => {
    const e = game.driving; if (!e) return false;
    const side = new THREE.Vector3(Math.cos(e.v.yaw), 0, -Math.sin(e.v.yaw)).multiplyScalar(2.2);
    const p = e.v.position.clone().add(side); p.y = 0.3;
    player.ctrl.teleport(p); player.model.visible = true;
    app.cameraRigs = footRigs; game.driving = null; app.audio.play('door');
    return true;
  };
  const nearestCar = (r = 3.8) => {
    let best = null, bd = r;
    for (const c of cars) { const d = c.v.position.distanceTo(player.position); if (d < bd) { bd = d; best = c; } }
    return best;
  };
  game.nearestCar = nearestCar;
  game.updateVehicles = (dt) => {
    if (app.input.pressed('enterCar')) { if (game.driving) { if (Math.abs(game.driving.v.kmh) < 25) game.exitCar(); } else game.enterCar(nearestCar()); }
    for (const c of cars) { c.v.drive(c === game.driving ? app.input : idle); c.v.update(dt); }
    const d = game.driving;
    if (d) {
      if (prompting) { app.ui.prompt(null); prompting = false; }
      player.ctrl.teleport(d.v.position.clone().setY(d.v.position.y + 0.2));
      chase.update(dt, d.v); app.atmosphere.setFocus?.(d.v.position);
      speedo.set(d.v.kmh, d.v.gear, d.v.boostFuel); if (speedo.el) speedo.el.style.display = '';
    } else {
      game.controlOnFoot(dt);
      if (speedo.el) speedo.el.style.display = 'none';
      const c = nearestCar();
      if (c) { app.ui.prompt(`${c.stolen || c.owned ? 'Get in' : 'Steal'} the ${c.name}`, 'F'); prompting = true; } else if (prompting) { app.ui.prompt(null); prompting = false; }
    }
  };
} };

// ------------------------------------------------------------------ streets: scheduled pedestrian crowd
const streets = { install(game) {
  const { app } = game;
  const crowd = new GF.Crowd(app, game.city, { count: 80, seed: 21, maxNear: 6, nearRange: 16, midRange: 70, variants: 4 });
  game.crowd = crowd; game.crowdReady = false;
  crowd.prepare().then(() => { game.crowdReady = true; });
  game.updateCrowd = (dt) => { if (game.crowdReady) crowd.update(dt, app.camera.position.clone().lerp(game.player.position, 0.5)); };
} };

// ------------------------------------------------------------------ police: wanted level + pursuers
const police = { install(game) {
  const { app, player } = game;
  const units = [];
  const spawnPoint = (center, rng) => {
    const a = rng.range(0, Math.PI * 2), r = rng.range(26, 38);
    const p = game.crowd.network.project({ x: center.x + Math.sin(a) * r, z: center.z + Math.cos(a) * r });
    return new THREE.Vector3(p.x, 0.3, p.z);
  };
  const uniform = (i) => ({ archetype: 'civilian', seed: 40 + i, sex: i % 3 === 2 ? 1 : 0, hair: 'buzz', skin: ['fair', 'olive', 'brown', 'dark'][i % 4],
    outfit: [{ type: 'shirt', color: 0x1f3159 }, { type: 'pants', color: 0x161b2b }, { type: 'belt', color: 0x0d0d0d }, { type: 'boots', color: 0x111111 }] });
  const wanted = new GF.WantedSystem({
    events: app.events, spawnPoint, canSee: GF.lineOfSight(app.physics, { range: 45 }),
    spawn: (pos) => { const u = new GF.Actor(app, { position: pos, name: 'Officer', tags: ['police'], look: uniform(units.length) }); u.hitTimer = 0; units.push(u); return u; },
    despawn: (u) => { u.remove(); units.splice(units.indexOf(u), 1); },
  });
  const hud = GF.wantedHUD(app.ui, wanted);
  game.wanted = wanted; game.police = units;
  const target = { position: new THREE.Vector3() };

  // police cruiser: joins the chase from level 2, drives toward the player with a pure-pursuit steer
  let cruiser = null; const cin = { s: {}, value(a) { return this.s[a] || 0; }, held(a) { return (this.s[a] || 0) > 0.5; }, pressed: () => false };
  const spawnCruiser = () => {
    const rig = GF.car({ type: 'sedan', color: 0xf1f1f1, lightbar: true, seed: 99 }); app.scene.add(rig);
    const v = new GF.Vehicle(app.physics, rig, { enginePower: 26, maxSpeed: 40 });
    // nearest road centre line ~60 m away from the player
    const rc = game.city.roadCenters; const px = player.position.x, pz = player.position.z;
    const roadX = rc.reduce((b, x) => (Math.abs(x - px) < Math.abs(b - px) ? x : b), rc[0]);
    const z = pz + (pz > 0 ? -60 : 60);
    v.resetOnRoad(V(roadX + 3.5, z), pz > 0 ? 0 : Math.PI);
    cruiser = { v, rig, dist0: v.position.distanceTo(player.position) };
    app.audio.play('alarm', { volume: 0.4 });
  };
  game.spawnCruiser = spawnCruiser;
  app.events.on('wanted:level', () => { if (wanted.level >= 2 && !cruiser) spawnCruiser(); });

  // crimes
  let lastShotCrime = -9;
  // Gunshots are loud and the councilman's coupe has an alarm, so both crimes are always reported;
  // pedestrian witnesses (crowd.witnesses) are counted for the HUD/debug and flee via crowd.alarm.
  game.crimeLog = [];
  const commit = (crime, pos, { loud = true } = {}) => {
    const witnesses = game.crowdReady ? game.crowd.witnesses(pos, 35).length : 0;
    wanted.commit(crime, { position: pos, witnessed: loud || witnesses > 0 });
    game.crimeLog.push({ crime, witnesses, level: wanted.level });
    if (game.crowdReady) game.crowd.alarm(pos, { radius: 25, watchRadius: 45 });
    return witnesses;
  };
  game.commitCrime = commit;
  app.events.on('weapon:shot', () => { if (app.loop?.time - lastShotCrime < 1.5) return; lastShotCrime = app.loop?.time ?? 0; commit('shooting', player.position.clone()); });
  app.events.on('car:stolen', (e) => commit('vehicleTheft', e.v.position.clone()));

  game.updatePolice = (dt) => {
    target.position.copy(game.driving ? game.driving.v.position : player.position);
    wanted.update(dt, target);
    for (const u of units) {
      const v = GF.WantedSystem.steer(u); const sp = Math.min(v.length(), 5.2);
      u.update(dt, sp > 0.05 ? v.normalize() : new THREE.Vector3(), sp, { faceMovement: true });
      u.hitTimer -= dt;
      if (!game.driving && u.position.distanceTo(player.position) < 1.7 && u.hitTimer <= 0) { u.hitTimer = 1.2; player.receive?.(6, { source: u }); }
    }
    if (cruiser) {
      const v = cruiser.v, tp = wanted.state === 'pursuit' ? target.position : v.position;
      const to = new THREE.Vector3(tp.x - v.position.x, 0, tp.z - v.position.z); const dist = to.length();
      const fwd = new THREE.Vector3(Math.sin(v.yaw), 0, Math.cos(v.yaw));
      const cross = fwd.x * to.z - fwd.z * to.x; const ang = Math.atan2(cross, fwd.dot(to));
      cin.s = { accelerate: dist > 9 ? 0.75 : 0, brake: dist < 7 ? 1 : 0, steerLeft: Math.max(0, Math.min(1, -ang * 1.5)), steerRight: Math.max(0, Math.min(1, ang * 1.5)) };
      v.drive(cin); v.update(dt);
      cruiser.minDist = Math.min(cruiser.minDist ?? 1e9, dist);
      if (wanted.level === 0) { app.scene.remove(cruiser.rig); v.dispose?.(); cruiser = null; }
    }
    GF.separateActors(game.driving ? units : [player, ...units]);
    hud.update();
  };
  game.cruiser = () => cruiser;
} };

// ------------------------------------------------------------------ mission glue (story objectives in game code)
const mission = { install(game) {
  const { app, player, quests } = game;
  // place the story cast where the story's locations are in this district
  const place = (id, p, faceYaw) => { const n = game.npcs[id]; if (!n) return; (n.ctrl?.teleport ? n.ctrl.teleport(p) : n.position.copy(p)); if (n.ctrl && faceYaw != null) n.ctrl.facing = faceYaw; n.home = p.clone(); };
  place('lu', PLACES.taqueria, -Math.PI / 2); place('ruiz', PLACES.halfmoon, Math.PI);
  player.ctrl.teleport(PLACES.spawn.clone()); player.ctrl.facing = -0.3; game.shooter.rig.yaw = -0.3 + Math.PI;
  // set dressing for the two story locations
  const garage = buildGarage(K, { seed: 3 }); garage.rotation.y = Math.PI; garage.position.set(112, game.groundAt(112, 88), 88.5);
  garage.traverse((o) => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; } }); app.scene.add(garage);
  app.physics.addStatic({ type: 'box', x: 112, y: 2.3, z: 88.5, hx: 4.05, hy: 2.3, hz: 3.5 });
  for (const [x, z] of [[10.4, -32.5], [10.4, -39.5]]) { const b = GF.PROPS.bench?.({}); if (b) { b.position.set(x, 0.18, z); b.rotation.y = -Math.PI / 2; app.scene.add(b); } }
  for (const [x, z] of [[106.5, 82.6], [117.5, 82.6]]) { const b = GF.PROPS.barrel?.({}); if (b) { b.position.set(x, 0.18, z); app.scene.add(b); } }
  const cone = GF.PROPS.trafficCone?.({}); if (cone) { cone.position.set(108.5, 0.02, 75); app.scene.add(cone); }

  let heatSeen = false, reached = false;
  const state = { stolenCoupe: false, heatLost: false, reachedHalfmoon: false };
  app.events.on('car:stolen', (e) => { if (e === game.coupe) { state.stolenCoupe = true; quests.report('custom', 'steal_car'); } });
  game.updateMission = () => {
    const w = game.wanted;
    if (state.stolenCoupe && w.level > 0) heatSeen = true;
    if (heatSeen && !state.heatLost && w.level === 0) { state.heatLost = true; quests.report('custom', 'lose_heat'); app.ui.toast('Heat lost', { ms: 1500 }); }
    const d = game.driving;
    if (!reached && state.heatLost && d === game.coupe && d.v.position.distanceTo(PLACES.halfmoonCurb) < 14) { reached = true; state.reachedHalfmoon = true; quests.report('reach', 'halfmoon'); }
  };
  game.missionState = state;
} };

// ------------------------------------------------------------------ integration: per-frame order, debug state, cheats
const integration = { install(game) {
  const { app, player } = game;
  game.onUpdate = (dt) => {
    game.updateVehicles(dt);
    game.updateCrowd(dt);
    game.updatePolice(dt);
    game.updateMission(dt);
  };
  const r1 = (x) => +x.toFixed(1);
  const baseDebug = app.debugState;
  app.debugState = () => {
    const base = baseDebug ? baseDebug() : {};
    const c = game.cruiser();
    return {
      ...base,
      shooter: game.shooter.debug(),
      driving: game.driving ? game.driving.name : null,
      car: game.driving ? { kmh: r1(game.driving.v.kmh), x: r1(game.driving.v.position.x), z: r1(game.driving.v.position.z) } : null,
      coupe: { x: r1(game.coupe.v.position.x), z: r1(game.coupe.v.position.z), stolen: game.coupe.stolen },
      crowd: game.crowdReady ? game.crowd.info() : null, crimes: game.crimeLog,
      wanted: game.wanted.debug(), policeOnFoot: game.police.length,
      cruiser: c ? { dist: r1(c.v.position.distanceTo(game.driving ? game.driving.v.position : player.position)), minDist: r1(c.minDist ?? 1e9), kmh: r1(c.v.kmh) } : null,
      mission: game.missionState,
      traffic: game.traffic ? game.traffic.cars.length : 0,
    };
  };
  const aimAt = (p) => { const r = game.shooter.rig; for (let k = 0; k < 4; k++) { const cam = app.camera.position, d = p.clone().sub(cam).normalize(); r.yaw = Math.atan2(-d.x, -d.z); r.pitch = Math.min(r.maxPitch, Math.max(r.minPitch, -Math.asin(d.y))); window.__GF.step(4); } };
  const cheat = window.__GF.cheat || (window.__GF.cheat = {});
  Object.assign(cheat, {
    goTo: (x, z, yaw) => { if (game.driving) game.exitCar(); player.ctrl.teleport(V(x, z, 0.3)); if (yaw != null) { player.ctrl.facing = yaw; game.shooter.rig.yaw = yaw + Math.PI; } },
    goPlace: (id) => { const p = PLACES[id]; cheat.goTo(p.x, p.z); },
    nearNpc: (id, off = 2.2) => { const n = game.npcs[id]; cheat.goTo(n.position.x, n.position.z - off, 0); },
    nearCoupe: () => { const p = game.coupe.v.position; cheat.goTo(p.x + 2.4, p.z - 1.5, -1.0); },
    faceCoupe: () => { const p = game.coupe.v.position; aimAt(p.clone().setY(1)); },
    carTo: (x, z, yaw = 0) => { const d = game.driving; if (d) d.v.resetOnRoad(V(x, z), yaw); },
    aimAtPoint: (x, y, z) => aimAt(new THREE.Vector3(x, y, z)),
    god: () => { player.health.max = player.health.value = 1e6; },
  });
  window.__game = game; window.__GF.crowd = game.crowd; window.__GF.wanted = game.wanted;
} };

export const ready = Humans.loadHumanData().then((data) => composeGame(SPEC, {
  modules: [combat, vehicles, streets, police, mission, integration],
  humans: { H: Humans, data },
}));
