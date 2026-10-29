# Open-world systems: streaming, NPC daily life, wanted/heat, crowds

Use this when the game is a GTA-style city, an open fantasy region or any world bigger than one
screen of content. All modules are exported from `engine/index.js` (open-world block); the
logic parts are pure and unit-tested (`tests/unit/openworld.test.mjs`), the integration scene
`tests/scenes/open-world/` shows everything wired together (`node tools/playtest.mjs tests/scenes/open-world`).

## 1. Design method

Build an open world from budgets first, content second.

1. **World density.** Decide what one city block (or 64 m of countryside) must contain so a
   screenshot never shows an empty plain: buildings/landmarks on the skyline, 3-6 props per
   sidewalk side, 2-6 visible pedestrians by day, 0-2 at 3 am, 1-3 moving cars. Density
   follows time of day and district (downtown > suburb > park).
2. **Streaming budget.** Pick a cell size (city: one block pitch, ~70 m; terrain: 64-128 m),
   `loadRadius` = the farthest distance where content must exist (fog/far plane minus a margin),
   `unloadRadius` = `loadRadius` + half a cell (hysteresis: no churn when the player stands on a
   border). Cap work per frame: `maxLoadsPerUpdate` 1-2 and `budgetMs` 2-4. Use `lookAhead`
   (s) for vehicles so the cells ahead load first. `warm()` on spawn/teleport/loading screens.
3. **LOD ladder.** Every repeated thing gets near / mid / far / hidden distances with ~10 %
   hysteresis (`selectLOD`, `LODGroup`). Far = impostor billboard (`createImpostor`) or
   nothing. Shadows only on the near tier.
4. **NPC life simulation.** Simulate everyone cheaply (positions + schedule state), render only
   the nearby ones. Each NPC has a template schedule (worker, shopper, retiree, student,
   nightOwl, guard) jittered ±0.5 h, fixed home/work places and travels via a planner (sidewalk
   graph, `NavGrid`, straight line). Time jumps (sleep, fast travel, `setTime`) teleport agents
   into their current activity instead of making them walk.
5. **Systemic reactions.** One event, several systems: a crime → `wanted.commit()` (heat,
   pursuers) + `crowd.alarm()` (nearby people flee, further ones watch) + audio/HUD. Witnesses
   (`crowd.witnesses(pos)`) decide whether a crime is reported in full (`witnessed: false`
   adds only 30 % heat). After the scare agents resume their schedule automatically.
6. **Performance budget (verify, don't assume).** Run `node tools/bench-crowd.mjs` and the
   playtest metrics. Measured on the integration scene (low tier, shadow pass included, 50
   pedestrians, SwiftShader so fps is not representative):

   | mode | draw calls | triangles |
   |---|---|---|
   | all realistic (crowd LOD clones) | 434 | 3.69 M |
   | all mannequins | 50 | 0.24 M |
   | default ladder (6 realistic ≤ 14 m, mannequins ≤ 60 m, rest hidden) | 86 | 0.60 M |

   Per realistic crowd human: 4 draw calls (skin, eyes, hair, merged garments) and ~35 k
   triangles, versus 14 draw calls for a full human. Per mannequin: 1 draw call, ~4.7 k triangles.
   Targets for a whole frame: < 900 draw calls, < 2.5 M triangles on `low` (the scene asserts it).

## 2. Streaming — `engine/world/streaming.js`

| API | Notes |
|---|---|
| `new GF.ChunkManager({ cellSize, loadRadius, unloadRadius, maxLoadsPerUpdate, maxUnloadsPerUpdate, budgetMs, lookAhead, bounds, build(cx,cz,key), dispose(content,cx,cz,key) })` | `.update(focus, dt)` loads nearest-first, `.warm(focus)`, `.isLoaded(cx,cz)`, `.get(cx,cz)`, `.loadedKeys`, `.stats {loads, unloads}`, `.debug()`. `build` may return a Promise. |
| `GF.streamObjects(parent, objects, { cellSize, loadRadius, ... })` | streams existing Object3Ds (e.g. `generateCity({ mergeBuildings: false }).buildings`) in/out of `parent`; colliders stay static |
| `GF.selectLOD(distance, thresholds, current, { hysteresis, cull })` | pure; −1 = culled |
| `new GF.LODGroup([{ object, distance }...], { hysteresis, cull, onSwitch })` | add `lod.root` to the scene, `lod.update(camera.position)` |
| `GF.createImpostor(renderer, object, { size })` | one-off render to a billboard Sprite (feet pivot) |
| `GF.bucketByCell(objects, cellSize)`, `GF.cellDistance(...)`, `GF.chunkKey(cx, cz)` | helpers |

City streaming: `generateCity({ mergeBuildings: false })` keeps buildings out of the merged
static mesh; every building carries `userData.lot = { type: tower|shop|house, block, side }`; the
result also has `blocks`, `sidewalk`, `sidewalkY`, `blockCount`.

```js
const city = GF.generateCity({ seed: 7, blocks: 6, mergeBuildings: false });
app.scene.add(city.group); city.colliders.forEach((c) => app.physics.addStatic(c));
const stream = GF.streamObjects(app.scene, city.buildings, { cellSize: 70, loadRadius: 120, unloadRadius: 170, lookAhead: 0.5 });
stream.warm(player.position);
app.add((dt) => stream.update(player.position, dt));
```

## 3. NPC schedules — `engine/ai/schedules.js`

| API | Notes |
|---|---|
| `GF.SCHEDULE_TEMPLATES` / `GF.ACTIVITIES` | templates `[from, to, activity, placeKind]` (wrap past midnight); activities: sleep home work eat shop park wander patrol idle with `inside` probability, loiter `radius`, `roam`, `pause` |
| `GF.activityAt(schedule, hour)`, `GF.makeSchedule(tpl)`, `GF.jitterSchedule(s, rng, 0.5)` | pure |
| `new GF.PlaceRegistry([{ id, kind \| kinds, x, z, radius }])` | `.of(kind)`, `.pick(kind, rng)`, `.nearest(kind, x, z)` |
| `new GF.ScheduleAgent({ schedule, registry \| places, position, seed, speed, runSpeed, planner, walkable, groundY, integrate })` | `.update(dt, hour)` → `.velocity`, `.position`, `.heading`, `.visible`, `.state` (inside travel perform flee cower watch), `.activity`; `.interrupt({ type, from, duration })`, `.resume()`, `.teleport(hour)` |
| `new GF.ScheduleSystem({ jumpHours })` + `GF.attachSchedules(app, system)` | follows `app.atmosphere.timeOfDay`; `.alarm(pos, { radius, type, duration, watchRadius })`; `.stats()` |
| planners | `GF.straightPlanner`, `GF.navGridPlanner(GF.NavGrid.fromWorld(app.physics, ...))`, `GF.navMeshPlanner(nav)` (navigation.md), sidewalk graph `crowd.network.path` |

Named NPCs (quest givers, shopkeepers) can use a `ScheduleAgent` with `integrate: false` and feed
`agent.velocity` into `npc.update(dt, dir, speed)`, so they keep physics and dialogue.

## 4. Wanted / heat — `engine/gameplay/wanted.js`

| API | Notes |
|---|---|
| `new GF.WantedSystem({ spawn(pos, i) → unit, despawn(unit), canSee(unit, target), spawnPoint(center, rng), unitsPerLevel, levels, cooldown(level), crimes, events, decay: 'level' \| 'clear', name })` | `.commit(crime, { position, witnessed })`, `.update(dt, target)`, `.setLevel(n)`, `.clear()`, `.debug()`; `.state` clear/pursuit/search; units get `.mode` + `.goal` |
| `GF.CRIMES`, `GF.WANTED_LEVELS` (heat per level 0..5), `GF.levelForHeat(h)` | tune per game (fantasy: `crimes: { poaching: 0.8 }`, `name: 'guards'`) |
| `GF.assignPursuit(units, targetPos, lastKnown, { seen, closeIn, flank, searchRadius })` | pure: nearest chase, others flank around the target; unseen → converge on last known + search ring |
| `GF.lineOfSight(app.physics, { range, fov })` | raycast `canSee` |
| `GF.WantedSystem.steer(unit)` | desired velocity toward the unit's goal |
| `GF.wantedHUD(app.ui, wanted)` → `.update()` each frame | uses `app.ui.stars(id, { max, icon })` (flashes while searching) |

Events on `app.events`: `wanted:crime`, `wanted:level`, `wanted:spotted`, `wanted:lost`, `wanted:clear`.
Losing the pursuers: break line of sight (buildings block the raycast, or get out of `range`); each
`cooldown(level)` seconds unseen drops one level; units despawn above the level's quota.

## 5. Crowds — `engine/world/crowd.js`

| API | Notes |
|---|---|
| `new GF.Crowd(app, city, { count, seed, templates: { worker: 4, ... }, variants, maxNear, nearRange, midRange, hysteresis, shadows, animStride })` | `await crowd.prepare()` builds `variants` realistic crowd templates if `app.humans` is set (otherwise mannequins only, dataset never loaded) |
| `crowd.update(dt, viewPos, hour?)` | schedules + LOD + animation (mid tier animates every `animStride` frames beyond 20 m) |
| `crowd.alarm(pos, { radius, duration, watchRadius })`, `crowd.witnesses(pos, r)`, `crowd.info()` | reactions, witnesses, stats (near/mid/hidden, byActivity, byState) |
| `GF.sidewalkNetwork(city)` | `.path(a, b, lane)`, `.project(p, lane)`, `.randomPoint(rng)` — block rings + crosswalks |
| `GF.placesFromCity(city)` | lots → home/work/shop/eat places at the sidewalk, parks → park places |
| `GF.CrowdAnimator(model, clips)` | idle/walk/run blend with shared pre-baked clips |

Realistic humans crowd path (`engine/humans.js`): `H.assembleHuman(data, { ...spec, lod: 'crowd' })`
= 256 px skin bake, underwear skipped under trousers, garments merged into one vertex-coloured
skinned mesh (`H.mergeGarments`), no teeth/tongue/facial morphs. `H.cloneHuman(template)` (≈3 ms)
shares geometry, skin textures and baked clips; only the skeleton is duplicated. Variety in the
near tier = number of templates (`variants`); mannequins reuse the same clothes/skin/hair colours so
the near↔mid swap does not change the person's palette.

## 5b. Navigation (navmesh)

For anything off the sidewalk graph (plazas, interiors, bridges, courtyards, terrain) build a
navmesh once and route through it: `const nav = app.buildNavMesh({ bounds, seeds: [spawn] })`.
`GF.navMeshPlanner(nav)` plugs into `ScheduleAgent` (like `navGridPlanner`),
`new GF.Crowd(app, city, { navmesh: nav })` routes pedestrians over it, `GF.NavAgent` + `GF.NavCrowd`
give named NPCs / pursuers path following with reciprocal avoidance, and
`nav.addObstacle(box)` / `removeObstacle(id)` reroute everyone around parked cars and closed doors.
100 × 100 m of city at 0.3 m cells builds in ~0.2-0.5 s, a path query is ~1 ms. Full API,
parameter guidance, costs and limits: `references/navigation.md`.

## 6. Testing an open world

- Unit-test pure logic (chunk sets, LOD thresholds, `activityAt`, heat/decay, assignments).
- Playtest checks to copy from `tests/scenes/open-world/playtest.json`: chunks stream and unload when
  the player moves, queue drains; time jumps put agents at their schedule places (3 am mostly
  asleep, lunch → eat, 10 am → work); crime raises the level, people flee, pursuers spawn, HUD
  stars match; hiding decays the level to 0 and pursuers despawn; frame metrics within budget;
  no runtime errors.
- Expose `debugState` fields for chunks, crowd and wanted, and cheats: `goTo`, `setHour`, `crime`.

## Limitations

- No mesh decimation: a realistic crowd human is still ~35 k triangles (keep `maxNear` ≤ 6-8).
- Near-tier variety equals the number of templates (each template build ≈ 0.8-1.5 s, do it on a
  loading screen); no per-clone recolouring yet.
- Pedestrians are kinematic on sidewalks (no collisions with each other, cars or the player; no
  traffic-light logic at crosswalks); indoor activities are hidden, not simulated interiors.
- Pursuers in the scene are on-foot actors; cars/roadblocks/helicopters are game-level work.
- Streaming streams visuals of existing objects (or whatever `build` returns); physics colliders
  of a city stay resident.

## Integration facts (from the GTA-style blind test)
- **Crimes and heat:** `GF.CRIMES` = { trespass 0.4, vandalism 0.6, theft 0.8, assault 1.2, vehicleTheft 1.5, shooting 2.2,
  assaultOfficer 2.6, murder 3.2, killOfficer 4.5 } heat; `GF.WANTED_LEVELS` = [0, 1, 3, 6, 10, 15] heat per star (index = stars).
  `wanted.reportCrime(kind, pos)`; add your own kinds by passing a number instead of a name.
- **Armed police:** the wanted system only assigns pursuit goals. For shooting cops, spawn `GF.RangedEnemy` units
  (references/shooter.md) as the pursuers and feed them the `assignPursuit` goals; for arrests, check
  `player within 1.5 m of a unit for 2 s while wanted ≤ 2 and not moving` in your module and fade out / respawn.
- **Traffic:** `new GF.TrafficSystem(scene, city, { count = 12, seed = 3, speed = 11 })`; `update(dt, obstacles)` (pass
  player vehicles so AI cars brake for them); `collide(vehicle, onImpact)`; `cars[]` (each has `rig` (Object3D), `position`, `yaw`, `speed`). composeGame
  exposes it as `game.traffic` for city worlds.
- **Crowd density:** schedules put people indoors during work/sleep hours. For a busy street at 08–10, 12–14 or 17–20 use
  60–120 pedestrians per 4×4-block district; at other hours use `ScheduleSystem` templates with more `wander`/`errand`
  activities or start the clock in those windows (`app.atmosphere.timeOfDay`).
