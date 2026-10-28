// Brief: shambling zombie walk loop, 1.6 s, in place.
// Left = good leg: long stance (p 0 -> 0.72), quick lurching swing.
// Right = injured leg: stiff knee, toes pointed down and SCRAPING the floor while it is dragged
// forward slowly (p 0.02 -> 0.58) with a hip hike; short, flat-footed stance (p 0.6 -> 1).
// Contacts: L heel strike p=0, R flat contact p=0.6. Weight sits over the left leg most of the
// cycle (limp) and drops onto the right with a buckle at p~0.65. Torso slumped and twisting,
// head lolls with lag; right arm reaches forward, left arm hangs and swings dead.
export default ({ S, C, ease, seg, bell }) => {
  // periodic keyframe interpolation (smoothstep between keys, wraps at 1)
  const keys = (k) => (p) => {
    p = ((p % 1) + 1) % 1;
    const ks = [...k, [k[0][0] + 1, k[0][1]]];
    for (let i = 0; i < ks.length - 1; i++) {
      const [a, va] = ks[i], [b, vb] = ks[i + 1];
      if (p >= a && p <= b) return va + (vb - va) * ease((p - a) / (b - a));
    }
    return k[0][1];
  };
  const wrap = (p) => ((p % 1) + 1) % 1;
  // NOTE: foot keys below are authored as + = toes UP; measured on the rig foot_L/R + = toes DOWN, so they are negated on output.
  // ---- legs (key poses: contact L 0, down 0.12, passing 0.35, contact R 0.6, buckle 0.66, L swing 0.85)
  const thighL = keys([[0, -24], [0.3, -6], [0.6, 10], [0.72, 15], [0.84, -18], [0.93, -28]]);
  const kneeL  = keys([[0, 4], [0.12, 16], [0.4, 6], [0.62, 12], [0.74, 40], [0.84, 60], [0.95, 14]]);
  const footL  = keys([[0, 12], [0.1, 0], [0.3, 6], [0.58, 16], [0.72, -2], [0.84, 6], [0.95, 12]]); // flat-footed shuffle, low heel rise
  const thighR = keys([[0, 16], [0.3, 4], [0.55, -12], [0.62, -13], [0.82, 3]]);
  const kneeRmin = keys([[0, 8], [0.3, 6], [0.55, 6], [0.67, 26], [0.8, 14], [0.92, 9]]); // buckle on contact
  const footR  = keys([[0, 6], [0.3, -26], [0.52, -12], [0.62, 0], [0.85, 4]]);
  // ---- simple sagittal FK (metres) so the lowest point of the feet stays on the floor
  const T = 0.43, SH = 0.43, ANK = 0.08, TOE = 0.15, HEEL = 0.05, D = Math.PI / 180;
  const lowest = (thigh, knee, foot) => {        // height of the lowest foot point below the hip
    const f = -thigh * D, g = f - knee * D, up = (foot) * D + g;
    const ank = T * Math.cos(f) + SH * Math.cos(g);
    const toe = -TOE * Math.sin(up) + ANK * Math.cos(up), heel = HEEL * Math.sin(up) + ANK * Math.cos(up);
    return ank + Math.max(toe, heel);
  };
  const REST = T + SH + ANK;
  return {
    duration: 1.6, loop: true, groundFeet: true,
    // footfalls for audio/FX: good-leg heel strike, toe scrape start, bad-leg flat slap
    events: [{ t: 0.0, name: 'footL' }, { t: 0.1, name: 'scrapeR' }, { t: 0.6, name: 'footR' }],
    pose: (p) => {
      const tl = thighL(p) - 4, kl = kneeL(p) + 8, fl = footL(p) - 4;   // crouched good leg
      const tr = thighR(p), fr = footR(p);
      const stanceL = lowest(tl, kl, fl);
      // drag: hold the right foot at a fixed world pitch (toes pointing down, dorsum dragging) and
      // bend the knee just enough that the toe scrapes the floor. Blended in/out smoothly.
      const dragW = Math.min(seg(p, 0, 0.14), 1 - seg(p, 0.54, 0.64));
      const km = kneeRmin(p), toeWorld = keys([[0, -20], [0.12, -38], [0.34, -36], [0.56, -6], [0.8, -10]])(p); // world toes-up pitch
      const solve = (k) => lowest(tr, k, toeWorld + tr + k);
      let hi = km;
      if (solve(km) > stanceL - 0.004) { let lo = km; hi = 75; for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (solve(m) > stanceL - 0.004) lo = m; else hi = m; } }
      const kr = km + dragW * (hi - km);
      const frU = fr + dragW * (toeWorld + tr + kr - fr);
      const ground = Math.max(stanceL, lowest(tr, kr, frU));
      const buckle = bell(p, 0.6, 0.67, 0.82);          // weight crashes onto the bad leg
      const hipsY = ground - REST - 0.006 * buckle;
      const wL = keys([[0, 0.3], [0.15, 1], [0.55, 1], [0.68, -0.2], [0.8, -1], [0.95, -0.4]])(p); // +1 = over left foot
      const hike = bell(p, 0.05, 0.3, 0.55);
      const lag = (o) => wrap(p - o);
      return {
        hipsY, hipsX: 0.05 * wL,
        hips: [0, 5 * S(p + 0.08), -4 * hike + 2 * wL],
        spine: [16, -2 * S(p + 0.1), 1.5 * wL],
        chest: [12 + 5 * buckle, -3 * S(p + 0.14), 2 * wL + 2 * buckle],
        neck: [-8, 4 * S(lag(0.18)), 0],
        head: [10 + 10 * bell(lag(0.06), 0.55, 0.72, 0.98), 9 * S(lag(0.22)), 12 + 10 * S(lag(0.24))],
        upperLeg_L: [tl, 0, 3], lowerLeg_L: [kl, 0, 0], foot_L: [-fl, 0, 0],
        upperLeg_R: [tr, 12, -3 - 4 * hike], lowerLeg_R: [kr, 0, 0], foot_R: [-frU, 0, 0],
        shoulder_R: [8, 0, 5], shoulder_L: [-3, 0, -4],
        upperArm_R: [-80 + 7 * S(lag(0.15)), 0, 14 + 3 * C(lag(0.15))], lowerArm_R: [-18 - 8 * S(lag(0.25)), 0, 0], hand_R: [28 + 6 * S(lag(0.3)), 0, 0],
        upperArm_L: [-4 - 12 * S(lag(0.62)), 0, 2], lowerArm_L: [-12 - 6 * S(lag(0.7)), 0, 0], hand_L: [12, 0, 0],
      };
    },
  };
};
