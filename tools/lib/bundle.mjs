// Zero-dependency ES module bundler for GameForge projects. Resolves the static import
// graph from an entry file and emits one classic script (no import/export) that runs from
// file:// URLs, so a game can ship as a single self-contained HTML file.
// Supported syntax (what GameForge code and three.js builds use): named/default/namespace
// imports, side-effect imports, `export` declarations, `export {..}` lists, re-exports
// (`export {..} from`, `export * from`, `export * as ns from`) and `export default`.
// Dynamic import() is not supported and is reported as an error.
import fs from 'node:fs';
import path from 'node:path';

const IMPORT_RE = /^[ \t]*import\s+([\s\S]*?)\s*from\s*['"]([^'"]+)['"];?|^[ \t]*import\s*['"]([^'"]+)['"];?/gm;
const EXPORT_LIST_RE = /^[ \t]*export\s*\{([\s\S]*?)\}\s*(?:from\s*['"]([^'"]+)['"])?\s*;?/gm;
const EXPORT_STAR_RE = /^[ \t]*export\s*\*\s*(?:as\s+([\w$]+)\s*)?from\s*['"]([^'"]+)['"]\s*;?/gm;
const EXPORT_DECL_RE = /^([ \t]*)export\s+(default\s+)?(async\s+function\*?|function\*?|class|const|let|var)\s+([\w$]+)/gm;
const EXPORT_DEFAULT_RE = /^([ \t]*)export\s+default\s+/gm;

function parseSpecList(list) {
  return list.split(',').map((s) => s.replace(/\/\*[\s\S]*?\*\//g, '').trim()).filter(Boolean).map((s) => {
    const m = s.match(/^([\w$]+)(?:\s+as\s+([\w$]+))?$/); if (!m) throw new Error('bundle: cannot parse specifier "' + s + '"');
    return { local: m[1], exported: m[2] || m[1] };
  });
}

export function bundle(entry, { root } = {}) {
  entry = path.resolve(entry); root = root ? path.resolve(root) : path.dirname(entry);
  const modules = new Map(); // abs path -> { id, code }
  const order = [];
  const visiting = new Set(), cycles = [];
  const idOf = (abs) => path.relative(root, abs).split(path.sep).join('/');
  function load(abs) {
    if (modules.has(abs)) return;
    if (visiting.has(abs)) { cycles.push(idOf(abs)); return; }
    visiting.add(abs);
    let src = fs.readFileSync(abs, 'utf8');
    if (/(^|[^.\w$])import\s*\(/.test(src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ''))) throw new Error(`bundle: dynamic import() in ${idOf(abs)} is not supported`);
    const deps = [];
    const resolve = (spec) => {
      if (!spec.startsWith('.') && !spec.startsWith('/')) throw new Error(`bundle: bare import '${spec}' in ${idOf(abs)}; GameForge projects must use relative paths`);
      const p = spec.startsWith('/') ? path.join(root, spec) : path.resolve(path.dirname(abs), spec);
      deps.push(p); return p;
    };
    const header = []; // lines placed at top of the module function
    const getters = []; // [exportedName, expression]
    let n = 0;
    src = src.replace(IMPORT_RE, (m, clause, from, bare) => {
      if (bare) { const p = resolve(bare); return `__require(${JSON.stringify(idOf(p))});`; }
      const p = resolve(from), v = `__i${n++}`;
      let out = `const ${v} = __require(${JSON.stringify(idOf(p))});`;
      clause = clause.trim();
      const ns = clause.match(/\*\s+as\s+([\w$]+)/);
      const named = clause.match(/\{([\s\S]*)\}/);
      const def = clause.replace(/\{[\s\S]*\}/, '').replace(/\*\s+as\s+[\w$]+/, '').replace(/,/g, ' ').trim();
      if (ns) out += ` const ${ns[1]} = ${v};`;
      if (def) out += ` const ${def} = ${v}.default;`;
      if (named) { const specs = parseSpecList(named[1]); if (specs.length) out += ` const { ${specs.map((s) => (s.local === s.exported ? s.local : `${s.local}: ${s.exported}`)).join(', ')} } = ${v};`; }
      return out;
    });
    src = src.replace(EXPORT_STAR_RE, (m, as, from) => {
      const p = resolve(from), v = `__e${n++}`;
      if (as) { getters.push([as, v]); return `const ${v} = __require(${JSON.stringify(idOf(p))});`; }
      return `const ${v} = __require(${JSON.stringify(idOf(p))}); __star(__exports, ${v});`;
    });
    src = src.replace(EXPORT_LIST_RE, (m, list, from) => {
      const specs = parseSpecList(list);
      if (from) { const p = resolve(from), v = `__e${n++}`; for (const s of specs) getters.push([s.exported, `${v}.${s.local}`]); return `const ${v} = __require(${JSON.stringify(idOf(p))});`; }
      for (const s of specs) getters.push([s.exported, s.local]);
      return '';
    });
    src = src.replace(EXPORT_DECL_RE, (m, indent, isDefault, kind, name) => { getters.push([isDefault ? 'default' : name, name]); return `${indent}${kind} ${name}`; });
    src = src.replace(EXPORT_DEFAULT_RE, (m, indent) => `${indent}__exports.default = `);
    if (/^[ \t]*export\s/m.test(src)) throw new Error(`bundle: unsupported export form in ${idOf(abs)}: ${src.match(/^[ \t]*export\s.*$/m)[0].slice(0, 80)}`);
    src = src.replace(/import\.meta\.url/g, '(document.currentScript && document.currentScript.src || location.href)');
    for (const [e, expr] of getters) header.push(`__def(__exports, ${JSON.stringify(e)}, () => ${expr});`);
    for (const d of deps) load(d);
    visiting.delete(abs);
    modules.set(abs, { id: idOf(abs), code: header.join('\n') + '\n' + src });
    order.push(abs);
  }
  load(entry);
  const parts = ['(function(){"use strict";',
    'const __defs = {}, __cache = {};',
    'function __def(o, k, g){ Object.defineProperty(o, k, { enumerable: true, configurable: true, get: g }); }',
    'function __star(o, m){ for (const k of Object.keys(m)) if (k !== "default" && !(k in o)) __def(o, k, () => m[k]); }',
    'function __require(id){ if (__cache[id]) return __cache[id]; const e = __cache[id] = {}; Object.defineProperty(e, Symbol.toStringTag, { value: "Module" }); if (!__defs[id]) throw new Error("bundle: missing module " + id); __defs[id](e); return e; }'];
  for (const abs of order) { const m = modules.get(abs); parts.push(`__defs[${JSON.stringify(m.id)}] = function(__exports){\n${m.code}\n};`); }
  parts.push(`__require(${JSON.stringify(idOf(entry))});`, '})();');
  const code = parts.join('\n');
  return { code, modules: order.map((a) => modules.get(a).id), cycles, bytes: Buffer.byteLength(code) };
}

// Inline the bundle into the game's index.html, replacing its module entry script.
export function buildSingleHtml(gameDir, { root, entry = 'main.js', html = 'index.html' } = {}) {
  const htmlSrc = fs.readFileSync(path.join(gameDir, html), 'utf8');
  const b = bundle(path.join(gameDir, entry), { root: root || gameDir });
  const tag = /<script\s+type=["']module["']\s+src=["'][^"']+["']\s*><\/script>/;
  if (!tag.test(htmlSrc)) throw new Error('build: index.html must load the entry with <script type="module" src="...">');
  const safe = b.code.replace(/<\/script/gi, '<\\/script');
  const out = htmlSrc.replace(tag, () => `<script>\n/* Built with GameForge AAA — single-file bundle of ${b.modules.length} modules */\n${safe}\n</script>`);
  return { html: out, ...b };
}
