// Procedural architecture: towers with window facades and rooftop clutter, shops with
// storefronts, houses with gable roofs, doors, windows and chimneys.
import * as THREE from '../vendor/three/three.module.js';
import { MeshBuilder, mat4, roundedBox, boxUV } from './builders.js';
import { pbr, solid, glass, emissive, registerNightEmissive } from '../render/materials.js';
import { RNG } from '../core/rng.js';

// Axis-aligned facade quad with UVs in "tile units" so texture tiling follows real size.
function facadeQuad(w, h, tileW, tileH) {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (w / tileW), uv.getY(i) * (h / tileH));
  return g;
}
// Four facades of a box (no top/bottom), centred on x/z, base at y0.
function addFacades(mb, mat, w, d, h, y0, tileW, tileH) {
  const faces = [[0, d / 2, 0, w], [Math.PI, -d / 2, 0, w], [Math.PI / 2, 0, w / 2, d], [-Math.PI / 2, 0, -w / 2, d]];
  for (const [ry, z, x, fw] of faces) {
    const tilesW = Math.max(1, Math.round(fw / tileW));
    mb.add(facadeQuad(fw, h, fw / tilesW, tileH), mat, mat4([x, y0 + h / 2, z], [0, ry, 0]));
  }
}

const PALETTES = {
  modern: [0x8c9198, 0xa7a29a, 0x5f6670, 0xc2bcb0, 0x6e7a86],
  warm: [0xc9a27a, 0xb5785a, 0xd8c3a0, 0x9a6a50, 0xe0cfae],
  neon: [0x2a2e3a, 0x343a4a, 0x22262e, 0x3a3348, 0x2c3a40],
};

export function tower({ width = 14, depth = 14, floors = 12, seed = 1, style = 'modern', night = true } = {}) {
  const rng = new RNG(seed), mb = new MeshBuilder();
  const floorH = 3.4, h = floors * floorH, col = rng.pick(PALETTES[style] || PALETTES.modern);
  const facade = pbr('facade', { color: col, cols: 4, floors: 4, glass: rng.pick([0x1c2a38, 0x22323a, 0x2a2a34]), litRatio: style === 'neon' ? 0.4 : 0.6, seed: seed % 7, emissiveIntensity: 0 });
  if (night) registerNightEmissive(facade, 0.0, style === 'neon' ? 2.2 : 1.4);
  // podium ground floor
  const lobby = 4.2;
  addFacades(mb, pbr('concrete', { color: 0x8a8780, panels: 2 }), width + 0.4, depth + 0.4, lobby, 0, 4, lobby);
  mb.add(new THREE.BoxGeometry(width * 0.6, lobby * 0.7, 0.1), glass({ opacity: 0.6 }), mat4([0, lobby * 0.38, depth / 2 + 0.22]));
  addFacades(mb, facade, width, depth, h - lobby, lobby, 12.8, floorH * 4); // texture tile = 4 windows x 4 floors
  // setbacks for tall towers
  let top = h;
  if (floors > 14 && rng.chance(0.6)) {
    const f2 = rng.int(4, 8), w2 = width * 0.7, d2 = depth * 0.7;
    addFacades(mb, facade, w2, d2, f2 * floorH, h, 12.8, floorH * 4);
    mb.add(new THREE.BoxGeometry(width, 0.4, depth), solid(0x50545a), mat4([0, h, 0]));
    top = h + f2 * floorH;
    mb.add(new THREE.BoxGeometry(w2, 0.4, d2), solid(0x50545a), mat4([0, top, 0]));
  } else {
    mb.add(new THREE.BoxGeometry(width, 0.4, depth), solid(0x50545a), mat4([0, h, 0]));
    // parapet
    const pm = pbr('concrete', { color: 0x77756f });
    for (const [x, z, sx, sz] of [[0, depth / 2, width, 0.3], [0, -depth / 2, width, 0.3], [width / 2, 0, 0.3, depth], [-width / 2, 0, 0.3, depth]]) mb.add(new THREE.BoxGeometry(sx, 1, sz), pm, mat4([x, h + 0.5, z]));
  }
  // rooftop clutter
  const metal = pbr('paintedMetal', { color: 0x9aa0a6, rust: 0.25, panels: 3 });
  for (let i = 0; i < rng.int(1, 4); i++) mb.add(roundedBox(rng.range(1.5, 3), rng.range(1, 2), rng.range(1.5, 3), 0.1, 1), metal, mat4([rng.range(-width / 4, width / 4), top + 0.8, rng.range(-depth / 4, depth / 4)]));
  if (rng.chance(0.4)) { mb.add(new THREE.CylinderGeometry(1.2, 1.2, 2.5, 12), pbr('planks', { planks: 10 }), mat4([width / 4, top + 3, -depth / 4])); mb.add(new THREE.ConeGeometry(1.3, 0.8, 12), solid(0x3a3a3a), mat4([width / 4, top + 4.6, -depth / 4])); }
  if (style === 'neon' || rng.chance(0.3)) mb.add(new THREE.CylinderGeometry(0.06, 0.06, 6, 4), solid(0x333333), mat4([0, top + 3, 0]));
  if (style === 'neon' || rng.chance(0.3)) mb.add(new THREE.SphereGeometry(0.25, 8, 6), emissive(0xff2a2a, 5), mat4([0, top + 6, 0]));
  if (style === 'neon') {
    const c = rng.pick([0xff2a8a, 0x2af0ff, 0xb02aff, 0xffb02a]);
    const sign = emissive(c, 4);
    mb.add(new THREE.BoxGeometry(0.3, h * 0.3, 1.2), sign, mat4([width / 2 + 0.3, h * 0.55, depth / 4]));
    mb.add(new THREE.BoxGeometry(width * 0.9, 0.18, 0.18), emissive(rng.pick([0xff2a8a, 0x2af0ff]), 3), mat4([0, lobby + 0.2, depth / 2 + 0.3]));
  }
  const g = mb.build({ name: 'tower' });
  g.userData = { kind: 'building', collider: { type: 'box', size: [width + 0.4, top, depth + 0.4], offset: [0, top / 2, 0] }, height: top };
  return g;
}

export function shop({ width = 10, depth = 10, floors = 2, seed = 1, awning } = {}) {
  const rng = new RNG(seed), mb = new MeshBuilder(), h = floors * 3.3 + 1;
  const wallKind = rng.pick(['brick', 'plaster']);
  const wall = wallKind === 'brick' ? pbr('brick', { color: rng.pick([0x9a4a32, 0x7a5040, 0xa86a4a]) }) : pbr('plaster', { color: rng.pick(PALETTES.warm) });
  addFacades(mb, wall, width, depth, h, 0, 4, 4);
  // storefront
  mb.add(new THREE.BoxGeometry(width * 0.75, 2.6, 0.08), glass({ opacity: 0.55, color: 0x7090a8 }), mat4([0, 1.6, depth / 2 + 0.03]));
  const interior = registerNightEmissive(emissive(0xffd8a0, 0.6), 0.3, 2.0);
  mb.add(new THREE.PlaneGeometry(width * 0.74, 2.5), interior, mat4([0, 1.6, depth / 2 - 0.3]));
  mb.add(new THREE.BoxGeometry(width * 0.8, 0.25, 0.2), solid(0x2a2a2a, { metalness: 0.6 }), mat4([0, 3.0, depth / 2 + 0.1]));
  const awn = pbr('fabric', { color: awning ?? rng.pick([0x2a6a4a, 0xa83a2e, 0x2a4a8a, 0xd0a030]), stripe: 0xeeeeee, weave: 32 });
  mb.add(new THREE.BoxGeometry(width * 0.8, 0.06, 1.6), awn, mat4([0, 3.3, depth / 2 + 0.8], [0.25, 0, 0]));
  // upper windows
  const winMat = registerNightEmissive(solid(0x1c2a38, { roughness: 0.1, metalness: 0.3, emissive: 0xffd59a, emissiveIntensity: 0 }), 0, 1.2);
  const frame = solid(0xe8e2d8, { roughness: 0.6 });
  for (let f = 1; f < floors; f++) for (let i = 0; i < Math.floor(width / 2.6); i++) {
    const x = -width / 2 + 1.6 + i * 2.6; if (x > width / 2 - 1) break;
    const y = f * 3.3 + 1.8;
    mb.add(new THREE.BoxGeometry(1.2, 1.6, 0.1), rng.chance(0.5) ? winMat : solid(0x1c2a38, { roughness: 0.1, metalness: 0.3 }), mat4([x, y, depth / 2 + 0.02]));
    mb.add(new THREE.BoxGeometry(1.45, 0.14, 0.25), frame, mat4([x, y - 0.85, depth / 2 + 0.08]));
  }
  mb.add(new THREE.BoxGeometry(width + 0.3, 0.5, depth + 0.3), solid(0x5a524a), mat4([0, h + 0.25, 0]));
  const g = mb.build({ name: 'shop' });
  g.userData = { kind: 'building', collider: { type: 'box', size: [width, h + 0.5, depth], offset: [0, (h + 0.5) / 2, 0] }, height: h };
  return g;
}

export function house({ width = 7, depth = 6, seed = 1, wallColor, roofColor, style = 'cottage' } = {}) {
  const rng = new RNG(seed), mb = new MeshBuilder();
  const wallH = rng.range(2.8, 3.4) * (style === 'manor' ? 1.6 : 1);
  const wall = style === 'stone' ? pbr('cobble', { cells: 7, color: 0x8d877c }) : pbr('plaster', { color: wallColor ?? rng.pick([0xe6dccb, 0xd8c8a8, 0xe0d0c0, 0xc8b89a, 0xe8e0d0]) });
  const g0 = boxUV(new THREE.BoxGeometry(width, wallH, depth), 0.3);
  mb.add(g0, wall, mat4([0, wallH / 2, 0]));
  // timber frame
  const timber = pbr('planks', { planks: 1, color: 0x4a3020 });
  if (style !== 'stone') {
    for (const x of [-width / 2, width / 2]) for (const z of [-depth / 2, depth / 2]) mb.add(new THREE.BoxGeometry(0.22, wallH, 0.22), timber, mat4([x, wallH / 2, z]));
    mb.add(new THREE.BoxGeometry(width + 0.1, 0.2, 0.12), timber, mat4([0, wallH - 0.1, depth / 2 + 0.06]));
    mb.add(new THREE.BoxGeometry(width + 0.1, 0.2, 0.12), timber, mat4([0, wallH - 0.1, -depth / 2 - 0.06]));
  }
  // gable roof: triangular prism, overhang
  const rh = width * 0.42, ov = 0.45;
  const shape = new THREE.Shape(); shape.moveTo(-width / 2 - ov, 0); shape.lineTo(0, rh); shape.lineTo(width / 2 + ov, 0); shape.lineTo(-width / 2 - ov, 0);
  const gable = new THREE.ExtrudeGeometry(shape, { depth: depth - 0.02, bevelEnabled: false }); gable.translate(0, 0, -depth / 2 + 0.01);
  mb.add(boxUV(gable, 0.4), wall, mat4([0, wallH, 0], [0, 0, 0], [width / (width + 2 * ov), 1, 1]));
  const slope = Math.hypot(width / 2 + ov, rh), ang = Math.atan2(rh, width / 2 + ov);
  const roofMat = pbr('roof', { color: roofColor ?? rng.pick([0x8c3b2a, 0x5e4a3a, 0x4a5a6a, 0x7a4a2a]) });
  for (const s of [-1, 1]) {
    const pl = new THREE.BoxGeometry(slope + 0.1, 0.16, depth + ov * 2);
    const uv = pl.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (depth + ov * 2) / 3, uv.getY(i) * slope / 3);
    mb.add(pl, roofMat, mat4([s * (width / 2 + ov) / 2, wallH + rh / 2 + 0.05, 0], [0, 0, -s * ang]));
  }
  // chimney
  if (rng.chance(0.7)) mb.add(boxUV(new THREE.BoxGeometry(0.7, rh + 1.2, 0.7), 0.5), pbr('brick', { color: 0x7a4030 }), mat4([width * 0.25, wallH + rh * 0.5 + 0.4, depth * 0.15]));
  // door + windows on front (+z)
  mb.add(roundedBox(1.1, 2.1, 0.12, 0.03, 1), pbr('planks', { planks: 3, color: rng.pick([0x5a3a20, 0x2a4a3a, 0x6a2a20]) }), mat4([0, 1.05, depth / 2 + 0.04]));
  mb.add(new THREE.SphereGeometry(0.05, 6, 4), solid(0xc8a040, { metalness: 1, roughness: 0.3 }), mat4([0.38, 1.0, depth / 2 + 0.12]));
  const winLit = registerNightEmissive(solid(0x223040, { roughness: 0.1, emissive: 0xffc070, emissiveIntensity: 0 }), 0.05, 1.8);
  for (const [x, z, ry] of [[-width * 0.3, depth / 2 + 0.03, 0], [width * 0.3, depth / 2 + 0.03, 0], [width / 2 + 0.03, 0, Math.PI / 2], [-width / 2 - 0.03, 0, -Math.PI / 2], [0, -depth / 2 - 0.03, Math.PI]]) {
    mb.add(new THREE.BoxGeometry(1.0, 1.1, 0.06), winLit, mat4([x, wallH * 0.55, z], [0, ry, 0]));
    mb.add(new THREE.BoxGeometry(1.2, 0.12, 0.2), timber, mat4([x, wallH * 0.55 - 0.6, z], [0, ry, 0]));
    mb.add(new THREE.BoxGeometry(0.08, 1.1, 0.1), timber, mat4([x, wallH * 0.55, z], [0, ry, 0]));
  }
  const g = mb.build({ name: 'house' });
  g.userData = { kind: 'building', collider: { type: 'box', size: [width + 0.2, wallH + rh, depth + 0.2], offset: [0, (wallH + rh) / 2, 0] }, door: [0, 0, depth / 2 + 0.8], height: wallH + rh };
  return g;
}

export const BUILDINGS = { tower, shop, house };
