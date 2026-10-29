import test from 'node:test';
import assert from 'node:assert/strict';
import { decodePNG, encodePNG, compareImages } from '../../tools/visual-diff.mjs';

const img = (w, h, f) => { const d = new Uint8Array(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d.set([...f(x, y), 255], (y * w + x) * 4); return { width: w, height: h, data: d }; };

test('visual-diff: PNG round trip, identical images pass, a moved square is detected and localized', () => {
  const a = img(64, 48, (x, y) => [x * 4, y * 5, 128]);
  const back = decodePNG(encodePNG(a));
  assert.equal(back.width, 64); assert.deepEqual([...back.data.slice(0, 8)], [...a.data.slice(0, 8)]);
  assert.equal(compareImages(a, back).changed, 0);
  const sq = (ox) => img(64, 48, (x, y) => (x >= ox && x < ox + 12 && y >= 18 && y < 30 ? [250, 250, 250] : [20, 20, 20]));
  const r = compareImages(sq(10), sq(30));
  assert.ok(r.changed > 0.05 && r.changed < 0.2, `changed ${r.changed}`);
  const i = (24 * 64 + 5) * 4; assert.notEqual(r.diff.data[i], 255); // far from both squares → not flagged
  assert.ok(compareImages(sq(10), img(32, 32, () => [0, 0, 0])).sizeMismatch);
  // 1-level noise is ignored by the tolerance
  const n = img(64, 48, (x, y) => [x * 4 + ((x + y) % 2), y * 5, 128]); assert.equal(compareImages(a, n).changed, 0);
});
