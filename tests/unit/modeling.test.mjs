import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { K } from '../../engine/modeling/index.js';
import { reviewModel } from '../../tools/model.mjs';

test('SDF primitives: signs and distances', () => {
  assert.ok(Math.abs(K.sphere([0, 0, 0], 1)(2, 0, 0) - 1) < 1e-9);
  assert.ok(K.box([0, 0, 0], [1, 1, 1])(0, 0, 0) < 0);
  assert.ok(K.capsule([0, 0, 0], [0, 2, 0], 0.5)(0, 1, 0) < 0);
  const cutF = K.cut(K.sphere([0, 0, 0], 1), [0, 1, 0], 0, 0.001);
  assert.ok(cutF(0, 0.5, 0) < 0, 'keeps the side the normal points to');
  assert.ok(cutF(0, -0.5, 0) > 0, 'removes the side behind the normal');
});

test('meshSDF produces a closed, finite sphere of the right size', () => {
  const g = K.meshSDF(K.sphere([0, 0, 0], 1), { bounds: [[-1.3, -1.3, -1.3], [1.3, 1.3, 1.3]], resolution: 32 });
  g.computeBoundingBox(); const s = g.boundingBox.max.x - g.boundingBox.min.x;
  assert.ok(s > 1.85 && s < 2.05, 'diameter ' + s);
  for (const v of g.attributes.position.array) assert.ok(Number.isFinite(v));
  const e = new Map(), P = g.attributes.position, I = g.index.array, key = (i) => `${P.getX(i).toFixed(5)},${P.getY(i).toFixed(5)},${P.getZ(i).toFixed(5)}`;
  for (let t = 0; t < I.length; t += 3) for (const [a, b] of [[I[t], I[t + 1]], [I[t + 1], I[t + 2]], [I[t + 2], I[t]]]) { const k = [key(a), key(b)].sort().join('|'); e.set(k, (e.get(k) || 0) + 1); }
  assert.equal([...e.values()].filter((c) => c === 1).length, 0, 'watertight');
});

test('L-system + turtle + skinning build a branching structure', () => {
  const s = K.lsystem({ axiom: 'FA', rules: { A: 'F[&FA]/////[&FA]' }, iterations: 4 });
  const t = K.turtle(s, { step: 1, angle: 30, radius: 0.1 });
  assert.ok(t.branches.length > 10 && t.tips.length > 10);
  const g = K.skinBranches(t.branches, { radial: 5 });
  assert.ok(g.index.count / 3 > 100);
});

test('space colonization fills an attractor volume', () => {
  const at = K.sampleVolume((x, y, z) => x * x + (y - 3) ** 2 + z * z < 1, [[-1, 2, -1], [1, 4, 1]], 200, 3);
  assert.equal(at.length, 200);
  const sc = K.spaceColonization({ attractors: at, trunk: 1.5, step: 0.15 });
  assert.ok(sc.branches.length > 5 && sc.tips.length > 3);
});

test('paint() rasterises alpha textures; cards() builds quads', () => {
  const tex = K.cardTexture('leafSpray');
  const a = tex.image.data; let opaque = 0; for (let i = 3; i < a.length; i += 4) if (a[i]) opaque++;
  assert.ok(opaque > 1000 && opaque < a.length / 4, 'partially transparent');
  const g = K.cards([{ pos: K.V(), dir: K.V(0, 1, 0), side: K.V(1, 0, 0), w: 1, h: 1 }]);
  assert.equal(g.index.count, 6);
});

test('every example model script builds and passes review checks (no render)', async () => {
  const dir = new URL('../../skills/gameforge/models/', import.meta.url);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.model.js'));
  assert.ok(files.length >= 4);
  for (const f of files) {
    const m = await reviewModel(new URL(f, dir).pathname, { render: false, quiet: true, out: fs.mkdtempSync('/tmp/gfm-') });
    assert.ok(m.ok, f + ': ' + JSON.stringify(m.checks.filter((c) => !c.pass)));
    assert.ok(m.triangles > 300, f + ' too simple');
  }
});

test('anim review: good example passes, broken example is caught', async () => {
  const { reviewAnim } = await import('../../tools/anim.mjs');
  const dir = new URL('../../skills/gameforge/anims/', import.meta.url).pathname, out = fs.mkdtempSync('/tmp/gfa-');
  const good = await reviewAnim(dir + 'wave.anim.js', { render: false, quiet: true, out });
  assert.ok(good.ok, JSON.stringify(good.checks.filter((c) => !c.pass)));
  const bad = await reviewAnim(dir + 'bad-kick.anim.js', { render: false, quiet: true, out });
  const failed = bad.checks.filter((c) => !c.pass).map((c) => c.name).join('|');
  for (const w of ['sink', 'pops', 'knees', 'seamless']) assert.ok(failed.includes(w), 'expected failure: ' + w + ' in ' + failed);
});
