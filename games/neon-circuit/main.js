// Neon Circuit — driving demo built with GameForge.
// Street race through a procedural downtown at dusk: checkpoints, traffic, drifting, boost.
import * as GF from '../../engine/index.js';
import { TrafficSystem } from '../../engine/world/city.js';
const { THREE } = GF;

const app = new GF.GameApp({ id: 'neon-circuit', title: 'Neon Circuit', container: document.getElementById('game'), timeOfDay: 17.85, fov: 62,
  theme: { accent: '#3ae0ff', accent2: '#ff3a9a' }, atmosphere: { turbidity: 3, rayleigh: 2.2, fogDensity: 0.0022, shadowRange: 70, exposure: 1.15 }, touchButtons: [['handbrake', 'HB'], ['boost', 'N2O']] });
const loader = app.ui.loading('Paving the streets…');
const rng = new GF.RNG(21);

// ---------- City ----------
const city = GF.generateCity({ seed: 21, blocks: 5, blockSize: 56, roadWidth: 14, style: 'neon', maxFloors: 26 });
app.scene.add(city.group);
for (const c of city.colliders) app.physics.addStatic(c, c.userData);
// knock-able street props as dynamic bodies
const bodies = [];
for (const p of city.dynamicProps) {
  app.scene.add(p);
  p.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  const r = p.userData.kind === 'barrel' ? 0.45 : 0.3;
  const b = app.physics.addBody({ object: p, position: p.position.clone().setY(p.position.y + r), radius: r, mass: p.userData.kind === 'barrel' ? 30 : 6, restitution: 0.3, userData: { centerOffset: r } });
  b.userData.onHit = () => { if (!b.userData.hitOnce) { b.userData.hitOnce = true; app.audio.play('crash', { pos: b.position, volume: 0.4, pitch: 1.6 }); score += 25; } };
  bodies.push(b);
}
loader.set(0.4, 'Tuning engines…');

// ---------- Player car ----------
const rig = GF.car({ type: 'sports', color: 0x16c8ff, seed: 4 });
app.scene.add(rig);
const headL = new THREE.SpotLight(0xfff2d8, 60, 60, 0.5, 0.5, 1.5); headL.position.set(0, 0.8, 2.2); headL.target.position.set(0, 0, 14); rig.add(headL, headL.target);
const start = { x: city.roadCenters[2] + city.roadWidth / 4, z: city.roadCenters[0] + 18, yaw: 0 };
const car = new GF.Vehicle(app.physics, rig, { position: new THREE.Vector3(start.x, 0.1, start.z), yaw: start.yaw, enginePower: 24, maxSpeed: 58 });
const chase = new GF.ChaseCamera(app.camera, app.physics, { distance: 7, height: 2.3 });
app.cameraRigs = [chase];
const traffic = new TrafficSystem(app.scene, city, { count: app.gfx.tier.name === 'low' ? 8 : 16, seed: 9, speed: 10 });
let engineSnd = null;
app.events.on('audio:unlocked', () => { if (!engineSnd) engineSnd = app.audio.engine({ base: 36 }); });

// ---------- Race route: loop of intersections ----------
const rc = city.roadCenters;
const routeIdx = [[2, 0], [4, 0], [4, 2], [3, 3], [3, 5], [1, 5], [1, 3], [0, 2], [0, 0], [2, 0]];
const route = routeIdx.map(([i, j]) => new THREE.Vector3(rc[i], 0, rc[j]));
// insert mid points so gates sit on straights
const gates = [];
for (let k = 1; k < route.length; k++) {
  const a = route[k - 1], b = route[k];
  const steps = Math.max(1, Math.round(a.distanceTo(b) / 70));
  for (let s = 1; s <= steps; s++) gates.push(a.clone().lerp(b, s / steps));
}
const gateMat = new THREE.MeshBasicMaterial({ color: 0xff3a9a, transparent: true, opacity: 0.85, side: THREE.DoubleSide });
const gateNext = new THREE.MeshBasicMaterial({ color: 0x3ae0ff, transparent: true, opacity: 0.95, side: THREE.DoubleSide });
const gateObjs = gates.map((g, i) => {
  const grp = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.TorusGeometry(6.5, 0.18, 8, 48, Math.PI), gateMat); grp.add(ring);
  for (const s of [-1, 1]) { const post = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.6, 8), gateMat); post.position.set(s * 6.5, 0.3, 0); grp.add(post); }
  const prev = i === 0 ? route[0] : gates[i - 1];
  grp.position.copy(g); grp.lookAt(prev.x, 0, prev.z);
  app.scene.add(grp); return grp;
});
loader.set(0.7, 'Lighting the skyline…');

// ---------- HUD ----------
const speedo = app.ui.speedometer('br');
const timeC = app.ui.counter('time', { icon: '⏱', label: 'Time', corner: 'tr', value: '0:00.0' });
const lapC = app.ui.counter('cp', { icon: '◎', label: 'Checkpoint', corner: 'tr', value: `0/${gates.length}` });
const bestC = app.ui.counter('best', { icon: '★', label: 'Best', corner: 'tr', value: '--' });
const scoreC = app.ui.counter('score', { icon: '◆', label: 'Style', corner: 'tl', value: '0' });
const dmgBar = app.ui.bar('damage', { label: 'Car integrity', color: 'linear-gradient(90deg,#3ae0ff,#7affd0)', corner: 'tl' });
const minimap = app.ui.minimap({ corner: 'bl', range: 120 });
const compass = app.ui.compass();
const CONTROLS = [['Throttle', 'W / ↑ / RT'], ['Brake / reverse', 'S / ↓ / LT'], ['Steer', 'A D / ← →'], ['Handbrake (drift)', 'Space'], ['Nitro boost', 'Shift'], ['Horn', 'H'], ['Look back', 'B (hold)'], ['Reset car', 'R'], ['Pause', 'Esc / P']];
app.input.bind('lookBack', ['KeyB']);

// ---------- Game state ----------
let mode = 'race', raceTime = 0, nextGate = 0, best = null, score = 0, countdown = 0, driftCombo = 0, finished = false, crashes = 0;
app.save.register('race', { save: () => ({ best }), load: (d) => { best = d.best ?? null; } });
app.save.load('race');
const fmt = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
if (best) bestC.set(fmt(best));

function resetRace() {
  car.resetOnRoad(new THREE.Vector3(start.x, 0.1, start.z), start.yaw); car.damage = 0; car.boostFuel = 1; car.distance = 0; car.topSpeed = 0;
  raceTime = 0; nextGate = 0; score = 0; finished = false; crashes = 0; countdown = 3.2; driftCombo = 0;
  chase.init = false;
  app.setState('playing'); app.audio.playMusic('driving', { intensity: 0.5 });
}
function finish() {
  finished = true; app.setState('gameover');
  const newBest = best === null || raceTime < best; if (newBest) { best = raceTime; app.save.save('race'); bestC.set(fmt(best)); }
  app.audio.play('questComplete'); app.vfx.emit('confetti', car.position.clone().setY(2), { count: 120 });
  app.after(1.5, () => app.ui.endScreen({ victory: true, title: newBest ? 'New Record!' : 'Finish!', text: 'Circuit complete.', stats: { Time: fmt(raceTime), Best: fmt(best), 'Style points': score, 'Top speed': Math.round(car.topSpeed) + ' km/h', Crashes: crashes }, onRetry: resetRace, onQuit: showTitle }));
}
function showTitle() {
  app.setState('menu');
  app.ui.mainMenu({ subtitle: 'A GameForge driving demo. Race through the downtown circuit at dusk — hit every checkpoint, drift for style, dodge traffic.', onStart: resetRace, controls: CONTROLS, credits: 'Procedural city, cars, physics, traffic AI and synthesized engine audio by GameForge AAA.' });
}

car.onCollision = (impact, hit) => {
  if (impact > 3) { app.audio.play('crash', { volume: Math.min(1, impact / 20), pos: car.position }); app.shake(Math.min(0.8, impact / 25)); app.vfx.emit('sparks', car.position.clone().add(new THREE.Vector3(hit.nx * -1.2, 0.6, hit.nz * -1.2)), { count: Math.min(40, impact * 2) }); }
  if (impact > 8) { crashes++; driftCombo = 0; }
};

app.add((dt) => {
  if (app.input.pressed('pause')) { app.setState('paused'); app.ui.pauseMenu({ onResume: () => app.setState('playing'), onRestart: resetRace, onQuit: showTitle, controls: CONTROLS }); return; }
  if (countdown > 0) {
    const before = Math.ceil(countdown); countdown -= dt; const after = Math.ceil(countdown);
    if (after !== before && after > 0) { app.ui.toast(String(after), { big: true, ms: 900 }); app.audio.play('countdown'); }
    if (countdown <= 0) { app.ui.toast('GO!', { big: true, ms: 900 }); app.audio.play('go'); }
    car.setInput({}); car.update(dt);
  } else {
    car.drive(app.input);
    if (app.input.pressed('reload')) { const back = car.position.clone(); car.resetOnRoad(new THREE.Vector3(back.x, 0.5, back.z), car.yaw); }
    if (app.input.pressed('horn')) app.audio.play('horn', { pos: car.position });
    car.update(dt);
    raceTime += dt;
  }
  traffic.update(dt, [car]);
  traffic.collide(car, (imp) => { if (imp > 3) { app.audio.play('crash', { pos: car.position, volume: 0.7 }); app.shake(0.5); crashes++; } });
  chase.lookBack = app.input.held('lookBack');
  chase.update(dt, car);
  app.audio.setListener(car.position.x, car.position.y, car.position.z, car.yaw);
  app.atmosphere.setFocus(car.position);
  // engine + effects
  engineSnd?.set(car.rpm, car.throttle);
  if (car.drifting > 0.3 && car.grounded) {
    driftCombo += dt * car.drifting * Math.abs(car.speed) * 0.6;
    for (const w of car.wheels.slice(2)) app.vfx.emit('tireSmoke', new THREE.Vector3(w.wx, 0.3, w.wz), { count: 1 });
    if (rng.chance(0.08)) app.audio.play('screech', { volume: 0.4 });
  } else if (driftCombo > 0) { if (driftCombo > 20) { score += Math.round(driftCombo); app.ui.toast(`Drift +${Math.round(driftCombo)}`, { ms: 1400 }); } driftCombo = 0; }
  if (car.boosting) app.vfx.emit('fire', car.position.clone().add(car.forward.clone().multiplyScalar(-2.4)).setY(car.position.y + 0.45), { count: 2, scale: 0.8 });
  // checkpoints
  if (!finished && nextGate < gates.length && countdown <= 0) {
    const g = gates[nextGate];
    if (Math.hypot(car.position.x - g.x, car.position.z - g.z) < 8) {
      nextGate++; app.audio.play('checkpoint'); app.vfx.emit('magic', g.clone().setY(3), { count: 40, scale: 2 });
      if (nextGate >= gates.length) finish(); else app.ui.toast(`Checkpoint ${nextGate}/${gates.length}`, { ms: 1200, sub: fmt(raceTime) });
    }
  }
  gateObjs.forEach((o, i) => { o.visible = i >= nextGate; o.children.forEach((m) => (m.material = i === nextGate ? gateNext : gateMat)); if (i === nextGate) o.rotation.z = Math.sin(app.loop.time * 3) * 0.03; });
  // HUD
  speedo.set(car.kmh, car.speed < -0.5 ? 'R' : car.gear, car.boostFuel);
  timeC.set(fmt(raceTime)); lapC.set(`${nextGate}/${gates.length}`); scoreC.set(score); dmgBar.set(1 - car.damage);
  const g = gates[Math.min(nextGate, gates.length - 1)];
  compass.set(((car.yaw * 180) / Math.PI + 360) % 360, [{ angle: ((Math.atan2(g.x - car.position.x, g.z - car.position.z) * 180) / Math.PI + 360) % 360, color: '#3ae0ff' }]);
  minimap.draw({ center: car.position, yaw: car.yaw + Math.PI, background: (ctx, toMap, k) => {
    ctx.strokeStyle = 'rgba(160,180,210,.35)'; ctx.lineWidth = city.roadWidth * k;
    for (const c of rc) { let [x1, y1] = toMap(c, -city.extent); let [x2, y2] = toMap(c, city.extent); ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); [x1, y1] = toMap(-city.extent, c); [x2, y2] = toMap(city.extent, c); ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }
  }, markers: [...traffic.cars.map((c) => ({ x: c.position.x, z: c.position.z, color: '#ffd04a', size: 3 })), { x: g.x, z: g.z, color: '#3ae0ff', size: 8, shape: 'diamond', clamp: true }] });
}, { order: 0 });
app.add((dt) => { traffic.update(dt, []); const t = app.loop.time * 0.04; app.camera.position.set(Math.sin(t) * 140, 60, Math.cos(t) * 140); app.camera.lookAt(0, 10, 0); }, { states: ['menu'] });

app.debugState = () => ({ car: { x: +car.position.x.toFixed(2), z: +car.position.z.toFixed(2), y: +car.position.y.toFixed(2), kmh: Math.round(car.kmh), yaw: +car.yaw.toFixed(3), gear: car.gear, grounded: car.grounded, damage: +car.damage.toFixed(3), boost: +car.boostFuel.toFixed(2), drifting: +car.drifting.toFixed(2), distance: Math.round(car.distance) },
  race: { nextGate, gates: gates.length, time: +raceTime.toFixed(2), finished, countdown: +countdown.toFixed(2) }, score, crashes, traffic: traffic.cars.length, trafficMoving: traffic.cars.filter((c) => c.cur > 1).length, propsKnocked: bodies.filter((b) => b.userData.hitOnce).length });
window.__GF.startGame = () => { app.ui.closeMenu(); resetRace(); };
window.__GF.cheat = {
  // teleport the car just before the next gate, facing it
  toNextGate: () => { const g = gates[nextGate]; const prev = nextGate === 0 ? route[0] : gates[nextGate - 1]; const dir = g.clone().sub(prev).normalize(); car.resetOnRoad(g.clone().addScaledVector(dir, -12).setY(0.2), Math.atan2(dir.x, dir.z)); },
  aimAt: (x, z) => { car.yaw = Math.atan2(x - car.position.x, z - car.position.z); },
  teleport: (x, z, yaw = 0) => car.resetOnRoad(new THREE.Vector3(x, 0.3, z), yaw),
};
loader.set(1); setTimeout(() => loader.done(), 300);
showTitle();
app.start();
