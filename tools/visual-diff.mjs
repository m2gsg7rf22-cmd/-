#!/usr/bin/env node
// Visual regression: compare screenshots against a baseline set, pixel by pixel.
//   node tools/gameforge.mjs visual-diff <current-dir> --baseline <dir> [--out dir] [--threshold 0.02] [--tolerance 0.06] [--update]
// For each PNG in current-dir with a same-named baseline: both are box-blurred 3×3 (ignores AA/dither
// noise), a pixel counts as changed when its largest channel difference exceeds `tolerance` (0..1), and the
// image FAILS when the changed fraction exceeds `threshold`. Writes <name>.diff.png (dimmed current with
// changed pixels in red) and visual-diff.json. --update copies current into the baseline (new or all).
// Pure Node (zlib) PNG codec: 8-bit greyscale/RGB/RGBA/palette, non-interlaced — what browsers/Playwright write.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
export function decodePNG(buf) {
  if (!buf.subarray(0, 8).equals(SIG)) throw new Error('not a PNG');
  let o = 8, w = 0, h = 0, depth = 0, type = 0, interlace = 0, pal = null, trns = null; const idat = [];
  while (o < buf.length) {
    const len = buf.readUInt32BE(o), t = buf.toString('ascii', o + 4, o + 8), d = buf.subarray(o + 8, o + 8 + len); o += 12 + len;
    if (t === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); depth = d[8]; type = d[9]; interlace = d[12]; }
    else if (t === 'PLTE') pal = d; else if (t === 'tRNS') trns = d; else if (t === 'IDAT') idat.push(d); else if (t === 'IEND') break;
  }
  if (depth !== 8 || interlace) throw new Error(`unsupported PNG (depth ${depth}, interlace ${interlace})`);
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type]; const raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * ch;
  const px = Buffer.alloc(h * stride); let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), out = px.subarray(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? out[i - ch] : 0, b = prev[i], c = i >= ch ? prev[i - ch] : 0; let v = line[i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out[i] = v & 255;
    }
    prev = out;
  }
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    let r, g, b, al = 255;
    if (type === 3) { const k = px[i]; r = pal[k * 3]; g = pal[k * 3 + 1]; b = pal[k * 3 + 2]; if (trns && k < trns.length) al = trns[k]; }
    else if (ch <= 2) { r = g = b = px[i * ch]; if (ch === 2) al = px[i * 2 + 1]; }
    else { r = px[i * ch]; g = px[i * ch + 1]; b = px[i * ch + 2]; if (ch === 4) al = px[i * 4 + 3]; }
    rgba.set([r, g, b, al], i * 4);
  }
  return { width: w, height: h, data: rgba };
}
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = (b) => { let c = -1; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
export function encodePNG({ width, height, data }) { // RGBA in, RGB PNG out
  const raw = Buffer.alloc(height * (width * 3 + 1));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const i = (y * width + x) * 4, o = y * (width * 3 + 1) + 1 + x * 3; raw[o] = data[i]; raw[o + 1] = data[i + 1]; raw[o + 2] = data[i + 2]; }
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t, 'ascii'), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([SIG, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
function blur3(img) {
  const { width: w, height: h, data } = img, out = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) { const yy = y + dy; if (yy < 0 || yy >= h) continue; for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx < 0 || xx >= w) continue; const i = (yy * w + xx) * 4; r += data[i]; g += data[i + 1]; b += data[i + 2]; n++; } }
    const o = (y * w + x) * 3; out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n;
  }
  return out;
}
/** Compare two decoded images → { changed (fraction), meanDiff (0..1), maxDiff, diff (RGBA image) }. */
export function compareImages(a, b, { tolerance = 0.06 } = {}) {
  if (a.width !== b.width || a.height !== b.height) return { sizeMismatch: true, changed: 1, meanDiff: 1, maxDiff: 1 };
  const A = blur3(a), B = blur3(b), n = a.width * a.height, diff = new Uint8Array(n * 4); let changed = 0, sum = 0, max = 0; const tol = tolerance * 255;
  for (let i = 0; i < n; i++) {
    const d = Math.max(Math.abs(A[i * 3] - B[i * 3]), Math.abs(A[i * 3 + 1] - B[i * 3 + 1]), Math.abs(A[i * 3 + 2] - B[i * 3 + 2]));
    sum += d; max = Math.max(max, d);
    const lum = (b.data[i * 4] * 0.3 + b.data[i * 4 + 1] * 0.59 + b.data[i * 4 + 2] * 0.11) * 0.35;
    if (d > tol) { changed++; diff.set([255, 40, 40, 255], i * 4); } else diff.set([lum, lum, lum, 255], i * 4);
  }
  return { changed: changed / n, meanDiff: sum / n / 255, maxDiff: max / 255, diff: { width: a.width, height: a.height, data: diff } };
}

export async function visualDiff({ baseline, current, out, threshold = 0.02, tolerance = 0.06, update = false, quiet = false } = {}) {
  if (!baseline || !current) { console.log('usage: gameforge visual-diff <current-dir> --baseline <dir> [--out dir] [--threshold 0.02] [--tolerance 0.06] [--update]'); return { ok: false }; }
  baseline = path.resolve(baseline); current = path.resolve(current); out = path.resolve(out || path.join(current, 'diff'));
  fs.mkdirSync(baseline, { recursive: true }); fs.mkdirSync(out, { recursive: true });
  const files = fs.readdirSync(current).filter((f) => f.endsWith('.png') && !f.endsWith('.diff.png')).sort();
  const results = [];
  for (const f of files) {
    const bp = path.join(baseline, f), cp = path.join(current, f);
    if (!fs.existsSync(bp) || update) { const existed = fs.existsSync(bp); fs.copyFileSync(cp, bp); results.push({ file: f, status: existed ? 'baseline-updated' : 'new' }); continue; }
    const r = compareImages(decodePNG(fs.readFileSync(bp)), decodePNG(fs.readFileSync(cp)), { tolerance });
    const status = r.sizeMismatch ? 'size-mismatch' : r.changed > threshold ? 'FAIL' : 'pass';
    if (r.diff) fs.writeFileSync(path.join(out, f.replace(/\.png$/, '.diff.png')), encodePNG(r.diff));
    results.push({ file: f, status, changed: +r.changed.toFixed(4), meanDiff: +r.meanDiff.toFixed(4), maxDiff: +r.maxDiff.toFixed(3) });
  }
  const missing = fs.readdirSync(baseline).filter((f) => f.endsWith('.png') && !files.includes(f));
  const ok = results.every((r) => r.status !== 'FAIL' && r.status !== 'size-mismatch');
  const report = { baseline, current, threshold, tolerance, ok, results, missingFromCurrent: missing };
  fs.writeFileSync(path.join(out, 'visual-diff.json'), JSON.stringify(report, null, 2));
  if (!quiet) {
    for (const r of results) console.log(`  ${r.status === 'pass' ? 'PASS' : r.status === 'FAIL' || r.status === 'size-mismatch' ? 'FAIL' : 'NEW '}  ${r.file}${r.changed != null ? `  changed ${(r.changed * 100).toFixed(2)}% · mean Δ ${(r.meanDiff * 100).toFixed(2)}%` : '  ' + r.status}`);
    if (missing.length) console.log(`  WARN  missing from current: ${missing.join(', ')}`);
    console.log(`${ok ? '✔' : '✘'} visual-diff: ${results.filter((r) => r.status === 'pass').length}/${results.filter((r) => r.changed != null).length} match the baseline  → ${out}`);
  }
  return report;
}
