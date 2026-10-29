// Firearm meshes for the shooter kit, built with the Modeling Kit (engine/modeling).
// Convention (same as skills/gameforge/models/scifi-rifle.model.js): grip centre (palm point)
// at the origin, +Z = muzzle direction, +Y = up. Sockets are child Object3Ds named
// `socket_<name>` (grip, muzzle, offHand, sight) and also listed as plain arrays in
// userData.sockets so clones stay JSON-safe. Geometry is cached per kind+colour; call
// weaponModel(kind) as often as needed (cheap clones that share geometry/materials).
import { K } from '../modeling/index.js';

const { THREE } = K;
const cache = new Map();
const cyl = (r, len, seg = 16, r2 = r) => new THREE.CylinderGeometry(r2, r, len, seg, 1).rotateX(Math.PI / 2);

function grip(mb, mat, { h = 0.11, w = 0.03, d = 0.038, rake = 0.3, y = 0.0 } = {}) {
  mb.add(K.roundedBox(w, h, d, 0.008, 2), mat, K.mat4([0, y - h * 0.18, -0.006], [rake, 0, 0]));
}
function triggerGroup(mb, frame, metal, y) {
  mb.add(K.roundedBox(0.008, 0.006, 0.06, 0.002, 1), frame, K.mat4([0, y - 0.03, 0.045]));
  mb.add(K.roundedBox(0.008, 0.03, 0.007, 0.002, 1), frame, K.mat4([0, y - 0.015, 0.075]));
  mb.add(K.roundedBox(0.005, 0.022, 0.006, 0.002, 1), metal, K.mat4([0, y - 0.012, 0.045], [-0.25, 0, 0]));
}

const BUILDERS = {
  rifle({ body, accent, metal, poly, glow }) {
    const mb = new K.MeshBuilder(), bore = 0.1;
    mb.add(K.roundedBox(0.05, 0.085, 0.34, 0.01, 2), body, K.mat4([0, 0.095, 0.09]));                 // receiver
    mb.add(K.roundedBox(0.056, 0.07, 0.24, 0.012, 2), body, K.mat4([0, bore - 0.004, 0.37]));          // handguard
    for (let i = 0; i < 5; i++) mb.add(K.roundedBox(0.058, 0.012, 0.022, 0.003, 1), poly, K.mat4([0, bore - 0.012, 0.29 + i * 0.038]));
    mb.add(cyl(0.011, 0.2), metal, K.mat4([0, bore, 0.58]));                                           // barrel
    mb.add(K.roundedBox(0.03, 0.03, 0.055, 0.006, 2), metal, K.mat4([0, bore, 0.68]));                 // brake
    mb.add(K.roundedBox(0.022, 0.01, 0.42, 0.002, 1), metal, K.mat4([0, 0.143, 0.18]));                // top rail
    mb.add(K.roundedBox(0.038, 0.04, 0.09, 0.008, 2), body, K.mat4([0, 0.17, 0.08]));                  // optic
    mb.add(cyl(0.017, 0.006, 20), K.glass({ color: 0x6aa8c8, opacity: 0.5 }), K.mat4([0, 0.172, 0.127]));
    mb.add(K.roundedBox(0.002, 0.004, 0.06, 0.001, 1), glow, K.mat4([0.02, 0.18, 0.08]));
    mb.add(K.roundedBox(0.032, 0.15, 0.06, 0.008, 2), poly, K.mat4([0, -0.01, 0.17], [0.22, 0, 0])); // magazine (forward curved)
    mb.add(K.roundedBox(0.04, 0.05, 0.22, 0.01, 2), body, K.mat4([0, 0.09, -0.17]));                  // stock beam
    mb.add(K.roundedBox(0.044, 0.13, 0.03, 0.01, 2), poly, K.mat4([0, 0.065, -0.29]));                 // butt pad
    mb.add(K.roundedBox(0.06, 0.012, 0.06, 0.004, 1), accent, K.mat4([0, 0.05, 0.36]));
    grip(mb, poly, { y: 0.03 }); triggerGroup(mb, body, metal, 0.06);
    mb.add(K.roundedBox(0.03, 0.07, 0.03, 0.008, 2), poly, K.mat4([0, bore - 0.07, 0.42], [-0.3, 0, 0])); // foregrip
    return { mb, sockets: { grip: [0, 0, 0], muzzle: [0, bore, 0.71], offHand: [0, bore - 0.07, 0.42], sight: [0, 0.172, -0.05] } };
  },
  carbine(m) { const r = BUILDERS.rifle(m); return r; },
  smg({ body, accent, metal, poly }) {
    const mb = new K.MeshBuilder(), bore = 0.085;
    mb.add(K.roundedBox(0.046, 0.075, 0.26, 0.01, 2), body, K.mat4([0, 0.085, 0.08]));
    mb.add(cyl(0.016, 0.1, 16), metal, K.mat4([0, bore, 0.26]));                                       // suppressor-ish shroud
    mb.add(cyl(0.01, 0.06), metal, K.mat4([0, bore, 0.33]));
    mb.add(K.roundedBox(0.026, 0.19, 0.03, 0.006, 2), poly, K.mat4([0, -0.04, 0.12], [0.08, 0, 0])); // long stick mag
    mb.add(K.roundedBox(0.03, 0.018, 0.05, 0.004, 1), metal, K.mat4([0, 0.135, 0.06]));                // rear sight block
    for (const s of [-1, 1]) mb.add(K.roundedBox(0.006, 0.012, 0.2, 0.003, 1), metal, K.mat4([s * 0.018, 0.09, -0.13])); // wire stock
    mb.add(K.roundedBox(0.044, 0.07, 0.016, 0.005, 1), poly, K.mat4([0, 0.075, -0.235]));
    mb.add(K.roundedBox(0.048, 0.01, 0.12, 0.003, 1), accent, K.mat4([0, 0.05, 0.1]));
    grip(mb, poly, { y: 0.025 }); triggerGroup(mb, body, metal, 0.05);
    return { mb, sockets: { grip: [0, 0, 0], muzzle: [0, bore, 0.36], offHand: [0, -0.04, 0.12], sight: [0, 0.15, -0.1] } };
  },
  pistol({ body, metal, poly, accent }) {
    const mb = new K.MeshBuilder(), bore = 0.075;
    mb.add(K.roundedBox(0.03, 0.034, 0.19, 0.006, 2), metal, K.mat4([0, 0.078, 0.065]));               // slide
    for (let i = 0; i < 5; i++) mb.add(K.roundedBox(0.031, 0.022, 0.003, 0.001, 1), poly, K.mat4([0, 0.08, -0.015 + i * 0.006]));
    mb.add(K.roundedBox(0.028, 0.026, 0.15, 0.005, 2), body, K.mat4([0, 0.05, 0.06]));                 // frame
    mb.add(K.roundedBox(0.006, 0.008, 0.006, 0.002, 1), accent, K.mat4([0, 0.098, 0.15]));            // front sight
    grip(mb, poly, { h: 0.1, w: 0.028, d: 0.042, rake: 0.25, y: 0.02 }); triggerGroup(mb, body, metal, 0.045);
    return { mb, sockets: { grip: [0, 0, 0], muzzle: [0, bore, 0.16], offHand: [0, -0.02, 0.0], sight: [0, 0.1, -0.12] } };
  },
  shotgun({ body, metal, poly, wood }) {
    const mb = new K.MeshBuilder(), bore = 0.095;
    mb.add(K.roundedBox(0.046, 0.07, 0.2, 0.01, 2), metal, K.mat4([0, 0.085, 0.07]));
    mb.add(cyl(0.012, 0.52), metal, K.mat4([0, bore + 0.01, 0.43]));                                   // barrel
    mb.add(cyl(0.011, 0.42), metal, K.mat4([0, bore - 0.022, 0.38]));                                  // tube magazine
    mb.add(K.roundedBox(0.05, 0.045, 0.16, 0.012, 2), wood, K.mat4([0, bore - 0.025, 0.38]));         // pump
    for (let i = 0; i < 6; i++) mb.add(K.roundedBox(0.052, 0.004, 0.006, 0.001, 1), poly, K.mat4([0, bore - 0.025, 0.32 + i * 0.024]));
    mb.add(K.roundedBox(0.04, 0.07, 0.3, 0.012, 2), wood, K.mat4([0, 0.055, -0.17], [0.12, 0, 0]));   // stock
    mb.add(K.roundedBox(0.044, 0.12, 0.024, 0.008, 2), poly, K.mat4([0, 0.02, -0.32], [0.12, 0, 0]));
    mb.add(K.roundedBox(0.006, 0.008, 0.008, 0.002, 1), body, K.mat4([0, bore + 0.026, 0.68]));
    grip(mb, wood, { y: 0.02 }); triggerGroup(mb, metal, metal, 0.05);
    return { mb, sockets: { grip: [0, 0, 0], muzzle: [0, bore + 0.01, 0.69], offHand: [0, bore - 0.025, 0.38], sight: [0, 0.13, -0.08] } };
  },
  sniper({ body, metal, poly, accent }) {
    const mb = new K.MeshBuilder(), bore = 0.1;
    mb.add(K.roundedBox(0.05, 0.08, 0.3, 0.01, 2), body, K.mat4([0, 0.09, 0.07]));
    mb.add(K.roundedBox(0.054, 0.06, 0.32, 0.012, 2), body, K.mat4([0, bore - 0.01, 0.36]));
    mb.add(cyl(0.012, 0.5, 16, 0.015), metal, K.mat4([0, bore, 0.75]));
    mb.add(K.roundedBox(0.034, 0.03, 0.07, 0.006, 2), metal, K.mat4([0, bore, 1.02]));
    mb.add(cyl(0.022, 0.3, 20), metal, K.mat4([0, 0.19, 0.08]));                                      // scope tube
    mb.add(cyl(0.03, 0.06, 20, 0.022), metal, K.mat4([0, 0.19, 0.26]));                               // objective bell
    mb.add(cyl(0.026, 0.004, 20), K.glass({ color: 0x4a8ab0, opacity: 0.6 }), K.mat4([0, 0.19, 0.29]));
    for (const z of [0.01, 0.15]) mb.add(K.roundedBox(0.026, 0.04, 0.02, 0.004, 1), metal, K.mat4([0, 0.155, z]));
    mb.add(cyl(0.012, 0.02, 12).rotateY(Math.PI / 2), accent, K.mat4([0, 0.22, 0.08]));               // turret
    mb.add(K.roundedBox(0.03, 0.1, 0.06, 0.006, 2), poly, K.mat4([0, 0.01, 0.15]));                    // box mag
    mb.add(K.roundedBox(0.046, 0.09, 0.28, 0.012, 2), body, K.mat4([0, 0.07, -0.2]));                 // stock
    mb.add(K.roundedBox(0.03, 0.02, 0.12, 0.006, 1), poly, K.mat4([0, 0.125, -0.18]));                // cheek rest
    for (const s of [-1, 1]) mb.add(K.roundedBox(0.008, 0.16, 0.008, 0.003, 1), metal, K.mat4([s * 0.02, bore - 0.1, 0.48], [0.4, 0, s * 0.3])); // bipod
    grip(mb, poly, { y: 0.03 }); triggerGroup(mb, body, metal, 0.06);
    return { mb, sockets: { grip: [0, 0, 0], muzzle: [0, bore, 1.06], offHand: [0, bore - 0.04, 0.38], sight: [0, 0.19, -0.1] } };
  },
  launcher({ body, metal, poly, accent }) {
    const mb = new K.MeshBuilder(), bore = 0.12;
    mb.add(cyl(0.055, 1.0, 24), body, K.mat4([0, bore, 0.2]));                                        // tube
    mb.add(cyl(0.065, 0.12, 24, 0.055), metal, K.mat4([0, bore, 0.74]));                               // muzzle flare
    mb.add(cyl(0.062, 0.1, 24), metal, K.mat4([0, bore, -0.3]));
    for (const z of [-0.05, 0.4]) mb.add(cyl(0.058, 0.03, 24), accent, K.mat4([0, bore, z]));
    mb.add(K.roundedBox(0.03, 0.06, 0.09, 0.006, 2), metal, K.mat4([-0.065, bore + 0.03, 0.15]));      // side sight
    mb.add(K.roundedBox(0.03, 0.08, 0.035, 0.008, 2), poly, K.mat4([0, bore - 0.09, 0.3], [-0.2, 0, 0])); // fore grip
    mb.add(K.roundedBox(0.04, 0.04, 0.12, 0.006, 1), body, K.mat4([0, 0.065, 0.02]));
    grip(mb, poly, { y: 0.02 }); triggerGroup(mb, metal, metal, 0.05);
    return { mb, sockets: { grip: [0, 0, 0], muzzle: [0, bore, 0.8], offHand: [0, bore - 0.09, 0.3], sight: [-0.065, bore + 0.07, 0.0] } };
  },
};
export const WEAPON_MODEL_KINDS = Object.keys(BUILDERS);

function build(kind, colors) {
  const b = BUILDERS[kind] || BUILDERS.rifle;
  const mats = {
    body: K.solid(colors.body, { roughness: 0.5, metalness: 0.55 }),
    accent: K.solid(colors.accent, { roughness: 0.45, metalness: 0.3 }),
    metal: K.solid(colors.metal, { roughness: 0.35, metalness: 0.9 }),
    poly: K.polymer(colors.poly), wood: K.solid(colors.wood, { roughness: 0.7, metalness: 0 }),
    glow: K.emissive(colors.glow, 2.5),
  };
  const { mb, sockets } = b(mats);
  const g = mb.build({ name: 'weapon_' + kind });
  for (const [n, p] of Object.entries(sockets)) { const s = new THREE.Object3D(); s.name = 'socket_' + n; s.position.set(...p); g.add(s); }
  g.userData.sockets = sockets;
  g.userData.weaponKind = kind;
  return K.finish(g, { kind: 'weapon', collider: null, name: 'weapon_' + kind });
}

/** Firearm model: kind in WEAPON_MODEL_KINDS; colours { body, accent, metal, poly, wood, glow }. */
export function weaponModel(kind = 'rifle', colors = {}) {
  const c = { body: 0x33383f, accent: 0xc8742a, metal: 0x4a4e54, poly: 0x222326, wood: 0x6a4428, glow: 0x38e0ff, ...colors };
  const key = kind + JSON.stringify(c);
  if (!cache.has(key)) cache.set(key, build(kind, c));
  const m = cache.get(key).clone();
  m.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.userData.noHitscan = true; } });
  return m;
}
/** World position of a weapon socket (Object3D child `socket_<name>`). */
export function weaponSocketWorld(model, name, out = new THREE.Vector3()) {
  const s = model.getObjectByName('socket_' + name);
  if (!s) return model.getWorldPosition(out);
  return s.getWorldPosition(out);
}
