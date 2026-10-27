# Capability matrix

Status meanings: **TESTED** = covered by a passing automated check (unit test or playtest, see
TEST_RESULTS.md) · **IMPLEMENTED** = code exists and runs in a shipped demo but has no dedicated
assertion · **EXPERIMENTAL** = present, unverified or known-rough · **UNSUPPORTED** = not available.

| Area | Capability | Status | Evidence |
|---|---|---|---|
| Pipeline | Spec → GDD → task graph (waves, ownership, conflict/cycle validation) | TESTED | `tests/unit/tooling.test.mjs`, `gameforge plan` |
| Pipeline | Scaffold project from templates blank/action/driving/adventure | TESTED | generated projects pass generated playtests (PROGRESS.md log) |
| Pipeline | Spec composer → playable baseline | TESTED | skyline-vigil, recipes-lab playtests |
| Pipeline | Single-file HTML build working from file:// | TESTED | dist playtests in TEST_RESULTS.md |
| Pipeline | Static validation (network refs, import graph, assets, tasks) | TESTED | `gameforge validate` |
| Pipeline | Parallel specialist subagents with file ownership | TESTED (Claude Code) | Skyline Vigil src/story.js, ai.js, gameplay.js written by 3 parallel subagents; 25/25 playtest |
| Pipeline | Codex / other agents | EXPERIMENTAL | AGENTS.md, docs/PORTABILITY.md (not run) |
| Rendering | PBR, ACES tone mapping, soft shadows following focus, IBL from sky | IMPLEMENTED | all demos; canvas checks |
| Rendering | Physical sky, day/night cycle, stars, fog | TESTED | lantern-isle ending (time jump), canvas checks |
| Rendering | Post: bloom, grading, vignette, FXAA (medium/high tiers) | IMPLEMENTED | showcase screenshots on `quality=high` |
| Rendering | Quality tiers auto-detected | IMPLEMENTED | `tier` in metrics |
| Rendering | Light pool (N real lights over many anchors), night fill light | IMPLEMENTED | skyline-vigil, neon-circuit |
| Textures | 21 seamless procedural PBR texture recipes | TESTED | `content.test.mjs` (variation, seam ratio, normals) |
| Geometry | Loft/lathe/tube/rounded box/displace/box-UV/merge | TESTED | `content.test.mjs` |
| Assets | 24 props, 3 building types, 5 vehicle types, trees ×4 species | TESTED | `content.test.mjs` validateObject |
| Assets | GLB/OBJ export | TESTED | `content.test.mjs`, `gameforge export` |
| Characters | Procedural skinned humanoid (outfits, armor, cape, hair, faces) | TESTED | weights/skeleton unit test; all demos |
| Animation | 28 procedural clips, locomotion blending, upper-body layering, hit events | TESTED | clip unit test; combat playtests rely on hit events |
| Animation | Custom clips via `defineClip` | TESTED | recipes-lab |
| Animation | Cinematic camera rails, letterbox, subtitles | TESTED | lantern-isle ending cutscene |
| World | Heightfield terrain (hills/mountains/dunes/island), flatten, roads, splat material | TESTED | unit + all terrain demos |
| World | Instanced vegetation, grass with wind | IMPLEMENTED | ashen-vale, lantern-isle |
| World | Water with shoreline foam | IMPLEMENTED | lantern-isle screenshots |
| World | Procedural city (roads, lanes, zoning, parks, props) | TESTED | unit test + neon-circuit, skyline-vigil |
| Physics | Character controller (ground, walls, jump, slopes, swimming) | TESTED | unit + playtests |
| Physics | Raycast vehicle (suspension, grip, drift, boost, brakes, collisions/damage) | TESTED | unit + neon-circuit |
| Physics | Raycasts, overlaps, triggers, dynamic knock-able props | TESTED | unit (raycast/overlap); props IMPLEMENTED |
| Traversal | Swing, glide, double jump, air dash | TESTED | skyline-vigil |
| AI | Behaviour trees, FSM, perception, steering, attack tokens | TESTED | unit + combat playtests |
| AI | A* nav grid with smoothing | TESTED | unit |
| AI | Ambient traffic on lane graph | TESTED | neon-circuit ("AI traffic drives") |
| Gameplay | Melee combos, heavy, block/parry, dodge i-frames, lock-on, soft-lock, ability | TESTED | ashen-vale |
| Gameplay | Waves, bosses with bars, phases | TESTED | ashen-vale, recipes-lab |
| Gameplay | Quests (typed objectives, chains, sequential, optional), flags, dialogue scripts, branching | TESTED | unit + lantern-isle + skyline-vigil |
| Gameplay | Inventory, item-gated interactions, XP/levels | TESTED | lantern-isle, unit |
| Gameplay | Save/load with versioned migrations | TESTED | unit + lantern-isle |
| Gameplay | Checkpoint race, timer, best time | TESTED | neon-circuit |
| Gameplay | Projectiles | TESTED | recipes-lab |
| Audio | 37 synthesized SFX, spatial pan, engine loop, ambience, adaptive music (7 moods) | IMPLEMENTED | `audioEvents` metric > 0 in playtests; not listened to by a human |
| UI | HUD kit, menus, dialogue box, minimap, compass, speedometer, boss bar | TESTED | menu/dialogue/end-screen checks |
| UI | Accessibility: text scale, subtitles, high contrast, colour filters, reduced motion, shake, remapping API, invert Y | IMPLEMENTED | settings menu; not covered by assertions |
| Input | Keyboard/mouse, gamepad mapping, touch joystick | IMPLEMENTED (keyboard via virtual actions TESTED) | gamepad/touch untested |
| Performance | Metrics capture (draw calls, triangles, fps) | TESTED | TEST_RESULTS.md |
| Performance | Real-GPU frame rate | UNSUPPORTED (not measured) | only SwiftShader available |
| — | Multiplayer, streaming open worlds, ragdolls, IK, cloth, mocap, voice acting, photorealism | UNSUPPORTED | see LIMITATIONS.md |
