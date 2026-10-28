# Limitations (honest status)

GameForge produces real, playable, tested browser games, but it is **not** a replacement for a
AAA studio or engine. Concretely:

## Visual fidelity
- **Humans** (default in new projects) are built from the CC0 MakeHuman base mesh and morph
  targets. They have anatomically proportioned and individually varied bodies and faces (checked
  against anthropometric norms by `tools/bench-characters.mjs`), a 163-bone skeleton, facial
  expressions, baked skin textures, garments and hair. They are **not photorealistic**:
  - **Hair** is a textured shell or tube geometry, not strands. Short styles can look
    helmet-like up close.
  - **Garments** are body-offset shells with Laplacian draping, not cloth simulation. Loose
    clothing (skirts, robes) does not swing.
  - **Skin** is a procedurally baked albedo/roughness at 512–1024 px plus a wrap-lighting
    subsurface approximation. There are no scanned textures, pore-level normal maps or
    real-time SSS.
  - **Shoes** are rigid procedural lasts that do not bend at the toes.
  - **Children** are not supported, because the dataset is adult only.
  - **Cost:** about 38–41k triangles and about 0.5 s CPU build time per dressed human. Crowds
    of more than about 20 humans need reduced texture size or the stylized mannequin.
- **The stylized mannequin** (`SPEC.characters = 'stylized'`) remains available. It is
  low-poly with no facial animation.
- **Vehicles** have smooth profile-driven bodies with flush glass, seams, lamps, arches,
  interiors and detailed wheels (`tools/bench-vehicles.mjs`). They read as car classes, not as
  specific production models: there is no sculpted surfacing beyond the profile curves, lamps
  are emissive patches, there are no damage models, and doors do not open.
- **Environment textures** are procedurally synthesized at 256–512 px. There is no
  photogrammetry. Buildings are block massing with facade textures; there are no modelled
  interiors. Terrain, foliage and water are stylized. Overall fidelity is far below GTA VI,
  Spider-Man 2, RDR2 or Cyberpunk 2077.
- **Post-processing:** no real-time GI, SSR, SSAO or volumetrics are enabled. Enabled effects
  are bloom, FXAA, grading, shadows and image-based lighting. Night scenes rely on a light pool
  plus a fill light.
- **Low tier:** the low-quality tier (auto-selected on software WebGL) disables post-processing,
  so headless screenshots look flatter than they would on a GPU.

## Animation
- **Clip sources:**
  - Engine clips are procedural pose functions, retargeted at load time onto the realistic
    rig.
  - BVH motion capture (CMU, Mixamo-style or MakeHuman naming) can be imported with
    `clipFromBVHCanonical`. Only four CC0 BVH clips are bundled; the rest must be supplied by
    the user.
- **Missing systems:** there is no foot IK, root motion, ragdolls or motion matching. Fingers
  are posed procedurally (grip curl). Lip sync uses random visemes while speaking and is not
  driven by audio.

## Simulation
- Physics is a deliberately simple in-house system: kinematic characters, sphere-proxy dynamic
  props, a raycast vehicle with circle-based chassis collision. No rigid-body stacking, joints,
  soft bodies or destruction. Vehicle–traffic collisions are approximate.
- AI is per-agent behaviour trees with a shared attack-token budget; no crowd simulation,
  no navmesh (grid A* only), traffic follows lane graphs without traffic-light logic.

## Scale
- Worlds are single-scene (≈ 400 m terrain or a 5×5-block city). No streaming, no LOD system
  beyond instancing/merging and the vehicle `detail:'low'` option, no multiplayer, no networking.
- Single-file builds that use realistic humans are ~9 MB (6 MB CC0 human dataset).

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
