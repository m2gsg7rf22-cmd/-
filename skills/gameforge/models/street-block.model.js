// Example: a street of attached buildings from the facade grammar (K.building / K.streetBlock).
// Review: node tools/gameforge.mjs model skills/gameforge/models/street-block.model.js
export default function build(K, { seed = 4, length = 48 } = {}) {
  const block = K.streetBlock({ length, depth: 12, seed, floors: [3, 6] });
  const pavement = K.mesh(new K.THREE.BoxGeometry(length + 2, 0.15, 4), K.solid(0x8d8a84, { roughness: 0.95 }));
  pavement.position.set(0, 0.075, 8); block.add(pavement);
  return block;
}
