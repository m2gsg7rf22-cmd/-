# Authoring sound effects and music

All audio is synthesized at runtime with WebAudio: no sample files and no services. You design
a sound as a **recipe script**, render it offline, and judge it **visually and numerically**.
You cannot hear it, so the brief and the analysis sheet are your ears.

```js
// sounds/door-creak.sfx.js
export default {
  duration: 1.2,             // render length (s); must include the full decay
  reverb: 0.1,               // 0..1 send to a generated room
  brief: 'old wooden door creak: slow rising stick-slip squeal 300→700 Hz with irregular pulses',
  recipe(e, t, d, p) {       // e = engine voices, t = start time, d = destination, p = pitch multiplier
    for (let i = 0; i < 14; i++) e._fm(300 * p * (1 + i * 0.06), 2.01, 120, t + i * 0.06 + Math.random() * 0.02, 0.07, d, { gain: 0.12 });
  },
};
```

To review a recipe:

```bash
node $GF/tools/gameforge.mjs sound sounds/door-creak.sfx.js
```

The command writes `review/<name>.sound.png` (waveform, log spectrogram from 40 Hz to 16 kHz,
and the dB envelope) and `<name>.wav`, and runs the checks below. **Open the PNG.**

To register the sound in a game: `import { defineSfx } from './engine/audio/audio.js'`, then
`defineSfx('doorCreak', def.recipe)` and `app.audio.play('doorCreak', { pos })`. The engine adds
3D panning, distance falloff and buses.

## Voices (on `e`)

| Voice | Use for |
|---|---|
| `_osc(type, freq, t, dur, d, { gain, a, slide, detune })` | Tones, thumps (sine plus a downward `slide`), buzzes (`sawtooth`/`square`) |
| `_noiseBurst(t, dur, d, { gain, type: 'bandpass'/'lowpass'/'highpass', freq, q, slide })` | Whooshes, cracks, wind, impacts, footsteps, fire, rain (many tiny bursts) |
| `_fm(freq, ratio, index, t, dur, d, { gain, indexDecay, type, slide })` | Metal, bells (non-integer `ratio`), lasers, growls, alarms |
| `_pluck(freq, t, dur, d, { gain, damping, brightness })` | Strings, harps, plinks, bowstrings, twangs |
| `e.ctx` | Any raw WebAudio node: BiquadFilter, WaveShaper (distortion), Convolver, DelayNode (echo), oscillators with periodic waves |

## The method (how a sound designer works)

1. **Brief.** Describe the real sound physically: the source, the material, the size, and the
   action (hit, scrape, roll), plus its distance and space.
2. **Decompose into layers** in time:
   - **Transient** (0–30 ms): click, crack or noise burst; this is what sells the impact.
   - **Body** (30–300 ms): the pitched resonance or filtered noise that identifies the material
     and size. Larger objects are lower and longer.
   - **Tail:** the decay, the debris, and the room.
3. **Map physics to parameters:**
   - **Size:** lower frequency, longer decay.
   - **Hardness:** brighter (higher `freq`/centroid) and shorter attack.
   - **Metal:** inharmonic partials (FM ratio 1.4–3.5, or several `_osc` at ratios 1 : 2.76 : 5.4).
   - **Wood:** short, mid-heavy band-pass noise around 500–1500 Hz.
   - **Organic or voice:** saw plus a formant band-pass.
   - **Distance:** less high end and more reverb.
4. **Vary.** Never play the identical sound twice in a row. Use the `p` pitch argument (the
   engine randomises ±8%) and `Math.random()` inside clusters.
5. **Review loop.** Render, open the sheet, and compare it with the brief:
   - Is the transient visible?
   - Is the body in the expected band? Check the spectral centroid.
   - Does it decay before the end of the render?
   - Is the loudness right for its role?

   Iterate (at most 5 rounds).

## Checks and targets

| Check | Target |
|---|---|
| Peak | between −3 and −30 dBFS, with no clipping. UI and footsteps around −12 to −18; hits and explosions −3 to −6 |
| DC offset | below 0.01 |
| Tail | the tail must decay inside `duration`. A cut-off tail clicks |
| SFX onset | under 50 ms. Slow swells are fine for ambience or music, where the warning is OK |

Typical spectral centroids:

| Sound | Centroid |
|---|---|
| Footsteps (soft) | 1–3 kHz |
| Gravel | 4–6 kHz |
| Explosions | below 1.5 kHz |
| Lasers / UI clicks | 3–8 kHz |
| Engines | below 800 Hz |

## Music

`app.audio.playMusic(mood, { intensity })` runs the adaptive step sequencer over the moods in
`MOODS` (`engine/audio/audio.js`): exploration, combat, mystery, driving, victory, tension, calm.
To add a mood, add an entry with its scale, tempo, progression and instrument choices, following
the existing ones. Musical sounds can be rendered through `gameforge sound` the same way, with a
recipe that schedules notes.

## Honest limits

- **Synthesis, not recordings:** foley realism is limited, especially for voices, crowds and
  complex mechanical sounds.
- **No voice acting.** Dialogue uses babble blips, or the browser's Web Speech API where
  available.
- **Not listened to:** the review measures and visualises the sound, but no one listens to it.
  Flag sounds as "not listened to by a human" in reports.
