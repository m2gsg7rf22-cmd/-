// Racing kit integration scene (not a game): a generated circuit with banking, curbs,
// barriers, start grid and checkpoints; five AI racers on the racing line with
// rubber-banding; the player's raycast vehicle; laps, splits, positions, wrong-way and
// respawn handled by RaceManager. Driven by playtest.json through window.__GF.
import * as GF from '../../../engine/index.js';
const { THREE } = GF;

const app = new GF.GameApp({ id: 'scene-race-track', title: 'Racing kit', container: document.getElementById('game'), timeOfDay: 16.2, fov: 62,
  atmosphere: { turbidity: 2.6, fogDensity: 0.0011, shadowRange: 70, exposure: 1.05 } });
const low = app.gfx.tier.name === 'low';

// ---- track
const track = GF.generateTrack({ seed: 5, width: 13, elevation: 5, checkpoints: 8 });
const line = GF.computeRacingLine(track);
app.scene.add(GF.trackMesh(track, { lowDetail: low }));
GF.addTrackPhysics(app.physics, track);
// scenery: trees and rocks outside the barriers (static colliders so cars cannot drive through)
const rng = new GF.RNG(9), b = track.bounds();
for (let i = 0, placed = 0; i < 600 && placed < (low ? 45 : 90); i++) {
  const x = rng.range(b.x0 - 50, b.x1 + 50), z = rng.range(b.z0 - 50, b.z1 + 50), pr = track.project(x, z);
  if (pr.distance < pr.frame.halfWidth + track.runoff + 7) continue;
  const t = rng.chance(0.8) ? GF.PROPS.tree({ species: rng.pick(['oak', 'pine', 'pine']), seed: i }) : GF.PROPS.rock({ seed: i, size: rng.range(0.8, 2) });
  t.scale.setScalar(rng.range(0.85, 1.25)); t.position.set(x, track.heightAt(x, z) - 0.2, z); t.rotation.y = rng.range(0, 6.28); app.scene.add(t); app.physics.addFromObject(t); placed++;
}

// ---- cars: five AI (low detail) + the player
const race = new GF.RaceManager(track, { laps: 3, countdown: 3 });
const palette = [0xe63946, 0xf4a261, 0x2a9d8f, 0x8e44ad, 0xf1c40f];
const types = ['sports', 'sedan', 'sports', 'suv', 'sedan'];
const cars = [];
for (let i = 0; i < 5; i++) {
  const rig = GF.car({ type: types[i], color: palette[i], seed: 20 + i, detail: 'low' }); app.scene.add(rig);
  const v = new GF.Vehicle(app.physics, rig, { enginePower: 24, maxSpeed: 56 }); cars.push(v);
  race.add(v, { name: ['Rossa', 'Arancio', 'Verde', 'Viola', 'Giallo'][i], ai: new GF.RaceAI(v, track, line, { skill: 0.9 + i * 0.02, laneOffset: (i % 3 - 1) * 1.3 }) });
}
const prig = GF.car({ type: 'sports', color: 0x1e88ff, seed: 4 }); app.scene.add(prig);
const car = new GF.Vehicle(app.physics, prig, { enginePower: 26, maxSpeed: 60 }); cars.push(car);
const me = race.add(car, { name: 'You', isPlayer: true });
for (const v of cars) v.rig.traverse((o) => { if (o.isMesh) o.castShadow = true; });
race.placeOnGrid(); race.start();
const chase = new GF.ChaseCamera(app.camera, app.physics, { distance: 7.5, height: 2.6 }); app.cameraRigs = [chase]; chase.yaw = car.yaw;

// ---- HUD
const posW = app.ui.counter('pos', { icon: '🏁', label: 'Pos', corner: 'tr', value: '-' });
const lapW = app.ui.counter('lap', { icon: '⟳', label: 'Lap', corner: 'tr', value: '1/3' });
const timeW = app.ui.counter('time', { icon: '⏱', label: '', corner: 'tl', value: '0:00.000' });
const speedW = app.ui.speedometer('br');
race.onCountdown = (n) => { app.ui.toast(String(n), { big: true, ms: 700 }); app.audio.play('countdown'); };
race.onStart = () => { app.ui.toast('GO!', { big: true, ms: 900 }); app.audio.play('go'); };
race.onCheckpoint = (e, k, split) => { if (e.isPlayer && k > 0) app.ui.toast(`Split ${k}: ${GF.formatTime(split)}`, { ms: 1200 }); if (e.isPlayer) app.audio.play('checkpoint', { volume: 0.5 }); };
race.onLap = (e, t) => { if (e.isPlayer) app.ui.toast(`Lap ${GF.formatTime(t)}`, { sub: `best ${GF.formatTime(e.bestLap)}` }); };
race.onWrongWay = (e, on) => { if (e.isPlayer) app.ui.toast(on ? 'WRONG WAY' : '', { big: true, ms: on ? 1500 : 1 }); };

// ---- optional pilot for the player car: a RaceAI whose output is fed back through the Input
// system (so the playtest exercises the real player input path)
const pilotAI = new GF.RaceAI(car, track, line, { skill: 0.95, rubberBand: null });
let assist = false, pilot = false;
let positionChanges = 0; const lastPos = new Map();
app.add((dt) => {
  const racing = race.state === 'racing';
  if (racing) for (const e of race.entrants) if (e.ai) e.ai.update(dt, cars);
  if (pilot || assist) {
    pilotAI.update(dt, cars);
    const inp = app.input;
    inp.setVirtual('steerLeft', Math.max(0, car.steerTarget)); inp.setVirtual('steerRight', Math.max(0, -car.steerTarget));
    if (pilot) { inp.setVirtual('accelerate', car.throttle); inp.setVirtual('brake', car.brakeInput); }
  }
  car.drive(app.input);
  for (const v of cars) v.update(dt);
  race.update(dt);
  if (app.input.pressed('interact')) race.respawn(me, 'manual');
  for (const e of race.entrants) { if (lastPos.has(e) && lastPos.get(e) !== e.position) positionChanges++; lastPos.set(e, e.position); }
  chase.update(dt, car);
  app.atmosphere.setFocus(car.position);
  posW.set(`${me.position}/${race.entrants.length}`); lapW.set(`${Math.min(race.laps, me.lap + 1)}/${race.laps}`); timeW.set(GF.formatTime(race.raceTime));
  speedW.set(car.kmh, car.gear, car.boostFuel);
}, { order: 0 });

app.debugState = () => ({ ...race.debugState(), car: { x: +car.position.x.toFixed(2), z: +car.position.z.toFixed(2), kmh: +car.kmh.toFixed(1), grounded: car.grounded, yaw: +car.yaw.toFixed(3) }, positionChanges, trackLength: +track.length.toFixed(1), checkpoints: track.checkpoints.length, lineOk: line.withinBounds() });
window.__GF.scene = {
  assist: (on = true) => { assist = on; if (!on) { app.input.setVirtual('steerLeft', 0); app.input.setVirtual('steerRight', 0); } },
  pilot: (on = true) => { pilot = on; assist = false; if (!on) app.input.clearVirtual(); },
  // face the player car against the direction of travel
  reverse: () => { const pose = track.pose(me.s, 0); car.resetOnRoad(pose.position, pose.yaw + Math.PI); },
  respawn: () => race.respawn(me, 'manual'),
};
window.__GF.startGame = () => {};
app.setState('playing');
app.start();
