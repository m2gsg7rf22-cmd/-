#!/usr/bin/env node
// Animation review loop for agents: run a custom clip script on the realistic 163-bone human,
// measure it, and render phase contact sheets (side + front).
//   node tools/gameforge.mjs anim <file.anim.js> [--out dir] [--phases 8] [--no-render]
// An anim script:  export default ({ S, C, ease, seg, bell, relaxed, locomotion }) => ({ duration, loop, pose(p) })
//   (or export default { duration, loop, pose }). pose(p) returns canonical joint rotations in
//   degrees + hipsX/Y/Z offsets (metres) — see skills/gameforge/references/animation.md.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function reviewAnim(file, { out, phases = 8, render = true, quiet = false, archetype = 'athlete' } = {}) {
  file = path.resolve(file);
  const name = path.basename(file).replace(/\.anim\.m?js$|\.m?js$/, '');
  out = path.resolve(out || path.join(path.dirname(file), 'review')); fs.mkdirSync(out, { recursive: true });
  const H = await import(pathToFileURL(path.join(ROOT, 'engine/humans.js')).href);
  const { CLIP_HELPERS } = await import(pathToFileURL(path.join(ROOT, 'engine/animation/clips.js')).href);
  const THREE = H.THREE;
  const mod = await import(pathToFileURL(file).href + '?t=' + Date.now());
  const def = typeof mod.default === 'function' ? mod.default(CLIP_HELPERS) : mod.default;
  if (!def || typeof def.pose !== 'function' || !(def.duration > 0)) throw new Error('anim script must provide { duration, loop, pose(p) }');
  const data = await H.loadHumanData();
  const human = H.buildHuman(data, H.characterFromSpec(archetype, 3));
  const rt = new H.Retargeter(human.userData.bones);
  const clip = rt.clipFromPoseFn(name, def);
  const mixer = new THREE.AnimationMixer(human), act = mixer.clipAction(clip); act.play();
  const B = human.userData.bones, W = (n) => new THREE.Vector3().setFromMatrixPosition(B[n].matrixWorld);
  human.updateMatrixWorld(true); const restFootY = Math.min(W('toe1-1.L').y, W('foot.L').y);
  const N = 60, bones = human.userData.skeleton.bones;
  let minFoot = Infinity, maxLowFoot = -Infinity, maxStep = 0, maxStepBone = '', kneeHyper = 0, elbowHyper = 0, loopSeam = 0;
  let prevQ = null; const firstQ = []; const frames = []; let minAt = '', floatAt = '';
  for (let f = 0; f <= N; f++) {
    act.time = (f / N) * def.duration * (def.loop ? 0.9999 : 1); mixer.update(0); human.updateMatrixWorld(true);
    const fl = Math.min(W('toe1-1.L').y, W('foot.L').y) - restFootY, fr = Math.min(W('toe1-1.R').y, W('foot.R').y) - restFootY;
    const p = +(f / N).toFixed(3), hy = B[Object.keys(B).find((k) => k === 'root') || 'root'].position.y;
    frames.push({ p, footL: +fl.toFixed(3), footR: +fr.toFixed(3), hipsY: +hy.toFixed(3) });
    if (Math.min(fl, fr) < minFoot) minAt = `p=${p} ${fl < fr ? 'L' : 'R'}`;
    if (Math.min(fl, fr) > maxLowFoot) floatAt = `p=${p} (both feet ≥ ${(Math.min(fl, fr) * 100).toFixed(1)} cm)`;
    minFoot = Math.min(minFoot, fl, fr); maxLowFoot = Math.max(maxLowFoot, Math.min(fl, fr));
    // hinge joints at the canonical level: knee flexion is +x, elbow flexion is −x (references/animation.md)
    const pz = def.pose((f / N) % 1) || {};
    for (const s of ['L', 'R']) {
      const kx = (pz['lowerLeg_' + s] || [0])[0], ex = (pz['lowerArm_' + s] || [0])[0];
      if (kx < -5) kneeHyper = Math.max(kneeHyper, -kx);
      if (ex > 10) elbowHyper = Math.max(elbowHyper, ex);
    }
    const qs = bones.map((b) => b.quaternion.clone());
    if (f === 0) firstQ.push(...qs);
    if (prevQ) qs.forEach((q, i) => { const d = THREE.MathUtils.radToDeg(q.angleTo(prevQ[i])) * (N / def.duration) / 30; if (d > maxStep) { maxStep = d; maxStepBone = bones[i].name; } });
    prevQ = qs;
  }
  if (def.loop) { // seam: compare the pose function at p=0 and p→1 (the sampler wraps, so measure the source)
    const a0 = def.pose(0) || {}, a1 = def.pose(0.9999) || {};
    for (const k of new Set([...Object.keys(a0), ...Object.keys(a1)])) { const x = a0[k], y = a1[k]; if (Array.isArray(x) || Array.isArray(y)) for (let i = 0; i < 3; i++) loopSeam = Math.max(loopSeam, Math.abs(((x || [0, 0, 0])[i] || 0) - ((y || [0, 0, 0])[i] || 0))); else if (typeof x === 'number' || typeof y === 'number') loopSeam = Math.max(loopSeam, Math.abs((x || 0) - (y || 0)) * 100); }
  }
  const hipsRange = frames.length ? +(Math.max(...frames.map((x) => x.hipsY)) - Math.min(...frames.map((x) => x.hipsY))).toFixed(3) : 0;
  const metrics = { frames, hipsBobRange: hipsRange, name, file, duration: def.duration, loop: !!def.loop, minFootOffset: +minFoot.toFixed(3), lowestFootMaxHeight: +maxLowFoot.toFixed(3), maxDegPerFrame30: +maxStep.toFixed(1), maxStepBone, kneeHyperextensionDeg: +kneeHyper.toFixed(1), elbowHyperextensionDeg: +elbowHyper.toFixed(1), loopSeamDeg: +loopSeam.toFixed(1) };
  const checks = []; const chk = (n, pass, detail, level = 'error') => checks.push({ name: n, pass: !!pass, detail, level });
  chk('feet do not sink into the ground (> −3 cm)', minFoot > -0.03, `${(minFoot * 100).toFixed(1)} cm at ${minAt}`);
  chk('grounded: a foot on the floor in every frame (≤ 3 cm) unless airborne', def.airborne || maxLowFoot <= 0.03, `worst ${floatAt || '—'}; set groundFeet: true to pin feet automatically`, 'warn');
  chk('no pops (≤ 25°/frame @30 fps)', maxStep <= 25, `${maxStep.toFixed(1)}° on ${maxStepBone}`);
  chk('knees never bend backwards', kneeHyper === 0, `${kneeHyper.toFixed(1)}°`);
  chk('elbows never bend backwards', elbowHyper === 0, `${elbowHyper.toFixed(1)}°`);
  if (def.loop) chk('seamless loop (≤ 4°)', loopSeam <= 4, `${loopSeam.toFixed(1)}°`);
  metrics.checks = checks;
  if (render) {
    const { launchBrowser } = await import('./lib/playwright.mjs'); const { serve } = await import('./serve.mjs');
    const server = await serve(ROOT, 0, { quiet: true, aliases: { '/__anim/': path.dirname(file) } });
    const br = await launchBrowser(); metrics.sheets = [];
    for (const [view, extra] of [['side', '&side&ortho&cz=8&ly=0.95&gap=0.8&labels&contacts'], ['front', '&ortho&cz=8&ly=0.95&gap=0.8&labels&contacts']]) {
      const page = await br.newPage({ viewport: { width: 1800, height: 1000 } }); const errs = []; page.on('pageerror', (e) => errs.push(e.message));
      const who = Array.from({ length: phases }, () => archetype + ':3').join(',');
      await page.goto(`http://127.0.0.1:${server.address().port}/sandbox/humans.html?who=${who}&anim=${encodeURIComponent('/__anim/' + path.basename(file))}&clip=${name}&phase&noblink${extra}&quality=medium`);
      try { await page.waitForFunction(() => window.__frames > 4, null, { timeout: 240000 }); await page.evaluate(() => { window.__pause = true; }); const f2 = path.join(out, `${name}.${view}.jpg`); await page.screenshot({ path: f2, type: 'jpeg', quality: 85, timeout: 240000 }); metrics.sheets.push(f2); }
      catch (e) { metrics.renderError = (errs[0] || e.message).split('\n')[0]; }
      if (errs.length) metrics.pageErrors = errs; await page.close();
    }
    await br.close(); server.close();
    chk('renders without page errors', !metrics.renderError && !metrics.pageErrors, metrics.renderError || 'ok');
  }
  fs.writeFileSync(path.join(out, name + '.anim-metrics.json'), JSON.stringify(metrics, null, 2));
  metrics.ok = checks.every((c) => c.pass || c.level === 'warn');
  if (!quiet) {
    console.log(`▶ ${name}: ${def.duration}s ${def.loop ? 'loop' : 'once'} · ${phases} phases`);
    for (const c of checks) console.log(`  ${c.pass ? 'PASS' : c.level === 'warn' ? 'WARN' : 'FAIL'}  ${c.name}  (${c.detail})`);
    for (const s of metrics.sheets || []) console.log(`  sheet: ${s}   ← open and critique (labels show p; green discs = foot contact)`);
  }
  return metrics;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
  const file = args.find((x, i) => !x.startsWith('--') && !['--out', '--phases'].includes(args[i - 1]));
  if (!file) { console.log('usage: node tools/anim.mjs <file.anim.js> [--out dir] [--phases 8] [--no-render]'); process.exit(1); }
  const m = await reviewAnim(file, { out: opt('out'), phases: +opt('phases', 8), render: !args.includes('--no-render') });
  process.exitCode = m.ok ? 0 : 1;
}
