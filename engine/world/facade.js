// Facade grammar: real-geometry building fronts for close-up streets. A building is a core box
// (recessed by the window reveal) wrapped by a facade per side, made of floors × bays:
//   ground floor  storefront | lobby | residential (door + stoop) | blank
//   upper floors  window bays (glass in a reveal, frame, mullions, sill, optional lintel/shutters,
//                 balcony, AC unit) between piers, with string courses between floors
//   crown         cornice / parapet, rooftop units
// Everything is merged per material (≈6–9 draw calls per building) and seeded, so a block of
// unique buildings costs one call each. Use the textured towers in geometry/buildings.js as far LODs.
//
//   building({ width: 12, depth: 10, floors: 5, style: 'brownstone', ground: 'shop', seed: 3 })
//   → Group (base at y=0, front faces +Z) with userData { kind:'building', collider, height, doors:[{x,z,facing}] }
import * as THREE from '../vendor/three/three.module.js';
import { MeshBuilder, mat4, boxUV } from '../geometry/builders.js';
import { pbr, solid, glass, registerNightEmissive } from '../render/materials.js';
import { RNG } from '../core/rng.js';

/** Style presets: every field can be overridden per building ({ ...FACADE_STYLES.brownstone, bayW: 3 }). */
export const FACADE_STYLES = {
  brownstone: { wall: ['brick', { color: 0x8a4a34 }], wallScale: 0.5, trim: 0xd8cdb8, frame: 0xf0ece4, floorH: 3.2, groundH: 3.8, bayW: 2.6, winW: 1.15, winH: 1.75, reveal: 0.18, mullions: [1, 2], sill: true, lintel: true, cornice: 0.55, stringCourse: true, balcony: 0.12, ac: 0.12, shutters: 0, roofUnits: 1 },
  oldtown: { wall: ['plaster', { color: 0xd8c8a8 }], wallScale: 0.4, trim: 0xefe6d2, frame: 0x5a3a24, floorH: 3.0, groundH: 3.4, bayW: 2.4, winW: 1.0, winH: 1.6, reveal: 0.22, mullions: [1, 3], sill: true, lintel: true, cornice: 0.45, stringCourse: true, balcony: 0.25, ac: 0, shutters: 0.6, roofUnits: 0 },
  modern: { wall: ['concrete', { color: 0xa9a59c, panels: 1 }], wallScale: 0.33, trim: 0x8d8a84, frame: 0x2a2d31, floorH: 3.4, groundH: 4.4, bayW: 3.0, winW: 2.2, winH: 2.1, reveal: 0.12, mullions: [1, 1], sill: false, lintel: false, cornice: 0.25, stringCourse: false, balcony: 0.18, ac: 0.08, shutters: 0, roofUnits: 3 },
  industrial: { wall: ['brick', { color: 0x7a3e2c, color2: 0x5a2a1e }], wallScale: 0.5, trim: 0x6a6660, frame: 0x2e3a36, floorH: 4.2, groundH: 4.6, bayW: 3.6, winW: 2.6, winH: 2.6, reveal: 0.25, mullions: [4, 3], sill: true, lintel: true, cornice: 0.3, stringCourse: false, balcony: 0, ac: 0.05, shutters: 0, roofUnits: 2 },
  glass: { wall: ['concrete', { color: 0x6e7680 }], wallScale: 0.33, trim: 0x50565e, frame: 0x3a4048, floorH: 3.6, groundH: 5.0, bayW: 1.8, winW: 1.72, winH: 3.2, reveal: 0.04, mullions: [1, 1], sill: false, lintel: false, cornice: 0.2, stringCourse: true, balcony: 0, ac: 0, shutters: 0, roofUnits: 4 },
};
export const GROUND_TYPES = ['shop', 'lobby', 'residential', 'blank'];

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);

/**
 * Build one facade into `mb` in face-local space (x along the face, y up, z = outward normal,
 * wall plane at z=0), then transformed by `M`. Returns door positions (face-local).
 */
function facade(mb, M, { width, floors, s, rng, ground, mats, sideFace }) {
  const doors = [], T = (x, y, z, ry = 0, sc) => M.clone().multiply(mat4([x, y, z], [0, ry, 0], sc));
  const bays = Math.max(1, Math.round((width - 0.6) / s.bayW)), bayW = (width - 0.6) / bays, x0 = -width / 2 + 0.3;
  const H = s.groundH + (floors - 1) * s.floorH, r = s.reveal;
  const wallBox = (w, h, d, x, y, z) => mb.add(boxUV(box(w, h, d), s.wallScale), mats.wall, T(x, y, z));
  // corner piers / quoins
  for (const cx of [-width / 2 + 0.15, width / 2 - 0.15]) wallBox(0.3, H, r + 0.02, cx, H / 2, -r / 2 + 0.01);
  // ---------------- ground floor
  const gH = s.groundH, gType = sideFace && ground !== 'blank' ? 'blank' : ground;
  if (gType === 'shop' || gType === 'lobby') {
    const glassH = gType === 'lobby' ? gH - 0.9 : gH - 1.3, bandY = glassH + 0.35;
    wallBox(width - 0.6, gH - glassH - 0.35, r + 0.02, 0, glassH + 0.35 + (gH - glassH - 0.35) / 2, -r / 2 + 0.01); // sign band / transom wall
    wallBox(width - 0.6, 0.35, r + 0.06, 0, 0.175, -r / 2 + 0.03);                                                     // plinth
    mb.add(box(width - 0.62, glassH, 0.04), mats.glassShop, T(0, 0.35 + glassH / 2, -r));
    for (let i = 0; i <= bays; i++) mb.add(box(0.12, glassH, 0.12), mats.frame, T(x0 + i * bayW, 0.35 + glassH / 2, -r + 0.04)); // mullions
    mb.add(box(width - 0.6, 0.1, 0.14), mats.frame, T(0, 0.35 + glassH, -r + 0.04));
    const di = Math.floor(bays / 2), dx = x0 + (di + 0.5) * bayW, dw = Math.min(bayW - 0.3, gType === 'lobby' ? 2.2 : 1.1);
    mb.add(box(dw, 2.3, 0.06), mats.door, T(dx, 0.35 + 1.15, -r + 0.03)); doors.push({ x: dx, z: 0.6 });
    if (gType === 'shop') {
      mb.add(box(width * 0.7, 0.55, 0.1), mats.sign, T(0, bandY + 0.45, 0.06)); // fascia sign board
      if (rng.chance(0.65)) mb.add(box(width - 1, 0.06, 1.5), mats.awning, T(0, gH - 0.55, 0.75, 0, undefined).multiply(new THREE.Matrix4().makeRotationX(0.28)));
    } else mb.add(box(Math.min(width - 1, 5), 0.18, 1.8), mats.trim, T(dx, gH - 0.7, 0.9)); // lobby canopy
  } else if (gType === 'residential') {
    wallBox(width - 0.6, gH, r + 0.02, 0, gH / 2, -r / 2 + 0.01);
    const dx = x0 + Math.floor(bays / 2) * bayW + bayW / 2;
    mb.add(box(1.1, 2.3, 0.08), mats.door, T(dx, 0.5 + 1.15, 0.03)); doors.push({ x: dx, z: 1.4 });
    mb.add(box(1.5, 0.14, 0.3), mats.trim, T(dx, 0.5 + 2.4, 0.12));
    for (let k = 0; k < 3; k++) mb.add(box(1.6, 0.17, 0.32), mats.trim, T(dx, 0.085 + k * 0.17, 0.32 * (3 - k) - 0.1)); // stoop
    for (let b = 0; b < bays; b++) { const cx = x0 + (b + 0.5) * bayW; if (Math.abs(cx - dx) < 0.1) continue; windowBay(mb, T, cx, 0.9, s, rng, mats, bayW, false); }
  } else wallBox(width - 0.6, gH, r + 0.02, 0, gH / 2, -r / 2 + 0.01);
  // ---------------- upper floors
  for (let f = 1; f < floors; f++) {
    const y0 = s.groundH + (f - 1) * s.floorH, sillY = y0 + (s.floorH - s.winH) * 0.55;
    if (s.stringCourse) mb.add(box(width, 0.16, 0.12), mats.trim, T(0, y0 + 0.08, 0.04));
    const balconyRow = s.balcony > 0 && f >= 1 && rng.chance(s.balcony * 3) ? rng.next() : -1;
    for (let b = 0; b < bays; b++) {
      const cx = x0 + (b + 0.5) * bayW;
      // wall around the window: piers left/right + spandrel below/above
      const pw = (bayW - s.winW) / 2;
      if (pw > 0.01) for (const sx of [-1, 1]) wallBox(pw, s.floorH, r, cx + sx * (s.winW / 2 + pw / 2), y0 + s.floorH / 2, -r / 2);
      wallBox(s.winW, sillY - y0, r, cx, y0 + (sillY - y0) / 2, -r / 2);
      const top = sillY + s.winH; wallBox(s.winW, y0 + s.floorH - top, r, cx, top + (y0 + s.floorH - top) / 2, -r / 2);
      const balcony = balconyRow >= 0 && (b % 2 === 0 || bays <= 2) && !sideFace;
      windowBay(mb, T, cx, sillY, s, rng, mats, bayW, balcony);
    }
  }
  // ---------------- crown
  if (s.cornice > 0) {
    mb.add(box(width + 0.5, 0.22, s.cornice), mats.trim, T(0, H + 0.11, s.cornice / 2 - 0.05));
    mb.add(box(width + 0.3, 0.3, s.cornice * 0.6), mats.trim, T(0, H - 0.15, s.cornice * 0.3 - 0.05));
  }
  wallBox(width, 0.9, 0.25, 0, H + 0.67, -0.12); // parapet
  return { doors, height: H };
}

function windowBay(mb, T, cx, sillY, s, rng, mats, bayW, balcony) {
  const w = s.winW, h = s.winH, r = s.reveal, lit = rng.chance(0.45);
  mb.add(box(w, h, 0.03), lit ? mats.glassLit : mats.glassDark, T(cx, sillY + h / 2, -r + 0.02));
  const ft = 0.07; // frame
  for (const sx of [-1, 1]) mb.add(box(ft, h, 0.08), mats.frame, T(cx + sx * (w / 2 - ft / 2), sillY + h / 2, -r + 0.05));
  for (const sy of [0, 1]) mb.add(box(w, ft, 0.08), mats.frame, T(cx, sillY + ft / 2 + sy * (h - ft), -r + 0.05));
  const [mc, mr] = s.mullions;
  for (let i = 1; i < mc; i++) mb.add(box(0.04, h, 0.05), mats.frame, T(cx - w / 2 + (w * i) / mc, sillY + h / 2, -r + 0.05));
  for (let i = 1; i < mr; i++) mb.add(box(w, 0.04, 0.05), mats.frame, T(cx, sillY + (h * i) / mr, -r + 0.05));
  if (s.sill) mb.add(box(w + 0.2, 0.07, r + 0.1), mats.trim, T(cx, sillY - 0.035, -r / 2 + 0.05));
  if (s.lintel) mb.add(box(w + 0.24, 0.18, 0.06), mats.trim, T(cx, sillY + h + 0.09, 0.02));
  if (s.shutters && rng.chance(s.shutters)) for (const sx of [-1, 1]) mb.add(box(w / 2, h, 0.04), mats.shutter, T(cx + sx * (w * 0.75 + 0.03), sillY + h / 2, 0.03));
  if (balcony) {
    const bw = Math.min(bayW * 1.6, w + 1.2);
    mb.add(box(bw, 0.14, 0.9), mats.trim, T(cx, sillY - 0.07, 0.45));
    mb.add(box(bw, 0.05, 0.05), mats.rail, T(cx, sillY + 1.0, 0.88));
    for (const sx of [-1, 1]) mb.add(box(0.05, 0.05, 0.9), mats.rail, T(cx + sx * (bw / 2 - 0.03), sillY + 1.0, 0.45));
    for (let x = -bw / 2 + 0.05; x <= bw / 2 - 0.04; x += 0.12) mb.add(box(0.02, 1.0, 0.02), mats.rail, T(cx + x, sillY + 0.5, 0.88));
  } else if (s.ac && rng.chance(s.ac)) mb.add(box(0.75, 0.45, 0.5), mats.ac, T(cx + w * 0.15, sillY + 0.23, 0.25 - r));
}

/**
 * building({ width, depth, floors, style, ground, seed, sides, night }) — a detailed building.
 * sides: which faces get the full grammar (default all four; 'front' = only +Z, others plain walls with windows).
 */
export function building({ width = 12, depth = 10, floors = 5, style = 'brownstone', ground = 'shop', seed = 1, sides = 'all', night = true, ...over } = {}) {
  const rng = new RNG(seed), s = { ...(FACADE_STYLES[style] || FACADE_STYLES.brownstone), ...over };
  const mb = new MeshBuilder();
  const night1 = (m, d, n) => (night ? registerNightEmissive(m, d, n) : m);
  const mats = {
    wall: pbr(s.wall[0], { ...s.wall[1], seed: seed % 5 }),
    trim: solid(s.trim, { roughness: 0.8 }), frame: solid(s.frame, { roughness: 0.45, metalness: 0.2 }),
    glassDark: solid(0x1d2630, { roughness: 0.08, metalness: 0.4 }),
    glassLit: night1(solid(0x2a3440, { roughness: 0.1, metalness: 0.3, emissive: 0xffd49a, emissiveIntensity: 0 }), 0, 1.3),
    glassShop: night1(solid(0x5a6e7a, { roughness: 0.05, metalness: 0.5, emissive: 0xfff0d8, emissiveIntensity: 0 }), 0.05, 1.6),
    door: solid(rng.pick([0x2a3a2e, 0x3a2418, 0x1e2632, 0x5a1e1a]), { roughness: 0.5 }),
    sign: solid(rng.pick([0x1e3a5a, 0x5a1e2a, 0x2a4a2a, 0x2a2a2a]), { roughness: 0.4 }),
    awning: pbr('fabric', { color: rng.pick([0x2a6a4a, 0xa83a2e, 0x2a4a8a, 0xd0a030]), stripe: 0xeeeeee, weave: 32 }),
    rail: solid(0x1e2022, { roughness: 0.4, metalness: 0.7 }), ac: solid(0xb8bab6, { roughness: 0.6 }),
    shutter: solid(rng.pick([0x3a5a3a, 0x5a6a7a, 0x7a3a2a]), { roughness: 0.7 }),
  };
  const H = s.groundH + (floors - 1) * s.floorH, r = s.reveal;
  // core (behind the reveal) + roof slab
  mb.add(boxUV(box(width - 2 * r, H, depth - 2 * r), s.wallScale), mats.wall, mat4([0, H / 2, 0]));
  mb.add(box(width - 0.2, 0.2, depth - 0.2), solid(0x4a4a48, { roughness: 0.95 }), mat4([0, H + 0.1, 0]));
  const faces = [[0, 0, depth / 2, width, 'front'], [Math.PI, 0, -depth / 2, width, 'back'], [Math.PI / 2, width / 2, 0, depth, 'right'], [-Math.PI / 2, -width / 2, 0, depth, 'left']];
  const doors = [];
  for (const [ry, x, z, w, name] of faces) {
    const M = mat4([x, 0, z], [0, ry, 0]);
    const res = facade(mb, M, { width: w, floors, s, rng, ground: name === 'front' ? ground : 'blank', mats, sideFace: name !== 'front' && sides !== 'all' });
    for (const d of res.doors) { const p = new THREE.Vector3(d.x, 0, d.z).applyMatrix4(M); doors.push({ x: p.x, z: p.z, facing: ry }); }
  }
  for (let i = 0; i < (s.roofUnits ?? 0); i++) mb.add(box(rng.range(1.2, 2.4), rng.range(0.8, 1.6), rng.range(1.2, 2.2)), mats.ac, mat4([rng.range(-width / 4, width / 4), H + 0.9, rng.range(-depth / 4, depth / 4)]));
  const g = mb.build({ name: `building:${style}` });
  g.userData = { kind: 'building', style, height: H + 1.1, doors, collider: { type: 'box', size: [width, H + 1.1, depth], offset: [0, (H + 1.1) / 2, 0] } };
  return g;
}

/**
 * streetBlock({ length, depth, side, styles, seed, minW, maxW, floors: [a,b] }) — a row of attached
 * buildings along +X (fronts facing +Z), varied widths/heights/styles, shared party walls.
 */
export function streetBlock({ length = 60, depth = 12, styles = ['brownstone', 'oldtown', 'modern', 'industrial'], seed = 1, minW = 8, maxW = 16, floors = [3, 7], ground = ['shop', 'shop', 'residential', 'lobby'] } = {}) {
  const rng = new RNG(seed), grp = new THREE.Group(); grp.name = 'streetBlock';
  let x = -length / 2;
  while (x < length / 2 - minW * 0.6) {
    const w = Math.min(length / 2 - x, rng.range(minW, maxW)); if (w < minW * 0.6) break;
    const b = building({ width: w, depth: depth * rng.range(0.85, 1), floors: rng.int(floors[0], floors[1]), style: rng.pick(styles), ground: rng.pick(ground), seed: rng.int(1, 1e6), sides: 'front' });
    b.position.set(x + w / 2, 0, -depth / 2 + (b.userData.collider.size[2]) / 2); grp.add(b); x += w;
  }
  grp.userData = { kind: 'block', buildings: grp.children.length };
  return grp;
}
