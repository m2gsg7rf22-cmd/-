#!/usr/bin/env node
// GameForge automated playtester. Drives a game through window.__GF hooks with a JSON
// scenario (<project>/playtest.json), asserts on game state, checks for runtime errors,
// verifies the canvas is not blank, measures performance and captures screenshots.
// Usage: node tools/playtest.mjs <game-dir> [--quality low|medium|high] [--shots dir] [--query 'a=1&b=2'] [--scenario other.json] [--headed]
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser } from './lib/playwright.mjs';
import { serve } from './serve.mjs';

function get(obj, p) { return p.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj); }
const OPS = { '<': (a, b) => a < b, '<=': (a, b) => a <= b, '>': (a, b) => a > b, '>=': (a, b) => a >= b, '==': (a, b) => a === b, '!=': (a, b) => a !== b, 'truthy': (a) => !!a, 'falsy': (a) => !a, 'includes': (a, b) => Array.isArray(a) ? a.includes(b) : String(a).includes(b) };

export async function playtest(gameDir, { quality, shotsDir, serveRoot, file = null, resultsName = 'test-results.json', log = console.log, query = '', scenarioFile = 'playtest.json' } = {}) {
  gameDir = path.resolve(gameDir);
  const scenario = JSON.parse(fs.readFileSync(path.join(gameDir, scenarioFile), 'utf8'));
  if (scenarioFile !== 'playtest.json' && resultsName === 'test-results.json') resultsName = `test-results.${path.basename(scenarioFile, '.json')}.json`;
  const root = path.resolve(serveRoot || scenario.serveRoot ? path.resolve(gameDir, scenario.serveRoot || '.') : gameDir);
  const rel = path.relative(root, gameDir).split(path.sep).join('/');
  const q = quality || scenario.quality || 'low';
  shotsDir = shotsDir || path.join(gameDir, 'screenshots');
  fs.mkdirSync(shotsDir, { recursive: true });
  const server = await serve(root, 0, { quiet: true });
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: scenario.viewport || { width: 1280, height: 720 } });
  const errors = [], warnings = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); else if (m.type() === 'warning') warnings.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  const results = { game: scenario.name || path.basename(gameDir), quality: q, startedAt: new Date().toISOString(), checks: [], screenshots: [], metrics: null, errors, passed: false };
  const check = (label, ok, detail) => { results.checks.push({ label, ok: !!ok, detail }); log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail !== undefined ? '  (' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) + ')' : ''}`); };
  const t0 = Date.now();
  try {
    const url = file ? `file://${path.resolve(file)}?quality=${q}&test=1${query ? '&' + query : ''}` : `http://127.0.0.1:${server.address().port}/${rel ? rel + '/' : ''}${scenario.url || 'index.html'}?quality=${q}&test=1${query ? '&' + query : ''}`;
    results.url = file ? 'file://' + path.basename(file) : (scenario.url || 'index.html');
    await page.goto(url);
    await page.waitForFunction(() => window.__GF && window.__GF.ready, null, { timeout: scenario.loadTimeout || 120000 });
    results.loadMs = Date.now() - t0;
    check('game boots and exposes window.__GF', true, `${results.loadMs} ms`);
    await page.evaluate(() => window.__GF.pause());
    for (const st of scenario.steps) {
      const rep = st.repeat || 1;
      for (let r = 0; r < rep; r++) {
        switch (st.do) {
          case 'call': await page.evaluate(([fn, args]) => window.__GF[fn](...(args || [])), [st.fn, st.args]); break;
          case 'step': await page.evaluate((n) => window.__GF.step(n), st.frames || 1); break;
          case 'hold': await page.evaluate(([a, v]) => window.__GF.hold(a, v), [st.action, st.value ?? 1]); break;
          case 'release': await page.evaluate((a) => (a ? window.__GF.release(a) : window.__GF.releaseAll()), st.action); break;
          case 'press': await page.evaluate(([a, f]) => window.__GF.press(a, f), [st.action, st.frames || 2]); if (st.every) await page.evaluate((n) => window.__GF.step(n), st.every); break;
          case 'look': await page.evaluate(([x, y]) => window.__GF.look(x, y), [st.x || 0, st.y || 0]); break;
          case 'eval': await page.evaluate(st.js); break;
          case 'key': await page.keyboard.press(st.key); break;
          case 'click': await page.click(st.selector, { timeout: 10000 }); break;
          case 'expect': {
            const state = await page.evaluate(() => window.__GF.state());
            const v = st.js ? await page.evaluate(st.js) : get(state, st.path);
            if (r === rep - 1) check(st.label || `${st.path} ${st.op} ${st.value}`, OPS[st.op](v, st.value), v);
            break;
          }
          case 'screenshot': {
            await page.evaluate(() => window.__GF.render());
            const file = path.join(shotsDir, `${st.name}.png`);
            await page.screenshot({ path: file, timeout: 120000 });
            results.screenshots.push(path.relative(gameDir, file));
            break;
          }
          case 'canvas': {
            const stats = await page.evaluate(() => {
              window.__GF.render();
              const src = window.__GF.app?.renderer?.domElement || document.querySelector('canvas'); const c = document.createElement('canvas'); c.width = 96; c.height = 54;
              const x = c.getContext('2d'); x.drawImage(src, 0, 0, 96, 54); const d = x.getImageData(0, 0, 96, 54).data;
              let sum = 0, sq = 0; const cols = new Set();
              for (let i = 0; i < d.length; i += 4) { const l = (d[i] + d[i + 1] + d[i + 2]) / 3; sum += l; sq += l * l; cols.add((d[i] >> 4) << 8 | (d[i + 1] >> 4) << 4 | (d[i + 2] >> 4)); }
              const n = d.length / 4, mean = sum / n; return { mean: +mean.toFixed(1), std: +Math.sqrt(sq / n - mean * mean).toFixed(1), colors: cols.size };
            });
            check(st.label || 'canvas renders a non-blank, detailed image', stats.std > (st.minStd ?? 12) && stats.colors > (st.minColors ?? 60) && stats.mean > 8 && stats.mean < 248, stats);
            break;
          }
          default: throw new Error('unknown step ' + st.do);
        }
      }
    }
    // performance sample in real-time mode
    await page.evaluate(() => window.__GF.resume());
    await page.waitForTimeout(scenario.perfSampleMs || 3000);
    results.metrics = await page.evaluate(() => window.__GF.metrics());
    await page.evaluate(() => window.__GF.pause());
    check('no runtime errors', errors.length === 0, errors.slice(0, 3).join(' | ') || 'none');
  } catch (e) {
    check('scenario executed without exceptions', false, e.message + (errors.length ? ' | page errors: ' + errors.slice(0, 3).join(' | ') : ''));
  } finally {
    await browser.close(); server.close();
  }
  results.durationMs = Date.now() - t0;
  results.passed = results.checks.every((c) => c.ok);
  results.summary = `${results.checks.filter((c) => c.ok).length}/${results.checks.length} checks passed`;
  fs.writeFileSync(path.join(gameDir, resultsName), JSON.stringify(results, null, 2));
  return results;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const opt = (k) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : undefined; };
  const dirs = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
  let failed = 0;
  for (const d of dirs) {
    console.log(`\n▶ Playtest ${d}`);
    const r = await playtest(d, { quality: opt('quality'), shotsDir: opt('shots'), serveRoot: opt('root'), file: opt('file'), query: opt('query'), scenarioFile: opt('scenario') || 'playtest.json', resultsName: opt('file') ? 'test-results.dist.json' : 'test-results.json' });
    console.log(`  ${r.passed ? '✔' : '✘'} ${r.summary} in ${(r.durationMs / 1000).toFixed(1)}s  metrics=${JSON.stringify(r.metrics)}`);
    if (!r.passed) failed++;
  }
  process.exit(failed ? 1 : 0);
}
