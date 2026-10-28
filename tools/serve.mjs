#!/usr/bin/env node
// Zero-dependency static file server for GameForge projects.
// Usage: node tools/serve.mjs [root=.] [--port 5173]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.wav': 'audio/wav', '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.ico': 'image/x-icon' };

// aliases: { '/__model/': '/abs/dir' } serves extra directories under URL prefixes
export function serve(root = '.', port = 5173, { quiet = false, aliases = {} } = {}) {
  root = path.resolve(root);
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let base = root, rel = p;
    for (const [prefix, dir] of Object.entries(aliases)) if (p.startsWith(prefix)) { base = path.resolve(dir); rel = p.slice(prefix.length); }
    let file = path.join(base, rel);
    if (!file.startsWith(base)) { res.writeHead(403); return res.end('forbidden'); }
    try { if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html'); } catch { /* 404 below */ }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('not found: ' + p); }
      res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-cache' });
      res.end(data);
    });
  });
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => { if (!quiet) console.log(`GameForge server: http://127.0.0.1:${server.address().port}/  (root ${root})`); resolve(server); });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const pi = args.indexOf('--port');
  const port = pi >= 0 ? +args[pi + 1] : 5173;
  const root = args.find((a, i) => !a.startsWith('--') && (pi < 0 || i !== pi + 1)) || '.';
  serve(root, port);
}
