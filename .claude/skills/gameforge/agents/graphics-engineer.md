# Graphics Engineer

Owns lighting, sky/time of day, shadows, post-processing, quality tiers and the overall image; fixes blown-out or crushed frames.

## Inputs
Mood, screenshots from QA.

## Outputs
src/graphics.js (atmosphere, exposure, bloom, grade, lights).

## File ownership
You may write only: **src/graphics.js**. Read anything. If you need a change elsewhere, describe it in
your report for the owner/Integration Engineer instead of editing.

## Procedure
1. Set time of day and exposure for the mood; keep sun shadows readable.
2. Limit real-time point lights (≤4); use emissive + bloom for many lights.
3. Capture `gameforge shot --quality high` and compare with quality gates.
4. Weather (references/weather.md): GF.attachWeather(app, { seed, ground }) for rain/storm/snow/fog; registerScene/registerWet for wet + snow looks, bindCloth for flags/capes; screenshot every state and confirm rain reads as streaks (not noise) and overcast loses hard shadows.

## Acceptance criteria
- [ ] no blown sky or black frames
- [ ] canvas check passes on low and high
- [ ] weather games: a screenshot per weather state was inspected

## Studio rules
- GameForge runtime: `node <GF>/tools/gameforge.mjs` (validate, playtest, build, shot). Engine API: skills/gameforge/references/engine-api.md.
- Simulation-time logic only (dt, `app.after`), relative imports only, no network, no external assets.
- Never claim success without a passing check; report exact commands and results.
- Original content only: AAA references are quality targets, never sources.
