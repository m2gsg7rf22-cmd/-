// BlockForge automated browser QA (desktop flow).
// Usage: npm run build && npx vite preview --port 4173 & node scripts/e2e.mjs
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const URL_ = process.env.URL || 'http://localhost:4173/';
const OUT = 'qa-output/e2e';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await context.newPage();
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`[console.error] ${m.text()}`);
});
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
page.on('requestfailed', (r) => errors.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`));
page.on('response', (r) => {
  if (r.status() >= 400) errors.push(`[http ${r.status()}] ${r.url()}`);
});

const results = [];
async function step(name, fn) {
  const t = Date.now();
  try {
    const detail = await fn();
    results.push({ name, pass: true, ms: Date.now() - t, detail });
    console.log(`PASS ${name}${detail ? ' — ' + JSON.stringify(detail) : ''}`);
  } catch (e) {
    results.push({ name, pass: false, ms: Date.now() - t, detail: String(e?.message ?? e) });
    console.log(`FAIL ${name} — ${e?.message ?? e}`);
    await page.screenshot({ path: `${OUT}/fail-${name.replace(/\W+/g, '_')}.png` }).catch(() => {});
  }
}
const assert = (c, msg) => {
  if (!c) throw new Error(msg);
};
const state = () => page.evaluate(() => window.__bf?.state);
/** Poll a page predicate (game time can run slower than wall time under software GL). */
async function until(fn, arg, timeout = 15000, what = 'condition') {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await page.evaluate(fn, arg)) return true;
    await page.waitForTimeout(60);
  }
  throw new Error(`timeout waiting for ${what}`);
}
const player = () =>
  page.evaluate(() => {
    const g = window.__bf.app.game;
    const p = g.player;
    return { x: p.body.x, y: p.body.y, z: p.body.z, yaw: p.yaw, pitch: p.pitch, onGround: p.onGround, health: p.health };
  });
const invCount = (id) => page.evaluate((id) => window.__bf.app.game.inventory.count(id), id);

await step('boot: main menu visible', async () => {
  await page.goto(URL_);
  await page.waitForSelector('[data-screen=menu]', { timeout: 15000 });
  await page.screenshot({ path: `${OUT}/01-menu.png` });
});

await step('create world (survival, seed)', async () => {
  await page.click('[data-act=new]');
  await page.fill('[name=name]', 'QA World');
  await page.fill('[name=seed]', 'qa-seed-42');
  await page.click('[data-act=create]');
  await page.waitForSelector('[data-screen=loading]', { timeout: 5000 });
  const stages = new Set();
  const t0 = Date.now();
  while ((await state()) !== 'playing') {
    const s = await page.evaluate(() => document.querySelector('.loading .stage')?.textContent);
    if (s) stages.add(s);
    if (Date.now() - t0 > 90000) throw new Error('world load timeout');
    await page.waitForTimeout(50);
  }
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/02-world.png` });
  const p = await player();
  assert(Number.isFinite(p.x + p.y + p.z), 'player position NaN');
  return { loadMs: Date.now() - t0, stages: [...stages], pos: [p.x.toFixed(1), p.y.toFixed(1), p.z.toFixed(1)] };
});

await step('spawn is safe (on ground, not inside blocks)', async () => {
  await page.waitForTimeout(1000);
  const r = await page.evaluate(() => {
    const g = window.__bf.app.game;
    const b = g.player.body;
    const w = g.world;
    const inside = w.isSolid(b.x, b.y + 0.5, b.z) || w.isSolid(b.x, b.y + 1.5, b.z);
    const below = w.getBlock(b.x, b.y - 0.5, b.z);
    return { inside, below, onGround: g.player.onGround, inWater: g.player.inWater };
  });
  assert(!r.inside, 'player inside blocks');
  assert(r.onGround, 'player not on ground after spawn');
  return r;
});

await step('pointer lock / click to play', async () => {
  await page.mouse.click(640, 360);
  await page.waitForTimeout(400);
  const locked = await page.evaluate(() => window.__bf.app.input.pointerLocked);
  return { locked };
});

await step('test fixture: clear a flat 15x15 platform around the player', async () => {
  // Controls tests must not depend on random terrain (trees/hills next to spawn).
  await page.evaluate(() => {
    const g = window.__bf.app.game;
    const b = g.player.body;
    const fx = Math.floor(b.x), fy = Math.floor(b.y), fz = Math.floor(b.z);
    for (let dx = -7; dx <= 7; dx++) for (let dz = -7; dz <= 7; dz++) {
      g.world.setBlock(fx + dx, fy - 1, fz + dz, 2, false); // dirt floor
      g.world.setBlock(fx + dx, fy - 2, fz + dz, 3, false);
      for (let dy = 0; dy <= 6; dy++) g.world.setBlock(fx + dx, fy + dy, fz + dz, 0, false);
    }
    g.player.setPosition(fx + 0.5, fy, fz + 0.5);
    window.__fixture = { fx, fy, fz };
  });
  await page.waitForTimeout(500);
});

await step('move forward (W)', async () => {
  const a = await player();
  await page.keyboard.down('KeyW');
  let b = a, d = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < 6000 && d <= 1.5) {
    await page.waitForTimeout(100);
    b = await player();
    d = Math.hypot(b.x - a.x, b.z - a.z);
  }
  await page.keyboard.up('KeyW');
  assert(d > 1.5, `moved only ${d.toFixed(2)}`);
  return { moved: d.toFixed(2) };
});

await step('strafe (A/D) and back (S)', async () => {
  for (const k of ['KeyA', 'KeyD', 'KeyS']) {
    const a = await player();
    await page.keyboard.down(k);
    let d = 0;
    const t0 = Date.now();
    while (Date.now() - t0 < 4000 && d <= 0.5) {
      await page.waitForTimeout(100);
      const b = await player();
      d = Math.hypot(b.x - a.x, b.z - a.z);
    }
    await page.keyboard.up(k);
    assert(d > 0.5, `${k} did not move`);
  }
});

await step('rotate camera (mouse)', async () => {
  const a = await player();
  const locked = await page.evaluate(() => window.__bf.app.input.pointerLocked);
  if (locked) {
    // Headless pointer lock doesn't synthesize movementX; dispatch real mousemove events with movement deltas.
    for (let i = 0; i < 10; i++) {
      await page.evaluate(() => document.dispatchEvent(new MouseEvent('mousemove', { movementX: 25, movementY: -5, bubbles: true })));
      await page.waitForTimeout(20);
    }
  } else {
    // Drag-look fallback path.
    await page.mouse.move(640, 360);
    await page.mouse.down();
    await page.mouse.move(800, 360, { steps: 8 });
    await page.mouse.up();
  }
  await page.waitForTimeout(200);
  const b = await player();
  const dy = Math.abs(b.yaw - a.yaw);
  assert(dy > 0.05, `camera did not rotate (${dy})`);
  assert(b.yaw < a.yaw, 'horizontal look inverted (moving mouse right must turn right)');
  assert(b.pitch > a.pitch || !locked, 'vertical look inverted (moving mouse up must look up)');
  return { yawDelta: dy.toFixed(3), locked };
});

await step('jump (Space)', async () => {
  await until(() => window.__bf.app.game.player.onGround, null, 8000, 'on ground before jump');
  const a = await player();
  await page.keyboard.down('Space');
  let maxY = a.y;
  const t0 = Date.now();
  while (Date.now() - t0 < 3000 && maxY - a.y < 1.0) {
    maxY = Math.max(maxY, (await player()).y);
    await page.waitForTimeout(30);
  }
  await page.keyboard.up('Space');
  await until(() => window.__bf.app.game.player.onGround, null, 10000, 'landing');
  assert(maxY - a.y > 0.5, `jump height ${maxY - a.y}`);
  return { height: (maxY - a.y).toFixed(2) };
});

await step('cannot jump through ceiling (head bump)', async () => {
  const r = await page.evaluate(() => {
    const g = window.__bf.app.game;
    const b = g.player.body;
    const c = { x: Math.floor(b.x), y: Math.floor(b.y) + 2, z: Math.floor(b.z) };
    g.world.setBlock(c.x, c.y, c.z, 3);
    return c;
  });
  await page.keyboard.down('Space');
  let maxY = 0;
  const y0 = (await player()).y;
  const t0 = Date.now();
  while (Date.now() - t0 < 1500) { maxY = Math.max(maxY, (await player()).y - y0); await page.waitForTimeout(30); }
  await page.keyboard.up('Space');
  await page.evaluate((c) => window.__bf.app.game.world.setBlock(c.x, c.y, c.z, 0), r);
  assert(maxY < 0.25, `rose ${maxY} under a 2-high ceiling`);
  await until(() => window.__bf.app.game.player.onGround, null, 8000, 'landing');
  return { rise: maxY.toFixed(3) };
});

let minedId = 0;
await step('mine block below (hold primary)', async () => {
  // Look straight down.
  await page.evaluate(() => {
    window.__bf.app.game.player.pitch = -1.5;
  });
  await until(() => !!window.__bf.app.game.interaction.target, null, 8000, 'target below');
  const before = await page.evaluate(() => {
    const g = window.__bf.app.game;
    const t = g.interaction.target;
    return t ? { x: t.x, y: t.y, z: t.z, id: g.world.getBlock(t.x, t.y, t.z) } : null;
  });
  assert(before, 'no target block below');
  minedId = before.id;
  const locked = await page.evaluate(() => window.__bf.app.input.pointerLocked);
  if (locked) {
    await page.mouse.down({ button: 'left' });
    const seen = await page.evaluate(() => window.__bf.app.input.primary);
    await until((b) => { const id = window.__bf.app.game.world.getBlock(b.x, b.y, b.z); return id === 0 || id === 10; }, before, 30000, 'block to break').catch(() => {});
    await page.mouse.up({ button: 'left' });
    if (!seen) throw new Error('primary not registered while mouse held');
  } else {
    await page.evaluate(() => window.__bf.app.input.setTouchPrimary(true));
    await page.waitForTimeout(6000);
    await page.evaluate(() => window.__bf.app.input.setTouchPrimary(false));
  }
  const after = await page.evaluate((b) => window.__bf.app.game.world.getBlock(b.x, b.y, b.z), before);
  if (!(after === 0 || after === 10)) {
    const diag = await page.evaluate(() => {
      const g = window.__bf.app.game;
      return { gameplay: g.input.gameplay, primary: g.input.primary, target: g.interaction.target, state: window.__bf.state, locked: g.input.pointerLocked, el: document.elementFromPoint(640, 360)?.id };
    });
    throw new Error(`block still there (${after}) diag=${JSON.stringify(diag)}`);
  }
  const total = await page.evaluate(() => window.__bf.app.game.inventory.toJSON().filter(Boolean).reduce((a, s) => a + s.count, 0));
  assert(total > 0, 'nothing collected');
  const inv = await page.evaluate(() => window.__bf.app.game.inventory.toJSON().filter(Boolean));
  return { mined: before, after, inv };
});

await step('place block (secondary)', async () => {
  await page.waitForTimeout(800);
  const slot = await page.evaluate(() => {
    const g = window.__bf.app.game;
    const i = g.inventory.slots.findIndex((s) => s && s.id < 256);
    return i;
  });
  assert(slot >= 0 && slot < 9, 'no placeable block in hotbar');
  await page.keyboard.press(`Digit${slot + 1}`);
  await page.evaluate(() => {
    // Restore the platform (mining dug a hole under the player) and recenter.
    const g = window.__bf.app.game;
    const { fx, fy, fz } = window.__fixture;
    for (let dx = -7; dx <= 7; dx++) for (let dz = -7; dz <= 7; dz++) g.world.setBlock(fx + dx, fy - 1, fz + dz, 2, false);
    g.player.setPosition(fx + 0.5, fy, fz + 0.5);
    g.player.yaw = 0;
    g.player.pitch = -0.6; // aim ~2 blocks ahead so the target cell never overlaps the body
  });
  await until(() => {
    const g = window.__bf.app.game; const t = g.interaction.target;
    return !!t && t.y === window.__fixture.fy - 1 && t.ny === 1 && t.dist > 2 && g.player.onGround;
  }, null, 10000, 'placement target on floor');
  const before = await page.evaluate(() => {
    const g = window.__bf.app.game;
    return { count: g.heldStack()?.count ?? 0, target: g.interaction.target };
  });
  assert(before.target, 'no target for placement');
  const locked = await page.evaluate(() => window.__bf.app.input.pointerLocked);
  await page.evaluate(() => { window.__ev = []; window.__bf.app.input.onEvent((e) => window.__ev.push(e)); document.addEventListener('mousedown', (e) => window.__ev.push('md' + e.button + ':' + e.target.id), { capture: true }); });
  if (locked) await page.mouse.click(640, 360, { button: 'right' });
  else await page.evaluate(() => window.__bf.app.input.triggerEvent('secondaryDown'));
  const trace = [];
  for (let i = 0; i < 10; i++) {
    trace.push(await page.evaluate(() => { const g = window.__bf.app.game; return `${g.heldStack()?.count ?? 0}/${g.input.primary ? 'P' : '-'}${g.input.secondary ? 'S' : '-'}`; }));
    await page.waitForTimeout(100);
  }
  console.log('place trace', trace.join(' '), await page.evaluate(() => JSON.stringify({ ev: window.__ev, paused: window.__bf.app.game.paused, dead: window.__bf.app.game.player.dead, pq: window.__bf.app.game.interaction.placeQueued, pt: window.__bf.app.game.interaction.placeTimer })));
  await until((c) => (window.__bf.app.game.heldStack()?.count ?? 0) !== c, before.count, 8000, 'placement').catch(() => {});
  const after = await page.evaluate(() => window.__bf.app.game.heldStack()?.count ?? 0);
  if (after !== before.count - 1) {
    const diag = await page.evaluate(() => {
      const g = window.__bf.app.game; const t = g.interaction.target; const b = g.player.body;
      const cell = t ? [t.x + t.nx, t.y + t.ny, t.z + t.nz] : null;
      return { held: g.heldStack(), sel: g.selected, t, cell, cellId: cell && g.world.getBlock(...cell), body: [b.x, b.y, b.z], pitch: g.player.pitch, gameplay: g.input.gameplay, secondary: g.input.secondary };
    });
    throw new Error(`count ${before.count} -> ${after} diag=${JSON.stringify(diag)} before=${JSON.stringify(before)}`);
  }
  return { before: before.count, after };
});

await step('cannot place block inside player', async () => {
  const c = await page.evaluate(() => {
    const g = window.__bf.app.game;
    const b = g.player.body;
    g.player.setPosition(Math.floor(b.x) + 0.5, b.y, Math.floor(b.z) + 0.5);
    g.inventory.slots[0] = { id: 3, count: 5 };
    g.select(0);
    g.player.pitch = -Math.PI / 2 + 0.02;
    return { x: Math.floor(b.x), y: Math.floor(b.y), z: Math.floor(b.z) };
  });
  // Wait until the crosshair targets the top face of the block under our feet.
  await until((c) => { const t = window.__bf.app.game.interaction.target; return !!t && t.x === c.x && t.y === c.y - 1 && t.z === c.z && t.ny === 1; }, c, 8000, 'target under feet');
  await page.evaluate(() => window.__bf.app.input.triggerEvent('secondaryDown'));
  await page.waitForTimeout(1200);
  const r = await page.evaluate((c) => {
    const g = window.__bf.app.game;
    return { atFeet: g.world.getBlock(c.x, c.y, c.z), count: g.inventory.slots[0]?.count };
  }, c);
  assert(r.atFeet === 0 && r.count === 5, `block placed inside player: ${JSON.stringify(r)}`);
  return r;
});

await step('inventory open + craft (log→planks→sticks)', async () => {
  await page.evaluate(() => window.__bf.app.game.inventory.add(11, 2)); // Ashwood Log
  await page.keyboard.press('KeyE');
  await page.waitForSelector('.inv-screen', { timeout: 3000 });
  assert((await state()) === 'inventory', 'state not inventory');
  // Gameplay input must be blocked while inventory is open.
  const p0 = await player();
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(400);
  await page.keyboard.up('KeyW');
  const p1 = await player();
  assert(Math.hypot(p1.x - p0.x, p1.z - p0.z) < 0.05, 'player moved while inventory open');
  await page.screenshot({ path: `${OUT}/03-inventory.png` });
  const planksBefore = await invCount(15);
  await page.click('[data-craft=planks_ash]');
  await page.waitForTimeout(100);
  const planks = await invCount(15);
  assert(planks === planksBefore + 4, `planks ${planksBefore} -> ${planks}`);
  await page.click('[data-craft=sticks]');
  const sticks = await invCount(256);
  assert(sticks >= 4, 'no sticks');
  return { planks: await invCount(15), sticks, logs: await invCount(11) };
});

await step('inventory move/swap by click', async () => {
  const before = await page.evaluate(() => window.__bf.app.game.inventory.toJSON());
  const from = before.findIndex((s) => s);
  const to = before.findIndex((s, i) => !s && i >= 9);
  await page.click(`[data-slot="${from}"]`);
  await page.click(`[data-slot="${to}"]`);
  const after = await page.evaluate(() => window.__bf.app.game.inventory.toJSON());
  assert(!after[from] && after[to] && after[to].id === before[from].id, 'move failed');
  await page.click(`[data-slot="${to}"]`);
  await page.click(`[data-slot="${from}"]`);
  return { from, to };
});

await step('close inventory (E)', async () => {
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(200);
  assert((await state()) === 'playing', 'did not return to playing');
  assert(!(await page.$('.inv-screen')), 'inventory still visible');
});

await step('pause (Esc) and resume', async () => {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  let s = await state();
  if (s !== 'paused') {
    // When pointer-locked, the first Esc only releases the lock (which also pauses).
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    s = await state();
  }
  assert(s === 'paused', `state ${s}`);
  await page.waitForSelector('[data-screen=pause]');
  await page.screenshot({ path: `${OUT}/04-pause.png` });
  const p0 = await player();
  await page.waitForTimeout(500);
  const p1 = await player();
  assert(Math.abs(p1.y - p0.y) < 0.01, 'gameplay advanced while paused');
  await page.click('[data-act=resume]');
  await page.waitForTimeout(300);
  assert((await state()) === 'playing', 'resume failed');
});

let savedPos;
let minedPos;
await step('save & quit', async () => {
  // Record a deterministic edit to verify after reload.
  minedPos = await page.evaluate(() => {
    const g = window.__bf.app.game;
    const b = g.player.body;
    const x = Math.floor(b.x) + 2, z = Math.floor(b.z) + 2;
    const y = g.world.surfaceY(x, z);
    g.world.setBlock(x, y, z, 30); // Slate Bricks
    return { x, y, z };
  });
  savedPos = await player();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  if ((await state()) !== 'paused') {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }
  await page.click('[data-act=savequit]');
  await page.waitForSelector('[data-screen=menu]', { timeout: 10000 });
});

await step('reload page and load saved world', async () => {
  await page.reload();
  await page.waitForSelector('[data-screen=menu]');
  await page.click('[data-act=worlds]');
  await page.waitForSelector('[data-screen=worlds]');
  await page.screenshot({ path: `${OUT}/05-worlds.png` });
  const names = await page.$$eval('.world-item .title', (els) => els.map((e) => e.textContent));
  assert(names.some((n) => n.includes('QA World')), 'world not listed');
  await page.click('.world-item [data-act=playw]');
  await page.waitForFunction(() => window.__bf?.state === 'playing', null, { timeout: 60000 });
  await page.waitForTimeout(1000);
  const p = await player();
  const d = Math.hypot(p.x - savedPos.x, p.z - savedPos.z);
  assert(d < 1, `position not restored (off by ${d.toFixed(2)})`);
  const planks = await invCount(15);
  const sticks = await invCount(256);
  assert(planks > 0 && sticks > 0, 'inventory not restored');
  const edit = await page.evaluate((m) => window.__bf.app.game.world.getBlock(m.x, m.y, m.z), minedPos);
  assert(edit === 30, `block edit not persisted (got ${edit})`);
  await page.screenshot({ path: `${OUT}/06-reloaded.png` });
  return { posError: d.toFixed(3), planks, sticks, edit };
});

await step('settings persisted across reload', async () => {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  if ((await state()) !== 'paused') {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }
  await page.click('[data-screen=pause] [data-act=settings]');
  await page.waitForSelector('[data-screen=settings]');
  await page.$eval('[data-range=fov]', (e) => {
    e.value = '90';
    e.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.click('[data-screen=settings] [data-act=back]');
  await page.click('[data-act=savequit]');
  await page.waitForSelector('[data-screen=menu]');
  await page.reload();
  await page.waitForSelector('[data-screen=menu]');
  const fov = await page.evaluate(() => window.__bf.app.settings.fov);
  assert(fov === 90, `fov ${fov}`);
  return { fov };
});

await step('walk across chunk borders incl. x=0/z=0 (streaming)', async () => {
  await page.click('[data-act=play]');
  await page.waitForFunction(() => window.__bf?.state === 'playing', null, { timeout: 60000 });
  const r = await page.evaluate(async () => {
    const g = window.__bf.app.game;
    g.creative = true;
    g.player.creative = true;
    g.player.flying = true;
    const samples = [];
    const start = { x: g.player.body.x, z: g.player.body.z };
    // Fly a path through the origin and well beyond, sampling world stats.
    const pts = [[-40, -40], [40, 40], [120, 40], [120, -120]];
    for (const [tx, tz] of pts) {
      g.player.setPosition(tx + 0.5, 110, tz + 0.5);
      const t0 = performance.now();
      const cx = Math.floor(tx / 16), cz = Math.floor(tz / 16);
      // Wait until the 3x3 chunks around the new position are meshed (streaming latency).
      while (performance.now() - t0 < 30000) {
        let ok = true;
        for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if (!g.world.isChunkMeshed(cx + dx, cz + dz)) ok = false;
        if (ok) break;
        await new Promise((res) => setTimeout(res, 100));
      }
      const s = g.world.stats();
      samples.push({ tx, tz, ms: Math.round(performance.now() - t0), loaded: s.loaded, meshed: s.meshed, tris: s.triangles });
    }
    g.player.setPosition(start.x, 110, start.z);
    return samples;
  });
  for (const s of r) assert(s.ms < 30000, `chunks around ${s.tx},${s.tz} never meshed`);
  // Loaded chunk count must stay bounded (unloading works).
  const max = Math.max(...r.map((s) => s.loaded));
  assert(max < 600, `too many chunks loaded: ${max}`);
  await page.screenshot({ path: `${OUT}/07-flight.png` });
  return r;
});

await step('death and respawn', async () => {
  const r = await page.evaluate(async () => {
    const g = window.__bf.app.game;
    g.creative = false;
    g.player.creative = false;
    g.player.flying = false;
    g.player.hurt(100, 'fall');
    await new Promise((res) => setTimeout(res, 300));
    return window.__bf.state;
  });
  assert(r === 'dead', `state ${r}`);
  await page.waitForSelector('[data-screen=death]');
  await page.screenshot({ path: `${OUT}/08-death.png` });
  await page.click('[data-act=respawn]');
  await page.waitForTimeout(1500);
  const p = await player();
  assert((await state()) === 'playing', 'not playing after respawn');
  assert(p.health === 20, 'health not restored');
  return { health: p.health };
});

await step('no console errors / failed requests', async () => {
  const relevant = errors.filter((e) => !e.includes('favicon'));
  assert(relevant.length === 0, relevant.slice(0, 10).join(' | '));
});

writeFileSync(`${OUT}/results.json`, JSON.stringify({ results, errors }, null, 2));
const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} steps passed`);
await browser.close();
process.exit(failed ? 1 : 0);
