import * as THREE from 'three';

/** What the Void Dragon is doing. */
export type DragonPhase = 'circle' | 'swoop' | 'breath' | 'perch';

export interface DragonBrain {
  phase: DragonPhase;
  /** Seconds left in the current phase. */
  t: number;
  /** Angle on its circling path around the arena. */
  angle: number;
  /** Bolts left in a breath attack. */
  shots: number;
  shotCd: number;
  /** Seconds until the next crystal scan. */
  scan: number;
  /** Intact crystals found by the last scan. */
  crystals: { x: number; y: number; z: number }[];
  beam: THREE.Line;
  /** Neck + head chain, tail chain, jaw. */
  tail: THREE.Object3D[];
  jaw: THREE.Object3D;
}

/** Arena the dragon guards (Voidreach central island). */
export interface DragonArena {
  x: number;
  /** Plaza surface y. */
  y: number;
  z: number;
  /** Crystal cells on the spires. */
  crystals: { x: number; y: number; z: number }[];
}

/**
 * Choose the next attack after circling. Weighted toward swoops (the only time a melee player
 * can reach it) and perches (its vulnerable landing on the plaza).
 */
export function nextPhase(r: number): DragonPhase {
  if (r < 0.42) return 'swoop';
  if (r < 0.72) return 'breath';
  return 'perch';
}

function box(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, geos: THREE.BufferGeometry[]): THREE.Mesh {
  const g = new THREE.BoxGeometry(w, h, d);
  geos.push(g);
  const m = new THREE.Mesh(g, mat);
  m.position.set(x, y, z);
  return m;
}

/**
 * Blocky dragon model facing -Z: body with back spines, a three-part neck, a horned head with a
 * hinged jaw and glowing eyes, a six-segment tail, two-part flapping wings and folded legs.
 */
export function buildDragon(
  geos: THREE.BufferGeometry[],
  mat: (c: number, emissive?: number) => THREE.MeshLambertMaterial,
): { group: THREE.Group; tail: THREE.Object3D[]; wings: THREE.Object3D[]; jaw: THREE.Object3D; head: THREE.Object3D } {
  const scale = mat(0x1d1626);
  const belly = mat(0x2e2440);
  const membrane = mat(0x3a2a52);
  const bone = mat(0x15101c);
  const eye = mat(0xe080ff, 0xc050ff);
  const horn = mat(0xcfc6d8);
  const group = new THREE.Group();

  group.add(box(2.2, 1.5, 4.2, scale, 0, 1.25, 0, geos));
  group.add(box(1.8, 0.3, 3.6, belly, 0, 0.45, 0, geos));
  for (let i = 0; i < 5; i++) group.add(box(0.2, 0.45, 0.4, horn, 0, 2.15, -1.6 + i * 0.8, geos));
  // Neck rising to the head.
  const necks: [number, number][] = [[1.55, -2.5], [1.85, -3.3], [2.1, -4.05]];
  for (const [y, z] of necks) group.add(box(0.95, 0.9, 0.95, scale, 0, y, z, geos));
  const head = new THREE.Group();
  head.position.set(0, 2.2, -4.9);
  head.add(box(1.25, 0.95, 1.3, scale, 0, 0, 0, geos));
  head.add(box(0.85, 0.5, 1.1, scale, 0, -0.08, -1.1, geos));
  head.add(box(0.22, 0.14, 0.04, eye, -0.38, 0.18, -0.66, geos));
  head.add(box(0.22, 0.14, 0.04, eye, 0.38, 0.18, -0.66, geos));
  head.add(box(0.12, 0.12, 0.12, bone, -0.22, 0.05, -1.66, geos));
  head.add(box(0.12, 0.12, 0.12, bone, 0.22, 0.05, -1.66, geos));
  for (const s of [-1, 1]) {
    const h = box(0.16, 0.16, 0.8, horn, s * 0.38, 0.62, 0.45, geos);
    h.rotation.x = 0.6;
    head.add(h);
  }
  const jaw = new THREE.Group();
  jaw.position.set(0, -0.42, 0.2);
  jaw.add(box(0.75, 0.22, 1.6, bone, 0, -0.08, -0.85, geos));
  head.add(jaw);
  group.add(head);

  // Tail: a chain, each segment parented to the previous so the sway propagates.
  const tail: THREE.Object3D[] = [];
  let parent: THREE.Object3D = group;
  let z = 2.1;
  for (let i = 0; i < 6; i++) {
    const seg = new THREE.Group();
    seg.position.set(0, i === 0 ? 1.15 : 0, z);
    const w = 0.95 - i * 0.12;
    seg.add(box(w, w, 0.95, scale, 0, 0, 0.45, geos));
    seg.add(box(0.14, 0.3, 0.3, horn, 0, w / 2 + 0.12, 0.45, geos));
    parent.add(seg);
    tail.push(seg);
    parent = seg;
    z = 0.9;
  }

  // Wings: an inner and an outer panel per side, each on its own hinge.
  const wings: THREE.Object3D[] = [];
  for (const s of [-1, 1]) {
    const inner = new THREE.Group();
    inner.position.set(s * 1.1, 1.75, -0.6);
    inner.add(box(2.8, 0.18, 0.2, bone, s * 1.4, 0, 0, geos));
    inner.add(box(2.8, 0.06, 2.4, membrane, s * 1.4, -0.02, 1.2, geos));
    const outer = new THREE.Group();
    outer.position.set(s * 2.8, 0, 0);
    outer.add(box(2.6, 0.16, 0.18, bone, s * 1.3, 0, 0, geos));
    outer.add(box(2.6, 0.05, 1.9, membrane, s * 1.3, -0.02, 0.95, geos));
    inner.add(outer);
    group.add(inner);
    wings.push(inner, outer);
  }
  for (const [x, zz] of [[-0.8, -1.2], [0.8, -1.2], [-0.8, 1.3], [0.8, 1.3]]) group.add(box(0.4, 0.55, 0.5, scale, x, 0.3, zz, geos));
  return { group, tail, wings, jaw, head };
}

/** Animate wings (folded while perched), tail sway and the jaw. */
export function animateDragon(time: number, brain: DragonBrain, wings: THREE.Object3D[], perched: boolean, open: boolean): void {
  for (let i = 0; i < wings.length; i++) {
    const side = i < 2 ? -1 : 1;
    const outer = i % 2 === 1;
    if (perched) {
      wings[i].rotation.z = side * (outer ? 1.9 : 0.55);
    } else {
      const flap = Math.sin(time * 3.4 - (outer ? 0.7 : 0));
      wings[i].rotation.z = side * flap * (outer ? 0.5 : 0.7);
    }
  }
  brain.tail.forEach((seg, i) => {
    seg.rotation.y = Math.sin(time * 1.8 - i * 0.7) * 0.16;
    seg.rotation.x = perched ? 0.05 : Math.sin(time * 1.3 - i * 0.5) * 0.06;
  });
  const target = open ? 0.55 : 0.05;
  brain.jaw.rotation.x += (target - brain.jaw.rotation.x) * 0.2;
}
