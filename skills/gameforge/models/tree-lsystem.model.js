// Technique: grammar-driven branching (L-system + 3D turtle) → tapered tubes + alpha leaf cards.
// Params: { seed, iterations, angle, leafColor, height }
export default function build(K, { seed = 3, iterations = 5, angle = 27, leafColor = 0x4e7a2c, height = 8 } = {}) {
  const { THREE, V } = K, rng = new K.RNG(seed);
  // 1. structure: trunk segment, then recursive forks with roll (phyllotaxis) and shrink (!)
  const str = K.lsystem({ axiom: 'FFFA', rules: { A: [['!F[&FLA]/////[&FLA]///////[&FLA]', 0.7], ['!F[&FLA]///////[&FLA]', 0.3]] }, iterations, seed });
  const t = K.turtle(str, { step: height / 11, angle, radius: height * 0.03, radiusDecay: 0.68, stepDecay: 0.86, tropism: [0, -1, 0], tropismK: 0.06, jitter: 8, seed });
  // 2. bark: smooth tapered tubes, more sides on thick limbs
  const bark = K.mesh(K.skinBranches(t.branches, { smooth: 2, radialFor: (r) => (r > 0.08 ? 10 : r > 0.03 ? 6 : 4), vScale: 0.5 }), K.pbr('bark', { color: 0x4a3a2c, repeat: [2, 1] }), { name: 'bark' });
  // 3. foliage: cards at the outer tips, normals bent around the crown centre for volume shading
  const crown = V(0, height * 0.7, 0), list = [], base = new THREE.Color(leafColor);
  for (const tip of t.tips) {
    if (tip.depth < 2) continue;
    for (let k = 0; k < 3; k++) {
      const dir = tip.dir.clone().add(V(rng.range(-0.6, 0.6), rng.range(0, 0.6), rng.range(-0.6, 0.6))).normalize();
      const side = new THREE.Vector3().crossVectors(dir, V(rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1))).normalize();
      list.push({ pos: tip.pos.clone().addScaledVector(dir, -0.2), dir, side, w: 1.1, h: 1.2, color: base.clone().multiplyScalar(rng.range(0.8, 1.15)) });
    }
  }
  const leaves = K.mesh(K.cards(list, { centre: crown, normalBlend: 0.7 }), K.cardMaterial(K.cardTexture('leafSpray', seed)), { name: 'leaves' });
  const g = new THREE.Group(); g.add(bark, leaves);
  return K.finish(g, { kind: 'tree', collider: { type: 'cylinder', radius: height * 0.04, height } });
}
