// Gamepad QA with a scripted virtual controller (navigator.getGamepads is replaced before load).
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const URL_ = process.env.URL || 'http://localhost:4173/';
const OUT = 'qa-output/gamepad';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 650 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.addInitScript(() => {
  const mk = () => ({ pressed: false, touched: false, value: 0 });
  window.__pad = { id: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)', index: 0, connected: true, mapping: 'standard', timestamp: 0, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, mk) };
  window.__padOn = true;
  navigator.getGamepads = () => (window.__padOn ? [window.__pad, null, null, null] : [null, null, null, null]);
});
const results = [];
const assert = (c, m) => { if (!c) throw new Error(m); };
async function step(name, fn) {
  try { const d = await fn(); results.push(true); console.log('PASS', name, d !== undefined ? JSON.stringify(d) : ''); }
  catch (e) { results.push(false); console.log('FAIL', name, e.message); await page.screenshot({ path: `${OUT}/fail-${name.replace(/\W+/g, '_')}.png` }); }
}
async function until(fn, arg, timeout = 15000, what = 'condition') {
  const t = Date.now();
  while (Date.now() - t < timeout) { if (await page.evaluate(fn, arg)) return; await page.waitForTimeout(60); }
  const st = await page.evaluate(() => ({ state: window.__bf.state, fps: window.__bf.app.game?.fps ?? null, active: window.__bf.pad.active }));
  throw new Error('timeout: ' + what + ' ' + JSON.stringify(st));
}
const setBtn = (i, v) => page.evaluate(([i, v]) => { const b = window.__pad.buttons[i]; b.pressed = v; b.value = v ? 1 : 0; }, [i, v]);
// Wait for real animation frames so a press is never shorter than one poll (software GL can stall frames).
const frames = (n) => page.evaluate((n) => new Promise((r) => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
async function press(i, hold = 160) { await setBtn(i, true); await frames(3); await page.waitForTimeout(hold); await setBtn(i, false); await frames(3); await page.waitForTimeout(100); }
const axes = (a) => page.evaluate((a) => { window.__pad.axes = a; }, a);
const focused = () => page.evaluate(() => { const f = document.querySelector('.pad-focus'); return f ? (f.dataset.mode || f.dataset.act || f.getAttribute('name') || f.dataset.slot || f.textContent.trim().slice(0, 24)) : null; });
// Flat stone platform under the player and an exact aim, so mining/placing don't depend on random terrain.
const platform = () => page.evaluate(() => {
  const g = window.__bf.app.game;
  const b = g.player.body;
  const fx = Math.floor(b.x), fy = Math.floor(b.y), fz = Math.floor(b.z);
  for (let dx = -5; dx <= 5; dx++) for (let dz = -5; dz <= 5; dz++) {
    g.world.setBlock(fx + dx, fy - 1, fz + dz, 3, false);
    for (let dy = 0; dy <= 4; dy++) g.world.setBlock(fx + dx, fy + dy, fz + dz, 0, false);
  }
  g.player.setPosition(fx + 0.5, fy, fz + 0.5);
  return { fx, fy, fz };
});
async function aimAt(c) {
  await page.evaluate((c) => { const p = window.__bf.app.game.player; const dx = c.x + 0.5 - p.body.x, dz = c.z + 0.5 - p.body.z, dy = c.y + 1 - p.eyeY; p.yaw = Math.atan2(-dx, -dz); p.pitch = Math.atan2(dy, Math.hypot(dx, dz)); }, c);
  await until((c) => { const t = window.__bf.app.game.interaction.target; return t && t.x === c.x && t.y === c.y && t.z === c.z; }, c, 8000, 'target');
}
const B = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, START: 9, L3: 10, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };

await page.goto(URL_);
await page.waitForSelector('[data-screen=menu]');

await step('menu: controller detected, focus + prompt bar appear', async () => {
  await press(B.DOWN);
  const r = await page.evaluate(() => ({ bar: !document.querySelector('.pad-bar').hidden, text: document.querySelector('.pad-bar').textContent, active: document.body.classList.contains('pad-active') }));
  assert(r.bar && r.active, JSON.stringify(r));
  assert(/A\s*Select/.test(r.text), r.text);
  return { focus: await focused(), bar: r.text };
});

await step('menu: D-pad moves focus, A opens New World', async () => {
  // Walk focus to the "New World" button.
  for (let i = 0; i < 6 && (await focused()) !== 'new'; i++) await press(B.DOWN);
  if ((await focused()) !== 'new') for (let i = 0; i < 6 && (await focused()) !== 'new'; i++) await press(B.UP);
  assert((await focused()) === 'new', `focus ${await focused()}`);
  await press(B.A);
  await page.waitForSelector('[data-screen=new]');
});

await step('new world: pick Creative with the controller and create', async () => {
  // From the default (Create World) go up to the Seed field, down to the mode row, right to Creative.
  for (let i = 0; i < 4 && (await focused()) !== 'seed'; i++) await press(B.UP);
  const path = [await focused()];
  await press(B.DOWN); path.push(await focused());
  if ((await focused()) === 'survival') { await press(B.RIGHT); path.push(await focused()); }
  assert((await focused()) === 'creative', `path ${path}`);
  await press(B.A);
  const on = await page.evaluate(() => document.querySelector('[data-mode=creative]').classList.contains('on'));
  assert(on, 'creative not selected');
  await page.screenshot({ path: `${OUT}/01-new-world.png` });
  await press(B.DOWN); path.push(await focused());
  for (let i = 0; i < 3 && (await focused()) !== 'create'; i++) await press(B.RIGHT);
  assert((await focused()) === 'create', `path ${path} ${await focused()}`);
  await press(B.A);
  const t0 = Date.now(); const seen = [];
  while (Date.now() - t0 < 90000) {
    const st = await page.evaluate(() => window.__bf?.state + ':' + (document.querySelector('#ui > .screen:last-child')?.dataset.screen ?? '-'));
    if (seen[seen.length - 1] !== st) seen.push(st);
    if (st.startsWith('playing')) break;
    await page.waitForTimeout(250);
  }
  assert(seen[seen.length - 1].startsWith('playing'), 'states ' + seen.join(' > '));
  const creative = await page.evaluate(() => window.__bf.app.game.creative);
  assert(creative, 'world is not creative');
  return { path };
});

await step('in game: prompt hints show Xbox glyphs', async () => {
  await page.waitForTimeout(800);
  const r = await page.evaluate(() => ({ hints: !document.querySelector('.pad-hints').hidden, text: document.querySelector('.pad-hints').textContent, touch: getComputedStyle(document.getElementById('touch')).display }));
  assert(r.hints && /RT\s*Mine/.test(r.text) && /Fly/.test(r.text), JSON.stringify(r));
  await page.screenshot({ path: `${OUT}/02-ingame.png` });
  return r.text;
});

await step('left stick moves, right stick looks (axes not inverted)', async () => {
  const a = await page.evaluate(() => ({ ...window.__bf.app.game.player.body, yaw: window.__bf.app.game.player.yaw, pitch: window.__bf.app.game.player.pitch }));
  await axes([0, -1, 0, 0]); // stick up = forward
  await until((a) => { const b = window.__bf.app.game.player.body; return Math.hypot(b.x - a.x, b.z - a.z) > 1; }, a, 8000, 'move');
  await axes([0, 0, 1, 0]); // right stick right = turn right
  await page.waitForTimeout(500);
  await axes([0, 0, 0, -1]); // right stick up = look up
  await page.waitForTimeout(400);
  await axes([0, 0, 0, 0]);
  const b = await page.evaluate(() => ({ ...window.__bf.app.game.player.body, yaw: window.__bf.app.game.player.yaw, pitch: window.__bf.app.game.player.pitch }));
  const fx = -Math.sin(a.yaw), fz = -Math.cos(a.yaw);
  const fwd = (b.x - a.x) * fx + (b.z - a.z) * fz;
  assert(fwd > 0.5, `forward ${fwd}`);
  assert(b.yaw < a.yaw - 0.05, `yaw ${a.yaw} -> ${b.yaw}`);
  assert(b.pitch > a.pitch + 0.02, `pitch ${a.pitch} -> ${b.pitch} ` + (await page.evaluate(() => window.__bf.state)));
  return { fwd: fwd.toFixed(2), dyaw: (b.yaw - a.yaw).toFixed(2), dpitch: (b.pitch - a.pitch).toFixed(2) };
});

await step('creative: D-pad up toggles flight, A ascends, B descends', async () => {
  await press(B.UP);
  await until(() => window.__bf.app.game.player.flying, null, 5000, 'flying');
  const y0 = await page.evaluate(() => window.__bf.app.game.player.body.y);
  await setBtn(B.A, true);
  await until((y0) => window.__bf.app.game.player.body.y > y0 + 1.5, y0, 8000, 'ascend');
  await setBtn(B.A, false);
  const y1 = await page.evaluate(() => window.__bf.app.game.player.body.y);
  await setBtn(B.B, true);
  await until((y1) => window.__bf.app.game.player.body.y < y1 - 0.8, y1, 8000, 'descend');
  await setBtn(B.B, false);
  await press(B.UP);
  return { rose: (y1 - y0).toFixed(2) };
});

await step('RB/LB change hotbar slot; RT mines (creative instant break)', async () => {
  const s0 = await page.evaluate(() => window.__bf.app.game.selected);
  await press(B.RB);
  const s1 = await page.evaluate(() => window.__bf.app.game.selected);
  await press(B.LB);
  const s2 = await page.evaluate(() => window.__bf.app.game.selected);
  assert(s1 === (s0 + 1) % 9 && s2 === s0, `${s0} ${s1} ${s2}`);
  await until(() => !window.__bf.app.game.player.flying, null, 10000, 'not flying');
  const F = await platform();
  await page.waitForTimeout(800);
  const t = { x: F.fx + 2, y: F.fy - 1, z: F.fz };
  await aimAt(t);
  await press(B.RT, 300);
  await until((t) => window.__bf.app.game.world.getBlock(t.x, t.y, t.z) === 0 || window.__bf.app.game.world.getBlock(t.x, t.y, t.z) >= 61, t, 8000, 'block broken');
});

await step('LT places from the creative library (via inventory with the controller)', async () => {
  await press(B.Y);
  await page.waitForSelector('.inv-screen');
  await press(B.RB); // switch to Block Library tab
  await until(() => document.querySelector('[data-tab=library]')?.classList.contains('on'), null, 4000, 'library tab');
  // Move focus into the library grid and take an item with A.
  for (let i = 0; i < 12 && !(await page.evaluate(() => !!document.querySelector('.pad-focus[data-lib]'))); i++) await press(B.DOWN);
  const lib = await page.evaluate(() => document.querySelector('.pad-focus')?.dataset.lib);
  assert(lib, 'no library item focused');
  await press(B.A);
  await page.screenshot({ path: `${OUT}/03-inventory.png` });
  await press(B.B); // close
  await until(() => window.__bf.state === 'playing', null, 5000, 'closed');
  const got = await page.evaluate((id) => window.__bf.app.game.inventory.count(Number(id)), lib);
  assert(got > 0, 'library item not added');
  // Select the slot holding it and place with LT.
  const slot = await page.evaluate((id) => window.__bf.app.game.inventory.slots.findIndex((s) => s && s.id === Number(id)), lib);
  assert(slot >= 0 && slot < 9, 'library item not in hotbar: slot ' + slot);
  await page.evaluate((i) => window.__bf.app.game.select(i), slot);
  const F = await platform();
  await page.waitForTimeout(800);
  const cell = { x: F.fx, y: F.fy - 1, z: F.fz + 2 };
  await aimAt(cell);
  const t = { x: cell.x, y: cell.y + 1, z: cell.z };
  await press(B.LT);
  await until((t) => window.__bf.app.game.world.getBlock(t.x, t.y, t.z) !== 0, t, 6000, 'placed').catch(() => {});
  const placed = await page.evaluate((t) => window.__bf.app.game.world.getBlock(t.x, t.y, t.z), t);
  const diag = await page.evaluate(() => { const g = window.__bf.app.game; return { sel: g.selected, held: g.heldStack(), slotIdx: g.inventory.slots.findIndex((s) => s), pos: [g.player.body.x, g.player.body.y, g.player.body.z].map((v) => +v.toFixed(2)), fly: g.player.flying }; });
  assert(placed !== 0, 'not placed ' + JSON.stringify({ t, diag }));
  return { lib, placed };
});

await step('Start pauses; switch to Survival from the pause menu; B resumes', async () => {
  await press(B.START);
  await page.waitForSelector('[data-screen=pause]');
  for (let i = 0; i < 6 && (await focused()) !== 'mode'; i++) await press(B.DOWN);
  assert((await focused()) === 'mode', `focus ${await focused()}`);
  await press(B.A);
  await until(() => window.__bf.app.game.creative === false, null, 5000, 'survival');
  await page.screenshot({ path: `${OUT}/04-pause.png` });
  await press(B.B);
  await until(() => window.__bf.state === 'playing', null, 5000, 'resumed');
  const r = await page.evaluate(() => ({ creative: window.__bf.app.game.creative, meta: window.__bf.app.game.meta.mode, bars: document.querySelector('.bars').style.visibility }));
  assert(r.meta === 'survival' && r.bars !== 'hidden', JSON.stringify(r));
  return r;
});

await step('A that closed a menu does not leak a jump into the game', async () => {
  await press(B.START);
  await page.waitForSelector('[data-screen=pause]');
  for (let i = 0; i < 6 && (await focused()) !== 'resume'; i++) await press(B.UP);
  await setBtn(B.A, true);
  await until(() => window.__bf.state === 'playing', null, 5000, 'resumed');
  const y0 = await page.evaluate(() => window.__bf.app.game.player.body.y);
  await page.waitForTimeout(500);
  const y1 = await page.evaluate(() => window.__bf.app.game.player.body.y);
  await setBtn(B.A, false);
  assert(Math.abs(y1 - y0) < 0.05, `jumped ${y1 - y0}`);
});

await step('PlayStation controller shows ✕ ○ □ △ / R2 L2 glyphs', async () => {
  await page.evaluate(() => { window.__pad.id = 'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)'; window.__padOn = false; });
  await until(() => window.__bf.state === 'paused', null, 8000, 'paused on unplug');
  await page.evaluate(() => { window.__padOn = true; });
  // Unplugging paused the game; the pause menu is waiting for the reconnected controller.
  await page.waitForSelector('[data-screen=pause]');
  await press(B.B);
  await until(() => window.__bf.state === 'playing', null, 5000, 'resumed');
  await page.waitForTimeout(300);
  const text = await page.evaluate(() => document.querySelector('.pad-hints').textContent);
  assert(text.includes('R2') && text.includes('✕') && text.includes('△'), text);
  await page.screenshot({ path: `${OUT}/05-playstation.png` });
  return text;
});

await step('disconnecting the controller pauses the game', async () => {
  await page.evaluate(() => { window.__padOn = false; });
  await until(() => window.__bf.state === 'paused', null, 5000, 'paused');
  await page.evaluate(() => { window.__padOn = true; });
});

await step('no runtime errors', async () => { assert(errors.length === 0, errors.slice(0, 5).join(' | ')); });
console.log(`${results.filter(Boolean).length}/${results.length} passed`);
await browser.close();
