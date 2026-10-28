// Technique: hard-surface blockout from rounded boxes + lathe legs, bilateral symmetry, PBR fabric/wood.
// Params: { fabric, wood, width }
export default function build(K, { fabric = 0x6a3a2e, wood = 0x3b2618, width = 0.86 } = {}) {
  const { THREE } = K, mb = new K.MeshBuilder(), W = width;
  const cloth = K.pbr('fabric', { color: fabric, repeat: [3, 3] }), timber = K.pbr('planks', { color: wood, repeat: [0.5, 0.5] });
  // primary forms: seat, back, arms (soft cushions = generous rounding)
  mb.add(K.roundedBox(W - 0.24, 0.16, 0.6, 0.06, 4), cloth, K.mat4([0, 0.42, 0.02]));                 // seat cushion
  mb.add(K.roundedBox(W, 0.14, 0.72, 0.03, 2), cloth, K.mat4([0, 0.3, 0]));                           // base
  mb.add(K.roundedBox(W - 0.12, 0.62, 0.16, 0.07, 4), cloth, K.mat4([0, 0.72, -0.3], [-0.16, 0, 0])); // back, reclined
  for (const s of [-1, 1]) mb.add(K.roundedBox(0.14, 0.32, 0.72, 0.06, 4), cloth, K.mat4([s * (W / 2 - 0.07), 0.5, 0]));
  // secondary: turned legs (lathe profile), piping
  const leg = K.lathe([[0.0, 0], [0.022, 0], [0.026, 0.06], [0.018, 0.14], [0.028, 0.2], [0.0, 0.23]], 14);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) mb.add(leg, timber, K.mat4([sx * (W / 2 - 0.06), 0, sz * 0.3]));
  const piping = K.tube([new THREE.Vector3(-(W - 0.24) / 2, 0.5, 0.32), new THREE.Vector3((W - 0.24) / 2, 0.5, 0.32)], 0.012, 6, 8);
  mb.add(piping, cloth);
  return K.finish(K.ground(mb.build({ name: 'armchair' })), { kind: 'furniture' });
}
