// Procedural vehicles: lofted bodywork with a glass greenhouse, wheel rigs ready for
// suspension/steering animation, head/brake lights and optional light bar. Forward = +Z.
import * as THREE from '../vendor/three/three.module.js';
import { MeshBuilder, mat4, loft, lathe, roundedBox } from './builders.js';
import { carPaint, solid, emissive, glass, pbr } from '../render/materials.js';
import { RNG } from '../core/rng.js';

export const VEHICLE_TYPES = {
  sedan: { length: 4.6, width: 1.85, height: 1.45, clearance: 0.18, wheelR: 0.34, wheelbase: 2.75, hood: 0.32, trunk: 0.2, cabinStart: 0.3, cabinEnd: 0.72, roof: 0.58 },
  sports: { length: 4.4, width: 1.95, height: 1.18, clearance: 0.12, wheelR: 0.35, wheelbase: 2.6, hood: 0.38, trunk: 0.2, cabinStart: 0.35, cabinEnd: 0.7, roof: 0.42 },
  suv: { length: 4.8, width: 2.0, height: 1.8, clearance: 0.26, wheelR: 0.4, wheelbase: 2.9, hood: 0.3, trunk: 0.06, cabinStart: 0.28, cabinEnd: 0.92, roof: 0.7 },
  truck: { length: 5.4, width: 2.0, height: 1.85, clearance: 0.3, wheelR: 0.42, wheelbase: 3.3, hood: 0.32, trunk: 0.0, cabinStart: 0.3, cabinEnd: 0.58, roof: 0.72, bed: true },
  van: { length: 5.0, width: 2.0, height: 2.1, clearance: 0.22, wheelR: 0.37, wheelbase: 3.1, hood: 0.15, trunk: 0.0, cabinStart: 0.12, cabinEnd: 0.98, roof: 1.0 },
};

// Cross-section of the lower body at a given half-width/height with rounded shoulders.
function bodyRing(n, w, yBottom, yTop, tumble = 0.12) {
  const pts = [];
  const quarter = n / 4;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    const ex = 6, sx = Math.sign(c) * Math.pow(Math.abs(c), 2 / ex), sy = Math.sign(s) * Math.pow(Math.abs(s), 2 / ex);
    const yMid = (yBottom + yTop) / 2, hh = (yTop - yBottom) / 2;
    const y = yMid + sy * hh;
    const taper = s > 0 ? 1 - tumble * sy : 1 - 0.05 * Math.abs(sy);
    pts.push([sx * w * taper, y]);
  }
  void quarter;
  return pts;
}

export function car({ type = 'sedan', color, seed = 1, lightbar = false, taxi = false } = {}) {
  const rng = new RNG(seed);
  const t = { ...VEHICLE_TYPES[type] || VEHICLE_TYPES.sedan };
  const L = t.length, W = t.width / 2, base = t.clearance + 0.12;
  const belt = base + (t.height - t.clearance) * (type === 'van' ? 0.5 : 0.55);
  const paint = carPaint(color ?? (taxi ? 0xf2c230 : rng.pick([0xb01c1c, 0x1c3cb0, 0x202224, 0xe8e8ea, 0x5a6a72, 0x2a6a3a, 0xd0a030, 0x6a1c8a])));
  const mb = new MeshBuilder();
  const N = 24;
  // Lower body: hood slopes down to the nose, trunk slopes to the tail.
  const zs = [-0.5, -0.47, -0.42, -0.3, 0, 0.25, 0.4, 0.47, 0.5];
  const sections = zs.map((zn) => {
    const z = zn * L;
    const nose = zn > 0 ? Math.pow(Math.max(0, (zn - 0.3) / 0.2), 2) : 0;
    const tail = zn < 0 ? Math.pow(Math.max(0, (-zn - 0.36) / 0.14), 2) : 0;
    const top = belt - nose * t.hood * 0.6 - tail * t.trunk * 0.8;
    const bottom = base + nose * 0.08 + tail * 0.06;
    const w = W * (1 - 0.1 * nose - 0.06 * tail);
    return { z, ring: bodyRing(N, w, bottom, top) };
  });
  // close the ends slightly inset for rounded bumpers
  sections[0].scale = 0.92; sections[sections.length - 1].scale = 0.9;
  mb.add(loft(sections, { caps: true }), paint);
  // Greenhouse (glass) from cabinStart..cabinEnd with raked pillars
  const cz0 = -L / 2 + L * (1 - t.cabinEnd), cz1 = -L / 2 + L * (1 - t.cabinStart);
  const roofY = t.height, cabinLen = cz1 - cz0;
  const gl = glass({ color: 0x1a2630, opacity: 0.82 });
  const greenhouse = [];
  const steps = 6;
  for (let i = 0; i <= steps; i++) {
    const k = i / steps, z = cz0 + k * cabinLen;
    const rake = type === 'van' ? Math.min(1, k * 8) : Math.min(1, Math.min(k / 0.3, (1 - k) / 0.35)); // windshield & rear glass rake
    const yTop = belt + (roofY - belt) * Math.max(0.02, Math.pow(rake, 0.6));
    greenhouse.push({ z, ring: bodyRing(N, W * 0.86, belt - 0.02, yTop, 0.25) });
  }
  mb.add(loft(greenhouse, { caps: true }), gl);
  // Roof panel (body colour) over the flat part of the greenhouse
  const r0 = cz0 + cabinLen * (type === 'van' ? 0.12 : 0.3), r1 = cz1 - cabinLen * (type === 'van' ? 0.01 : 0.35);
  mb.add(roundedBox(W * 1.62, 0.07, r1 - r0, 0.03, 1), paint, mat4([0, roofY + 0.01, (r0 + r1) / 2]));
  // pillars
  for (const s of [-1, 1]) mb.add(new THREE.BoxGeometry(0.06, roofY - belt, 0.12), paint, mat4([s * W * 0.84, (roofY + belt) / 2, (r0 + r1) / 2]));
  if (t.bed) {
    const bedMat = pbr('paintedMetal', { color: 0x2a2a2a, rust: 0.1 });
    mb.add(new THREE.BoxGeometry(W * 1.9, 0.08, L * 0.36), bedMat, mat4([0, belt - 0.1, -L * 0.3]));
  }
  // bumpers, grille, trims
  const trim = solid(0x18191b, { roughness: 0.6 });
  mb.add(roundedBox(W * 2.02, 0.22, 0.24, 0.08, 2), trim, mat4([0, base + 0.08, L / 2 - 0.06]));
  mb.add(roundedBox(W * 2.02, 0.22, 0.24, 0.08, 2), trim, mat4([0, base + 0.08, -L / 2 + 0.06]));
  mb.add(new THREE.BoxGeometry(W * 0.9, 0.16, 0.05), solid(0x0b0b0c, { metalness: 0.6, roughness: 0.3 }), mat4([0, base + 0.26, L / 2 - 0.02]));
  for (const s of [-1, 1]) mb.add(new THREE.BoxGeometry(0.05, 0.08, 0.25), trim, mat4([s * (W + 0.02), belt - 0.02, cz1 - 0.15])); // mirrors
  // wheel arches (dark)
  const axleF = t.wheelbase / 2, axleR = -t.wheelbase / 2;
  for (const z of [axleF, axleR]) for (const s of [-1, 1]) {
    const arch = new THREE.CylinderGeometry(t.wheelR + 0.08, t.wheelR + 0.08, 0.3, 16, 1, true, 0, Math.PI);
    arch.rotateZ(Math.PI / 2); arch.rotateX(-Math.PI / 2);
    mb.add(arch, solid(0x0c0c0d, { roughness: 0.9, side: THREE.DoubleSide }), mat4([s * (W - 0.12), t.wheelR + 0.02, z], [0, 0, 0]));
  }
  // lights
  const head = emissive(0xfff4e0, 3), tail = emissive(0xff1a12, 1.2);
  for (const s of [-1, 1]) {
    mb.add(roundedBox(0.36, 0.1, 0.06, 0.03, 1), head, mat4([s * W * 0.68, belt - t.hood * 0.5, L / 2 - 0.08]));
    mb.add(roundedBox(0.38, 0.1, 0.05, 0.03, 1), tail, mat4([s * W * 0.7, belt - t.trunk * 0.8 - 0.05, -L / 2 + 0.05]));
  }
  if (taxi) mb.add(roundedBox(0.6, 0.18, 0.25, 0.05, 1), emissive(0xfff0a0, 2), mat4([0, roofY + 0.14, (r0 + r1) / 2]));
  const body = mb.build({ name: 'body' });
  if (lightbar) {
    const lb = new MeshBuilder();
    lb.add(roundedBox(1.0, 0.12, 0.25, 0.04, 1), emissive(0xff2020, 3), mat4([-0.26, roofY + 0.1, (r0 + r1) / 2], [0, 0, 0], [0.48, 1, 1]));
    lb.add(roundedBox(1.0, 0.12, 0.25, 0.04, 1), emissive(0x2040ff, 3), mat4([0.26, roofY + 0.1, (r0 + r1) / 2], [0, 0, 0], [0.48, 1, 1]));
    body.add(lb.build({ name: 'lightbar' }));
  }

  // Wheels: pivot (steer) -> spin -> mesh
  const tireProfile = [[t.wheelR * 0.62, -0.13], [t.wheelR * 0.92, -0.135], [t.wheelR, -0.1], [t.wheelR, 0.1], [t.wheelR * 0.92, 0.135], [t.wheelR * 0.62, 0.13]];
  const tireGeo = lathe(tireProfile, 22); tireGeo.rotateZ(Math.PI / 2);
  const rimMB = new MeshBuilder();
  const rimMat = solid(rng.pick([0xc0c4c8, 0x2a2a2c, 0x9a8a6a]), { metalness: 1, roughness: 0.25 });
  const rim = new THREE.CylinderGeometry(t.wheelR * 0.64, t.wheelR * 0.64, 0.2, 18); rim.rotateZ(Math.PI / 2);
  rimMB.add(rim, solid(0x1a1a1a, { metalness: 0.8, roughness: 0.5 }));
  for (let i = 0; i < 5; i++) rimMB.add(new THREE.BoxGeometry(0.04, t.wheelR * 1.15, 0.07), rimMat, mat4([0.1, 0, 0], [i * Math.PI * 2 / 5, 0, 0]));
  rimMB.add(new THREE.CylinderGeometry(0.06, 0.06, 0.05, 10), rimMat, mat4([0.11, 0, 0], [0, 0, Math.PI / 2]));
  const tireMat = solid(0x161618, { roughness: 0.92 });
  const wheels = [];
  const root = new THREE.Group(); root.name = 'vehicle:' + type;
  root.add(body);
  for (const [z, steer] of [[axleF, true], [axleR, false]]) for (const s of [-1, 1]) {
    const pivot = new THREE.Group(); pivot.position.set(s * (W - 0.14), t.wheelR, z);
    const spin = new THREE.Group();
    const tire = new THREE.Mesh(tireGeo, tireMat); tire.castShadow = true;
    const r = rimMB.build({ name: 'rim' }); if (s < 0) r.scale.x = -1;
    spin.add(tire, r); pivot.add(spin); root.add(pivot);
    wheels.push({ pivot, spin, steer, side: s, z, x: s * (W - 0.14), radius: t.wheelR, rest: t.wheelR });
  }
  root.userData = { kind: 'vehicle', type, dims: { length: L, width: t.width, height: t.height }, wheels, body, headMat: head, tailMat: tail,
    collider: { type: 'box', size: [t.width, t.height - t.clearance, L], offset: [0, (t.height + t.clearance) / 2, 0] } };
  return root;
}
