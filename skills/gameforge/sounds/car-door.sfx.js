// Brief: heavy steel car door slammed shut, close-mic, garage. Deep damped panel thunk (~90 Hz
// falling, rubber seals damp it in ~150 ms) with a boxy door-shell body (~200-350 Hz); ~25 ms in, the
// latch catches: a sharp, short metallic click (inharmonic, 2-5 kHz) in two stages. No ringing, tiny room.
export default {
  duration: 0.5, reverb: 0.05,
  brief: 'heavy car door close: low damped thunk 90 Hz + latch click at 25 ms',
  recipe(e, t, d, p) {
    // body: thunk
    e._osc('sine', 85 * p, t, 0.2, d, { gain: 0.55, slide: 45 });
    e._osc('triangle', 170 * p, t, 0.06, d, { gain: 0.15, slide: 110 });
    e._noiseBurst(t, 0.07, d, { gain: 0.35, type: 'lowpass', freq: 350 });
    e._noiseBurst(t, 0.1, d, { gain: 0.3, type: 'bandpass', freq: 240 * p, q: 2 });
    e._noiseBurst(t, 0.006, d, { gain: 0.2, type: 'bandpass', freq: 900, q: 1 }); // contact smack (rubber+steel)
    // transient: latch, two stages
    const l = t + 0.025;
    e._fm(3100 * p, 1.73, 1500, l, 0.025, d, { gain: 0.035, indexDecay: 0.01 });
    e._noiseBurst(l, 0.006, d, { gain: 0.12, type: 'bandpass', freq: 3600 * p, q: 3 });
    e._noiseBurst(l + 0.018, 0.005, d, { gain: 0.08, type: 'bandpass', freq: 2800 * p, q: 3 });
    e._fm(2500 * p, 2.41, 900, l + 0.018, 0.02, d, { gain: 0.035, indexDecay: 0.01 });
  },
};
