#!/usr/bin/env node
// Visual check for foot IK + ragdoll: renders sandbox/ik.html views and writes screenshots and
// metrics to docs/benchmarks/ik/.   node tools/bench-ik.mjs [--style stylized] [--clip walk]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from './lib/playwright.mjs';
import { serve } from './serve.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const out = path.resolve(opt('out', path.join(ROOT, 'docs/benchmarks/ik'))); fs.mkdirSync(out, { recursive: true });
const style = opt('style', ''), clip = opt('clip', 'idle');
const server = await serve(ROOT, 0, { quiet: true });
const br = await launchBrowser();
const report = { views: {}, checks: [] };
const suffix = (style ? '-' + style : '') + (clip !== 'idle' ? '-' + clip : '');
for (const view of (opt('views', 'all,slope,feet,steps,ragdoll,ragside')).split(',')) {
  const page = await br.newPage({ viewport: { width: 1600, height: 900 } }); const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/sandbox/ik.html?view=${view}&clip=${clip}${style ? '&style=' + style : ''}&t=${opt('t', 12)}`);
  await page.waitForFunction(() => window.__frames > 4, null, { timeout: 300000 });
  const file = path.join(out, `${view}${suffix}.jpg`); await page.screenshot({ path: file, type: 'jpeg', quality: 88 });
  report.views[view] = file; if (errs.length) report.errors = errs;
  if (!report.ik) { report.ik = await page.evaluate(() => window.__ik); report.ragdoll = await page.evaluate(() => window.__ragdoll); }
  await page.close();
}
await br.close(); server.close();
const chk = (name, pass, detail) => report.checks.push({ name, pass: !!pass, detail });
const on = report.ik.filter((a) => a.ik), off = report.ik.filter((a) => !a.ik);
const err = (a) => Math.max(...a.ankleAboveGround.map((h) => Math.abs(h - a.ankleAboveGround.reduce((s, x) => Math.min(s, x), Infinity))));
chk('IK on: both ankles at the same height above their ground (≤ 2 cm)', on.every((a) => err(a) <= 0.02), on.map((a) => a.ankleAboveGround.join('/')).join('  '));
chk('IK on: no ankle below its ground', on.every((a) => Math.min(...a.ankleAboveGround) > 0.02), on.map((a) => Math.min(...a.ankleAboveGround)).join(', '));
chk('IK off shows the problem (one foot floats or sinks ≥ 4 cm)', off.every((a) => err(a) >= 0.04), off.map((a) => a.ankleAboveGround.join('/')).join('  '));
chk('ragdoll settled on the ground', report.ragdoll.settled && report.ragdoll.minClearance > -0.01 && report.ragdoll.top < 0.5, JSON.stringify(report.ragdoll));
chk('ragdoll bone lengths within 2%', report.ragdoll.lengthError < 0.02, String(report.ragdoll.lengthError));
chk('no page errors', !report.errors, (report.errors || ['none'])[0]);
fs.writeFileSync(path.join(out, `metrics${suffix}.json`), JSON.stringify(report, null, 2));
for (const c of report.checks) console.log(`  ${c.pass ? 'PASS' : 'FAIL'}  ${c.name}  (${c.detail})`);
for (const f of Object.values(report.views)) console.log('  shot: ' + f);
process.exitCode = report.checks.every((c) => c.pass) ? 0 : 1;
