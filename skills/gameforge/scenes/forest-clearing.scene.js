// Example scene script: a forest clearing with a stream, boulders and a cabin-sized focal point.
// Method: terrain first (shape the gameplay space), then focal point, then vegetation density
// gradient (dense at edges, open at the centre), then props for storytelling. Review: gameforge scene.
export default function build(K, { seed = 4 } = {}) {
  const { THREE } = K, W = K.world, g = new THREE.Group();
  const hf = new W.Heightfield({ size: 220, resolution: 110, seed, height: 18, type: 'hills', flatten: [{ x: 0, z: 0, radius: 26, falloff: 20, height: 3 }], roads: [{ points: [[0, 0], [30, 40], [60, 100]], width: 4 }] });
  g.add(W.terrainMesh(hf, { palette: { grass: 0x4f7a2c, grass2: 0x6d8a34, dirt: 0x6b5038, rock: 0x6e6a64 } }));
  const veg = W.populate(hf, { seed, trees: 180, rocks: 40, bushes: 120, grass: 3000, species: ['oak', 'birch', 'pine'], exclude: [{ x: 0, z: 0, r: 22 }] });
  g.add(veg.group);
  const house = K.BUILDINGS.house({ seed, style: 'cottage' }); house.position.set(-6, hf.heightAt(-6, -8), -8); house.rotation.y = 0.5; g.add(house);
  for (let i = 0; i < 3; i++) { const r = K.PROPS.rock({ seed: i + 2, size: 1.4 }); const x = 8 + i * 2.5, z = 4 - i * 1.5; r.position.set(x, hf.heightAt(x, z) - 0.2, z); g.add(r); }
  const well = K.PROPS.well(); well.position.set(4, hf.heightAt(4, -2), -2); g.add(well);
  return g;
}
