import test from 'node:test';
import assert from 'node:assert/strict';
import { RNG, Noise, hashString } from '../../engine/core/rng.js';
import { EventBus } from '../../engine/core/events.js';
import { GameLoop } from '../../engine/core/loop.js';
import { SaveSystem } from '../../engine/core/save.js';
import { Input } from '../../engine/core/input.js';

test('RNG is deterministic per seed and in range', () => {
  const a = new RNG(42), b = new RNG(42), c = new RNG(43);
  const sa = Array.from({ length: 100 }, () => a.next()), sb = Array.from({ length: 100 }, () => b.next());
  assert.deepEqual(sa, sb);
  assert.notDeepEqual(sa, Array.from({ length: 100 }, () => c.next()));
  for (const v of sa) assert.ok(v >= 0 && v < 1);
  const r = new RNG('seed'); for (let i = 0; i < 200; i++) { const n = r.int(3, 7); assert.ok(n >= 3 && n <= 7 && Number.isInteger(n)); }
  assert.equal(hashString('abc'), hashString('abc'));
});
test('Noise is deterministic, bounded and continuous', () => {
  const n = new Noise(1), m = new Noise(1);
  let max = 0;
  for (let i = 0; i < 500; i++) { const x = i * 0.137, y = i * 0.071; const v = n.noise2(x, y); assert.equal(v, m.noise2(x, y)); max = Math.max(max, Math.abs(v)); assert.ok(Math.abs(v) <= 1.0001); }
  assert.ok(max > 0.3, 'noise has amplitude');
  assert.ok(Math.abs(n.noise2(1, 1) - n.noise2(1.001, 1)) < 0.02, 'continuous');
  assert.ok(Math.abs(n.fbm2(0.3, 0.7)) <= 1);
});
test('EventBus on/once/off/wildcard', () => {
  const e = new EventBus(); let a = 0, b = 0, w = 0;
  const off = e.on('x', () => a++); e.once('x', () => b++); e.on('*', () => w++);
  e.emit('x'); e.emit('x'); off(); e.emit('x');
  assert.equal(a, 2); assert.equal(b, 1); assert.equal(w, 3); assert.equal(e.count('x'), 3);
});
test('GameLoop fixed steps, time scale and hit-stop', () => {
  const l = new GameLoop(); let steps = 0, t = 0;
  l.add((dt) => { steps++; t += dt; });
  l.advance(60); assert.equal(steps, 60); assert.ok(Math.abs(t - 1) < 1e-9);
  l.timeScale = 0.5; l.advance(60); assert.ok(Math.abs(t - 1.5) < 1e-9);
  l.timeScale = 1; l.hitStop = 0.1; const before = steps; l.advance(3); assert.equal(steps, before, 'frozen during hit-stop');
});
test('SaveSystem round-trips with providers and migrations (memory fallback)', () => {
  const s = new SaveSystem('t', { storage: null, version: 2 });
  let state = { hp: 5 };
  s.register('player', { save: () => ({ ...state }), load: (d) => { state = d; } });
  s.save('slot1'); state = { hp: 1 };
  assert.equal(s.has('slot1'), true); s.load('slot1'); assert.equal(state.hp, 5);
  s.memory.set('gameforge:t:old', JSON.stringify({ version: 1, data: { player: { health: 9 } } }));
  s.migrations[1] = (d) => ({ player: { hp: d.player.health } });
  s.load('old'); assert.equal(state.hp, 9);
  s.delete('slot1'); assert.equal(s.has('slot1'), false);
});
test('Input virtual actions, taps and move vector', () => {
  const i = new Input(null);
  i.setVirtual('moveForward', 1); i.setVirtual('moveRight', 1);
  const mv = i.moveVector(); assert.ok(Math.abs(Math.hypot(mv.x, mv.y) - 1) < 1e-9);
  i.tap('jump'); assert.equal(i.pressed('jump'), true); i.endFrame(); assert.equal(i.pressed('jump'), false);
  i.bind('jump', ['KeyK']); assert.equal(i.describe('jump'), 'K');
});
