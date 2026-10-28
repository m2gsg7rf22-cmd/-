#!/usr/bin/env node
// Model review loop for agents: build a model script, measure it, render a 4-view sheet, export GLB.
//   node tools/gameforge.mjs model <file.model.js> [--params '{"seed":2}'] [--out dir] [--no-render] [--glb]
// A model script:  export default function build(K, params) { return THREE.Object3D }
// (K = engine/modeling/index.js kit). Output: <out>/<name>.views.jpg + <name>.metrics.json (+ .glb).
// Look at the sheet, compare with your reference/brief, fix the script, run again.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function reviewModel(file, { params = {}, out, render = true, glb = false, quiet = false, scene = false, ref = true, yaw = 0, time = null, azimuth = null } = {}) {
  file = path.resolve(file);
  const name = path.basename(file).replace(/\.model\.m?js$|\.m?js$/, '');
  out = path.resolve(out || path.join(path.dirname(file), 'review'));
  fs.mkdirSync(out, { recursive: true });
  const { K } = await import(pathToFileURL(path.join(ROOT, 'engine/modeling/index.js')).href);
  const THREE = K.THREE;
  const mod = await import(pathToFileURL(file).href + '?t=' + Date.now());
  const t0 = performance.now();
  const obj = await mod.default(K, params);
  const buildMs = performance.now() - t0;
  if (!obj || !obj.isObject3D) throw new Error('model script must return a THREE.Object3D');
  obj.updateMatrixWorld(true);
  // ---- metrics
  const perMesh = []; let tris = 0, verts = 0, meshes = 0, nan = 0, degenerate = 0, openEdges = 0, cardMeshes = 0; const mats = new Set(), textures = new Set();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  obj.traverse((o) => {
    if (!o.isMesh) return; meshes++;
    const g = o.geometry, P = g.attributes.position, idx = g.index ? g.index.array : null, n = idx ? idx.length : P.count;
    verts += P.count; const mt = n / 3 * (o.isInstancedMesh ? o.count : 1); tris += mt; perMesh.push({ name: o.name || o.parent?.name || 'mesh', triangles: Math.round(mt), material: (Array.isArray(o.material) ? o.material.map((m) => m.name || m.type).join('+') : o.material.name || o.material.type), instances: o.isInstancedMesh ? o.count : 1 });
    for (const v of P.array) if (!Number.isFinite(v)) { nan++; }
    const ml = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of ml) { mats.add(m); for (const k of ['map', 'normalMap', 'roughnessMap', 'alphaMap']) if (m[k]) textures.add(m[k]); }
    const isCards = ml.some((m) => m.alphaTest > 0 || m.transparent) || g.userData.open || o.userData.open;
    if (isCards) cardMeshes++;
    const edges = new Map(), key = (i) => `${Math.round(P.getX(i) * 1e4)},${Math.round(P.getY(i) * 1e4)},${Math.round(P.getZ(i) * 1e4)}`;
    for (let t = 0; t < n; t += 3) {
      const i0 = idx ? idx[t] : t, i1 = idx ? idx[t + 1] : t + 1, i2 = idx ? idx[t + 2] : t + 2;
      a.fromBufferAttribute(P, i0); b.fromBufferAttribute(P, i1); c.fromBufferAttribute(P, i2);
      if (b.clone().sub(a).cross(c.clone().sub(a)).lengthSq() < 1e-14) degenerate++;
      if (!isCards && !scene && P.count < 300000) for (const [u, v] of [[i0, i1], [i1, i2], [i2, i0]]) { const ku = key(u), kv = key(v); const k = ku < kv ? ku + '|' + kv : kv + '|' + ku; edges.set(k, (edges.get(k) || 0) + 1); }
    }
    for (const cnt of edges.values()) if (cnt === 1) openEdges++;
  });
  const box = new THREE.Box3().setFromObject(obj), size = box.getSize(new THREE.Vector3());
  const metrics = { name, file, params, buildMs: +buildMs.toFixed(0), triangles: Math.round(tris), vertices: verts, meshes, drawCallsApprox: [...mats].length, materials: mats.size, textures: textures.size, cardMeshes,
    size: size.toArray().map((v) => +v.toFixed(3)), sizeAxes: 'x(width) × y(height) × z(depth), metres', perMesh, min: box.min.toArray().map((v) => +v.toFixed(3)), nanValues: nan, degenerateTriangles: degenerate, openEdges, collider: obj.userData.collider ?? null };
  const checks = [];
  const chk = (name, pass, detail, level = 'error') => checks.push({ name, pass: !!pass, detail, level });
  chk('no NaN/Infinity positions', nan === 0, `${nan} bad values`);
  chk('has geometry', tris > 0, `${Math.round(tris)} triangles`);
  chk('plausible size (1 cm … 500 m)', Math.max(...metrics.size) > 0.01 && Math.max(...metrics.size) < 500, metrics.size.join(' × ') + ' m');
  if (scene) {
    let lights = 0; obj.traverse((o) => { if (o.isLight) lights++; });
    metrics.lights = lights;
    chk('scene triangle budget ≤ 2.5M (desktop)', tris <= 2.5e6, `${(tris / 1e6).toFixed(2)}M`, 'warn');
    chk('draw calls ≤ 500 (merge/instance repeats)', meshes <= 500, `${meshes} meshes`, 'warn');
    chk('real lights ≤ 8 (use emissive + light pool)', lights <= 8, `${lights}`, 'warn');
    chk('materials ≤ 60 (share materials; each costs shader/state changes)', mats.size <= 60, `${mats.size}`, 'warn');
    const hf = obj.userData.heightfield;
    if (hf) { const { groundAudit } = await import(pathToFileURL(path.join(ROOT, 'engine/world/placement.js')).href); const a = groundAudit(obj, hf); metrics.groundAudit = a;
      chk('no floating/buried assets (set root.userData.heightfield = hf)', !a.floating.length && !a.buried.length, `${a.checked} checked; floating ${a.floating.length}${a.floating.length ? ': ' + a.floating.slice(0, 4).join(', ') : ''}; buried ${a.buried.length}${a.buried.length ? ': ' + a.buried.slice(0, 4).join(', ') : ''}`, 'warn'); }
    else chk('ground audit available', false, 'set root.userData.heightfield = hf to audit floating/buried assets', 'warn');
  } else {
    chk('rests on the ground (min.y ≈ 0) — pass params.floating for socket-origin assets', Math.abs(box.min.y) < 0.05 || params.floating, `min.y = ${box.min.y.toFixed(3)}`, 'warn');
    chk('few degenerate triangles (< 1 %)', degenerate <= tris * 0.01, `${degenerate}`, 'warn');
    chk('solid meshes are closed (open edges)', openEdges === 0, `${openEdges} open edges (cards, tubes and geometry.userData.open meshes are skipped)`, 'warn');
    chk('draw calls ≤ 8 per asset', mats.size <= 8, `${mats.size} materials`, 'warn');
  }
  metrics.checks = checks;
  // ---- render
  if (render) {
    const { launchBrowser } = await import('./lib/playwright.mjs'); const { serve } = await import('./serve.mjs');
    const server = await serve(ROOT, 0, { quiet: true, aliases: { '/__model/': path.dirname(file) } });
    const br = await launchBrowser(); const page = await br.newPage({ viewport: { width: 1600, height: 1000 } }); const errs = []; page.on('pageerror', (e) => errs.push(e.message));
    const url = `http://127.0.0.1:${server.address().port}/sandbox/model.html?model=${encodeURIComponent('/__model/' + path.basename(file))}&params=${encodeURIComponent(JSON.stringify(params))}&quality=medium${scene ? '&mode=scene' : ''}${ref ? '' : '&ref=0'}${yaw ? '&yaw=' + yaw : ''}${time !== null ? '&t=' + time : ''}${azimuth !== null ? '&az=' + azimuth : ''}`;
    await page.goto(url);
    try { await page.waitForFunction(() => window.__frames > 4, null, { timeout: 180000 }); await page.evaluate(() => { window.__pause = true; }); metrics.views = path.join(out, name + '.views.jpg'); await page.screenshot({ path: metrics.views, type: 'jpeg', quality: 88, timeout: 180000 }); }
    catch (e) { metrics.renderError = (errs[0] || e.message).split('\n')[0]; }
    if (errs.length) metrics.pageErrors = errs;
    await br.close(); server.close();
    chk('renders without page errors', !metrics.renderError && !errs.length, metrics.renderError || errs[0] || 'ok');
  }
  if (glb) { try { const { exportGLB } = await import(pathToFileURL(path.join(ROOT, 'engine/geometry/export.js')).href); const buf = exportGLB(obj); metrics.glb = path.join(out, name + '.glb'); fs.writeFileSync(metrics.glb, Buffer.from(buf)); } catch (e) { metrics.glbError = e.message; } }
  fs.writeFileSync(path.join(out, name + '.metrics.json'), JSON.stringify(metrics, null, 2));
  if (!quiet) {
    console.log(`▶ ${name}: ${metrics.triangles} tris · ${metrics.meshes} meshes · ${metrics.materials} materials · W ${metrics.size[0]} × H ${metrics.size[1]} × D ${metrics.size[2]} m · build ${metrics.buildMs} ms`);
    if (perMesh.length > 1 && perMesh.length <= 12) for (const m of perMesh) console.log(`    · ${m.name}: ${m.triangles} tris (${m.material}${m.instances > 1 ? ', ×' + m.instances : ''})`);
    for (const c of checks) console.log(`  ${c.pass ? 'PASS' : c.level === 'warn' ? 'WARN' : 'FAIL'}  ${c.name}  (${c.detail})`);
    if (metrics.views) console.log(`  views: ${metrics.views}   ← open this image and critique it`);
    if (metrics.glb) console.log(`  glb:   ${metrics.glb}`);
  }
  metrics.ok = checks.every((c) => c.pass || c.level === 'warn');
  return metrics;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
  const file = args.find((x, i) => !x.startsWith('--') && !['--params', '--out'].includes(args[i - 1]));
  if (!file) { console.log('usage: node tools/model.mjs <file.model.js> [--params json] [--out dir] [--no-render] [--glb]'); process.exit(1); }
  const m = await reviewModel(file, { params: JSON.parse(opt('params', '{}')), out: opt('out'), render: !args.includes('--no-render'), glb: args.includes('--glb'), ref: !args.includes('--no-ref'), yaw: +opt('yaw', 0) });
  process.exitCode = m.ok ? 0 : 1;
}
