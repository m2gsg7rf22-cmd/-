// Converts the single-file build into an artifact page body (the artifact host supplies
// doctype/html/head/body and the viewport meta). Keeps title, styles, scripts and app markup.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
const [, , src = 'dist-single/index.html', out = 'artifact/blockforge.html'] = process.argv;
const html = readFileSync(src, 'utf8');
const head = html.match(/<head>([\s\S]*?)<\/head>/i)[1];
const body = html.match(/<body>([\s\S]*?)<\/body>/i)[1];
const title = head.match(/<title>[\s\S]*?<\/title>/i)[0];
const icon = (head.match(/<link rel="icon"[^>]*>/i) || [''])[0];
const styles = [...head.matchAll(/<style[^>]*>[\s\S]*?<\/style>/gi)].map((m) => m[0]).join('\n');
const scripts = [...head.matchAll(/<script[^>]*>[\s\S]*?<\/script>/gi)].map((m) => m[0]).join('\n');
const page = `${title}\n<meta name="theme-color" content="#121318">\n${icon}\n${styles}\n${body.trim()}\n${scripts}\n`;
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, page);
console.log(`wrote ${out} (${(page.length / 1024).toFixed(0)} KB)`);
