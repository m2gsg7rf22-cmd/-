// Sci-fi assault rifle "VK-9 Lancer" — hard-surface hero prop.
// Brief:
//   Real size: ~0.92 m long (z), ~0.30 m tall incl. magazine/optic, ~0.06 m wide.
//   Silhouette: long, low, wedge-nosed receiver; boxy vented shroud tapering to a slim barrel and
//     slotted muzzle brake; skeletal stock dropping behind; raked pistol grip; forward-curved mag;
//     squat boxy optic on a full-length top rail.
//   Defining features: vented barrel shroud, skeletal stock, curved magazine, boxy optic with glass,
//     cyan emissive strips on receiver + optic.
//   Materials: painted metal body (dark slate), orange accent paint, gunmetal (barrel/rail), rubberised
//     polymer (grip/mag/seams), cyan emissive, lens glass. Style: stylized-realistic.
//   Budget: hero weapon, 8–20k triangles, <= 6 materials.
// ATTACH FRAME (hand socket): origin = centre of the pistol grip (palm point), +Z = barrel/muzzle
//   direction, +Y = up (top rail), X = width. Not grounded on purpose -> review with {"floating":true}.
//   userData.sockets: grip [0,0,0], muzzle, offHand (foregrip centre), sight (eye point behind optic).
// Params: { body, accent, glow, reviewScale, reviewYaw (review only; keep defaults in game) }
export default function build(K, { body = 0x3a4047, accent = 0xd8661e, glow = 0x38e0ff, reviewScale = 1, reviewYaw = 0 } = {}) {
  const { THREE } = K, mb = new K.MeshBuilder();
  // ---- materials
  const mBody = K.pbr('paintedMetal', { color: body, rust: 0, repeat: [2, 2] });
  const mAccent = K.pbr('paintedMetal', { color: accent, rust: 0, repeat: [2, 2] });
  const mMetal = K.pbr('metal', { color: 0x4a4d52, repeat: [2, 2] });
  const mPoly = K.pbr('leather', { color: 0x24262a, repeat: [4, 4] });
  const mGlow = K.emissive(glow, 3);
  const mGlass = K.glass({ color: 0x5fa8c8, opacity: 0.45 });

  // ---- key dimensions (metres)
  const boreY = 0.112;                 // barrel axis height above grip centre
  const recZ0 = -0.06, recZ1 = 0.25;   // receiver extent
  const recBot = 0.055, recTop = 0.148, recW = 0.052;
  const railTop = recTop + 0.012;
  const shrZ0 = 0.24, shrZ1 = 0.50;
  const muzzleZ = 0.64;

  const sec = (z, w, top, bottom, cy, exp = 6, topWidth = w) => ({ z, ring: K.profileRing(24, { width: w, top, bottom, cy, exp, topWidth }) });

  // ===== PRIMARY: receiver (lofted wedge, slightly narrower on top)
  const rc = (recTop + recBot) / 2, rh = (recTop - recBot) / 2;
  mb.add(K.loft([
    sec(recZ0, recW * 0.92, rh * 0.9, rh * 0.75, rc + 0.004, 6, recW * 0.85),
    sec(recZ0 + 0.02, recW, rh, rh, rc, 6, recW * 0.88),
    sec(recZ1 - 0.05, recW, rh, rh, rc, 6, recW * 0.88),
    sec(recZ1, recW * 0.94, rh * 0.95, rh * 0.55, rc + 0.012, 6, recW * 0.85),
  ]), mBody);
  // magazine well (flared)
  mb.add(K.roundedBox(0.04, 0.035, 0.07, 0.006, 2), mBody, K.mat4([0, recBot - 0.012, 0.115]));
  mb.add(K.roundedBox(0.044, 0.008, 0.076, 0.003, 1), mAccent, K.mat4([0, recBot - 0.03, 0.115]));

  // ===== shroud / handguard: boxy, tapering towards the muzzle
  mb.add(K.loft([
    sec(shrZ0, 0.056, 0.036, 0.05, boreY - 0.004, 5),
    sec(shrZ0 + 0.04, 0.06, 0.036, 0.054, boreY - 0.004, 5),          // chin: deep at the rear
    sec(shrZ1 - 0.06, 0.056, 0.032, 0.04, boreY - 0.002, 5),
    sec(shrZ1, 0.044, 0.026, 0.026, boreY, 5),
  ]), mBody);
  mb.add(K.roundedBox(0.046, 0.004, 0.006, 0.0015, 1), mGlow, K.mat4([0, boreY - 0.02, shrZ1 - 0.001]));   // front glow slit
  // vents: dark recessed-looking slots framed by accent ribs, both sides
  for (const s of [-1, 1]) {
    for (let i = 0; i < 6; i++) {
      const z = shrZ0 + 0.07 + i * 0.03;
      mb.add(K.roundedBox(0.004, 0.034, 0.016, 0.0015, 1), mPoly, K.mat4([s * 0.029, boreY - 0.002, z]));
    }
    mb.add(K.roundedBox(0.004, 0.006, 0.19, 0.002, 1), mAccent, K.mat4([s * 0.0295, boreY + 0.024, shrZ0 + 0.145]));
  }
  // underside vents
  for (let i = 0; i < 5; i++) mb.add(K.roundedBox(0.026, 0.004, 0.014, 0.0015, 1), mPoly, K.mat4([0, boreY - 0.0535 + i * 0.0035, shrZ0 + 0.07 + i * 0.03]));

  // ===== barrel + muzzle brake
  const cyl = (r, len, seg = 20) => new THREE.CylinderGeometry(r, r, len, seg, 1).rotateX(Math.PI / 2);
  mb.add(cyl(0.012, muzzleZ - shrZ1 + 0.02), mMetal, K.mat4([0, boreY, (shrZ1 + muzzleZ) / 2 - 0.01]));
  mb.add(cyl(0.015, 0.012), mMetal, K.mat4([0, boreY, shrZ1 + 0.01]));         // barrel nut
  mb.add(K.roundedBox(0.032, 0.03, 0.06, 0.006, 2), mMetal, K.mat4([0, boreY, muzzleZ - 0.03]));   // boxy brake
  for (const s of [-1, 1]) for (let i = 0; i < 3; i++) mb.add(K.roundedBox(0.004, 0.018, 0.01, 0.0015, 1), mPoly, K.mat4([s * 0.0155, boreY, muzzleZ - 0.046 + i * 0.016]));
  for (let i = 0; i < 2; i++) mb.add(K.roundedBox(0.016, 0.004, 0.01, 0.0015, 1), mPoly, K.mat4([0, boreY + 0.0145, muzzleZ - 0.038 + i * 0.018]));
  mb.add(K.roundedBox(0.016, 0.016, 0.004, 0.002, 1), mPoly, K.mat4([0, boreY, muzzleZ + 0.0005]));       // bore face
  mb.add(K.roundedBox(0.034, 0.004, 0.04, 0.0015, 1), mAccent, K.mat4([0, boreY - 0.015, muzzleZ - 0.03])); // accent band

  // angled foregrip under the shroud (raked forward), with accent toe
  mb.add(K.roundedBox(0.026, 0.07, 0.03, 0.009, 2), mPoly, K.mat4([0, boreY - 0.075, 0.405], [-0.35, 0, 0]));
  mb.add(K.roundedBox(0.03, 0.01, 0.036, 0.004, 2), mAccent, K.mat4([0, boreY - 0.108, 0.418], [-0.35, 0, 0]));
  mb.add(cyl(0.011, 0.012, 16), mGlow, K.mat4([0, boreY - 0.052, shrZ1 - 0.03]));            // flash-light lens under the chin
  mb.add(K.roundedBox(0.028, 0.024, 0.05, 0.005, 2), mMetal, K.mat4([0, boreY - 0.052, shrZ1 - 0.06]));

  // ===== top rail with teeth (receiver -> shroud)
  const railZ0 = -0.04, railZ1 = 0.46;
  mb.add(K.roundedBox(0.024, 0.008, railZ1 - railZ0, 0.002, 1), mMetal, K.mat4([0, recTop + 0.003, (railZ0 + railZ1) / 2]));
  for (let z = railZ0 + 0.008; z < railZ1 - 0.004; z += 0.01) mb.add(K.roundedBox(0.026, 0.005, 0.005, 0.001, 1), mMetal, K.mat4([0, railTop - 0.003, z]));

  // ===== stock: skeletal, upper beam + lower strut + butt plate
  mb.add(K.loft([
    sec(recZ0 + 0.01, 0.042, 0.016, 0.016, recTop - 0.022, 5),
    sec(-0.2, 0.04, 0.014, 0.014, recTop - 0.018, 5),
    sec(-0.27, 0.042, 0.016, 0.016, recTop - 0.018, 5),
  ]), mBody);
  mb.add(K.loft([
    sec(recZ0 + 0.01, 0.034, 0.012, 0.012, recBot + 0.02, 5),
    sec(-0.27, 0.034, 0.012, 0.012, recBot - 0.045, 5),
  ]), mBody);
  // power cell: glowing core between the stock struts, metal end caps and cage bars
  const cellZ0 = -0.215, cellZ1 = -0.1, cellY = recTop - 0.06;
  mb.add(cyl(0.012, cellZ1 - cellZ0, 16), mGlow, K.mat4([0, cellY, (cellZ0 + cellZ1) / 2]));
  for (const z of [cellZ0, cellZ1]) mb.add(cyl(0.016, 0.014, 16), mMetal, K.mat4([0, cellY, z]));
  for (const a of [0.6, 2.2, 3.8, 5.3]) mb.add(K.roundedBox(0.003, 0.003, cellZ1 - cellZ0, 0.001, 1), mMetal, K.mat4([Math.cos(a) * 0.0135, cellY + Math.sin(a) * 0.0135, (cellZ0 + cellZ1) / 2]));
  mb.add(K.roundedBox(0.012, 0.03, 0.01, 0.003, 1), mMetal, K.mat4([0, cellY + 0.026, cellZ1]));   // hanger to upper beam
  mb.add(K.roundedBox(0.012, 0.03, 0.01, 0.003, 1), mMetal, K.mat4([0, cellY + 0.026, cellZ0]));
  // cheek riser accent
  mb.add(K.roundedBox(0.03, 0.01, 0.1, 0.004, 2), mAccent, K.mat4([0, recTop - 0.001, -0.2]));
  // butt plate (rubber)
  mb.add(K.roundedBox(0.046, 0.16, 0.025, 0.01, 3), mPoly, K.mat4([0, recBot + 0.02, -0.285], [-0.06, 0, 0]));

  // ===== pistol grip (raked back) + trigger guard + trigger
  // grip lofted top->bottom (local z = down the grip), front edge with finger bumps, then raked back
  const gripSecs = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10, bump = 0.003 * Math.max(0, Math.sin(t * Math.PI * 3 + 0.3)) * (t > 0.15 && t < 0.85 ? 1 : 0);
    gripSecs.push({ z: t * 0.13, ring: K.profileRing(20, { width: 0.03 + 0.002 * Math.sin(t * Math.PI), top: 0.019 + bump, bottom: 0.019, exp: 3 }) });
  }
  // local ring y -> world +z (front), local z -> world -y: rotate X by +90deg then rake by 0.3
  mb.add(K.loft(gripSecs), mPoly, K.mat4([0, 0.062, 0.004], [Math.PI / 2 + 0.3, 0, 0]));
  mb.add(K.roundedBox(0.034, 0.01, 0.046, 0.004, 2), mBody, K.mat4([0, -0.062, -0.034], [0.3, 0, 0])); // grip base cap
  // trigger guard: closed rounded bars (no open tube ends)
  mb.add(K.roundedBox(0.008, 0.006, 0.07, 0.002, 1), mBody, K.mat4([0, recBot - 0.034, 0.052]));
  mb.add(K.roundedBox(0.008, 0.034, 0.007, 0.002, 1), mBody, K.mat4([0, recBot - 0.017, 0.086]));
  // trigger: curved blade (lathe sliver)
  mb.add(K.roundedBox(0.005, 0.024, 0.006, 0.002, 1), mMetal, K.mat4([0, recBot - 0.012, 0.052], [-0.25, 0, 0]));

  // ===== magazine: curved forward, lofted along its length then rotated to hang down
  const magSecs = [];
  for (let i = 0; i <= 6; i++) { const t = i / 6; magSecs.push({ z: t * 0.15, y: t * t * 0.035, ring: K.superRing(16, 0.013, 0.03, 6) }); }
  const mag = K.loft(magSecs);
  mb.add(mag, mPoly, K.mat4([0, recBot - 0.02, 0.115], [Math.PI / 2, 0, 0]));
  mb.add(K.roundedBox(0.03, 0.012, 0.066, 0.004, 2), mAccent, K.mat4([0, recBot - 0.17, 0.115 + 0.035], [0.25, 0, 0])); // base plate

  // ===== optic: boxy housing on two mounts, lens bezels, glass, glow strip
  const opY = railTop + 0.034, opZ = 0.07;
  for (const z of [opZ - 0.035, opZ + 0.035]) mb.add(K.roundedBox(0.03, 0.02, 0.016, 0.003, 1), mMetal, K.mat4([0, railTop + 0.01, z]));
  mb.add(K.loft([
    sec(opZ - 0.07, 0.044, 0.022, 0.02, opY, 5),
    sec(opZ - 0.05, 0.046, 0.024, 0.022, opY, 5),
    sec(opZ + 0.05, 0.048, 0.026, 0.022, opY, 5),
    sec(opZ + 0.075, 0.054, 0.03, 0.026, opY, 5),
  ]), mBody);
  mb.add(K.loft([sec(opZ + 0.075, 0.054, 0.03, 0.026, opY, 5), sec(opZ + 0.1, 0.056, 0.033, 0.026, opY + 0.002, 5)], { caps: true }), mBody); // sunshade
  mb.add(K.lathe([[0, 0], [0.008, 0], [0.009, 0.003], [0.009, 0.008], [0.006, 0.01], [0, 0.01]], 6), mAccent, K.mat4([0.022, opY, opZ - 0.01], [0, 0, -Math.PI / 2])); // hex battery/turret knob
  const bezel = (r, z) => mb.add(K.lathe([[r * 0.7, 0], [r, 0], [r, 0.006], [r * 0.7, 0.006], [r * 0.7, 0.0]], 24), mMetal, K.mat4([0, opY, z], [Math.PI / 2, 0, 0]));
  bezel(0.018, opZ - 0.074); bezel(0.022, opZ + 0.098);
  const lens = (r, z) => mb.add(cyl(r, 0.003, 24), mGlass, K.mat4([0, opY, z]));
  lens(0.0135, opZ - 0.071); lens(0.0165, opZ + 0.09);
  for (const s of [-1, 1]) mb.add(K.roundedBox(0.002, 0.004, 0.08, 0.001, 1), mGlow, K.mat4([s * 0.0235, opY + 0.006, opZ]));

  // ===== SECONDARY: panel seams, accent plates, emissive strips on the receiver
  for (const s of [-1, 1]) {
    const x = s * (recW / 2 + 0.0004);
    for (const z of [0.02, 0.17]) mb.add(K.roundedBox(0.0015, 0.07, 0.0025, 0.0005, 1), mPoly, K.mat4([x, rc, z]));
    mb.add(K.roundedBox(0.0015, 0.0025, recZ1 - recZ0 - 0.06, 0.0005, 1), mPoly, K.mat4([x, rc + 0.022, (recZ0 + recZ1) / 2]));
    mb.add(K.roundedBox(0.003, 0.005, 0.12, 0.0015, 1), mGlow, K.mat4([s * (recW / 2 + 0.001), rc + 0.012, 0.09]));
    mb.add(K.roundedBox(0.004, 0.026, 0.05, 0.004, 2), mAccent, K.mat4([s * (recW / 2 + 0.001), rc - 0.018, 0.2]));   // side plate
    // raised armour plate over the rear receiver, with four bolt heads
    mb.add(K.roundedBox(0.004, 0.03, 0.07, 0.005, 2), mBody, K.mat4([s * (recW / 2 + 0.0015), rc - 0.008, -0.015]));
    for (const [dy, dz] of [[-0.02, -0.04], [0.004, -0.04], [-0.02, 0.01], [0.004, 0.01]]) mb.add(cyl(0.0022, 0.004, 6).rotateY(Math.PI / 2), mMetal, K.mat4([s * (recW / 2 + 0.0035), rc + dy + 0.002, dz + 0.0]));
    mb.add(K.roundedBox(0.008, 0.012, 0.03, 0.003, 2), mMetal, K.mat4([s * (recW / 2 + 0.003), rc + 0.002, -0.02])); // selector / bolt release
  }
  // ejection port + dust cover hinge (right side)
  mb.add(K.roundedBox(0.003, 0.018, 0.055, 0.003, 1), mPoly, K.mat4([recW / 2 + 0.0006, rc + 0.012, 0.11]));
  mb.add(K.roundedBox(0.004, 0.003, 0.06, 0.001, 1), mMetal, K.mat4([recW / 2 + 0.0015, rc - 0.0015, 0.11]));
  // lower receiver shell (two-tone split) around the trigger group
  mb.add(K.roundedBox(recW + 0.004, 0.026, 0.2, 0.006, 2), mBody, K.mat4([0, recBot + 0.008, 0.08]));
  // charging handle (right side only — breaks symmetry)
  mb.add(K.roundedBox(0.024, 0.012, 0.018, 0.004, 2), mMetal, K.mat4([recW / 2 + 0.01, recTop - 0.018, 0.2]));

  const g = mb.build({ name: 'rifle' });
  // tubes are open-ended by construction
  g.traverse((o) => { if (o.isMesh && o.material === mGlass) o.geometry.userData.open = true; });
  g.userData.sockets = { grip: [0, 0, 0], muzzle: [0, boreY, muzzleZ], offHand: [0, boreY - 0.075, 0.405], sight: [0, opY, opZ - 0.18] };
  if (reviewYaw) g.rotation.y = reviewYaw;          // review-only: turn the side towards the detail camera
  if (reviewScale !== 1) g.scale.setScalar(reviewScale); // review-only magnification (tiny props vs 1.75 m figure)
  return K.finish(g, { kind: 'weapon' });
}
