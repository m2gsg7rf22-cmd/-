// Dimension QA: rift portals to Emberdeep and back, the Void Gate to Voidreach and back, magma,
// death in another dimension, rift collapse, saving/reloading in Emberdeep, new creatures, mining feedback.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const URL_ = process.env.URL || 'http://localhost:4173/';
const OUT = 'qa-output/dimensions';
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
  const st = await page.evaluate(() => ({ state: window.__bf?.state, dim: window.__bf?.app.game?.dim }));
  throw new Error('timeout: ' + what + ' ' + JSON.stringify(st));
}
const playingIn = (dim, timeout = 120000) => until((d) => window.__bf?.state === 'playing' && window.__bf.app.game?.dim === d && !window.__bf.app.travelling, dim, timeout, 'playing in ' + dim);
async function aim(cell, face) {
  await page.evaluate(({ cell, face }) => {
    const p = window.__bf.app.game.player;
    const tx = cell.x + 0.5 + face[0] * 0.5, ty = cell.y + 0.5 + face[1] * 0.5, tz = cell.z + 0.5 + face[2] * 0.5;
    const dx = tx - p.body.x, dy = ty - p.eyeY, dz = tz - p.body.z;
    p.yaw = Math.atan2(-dx, -dz);
    p.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  }, { cell, face });
  await until((c) => { const t = window.__bf.app.game.interaction.target; return !!t && t.x === c.x && t.y === c.y && t.z === c.z; }, cell, 8000, 'aim');
}
async function useOn(cell, face) {
  await aim(cell, face);
  await page.evaluate(() => window.__bf.app.input.triggerEvent('secondaryDown'));
  await until(() => !window.__bf.app.game.interaction.placeQueued, null, 15000, 'use processed');
  await page.waitForTimeout(200);
}
/** Flat stone pad with clear air around the player (survival world, so blocks don't come from terrain luck). */
const pad = () => page.evaluate(() => {
  const g = window.__bf.app.game;
  const b = g.player.body;
  const fx = Math.floor(b.x), fy = Math.floor(b.y), fz = Math.floor(b.z);
  for (let dx = -7; dx <= 7; dx++) for (let dz = -7; dz <= 7; dz++) {
    g.world.setBlock(fx + dx, fy - 1, fz + dz, 3, false);
    for (let dy = 0; dy <= 7; dy++) g.world.setBlock(fx + dx, fy + dy, fz + dz, 0, false);
  }
  g.player.setPosition(fx + 0.5, fy, fz + 0.5);
  return { fx, fy, fz };
});

await page.goto(URL_);
await page.waitForSelector('[data-screen=menu]');
await page.click('[data-act=new]');
await page.fill('[name=seed]', 'dimensions');
await page.click('[data-act=create]');
await playingIn('overworld');
// Software GL is slow: keep adaptive quality from switching particles off mid-test.
await page.evaluate(() => { const a = window.__bf.app; a.settings.adaptive = false; const g = a.game; g.mobs.enabled = false; g.mobs.clear(); });
let F = await pad();
await page.waitForTimeout(1200);
let home;

await step('Ember Striker lights a Duskstone frame (2x3 interior)', async () => {
  // Frame 4 wide x 5 tall along x, 3 blocks in front of the player.
  const r = await page.evaluate((f) => {
    const g = window.__bf.app.game;
    const z = f.fz - 3;
    for (let dx = -1; dx <= 2; dx++) { g.world.setBlock(f.fx + dx, f.fy - 1, z, 73); g.world.setBlock(f.fx + dx, f.fy + 3, z, 73); }
    for (let dy = 0; dy < 3; dy++) { g.world.setBlock(f.fx - 1, f.fy + dy, z, 73); g.world.setBlock(f.fx + 2, f.fy + dy, z, 73); }
    g.inventory.clear();
    g.inventory.slots[0] = { id: 272, count: 1 };
    g.select(0);
    return { z };
  }, F);
  // Strike the top face of the bottom frame block, inside the frame.
  await useOn({ x: F.fx, y: F.fy - 1, z: r.z }, [0, 1, 0]);
  const cells = await page.evaluate(({ f, z }) => {
    const g = window.__bf.app.game;
    let n = 0;
    for (let dx = 0; dx < 2; dx++) for (let dy = 0; dy < 3; dy++) if (g.world.getBlock(f.fx + dx, f.fy + dy, z) === 74) n++;
    return n;
  }, { f: F, z: r.z });
  assert(cells === 6, `rift cells ${cells}`);
  await page.screenshot({ path: `${OUT}/01-rift.png` });
  home = { x: F.fx, y: F.fy, z: r.z };
  return { cells };
});

await step('an open frame (missing side) does not light', async () => {
  const lit = await page.evaluate((f) => {
    const g = window.__bf.app.game;
    const z = f.fz + 3;
    for (let dx = -1; dx <= 2; dx++) { g.world.setBlock(f.fx + dx, f.fy - 1, z, 73); g.world.setBlock(f.fx + dx, f.fy + 3, z, 73); }
    for (let dy = 0; dy < 3; dy++) g.world.setBlock(f.fx - 1, f.fy + dy, z, 73); // right side missing
    return z;
  }, F);
  await useOn({ x: F.fx, y: F.fy - 1, z: lit }, [0, 1, 0]);
  const n = await page.evaluate(({ f, z }) => { const g = window.__bf.app.game; return [0, 1].filter((dx) => g.world.getBlock(f.fx + dx, f.fy, z) === 74).length; }, { f: F, z: lit });
  assert(n === 0, 'open frame lit');
});

await step('standing in the rift travels to Emberdeep and arrives inside a linked rift', async () => {
  await page.evaluate((h) => { const p = window.__bf.app.game.player; p.setPosition(h.x + 0.5, h.y, h.z + 0.5); }, home);
  await until(() => parseFloat(getComputedStyle(document.getElementById('overlay-rift')).opacity) > 0.2, null, 8000, 'rift overlay');
  await playingIn('emberdeep');
  await page.waitForTimeout(1500);
  const r = await page.evaluate(() => {
    const g = window.__bf.app.game;
    const b = g.player.body;
    const id = g.world.getBlock(b.x, b.y + 0.2, b.z);
    return { id, link: g.meta.emberLink, pos: [b.x, b.y, b.z].map((v) => +v.toFixed(1)), back: g.meta.dimPos?.overworld };
  });
  assert(r.id === 74 || r.id === 75, 'not standing in a rift: ' + r.id);
  assert(r.link && r.back, 'link/back missing ' + JSON.stringify(r));
  await page.screenshot({ path: `${OUT}/02-emberdeep.png` });
  return r;
});

await step('the player does not bounce straight back (rift lock until stepping out)', async () => {
  await page.waitForTimeout(3500);
  const dim = await page.evaluate(() => window.__bf.app.game.dim);
  assert(dim === 'emberdeep', 'bounced back to ' + dim);
});

await step('Emberdeep terrain: magma sea, cinderrock, glowcaps, light from magma', async () => {
  const r = await page.evaluate(() => {
    const g = window.__bf.app.game;
    const b = g.player.body;
    const counts = {};
    for (let x = -24; x <= 24; x += 2) for (let z = -24; z <= 24; z += 2) for (let y = 1; y < 127; y++) {
      const id = g.world.getBlock(b.x + x, y, b.z + z);
      counts[id] = (counts[id] ?? 0) + 1;
    }
    return { magma: (counts[71] ?? 0) + (counts[88] ?? 0), cinder: counts[68] ?? 0, glowcap: counts[70] ?? 0, roof: counts[20] ?? 0 };
  });
  assert(r.magma > 0 && r.cinder > 100 && r.roof > 0, JSON.stringify(r));
  return r;
});

await step('magma burns the player in survival', async () => {
  const r = await page.evaluate(() => {
    const g = window.__bf.app.game;
    const b = g.player.body;
    // Find a magma surface nearby and drop the player into it.
    for (let x = -30; x <= 30; x++) for (let z = -30; z <= 30; z++) for (let y = 20; y < 40; y++) {
      if (g.world.getBlock(b.x + x, y, b.z + z) === 71 && g.world.getBlock(b.x + x, y + 1, b.z + z) === 0) {
        const back = { x: b.x, y: b.y, z: b.z };
        g.player.setPosition(Math.floor(b.x + x) + 0.5, y, Math.floor(b.z + z) + 0.5);
        return { back, h0: g.player.health };
      }
    }
    return null;
  });
  assert(r, 'no magma surface found');
  await until(() => window.__bf.app.game.player.health < 18, null, 8000, 'burn damage');
  const st = await page.evaluate(() => ({ h: window.__bf.app.game.player.health, inMagma: window.__bf.app.game.player.inMagma }));
  await page.evaluate((r) => { const g = window.__bf.app.game; g.player.setPosition(r.back.x, r.back.y, r.back.z); g.player.health = 20; }, r);
  return st;
});

await step('stepping out and back into the rift returns to the overworld portal', async () => {
  await page.evaluate(() => {
    const g = window.__bf.app.game;
    const l = g.meta.emberLink;
    g.player.setPosition(l.x + 0.5, l.y, l.z + 1.6); // step out
  });
  await page.waitForTimeout(500);
  await page.evaluate(() => { const g = window.__bf.app.game; const l = g.meta.emberLink; g.player.setPosition(l.x + 0.5, l.y, l.z + 0.5); });
  await playingIn('overworld');
  await page.waitForTimeout(800);
  const r = await page.evaluate(() => { const b = window.__bf.app.game.player.body; return { x: b.x, y: b.y, z: b.z }; });
  const d = Math.hypot(r.x - (home.x + 0.5), r.z - (home.z + 0.5));
  assert(d < 3, `arrived ${d.toFixed(1)} blocks from the home portal`);
  return { d: d.toFixed(2) };
});

await step('breaking the frame collapses the rift', async () => {
  const n = await page.evaluate((h) => {
    const g = window.__bf.app.game;
    g.world.setBlock(h.x - 1, h.y + 1, h.z, 0);
    let left = 0;
    for (let dx = 0; dx < 2; dx++) for (let dy = 0; dy < 3; dy++) if (g.world.getBlock(h.x + dx, h.y + dy, h.z) === 74) left++;
    return left;
  }, home);
  assert(n === 0, `${n} rift blocks left`);
});

await step('Void Gate travels to Voidreach; the return gate there brings the player home', async () => {
  F = await pad();
  await page.evaluate((f) => { const g = window.__bf.app.game; g.world.setBlock(f.fx, f.fy, f.fz - 2, 84); g.inventory.clear(); }, F);
  await page.waitForTimeout(400);
  await useOn({ x: F.fx, y: F.fy, z: F.fz - 2 }, [0, 0, 1]);
  await playingIn('voidreach');
  await page.waitForTimeout(1500);
  const r = await page.evaluate(() => {
    const g = window.__bf.app.game;
    const gate = g.world.gen.gateCell();
    return { gate, id: g.world.getBlock(gate.x, gate.y, gate.z), pos: [g.player.body.x, g.player.body.y].map((v) => +v.toFixed(1)), onGround: g.player.onGround };
  });
  assert(r.id === 84, 'no return gate at ' + JSON.stringify(r.gate));
  await page.screenshot({ path: `${OUT}/03-voidreach.png` });
  await page.evaluate(() => { const g = window.__bf.app.game; g.player.setPosition(2.5, g.world.gen.gateCell().y, 0.5); });
  await page.waitForTimeout(300);
  await useOn(r.gate, [-1, 0, 0]);
  await playingIn('overworld');
  const d = await page.evaluate((f) => { const b = window.__bf.app.game.player.body; return Math.hypot(b.x - f.fx, b.z - f.fz); }, F);
  assert(d < 26, 'returned far away: ' + d);
  return { gate: r.gate, back: d.toFixed(1) };
});

await step('death in another dimension respawns at the overworld spawn', async () => {
  await page.evaluate(() => window.__bf.app.travel('emberdeep', 'rift'));
  await playingIn('emberdeep');
  await page.waitForTimeout(800);
  await page.evaluate(() => { const g = window.__bf.app.game; g.player.hurtCooldown = 0; g.player.hurt(40, 'magma'); });
  await page.waitForSelector('[data-screen=death]');
  const txt = await page.textContent('[data-screen=death]');
  await page.click('[data-act=respawn]');
  await playingIn('overworld');
  const r = await page.evaluate(() => { const g = window.__bf.app.game; const b = g.player.body; const s = g.player.spawn; return { d: Math.hypot(b.x - s.x, b.z - s.z), h: g.player.health, dead: g.player.dead }; });
  assert(r.d < 3 && r.h === 20 && !r.dead, JSON.stringify(r));
  return { ...r, txt: txt.slice(0, 60) };
});

await step('saving in Emberdeep and reloading the page continues in Emberdeep', async () => {
  await page.evaluate(() => window.__bf.app.travel('emberdeep', 'rift'));
  await playingIn('emberdeep');
  await page.waitForTimeout(800);
  const before = await page.evaluate(async () => { const g = window.__bf.app.game; await g.save(); const b = g.player.body; return { x: b.x, y: b.y, z: b.z, id: g.meta.id }; });
  await page.reload();
  await page.waitForSelector('[data-screen=menu]');
  await page.click('[data-act=play]'); // resumes the most recently played world
  await playingIn('emberdeep');
  const after = await page.evaluate(() => { const b = window.__bf.app.game.player.body; return { x: b.x, y: b.y, z: b.z }; });
  const d = Math.hypot(after.x - before.x, after.y - before.y, after.z - before.z);
  assert(d < 1.5, 'position drift ' + d);
  return { d: d.toFixed(2) };
});

await step('new creatures spawn in their dimensions and render', async () => {
  const r = await page.evaluate(() => {
    const g = window.__bf.app.game;
    g.mobs.clear();
    g.mobs.enabled = true;
    g.mobs.maxHostile = 6;
    return g.dim;
  });
  await until(() => window.__bf.app.game.mobs.mobs.length >= 2, null, 40000, 'emberdeep spawns');
  const kinds = await page.evaluate(() => [...new Set(window.__bf.app.game.mobs.mobs.map((m) => m.kind))]);
  assert(kinds.every((k) => ['hopper', 'wraith', 'emberhog'].includes(k)), 'wrong kinds ' + kinds);
  return { dim: r, kinds };
});

await step('creature line-up screenshot (all ten kinds)', async () => {
  await page.evaluate(() => window.__bf.app.travel('overworld', 'rift'));
  await playingIn('overworld');
  F = await pad();
  await page.evaluate((f) => {
    const g = window.__bf.app.game;
    g.mobs.clear();
    g.mobs.enabled = false;
    g.creative = true; g.player.creative = true;
    g.time = 0.25;
    const kinds = ['grazer', 'boar', 'featherback', 'crawler', 'bonewalker', 'hopper', 'wraith', 'emberhog', 'voidwalker', 'shardling'];
    kinds.forEach((k, i) => {
      const m = g.mobs.spawn(k, f.fx - 6.75 + i * 1.5, f.fy, f.fz - 6);
      m.yaw = 0;
    });
    g.player.yaw = 0; g.player.pitch = -0.12;
  }, F);
  await page.evaluate(() => { const g = window.__bf.app.game; g.mobs.enabled = true; g.mobs.update(0.016, 1, false, 1); g.mobs.enabled = false; });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/04-creatures.png` });
});

await step('ranged creatures hurt the player with projectiles', async () => {
  const h = await page.evaluate((f) => {
    const g = window.__bf.app.game;
    g.mobs.clear();
    g.creative = false; g.player.creative = false;
    g.player.health = 20;
    g.time = 0.75; // night: Bonewalkers fade away in daylight
    g.mobs.spawn('bonewalker', f.fx + 0.5, f.fy, f.fz - 6); // inside the cleared pad, so terrain can't block its shots
    g.mobs.enabled = true;
    return g.player.health;
  }, F);
  await until(() => window.__bf.app.game.player.health < 20, null, 20000, 'projectile hit');
  await page.evaluate(() => { const g = window.__bf.app.game; g.mobs.clear(); g.mobs.enabled = false; g.player.health = 20; });
  return { h };
});

await step('mining: the arm swings, each strike throws chips and advances the crack', async () => {
  F = await pad();
  const cell = { x: F.fx + 2, y: F.fy - 1, z: F.fz };
  await page.evaluate((c) => { const g = window.__bf.app.game; g.world.setBlock(c.x, c.y, c.z, 2); g.inventory.clear(); g.select(0); g.caps.particles = true; g.applySettings(g.settings); g.creative = false; g.player.creative = false; }, cell);
  await aim(cell, [0, 1, 0]);
  await page.evaluate(() => window.__bf.app.input.setTouchPrimary(true));
  let maxParts = 0, swings = 0, maxStage = -1, broken = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 15000 && !broken) { // software GL can run at a few fps
    const s = await page.evaluate((c) => { const g = window.__bf.app.game; return { n: g.particles.mesh.count, sw: g.hand.swinging, stage: g.highlight.stage, id: g.world.getBlock(c.x, c.y, c.z) }; }, cell);
    maxParts = Math.max(maxParts, s.n);
    maxStage = Math.max(maxStage, s.stage);
    if (s.sw) swings++;
    if (s.stage >= 3 && maxStage < 4) await page.screenshot({ path: `${OUT}/05-mining.png` });
    broken = s.id === 0;
    await page.waitForTimeout(60);
  }
  await page.evaluate(() => window.__bf.app.input.setTouchPrimary(false));
  assert(maxParts > 0 && swings > 2 && maxStage >= 2 && broken, JSON.stringify({ maxParts, swings, maxStage, broken }));
  return { maxParts, swings, maxStage, broken };
});

await step('no runtime errors', async () => {
  assert(errors.length === 0, errors.slice(0, 5).join(' | '));
});

console.log(`${results.filter(Boolean).length}/${results.length} passed`);
await browser.close();
