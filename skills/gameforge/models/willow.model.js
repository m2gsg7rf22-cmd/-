// Weeping willow (Salix babylonica-like), realistic style.
// Size: ~9 m tall, crown ~11-12 m wide, trunk ~0.65 m diameter at breast height.
// Silhouette: short thick (slightly leaning) trunk forking low into a few upward-arching scaffold
//   limbs; broad rounded dome whose outer edge falls as a vertical curtain almost to the ground.
// Defining features: 1) low fork into 4-6 ascending limbs; 2) limbs arch outward then droop;
//   3) long whip-like hanging branchlets (3-7 m) forming a curtain ending ~0.3-1.2 m above ground;
//   4) slender lanceolate yellow-green leaves with silvery undersides; 5) furrowed grey-brown bark.
// Materials: bark (pbr 'bark'), leaf curtain cards (custom painted texture). 2 materials.
// Budget: near tree 5-10k triangles.
// Params: { seed, height, spread, density, leafColor }
export default function build(K, { seed = 7, height = 9, spread = 1, density = 1, leafColor = 0xb0bf62 } = {}) {
  const { THREE, V } = K, rng = new K.RNG(seed);
  const H = height, s = H / 9;                     // all dimensions scale with height
  const forkY = 2.2 * s, trunkR = 0.34 * s;

  // ---------- helpers
  const bez = (p0, p1, p2, p3, n) => { const out = []; for (let i = 0; i <= n; i++) { const t = i / n, a = (1 - t) ** 3, b = 3 * (1 - t) ** 2 * t, c = 3 * (1 - t) * t * t, d = t ** 3; out.push(V(p0.x * a + p1.x * b + p2.x * c + p3.x * d, p0.y * a + p1.y * b + p2.y * c + p3.y * d, p0.z * a + p1.z * b + p2.z * c + p3.z * d)); } return out; };
  const taper = (n, r0, r1, pw = 1) => Array.from({ length: n + 1 }, (_, i) => r0 + (r1 - r0) * Math.pow(i / n, pw));
  const horiz = (a) => V(Math.cos(a), 0, Math.sin(a));
  const branches = [], hangers = [];  // hangers: attachment points for curtain strands

  // ---------- trunk (slight lean + curve, root flare via radius profile)
  const lean = horiz(rng.range(0, Math.PI * 2)).multiplyScalar(0.25 * s);
  const trunkPts = bez(V(0, 0, 0), V(0, forkY * 0.35, 0), V(lean.x * 0.5, forkY * 0.7, lean.z * 0.5), V(lean.x, forkY, lean.z), 8);
  const trunkRad = trunkPts.map((p, i) => { const t = i / 8; return trunkR * (1 + 0.6 * Math.exp(-t * 9)) * (1 - 0.3 * t); });
  branches.push({ points: trunkPts, radii: trunkRad });
  const top = trunkPts[8];

  // ---------- scaffold limbs: ascend steeply, then arch outward (dome)
  const nLimbs = 7, a0 = rng.range(0, Math.PI * 2), order = rng.shuffle([...Array(nLimbs).keys()]);
  const addHangers = (pts, from, out) => { for (let m = from; m < pts.length; m++) hangers.push({ p: pts[m], out }); };
  for (let i = 0; i < nLimbs; i++) {
    const az = a0 + (i / nLimbs) * Math.PI * 2 + rng.range(-0.25, 0.25), out = horiz(az);
    const start = top.clone().add(V(0, rng.range(-0.5, 0.1) * s, 0)).addScaledVector(out, 0.12 * s);
    const f = order[i] / (nLimbs - 1);                    // 0 = steep central limb, 1 = wide low limb (gives a dome)
    const rise = (6.7 - 2.8 * f + rng.range(-0.3, 0.3)) * s, reach = (0.9 + 2.6 * f + rng.range(-0.3, 0.3)) * s * spread;
    const end = start.clone().add(V(0, rise, 0)).addScaledVector(out, reach);
    const pts = bez(start, start.clone().add(V(0, rise * 0.5, 0)).addScaledVector(out, reach * 0.2), end.clone().add(V(0, -rise * 0.15, 0)).addScaledVector(out, -reach * 0.3), end, 10);
    branches.push({ points: pts, radii: taper(10, trunkR * 0.48, 0.03 * s, 0.8) });
    addHangers(pts, 5, out);
    // secondaries: leave the upper limb, arch up/over and droop outward
    const nSec = 5;
    for (let k = 0; k < nSec; k++) {
      const t = 0.4 + 0.6 * (k / (nSec - 1)), j = Math.round(t * 10), p0 = pts[j];
      const az2 = az + rng.range(-1.3, 1.3), o2 = horiz(az2), L = rng.range(1.8, 3.2) * s * spread * (1.15 - t * 0.3);
      const up = rng.range(0.6, 1.2) * s * (1.4 - t * 0.7);
      const p3 = p0.clone().addScaledVector(o2, L).add(V(0, up - (1.0 + 1.2 * t) * s, 0));
      const sp = bez(p0, p0.clone().addScaledVector(o2, L * 0.25).add(V(0, up, 0)), p0.clone().addScaledVector(o2, L * 0.7).add(V(0, up * 0.95, 0)), p3, 6);
      branches.push({ points: sp, radii: taper(6, 0.05 * s * (1.25 - t * 0.5), 0.01 * s, 0.9) });
      addHangers(sp, 1, o2);
      // tertiaries: short arching twigs off the secondary
      for (let q = 0; q < 2; q++) {
        const b0 = sp[3 + q * 2], o3 = horiz(az2 + rng.sign() * rng.range(0.5, 1.1)), L3 = rng.range(0.8, 1.5) * s;
        const tp = bez(b0, b0.clone().addScaledVector(o3, L3 * 0.3).add(V(0, 0.35 * s, 0)), b0.clone().addScaledVector(o3, L3 * 0.75).add(V(0, 0.3 * s, 0)), b0.clone().addScaledVector(o3, L3).add(V(0, -0.3 * s, 0)), 3);
        branches.push({ points: tp, radii: taper(3, 0.018 * s, 0.006 * s) });
        addHangers(tp, 1, o3);
      }
    }
  }

  const bark = K.mesh(K.skinBranches(branches, { smooth: 1, radialFor: (r) => (r > 0.25 * s ? 12 : r > 0.12 * s ? 7 : r > 0.06 * s ? 5 : r > 0.03 * s ? 4 : 3), vScale: 0.6 }), K.pbr('bark', { color: 0x4b4136, color2: 0x6e6455, repeat: [2, 1] }), { name: 'bark' });

  // ---------- curtain texture: left half = periodic hanging whips (tiles in v), right half = whip ends
  const tex = K.paint(256, (p) => {
    const S = p.size, r = p.rng;
    const whip = (x0, yEnd, ox, periodic) => {
      const ph = r.range(0, 6.28), xs = (y) => ox + x0 + 3 * Math.sin((y / S) * Math.PI * 2 + ph);
      for (let y = 0; y < yEnd; y += 2) p.line(xs(y), y, xs(y + 2), y + 2, 2, [150, 140, 95]);
      for (let y = r.range(0, 8), i = 0; y < yEnd - 4; y += r.range(6, 10), i++) {
        const side = i % 2 ? 1 : -1, fade = periodic ? 1 : Math.min(1, (yEnd - y) / 60 + 0.35);
        const L = r.range(24, 34) * fade, a = Math.PI / 2 - side * r.range(0.25, 0.65), sh = r.chance(0.3) ? r.range(0.97, 1) : r.range(0.78, 0.93);
        for (const dy of periodic ? [0, -S, S] : [0]) p.leaf(xs(y), y + dy, L, L * 0.17, a, sh);
      }
    };
    for (const x of [22, 64, 106]) whip(x + r.range(-4, 4), S, 0, true);
    for (const x of [22, 64, 106]) whip(x + r.range(-4, 4), r.range(170, 240), 128, false);
  }, { seed });
  tex.wrapT = THREE.RepeatWrapping;

  // ---------- hanging strands: chains of cards following a sagging curve to near the ground
  const list = [], base = new THREE.Color(leafColor), Wc = 0.45 * s, tile = Wc * 2;
  const crownR = Math.max(...hangers.map((h) => Math.hypot(h.p.x, h.p.z)));
  for (const h of hangers) {
    const reps = Math.round(density) + (rng.chance(0.2) ? 1 : 0);
    for (let rep = 0; rep < reps; rep++) {
      const p0 = h.p.clone().add(V(rng.range(-0.15, 0.15), 0, rng.range(-0.15, 0.15)));
      const rr = Math.hypot(p0.x, p0.z) / crownR;                         // 0 = trunk, 1 = crown edge
      const bottom = rr > 0.55 ? (rng.chance(0.75) ? rng.range(0.25, 0.9) : rng.range(0.9, 2.2)) * s : p0.y - (p0.y - 1.2 * s) * rng.range(0.4, 0.9);
      const len = p0.y - bottom; if (len < 0.4) continue;
      const o = h.out.clone().applyAxisAngle(V(0, 1, 0), rng.range(-0.6, 0.6));
      const bow = rng.range(0.2, 0.5) * s;
      const n = Math.max(2, Math.ceil(len / 1.1));
      const path = bez(p0, p0.clone().addScaledVector(o, bow).add(V(0, 0.1 * s, 0)), p0.clone().addScaledVector(o, bow * 1.3).add(V(0, -len * 0.3, 0)), V(p0.x, bottom, p0.z).addScaledVector(o, bow * 1.1), n);
      const side = new THREE.Vector3().crossVectors(V(0, 1, 0), o).applyAxisAngle(V(0, 1, 0), rng.range(-0.5, 0.5)).normalize();
      const col = base.clone().offsetHSL(rng.range(-0.02, 0.02), rng.range(-0.08, 0.05), rng.range(-0.06, 0.05));
      let cum = rng.range(0, 1);
      for (let i = 0; i < n; i++) {
        const a = path[i], d = path[i + 1].clone().sub(a), hh = d.length(), last = i === n - 1;
        const uv = last ? [0.5, 1, 1, 0] : [0, cum + hh / tile, 0.5, cum];
        list.push({ pos: a, dir: d.normalize(), side, w: Wc, h: hh, color: col, uv }); cum += hh / tile;
      }
    }
  }
  // crown cover: short drooping sprays lying over the arcs so the dome reads from above / 3/4
  for (const h of hangers) {
    if (h.p.y < H * 0.5 || !rng.chance(0.85)) continue;
    const o = h.out.clone().applyAxisAngle(V(0, 1, 0), rng.range(-0.8, 0.8)), dir = o.clone().multiplyScalar(rng.range(0.8, 1.5)).add(V(0, -1, 0)).normalize();
    const side = new THREE.Vector3().crossVectors(V(0, 1, 0), o).normalize();
    list.push({ pos: h.p.clone().add(V(0, 0.08 * s, 0)), dir, side, w: Wc * 1.3, h: rng.range(0.9, 1.4) * s, color: base.clone().offsetHSL(0, -0.04, rng.range(-0.02, 0.07)), uv: [0.5, 1, 1, 0] });
  }
  const leaves = K.mesh(K.cards(list, { centre: V(0, H * 0.55, 0), normalBlend: 0.7 }), K.cardMaterial(tex, { alphaTest: 0.4, roughness: 0.7 }), { name: 'leaves' });

  const g = new THREE.Group(); g.add(bark, leaves);
  return K.finish(K.ground(g), { kind: 'tree', collider: { type: 'cylinder', radius: trunkR * 1.2, height: H } });
}
