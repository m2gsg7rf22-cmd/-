# Genre kits: platformer and racing

Two reusable kits that sit on the core engine (`CharacterController`, `Vehicle`, `PhysicsWorld`).
Both are exported from `engine/index.js`. Verified by `tests/unit/platformer.test.mjs`,
`tests/unit/racing.test.mjs` and the integration scenes `tests/scenes/platformer/` and
`tests/scenes/race-track/` (`node tools/playtest.mjs tests/scenes/<name>`). Read the scene
`main.js` files as the reference wiring.

---

## A. Platformer (`engine/gameplay/platformer.js`)

### API
| API | Notes |
|---|---|
| `GF.platformerProfile(overrides)` | controller profile; `new GF.CharacterController(world, { position, profile })` or `ctrl.setProfile(p)`. Without a profile the controller behaves exactly as before. |
| `ctrl.move(dt, dir, 0, { jump, jumpHeld, dash })` | `jump`/`dash` = **pressed edges**, `jumpHeld` = button down (variable height). Speed `0` = profile `runSpeed`. |
| `ctrl.pf` | state: `state` (idle run jump fall wallSlide ledge climb dash), `events` per step (`jumped landed wallJumped dashed ledgeGrab climb climbed airJump`), counters (`jumpCount wallJumps dashes ledgeGrabs`). Drive audio/VFX/animation from `events`. |
| `GF.platformerParams(o)` | resolved numbers incl. derived `gravity`, `jumpVelocity`, `fallGravity` |
| `GF.jumpArc(p)` `{ apex, tApex, heightAt(t) }` · `GF.airTime(p, rise)` · `GF.jumpReach(p, rise, { dash })` · `GF.maxGap(p, rise)` | jump math |
| `GF.canReach(p, { gap, rise, kind: 'jump'|'ledge'|'spring', launch })` → `{ ok, reason: 'too-far'|'too-high', reach, required, maxRise }` | reachability checker |
| `GF.validateLevel(desc)` → `{ ok, links, failures }` | re-check a level after changing feel numbers |
| `new GF.PlatformerLevel(world, { scene, killY })` | runtime: `addPlatform/addMoving/addCrumble/addSpring/addHazard/addCheckpoint/addCollectible/setGoal/setSpawn`, `build(desc)`, `update(dt, [ctrl])` (**before** `ctrl.move`), `respawn(ctrl)`, `kill(ctrl)`, `platformOf(ctrl)`, `stats`, `debugState()`; callbacks `onDeath onRespawn onCheckpoint onCollect onGoal onSpring onCrumble` |
| moving platform `motion` | `{ type:'linear', from:[x,y,z], to, period, phase }` · `{ type:'circular', center, radius, period, plane:'xz'|'xy', startAngle }` · `{ type:'path', points:[[x,y,z]…], speed, loop }`. Positions are platform **top** centres. `GF.motionPose(m, t)` evaluates them. |
| `GF.generatePlatformerLevel({ seed, pieces, difficulty, profile, kinds, sequence, checkpointEvery, collectibles })` | description `{ platforms, hazards, checkpoints, collectibles, goal, start, links, path, sections, killY, report }` |
| `new GF.PlatformerBot(level, ctrl)` `.update(dt)` → `{ moveX, moveZ, jump, jumpHeld, dash }` | plays a generated level through normal inputs: playtests, attract mode, solvability proof |
| `world.moveStatic(shape, x, y, z, yaw?)` | move any static collider (kinematic doors/lifts) |

Piece kinds (`GF.PLATFORMER_PIECES`): `gap stairs drop spikes lava crumble moving circular path spring ledge`.

### Carrying, springs, crumbling, hazards — how it works
- Movers move their collider each step and add the same delta to every controller standing
  (or hanging on a ledge) on them; leaving a mover hands its velocity to `ctrl.external`
  (momentum is kept on jump-off). So the update order matters: `level.update` → `ctrl.move`.
- Springs launch when the player is grounded on them (`power` m/s up; jump-cut is disabled for
  that launch). Spring height = `power² / (2·gravity)`.
- Crumble platforms shake for `delay` s after first contact, drop (collider removed), and
  come back after `respawn` s or when the player dies.
- Hazards are AABB kill volumes (`spikes`, `lava`); also `killY`. Death → respawn at the last
  checkpoint reached (checkpoints only activate in increasing order).

### Game-feel numbers (defaults, metres/seconds)
| Parameter | Default | Guidance |
|---|---|---|
| `jumpHeight` / `timeToApex` | 2.4 m / 0.36 s | gravity = 2h/t² ≈ 37 m/s², launch = 2h/t ≈ 13.3 m/s. Snappy platformers use 0.3–0.4 s to apex; floaty 0.45–0.55 |
| `fallMultiplier` | 1.55 | 1.4–2.0: falling faster than rising removes the "moon" feel |
| `jumpCut` | 0.45 | upward velocity kept when the button is released early (short hop ≈ 30–45 % of full) |
| `coyoteTime` | 0.10 s | 0.08–0.15; invisible forgiveness when leaving ledges |
| `jumpBuffer` | 0.12 s | 0.1–0.15; a press just before landing still jumps |
| `runSpeed`, `groundAccel/Decel`, `airAccel/Decel` | 7.5 m/s, 75/90, 45/22 m/s² | full speed in ~0.1 s on ground; air control ~60 % |
| `wallSlideSpeed`, `wallJumpUp/Out`, `wallJumpLock` | 2.8, 11 / 7.5 m/s, 0.16 s | lock = short time input is weakened so the kick-off is not cancelled |
| `ledgeReach`, `climbTime` | 0.35 m, 0.26 s | grab when the box top is within reach of the hands (0.9 × height) |
| `dashSpeed`, `dashTime`, `airDashes` | 19 m/s, 0.16 s, 1 | ≈ 3 m dash, gravity off during it; refills on ground / wall jump |

Derived reach with the defaults: flat gap ≈ 4.9 m raw, `maxGap(p, 0)` ≈ 4.2 m safe; max rise
≈ 2.1 m (jump), ≈ 3.8 m with ledge grab.

### Level design method
1. **Fix the feel first**, then derive the level metrics from it (`jumpArc`, `maxGap`); never
   hand-place a gap without `canReach`. When feel numbers change, re-run `validateLevel`.
2. **Rhythm**: alternate tension and rest. A chunk of 2–3 challenge pieces, then a safe static
   platform with a checkpoint (`checkpointEvery: 3`). Put a new mechanic first in a safe form
   (moving platform over a short gap) before combining it with hazards.
3. **Difficulty** = gap/maxGap ratio (0.3 → easy, 0.9 → expert), platform length (shorter is
   harder), hazards under gaps, waiting (movers), and timing (crumble delay).
4. **Teach with collectibles**: the generator places gems on the jump arcs — they show the line.
5. Waiting sections (movers) always start from solid ground (the generator inserts one).
6. Prove solvability in the playtest with `PlatformerBot` *and* script at least one jump with
   raw inputs (hold move, press jump at the edge) — see `tests/scenes/platformer/playtest.json`.

---

## B. Racing (`engine/world/track.js`, `engine/gameplay/racing.js`)

### API
| API | Notes |
|---|---|
| `GF.generateTrack({ seed, controlPoints, radius, irregularity, width, elevation, bankMax, checkpoints, gridSlots, runoff, minRadius, maxGrade })` → `Track` | closed centripetal Catmull-Rom spline, arc-length samples every ~2 m; rejects self-intersection, too-tight corners and near-touching sections (retries with calmer shapes) |
| `track.samples[i]` | `{ x y z s tx tz rx rz curvature bank halfWidth }` (`r` = right of travel, + curvature = right turn, outer edge raised) |
| `track.sampleAt(s)`, `.pointAt(s, lateral)`, `.project(x, z, hint)` → `{ s, lateral, index, frame }`, `.heightAt(x, z)`, `.onTrack(x, z)`, `.pose(s, lateral)` → `{ position, yaw }` | queries (grid-accelerated) |
| `track.checkpoints` (cp0 = start/finish at s=0), `track.startGrid` (staggered 2-wide slots behind the line), `track.curbs` | auto-placed |
| `GF.trackMesh(track, { lowDetail })` | asphalt road with edge lines, red/white curbs, gravel runoff, barrier walls, start checker + gantry, checkpoint pylons, ground skirt |
| `GF.addTrackPhysics(world, track)` | `world.groundFn` = banked surface for the raycast vehicle; barrier boxes (`noGround`) |
| `GF.computeRacingLine(track, { margin, aLat, aBrake, aAccel, vMax })` | `{ offsets, points, curvature, speed, brakingPoints, lapTime, speedAt(s), pointAt(s, extra), withinBounds() }` |
| `new GF.RaceAI(vehicle, track, line, { skill, laneOffset, rubberBand })` `.update(dt, cars)` | pure-pursuit steering on the line, speed from the braking profile, overtake offset, stuck flag |
| `new GF.RaceManager(track, { laps, countdown, autoRespawn })` | `add(vehicle, { name, isPlayer, ai })`, `placeOnGrid()`, `start()`, `update(dt)`, `respawn(e)`, `leaderboard()`, `debugState()`; callbacks `onCountdown onStart onCheckpoint onLap onFinish onWrongWay onRespawn` |
| `GF.formatTime(s)` | `m:ss.mmm` |

Per-step order: `ai.update(dt, cars)` (racing state only) → `playerCar.drive(input)` →
`vehicle.update(dt)` for all → `race.update(dt)` → camera. AI cars use
`GF.car({ …, detail: 'low' })`.

### How timing works
Each entrant has a monotonic `progress` (metres, unwrapped track distance). Checkpoint *k* of
lap *n* sits at `n·L + cp[k].s`; it counts only if passed in order and inside the gate (road +
runoff + slack), otherwise the car is respawned. Lap 1 is timed from GO (grid is behind the
line), later laps line-to-line. Splits are per checkpoint per lap. Positions: finished cars by
finish time, others by `progress`. Wrong way = moving against the tangent > 2 m/s for 0.8 s.
Off track (beyond barrier margin) or stuck → respawn on the centreline, never past the next
checkpoint.

### Racing line and AI
The line is relaxed toward neighbour midpoints (coarse → fine) inside `halfWidth − margin`,
then low-passed. Speed profile: `v = √(aLat/|κ|)` capped, then a backward braking pass
(`aBrake`) and forward traction pass (`aAccel`); a braking point is where the target speed
starts to drop. Rubber-banding scales AI power/top speed by up to +12 % when behind the player
and −8 % when ahead (over 150 m). `skill` 0.88–1.0 spreads the field.

### Track design method
- Length 600–1500 m for arcade (lap 20–60 s); width 11–15 m; tightest radius ≥ 22 m for the
  raycast vehicle; grade ≤ 6 %; bank ≤ 0.1 rad.
- One long straight for the start (the generator puts s=0 there), then a hard braking corner:
  the first corner sorts the field. Mix corner radii; a slow corner after a fast straight
  creates overtaking.
- 6–10 checkpoints; tight corners get curbs on both edges; barriers at `halfWidth + runoff`.
- Verify in a playtest: countdown hold, scripted player inputs cross a checkpoint, AI laps,
  positions change, wrong way, respawn (`tests/scenes/race-track/playtest.json`).

## Limitations
- Platformer levels are laid out along +X (side-on course with depth); the generator has no
  branching paths or wall-jump chimneys (wall jump/slide work, but are not generated).
- Moving platforms carry by translation only (no rotating platforms); crushing is not handled.
- Tracks are star-shaped around the origin (no figure-eights/crossovers, no jumps or tunnels);
  the ground skirt blends heights in the infield, so very close sections can show small seams.
- The raycast vehicle corners arcade-style, so `aLat` is a design number, not a tyre model.

## Action / Souls-like: boss encounters (`engine/gameplay/boss.js`)
`BossController` drives any Enemy with a data-driven moveset: each attack has `windup / active / recovery` seconds (the
recovery is the punish window), an exact hit shape (`cone` radius+arc, `line` length+width, `circle`, `ring` inner+radius)
drawn on the ground as a telegraph that fills during the windup, and optional movement (`lunge`, `leap` to the target's
position at commit time). The boss tracks the player during the first 75 % of a windup, then commits — so a well-timed
dodge or step out always works. Phases switch by health (`until` ratio) with an invulnerable transition (`transitionClip`,
`onEnter`), per-phase `speed` and `combo` (chained attacks). Hits fill **poise**; breaking it staggers the boss for
`staggerTime` (riposte window). `enrage` seconds → +25 % speed/damage.
```js
const boss = new GF.BossController(app, enemy, { name: 'The Warden', poise: 140, attacks: { sweep: { clip: 'heavy', windup: 0.75, active: 0.25,
  recovery: 0.9, shape: 'cone', radius: 4.2, arc: 140, damage: 26, range: [0, 3.8] }, … }, phases: [{ until: 0.6, attacks: ['sweep', 'lunge'] }, …] });
app.add((dt) => { boss.update(dt, player); enemy.update(dt); app.ui.boss(boss.name, enemy.health.ratio); });
boss.on('phase' | 'attack' | 'hit' | 'poiseBreak' | 'enrage' | 'death', fn);
```
Feel numbers: windups 0.5–1.4 s (longer = bigger damage), recoveries 0.7–1.5 s, 2–4 attacks per phase with one gap-closer,
phase 3 adds a combo or an area attack the player hasn't seen, telegraph radius = hit radius exactly (never lie).
Test scene: `tests/scenes/boss-arena` (13 checks). Limits: shapes are ground-plane areas (no vertical reach), one target.
