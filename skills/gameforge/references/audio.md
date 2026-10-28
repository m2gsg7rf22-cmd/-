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

All times are seconds. `t` is the start time (use the `t` you receive plus offsets), and `d` is
the destination node.

| Voice | Use for | Notes |
|---|---|---|
| `_osc(type, freq, t, dur, d, { gain = 0.3, a = 0.005, slide, detune })` | tones, thumps (sine with a downward slide), buzzes (`sawtooth`/`square`/`triangle`) | Envelope: linear attack `a`, then an exponential decay to silence over `dur`. `slide` is the **target frequency in Hz**, reached at `t + dur` |
| `_noiseBurst(t, dur, d, { gain = 0.4, type = 'bandpass', freq = 1000, q = 1, slide, a = 0.003 })` | whooshes, cracks, wind, impacts, footsteps, fire, rain (many tiny bursts) | Same envelope. `slide` sweeps the filter frequency (Hz) |
| `_fm(freq, ratio, index, t, dur, d, { gain = 0.3, a = 0.003, indexDecay = 0.5, type = 'sine', slide })` | metal, bells (non-integer `ratio`), lasers, growls, alarms | `index` is the modulation depth in Hz and decays to `index·indexDecay` (bright attack, mellow tail) |
| `_pluck(freq, t, dur, d, { gain = 0.4, damping = 0.996, brightness = 0.5 })` | strings, harps, plinks, bowstrings | Usable **40–1500 Hz**; above that the integer period quantises into noise, so use `_fm` or `_osc` for high tones. `damping` 0.98–0.999 sets the length; `brightness` 0..1 |

**Insert effects.** Each returns a node you pass as `d` to voices; it routes into its own `dest`:

| Effect | What it does |
|---|---|
| `e.saturate(dest, drive = 4)` | tanh soft clip, level-compensated. Use it for explosions, engines, gritty impacts, growls |
| `e.delay(dest, time = 0.25, feedback = 0.35, mix = 0.35)` | echo for canyons, tunnels, sci-fi and magic |
| `e.filter(dest, type, freq, q, { t, to, dur, gain })` | static or swept filter (`lowpass`, `highpass`, `bandpass`, `peaking`…) |
| `e.ctx` | any raw WebAudio node |

Effects chain. For example, a saturated, low-passed boom:

```js
const fx = e.saturate(e.filter(d, 'lowpass', 900), 6);
e._osc('sine', 60 * p, t, 0.8, fx, { gain: 0.5, slide: 28 });
```

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

Typical spectral centroids (whole file). For layered sounds also read the per-segment centroids
(transient 0–50 ms, body 50–300 ms, tail) and the band-energy split. A quiet bright click can
dominate the whole-file centroid while the energy is in the lows.

| Sound | Centroid |
|---|---|
| Footsteps (soft) | 1–3 kHz |
| Gravel | 4–6 kHz |
| Explosions | below 1.5 kHz |
| Lasers / UI clicks | 3–8 kHz |
| Engines | below 800 Hz |
| Car door / heavy mechanical foley | body 100–400 Hz, latch transient 2–4 kHz |
| Magic chimes / pickups | 2–5 kHz, with clear tonal peaks |
| Debris tails | 1–3 kHz scattered bursts |

Peak targets by role:

| Role | Peak |
|---|---|
| UI, chimes, pickups | −12 to −18 dBFS |
| Footsteps | −14 to −20 dBFS |
| Hits, doors | −6 to −10 dBFS |
| Explosions | −3 to −6 dBFS |

The −3 dBFS headroom warning is advisory for the loudest category only.

## Reading the sheet and metrics

- **Seeds:** renders are deterministic per `--seed` (default 1), because `Math.random()` is
  seeded during the recipe. Try 2–3 seeds for sounds with random clusters.
- **Spectrogram:** log frequency from 40 Hz to 16 kHz. Colour runs from 0 dB (bright) to
  −80 dB (dark); see the colour bar. Faint vertical stripes at a sharp onset are window leakage
  (2048-sample FFT), not clicks; `clickCount` detects real discontinuities. A faint
  low-frequency floor across the whole render is the analysis noise floor.
- **Zoom panel:** the first 120 ms, for transients and multi-stage events (latches, double hits)
  that sit under 20 ms apart.
- **`spectralPeaksHz`:** use it to confirm pitches, e.g. arpeggio notes or engine harmonics.
- **Examples:** `skills/gameforge/sounds/` contains `car-door`, `explosion` (saturation + debris
  tail), `heal-chime` (tonal arpeggio + sparkles), `laser-blaster` and `footstep-gravel`.

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
