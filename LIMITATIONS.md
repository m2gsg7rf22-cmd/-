# Limitations (honest status)

GameForge produces real, playable, tested browser games, but it is **not** a replacement for a
AAA studio or engine. Concretely:

## Visual fidelity
- All content is procedural and stylized. Characters are built from lofted/lathed primitives
  with ~4–6k triangles and rigid-ish joint skinning: no sculpted detail, no facial animation,
  no hair simulation, no cloth simulation (capes are skinned to the torso).
- Textures are procedurally synthesized (256² default); no photogrammetry, no hand-painted
  hero textures. Visual results are far from GTA VI / Spider-Man 2 / RDR2 / Cyberpunk 2077.
- No real-time GI, SSR, SSAO or volumetrics are enabled by default (bloom, FXAA, grading,
  shadows and image-based lighting are). Night scenes rely on a light pool + fill light.
- Low-quality tier (auto-selected on software WebGL) disables post-processing, so headless
  screenshots look flatter than on a GPU.

## Animation
- Animations are procedural pose functions sampled to keyframes: readable but not
  motion-captured. No foot IK, no root motion, no ragdolls, no animation retargeting.

## Simulation
- Physics is a deliberately simple in-house system: kinematic characters, sphere-proxy dynamic
  props, a raycast vehicle with circle-based chassis collision. No rigid-body stacking, joints,
  soft bodies or destruction. Vehicle–traffic collisions are approximate.
- AI is per-agent behaviour trees with a shared attack-token budget; no crowd simulation,
  no navmesh (grid A* only), traffic follows lane graphs without traffic-light logic.

## Scale
- Worlds are single-scene (≈ 400 m terrain or a 5×5-block city). No streaming, no LOD system
  beyond instancing/merging, no multiplayer, no networking.

## Performance evidence
- All automated measurements in this repository were taken on **software WebGL (SwiftShader)**
  in a headless container: 4–7 fps at 1280×720. These numbers say nothing about real GPU
  performance, which has **not been measured**. Draw calls/triangles per scene are reported in
  TEST_RESULTS.md.

## Audio
- Synthesized SFX/music are functional but simple (oscillators, filtered noise, a step
  sequencer). No voice acting (dialogue uses babble blips), no HRTF spatialization.

## Agent layer
- Parallel multi-agent execution was demonstrated with Claude Code subagents on Skyline Vigil
  (3 specialists in one wave). Codex/other runners were **not** tested; their instructions
  (AGENTS.md, agents/openai.yaml) are best-effort and marked experimental.
- "Any game at any level" is an aspiration: the composer covers action, driving, adventure,
  exploration, collectathon and survival baselines; other genres (RTS, flight sim, card games,
  platformers with precise collision, shooters with aiming/hit-scan) need custom code written
  by the agent on top of the engine and have no dedicated templates or tests yet.

## Publication
- The requested public repository `gameforge-aaa` could not be created from this environment:
  the GitHub integration returned `403 Resource not accessible by integration` for
  `POST /user/repos`. The complete project was pushed to the `gameforge-aaa` branch of the
  accessible repository instead (see README → Publication).

## Browser support
- Tested only in headless Chromium (Playwright). Firefox/Safari should work (WebGL2, Web Audio,
  ES2020) but are untested. Pointer lock and gamepad were not exercised by automated tests.
