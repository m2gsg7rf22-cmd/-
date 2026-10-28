// Brief: sci-fi blaster shot. Layers: (1) bright FM "zap" sweeping 2.4 kHz → 300 Hz in 0.18 s,
// (2) short noise transient for the muzzle crack, (3) low sine thump for weight. Total < 0.5 s.
export default {
  duration: 0.6, reverb: 0.15,
  recipe(e, t, d, p) {
    e._fm(2400 * p, 1.5, 900, t, 0.18, d, { gain: 0.22, slide: 300 * p, indexDecay: 0.1, type: 'sawtooth' });
    e._noiseBurst(t, 0.04, d, { gain: 0.35, type: 'highpass', freq: 3000 });
    e._osc('sine', 120 * p, t, 0.12, d, { gain: 0.35, slide: 45 });
  },
};
