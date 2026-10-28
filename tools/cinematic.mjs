#!/usr/bin/env node
// Cinematic review loop: build a *.cine.js script (set + actors + timeline), lint film grammar,
// render a storyboard (one frame per shot) with subtitles and per-frame framing checks.
//   node tools/gameforge.mjs cinematic <file.cine.js> [--out dir]
// A cine script: export default async ({ K, H, humanData, THREE }) => ({ set, actors: { id: Object3D }, cinematic })
// (see skills/gameforge/references/cinematics.md)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function reviewCinematic(file, { out, quiet = false } = {}) {
  if (!file) { console.log('usage: gameforge cinematic <file.cine.js> [--out dir]'); return { ok: false }; }
  file = path.resolve(file);
  const name = path.basename(file).replace(/\.cine\.m?js$|\.m?js$/, '');
  out = path.resolve(out || path.join(path.dirname(file), 'review')); fs.mkdirSync(out, { recursive: true });
  const { launchBrowser } = await import('./lib/playwright.mjs'); const { serve } = await import('./serve.mjs');
  const server = await serve(ROOT, 0, { quiet: true, aliases: { '/__cine/': path.dirname(file) } });
  const br = await launchBrowser(); const page = await br.newPage({ viewport: { width: 1800, height: 1000 } }); const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/sandbox/cinematic.html?cine=${encodeURIComponent('/__cine/' + path.basename(file))}&quality=medium`);
  let res = null;
  try { await page.waitForFunction(() => window.__result, null, { timeout: 240000 }); res = await page.evaluate(() => window.__result); await page.screenshot({ path: path.join(out, name + '.storyboard.jpg'), type: 'jpeg', quality: 88 }); }
  catch (e) { errs.push(e.message.split('\n')[0]); }
  await br.close(); server.close();
  const checks = []; const chk = (n, pass, detail, level = 'error') => checks.push({ name: n, pass: !!pass, detail, level });
  if (!res) { chk('builds and renders', false, errs.join('; ')); }
  else {
    const errors = res.lint.issues.filter((i) => i.level === 'error'), warns = res.lint.issues.filter((i) => i.level === 'warn');
    chk('timeline is valid', !errors.length, errors.map((e) => e.msg).join('; ') || `${res.shots} shots, ${res.duration}s`);
    chk('film grammar (jump cuts, 180° rule, shot length, subtitle reading time)', !warns.length, warns.map((e) => e.msg).join('; ') || 'ok', 'warn');
    const out1 = res.frames.filter((f) => f.subjectInFrame === false), occ = res.frames.filter((f) => f.occluded), under = res.frames.filter((f) => !f.cameraAboveGround);
    chk('subject in frame in every shot', !out1.length, out1.map((f) => f.shot).join(', ') || 'ok');
    chk('subject not occluded', !occ.length, occ.map((f) => f.shot).join(', ') || 'ok', 'warn');
    chk('camera above ground', !under.length, under.map((f) => f.shot).join(', ') || 'ok');
    if (errs.length) chk('renders without page errors', false, errs[0]);
  }
  const m = { name, file, storyboard: path.join(out, name + '.storyboard.jpg'), result: res, checks, ok: checks.every((c) => c.pass || c.level === 'warn') };
  fs.writeFileSync(path.join(out, name + '.cinematic.json'), JSON.stringify(m, null, 2));
  if (!quiet) {
    console.log(`▶ ${name}: ${res ? `${res.shots} shots · ${res.duration}s` : 'failed'}`);
    for (const c of checks) console.log(`  ${c.pass ? 'PASS' : c.level === 'warn' ? 'WARN' : 'FAIL'}  ${c.name}  (${c.detail})`);
    if (res) console.log(`  storyboard: ${m.storyboard}   ← open it: does every frame read? is the story clear without sound?`);
  }
  return m;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
  const m = await reviewCinematic(args.find((x, i) => !x.startsWith('--') && args[i - 1] !== '--out'), { out: opt('out') }); process.exitCode = m.ok ? 0 : 1;
}
