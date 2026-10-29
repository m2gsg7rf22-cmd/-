# From "make me a game like X" to a production plan

When the user names a reference game ("like GTA VI", "like Spider-Man 2", "a Souls-like"),
treat it as a **quality and systems target**. Never copy:
- names, characters, maps, logos or story;
- music, UI art or proprietary code.

Instead, decompose the reference into **systems and feel**, then rebuild them as an original game
with GameForge technology. Write the result into `game.spec.js` and `GDD.md`, and plan the work
in `tasks.json`.

## 1. Decompose the reference (write this table in the GDD)

| Layer | Questions to answer | Example: open-world crime game |
|---|---|---|
| Fantasy | What does the player get to *be*? | A career criminal rising in a sun-drenched city |
| Core loop (30 s) | The verbs used every half minute | Drive, run, aim, shoot, take cover, evade |
| Mission loop (10 min) | How verbs combine into missions | Setup → travel → set piece → escape → payout |
| Meta loop (hours) | Progression and economy | Money, properties, weapons, crew, reputation |
| Camera and controls | Perspective, aim model, traversal | Third person, over-the-shoulder aim, cover, vehicles |
| World structure | Size, density, districts, verticality | City districts, highways, countryside, interiors |
| Systemic layer | What reacts without scripting | Traffic, pedestrians and schedules, police and wanted level, day/night |
| Presentation | Cinematics, UI, audio identity | Mission intros, radio-style music moods, phone UI |
| Content budget | How many missions, side activities, collectibles | e.g. 6 story missions + 3 activity types for a slice |

**Scope honestly.** A browser build made by an agent can deliver a **vertical slice**:
- one district;
- 3–6 missions;
- the full core loop;
- the systemic layer.

It cannot deliver 100 hours of content. State the slice scope in the GDD.

## 2. Map every system to GameForge technology

| System | Engine / tool | Reference doc |
|---|---|---|
| Realistic characters, outfits, faces | `engine/humans.js`, `bench-characters` | characters.md |
| Any bespoke asset (weapons, props, creatures, vehicles, buildings) | Modeling Kit + `gameforge model` | modeling.md |
| Motion (attacks, emotes, traversal, cutscenes) | anim scripts + `gameforge anim`, BVH, IK, ragdoll | animation.md |
| Cities, terrain, foliage, water | `engine/world/*`, `gameforge scene` | modeling.md (scenes), open-world.md |
| Streaming, crowds, schedules, police/wanted | `world/streaming.js`, `world/crowd.js`, `ai/schedules.js`, `gameplay/wanted.js` | open-world.md |
| Melee, combos, bosses | `engine/gameplay/player.js`, `actors.js` | engine-api.md |
| Stealth (light, suspicion, noise, takedowns) | `engine/gameplay/stealth.js` | stealth.md |
| Guns, cover, aiming, first person | `engine/gameplay/shooter.js` | shooter.md |
| Driving and racing | `physics/vehicle.js`, `geometry/vehicles.js`, `gameplay/racing.js`, `world/track.js` | genres.md |
| Platforming, traversal (swing, glide, dash, wall-run) | `gameplay/traversal.js`, `gameplay/platformer.js` | genres.md, recipes.md |
| Story, missions, dialogue, branching | story scripts + `gameforge story`, quests | narrative.md |
| Sound effects, music, ambience | sfx scripts + `gameforge sound`, adaptive music | audio.md |
| Lighting, time of day, post | `engine/render/*` | engine-api.md |
| HUD, menus, accessibility, save | `engine/ui`, `core/save.js` | engine-api.md |
| Verification | playtests, `report.mjs`, benchmarks, review sheets | testing.md, quality-gates.md |

If a system has **no** module, write it as a new reusable module under `engine/` with unit
tests. Don't bury it inside the game. Then add it to this table.

## 3. Genre blueprints (starting points; adapt to the request)

### Open-world crime / action
- **Core loop:** on foot (realistic humans), driving, gunplay with cover, and a wanted system.
- **World:**
  - `generateCity` districts with streaming;
  - day/night lighting;
  - traffic (`TrafficSystem`) and scheduled pedestrians.
- **Missions:** story script with heists, chases and escapes. Each mission mixes ≥ 2 verbs, and
  failure states are recoverable.
- **Feel targets:**
  - car top speed 50–70 m/s and drift-friendly;
  - time-to-kill on enemies 0.4–1.2 s;
  - wanted level 1 clears in about 20 s out of sight.

### Superhero traversal
- **Core loop:** swing, glide, wall-run, combat combos and dodge, with gadgets.
- **World:** a vertical city with rooftops, landmarks visible from far away, and streaming.
- **Feel:** momentum conservation on swings, camera FOV kick at speed, landing recovery under
  0.2 s.
- **Activities:** crimes in progress (spawned by schedules or wanted), races through rings,
  collectibles on rooftops.

### Third-person action / Souls-like
- **Core loop:** stamina-based melee, lock-on, dodge i-frames, parry, heavy and light attacks,
  bosses with phases.
- **World:** a hub plus interconnected areas, shortcuts and checkpoints (bonfire-style rests,
  with original naming).
- **Feel:** commitment in attacks (recovery frames), and hit-stop of 60–100 ms on heavy hits.

### Shooter (third or first person)
- **Core loop:** aim, fire, reload, cover, flank, grenades.
- **Encounters:** arenas with cover graphs, enemy archetypes (rusher, rifleman, sniper, heavy)
  and waves.
- **Feel:** recoil recovery, hit markers, damage falloff, aim assist on gamepad.

### Racing
- **Core loop:** drive, draft, drift, boost.
- **Content:** a generated track set (circuits and point-to-point), AI racers with rubber-banding,
  time trials, ghost.
- **Feel:** grip at the limit that is readable, and speed sensation from FOV, motion blur and
  camera shake.

### Platformer
- **Core loop:** run, jump, dash, wall-jump, with collectibles.
- **Levels:** chunk generator with a reachability guarantee, rhythm of
  teach → test → twist, and checkpoints every 20–40 s.
- **Feel:** coyote time 80–120 ms, jump buffer 100 ms, variable jump height.

### Survival / crafting
- **Core loop:** gather, craft, build, survive (hunger, temperature), with day/night threats.
- **World:** biome terrain with resource nodes (scatterPoints), weather, shelters.
- **Systems:** inventory and crafting recipes (data-driven), enemy schedules at night.

### Stealth
- **Core loop:** observe, hide, distract, takedown.
- **AI:** `StealthSystem` (stealth.md): perception cones weighted by `lightProbe`, suspicion meter,
  patrol → investigate → search → alert, radio alarm → wanted escalation.
- **Level design:** multiple routes, readable guard paths, safe zones.

## 4. Production plan

Follow SKILL.md: spec → GDD → `tasks.json` waves.

1. **Wave 0:** spec, GDD with the decomposition table, slice scope and a style guide.
2. **Wave 1 (in parallel):**
   - world-builder: the scene script with `gameforge scene`;
   - character-director: the cast;
   - 3d-artist: hero assets (model scripts);
   - narrative-director: the story script with `gameforge story`;
   - audio-director: sfx and music moods.
3. **Wave 2:**
   - gameplay-engineer: core loop modules;
   - ai-engineer: enemies, schedules and wanted;
   - animation-director: bespoke clips, IK and ragdoll;
   - ui-ux: HUD.
4. **Wave 3:**
   - integration;
   - QA: playtests covering every verb and mission;
   - performance pass: budgets.
5. **Wave 4:** polish pass. Use review sheets for every asset and screenshots of every area.
   Then build with `gameforge build` and write an honest report.

## 5. Honest quality bar

AAA studios use scanned assets, mocap libraries, years of content and custom engines. A
GameForge game made by an agent is a playable original **vertical slice** that **references**
those games' systems and feel:
- it is procedural or stylized-realistic in look;
- it is verified by tests and review sheets.

Report it that way. Never claim parity with the reference title, and never call it
photorealistic.
