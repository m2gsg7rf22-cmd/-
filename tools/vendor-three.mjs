#!/usr/bin/env node
// Copies three.js core builds plus a dependency-closed set of examples/jsm addons
// into engine/vendor/three, rewriting bare 'three' imports to relative paths so the
// engine runs without npm, import maps or a bundler.
// Usage: node tools/vendor-three.mjs <path-to-extracted-three-package>
import fs from 'node:fs';
import path from 'node:path';

const src = path.resolve(process.argv[2] || 'node_modules/three');
const dest = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../engine/vendor/three');
const ADDONS = [
  'postprocessing/EffectComposer.js', 'postprocessing/RenderPass.js', 'postprocessing/ShaderPass.js',
  'postprocessing/UnrealBloomPass.js', 'postprocessing/OutputPass.js', 'postprocessing/SMAAPass.js',
  'postprocessing/FXAAPass.js', 'shaders/VignetteShader.js', 'shaders/FXAAShader.js',
  'objects/Sky.js', 'objects/Water.js', 'exporters/GLTFExporter.js', 'loaders/GLTFLoader.js',
  'environments/RoomEnvironment.js', 'utils/BufferGeometryUtils.js', 'utils/SkeletonUtils.js',
  'math/SimplexNoise.js', 'postprocessing/GTAOPass.js', 'postprocessing/BokehPass.js',
];
const importRe = /^(import|export)\s[^;]*?from\s*['"]([^'"]+)['"]/gms;

fs.mkdirSync(path.join(dest, 'addons'), { recursive: true });
for (const f of ['three.module.js', 'three.core.js']) fs.copyFileSync(path.join(src, 'build', f), path.join(dest, f));
fs.copyFileSync(path.join(src, 'LICENSE'), path.join(dest, 'LICENSE'));

const done = new Set();
const queue = [...ADDONS];
while (queue.length) {
  const rel = queue.shift();
  if (done.has(rel)) continue;
  done.add(rel);
  let code = fs.readFileSync(path.join(src, 'examples/jsm', rel), 'utf8');
  const depth = rel.split('/').length; // addons/<dir>/<file> -> ../../three.module.js
  const toThree = '../'.repeat(depth) + 'three.module.js';
  code = code.replace(importRe, (m, kw, spec) => {
    if (spec === 'three') return m.replace(/['"]three['"]/, `'${toThree}'`);
    if (spec.startsWith('.')) queue.push(path.posix.normalize(path.posix.join(path.posix.dirname(rel), spec)));
    return m;
  });
  const out = path.join(dest, 'addons', rel);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, code);
}
const pkg = JSON.parse(fs.readFileSync(path.join(src, 'package.json'), 'utf8'));
fs.writeFileSync(path.join(dest, 'VERSION.json'), JSON.stringify({ name: 'three', version: pkg.version, license: pkg.license, addons: [...done].sort() }, null, 2) + '\n');
console.log(`vendored three@${pkg.version} with ${done.size} addons -> ${dest}`);
