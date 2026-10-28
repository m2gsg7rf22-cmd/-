// Technique: organic character sculpt with SDF — capsule/ellipsoid masses, smooth blends, mirrorX
// for bilateral symmetry, subtractive eye sockets, then separate eye meshes. (Static sculpt: rig it
// with the animation tools or keep it as a prop.) Params: { seed, skin }
export default function build(K, { seed = 2, skin = 0x5f8a4a } = {}) {
  const { THREE } = K;
  const half = K.smoothUnionAll([
    K.ellipsoid([0, 0.55, 0], [0.42, 0.34, 0.5]),                     // body mass
    K.ellipsoid([0, 0.92, 0.32], [0.3, 0.24, 0.28]),                  // head
    K.capsule([0.28, 0.45, 0.25], [0.42, 0.12, 0.42], 0.09, 0.06),   // front leg
    K.capsule([0.3, 0.45, -0.25], [0.5, 0.1, -0.3], 0.12, 0.07),     // hind leg
    K.ellipsoid([0.48, 0.05, 0.47], [0.1, 0.04, 0.12]),               // front foot
    K.ellipsoid([0.52, 0.04, -0.32], [0.12, 0.04, 0.14]),             // hind foot
    K.ellipsoid([0.16, 1.1, 0.4], [0.1, 0.09, 0.1]),                  // brow bump
  ], 0.12);
  let f = K.mirrorX(half);
  f = K.smoothSubtract(f, K.ellipsoid([0, 0.84, 0.62], [0.2, 0.03, 0.1]), 0.03); // mouth line
  f = K.smoothSubtract(f, K.mirrorX(K.sphere([0.16, 1.1, 0.48], 0.07)), 0.02);     // eye sockets
  f = K.noiseDisplace(f, { amount: 0.008, frequency: 14, octaves: 3, seed });     // skin micro-relief
  const body = K.mesh(K.meshSDF(f, { bounds: [[-0.75, -0.05, -0.7], [0.75, 1.3, 0.8]], resolution: 96, smooth: 1, uvScale: 3 }), K.pbr('skin', { color: skin, repeat: 2 }), { name: 'body' });
  const g = new THREE.Group(); g.add(body);
  for (const s of [-1, 1]) {
    const eye = K.mesh(new THREE.SphereGeometry(0.062, 24, 16), new THREE.MeshPhysicalMaterial({ color: 0xd8c23a, roughness: 0.15, clearcoat: 1 }));
    eye.position.set(s * 0.16, 1.1, 0.48); g.add(eye);
    const pupil = K.mesh(new THREE.SphereGeometry(0.03, 16, 12), K.solid(0x050505, { roughness: 0.2 })); pupil.position.set(s * 0.165, 1.1, 0.535); pupil.scale.set(0.5, 1.2, 0.5); g.add(pupil);
  }
  return K.finish(K.ground(g), { kind: 'creature' });
}
