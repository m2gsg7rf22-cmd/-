# Navigation (navmesh): walkable surfaces, pathfinding, obstacles, steering

`engine/ai/navmesh.js` (exported from `engine/index.js`). Use it whenever NPCs, enemies or
crowds must get around buildings, walls, stairs, bridges or parked cars. Pure JS, deterministic,
no dependencies. Tests: `tests/unit/navmesh.test.mjs`; integration scene: `tests/scenes/navmesh/`
(`node tools/playtest.mjs tests/scenes/navmesh`). Nothing uses it by default: games opt in.

## 1. Build

```js
const nav = app.buildNavMesh({ bounds: { minX: -60, minZ: -60, maxX: 60, maxZ: 60 }, seeds: [spawn] });
// same as GF.buildNavMesh({ physics: app.physics, ... })
const dbg = nav.debugMesh(); app.scene.add(dbg);         // overlay (rebuild after obstacle changes)
```

Sources: `physics` (its heightfield, or `physics.groundFn`, or flat ground at y = 0, plus every
static collider except triggers and `userData.noNav` / `userData.noCollide`), or `heightfield`, or
`ground: (x, z) => y` (`ground: false` = no ground); `colliders: [...]` adds shapes, including
`{ type: 'ramp', x, z, hx, hz, yaw, y0, y1, base }` wedges (y0 at local −z, y1 at local +z;
PhysicsWorld has no sloped collider, so a ramp is navmesh-only unless the game also gives the
physics a ground function). `userData.navWalkable = false` on a collider makes its top unwalkable
(car roofs, market stalls).

Pipeline (Recast-style): rasterize columns of `cellSize` (conservative, so thin walls are not
missed) → solid spans per column → walkable span = top with slope ≤ `maxSlope` and
`agentHeight` free above (several per column = **multi-level**: street under a bridge + the deck)
→ links between neighbour spans when the step is ≤ `maxClimb` → erosion by `agentRadius`
(distance field from walls, ledges and drops) → regions (connected components; < `minRegionArea`
pruned; `seeds` keep only regions containing a seed, which drops roofs and unreachable islands) →
convex rectangles per tile (`tileSize` cells) with portals on shared edges.

| Parameter | Default | Guidance |
|---|---|---|
| `cellSize` | 0.3 | ≤ agentRadius. 0.2 for interiors and narrow doors, 0.4-0.5 for big terrain. Build cost grows with 1/cellSize² |
| `cellHeight` | 0.2 | merge tolerance between stacked solids (gaps smaller than half of it are closed) |
| `agentRadius` | 0.35 | erosion. Effective wall clearance is ceil(r / cellSize) · cellSize to + 1 cell (0.6-0.9 m at the defaults) |
| `agentHeight` | 1.8 | ceiling clearance (under bridges, tables) |
| `maxClimb` | 0.45 | stair risers / curbs; match `CharacterController` step (0.45) |
| `maxSlope` | 45° | terrain / ramp / sphere tops |
| `tileSize` | 32 cells | the unit of rebuild for dynamic obstacles (≈ 10 m) |
| `minRegionArea` | 1.5 m² | drops slivers on props |
| `seeds` | none | `[spawnPoint]`: keep only what the player can reach |
| `waterLevel` | null | ground below waterLevel + 0.2 is not walkable |

Doors: with conservative erosion a doorway needs about 2·ceil(r/cs)·cs + 2·cs of clear width
(≈ 1.8 m at the defaults, 1.2 m with cellSize 0.15). Make doors ≥ 2 m or lower `cellSize`.

## 2. Query

| API | Notes |
|---|---|
| `nav.findPath(a, b, { maxSnap })` → `[Vector3]` \| null | A* over polygons + funnel string pulling; includes the snapped start and end; null when an end is off the mesh (beyond `maxSnap`, 3 m) or unreachable (different region → O(1) answer) |
| `nav.closestPoint(p)` / `nav.findNearest(p)` | snap to the mesh (`{ point, poly, region, span }`); `p.y` picks the level, missing y = lowest level |
| `nav.raycast(a, b)` → `{ hit, t, point, distance }`, `nav.lineWalkable(a, b)` | walk the surface along a straight line (multi-level aware) |
| `nav.moveAlongSurface(from, to, span)` → `{ position, span, blocked }` | constrained move that slides along borders (what NavAgent uses) |
| `nav.randomPoint(rng, { region })` | uniform by area, deterministic with `GF.RNG` |
| `nav.isWalkable(p, { tolerance })`, `nav.heightAt(x, z, nearY)`, `nav.regionOf(p)` | |
| `nav.addObstacle(shape)` → id, `nav.updateObstacle(id, shape)`, `nav.removeObstacle(id)` | shape: `Box3` \| `{ x, z, hx, hz, yaw, y, hy }` \| `{ type: 'cylinder', x, z, r }`; inflated by agentRadius; without y it blocks every level. Touched tiles are re-polygonized lazily before the next query; `nav.version` increments (agents re-plan) |
| `nav.toJSON()` / `GF.NavMesh.fromJSON(json)` | spans + erosion mask + obstacles (base64), polygons rebuilt on load |
| `nav.debugMesh({ opacity, outlines, portals })`, `nav.info()` | overlay (colour per polygon, blocked cells red); stats incl. `buildMs`, `timings`, `polys`, `regions` |

## 3. Steering

```js
const crowd = new GF.NavCrowd(nav);                    // neighbour grid + reciprocal avoidance + separation
const a = crowd.add(new GF.NavAgent(nav, { position, maxSpeed: 1.6 }));
a.setDestination(target);                              // false → state 'nopath'
app.add((dt) => crowd.update(dt));                     // a.position / a.velocity / a.heading / a.state ('moving' | 'arrived' | 'nopath' | 'idle')
```

NavAgent: corridor following with arrival slow-down, re-plan when `nav.version` changes, every
`repathInterval` s, when pushed out of sight of its next corner, or when stuck 1.5 s. Avoidance is a
sampled velocity obstacle (25 candidates scored by deviation, reciprocal time-to-collision with
up to 6 neighbours and a 0.6 s wall probe). Movement goes through `moveAlongSurface`, so agents
cannot leave the mesh or enter walls. Neighbours with `avoidance: false` (the player) are avoided
but not expected to cooperate.

- **Actor / NPC / Enemy**: `new GF.NavAgent(nav, { integrate: false })`; each frame
  `agent.position.copy(actor.position); agent.update(dt, neighbours)` then
  `Actor.prototype.update.call(actor, dt, agent.velocity.clone().normalize(), agent.velocity.length())`
  (or, after `enemy.think(dt, target)`, set `enemy.move = agent.velocity.clone()` before `enemy.update(dt)`), so physics and animation stay in charge.
- **ScheduleAgent**: `planner: GF.navMeshPlanner(nav)` (like `navGridPlanner`; no path → stay,
  `{ fallback: 'straight' }` to walk straight). ScheduleAgent switches waypoints at 0.9 m and moves
  kinematically, so it cuts corners by up to that much. Use NavAgent where wall clearance matters.
- **Crowd**: `new GF.Crowd(app, city, { navmesh: nav })` routes pedestrians over the navmesh
  instead of the sidewalk graph (they may then cross roads anywhere).

## 4. Costs (measured, Node 22, this container; see the unit test output)

| Case | Result |
|---|---|
| 100 × 100 m city-like layout (36 blocks with 1-3 buildings each, 144 posts, curbs), cellSize 0.3 → 111 k columns | build 220-450 ms across runs (rasterize ≈ 45 %, spans ≈ 30 %, erosion/regions/polygons ≈ 20 %), 1886 polygons, 37 regions (roofs/islands, use `seeds`) |
| `findPath`, 100 random queries, mean 55 m | 0.4-1.1 ms each |
| JSON | 1.9 MB, `fromJSON` 80-330 ms |
| integration scene 60 × 60 m (`tests/scenes/navmesh`) | see `debugState().nav.buildMs` in its test-results.json |

Memory ≈ 40 bytes per span. Build once on a loading screen or ship `toJSON()` output; cost scales
with area / cellSize².

## 5. Limits

- Colliders are boxes (yaw only), cylinders, spheres and navmesh ramps; arbitrary triangle meshes
  are not rasterized (add box/ramp proxies). Heights come from the cell centres (bilinear smoothed),
  so very bumpy terrain is approximated at `cellSize`.
- Polygons are grid-aligned rectangles (not simplified contours): more polygons than Recast on
  diagonal / rotated walls (staircase borders) and a few 1-cell slivers at corners.
- Erosion is conservative (clearance rounds up to whole cells, square at convex corners), see the door rule above.
- One agent size per navmesh (build a second mesh for vehicles / big monsters).
- No off-mesh links (jumps, ladders, teleports) and no area costs (prefer sidewalks) yet.
- Dynamic obstacles block whole cells under an inflated footprint; moving one every frame
  rebuilds its tiles every frame (cheap for a door or a parked car, not for traffic; cars on roads
  should keep using the traffic system).
- Avoidance is local: dense crowds in narrow corridors can still jam (agents re-plan when stuck).
