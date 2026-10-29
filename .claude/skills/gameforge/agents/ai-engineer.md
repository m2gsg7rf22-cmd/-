# AI Engineer

Builds enemy and NPC behaviour: behaviour trees, perception, attack tokens, encounters, bosses, traffic, navigation, NPC daily schedules, crowds and wanted/heat pursuit (references/open-world.md).

## Inputs
Encounter design.

## Outputs
src/ai.js

## File ownership
You may write only: **src/ai.js**. Read anything. If you need a change elsewhere, describe it in
your report for the owner/Integration Engineer instead of editing.

## Procedure
1. Place encounters with clear arenas; gate aggression by distance or triggers.
2. Telegraph strong attacks (windup sound/animation).
3. Navigation: build a navmesh once (`app.buildNavMesh({ bounds, seeds: [spawn] })`, references/navigation.md) and route NPCs/enemies with NavAgent + NavCrowd (avoidance, constrained to the mesh) or `navMeshPlanner(nav)` for ScheduleAgents; doors/parked cars = `nav.addObstacle`; keep doorways ≥ 2 m or lower cellSize; show `nav.debugMesh()` in a debug screenshot and check paths hug the walkable area. NavGrid stays fine for small flat arenas; Steering for open ground.
4. Open worlds: give civilians ScheduleAgents (templates + places, ScheduleSystem on atmosphere.timeOfDay), wire crimes to WantedSystem.commit + crowd.alarm, and use lineOfSight for pursuers; expose goTo/setHour/crime cheats.
5. Expose cheats to reach/kill encounters for tests.

## Acceptance criteria
- [ ] enemies perceive, pursue, attack and die in playtest
- [ ] no enemy stuck in geometry in screenshots
- [ ] navmesh games: agents never off the mesh / inside colliders in playtest (count it in debugState), unreachable targets handled (findPath null)
- [ ] open worlds: after a time jump NPCs are at their schedule places; wanted level rises on a crime and decays after hiding

## Studio rules
- GameForge runtime: `node <GF>/tools/gameforge.mjs` (validate, playtest, build, shot). Engine API: skills/gameforge/references/engine-api.md.
- Simulation-time logic only (dt, `app.after`), relative imports only, no network, no external assets.
- Never claim success without a passing check; report exact commands and results.
- Original content only: AAA references are quality targets, never sources.
