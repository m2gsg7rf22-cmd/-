import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../../engine/vendor/three/three.module.js';
import { Weather, WEATHER_STATES, Precipitation } from '../../engine/render/weather.js';
import { SHARED_UNIFORMS } from '../../engine/render/materials.js';
import { EventBus } from '../../engine/core/events.js';
import { SaveSystem } from '../../engine/core/save.js';
import { Needs } from '../../engine/gameplay/survival.js';
import { SFX_NAMES } from '../../engine/audio/audio.js';

const run = (w, s, dt = 0.1) => { for (let i = 0; i < s / dt; i++) w.update(dt); return w; };

test('weather: smooth transitions between states, instant set, events', () => {
  const events = new EventBus(); const seen = [];
  events.on('weather:change', (e) => seen.push(e.from + '>' + e.to));
  const w = new Weather({ seed: 3, events });
  assert.equal(w.state, 'clear'); assert.equal(w.params.rain, 0);
  w.set('rain', { transition: 10 });
  run(w, 5); assert.ok(w.params.rain > 0.2 && w.params.rain < 0.5, `halfway (${w.params.rain})`);
  run(w, 5.2); assert.ok(Math.abs(w.params.rain - WEATHER_STATES.rain.rain) < 1e-9, 'arrives at target');
  w.set('storm', { transition: 0 }); assert.equal(w.params.wind, WEATHER_STATES.storm.wind, 'instant set');
  assert.deepEqual(seen, ['clear>rain', 'rain>storm']);
  assert.throws(() => w.set('hail'));
  // monotonic blend: no overshoot
  const m = new Weather({ seed: 1 }); m.set('fog', { transition: 4 }); let prev = m.params.fog, mono = true;
  for (let i = 0; i < 50; i++) { m.update(0.1); if (m.params.fog < prev - 1e-9 || m.params.fog > WEATHER_STATES.fog.fog + 1e-9) mono = false; prev = m.params.fog; }
  assert.ok(mono);
});

test('weather: seeded forecast is deterministic, follows the transition table and drives auto mode', () => {
  const a = new Weather({ seed: 42, auto: true, durations: [60, 120] }), b = new Weather({ seed: 42, auto: true, durations: [60, 120] }), c = new Weather({ seed: 43, auto: true, durations: [60, 120] });
  const fa = a.forecast(12), fb = b.forecast(12), fc = c.forecast(12);
  assert.deepEqual(fa, fb, 'same seed, same forecast');
  assert.notDeepEqual(fa.map((e) => e.state + e.duration), fc.map((e) => e.state + e.duration), 'different seed differs');
  for (let i = 1; i < fa.length; i++) { assert.ok(a.transitions[fa[i - 1].state][fa[i].state] > 0, `${fa[i - 1].state}->${fa[i].state} allowed`); assert.equal(fa[i].start, fa[i - 1].start + fa[i - 1].duration); }
  run(a, fa[0].duration + fa[1].duration + 1, 0.5);
  assert.equal(a.state, fa[2].state, 'auto mode follows the forecast'); assert.equal(a.cursor, 2);
  run(b, fa[0].duration + fa[1].duration + 1, 0.25); assert.equal(b.state, a.state, 'independent of step size');
  a.set('snow'); assert.equal(a.auto, false, 'manual set pauses the forecast');
});

test('weather: wind vector, foliage uniform, cloth binding; wetness and snow cover; temperature by hour', () => {
  const cloth = { wind: new THREE.Vector3(), gust: 0 };
  let H = 15; const w = new Weather({ seed: 9, climate: { mean: 12, amplitude: 6, peakHour: 15 }, hour: () => H });
  w.bindCloth(cloth); run(w, 2);
  const calm = w.windSpeed; w.set('storm', { transition: 0 }); run(w, 2);
  assert.ok(w.windSpeed > calm * 2.5, `storm wind ${w.windSpeed.toFixed(1)} > calm ${calm.toFixed(1)}`);
  assert.ok(cloth.wind.distanceTo(w.wind) < 1e-9, 'bound cloth receives the wind');
  assert.ok(Math.hypot(SHARED_UNIFORMS.uWind.value.x, SHARED_UNIFORMS.uWind.value.y) > 1, 'foliage uniform follows the wind');
  run(w, 20); assert.ok(w.wetness > 0.9, 'surfaces soak in rain'); assert.ok(SHARED_UNIFORMS.uWet.value > 0.9);
  w.set('clear', { transition: 0 }); run(w, 30); const mid = w.wetness; run(w, 200); assert.ok(mid > 0.3 && w.wetness < mid && w.wetness < 0.1, 'and dry afterwards');
  assert.ok(Math.abs(w.temperatureAt(15) - 18) < 1e-9 && Math.abs(w.temperatureAt(3) - 6) < 1e-9, 'day/night temperature curve');
  H = 3; w.set('snow', { transition: 0 }); assert.ok(w.temperature < 0); run(w, 120); assert.ok(w.snowCover > 0.9, 'snow accumulates');
  H = 15; w.set('clear', { transition: 0 }); run(w, 300); assert.ok(w.snowCover < 0.6, 'and melts above freezing');
});

test('weather: lightning is seeded (Poisson), thunder is delayed by distance; shelter events; Needs integration', () => {
  const events = new EventBus(); const log = [];
  events.on('weather:lightning', (e) => log.push(['L', +e.distance.toFixed(1)])); events.on('weather:thunder', (e) => log.push(['T', +e.distance.toFixed(1)]));
  const shelter = []; events.on('weather:shelter', (e) => shelter.push(e.needed));
  const played = []; const audio = { ready: false, play: (n, o) => played.push([n, o.volume]) };
  const w = new Weather({ seed: 5, events, audio }); w.set('storm', { transition: 0 }); run(w, 120);
  const strikes = log.filter((x) => x[0] === 'L').length;
  assert.ok(strikes >= 10 && strikes <= 45, `${strikes} strikes in 2 min at 0.2/s`);
  assert.ok(played.length >= strikes - 3 && played.every((p) => p[0] === 'thunder'), 'thunder sfx played');
  const q = new Weather({ seed: 5 }); const s = q.strike({ distance: 686 }); assert.ok(Math.abs(s.delay - 2) < 1e-9, 'sound travels at 343 m/s');
  run(q, 1.9, 0.1); assert.equal(q.stats.thunders, 0, 'no thunder before 2 s'); run(q, 0.3, 0.1); assert.equal(q.stats.thunders, 1, 'thunder arrives 2 s after the flash');
  assert.ok(SFX_NAMES.includes('thunder'), 'thunder registered as an SFX preset');
  const again = new Weather({ seed: 5, events: new EventBus(), audio: { ready: false, play() {} } }); again.set('storm', { transition: 0 }); run(again, 120);
  assert.equal(again.stats.strikes, strikes, 'same seed, same strikes');
  assert.deepEqual(shelter, [true]); w.set('clear', { transition: 0 }); w.update(0.1); assert.deepEqual(shelter, [true, false]);
  // Needs: the same night is colder in a storm than when clear
  const n1 = new Needs(), n2 = new Needs(); const cold = new Weather({ seed: 1, hour: () => 2 }); const stormy = new Weather({ seed: 1, hour: () => 2 }); stormy.set('storm', { transition: 0 });
  for (let i = 0; i < 1200; i++) { cold.update(1); stormy.update(1); n1.update(1, { ambient: cold.temperature, wind: cold.windSpeed, rain: cold.rainIntensity }); n2.update(1, { ambient: stormy.temperature, wind: stormy.windSpeed, rain: stormy.rainIntensity }); }
  assert.ok(n2.bodyTemp < n1.bodyTemp - 0.5 && n2.wetness > 0.9, `storm chills (${n2.bodyTemp.toFixed(2)} vs ${n1.bodyTemp.toFixed(2)})`);
});

test('weather: rendering side (headless scene): precipitation budget, cloud dome, fog, wet materials; save/load', () => {
  const scene = new THREE.Scene(); scene.fog = new THREE.FogExp2(0xb8c8d8, 0.002);
  const camera = new THREE.PerspectiveCamera(); camera.position.set(5, 2, 5);
  const w = new Weather({ scene, camera, seed: 2, particles: { rain: 4000, snow: 2000 } });
  const mat = new THREE.MeshStandardMaterial({ color: 0x806040, roughness: 0.9 }); scene.add(new THREE.Mesh(new THREE.BoxGeometry(), mat));
  assert.equal(w.registerScene(scene), 1);
  w.set('rain', { transition: 0 }); run(w, 30);
  assert.equal(w.rain.visible, Math.floor(4000 * WEATHER_STATES.rain.rain), 'instance count follows intensity'); assert.equal(w.snow.visible, 0);
  assert.ok(scene.fog.density > 0.002 * 2, 'fog thickens'); assert.equal(w.dome.position.x, 5, 'cloud dome follows the camera');
  assert.ok(mat.color.r < 0x80 / 255 * 0.8 && mat.roughness < 0.5, 'wet look darkens and polishes');
  const save = new SaveSystem('weather-test', { storage: null }); save.register('weather', { save: () => w.toJSON(), load: (d) => w.load(d) }); save.save('s');
  w.set('clear', { transition: 0 }); run(w, 1);
  const w2 = new Weather({ scene: new THREE.Scene(), camera, seed: 2 }); save.register('weather', { save: () => w2.toJSON(), load: (d) => w2.load(d) }); save.load('s');
  assert.equal(w2.state, 'rain'); assert.ok(w2.wetness > 0.9); assert.equal(w2.rain.visible > 0, true);
  const p = new Precipitation({ kind: 'snow', count: 100 }); p.set(0.5, { time: 1, wind: new THREE.Vector3(1, 0, 0) }); assert.equal(p.visible, 50);
});
