# GameForge engine API (engine/index.js)

`import * as GF from './engine/index.js'` (adjust the relative path). `GF.THREE` is the vendored
three.js r180. Everything is procedural and runs without network or build step.

## App & core
| API | Notes |
|---|---|
| `new GF.GameApp({ id, title, container, timeOfDay, dayLength, theme, fov, atmosphere, quality })` | renderer + scene + camera + `atmosphere` + `physics` + `input` + `audio` + `ui` + `vfx` + `save` + `loop` + `events` |
| `app.add(fn(dt,t), { order, states })` | fixed-step update; `states` default `['playing']`, or `'all'` |
| `app.setState(s)` | `menu playing paused dialogue cutscene gameover` (free-form allowed) |
| `app.after(seconds, fn)` | simulation-time timer (deterministic) |
| `app.shake(a)`, `app.hitStop(s)` | feel |
| `app.debugState = () => ({...})` | exposed via `window.__GF.state()` for tests |
| `GF.RNG(seed)` `.next() .range(a,b) .int(a,b) .pick(arr) .chance(p) .fork(salt)` · `GF.Noise(seed)` `.noise2 .fbm2 .ridged2 .noise3` | deterministic |
| `app.input.value(a) .held(a) .pressed(a) .moveVector() .look() .bind(a, codes) .rebind(a)` | actions in `DEFAULT_BINDINGS` (move*, jump, sprint, attack, heavy, block, dodge, lockOn, ability, interact, pause, accelerate, brake, steer*, handbrake, boost, horn, choice1-4…) |
| `app.save.register(key, { save, load })`, `.save(slot)`, `.load(slot)`, `.has(slot)` | localStorage with memory fallback |
| `app.events.on/emit` | `quest:start`, `quest:complete`, `objective:complete`, `dialogue:*`, `enemy:killed`, `player:hit`, `player:parry`, `audio:unlocked`, `state` |

## Rendering
| API | Notes |
|---|---|
| `app.atmosphere.setTime(h)`, `.timeOfDay`, `.daylight`, `.isNight`, `.setFocus(v)` | sky, sun shadows (follow focus), IBL, fog, stars |
| `GF.pbr(kind, { repeat, color, … })` | procedural PBR: grass dirt sand rock snow asphalt(lanes) concrete plaster brick cobble planks roof metal paintedMetal fabric leather skin bark leaves tiles facade |
| `GF.solid(color, { roughness, metalness, emissive })`, `GF.emissive(c, i)`, `GF.glass()`, `GF.carPaint(c)` | cached materials |
| `GF.registerNightEmissive(mat, day, night)` | windows/lamps glow at night automatically |
| `GF.applyWind(mat)` | vertex wind sway (foliage) |
| `app.vfx.emit(preset, pos, { count, direction, color, scale })` | sparks hit dust smoke fire magic splash debris confetti trail tireSmoke heal |

## Geometry & assets
| API | Notes |
|---|---|
| `GF.Geo.MeshBuilder` `.add(geo, mat, matrix)` `.build()` | merges per material (few draw calls) |
| `GF.Geo.loft(sections)`, `smoothLoft`, `lathe(profile)`, `tube(points, r)`, `roundedBox`, `displace`, `boxUV`, `mat4(pos, rot, scale)`, `mergeByMaterial(group)`, `validateObject(obj)` | procedural modelling |
| `GF.PROPS.<name>(opts)` | tree(species oak/pine/palm/dead) rock bush crate barrel lampPost fence bench chest torch pillar stoneWall stall well sword axe shield staff pickup(coin/gem/health/key) trafficCone hydrant trashBin trafficLight barrier |
| `GF.house/shop/tower(opts)` | buildings with colliders, night windows |
| `GF.car({ type: sedan/sports/suv/truck/van, color, lightbar, taxi })` | vehicle rig with wheels |
| `GF.createHumanoid(params)` + `GF.attach(char, 'hand_R', obj)` | skinned procedural human; params: height build shoulders hips skin hair hairStyle(short/long/ponytail/buzz/mohawk/bun/bald) outfit(casual/armor/robe/suit/skin) top bottom shoes accent armor helmet cape capeColor coat beard |
| `GF.exportGLB(obj)` / `GF.exportOBJ(obj)` | asset export (also `gameforge export <asset>`) |

## Animation
| API | Notes |
|---|---|
| `new GF.HumanoidAnimator(char)` `.setLocomotion(speed, grounded)` `.play(clip, { upperOnly, speed, onEnd })` `.setOverride(loopClip)` `.setUpperOverride(clip)` `.on('hit', fn)` | idle walk run sprint jump fall land attack1-3 heavy punch kick block dodge hit death talk wave cheer sit drive cast interact swing fly combatIdle strafe |
| `GF.defineClip(name, { duration, loop, events: { hit: 0.4 }, pose: (p) => ({ bone: [x,y,z] deg, hipsY }) })` | author new moves as pose functions |
| `new GF.CinematicCamera(camera).play(keys, onEnd)` | keys `{ t, pos, look, fov }` |
| `GF.Tweens` | `to(obj, props, sec, { ease })` |

## World
| API | Notes |
|---|---|
| `new GF.Heightfield({ size, resolution, seed, height, type, island, flatten, roads })` `.heightAt .normalAt .flattenArea .carveRoad .raycast` | terrain data |
| `GF.terrainMesh(hf, { palette })`, `GF.createWater({ level, heightfield })`, `GF.populate(hf, {...})` | splat terrain, water, instanced vegetation |
| `GF.generateCity({ seed, blocks, style })` → `{ group, colliders, dynamicProps, graph, roadCenters, isRoad }`; `new GF.TrafficSystem(scene, city)` | city + traffic |

## Physics
| API | Notes |
|---|---|
| `app.physics.addStatic({ type: box|cylinder|sphere, … })`, `.addFromObject(obj)` | static colliders (uses `userData.collider`) |
| `.raycast(origin, dir, max)`, `.overlapSphere(c, r)`, `.groundHeight(x, z)`, `.addBody({ object, position, radius, mass })`, `.addTrigger({ x, z, r, onEnter })`, `.updateTriggers(actors)` | queries, props, triggers |
| `new GF.CharacterController(world, opts).move(dt, dir, speed, { jump })` | kinematic character |
| `new GF.Vehicle(world, carRig, tuning)` `.drive(input)` `.update(dt)` | raycast vehicle; `.kmh .drifting .boostFuel .damage` |
| `new GF.Traversal(player, opts)` | swing / glide / double jump / air dash (see recipes) |

## Gameplay & AI
| API | Notes |
|---|---|
| `new GF.Player(app, { combat, look, hp, position })` `.control(dt)` `.interactables.push({ position, label, action })` `.targets = () => enemies` `.receive(dmg, info)` | full third-person kit |
| `new GF.Enemy(app, { type, position, tokens, stats })` `.think(dt, target)` `.update(dt)` `.strike([player])` ; `GF.ENEMY_TYPES` | BT-driven melee AI |
| `new GF.NPC(app, { look, position, dialogue, waypoints, wanderRadius })` `.setMarker('!')` | villagers |
| `GF.bt.sel/seq/cond/act/wait/cooldown` + `new GF.BehaviorTree(root, bb)` ; `GF.StateMachine` ; `GF.Steering.*` ; `GF.NavGrid.fromWorld(world)` `.findPath(a, b)` ; `GF.Perception` | AI toolkit |
| `GF.Health`, `GF.Stamina`, `GF.meleeSweep`, `GF.ComboSystem`, `GF.ProjectileSystem`, `GF.Inventory`, `GF.Progression`, `GF.separateActors` | systems |
| `GF.Flags`, `GF.QuestSystem`, `GF.DialogueSystem` (`define(id, script)`), `GF.parseDialogue`, `GF.Mission` | narrative |

## Audio & UI
| API | Notes |
|---|---|
| `app.audio.play(name, { pos, pitch, volume })` | GF.SFX_NAMES: swing hit heavyHit clang block hurt death footstep(Grass) jump land dodge pickup coin powerup levelUp questComplete questStart ui* explosion crash screech horn checkpoint countdown go magic shoot door chest splash bird alarm whoosh thwip |
| `app.audio.playMusic(mood, { intensity })`, `.music.intensity = x` | moods: exploration calm tension combat driving heroic mystery |
| `app.audio.engine()` → `.set(rpm, load)`; `.ambience('wind'/'waves'/'city'/'rain'/'forest')`; `.speak(text)` | continuous sounds |
| `app.ui.bar/counter/objectives/minimap/compass/speedometer/prompt/toast/subtitle/damageNumber/boss/letterbox/flash/fade` | HUD |
| `app.ui.mainMenu/pauseMenu/settingsMenu/endScreen/loading/showDialogue` | menus; settings include volume, quality, sensitivity, invert Y, text size, subtitles, high contrast, colour filters, reduced motion, shake |

## Composer
`GF.composeGame(spec, { modules })` → `game` object (see spec-reference.md). Modules export
`install(game)`; set `game.onUpdate = (dt) => …` for per-frame custom logic (runs in `playing`).
