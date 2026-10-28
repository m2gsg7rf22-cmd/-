// Brief: one footstep on gravel. A soft low heel thud followed 25 ms later by a crunchy cluster of
// many tiny grain clicks (band-passed noise micro-bursts 2–6 kHz with random timing and level).
export default {
  duration: 0.4,
  recipe(e, t, d, p) {
    e._osc('sine', 75 * p, t, 0.07, d, { gain: 0.3, slide: 45 });
    e._noiseBurst(t, 0.05, d, { gain: 0.18, type: 'lowpass', freq: 500 });
    for (let i = 0; i < 18; i++) { const dt = 0.025 + Math.random() * 0.11; e._noiseBurst(t + dt, 0.012 + Math.random() * 0.015, d, { gain: 0.05 + Math.random() * 0.09, freq: (2000 + Math.random() * 4000) * p, q: 3 }); }
  },
};
