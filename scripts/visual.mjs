// Visual tour: captures key scenes for manual inspection.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const OUT = 'qa-output/visual';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(process.env.URL || 'http://localhost:4173/');
await page.waitForSelector('[data-screen=menu]');
// Bump quality for screenshots.
await page.evaluate(() => { const a = window.__bf.app; a.setSettings({ ...a.settings, renderDistance: 6, ao: true, clouds: true, resolutionScale: 1, adaptive: false }); });
await page.click('[data-act=new]');
await page.fill('[name=seed]', process.env.SEED || 'visual-tour');
await page.click('[data-act=create]');
await page.waitForFunction(() => window.__bf?.state === 'playing', null, { timeout: 90000 });
const shot = async (name, setup, wait = 2500) => {
  await page.evaluate(setup);
  await page.waitForTimeout(wait);
  await page.screenshot({ path: `${OUT}/${name}.png` });
};
const settle = () => page.waitForFunction(() => { const s = window.__bf.app.game.world.stats(); return s.pending === 0; }, null, { timeout: 30000 }).catch(() => {});
await settle();
await shot('01-morning', () => { const g = window.__bf.app.game; g.time = 0.06; g.player.pitch = -0.05; });
await shot('02-noon', () => { const g = window.__bf.app.game; g.time = 0.25; g.player.yaw += 1.5; });
await shot('03-sunset', () => { const g = window.__bf.app.game; g.time = 0.49; g.player.yaw = -Math.PI / 2 + 0.3; g.player.pitch = 0.1; });
await shot('04-night', () => { const g = window.__bf.app.game; g.time = 0.75; g.player.pitch = 0.5; });
await shot('05-night-ground', () => { const g = window.__bf.app.game; g.time = 0.8; g.player.pitch = -0.2; });
// Overview from above.
await shot('06-aerial', () => { const g = window.__bf.app.game; g.time = 0.2; g.creative = true; g.player.creative = true; g.player.flying = true; const b = g.player.body; g.player.setPosition(b.x, 105, b.z); g.player.pitch = -0.5; }, 5000);
// Find water nearby and go under.
await shot('07-underwater', () => {
  const g = window.__bf.app.game; const b = g.player.body;
  for (let r = 0; r < 120; r += 2) for (let a = 0; a < 6.28; a += 0.2) {
    const x = Math.floor(b.x + Math.cos(a) * r), z = Math.floor(b.z + Math.sin(a) * r);
    if (g.world.getBlock(x, 47, z) === 10 && g.world.getBlock(x, 44, z) === 10) { g.player.setPosition(x + 0.5, 44.2, z + 0.5); g.player.flying = true; g.player.pitch = 0.1; return; }
  }
}, 3000);
await shot('08-water-surface', () => { const g = window.__bf.app.game; const b = g.player.body; g.player.setPosition(b.x, 50.5, b.z); g.player.pitch = -0.25; }, 2000);
// Cave: carve-free search for an air pocket underground.
await shot('09-cave', () => {
  const g = window.__bf.app.game; const b = g.player.body;
  for (let r = 0; r < 60; r += 3) for (let a = 0; a < 6.28; a += 0.3) {
    const x = Math.floor(b.x + Math.cos(a) * r), z = Math.floor(b.z + Math.sin(a) * r);
    for (let y = 20; y < 40; y++) if (g.world.getBlock(x, y, z) === 0 && g.world.getBlock(x, y + 1, z) === 0 && g.world.getBlock(x, y - 1, z) !== 0 && g.world.getBlock(x, y + 6, z) === 3) {
      g.player.setPosition(x + 0.5, y, z + 0.5); g.player.flying = true; g.player.pitch = 0; g.time = 0.25; return;
    }
  }
}, 3000);
// Mobs.
await shot('10-mobs', () => {
  const g = window.__bf.app.game; const b = g.player.body;
  const spot = g.world.findSafeSpot(b.x, b.z, 30) || { x: b.x, y: b.y, z: b.z };
  const s2 = spot;
  g.player.setPosition(s2.x, s2.y, s2.z); g.player.flying = false; g.player.yaw = 0; g.player.pitch = -0.15; g.time = 0.25;
  g.mobs.spawn('grazer', s2.x - 1.5, s2.y + 0.5, s2.z - 4);
  g.mobs.spawn('boar', s2.x + 1.5, s2.y + 0.5, s2.z - 4.5);
  g.mobs.spawn('crawler', s2.x, s2.y + 0.5, s2.z - 6.5);
}, 1200);
await shot('11-creative-inventory', () => { const a = window.__bf.app; a.openInventory(); }, 500);
await page.click('[data-tab=library]').catch(() => {});
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/12-library.png` });
await page.evaluate(() => window.__bf.app.closeInventory());
await shot('13-debug', () => { const g = window.__bf.app.game; g.debugOn = true; }, 1200);
console.log(errors.length ? errors.join('\n') : 'no errors');
await browser.close();
