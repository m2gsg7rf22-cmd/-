#!/usr/bin/env node
// Vehicle quality benchmark: geometry sanity + inspection renders for every vehicle type.
//   node tools/bench-vehicles.mjs [--no-images]   -> docs/benchmarks/vehicles/{REPORT.md,metrics.json,*.jpg}
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs/benchmarks/vehicles');
const noImages = process.argv.includes('--no-images');
const V = await import(pathToFileURL(path.join(ROOT, 'engine/geometry/vehicles.js')).href);
const THREE = await import(pathToFileURL(path.join(ROOT, 'engine/vendor/three/three.module.js')).href);

const checks = [], samples = [];
const check = (name, pass, detail) => { checks.push({ name, pass: !!pass, detail }); console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}  (${detail})`); };
const types = ['sedan', 'sports', 'coupe', 'hatchback', 'suv', 'truck', 'van', 'police', 'taxi'];
for (const type of types) for (const detail of ['high', 'low']) {
  const t0 = performance.now(); const c = V.car({ type, detail, seed: 3, taxi: type === 'taxi' }); const ms = performance.now() - t0;
  c.updateMatrixWorld(true);
  let tris = 0, nan = 0; c.traverse((o) => { if (!o.isMesh) return; const p = o.geometry.attributes.position.array; for (const v of p) if (!Number.isFinite(v)) nan++; tris += (o.geometry.index ? o.geometry.index.count : p.length / 3) / 3; });
  const box = new THREE.Box3().setFromObject(c.userData.body.getObjectByName('shell')), size = box.getSize(new THREE.Vector3()); size.y = box.max.y; // body shell top above ground; (excludes mirrors, light bars, signs)
  const d = c.userData.dims, w = c.userData.wheels;
  const wheelBottom = Math.max(...w.map((x) => Math.abs(x.pivot.position.y - x.radius)));
  const shell = c.userData.body.getObjectByName('shell'), groups = shell.geometry.groups.map((g) => g.count / 3);
  samples.push({ type, detail, ms: +ms.toFixed(0), tris: Math.round(tris), nan, size: size.toArray().map((v) => +v.toFixed(2)), dims: d, wheels: w.length, wheelBottom: +wheelBottom.toFixed(3), glassTris: groups[1], lampTris: groups[3] + groups[4] });
}
check('no NaN vertices', samples.every((s) => !s.nan), `${samples.length} builds`);
check('4 wheels touching the ground plane', samples.every((s) => s.wheels === 4 && s.wheelBottom < 0.005), 'pivot.y − radius ≈ 0');
check('body shell matches declared dimensions (±6 %)', samples.every((s) => Math.abs(s.size[2] - s.dims.length) / s.dims.length < 0.06 && Math.abs(s.size[1] - s.dims.height) / s.dims.height < 0.06 && Math.abs(s.size[0] - s.dims.width) / s.dims.width < 0.06), samples.map((s) => `${s.type}:${s.size.join('×')}`).filter((_, i) => i % 2 === 0).join(' '));
check('every body has glass and lamps', samples.every((s) => s.glassTris > 50 && s.lampTris > 10), 'material groups non-empty');
const hi = samples.filter((s) => s.detail === 'high'), lo = samples.filter((s) => s.detail === 'low');
check('triangle budget: high ≤ 30k, low ≤ 16k', hi.every((s) => s.tris <= 30000) && lo.every((s) => s.tris <= 16000), `high ${Math.max(...hi.map((s) => s.tris))}, low ${Math.max(...lo.map((s) => s.tris))}`);
check('build time ≤ 150 ms', samples.every((s) => s.ms <= 150), `max ${Math.max(...samples.map((s) => s.ms))} ms`);

const images = [];
if (!noImages) {
  const { launchBrowser } = await import('./lib/playwright.mjs'); const { serve } = await import('./serve.mjs');
  const server = await serve(ROOT, 0, { quiet: true }); const b = await launchBrowser();
  const shots = [
    ['lineup-front', 'types=sedan,sports,hatchback,suv,truck,van,police&gap=2.9&cz=16&cy=3.5&ry=-40&seed=3', 'All types, front three-quarter'],
    ['lineup-rear', 'types=sedan,sports,hatchback,suv,truck,van,police&gap=2.9&cz=16&cy=3.5&ry=140&seed=3', 'All types, rear three-quarter'],
    ['side-profiles', 'types=sedan,sports,suv&gap=2.6&cz=11&cy=1.4&ly=0.8&ry=-90&seed=5', 'Side profiles (sedan, sports, SUV)'],
    ['detail', 'types=sports&cz=5.2&cy=1.3&cx=1.2&ly=0.5&ry=-35&seed=8&fov=32', 'Close-up: wheels, lamps, glass, interior'],
  ];
  for (const [name, qs, caption] of shots) {
    const page = await b.newPage({ viewport: { width: 1600, height: 900 } }); const errs = []; page.on('pageerror', (e) => errs.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/sandbox/vehicles.html?${qs}&quality=medium`);
    await page.waitForFunction(() => window.__frames > 5, null, { timeout: 180000 }); await page.evaluate(() => { window.__pause = true; });
    fs.mkdirSync(OUT, { recursive: true }); await page.screenshot({ path: path.join(OUT, name + '.jpg'), type: 'jpeg', quality: 85, timeout: 180000 });
    images.push({ name, file: name + '.jpg', caption, errors: errs }); console.log(`  shot ${name}.jpg${errs.length ? ' errors: ' + errs.join('; ') : ''}`); await page.close();
  }
  await b.close(); server.close();
  check('inspection renders without page errors', images.every((i) => !i.errors.length), `${images.length} images`);
}
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'metrics.json'), JSON.stringify({ generated: new Date().toISOString(), checks, samples, images }, null, 2));
let md = `# Vehicle quality benchmark\n\nGenerated by \`node tools/bench-vehicles.mjs\` (${new Date().toISOString()}). Raw data: [metrics.json](metrics.json).\n\n**${checks.filter((c) => c.pass).length}/${checks.length} checks passed.**\n\n| Check | Result | Detail |\n|---|---|---|\n${checks.map((c) => `| ${c.name} | ${c.pass ? 'PASS' : 'FAIL'} | ${c.detail} |`).join('\n')}\n\n| Type | Detail | Triangles | Build ms | Size (W×H×L m) |\n|---|---|---|---|---|\n${samples.map((s) => `| ${s.type} | ${s.detail} | ${s.tris} | ${s.ms} | ${s.size.join(' × ')} |`).join('\n')}\n\n`;
for (const i of images) md += `### ${i.caption}\n\n![${i.name}](${i.file})\n\n`;
md += `## Honest assessment\n\nProfile-driven procedural bodies: continuous smooth shells with flush glass, pillars, door seams, wrap-around lamps, cut wheel arches with liners, interiors and detailed wheels. They read clearly as car classes but are **not** production car models: no body-panel creases or sculpted surfacing beyond the profile curves, lamps are emissive patches rather than modelled optics, and paint uses a clearcoat material without baked AO.\n`;
fs.writeFileSync(path.join(OUT, 'REPORT.md'), md);
const failed = checks.filter((c) => !c.pass).length;
console.log(`${failed ? '✘' : '✔'} ${checks.length - failed}/${checks.length} checks → docs/benchmarks/vehicles/REPORT.md`);
process.exitCode = failed ? 1 : 0;
