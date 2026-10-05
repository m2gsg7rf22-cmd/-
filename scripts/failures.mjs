// Controlled failure tests: the game must degrade gracefully instead of crashing.
import { chromium } from 'playwright';
const URL_ = process.env.URL || 'http://localhost:4173/';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const results = [];
async function scenario(name, { init, viewport, mobile } = {}, fn) {
  const ctx = await browser.newContext({ viewport: viewport ?? { width: 1000, height: 640 }, isMobile: !!mobile, hasTouch: !!mobile });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  if (init) await page.addInitScript(init);
  try {
    const d = await fn(page, errors);
    const uncaught = errors.filter((e) => e.startsWith('pageerror'));
    if (uncaught.length) throw new Error(uncaught.join(' | '));
    results.push({ name, pass: true });
    console.log('PASS', name, d ? JSON.stringify(d) : '');
  } catch (e) {
    results.push({ name, pass: false });
    console.log('FAIL', name, e.message);
    await page.screenshot({ path: `qa-output/fail-${name.replace(/\W+/g, '_')}.png` }).catch(() => {});
  }
  await ctx.close();
}
const assert = (c, m) => { if (!c) throw new Error(m); };
async function createWorld(page, seed = 'fail-test') {
  await page.goto(URL_);
  await page.waitForSelector('[data-screen=menu]');
  await page.click('[data-act=new]');
  await page.fill('[name=seed]', seed);
  await page.click('[data-act=create]');
  await page.waitForFunction(() => window.__bf?.state === 'playing', null, { timeout: 90000 });
}

await scenario('IndexedDB unavailable → memory store + warning', { init: () => { Object.defineProperty(window, 'indexedDB', { value: undefined }); } }, async (page) => {
  await createWorld(page);
  const r = await page.evaluate(() => ({ persistent: window.__bf.app.store.persistent, toast: document.querySelector('.toast')?.textContent }));
  assert(!r.persistent, 'expected non-persistent store');
  assert(/not be saved/i.test(r.toast ?? ''), 'no warning toast');
  return r;
});

await scenario('localStorage throws → default settings, still boots', { init: () => { Object.defineProperty(window, 'localStorage', { get() { throw new Error('denied'); } }); } }, async (page) => {
  await createWorld(page);
});

await scenario('Web Workers fail → main-thread fallback generation', { init: () => { window.Worker = class { constructor() { throw new Error('workers disabled'); } }; } }, async (page) => {
  await createWorld(page);
  const s = await page.evaluate(() => window.__bf.app.game.world.stats());
  assert(s.fallback, 'fallback flag not set');
  assert(s.meshed > 5, 'no chunks meshed');
  return { meshed: s.meshed };
});

await scenario('Worker crashes mid-game → recovers on main thread', {}, async (page) => {
  await createWorld(page);
  await page.evaluate(() => {
    const pool = window.__bf.app.game.world['pool'];
    pool['workers'][0].onerror({ message: 'simulated crash', preventDefault() {} });
  });
  // Move far so new chunks must be generated.
  await page.evaluate(() => { const g = window.__bf.app.game; g.creative = g.player.creative = true; g.player.flying = true; g.player.setPosition(g.player.body.x + 200, 110, g.player.body.z); });
  await page.waitForFunction(() => { const g = window.__bf.app.game; const cx = Math.floor(g.player.body.x / 16), cz = Math.floor(g.player.body.z / 16); return g.world.isChunkMeshed(cx, cz); }, null, { timeout: 60000 });
  return await page.evaluate(() => window.__bf.app.game.world.stats());
});

await scenario('Audio unavailable → silent but playable', { init: () => { window.AudioContext = undefined; window.webkitAudioContext = undefined; } }, async (page) => {
  await createWorld(page);
  await page.keyboard.down('KeyW'); await page.waitForTimeout(500); await page.keyboard.up('KeyW');
});

await scenario('Pointer lock denied → drag-to-look fallback', {
  init: () => {
    HTMLCanvasElement.prototype.requestPointerLock = function () { setTimeout(() => document.dispatchEvent(new Event('pointerlockerror')), 0); return Promise.reject(new Error('denied')); };
  },
}, async (page) => {
  await createWorld(page);
  for (let i = 0; i < 3; i++) { await page.mouse.click(500, 320); await page.waitForTimeout(150); }
  const fb = await page.evaluate(() => window.__bf.app.input.useDragFallback);
  assert(fb, 'drag fallback not enabled');
  const a = await page.evaluate(() => window.__bf.app.game.player.yaw);
  await page.mouse.move(500, 320); await page.mouse.down(); await page.mouse.move(650, 320, { steps: 10 }); await page.mouse.up();
  await page.waitForTimeout(300);
  const b = await page.evaluate(() => window.__bf.app.game.player.yaw);
  assert(b < a - 0.05, `drag did not rotate (${a} → ${b})`);
  return { dyaw: (b - a).toFixed(3) };
});

await scenario('WebGL unavailable → friendly error, no crash', {
  init: () => {
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (t, ...a) { if (/webgl/.test(t)) return null; return orig.call(this, t, ...a); };
  },
}, async (page) => {
  await page.goto(URL_);
  await page.waitForSelector('[data-screen=error]', { timeout: 15000 });
  return { text: (await page.textContent('[data-screen=error] h2')) };
});

await scenario('Corrupted save data → skipped/regenerated, valid world loads', {}, async (page) => {
  await createWorld(page, 'corrupt');
  // Edit + save, then corrupt one chunk and inject a garbage world record.
  const key = await page.evaluate(async () => {
    const g = window.__bf.app.game; const b = g.player.body;
    g.world.setBlock(b.x + 2, b.y, b.z, 30);
    await g.save();
    return { id: g.meta.id, cx: Math.floor((b.x + 2) / 16), cz: Math.floor(b.z / 16) };
  });
  await page.evaluate(async ({ id, cx, cz }) => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open('blockforge', 1); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    await new Promise((res, rej) => {
      const tx = db.transaction(['worlds', 'chunks'], 'readwrite');
      tx.objectStore('chunks').put({ id: `${id}|${cx},${cz}`, world: id, key: `${cx},${cz}`, rle: new Uint8Array([9, 9, 9]) });
      tx.objectStore('worlds').put({ id: 'garbage', name: 42, seedNum: 'x' });
      tx.objectStore('worlds').put({ id: 'garbage2' });
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    });
  }, key);
  await page.reload();
  await page.waitForSelector('[data-screen=menu]');
  await page.click('[data-act=worlds]');
  await page.waitForSelector('[data-screen=worlds]');
  const n = await page.$$eval('.world-item', (e) => e.length);
  assert(n === 1, `expected 1 valid world listed, got ${n}`);
  await page.click('[data-act=playw]');
  await page.waitForFunction(() => window.__bf?.state === 'playing', null, { timeout: 90000 });
  const ok = await page.evaluate(({ cx, cz }) => window.__bf.app.game.world.isChunkLoaded(cx, cz), key);
  assert(ok, 'corrupted chunk was not regenerated');
  return { listed: n };
});

await scenario('Focus loss / tab hidden → pauses and saves (mobile)', { mobile: true, viewport: { width: 844, height: 390 } }, async (page) => {
  await createWorld(page);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.waitForTimeout(200);
  const s = await page.evaluate(() => window.__bf.state);
  assert(s === 'paused', `state ${s}`);
  await page.click('[data-act=resume]');
  assert((await page.evaluate(() => window.__bf.state)) === 'playing', 'resume failed');
});

await scenario('Rapid resize / fullscreen-like changes keep canvas consistent', {}, async (page) => {
  await createWorld(page);
  for (const [w, h] of [[400, 800], [1200, 500], [700, 700], [1600, 900], [1000, 640]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(400);
  const r = await page.evaluate(() => { const a = window.__bf.app.r; return { aspect: a.camera.aspect, w: innerWidth, h: innerHeight, bw: a.renderer.domElement.width, bh: a.renderer.domElement.height }; });
  assert(Math.abs(r.aspect - r.w / r.h) < 0.01, JSON.stringify(r));
  return r;
});

console.log(`${results.filter((r) => r.pass).length}/${results.length} passed`);
await browser.close();
