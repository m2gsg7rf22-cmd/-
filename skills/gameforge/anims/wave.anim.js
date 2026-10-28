// Example: a friendly one-handed wave (loop). Brief: weight on both feet, right arm raised to the
// side with the elbow bent ~90°, forearm swinging ±25° around the elbow, slight head tilt and smile timing.
export default ({ S, relaxed }) => ({
  duration: 1.6, loop: true,
  pose: (p) => relaxed({
    upperArm_R: [-20, 0, -95],            // raise sideways (right arm: negative z = abduction)
    lowerArm_R: [-70 + 25 * S(p * 2), 0, 0],  // elbow flexion + wave (two waves per loop)
    hand_R: [0, 0, 10 * S(p * 2 + 0.1)],
    chest: [0, 0, 2 * S(p)], head: [-3, 0, -4 + 2 * S(p)],
    upperArm_L: [0, 0, 4], hipsY: -0.005,
  }),
});
