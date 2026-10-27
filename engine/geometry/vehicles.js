// Procedural vehicles v2: one continuous, smooth body generated from side/plan profile curves
// (roofline, beltline, ground line, plan width) per vehicle type. The body grid is classified
// into paint, flush glass, black trim (pillars, window frames, panel gaps, lower cladding),
// wrap-around head/tail lights and wheel-arch cut-outs. Details: arch liners, grille, plates,
// mirrors, door handles, exhaust, interior (seats, dash, steering wheel), lathe-turned tyres with
// sidewall bulge + tread grooves, spoked rims, brake discs and calipers. Forward = +Z, metres.
// Wheels are rigs ready for suspension/steering (pivot -> spin), as consumed by physics/vehicle.js.
import * as THREE from '../vendor/three/three.module.js';
import { MeshBuilder, mat4, lathe, roundedBox } from './builders.js';
import { carPaint, solid, emissive, glass } from '../render/materials.js';
import { RNG } from '../core/rng.js';

// Profiles: u = 0 rear … 1 front. top/belt/bottom are [u, metres] for the reference height
// `h` (rescaled to the requested height). zones (u): deck = rear glass base, roofR/roofF = roof
// ends, cowl = windshield base, B = B-pillar centre (null = 2 doors), seams = door cut lines,
// axles = [rear, front]; roof = roof half-width ratio; bed = pickup bed until u.
const PROFILES = {
  sedan: { length: 4.7, width: 1.85, h: 1.45, wheelR: 0.335, roof: 0.79,
    top: [[0, 0.78], [0.04, 0.93], [0.13, 0.99], [0.22, 1.0], [0.3, 1.26], [0.38, 1.42], [0.55, 1.45], [0.62, 1.37], [0.72, 1.02], [0.8, 0.98], [0.95, 0.87], [1, 0.7]],
    belt: [[0, 0.9], [0.22, 0.99], [0.72, 0.98], [1, 0.82]],
    bottom: [[0, 0.42], [0.1, 0.24], [0.18, 0.19], [0.82, 0.19], [0.92, 0.24], [1, 0.4]],
    zones: { deck: 0.225, roofR: 0.39, roofF: 0.585, cowl: 0.72, B: 0.49, seams: [0.3, 0.49, 0.705] }, axles: [0.21, 0.795] },
  sports: { length: 4.45, width: 1.95, h: 1.2, wheelR: 0.345, roof: 0.74,
    top: [[0, 0.72], [0.04, 0.86], [0.15, 0.9], [0.24, 0.93], [0.36, 1.15], [0.45, 1.2], [0.55, 1.18], [0.66, 0.95], [0.75, 0.84], [0.95, 0.7], [1, 0.52]],
    belt: [[0, 0.84], [0.24, 0.92], [0.66, 0.86], [1, 0.66]],
    bottom: [[0, 0.36], [0.1, 0.18], [0.18, 0.13], [0.84, 0.13], [0.93, 0.18], [1, 0.32]],
    zones: { deck: 0.245, roofR: 0.4, roofF: 0.53, cowl: 0.66, B: null, seams: [0.36, 0.645] }, axles: [0.205, 0.79] },
  hatchback: { length: 4.1, width: 1.8, h: 1.48, wheelR: 0.32, roof: 0.82,
    top: [[0, 0.86], [0.03, 1.3], [0.09, 1.42], [0.16, 1.48], [0.55, 1.48], [0.66, 1.05], [0.76, 0.98], [0.95, 0.86], [1, 0.68]],
    belt: [[0, 1.0], [0.66, 1.0], [1, 0.84]],
    bottom: [[0, 0.4], [0.08, 0.24], [0.15, 0.19], [0.84, 0.19], [0.93, 0.24], [1, 0.4]],
    zones: { deck: 0.035, roofR: 0.12, roofF: 0.57, cowl: 0.665, B: 0.42, seams: [0.23, 0.42, 0.655] }, axles: [0.185, 0.8] },
  suv: { length: 4.8, width: 2.0, h: 1.8, wheelR: 0.4, roof: 0.86,
    top: [[0, 0.95], [0.02, 1.6], [0.06, 1.75], [0.15, 1.8], [0.62, 1.8], [0.72, 1.3], [0.76, 1.18], [0.95, 1.08], [1, 0.85]],
    belt: [[0, 1.12], [0.72, 1.15], [1, 1.0]],
    bottom: [[0, 0.55], [0.08, 0.36], [0.15, 0.3], [0.85, 0.3], [0.92, 0.36], [1, 0.55]],
    zones: { deck: 0.03, roofR: 0.07, roofF: 0.64, cowl: 0.75, B: 0.46, seams: [0.27, 0.46, 0.7] }, axles: [0.19, 0.79] },
  van: { length: 5.0, width: 2.0, h: 2.1, wheelR: 0.37, roof: 0.92,
    top: [[0, 1.0], [0.01, 1.9], [0.04, 2.08], [0.12, 2.1], [0.8, 2.1], [0.9, 1.45], [0.93, 1.2], [0.99, 1.05], [1, 0.8]],
    belt: [[0, 1.15], [0.9, 1.15], [1, 1.0]],
    bottom: [[0, 0.5], [0.06, 0.32], [0.84, 0.3], [0.93, 0.34], [1, 0.5]],
    zones: { deck: 0.015, roofR: 0.05, roofF: 0.84, cowl: 0.92, B: 0.78, seams: [0.62, 0.78, 0.905], sideGlass: [0.5, 0.92] }, axles: [0.16, 0.8] },
  truck: { length: 5.4, width: 2.0, h: 1.85, wheelR: 0.42, roof: 0.86, bed: 0.385,
    top: [[0, 1.12], [0.02, 1.16], [0.37, 1.16], [0.385, 1.6], [0.4, 1.8], [0.45, 1.85], [0.6, 1.85], [0.68, 1.4], [0.72, 1.3], [0.95, 1.22], [1, 0.95]],
    belt: [[0, 1.16], [0.7, 1.25], [1, 1.1]],
    bottom: [[0, 0.6], [0.05, 0.44], [0.85, 0.42], [0.95, 0.46], [1, 0.6]],
    zones: { deck: 0.39, roofR: 0.425, roofF: 0.625, cowl: 0.71, B: 0.535, seams: [0.385, 0.535, 0.7] }, axles: [0.17, 0.8] },
};
PROFILES.coupe = { ...PROFILES.sports, length: 4.6, h: 1.3, roof: 0.76, top: PROFILES.sports.top.map(([u, y]) => [u, y * 1.3 / 1.2]), belt: PROFILES.sports.belt.map(([u, y]) => [u, y * 1.06]) };
PROFILES.police = PROFILES.sedan; PROFILES.taxi = PROFILES.sedan; PROFILES.pickup = PROFILES.truck;

// Public table (dimensions used by physics/spec tooling).
export const VEHICLE_TYPES = Object.fromEntries(Object.entries(PROFILES).map(([k, p]) => [k, {
  length: p.length, width: p.width, height: p.h, wheelR: p.wheelR, wheelbase: (p.axles[1] - p.axles[0]) * p.length,
  clearance: Math.min(...p.bottom.map((b) => b[1])) - 0.08, bed: !!p.bed,
}]));

// Catmull-Rom through [u, y] keys (clamped ends).
function curve(keys) {
  return (u) => {
    if (u <= keys[0][0]) return keys[0][1];
    if (u >= keys[keys.length - 1][0]) return keys[keys.length - 1][1];
    let i = 0; while (keys[i + 1][0] < u) i++;
    const p0 = keys[Math.max(0, i - 1)], p1 = keys[i], p2 = keys[i + 1], p3 = keys[Math.min(keys.length - 1, i + 2)];
    const t = (u - p1[0]) / (p2[0] - p1[0]);
    // tangents scaled to the segment (keeps steep pillars from overshooting)
    const m1 = ((p2[1] - p0[1]) / Math.max(1e-6, p2[0] - p0[0])) * (p2[0] - p1[0]), m2 = ((p3[1] - p1[1]) / Math.max(1e-6, p3[0] - p1[0])) * (p2[0] - p1[0]);
    const lim = Math.abs(p2[1] - p1[1]) * 1.2 + 0.02, c1 = THREE.MathUtils.clamp(m1, -lim, lim), c2 = THREE.MathUtils.clamp(m2, -lim, lim);
    const t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * p1[1] + (t3 - 2 * t2 + t) * c1 + (-2 * t3 + 3 * t2) * p2[1] + (t3 - t2) * c2;
  };
}
const SEG = { A: 4, B: 14, C: 8, D: 9 }; // contour points per segment (half section)

// detail: 'high' (hero/player car, ~24k tris) | 'low' (traffic, ~8k tris)
export function car({ type = 'sedan', color, seed = 1, lightbar = false, taxi = false, height, length, detail = 'high' } = {}) {
  const lo = detail === 'low';
  const rng = new RNG(seed);
  const P = PROFILES[type] || PROFILES.sedan;
  const L = length ?? P.length, W = P.width / 2, ys = (height ?? P.h) / P.h;
  const topC = curve(P.top), beltC = curve(P.belt), botC = curve(P.bottom);
  const Z = P.zones, wr = P.wheelR;
  const zOf = (u) => (u - 0.5) * L;
  const planW = (u) => {
    const fr = 0.07, rr = 0.055; let k = 1;
    if (u > 1 - fr) { const e = Math.min(1, (u - (1 - fr)) / fr); k = Math.min(k, 0.55 + 0.45 * Math.pow(1 - Math.pow(e, 2.2), 1 / 2.2)); }
    if (u < rr) { const e = Math.min(1, (rr - u) / rr); k = Math.min(k, 0.6 + 0.4 * Math.pow(1 - Math.pow(e, 2.2), 1 / 2.2)); }
    return W * k * (1 - 0.025 * (2 * u - 1) ** 2);
  };
  const station = (u) => {
    const top = topC(u) * ys, bottom = botC(u) * ys; let belt = Math.min(beltC(u) * ys, top);
    const gh = top - belt, g = THREE.MathUtils.smoothstep(gh, 0.04, 0.3);
    const w = planW(u);
    return { u, z: zOf(u), top, bottom, belt, w, gh, wTop: THREE.MathUtils.lerp(w * 0.9, w * P.roof, g), rr: THREE.MathUtils.lerp(0.035, 0.07, g) };
  };
  // half contour (x >= 0) from bottom centre to top centre; returns points + segment tags
  const half = (s) => {
    const pts = [];
    for (let i = 0; i < SEG.A; i++) pts.push([(i / SEG.A) * s.w * 0.9, s.bottom, 'A']);
    // rows: uniform + exact lines for cladding / lamp edges (crisp material borders)
    const span = s.belt - s.bottom, anchors = [s.bottom + 0.075, s.belt - 0.16, s.belt - 0.035].filter((y) => y > s.bottom + 0.01 && y < s.belt - 0.01);
    const ysB = []; for (let i = 0; i < SEG.B - anchors.length; i++) ysB.push(s.bottom + (i / (SEG.B - anchors.length - 1)) * span);
    ysB.push(...anchors); ysB.sort((a, b) => a - b);
    for (let i = 0; i < SEG.B; i++) {
      const y = ysB[i], t = (y - s.bottom) / Math.max(1e-6, span);
      const corner = Math.sin(Math.min(1, t * 3.5) * Math.PI / 2); // rounded rocker
      const barrel = 1 - 0.035 * (2 * t - 1) ** 2, shoulder = t > 0.85 ? 1 - 0.04 * ((t - 0.85) / 0.15) ** 2 : 1;
      pts.push([s.w * (0.9 + 0.1 * corner) * barrel * shoulder, y, 'B']);
    }
    const x0 = s.w * 0.955, yTopSide = s.top - s.rr;
    for (let i = 1; i <= SEG.C; i++) { const t = i / SEG.C; pts.push([THREE.MathUtils.lerp(x0, s.wTop, t), THREE.MathUtils.lerp(s.belt, Math.max(s.belt, yTopSide), t), 'C']); }
    for (let i = 1; i <= SEG.D; i++) {
      const t = i / SEG.D;
      if (t <= 0.34) { const a = (t / 0.34) * Math.PI / 2; pts.push([s.wTop - s.rr + s.rr * Math.cos(a), Math.max(s.belt, yTopSide) + s.rr * Math.sin(a), 'D']); } // rounded roof/hood edge
      else { const k = (t - 0.34) / 0.66; pts.push([(s.wTop - s.rr) * (1 - k), s.top + 0.012 * (1 - (1 - k) ** 2), 'D']); } // slight crown
    }
    return pts;
  };
  const M = SEG.A + SEG.B + SEG.C + SEG.D; // points per half incl. centre ends
  // stations: cosine-spaced + exact zone/seam boundaries (crisp material edges)
  const us = new Set();
  const NS = lo ? 26 : 72; for (let k = 0; k <= NS; k++) us.add(0.5 - 0.5 * Math.cos((Math.PI * k) / NS));
  const du = 0.004 / L;
  for (const v of [Z.deck, Z.roofR, Z.roofF, Z.cowl, Z.deck + 0.02, Z.cowl - 0.015]) if (v != null) us.add(v);
  if (Z.B != null) { us.add(Z.B - 0.012); us.add(Z.B + 0.012); }
  for (const sm of Z.seams || []) { us.add(sm - du); us.add(sm + du); }
  if (P.bed) { us.add(P.bed - du * 2); us.add(P.bed); }
  for (const a of P.axles) for (const d of [-1, -0.7, -0.35, 0, 0.35, 0.7, 1]) us.add(a + (d * (wr + 0.08)) / L);
  const U = [...us].filter((u) => u >= 0 && u <= 1).sort((a, b) => a - b);
  const stations = U.map(station);
  // vertices: ring = right half (M) + mirrored left half (M-2, skipping centre points)
  const ringN = 2 * M - 2, pos = [], tags = [], stOf = [];
  const ringPts = (s, scale = 1, yc = 0, dz = 0) => {
    const h = half(s), ring = [...h, ...h.slice(1, -1).reverse().map(([x, y, tg]) => [-x, y, tg])];
    for (const [x, y, tg] of ring) { pos.push(x * scale, yc + (y - yc) * scale, s.z + dz); tags.push(tg); }
  };
  for (const s of stations) { ringPts(s); stOf.push(s); }
  // closing rings at both ends (rounded nose / tail faces) + caps
  const closeEnd = (s, dir) => { const yc = (s.bottom + s.top) / 2; for (const [dz, sc] of [[0.014, 0.9], [0.026, 0.68], [0.034, 0.38]]) { ringPts(s, sc, yc, dz * dir); stOf.push({ ...s, closing: true }); } };
  const first = stations[0], last = stations[stations.length - 1];
  // rebuild order: rear closing rings (reversed) + stations + front closing rings
  const rearPos = [], rearTags = [], rearSt = [];
  { const p0 = pos.length; closeEnd(first, -1); rearPos.push(...pos.splice(p0)); rearTags.push(...tags.splice(p0 / 3)); rearSt.push(...stOf.splice(stOf.length - 3)); }
  closeEnd(last, 1);
  const rings = []; // [startVertex, station]
  const allPos = [], allTags = [];
  const pushRing = (arr, tg, st, r) => { rings.push({ v: allPos.length / 3, st }); allPos.push(...arr.slice(r * ringN * 3, (r + 1) * ringN * 3)); allTags.push(...tg.slice(r * ringN, (r + 1) * ringN)); };
  for (let r = 2; r >= 0; r--) pushRing(rearPos, rearTags, rearSt[r], r);
  for (let r = 0; r < stOf.length; r++) pushRing(pos, tags, stOf[r], r);

  // wheel arches: project vertices inside the arch circle onto it (smooth cut edge); quads that
  // were entirely inside are dropped below
  const axZ0 = P.axles.map(zOf), archR0 = wr + 0.07, inside = new Uint8Array(allPos.length / 3);
  for (const { v, st } of rings) if (!st.closing) for (let j = 0; j < ringN; j++) {
    const k = (v + j) * 3; if (Math.abs(allPos[k]) < W * 0.5 || allTags[v + j] === 'C' || allTags[v + j] === 'D') continue;
    for (const az of axZ0) { const dy = allPos[k + 1] - wr, dz = allPos[k + 2] - az, d = Math.hypot(dy, dz); if (d < archR0) { inside[v + j] = 1; const ny = wr + (dy / Math.max(d, 1e-4)) * archR0; if (d > 1e-4 && ny >= st.bottom - 0.005) { allPos[k + 1] = ny; allPos[k + 2] = az + (dz / d) * archR0; } } }
  }
  // pickup bed: lower the top surface between the rails behind the cab
  if (P.bed) for (const { v, st } of rings) if (st.u < P.bed - du && !st.closing) for (let j = 0; j < ringN; j++) { const k = (v + j) * 3; if (allTags[v + j] === 'D' && Math.abs(allPos[k]) < st.w * 0.86) allPos[k + 1] = st.belt - 0.42 * ys; }

  // ---- classify quads into material groups
  const MAT = { paint: 0, glass: 1, trim: 2, head: 3, tail: 4 };
  const lists = [[], [], [], [], []];
  const axZ = P.axles.map(zOf), archR = wr + 0.07;
  const seg = (j) => allTags[j];
  const halfIndex = (j) => (j < M ? j : ringN - j); // index along the half contour
  for (let r = 0; r < rings.length - 1; r++) {
    const a = rings[r], b = rings[r + 1], s0 = a.st, s1 = b.st, um = (s0.u + s1.u) / 2;
    const closing = s0.closing || s1.closing;
    for (let j = 0; j < ringN; j++) {
      const j2 = (j + 1) % ringN;
      const i00 = a.v + j, i01 = a.v + j2, i10 = b.v + j, i11 = b.v + j2;
      const cx = (allPos[i00 * 3] + allPos[i01 * 3] + allPos[i10 * 3] + allPos[i11 * 3]) / 4, cy = (allPos[i00 * 3 + 1] + allPos[i01 * 3 + 1] + allPos[i10 * 3 + 1] + allPos[i11 * 3 + 1]) / 4, cz = (allPos[i00 * 3 + 2] + allPos[i10 * 3 + 2]) / 2;
      const tg = seg(i00) === seg(i01) ? seg(i00) : seg(i01) === 'A' || seg(i00) === 'A' ? 'A' : seg(i00);
      const hi = Math.min(halfIndex(j), halfIndex(j2));
      const belt = (s0.belt + s1.belt) / 2, bottom = (s0.bottom + s1.bottom) / 2;
      // wheel arch cut-outs
      const cut = inside[i00] + inside[i01] + inside[i10] + inside[i11] >= 3;
      if (cut && !closing) continue;
      let m = MAT.paint;
      const inSide = !closing && um > Z.deck && um < Z.cowl;
      if (tg === 'C' && !closing) {
        const ci = hi - (SEG.A + SEG.B); // 0 = belt row
        const sideGlass = Z.sideGlass ? um > Z.sideGlass[0] && um < Z.sideGlass[1] : true;
        if (ci <= 0) m = inSide ? MAT.trim : MAT.paint; // belt-line seal
        else if (ci >= SEG.C - 1) m = MAT.paint;
        else if (um > Z.deck + 0.02 && um < Z.cowl - 0.015 && sideGlass) m = Z.B != null && Math.abs(um - Z.B) < 0.012 ? MAT.trim : MAT.glass;
        else if (P.bed && um < P.bed) m = MAT.paint;
      } else if (tg === 'D' && !closing) {
        const di = hi - (SEG.A + SEG.B + SEG.C);
        if (di >= 2 && ((um > Z.roofF && um < Z.cowl) || (um > Z.deck && um < Z.roofR))) m = MAT.glass;
        if (P.bed && um < P.bed - du) m = Math.abs(cx) < W * 0.86 ? MAT.trim : MAT.paint;
      } else if (tg === 'A') m = MAT.trim;
      else if (tg === 'B' || closing) {
        if (cy < bottom + 0.075) m = MAT.trim;
        for (const sm of Z.seams || []) if (!closing && Math.abs(um - sm) < du * 1.01 && cy > bottom + 0.09 && cy < belt - 0.01) m = MAT.trim;
        const front = um > 0.955 || (closing && s0.u > 0.5), rear = um < 0.04 || (closing && s0.u < 0.5);
        if (front && cy > belt - 0.16 && cy < belt - 0.035 && Math.abs(cx) > W * 0.42) m = MAT.head;
        if (rear && cy > belt - 0.15 && cy < belt - 0.02 && Math.abs(cx) > W * 0.45) m = MAT.tail;
      }
      lists[m].push(i00, i01, i10, i01, i11, i10);
    }
  }
  // caps (fans) at both ends
  const cap = (ring, flip) => {
    const c = allPos.length / 3; let sx = 0, sy = 0, sz = 0; for (let j = 0; j < ringN; j++) { sx += allPos[(ring.v + j) * 3]; sy += allPos[(ring.v + j) * 3 + 1]; sz += allPos[(ring.v + j) * 3 + 2]; }
    allPos.push(sx / ringN, sy / ringN, sz / ringN);
    for (let j = 0; j < ringN; j++) { const a = ring.v + j, b = ring.v + ((j + 1) % ringN); flip ? lists[0].push(c, a, b) : lists[0].push(c, b, a); }
  };
  cap(rings[0], false); cap(rings[rings.length - 1], true);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(allPos, 3));
  const idx = []; let start = 0;
  for (let m = 0; m < lists.length; m++) { idx.push(...lists[m]); geo.addGroup(start, lists[m].length, m); start += lists[m].length; }
  geo.setIndex(idx); geo.computeVertexNormals();
  const uv = new Float32Array((allPos.length / 3) * 2); for (let i = 0; i < allPos.length / 3; i++) { uv[i * 2] = allPos[i * 3 + 2] * 0.5; uv[i * 2 + 1] = (allPos[i * 3 + 1] + Math.abs(allPos[i * 3])) * 0.5; /* works on sides and tops */ }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));

  const paint = carPaint(color ?? (taxi ? 0xf2c230 : rng.pick([0xb01c1c, 0x1c3cb0, 0x202224, 0xe8e8ea, 0x5a6a72, 0x2a6a3a, 0xd0a030, 0x6a1c8a, 0x8a8e92, 0x0e2a4a])));
  const gl = glass({ color: 0x0c1418, opacity: 0.72 });
  const trim = solid(0x0d0e10, { roughness: 0.45 });
  const head = emissive(0xeef4ff, 1.6).clone(), tail = emissive(0xff1a12, 1.2).clone(); // per-car (brake lights)
  const shell = new THREE.Mesh(geo, [paint, gl, trim, head, tail]); shell.name = 'shell'; shell.castShadow = true; shell.receiveShadow = true;

  // ---- details
  const mb = new MeshBuilder();
  const S = station, sF = S(0.995), sR = S(0.005);
  // grille + lower intake (front face), plates
  mb.add(roundedBox(sF.w * 1.05, 0.16, 0.06, 0.03, 2), solid(0x060607, { metalness: 0.5, roughness: 0.35 }), mat4([0, sF.belt - 0.13, zOf(1) + 0.012]));
  mb.add(roundedBox(sF.w * 1.25, 0.1, 0.05, 0.03, 2), trim, mat4([0, sF.bottom + 0.1, zOf(1) + 0.008]));
  const plate = solid(0xeeeeea, { roughness: 0.5 });
  mb.add(new THREE.BoxGeometry(0.52, 0.12, 0.02), plate, mat4([0, sF.bottom + 0.2, zOf(1) + 0.03]));
  mb.add(new THREE.BoxGeometry(0.52, 0.12, 0.02), plate, mat4([0, sR.belt - 0.26, zOf(0) - 0.03]));
  // arch liners (dark half-rings inside the cut-outs)
  const liner = solid(0x070708, { roughness: 0.95, side: THREE.DoubleSide });
  for (const az of axZ) for (const sd of [-1, 1]) {
    const lp = [], li = [], n = 18, xo = sd * (station((az / L) + 0.5).w * 0.97), xi = sd * (station((az / L) + 0.5).w - 0.34);
    for (let k = 0; k <= n; k++) { const ph = -0.15 + (k / n) * (Math.PI + 0.3); const y = wr + archR * Math.sin(ph), z = az + archR * Math.cos(ph); lp.push(xo, y, z, xi, y, z); }
    for (let k = 0; k < n; k++) li.push(k * 2, k * 2 + 1, k * 2 + 2, k * 2 + 1, k * 2 + 3, k * 2 + 2);
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3)); lg.setIndex(li); lg.computeVertexNormals();
    mb.add(lg, liner);
  }
  // mirrors + door handles
  const sA = S(Z.cowl - 0.035);
  for (const sd of [-1, 1]) {
    mb.add(roundedBox(0.2, 0.11, 0.08, 0.03, 2), paint, mat4([sd * (sA.w + 0.1), sA.belt + 0.07, sA.z], [0, sd * 0.25, 0]));
    mb.add(new THREE.BoxGeometry(0.1, 0.03, 0.05), trim, mat4([sd * (sA.w + 0.03), sA.belt + 0.03, sA.z + 0.02]));
    for (const sm of (Z.seams || []).slice(0, -1)) { const sh = S(sm + 0.05); if (P.bed && sm <= P.bed) continue; mb.add(roundedBox(0.16, 0.035, 0.03, 0.012, 1), solid(0x1a1b1d, { metalness: 0.6, roughness: 0.3 }), mat4([sd * (sh.w * 1.0 + 0.008), sh.belt - 0.08, sh.z - 0.0])); }
  }
  // exhaust
  mb.add(new THREE.CylinderGeometry(0.035, 0.035, 0.16, 12), solid(0xb8bcc2, { metalness: 1, roughness: 0.25 }), mat4([-W * 0.55, sR.bottom - 0.02, zOf(0) - 0.02], [Math.PI / 2, 0, 0]));
  // interior (visible through the glass)
  const inner = solid(0x16171a, { roughness: 0.85 }), uMid = (Z.deck + Z.cowl) / 2, sm = S(uMid);
  const dashS = S(Z.cowl - 0.03);
  mb.add(roundedBox(dashS.w * 1.7, 0.18, 0.4, 0.05, 2), inner, mat4([0, dashS.belt - 0.04, dashS.z - 0.1]));
  const rowZ = [S(Z.cowl - 0.14), S(Z.cowl - 0.29)].filter((s, i) => i === 0 || (Z.B != null && s.u > Z.deck + 0.04));
  if (!lo) for (const s of rowZ) for (const sd of (s === rowZ[0] ? [-1, 1] : [0])) {
    const wSeat = s === rowZ[0] ? 0.5 : sm.w * 1.5;
    mb.add(roundedBox(wSeat, 0.12, 0.5, 0.05, 2), inner, mat4([sd * 0.38, s.bottom + 0.42, s.z]));
    mb.add(roundedBox(wSeat, 0.6, 0.12, 0.05, 2), inner, mat4([sd * 0.38, s.bottom + 0.72, s.z - 0.24], [-0.18, 0, 0]));
  }
  const wheel = new THREE.TorusGeometry(0.18, 0.022, 8, 24); mb.add(wheel, inner, mat4([0.38, dashS.belt + 0.05, dashS.z - 0.32], [0.45, 0, 0]));
  if (taxi) mb.add(roundedBox(0.6, 0.18, 0.25, 0.05, 1), emissive(0xfff0a0, 2), mat4([0, S((Z.roofR + Z.roofF) / 2).top + 0.09, S((Z.roofR + Z.roofF) / 2).z]));
  const body = new THREE.Group(); body.name = 'body';
  body.add(shell); const det = mb.build({ name: 'details' }); body.add(det);
  if (lightbar || type === 'police') {
    const lb = new MeshBuilder(), sr = S((Z.roofR + Z.roofF) / 2);
    lb.add(roundedBox(1.1, 0.1, 0.28, 0.04, 1), trim, mat4([0, sr.top + 0.04, sr.z]));
    lb.add(roundedBox(0.5, 0.11, 0.26, 0.04, 1), emissive(0xff2020, 3), mat4([-0.27, sr.top + 0.11, sr.z]));
    lb.add(roundedBox(0.5, 0.11, 0.26, 0.04, 1), emissive(0x2040ff, 3), mat4([0.27, sr.top + 0.11, sr.z]));
    body.add(lb.build({ name: 'lightbar' }));
  }

  // ---- wheels: tyre (sidewall bulge + tread grooves), spoked rim, brake disc + caliper
  const tw = 0.13 + wr * 0.18; // half tread width
  const prof = [[wr * 0.66, -tw], [wr * 0.8, -tw - 0.012], [wr * 0.93, -tw], [wr * 0.985, -tw * 0.86]];
  const grooves = 4; for (let g = 0; g <= grooves * 2; g++) { const x = -tw * 0.8 + (g / (grooves * 2)) * tw * 1.6; prof.push([g % 2 ? wr * 0.982 : wr, x]); }
  prof.push([wr * 0.985, tw * 0.86], [wr * 0.93, tw], [wr * 0.8, tw + 0.012], [wr * 0.66, tw]);
  const tireGeo = lathe(prof, lo ? 20 : 40); tireGeo.rotateZ(Math.PI / 2); tireGeo.computeVertexNormals();
  const tireMat = solid(0x141416, { roughness: 0.9 });
  const rimColor = rng.pick([0xc4c8cc, 0x2a2a2c, 0x9a9ea2, 0x8a7a5a]), rimMat = solid(rimColor, { metalness: 1, roughness: 0.22 });
  const spokes = rng.pick([5, 6, 7, 10]);
  const rimMB = new MeshBuilder();
  const dish = lathe([[0.02, -tw * 0.55], [wr * 0.2, -tw * 0.6], [wr * 0.6, -tw * 0.5], [wr * 0.66, -tw * 0.55], [wr * 0.67, -tw * 0.75], [wr * 0.64, -tw * 0.8]], lo ? 16 : 32); // outward face at +x after rotateZ dish.rotateZ(Math.PI / 2);
  rimMB.add(dish, rimMat);
  const barrel = new THREE.CylinderGeometry(wr * 0.63, wr * 0.63, tw * 1.5, 28, 1, true); barrel.rotateZ(Math.PI / 2); rimMB.add(barrel, solid(0x3a3c40, { metalness: 0.9, roughness: 0.4, side: THREE.DoubleSide }));
  for (let i = 0; i < spokes; i++) {
    const sp = new THREE.BoxGeometry(0.03, wr * 0.48, spokes > 7 ? 0.035 : 0.06); sp.translate(0, wr * 0.36, 0);
    rimMB.add(sp, rimMat, mat4([tw * 0.66, 0, 0], [(i / spokes) * Math.PI * 2, 0, 0]));
  }
  rimMB.add(new THREE.CylinderGeometry(wr * 0.12, wr * 0.12, 0.04, 16), rimMat, mat4([tw * 0.7, 0, 0], [0, 0, Math.PI / 2]));
  const discGeo = new THREE.CylinderGeometry(wr * 0.52, wr * 0.52, 0.025, 28); discGeo.rotateZ(Math.PI / 2);
  const discMat = solid(0x6a6c70, { metalness: 0.9, roughness: 0.45 }), calMat = solid(rng.chance(0.3) ? 0xb01818 : 0x222326, { roughness: 0.4, metalness: 0.3 });
  const wheels = [];
  const root = new THREE.Group(); root.name = 'vehicle:' + type;
  root.add(body);
  const H = height ?? P.h;
  for (const [z, steer] of [[axZ[1], true], [axZ[0], false]]) for (const sd of [-1, 1]) {
    const x = sd * (station(z / L + 0.5).w - tw - 0.02);
    const pivot = new THREE.Group(); pivot.position.set(x, wr, z);
    const disc = new THREE.Mesh(discGeo, discMat); disc.position.x = -sd * 0.02; pivot.add(disc);
    const cal = new THREE.Mesh(roundedBox(0.06, 0.18, 0.12, 0.02, 1), calMat); cal.position.set(-sd * 0.0, wr * 0.38, sd * 0 - 0.1); pivot.add(cal);
    const spin = new THREE.Group();
    const tire = new THREE.Mesh(tireGeo, tireMat); tire.castShadow = true;
    const r = rimMB.build({ name: 'rim' }); if (sd < 0) r.scale.x = -1;
    spin.add(tire, r); pivot.add(spin); root.add(pivot);
    wheels.push({ pivot, spin, steer, side: sd, z, x, radius: wr, rest: wr });
  }
  const clearance = Math.min(...stations.map((s) => s.bottom));
  root.userData = { kind: 'vehicle', type, dims: { length: L, width: P.width, height: H }, wheels, body, headMat: head, tailMat: tail,
    collider: { type: 'box', size: [P.width, H - clearance, L], offset: [0, (H + clearance) / 2, 0] } };
  return root;
}
