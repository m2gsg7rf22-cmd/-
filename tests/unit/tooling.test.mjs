import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { bundle } from '../../tools/lib/bundle.mjs';
import { generateGDD, generateTasks, validateTasks, generatePlaytest } from '../../tools/lib/design.mjs';

test('bundler handles imports/exports/re-exports/defaults and runs as a classic script', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'gfb-'));
  fs.writeFileSync(path.join(d, 'a.js'), "export const x = 1;\nexport function f(v) { return v * 2; }\nexport default class K { k() { return 'k'; } }\n");
  fs.writeFileSync(path.join(d, 'b.js'), "import K, { x as y, f } from './a.js';\nimport * as A from './a.js';\nexport { y, f as g };\nexport * from './c.js';\nexport * as C from './c.js';\nexport const k = new K().k() + A.x;\n");
  fs.writeFileSync(path.join(d, 'c.js'), "let n = 0;\nexport function inc() { return ++n; }\nexport { n };\n");
  fs.writeFileSync(path.join(d, 'main.js'), "import { y, g, k, inc, C } from './b.js';\nimport './side.js';\nglobalThis.result = [y, g(5), k, inc(), C.inc(), C.n, globalThis.side];\n");
  fs.writeFileSync(path.join(d, 'side.js'), 'globalThis.side = true;\n');
  const b = bundle(path.join(d, 'main.js'));
  assert.equal(b.modules.length, 5); assert.doesNotMatch(b.code, /^\s*(import|export)\s/m);
  const ctx = { location: { href: 'x' }, document: {} }; ctx.globalThis = ctx; vm.runInNewContext(b.code, ctx);
  assert.deepEqual([...ctx.result], [1, 10, 'k1', 1, 2, 2, true]);
  fs.writeFileSync(path.join(d, 'bad.js'), "import x from 'three';\n");
  assert.throws(() => bundle(path.join(d, 'bad.js')), /bare import/);
});
test('engine bundles completely (three.js + all modules)', () => {
  const b = bundle(new URL('../../engine/index.js', import.meta.url).pathname, { root: new URL('../..', import.meta.url).pathname });
  assert.ok(b.modules.length > 40); assert.deepEqual(b.cycles, []);
  assert.doesNotMatch(b.code, /^[ \t]*export\s/m);
});
test('GDD, task graph and playtest generation', () => {
  const spec = { id: 't', title: 'T', world: { type: 'island' }, player: { mode: 'onfoot', combat: true }, enemies: [{ type: 'grunt', count: 2 }], npcs: [{ id: 'n', name: 'N', dialogue: '# a\nN: hi\n-> end' }], quests: [{ id: 'q', title: 'Q', objectives: [{ id: 'o', type: 'talk', target: 'n', text: 'talk' }] }], goal: { type: 'defeat' } };
  const gdd = generateGDD(spec);
  for (const s of ['Core gameplay loop', 'World and level structure', 'Story, characters and missions', 'Art direction', 'Controls and camera', 'Mechanics and progression', 'Technical architecture', 'Asset requirements', 'Performance targets', 'Completion criteria']) assert.match(gdd, new RegExp(s));
  const g = generateTasks(spec); const v = validateTasks(g); assert.ok(v.ok, v.errors.join('\n'));
  assert.ok(g.tasks.some((t) => t.role === 'ai-engineer') && g.tasks.some((t) => t.role === 'narrative-director'));
  const bad = { tasks: [{ id: 'a', deps: [], owns: ['x.js'], wave: 0 }, { id: 'b', deps: ['a'], owns: ['x.js'], wave: 1 }, { id: 'c', deps: [], owns: ['x.js'], wave: 1 }] };
  assert.equal(validateTasks(bad).ok, false);
  const pt = generatePlaytest(spec); assert.ok(pt.steps.some((s) => s.label === 'enemies can be defeated'));
});
