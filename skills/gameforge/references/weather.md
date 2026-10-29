# Weather

Module: `engine/render/weather.js`, exported from `engine/index.js`.

- Unit tests: `tests/unit/weather.test.mjs`.
- Visual + integration checks: `tests/scenes/survival/` (clear → rain → storm with lightning → snow, with screenshots).

## 1. What it drives

| Output | How |
|---|---|
| Sky | Procedural cloud dome (fbm shader, follows the camera, coverage + darkness + wind drift, horizon blended into the fog colour) and Sky turbidity/rayleigh |
| Lighting | Sun intensity × `sun`; hemisphere fill + IBL adjusted for overcast; tone-mapping exposure × `exposure`; lightning flash boosts hemi/IBL/exposure for about 0.5 s with a double flicker |
| Fog | `FogExp2` density × `fog`. Colour pulled toward a daylight-scaled grey (and snow white) |
| Wind | `weather.wind` (Vector3, m/s; veering direction + coherent gusts) → `SHARED_UNIFORMS.uWind` (all `applyWind` foliage and grass) and every `bindCloth(cloth)` (`Cloth.wind`, `gust`) |
| Precipitation | `Precipitation` layers. Rain uses velocity-aligned streaks; snow uses round flakes with wobble. Both are instanced quads whose positions are computed in the vertex shader (seed + time, wrapped in a world-anchored box around the camera), so the CPU does no work per drop. The instance count follows intensity. Default budget per quality tier: low 3.5k/2.5k, medium 8k/5k, high 14k/8k (rain/snow) |
| Splashes | Optional CPU `vfx.emit('splash')` around the camera on `ground` (Heightfield or fn), about 60/s at full rain |
| Lightning + thunder | Seeded Poisson strikes (thinned during transitions), a jagged tube bolt with an additive glow, and a `thunder` SFX (synth: crack + rumble + sub) played after `distance / 343` s, louder when close |
| Surfaces | `wetness` (soaks in ~15 s of rain, dries in ~2 min) and `snowCover` (builds below 2 °C, melts above 1 °C) → terrain through `SHARED_UNIFORMS.uWet/uSnowCover` (darker, glossier when wet; flat ground whitens under snow) and any `MeshStandardMaterial` via `registerWet(mat, { darken, roughness, snow })` / `registerScene(root, { filter })` |
| Audio beds | `audio.ambience('rain')` and `('wind')` levels follow rain and wind once audio is unlocked |
| Gameplay | `temperature` (climate day curve + state offset), `windSpeed`, `rainIntensity`, `snowIntensity`, `shouldShelter`; events `weather:change {from,to}`, `weather:lightning {position, distance, delay}`, `weather:thunder`, `weather:shelter {needed}` |

## 2. API

| API | Notes |
|---|---|
| `GF.attachWeather(app, opts)` / `new GF.Weather({ app, ...opts })` | opts: `seed`, `state`, `auto` (follow forecast), `durations [min,max]` s, `transition` s, `transitions` (Markov weights), `states` (override or add states), `climate { mean, amplitude, peakHour }`, `particles { rain, snow, radius, height }`, `ground`, `splashes`, `fogScale`, `windScale`, `hour: () => h` (without an Atmosphere) |
| `.set(state, { transition, keepAuto })` | `clear cloudy rain storm snow fog`. Smoothstep blend of every parameter. A manual set pauses the forecast |
| `.forecast(n)` → `[{ state, start, duration, transition }]` · `.startForecast()` | deterministic per seed, step-size independent |
| `.update(dt)` | called by `attachWeather` |
| `.strike({ distance, angle })` | force a lightning strike (cutscenes, tests) |
| `.registerWet(mat, o)` · `.registerScene(root, { filter })` · `.bindCloth(cloth)` | surfaces and cloth |
| `.debug()` · `.toJSON()` / `.load()` | HUD/test state; save (also via `attachSurvivalSave`) |
| `GF.WEATHER_STATES`, `GF.WEATHER_TRANSITIONS`, `GF.Precipitation` | data + building block |

## 3. Art direction method

1. **Pick the mood per state, then tune the numbers in `states`.** For each state set:
   - **cloud**: coverage;
   - **dark**: underside darkness;
   - **sun**: direct light factor;
   - **fog**: density multiplier;
   - **exposure**.

   Overcast scenes must lose hard shadows (`sun` ≤ 0.3) and gain soft fill (hemi rises with
   cloud), otherwise rain looks like a sunny day with lines on it.
2. **Rain must read as rain.** Streaks need three things:
   - they are oriented by velocity (gravity + wind);
   - they are 0.5-1 m long and 1-2 px wide at 10 m;
   - their alpha is about 0.5 against a darkened sky.

   Density comes from count / volume (default radius 18 m, height 14 m). Check a screenshot:
   with too few drops it looks like scratches, and with drops too wide it looks like snow.
   Wet ground (darker + glossier) sells it as much as the drops.
3. **Storm = rain + wind + flashes.** Wind over 10 m/s slants the streaks and bends foliage.
   Lightning every 3-10 s. Thunder delayed by distance tells the player how far the storm is.
4. **Snow:** slow fall (about 1 m/s) with wobble, flakes 5-15 cm, a white-grey fog, and snow
   cover that builds over about a minute. Register vertical surfaces with a low `snow`
   (0.1) and roofs and ground with a high one.
5. **Transitions:** 10-30 s in play and 0-5 s in tests. Never cut from clear to storm unless
   a cutscene motivates it.
6. **Budget:** precipitation costs 2 draw calls plus the cloud dome, and fill-rate scales with
   drops on screen. On `low`, keep rain at 3-4k instances or fewer and turn splashes off.

## 4. Gameplay hooks

- `Needs.update(dt, { ambient: weather.temperature, wind: weather.windSpeed, rain: weather.rainIntensity })`: survival exposure.
- `weather:shelter` → AI goes indoors. Example with `ScheduleAgent.alarm`, or a custom BT branch: when `needed`, path to the nearest `BuildPlacement.shelterAt` place or building.
- Campfires (`BuildPlacement.update(dt, { rain })`) burn 3× faster in unsheltered rain.
- `weather.forecast(3)` → a HUD or radio line ("storm in 2 min").

## 5. Limitations (honest)

- Precipitation is not occluded by roofs: drops render inside shelters. Hide them with your own
  rule (for example scale intensity down when `shelterAt(camera)`) if it matters.
- The wet look is albedo darkening plus lower roughness. There are no puddles, ripples or screen
  droplets.
- The cloud dome is a 2D fbm layer with no volumetric lighting. The lightning bolt is a mesh,
  not a light that casts shadows.
- The snow tint is uniform per material, except terrain, which masks by slope.
