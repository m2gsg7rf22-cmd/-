// Loader for the compiled parametric human dataset (MakeHuman CC0 assets, see
// engine/assets/human/LICENSE-CC0.md). Decompresses once and exposes typed-array views.
import { HUMAN_DATA_GZ_B64 } from '../assets/human/human-data.js';

let cached = null;
async function gunzip(bytes) {
  const ds = new DecompressionStream('gzip');
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
function b64(str) {
  const bin = atob(str); const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function loadHumanData() {
  if (cached) return cached;
  const raw = await gunzip(b64(HUMAN_DATA_GZ_B64));
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  if (dv.getUint32(0, true) !== 0x31484647) throw new Error('human data: bad magic');
  const metaLen = dv.getUint32(4, true);
  const meta = JSON.parse(new TextDecoder().decode(raw.subarray(8, 8 + metaLen)));
  let base = 8 + metaLen; base += (4 - (base % 4)) % 4;
  const buf = raw.buffer, bo = raw.byteOffset + base;
  const f32 = (off, n) => new Float32Array(buf, bo + off, n);
  const u16 = (off, n) => new Uint16Array(buf, bo + off, n);
  const i16 = (off, n) => new Int16Array(buf, bo + off, n);
  const u8 = (off, n) => new Uint8Array(buf, bo + off, n);
  const d = {
    meta,
    basePositions: f32(meta.basePositions, meta.baseVerts * 3),
    renderToBase: u16(meta.renderToBase, meta.renderVerts),
    uvs: f32(meta.uvs, meta.renderVerts * 2),
    groups: Object.fromEntries(meta.groups.map((g) => [g.name, u16(g.offset, g.count)])),
    skinIndex: u8(meta.skinIndex, meta.baseVerts * 4),
    skinWeight: u8(meta.skinWeight, meta.baseVerts * 4),
    targets: new Map(meta.targets.map((t) => { const idx = u16(t.idx, t.count).slice(); for (let i = 1; i < idx.length; i++) idx[i] += idx[i - 1]; return [t.name, { ...t, idx, delta: t.bits === 8 ? new Int8Array(buf, bo + t.delta, t.count * 3) : i16(t.delta, t.count * 3) }]; })),
    eyes: meta.eyes && { ...meta.eyes, refs: f32(meta.eyes.refs, meta.eyes.verts * 9), renderToProxy: u16(meta.eyes.renderToProxy, meta.eyes.renderVerts), uvs: f32(meta.eyes.uvs, meta.eyes.renderVerts * 2), tris: u16(meta.eyes.tris, meta.eyes.triCount) },
    poses: Object.fromEntries(meta.poses.map((p) => [p.name, new TextDecoder().decode(u8(p.offset, p.length))])),
    boneIndex: Object.fromEntries(meta.bones.map((b, i) => [b.name, i])),
  };
  cached = d;
  return d;
}
export function humanDataLoaded() { return cached; }
