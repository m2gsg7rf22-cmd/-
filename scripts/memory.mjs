// Long-travel memory/stability test: geometry count, loaded chunks and heap must plateau.
import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-precise-memory-info', '--js-flags=--expose-gc'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(process.env.URL || 'http://localhost:4173/');
await page.waitForSelector('[data-screen=menu]');
await page.click('[data-act=new]');
await page.fill('[name=seed]', 'memory');
await page.click('[data-act=create]');
await page.waitForFunction(() => window.__bf?.state === 'playing', null, { timeout: 90000 });
const samples = await page.evaluate(async () => {
  const g = window.__bf.app.game;
  g.creative = g.player.creative = true;
  g.player.flying = true;
  const out = [];
  const x0 = g.player.body.x;
  for (let step = 0; step <= 75; step++) {
    // ~22 blocks/s sprint-flight speed, in 1s hops, along a diagonal through new terrain.
    g.player.setPosition(x0 + step * 20, 100, step * 8);
    await new Promise((r) => setTimeout(r, 1000));
    if (step % 15 === 0) {
      window.gc?.();
      const s = g.world.stats();
      const i = window.__bf.app.r.info();
      out.push({ step, loaded: s.loaded, meshed: s.meshed, geos: i.geometries, heapMB: Math.round((performance.memory?.usedJSHeapSize ?? 0) / 1048576), mobs: g.mobs.mobs.length });
    }
  }
  return out;
});
console.table(samples);
const first = samples[1], last = samples[samples.length - 1];
const geoGrowth = last.geos / first.geos;
const ok = last.loaded < 200 && geoGrowth < 1.6 && errors.length === 0;
console.log(ok ? 'PASS memory plateau' : 'FAIL memory growth', { geoGrowth: geoGrowth.toFixed(2), errors });
await browser.close();
process.exit(ok ? 0 : 1);
