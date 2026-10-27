#!/usr/bin/env node
// GameForge CLI — zero-dependency tooling used by the /gameforge skill and its agents.
//   doctor                      detect capabilities (node, browser, WebGL, git) -> capabilities.json
//   new <dir> [--spec f.js|json] [--title T] [--template blank|action|driving|adventure]
//   gdd <dir>                   regenerate GDD.md from game.spec.js
//   plan <dir>                  regenerate tasks.json (task graph) and validate it
//   validate <dir>              static + asset validation of a project
//   serve <dir> [--port N]      static dev server
//   playtest <dir> [--quality q] [--file dist.html]   automated gameplay test
//   build <dir>                 bundle to dist/<id>.html (single file) + dist/web/
//   shot <dir> [--quality high] capture screenshots (title + gameplay)
//   export <asset> [--out f.glb] [--params json]       export a procedural asset to GLB/OBJ
//   status <dir>                print task/test status
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { generateGDD, generateTasks, validateTasks, generatePlaytest } from './lib/design.mjs';
import { buildSingleHtml } from './lib/bundle.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(HERE, '..');
const args = process.argv.slice(2);
const cmd = args[0];
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const flag = (k) => args.includes('--' + k);
const positional = args.slice(1).filter((a, i, arr) => !a.startsWith('--') && !(i > 0 && arr[i - 1].startsWith('--') && !['--all', '--force'].includes(arr[i - 1])));

function copyDir(src, dst, filter = () => true) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (!filter(s)) continue;
    if (e.isDirectory()) copyDir(s, d, filter); else fs.copyFileSync(s, d);
  }
}
async function loadSpec(dir) {
  const js = path.join(dir, 'game.spec.js');
  if (fs.existsSync(js)) return (await import(pathToFileURL(js).href + '?t=' + Date.now())).SPEC;
  const json = path.join(dir, 'game.spec.json');
  if (fs.existsSync(json)) return JSON.parse(fs.readFileSync(json, 'utf8'));
  throw new Error('no game.spec.js in ' + dir);
}
const writeSpec = (dir, spec) => fs.writeFileSync(path.join(dir, 'game.spec.js'), `// Game spec: the single source of truth for composeGame(), GDD.md, tasks.json and playtest.json.\n// Edit, then run: node tools/gameforge.mjs gdd . && node tools/gameforge.mjs plan .\nexport const SPEC = ${JSON.stringify(spec, null, 2)};\n`);

const DEFAULT_SPECS = {
  blank: { title: 'New Game', world: { type: 'hills', biome: 'temperate' }, player: { mode: 'onfoot', combat: false }, collectibles: [{ kind: 'gem', count: 6, label: 'Collect the gems' }], goal: { type: 'collect', label: 'Collect the gems' } },
  action: { title: 'New Action Game', genre: 'action', world: { type: 'arena', biome: 'autumn' }, player: { mode: 'onfoot', combat: true }, enemies: [{ type: 'grunt', count: 4 }, { type: 'brute', count: 1, boss: true, name: 'Warlord' }], goal: { type: 'defeat' }, music: 'combat' },
  driving: { title: 'New Driving Game', genre: 'driving', world: { type: 'city', style: 'modern', traffic: 10 }, player: { mode: 'vehicle', vehicle: { type: 'sports' } }, goal: { type: 'explore', label: 'Cruise the city' }, music: 'driving' },
  adventure: { title: 'New Adventure', genre: 'adventure', world: { type: 'island', biome: 'tropical' }, player: { mode: 'onfoot', combat: false }, landmarks: [{ id: 'village', kind: 'village', at: 'north', distance: 40 }],
    npcs: [{ id: 'elder', name: 'The Elder', at: 'village', dialogue: '# start\nThe Elder: Welcome, traveller. Will you find the three relics?\n> I will. -> yes\n> Not now. -> end\n# yes\nThe Elder: Bless you. They lie scattered across the island.\n@do: start relics\n-> end' }],
    quests: [{ id: 'relics', title: 'The Three Relics', description: 'Find the relics scattered across the island.', objectives: [{ id: 'r', type: 'collect', target: 'relic', count: 3, text: 'Find the relics' }] }],
    collectibles: [{ kind: 'gem', item: 'relic', count: 3, label: 'Take the relic' }], goal: { type: 'quests', quests: ['relics'], label: 'Help the Elder' }, music: 'exploration' },
};

async function cmdNew() {
  const dir = path.resolve(positional[0] || 'my-game');
  if (fs.existsSync(dir) && fs.readdirSync(dir).length && !flag('force')) throw new Error(`${dir} is not empty (use --force)`);
  let spec;
  const specFile = opt('spec');
  if (specFile) spec = specFile.endsWith('.json') ? JSON.parse(fs.readFileSync(specFile, 'utf8')) : (await import(pathToFileURL(path.resolve(specFile)).href)).SPEC;
  else spec = JSON.parse(JSON.stringify(DEFAULT_SPECS[opt('template', 'blank')] || DEFAULT_SPECS.blank));
  if (opt('title')) spec.title = opt('title');
  spec.id ||= spec.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  copyDir(path.join(ROOT, 'templates/project'), dir);
  fs.writeFileSync(path.join(dir, 'index.html'), fs.readFileSync(path.join(dir, 'index.html'), 'utf8').replace('{{TITLE}}', spec.title));
  copyDir(path.join(ROOT, 'engine'), path.join(dir, 'engine'));
  copyDir(path.join(ROOT, 'tools'), path.join(dir, 'tools'));
  writeSpec(dir, spec);
  fs.writeFileSync(path.join(dir, 'GDD.md'), generateGDD(spec));
  const tasks = generateTasks(spec); fs.writeFileSync(path.join(dir, 'tasks.json'), JSON.stringify(tasks, null, 2));
  fs.writeFileSync(path.join(dir, 'playtest.json'), JSON.stringify(generatePlaytest(spec), null, 2));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: spec.id, private: true, type: 'module', scripts: { start: 'node tools/serve.mjs .', test: 'node tools/playtest.mjs .', build: 'node tools/gameforge.mjs build .' } }, null, 2));
  fs.writeFileSync(path.join(dir, 'README.md'), `# ${spec.title}\n\nGenerated with GameForge AAA.\n\n- Play (dev): \`node tools/serve.mjs .\` then open http://127.0.0.1:5173/\n- Test: \`node tools/playtest.mjs .\`\n- Build single-file game: \`node tools/gameforge.mjs build .\` → \`dist/${spec.id}.html\` (open directly in a browser)\n\nDesign: [GDD.md](GDD.md) · Tasks: [tasks.json](tasks.json) · Spec: [game.spec.js](game.spec.js)\n`);
  console.log(`Created ${dir}\n  spec: game.spec.js  gdd: GDD.md  tasks: ${tasks.tasks.length} in ${tasks.waves} waves  playtest: ${generatePlaytest(spec).steps.length} steps`);
}

async function cmdValidate(dir) {
  dir = path.resolve(dir); const problems = [], notes = [];
  for (const f of ['index.html', 'main.js']) if (!fs.existsSync(path.join(dir, f))) problems.push('missing ' + f);
  // external network references (zero-install rule)
  const scan = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (!['vendor', 'node_modules', 'dist', 'tools', '.git'].includes(e.name)) scan(p); } else if (/\.(js|html)$/.test(e.name)) { const s = fs.readFileSync(p, 'utf8'); const m = s.match(/(?:src|href|from|fetch\()\s*=?\s*['"]https?:\/\/[^'"]+/g); if (m) problems.push(`${path.relative(dir, p)} references the network: ${m[0]}`); } } };
  scan(dir);
  // import graph resolves
  try { const b = buildSingleHtml(dir, { root: fs.existsSync(path.join(dir, 'engine')) ? dir : ROOT }); notes.push(`import graph OK: ${b.modules.length} modules`); if (b.cycles.length) notes.push('cycles: ' + b.cycles.join(', ')); } catch (e) { problems.push('bundle: ' + e.message); }
  // spec + tasks
  if (fs.existsSync(path.join(dir, 'game.spec.js'))) { try { const spec = await loadSpec(dir); if (!spec.title) problems.push('spec has no title'); notes.push('spec OK: ' + spec.title); } catch (e) { problems.push('spec: ' + e.message); } }
  if (fs.existsSync(path.join(dir, 'tasks.json'))) { const v = validateTasks(JSON.parse(fs.readFileSync(path.join(dir, 'tasks.json'), 'utf8'))); if (!v.ok) problems.push(...v.errors.map((e) => 'tasks: ' + e)); else notes.push('task graph OK'); }
  // procedural asset validation (engine generators)
  const engineDir = fs.existsSync(path.join(dir, 'engine')) ? path.join(dir, 'engine') : path.join(ROOT, 'engine');
  const { validateObject } = await import(pathToFileURL(path.join(engineDir, 'geometry/builders.js')).href);
  const { MaterialLibrary } = await import(pathToFileURL(path.join(engineDir, 'render/materials.js')).href); MaterialLibrary.textureSize = 32;
  const { PROPS } = await import(pathToFileURL(path.join(engineDir, 'geometry/props.js')).href);
  let bad = 0; for (const [k, f] of Object.entries(PROPS)) { const r = validateObject(f({})); if (!r.ok) { bad++; problems.push(`asset ${k}: ${r.issues.join('; ')}`); } }
  notes.push(`${Object.keys(PROPS).length - bad}/${Object.keys(PROPS).length} procedural props valid`);
  for (const n of notes) console.log('  ok  ' + n);
  for (const p of problems) console.log('  ERR ' + p);
  return problems.length === 0;
}

async function cmdBuild(dir) {
  dir = path.resolve(dir);
  const root = fs.existsSync(path.join(dir, 'engine')) ? dir : ROOT;
  let id = path.basename(dir); try { id = (await loadSpec(dir)).id || id; } catch { /* demo games have no spec file */ }
  const out = path.join(dir, 'dist'); fs.mkdirSync(out, { recursive: true });
  const r = buildSingleHtml(dir, { root });
  const file = path.join(out, `${id}.html`); fs.writeFileSync(file, r.html);
  console.log(`  built ${path.relative(process.cwd(), file)}  (${r.modules.length} modules, ${(Buffer.byteLength(r.html) / 1e6).toFixed(2)} MB, single file, works from file://)`);
  return file;
}

async function cmdDoctor() {
  const caps = { node: process.version, platform: process.platform, git: false, playwright: false, browser: false, webgl: null, gpu: null, time: new Date().toISOString() };
  try { execSync('git --version', { stdio: 'ignore' }); caps.git = true; } catch { /* no git */ }
  const { loadPlaywright, launchBrowser } = await import('./lib/playwright.mjs');
  caps.playwright = !!loadPlaywright();
  if (caps.playwright) {
    try {
      const b = await launchBrowser(); caps.browser = true;
      const p = await b.newPage();
      const r = await p.evaluate(() => { const c = document.createElement('canvas'); const gl = c.getContext('webgl2'); if (!gl) return { webgl: false }; const e = gl.getExtension('WEBGL_debug_renderer_info'); return { webgl: true, gpu: e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown' }; });
      Object.assign(caps, r); await b.close();
    } catch (e) { caps.browserError = e.message; }
  }
  caps.software = /swiftshader|llvmpipe/i.test(caps.gpu || '');
  caps.recommendations = [
    caps.playwright ? 'Automated playtests available: run node tools/playtest.mjs <dir>' : 'Playwright missing: games still build/run; install playwright for automated playtests (npm i -D playwright)',
    caps.software ? 'Software WebGL detected: use --quality low for tests; fps numbers are not representative of real GPUs' : 'Hardware WebGL available',
    'Parallel agents: if your agent runtime exposes a subagent/Task tool, run independent waves from tasks.json in parallel; otherwise execute waves sequentially',
  ];
  fs.writeFileSync('capabilities.json', JSON.stringify(caps, null, 2));
  console.log(JSON.stringify(caps, null, 2));
}

async function cmdExport() {
  const kind = positional[0]; const params = JSON.parse(opt('params', '{}')); const out = opt('out', `${kind}.glb`);
  const E = await import(pathToFileURL(path.join(ROOT, 'engine/index.js')).href);
  E.MaterialLibrary.textureSize = 64;
  let obj;
  if (E.PROPS[kind]) obj = E.PROPS[kind](params);
  else if (E.BUILDINGS[kind]) obj = E.BUILDINGS[kind](params);
  else if (kind === 'car') obj = E.car(params);
  else if (kind === 'humanoid') obj = E.createHumanoid(params);
  else throw new Error(`unknown asset '${kind}'. Props: ${Object.keys(E.PROPS).join(', ')}; buildings: ${Object.keys(E.BUILDINGS).join(', ')}; car; humanoid`);
  const data = out.endsWith('.obj') ? E.exportOBJ(obj) : E.exportGLB(obj);
  fs.writeFileSync(out, data); console.log(`  exported ${kind} -> ${out} (${(data.length / 1024).toFixed(1)} KB)`);
}

async function cmdShot(dir) {
  const { launchBrowser } = await import('./lib/playwright.mjs'); const { serve } = await import('./serve.mjs');
  dir = path.resolve(dir); const root = fs.existsSync(path.join(dir, 'engine')) ? dir : ROOT;
  const server = await serve(root, 0, { quiet: true }); const b = await launchBrowser(); const page = await b.newPage({ viewport: { width: 1600, height: 900 } });
  const rel = path.relative(root, dir).split(path.sep).join('/');
  await page.goto(`http://127.0.0.1:${server.address().port}/${rel ? rel + '/' : ''}index.html?quality=${opt('quality', 'high')}&test=1`);
  await page.waitForFunction(() => window.__GF?.ready, null, { timeout: 180000 });
  await page.evaluate(() => { window.__GF.pause(); window.__GF.startGame?.(); window.__GF.step(+(new URLSearchParams(location.search).get('frames') || 90)); });
  const outDir = path.join(dir, 'screenshots'); fs.mkdirSync(outDir, { recursive: true });
  const f = path.join(outDir, `hero-${opt('quality', 'high')}.png`);
  await page.screenshot({ path: f, timeout: 180000 }); console.log('  saved ' + f);
  await b.close(); server.close();
}

const main = {
  async doctor() { await cmdDoctor(); },
  async new() { await cmdNew(); },
  async gdd() { const d = path.resolve(positional[0] || '.'); fs.writeFileSync(path.join(d, 'GDD.md'), generateGDD(await loadSpec(d))); console.log('  wrote GDD.md'); },
  async plan() { const d = path.resolve(positional[0] || '.'); const g = generateTasks(await loadSpec(d)); const v = validateTasks(g); fs.writeFileSync(path.join(d, 'tasks.json'), JSON.stringify(g, null, 2)); console.log(`  wrote tasks.json: ${g.tasks.length} tasks, ${g.waves} waves, valid=${v.ok}`); for (let w = 0; w < g.waves; w++) console.log(`   wave ${w}: ${g.tasks.filter((t) => t.wave === w).map((t) => `${t.id}(${t.role})`).join(', ')}`); if (!v.ok) { console.log(v.errors.join('\n')); process.exitCode = 1; } },
  async validate() { const ok = await cmdValidate(positional[0] || '.'); if (!ok) process.exitCode = 1; },
  async serve() { const { serve } = await import('./serve.mjs'); const d = path.resolve(positional[0] || '.'); await serve(fs.existsSync(path.join(d, 'engine')) ? d : ROOT, +opt('port', 5173)); },
  async playtest() {
    const { playtest } = await import('./playtest.mjs');
    const dirs = flag('all') ? fs.readdirSync(path.join(ROOT, 'games')).map((g) => path.join(ROOT, 'games', g)).filter((d) => fs.existsSync(path.join(d, 'playtest.json'))) : [positional[0] || '.'];
    let failed = 0;
    for (const d of dirs) { console.log(`\n▶ ${d}`); const r = await playtest(d, { quality: opt('quality'), file: opt('file'), resultsName: opt('file') ? 'test-results.dist.json' : 'test-results.json' }); console.log(`  ${r.passed ? '✔' : '✘'} ${r.summary}`); if (!r.passed) failed++; }
    process.exitCode = failed ? 1 : 0;
  },
  async build() {
    const dirs = flag('all') ? fs.readdirSync(path.join(ROOT, 'games')).map((g) => path.join(ROOT, 'games', g)) : [positional[0] || '.'];
    for (const d of dirs) await cmdBuild(d);
  },
  async shot() { await cmdShot(positional[0] || '.'); },
  async export() { await cmdExport(); },
  async status() { const d = path.resolve(positional[0] || '.'); const t = JSON.parse(fs.readFileSync(path.join(d, 'tasks.json'), 'utf8')); for (const x of t.tasks) console.log(`  [${x.status}] w${x.wave} ${x.id} (${x.role})`); const r = path.join(d, 'test-results.json'); if (fs.existsSync(r)) { const j = JSON.parse(fs.readFileSync(r, 'utf8')); console.log(`  playtest: ${j.summary} at ${j.startedAt}`); } },
};
if (!main[cmd]) { console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 14).map((l) => l.replace(/^\/\/ ?/, '')).join('\n')); process.exit(cmd ? 1 : 0); }
main[cmd]().catch((e) => { console.error('gameforge: ' + e.message); process.exit(1); });
