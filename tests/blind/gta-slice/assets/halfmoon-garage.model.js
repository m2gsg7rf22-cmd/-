// Halfmoon Body Shop — small one-bay paint garage (story location "halfmoon").
// Brief: real size 8.0 m wide × 4.6 m high × 7.0 m deep; boxy flat-roofed block, faces +Z.
// Defining features: one wide roll-up door (3.6 × 3.0 m) with ribbed slats, a half-moon sign
// above it, a side man-door, a parapet with coping, a paint-stained concrete apron.
// Materials: painted brick walls, ribbed painted-metal door, concrete apron/coping, emissive sign.
// Budget: building class, 2–15k triangles, ≤ 8 materials.
export default function build(K, { wall = 0x9a5f45, door = 0x8f9aa0, seed = 1 } = {}) {
  const { THREE } = K, mb = new K.MeshBuilder();
  const W = 8, H = 4.2, D = 7, PAR = 0.4;
  const brick = K.pbr('brick', { color: wall, repeat: [3, 2], seed });
  const metal = K.pbr('paintedMetal', { color: door, rust: 0.25, repeat: [2, 2], seed });
  const conc = K.pbr('concrete', { color: 0x9c9890, repeat: [2, 2] });
  const trim = K.solid(0x2c2a28, { roughness: 0.7 });
  const signMat = K.emissive(0xf2c14e, 2.2);
  const signBack = trim;
  // primary: walls (left, right, back, front piers + lintel), roof slab, parapet
  const t = 0.3, doorW = 3.6, doorH = 3.0;
  mb.add(K.roundedBox(t, H, D, 0.02, 1), brick, K.mat4([-W / 2 + t / 2, H / 2, 0]));
  mb.add(K.roundedBox(t, H, D, 0.02, 1), brick, K.mat4([W / 2 - t / 2, H / 2, 0]));
  mb.add(K.roundedBox(W, H, t, 0.02, 1), brick, K.mat4([0, H / 2, -D / 2 + t / 2]));
  const pierW = (W - doorW) / 2;
  mb.add(K.roundedBox(pierW - 1.2, H, t, 0.02, 1), brick, K.mat4([-W / 2 + (pierW - 1.2) / 2, H / 2, D / 2 - t / 2]));
  mb.add(K.roundedBox(0.4, H, t, 0.02, 1), brick, K.mat4([-doorW / 2 - 0.2, H / 2, D / 2 - t / 2]));
  mb.add(K.roundedBox(pierW, H, t, 0.02, 1), brick, K.mat4([W / 2 - pierW / 2, H / 2, D / 2 - t / 2]));
  mb.add(K.roundedBox(W, H - doorH, t, 0.02, 1), brick, K.mat4([0, doorH + (H - doorH) / 2, D / 2 - t / 2]));
  mb.add(K.roundedBox(W - 0.1, 0.25, D - 0.1, 0.02, 1), conc, K.mat4([0, H - 0.12, 0]));
  for (const [x, z, w, d] of [[0, D / 2 - 0.12, W + 0.1, 0.25], [0, -D / 2 + 0.12, W + 0.1, 0.25], [-W / 2 + 0.12, 0, 0.25, D], [W / 2 - 0.12, 0, 0.25, D]])
    mb.add(K.roundedBox(w, PAR, d, 0.03, 1), conc, K.mat4([x, H + PAR / 2, z]));
  // secondary: roll-up door with ribs, side man-door, sign
  mb.add(K.roundedBox(doorW, doorH, 0.08, 0.01, 1), metal, K.mat4([0, doorH / 2, D / 2 - t / 2]));
  for (let i = 0; i < 14; i++) mb.add(K.roundedBox(doorW - 0.05, 0.035, 0.03, 0.01, 1), trim, K.mat4([0, 0.15 + i * 0.205, D / 2 - t / 2 + 0.055]));
  mb.add(K.roundedBox(doorW + 0.3, 0.3, 0.32, 0.03, 1), metal, K.mat4([0, doorH + 0.15, D / 2 - t / 2 + 0.06]));
  const manX = -W / 2 + (pierW - 1.2) + 0.6;
  mb.add(K.roundedBox(0.95, 2.1, 0.06, 0.01, 1), K.solid(0x3d5a4a, { roughness: 0.6 }), K.mat4([manX, 1.05, D / 2 - t / 2]));
  mb.add(K.roundedBox(1.1, 0.05, 0.28, 0.01, 1), metal, K.mat4([manX, 2.2, D / 2 - t / 2 + 0.1]));
  mb.add(K.roundedBox(0.06, 0.06, 0.08, 0.01, 1), trim, K.mat4([manX + 0.35, 1.0, D / 2 - t / 2 + 0.06]));
  mb.add(K.roundedBox(3.2, 0.7, 0.1, 0.03, 1), signBack, K.mat4([0, 3.75, D / 2 + 0.02]));
  // half-moon disc (lathe-free: a flattened cylinder segment)
  const moon = new THREE.CylinderGeometry(0.28, 0.28, 0.04, 20, 1, false, 0, Math.PI).rotateX(Math.PI / 2).rotateZ(Math.PI / 2);
  mb.add(moon, signMat, K.mat4([-1.1, 3.75, D / 2 + 0.09]));
  for (let i = 0; i < 6; i++) mb.add(K.roundedBox(0.22, 0.32, 0.03, 0.01, 1), signMat, K.mat4([-0.55 + i * 0.36, 3.75, D / 2 + 0.085]));
  // tertiary: concrete apron with paint drips
  mb.add(K.roundedBox(W, 0.06, 2.0, 0.01, 1), conc, K.mat4([0, 0.03, D / 2 + 1.0]));
  const rng = new K.RNG(seed), drip = K.solid(0x5a7dbb, { roughness: 0.4 });
  for (let i = 0; i < 7; i++) mb.add(K.roundedBox(rng.range(0.1, 0.35), 0.005, rng.range(0.1, 0.3), 0.002, 1), drip, K.mat4([rng.range(-2, 2), 0.063, D / 2 + rng.range(0.3, 1.6)]));
  return K.finish(K.ground(mb.build({ name: 'halfmoon-garage' })), { kind: 'building' });
}
