// Mobile multitouch QA using real CDP touch events (pointerType=touch).
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const URL_ = process.env.URL || 'http://localhost:4173/';
const OUT = 'qa-output/touch';
mkdirSync(OUT, { recursive: true });
const W = 844, H = 390;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const results = [];
const assert = (c, m) => { if (!c) throw new Error(m); };
const recenter = () => page.evaluate(() => {
  const g = window.__bf.app.game; const { fx, fy, fz } = window.__fixture;
  for (let dx = -10; dx <= 10; dx++) for (let dz = -10; dz <= 10; dz++) { g.world.setBlock(fx + dx, fy - 1, fz + dz, 2, false); for (let dy = 0; dy <= 5; dy++) g.world.setBlock(fx + dx, fy + dy, fz + dz, 0, false); }
  g.player.setPosition(fx + 0.5, fy, fz + 0.5); g.player.yaw = 0; g.player.pitch = 0;
});
async function step(name, fn) {
  if (results.length > 1) { await touch('touchEnd', []).catch(() => {}); await recenter().catch(() => {}); await page.waitForTimeout(300); }
  try { const d = await fn(); results.push({ name, pass: true, d }); console.log('PASS', name, d ? JSON.stringify(d) : ''); }
  catch (e) { results.push({ name, pass: false, d: e.message }); console.log('FAIL', name, e.message); await page.screenshot({ path: `${OUT}/fail-${name.replace(/\W+/g, '_')}.png` }); }
}
const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y, id]) => ({ x, y, id, radiusX: 4, radiusY: 4, force: 1 })) });
const P = () => page.evaluate(() => { const p = window.__bf.app.game.player; return { x: p.body.x, y: p.body.y, z: p.body.z, yaw: p.yaw, pitch: p.pitch, ground: p.onGround }; });
async function until(fn, arg, timeout = 10000) { const t = Date.now(); while (Date.now() - t < timeout) { if (await page.evaluate(fn, arg)) return; await page.waitForTimeout(50); } throw new Error('timeout'); }
const center = (sel) => page.$eval(sel, (el) => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });

await step('auto-detects mobile controls', async () => {
  await page.goto(URL_);
  await page.waitForSelector('[data-screen=menu]');
  const m = await page.evaluate(() => window.__bf.app.mobile);
  assert(m === true, 'not detected as mobile');
  await page.click('[data-act=new]');
  await page.fill('[name=seed]', 'touch-qa');
  await page.click('[data-act=create]');
  await page.waitForFunction(() => window.__bf?.state === 'playing', null, { timeout: 90000 });
  // Flat fixture so movement checks don't depend on terrain.
  await page.evaluate(() => {
    const g = window.__bf.app.game; const b = g.player.body;
    const fx = Math.floor(b.x), fy = Math.floor(b.y), fz = Math.floor(b.z);
    for (let dx = -10; dx <= 10; dx++) for (let dz = -10; dz <= 10; dz++) { g.world.setBlock(fx + dx, fy - 1, fz + dz, 2, false); for (let dy = 0; dy <= 5; dy++) g.world.setBlock(fx + dx, fy + dy, fz + dz, 0, false); }
    g.player.setPosition(fx + 0.5, fy, fz + 0.5); g.player.yaw = 0; g.player.pitch = 0;
    g.settings.autoJump = false; g.player.autoJump = false;
    window.__fixture = { fx, fy, fz };
  });
  await page.waitForTimeout(800);
  const touchVisible = await page.evaluate(() => !document.getElementById('touch').hidden);
  assert(touchVisible, 'touch controls hidden');
  await page.screenshot({ path: `${OUT}/01-controls.png` });
});

await step('joystick up = forward (Y not inverted)', async () => {
  const a = await P();
  const sx = 120, sy = 260;
  await touch('touchStart', [[sx, sy, 1]]);
  for (let i = 1; i <= 6; i++) await touch('touchMove', [[sx, sy - i * 12, 1]]);
  await page.waitForTimeout(900);
  await touch('touchEnd', []);
  await page.waitForTimeout(300);
  const b = await P();
  const fx = -Math.sin(a.yaw), fz = -Math.cos(a.yaw);
  const fwd = (b.x - a.x) * fx + (b.z - a.z) * fz;
  assert(fwd > 0.8, `forward displacement ${fwd.toFixed(2)}`);
  return { forward: fwd.toFixed(2) };
});

await step('joystick right = strafe right (X not inverted)', async () => {
  const a = await P();
  const sx = 120, sy = 260;
  await touch('touchStart', [[sx, sy, 2]]);
  for (let i = 1; i <= 6; i++) await touch('touchMove', [[sx + i * 12, sy, 2]]);
  await page.waitForTimeout(900);
  await touch('touchEnd', []);
  await page.waitForTimeout(300);
  const b = await P();
  const rx = Math.cos(a.yaw), rz = -Math.sin(a.yaw);
  const right = (b.x - a.x) * rx + (b.z - a.z) * rz;
  assert(right > 0.8, `right displacement ${right.toFixed(2)}`);
  return { right: right.toFixed(2) };
});

await step('joystick release stops movement (no stuck input)', async () => {
  await page.waitForTimeout(400);
  const a = await P();
  await page.waitForTimeout(600);
  const b = await P();
  const d = Math.hypot(b.x - a.x, b.z - a.z);
  assert(d < 0.05, `drifted ${d}`);
  const mv = await page.evaluate(() => window.__bf.app.input.moveVector());
  assert(mv.x === 0 && mv.y === 0, 'move vector not zero');
});

await step('look drag right = turn right, drag up = look up', async () => {
  const a = await P();
  await touch('touchStart', [[600, 200, 3]]);
  for (let i = 1; i <= 8; i++) await touch('touchMove', [[600 + i * 10, 200 - i * 4, 3]]);
  await touch('touchEnd', []);
  await page.waitForTimeout(300);
  const b = await P();
  assert(b.yaw < a.yaw - 0.05, `yaw ${a.yaw} -> ${b.yaw} (should turn right)`);
  assert(b.pitch > a.pitch + 0.02, `pitch ${a.pitch} -> ${b.pitch} (should look up)`);
  return { dyaw: (b.yaw - a.yaw).toFixed(3), dpitch: (b.pitch - a.pitch).toFixed(3) };
});

await step('multitouch: move + look + jump simultaneously', async () => {
  const a = await P();
  const [jx, jy] = await center('[data-touch=jump]');
  await touch('touchStart', [[120, 260, 10]]);
  await touch('touchMove', [[120, 200, 10]]);
  await touch('touchStart', [[120, 200, 10], [560, 180, 11]]);
  await touch('touchStart', [[120, 200, 10], [560, 180, 11], [jx, jy, 12]]);
  let maxY = a.y;
  for (let i = 1; i <= 10; i++) {
    await touch('touchMove', [[120, 200, 10], [560 + i * 6, 180, 11], [jx, jy, 12]]);
    maxY = Math.max(maxY, (await P()).y);
    await page.waitForTimeout(60);
  }
  await touch('touchEnd', []);
  await until(() => window.__bf.app.game.player.onGround);
  const b = await P();
  assert(Math.hypot(b.x - a.x, b.z - a.z) > 0.5, 'did not move while multitouching');
  assert(Math.abs(b.yaw - a.yaw) > 0.03, 'did not look while multitouching');
  assert(maxY - a.y > 0.4, `did not jump (${(maxY - a.y).toFixed(2)})`);
  const held = await page.evaluate(() => ({ jump: window.__bf.app.input.touchJump, pressed: document.querySelectorAll('#touch .pressed').length }));
  assert(!held.jump && held.pressed === 0, 'button stuck after release');
  return { moved: Math.hypot(b.x - a.x, b.z - a.z).toFixed(2), jump: (maxY - a.y).toFixed(2) };
});

await step('touchcancel releases everything', async () => {
  const [mx, my] = await center('[data-touch=mine]');
  await touch('touchStart', [[120, 260, 20], [mx, my, 21]]);
  await touch('touchMove', [[120, 200, 20], [mx, my, 21]]);
  await page.waitForTimeout(200);
  const mid = await page.evaluate(() => ({ p: window.__bf.app.input.primary, mv: window.__bf.app.input.moveVector() }));
  await touch('touchCancel', []);
  await page.waitForTimeout(200);
  const after = await page.evaluate(() => ({ p: window.__bf.app.input.primary, mv: window.__bf.app.input.moveVector(), pressed: document.querySelectorAll('#touch .pressed').length }));
  assert(mid.p && mid.mv.y > 0, 'controls were not active before cancel');
  assert(!after.p && after.mv.x === 0 && after.mv.y === 0 && after.pressed === 0, `stuck after cancel ${JSON.stringify(after)}`);
});

await step('finger sliding off a button releases it', async () => {
  const [mx, my] = await center('[data-touch=mine]');
  await touch('touchStart', [[mx, my, 30]]);
  await page.waitForTimeout(150);
  const on = await page.evaluate(() => window.__bf.app.input.primary);
  for (let i = 1; i <= 6; i++) await touch('touchMove', [[mx - i * 30, my, 30]]);
  await page.waitForTimeout(150);
  const off = await page.evaluate(() => window.__bf.app.input.primary);
  await touch('touchEnd', []);
  assert(on && !off, `on=${on} off=${off}`);
});

await step('mine button breaks block; place button places', async () => {
  await page.evaluate(() => { const g = window.__bf.app.game; g.player.pitch = -1.2; g.player.yaw = 0; });
  await until(() => !!window.__bf.app.game.interaction.target);
  const t = await page.evaluate(() => { const t = window.__bf.app.game.interaction.target; return { x: t.x, y: t.y, z: t.z }; });
  const [mx, my] = await center('[data-touch=mine]');
  await touch('touchStart', [[mx, my, 40]]);
  await until((t) => window.__bf.app.game.world.getBlock(t.x, t.y, t.z) === 0, t, 20000);
  await touch('touchEnd', []);
  // Broken blocks drop as items; wait for the magnet pickup.
  await until(() => window.__bf.app.game.inventory.count(2) >= 1, null, 15000).catch(() => {});
  const cnt = await page.evaluate(() => window.__bf.app.game.inventory.count(2));
  assert(cnt >= 1, 'no dirt collected');
  // Place it back.
  await page.evaluate(() => { const g = window.__bf.app.game; g.select(g.inventory.slots.findIndex((s) => s && s.id === 2)); g.player.pitch = -0.6; });
  await page.waitForTimeout(400);
  const [px, py] = await center('[data-touch=place]');
  await touch('touchStart', [[px, py, 41]]);
  await page.waitForTimeout(120);
  await touch('touchEnd', []);
  await page.waitForTimeout(500);
  const cnt2 = await page.evaluate(() => window.__bf.app.game.inventory.count(2));
  assert(cnt2 === cnt - 1, `place failed ${cnt} -> ${cnt2}`);
});

await step('hotbar tap selects slot', async () => {
  const [sx, sy] = await center('.hotbar .slot[data-i="4"]');
  await touch('touchStart', [[sx, sy, 50]]);
  await touch('touchEnd', []);
  await page.waitForTimeout(200);
  const sel = await page.evaluate(() => window.__bf.app.game.selected);
  assert(sel === 4, `selected ${sel}`);
});

await step('inventory button opens inventory; touch input blocked while open', async () => {
  const [ix, iy] = await center('[data-touch=inventory]');
  await touch('touchStart', [[ix, iy, 60]]);
  await touch('touchEnd', []);
  await page.waitForSelector('.inv-screen');
  const a = await P();
  await touch('touchStart', [[120, 260, 61]]);
  await touch('touchMove', [[120, 200, 61]]);
  await page.waitForTimeout(500);
  await touch('touchEnd', []);
  const b = await P();
  assert(Math.hypot(b.x - a.x, b.z - a.z) < 0.05, 'moved while inventory open');
  // Tap-select then tap-move in the inventory.
  await page.evaluate(() => window.__bf.app.game.inventory.add(3, 10));
  await page.evaluate(() => window.__bf.app.inv && window.__bf.app.inv.render());
  const from = await page.evaluate(() => window.__bf.app.game.inventory.slots.findIndex((s) => s));
  const to = 20;
  const [fx, fy] = await center(`[data-slot="${from}"]`);
  await touch('touchStart', [[fx, fy, 62]]); await touch('touchEnd', []);
  await page.waitForTimeout(100);
  const [tx, ty] = await center(`[data-slot="${to}"]`);
  await touch('touchStart', [[tx, ty, 63]]); await touch('touchEnd', []);
  await page.waitForTimeout(100);
  const moved = await page.evaluate(([f, t]) => { const s = window.__bf.app.game.inventory.slots; return !s[f] && !!s[t]; }, [from, to]);
  assert(moved, 'tap-move failed');
  await page.screenshot({ path: `${OUT}/02-inventory.png` });
  await page.click('[data-act=close]');
  await page.waitForTimeout(200);
  assert((await page.evaluate(() => window.__bf.state)) === 'playing', 'did not close');
});

await step('pause button pauses; resume works', async () => {
  const [px, py] = await center('[data-touch=pause]');
  await touch('touchStart', [[px, py, 70]]);
  await touch('touchEnd', []);
  await page.waitForSelector('[data-screen=pause]');
  await page.screenshot({ path: `${OUT}/03-pause.png` });
  await page.click('[data-act=resume]');
  await page.waitForTimeout(200);
  assert((await page.evaluate(() => window.__bf.state)) === 'playing', 'not resumed');
});

await step('orientation change: portrait → landscape keeps renderer + controls healthy', async () => {
  await page.setViewportSize({ width: H, height: W });
  await page.waitForTimeout(600);
  const portrait = await page.evaluate(() => ({ rotate: !!document.querySelector('[data-screen=rotate]'), aspect: window.__bf.app.r.camera.aspect }));
  await page.screenshot({ path: `${OUT}/04-portrait.png` });
  await page.setViewportSize({ width: W, height: H });
  await page.waitForTimeout(600);
  const land = await page.evaluate(() => ({ rotate: !!document.querySelector('[data-screen=rotate]'), aspect: window.__bf.app.r.camera.aspect, state: window.__bf.state }));
  assert(Math.abs(portrait.aspect - H / W) < 0.01, `portrait aspect ${portrait.aspect}`);
  assert(Math.abs(land.aspect - W / H) < 0.01, `landscape aspect ${land.aspect}`);
  assert(!land.rotate, 'rotate overlay stuck');
  // Controls still work after rotation.
  const a = await P();
  await touch('touchStart', [[120, 260, 80]]);
  for (let i = 1; i <= 5; i++) await touch('touchMove', [[120, 260 - i * 12, 80]]);
  await page.waitForTimeout(600);
  await touch('touchEnd', []);
  const b = await P();
  assert(Math.hypot(b.x - a.x, b.z - a.z) > 0.3, 'joystick dead after rotation');
  return { portrait, land };
});

await step('no page scroll / zoom during play', async () => {
  const r = await page.evaluate(() => ({ sx: scrollX, sy: scrollY, vv: window.visualViewport?.scale ?? 1 }));
  assert(r.sx === 0 && r.sy === 0 && r.vv === 1, JSON.stringify(r));
});

await step('no runtime errors', async () => { assert(errors.length === 0, errors.join(' | ')); });
writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
console.log(`${results.filter((r) => r.pass).length}/${results.length} passed`);
await browser.close();
