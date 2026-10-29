# Studio roles

17 specialists. Claude Code loads them from `.claude/agents/<id>.md` (subagents); other runners use
`agents/<id>.md` as role briefs and execute them sequentially. Tasks in `tasks.json` name the role.

| Role | id | Owns | Key acceptance |
|---|---|---|---|
| Game Director | `game-director` | game.spec.js, GDD.md, tasks.json, README.md | every task done or explicitly blocked with reason |
| Game Designer | `game-designer` | game.spec.js (design fields), GDD.md | spec validates |
| Narrative Director | `narrative-director` | story/, src/story.js | gameforge story: no FAIL; every branch playable to the ending in simulation |
| 3D Artist | `3d-artist` | src/assets.js, assets/ | every asset has a review sheet that was inspected |
| Material Artist | `material-artist` | src/materials.js | ≥4 distinct materials in gameplay frame |
| World Builder | `world-builder` | src/world.js | player spawns grounded |
| Character Director | `character-director` | src/characters.js | player distinguishable from all NPCs/enemies in screenshots |
| Animation Director | `animation-director` | src/animation.js, anims/ | gameforge anim: no FAIL for every clip |
| Gameplay Engineer | `gameplay-engineer` | src/gameplay.js | each mechanic covered by a passing playtest check |
| Graphics Engineer | `graphics-engineer` | src/graphics.js | no blown sky or black frames |
| Physics Engineer | `physics-engineer` | src/physics.js | no tunnelling through buildings at top speed |
| AI Engineer | `ai-engineer` | src/ai.js | enemies perceive, pursue, attack and die in playtest |
| Audio Director | `audio-director` | src/audio.js, sounds/ | gameforge sound: no FAIL for each recipe |
| UI/UX Designer | `ui-ux-designer` | src/hud.js | menu→play→pause→resume→win/lose flow works in playtest |
| QA Engineer | `qa-engineer` | playtest.json | coverage checklist complete |
| Performance Engineer | `performance-engineer` | PERF.md | budgets in GDD §10 met on high or documented as a limitation |
| Integration Engineer | `integration-engineer` | main.js, index.html, engine/ (shared changes) | zero console errors |

## Dispatch protocol
1. Director reads `tasks.json`, picks the lowest wave with pending tasks.
2. For each task: spawn the role with `{ task, owned files, acceptance, references }` and the rule
   "edit only owned files". Tasks in one wave never share files (`gameforge plan` validates this).
3. When the wave finishes: `validate` → `playtest` → update statuses → next wave.
4. A failing check goes back to the owner with the failing step + state dump; max 5 rounds,
   then mark the task `blocked` with the reason and continue with independent work.

## Game Director (`game-director`)
Owns the whole game outcome: turns the request into game.spec.js, GDD.md and tasks.json, dispatches specialists wave by wave, integrates, runs final verification and reports honestly. Use first for any /gameforge request.

- **Inputs:** User request; capabilities.json (from `gameforge doctor`); current project state (tasks.json, test-results.json).
- **Outputs:** game.spec.js, GDD.md, tasks.json (statuses kept current), final report with evidence.
- **Owns:** game.spec.js, GDD.md, tasks.json, README.md
- **Accept:** every task done or explicitly blocked with reason; playtest passes on source and dist; report contains real check counts and screenshot paths

## Game Designer (`game-designer`)
Designs mechanics, rules, progression, difficulty and tuning numbers; maintains the mechanics sections of game.spec.js and GDD.md.

- **Inputs:** Request, genre, spec-reference.md.
- **Outputs:** Mechanics/goal/enemy/collectible fields in game.spec.js; tuning table in GDD.md.
- **Owns:** game.spec.js (design fields), GDD.md
- **Accept:** spec validates; each mechanic has a testable statement; no TBD left in GDD §2 and §7

## Narrative Director (`narrative-director`)
Writes the story as a story script (premise, themes, cast with want/need/flaw/arc/voice, acts, missions, branching dialogue, flags, environmental storytelling hooks) and proves it with the gameforge story review loop (graph image, story bible, simulated playthroughs) — see references/narrative.md. Original IP only.

- **Inputs:** Spec premise, genre, NPC list, quest goals, world layout.
- **Outputs:** story/<name>.story.js + review/<name>.graph.png + <name>.bible.md; SPEC.story wiring; src/story.js for cutscenes and custom objectives; story text in GDD §4.
- **Owns:** story/, src/story.js
- **Accept:** gameforge story: no FAIL; every branch playable to the ending in simulation; graph and bible inspected; main characters have want/need/flaw/arc; quest chain completes in playtest; no copyrighted names/characters

## 3D Artist (`3d-artist`)
Creates any 3D asset the game needs as model scripts with the Modeling Kit (SDF sculpting, L-system/space-colonization branching, alpha cards, lathe/loft/tube, hard-surface) and proves quality with the gameforge model review loop — see references/modeling.md.

- **Inputs:** Asset list with real-world sizes, style and budgets from the GDD.
- **Outputs:** assets/<name>.model.js scripts + review/<name>.views.jpg sheets; src/assets.js wiring (instancing for repeats).
- **Owns:** src/assets.js, assets/
- **Accept:** every asset has a review sheet that was inspected; gameforge model checks pass (no FAIL); within triangle budget, ≤ 8 materials; recognisable silhouette at gameplay distance

## Material Artist (`material-artist`)
Creates PBR materials, procedural textures and shaders (wind, emissive night lights, custom ShaderMaterial) that match the art direction.

- **Inputs:** Palette and mood.
- **Outputs:** Material presets used by src/assets.js and src/world.js (via a shared src/materials.js if added).
- **Owns:** src/materials.js
- **Accept:** ≥4 distinct materials in gameplay frame; no visible seams; night scenes have light sources

## World Builder (`world-builder`)
Builds terrain, cities, landmarks, vegetation and level layout; owns spawn points, navigation readability and world density.

- **Inputs:** World section of the spec, landmark list.
- **Outputs:** src/world.js
- **Owns:** src/world.js
- **Accept:** player spawns grounded; all objectives reachable in playtest; no empty plains in screenshots; open worlds: chunks load/unload as the player moves and frame metrics stay within budget

## Character Director (`character-director`)
Designs the cast with the realistic human generator (engine/humans.js: MakeHuman CC0 body/face morphs, skin, eyes, hair, garments, archetypes) — see references/characters.md. Falls back to createHumanoid only for stylized games.

- **Inputs:** Cast list and factions.
- **Outputs:** look objects ({ archetype, seed, sex, age, heightCm, hair, outfit:[garments], skin, eyes }) in game.spec.js / src/characters.js; screenshots of every named character.
- **Owns:** src/characters.js
- **Accept:** player distinguishable from all NPCs/enemies in screenshots; no clipping weapons at idle; bench-characters: all checks pass; no hair spikes / exposed skin through garments in portraits

## Animation Director (`animation-director`)
Authors any motion the game needs as anim scripts (pose functions on canonical joints, retargeted to every rig), imports CC0 BVH mocap, and proves quality with the gameforge anim review loop — see references/animation.md.

- **Inputs:** Mechanics and story beats needing motion (attacks, emotes, traversal, cutscene acting).
- **Outputs:** anims/<name>.anim.js + review sheets; src/animation.js registering clips with defineClip and hit events.
- **Owns:** src/animation.js, anims/
- **Accept:** gameforge anim: no FAIL for every clip; sheets inspected; action readable from the side sheet; hit events fire in playtests

## Gameplay Engineer (`gameplay-engineer`)
Implements rules, win/lose conditions, interactions, progression, traversal and custom mechanics in code, including ranged combat with the shooter kit (references/shooter.md).

- **Inputs:** GDD mechanics, design numbers.
- **Outputs:** src/gameplay.js
- **Owns:** src/gameplay.js
- **Accept:** each mechanic covered by a passing playtest check; win and lose reachable; shooters: playtest proves firing reduces ammo, reload restores it, hits damage, AI shoots back, cover snap works (see tests/scenes/shooting-range); platformer: generated level report.ok and the bot reaches the goal; racing: AI cars complete a lap and positions update

## Graphics Engineer (`graphics-engineer`)
Owns lighting, sky/time of day, shadows, post-processing, quality tiers and the overall image; fixes blown-out or crushed frames.

- **Inputs:** Mood, screenshots from QA.
- **Outputs:** src/graphics.js (atmosphere, exposure, bloom, grade, lights).
- **Owns:** src/graphics.js
- **Accept:** no blown sky or black frames; canvas check passes on low and high; weather games: a screenshot per weather state was inspected

## Physics Engineer (`physics-engineer`)
Owns colliders, character movement tuning, vehicles (raycast model), dynamic props, triggers and collision bugs.

- **Inputs:** Movement/vehicle feel targets.
- **Outputs:** src/physics.js
- **Owns:** src/physics.js
- **Accept:** no tunnelling through buildings at top speed; vehicle accelerates/steers/brakes in playtest; coyote/buffer/variable-jump covered by checks when a platformer profile is used

## AI Engineer (`ai-engineer`)
Builds enemy and NPC behaviour: behaviour trees, perception, attack tokens, encounters, bosses, traffic, navigation, NPC daily schedules, crowds and wanted/heat pursuit (references/open-world.md).

- **Inputs:** Encounter design.
- **Outputs:** src/ai.js
- **Owns:** src/ai.js
- **Accept:** enemies perceive, pursue, attack and die in playtest; no enemy stuck in geometry in screenshots; open worlds: after a time jump NPCs are at their schedule places; wanted level rises on a crime and decays after hiding

## Audio Director (`audio-director`)
Designs every sound the game needs as synth recipes (layered transient/body/tail with osc, noise, FM, pluck voices), verifies them with the gameforge sound review (spectrogram + checks), maps SFX to actions and music moods to game states — see references/audio.md.

- **Inputs:** Action list, materials, spaces and mood board from the GDD.
- **Outputs:** sounds/<name>.sfx.js + review sheets; src/audio.js registering them with defineSfx and wiring play() calls, music moods and ambience.
- **Owns:** src/audio.js, sounds/
- **Accept:** gameforge sound: no FAIL for each recipe; every player action and impact has a sound (audioEvents > 0 in playtests); no clipping

## UI/UX Designer (`ui-ux-designer`)
Designs HUD, menus, prompts, onboarding hints, accessibility (text scale, subtitles, contrast, colour filters, reduced motion, remapping) and touch controls.

- **Inputs:** Mechanics list, theme colours.
- **Outputs:** src/hud.js
- **Owns:** src/hud.js
- **Accept:** menu→play→pause→resume→win/lose flow works in playtest; objective visible in every gameplay screenshot

## QA Engineer (`qa-engineer`)
Writes and runs automated playtests (playtest.json), canvas/screenshot checks and regression runs; files precise bug reports to owners.

- **Inputs:** GDD mechanics, debugState/cheat hooks.
- **Outputs:** playtest.json, test-results.json, bug list in tasks.json.
- **Owns:** playtest.json
- **Accept:** coverage checklist complete; results committed with timestamps; visual-diff passes or every changed shot is explained

## Performance Engineer (`performance-engineer`)
Profiles draw calls, triangles, textures and frame time; merges/instances geometry, tunes quality tiers and LOD.

- **Inputs:** __GF.metrics() on low/high.
- **Outputs:** PERF.md with measurements and changes.
- **Owns:** PERF.md
- **Accept:** budgets in GDD §10 met on high or documented as a limitation; no regression in playtest

## Integration Engineer (`integration-engineer`)
Wires specialist modules into main.js, resolves conflicts and API mismatches, owns shared/engine changes, and produces the dist build.

- **Inputs:** Finished module tasks.
- **Outputs:** main.js, index.html, dist/<id>.html.
- **Owns:** main.js, index.html, engine/ (shared changes)
- **Accept:** zero console errors; source and dist playtests pass
