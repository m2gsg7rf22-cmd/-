// Brief: magical heal spell. Warm, benevolent: a rising major arpeggio of glassy bell tones
// (C6 E6 G6 C7, 70 ms apart) over a soft sine pad sliding up an octave, sprinkled with tiny
// high sparkles (5-9 kHz) that drift upward in time and thin out, in a large bright reverb.
export default {
  duration: 2.2, reverb: 0.4,
  brief: 'healing chime: rising major arpeggio bells + sparkles + rising pad',
  recipe(e, t, d, p) {
    const notes = [1046.5, 1318.5, 1568, 2093];
    notes.forEach((f, i) => e._fm(f * p, 2, 150, t + i * 0.07, 0.6, d, { gain: 0.12, indexDecay: 0.2, a: 0.004 }));
    notes.forEach((f, i) => e._osc('sine', f * 2 * p, t + i * 0.07 + 0.01, 0.45, d, { gain: 0.04, a: 0.006 }));
    e._osc('sine', 523 * p, t, 0.9, d, { gain: 0.1, a: 0.05, slide: 1046 * p });
    for (let i = 0; i < 22; i++) {
      const dt = 0.05 + Math.pow(Math.random(), 1.3) * 0.9;
      e._osc('sine', (4500 + dt * 3500 + Math.random() * 1500) * p, t + dt, 0.08 + Math.random() * 0.08, d, { gain: 0.025 + Math.random() * 0.03, a: 0.008 });
    }
  },
};
