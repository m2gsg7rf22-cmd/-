// Example scene script: a forest clearing with a cottage, a path, boulders and a well.
// Method: terrain first (shape the gameplay space: foundation pads, path), then focal point,
// then vegetation with a density gradient (dense at edges, open at the centre), then props for
// storytelling. Review: node tools/gameforge.mjs scene <this file>
export const env = { timeOfDay: 16.5, sunAzimuth: 210 }; // late afternoon light for the review
export default function build(K, { seed = 4 } = {}) {
  const { THREE } = K, W = K.world, g = new THREE.Group();
  const path = [[0, 2], [14, 20], [30, 45], [55, 95]];
  const hf = new W.Heightfield({ size: 220, resolution: 110, seed, height: 18, type: 'hills', flatten: [{ x: 0, z: 0, radius: 26, falloff: 20, height: 3 }], roads: [{ points: path, width: 4 }] });
  const pad = K.foundation(hf, -6, -8, 8, 7);                        // level pad for the cottage (before terrainMesh)
  g.add(W.terrainMesh(hf, { palette: { grass: 0x4f7a2c, grass2: 0x6d8a34, dirt: 0x6b5038, rock: 0x6e6a64 } }));
  g.add(K.pathStrip(hf, path, { width: 3, kind: 'dirt', color: 0x8a7458 }));
  const veg = W.populate(hf, { seed, trees: 180, rocks: 40, bushes: 120, grass: 3000, species: ['oak', 'birch', 'pine'], exclude: [{ x: 0, z: 0, r: 22 }, { x: 20, z: 30, r: 5 }] });
  g.add(veg.group);
  const house = K.BUILDINGS.house({ seed, style: 'cottage' }); house.position.set(-6, pad, -8); house.rotation.y = 0.5; g.add(house);
  for (let i = 0; i < 3; i++) { const r = K.PROPS.rock({ seed: i + 2, size: 1.4 }); r.userData.kind = 'rock'; K.place(r, hf, 8 + i * 2.5, 4 - i * 1.5, { align: 0.8, sink: 0.25, yaw: i }); g.add(r); }
  const well = K.PROPS.well(); K.place(well, hf, 4, -2); g.add(well);
  g.userData.heightfield = hf;                                         // enables the floating/buried audit
  g.userData.review = { focus: [0, hf.heightAt(0, 0) + 1, -3] };
  return g;
}
