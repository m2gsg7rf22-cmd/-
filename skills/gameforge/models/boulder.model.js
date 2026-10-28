// Technique: SDF sculpting — smooth-union blobs, ridged noise, flat cut base → Surface Nets mesh.
// Params: { seed, size, resolution }
export default function build(K, { seed = 7, size = 1.6, resolution = 72 } = {}) {
  const rng = new K.RNG(seed), s = size;
  let f = K.ellipsoid([0, s * 0.42, 0], [s * 0.62, s * 0.45, s * 0.5]);
  for (let i = 0; i < 4; i++) f = K.smoothUnion(f, K.sphere([rng.range(-0.4, 0.4) * s, rng.range(0.25, 0.6) * s, rng.range(-0.3, 0.3) * s], rng.range(0.22, 0.34) * s), 0.18 * s);
  f = K.subtract(f, K.box([s * 0.5, s * 0.75, 0], [s * 0.3, s * 0.15, s * 0.6]));       // a fractured facet
  f = K.noiseDisplace(f, { amount: 0.07 * s, frequency: 2.2 / s, octaves: 5, seed, ridged: true });
  f = K.cut(f, [0, 1, 0], 0.02 * s, 0.03 * s);                                         // sits flat on the ground
  const geo = K.meshSDF(f, { bounds: [[-s, -0.05, -s], [s, s * 1.1, s]], resolution, smooth: 1, uvScale: 1.5 / s });
  const rock = K.mesh(geo, K.pbr('rock', { color: 0x8a847a, repeat: 1 }), { name: 'boulder' });
  return K.finish(K.ground(rock), { kind: 'rock' });
}
