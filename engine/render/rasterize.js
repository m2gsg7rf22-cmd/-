// CPU UV-space rasterizer: paints per-texel values by interpolating per-vertex attributes
// across UV triangles. Used to bake procedural skin/garment textures onto arbitrary meshes.
export function rasterizeUV({ size, uvs, index, attrs, attrSize, shade, out, channels = 4, dilate = 2 }) {
  // shade(attrsInterpolated, u, v, outPixelArray, pixelOffset)
  const tmp = new Float32Array(attrSize);
  const filled = new Uint8Array(size * size);
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t], b = index[t + 1], c = index[t + 2];
    const ax = uvs[a * 2] * size, ay = (1 - uvs[a * 2 + 1]) * size, bx = uvs[b * 2] * size, by = (1 - uvs[b * 2 + 1]) * size, cx = uvs[c * 2] * size, cy = (1 - uvs[c * 2 + 1]) * size;
    const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx))), maxX = Math.min(size - 1, Math.ceil(Math.max(ax, bx, cx)));
    const minY = Math.max(0, Math.floor(Math.min(ay, by, cy))), maxY = Math.min(size - 1, Math.ceil(Math.max(ay, by, cy)));
    const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy); if (Math.abs(den) < 1e-9) continue;
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5, py = y + 0.5;
      const w0 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / den, w1 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / den, w2 = 1 - w0 - w1;
      if (w0 < -0.02 || w1 < -0.02 || w2 < -0.02) continue;
      for (let k = 0; k < attrSize; k++) tmp[k] = w0 * attrs[a * attrSize + k] + w1 * attrs[b * attrSize + k] + w2 * attrs[c * attrSize + k];
      shade(tmp, x / size, y / size, out, (y * size + x) * channels);
      filled[y * size + x] = 1;
    }
  }
  // dilate filled texels into empty ones to avoid seams at mip levels
  for (let it = 0; it < dilate; it++) {
    const next = filled.slice();
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const i = y * size + x; if (filled[i]) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= size || yy >= size) continue; const j = yy * size + xx; if (filled[j]) { for (let k = 0; k < channels; k++) out[i * channels + k] = out[j * channels + k]; next[i] = 1; break; } }
    }
    filled.set(next);
  }
  return out;
}
