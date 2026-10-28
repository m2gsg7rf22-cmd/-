// Coastal fishing village at golden hour.
// Layout: sea toward +Z, shoreline ~z=30, beach band z 22..34, village terrace z -15..20 on a slope,
// hills behind (z < -30). Main path runs along the slope (x axis), a side path drops to the plaza
// and the pier (focal point) at x≈10. Density gradient: open beach/water -> plaza -> houses -> forest on the hills.
export default function build(K, { seed = 7 } = {}) {
  const { THREE } = K, W = K.world, root = new THREE.Group();
  // Layout coordinates are authored around the plaza at (10, 18); the terrain is centred on the plaza so
  // the review tool's auto cameras (which orbit the bbox centre) look at the focal point.
  const OX = 10, OZ = 18, g = new THREE.Group(); g.position.set(-OX, 0, -OZ); root.add(g);
  const rng = new K.RNG(seed);
  const SIZE = 150;
  const shoreZ = (x) => 30 + 5 * Math.sin(x * 0.035 + 1) + 2 * Math.sin(x * 0.11);
  const generator = (x, z, n) => {
    const s = shoreZ(x), d = z - s; // d < 0 land, d > 0 sea
    let h;
    if (d < -10) h = 2.2 + (-10 - d) * 0.14 + Math.max(0, -d - 42) * 0.22; // slope + hills
    else if (d < 2) h = -0.4 + (2 - d) * 0.217; // beach: -0.4 .. 2.2 over 12 m
    else h = -0.4 - Math.min(6, (d - 2) * 0.22); // sea floor
    const landMask = Math.min(1, Math.max(0, (-d - 6) / 20));
    h += n.fbm2(x * 0.02, z * 0.02, 4) * 2.2 * landMask + n.fbm2(x * 0.08, z * 0.08, 2) * 0.25;
    return h;
  };
  const mainPath = [[-62, -3], [-45, 2], [-25, 5], [0, 4], [20, 2], [45, 5], [65, 2], [82, -2]];
  const sidePath = [[8, 3], [9, 10], [10, 16]];
  const toHf = (P) => P.map(([x, z]) => [x - OX, z - OZ]);
  const hf = new W.Heightfield({ size: SIZE, resolution: 160, seed, waterLevel: 0, generator: (x, z, n) => generator(x + OX, z + OZ, n),
    flatten: [{ x: 0, z: 0, radius: 7, falloff: 6 }],
    roads: [{ points: toHf(mainPath), width: 4, falloff: 4 }, { points: toHf(sidePath), width: 3, falloff: 3 }] });
  const T = { heightAt: (x, z) => hf.heightAt(x - OX, z - OZ), flattenArea: (o) => hf.flattenArea({ ...o, x: o.x - OX, z: o.z - OZ }) };

  // --- houses on flattened pads, doors facing the path
  const houses = [];
  const slots = [[-42, -5, 0.1], [-29, -3, 0], [-16, -3, 0], [-3, -4, 0], [24, -6, -0.05], [37, -4, -0.1], [-34, 11, Math.PI], [-20, 13, Math.PI], [28, 12, Math.PI], [42, 13, Math.PI + 0.1]];
  for (const [x, z, ry] of slots) {
    const w = rng.range(6, 8), dpt = rng.range(5, 6.5);
    T.flattenArea({ x, z, rect: [w + 3, dpt + 3], falloff: 4 });
    houses.push({ x, z, ry, w, dpt });
  }
  root.add(W.terrainMesh(hf, { material: W.terrainMaterial({ waterLevel: 0, sandBand: 1.6, snowLine: 999, palette: { grass: 0x6a8a3a, grass2: 0x8a9a44, dirt: 0x7a5a3a, rock: 0x7a7266, sand: 0xdcc59a } }) }));
  root.add(W.createWater({ size: SIZE, level: 0, heightfield: hf, color: 0x2a6a7a, deep: 0x123a4a }));

  // --- path ribbon (terrain shader has no road paint)
  const pathMat = K.pbr('cobble', { color: 0x9a8a72, repeat: [1, 1], moss: 0.2 });
  const ribbon = (pts, width) => {
    const c = new THREE.CatmullRomCurve3(pts.map(([x, z]) => new THREE.Vector3(x, 0, z)));
    const N = Math.ceil(c.getLength() / 1.0), pos = [], uv = [], idx = [];
    for (let i = 0; i <= N; i++) {
      const p = c.getPoint(i / N), t = c.getTangent(i / N), nx = -t.z, nz = t.x;
      for (const s of [-1, 1]) { const x = p.x + nx * s * width / 2, z = p.z + nz * s * width / 2; pos.push(x, T.heightAt(x, z) + 0.06, z); uv.push(s * 0.5 + 0.5, i * 0.25); }
      if (i < N) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(idx); geo.computeVertexNormals(); geo.userData.open = true;
    const m = new THREE.Mesh(geo, pathMat); if (geo.attributes.normal.getY(0) < 0) { geo.index.array.reverse(); geo.computeVertexNormals(); } m.receiveShadow = true; return m;
  };
  g.add(ribbon(mainPath, 3.2)); g.add(ribbon(sidePath, 2.4));

  for (const h of houses) {
    const b = K.BUILDINGS.house({ seed: seed * 13 + houses.indexOf(h), width: h.w, depth: h.dpt, style: rng.chance(0.25) ? 'stone' : 'cottage' });
    b.position.set(h.x, T.heightAt(h.x, h.z) - 0.05, h.z); b.rotation.y = h.ry; g.add(b);
  }

  for (const h of houses) {
    if (!rng.chance(0.6)) continue;
    const back = h.ry === 0 ? -1 : 1, fz = h.z + back * (h.dpt / 2 + 2.2), fx = h.x + rng.range(-1, 1);
    const f = K.PROPS.fence({ length: h.w + 1, posts: 4 }); f.position.set(fx, T.heightAt(fx, fz) - 0.05, fz); f.rotation.y = h.ry; g.add(f);
    const bx = h.x + h.w / 2 + 1.2, bz = h.z - back * (h.dpt / 2 - 0.5), bn = K.PROPS.bench(); bn.position.set(bx, T.heightAt(bx, bz), bz); bn.rotation.y = h.ry; g.add(bn);
  }
  // --- pier (focal point): deck on piles from the beach out over the water
  const PX = 10, Z0 = 26, Z1 = 64, DECK = 1.5, PW = 3;
  const mb = new K.MeshBuilder();
  const wood = K.pbr('planks', { planks: 1, color: 0x7a5a3c }), dark = K.pbr('planks', { planks: 1, color: 0x4a3626 });
  for (let z = Z0; z <= Z1; z += 0.5) mb.add(K.roundedBox(PW, 0.08, 0.44, 0.02, 1), wood, K.mat4([PX + rng.range(-0.05, 0.05), DECK, z], [0, rng.range(-0.02, 0.02), 0]));
  for (let z = Z0 + 1; z <= Z1; z += 3) for (const s of [-1, 1]) {
    const x = PX + s * (PW / 2 - 0.1), bed = T.heightAt(x, z) - 0.6, len = DECK - bed + 0.6;
    mb.add(new THREE.CylinderGeometry(0.14, 0.16, len, 8), dark, K.mat4([x, bed + len / 2, z]));
  }
  for (const s of [-1, 1]) mb.add(new THREE.BoxGeometry(0.2, 0.25, Z1 - Z0), dark, K.mat4([PX + s * (PW / 2 - 0.1), DECK - 0.17, (Z0 + Z1) / 2]));
  // T-head platform
  for (let x = -5; x <= 5; x += 0.5) mb.add(K.roundedBox(0.44, 0.08, 5, 0.02, 1), wood, K.mat4([PX + x, DECK, Z1 + 2.5]));
  for (const [x, z] of [[-5, Z1], [5, Z1], [-5, Z1 + 5], [5, Z1 + 5], [0, Z1 + 5]]) { const bed = T.heightAt(PX + x, z) - 0.6, len = DECK - bed + 0.9; mb.add(new THREE.CylinderGeometry(0.16, 0.18, len, 8), dark, K.mat4([PX + x, bed + len / 2, z])); }
  g.add(mb.build({ name: 'pier' }));

  // --- boats: lofted clinker-ish hull
  const boat = (len, beam, color, bseed) => {
    const b = new K.MeshBuilder();
    const H = beam * 0.45, n = 12;
    const ring = (w, h, sheer) => { const r = []; for (let i = 0; i < n; i++) { const a = Math.PI + (i / (n - 1)) * Math.PI; r.push([Math.cos(a) * w, sheer + Math.sin(a) * h]); } return r.reverse(); };
    const secs = [];
    for (let i = 0; i <= 8; i++) { const t = i / 8, z = -len / 2 + t * len, p = Math.sin(Math.PI * (0.08 + t * 0.84)); const sheer = H + Math.pow(Math.abs(t - 0.5) * 2, 2) * 0.25; secs.push({ z, ring: ring(Math.max(0.04, beam / 2 * Math.pow(p, 0.7)), H * Math.max(0.35, p), sheer) }); }
    const hull = K.smoothLoft(secs, 3);
    b.add(hull, K.pbr('planks', { planks: 6, color }), null);
    const inner = K.solid(0x5a4030, { roughness: 0.9 });
    for (const z of [-len * 0.2, len * 0.15]) b.add(new THREE.BoxGeometry(beam * 0.8, 0.06, 0.3), inner, K.mat4([0, H * 0.9, z]));
    b.add(new THREE.BoxGeometry(beam * 0.75, 0.04, len * 0.7), inner, K.mat4([0, H * 0.35, 0]));
    const r = new K.RNG(bseed); if (r.chance(0.6)) b.add(new THREE.CylinderGeometry(0.05, 0.06, len * 0.8, 6), inner, K.mat4([0, H + len * 0.4, len * 0.12]));
    return b.build({ name: 'boat' });
  };
  const boats = [[PX - 4.5, 50, 0.15, 5, 1.8, 0x3a6a8a], [PX + 4.5, 44, -0.1, 4.5, 1.6, 0xb84a2a], [PX - 6, Z1 + 4, 1.4, 6, 2.1, 0xd8c8a0], [22, 52, 0.6, 4, 1.5, 0x4a7a4a]];
  boats.forEach(([x, z, ry, L, B, c], i) => { const bt = boat(L, B, c, i); bt.position.set(x, -0.25, z); bt.rotation.set(0.02, ry, 0.03 * (i % 2 ? 1 : -1)); g.add(bt); });
  // one beached boat, tilted on the sand
  { const bt = boat(4, 1.5, 0x8a3a2a, 9), x = -4, z = shoreZ(-4) - 5; bt.position.set(x, T.heightAt(x, z) - 0.15, z); bt.rotation.set(0, 2.2, 0.18); g.add(bt); }

  // fish-drying racks on the upper beach (storytelling)
  const rackWood = K.pbr('planks', { planks: 1, color: 0x5a4430 }), net = K.solid(0x4a4a38, { roughness: 1, side: THREE.DoubleSide, transparent: true, opacity: 0.7 });
  for (const [x, ry] of [[-14, 0.2], [-20, -0.1], [26, 0.3]]) {
    const z = shoreZ(x) - 9, r = new K.MeshBuilder();
    for (const s of [-1.5, 1.5]) r.add(new THREE.CylinderGeometry(0.06, 0.07, 2.0, 6), rackWood, K.mat4([s, 1.0, 0]));
    r.add(new THREE.CylinderGeometry(0.05, 0.05, 3.2, 6), rackWood, K.mat4([0, 1.9, 0], [0, 0, Math.PI / 2]));
    r.add(new THREE.PlaneGeometry(2.9, 1.4, 6, 3), net, K.mat4([0, 1.2, 0.02], [0.05, 0, 0]));
    const o = r.build({ name: 'rack' }); o.position.set(x, T.heightAt(x, z) - 0.05, z); o.rotation.y = ry; g.add(o);
  }
  [[-8, 2.6, 0.12], [20, 0.9, -0.15]].forEach(([x, ry, roll], i) => { const z = shoreZ(x) - 4, bt = boat(4.2, 1.6, [0x2a5a7a, 0xc8b070][i], 20 + i); bt.position.set(x, T.heightAt(x, z) - 0.2, z); bt.rotation.set(0, ry, roll); g.add(bt); });
  // --- market plaza at the pier head on land
  const stallColors = [0xb83a2e, 0x2e6ab8, 0xd8a030, 0x3a8a4a];
  [[4, 15, 0.4], [7, 21, 0.9], [14, 21, -0.6], [16, 14, -1.2]].forEach(([x, z, ry], i) => { const s = K.PROPS.stall({ awning: stallColors[i], seed: i }); s.position.set(x, T.heightAt(x, z), z); s.rotation.y = ry; g.add(s); });
  const props = [];
  for (let i = 0; i < 8; i++) props.push([rng.pick(['barrel', 'crate']), PX + rng.range(-6, 6), rng.range(12, 24)]);
  for (let i = 0; i < 5; i++) props.push([rng.pick(['barrel', 'crate']), PX + rng.range(-1, 1), rng.range(Z0 + 4, Z1)]);
  for (const [k, x, z] of props) { const p = k === 'barrel' ? K.PROPS.barrel({ height: 0.9, radius: 0.32 }) : K.PROPS.crate({ size: 0.7 }); const y = z > Z0 + 2 && Math.abs(x - PX) < 1.5 ? DECK + 0.04 : T.heightAt(x, z); p.position.set(x, y, z); p.rotation.y = rng.range(0, 6); g.add(p); }
  K.PROPS.well && (() => { const w = K.PROPS.well(); w.position.set(10, T.heightAt(10, 18), 18); g.add(w); })();

  // --- lamps along the paths and the pier
  const lampAt = (x, z, y, ry = 0) => { const l = K.PROPS.lampPost({ height: 3.6 }); l.position.set(x, y ?? T.heightAt(x, z), z); l.rotation.y = ry; g.add(l); };
  const c = new THREE.CatmullRomCurve3(mainPath.map(([x, z]) => new THREE.Vector3(x, 0, z)));
  for (let i = 1; i < 12; i++) { const p = c.getPoint(i / 12); lampAt(p.x, p.z + 2.6, undefined, Math.PI / 2); }
  for (let z = Z0 + 6; z <= Z1; z += 12) lampAt(PX + PW / 2 - 0.2, z, DECK + 0.04, Math.PI);

  // --- shoreline rocks (clusters at the beach ends) and vegetation
  for (const cx of [-48, -30, 34, 52, 66]) for (let i = 0; i < 5; i++) {
    const x = cx + rng.gaussian(0, 3), z = shoreZ(cx) + rng.range(-3, 5), size = (i === 0 ? 2.6 : rng.range(0.6, 1.6)), r = K.PROPS.rock({ seed: i + cx, size });
    r.position.set(x, T.heightAt(x, z) - 0.25 * size, z); r.rotation.y = rng.range(0, 6); g.add(r);
  }
  const exclude = [{ x: 10, z: 18, r: 12 }, ...houses.map((h) => ({ x: h.x, z: h.z, rect: [h.w + 2, h.dpt + 2], pad: 2 }))];
  for (let x = -80; x <= 80; x += 6) exclude.push({ x, z: shoreZ(x) - 2, r: 10 });
  for (const P of [mainPath, sidePath]) { const cc = new THREE.CatmullRomCurve3(P.map(([x, z]) => new THREE.Vector3(x, 0, z))); for (let i = 0; i <= 40; i++) { const p = cc.getPoint(i / 40); exclude.push({ x: p.x, z: p.z, r: 4 }); } }
  const grassEx = exclude.map((e) => ({ ...e, x: e.x - OX, z: e.z - OZ }));
  root.add(W.grassField(hf, { count: 6000, seed, exclude: grassEx, color: 0x6a8a32 }));
  // density gradient: keep the village core open (only a few garden trees), forest on the hills and flanks
  exclude.push({ x: 0, z: 4, rect: [96, 26], pad: 0 });
  for (const [x, z] of [[-24, -10], [10, -9], [-48, 16], [34, 20], [-10, 22]]) { const tr = K.PROPS.tree({ species: 'oak', seed: x + 99 }); tr.position.set(x, T.heightAt(x, z) - 0.2, z); tr.scale.setScalar(0.8); g.add(tr); }
  const veg = W.populate(hf, { exclude: exclude.map((e) => ({ ...e, x: e.x - OX, z: e.z - OZ })), seed, trees: 420, rocks: 40, bushes: 220, grass: 0, species: ['pine', 'oak', 'birch'] });
  root.add(veg.group);
  // golden-hour shim: the review tool has no time-of-day flag, so retint the tool's sun/sky/fog at render time.
  const shim = new THREE.Mesh(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3)), new THREE.MeshBasicMaterial());
  shim.frustumCulled = false; shim.castShadow = shim.receiveShadow = false;
  const sunDir = new THREE.Vector3(-0.8, 0.1, 0.58).normalize();
  shim.onBeforeRender = (renderer, scene) => {
    scene.traverse((o) => {
      if (o.isDirectionalLight) { o.color.setRGB(1.0, 0.56, 0.3); o.intensity = 3.4; o.position.copy(o.target.position).addScaledVector(sunDir, 150); }
      else if (o.isHemisphereLight) { o.color.setRGB(0.42, 0.5, 0.72); o.groundColor.setRGB(0.22, 0.16, 0.1); o.intensity = 0.5; }
      else if (o.material?.uniforms?.sunPosition) { o.material.uniforms.sunPosition.value.copy(sunDir); o.material.uniforms.turbidity.value = 2.5; o.material.uniforms.rayleigh.value = 3.0; }
    });
    if (scene.fog) scene.fog.color.setRGB(0.95, 0.72, 0.55);
    renderer.toneMappingExposure = 0.8; scene.environmentIntensity = 0.25;
  };
  g.add(shim);
  return root;
}
