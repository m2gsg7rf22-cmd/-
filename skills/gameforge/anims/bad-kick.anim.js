// Deliberately broken example used by tests: backward knee, ground penetration, popping loop.
export default { duration: 1, loop: true, pose: (p) => ({ lowerLeg_R: [-60, 0, 0], hipsY: -0.2, upperArm_L: [p * 170, 0, 0] }) };
