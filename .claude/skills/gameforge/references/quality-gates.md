# Quality gates

A game is **done** only when all gates pass. A failing gate is either fixed or written down in
the project README under *Known issues* with the reason.

## Functional (automated, blocking)
- `gameforge validate` → no ERR lines (no network refs, import graph bundles, valid assets/tasks)
- `playtest` → 100 % of checks pass on the source build **and** the `dist/` single file
- zero runtime console errors
- every GDD mechanic covered by an `expect` step

## Visual (review the PNGs yourself; do not judge from code)
Score 0–3 each, premium requires no 0/1 and average ≥ 2:
1. **Readability** — player, enemies, interactables pop from the background (value contrast)
2. **Lighting** — sun direction + shadows visible, no blown-out sky or crushed blacks
3. **Material variety** — at least 4 distinct PBR surfaces in a gameplay frame
4. **Composition** — camera framing shows the player and the objective; HUD does not cover it
5. **World density** — no empty plains: vegetation, props, landmarks at every distance band
6. **Character quality** — proportions, clothing colours, idle/locomotion animation playing
7. **Atmosphere** — fog/sky/time-of-day coherent with the mood
8. **UI** — consistent theme, legible at 1280×720, objective always visible
Unrefined primitives (a cube as a character, flat-colour plane as the ground) fail gate 3/5/6.

## Feel
- input → visible response within one frame; camera never clips into walls
- hits have feedback: hit-stop, shake, particles, sound, damage numbers
- difficulty: first encounter winnable without upgrades; boss telegraphs heavy attacks

## Performance (measure; software WebGL numbers are not representative)
- record `metrics` (draw calls, triangles) on `low` and `high`
- budgets on `high`: < 300 draw calls, < 1.5 M triangles; merge static geometry (`mergeByMaterial`), instance vegetation (`populate`), limit real-time lights (≤ 4 point lights)

## Honesty
- Capabilities are reported as IMPLEMENTED (passing check), EXPERIMENTAL (runs, unverified) or UNSUPPORTED
- Never fabricate screenshots, fps, test results or links
- AAA titles are aspirations; state the gap concretely (asset fidelity, animation, scale, content hours)
