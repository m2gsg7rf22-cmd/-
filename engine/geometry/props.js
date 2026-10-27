// Procedural prop library. Every generator returns a THREE.Group whose meshes are merged
// per material, with userData.collider describing a physics proxy and userData.kind.
import * as THREE from '../vendor/three/three.module.js';
import { MeshBuilder, mat4, lathe, tube, roundedBox, displace, boxUV, loft, ellipseRing } from './builders.js';
import { pbr, solid, emissive, applyWind } from '../render/materials.js';
import { RNG } from '../core/rng.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
function finish(group, kind, collider) { group.name = kind; group.userData.kind = kind; if (collider) group.userData.collider = collider; return group; }

// ---------- Nature ----------
export function tree({ species = 'oak', seed = 1, height = 6, leafColor, trunkColor } = {}) {
  const rng = new RNG(seed), mb = new MeshBuilder();
  const bark = pbr('bark', { repeat: [1, 2], color: trunkColor ?? 0x4a3828 });
  const leafMat = applyWind(solid(leafColor ?? (species === 'pine' ? 0x2f5a2e : species === 'palm' ? 0x4f8a34 : rng.pick([0x4c7a2c, 0x5a8a30, 0x3f6e2a, 0x6d8f2e])), { roughness: 0.85, flat: false }), { instanced: false, strength: 0.08 });
  if (species === 'pine') {
    mb.add(tube([V(0, 0, 0), V(0, height * 0.5, 0), V(0, height, 0)], (t) => 0.22 * (1 - t * 0.8), 7, 6), bark);
    const tiers = 5;
    for (let i = 0; i < tiers; i++) {
      const t = i / tiers, r = (1 - t) * height * 0.32 + 0.4, h = height * 0.32;
      const cone = displace(new THREE.ConeGeometry(r, h, 9, 3), { amount: 0.18, frequency: 1.2, seed: seed + i });
      mb.add(cone, leafMat, mat4([0, height * 0.28 + t * height * 0.62, 0], [0, rng.range(0, 6), 0]));
    }
    return finish(mb.build(), 'tree', { type: 'cylinder', radius: 0.3, height });
  }
  if (species === 'palm') {
    const lean = rng.range(0.6, 1.4), pts = [];
    for (let i = 0; i <= 6; i++) { const t = i / 6; pts.push(V(Math.sin(t * 1.2) * lean, t * height, 0)); }
    mb.add(tube(pts, (t) => 0.2 * (1 - t * 0.4), 8, 12), pbr('bark', { repeat: [1, 6], color: 0x7a6248 }));
    const top = pts[pts.length - 1];
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + rng.range(-0.2, 0.2), len = rng.range(2.4, 3.2);
      const sections = [];
      for (let k = 0; k <= 6; k++) { const t = k / 6; sections.push({ z: t * len, y: -t * t * 1.4, ring: [[-0.02, 0], [0.45 * Math.sin(t * Math.PI) + 0.03, 0.04], [0.02, 0], [-0.45 * Math.sin(t * Math.PI) - 0.03, 0.04]] }); }
      const frond = loft(sections, { caps: false });
      mb.add(frond, leafMat, mat4([top.x, top.y, top.z], [rng.range(-0.3, 0.1), a, 0]));
    }
    return finish(mb.build(), 'tree', { type: 'cylinder', radius: 0.3, height });
  }
  // oak / broadleaf: tapered trunk + branches + clustered displaced canopy blobs
  const trunkTop = V(rng.range(-0.3, 0.3), height * 0.55, rng.range(-0.3, 0.3));
  mb.add(tube([V(0, -0.2, 0), V(0, height * 0.25, 0), trunkTop], (t) => 0.38 * (1 - t * 0.55) + (t < 0.08 ? 0.15 * (1 - t / 0.08) : 0), 9, 10), bark);
  const blobs = species === 'dead' ? 0 : rng.int(5, 8);
  for (let b = 0; b < rng.int(3, 5); b++) {
    const a = rng.range(0, Math.PI * 2), len = rng.range(1.2, 2.2);
    const end = trunkTop.clone().add(V(Math.cos(a) * len, rng.range(0.6, 1.6), Math.sin(a) * len));
    mb.add(tube([trunkTop.clone().add(V(0, -0.4, 0)), trunkTop.clone().lerp(end, 0.5).add(V(0, 0.2, 0)), end], (t) => 0.16 * (1 - t * 0.7), 6, 6), bark);
  }
  for (let i = 0; i < blobs; i++) {
    const a = rng.range(0, Math.PI * 2), d = i === 0 ? 0 : rng.range(0.9, 2.0);
    const r = rng.range(1.2, 1.9) * height / 6;
    const blob = displace(new THREE.IcosahedronGeometry(r, 2), { amount: r * 0.28, frequency: 1.1 / r, seed: seed * 13 + i });
    mb.add(blob, leafMat, mat4([trunkTop.x + Math.cos(a) * d, height * 0.68 + rng.range(-0.4, 0.9) * height / 6, trunkTop.z + Math.sin(a) * d], [0, 0, 0], [1, rng.range(0.75, 0.95), 1]));
  }
  return finish(mb.build(), 'tree', { type: 'cylinder', radius: 0.4, height });
}

export function rock({ seed = 1, size = 1, color, flatness = 0.7 } = {}) {
  const rng = new RNG(seed);
  let g = displace(new THREE.IcosahedronGeometry(size, 3), { amount: size * 0.35, frequency: 1.4 / size, seed });
  g.scale(rng.range(0.9, 1.4), rng.range(flatness * 0.7, flatness * 1.1), rng.range(0.8, 1.2));
  g = boxUV(g, 0.5);
  const mb = new MeshBuilder().add(g, pbr('rock', { color: color ?? 0x6e6a64, moss: 0.35 }), mat4([0, size * 0.25, 0], [rng.range(0, 1), rng.range(0, 6), 0]));
  return finish(mb.build(), 'rock', { type: 'sphere', radius: size * 0.95 });
}

export function bush({ seed = 1, size = 1, color = 0x46702a } = {}) {
  const rng = new RNG(seed), mb = new MeshBuilder();
  const m = applyWind(solid(color, { roughness: 0.9 }), { instanced: false, strength: 0.05 });
  for (let i = 0; i < 4; i++) {
    const r = size * rng.range(0.45, 0.7);
    mb.add(displace(new THREE.IcosahedronGeometry(r, 1), { amount: r * 0.3, seed: seed + i }), m, mat4([rng.range(-0.5, 0.5) * size, r * 0.8, rng.range(-0.5, 0.5) * size]));
  }
  return finish(mb.build(), 'bush', null);
}

// ---------- Village / dressing ----------
export function crate({ size = 1 } = {}) {
  const mb = new MeshBuilder(), wood = pbr('planks', { planks: 4, color: 0x9a6a3c });
  mb.add(roundedBox(size, size, size, size * 0.04, 1), wood);
  const frame = pbr('planks', { planks: 1, color: 0x6a4424 });
  const t = size * 0.08;
  for (const [x, z, sx, sz] of [[0, size / 2, size + 0.01, t], [0, -size / 2, size + 0.01, t], [size / 2, 0, t, size + 0.01], [-size / 2, 0, t, size + 0.01]]) {
    mb.add(new THREE.BoxGeometry(sx, t, sz), frame, mat4([x, size / 2, z]));
    mb.add(new THREE.BoxGeometry(sx, t, sz), frame, mat4([x, -size / 2, z]));
  }
  const g = mb.build(); g.children.forEach((c) => c.position.y += size / 2);
  return finish(g, 'crate', { type: 'box', size: [size, size, size], offset: [0, size / 2, 0] });
}

export function barrel({ height = 1.2, radius = 0.45 } = {}) {
  const mb = new MeshBuilder();
  const prof = []; for (let i = 0; i <= 10; i++) { const t = i / 10; prof.push([radius * (0.86 + 0.14 * Math.sin(t * Math.PI)), t * height]); }
  mb.add(lathe(prof, 20), pbr('planks', { planks: 12, color: 0x8a5a30, repeat: [1, 1] }));
  mb.add(new THREE.CircleGeometry(radius * 0.86, 20), pbr('planks', { planks: 5 }), mat4([0, height - 0.01, 0], [-Math.PI / 2, 0, 0]));
  const band = solid(0x3a3a3c, { metalness: 0.8, roughness: 0.45 });
  for (const t of [0.12, 0.5, 0.88]) { const r = radius * (0.86 + 0.14 * Math.sin(t * Math.PI)) + 0.01; mb.add(new THREE.CylinderGeometry(r, r, 0.06, 20, 1, true), band, mat4([0, t * height, 0])); }
  return finish(mb.build(), 'barrel', { type: 'cylinder', radius, height });
}

export function lampPost({ height = 5, lightColor = 0xffd9a0, withLight = false } = {}) {
  const mb = new MeshBuilder(), metal = solid(0x2a2d31, { metalness: 0.7, roughness: 0.4 });
  mb.add(lathe([[0.22, 0], [0.2, 0.3], [0.1, 0.4], [0.08, height], [0, height]], 12), metal);
  mb.add(tube([V(0, height - 0.1, 0), V(0.4, height + 0.25, 0), V(1.1, height + 0.2, 0)], 0.05, 6, 8), metal);
  mb.add(lathe([[0, 0], [0.32, 0.02], [0.18, 0.2], [0, 0.22]], 12), metal, mat4([1.1, height + 0.02, 0]));
  mb.add(new THREE.SphereGeometry(0.15, 10, 6), emissive(lightColor, 6), mat4([1.1, height - 0.02, 0]));
  const g = mb.build();
  if (withLight) { const l = new THREE.PointLight(lightColor, 12, 14, 2); l.position.set(1.1, height - 0.3, 0); g.add(l); }
  g.userData.lightAnchor = [1.1, height - 0.3, 0];
  return finish(g, 'lampPost', { type: 'cylinder', radius: 0.25, height });
}

export function fence({ length = 4, height = 1.1, posts = 3, color = 0x8a6440 } = {}) {
  const mb = new MeshBuilder(), wood = pbr('planks', { planks: 1, color });
  for (let i = 0; i < posts; i++) { const x = -length / 2 + (i / (posts - 1)) * length; mb.add(roundedBox(0.14, height, 0.14, 0.03, 1), wood, mat4([x, height / 2, 0], [0, 0, (i % 2 ? 0.03 : -0.02)])); }
  for (const y of [0.35, 0.8]) mb.add(new THREE.BoxGeometry(length, 0.1, 0.05), wood, mat4([0, y * height, 0.08]));
  return finish(mb.build(), 'fence', { type: 'box', size: [length, height, 0.25], offset: [0, height / 2, 0] });
}

export function bench() {
  const mb = new MeshBuilder(), wood = pbr('planks', { planks: 1, color: 0x9a6a3c }), iron = solid(0x232527, { metalness: 0.8, roughness: 0.5 });
  for (let i = 0; i < 3; i++) mb.add(roundedBox(1.8, 0.05, 0.12, 0.02, 1), wood, mat4([0, 0.45, -0.15 + i * 0.15]));
  for (let i = 0; i < 2; i++) mb.add(roundedBox(1.8, 0.12, 0.04, 0.02, 1), wood, mat4([0, 0.65 + i * 0.16, -0.25], [-0.15, 0, 0]));
  for (const x of [-0.75, 0.75]) { mb.add(new THREE.BoxGeometry(0.06, 0.45, 0.4), iron, mat4([x, 0.22, -0.05])); mb.add(new THREE.BoxGeometry(0.06, 0.5, 0.06), iron, mat4([x, 0.65, -0.27], [-0.15, 0, 0])); }
  return finish(mb.build(), 'bench', { type: 'box', size: [1.8, 0.9, 0.6], offset: [0, 0.45, -0.05] });
}

export function chest({ color = 0x7a4a26 } = {}) {
  const base = new MeshBuilder(), lid = new MeshBuilder();
  const wood = pbr('planks', { planks: 4, color }), gold = solid(0xd4a73a, { metalness: 1, roughness: 0.3 });
  base.add(roundedBox(1, 0.55, 0.65, 0.03, 1), wood, mat4([0, 0.275, 0]));
  for (const x of [-0.42, 0.42]) base.add(new THREE.BoxGeometry(0.06, 0.57, 0.67), gold, mat4([x, 0.275, 0]));
  const half = new THREE.CylinderGeometry(0.325, 0.325, 1, 14, 1, false, 0, Math.PI); half.rotateZ(Math.PI / 2); half.rotateX(Math.PI / 2);
  lid.add(half, wood, mat4([0, 0, 0.325]));
  lid.add(new THREE.BoxGeometry(0.14, 0.18, 0.05), gold, mat4([0, 0.0, 0.66]));
  const g = base.build(); const l = lid.build(); l.position.set(0, 0.55, -0.325); l.name = 'lid'; g.add(l);
  return finish(g, 'chest', { type: 'box', size: [1, 0.9, 0.7], offset: [0, 0.45, 0] });
}

export function torch({ height = 1.6 } = {}) {
  const mb = new MeshBuilder();
  mb.add(lathe([[0.05, 0], [0.04, height], [0.12, height + 0.05], [0.1, height + 0.2], [0, height + 0.2]], 8), pbr('planks', { planks: 1, color: 0x4a3020 }));
  mb.add(new THREE.ConeGeometry(0.12, 0.38, 8), emissive(0xff8a2a, 5), mat4([0, height + 0.36, 0]));
  const g = mb.build(); g.userData.lightAnchor = [0, height + 0.4, 0];
  return finish(g, 'torch', { type: 'cylinder', radius: 0.08, height });
}

export function pillar({ height = 5, radius = 0.45, broken = false, seed = 1 } = {}) {
  const rng = new RNG(seed), mb = new MeshBuilder(), stone = pbr('rock', { color: 0xb0a898, moss: 0.25, repeat: [2, 2] });
  const h = broken ? height * rng.range(0.35, 0.7) : height;
  const prof = [[radius * 1.35, 0], [radius * 1.35, 0.3], [radius * 1.05, 0.42], [radius, 0.5]];
  for (let i = 1; i <= 8; i++) prof.push([radius * (1 - 0.12 * (i / 8)), 0.5 + (h - 1) * (i / 8)]);
  if (!broken) prof.push([radius * 1.2, h - 0.35], [radius * 1.4, h - 0.2], [radius * 1.4, h], [0, h]); else prof.push([0, h - 0.5 + 0.3]);
  let g = lathe(prof, 16);
  if (broken) g = displace(g, { amount: 0.05, frequency: 3, seed });
  mb.add(boxUV(g, 0.6), stone);
  return finish(mb.build(), 'pillar', { type: 'cylinder', radius: radius * 1.3, height: h });
}

export function stoneWall({ length = 6, height = 2.5, thickness = 0.8, seed = 1, ruined = false } = {}) {
  const rng = new RNG(seed), mb = new MeshBuilder(), stone = pbr('cobble', { cells: 6, color: 0x8d877c, color2: 0x6c675f });
  let g = roundedBox(length, height, thickness, 0.08, 2);
  if (ruined) {
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) { const y = pos.getY(i); if (y > 0) pos.setY(i, y - (Math.sin(pos.getX(i) * 1.3 + seed) * 0.5 + 0.5) * height * 0.45 * rng.range(0.8, 1)); }
    g.computeVertexNormals();
  }
  mb.add(boxUV(g, 0.35), stone, mat4([0, height / 2, 0]));
  return finish(mb.build(), 'wall', { type: 'box', size: [length, height, thickness], offset: [0, height / 2, 0] });
}

export function stall({ awning = 0xb83a2e, seed = 1 } = {}) {
  const mb = new MeshBuilder(), wood = pbr('planks', { planks: 1, color: 0x7a5434 });
  for (const [x, z] of [[-1.2, -0.8], [1.2, -0.8], [-1.2, 0.8], [1.2, 0.8]]) mb.add(new THREE.CylinderGeometry(0.06, 0.06, 2.4, 6), wood, mat4([x, 1.2, z]));
  mb.add(roundedBox(2.5, 0.12, 1.4, 0.03, 1), pbr('planks', { planks: 5 }), mat4([0, 0.9, 0.2]));
  const cloth = pbr('fabric', { color: awning, stripe: 0xf0e6d0, weave: 48, side: THREE.DoubleSide });
  const sections = []; for (let i = 0; i <= 8; i++) { const t = i / 8; sections.push({ z: -1.6 + t * 3.2, ring: [[-1.0, 0], [-0.33, Math.sin(t * Math.PI * 8) * 0.03 + 0.15], [0.33, Math.sin(t * Math.PI * 8) * 0.03 + 0.15], [1.0, 0]] }); }
  const aw = loft(sections, { caps: false, axis: 'x' });
  mb.add(aw, cloth, mat4([0, 2.4, 0], [0.18, 0, 0]));
  const rng = new RNG(seed);
  for (let i = 0; i < 6; i++) mb.add(new THREE.SphereGeometry(0.11, 8, 6), solid(rng.pick([0xd94a2a, 0xf0b030, 0x7ab040, 0xe07a20])), mat4([rng.range(-1, 1), 1.05, rng.range(-0.2, 0.6)]));
  return finish(mb.build(), 'stall', { type: 'box', size: [2.6, 2.4, 1.8], offset: [0, 1.2, 0] });
}

export function well() {
  const mb = new MeshBuilder(), stone = pbr('cobble', { cells: 8 });
  const ring = new THREE.CylinderGeometry(1, 1.05, 0.9, 20, 1, true);
  mb.add(boxUV(ring, 0.7), stone, mat4([0, 0.45, 0]));
  mb.add(new THREE.RingGeometry(0.85, 1.05, 20), stone, mat4([0, 0.9, 0], [-Math.PI / 2, 0, 0]));
  mb.add(new THREE.CircleGeometry(0.86, 20), solid(0x1d3a4a, { roughness: 0.05, metalness: 0.2 }), mat4([0, 0.5, 0], [-Math.PI / 2, 0, 0]));
  const wood = pbr('planks', { planks: 1, color: 0x6a4424 });
  for (const x of [-0.95, 0.95]) mb.add(new THREE.BoxGeometry(0.12, 2.2, 0.12), wood, mat4([x, 1.1, 0]));
  mb.add(new THREE.ConeGeometry(1.5, 0.8, 4, 1), pbr('roof', { repeat: [2, 1] }), mat4([0, 2.5, 0], [0, Math.PI / 4, 0]));
  return finish(mb.build(), 'well', { type: 'cylinder', radius: 1.05, height: 1 });
}

// ---------- Weapons & pickups ----------
export function sword({ length = 1.0, bladeColor = 0xd8dde3, gripColor = 0x3a2416, accent = 0xc79a3a } = {}) {
  const mb = new MeshBuilder();
  const shape = new THREE.Shape();
  const w = 0.045;
  shape.moveTo(-w, 0); shape.lineTo(-w * 0.95, length * 0.82); shape.lineTo(0, length); shape.lineTo(w * 0.95, length * 0.82); shape.lineTo(w, 0); shape.lineTo(-w, 0);
  const blade = new THREE.ExtrudeGeometry(shape, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.012, bevelSegments: 1 });
  blade.translate(0, 0, -0.006);
  mb.add(blade, solid(bladeColor, { metalness: 1, roughness: 0.22 }), mat4([0, 0.12, 0]));
  mb.add(roundedBox(0.28, 0.035, 0.05, 0.012, 1), solid(accent, { metalness: 1, roughness: 0.35 }), mat4([0, 0.12, 0]));
  mb.add(new THREE.CylinderGeometry(0.02, 0.022, 0.16, 8), pbr('leather', { color: gripColor }), mat4([0, 0.03, 0]));
  mb.add(new THREE.SphereGeometry(0.032, 8, 6), solid(accent, { metalness: 1, roughness: 0.35 }), mat4([0, -0.06, 0]));
  return finish(mb.build({ castShadow: true }), 'sword', null);
}

export function axe() {
  const mb = new MeshBuilder();
  mb.add(new THREE.CylinderGeometry(0.022, 0.026, 0.9, 8), pbr('planks', { planks: 1, color: 0x6a4424 }), mat4([0, 0.35, 0]));
  const s = new THREE.Shape(); s.moveTo(0, -0.08); s.quadraticCurveTo(0.12, -0.16, 0.24, -0.2); s.quadraticCurveTo(0.2, 0, 0.24, 0.2); s.quadraticCurveTo(0.12, 0.16, 0, 0.08);
  const head = new THREE.ExtrudeGeometry(s, { depth: 0.02, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.01, bevelSegments: 1 });
  mb.add(head, solid(0xb8bcc2, { metalness: 1, roughness: 0.3 }), mat4([0.02, 0.72, -0.01]));
  return finish(mb.build(), 'axe', null);
}

export function shield({ radius = 0.38, color = 0x7a2a22, rim = 0xb08a40 } = {}) {
  const mb = new MeshBuilder();
  mb.add(lathe([[0, 0.06], [radius * 0.5, 0.05], [radius, 0], [radius, -0.02], [0, -0.02]], 24), pbr('paintedMetal', { color, rust: 0.15 }), mat4([0, 0, 0], [Math.PI / 2, 0, 0]));
  mb.add(new THREE.TorusGeometry(radius, 0.025, 6, 24), solid(rim, { metalness: 1, roughness: 0.35 }));
  mb.add(new THREE.SphereGeometry(0.07, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), solid(rim, { metalness: 1, roughness: 0.3 }), mat4([0, 0, 0.05], [Math.PI / 2, 0, 0]));
  return finish(mb.build(), 'shield', null);
}

export function staff({ gem = 0x6ad0ff } = {}) {
  const mb = new MeshBuilder();
  mb.add(tube([V(0, -0.2, 0), V(0.02, 0.6, 0), V(-0.02, 1.3, 0), V(0.04, 1.55, 0)], (t) => 0.025 * (1 - t * 0.3), 6, 10), pbr('bark'));
  mb.add(new THREE.OctahedronGeometry(0.08, 0), emissive(gem, 4), mat4([0.04, 1.65, 0]));
  return finish(mb.build(), 'staff', null);
}

export function pickup({ type = 'coin', color } = {}) {
  const mb = new MeshBuilder();
  if (type === 'coin') mb.add(new THREE.CylinderGeometry(0.25, 0.25, 0.05, 20), solid(color ?? 0xf2c14e, { metalness: 1, roughness: 0.25, emissive: 0x3a2600 }), mat4([0, 0, 0], [Math.PI / 2, 0, 0]));
  else if (type === 'gem') mb.add(new THREE.OctahedronGeometry(0.25, 0), solid(color ?? 0x3ad0ff, { metalness: 0.2, roughness: 0.05, emissive: color ?? 0x0a4a6a, emissiveIntensity: 1.5 }), mat4([0, 0, 0], [0, 0, 0], [1, 1.4, 1]));
  else if (type === 'health') { mb.add(new THREE.SphereGeometry(0.22, 16, 10), emissive(color ?? 0xff3b4a, 2.5)); mb.add(new THREE.TorusGeometry(0.3, 0.02, 6, 24), solid(0xffffff, { metalness: 1, roughness: 0.2 })); }
  else if (type === 'key') { mb.add(new THREE.TorusGeometry(0.1, 0.03, 6, 16), solid(0xd4a73a, { metalness: 1, roughness: 0.3 }), mat4([0, 0.15, 0])); mb.add(new THREE.BoxGeometry(0.04, 0.3, 0.04), solid(0xd4a73a, { metalness: 1, roughness: 0.3 }), mat4([0, -0.08, 0])); }
  else mb.add(new THREE.IcosahedronGeometry(0.22, 1), emissive(color ?? 0x9a6aff, 2));
  const g = mb.build({ castShadow: true }); g.userData.pickup = type;
  return finish(g, 'pickup:' + type, { type: 'sphere', radius: 0.5, trigger: true });
}

// ---------- Urban ----------
export function trafficCone() {
  const mb = new MeshBuilder();
  mb.add(new THREE.ConeGeometry(0.18, 0.7, 14), solid(0xff5a1a, { roughness: 0.5 }), mat4([0, 0.38, 0]));
  mb.add(new THREE.CylinderGeometry(0.115, 0.135, 0.12, 14, 1, true), solid(0xf0f0f0, { roughness: 0.3, emissive: 0x222222 }), mat4([0, 0.38, 0]));
  mb.add(new THREE.BoxGeometry(0.45, 0.04, 0.45), solid(0x222222), mat4([0, 0.02, 0]));
  return finish(mb.build(), 'cone', { type: 'cylinder', radius: 0.2, height: 0.7, dynamic: true });
}
export function hydrant() {
  const mb = new MeshBuilder(), red = solid(0xb81e1e, { metalness: 0.4, roughness: 0.45 });
  mb.add(lathe([[0.16, 0], [0.16, 0.08], [0.12, 0.1], [0.12, 0.6], [0.15, 0.62], [0.13, 0.7], [0.06, 0.8], [0, 0.82]], 12), red);
  mb.add(new THREE.CylinderGeometry(0.05, 0.05, 0.36, 8), red, mat4([0, 0.45, 0], [0, 0, Math.PI / 2]));
  return finish(mb.build(), 'hydrant', { type: 'cylinder', radius: 0.17, height: 0.8 });
}
export function trashBin() {
  const mb = new MeshBuilder();
  mb.add(lathe([[0.26, 0], [0.3, 0.9], [0.32, 0.95], [0, 0.95]], 14), pbr('paintedMetal', { color: 0x2e4a3a, rust: 0.2 }));
  return finish(mb.build(), 'bin', { type: 'cylinder', radius: 0.3, height: 0.95, dynamic: true });
}
export function trafficLight({ height = 4.5, arm = 3 } = {}) {
  const mb = new MeshBuilder(), metal = solid(0x2a2c2f, { metalness: 0.7, roughness: 0.45 });
  mb.add(new THREE.CylinderGeometry(0.1, 0.12, height, 10), metal, mat4([0, height / 2, 0]));
  mb.add(new THREE.CylinderGeometry(0.07, 0.07, arm, 8), metal, mat4([arm / 2, height - 0.2, 0], [0, 0, Math.PI / 2]));
  mb.add(roundedBox(0.32, 0.9, 0.3, 0.05, 1), solid(0x1a1b1d, { roughness: 0.5 }), mat4([arm - 0.2, height - 0.65, 0]));
  const cols = [0xff2a1a, 0xffb21a, 0x2aff6a];
  cols.forEach((c, i) => mb.add(new THREE.SphereGeometry(0.09, 10, 6), emissive(c, i === 2 ? 4 : 0.4), mat4([arm - 0.2, height - 0.38 - i * 0.27, 0.15])));
  return finish(mb.build(), 'trafficLight', { type: 'cylinder', radius: 0.15, height });
}
export function barrier({ length = 2 } = {}) {
  const mb = new MeshBuilder();
  const sect = []; for (const z of [-length / 2, length / 2]) sect.push({ z, ring: [[-0.3, 0], [0.3, 0], [0.1, 0.25], [0.1, 0.8], [-0.1, 0.8], [-0.1, 0.25]] });
  mb.add(boxUV(loft(sect), 1), pbr('concrete', { color: 0xb5b2aa }), mat4([0, 0, 0], [0, Math.PI / 2, 0]));
  return finish(mb.build(), 'barrier', { type: 'box', size: [length, 0.8, 0.6], offset: [0, 0.4, 0] });
}

// Registry for spec-driven worlds: { kind: generator }.
export const PROPS = { tree, rock, bush, crate, barrel, lampPost, fence, bench, chest, torch, pillar, stoneWall, stall, well, sword, axe, shield, staff, pickup, trafficCone, hydrant, trashBin, trafficLight, barrier };
void ellipseRing;
