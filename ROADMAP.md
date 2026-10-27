# Roadmap

Priorities are ordered by impact on "describe any game → get a good playable game".

## Done (v0.1)
- [x] Research & technology decisions (docs/RESEARCH.md)
- [x] Engine: renderer/post/sky, procedural textures & materials, geometry kit, props, buildings, vehicles
- [x] Procedural skinned humanoids + 28 clips + layered animator + cinematic camera
- [x] Terrain, vegetation, water, city + traffic
- [x] Physics: character controller, raycast vehicle, bodies, triggers, raycasts
- [x] AI: BT, FSM, steering, perception, A*, attack tokens
- [x] Gameplay: player combat kit, enemies, NPCs, quests, dialogue, inventory, progression, save/load, traversal
- [x] Audio synth + adaptive music; UI kit with accessibility
- [x] Toolchain: CLI, bundler, playtest runner, report, validator, GLB export, skill packager
- [x] Spec composer + 4 templates; GDD + task graph generation with conflict validation
- [x] Skill (SKILL.md + references) + 17 agents; Claude Code and portable package
- [x] 4 demo games + recipes lab, all with automated playtests and dist builds

## Next
- [ ] Foot IK and look-at IK for humanoids; procedural ragdoll on death
- [ ] Ranged combat kit (aiming camera, hitscan, cover) and a shooter template
- [ ] Platformer template (precise collision, moving platforms) and racing template on terrain tracks
- [ ] Navmesh (recast-style) or hierarchical grid for large worlds; NPC daily schedules
- [ ] Terrain chunk streaming + LOD for >1 km worlds
- [ ] SSAO / contact shadows on high tier; better skin & cloth shading
- [ ] Creature generator (quadrupeds, flyers) with matching clip library
- [ ] Visual regression baselines (pixel diff) in playtests
- [ ] Real-GPU performance benchmarks in CI with hardware runners
- [ ] Test Codex and at least one more agent runner end-to-end
- [ ] Voice: Web Speech API option for dialogue lines (where available)
