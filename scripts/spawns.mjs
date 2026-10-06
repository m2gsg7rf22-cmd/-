// Spawn quality across random seeds: must stand on natural ground, not in leaves/water/blocks.
import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let bad = 0;
for (let i = 0; i < 8; i++) {
  const seed = 'spawn-' + Math.floor(Math.random() * 1e9);
  const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
  await page.goto(process.env.URL || 'http://localhost:4173/');
  await page.waitForSelector('[data-screen=menu]');
  await page.click('[data-act=new]'); await page.fill('[name=seed]', seed); await page.click('[data-act=create]');
  await page.waitForFunction(() => window.__bf?.state === 'playing', null, { timeout: 90000 });
  const r = await page.evaluate(() => {
    const g = window.__bf.app.game; const b = g.player.body; const w = g.world;
    return { below: w.getBlock(b.x, b.y - 0.5, b.z), feet: w.getBlock(b.x, b.y + 0.2, b.z), head: w.getBlock(b.x, b.y + 1.5, b.z) };
  });
  const ok = [1, 2, 3, 5, 7, 8, 31, 6].includes(r.below) && r.feet !== 12 && r.feet !== 14 && r.head !== 12 && r.head !== 14;
  if (!ok) bad++;
  console.log(ok ? 'OK ' : 'BAD', seed, JSON.stringify(r));
  await page.close();
}
console.log(bad ? `${bad} bad spawns` : 'all spawns OK');
await browser.close();
