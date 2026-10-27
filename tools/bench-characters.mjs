#!/usr/bin/env node
// Character quality benchmark: measurable metrics + visual inspection sheets for the
// realistic human system. Writes docs/benchmarks/characters/{metrics.json,REPORT.md,*.png}.
//   node tools/bench-characters.mjs            # metrics + images
//   node tools/bench-characters.mjs --no-images
//   node tools/bench-characters.mjs --quality medium
// Metrics are checked against Winter's anthropometric segment ratios (fractions of stature H,
// "Biomechanics and Motor Control of Human Movement", table 4.1) with a tolerance, plus
// rig/mesh sanity (skin weight sums, NaNs, floor contact, symmetry), determinism and
// variation between seeds. A FAIL means the generator produced an implausible human.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs/benchmarks/characters');
const args = process.argv.slice(2);
const flag = (n) => args.includes('--' + n);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };

const H = await import(pathToFileURL(path.join(ROOT, 'engine/humans.js')).href);
const { THREE } = H;

// Joint heights as fractions of stature H from Winter (2009, table 4.1); segment lengths between
// joint centres from de Leva (1996, adjusted Zatsiorsky–Seluyanov, male/female mean). The rest
// pose is MakeHuman's A-pose, so elbow/wrist heights are not comparable and are not checked.
// Shoulder width is Winter's biacromial (outer) breadth; joint centres sit inside it, so a
// negative bias is expected (tolerance 30 %). [norm, relative tolerance]
const NORMS = {
  shoulderHeight: [0.818, 0.07], hipHeight: [0.530, 0.08], kneeHeight: [0.285, 0.12], ankleHeight: [0.039, 0.60],
  upperArm: [0.161, 0.15], forearm: [0.153, 0.15], thigh: [0.241, 0.12], shank: [0.247, 0.12], shoulderWidth: [0.259, 0.30],
};

function measure(h) {
  h.updateMatrixWorld(true);
  const sk = h.userData.skeleton, height = h.userData.height;
  const P = (n) => { const b = sk.bones.find((x) => x.name === n); if (!b) throw new Error('missing bone ' + n); return new THREE.Vector3().setFromMatrixPosition(b.matrixWorld); };
  const sh = P('upperarm01.L'), el = P('lowerarm01.L'), wr = P('wrist.L'), hip = P('upperleg01.L'), kn = P('lowerleg01.L'), an = P('foot.L'), shR = P('upperarm01.R');
  return {
    shoulderHeight: sh.y / height,
    hipHeight: hip.y / height, kneeHeight: kn.y / height, ankleHeight: an.y / height,
    upperArm: sh.distanceTo(el) / height, forearm: el.distanceTo(wr) / height,
    shoulderWidth: sh.distanceTo(shR) / height, thigh: hip.distanceTo(kn) / height, shank: kn.distanceTo(an) / height,
  };
}

function meshSanity(h) {
  const g = h.userData.mesh.geometry, pos = g.attributes.position.array, sw = g.attributes.skinWeight.array;
  let nan = 0, badW = 0, minY = Infinity, maxY = -Infinity, sx = 0;
  for (let i = 0; i < pos.length; i += 3) { if (!Number.isFinite(pos[i] + pos[i + 1] + pos[i + 2])) nan++; minY = Math.min(minY, pos[i + 1]); maxY = Math.max(maxY, pos[i + 1]); sx += pos[i]; }
  for (let i = 0; i < sw.length; i += 4) if (Math.abs(sw[i] + sw[i + 1] + sw[i + 2] + sw[i + 3] - 1) > 2e-3) badW++;
  const n = pos.length / 3;
  let tris = 0; h.traverse((o) => { if (o.isMesh) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
  return { verts: n, tris: Math.round(tris), nanVerts: nan, badWeights: badW, minY, maxY, centerX: sx / n, bones: h.userData.skeleton.bones.length };
}

const hash = (arr) => { let x = 2166136261; for (let i = 0; i < arr.length; i += 7) { x ^= Math.round(arr[i] * 1e4); x = Math.imul(x, 16777619); } return (x >>> 0).toString(16); };

const data = await H.loadHumanData();
const results = { generated: new Date().toISOString(), node: process.version, norms: NORMS, samples: [], checks: [] };
const check = (name, pass, detail) => { results.checks.push({ name, pass: !!pass, detail }); console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}  (${detail})`); };

// 1. Archetype × seed matrix + extreme body corners.
const specs = [];
for (const a of Object.keys(H.ARCHETYPES)) for (const s of [1, 2, 3]) specs.push({ label: `${a}:${s}`, spec: H.characterFromSpec(a, s) });
for (const sex of [0, 1]) for (const [muscle, weight] of [[0, 0], [1, 1], [0, 1], [1, 0]]) specs.push({ label: `extreme sex=${sex} m=${muscle} w=${weight}`, spec: { sex, muscle, weight, outfit: 'casual', hair: 'short' } });
for (const heightCm of [150, 200]) specs.push({ label: `height ${heightCm}cm`, spec: { sex: heightCm > 170 ? 1 : 0, heightCm, outfit: 'casual' } });
for (const age of [0.5, 0.875, 1]) specs.push({ label: `age ${age}`, spec: { sex: 1, age, outfit: 'casual' } });

console.log(`▶ Character benchmark: ${specs.length} samples`);
for (const { label, spec } of specs) {
  const t0 = performance.now();
  const h = H.buildHuman(data, spec);
  const geomMs = performance.now() - t0;
  const t1 = performance.now();
  let fullMs = null, fullTris = null;
  try { const full = H.assembleHuman(data, { textureSize: 512, ...spec }); fullMs = performance.now() - t1; fullTris = meshSanity(full).tris; } catch (e) { fullMs = 'n/a: ' + e.message.slice(0, 60); }
  const m = measure(h), s = meshSanity(h);
  const dev = {}; let worst = 0, worstKey = '';
  for (const [k, [norm, tol]] of Object.entries(NORMS)) { const d = (m[k] - norm) / norm; dev[k] = +d.toFixed(3); if (Math.abs(d) / tol > worst) { worst = Math.abs(d) / tol; worstKey = k; } }
  results.samples.push({ label, heightM: +h.userData.height.toFixed(3), targetCm: spec.heightCm ?? null, geomMs: +geomMs.toFixed(0), fullMs: typeof fullMs === 'number' ? +fullMs.toFixed(0) : fullMs, fullTris, ratios: Object.fromEntries(Object.entries(m).map(([k, v]) => [k, +v.toFixed(3)])), deviation: dev, worstNormScore: +worst.toFixed(2), worstKey, ...s });
}

// 2. Checks
const S = results.samples;
const proportionFails = S.filter((x) => x.worstNormScore > 1);
check('proportions within anthropometric tolerance', !proportionFails.length, proportionFails.length ? proportionFails.map((x) => `${x.label}:${x.worstKey}`).join(', ') : `${S.length}/${S.length} samples, worst score ${Math.max(...S.map((x) => x.worstNormScore))}`);
const hErr = S.filter((x) => x.targetCm).map((x) => Math.abs(x.heightM * 100 - x.targetCm));
check('stature matches requested heightCm', Math.max(...hErr) < 0.5, `max error ${Math.max(...hErr).toFixed(2)} cm over ${hErr.length} samples`);
check('stature range plausible for adults (1.40–2.10 m)', S.every((x) => x.heightM > 1.40 && x.heightM < 2.10), `${Math.min(...S.map((x) => x.heightM))}–${Math.max(...S.map((x) => x.heightM))} m`);
check('no NaN vertices', S.every((x) => !x.nanVerts), 'all samples');
check('skin weights normalised (|Σw−1|<2e-3)', S.every((x) => !x.badWeights), `bad=${S.reduce((a, x) => a + x.badWeights, 0)}`);
check('feet on the floor (minY ≈ 0)', S.every((x) => Math.abs(x.minY) < 0.02), `minY ${Math.min(...S.map((x) => x.minY)).toFixed(3)}..${Math.max(...S.map((x) => x.minY)).toFixed(3)}`);
check('body is centred/symmetric (|meanX| < 1 cm)', S.every((x) => Math.abs(x.centerX) < 0.01), `max ${Math.max(...S.map((x) => Math.abs(x.centerX))).toFixed(4)} m`);
const a1 = H.buildHuman(data, H.characterFromSpec('civilian', 42)), a2 = H.buildHuman(data, H.characterFromSpec('civilian', 42));
const h1 = hash(a1.userData.mesh.geometry.attributes.position.array), h2 = hash(a2.userData.mesh.geometry.attributes.position.array);
check('deterministic (same seed → identical mesh)', h1 === h2, `${h1} vs ${h2}`);
// variation: mean per-vertex distance between 8 civilians of the same sex, face region (top 13 % of body)
const civ = [1, 2, 3, 4, 5, 6, 7, 8].map((s) => H.buildHuman(data, { ...H.characterFromSpec('civilian', s), sex: 1, heightCm: 176 }));
let faceVar = 0, pairs = 0;
for (let i = 0; i < civ.length; i++) for (let j = i + 1; j < civ.length; j++) {
  const p = civ[i].userData.mesh.geometry.attributes.position.array, q = civ[j].userData.mesh.geometry.attributes.position.array; let d = 0, n = 0;
  for (let k = 0; k < p.length; k += 3) if (p[k + 1] > 1.52) { d += Math.hypot(p[k] - q[k], p[k + 1] - q[k + 1], p[k + 2] - q[k + 2]); n++; }
  faceVar += d / n; pairs++;
}
faceVar /= pairs;
check('faces differ between seeds (mean head-vertex Δ > 2 mm)', faceVar > 0.002, `${(faceVar * 1000).toFixed(1)} mm mean pairwise`);
const builds = S.map((x) => x.fullMs).filter((x) => typeof x === 'number');
results.perf = { geomMsMedian: median(S.map((x) => x.geomMs)), fullMsMedian: median(builds), fullTrisMedian: median(S.map((x) => x.fullTris).filter(Boolean)), note: 'Node.js CPU timings (geometry + 512px skin bake + clothing + hair); browser timings are similar.' };
check('full character assembly < 2 s (median)', results.perf.fullMsMedian < 2000, `${results.perf.fullMsMedian} ms, ${results.perf.fullTrisMedian} tris`);
function median(a) { a = [...a].sort((x, y) => x - y); return a.length ? a[a.length >> 1] : null; }

// 3. Visual inspection sheets (browser)
const images = [];
if (!flag('no-images')) {
  const { launchBrowser } = await import('./lib/playwright.mjs'); const { serve } = await import('./serve.mjs');
  const server = await serve(ROOT, 0, { quiet: true }); const port = server.address().port; const b = await launchBrowser();
  const quality = opt('quality', 'medium');
  const shots = [
    ['lineup', 'who=civilian:1,businessperson:2,soldier:3,knight:4,superhero:5,villager:6,wizard:7,athlete:8,biker:9&cz=8.2&cy=1.2&ly=0.95&gap=0.8', 'Archetype lineup (9 archetypes, seeded)'],
    ['diversity', 'who=civilian:11,civilian:12,civilian:13,civilian:14,civilian:15,civilian:16,civilian:17,civilian:18&cz=7&cy=1.2&ly=0.95&gap=0.75', 'Same archetype, 8 seeds'],
    ['portraits', 'who=civilian:21,civilian:22,civilian:23,civilian:24&gap=0.42&cz=1.5&cy=1.62&ly=1.6&fov=40&noblink', 'Head/shoulder portraits'],
    ['expressions', 'who=civilian:31,civilian:31,civilian:31,civilian:31,civilian:31&exprs=neutral,smile,angry,sad,surprised&gap=0.36&cz=1.45&cy=1.62&ly=1.6&fov=42&noblink&hair=short', 'Expressions: neutral, smile, angry, sad, surprised'],
    ['walk-cycle', 'who=athlete:41,athlete:41,athlete:41,athlete:41,athlete:41,athlete:41&clip=walk&phase&side&gap=0.75&cz=6&cy=1.0&ly=0.9', 'Retargeted procedural walk, 6 phases (side view)'],
    ['run-cycle', 'who=soldier:42,soldier:42,soldier:42,soldier:42,soldier:42,soldier:42&clip=run&phase&side&gap=0.8&cz=6&cy=1.0&ly=0.9', 'Retargeted procedural run, 6 phases'],
    ['bvh-walk', 'who=civilian:43,civilian:43,civilian:43,civilian:43,civilian:43&bvh=walk&phase&side&gap=0.8&cz=5.5&cy=1.0&ly=0.9', 'CC0 BVH mocap (MakeHuman walk) retargeted, 5 phases'],
  ];
  for (const [name, qs, caption] of shots) {
    const page = await b.newPage({ viewport: { width: 1600, height: 900 } });
    const errs = []; page.on('pageerror', (e) => errs.push(e.message));
    const t0 = Date.now();
    await page.goto(`http://127.0.0.1:${port}/sandbox/humans.html?${qs}&quality=${quality}`);
    try {
      await page.waitForFunction(() => window.__frames > 8, null, { timeout: 240000 });
      await page.evaluate(() => { window.__pause = true; });
      const f = path.join(OUT, name + '.jpg'); fs.mkdirSync(OUT, { recursive: true });
      await page.screenshot({ path: f, type: 'jpeg', quality: 85, timeout: 240000 });
      images.push({ name, file: name + '.jpg', caption, ms: Date.now() - t0, errors: errs });
      console.log(`  shot ${name}.jpg (${Date.now() - t0} ms)${errs.length ? ' errors: ' + errs.join('; ') : ''}`);
    } catch (e) { images.push({ name, caption, error: e.message.split('\n')[0], errors: errs }); console.log(`  shot ${name} FAILED ${e.message.split('\n')[0]} ${errs.join('; ')}`); }
    await page.close();
  }
  await b.close(); server.close();
  check('inspection sheets render without page errors', images.every((x) => !x.error && !x.errors.length), `${images.filter((x) => !x.error && !x.errors.length).length}/${images.length}`);
}
results.images = images;

// 4. Write report
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'metrics.json'), JSON.stringify(results, null, 2));
const pct = (v) => (v >= 0 ? '+' : '') + (v * 100).toFixed(1) + '%';
let md = `# Character quality benchmark\n\nGenerated by \`node tools/bench-characters.mjs\` on ${results.generated} (Node ${results.node}). Raw data: [metrics.json](metrics.json).\n\n`;
md += `**${results.checks.filter((c) => c.pass).length}/${results.checks.length} checks passed.**\n\n| Check | Result | Detail |\n|---|---|---|\n` + results.checks.map((c) => `| ${c.name} | ${c.pass ? 'PASS' : 'FAIL'} | ${c.detail} |`).join('\n') + '\n\n';
md += `## Proportions vs. anthropometric norms\n\nJoint heights/segment lengths as a fraction of stature, compared to Winter (2009) joint heights and de Leva (1996) joint-centre segment lengths (norm ± tolerance). Values are deviations from the norm; MakeHuman joint centres are approximations of anatomical landmarks, so tolerances are generous.\n\n`;
md += '| Sample | H (m) | ' + Object.keys(NORMS).join(' | ') + ' | tris | build ms |\n|' + '---|'.repeat(Object.keys(NORMS).length + 4) + '\n';
md += `| *norm* | | ${Object.values(NORMS).map(([n, t]) => `${n} ±${Math.round(t * 100)}%`).join(' | ')} | | |\n`;
for (const s of S) md += `| ${s.label} | ${s.heightM} | ${Object.keys(NORMS).map((k) => pct(s.deviation[k])).join(' | ')} | ${s.fullTris ?? s.tris} | ${s.fullMs} |\n`;
md += `\n## Performance\n\nMedian geometry build ${results.perf.geomMsMedian} ms; median full assembly (morph + 512 px skin bake + garments + hair) ${results.perf.fullMsMedian} ms; median ${results.perf.fullTrisMedian} triangles per dressed character. ${results.perf.note}\n\n`;
if (images.length) { md += `## Visual inspection sheets\n\nRendered with the sandbox scene (\`sandbox/humans.html\`) at quality=${opt('quality', 'medium')} in headless Chromium/SwiftShader.\n\n`; for (const i of images) md += i.file ? `### ${i.caption}\n\n![${i.name}](${i.file})\n\n` : `### ${i.caption}\n\nFAILED: ${i.error}\n\n`; }
md += `## Honest assessment\n\nThese characters are built from the CC0 MakeHuman base mesh and morph targets with procedural skin, garments and hair. They are anatomically proportioned and individually varied, but they are **not photorealistic**: hair is a textured shell rather than strands, garments are body-offset shells without cloth simulation, skin uses a baked albedo with a wrap-lighting SSS approximation, and there are no scanned textures. See LIMITATIONS.md.\n`;
fs.writeFileSync(path.join(OUT, 'REPORT.md'), md);
const failed = results.checks.filter((c) => !c.pass).length;
console.log(`${failed ? '✘' : '✔'} ${results.checks.length - failed}/${results.checks.length} checks → ${path.relative(ROOT, OUT)}/REPORT.md`);
process.exitCode = failed ? 1 : 0;
