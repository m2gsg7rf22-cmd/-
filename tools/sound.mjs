#!/usr/bin/env node
// Sound review loop for agents: render a *.sfx.js recipe offline in Chromium, save a WAV, a
// waveform/spectrogram/envelope sheet and metrics, and run checks.
//   node tools/gameforge.mjs sound <file.sfx.js> [--out dir]
// An sfx script:  export default { duration, reverb, brief, recipe(e, t, dest, pitch) { e._osc(...); ... } }
// See skills/gameforge/references/audio.md. You cannot hear it: judge with the sheet + metrics + brief.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function reviewSound(file, { out, quiet = false } = {}) {
  file = path.resolve(file);
  const name = path.basename(file).replace(/\.sfx\.m?js$|\.m?js$/, '');
  out = path.resolve(out || path.join(path.dirname(file), 'review')); fs.mkdirSync(out, { recursive: true });
  const { launchBrowser } = await import('./lib/playwright.mjs'); const { serve } = await import('./serve.mjs');
  const server = await serve(ROOT, 0, { quiet: true, aliases: { '/__sfx/': path.dirname(file) } });
  const br = await launchBrowser(); const page = await br.newPage({ viewport: { width: 1600, height: 900 } }); const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/sandbox/sound.html?sfx=${encodeURIComponent('/__sfx/' + path.basename(file))}`);
  let res = null;
  try { await page.waitForFunction(() => window.__result, null, { timeout: 120000 }); res = await page.evaluate(() => window.__result); await page.screenshot({ path: path.join(out, name + '.sound.png') }); }
  catch (e) { errs.push(e.message.split('\n')[0]); }
  await br.close(); server.close();
  if (!res) { const m = { name, ok: false, errors: errs }; if (!quiet) console.log('✘ ' + name + ': ' + errs.join('; ')); return m; }
  const m = res.metrics; m.name = name; m.sheet = path.join(out, name + '.sound.png'); m.wav = path.join(out, name + '.wav');
  fs.writeFileSync(m.wav, Buffer.from(res.wav, 'base64'));
  const checks = []; const chk = (n, pass, detail, level = 'error') => checks.push({ name: n, pass: !!pass, detail, level });
  chk('audible (peak > −30 dBFS)', m.peakDbfs > -30, `${m.peakDbfs} dBFS`);
  chk('no clipping (peak ≤ −0.5 dBFS, 0 clipped samples)', m.clippedSamples === 0 && m.peakDbfs <= -0.5, `${m.peakDbfs} dBFS, ${m.clippedSamples} clipped`);
  chk('headroom for mixing (peak ≤ −3 dBFS)', m.peakDbfs <= -3, `${m.peakDbfs} dBFS`, 'warn');
  chk('no DC offset (|mean| < 0.01)', Math.abs(m.dcOffset) < 0.01, `${m.dcOffset}`);
  chk('decays before the render ends (no cut-off tail)', m.tailPeak < 0.01, `last 5 ms peak ${m.tailPeak} (raise duration or shorten release)`);
  chk('fast onset for SFX (< 50 ms)', m.onsetS < 0.05, `${m.onsetS} s`, 'warn');
  if (errs.length) chk('renders without page errors', false, errs[0]);
  m.checks = checks; m.ok = checks.every((c) => c.pass || c.level === 'warn');
  fs.writeFileSync(path.join(out, name + '.sound.json'), JSON.stringify(m, null, 2));
  if (!quiet) {
    console.log(`▶ ${name}: peak ${m.peakDbfs} dBFS · RMS ${m.rmsDbfs} dBFS · centroid ${m.spectralCentroidHz} Hz · audible until ${m.audibleUntilS}s`);
    for (const c of checks) console.log(`  ${c.pass ? 'PASS' : c.level === 'warn' ? 'WARN' : 'FAIL'}  ${c.name}  (${c.detail})`);
    console.log(`  sheet: ${m.sheet}   ← open it: waveform, spectrogram, envelope\n  wav:   ${m.wav}`);
  }
  return m;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
  const file = args.find((x, i) => !x.startsWith('--') && args[i - 1] !== '--out');
  if (!file) { console.log('usage: node tools/sound.mjs <file.sfx.js> [--out dir]'); process.exit(1); }
  const m = await reviewSound(file, { out: opt('out') }); process.exitCode = m.ok ? 0 : 1;
}
