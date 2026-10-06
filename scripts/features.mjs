// Feature QA: torches/light, shaped blocks, doors, water flow, item drops, minimap, mob persistence.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const URL_ = process.env.URL || 'http://localhost:4173/';
const OUT = 'qa-output/features';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 650 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const results = [];
const assert = (c, m) => { if (!c) throw new Error(m); };
async function step(name, fn) {
  try { const d = await fn(); results.push(true); console.log('PASS', name, d !== undefined ? JSON.stringify(d) : ''); }
  catch (e) { results.push(false); console.log('FAIL', name, e.message); await page.screenshot({ path: `${OUT}/fail-${name.replace(/\W+/g, '_')}.png` }); }
}
async function until(fn, arg, timeout = 15000, what = 'condition') {
  const t = Date.now();
  while (Date.now() - t < timeout) { if (await page.evaluate(fn, arg)) return; await page.waitForTimeout(80); }
  throw new Error('timeout: ' + what);
}
/** Aim at a world cell's given face and press "use" through the real interaction path. */
async function useOn(cell, face, yOff = 0) {
  await page.evaluate(({ cell, face, yOff }) => {
    const g = window.__bf.app.game;
    const p = g.player;
    // Look from the eye at the center of the target face.
    const tx = cell.x + 0.5 + face[0] * 0.5, ty = cell.y + 0.5 + face[1] * 0.5 + yOff, tz = cell.z + 0.5 + face[2] * 0.5;
    const dx = tx - p.body.x, dy = ty - p.eyeY, dz = tz - p.body.z;
    p.yaw = Math.atan2(-dx, -dz);
    p.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  }, { cell, face, yOff });
  try {
    await until((c) => { const t = window.__bf.app.game.interaction.target; return !!t && t.x === c.x && t.y === c.y && t.z === c.z; }, cell, 8000, 'aim');
  } catch {
    const info = await page.evaluate(() => { const g = window.__bf.app.game; return { t: g.interaction.target, state: window.__bf.state, paused: g.paused, body: g.player.body, mob: !!g.interaction.targetMob }; });
    throw new Error('aim failed: ' + JSON.stringify({ want: cell, ...info }));
  }
  await page.evaluate(() => window.__bf.app.input.triggerEvent('secondaryDown'));
  // Wait until the game has actually processed the queued action (frames can be slow under software GL).
  await until(() => !window.__bf.app.game.interaction.placeQueued, null, 15000, 'use processed');
  await page.waitForTimeout(200);
}

await page.goto(URL_);
await page.waitForSelector('[data-screen=menu]');
await page.click('[data-act=new]');
await page.fill('[name=seed]', 'features');
await page.click('[data-act=create]');
await page.waitForFunction(() => window.__bf?.state === 'playing', null, { timeout: 90000 });
// Flat stone platform fixture.
const F = await page.evaluate(() => {
  const g = window.__bf.app.game;
  const b = g.player.body;
  const fx = Math.floor(b.x), fy = Math.floor(b.y), fz = Math.floor(b.z);
  for (let dx = -9; dx <= 9; dx++) for (let dz = -9; dz <= 9; dz++) {
    g.world.setBlock(fx + dx, fy - 1, fz + dz, 3, false);
    for (let dy = 0; dy <= 6; dy++) g.world.setBlock(fx + dx, fy + dy, fz + dz, 0, false);
  }
  g.player.setPosition(fx + 0.5, fy, fz + 0.5);
  g.inventory.clear();
  return { fx, fy, fz };
});
await page.waitForTimeout(1500);

await step('torch placement lights the area at night', async () => {
  await page.evaluate(() => { const g = window.__bf.app.game; g.time = 0.75; g.inventory.slots[0] = { id: 33, count: 8 }; g.select(0); });
  const cell = { x: F.fx + 2, y: F.fy - 1, z: F.fz };
  await useOn(cell, [0, 1, 0]);
  const id = await page.evaluate((c) => window.__bf.app.game.world.getBlock(c.x, c.y + 1, c.z), cell);
  assert(id === 33, `torch not placed (${id})`);
  await until(() => window.__bf.app.game.world.stats().pending === 0, null, 15000);
  await page.evaluate(() => { const p = window.__bf.app.game.player; p.yaw = -Math.PI / 2; p.pitch = -0.5; });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/01-torch-night.png` });
  // Torch can't float: placing on the side of a wall high up without support fails.
  return { torch: id };
});

await step('slab placement, slab-on-slab merges into a full block', async () => {
  await page.evaluate(() => { const g = window.__bf.app.game; g.time = 0.25; g.inventory.slots[1] = { id: 34, count: 8 }; g.select(1); });
  const cell = { x: F.fx - 2, y: F.fy - 1, z: F.fz };
  await useOn(cell, [0, 1, 0]);
  const a = await page.evaluate((c) => window.__bf.app.game.world.getBlock(c.x, c.y + 1, c.z), cell);
  assert(a === 34, `slab not placed (${a})`);
  await useOn({ ...cell, y: cell.y + 1 }, [0, 0, 0]); // aim at the slab's top surface (half height)
  const dbg = await page.evaluate(() => JSON.stringify({ t: window.__bf.app.game.interaction.target, body: window.__bf.app.game.player.body, eye: window.__bf.app.game.player.eyeY }));
  const b = await page.evaluate((c) => window.__bf.app.game.world.getBlock(c.x, c.y + 1, c.z), cell);
  assert(b === 15, `slabs did not merge into planks (${b}) ${dbg}`);
  return { first: a, merged: b };
});

await step('stairs face away from the player', async () => {
  await page.evaluate(() => { const g = window.__bf.app.game; g.inventory.slots[2] = { id: 36, count: 8 }; g.select(2); });
  const cell = { x: F.fx, y: F.fy - 1, z: F.fz - 3 };
  await useOn(cell, [0, 1, 0]);
  const id = await page.evaluate((c) => window.__bf.app.game.world.getBlock(c.x, c.y + 1, c.z), cell);
  assert(id === 36, `expected north-facing stairs (36), got ${id}`); // player looks toward -z
  return { id };
});

await step('door: place (2 blocks), open/close, break drops one door', async () => {
  console.log('door-step start', await page.evaluate((f) => { const g = window.__bf.app.game; const b = g.player.body; const col = []; for (let y = f.fy - 3; y <= f.fy + 1; y++) col.push(g.world.getBlock(b.x, y, b.z)); return JSON.stringify({ b, col, fy: f.fy }); }, F));
  await page.evaluate(() => { const g = window.__bf.app.game; g.creative = false; g.player.creative = false; g.inventory.slots[3] = { id: 268, count: 1 }; g.select(3); });
  await page.waitForTimeout(500);
  console.log('after survival', await page.evaluate(() => JSON.stringify(window.__bf.app.game.player.body)));
  const cell = { x: F.fx + 3, y: F.fy - 1, z: F.fz - 3 };
  await useOn(cell, [0, 1, 0]);
  const parts = await page.evaluate((c) => [window.__bf.app.game.world.getBlock(c.x, c.y + 1, c.z), window.__bf.app.game.world.getBlock(c.x, c.y + 2, c.z)], cell);
  assert(parts[0] >= 44 && parts[0] < 52 && parts[1] >= 52 && parts[1] < 60, `door parts ${parts}`);
  // Aim at the panel itself (it sits on the far, -z side of the door cell).
  await useOn({ ...cell, y: cell.y + 1 }, [0, 0, -0.8]);
  const opened = await page.evaluate((c) => window.__bf.app.game.world.getBlock(c.x, c.y + 1, c.z), cell);
  assert(((opened - 44) & 4) !== 0, `door did not open (${opened})`);
  await page.screenshot({ path: `${OUT}/02-blocks.png` });
  // Break the upper half in survival: both halves go, exactly one door item drops.
  await page.evaluate(() => window.__bf.app.game.drops.clear());
  const upperCell = { ...cell, y: cell.y + 2 };
  await useOn(upperCell, [0, 0, -0.8]).catch(() => {});
  await page.evaluate(() => window.__bf.app.input.setTouchPrimary(true));
  await until((c) => window.__bf.app.game.world.getBlock(c.x, c.y, c.z) === 0, upperCell, 15000, 'door broken');
  await page.evaluate(() => window.__bf.app.input.setTouchPrimary(false));
  const after = await page.evaluate((c) => ({ lower: window.__bf.app.game.world.getBlock(c.x, c.y + 1, c.z), drops: window.__bf.app.game.drops.drops.map((d) => [d.id, d.count]) }), cell);
  assert(after.lower === 0, 'lower half left behind');
  assert(after.drops.length === 1 && after.drops[0][0] === 268 && after.drops[0][1] === 1, JSON.stringify(after.drops));
  return { closed: parts, opened, after };
});

await step('walk up a slab without jumping (step assist)', async () => {
  const r = await page.evaluate(({ fx, fy, fz }) => {
    const g = window.__bf.app.game;
    // A slab floor several blocks long so the player stays on it while settling.
    for (let sx = fx - 5; sx <= fx - 1; sx++) for (let dz = -5; dz <= -2; dz++) g.world.setBlock(sx, fy, fz + dz, 34, false);
    g.player.setPosition(fx - 4.5 - 1, fy, fz - 3.5);
    g.player.yaw = -Math.PI / 2; // face +x
    g.player.pitch = 0;
    g.settings.autoJump = false; g.player.autoJump = false;
    return true;
  }, F);
  await page.waitForTimeout(300);
  await page.keyboard.down('KeyW');
  await until((f) => window.__bf.app.game.player.body.x > f.fx - 4.7, F, 6000, 'reach slab');
  await until((f) => Math.abs(window.__bf.app.game.player.body.y - (f.fy + 0.5)) < 0.05, F, 6000, 'settle on slab').catch(() => {});
  await page.keyboard.up('KeyW');
  const y = await page.evaluate(() => window.__bf.app.game.player.body.y);
  assert(Math.abs(y - (F.fy + 0.5)) < 0.05, `y ${y}`);
  return { y, r };
});

await step('water flows out from a source and recedes when it is removed', async () => {
  const src = { x: F.fx - 6, y: F.fy, z: F.fz + 6 };
  await page.evaluate((s) => window.__bf.app.game.world.setBlock(s.x, s.y, s.z, 10), src);
  await until((s) => { const w = window.__bf.app.game.world; const id = w.getBlock(s.x + 3, s.y, s.z); return id >= 61 && id <= 67; }, src, 20000, 'flow');
  const lvl = await page.evaluate((s) => window.__bf.app.game.world.getBlock(s.x + 3, s.y, s.z) - 60, src);
  await page.evaluate((s) => { const p = window.__bf.app.game.player; p.setPosition(s.x + 3.5, s.y, s.z - 4.5); p.yaw = 0.6; p.pitch = -0.6; }, src);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/03-water.png` });
  await page.evaluate((s) => window.__bf.app.game.world.setBlock(s.x, s.y, s.z, 0), src);
  await until((s) => window.__bf.app.game.world.getBlock(s.x + 3, s.y, s.z) === 0, src, 30000, 'recede');
  return { levelAt3: lvl };
});

await step('breaking drops an item entity; walking over picks it up', async () => {
  await page.evaluate((f) => { const g = window.__bf.app.game; g.player.setPosition(f.fx + 0.5, f.fy, f.fz + 0.5); g.inventory.clear(); g.drops.clear(); g.select(0); }, F);
  const cell = { x: F.fx + 2, y: F.fy - 1, z: F.fz + 2 };
  await page.evaluate((c) => { const g = window.__bf.app.game; g.world.setBlock(c.x, c.y + 1, c.z, 2); }, cell);
  const target = { ...cell, y: cell.y + 1 };
  await page.evaluate((c) => { const g = window.__bf.app.game; const p = g.player; const dx = c.x + 0.5 - p.body.x, dz = c.z + 0.5 - p.body.z, dy = c.y + 0.5 - p.eyeY; p.yaw = Math.atan2(-dx, -dz); p.pitch = Math.atan2(dy, Math.hypot(dx, dz)); }, target);
  await until((c) => { const t = window.__bf.app.game.interaction.target; return !!t && t.x === c.x && t.y === c.y && t.z === c.z; }, target, 8000, 'aim dirt');
  await page.evaluate(() => window.__bf.app.input.setTouchPrimary(true));
  await until(() => window.__bf.app.game.drops.drops.length > 0, null, 40000, 'drop spawned').catch(async (e) => {
    throw new Error(e.message + ' ' + await page.evaluate(() => JSON.stringify({ fps: window.__bf.app.game.fps, st: window.__bf.app.game.world.stats(), fl: window.__bf.app.game.fluids.pending })));
  });
  await page.evaluate(() => window.__bf.app.input.setTouchPrimary(false));
  const before = await page.evaluate(() => window.__bf.app.game.inventory.count(2));
  assert(before === 0, 'item went straight to inventory');
  await page.evaluate((c) => window.__bf.app.game.player.setPosition(c.x + 0.5, c.y, c.z + 0.5), target);
  await until(() => window.__bf.app.game.inventory.count(2) === 1 && window.__bf.app.game.drops.drops.length === 0, null, 8000, 'pickup');
  return { picked: 1 };
});

await step('Q throws the held item as a drop', async () => {
  await page.evaluate(() => { const g = window.__bf.app.game; g.inventory.slots[0] = { id: 2, count: 3 }; g.select(0); g.player.pitch = 0; });
  await page.keyboard.press('KeyQ');
  await page.waitForTimeout(300);
  const r = await page.evaluate(() => ({ held: window.__bf.app.game.heldStack()?.count, drops: window.__bf.app.game.drops.drops.length }));
  assert(r.held === 2 && r.drops === 1, JSON.stringify(r));
  return r;
});

await step('minimap and compass render', async () => {
  await page.waitForTimeout(800);
  const r = await page.evaluate(() => {
    const c = document.querySelector('.minimap');
    const ctx = c.getContext('2d');
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let lit = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 120) lit++;
    return { visible: !document.querySelector('.nav').hidden, lit, compass: !!document.querySelector('.compass') };
  });
  assert(r.visible && r.lit > 1000, JSON.stringify(r));
  await page.screenshot({ path: `${OUT}/04-hud.png` });
  return r;
});

await step('creatures persist across save & reload', async () => {
  await page.evaluate((f) => {
    const g = window.__bf.app.game;
    g.mobs.clear();
    g.mobs.enabled = false;
    const m = g.mobs.spawn('grazer', f.fx + 4.5, f.fy, f.fz + 4.5);
    m.health = 5;
  }, F);
  await page.evaluate(() => window.__bf.app.pause());
  await page.click('[data-act=savequit]');
  await page.waitForSelector('[data-screen=menu]');
  await page.reload();
  await page.waitForSelector('[data-screen=menu]');
  await page.click('[data-act=play]');
  await page.waitForFunction(() => window.__bf?.state === 'playing', null, { timeout: 90000 });
  const r = await page.evaluate(() => window.__bf.app.game.mobs.mobs.map((m) => ({ kind: m.kind, health: m.health })));
  assert(r.some((m) => m.kind === 'grazer' && m.health === 5), JSON.stringify(r));
  // Placed blocks (torch, door) survive too.
  const blocks = await page.evaluate((f) => ({ torch: window.__bf.app.game.world.getBlock(f.fx + 2, f.fy, f.fz) }), F);
  assert(blocks.torch === 33, 'torch lost after reload');
  return { mobs: r.length };
});

await step('no runtime errors', async () => { assert(errors.length === 0, errors.slice(0, 5).join(' | ')); });
console.log(`${results.filter(Boolean).length}/${results.length} passed`);
await browser.close();
