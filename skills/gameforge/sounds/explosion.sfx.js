// Brief: large explosion at ~50 m, outdoors. Broadband crack (short), a huge low boom 60→28 Hz
// (~1.2 s) pushed through soft saturation for weight, a lowpassed rolling roar closing 900→120 Hz
// (~1.8 s), a long low rumble, then debris (rocks/metal bits) pattering down 0.25-2.6 s, sparser and quieter.
export default {
  duration: 3.5, reverb: 0.3,
  brief: 'large explosion: crack + saturated low boom + roar + debris tail; centroid < 1.5 kHz',
  recipe(e, t, d, p) {
    const sh = e.ctx.createWaveShaper();
    const c = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = i / 511.5 - 1; c[i] = Math.tanh(2.5 * x) / Math.tanh(2.5); }
    sh.curve = c; sh.connect(d);
    e._noiseBurst(t, 0.025, d, { gain: 0.25, type: 'bandpass', freq: 1800, q: 0.7 });
    e._osc('sine', 60 * p, t, 1.2, sh, { gain: 0.25, slide: 28 });
    e._noiseBurst(t, 1.8, sh, { gain: 0.27, type: 'lowpass', freq: 900, slide: 120 });
    e._noiseBurst(t + 0.05, 3.0, d, { gain: 0.3, type: 'lowpass', freq: 200, slide: 90 });
    for (let i = 0; i < 60; i++) {
      const dt = 0.25 + Math.pow(Math.random(), 1.5) * 2.35;
      const g = 0.22 * Math.pow(1 - (dt - 0.25) / 2.5, 1.2) * (0.4 + Math.random() * 0.6);
      e._noiseBurst(t + dt, 0.008 + Math.random() * 0.025, d, { gain: g, type: 'bandpass', freq: (500 + Math.random() * 2500) * p, q: 5 });
    }
  },
};
