# Survival / crafting kit

Use this for any gather → craft → build → survive loop (wilderness survival, colony starts,
crafting RPG side systems). Module: `engine/gameplay/survival.js`, exported from
`engine/index.js` (survival block). Weather is a separate module: see `weather.md`.

- Unit tests: `tests/unit/survival.test.mjs` (7 tests) and `tests/unit/weather.test.mjs` (5 tests).
- Integration scene: `tests/scenes/survival/` (`node tools/playtest.mjs tests/scenes/survival`, 39 checks).
  It covers harvesting a tree and a rock, crafting rope → axe → campfire kit, a ghost preview,
  a shelter, needs ticking, clear → rain → storm → snow, and a save/load round trip.

Every class works without a scene (pure logic, Node-testable) and only builds meshes when you
pass `scene`. Every class has `toJSON()` / `load()`. `attachSurvivalSave()` registers them all
with `app.save`.

## 1. Design method

1. **Write the loop on one line first.** Example: *chop wood → craft axe → fell trees faster →
   build a shelter before the storm at dusk → keep a fire fuelled through the night*. Each arrow
   needs a system that pushes the player forward:
   - a tool tier;
   - a need that worsens;
   - a weather event.
2. **Resource economy.** List every item with *where it comes from* and *what consumes it*. An
   item with no sink is clutter. An item with no source is a softlock.
   - Keep 4-8 raw materials and 2-3 tool tiers in a slice.
   - Starter costs used by the defaults: axe = 3 wood + 2 stone + 1 rope; foundation = 6 wood + 2 stone;
     full one-room shelter ≈ 27 wood, 6 stone, 12 fiber. That is about 5 trees, 2 rocks and 4 bushes:
     roughly 5 minutes of play with an axe.
3. **Time to first tool ≤ 2 minutes.** Bare hands must work on the first nodes, only slowly:
   `handFactor` 0.5 gives about 30 hits per tree, against 4 with a stone axe. The slowness is the
   reason to craft. Gate only the second tier (`minTier`, `handFactor: 0`).
4. **Needs create a schedule, not a chore.** Defaults (per game hour, idle):
   - hunger −4, thirst −6, fatigue +5;
   - sprinting multiplies hunger, thirst and fatigue by about 2.4-3;
   - sleeping restores fatigue (−15/h).

   With a 20-minute day (`hoursPerSecond = 24/1200`), a full stomach lasts about one game day.
   Damage only starts at 0, or below 35 °C body temperature. Warn early with statuses
   (`hungry` < 25, `cold` < 35.6 °C) and HUD bars.
5. **Weather is the antagonist.** Rain soaks you (wetness → −7 °C feels-like), wind chills,
   storms put out unsheltered fires 3× faster. A shelter (foundation + roof + ≥ 2 walls) and a
   campfire (`heat` up to +18 °C at the fire, linear falloff to 5 m) are the counters. Forecast
   the threat: the seeded `weather.forecast()` can drive a "storm in 2 minutes" HUD line.
6. **Building reads at a glance.** Grid 3 m.
   - Foundations snap to the grid. Walls snap to the nearest foundation edge. The roof snaps on
     top and needs 2 walls. Small props (campfire, storage, workbench) snap to 0.25 m.
   - The ghost is green when valid and red when invalid, and `reason` tells the player why:
     *ground too steep*, *overlaps campfire*, *blocked by tree*, *needs a foundation*.
   - Removing a foundation removes what it supports. The refund is 50 %.

## 2. API

| API | Notes |
|---|---|
| `new GF.ItemRegistry(defs = DEFAULT_ITEMS)` `.define(id, def)` `.get(id)` `.list(tag)` | def: `name stack weight tags durability use{hunger,thirst,health,stamina,warmth,fatigue}\|fn equip tool{kind,tier,damage} insulation fuel place`. Durability items never stack |
| `new GF.SlotInventory(registry, { slots, maxWeight, events })` | `.add(id, n) → leftover` · `.remove(id, n)` (all-or-nothing) · `.count .has .hasAll .capacityFor .weight` · `.split(i, n)` · `.move(a, b)`/`.merge` (merges stacks or swaps) · `.sort()` · `.wear(i)` · `.findTool(kind, tier)` · `.use(i, { needs, health, stamina })` / `.useItem(id, ctx)`. Events `inventory:change/full/break/use/equip`. (`GF.Inventory` is still the old count-only inventory.) |
| `new GF.Equipment(inventory, { slots })` | `.equip(i)` / `.equipItem(id)` / `.unequip(slot)` · `.tool()` → `{ kind, tier, damage }` (bare hands = `hand`) · `.wearTool()` · `.insulation()` |
| `new GF.CraftingSystem(inventory, { recipes, equipment, stations: () => Set, events })` | recipe: `{ id, inputs, tools: [{kind, tier}], station, time, outputs, category }` · `.canCraft(id)` → `{ ok, missing: [{ type: item\|tool\|station, id, need, have }], reason }` · `.craft(id, { count, instant })` consumes inputs now, outputs after `time` · `.cancel(i)` refunds · `.update(dt)` · `.available()` · events `craft:start/complete/cancel/fail/overflow` |
| `new GF.Needs({ health, stamina, hoursPerSecond, ...rates })` | `.update(dt, { activity: idle\|walk\|sprint\|work\|swim\|sleep, ambient °C, wind m/s, rain 0..1, shelter, heat 0..1, insulation °C, sleeping, swimming })` · fields `hunger thirst fatigue bodyTemp wetness feelsLike` · `.apply(effect)` · `.status()` · `.staminaMax()` · `.speedScale` · event `needs:status {status, on}`, `needs:death` |
| `GF.needsHUD(app.ui, needs)` · `GF.inventoryHUD(app.ui, inventory, { slots, equipment })` | HUD bars (food, water, warmth, energy) + hotbar |
| `new GF.ResourceNodes({ scene, physics, types = RESOURCE_TYPES, seed, events })` | `.add(type, pos, { scale, ry })` · `.scatter(hf, type, scatterPointsRules)` · `.hit(node, tool, { inventory })` → `{ ok, damage, yields, depleted, reason }` · `.harvest(node, { inventory, equipment })` (uses the equipped or best tool and wears it) · `.raycast(origin, dir, max)` · `.inFront(pos, facing, { range, arc, type })` · `.nearest(pos, { type })` · `.update(dt)` (respawn, hit shake). Types: `{ hp, tool, minTier, yields: [{ id, n: [min,max] }], bonus, respawn, radius, height, handFactor, build(node) }`. Yields are paid in proportion to the damage dealt, never twice. A cylinder collider is added per node and removed when the node is depleted |
| `new GF.BuildPlacement({ scene, physics, ground: hf\|fn, grid, pieces = BUILD_PIECES, blockers: () => [{x,z,r,kind}], materials, events })` | `.resolve(type, point, rot)` → `{ valid, reason, x, y, z, rot }` · `.preview(type, point, rot)` (ghost) · `.hidePreview()` · `.place(type, point, rot, { inventory })` (pays the cost or the piece's kit item) · `.remove(p, { inventory })` · `.stationsNear(pos, r)` · `.heatAt(pos)` · `.shelterAt(pos)` · `.addFuel(p, s)` · `.update(dt, { rain, vfx })` (fuel, flicker, fire/smoke VFX). Pieces: foundation wall doorway roof campfire storage workbench; override `build({ ghost })` per piece for custom meshes |
| `GF.attachSurvivalSave(app.save, { inventory, equipment, crafting, needs, nodes, building, weather })` | registers `survival.<name>` providers |

## 3. Wiring (frame order)

```js
const registry = new GF.ItemRegistry();
const inv = new GF.SlotInventory(registry, { slots: 24, maxWeight: 80, events: app.events });
const eq = new GF.Equipment(inv);
const nodes = new GF.ResourceNodes({ scene: app.scene, physics: app.physics, seed: 8 });
nodes.scatter(hf, 'tree', { count: 30, exclude: [{ x: 0, z: 0, r: 10 }] });
const build = new GF.BuildPlacement({ scene: app.scene, physics: app.physics, ground: hf,
  blockers: () => nodes.nodes.filter((n) => n.alive).map((n) => ({ x: n.position.x, z: n.position.z, r: 0.6, kind: n.type })) });
const craft = new GF.CraftingSystem(inv, { equipment: eq, stations: () => build.stationsNear(player.position) });
const needs = new GF.Needs({ health: player.health, stamina: player.stamina });
const weather = GF.attachWeather(app, { seed: 3, ground: hf });
GF.attachSurvivalSave(app.save, { inventory: inv, equipment: eq, crafting: craft, needs, nodes, building: build, weather });
app.add((dt) => {
  player.control(dt);
  if (app.input.pressed('interact')) nodes.harvest(nodes.inFront(player.position, player.facing), { inventory: inv, equipment: eq });
  nodes.update(dt); craft.update(dt); build.update(dt, { rain: weather.rainIntensity, vfx: app.vfx });
  needs.update(dt, { activity, ambient: weather.temperature, wind: weather.windSpeed, rain: weather.rainIntensity,
    shelter: build.shelterAt(player.position), heat: build.heatAt(player.position), insulation: eq.insulation() });
});
```

The weather update must run after the Atmosphere. `attachWeather` uses order 40, which comes
after the app's pre-update. `tests/scenes/survival/main.js` is the complete reference: keys,
hotbar, axe attached to the hand, cheats and the save round trip.

## 4. Playtest checklist

Write one `expect` for each of these:
- a node yields items and is depleted;
- the tool tier speeds harvesting;
- `canCraft` names the missing input;
- the craft finishes only after `time`;
- the ghost is visible and valid on flat ground, and invalid on a tree or a slope;
- the roof is rejected without walls;
- the shelter counts as sheltered;
- the campfire is a station;
- needs fall over time;
- getting wet in rain;
- the save/load round trip.

Take screenshots of the ghost and of each weather state, and *look at them*: rain must read as
streaks, not noise, and the ghost must stand out from the terrain.

## 5. Limitations (honest)

- Structural rules are deliberately simple:
  - support only (foundation → walls/roof);
  - no stability or load propagation;
  - no multi-storey;
  - no free-angle snapping.
- Foundations take the height of their highest corner, and a stone plinth hides the gap. Steep
  ground (> 0.9 m step across 3 m) is rejected.
- Resource nodes are individual meshes that share prototypes. That is fine for ~100 nodes. For
  thousands, stream them (`streamObjects`) or instance them.
- Needs use a single body-temperature model with a fixed comfort point (21 °C feels-like). It is
  not a physiological simulation.
- Storage boxes keep a `storage.slots` array but have no UI. Doors are open gaps.
