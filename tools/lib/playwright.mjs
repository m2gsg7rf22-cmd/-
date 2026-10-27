// Locate Playwright without making it a hard dependency: project node_modules, global
// npm root, NODE_PATH, then common preinstall locations. Returns null if unavailable.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

export function loadPlaywright() {
  const candidates = [process.cwd(), path.dirname(new URL(import.meta.url).pathname)];
  for (const dir of candidates) { try { return createRequire(path.join(dir, 'x.js'))('playwright'); } catch { /* next */ } }
  const roots = [...(process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean)];
  try { roots.push(execSync('npm root -g', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()); } catch { /* no npm */ }
  roots.push('/usr/lib/node_modules', '/usr/local/lib/node_modules', '/opt/node_modules');
  for (const r of roots) {
    const p = path.join(r, 'playwright');
    if (fs.existsSync(p)) { try { return createRequire(path.join(r, 'x.js'))('playwright'); } catch { /* next */ } }
  }
  return null;
}

// Chromium flags that give WebGL on GPU-less machines (SwiftShader) without breaking GPUs.
export const CHROMIUM_ARGS = ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--autoplay-policy=no-user-gesture-required'];

export async function launchBrowser() {
  const pw = loadPlaywright();
  if (!pw) throw new Error('Playwright not found. Install with `npm i -D playwright && npx playwright install chromium`, or run in an environment that provides it.');
  const opts = { args: CHROMIUM_ARGS };
  if (fs.existsSync('/opt/pw-browsers/chromium') && process.env.GF_CHROMIUM_PATH === undefined) { /* default discovery works with preinstalled browsers */ }
  if (process.env.GF_CHROMIUM_PATH) opts.executablePath = process.env.GF_CHROMIUM_PATH;
  return pw.chromium.launch(opts);
}
