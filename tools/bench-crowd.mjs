#!/usr/bin/env node
// Crowd budget benchmark: 50 pedestrians in the open-world integration scene, measured with one
// plain render (renderer.info, shadow pass included) per LOD mode:
//   realistic  every pedestrian is a realistic crowd-LOD human clone
//   mannequin  every pedestrian is a stylized mannequin (1 shared material)
//   lod        the default ladder (<= 6 realistic within 14 m, mannequins to 60 m, hidden beyond)
// Writes docs/benchmarks/crowd/metrics.json.   node tools/bench-crowd.mjs [--quality low|medium|high] [--count 50]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from './lib/playwright.mjs';
import { serve } from './serve.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const quality = opt('quality', 'low'), count = +opt('count', 50);
const server = await serve(ROOT, 0, { quiet: true });
const browser = await launchBrowser();
const out = { quality, count, modes: {} };
try {
  for (const mode of ['realistic', 'mannequin', 'lod']) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/tests/scenes/open-world/index.html?quality=${quality}&test=1&count=${count}`);
    await page.waitForFunction(() => window.__GF && window.__GF.ready, null, { timeout: 240000 });
    await page.evaluate(() => { window.__GF.pause(); window.__GF.cheat.setHour(12); window.__GF.step(2); });
    const t0 = Date.now();
    const r = await page.evaluate((m) => window.__GF.cheat.bench(m), mode);
    r.lodSwitchMs = Date.now() - t0; // includes building clones/mannequins on first use
    // simulation + animation cost per frame for this crowd (CPU, software renderer: relative only)
    r.stepMs = await page.evaluate(() => { const t = performance.now(); window.__GF.step(30); return +((performance.now() - t) / 30).toFixed(2); });
    r.errors = errors.length;
    out.modes[mode] = r;
    console.log(mode.padEnd(10), JSON.stringify(r));
    await page.close();
  }
} finally { await browser.close(); server.close(); }
const dir = path.join(ROOT, 'docs/benchmarks/crowd'); fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'metrics.json'), JSON.stringify({ date: new Date().toISOString(), ...out }, null, 2));
console.log('wrote docs/benchmarks/crowd/metrics.json');
