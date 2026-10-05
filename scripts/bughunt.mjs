// Bug hunt: deliberately abuse the game and verify it stays consistent.
import { chromium } from 'playwright';
const URL_ = process.env.URL || 'http://localhost:4173/';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 1100, height: 650 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const results = [];
const assert = (c, m) => { if (!c) throw new Error(m); };
async function step(name, fn) {
  try { const d = await fn(); results.push(true); console.log('PASS', name, d ? JSON.stringify(d) : ''); }
  catch (e) { results.push(false); console.log('FAIL', name, e.message); await page.screenshot({ path: `qa-output/bughunt-${name.replace(/\W+/g, '_')}.png` }); }
}
const state = () => page.evaluate(() => window.__bf.state);
/** Invariant: input gameplay flag matches state; overlays match state. */
const consistent = () => page.evaluate(() => {
  const a = window.__bf.app;
  const s = a.state;
  const inv = !!document.querySelector('.inv-screen');
  const pause = !!document.querySelector('[data-screen=pause]');
  return { s, ok: a.input.gameplay === (s === 'playing') && inv === (s === 'inventory') && pause === (s === 'paused') && (!a.game || a.game.paused === (s === 'paused')), inv, pause, gp: a.input.gameplay };
});
async function newWorld(seed, mode = 'survival') {
  await page.click('[data-act=new]');
  await page.fill('[name=seed]', seed);
  if (mode === 'creative') await page.click('[data-mode=creative]');
  await page.click('[data-act=create]');
  await page.waitForFunction(() => window.__bf?.state === 'playing', null, { timeout: 90000 });
}

await page.goto(URL_);
await page.waitForSelector('[data-screen=menu]');
await newWorld('bughunt');

await step('spam inventory toggle (E x25)', async () => {
  for (let i = 0; i < 25; i++) { await page.keyboard.press('KeyE'); await page.waitForTimeout(i % 3 === 0 ? 0 : 20); }
  await page.waitForTimeout(300);
  const c = await consistent();
  assert(c.ok, JSON.stringify(c));
  if (c.s === 'inventory') await page.keyboard.press('KeyE');
  return c;
});

await step('spam Escape (x15)', async () => {
  for (let i = 0; i < 15; i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(15); }
  await page.waitForTimeout(300);
  const c = await consistent();
  assert(c.ok, JSON.stringify(c));
  if (c.s === 'paused') await page.click('[data-act=resume]');
  return c;
});

await step('spam hotbar keys + wheel', async () => {
  for (let i = 0; i < 40; i++) await page.keyboard.press(`Digit${(i % 9) + 1}`);
  for (let i = 0; i < 30; i++) await page.mouse.wheel(0, i % 2 ? 120 : -120);
  await page.waitForTimeout(200);
  const sel = await page.evaluate(() => window.__bf.app.game.selected);
  assert(sel >= 0 && sel < 9, `selected ${sel}`);
});

await step('pause while mining → mining stops, nothing stuck after resume', async () => {
  await page.evaluate(() => { window.__bf.app.game.player.pitch = -1.4; });
  await page.mouse.click(550, 325);
  await page.mouse.down();
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  if ((await state()) !== 'paused') await page.evaluate(() => window.__bf.app.pause());
  await page.mouse.up();
  await page.click('[data-act=resume]');
  await page.waitForTimeout(300);
  const r = await page.evaluate(() => ({ primary: window.__bf.app.input.primary, prog: window.__bf.app.game.interaction.progress }));
  assert(!r.primary, 'primary stuck after pause');
  return r;
});

await step('hold W while mining (move + mine)', async () => {
  const a = await page.evaluate(() => ({ ...window.__bf.app.game.player.body }));
  await page.keyboard.down('KeyW');
  await page.mouse.down();
  await page.waitForTimeout(1500);
  await page.mouse.up();
  await page.keyboard.up('KeyW');
  const b = await page.evaluate(() => ({ ...window.__bf.app.game.player.body }));
  assert(Number.isFinite(b.x + b.y + b.z), 'NaN position');
  return { moved: Math.hypot(b.x - a.x, b.z - a.z).toFixed(2) };
});

await step('death while inventory open', async () => {
  await page.evaluate(() => window.__bf.app.openInventory());
  await page.waitForSelector('.inv-screen');
  await page.evaluate(() => window.__bf.app.game.player.hurt(100, 'fall'));
  await page.waitForSelector('[data-screen=death]');
  const inv = await page.$('.inv-screen');
  assert(!inv, 'inventory still open on death screen');
  await page.click('[data-act=respawn]');
  await page.waitForTimeout(300);
  const c = await consistent();
  assert(c.ok && c.s === 'playing', JSON.stringify(c));
});

await step('E / Esc ignored on death screen', async () => {
  await page.waitForTimeout(800); // post-respawn invulnerability window
  await page.evaluate(() => window.__bf.app.game.player.hurt(100, 'fall'));
  await page.waitForSelector('[data-screen=death]');
  await page.keyboard.press('KeyE');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  assert((await state()) === 'dead', `state ${await state()}`);
  await page.click('[data-act=respawn]');
});

await step('walk across x=0 / z=0 boundary (survival physics)', async () => {
  const r = await page.evaluate(async () => {
    const g = window.__bf.app.game;
    const w = g.world;
    // Find ground near the origin.
    const spot = w.findSafeSpot(1, 1, 30);
    g.player.setPosition(spot ? spot.x : 1.5, spot ? spot.y : 90, spot ? spot.z : 1.5);
    await new Promise((r) => setTimeout(r, 3000));
    return { start: { ...g.player.body } };
  });
  // Walk diagonally toward negative coordinates for a while.
  await page.evaluate(() => { window.__bf.app.game.player.yaw = Math.PI / 4; window.__bf.app.game.settings.autoJump = true; window.__bf.app.game.player.autoJump = true; });
  await page.keyboard.down('KeyW');
  let minY = Infinity;
  for (let i = 0; i < 30; i++) { await page.waitForTimeout(100); minY = Math.min(minY, await page.evaluate(() => window.__bf.app.game.player.body.y)); }
  await page.keyboard.up('KeyW');
  const end = await page.evaluate(() => { const g = window.__bf.app.game; const b = g.player.body; return { ...b, inside: g.world.isSolid(b.x, b.y + 0.5, b.z) }; });
  assert(!end.inside, 'player inside blocks');
  assert(minY > 20, `fell through the world (minY ${minY})`);
  return { start: [r.start.x.toFixed(1), r.start.z.toFixed(1)], end: [end.x.toFixed(1), end.z.toFixed(1)] };
});

await step('render distance up/down during play', async () => {
  await page.evaluate(() => { const a = window.__bf.app; a.setSettings({ ...a.settings, renderDistance: 10 }); });
  await page.waitForFunction(() => window.__bf.app.game.world.stats().loaded > 250, null, { timeout: 60000 });
  const big = await page.evaluate(() => window.__bf.app.game.world.stats().loaded);
  await page.evaluate(() => { const a = window.__bf.app; a.setSettings({ ...a.settings, renderDistance: 3 }); });
  await page.waitForTimeout(1500);
  const small = await page.evaluate(() => window.__bf.app.game.world.stats().loaded);
  assert(small < big && small <= 140, `chunks not unloaded (${big} → ${small})`);
  return { big, small };
});

await step('save & quit → open another world → no leaked scenes/loops', async () => {
  await page.evaluate(() => window.__bf.app.pause());
  await page.click('[data-act=savequit]');
  await page.waitForSelector('[data-screen=menu]');
  await newWorld('second', 'creative');
  const r = await page.evaluate(() => {
    const sc = window.__bf.app.r.scene;
    return { worldGroups: sc.children.filter((c) => c.name === 'world').length, children: sc.children.length };
  });
  assert(r.worldGroups === 1, `world groups ${r.worldGroups}`);
  return r;
});

await step('creative: rapid place/break spam', async () => {
  await page.evaluate(() => { const g = window.__bf.app.game; g.inventory.slots[0] = { id: 3, count: 64 }; g.select(0); g.player.pitch = -0.7; });
  await page.mouse.click(550, 325);
  for (let i = 0; i < 20; i++) {
    await page.mouse.down({ button: i % 2 ? 'left' : 'right' });
    await page.waitForTimeout(40);
    await page.mouse.up({ button: i % 2 ? 'left' : 'right' });
  }
  const c = await consistent();
  assert(c.ok, JSON.stringify(c));
});

await step('reload during save keeps worlds loadable', async () => {
  await page.evaluate(() => { const g = window.__bf.app.game; for (let i = 0; i < 30; i++) g.world.setBlock(g.player.body.x + i, g.player.body.y + 3, g.player.body.z, 30, false); void g.save(); });
  await page.reload();
  await page.waitForSelector('[data-screen=menu]');
  await page.click('[data-act=worlds]');
  await page.waitForSelector('[data-screen=worlds]');
  const n = await page.$$eval('.world-item', (e) => e.length);
  assert(n === 2, `worlds ${n}`);
  await page.click('.world-item [data-act=playw]');
  await page.waitForFunction(() => window.__bf?.state === 'playing', null, { timeout: 90000 });
});

await step('no runtime errors during bug hunt', async () => { assert(errors.length === 0, errors.slice(0, 5).join(' | ')); });
console.log(`${results.filter(Boolean).length}/${results.length} passed`);
await browser.close();
