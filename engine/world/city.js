// Procedural city: road grid with lane-marked asphalt, intersections, curbs/sidewalks,
// zoned buildings (downtown towers -> shops at the edge), parks, street furniture,
// knock-able props, a lane graph for traffic AI, and a TrafficSystem.
import * as THREE from '../vendor/three/three.module.js';
import { RNG } from '../core/rng.js';
import { MeshBuilder, mat4, mergeByMaterial } from '../geometry/builders.js';
import { pbr, solid } from '../render/materials.js';
import { tower, shop, house } from '../geometry/buildings.js';
import { PROPS } from '../geometry/props.js';
import { car } from '../geometry/vehicles.js';

export function generateCity({ seed = 1, blocks = 5, blockSize = 56, roadWidth = 14, style = 'modern', parkChance = 0.12, sidewalk = 4, maxFloors = 30, props = true } = {}) {
  const rng = new RNG(seed);
  const pitch = blockSize + roadWidth, half = (blocks * pitch) / 2;
  const roadCenters = []; for (let i = 0; i <= blocks; i++) roadCenters.push(-half + i * pitch);
  const group = new THREE.Group(); group.name = 'city';
  const roadMB = new MeshBuilder();
  const asphalt = pbr('asphalt', { lanes: true, repeat: [1, 1] }), plain = pbr('asphalt', {}), walkMat = pbr('tiles', { tiles: 4, color: 0xa8a49c }), curbMat = pbr('concrete', { color: 0x8a8882 });
  const extent = half + roadWidth / 2;
  // Roads: one strip per grid line in each axis, segmented between intersections
  for (const x of roadCenters) for (let i = 0; i < blocks; i++) {
    const z0 = roadCenters[i] + roadWidth / 2, z1 = roadCenters[i + 1] - roadWidth / 2, len = z1 - z0;
    const g = new THREE.PlaneGeometry(roadWidth, len); g.rotateX(-Math.PI / 2);
    const uv = g.attributes.uv; for (let k = 0; k < uv.count; k++) uv.setY(k, uv.getY(k) * len / 14);
    roadMB.add(g, asphalt, mat4([x, 0.02, (z0 + z1) / 2]));
  }
  for (const z of roadCenters) for (let i = 0; i < blocks; i++) {
    const x0 = roadCenters[i] + roadWidth / 2, x1 = roadCenters[i + 1] - roadWidth / 2, len = x1 - x0;
    const g = new THREE.PlaneGeometry(roadWidth, len); g.rotateX(-Math.PI / 2);
    const uv = g.attributes.uv; for (let k = 0; k < uv.count; k++) uv.setY(k, uv.getY(k) * len / 14);
    roadMB.add(g, asphalt, mat4([(x0 + x1) / 2, 0.02, z], [0, Math.PI / 2, 0]));
  }
  for (const x of roadCenters) for (const z of roadCenters) {
    const g = new THREE.PlaneGeometry(roadWidth, roadWidth); g.rotateX(-Math.PI / 2);
    roadMB.add(g, plain, mat4([x, 0.021, z]));
    // crosswalk stripes
    for (const [dx, dz, ry] of [[0, roadWidth / 2 + 1.5, 0], [0, -roadWidth / 2 - 1.5, 0], [roadWidth / 2 + 1.5, 0, Math.PI / 2], [-roadWidth / 2 - 1.5, 0, Math.PI / 2]]) {
      for (let s = -4; s <= 4; s++) { const st = new THREE.PlaneGeometry(0.7, 2.6); st.rotateX(-Math.PI / 2); roadMB.add(st, solid(0xdedad0, { roughness: 0.7 }), mat4([x + dx + (ry ? 0 : s * 1.4), 0.025, z + dz + (ry ? s * 1.4 : 0)], [0, ry, 0])); }
    }
  }
  // Ground outside city
  const outer = new THREE.PlaneGeometry(extent * 2 + 400, extent * 2 + 400); outer.rotateX(-Math.PI / 2);
  roadMB.add(outer, pbr('grass', { repeat: 80 }), mat4([0, -0.02, 0]));
  group.add(roadMB.build({ name: 'roads', castShadow: false }));

  const colliders = [], dynamicProps = [], buildings = [], parks = [], lampAnchors = [];
  const deco = new THREE.Group();
  for (let bi = 0; bi < blocks; bi++) for (let bj = 0; bj < blocks; bj++) {
    const cx = (roadCenters[bi] + roadCenters[bi + 1]) / 2, cz = (roadCenters[bj] + roadCenters[bj + 1]) / 2;
    const inner = blockSize - sidewalk * 2;
    // sidewalk slab with curb
    const slab = new THREE.BoxGeometry(blockSize, 0.18, blockSize);
    const uv = slab.attributes.uv; for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * blockSize / 4, uv.getY(k) * blockSize / 4);
    const sm = new THREE.Mesh(slab, walkMat); sm.position.set(cx, 0.09, cz); sm.receiveShadow = true; deco.add(sm);
    colliders.push({ type: 'box', x: cx, y: 0.09, z: cz, hx: blockSize / 2, hy: 0.09, hz: blockSize / 2, yaw: 0, userData: { kind: 'sidewalk' } });
    const distC = Math.hypot(cx, cz) / half; // 0 centre .. ~1.4 corners
    const isPark = rng.chance(parkChance) && !(bi === Math.floor(blocks / 2) && bj === Math.floor(blocks / 2));
    if (isPark) {
      const lawn = new THREE.Mesh(new THREE.BoxGeometry(inner, 0.22, inner), pbr('grass', { repeat: 6 })); lawn.position.set(cx, 0.11, cz); lawn.receiveShadow = true; deco.add(lawn);
      for (let t = 0; t < 10; t++) { const tr = PROPS.tree({ seed: seed + bi * 31 + bj * 7 + t, species: rng.pick(['oak', 'oak', 'pine']) }); const px = cx + rng.range(-inner / 2 + 3, inner / 2 - 3), pz = cz + rng.range(-inner / 2 + 3, inner / 2 - 3); tr.position.set(px, 0.2, pz); tr.scale.setScalar(rng.range(0.8, 1.2)); deco.add(tr); colliders.push({ type: 'cylinder', x: px, y: 0, z: pz, r: 0.45, h: 6, userData: { kind: 'tree' } }); }
      for (let b = 0; b < 4; b++) { const be = PROPS.bench(); be.position.set(cx + (b < 2 ? -1 : 1) * inner * 0.25, 0.2, cz + (b % 2 ? -1 : 1) * 4); be.rotation.y = b % 2 ? 0 : Math.PI; deco.add(be); }
      parks.push({ x: cx, z: cz, size: inner });
      continue;
    }
    // lots along the block perimeter
    const lotsPerSide = Math.max(1, Math.floor(inner / rng.pick([16, 20, 24])));
    const lotW = inner / lotsPerSide;
    for (let side = 0; side < 4; side++) for (let l = 0; l < lotsPerSide; l++) {
      if (side % 2 === 1 && (l === 0 || l === lotsPerSide - 1)) continue; // corners belong to sides 0/2
      const t = -inner / 2 + lotW * (l + 0.5);
      const depth = Math.min(lotW * rng.range(0.9, 1.3), inner / 2 - 1);
      const w = lotW - 1.2;
      const height = Math.max(2, Math.round(maxFloors * Math.pow(Math.max(0, 1 - distC * 0.8), 1.6) * rng.range(0.4, 1.1)));
      let b;
      if (height >= 6) b = tower({ width: w, depth, floors: height, seed: seed * 101 + bi * 13 + bj * 7 + side * 3 + l, style });
      else if (style === 'suburb' || rng.chance(0.15)) b = house({ width: Math.min(w, 9), depth: Math.min(depth, 8), seed: seed + bi + bj * 3 + l });
      else b = shop({ width: w, depth, floors: Math.max(1, Math.min(3, height)), seed: seed * 7 + bi * 5 + bj + l + side });
      const off = inner / 2 - depth / 2;
      const pos = [[t, off], [off, -t], [-t, -off], [-off, t]][side];
      const yaw = [0, Math.PI / 2, Math.PI, -Math.PI / 2][side];
      b.position.set(cx + pos[0], 0.18, cz + pos[1]); b.rotation.y = yaw;
      deco.add(b); buildings.push(b);
      const c = b.userData.collider;
      const hx = c.size[0] / 2, hz = c.size[2] / 2;
      colliders.push({ type: 'box', x: b.position.x, y: 0.18 + c.size[1] / 2, z: b.position.z, hx, hy: c.size[1] / 2, hz, yaw, userData: { kind: 'building' } });
    }
    // courtyard fill (so blocks look solid from above)
    const fill = new THREE.Mesh(new THREE.BoxGeometry(inner - 2, 0.3, inner - 2), pbr('concrete', { color: 0x6a6862 })); fill.position.set(cx, 0.2, cz); deco.add(fill);
  }
  // Street furniture along sidewalks
  if (props) for (let bi = 0; bi < blocks; bi++) for (let bj = 0; bj < blocks; bj++) {
    const cx = (roadCenters[bi] + roadCenters[bi + 1]) / 2, cz = (roadCenters[bj] + roadCenters[bj + 1]) / 2, e = blockSize / 2 - 1.2;
    for (let s = -1; s <= 1; s += 2) {
      const lp = PROPS.lampPost({ height: 6 }); lp.position.set(cx + s * blockSize * 0.25, 0.18, cz + e); lp.rotation.y = Math.PI / 2; deco.add(lp); lampAnchors.push(new THREE.Vector3(lp.position.x, 5.8, lp.position.z + 1.1)); colliders.push({ type: 'cylinder', x: lp.position.x, y: 0, z: lp.position.z, r: 0.25, h: 6, userData: { kind: 'pole' } });
      const lp2 = PROPS.lampPost({ height: 6 }); lp2.position.set(cx + e, 0.18, cz + s * blockSize * 0.25); deco.add(lp2); lampAnchors.push(new THREE.Vector3(lp2.position.x + 1.1, 5.8, lp2.position.z)); colliders.push({ type: 'cylinder', x: lp2.position.x, y: 0, z: lp2.position.z, r: 0.25, h: 6, userData: { kind: 'pole' } });
    }
    if (rng.chance(0.6)) { const h = PROPS.hydrant(); h.position.set(cx - e, 0.18, cz + rng.range(-10, 10)); deco.add(h); colliders.push({ type: 'cylinder', x: h.position.x, y: 0, z: h.position.z, r: 0.2, h: 0.8, userData: { kind: 'hydrant' } }); }
    for (let k = 0; k < 3; k++) { const kind = rng.pick(['trashBin', 'trafficCone', 'trafficCone', 'barrel']); const p = PROPS[kind]({}); const px = cx + rng.range(-e, e), pz = cz + (rng.chance(0.5) ? e : -e); p.position.set(px, 0.18, pz); dynamicProps.push(p); }
  }
  // traffic lights at intersections
  if (props) for (const x of roadCenters) for (const z of roadCenters) {
    if (Math.abs(x) === half || Math.abs(z) === half) continue;
    const tl = PROPS.trafficLight({}); tl.position.set(x + roadWidth / 2 + 0.8, 0.18, z + roadWidth / 2 + 0.8); tl.rotation.y = Math.PI; deco.add(tl);
    colliders.push({ type: 'cylinder', x: tl.position.x, y: 0, z: tl.position.z, r: 0.2, h: 4.5, userData: { kind: 'pole' } });
  }
  const merged = mergeByMaterial(deco, { name: 'cityStatic' });
  group.add(merged);
  // boundary walls (keep cars in)
  const B = extent + 2;
  for (const [x, z, hx, hz] of [[0, B, B, 1], [0, -B, B, 1], [B, 0, 1, B], [-B, 0, 1, B]]) colliders.push({ type: 'box', x, y: 2, z, hx, hy: 2, hz, yaw: 0, userData: { kind: 'boundary' } });
  // lane graph: nodes at intersections, edges between neighbours (two lanes each way offset)
  const nodes = [], idx = (i, j) => j * (blocks + 1) + i;
  for (let j = 0; j <= blocks; j++) for (let i = 0; i <= blocks; i++) nodes.push({ id: idx(i, j), x: roadCenters[i], z: roadCenters[j], edges: [] });
  for (let j = 0; j <= blocks; j++) for (let i = 0; i <= blocks; i++) {
    if (i < blocks) { nodes[idx(i, j)].edges.push(idx(i + 1, j)); nodes[idx(i + 1, j)].edges.push(idx(i, j)); }
    if (j < blocks) { nodes[idx(i, j)].edges.push(idx(i, j + 1)); nodes[idx(i, j + 1)].edges.push(idx(i, j)); }
  }
  return { group, colliders, dynamicProps, buildings, parks, lampAnchors, graph: { nodes, laneOffset: roadWidth / 4 }, half, extent, roadCenters, roadWidth, blockSize, pitch,
    spawn: { x: roadCenters[Math.floor(blocks / 2)] + roadWidth / 4, z: roadCenters[1] - 10, yaw: 0 },
    isRoad: (x, z) => roadCenters.some((c) => Math.abs(x - c) < roadWidth / 2) || roadCenters.some((c) => Math.abs(z - c) < roadWidth / 2) };
}

// Ambient AI traffic following the lane graph (right-hand traffic).
export class TrafficSystem {
  constructor(scene, city, { count = 12, seed = 3, speed = 11 } = {}) {
    this.city = city; this.rng = new RNG(seed); this.cars = []; this.speed = speed;
    const nodes = city.graph.nodes;
    for (let i = 0; i < count; i++) {
      const rig = car({ type: this.rng.pick(['sedan', 'sedan', 'suv', 'van', 'truck', 'sports']), seed: seed * 13 + i, taxi: this.rng.chance(0.12), detail: 'low' });
      scene.add(rig);
      const a = this.rng.pick(nodes), b = nodes[this.rng.pick(a.edges)];
      const c = { rig, from: a, to: b, t: this.rng.next(), speed: speed * this.rng.range(0.8, 1.15), cur: 0, position: new THREE.Vector3(), yaw: 0, radius: 1.1, stopped: 0, hit: 0 };
      this.cars.push(c);
    }
  }
  _lanePoint(c, t) {
    const off = this.city.graph.laneOffset, dx = c.to.x - c.from.x, dz = c.to.z - c.from.z, l = Math.hypot(dx, dz);
    const nx = dz / l, nz = -dx / l; // right-hand normal
    return new THREE.Vector3(c.from.x + dx * t - nx * off, 0, c.from.z + dz * t - nz * off);
  }
  update(dt, obstacles = []) {
    for (const c of this.cars) {
      if (c.hit > 0) { c.hit -= dt; c.cur *= Math.exp(-3 * dt); }
      const len = Math.hypot(c.to.x - c.from.x, c.to.z - c.from.z);
      // look ahead for other cars / obstacles
      const ahead = this._lanePoint(c, Math.min(1, c.t + 12 / len));
      let blocked = false;
      for (const o of [...this.cars, ...obstacles]) { if (o === c) continue; const p = o.position; if (p.distanceTo(ahead) < 6 && p.distanceTo(c.position) < 13) { const fwd = ahead.clone().sub(c.position).normalize(); if (p.clone().sub(c.position).dot(fwd) > 0) { blocked = true; break; } } }
      const target = blocked || c.hit > 0 ? 0 : c.speed;
      c.cur += (target - c.cur) * (1 - Math.exp(-(target < c.cur ? 4 : 1.2) * dt));
      c.t += (c.cur * dt) / len;
      if (c.t >= 1) {
        const opts = c.to.edges.filter((e) => e !== c.from.id);
        const next = this.city.graph.nodes[this.rng.pick(opts.length ? opts : c.to.edges)];
        c.from = c.to; c.to = next; c.t = 0;
      }
      const p = this._lanePoint(c, c.t), q = this._lanePoint(c, Math.min(1, c.t + 0.02));
      const wantYaw = Math.atan2(q.x - p.x, q.z - p.z);
      let d = wantYaw - c.yaw; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
      c.yaw += d * (1 - Math.exp(-6 * dt));
      c.position.lerp(p, c.t < 0.05 ? 1 - Math.exp(-6 * dt) : 1);
      c.rig.position.set(c.position.x, 0.02, c.position.z); c.rig.rotation.set(0, c.yaw, 0);
      for (const w of c.rig.userData.wheels) w.spin.rotation.x += (c.cur / w.radius) * dt;
    }
  }
  // Resolve collisions between a player Vehicle and traffic (circle approximation).
  collide(vehicle, onHit) {
    for (const c of this.cars) {
      const d = vehicle.position.clone().sub(c.position); d.y = 0; const dist = d.length(), min = vehicle.radius + 1.5;
      if (dist < min && dist > 1e-3) {
        d.divideScalar(dist); vehicle.position.addScaledVector(d, (min - dist) * 0.7); c.position.addScaledVector(d, -(min - dist) * 0.3);
        const vn = vehicle.velocity.dot(d);
        if (vn < 0) { vehicle.velocity.addScaledVector(d, -1.4 * vn); vehicle.velocity.multiplyScalar(0.8); c.hit = 2.5; onHit?.(-vn, c); }
      }
    }
  }
}
